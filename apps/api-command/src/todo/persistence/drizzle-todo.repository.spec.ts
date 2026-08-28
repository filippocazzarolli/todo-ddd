import { Test, TestingModule } from '@nestjs/testing';
import { users } from '@repo/db';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { CreateTodoProps, Todo } from '../domain/aggregates/todo.aggregate';
import { TodoRepository } from '../domain/ports/todo.repository';
import {
  TodoAlreadyExistsError,
  TodoNoLongerExistsError,
  TodoOwnerNotFoundError,
} from '../domain/ports/todo.repository.errors';
import { DrizzleTodoRepository } from './drizzle-todo.repository';
import { TodoRowInvalidError } from './todo.mapper';

const TODO_ID = 'todo-1';
const OWNER_ID = 'user-1';

/** Istante fisso: arriva dalla porta `Clock`, nessun fake timer. */
const NOW = new Date(2026, 0, 15, 10, 30);

/** Scadenza futura rispetto a NOW, in componenti locali come nel dominio. */
const EXPIRATION = { date: '2026-03-01', time: '09:00' };

function createProps(overrides: Partial<CreateTodoProps> = {}) {
  return {
    todoId: TODO_ID,
    ownerId: OWNER_ID,
    title: 'Comprare il latte',
    now: NOW,
    ...overrides,
  } satisfies CreateTodoProps;
}

/** Evita il narrowing di `Todo | null` in ogni test. */
async function loadOrFail(
  repository: TodoRepository,
  todoId: string,
): Promise<Todo> {
  const todo = await repository.findById(todoId);

  if (todo === null) {
    throw new Error(`Todo ${todoId} atteso nel repository, non trovato`);
  }

  return todo;
}

/**
 * Ricalca i casi di `in-memory-todo.repository.spec.ts` e ne aggiunge due che
 * solo un adapter SQL può avere: la chiave esterna sul proprietario, e una riga
 * che il dominio non sa rappresentare.
 *
 * **Ogni test inserisce prima l'utente**, e questa è la novità rispetto
 * all'adapter in memoria, per cui `ownerId` era "un campo come gli altri".
 * L'inserimento passa dalla tabella `users` di `@repo/db` e non da
 * `src/user/`: questo modulo non importa una riga dall'altro bounded context, e
 * lo schema è il solo punto in cui i due si toccano.
 */
describe('DrizzleTodoRepository', () => {
  const originalUrl = process.env.DATABASE_URL;
  let moduleRef: TestingModule;
  let repository: DrizzleTodoRepository;
  let connection: SqliteConnection;

  /** Il proprietario deve esistere: lo impone la chiave esterna. */
  async function insertOwner(userId = OWNER_ID): Promise<void> {
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

    await insertOwner();
  });

  afterEach(async () => {
    await moduleRef.close();

    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it('e registrato come implementazione della porta', () => {
    expect(repository).toBeInstanceOf(TodoRepository);
  });

  describe('findById', () => {
    it('restituisce null per un id sconosciuto', async () => {
      await expect(repository.findById('ignoto')).resolves.toBeNull();
    });

    it('restituisce un aggregato senza eventi pendenti', async () => {
      await repository.add(Todo.create(createProps()));

      const loaded = await loadOrFail(repository, TODO_ID);

      expect(loaded.getUncommittedEvents()).toHaveLength(0);
    });

    it('restituisce una nuova istanza a ogni chiamata', async () => {
      await repository.add(Todo.create(createProps()));

      const primo = await loadOrFail(repository, TODO_ID);
      const secondo = await loadOrFail(repository, TODO_ID);

      expect(primo).not.toBe(secondo);
    });

    it('restituisce anche i todo cancellati, per far decidere l aggregato', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);
      todo.delete();
      await repository.update(todo);

      const loaded = await loadOrFail(repository, TODO_ID);

      expect(loaded.isDeleted).toBe(true);
    });
  });

  describe('add', () => {
    it('esegue il round-trip preservando tutti i campi', async () => {
      const todo = Todo.create(
        createProps({
          description: 'Intero, non scremato',
          important: true,
          tags: ['casa', 'spesa'],
          expiration: EXPIRATION,
        }),
      );
      await repository.add(todo);

      const loaded = await loadOrFail(repository, TODO_ID);

      // `toStrictEqual` e non `toEqual`: distingue una chiave assente da una a
      // `undefined`, che e' esattamente cio' che il mapper deve preservare.
      expect(loaded.snapshot()).toStrictEqual(todo.snapshot());
    });

    it('esegue il round-trip anche di un todo senza campi opzionali', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);

      const loaded = await loadOrFail(repository, TODO_ID);

      expect(loaded.snapshot()).toStrictEqual(todo.snapshot());
    });

    it('conserva la scadenza al minuto, senza secondi', async () => {
      const todo = Todo.create(createProps({ expiration: EXPIRATION }));
      await repository.add(todo);

      const loaded = await loadOrFail(repository, TODO_ID);

      expect(loaded.expiration?.date).toBe(EXPIRATION.date);
      expect(loaded.expiration?.time).toBe(EXPIRATION.time);
    });

    it('conserva una scadenza gia passata: rehydrate non rivalida', async () => {
      // `Expiration.create` rifiuta il passato, `rehydrate` no: altrimenti ogni
      // todo scaduto diventerebbe impossibile da ricaricare.
      const todo = Todo.create(
        createProps({ expiration: { date: '2026-01-16', time: '09:00' } }),
      );
      await repository.add(todo);

      const loaded = await loadOrFail(repository, TODO_ID);

      expect(loaded.expiration?.date).toBe('2026-01-16');
    });

    it('conserva la lista dei tag vuota come lista, non come assenza', async () => {
      const todo = Todo.create(createProps({ tags: [] }));
      await repository.add(todo);

      const loaded = await loadOrFail(repository, TODO_ID);

      expect(loaded.snapshot().tags).toStrictEqual([]);
    });

    it('rifiuta un id gia presente con TodoAlreadyExistsError', async () => {
      await repository.add(Todo.create(createProps()));

      await expect(
        repository.add(Todo.create(createProps({ title: 'Altro' }))),
      ).rejects.toThrow(TodoAlreadyExistsError);
    });

    it('non altera lo stato gia presente quando rifiuta', async () => {
      await repository.add(Todo.create(createProps()));

      await expect(
        repository.add(Todo.create(createProps({ title: 'Altro' }))),
      ).rejects.toThrow(TodoAlreadyExistsError);

      const loaded = await loadOrFail(repository, TODO_ID);
      expect(loaded.snapshot().title).toBe('Comprare il latte');
    });

    it('non tiene il riferimento all aggregato salvato', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);

      todo.markAsDone();

      const loaded = await loadOrFail(repository, TODO_ID);
      expect(loaded.status).toBe('todo');
    });

    it('mantiene aggregati distinti separati', async () => {
      await repository.add(Todo.create(createProps()));
      await repository.add(
        Todo.create(createProps({ todoId: 'todo-2', title: 'Altro' })),
      );

      const primo = await loadOrFail(repository, TODO_ID);
      const secondo = await loadOrFail(repository, 'todo-2');

      expect(primo.snapshot().title).toBe('Comprare il latte');
      expect(secondo.snapshot().title).toBe('Altro');
    });

    /*
     * Questi due casi non esistono nella spec dell'adapter in memoria, che non
     * vede gli utenti: e' la prima volta che il contratto dichiarato dalla porta
     * viene davvero esercitato.
     */
    it('rifiuta un proprietario inesistente con TodoOwnerNotFoundError', async () => {
      await expect(
        repository.add(Todo.create(createProps({ ownerId: 'nessuno' }))),
      ).rejects.toThrow(TodoOwnerNotFoundError);
    });

    it('non inserisce il todo orfano che ha rifiutato', async () => {
      await expect(
        repository.add(Todo.create(createProps({ ownerId: 'nessuno' }))),
      ).rejects.toThrow(TodoOwnerNotFoundError);

      await expect(repository.findById(TODO_ID)).resolves.toBeNull();
    });

    it('accetta proprietari diversi, purche esistano', async () => {
      await insertOwner('user-2');

      await repository.add(Todo.create(createProps()));
      await repository.add(
        Todo.create(createProps({ todoId: 'todo-2', ownerId: 'user-2' })),
      );

      const secondo = await loadOrFail(repository, 'todo-2');
      expect(secondo.ownerId).toBe('user-2');
    });
  });

  describe('update', () => {
    it('sovrascrive lo stato di un aggregato esistente', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);

      todo.update({ now: NOW, title: 'Comprare il pane' });
      await repository.update(todo);

      const loaded = await loadOrFail(repository, TODO_ID);
      expect(loaded.snapshot().title).toBe('Comprare il pane');
    });

    it('persiste ogni transizione del ciclo di vita', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);

      todo.markAsDone();
      await repository.update(todo);
      expect((await loadOrFail(repository, TODO_ID)).status).toBe('done');

      todo.reopen();
      await repository.update(todo);
      expect((await loadOrFail(repository, TODO_ID)).status).toBe('todo');

      todo.delete();
      await repository.update(todo);
      expect((await loadOrFail(repository, TODO_ID)).isDeleted).toBe(true);
    });

    it('azzera i campi opzionali, invece di lasciare il valore precedente', async () => {
      // Il caso che un UPDATE parziale sbaglierebbe in silenzio: senza scrivere
      // NULL esplicitamente, la descrizione rimossa resterebbe in tabella.
      const todo = Todo.create(
        createProps({ description: 'Da rimuovere', expiration: EXPIRATION }),
      );
      await repository.add(todo);

      todo.update({ now: NOW, description: null, expiration: null });
      await repository.update(todo);

      const loaded = await loadOrFail(repository, TODO_ID);
      expect(loaded.snapshot().description).toBeUndefined();
      expect(loaded.snapshot().expiration).toBeUndefined();
    });

    it('e ripetibile: due update identici non duplicano niente', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);

      todo.markAsDone();
      await repository.update(todo);
      await expect(repository.update(todo)).resolves.toBeUndefined();

      expect((await loadOrFail(repository, TODO_ID)).status).toBe('done');
    });

    it('rifiuta un id assente con TodoNoLongerExistsError', async () => {
      await expect(
        repository.update(Todo.create(createProps())),
      ).rejects.toThrow(TodoNoLongerExistsError);
    });

    it('non inserisce niente quando rifiuta', async () => {
      await expect(
        repository.update(Todo.create(createProps())),
      ).rejects.toThrow(TodoNoLongerExistsError);

      await expect(repository.findById(TODO_ID)).resolves.toBeNull();
    });

    it('aggiorna il solo aggregato indicato', async () => {
      const primo = Todo.create(createProps());
      await repository.add(primo);
      await repository.add(
        Todo.create(createProps({ todoId: 'todo-2', title: 'Altro' })),
      );

      primo.markAsDone();
      await repository.update(primo);

      expect((await loadOrFail(repository, 'todo-2')).status).toBe('todo');
    });
  });

  describe('una riga che il dominio non sa rappresentare', () => {
    it('non accetta uno status fuori dall insieme', async () => {
      await repository.add(Todo.create(createProps()));
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
      await repository.add(Todo.create(createProps()));
      connection.db.run(
        "update todos set tags = '[1, 2]' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toThrow(
        TodoRowInvalidError,
      );
    });

    it('non accetta un JSON malformato nei tag', async () => {
      await repository.add(Todo.create(createProps()));
      connection.db.run(
        "update todos set tags = 'non json' where todo_id = 'todo-1'",
      );

      await expect(repository.findById(TODO_ID)).rejects.toThrow(
        TodoRowInvalidError,
      );
    });
  });
});
