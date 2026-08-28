import { defineConfig } from "drizzle-kit";

import { databaseUrl } from "./src/paths";

/**
 * Le migrazioni stanno accanto allo schema, dentro questo package: drizzle-kit
 * le tiene in sync tramite lo snapshot in `migrations/meta/`, e `drizzle-kit
 * check` verifica quella coerenza. Separarle dallo schema significherebbe due
 * cartelle in due posti che devono muoversi insieme.
 *
 * Il path del database arriva da `src/paths`, che è l'unico punto di verità:
 * drizzle-kit legge questo file con esbuild-register, quindi importare un modulo
 * TypeScript qui è lecito — ma solo perché `paths.ts` non tira dentro il driver
 * nativo.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: databaseUrl() },
});
