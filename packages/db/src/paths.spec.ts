import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { DEFAULT_DATABASE_PATH, MIGRATIONS_FOLDER, databaseUrl } from "./paths";

/**
 * Questi test non verificano una logica: verificano che il conteggio dei `..` in
 * `paths.ts` sia ancora giusto. È l'unico modo di far fallire un `pnpm test`
 * invece di scoprire a runtime che il DB è stato creato nel posto sbagliato.
 */
describe("paths", () => {
  describe("DEFAULT_DATABASE_PATH", () => {
    it("punta a una cartella `data` nella radice del monorepo", () => {
      const dataFolder = dirname(DEFAULT_DATABASE_PATH);

      expect(basename(DEFAULT_DATABASE_PATH)).toBe("todo.sqlite");
      expect(basename(dataFolder)).toBe("data");
      // La radice è riconoscibile da qui: se il package si spostasse, il numero
      // di livelli risaliti cambierebbe e questo file non ci sarebbe più.
      expect(existsSync(join(dirname(dataFolder), "pnpm-workspace.yaml"))).toBe(
        true,
      );
    });

    it("sta fuori da `packages/`, perché non è codice", () => {
      expect(DEFAULT_DATABASE_PATH).not.toContain("packages");
    });
  });

  describe("MIGRATIONS_FOLDER", () => {
    it("punta alla cartella delle migrazioni di questo package", () => {
      expect(existsSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"))).toBe(
        true,
      );
    });
  });

  describe("databaseUrl", () => {
    const original = process.env.DATABASE_URL;

    afterEach(() => {
      if (original === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original;
      }
    });

    it("usa il default quando DATABASE_URL non è impostata", () => {
      delete process.env.DATABASE_URL;

      expect(databaseUrl()).toBe(DEFAULT_DATABASE_PATH);
    });

    it("lascia vincere DATABASE_URL", () => {
      process.env.DATABASE_URL = ":memory:";

      expect(databaseUrl()).toBe(":memory:");
    });
  });
});
