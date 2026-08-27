import {
  TodoAlreadyDoneError,
  TodoDeletedError,
  TodoDomainError,
  TodoExpirationInPastError,
  TodoExpirationInvalidError,
  TodoNotDoneError,
  TodoTitleRequiredError,
} from '../errors/todo.errors';
import { TodoCreatedEvent } from '../events/todo-created.event';
import { TodoDeletedEvent } from '../events/todo-deleted.event';
import { TodoMarkedAsDoneEvent } from '../events/todo-marked-as-done.event';
import { TodoReopenedEvent } from '../events/todo-reopened.event';
import { TodoUpdatedEvent } from '../events/todo-updated.event';
import { Expiration } from '../value-objects/expiration.value-object';
import { CreateTodoProps, Todo, TodoProps } from './todo.aggregate';

/**
 * Il todoId arriva dall'esterno (`TodoIdGenerator`), quindi qui è un valore
 * fisso: nessun mock, nessun fake timer, nessuna sorgente non deterministica.
 */
const TODO_ID = 'todo-1';

/**
 * Anche `now` arriva dall'esterno (porta `Clock`), quindi è un valore fisso.
 * Costruito da componenti locali, non da stringa ISO: `Expiration` interpreta
 * data e ora nel fuso del processo, e confrontare i due nello stesso fuso
 * rende i test indipendenti dal `TZ` della macchina.
 */
const NOW = new Date(2026, 0, 15, 10, 30, 45);

/** Un'ora dopo `NOW`. */
const FUTURE = { date: '2026-01-15', time: '11:30' };

function createProps(overrides: Partial<CreateTodoProps> = {}) {
  return {
    todoId: TODO_ID,
    title: 'Comprare il latte',
    now: NOW,
    ...overrides,
  } satisfies CreateTodoProps;
}

function doneState(overrides: Partial<TodoProps> = {}) {
  return {
    todoId: TODO_ID,
    title: 'Comprare il latte',
    status: 'done',
    deleted: false,
    ...overrides,
  } satisfies TodoProps;
}

describe('Todo', () => {
  describe('create', () => {
    it('nasce nello stato `todo` con i default applicati', () => {
      const todo = Todo.create(createProps());

      expect(todo.snapshot()).toStrictEqual({
        todoId: TODO_ID,
        title: 'Comprare il latte',
        status: 'todo',
        deleted: false,
        description: undefined,
        important: false,
        expiration: undefined,
        tags: [],
      });
      expect(todo.todoId).toBe(TODO_ID);
      expect(todo.status).toBe('todo');
      expect(todo.isDone).toBe(false);
      expect(todo.isDeleted).toBe(false);
    });

    it('registra un solo TodoCreatedEvent con i valori normalizzati', () => {
      const todo = Todo.create(
        createProps({
          title: '  Comprare il latte  ',
          description: '  intero  ',
          important: true,
          tags: [' casa ', 'casa', ''],
        }),
      );

      // toStrictEqual verifica anche la classe dell'evento, non solo i campi.
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoCreatedEvent(
          TODO_ID,
          'Comprare il latte',
          true,
          ['casa'],
          'intero',
        ),
      ]);
    });

    it('trimma il titolo', () => {
      const todo = Todo.create(
        createProps({ title: '  Comprare il latte \n' }),
      );

      expect(todo.snapshot().title).toBe('Comprare il latte');
    });

    it.each(['', '   ', '\n\t'])(
      'rifiuta il titolo vuoto (%j) con TodoTitleRequiredError',
      (title) => {
        expect(() => Todo.create(createProps({ title }))).toThrow(
          TodoTitleRequiredError,
        );
      },
    );

    it('espone le violazioni di invariante come TodoDomainError', () => {
      // Il layer applicativo deve poter mappare la gerarchia, non le foglie.
      expect(() => Todo.create(createProps({ title: '' }))).toThrow(
        TodoDomainError,
      );
    });

    it('trimma la description e collassa quella vuota su undefined', () => {
      expect(
        Todo.create(createProps({ description: ' x ' })).snapshot(),
      ).toMatchObject({
        description: 'x',
      });
      expect(
        Todo.create(createProps({ description: '   ' })).snapshot().description,
      ).toBeUndefined();
    });

    it('normalizza i tag: trim, scarto dei vuoti, dedup, ordine preservato', () => {
      const todo = Todo.create(
        createProps({ tags: ['casa', ' spesa ', '', 'casa', '  ', 'spesa'] }),
      );

      expect(todo.snapshot().tags).toStrictEqual(['casa', 'spesa']);
    });

    it('copia i tag in ingresso: mutare l`array del chiamante non altera l`aggregato', () => {
      const tags = ['casa'];
      const todo = Todo.create(createProps({ tags }));

      tags.push('iniettato');

      expect(todo.snapshot().tags).toStrictEqual(['casa']);
    });
  });

  describe('create con scadenza', () => {
    it('non ha scadenza se non gliene viene data una', () => {
      const todo = Todo.create(createProps());

      expect(todo.expiration).toBeUndefined();
      expect(todo.snapshot().expiration).toBeUndefined();
    });

    it('compone data e ora in un unico Value Object', () => {
      const todo = Todo.create(createProps({ expiration: FUTURE }));

      expect(todo.expiration?.date).toBe('2026-01-15');
      expect(todo.expiration?.time).toBe('11:30');
      expect(todo.expiration?.toDate()).toStrictEqual(
        new Date(2026, 0, 15, 11, 30),
      );
    });

    it('porta la scadenza nell`evento come istante ISO', () => {
      const todo = Todo.create(createProps({ expiration: FUTURE }));

      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoCreatedEvent(
          TODO_ID,
          'Comprare il latte',
          false,
          [],
          undefined,
          new Date(2026, 0, 15, 11, 30).toISOString(),
        ),
      ]);
    });

    it('rifiuta una scadenza nel passato senza registrare eventi', () => {
      const props = createProps({
        expiration: { date: '2026-01-15', time: '09:00' },
      });

      expect(() => Todo.create(props)).toThrow(TodoExpirationInPastError);
      expect(() => Todo.create(props)).toThrow(TodoDomainError);
    });

    it('ammette il minuto in corso: `now` è troncato al minuto', () => {
      // NOW è 10:30:45 — le 10:30 sono ancora un istante non passato.
      const todo = Todo.create(
        createProps({ expiration: { date: '2026-01-15', time: '10:30' } }),
      );

      expect(todo.expiration?.time).toBe('10:30');
    });

    it.each([
      ['2026-01-15', '10:29'],
      ['2026-01-14', '23:59'],
      ['2025-12-31', '23:59'],
    ])('rifiuta %s %s, precedente a NOW', (date, time) => {
      expect(() =>
        Todo.create(createProps({ expiration: { date, time } })),
      ).toThrow(TodoExpirationInPastError);
    });

    it.each([
      ['2026-13-01', '10:00'],
      ['2026-02-30', '10:00'],
      ['2026-1-5', '10:00'],
      ['15/01/2026', '10:00'],
      ['', '10:00'],
      ['2026-06-01', '25:00'],
      ['2026-06-01', '10:70'],
      ['2026-06-01', '10'],
      ['2026-06-01', '10:00:00'],
      ['2026-06-01', ''],
    ])(
      'rifiuta la data/ora non valida (%j %j) con TodoExpirationInvalidError',
      (date, time) => {
        expect(() =>
          Todo.create(createProps({ expiration: { date, time } })),
        ).toThrow(TodoExpirationInvalidError);
      },
    );

    it('trimma le parti prima di comporle', () => {
      const todo = Todo.create(
        createProps({ expiration: { date: ' 2026-01-15 ', time: ' 11:30 ' } }),
      );

      expect(todo.expiration?.toString()).toBe('2026-01-15 11:30');
    });

    it('non conserva secondi e millisecondi: la precisione è il minuto', () => {
      const todo = Todo.create(createProps({ expiration: FUTURE }));
      const instant = todo.expiration?.toDate();

      expect(instant?.getSeconds()).toBe(0);
      expect(instant?.getMilliseconds()).toBe(0);
    });
  });

  describe('rehydrate', () => {
    it('non registra eventi: quei fatti sono già accaduti', () => {
      const todo = Todo.rehydrate(doneState());

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('preserva lo stato persistito, incluso `done`', () => {
      const todo = Todo.rehydrate(
        doneState({ description: 'intero', important: true, tags: ['casa'] }),
      );

      expect(todo.snapshot()).toStrictEqual({
        todoId: TODO_ID,
        title: 'Comprare il latte',
        status: 'done',
        deleted: false,
        description: 'intero',
        important: true,
        expiration: undefined,
        tags: ['casa'],
      });
      expect(todo.isDone).toBe(true);
    });

    it('preserva la cancellazione: un aggregato cancellato resta congelato', () => {
      const todo = Todo.rehydrate(doneState({ deleted: true }));

      expect(todo.isDeleted).toBe(true);
      expect(() => todo.reopen()).toThrow(TodoDeletedError);
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('normalizza i tag persistiti e non tiene il riferimento allo stato', () => {
      const state = doneState({ tags: [' casa ', 'casa'] });
      const todo = Todo.rehydrate(state);

      state.title = 'mutato';

      expect(todo.snapshot()).toMatchObject({
        title: 'Comprare il latte',
        tags: ['casa'],
      });
    });
  });

  describe('rehydrate con scadenza', () => {
    it('accetta una scadenza già scaduta: il tempo passa, il dato resta', () => {
      const expiration = Expiration.rehydrate(
        new Date(2020, 0, 1, 8, 0).toISOString(),
      );
      const todo = Todo.rehydrate(doneState({ expiration }));

      expect(todo.expiration?.toString()).toBe('2020-01-01 08:00');
      expect(todo.expiration?.isPast(NOW)).toBe(true);
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('restituisce la scadenza nello snapshot: il VO è immutabile', () => {
      const expiration = Expiration.create(FUTURE, NOW);
      const todo = Todo.rehydrate(doneState({ expiration }));

      expect(todo.snapshot().expiration).toBe(expiration);
    });

    it('espone la chiave `expiration` anche quando lo stato non la porta', () => {
      // Chiave assente e chiave a undefined non sono la stessa cosa per un
      // toStrictEqual a valle: la forma dello snapshot non deve dipenderne.
      const snapshot = Todo.rehydrate(doneState()).snapshot();

      expect('expiration' in snapshot).toBe(true);
      expect(snapshot.expiration).toBeUndefined();
    });
  });

  describe('update', () => {
    /** Stato di partenza: un todo aperto e completo dei suoi default. */
    function openState(overrides: Partial<TodoProps> = {}) {
      return {
        todoId: TODO_ID,
        title: 'Comprare il latte',
        status: 'todo',
        deleted: false,
        important: false,
        tags: [],
        ...overrides,
      } satisfies TodoProps;
    }

    /**
     * Reidratato e non creato: `create` registrerebbe il suo evento, e ogni
     * assert sugli eventi dovrebbe portarselo dietro.
     */
    function openTodo(overrides: Partial<TodoProps> = {}): Todo {
      return Todo.rehydrate(openState(overrides));
    }

    it('applica piu` campi in una sola chiamata, con un solo evento', () => {
      const todo = openTodo();

      todo.update({
        now: NOW,
        title: 'Comprare il pane',
        description: 'integrale',
        important: true,
        tags: ['casa'],
      });

      expect(todo.snapshot()).toStrictEqual({
        todoId: TODO_ID,
        title: 'Comprare il pane',
        status: 'todo',
        deleted: false,
        description: 'integrale',
        important: true,
        expiration: undefined,
        tags: ['casa'],
      });
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, {
          title: 'Comprare il pane',
          description: 'integrale',
          important: true,
          tags: ['casa'],
        }),
      ]);
    });

    it('l`evento porta il solo delta, non i campi rimasti fermi', () => {
      const todo = openTodo({ description: 'intero', important: true });

      todo.update({ now: NOW, title: 'Comprare il pane', important: true });

      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, { title: 'Comprare il pane' }),
      ]);
    });

    it('non tocca i campi assenti dall`update', () => {
      const todo = openTodo({
        description: 'intero',
        important: true,
        tags: ['casa'],
      });

      todo.update({ now: NOW, title: 'Comprare il pane' });

      expect(todo.snapshot()).toMatchObject({
        description: 'intero',
        important: true,
        tags: ['casa'],
      });
    });

    it('e` un no-op se i valori sono identici a quelli attuali', () => {
      const todo = openTodo({ description: 'intero', tags: ['casa'] });

      todo.update({
        now: NOW,
        title: 'Comprare il latte',
        description: 'intero',
        important: false,
        tags: ['casa'],
      });

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('e` un no-op se non viene passato nessun campo', () => {
      const todo = openTodo();

      todo.update({ now: NOW });

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('normalizza il titolo prima di confrontarlo: gli spazi non sono un cambio', () => {
      const todo = openTodo();

      todo.update({ now: NOW, title: '  Comprare il latte  ' });

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('rifiuta un titolo vuoto con TodoTitleRequiredError', () => {
      const todo = openTodo();

      expect(() => todo.update({ now: NOW, title: '   ' })).toThrow(
        TodoTitleRequiredError,
      );
      expect(todo.snapshot().title).toBe('Comprare il latte');
    });

    it.each([
      ['null', null],
      ['stringa vuota', ''],
      ['soli spazi', '   '],
    ])('azzera la descrizione con %s', (_label, description) => {
      const todo = openTodo({ description: 'intero' });

      todo.update({ now: NOW, description });

      expect(todo.snapshot().description).toBeUndefined();
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, { description: null }),
      ]);
    });

    it('non emette niente se azzera una descrizione gia` assente', () => {
      const todo = openTodo();

      todo.update({ now: NOW, description: null });

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('sostituisce l`insieme dei tag e lo normalizza', () => {
      const todo = openTodo({ tags: ['casa', 'spesa'] });

      todo.update({ now: NOW, tags: [' ufficio ', 'ufficio', ''] });

      expect(todo.snapshot().tags).toStrictEqual(['ufficio']);
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, { tags: ['ufficio'] }),
      ]);
    });

    it('svuota i tag con una lista vuota', () => {
      const todo = openTodo({ tags: ['casa'] });

      todo.update({ now: NOW, tags: [] });

      expect(todo.snapshot().tags).toStrictEqual([]);
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, { tags: [] }),
      ]);
    });

    it('confronta i tag per contenuto: lo stesso insieme non e` un cambio', () => {
      const todo = openTodo({ tags: ['casa', 'spesa'] });

      todo.update({ now: NOW, tags: ['casa', ' spesa '] });

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('imposta la scadenza, e nell`evento e` una stringa ISO', () => {
      const todo = openTodo();

      todo.update({ now: NOW, expiration: FUTURE });

      expect(todo.expiration?.toString()).toBe('2026-01-15 11:30');
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, {
          expiration: new Date(2026, 0, 15, 11, 30).toISOString(),
        }),
      ]);
    });

    it('rimuove la scadenza con null', () => {
      const todo = openTodo({ expiration: Expiration.create(FUTURE, NOW) });

      todo.update({ now: NOW, expiration: null });

      expect(todo.expiration).toBeUndefined();
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoUpdatedEvent(TODO_ID, { expiration: null }),
      ]);
    });

    it('confronta la scadenza per valore: la stessa non e` un cambio', () => {
      const todo = openTodo({ expiration: Expiration.create(FUTURE, NOW) });

      todo.update({ now: NOW, expiration: FUTURE });

      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('rifiuta una scadenza nel passato con TodoExpirationInPastError', () => {
      const todo = openTodo();

      expect(() =>
        todo.update({
          now: NOW,
          expiration: { date: '2026-01-15', time: '09:00' },
        }),
      ).toThrow(TodoExpirationInPastError);
    });

    it('non applica niente se un campo qualsiasi e` invalido', () => {
      const todo = openTodo();

      /*
       * Il titolo e` valido e viene prima nella firma, la scadenza no: se
       * l'aggregato mutasse strada facendo, resterebbe in memoria con il
       * titolo nuovo e la scadenza vecchia — uno stato che nessun comando ha
       * chiesto e che il repository non salverebbe mai.
       */
      expect(() =>
        todo.update({
          now: NOW,
          title: 'Comprare il pane',
          expiration: { date: '2026-01-15', time: '09:00' },
        }),
      ).toThrow(TodoExpirationInPastError);

      expect(todo.snapshot().title).toBe('Comprare il latte');
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('modifica un todo completato: `done` non e` terminale', () => {
      const todo = Todo.rehydrate(openState({ status: 'done' }));

      todo.update({ now: NOW, title: 'Comprare il pane' });

      expect(todo.snapshot().title).toBe('Comprare il pane');
      expect(todo.status).toBe('done');
    });

    it('rifiuta un aggregato cancellato con TodoDeletedError', () => {
      const todo = openTodo({ deleted: true });

      expect(() =>
        todo.update({ now: NOW, title: 'Comprare il pane' }),
      ).toThrow(new TodoDeletedError(TODO_ID));
      expect(todo.snapshot().title).toBe('Comprare il latte');
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });
  });

  describe('markAsDone', () => {
    it('esegue la transizione `todo` -> `done`', () => {
      const todo = Todo.create(createProps());

      todo.markAsDone();

      expect(todo.status).toBe('done');
      expect(todo.isDone).toBe(true);
      expect(todo.snapshot().status).toBe('done');
    });

    it('registra TodoMarkedAsDoneEvent dopo TodoCreatedEvent, in ordine', () => {
      const todo = Todo.create(createProps());

      todo.markAsDone();

      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoCreatedEvent(
          TODO_ID,
          'Comprare il latte',
          false,
          [],
          undefined,
        ),
        new TodoMarkedAsDoneEvent(TODO_ID),
      ]);
    });

    it('registra il solo evento di completamento su un aggregato reidratato', () => {
      const todo = Todo.rehydrate({ ...doneState(), status: 'todo' });

      todo.markAsDone();

      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoMarkedAsDoneEvent(TODO_ID),
      ]);
    });

    it('non è idempotente: la seconda chiamata lancia TodoAlreadyDoneError', () => {
      const todo = Todo.create(createProps());

      todo.markAsDone();

      expect(() => todo.markAsDone()).toThrow(TodoAlreadyDoneError);
    });

    it('rifiuta un aggregato già `done` senza registrare eventi', () => {
      const todo = Todo.rehydrate(doneState());

      expect(() => todo.markAsDone()).toThrow(
        new TodoAlreadyDoneError(TODO_ID),
      );
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('rifiuta un aggregato cancellato con TodoDeletedError', () => {
      const todo = Todo.rehydrate(doneState({ status: 'todo', deleted: true }));

      // L'esistenza è precondizione dello stato: prima ensureNotDeleted.
      expect(() => todo.markAsDone()).toThrow(TodoDeletedError);
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('porta il todoId nell`errore, per la mappatura a valle', () => {
      const todo = Todo.rehydrate(doneState());

      expect(() => todo.markAsDone()).toThrow(TODO_ID);
    });
  });

  describe('reopen', () => {
    it('esegue la transizione `done` -> `todo`', () => {
      const todo = Todo.rehydrate(doneState());

      todo.reopen();

      expect(todo.status).toBe('todo');
      expect(todo.isDone).toBe(false);
      expect(todo.snapshot().status).toBe('todo');
    });

    it('registra TodoReopenedEvent', () => {
      const todo = Todo.rehydrate(doneState());

      todo.reopen();

      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoReopenedEvent(TODO_ID),
      ]);
    });

    it('è ripetibile: il ciclo di vita non è a senso unico', () => {
      const todo = Todo.create(createProps());

      todo.markAsDone();
      todo.reopen();
      todo.markAsDone();

      expect(todo.isDone).toBe(true);
      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoCreatedEvent(
          TODO_ID,
          'Comprare il latte',
          false,
          [],
          undefined,
        ),
        new TodoMarkedAsDoneEvent(TODO_ID),
        new TodoReopenedEvent(TODO_ID),
        new TodoMarkedAsDoneEvent(TODO_ID),
      ]);
    });

    it('rifiuta un todo non completato con TodoNotDoneError, senza eventi', () => {
      const todo = Todo.rehydrate(doneState({ status: 'todo' }));

      expect(() => todo.reopen()).toThrow(new TodoNotDoneError(TODO_ID));
      expect(todo.getUncommittedEvents()).toStrictEqual([]);
    });

    it('rifiuta un aggregato cancellato, anche se completato', () => {
      const todo = Todo.rehydrate(doneState({ deleted: true }));

      expect(() => todo.reopen()).toThrow(TodoDeletedError);
      expect(todo.snapshot().status).toBe('done');
    });
  });

  describe('delete', () => {
    it('marca l`aggregato come cancellato', () => {
      const todo = Todo.create(createProps());

      todo.delete();

      expect(todo.isDeleted).toBe(true);
      expect(todo.snapshot().deleted).toBe(true);
    });

    it('registra TodoDeletedEvent', () => {
      const todo = Todo.rehydrate(doneState({ status: 'todo' }));

      todo.delete();

      expect(todo.getUncommittedEvents()).toStrictEqual([
        new TodoDeletedEvent(TODO_ID),
      ]);
    });

    it('è ortogonale al ciclo di vita: cancella anche un todo completato', () => {
      const todo = Todo.rehydrate(doneState());

      todo.delete();

      // Lo `status` resta un'informazione valida dopo la cancellazione.
      expect(todo.snapshot()).toMatchObject({ status: 'done', deleted: true });
      expect(todo.isDone).toBe(true);
    });

    it('non è idempotente: la seconda chiamata lancia TodoDeletedError', () => {
      const todo = Todo.create(createProps());

      todo.delete();

      expect(() => todo.delete()).toThrow(new TodoDeletedError(TODO_ID));
    });

    it('congela l`aggregato: nessuna transizione dopo la cancellazione', () => {
      const todo = Todo.create(createProps());

      todo.delete();
      const eventsAfterDelete = [...todo.getUncommittedEvents()];

      expect(() => todo.markAsDone()).toThrow(TodoDeletedError);
      expect(() => todo.reopen()).toThrow(TodoDeletedError);
      expect(() => todo.delete()).toThrow(TodoDeletedError);
      expect(todo.getUncommittedEvents()).toStrictEqual(eventsAfterDelete);
      expect(todo.snapshot().status).toBe('todo');
    });
  });

  describe('snapshot', () => {
    it('non espone lo stato interno: mutare lo snapshot è innocuo', () => {
      const todo = Todo.create(createProps({ tags: ['casa'] }));
      const snapshot = todo.snapshot() as TodoProps;

      snapshot.title = 'mutato';
      snapshot.status = 'done';
      snapshot.deleted = true;
      snapshot.tags?.push('iniettato');

      expect(todo.snapshot()).toMatchObject({
        title: 'Comprare il latte',
        status: 'todo',
        deleted: false,
        tags: ['casa'],
      });
      expect(todo.isDone).toBe(false);
      expect(todo.isDeleted).toBe(false);
    });
  });
});
