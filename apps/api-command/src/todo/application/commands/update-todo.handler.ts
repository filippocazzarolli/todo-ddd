import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { Clock } from '../../domain/ports/clock';
import { TodoRepository } from '../../domain/ports/todo.repository';
import { loadTodo } from '../load-todo';
import { UpdateTodoCommand } from './update-todo.command';

/**
 * Orchestratore: carica, applica il patch, salva, pubblica.
 *
 * Non ispeziona `command.fields` né confronta niente: quali campi siano
 * cambiati davvero, e se valga la pena emettere un evento, lo decide
 * `Todo.update`. Un handler che provasse a saltare il salvataggio per gli
 * update a vuoto duplicherebbe quel confronto fuori dall'aggregato.
 *
 * Inietta `Clock` come `CreateTodoHandler`: l'istante serve a `Expiration` per
 * rifiutare le scadenze nel passato, e il dominio non legge l'ora di sistema.
 */
@CommandHandler(UpdateTodoCommand)
export class UpdateTodoHandler implements ICommandHandler<UpdateTodoCommand> {
  constructor(
    private readonly todos: TodoRepository,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: UpdateTodoCommand): Promise<void> {
    const todo = await loadTodo(
      this.todos,
      this.publisher,
      command.todoId,
      command.actorId,
    );

    todo.update({ now: this.clock.now(), ...command.fields });

    await this.todos.update(todo);

    // Prima si persiste, poi si pubblica: il read model non deve vedere una
    // write che potrebbe essere fallita.
    todo.commit();
  }
}
