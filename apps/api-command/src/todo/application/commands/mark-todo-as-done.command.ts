import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di completare un todo.
 *
 * Porta il solo `todoId`: l'esito della transizione non dipende da altri dati
 * del chiamante, dipende dallo stato dell'aggregato. Non porta nemmeno un
 * istante di completamento — se un giorno servirà `completedAt`, arriverà da
 * `Clock` nell'handler, come `now` in `CreateTodoCommand`.
 *
 * `Command<void>` e non `Command<string>`: l'id lo conosce già il chiamante,
 * restituirlo non aggiungerebbe informazione.
 */
export class MarkTodoAsDoneCommand extends Command<void> {
  constructor(public readonly todoId: string) {
    super();
  }
}
