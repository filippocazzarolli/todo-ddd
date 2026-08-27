/**
 * Campi effettivamente cambiati da un update, nella forma serializzabile.
 *
 * Delta e non stato completo, come `TodoChanges`: l'evento racconta *cosa* è
 * cambiato, che è l'informazione che il lato query non può ricostruire da sé.
 *
 * Nessun campo ammette `null`, a differenza di `TodoChanges`: né il nome né il
 * cognome sono azzerabili, quindi qui i due stati "assente = non toccato" e
 * "presente = assegnato" bastano. Il terzo stato di `TodoChanges` esiste solo
 * perché il todo ha campi opzionali da svuotare.
 */
export interface UserChanges {
  firstName?: string;
  lastName?: string;
}

/**
 * Emesso quando almeno un campo modificabile dell'utente è cambiato.
 *
 * Se l'update non cambia niente non viene emesso: un evento è un fatto
 * accaduto, e "il cognome è stato riscritto identico" non lo è.
 *
 * `changes` è un oggetto e non parametri posizionali perché è sparso: solo i
 * campi toccati sono presenti.
 */
export class UserUpdatedEvent {
  constructor(
    public readonly userId: string,
    public readonly changes: UserChanges,
  ) {}
}
