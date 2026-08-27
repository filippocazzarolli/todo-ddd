/**
 * Emesso quando un todo viene cancellato.
 *
 * Porta il solo `todoId`: al lato query serve sapere *quale* proiezione
 * rimuovere, non com'era fatta.
 */
export class TodoDeletedEvent {
  constructor(public readonly todoId: string) {}
}
