import { Injectable } from '@nestjs/common';

import { User, UserProps } from '../domain/aggregates/user.aggregate';
import { UserRepository } from '../domain/ports/user.repository';
import {
  UserAlreadyExistsError,
  UserEmailAlreadyTakenError,
  UserNoLongerExistsError,
} from '../domain/ports/user.repository.errors';

/**
 * Implementazione in memoria di `UserRepository`: il **test double** degli
 * handler spec, non l'adapter dell'applicazione — quello è
 * `DrizzleUserRepository`. Resta perché negli handler spec un database vero
 * sarebbe I/O senza guadagno: là si verifica l'orchestrazione, non lo storage.
 *
 * Conserva lo **stato** (`snapshot()`) e non le istanze di `User`: tenere in
 * mappa l'aggregato lo renderebbe condiviso e mutabile, così una modifica non
 * salvata sarebbe già visibile a tutti e i test passerebbero su un
 * comportamento che nessun database avrà mai. `snapshot()` in ingresso e
 * `rehydrate()` in uscita sono entrambi copie: nessun aliasing in nessuna
 * delle due direzioni.
 *
 * Le due `Map` stanno al posto di due vincoli dello schema: `states` è la
 * chiave primaria, `emails` è `UNIQUE (email)`. Sono i controlli che rendono
 * `add` e `update` distinti, e un adapter che li omettesse tornerebbe a essere
 * un upsert.
 *
 * Un utente cancellato **continua a occupare la sua email**: la sua riga
 * esiste ancora, e il vincolo vale. È la conseguenza diretta della
 * cancellazione logica, ed è anche la decisione presa nello schema vero
 * (`UNIQUE (email)` pieno): i due adapter concordano.
 *
 * I metodi restituiscono `Promise` pur essendo sincroni, perché la firma è
 * quella della porta. Per questo gli errori escono da `Promise.reject` e non da
 * `throw`, e `async` non è un'opzione: senza `await` nel corpo, `require-await`
 * fa fallire il lint. `DrizzleUserRepository` ha la stessa forma per la stessa
 * ragione — `better-sqlite3` è un driver sincrono, quindi nemmeno lì c'è
 * qualcosa da attendere.
 */
@Injectable()
export class InMemoryUserRepository extends UserRepository {
  private readonly states = new Map<string, Readonly<UserProps>>();

  /** Sta al posto di `UNIQUE (email)`: email normalizzata -> userId. */
  private readonly emails = new Map<string, string>();

  findById(userId: string): Promise<User | null> {
    const state = this.states.get(userId);

    return Promise.resolve(state === undefined ? null : User.rehydrate(state));
  }

  add(user: User): Promise<void> {
    if (this.states.has(user.userId)) {
      return Promise.reject(new UserAlreadyExistsError(user.userId));
    }

    /*
     * La chiave dell'indice è l'email *normalizzata*, quella che esce dal Value
     * Object: se lo fosse la stringa grezza, `Mario@x.it` e `mario@x.it`
     * sarebbero due chiavi diverse e il vincolo non varrebbe niente. È lo
     * stesso motivo per cui `Email` normalizza anche la parte locale.
     */
    const email = user.email.toString();

    if (this.emails.has(email)) {
      return Promise.reject(new UserEmailAlreadyTakenError(email));
    }

    this.states.set(user.userId, user.snapshot());
    this.emails.set(email, user.userId);

    return Promise.resolve();
  }

  /**
   * Non tocca l'indice delle email, e oggi è corretto: l'email non è
   * modificabile (`UpdateUserProps` non la contiene), quindi la voce
   * dell'indice resta valida per definizione. Quando arriverà `changeEmail`,
   * questo metodo dovrà spostarla — e potrà fallire con
   * `UserEmailAlreadyTakenError` come fa `add`.
   */
  update(user: User): Promise<void> {
    if (!this.states.has(user.userId)) {
      return Promise.reject(new UserNoLongerExistsError(user.userId));
    }

    this.states.set(user.userId, user.snapshot());

    return Promise.resolve();
  }
}
