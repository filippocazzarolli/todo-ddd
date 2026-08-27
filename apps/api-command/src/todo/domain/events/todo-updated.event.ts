/**
 * Campi effettivamente cambiati da un update, nella forma serializzabile.
 *
 * Delta e non stato completo: l'evento racconta *cosa* è cambiato, che è
 * l'informazione che il lato query non può ricostruire da sé. Ricopiare tutto
 * il todo renderebbe l'evento un `TodoSnapshotted` travestito, e il read model
 * non saprebbe distinguere un campo riscritto da uno rimasto fermo.
 *
 * Chiave assente e chiave a `null` significano cose diverse: la prima è "non
 * toccato", la seconda "azzerato". Per questo i campi opzionali del todo
 * ammettono `null` e non `undefined` — `undefined` non sopravvive a
 * `JSON.stringify`, e un evento che passa da una coda perderebbe proprio
 * l'informazione più importante.
 */
export interface TodoChanges {
  title?: string;
  description?: string | null;
  important?: boolean;
  /** ISO 8601, come in `TodoCreatedEvent`; `null` se la scadenza è stata rimossa. */
  expiration?: string | null;
  /** Insieme completo dei tag dopo l'update, non i soli aggiunti o rimossi. */
  tags?: string[];
}

/**
 * Emesso quando almeno un campo del todo è cambiato.
 *
 * Se l'update non cambia niente non viene emesso: un evento è un fatto
 * accaduto, e "il titolo è stato riscritto identico" non lo è.
 *
 * `changes` è un oggetto e non una lista di parametri posizionali perché è
 * sparso: solo i campi toccati sono presenti.
 */
export class TodoUpdatedEvent {
  constructor(
    public readonly todoId: string,
    /** Come in ogni evento del modulo: vedi `TodoCreatedEvent`. */
    public readonly ownerId: string,
    public readonly changes: TodoChanges,
  ) {}
}
