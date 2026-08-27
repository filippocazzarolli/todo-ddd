import { CreateTodoProps, Todo } from '../domain/aggregates/todo.aggregate';
import { TodoRepository } from '../domain/ports/todo.repository';
import {
  TodoAlreadyExistsError,
  TodoNoLongerExistsError,
} from '../domain/ports/todo.repository.errors';
import { InMemoryTodoRepository } from './in-memory-todo.repository';

const TODO_ID = 'todo-1';

/** L'adapter non interpreta il proprietario: per lui e` un campo come gli altri. */
const OWNER_ID = 'user-1';

/** Istante fisso: arriva dalla porta `Clock`, nessun fake timer. */
const NOW = new Date(2026, 0, 15, 10, 30);

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

describe('InMemoryTodoRepository', () => {
  let repository: InMemoryTodoRepository;

  beforeEach(() => {
    repository = new InMemoryTodoRepository();
  });

  it('è risolvibile come TodoRepository: la classe astratta è il token DI', () => {
    expect(repository).toBeInstanceOf(TodoRepository);
  });

  describe('findById', () => {
    it('restituisce null per un id sconosciuto', async () => {
      await expect(repository.findById('inesistente')).resolves.toBeNull();
    });

    it('non condivide stato tra istanze diverse', async () => {
      await repository.add(Todo.create(createProps()));

      const altro = new InMemoryTodoRepository();

      await expect(altro.findById(TODO_ID)).resolves.toBeNull();
    });

    it('restituisce un aggregato senza eventi pendenti', async () => {
      // Passa da rehydrate, non da create: altrimenti il TodoCreatedEvent
      // verrebbe ripubblicato a ogni caricamento.
      await repository.add(Todo.create(createProps()));

      const caricato = await loadOrFail(repository, TODO_ID);

      expect(caricato.getUncommittedEvents()).toStrictEqual([]);
    });

    it('restituisce una nuova istanza a ogni chiamata', async () => {
      await repository.add(Todo.create(createProps()));

      const primo = await loadOrFail(repository, TODO_ID);
      const secondo = await loadOrFail(repository, TODO_ID);

      expect(primo).not.toBe(secondo);

      primo.markAsDone();

      // Nessun aliasing: la modifica non salvata non contamina gli altri.
      expect(secondo.isDone).toBe(false);
      expect((await loadOrFail(repository, TODO_ID)).isDone).toBe(false);
    });

    it('restituisce anche i todo cancellati, per far decidere l`aggregato', async () => {
      const todo = Todo.create(createProps());
      todo.delete();
      await repository.add(todo);

      const caricato = await loadOrFail(repository, TODO_ID);

      // Se il repository li filtrasse, qui arriverebbe un "non trovato"
      // invece del TodoDeletedError dell'aggregato.
      expect(caricato.isDeleted).toBe(true);
    });
  });

  describe('add', () => {
    it('esegue il round-trip preservando tutti i campi', async () => {
      const todo = Todo.create(
        createProps({
          description: 'intero',
          important: true,
          tags: ['casa', 'spesa'],
        }),
      );

      await repository.add(todo);

      expect((await loadOrFail(repository, TODO_ID)).snapshot()).toStrictEqual(
        todo.snapshot(),
      );
    });

    it('rifiuta un id già presente con TodoAlreadyExistsError', async () => {
      await repository.add(Todo.create(createProps()));

      /*
       * Sta al posto del vincolo di chiave primaria. Senza questo controllo
       * `add` sarebbe un upsert, e la riconsegna di un comando di creazione
       * riporterebbe il todo allo stato iniziale in silenzio.
       */
      await expect(repository.add(Todo.create(createProps()))).rejects.toThrow(
        new TodoAlreadyExistsError(TODO_ID),
      );
    });

    it('non altera lo stato già presente quando rifiuta', async () => {
      await repository.add(Todo.create(createProps()));

      const caricato = await loadOrFail(repository, TODO_ID);
      caricato.markAsDone();
      await repository.update(caricato);

      await expect(repository.add(Todo.create(createProps()))).rejects.toThrow(
        TodoAlreadyExistsError,
      );

      expect((await loadOrFail(repository, TODO_ID)).isDone).toBe(true);
    });

    it('accetta lo stesso id su un`altra istanza del repository', async () => {
      await repository.add(Todo.create(createProps()));

      const altro = new InMemoryTodoRepository();

      await expect(
        altro.add(Todo.create(createProps())),
      ).resolves.toBeUndefined();
    });

    it('congela l`aggregato caricato dopo una cancellazione salvata', async () => {
      const todo = Todo.create(createProps());
      todo.delete();
      await repository.add(todo);

      const caricato = await loadOrFail(repository, TODO_ID);

      expect(() => caricato.markAsDone()).toThrow(TODO_ID);
    });

    it('non tiene il riferimento all`aggregato salvato', async () => {
      const todo = Todo.create(createProps());
      await repository.add(todo);

      // Transizione applicata ma mai salvata: il repository non deve vederla.
      todo.markAsDone();

      expect((await loadOrFail(repository, TODO_ID)).isDone).toBe(false);
    });

    it('non tiene il riferimento ai tag salvati', async () => {
      const tags = ['casa'];
      const todo = Todo.create(createProps({ tags }));
      await repository.add(todo);

      tags.push('iniettato');

      expect(
        (await loadOrFail(repository, TODO_ID)).snapshot().tags,
      ).toStrictEqual(['casa']);
    });

    it('mantiene aggregati distinti separati', async () => {
      await repository.add(Todo.create(createProps()));
      await repository.add(
        Todo.create(
          createProps({ todoId: 'todo-2', title: 'Pagare bolletta' }),
        ),
      );

      const primo = await loadOrFail(repository, TODO_ID);
      const secondo = await loadOrFail(repository, 'todo-2');

      expect(primo.snapshot().title).toBe('Comprare il latte');
      expect(secondo.snapshot().title).toBe('Pagare bolletta');
    });
  });

  describe('update', () => {
    it('sovrascrive lo stato di un aggregato esistente', async () => {
      await repository.add(Todo.create(createProps()));

      const caricato = await loadOrFail(repository, TODO_ID);
      caricato.markAsDone();
      await repository.update(caricato);

      expect((await loadOrFail(repository, TODO_ID)).isDone).toBe(true);
    });

    it('persiste ogni transizione del ciclo di vita', async () => {
      await repository.add(Todo.create(createProps()));

      const daCompletare = await loadOrFail(repository, TODO_ID);
      daCompletare.markAsDone();
      await repository.update(daCompletare);

      const daRiaprire = await loadOrFail(repository, TODO_ID);
      daRiaprire.reopen();
      await repository.update(daRiaprire);

      const finale = await loadOrFail(repository, TODO_ID);

      expect(finale.status).toBe('todo');
      expect(finale.isDeleted).toBe(false);
    });

    it('è ripetibile: due update identici non duplicano niente', async () => {
      await repository.add(Todo.create(createProps()));

      const caricato = await loadOrFail(repository, TODO_ID);
      await repository.update(caricato);
      await repository.update(caricato);

      expect((await loadOrFail(repository, TODO_ID)).snapshot()).toStrictEqual(
        caricato.snapshot(),
      );
    });

    it('rifiuta un id assente con TodoNoLongerExistsError', async () => {
      /*
       * Sta al posto del conteggio delle righe toccate. Con un upsert questa
       * scrittura reinserirebbe l'aggregato, resuscitando una riga che qualcun
       * altro ha rimosso mentre la stavamo modificando.
       */
      await expect(
        repository.update(Todo.create(createProps())),
      ).rejects.toThrow(new TodoNoLongerExistsError(TODO_ID));
    });

    it('non inserisce niente quando rifiuta', async () => {
      await expect(
        repository.update(Todo.create(createProps())),
      ).rejects.toThrow(TodoNoLongerExistsError);

      await expect(repository.findById(TODO_ID)).resolves.toBeNull();
    });

    it('aggiorna il solo aggregato indicato', async () => {
      await repository.add(Todo.create(createProps()));
      await repository.add(
        Todo.create(
          createProps({ todoId: 'todo-2', title: 'Pagare bolletta' }),
        ),
      );

      const primo = await loadOrFail(repository, TODO_ID);
      primo.markAsDone();
      await repository.update(primo);

      expect((await loadOrFail(repository, 'todo-2')).isDone).toBe(false);
    });
  });
});
