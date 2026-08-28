import { Injectable } from '@nestjs/common';
import { todos } from '@repo/db';
import { eq } from 'drizzle-orm';

import { settle } from '../../shared/persistence/settle';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { Todo } from '../domain/aggregates/todo.aggregate';
import { TodoRepository } from '../domain/ports/todo.repository';
import {
  TodoAlreadyExistsError,
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
   * `changes === 0` significa "riga assente" e non "nessun valore cambiato":
   * SQLite conta le righe *processate*. Vale l'avvertenza dell'adapter user —
   * nessun trigger su questa tabella, che falserebbe `sqlite3_changes()`.
   *
   * Non traduce i vincoli: l'unico modificabile qui sarebbe la chiave esterna, e
   * `ownerId` non è aggiornabile (non compare in `UpdateTodoProps`).
   */
  update(todo: Todo): Promise<void> {
    const row = toRow(todo.snapshot());

    return settle(() => {
      const { changes } = this.connection.db
        .update(todos)
        .set(row)
        .where(eq(todos.todoId, row.todoId))
        .run();

      if (changes === 0) {
        throw new TodoNoLongerExistsError(row.todoId);
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
