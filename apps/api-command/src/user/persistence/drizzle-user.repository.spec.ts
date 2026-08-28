import { Test, TestingModule } from '@nestjs/testing';
import { outbox } from '@repo/db';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { User } from '../domain/aggregates/user.aggregate';
import { UserEmailInvalidError } from '../domain/errors/user.errors';
import { UserRepository } from '../domain/ports/user.repository';
import { UserEmailAlreadyTakenError } from '../domain/ports/user.repository.errors';
import { DrizzleUserRepository } from './drizzle-user.repository';
import { UserRowInvalidError } from './user.mapper';
import {
  createUserProps,
  describeUserRepositoryContract,
  OTHER_USER_ID,
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

  /*
   * Fuori dal contratto perché l'adapter in memoria non ha un outbox e non può
   * averlo. La forma è la stessa dell'adapter todo, che ne copre i casi in
   * dettaglio: qui bastano i due che dipendono da `add` con `ON CONFLICT DO
   * NOTHING`, la cui interazione con il rollback non è ovvia.
   */
  describe('l’outbox transazionale', () => {
    function outboxRows() {
      return connection.db.select().from(outbox).orderBy(outbox.sequence).all();
    }

    it('scrive l’evento dell’aggregato insieme alla riga', async () => {
      await repository.add(User.create(createUserProps()));

      expect(outboxRows()).toMatchObject([
        {
          aggregateType: 'user',
          aggregateId: USER_ID,
          name: 'UserCreatedEvent',
        },
      ]);
    });

    it('non scrive l’evento quando l’insert non inserisce niente', async () => {
      /*
       * Il caso in cui il rollback non c'entra: `ON CONFLICT DO NOTHING` non
       * solleva, quindi la transazione arriva in fondo e commit — è il `changes
       * > 0` a decidere se l'evento va scritto. Un `append` messo fuori da quel
       * ramo avrebbe pubblicato una creazione mai avvenuta.
       */
      await repository.add(User.create(createUserProps()));

      await expect(
        repository.add(User.create(createUserProps({ userId: OTHER_USER_ID }))),
      ).rejects.toThrow(UserEmailAlreadyTakenError);

      expect(outboxRows()).toHaveLength(1);
    });
  });

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
