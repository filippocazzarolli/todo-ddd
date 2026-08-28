import { User } from '../aggregates/user.aggregate';

/**
 * Porta di persistenza dell'aggregato `User`.
 *
 * Vive nel dominio e non in `persistence/` perché è il dominio a possedere il
 * contratto: cancellando l'intera cartella degli adapter, questo file deve
 * continuare a compilare.
 *
 * È una `abstract class` e non una `interface` per avere un token DI
 * risolvibile a runtime (vedi `UserIdGenerator` e CLAUDE.md).
 *
 * Superficie deliberatamente minima, come `TodoRepository`: sul lato command
 * serve solo caricare l'aggregato per eseguire un comando e scriverlo. Nessun
 * `findByEmail`, nessun elenco, nessun filtro — quelli appartengono al read
 * model di `api-query`. In particolare non c'è un `existsByEmail` per il
 * controllo di unicità: quel controllo non è una lettura del lato write ma un
 * vincolo, e sta in `add` (vedi `UserEmailAlreadyTakenError`).
 *
 * Non c'è nessuna rimozione: la cancellazione è un cambio di stato
 * dell'aggregato (`User.delete`), quindi passa per `update`.
 */
export abstract class UserRepository {
  /**
   * Restituisce l'aggregato, `null` se non esiste.
   *
   * Restituisce anche gli utenti cancellati: la decisione su cosa sia lecito
   * fare su un aggregato cancellato è dell'aggregato (`UserDeletedError`), non
   * del repository. Filtrarli qui li farebbe apparire come inesistenti, e un
   * client si vedrebbe un 404 dove il fatto è un 409.
   */
  abstract findById(userId: string): Promise<User | null>;

  /**
   * Inserisce un aggregato nuovo.
   *
   * Due fallimenti distinti, entrambi vincoli di unicità che solo lo store può
   * verificare: `UserAlreadyExistsError` se l'id esiste già,
   * `UserEmailAlreadyTakenError` se l'email è di qualcun altro.
   *
   * Distinto da `update` e non un upsert unico, perché un upsert cancella due
   * segnali che vale la pena sentire: l'inserimento di un id duplicato (che è
   * la base dell'idempotenza sulle retry) e la scrittura su un aggregato
   * scomparso.
   *
   * L'identità arriva sempre dall'aggregato, mai generata qui: la produce
   * l'handler tramite `UserIdGenerator`.
   */
  abstract add(user: User): Promise<void>;

  /**
   * Sovrascrive un aggregato esistente, **se nessun altro l'ha già fatto**.
   *
   * Due fallimenti dichiarati, e la differenza conta per chi chiama:
   * `UserNoLongerExistsError` se l'aggregato è sparito,
   * `UserConcurrencyConflictError` se è stato riscritto dopo il caricamento.
   *
   * Scrive l'aggregato intero e non i soli campi cambiati: il delta è un
   * concetto degli eventi, non della persistenza dello stato. È anche la
   * ragione per cui la concorrenza ottimistica serve davvero — riscrivendo
   * tutto, un aggregato caricato prima di un altro comando ne cancellerebbe le
   * decisioni in silenzio.
   *
   * Il confronto avviene sulla `version` dello stato caricato; ogni scrittura
   * riuscita la fa avanzare di uno, e l'istanza in memoria resta indietro: dopo
   * un `update` non è più scrivibile senza ricaricarla.
   *
   * È l'altra ragione per cui non è un upsert: `UPDATE ... WHERE version = ?`
   * che non tocca righe è un conflitto, mentre lo stesso in un upsert diventa
   * un insert silenzioso.
   */
  abstract update(user: User): Promise<void>;
}
