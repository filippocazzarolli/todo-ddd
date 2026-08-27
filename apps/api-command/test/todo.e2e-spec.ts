import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { ACTOR_HEADER } from './../src/shared/presentation/actor.decorator';

/** Il proprietario dei todo creati dai test. */
const OWNER_ID = 'user-1';

/** Un altro utente autenticato, che non possiede niente di suo. */
const OTHER_ID = 'user-2';

/**
 * Unico test che passa da HTTP vero: verifica ciò che gli spec unitari non
 * possono vedere — rotte, status code, il `ValidationPipe` sul body e la
 * mappatura degli errori del filtro. Il resto (regole, eventi, persistenza) è
 * già coperto sotto `src`.
 *
 * L'app usa `SystemClock` e `InMemoryTodoRepository` reali: nessun mock, ma
 * l'app viene ricostruita a ogni test, quindi il repository riparte vuoto.
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
});
