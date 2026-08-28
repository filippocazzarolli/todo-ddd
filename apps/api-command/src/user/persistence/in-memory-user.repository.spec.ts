import { InMemoryUserRepository } from './in-memory-user.repository';
import { describeUserRepositoryContract } from './user.repository.contract';

/**
 * L'adapter in memoria contro la suite di contratto della porta.
 *
 * Non ha nessun caso proprio: a differenza dell'adapter todo, dove l'isolamento
 * fra istanze è una regola di questa implementazione e non della porta, qui
 * tutto ciò che c'era da verificare è contratto. Una spec di tre righe non è un
 * segno che manchino test — sono ventitré, e girano anche sull'altro adapter.
 */
describe('InMemoryUserRepository', () => {
  let repository: InMemoryUserRepository;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
  });

  describeUserRepositoryContract(() => repository);
});
