import { UserIdGenerator } from '../domain/ports/user-id.generator';
import { UuidUserIdGenerator } from './uuid-user-id.generator';

/*
 * Le proprietà degli UUIDv7 (formato, timestamp, ordinamento, unicità) sono
 * testate in `shared/infrastructure/uuid-v7.spec.ts`, dove vive il meccanismo.
 * Qui si verifica solo che l'adapter sia un `UserIdGenerator` e che deleghi.
 */
describe('UuidUserIdGenerator', () => {
  const generator = new UuidUserIdGenerator();

  it('è un UserIdGenerator: la porta è il token DI', () => {
    expect(generator).toBeInstanceOf(UserIdGenerator);
  });

  it('delega a uuidV7: restituisce un UUID canonico e sempre diverso', () => {
    const pattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(generator.next()).toMatch(pattern);
    expect(generator.next()).not.toBe(generator.next());
  });
});
