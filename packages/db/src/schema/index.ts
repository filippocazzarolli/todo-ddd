import { todos } from "./todos";
import { users } from "./users";

export { todos } from "./todos";
export { users } from "./users";

export type TodoRow = typeof todos.$inferSelect;
export type NewTodoRow = typeof todos.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Lo schema completo, nella forma che `drizzle()` vuole per abilitare le
 * relational query (`db.query.todos.findMany()`). Il query builder normale non
 * ne ha bisogno: basta la tabella.
 */
export const schema = { todos, users };
