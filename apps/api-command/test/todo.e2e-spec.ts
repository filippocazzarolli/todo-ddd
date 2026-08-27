import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';

/**
 * Unico test che passa da HTTP vero: verifica ciò che gli spec unitari non
 * possono vedere — rotte, status code, il `ValidationPipe` sul body e la
 * mappatura degli errori del filtro. Il resto (regole, eventi, persistenza) è
 * già coperto sotto `src`.
 *
 * L'app usa `SystemClock` e `InMemoryTodoRepository` reali: nessun mock, ma
 * l'app viene ricostruita a ogni test, quindi il repository riparte vuoto.
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
  ): Promise<string> {
    const response = await request(server)
      .post('/todos')
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
      await request(server).post('/todos').send({ title: 123 }).expect(400);
    });

    it('rifiuta un campo sconosciuto invece di ignorarlo', async () => {
      // forbidNonWhitelisted: un `titolo` scritto male non deve creare un todo
      // senza titolo, deve dare errore.
      await request(server)
        .post('/todos')
        .send({ title: 'Comprare il latte', titolo: 'Comprare il pane' })
        .expect(400);
    });

    it('rifiuta un titolo vuoto: la regola è del dominio, lo status è 400', async () => {
      const response = await request(server)
        .post('/todos')
        .send({ title: '   ' })
        .expect(400);

      expect(response.body).toMatchObject({ error: 'TodoTitleRequiredError' });
    });

    it('rifiuta una scadenza nel passato con 400', async () => {
      const response = await request(server)
        .post('/todos')
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
        .send({ title: 'Comprare il pane', description: null })
        .expect(204);

      expect(response.body).toStrictEqual({});
    });

    it('accetta un body vuoto: l`update a vuoto non è un errore', async () => {
      const todoId = await createTodo();

      await request(server).patch(`/todos/${todoId}`).send({}).expect(204);
    });

    it('rifiuta null su un campo non azzerabile', async () => {
      const todoId = await createTodo();

      await request(server)
        .patch(`/todos/${todoId}`)
        .send({ title: null })
        .expect(400);
    });

    it('risponde 404 su un id inesistente', async () => {
      const response = await request(server)
        .patch('/todos/inesistente')
        .send({ title: 'Comprare il pane' })
        .expect(404);

      expect(response.body).toMatchObject({ error: 'TodoNotFoundError' });
    });
  });

  describe('POST /todos/:todoId/done e /reopen', () => {
    it('completa, riapre, ricompleta', async () => {
      const todoId = await createTodo();

      await request(server).post(`/todos/${todoId}/done`).expect(204);
      await request(server).post(`/todos/${todoId}/reopen`).expect(204);
      await request(server).post(`/todos/${todoId}/done`).expect(204);
    });

    it('risponde 409 se il todo è già completato', async () => {
      const todoId = await createTodo();
      await request(server).post(`/todos/${todoId}/done`).expect(204);

      const response = await request(server)
        .post(`/todos/${todoId}/done`)
        .expect(409);

      expect(response.body).toMatchObject({ error: 'TodoAlreadyDoneError' });
    });

    it('risponde 409 se riapre un todo che non è completato', async () => {
      const todoId = await createTodo();

      const response = await request(server)
        .post(`/todos/${todoId}/reopen`)
        .expect(409);

      expect(response.body).toMatchObject({ error: 'TodoNotDoneError' });
    });

    it('risponde 404 su un id inesistente', async () => {
      await request(server).post('/todos/inesistente/done').expect(404);
    });
  });

  describe('DELETE /todos/:todoId', () => {
    it('cancella e risponde 204', async () => {
      const todoId = await createTodo();

      await request(server).delete(`/todos/${todoId}`).expect(204);
    });

    it('congela il todo: ogni comando successivo è 409', async () => {
      const todoId = await createTodo();
      await request(server).delete(`/todos/${todoId}`).expect(204);

      const response = await request(server)
        .patch(`/todos/${todoId}`)
        .send({ title: 'Comprare il pane' })
        .expect(409);

      expect(response.body).toMatchObject({ error: 'TodoDeletedError' });

      await request(server).post(`/todos/${todoId}/done`).expect(409);
      await request(server).delete(`/todos/${todoId}`).expect(409);
    });
  });

  it('risponde 404 su una rotta che non esiste', async () => {
    await request(server).get('/todos').expect(404);
  });
});
