import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./users";

/**
 * Lo stato persistito dell'aggregato `Todo` del lato write.
 *
 * **La chiave esterna su `owner_id` è l'unico punto in cui i due bounded context
 * si toccano**, ed è deliberato: l'esistenza del proprietario non è un invariante
 * dell'aggregato (verificarla richiede di guardare fuori dal confine
 * transazionale), quindi il dominio la dichiara come contratto della porta di
 * persistenza — `TodoOwnerNotFoundError` — e la fa valere qui, dove la verifica è
 * atomica. Richiede `PRAGMA foreign_keys = ON`, che è per-connessione.
 *
 * Tre colonne meritano una nota, perché la scelta ovvia sarebbe sbagliata:
 *
 * - `tags` è `text` con dentro un JSON, **non** una colonna in `mode: 'json'`.
 *   Quel modo va accompagnato da `.$type<string[]>()`, che è un cast non
 *   verificato: una riga con `'[1,2]'` entrerebbe nell'aggregato dichiarando di
 *   essere `string[]` e mentendo. Il parse e la validazione stanno nel mapper.
 * - `tags` e `important` sono `notNull`. `snapshot()` restituisce sempre un array
 *   e `Todo.create` normalizza `important` a `false`, quindi una colonna nullable
 *   introdurrebbe una seconda rappresentazione dello stesso stato — NULL e `'[]'`
 *   per "nessun tag" — che è esattamente ciò che il dominio vieta.
 * - `description` invece è nullable, e va bene: nel dominio "assente" ha una sola
 *   rappresentazione (`undefined`), quindi la corrispondenza con NULL è biunivoca.
 *
 * `status` è `text` puro per la stessa ragione di `users.subscription`.
 */
export const todos = sqliteTable("todos", {
  todoId: text("todo_id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.userId),
  title: text("title").notNull(),
  status: text("status").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  description: text("description"),
  important: integer("important", { mode: "boolean" }).notNull().default(false),
  expiration: text("expiration"),
  tags: text("tags").notNull(),
  /**
   * Generazione della riga, per la concorrenza ottimistica del lato write.
   *
   * L'adapter scrive `UPDATE ... SET version = ? WHERE todo_id = ? AND version =
   * ?`: zero righe toccate significa che qualcun altro ha scritto nel frattempo,
   * e la scrittura si basava su uno stato che non esiste più.
   *
   * `default 1` non serve all'adapter, che la valorizza sempre: serve alle righe
   * che nascono altrove — una migrazione, una fixture, un import — perché non
   * partano da NULL o da 0, che il dominio non si aspetta.
   */
  version: integer("version").notNull().default(1),
});
