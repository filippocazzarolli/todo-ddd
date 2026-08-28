import { Injectable } from '@nestjs/common';
import { users } from '@repo/db';
import { and, eq } from 'drizzle-orm';

import { settle } from '../../shared/persistence/settle';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { User } from '../domain/aggregates/user.aggregate';
import { UserRepository } from '../domain/ports/user.repository';
import {
  UserAlreadyExistsError,
  UserConcurrencyConflictError,
  UserEmailAlreadyTakenError,
  UserNoLongerExistsError,
  UserPersistenceError,
} from '../domain/ports/user.repository.errors';
import { toProps, toRow } from './user.mapper';

/**
 * Adapter SQLite di `UserRepository`, via Drizzle.
 *
 * Conserva lo **stato** e non le istanze, come faceva l'adapter in memoria — ma
 * qui è il database a imporlo, non una scelta: `toRow(snapshot())` in ingresso e
 * `rehydrate(toProps(row))` in uscita sono due copie per costruzione.
 *
 * **I metodi non sono `async`, e non è una dimenticanza.** `better-sqlite3` è un
 * driver sincrono, e `db.transaction()` di Drizzle su un driver sincrono
 * restituisce un valore, non una promise: dentro `add` non c'è niente da
 * attendere, quindi un `async` senza `await` farebbe fallire il lint per
 * `require-await`, e un `await` messo lì per soddisfarlo farebbe scattare
 * `await-thenable`. Da qui la stessa forma di `InMemoryUserRepository`: firma
 * `Promise`, esiti da `Promise.resolve` / `Promise.reject`. La firma resta
 * asincrona perché è il contratto della porta, e un driver diverso — o una
 * connessione remota — la userebbe davvero.
 *
 * Gli errori inattesi (connessione chiusa, riga corrotta) passano da `settle`,
 * che li consegna come promise rifiutata invece di lasciarli propagare in modo
 * sincrono: chi chiama vede un solo modo di fallire.
 */
@Injectable()
export class DrizzleUserRepository extends UserRepository {
  constructor(private readonly connection: SqliteConnection) {
    super();
  }

  findById(userId: string): Promise<User | null> {
    return settle(() => {
      const [row] = this.connection.db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1)
        .all();

      // `noUncheckedIndexedAccess` rende l'accesso `UserRow | undefined`: il
      // narrowing è obbligato, e qui è anche la distinzione fra "non c'è" e
      // "c'è" — cioè fra `null` e l'aggregato.
      return row === undefined ? null : User.rehydrate(toProps(row));
    });
  }

  /**
   * Un solo `INSERT ... ON CONFLICT DO NOTHING`, e la disambiguazione solo se
   * serve.
   *
   * Il motivo è che SQLite riporta **un** vincolo violato, e quale dipende
   * dall'ordine di dichiarazione delle colonne: con `user_id` prima di `email`,
   * un insert che collide su entrambi riporta l'email. `InMemoryUserRepository`
   * controlla invece l'id prima dell'email, quindi affidarsi al codice d'errore
   * darebbe due adapter della stessa porta con esiti diversi sullo stesso input.
   * `DO NOTHING` non solleva niente e lascia `changes = 0` per entrambi i casi,
   * così l'ordine lo decidiamo noi e resta quello dell'altro adapter.
   *
   * Le due `SELECT` stanno **dentro la transazione**, e questo è ciò che le
   * distingue dal controllo preventivo che `user.repository.errors.ts` dichiara
   * inaccettabile: lì `SELECT` e `INSERT` sono due operazioni con una finestra
   * in mezzo, qui l'insert è già avvenuto e SQLite tiene il write lock.
   */
  add(user: User): Promise<void> {
    const row = toRow(user.snapshot());

    return settle(() => {
      const conflict = this.connection.db.transaction((tx) => {
        const inserted = tx
          .insert(users)
          .values(row)
          .onConflictDoNothing()
          .run();

        if (inserted.changes > 0) {
          return null;
        }

        const [byId] = tx
          .select({ userId: users.userId })
          .from(users)
          .where(eq(users.userId, row.userId))
          .limit(1)
          .all();

        if (byId !== undefined) {
          return new UserAlreadyExistsError(row.userId);
        }

        const [byEmail] = tx
          .select({ userId: users.userId })
          .from(users)
          .where(eq(users.email, row.email))
          .limit(1)
          .all();

        if (byEmail !== undefined) {
          return new UserEmailAlreadyTakenError(row.email);
        }

        // Nessuno dei due vincoli noti: lo schema ne ha acquisito uno terzo e
        // questo metodo non lo sa ancora. Meglio un errore esplicito che un
        // successo silenzioso su una riga mai scritta.
        return new UserPersistenceError(
          `Inserimento dell'utente ${row.userId} rifiutato da un vincolo non riconosciuto`,
        );
      });

      if (conflict !== null) {
        throw conflict;
      }
    });
  }

  /**
   * Scrittura con **concorrenza ottimistica**: `WHERE user_id = ? AND version =
   * ?`, e la riga avanza a `version + 1`.
   *
   * `changes === 0` non è più un segnale univoco. Prima significava soltanto
   * "riga assente", perché SQLite conta le righe *processate* e non quelle il
   * cui contenuto cambia — un UPDATE che riscrive gli stessi valori conta
   * comunque 1, a differenza di MySQL. Con la versione nel `WHERE` i casi
   * diventano due, e la `SELECT` che li distingue sta dentro la transazione per
   * la stessa ragione delle due di `add`: fuori, la riga potrebbe sparire fra
   * l'update a vuoto e il controllo.
   *
   * Resta l'avvertenza di sempre: nessun trigger su questa tabella, che
   * falserebbe `sqlite3_changes()`.
   *
   * Non tocca l'email, che non è modificabile: quando arriverà `changeEmail`
   * questo metodo erediterà anche `UserEmailAlreadyTakenError`, come `add`.
   */
  update(user: User): Promise<void> {
    const state = user.snapshot();
    const row = toRow(state);

    return settle(() => {
      const failure = this.connection.db.transaction((tx) => {
        const { changes } = tx
          .update(users)
          .set({ ...row, version: state.version + 1 })
          .where(
            and(eq(users.userId, row.userId), eq(users.version, state.version)),
          )
          .run();

        if (changes > 0) {
          return null;
        }

        const [present] = tx
          .select({ userId: users.userId })
          .from(users)
          .where(eq(users.userId, row.userId))
          .limit(1)
          .all();

        return present === undefined
          ? new UserNoLongerExistsError(row.userId)
          : new UserConcurrencyConflictError(row.userId, state.version);
      });

      if (failure !== null) {
        throw failure;
      }
    });
  }
}
