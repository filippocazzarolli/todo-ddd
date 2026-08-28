import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { schema } from "./schema";
import { databaseUrl } from "./paths";

const IN_MEMORY = ":memory:";

export interface SqliteClientOptions {
  /** Il path del file, o `:memory:`. Default: `DATABASE_URL` o quello di sviluppo. */
  url?: string;
  /**
   * Apre la connessione in sola lettura. È il modo in cui il lato read
   * partecipa al file condiviso: il privilegio di scrittura resta di
   * `api-command`, e non per convenzione ma per rifiuto del driver.
   */
  readOnly?: boolean;
}

/**
 * Il tipo di ritorno e' dichiarato invece che inferito, e non per stile: con
 * `declaration: true` un tipo di ritorno inferito che nomina
 * `BetterSqlite3.Database` fa fallire l'emissione dei `.d.ts` con TS4058
 * ("cannot be named"), perche' quel tipo vive in un percorso dello store pnpm che
 * non e' raggiungibile con un import stabile. Importarlo qui lo rende nominabile.
 */
export interface SqliteClient {
  /** La connessione grezza: serve a chi deve chiuderla e a leggere i pragma. */
  connection: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

/**
 * Apre il database e applica i pragma. Restituisce il `db` di Drizzle insieme
 * alla connessione grezza, che serve a chi deve chiuderla.
 *
 * I pragma non sono interscambiabili fra i due ruoli:
 *
 * - `journal_mode = WAL` lo imposta **solo** chi scrive, e una volta sola: è
 *   persistente nell'header del file, non una proprietà della connessione. Su una
 *   connessione readonly il tentativo è un no-op. Serve perché due processi
 *   leggano e scrivano lo stesso file senza bloccarsi a vicenda.
 * - `foreign_keys` invece **è** per-connessione, ed è spento per default in
 *   SQLite. Va acceso qui, all'apertura, perché dentro una transazione non ha
 *   effetto — e senza di lui la chiave esterna su `todos.owner_id` è decorativa.
 * - `busy_timeout` vale per entrambi: senza, due processi concorrenti prendono
 *   `SQLITE_BUSY` invece di aspettare il loro turno.
 * - `query_only` sul reader è una seconda rete oltre a `readonly`, a livello di
 *   connessione anziché di file descriptor.
 *
 * Nota per chi legge i test: su `:memory:` il journal mode resta `memory` e il
 * `PRAGMA` non fallisce, quindi la suite **non** esercita il WAL di produzione.
 */
export function createSqliteClient(
  options: SqliteClientOptions = {},
): SqliteClient {
  const url = options.url ?? databaseUrl();
  const readOnly = options.readOnly ?? false;

  if (!readOnly && url !== IN_MEMORY) {
    // `data/` è gitignored, quindi su un clone pulito non esiste, e
    // better-sqlite3 non crea directory: senza questo il primo avvio muore con
    // SQLITE_CANTOPEN.
    mkdirSync(dirname(url), { recursive: true });
  }

  const connection = new Database(url, {
    readonly: readOnly,
    fileMustExist: readOnly,
  });

  connection.pragma("busy_timeout = 5000");

  if (readOnly) {
    connection.pragma("query_only = ON");
  } else {
    connection.pragma("journal_mode = WAL");
    connection.pragma("synchronous = NORMAL");
    connection.pragma("foreign_keys = ON");
  }

  return { connection, db: drizzle({ client: connection, schema }) };
}
