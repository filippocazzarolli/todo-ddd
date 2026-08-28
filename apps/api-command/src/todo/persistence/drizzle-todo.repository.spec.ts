import { Test, TestingModule } from '@nestjs/testing';
import { users } from '@repo/db';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { Todo } from '../domain/aggregates/todo.aggregate';
import { TodoExpirationInvalidError } from '../domain/errors/todo.errors';
import { TodoRepository } from '../domain/ports/todo.repository';
import { TodoOwnerNotFoundError } from '../domain/ports/todo.repository.errors';
import { DrizzleTodoRepository } from './drizzle-todo.repository';
import { TodoRowInvalidError } from './todo.mapper';
import {
  createTodoProps,
  describeTodoRepositoryContract,
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
