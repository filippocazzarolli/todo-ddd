import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di completare un todo.
 *
 * Oltre all'attore porta il solo `todoId`: l'esito della transizione non
 * dipende da altri dati del chiamante, dipende dallo stato dell'aggregato. Non porta nemmeno un
 * istante di completamento — se un giorno servirà `completedAt`, arriverà da
 * `Clock` nell'handler, come `now` in `CreateTodoCommand`.
 *
 * `Command<void>` e non `Command<string>`: l'id lo conosce già il chiamante,
 * restituirlo non aggiungerebbe informazione.
 */
export class MarkTodoAsDoneCommand extends Command<void> {
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
