import { Todo } from '../domain/aggregates/todo.aggregate';
import { InMemoryTodoRepository } from './in-memory-todo.repository';
import {
  createTodoProps,
  describeTodoRepositoryContract,
  TODO_ID,
} from './todo.repository.contract';

/**
 * L'adapter in memoria contro la suite di contratto della porta, più i due casi
 * che solo lui può avere.
 *
 * Non vede gli utenti, quindi `seedOwner` non ha niente da fare: per questo
 * adapter `ownerId` è un campo come gli altri, e la chiave esterna che lo
 * rende un riferimento vero appartiene alla spec dell'adapter Drizzle.
 */
describe('InMemoryTodoRepository', () => {
  let repository: InMemoryTodoRepository;

  beforeEach(() => {
    repository = new InMemoryTodoRepository();
  });

  describeTodoRepositoryContract(() => ({
    repository,
    seedOwner: () => Promise.resolve(),
  }));

  /*
   * Fuori dal contratto perché non è una regola della porta ma di questa
   * implementazione: due adapter Drizzle costruiti sulla stessa connessione
   * vedono invece gli stessi dati, ed è giusto così.
   */
  describe('l’isolamento fra istanze', () => {
    it('non condivide stato tra istanze diverse', async () => {
      await repository.add(Todo.create(createTodoProps()));

      const altro = new InMemoryTodoRepository();

      await expect(altro.findById(TODO_ID)).resolves.toBeNull();
    });

    it('accetta lo stesso id su un’altra istanza del repository', async () => {
      await repository.add(Todo.create(createTodoProps()));

      const altro = new InMemoryTodoRepository();

      await expect(
        altro.add(Todo.create(createTodoProps())),
      ).resolves.toBeUndefined();
    });
  });
});
