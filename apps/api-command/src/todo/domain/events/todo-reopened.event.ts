/**
 * Emesso alla transizione `done` -> `todo`.
 *
 * Porta l'`ownerId` come ogni evento del modulo, per la ragione spiegata in
 * `TodoCreatedEvent`.
 */
export class TodoReopenedEvent {
  constructor(
    public readonly todoId: string,
    public readonly ownerId: string,
  ) {}
}
