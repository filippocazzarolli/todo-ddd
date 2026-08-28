import { Todo } from '../aggregates/todo.aggregate';

/**
 * Porta di persistenza dell'aggregato `Todo`.
 *
 * Vive nel dominio e non in `persistence/` perché è il dominio a possedere il
 * contratto: cancellando l'intera cartella degli adapter, questo file deve
 * continuare a compilare.
 *
 * È una `abstract class` e non una `interface` per avere un token DI
 * risolvibile a runtime (vedi `TodoIdGenerator` e CLAUDE.md).
 *
 * Superficie deliberatamente minima: sul lato command serve solo caricare
 * l'aggregato per eseguire un comando e scriverlo. Ogni ricerca, filtro o
 * elenco appartiene al read model di `api-query` — un `findByStatus` qui
 * renderebbe decorativo lo split CQRS.
 *
 * Non c'è nessuna rimozione: la cancellazione è un cambio di stato
 * dell'aggregato (`Todo.delete`), quindi passa per `update`. Se un adapter
 * decida di tradurla in `DELETE` fisica o in un tombstone è affare suo.
 */
export abstract class TodoRepository {
  /**
   * Restituisce l'aggregato, `null` se non esiste.
   *
   * Restituisce anche i todo cancellati: la decisione su cosa sia lecito fare
   * su un aggregato cancellato è dell'aggregato (`TodoDeletedError`), non del
   * repository. Filtrarli qui li farebbe apparire come inesistenti.
   */
  abstract findById(todoId: string): Promise<Todo | null>;

  /**
   * Inserisce un aggregato nuovo.
   *
   * Due fallimenti dichiarati: `TodoAlreadyExistsError` se l'id esiste già, e
   * `TodoOwnerNotFoundError` se l'`ownerId` non corrisponde a nessun utente.
   * Il secondo sta qui e non nell'aggregato perché l'esistenza del
   * proprietario si verifica solo guardando fuori dal confine del todo, cioè in
   * un vincolo di chiave esterna: lo solleva l'adapter Drizzle, mentre il test
   * double in memoria non può, non vedendo gli utenti.
   *
   * Distinto da `update` e non un upsert unico, perché un upsert cancella due
   * segnali che vale la pena sentire: l'inserimento di un id duplicato (che è
   * la base dell'idempotenza sulle retry) e la scrittura su un aggregato
   * scomparso. Il chiamante sa sempre quale dei due casi è il suo: o l'ha
   * appena costruito con `Todo.create`, o l'ha caricato con `findById`.
   *
   * L'identità arriva sempre dall'aggregato, mai generata qui: la produce
   * l'handler tramite `TodoIdGenerator`.
   */
  abstract add(todo: Todo): Promise<void>;

  /**
   * Sovrascrive un aggregato esistente, **se nessun altro l'ha già fatto**.
   *
   * Due fallimenti dichiarati, e la differenza fra i due conta per chi chiama:
   * `TodoNoLongerExistsError` se l'aggregato è sparito (rinunciare), e
   * `TodoConcurrencyConflictError` se è stato riscritto dopo che l'avevamo
   * caricato (ricaricare e riprovare).
   *
   * Scrive l'aggregato intero e non i soli campi cambiati: il delta è un
   * concetto degli eventi, non della persistenza dello stato. È anche la
   * ragione per cui la concorrenza ottimistica serve davvero — riscrivendo
   * tutto, un aggregato caricato prima di un altro comando ne cancellerebbe le
   * decisioni in silenzio, non solo sui campi che tocca.
   *
   * Il confronto avviene sulla `version` dello stato caricato; ogni scrittura
   * riuscita la fa avanzare di uno. **L'aggregato non se ne accorge**: dopo un
   * `update` l'istanza in memoria è indietro di uno e non è più scrivibile.
   * Volerlo riscrivere significa ricaricarlo, che è precisamente ciò che questa
   * regola deve imporre.
   *
   * È l'altra ragione per cui non è un upsert: `UPDATE ... WHERE version = ?`
   * che non tocca righe è un conflitto, mentre lo stesso in un upsert diventa
   * un insert silenzioso.
   */
  abstract update(todo: Todo): Promise<void>;
}
