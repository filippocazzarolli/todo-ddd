import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di cancellare un todo.
 *
 * Non distingue tra cancellazione logica e fisica: è una scelta di
 * persistenza, e il comando esprime l'intenzione dell'utente.
 */
export class DeleteTodoCommand extends Command<void> {
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
