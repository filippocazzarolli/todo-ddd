import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Lo stato persistito dell'aggregato `User` del lato write.
 *
 * `email` porta un `UNIQUE` pieno e non parziale: un utente cancellato continua
 * a occupare la sua email. È la stessa scelta che `InMemoryUserRepository`
 * simulava con il suo secondo indice, resa qui esplicita — la cancellazione è
 * logica (`deleted`), e liberare l'email significherebbe permettere a un secondo
 * utente di nascere con l'identità di uno cancellato.
 *
 * `subscription` è `text` puro e non un enum tipizzato: `.$type<UserSubscription>()`
 * costringerebbe questo package a importare il dominio di `api-command`, che è la
 * direzione vietata. Il narrowing sull'insieme dei valori ammessi vive nel mapper,
 * accanto alla tupla runtime che il dominio già possiede.
 */
export const users = sqliteTable("users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  subscription: text("subscription").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  /**
   * Generazione della riga, per la concorrenza ottimistica del lato write.
   * Stessa colonna e stessa ragione di `todos.version`, documentata lì.
   */
  version: integer("version").notNull().default(1),
});
