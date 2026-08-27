/**
 * Fallimenti dichiarati da `UserRepository`.
 *
 * Stanno accanto alla porta, non tra gli errori di dominio: non sono
 * violazioni di invarianti dell'aggregato ma esiti della scrittura, e chi
 * implementa un adapter deve poterli sollevare senza dipendere dal dominio più
 * di quanto già faccia. Vivono qui e non in `persistence/` per la stessa
 * ragione della porta: il contratto è del dominio, gli adapter lo rispettano.
 *
 * Gerarchia separata da `UserDomainError` e da `UserNotFoundError`, così la
 * mappatura a valle può trattare in modo diverso "l'utente ha chiesto qualcosa
 * di illegale" e "la scrittura non è andata come previsto".
 */
export class UserPersistenceError extends Error {}

/**
 * `add` su un id già presente.
 *
 * È il segnale su cui si costruisce l'idempotenza: quando `CreateUserCommand`
 * porterà lo `userId` dal chiamante, una consegna ripetuta dello stesso
 * comando finisce qui invece di sovrascrivere in silenzio un utente che nel
 * frattempo è stato modificato.
 */
export class UserAlreadyExistsError extends UserPersistenceError {
  constructor(public readonly userId: string) {
    super(`L'utente ${userId} esiste già`);
  }
}

/**
 * `add` con un'email già registrata da un altro utente.
 *
 * Questo è il punto in cui l'unicità dell'email viene davvero fatta
 * rispettare, e non è un caso che sia qui: `User` non può verificarla — gli
 * altri utenti sono fuori dal suo confine transazionale — e un controllo
 * preventivo nell'handler sarebbe una corsa (`SELECT` e `INSERT` non sono
 * atomici) che darebbe l'illusione della sicurezza senza togliere la necessità
 * del vincolo. L'unico posto che vede tutti gli utenti è lo store, quindi è
 * lui l'autorità: `UNIQUE (email)` sulla tabella, e l'adapter traduce la
 * violazione in questo errore.
 *
 * Solo su `add` e non su `update` perché l'email oggi non è modificabile
 * (`UpdateUserProps` non la contiene). Quando arriverà `changeEmail`, `update`
 * erediterà lo stesso fallimento.
 *
 * Nota per l'adapter: con la cancellazione logica un utente cancellato occupa
 * ancora la sua email, perché la riga c'è e il vincolo vale. Liberarla al
 * `delete` è una scelta diversa (indice parziale `WHERE deleted = false`) con
 * conseguenze reali — permette la re-registrazione, ma rende ambigua la storia
 * di quell'indirizzo. Va decisa quando si scrive lo schema, non per caso.
 */
export class UserEmailAlreadyTakenError extends UserPersistenceError {
  constructor(public readonly email: string) {
    super(`L'email ${email} è già registrata`);
  }
}

/**
 * `update` su un id assente.
 *
 * Significa che l'aggregato è stato caricato e poi è sparito: la scrittura si
 * basa su uno stato che non esiste più. Non è `UserNotFoundError` — quello dice
 * che il comando si riferiva a qualcosa che non c'era, questo che la corsa
 * l'ha vinta qualcun altro.
 */
export class UserNoLongerExistsError extends UserPersistenceError {
  constructor(public readonly userId: string) {
    super(`L'utente ${userId} non esiste più`);
  }
}
