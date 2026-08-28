import { createSqliteClient, SqliteClient } from "../client";
import { runMigrations } from "../migrator";
import { todosRead, usersRead } from "./read";
import { todos } from "./todos";
import { users } from "./users";

/**
 * Il contratto di lettura, verificato dove vive.
 *
 * È l'unico posto che può provarlo: `api-command` non legge le view, e
 * `api-query` non ha ancora una riga di codice. Senza questi test le view
 * sarebbero due definizioni che nessuno esegue, e un errore nella migrazione si
 * scoprirebbe alla prima query del lato read.
 *
 * Verifica anche ciò che il contratto **non** espone. È la parte che si rompe in
 * silenzio: aggiungere una colonna al write model e ritrovarsela nella view non
 * darebbe nessun errore, e il reader comincerebbe a dipendere da un dettaglio
 * interno senza che nessuno l'abbia deciso.
 */
describe("il contratto di lettura", () => {
  let client: SqliteClient;

  beforeEach(() => {
    client = createSqliteClient({ url: ":memory:" });
    runMigrations(client.db);

    client.db
      .insert(users)
      .values({
        userId: "user-1",
        email: "mario.rossi@example.com",
        firstName: "Mario",
        lastName: "Rossi",
        subscription: "free",
        deleted: false,
      })
      .run();

    client.db
      .insert(todos)
      .values({
        todoId: "todo-1",
        ownerId: "user-1",
        title: "Comprare il latte",
        status: "todo",
        deleted: false,
        description: null,
        important: false,
        expiration: null,
        tags: "[]",
      })
      .run();
  });

  afterEach(() => {
    client.connection.close();
  });

  it("le view esistono: la migrazione le crea", () => {
    expect(client.db.select().from(todosRead).all()).toHaveLength(1);
    expect(client.db.select().from(usersRead).all()).toHaveLength(1);
  });

  it("espone del todo esattamente le colonne del contratto", () => {
    const [riga] = client.db.select().from(todosRead).all();

    expect(Object.keys(riga ?? {}).sort()).toStrictEqual([
      "deleted",
      "description",
      "expiration",
      "important",
      "ownerId",
      "status",
      "tags",
      "title",
      "todoId",
    ]);
  });

  it("espone dell utente esattamente le colonne del contratto", () => {
    const [riga] = client.db.select().from(usersRead).all();

    expect(Object.keys(riga ?? {}).sort()).toStrictEqual([
      "deleted",
      "email",
      "firstName",
      "lastName",
      "subscription",
      "userId",
    ]);
  });

  it("non espone la versione, che è meccanismo del lato write", () => {
    // Il caso che si romperebbe in silenzio: la colonna c'è nella tabella, e
    // basterebbe una view con `select *` per regalarla al lato read.
    expect(client.db.select().from(todosRead).all()[0]).not.toHaveProperty(
      "version",
    );
    expect(client.db.select().from(usersRead).all()[0]).not.toHaveProperty(
      "version",
    );
  });

  it("riflette le scritture del lato write: è una view, non una copia", () => {
    client.db.run("update todos set title = 'Comprare il pane'");

    expect(client.db.select().from(todosRead).all()[0]?.title).toBe(
      "Comprare il pane",
    );
  });

  it("non filtra i cancellati: la view è un contratto, non una policy", () => {
    // Decidere se un todo cancellato sia visibile è una domanda del lato read.
    // Nasconderlo qui gliela toglierebbe di mano senza che se ne accorga.
    client.db.run("update todos set deleted = 1");

    expect(client.db.select().from(todosRead).all()).toHaveLength(1);
  });
});
