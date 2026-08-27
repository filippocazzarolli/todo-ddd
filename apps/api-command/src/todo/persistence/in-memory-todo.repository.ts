import { Injectable } from '@nestjs/common';

import { Todo, TodoProps } from '../domain/aggregates/todo.aggregate';
import {
  TodoAlreadyExistsError,
  TodoNoLongerExistsError,
} from '../domain/ports/todo.repository.errors';
import { TodoRepository } from '../domain/ports/todo.repository';

/**
 * Implementazione in memoria di `TodoRepository`, in attesa del DB.
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
 * I metodi restituiscono `Promise` pur essendo sincroni, per non cambiare la
 * firma quando arriverà la persistenza vera. Per questo gli errori escono da
 * `Promise.reject` e non da `throw`: in un metodo non `async` un `throw`
 * sarebbe sincrono, e il chiamante che fa `await` non lo vedrebbe come una
 * promise rifiutata. `async` non è un'opzione — senza `await` nel corpo,
 * `require-await` fa fallire il lint.
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
