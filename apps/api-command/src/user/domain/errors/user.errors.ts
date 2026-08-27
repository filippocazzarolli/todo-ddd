// Solo il tipo, quindi nessuna dipendenza a runtime da `aggregates/`
// (vedi la nota in `user-subscription-changed.event.ts`).
import type { UserSubscription } from '../aggregates/user.aggregate';

/**
 * Errori di dominio: violazioni di invarianti dell'aggregato `User`.
 *
 * Sono volutamente ignoranti del trasporto — la mappatura su HTTP
 * è responsabilità del layer applicativo/infrastrutturale.
 */
export class UserDomainError extends Error {}

/** I campi nome dell'utente, entrambi obbligatori e trattati allo stesso modo. */
export type UserNameField = 'firstName' | 'lastName';

/**
 * Nome o cognome vuoto.
 *
 * Una sola classe parametrizzata invece di due gemelle: la regola violata è
 * la stessa e la mappatura a valle è la stessa (una richiesta malformata), ma
 * chi la riceve deve poter dire *quale* campo indicare. Il campo è quindi un
 * dato dell'errore, non la sua identità.
 */
export class UserNameRequiredError extends UserDomainError {
  constructor(public readonly field: UserNameField) {
    super(`Il campo ${field} dell'utente è obbligatorio`);
  }
}

/**
 * L'indirizzo non è un'email sintatticamente valida.
 *
 * Copre anche il caso vuoto: una stringa di soli spazi non è un indirizzo
 * "mancante" da segnalare a parte, è semplicemente un indirizzo che non
 * supera il formato. A differenza del titolo di un todo, qui non esiste una
 * forma valida-ma-vuota da distinguere.
 */
export class UserEmailInvalidError extends UserDomainError {
  constructor(public readonly value: string) {
    super(`L'indirizzo "${value}" non è un'email valida`);
  }
}

/**
 * Cambio di piano verso il piano già attivo.
 *
 * Esiste perché `changeSubscription` non è idempotente: una richiesta
 * duplicata è un segnale, non un no-op. Porta il piano oltre allo `userId`
 * perché a valle serve poter dire *quale* — un client che riceve "sei già
 * su pro" può correggere il proprio stato, uno che riceve "nessun cambiamento"
 * no.
 */
export class UserAlreadySubscribedError extends UserDomainError {
  constructor(
    public readonly userId: string,
    public readonly subscription: UserSubscription,
  ) {
    super(`L'utente ${userId} è già sul piano ${subscription}`);
  }
}

/**
 * Operazione su un utente già cancellato.
 *
 * L'esistenza dell'aggregato è precondizione di qualunque altra invariante,
 * quindi questo errore precede tutti gli altri: un utente cancellato non
 * riceve né `UserNameRequiredError` né `UserAlreadySubscribedError`, perché
 * quelle domande non si pongono più.
 */
export class UserDeletedError extends UserDomainError {
  constructor(public readonly userId: string) {
    super(`L'utente ${userId} è stato cancellato`);
  }
}
