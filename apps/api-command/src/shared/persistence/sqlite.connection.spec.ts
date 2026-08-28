import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { todos, users } from '@repo/db';

import { DatabaseModule } from './database.module';
import { SqliteConnection } from './sqlite.connection';

/**
 * Il database e' `:memory:`, quindi privato per connessione e nuovo a ogni test.
 * Nota che con `:memory:` il journal mode resta `memory`: il `PRAGMA
 * journal_mode = WAL` non fallisce, semplicemente non ha effetto. Questi test
 * **non** esercitano il WAL di produzione, e nessuno ci costruisca sopra un test
 * di concorrenza.
 */
describe('SqliteConnection', () => {
  const originalUrl = process.env.DATABASE_URL;
  let moduleRef: TestingModule;
  let connection: SqliteConnection;

  beforeEach(async () => {
    // Va impostata prima che Nest istanzi la classe: il path viene letto nel
    // costruttore.
    process.env.DATABASE_URL = ':memory:';

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    // init() fa scattare onModuleInit, quindi le migrazioni.
    await moduleRef.init();

    connection = moduleRef.get(SqliteConnection);
  });

  afterEach(async () => {
    await moduleRef.close();

    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  describe('le migrazioni', () => {
    it('girano all avvio, senza un passo esplicito', async () => {
      await expect(connection.db.select().from(users)).resolves.toEqual([]);
      await expect(connection.db.select().from(todos)).resolves.toEqual([]);
    });

    it('sono idempotenti: un secondo avvio non fallisce', () => {
      expect(() => {
        connection.onModuleInit();
      }).not.toThrow();
    });
  });

  describe('i pragma', () => {
    it('accende le chiavi esterne, che SQLite tiene spente per default', () => {
      // Senza questo la FK su `todos.owner_id` sarebbe decorativa, e
      // `TodoOwnerNotFoundError` resterebbe dichiarato e mai sollevato.
      expect(connection.pragma('foreign_keys')).toBe(1);
    });

    it('aspetta invece di prendere SQLITE_BUSY', () => {
      expect(connection.pragma('busy_timeout')).toBeGreaterThan(0);
    });

    it('e la connessione e scrivibile', () => {
      expect(connection.pragma('query_only')).toBe(0);
    });
  });

  describe('la chiusura', () => {
    it('rilascia la connessione allo shutdown', async () => {
      await moduleRef.close();

      // Una connessione chiusa rifiuta le query: e' il modo di verificare che
      // `onApplicationShutdown` sia stato eseguito davvero.
      await expect(connection.db.select().from(users)).rejects.toThrow();
    });
  });

  describe("l'istanza", () => {
    it('e la stessa per ogni modulo che la inietta', async () => {
      // Il fallimento che questo test previene e' silenzioso: due istanze
      // significano due database `:memory:` distinti, quindi utenti e todo in
      // posti diversi e la chiave esterna violata da ogni scrittura. Aggiungere
      // `SqliteConnection` ai providers di uno dei due moduli qui sotto — che e'
      // esattamente l'errore da cui difendersi — fa diventare rosso questo test.
      @Injectable()
      class ConsumatoreTodo {
        constructor(readonly connection: SqliteConnection) {}
      }

      @Injectable()
      class ConsumatoreUser {
        constructor(readonly connection: SqliteConnection) {}
      }

      @Module({ imports: [DatabaseModule], providers: [ConsumatoreTodo] })
      class TodoLikeModule {}

      @Module({ imports: [DatabaseModule], providers: [ConsumatoreUser] })
      class UserLikeModule {}

      const ref = await Test.createTestingModule({
        imports: [TodoLikeModule, UserLikeModule],
      }).compile();
      await ref.init();

      try {
        const dalTodo = ref.get(ConsumatoreTodo, { strict: false });
        const dallUser = ref.get(ConsumatoreUser, { strict: false });

        expect(dalTodo.connection).toBe(dallUser.connection);
      } finally {
        await ref.close();
      }
    });
  });
});
