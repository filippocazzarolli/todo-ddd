import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { TodoRepository } from '../../domain/ports/todo.repository';
import { loadTodo } from '../load-todo';
import { DeleteTodoCommand } from './delete-todo.command';

/**
 * Cancella il todo.
 *
 * `save` anche qui, come nelle altre transizioni: per il dominio la
 * cancellazione è un cambio di stato dell'aggregato, e se il repository la
 * tradurrà in una `DELETE` fisica o in un tombstone è affare suo. L'handler
 * non chiama nessun `remove`, e infatti `TodoRepository` non lo espone.
 *
 * Non è idempotente: ricancellare solleva `TodoDeletedError`. La ripetizione
 * di un comando è un problema di consegna, e va risolta con l'idempotenza sul
 * bus, non ammorbidendo l'aggregato.
 */
@CommandHandler(DeleteTodoCommand)
export class DeleteTodoHandler implements ICommandHandler<DeleteTodoCommand> {
  constructor(
    private readonly todos: TodoRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: DeleteTodoCommand): Promise<void> {
    const todo = await loadTodo(
      this.todos,
      this.publisher,
      command.todoId,
      command.actorId,
    );

    todo.delete();

    await this.todos.update(todo);

    todo.commit();
  }
}
