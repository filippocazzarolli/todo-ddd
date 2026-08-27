/**
 * Emesso quando un todo viene cancellato.
 *
 * Porta `todoId` e `ownerId` e nient'altro: al lato query serve sapere *quale*
 * proiezione rimuovere e di chi era, non com'era fatta. L'owner serve anche
 * qui perché la proiezione può essere partizionata per utente, e trovare la
 * riga da rimuovere richiede la chiave completa.
 */
export class TodoDeletedEvent {
  constructor(
    public readonly todoId: string,
    public readonly ownerId: string,
  ) {}
}
