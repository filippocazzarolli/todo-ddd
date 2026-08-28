import { sqliteView } from "drizzle-orm/sqlite-core";

import { todos } from "./todos";
import { users } from "./users";

/**
 * Il **contratto di lettura** verso `api-query`.
 *
 * Serve perché questo package è di fatto uno _Shared Kernel_ fra tre
 * consumatori: i due bounded context del lato write e il lato read. Senza un
 * confine dichiarato, ogni query del reader nascerebbe legata alle colonne
 * fisiche del write model, e rinominarne una diventerebbe un breaking change
 * per un'app che non ha voce in capitolo su quel nome.
 *
 * Le view assorbono quel cambio: rinominare `todos.title` significa aggiornare
 * una riga qui, non ogni query dall'altra parte.
 *
 * **Non risolvono il problema di fondo**, e vale la pena dirlo invece di
 * lasciarlo intendere: leggere lo stato del write model non è un read model. Un
 * read model vero sono tabelle di proiezione alimentate dagli eventi, e richiede
 * il relay che oggi non legge l'outbox. Le view sono il confine più economico
 * che si possa mettere nel frattempo, e il giorno in cui le proiezioni
 * esisteranno spariranno insieme a questa dipendenza.
 *
 * Cosa resta **fuori** dal contratto, e non per dimenticanza:
 *
 * - `version`, che è il meccanismo di concorrenza ottimistica del lato write:
 *   al reader non serve, e vederla lo inviterebbe a costruirci sopra qualcosa;
 * - `outbox`, che è macchinario interno del lato write. Il giorno in cui il
 *   reader dovrà consumarla lo farà da un bus, non da una `SELECT`.
 */
export const todosRead = sqliteView("todos_read").as((qb) =>
  qb
    .select({
      todoId: todos.todoId,
      ownerId: todos.ownerId,
      title: todos.title,
      status: todos.status,
      deleted: todos.deleted,
      description: todos.description,
      important: todos.important,
      expiration: todos.expiration,
      tags: todos.tags,
    })
    .from(todos),
);

/**
 * Il contratto di lettura degli utenti. Nessun filtro sui cancellati: la view è
 * un contratto, non una policy — decidere se un utente cancellato sia visibile è
 * una domanda del lato read, e nasconderlo qui gliela toglierebbe di mano senza
 * che se ne accorga.
 */
export const usersRead = sqliteView("users_read").as((qb) =>
  qb
    .select({
      userId: users.userId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      subscription: users.subscription,
      deleted: users.deleted,
    })
    .from(users),
);
