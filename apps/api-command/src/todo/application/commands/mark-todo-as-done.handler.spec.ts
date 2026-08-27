import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { Todo } from '../../domain/aggregates/todo.aggregate';
import {
  TodoAlreadyDoneError,
  TodoDeletedError,
  TodoNotOwnedError,
} from '../../domain/errors/todo.errors';
import { TodoMarkedAsDoneEvent } from '../../domain/events/todo-marked-as-done.event';
import { TodoRepository } from '../../domain/ports/todo.repository';
import { InMemoryTodoRepository } from '../../persistence/in-memory-todo.repository';
import { TodoNotFoundError } from '../errors/todo-not-found.error';
import { MarkTodoAsDoneCommand } from './mark-todo-as-done.command';
import { MarkTodoAsDoneHandler } from './mark-todo-as-done.handler';

const TODO_ID = 'todo-1';

/** Il proprietario del todo seminato: l'attore legittimo dei comandi. */
const OWNER_ID = 'user-1';

/** Un attore che non possiede il todo: deve essere respinto da `loadTodo`. */
const OTHER_ID = 'user-2';

/** Componenti locali, non stringa ISO: vedi lo spec dell'aggregato. */
const NOW = new Date(2026, 0, 15, 10, 30);

describe('MarkTodoAsDoneHandler', () => {
  let moduleRef: TestingModule;
  let handler: MarkTodoAsDoneHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryTodoRepository;

  /**
   * Semina il repository con uno stato di partenza. Il todo non è mergiato
   * sull'`EventPublisher`, quindi l'evento della `create` resta scartato: qui
   * conta solo lo stato persistito, non la sua storia.
   */
  async function seed(mutate?: (todo: Todo) => void): Promise<void> {
    const todo = Todo.create({
      todoId: TODO_ID,
      ownerId: OWNER_ID,
      title: 'Comprare il latte',
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
    moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        MarkTodoAsDoneHandler,
        { provide: TodoRepository, useClass: InMemoryTodoRepository },
      ],
    }).compile();

    // init() fa registrare l'handler sul CommandBus dall'ExplorerService.
    await moduleRef.init();

    handler = moduleRef.get(MarkTodoAsDoneHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryTodoRepository>(TodoRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('porta il todo a done e ne persiste lo stato', async () => {
    await seed();

    await handler.execute(new MarkTodoAsDoneCommand(OWNER_ID, TODO_ID));

    expect((await loadOrFail(TODO_ID)).status).toBe('done');
  });

  it('pubblica TodoMarkedAsDoneEvent', async () => {
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

    await handler.execute(new MarkTodoAsDoneCommand(OWNER_ID, TODO_ID));

    expect(published).toStrictEqual([
      new TodoMarkedAsDoneEvent(TODO_ID, OWNER_ID),
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

    await handler.execute(new MarkTodoAsDoneCommand(OWNER_ID, TODO_ID));

    expect(calls).toStrictEqual(['update', 'publishAll']);
  });

  it('solleva TodoNotFoundError se il todo non esiste, senza pubblicare', async () => {
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new MarkTodoAsDoneCommand(OWNER_ID, 'inesistente')),
    ).rejects.toThrow(TodoNotFoundError);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propaga TodoAlreadyDoneError lasciando invariato lo stato persistito', async () => {
    await seed((todo) => todo.markAsDone());

    const write = jest.spyOn(repository, 'update');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new MarkTodoAsDoneCommand(OWNER_ID, TODO_ID)),
    ).rejects.toThrow(TodoAlreadyDoneError);

    expect(write).not.toHaveBeenCalled();
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propaga TodoDeletedError su un todo cancellato', async () => {
    await seed((todo) => todo.delete());

    await expect(
      handler.execute(new MarkTodoAsDoneCommand(OWNER_ID, TODO_ID)),
    ).rejects.toThrow(TodoDeletedError);
  });

  /*
   * L'autorizzazione e` verificata da `loadTodo`, non da questo handler: il
   * test sta comunque qui perche` cio` che si vuole provare e` che *questo*
   * handler passi l'attore, e un handler che se lo dimenticasse non
   * fallirebbe nessun altro test.
   */
  it('rifiuta un attore che non e` il proprietario, senza scrivere ne` pubblicare', async () => {
    await seed();
    const write = jest.spyOn(repository, 'update');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new MarkTodoAsDoneCommand(OTHER_ID, TODO_ID)),
    ).rejects.toThrow(new TodoNotOwnedError(TODO_ID, OTHER_ID));

    expect(write).not.toHaveBeenCalled();
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('un todo inesistente e` un 404 anche per un estraneo: prima si cerca, poi si autorizza', async () => {
    await expect(
      handler.execute(new MarkTodoAsDoneCommand(OTHER_ID, 'inesistente')),
    ).rejects.toThrow(TodoNotFoundError);
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    await seed();

    await commandBus.execute(new MarkTodoAsDoneCommand(OWNER_ID, TODO_ID));

    expect((await loadOrFail(TODO_ID)).isDone).toBe(true);
  });
});
