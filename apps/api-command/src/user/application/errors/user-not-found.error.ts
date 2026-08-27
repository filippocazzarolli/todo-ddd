/**
 * Nessun utente con l'id richiesto.
 *
 * Vive in `application/` e non tra gli errori di dominio perché non è la
 * violazione di un'invariante: l'aggregato non può accorgersi di non esistere.
 * È il caso in cui `UserRepository.findById` restituisce `null`, cioè un fatto
 * sull'orchestrazione — il comando si riferisce a qualcosa che non c'è.
 *
 * Ha una gerarchia separata da `UserDomainError` proprio per questo: chi mappa
 * gli errori sul trasporto deve poter distinguere "richiesta impossibile"
 * (404) da "richiesta rifiutata dalle regole" (409).
 */
export class UserNotFoundError extends Error {
  constructor(public readonly userId: string) {
    super(`L'utente ${userId} non esiste`);
  }
}
