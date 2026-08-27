/**
 * Emesso alla transizione `todo` -> `done`.
 *
 * Porta l'`ownerId` come ogni evento del modulo, per la ragione spiegata in
 * `TodoCreatedEvent`: il consumatore non deve dover risalire al proprietario.
 */
export class TodoMarkedAsDoneEvent {
  constructor(
    public readonly todoId: string,
    public readonly ownerId: string,
  ) {}
}
