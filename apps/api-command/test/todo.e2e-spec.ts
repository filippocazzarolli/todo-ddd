import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { outbox } from '@repo/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { SqliteConnection } from './../src/shared/persistence/sqlite.connection';
import { ACTOR_HEADER } from './../src/shared/presentation/actor.decorator';

/**
 * I due attori dei test. Sono `let` e non `const` perché ora devono **esistere**
 * come utenti: la chiave esterna su `todos.owner_id` rende un todo orfano
 * impossibile, quindi gli id non possono più essere stringhe inventate. Li crea
 * il `beforeEach` via `POST /users`, che è anche il modo in cui il repo li
 * otterrebbe in produzione.
 */
let OWNER_ID: string;
let OTHER_ID: string;

/**
 * Unico test che passa da HTTP vero: verifica ciò che gli spec unitari non
 * possono vedere — rotte, status code, il `ValidationPipe` sul body e la
 * mappatura degli errori del filtro. Il resto (regole, eventi, persistenza) è
 * già coperto sotto `src`.
 *
 * L'app usa gli adapter veri — `SystemClock` e i repository Drizzle su SQLite —
 * senza nessun mock. Il database è `:memory:` (lo impone `jest-e2e-setup.ts`,
 * per tutti gli e2e e non solo per questo file) e l'app viene ricostruita a ogni
 * test: ogni test parte da un database vuoto e migrato, senza cleanup.
 *
 * Ogni richiesta porta l'header dell'attore: senza, la rotta risponde 401 e
 * nessun test arriverebbe al dominio. È l'unico posto del repo, oltre al
 * decoratore stesso, che nomina `x-user-id`.
 */
describe('Todo (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  /**
   * Scadenza sempre nel futuro, calcolata dall'ora di sistema: una data fissa
   * scadrebbe e il test comincerebbe a fallire da solo. Componenti locali,
   * perché `Expiration` interpreta data e ora nel fuso del processo.
   */
  function domani(): { date: string; time: string } {
    const instant = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');

    return {
      date: `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
      time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
    };
  }

  /**
   * Crea un utente e ne restituisce l'id. Passa da HTTP come tutto il resto: un
   * insert diretto in tabella salterebbe la generazione dell'id e il confine
   * che questo file esiste per esercitare.
   */
  async function createUser(email: string): Promise<string> {
    const response = await request(server)
      .post('/users')
      .send({ email, firstName: 'Mario', lastName: 'Rossi' })
      .expect(201);

    return (response.body as { userId: string }).userId;
  }

  async function createTodo(
    body: Record<string, unknown> = { title: 'Comprare il latte' },
    actorId: string = OWNER_ID,
  ): Promise<string> {
    const response = await request(server)
      .post('/todos')
      .set(ACTOR_HEADER, actorId)
      .send(body)
      .expect(201);

    return (response.body as { todoId: string }).todoId;
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    // Le email sono fisse: il database è nuovo a ogni test, quindi `UNIQUE
    // (email)` non ha modo di scattare.
    OWNER_ID = await createUser('proprietario@example.com');
    OTHER_ID = await createUser('altro@example.com');
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /todos', () => {
    it('crea il todo e restituisce l`id generato dal server', async () => {
      const response = await request(server)
        .post('/todos')

        .set(ACTOR_HEADER, OWNER_ID)
        .send({
          title: 'Comprare il latte',
          description: 'intero',
          important: true,
          tags: ['casa'],
          expiration: domani(),
        })
        .expect(201);

      const body = response.body as { todoId: string };

      expect(Object.keys(body)).toStrictEqual(['todoId']);
      expect(typeof body.todoId).toBe('string');
      expect(body.todoId.length).toBeGreaterThan(0);
    });

    /**
     * La prima volta che questo contratto viene esercitato da HTTP. Era
     * dichiarato dalla porta di persistenza e nessun adapter poteva
     * rispettarlo: `InMemoryTodoRepository` non vede gli utenti, quindi un todo
     * orfano era rappresentabile. Ora lo impedisce la chiave esterna.
     *
     * Verifica anche l'ordine dei rami del filtro: `TodoOwnerNotFoundError`
     * eredita da `TodoPersistenceError`, che è 409, e deve essere controllato
     * prima della sua base per uscire come 400.
     */
    it('rifiuta un attore che non è un utente, con 400', async () => {
      const response = await request(server)
        .post('/todos')
        .set(ACTOR_HEADER, 'nessuno')
        .send({ title: 'Comprare il latte' })
        .expect(400);

      expect((response.body as { error: string }).error).toBe(
        'TodoOwnerNotFoundError',
      );
    });

    it('non crea il todo orfano che ha rifiutato', async () => {
      const response = await request(server)
        .post('/todos')
        .set(ACTOR_HEADER, 'nessuno')
        .send({ title: 'Comprare il latte' })
        .expect(400);

      expect(response.body).not.toHaveProperty('todoId');
    });

    it('rifiuta un titolo che non è una stringa: lo ferma il ValidationPipe', async () => {
      await request(server)
        .post('/todos')
        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: 123 })
        .expect(400);
    });

    it('rifiuta un campo sconosciuto invece di ignorarlo', async () => {
      // forbidNonWhitelisted: un `titolo` scritto male non deve creare un todo
      // senza titolo, deve dare errore.
      await request(server)
        .post('/todos')

        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: 'Comprare il latte', titolo: 'Comprare il pane' })
        .expect(400);
    });

    it('rifiuta un titolo vuoto: la regola è del dominio, lo status è 400', async () => {
      const response = await request(server)
        .post('/todos')

        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: '   ' })
        .expect(400);

      expect(response.body).toMatchObject({ error: 'TodoTitleRequiredError' });
    });

    it('rifiuta una scadenza nel passato con 400', async () => {
      const response = await request(server)
        .post('/todos')

        .set(ACTOR_HEADER, OWNER_ID)
        .send({
          title: 'Comprare il latte',
          expiration: { date: '2020-01-01', time: '10:00' },
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'TodoExpirationInPastError',
      });
    });

    it('rifiuta una scadenza malformata con 400', async () => {
      const response = await request(server)
        .post('/todos')

        .set(ACTOR_HEADER, OWNER_ID)
        .send({
          title: 'Comprare il latte',
          expiration: { date: 'domani', time: '10:00' },
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'TodoExpirationInvalidError',
      });
    });
  });

  describe('PATCH /todos/:todoId', () => {
    it('aggiorna e risponde 204 senza body', async () => {
      const todoId = await createTodo();

      const response = await request(server)
        .patch(`/todos/${todoId}`)

        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: 'Comprare il pane', description: null })
        .expect(204);

      expect(response.body).toStrictEqual({});
    });

    it('accetta un body vuoto: l`update a vuoto non è un errore', async () => {
      const todoId = await createTodo();

      await request(server)
        .patch(`/todos/${todoId}`)
        .set(ACTOR_HEADER, OWNER_ID)
        .send({})
        .expect(204);
    });

    it('rifiuta null su un campo non azzerabile', async () => {
      const todoId = await createTodo();

      await request(server)
        .patch(`/todos/${todoId}`)

        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: null })
        .expect(400);
    });

    it('risponde 404 su un id inesistente', async () => {
      const response = await request(server)
        .patch('/todos/inesistente')

        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: 'Comprare il pane' })
        .expect(404);

      expect(response.body).toMatchObject({ error: 'TodoNotFoundError' });
    });
  });

  describe('POST /todos/:todoId/done e /reopen', () => {
    it('completa, riapre, ricompleta', async () => {
      const todoId = await createTodo();

      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);
      await request(server)
        .post(`/todos/${todoId}/reopen`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);
      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);
    });

    it('risponde 409 se il todo è già completato', async () => {
      const todoId = await createTodo();
      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);

      const response = await request(server)
        .post(`/todos/${todoId}/done`)

        .set(ACTOR_HEADER, OWNER_ID)
        .expect(409);

      expect(response.body).toMatchObject({ error: 'TodoAlreadyDoneError' });
    });

    it('risponde 409 se riapre un todo che non è completato', async () => {
      const todoId = await createTodo();

      const response = await request(server)
        .post(`/todos/${todoId}/reopen`)

        .set(ACTOR_HEADER, OWNER_ID)
        .expect(409);

      expect(response.body).toMatchObject({ error: 'TodoNotDoneError' });
    });

    it('risponde 404 su un id inesistente', async () => {
      await request(server)
        .post('/todos/inesistente/done')
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(404);
    });
  });

  describe('DELETE /todos/:todoId', () => {
    it('cancella e risponde 204', async () => {
      const todoId = await createTodo();

      await request(server)
        .delete(`/todos/${todoId}`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);
    });

    it('congela il todo: ogni comando successivo è 409', async () => {
      const todoId = await createTodo();
      await request(server)
        .delete(`/todos/${todoId}`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);

      const response = await request(server)
        .patch(`/todos/${todoId}`)

        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: 'Comprare il pane' })
        .expect(409);

      expect(response.body).toMatchObject({ error: 'TodoDeletedError' });

      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(409);
      await request(server)
        .delete(`/todos/${todoId}`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(409);
    });
  });

  describe('attore e ownership', () => {
    it.each([
      ['POST /todos', 'post', '/todos'],
      ['PATCH /todos/:id', 'patch', '/todos/qualsiasi'],
      ['POST /todos/:id/done', 'post', '/todos/qualsiasi/done'],
      ['POST /todos/:id/reopen', 'post', '/todos/qualsiasi/reopen'],
      ['DELETE /todos/:id', 'delete', '/todos/qualsiasi'],
    ])(
      'risponde 401 senza header dell`attore: %s',
      async (_label, verb, url) => {
        // Nessuna rotta e` raggiungibile in anonimo, nemmeno quelle che
        // fallirebbero comunque: l'identita` precede il dominio.
        const method = verb as 'post' | 'patch' | 'delete';

        await request(server)[method](url).send({}).expect(401);
      },
    );

    it('risponde 401 con un header vuoto', async () => {
      await request(server)
        .post('/todos')
        .set(ACTOR_HEADER, '   ')
        .send({ title: 'Comprare il latte' })
        .expect(401);
    });

    it('rifiuta con 403 chi non e` il proprietario, su ogni rotta', async () => {
      const todoId = await createTodo();

      const patch = await request(server)
        .patch(`/todos/${todoId}`)
        .set(ACTOR_HEADER, OTHER_ID)
        .send({ title: 'Comprare il pane' })
        .expect(403);

      expect(patch.body).toMatchObject({ error: 'TodoNotOwnedError' });

      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OTHER_ID)
        .expect(403);
      await request(server)
        .post(`/todos/${todoId}/reopen`)
        .set(ACTOR_HEADER, OTHER_ID)
        .expect(403);
      await request(server)
        .delete(`/todos/${todoId}`)
        .set(ACTOR_HEADER, OTHER_ID)
        .expect(403);
    });

    it('non lascia traccia del tentativo: il proprietario trova il todo intatto', async () => {
      const todoId = await createTodo();

      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OTHER_ID)
        .expect(403);

      // Se il 403 avesse scritto qualcosa, questa transizione sarebbe un 409.
      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);
    });

    it('un id inesistente resta 404 anche per un estraneo', async () => {
      // Prima si cerca, poi si autorizza: un 403 qui direbbe a un estraneo che
      // quell'id esiste. Non esiste, e la risposta e` la stessa per tutti.
      await request(server)
        .post('/todos/inesistente/done')
        .set(ACTOR_HEADER, OTHER_ID)
        .expect(404);
    });

    it('due utenti creano todo indipendenti', async () => {
      const mio = await createTodo({ title: 'Comprare il latte' });
      const suo = await createTodo({ title: 'Comprare il pane' }, OTHER_ID);

      expect(mio).not.toBe(suo);

      await request(server)
        .delete(`/todos/${suo}`)
        .set(ACTOR_HEADER, OTHER_ID)
        .expect(204);
      await request(server)
        .delete(`/todos/${mio}`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(204);
    });
  });

  it('risponde 404 su una rotta che non esiste', async () => {
    await request(server).get('/todos').set(ACTOR_HEADER, OWNER_ID).expect(404);
  });

  /**
   * L'outbox visto dal confine HTTP: un comando andato a buon fine lascia il suo
   * evento in una tabella durevole, non solo su un bus in-process che nessuno
   * ascolta. È la differenza fra un evento che si può ancora consegnare e uno
   * perso per sempre se il processo muore.
   */
  describe('l’outbox', () => {
    /**
     * Filtra per `aggregate_type`, perché la tabella **è una sola per i due
     * bounded context**: quando questo blocco gira, il `beforeEach` ha già
     * lasciato i due `UserCreatedEvent` dei suoi utenti. Non è un effetto
     * collaterale del test, è la forma dell'outbox — un solo registro ordinato,
     * che è ciò che permetterà a un relay di consegnare nell'ordine giusto
     * eventi di aggregati diversi.
     */
    function outboxTodoRows() {
      return app
        .get(SqliteConnection)
        .db.select()
        .from(outbox)
        .where(eq(outbox.aggregateType, 'todo'))
        .orderBy(outbox.sequence)
        .all();
    }

    it('registra l’evento del comando, non ancora pubblicato', async () => {
      const todoId = await createTodo();

      expect(outboxTodoRows()).toMatchObject([
        {
          aggregateId: todoId,
          name: 'TodoCreatedEvent',
          // Nessun relay lo consuma ancora: resta lì, ed è il punto.
          publishedAt: null,
        },
      ]);
    });

    it('non registra niente per un comando rifiutato', async () => {
      await request(server)
        .post('/todos')
        .set(ACTOR_HEADER, OWNER_ID)
        .send({ title: '   ' })
        .expect(400);

      expect(outboxTodoRows()).toStrictEqual([]);
    });
  });

  /**
   * Una riga che il dominio non sa rappresentare non è colpa del chiamante: è un
   * guasto, quindi 500 e non 400. Ci arriva perché `TodoRowInvalidError` non
   * discende da nessuna delle tre gerarchie che `TodoErrorFilter` cattura — la
   * regola "un errore di dominio nuovo è 400" vale per il dominio, non per la
   * persistenza corrotta.
   */
  describe('una riga corrotta in tabella', () => {
    it('risponde 500, non 400', async () => {
      const todoId = await createTodo();
      app
        .get(SqliteConnection)
        .db.run(
          `update todos set status = 'archiviato' where todo_id = '${todoId}'`,
        );

      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(500);
    });

    it('risponde 500 anche quando a rifiutare è un Value Object', async () => {
      /*
       * Il caso che prima usciva 400. `Expiration.rehydrate` solleva un
       * `TodoExpirationInvalidError`, che discende da `TodoDomainError` e che il
       * filtro quindi cattura: senza la traduzione nel mapper, una colonna
       * corrotta diventava "richiesta sbagliata" invece di "guasto del server".
       */
      const todoId = await createTodo();
      app
        .get(SqliteConnection)
        .db.run(
          `update todos set expiration = 'non una data' where todo_id = '${todoId}'`,
        );

      await request(server)
        .post(`/todos/${todoId}/done`)
        .set(ACTOR_HEADER, OWNER_ID)
        .expect(500);
    });
  });
});
