import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di cancellare un todo.
 *
 * Non distingue tra cancellazione logica e fisica: è una scelta di
 * persistenza, e il comando esprime l'intenzione dell'utente.
 */
export class DeleteTodoCommand extends Command<void> {
  constructor(public readonly todoId: string) {
    super();
  }
}
