import { createSqliteClient } from "./client";
import { runMigrations } from "./migrator";
import { databaseUrl } from "./paths";

/**
 * Entry point di `pnpm db:migrate`. Esiste come script separato invece di
 * affidarsi a `drizzle-kit migrate` perché applica le migrazioni **con gli stessi
 * pragma** che usa l'applicazione: un `drizzle-kit migrate` apre una connessione
 * propria, senza `foreign_keys`.
 */
const url = databaseUrl();
const { connection, db } = createSqliteClient({ url });

try {
  runMigrations(db);
  console.log(`Migrazioni applicate su ${url}`);
} finally {
  connection.close();
}
