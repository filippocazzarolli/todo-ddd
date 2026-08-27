import { TodoIdGenerator } from '../domain/ports/todo-id.generator';
import { UuidTodoIdGenerator } from './uuid-todo-id.generator';

/*
 * Le proprietà degli UUIDv7 (formato, timestamp, ordinamento, unicità) sono
 * testate in `shared/infrastructure/uuid-v7.spec.ts`, dove vive il meccanismo.
 * Qui si verifica solo che l'adapter sia un `TodoIdGenerator` e che deleghi.
 */
describe('UuidTodoIdGenerator', () => {
  const generator = new UuidTodoIdGenerator();

  it('è un TodoIdGenerator: la porta è il token DI', () => {
    expect(generator).toBeInstanceOf(TodoIdGenerator);
  });

  it('delega a uuidV7: restituisce un UUID canonico e sempre diverso', () => {
    const pattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(generator.next()).toMatch(pattern);
    expect(generator.next()).not.toBe(generator.next());
  });
});
