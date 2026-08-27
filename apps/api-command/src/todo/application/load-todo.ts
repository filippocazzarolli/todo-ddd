import { EventPublisher } from '@nestjs/cqrs';

import { Todo } from '../domain/aggregates/todo.aggregate';
import { TodoRepository } from '../domain/ports/todo.repository';
import { TodoNotFoundError } from './errors/todo-not-found.error';

/**
 * Carica un aggregato per eseguirci un comando, o solleva `TodoNotFoundError`.
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
): Promise<Todo> {
  const todo = await todos.findById(todoId);

  if (todo === null) {
    throw new TodoNotFoundError(todoId);
  }

  return publisher.mergeObjectContext(todo);
}
