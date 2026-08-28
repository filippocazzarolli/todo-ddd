import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { MIGRATIONS_FOLDER } from "./paths";
import type { SqliteClient } from "./client";

/**
 * Applica le migrazioni pendenti. Idempotente: drizzle tiene il registro di
 * quelle già applicate in una tabella propria, quindi chiamarla a ogni avvio
 * costa una query.
 */
export function runMigrations(db: SqliteClient["db"]): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
