import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { TodoRepository } from '../../domain/ports/todo.repository';
import { loadTodo } from '../load-todo';
import { MarkTodoAsDoneCommand } from './mark-todo-as-done.command';

/**
 * Orchestratore: carica, invoca la transizione, salva, pubblica.
 *
 * Nessuna regola qui — che un todo già completato non si possa ricompletare
 * (`TodoAlreadyDoneError`) e che un todo cancellato non accetti transizioni
 * (`TodoDeletedError`) lo decide `Todo.markAsDone`. L'handler lascia
 * propagare, e non salva: un aggregato che ha rifiutato la transizione non ha
 * cambiato stato, quindi non c'è niente da scrivere.
 *
 * Le dipendenze sono importate con import normali, non `import type`: con
 * `isolatedModules: true` un tipo importato non emette metadata e la DI per
 * costruttore si romperebbe in silenzio (vedi CLAUDE.md).
 */
@CommandHandler(MarkTodoAsDoneCommand)
export class MarkTodoAsDoneHandler implements ICommandHandler<MarkTodoAsDoneCommand> {
  constructor(
    private readonly todos: TodoRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: MarkTodoAsDoneCommand): Promise<void> {
    const todo = await loadTodo(this.todos, this.publisher, command.todoId);

    todo.markAsDone();

    await this.todos.update(todo);

    // Prima si persiste, poi si pubblica: il read model non deve vedere una
    // write che potrebbe essere fallita.
    todo.commit();
  }
}
