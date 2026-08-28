import { outbox } from "./outbox";
import { todosRead, usersRead } from "./read";
import { todos } from "./todos";
import { users } from "./users";

export { outbox } from "./outbox";
export { todosRead, usersRead } from "./read";
export { todos } from "./todos";
export { users } from "./users";

export type TodoRow = typeof todos.$inferSelect;
export type NewTodoRow = typeof todos.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;

/** Le righe del contratto di lettura: vedi `read.ts`. */
export type TodoReadRow = typeof todosRead.$inferSelect;
export type UserReadRow = typeof usersRead.$inferSelect;

/**
 * Lo schema completo, nella forma che `drizzle()` vuole per abilitare le
 * relational query (`db.query.todos.findMany()`). Il query builder normale non
 * ne ha bisogno: basta la tabella.
 */
export const schema = { outbox, todos, todosRead, users, usersRead };
