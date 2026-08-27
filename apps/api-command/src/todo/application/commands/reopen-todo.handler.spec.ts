import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { Todo } from '../../domain/aggregates/todo.aggregate';
import {
  TodoDeletedError,
  TodoNotDoneError,
} from '../../domain/errors/todo.errors';
import { TodoReopenedEvent } from '../../domain/events/todo-reopened.event';
import { TodoRepository } from '../../domain/ports/todo.repository';
import { InMemoryTodoRepository } from '../../persistence/in-memory-todo.repository';
import { TodoNotFoundError } from '../errors/todo-not-found.error';
import { ReopenTodoCommand } from './reopen-todo.command';
import { ReopenTodoHandler } from './reopen-todo.handler';

const TODO_ID = 'todo-1';

/** Componenti locali, non stringa ISO: vedi lo spec dell'aggregato. */
const NOW = new Date(2026, 0, 15, 10, 30);

describe('ReopenTodoHandler', () => {
  let moduleRef: TestingModule;
  let handler: ReopenTodoHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryTodoRepository;

  /** Semina un todo già completato: è lo stato di partenza della riapertura. */
  async function seedDone(mutate?: (todo: Todo) => void): Promise<void> {
    const todo = Todo.create({
      todoId: TODO_ID,
      title: 'Comprare il latte',
      now: NOW,
    });

    todo.markAsDone();
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
        ReopenTodoHandler,
        { provide: TodoRepository, useClass: InMemoryTodoRepository },
      ],
    }).compile();

    await moduleRef.init();

    handler = moduleRef.get(ReopenTodoHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryTodoRepository>(TodoRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('riporta il todo a todo e ne persiste lo stato', async () => {
    await seedDone();

    await handler.execute(new ReopenTodoCommand(TODO_ID));

    expect((await loadOrFail(TODO_ID)).status).toBe('todo');
  });

  it('pubblica TodoReopenedEvent', async () => {
    await seedDone();

    const published: unknown[] = [];
    jest
      .spyOn(eventBus, 'publishAll')
      .mockImplementation((events: unknown[]) => {
        published.push(...events);
        return [];
      });

    await handler.execute(new ReopenTodoCommand(TODO_ID));

    expect(published).toStrictEqual([new TodoReopenedEvent(TODO_ID)]);
  });

  it('pubblica dopo aver persistito, non prima', async () => {
    await seedDone();

    const calls: string[] = [];
    jest.spyOn(repository, 'update').mockImplementation(() => {
      calls.push('update');
      return Promise.resolve();
    });
    jest.spyOn(eventBus, 'publishAll').mockImplementation(() => {
      calls.push('publishAll');
      return [];
    });

    await handler.execute(new ReopenTodoCommand(TODO_ID));

    expect(calls).toStrictEqual(['update', 'publishAll']);
  });

  it('solleva TodoNotFoundError se il todo non esiste, senza pubblicare', async () => {
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new ReopenTodoCommand('inesistente')),
    ).rejects.toThrow(TodoNotFoundError);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propaga TodoNotDoneError se il todo non è completato', async () => {
    const todo = Todo.create({
      todoId: TODO_ID,
      title: 'Comprare il latte',
      now: NOW,
    });
    await repository.add(todo);

    const write = jest.spyOn(repository, 'update');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new ReopenTodoCommand(TODO_ID)),
    ).rejects.toThrow(TodoNotDoneError);

    expect(write).not.toHaveBeenCalled();
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propaga TodoDeletedError su un todo cancellato', async () => {
    await seedDone((todo) => todo.delete());

    await expect(
      handler.execute(new ReopenTodoCommand(TODO_ID)),
    ).rejects.toThrow(TodoDeletedError);
  });

  it('la transizione è ripetibile: done -> todo -> done -> todo', async () => {
    await seedDone();

    await commandBus.execute(new ReopenTodoCommand(TODO_ID));

    const reopened = await loadOrFail(TODO_ID);
    reopened.markAsDone();
    await repository.update(reopened);

    await commandBus.execute(new ReopenTodoCommand(TODO_ID));

    expect((await loadOrFail(TODO_ID)).isDone).toBe(false);
  });
});
