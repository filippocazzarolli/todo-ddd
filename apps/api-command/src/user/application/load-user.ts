import { EventPublisher } from '@nestjs/cqrs';

import { User } from '../domain/aggregates/user.aggregate';
import { UserRepository } from '../domain/ports/user.repository';
import { UserNotFoundError } from './errors/user-not-found.error';

/**
 * Carica un aggregato per eseguirci un comando, o solleva `UserNotFoundError`.
 *
 * Gemella di `loadTodo`, e non una versione generica di entrambe: astrarla su
 * `AggregateRoot` costringerebbe a un tipo di repository comune e a un errore
 * "not found" comune, cioè a un contratto condiviso tra bounded context — la
 * stessa cosa che le porte separate evitano. Il duplicato qui sono sei righe;
 * l'accoppiamento durerebbe.
 *
 * Fa anche il `mergeObjectContext` di proposito: non è un dettaglio separabile
 * dal caricamento. `AggregateRoot.publishAll` di base è un metodo vuoto,
 * quindi un aggregato non mergiato scarta i suoi eventi al `commit()` senza
 * lanciare nulla — un bug silenzioso che si nota solo perché `api-query` non
 * si aggiorna. Tenendoli insieme, il merge non si può dimenticare.
 *
 * Funzione e non classe base degli handler: l'ereditarietà costringerebbe le
 * sottoclassi a non dichiarare un costruttore per non perdere i metadata
 * della DI, che è esattamente il tipo di fragilità descritto in CLAUDE.md.
 */
export async function loadUser(
  users: UserRepository,
  publisher: EventPublisher,
  userId: string,
): Promise<User> {
  const user = await users.findById(userId);

  if (user === null) {
    throw new UserNotFoundError(userId);
  }

  return publisher.mergeObjectContext(user);
}
