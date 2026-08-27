import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di cancellare un utente.
 *
 * Non distingue tra cancellazione logica e fisica: è una scelta di
 * persistenza, e il comando esprime l'intenzione dell'utente.
 */
export class DeleteUserCommand extends Command<void> {
  constructor(public readonly userId: string) {
    super();
  }
}
