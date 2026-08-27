import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di riaprire un todo completato: inverso di
 * `MarkTodoAsDoneCommand`, e come quello porta il solo `todoId`.
 */
export class ReopenTodoCommand extends Command<void> {
  constructor(public readonly todoId: string) {
    super();
  }
}
