import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { TodoRepository } from '../../domain/ports/todo.repository';
import { loadTodo } from '../load-todo';
import { ReopenTodoCommand } from './reopen-todo.command';

/**
 * Simmetrico di `MarkTodoAsDoneHandler`: riaprire un todo non completato è un
 * errore di dominio (`TodoNotDoneError`), non un no-op.
 */
@CommandHandler(ReopenTodoCommand)
export class ReopenTodoHandler implements ICommandHandler<ReopenTodoCommand> {
  constructor(
    private readonly todos: TodoRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ReopenTodoCommand): Promise<void> {
    const todo = await loadTodo(
      this.todos,
      this.publisher,
      command.todoId,
      command.actorId,
    );

    todo.reopen();

    await this.todos.update(todo);

    todo.commit();
  }
}
