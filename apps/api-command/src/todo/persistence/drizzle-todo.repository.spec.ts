import { Test, TestingModule } from '@nestjs/testing';
import { outbox, users } from '@repo/db';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { Todo } from '../domain/aggregates/todo.aggregate';
import { TodoExpirationInvalidError } from '../domain/errors/todo.errors';
import { TodoRepository } from '../domain/ports/todo.repository';
import {
  TodoConcurrencyConflictError,
  TodoOwnerNotFoundError,
} from '../domain/ports/todo.repository.errors';
import { DrizzleTodoRepository } from './drizzle-todo.repository';
import { TodoRowInvalidError } from './todo.mapper';
import {
  createTodoProps,
  describeTodoRepositoryContract,
  loadOrFail,
  NOW,
  OWNER_ID,
  TODO_ID,
} from './todo.repository.contract';

/**
 * L'adapter Drizzle contro la suite di contratto della porta, più i casi che
 * solo un adapter SQL può avere: la chiave esterna sul proprietario e una riga
 * che il dominio non sa rappresentare.
 *
 * **`seedOwner` inserisce nella tabella `users` di `@repo/db`, non passando da
 * `src/user/`**: questo modulo non importa una riga dall'altro bounded context,
 * e lo schema è il solo punto in cui i due si toccano.
 *
 * Il database è `:memory:`, nuovo a ogni test perché il modulo viene ricreato.
 */
describe('DrizzleTodoRepository', () => {
  const originalUrl = process.env.DATABASE_URL;
  let moduleRef: TestingModule;
  let repository: DrizzleTodoRepository;
  let connection: SqliteConnection;

  /** Il proprietario deve esistere: lo impone la chiave esterna. */
  async function insertOwner(userId: string): Promise<void> {
    await connection.db.insert(users).values({
      userId,
      email: `${userId}@example.com`,
      firstName: 'Mario',
      lastName: 'Rossi',
      subscription: 'free',
      deleted: false,
    });
  }

  beforeEach(async () => {
    process.env.DATABASE_URL = ':memory:';

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [{ provide: TodoRepository, useClass: DrizzleTodoRepository }],
    }).compile();
    await moduleRef.init();

    repository = moduleRef.get<DrizzleTodoRepository>(TodoRepository);
    connection = moduleRef.get(SqliteConnection);

    // Il contratto lo dà per già presente: senza, ogni suo `add` fallirebbe
    // sulla chiave esterna invece che sul caso in esame.
    await insertOwner(OWNER_ID);
  });

  afterEach(async () => {
    await moduleRef.close();

    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  describeTodoRepositoryContract(() => ({
    repository,
    seedOwner: insertOwner,
  }));

  /*
   * Fuori dal contratto perché l'adapter in memoria non può rispettarlo: non
   * vede gli utenti, quindi per lui un todo orfano resta rappresentabile. È
   * l'unica divergenza legittima fra le due implementazioni della porta.
   */
  describe('la chiave esterna sul proprietario', () => {
    it('rifiuta un proprietario inesistente con TodoOwnerNotFoundError', async () => {
      await expect(
        repository.add(Todo.create(createTodoProps({ ownerId: 'nessuno' }))),
      ).rejects.toThrow(TodoOwnerNotFoundError);
    });

    it('non inserisce il todo orfano che ha rifiutato', async () => {
      await expect(
        repository.add(Todo.create(createTodoProps({ ownerId: 'nessuno' }))),
      ).rejects.toThrow(TodoOwnerNotFoundError);

      await expect(repository.findById(TODO_ID)).resolves.toBeNull();
    });
  });

  /*
   * Fuori dal contratto come la chiave esterna, e per la stessa ragione:
   * l'adapter in memoria non ha un outbox e non può averlo. È però la garanzia
   * che rende l'ordine persisti-poi-pubblica non più best-effort, quindi va
   * verificata dove esiste.
   */
  describe('l’outbox transazionale', () => {
    /**
     * Le righe in ordine di produzione. `sequence` e non `event_id`: l'UUIDv7
     * non è monotono dentro lo stesso millisecondo, che è precisamente il caso
     * di due eventi scritti dallo stesso test — ordinare per id rendeva questi
     * assert intermittenti.
     */
    function outboxRows() {
      return connection.db.select().from(outbox).orderBy(outbox.sequence).all();
    }

    it('scrive l’evento dell’aggregato insieme alla riga', async () => {
      await repository.add(Todo.create(createTodoProps()));

      const [riga] = outboxRows();

      expect(riga).toMatchObject({
        aggregateType: 'todo',
        aggregateId: TODO_ID,
        name: 'TodoCreatedEvent',
        publishedAt: null,
      });
    });

    it('serializza l’evento in JSON, con i suoi campi', async () => {
      await repository.add(
        Todo.create(createTodoProps({ important: true, tags: ['casa'] })),
      );

      const [riga] = outboxRows();

      /*
       * `description` ed `expiration` non compaiono: `JSON.stringify` scarta le
       * chiavi a `undefined`, quindi chi consuma vedrà una chiave assente e non
       * un `null`. Per gli eventi di creazione è indifferente — assente e non
       * valorizzato sono la stessa cosa — ma la distinzione conta per
       * `TodoUpdatedEvent`, dove `null` significa "azzerato" e la chiave assente
       * "non toccato": lì `null` sopravvive alla serializzazione, quindi i tre
       * stati arrivano interi dall'altra parte.
       */
      expect(JSON.parse(riga?.payload ?? 'null')).toStrictEqual({
        todoId: TODO_ID,
        ownerId: OWNER_ID,
        title: 'Comprare il latte',
        important: true,
        tags: ['casa'],
      });
    });

    it('conserva i tre stati del delta di un update', async () => {
      await repository.add(
        Todo.create(createTodoProps({ description: 'intero' })),
      );

      const caricato = await loadOrFail(repository, TODO_ID);
      caricato.update({ now: NOW, description: null });
      await repository.update(caricato);

      const [, riga] = outboxRows();

      // `description: null` è "azzerata" e sopravvive; `title`, che nessuno ha
      // toccato, resta assente. Sono i due stati che un solo `undefined` avrebbe
      // reso indistinguibili.
      expect(JSON.parse(riga?.payload ?? 'null')).toStrictEqual({
        todoId: TODO_ID,
        ownerId: OWNER_ID,
        changes: { description: null },
      });
    });

    it('non lascia traccia quando la scrittura viene rifiutata', async () => {
      /*
       * Il punto dell'outbox transazionale: il todo orfano viene respinto dalla
       * chiave esterna *dopo* che l'insert è partito, e il rollback si porta via
       * anche l'evento. Senza la transazione, il read model riceverebbe un
       * `TodoCreatedEvent` per un todo che non esiste.
       */
      await expect(
        repository.add(Todo.create(createTodoProps({ ownerId: 'nessuno' }))),
      ).rejects.toThrow(TodoOwnerNotFoundError);

      expect(outboxRows()).toStrictEqual([]);
    });

    it('accumula gli eventi delle scritture successive', async () => {
      await repository.add(Todo.create(createTodoProps()));

      const caricato = await loadOrFail(repository, TODO_ID);
      caricato.markAsDone();
      await repository.update(caricato);

      expect(outboxRows().map((riga) => riga.name)).toStrictEqual([
        'TodoCreatedEvent',
        'TodoMarkedAsDoneEvent',
      ]);
    });

    it('un update che non emette eventi non scrive niente', async () => {
      // `Todo.update` non registra nulla se nessun campo cambia davvero: la
      // riga viene comunque riscritta, l'outbox no.
      await repository.add(Todo.create(createTodoProps()));

      const caricato = await loadOrFail(repository, TODO_ID);
      caricato.update({ now: NOW, title: 'Comprare il latte' });
      await repository.update(caricato);

      expect(outboxRows()).toHaveLength(1);
    });

    it('un update rifiutato per conflitto non scrive niente', async () => {
      await repository.add(Todo.create(createTodoProps()));

      const primo = await loadOrFail(repository, TODO_ID);
      const secondo = await loadOrFail(repository, TODO_ID);

      primo.markAsDone();
      await repository.update(primo);

      secondo.delete();
      await expect(repository.update(secondo)).rejects.toThrow(
        TodoConcurrencyConflictError,
      );

      // Il `TodoDeletedEvent` del secondo non deve esistere: la scrittura su cui
      // si basava non è mai avvenuta.
      expect(outboxRows().map((riga) => riga.name)).toStrictEqual([
        'TodoCreatedEvent',
        'TodoMarkedAsDoneEvent',
      ]);
    });
  });

  describe('una riga che il dominio non sa rappresentare', () => {
    it('non accetta uno status fuori dall’insieme', async () => {
      await repository.add(Todo.create(createTodoProps()));
      // Scritto aggirando l'adapter, che non potrebbe produrlo: è il caso di
      // una migrazione o di una scrittura fatta a mano.
      connection.db.run(
        "update todos set status = 'archiviato' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toThrow(
        TodoRowInvalidError,
      );
    });

    it('non accetta un JSON dei tag che non sia una lista di stringhe', async () => {
      // Il caso che `mode: 'json'` con `.$type<string[]>()` avrebbe fatto
      // passare per valido, mentendo sul tipo.
      await repository.add(Todo.create(createTodoProps()));
      connection.db.run(
        "update todos set tags = '[1, 2]' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toThrow(
        TodoRowInvalidError,
      );
    });

    it('non accetta un JSON malformato nei tag', async () => {
      await repository.add(Todo.create(createTodoProps()));
      connection.db.run(
        "update todos set tags = 'non json' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toThrow(
        TodoRowInvalidError,
      );
    });

    it('non accetta una scadenza che non è una data', async () => {
      /*
       * Il caso in cui a rifiutare è un Value Object e non il mapper.
       * `Expiration.rehydrate` solleva un `TodoExpirationInvalidError`, che è un
       * errore di *dominio*: lasciandolo passare, il filtro darebbe 400 e la
       * colpa a chi ha solo chiesto di leggere. Il mapper lo traduce, quindi
       * resta un 500.
       */
      await repository.add(Todo.create(createTodoProps()));
      connection.db.run(
        "update todos set expiration = 'non una data' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toThrow(
        TodoRowInvalidError,
      );
    });

    it('conserva l’errore di dominio come `cause`, per chi legge i log', async () => {
      await repository.add(Todo.create(createTodoProps()));
      connection.db.run(
        "update todos set expiration = 'non una data' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toMatchObject({
        cause: expect.any(TodoExpirationInvalidError) as unknown,
      });
    });
  });
});
