/**
 * Fallimenti dichiarati da `TodoRepository`.
 *
 * Stanno accanto alla porta, non tra gli errori di dominio: non sono
 * violazioni di invarianti dell'aggregato ma esiti della scrittura, e chi
 * implementa un adapter deve poterli sollevare senza dipendere dal dominio
 * più di quanto già faccia. Vivono qui e non in `persistence/` per la stessa
 * ragione della porta: il contratto è del dominio, gli adapter lo rispettano.
 *
 * Gerarchia separata da `TodoDomainError` e da `TodoNotFoundError`, così la
 * mappatura a valle può trattare in modo diverso "l'utente ha chiesto qualcosa
 * di illegale" e "la scrittura non è andata come previsto" — il secondo caso è
 * spesso un retry, non un 4xx.
 */
export class TodoPersistenceError extends Error {}

/**
 * `add` su un id già presente.
 *
 * È il segnale su cui si costruisce l'idempotenza: quando `CreateTodoCommand`
 * porterà il `todoId` dal chiamante, una consegna ripetuta dello stesso
 * comando finisce qui invece di sovrascrivere in silenzio un todo che nel
 * frattempo è stato modificato.
 */
export class TodoAlreadyExistsError extends TodoPersistenceError {
  constructor(public readonly todoId: string) {
    super(`Il todo ${todoId} esiste già`);
  }
}

/**
 * `update` su un id assente.
 *
 * Significa che l'aggregato è stato caricato e poi è sparito: la scrittura si
 * basa su uno stato che non esiste più. Non è `TodoNotFoundError` — quello dice
 * che il comando si riferiva a qualcosa che non c'era, questo che la corsa
 * l'ha vinta qualcun altro.
 */
export class TodoNoLongerExistsError extends TodoPersistenceError {
  constructor(public readonly todoId: string) {
    super(`Il todo ${todoId} non esiste più`);
  }
}

/**
 * `add` con un `ownerId` che non corrisponde a nessun utente.
 *
 * L'esistenza del proprietario non è un invariante dell'aggregato `Todo` —
 * verificarla richiede di guardare fuori dal suo confine transazionale,
 * esattamente come l'unicità dell'email che `User` si rifiuta di controllare.
 * L'unico posto in cui la verifica è davvero atomica è il vincolo di chiave
 * esterna del database, quindi il fallimento appartiene alla porta di
 * persistenza.
 *
 * `DrizzleTodoRepository` lo solleva, traducendo
 * `SQLITE_CONSTRAINT_FOREIGNKEY`. `InMemoryTodoRepository` no e non può: non
 * vede gli utenti, quindi per il test double un todo orfano resta
 * rappresentabile — ed è la ragione per cui le due spec di questo repository
 * non condividono una suite di contratto.
 *
 * L'alternativa — l'handler che interroga `UserRepository` prima di creare —
 * è stata scartata: accoppierebbe i due bounded context sul lato write per una
 * verifica che resta comunque non atomica, dato che l'utente può essere
 * cancellato subito dopo il controllo.
 */
export class TodoOwnerNotFoundError extends TodoPersistenceError {
  constructor(public readonly ownerId: string) {
    super(`L'utente ${ownerId} non esiste`);
  }
}
