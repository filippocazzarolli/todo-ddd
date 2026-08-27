/**
 * Emesso alla transizione `done` -> `todo`.
 */
export class TodoReopenedEvent {
  constructor(public readonly todoId: string) {}
}
