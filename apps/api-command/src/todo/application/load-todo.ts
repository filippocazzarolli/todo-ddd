import { EventPublisher } from '@nestjs/cqrs';

import { Todo } from '../domain/aggregates/todo.aggregate';
import { TodoRepository } from '../domain/ports/todo.repository';
import { TodoNotFoundError } from './errors/todo-not-found.error';

/**
 * Carica un aggregato per eseguirci un comando, dopo aver verificato che
 * l'attore ne sia il proprietario.
 *
 * Solleva `TodoNotFoundError` se non esiste e `TodoNotOwnedError` se esiste ma
 * è di qualcun altro. In quest'ordine, che è anche l'ordine dei controlli: la
 * regola di accesso vive nell'aggregato (`ensureOwnedBy`), ma è invocata qui,
 * nell'unico punto da cui passa ogni comando che carica un todo. Un controllo
 * di autorizzazione dimenticato in un handler non lancia niente e non rompe
 * nessun test: si nota quando è tardi. Tenendolo qui, non si può dimenticare —
 * esattamente il ragionamento del `mergeObjectContext` qui sotto.
 *
 * `create` non passa da qui e non ne ha bisogno: un todo che nasce ha per
 * proprietario l'attore che lo crea, per costruzione.
 *
 * Fa anche il `mergeObjectContext` di proposito: non è un dettaglio separabile
 * dal caricamento. `AggregateRoot.publishAll` di base è un metodo vuoto,
 * quindi un aggregato non mergiato scarta i suoi eventi al `commit()` senza
 * lanciare nulla — un bug silenzioso che si nota solo perché `api-query` non
 * si aggiorna. Tenendoli insieme, il merge non si può dimenticare.
 *
 * Funzione e non classe base degli handler: l'ereditarietà costringerebbe le
 * sottoclassi a non dichiarare un costruttore per non perdere i metadata
 * della DI, che è esattamente il tipo di fragilità descritto in CLAUDE.md.
 */
export async function loadTodo(
  todos: TodoRepository,
  publisher: EventPublisher,
  todoId: string,
  actorId: string,
): Promise<Todo> {
  const todo = await todos.findById(todoId);

  if (todo === null) {
    throw new TodoNotFoundError(todoId);
  }

  todo.ensureOwnedBy(actorId);

  return publisher.mergeObjectContext(todo);
}
