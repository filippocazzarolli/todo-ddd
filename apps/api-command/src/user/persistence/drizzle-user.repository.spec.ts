import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { User } from '../domain/aggregates/user.aggregate';
import { UserEmailInvalidError } from '../domain/errors/user.errors';
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

    it('non accetta un’email che il dominio rifiuta', async () => {
      /*
       * Il caso in cui a rifiutare è un Value Object e non il mapper.
       * `Email.create` solleva un `UserEmailInvalidError`, che è un errore di
       * *dominio*: lasciandolo passare, il filtro darebbe 400 e la colpa a chi
       * ha solo chiesto di leggere.
       */
      await repository.add(User.create(createUserProps()));
      connection.db.run(
        "update users set email = 'non una email' where user_id = 'user-1'",
      );

      await expect(repository.findById(USER_ID)).rejects.toThrow(
        UserRowInvalidError,
      );
    });

    it('conserva l’errore di dominio come `cause`, per chi legge i log', async () => {
      await repository.add(User.create(createUserProps()));
      connection.db.run(
        "update users set email = 'non una email' where user_id = 'user-1'",
      );

      await expect(repository.findById(USER_ID)).rejects.toMatchObject({
        cause: expect.any(UserEmailInvalidError) as unknown,
      });
    });

    it('non accetta un’email non normalizzata, invece di riscriverla in silenzio', async () => {
      /*
       * `Email.create` normalizza, quindi questa riga tornerebbe come
       * `mario.rossi@example.com` e il primo `update` la riscriverebbe
       * normalizzata: una mutazione che nessun comando ha chiesto, e che può
       * collidere con `UNIQUE (email)` in un punto che sembra non c'entrare.
       * L'adapter scrive sempre il valore già normalizzato, quindi una riga che
       * non lo è non l'ha prodotta lui.
       */
      await repository.add(User.create(createUserProps()));
      connection.db.run(
        "update users set email = 'Mario.Rossi@Example.COM' where user_id = 'user-1'",
      );

      await expect(repository.findById(USER_ID)).rejects.toThrow(
        UserRowInvalidError,
      );
    });
  });
});
