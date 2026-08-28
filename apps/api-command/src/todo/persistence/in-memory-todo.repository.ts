import { Injectable } from '@nestjs/common';

import { Todo, TodoProps } from '../domain/aggregates/todo.aggregate';
import {
  TodoAlreadyExistsError,
  TodoNoLongerExistsError,
} from '../domain/ports/todo.repository.errors';
import { TodoRepository } from '../domain/ports/todo.repository';

/**
 * Implementazione in memoria di `TodoRepository`: il **test double** degli
 * handler spec, non l'adapter dell'applicazione — quello è
 * `DrizzleTodoRepository`. Resta perché negli handler spec un database vero
 * sarebbe I/O senza guadagno: là si verifica l'orchestrazione, non lo storage.
 *
 * Non vede gli utenti, quindi non può sollevare `TodoOwnerNotFoundError` e per
 * lui un todo orfano è rappresentabile. È l'unica divergenza dall'adapter vero,
 * ed è anche perché le due spec restano separate.
 *
 * Conserva lo **stato** (`snapshot()`) e non le istanze di `Todo`: tenere in
 * mappa l'aggregato lo renderebbe condiviso e mutabile, così una modifica non
 * salvata sarebbe già visibile a tutti e i test passerebbero su un
 * comportamento che nessun database avrà mai. `snapshot()` in ingresso e
 * `rehydrate()` in uscita sono entrambi copie: nessun aliasing in nessuna
 * delle due direzioni.
 *
 * `Map.has` sta al posto del vincolo di chiave primaria e del conteggio delle
 * righe toccate: sono i due controlli che rendono `add` e `update` distinti, e
 * un adapter che li omettesse tornerebbe a essere un upsert.
 *
 * I metodi restituiscono `Promise` pur essendo sincroni, perché la firma è
 * quella della porta. Per questo gli errori escono da `Promise.reject` e non da
 * `throw`, e `async` non è un'opzione: senza `await` nel corpo, `require-await`
 * fa fallire il lint. `DrizzleTodoRepository` ha la stessa forma per la stessa
 * ragione — `better-sqlite3` è un driver sincrono, quindi nemmeno lì c'è
 * qualcosa da attendere (là la conversione passa da `settle`).
 */
@Injectable()
export class InMemoryTodoRepository extends TodoRepository {
  private readonly states = new Map<string, Readonly<TodoProps>>();

  findById(todoId: string): Promise<Todo | null> {
    const state = this.states.get(todoId);

    return Promise.resolve(state === undefined ? null : Todo.rehydrate(state));
  }

  add(todo: Todo): Promise<void> {
    if (this.states.has(todo.todoId)) {
      return Promise.reject(new TodoAlreadyExistsError(todo.todoId));
    }

    this.states.set(todo.todoId, todo.snapshot());

    return Promise.resolve();
  }

  update(todo: Todo): Promise<void> {
    if (!this.states.has(todo.todoId)) {
      return Promise.reject(new TodoNoLongerExistsError(todo.todoId));
    }

    this.states.set(todo.todoId, todo.snapshot());

    return Promise.resolve();
  }
}
