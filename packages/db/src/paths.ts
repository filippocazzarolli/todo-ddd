import { join, resolve } from "node:path";

/**
 * I due percorsi che il resto del package non deve ricalcolare.
 *
 * `src/` e `dist/` sono allo stesso livello, quindi la risalita a `REPO_ROOT`
 * conta lo stesso numero di livelli in entrambi i casi: vale sia quando questo
 * file gira compilato (`dist/paths.js`, a runtime nelle app) sia quando
 * drizzle-kit lo transpila dal sorgente con esbuild-register (`src/paths.ts`,
 * per `db:generate`). È la ragione per cui questo file non importa
 * `better-sqlite3`: deve poter essere caricato da entrambi i mondi.
 *
 * Il conteggio dei `..` è l'unica cosa fragile del layout, e si romperebbe in
 * silenzio se il package si spostasse: `paths.spec.ts` lo verifica.
 */
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/**
 * Il file di database di sviluppo. Sta fuori dai package e non dentro
 * `packages/db/`: è dato mutabile e non codice, è condiviso fra il lato write e
 * il lato read (quindi non appartiene a nessuno dei due), e nessuna pulizia di
 * build lo può raggiungere. `DATABASE_URL` lo sovrascrive, ed è quello che farà
 * la produzione, dove il path è un volume montato.
 */
export const DEFAULT_DATABASE_PATH = join(REPO_ROOT, "data", "todo.sqlite");

/**
 * Risolta da `__dirname` e mai dalla cwd, che è diversa in ognuno dei tre modi
 * in cui questo codice viene eseguito: i test unitari girano con `rootDir: src`,
 * gli e2e con `rootDir: .`, la produzione da `dist`. Un path relativo
 * funzionerebbe in uno dei tre.
 */
export const MIGRATIONS_FOLDER = join(__dirname, "..", "migrations");

/** Il path effettivo: la variabile d'ambiente vince sul default di sviluppo. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_PATH;
}
