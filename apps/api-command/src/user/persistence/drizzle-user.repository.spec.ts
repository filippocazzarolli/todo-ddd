import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { User } from '../domain/aggregates/user.aggregate';
import { UserRepository } from '../domain/ports/user.repository';
import { DrizzleUserRepository } from './drizzle-user.repository';
import { UserRowInvalidError } from './user.mapper';
import {
  createUserProps,
  describeUserRepositoryContract,
  USER_ID,
} from './user.repository.contract';

/**
 * L'adapter Drizzle contro la suite di contratto della porta, più il solo caso
 * che l'adapter in memoria non può avere: una riga che il dominio non sa
 * rappresentare.
 *
 * Il database è `:memory:`, nuovo a ogni test perché il modulo viene ricreato.
 */
describe('DrizzleUserRepository', () => {
  const originalUrl = process.env.DATABASE_URL;
  let moduleRef: TestingModule;
  let repository: DrizzleUserRepository;
  let connection: SqliteConnection;

  beforeEach(async () => {
    process.env.DATABASE_URL = ':memory:';

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [{ provide: UserRepository, useClass: DrizzleUserRepository }],
    }).compile();
    await moduleRef.init();

    repository = moduleRef.get<DrizzleUserRepository>(UserRepository);
    connection = moduleRef.get(SqliteConnection);
  });

  afterEach(async () => {
    await moduleRef.close();

    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  describeUserRepositoryContract(() => repository);

  describe('una riga che il dominio non sa rappresentare', () => {
    it('non passa per un valore valido', async () => {
      await repository.add(User.create(createUserProps()));
      // Scritto aggirando l'adapter, che non potrebbe produrlo: è il caso di
      // una migrazione o di una scrittura fatta a mano.
      connection.db.run(
        "update users set subscription = 'enterprise' where user_id = 'user-1'",
      );

      await expect(repository.findById(USER_ID)).rejects.toThrow(
        UserRowInvalidError,
      );
    });
  });
});
