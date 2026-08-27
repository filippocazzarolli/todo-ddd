import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { Todo } from '../../domain/aggregates/todo.aggregate';
import {
  TodoDeletedError,
  TodoExpirationInPastError,
  TodoTitleRequiredError,
} from '../../domain/errors/todo.errors';
import { TodoUpdatedEvent } from '../../domain/events/todo-updated.event';
import { Clock } from '../../domain/ports/clock';
import { TodoRepository } from '../../domain/ports/todo.repository';
import { InMemoryTodoRepository } from '../../persistence/in-memory-todo.repository';
import { TodoNotFoundError } from '../errors/todo-not-found.error';
import { UpdateTodoCommand } from './update-todo.command';
import { UpdateTodoHandler } from './update-todo.handler';

const TODO_ID = 'todo-1';

/** Componenti locali, non stringa ISO: vedi lo spec dell'aggregato. */
const NOW = new Date(2026, 0, 15, 10, 30);

/** Un'ora dopo `NOW`. */
const FUTURE = { date: '2026-01-15', time: '11:30' };

describe('UpdateTodoHandler', () => {
  let moduleRef: TestingModule;
  let handler: UpdateTodoHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryTodoRepository;
  const clock = { now: jest.fn(() => NOW) };

  async function seed(mutate?: (todo: Todo) => void): Promise<void> {
    const todo = Todo.create({
      todoId: TODO_ID,
      title: 'Comprare il latte',
      description: 'intero',
      tags: ['casa'],
      now: NOW,
    });

    mutate?.(todo);

    await repository.add(todo);
  }

  async function loadOrFail(todoId: string): Promise<Todo> {
    const todo = await repository.findById(todoId);

    if (todo === null) {
      throw new Error(`Todo ${todoId} atteso nel repository, non trovato`);
    }

    return todo;
  }

  beforeEach(async () => {
    clock.now.mockClear();

    moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        UpdateTodoHandler,
        { provide: TodoRepository, useClass: InMemoryTodoRepository },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    // init() fa registrare l'handler sul CommandBus dall'ExplorerService.
    await moduleRef.init();

    handler = moduleRef.get(UpdateTodoHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryTodoRepository>(TodoRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('persiste i campi modificati lasciando gli altri invariati', async () => {
    await seed();

    await handler.execute(
      new UpdateTodoCommand(TODO_ID, {
        title: 'Comprare il pane',
        important: true,
      }),
    );

    expect((await loadOrFail(TODO_ID)).snapshot()).toStrictEqual({
      todoId: TODO_ID,
      title: 'Comprare il pane',
      status: 'todo',
      deleted: false,
      description: 'intero',
      important: true,
      expiration: undefined,
      tags: ['casa'],
    });
  });

  it('non pre-elabora l`input: la normalizzazione resta nell`aggregato', async () => {
    await seed();

    await handler.execute(
      new UpdateTodoCommand(TODO_ID, {
        title: '  Comprare il pane  ',
        tags: [' ufficio ', 'ufficio', ''],
      }),
    );

    expect((await loadOrFail(TODO_ID)).snapshot()).toMatchObject({
      title: 'Comprare il pane',
      tags: ['ufficio'],
    });
  });

  it('pubblica TodoUpdatedEvent con il solo delta', async () => {
    await seed();

    /*
     * Gli eventi vanno copiati al momento della chiamata: `commit()` passa a
     * `publishAll` il proprio array interno e subito dopo lo azzera con
     * `.length = 0`, quindi `mock.calls` conserverebbe un riferimento vuoto.
     */
    const published: unknown[] = [];
    jest
      .spyOn(eventBus, 'publishAll')
      .mockImplementation((events: unknown[]) => {
        published.push(...events);
        return [];
      });

    await handler.execute(
      new UpdateTodoCommand(TODO_ID, {
        title: 'Comprare il pane',
        description: 'intero',
      }),
    );

    expect(published).toStrictEqual([
      new TodoUpdatedEvent(TODO_ID, { title: 'Comprare il pane' }),
    ]);
  });

  it('pubblica dopo aver persistito, non prima', async () => {
    await seed();

    const calls: string[] = [];
    jest.spyOn(repository, 'update').mockImplementation(() => {
      calls.push('update');
      return Promise.resolve();
    });
    jest.spyOn(eventBus, 'publishAll').mockImplementation(() => {
      calls.push('publishAll');
      return [];
    });

    await handler.execute(
      new UpdateTodoCommand(TODO_ID, { title: 'Comprare il pane' }),
    );

    expect(calls).toStrictEqual(['update', 'publishAll']);
  });

  it('prende l`istante dal Clock per validare la scadenza', async () => {
    await seed();

    await handler.execute(
      new UpdateTodoCommand(TODO_ID, { expiration: FUTURE }),
    );

    expect((await loadOrFail(TODO_ID)).expiration?.toString()).toBe(
      '2026-01-15 11:30',
    );
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it('rimuove la scadenza con null', async () => {
    await seed((todo) => todo.update({ now: NOW, expiration: FUTURE }));

    await handler.execute(new UpdateTodoCommand(TODO_ID, { expiration: null }));

    expect((await loadOrFail(TODO_ID)).expiration).toBeUndefined();
  });

  it('un update a vuoto non pubblica niente', async () => {
    await seed();

    const published: unknown[] = [];
    jest
      .spyOn(eventBus, 'publishAll')
      .mockImplementation((events: unknown[]) => {
        published.push(...events);
        return [];
      });

    await handler.execute(
      new UpdateTodoCommand(TODO_ID, { title: 'Comprare il latte' }),
    );

    expect(published).toStrictEqual([]);
  });

  it('solleva TodoNotFoundError se il todo non esiste, senza pubblicare', async () => {
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(
        new UpdateTodoCommand('inesistente', { title: 'Comprare il pane' }),
      ),
    ).rejects.toThrow(TodoNotFoundError);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it.each([
    ['TodoTitleRequiredError', { title: '   ' }, TodoTitleRequiredError],
    [
      'TodoExpirationInPastError',
      { expiration: { date: '2026-01-15', time: '09:00' } },
      TodoExpirationInPastError,
    ],
  ])(
    'propaga %s senza persistere né pubblicare',
    async (_label, fields, expected) => {
      await seed();

      const write = jest.spyOn(repository, 'update');
      const publishAll = jest.spyOn(eventBus, 'publishAll');

      await expect(
        handler.execute(new UpdateTodoCommand(TODO_ID, fields)),
      ).rejects.toThrow(expected);

      expect(write).not.toHaveBeenCalled();
      expect(publishAll).not.toHaveBeenCalled();
      expect((await loadOrFail(TODO_ID)).snapshot()).toMatchObject({
        title: 'Comprare il latte',
        expiration: undefined,
      });
    },
  );

  it('propaga TodoDeletedError su un todo cancellato', async () => {
    await seed((todo) => todo.delete());

    await expect(
      handler.execute(
        new UpdateTodoCommand(TODO_ID, { title: 'Comprare il pane' }),
      ),
    ).rejects.toThrow(TodoDeletedError);
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    await seed();

    await commandBus.execute(
      new UpdateTodoCommand(TODO_ID, { title: 'Comprare il pane' }),
    );

    expect((await loadOrFail(TODO_ID)).snapshot().title).toBe(
      'Comprare il pane',
    );
  });
});
