/**
 * Emesso alla transizione `todo` -> `done`.
 */
export class TodoMarkedAsDoneEvent {
  constructor(public readonly todoId: string) {}
}
