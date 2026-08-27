import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di riaprire un todo completato: inverso di
 * `MarkTodoAsDoneCommand`, e come quello porta solo attore e `todoId`.
 */
export class ReopenTodoCommand extends Command<void> {
  constructor(
    /**
     * Chi esegue il comando, dal contesto di autenticazione e mai dal body:
     * vedi `CreateTodoCommand`. Qui non assegna niente, serve a `loadTodo` per
     * verificare che l'attore sia il proprietario del todo.
     */
    public readonly actorId: string,
    public readonly todoId: string,
  ) {
    super();
  }
}
