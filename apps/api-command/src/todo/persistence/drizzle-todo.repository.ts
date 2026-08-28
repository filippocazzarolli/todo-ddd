import { Injectable } from '@nestjs/common';
import { todos } from '@repo/db';
import { and, eq } from 'drizzle-orm';

import { settle } from '../../shared/persistence/settle';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { Todo } from '../domain/aggregates/todo.aggregate';
import { TodoRepository } from '../domain/ports/todo.repository';
import {
  TodoAlreadyExistsError,
  TodoConcurrencyConflictError,
  TodoNoLongerExistsError,
  TodoOwnerNotFoundError,
} from '../domain/ports/todo.repository.errors';
import { toProps, toRow } from './todo.mapper';

/**
 * I codici di risultato estesi di SQLite, nella forma in cui `better-sqlite3` li
 * espone: la stringa di `SqliteError.code`, non il numero — il driver non
 * pubblica `errcode`, e il numero (787, 1555) appartiene ad altri binding.
 *
 * Si guarda il codice e non il messaggio: il testo è un dettaglio di
 * implementazione del driver, il codice è un contratto di SQLite.
 */
const SQLITE_CONSTRAINT_PRIMARYKEY = 'SQLITE_CONSTRAINT_PRIMARYKEY';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

/**
 * Adapter SQLite di `TodoRepository`, via Drizzle.
 *
 * Come `DrizzleUserRepository`, i metodi non sono `async`: `better-sqlite3` è un
 * driver sincrono, quindi non c'è niente da attendere e `require-await` boccerebbe
 * un `async` vuoto. La firma resta `Promise` perché è il contratto della porta.
 *
 * Differenza da `add` dell'adapter user, e non è un'incoerenza: là serve `ON
 * CONFLICT DO NOTHING` perché due vincoli di unicità possono essere violati
 * insieme e l'ordine con cui SQLite li riporta non è quello che vogliamo. Qui i
 * due fallimenti possibili — chiave primaria e chiave esterna — sono
 * distinguibili dal codice e non ambigui, quindi un `INSERT` normale con la
 * traduzione dell'errore basta ed è più diretto.
 */
@Injectable()
export class DrizzleTodoRepository extends TodoRepository {
  constructor(private readonly connection: SqliteConnection) {
    super();
  }

  findById(todoId: string): Promise<Todo | null> {
    return settle(() => {
      const [row] = this.connection.db
        .select()
        .from(todos)
        .where(eq(todos.todoId, todoId))
        .limit(1)
        .all();

      return row === undefined ? null : Todo.rehydrate(toProps(row));
    });
  }

  /**
   * **È qui che `TodoOwnerNotFoundError` viene sollevato per la prima volta.**
   * Il contratto era dichiarato in anticipo dalla porta e nessun adapter poteva
   * rispettarlo: `InMemoryTodoRepository` non vede gli utenti, quindi un todo
   * orfano era rappresentabile. Il vincolo di chiave esterna
   * (`todos.owner_id -> users.user_id`, con `PRAGMA foreign_keys = ON`) è
   * l'unico posto in cui la verifica è atomica, ed è per questo che il
   * fallimento appartiene alla persistenza e non all'aggregato.
   */
  add(todo: Todo): Promise<void> {
    const row = toRow(todo.snapshot());

    return settle(() => {
      try {
        this.connection.db.insert(todos).values(row).run();
      } catch (error) {
        throw translate(error, row.todoId, row.ownerId);
      }
    });
  }

  /**
   * Scrittura con **concorrenza ottimistica**: `WHERE todo_id = ? AND version =
   * ?`, e la riga avanza a `version + 1`.
   *
   * `changes === 0` non è più un segnale univoco. Prima significava soltanto
   * "riga assente", perché SQLite conta le righe *processate* e non quelle il
   * cui contenuto cambia — un UPDATE che riscrive gli stessi valori conta
   * comunque 1, a differenza di MySQL. Con la versione nel `WHERE` i casi
   * diventano due, e sono due esiti diversi per chi chiama: l'aggregato è
   * sparito (rinuncia) o è cambiato sotto le mani (ricarica e riprova). La
   * `SELECT` che li distingue sta **dentro la transazione**, come le due di
   * `add` nell'adapter user: fuori, la riga potrebbe sparire fra l'update a
   * vuoto e il controllo, e l'errore direbbe la cosa sbagliata.
   *
   * Resta l'avvertenza di sempre: nessun trigger su questa tabella, che
   * falserebbe `sqlite3_changes()`.
   *
   * Non traduce i vincoli: l'unico modificabile qui sarebbe la chiave esterna, e
   * `ownerId` non è aggiornabile (non compare in `UpdateTodoProps`).
   */
  update(todo: Todo): Promise<void> {
    const state = todo.snapshot();
    const row = toRow(state);

    return settle(() => {
      const failure = this.connection.db.transaction((tx) => {
        const { changes } = tx
          .update(todos)
          // `toRow` scrive la versione corrente, che qui è quella *attesa*: il
          // valore nuovo lo decide l'adapter, che è l'unico a sapere di stare
          // sovrascrivendo invece di inserire.
          .set({ ...row, version: state.version + 1 })
          .where(
            and(eq(todos.todoId, row.todoId), eq(todos.version, state.version)),
          )
          .run();

        if (changes > 0) {
          return null;
        }

        const [present] = tx
          .select({ todoId: todos.todoId })
          .from(todos)
          .where(eq(todos.todoId, row.todoId))
          .limit(1)
          .all();

        return present === undefined
          ? new TodoNoLongerExistsError(row.todoId)
          : new TodoConcurrencyConflictError(row.todoId, state.version);
      });

      if (failure !== null) {
        throw failure;
      }
    });
  }
}

/**
 * Traduce un errore del driver nel fallimento dichiarato dalla porta, o lo
 * lascia passare così com'è se non lo riconosce — un vincolo nuovo non deve
 * travestirsi da uno di quelli noti.
 */
function translate(error: unknown, todoId: string, ownerId: string): unknown {
  const code = resultCode(error);

  if (code === SQLITE_CONSTRAINT_FOREIGNKEY) {
    return new TodoOwnerNotFoundError(ownerId);
  }

  // `todos` non ha altri indici unici oltre alla chiave primaria, quindi anche
  // un generico CONSTRAINT_UNIQUE non può che essere l'id duplicato.
  if (
    code === SQLITE_CONSTRAINT_PRIMARYKEY ||
    code === SQLITE_CONSTRAINT_UNIQUE
  ) {
    return new TodoAlreadyExistsError(todoId);
  }

  return error;
}

/** Il codice esteso, se l'errore è un `SqliteError`. */
function resultCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return undefined;
}
