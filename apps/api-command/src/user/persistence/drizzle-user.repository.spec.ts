import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseModule } from '../../shared/persistence/database.module';
import { SqliteConnection } from '../../shared/persistence/sqlite.connection';
import { CreateUserProps, User } from '../domain/aggregates/user.aggregate';
import { UserRepository } from '../domain/ports/user.repository';
import {
  UserAlreadyExistsError,
  UserEmailAlreadyTakenError,
  UserNoLongerExistsError,
} from '../domain/ports/user.repository.errors';
import { DrizzleUserRepository } from './drizzle-user.repository';
import { UserRowInvalidError } from './user.mapper';

const USER_ID = 'user-1';

function createProps(overrides: Partial<CreateUserProps> = {}) {
  return {
    userId: USER_ID,
    email: 'mario.rossi@example.com',
    firstName: 'Mario',
    lastName: 'Rossi',
    ...overrides,
  } satisfies CreateUserProps;
}

/** Evita il narrowing di `User | null` in ogni test. */
async function loadOrFail(
  repository: UserRepository,
  userId: string,
): Promise<User> {
  const user = await repository.findById(userId);

  if (user === null) {
    throw new Error(`Utente ${userId} atteso nel repository, non trovato`);
  }

  return user;
}

/**
 * Ricalca i casi di `in-memory-user.repository.spec.ts` — è la stessa porta,
 * quindi lo stesso contratto — e aggiunge quelli che solo un adapter SQL può
 * avere: l'ordine fra i due vincoli di unicità quando sono violati insieme, e
 * una riga che il dominio non sa rappresentare.
 *
 * Le due spec restano separate invece di condividere una suite parametrica: gli
 * adapter divergono legittimamente (l'in-memory non vede le chiavi esterne),
 * e una suite comune costringerebbe a un contratto più povero di entrambi.
 *
 * Il database e' `:memory:`, nuovo a ogni test perche' il modulo viene ricreato.
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

  it('e registrato come implementazione della porta', () => {
    expect(repository).toBeInstanceOf(UserRepository);
  });

  describe('findById', () => {
    it('restituisce null per un id sconosciuto', async () => {
      await expect(repository.findById('ignoto')).resolves.toBeNull();
    });

    it('reidrata l aggregato con lo stato persistito', async () => {
      const user = User.create(createProps({ subscription: 'pro' }));
      await repository.add(user);

      const loaded = await loadOrFail(repository, USER_ID);

      expect(loaded.snapshot()).toStrictEqual(user.snapshot());
    });

    it('non registra eventi: l aggregato torna reidratato, non creato', async () => {
      await repository.add(User.create(createProps()));

      const loaded = await loadOrFail(repository, USER_ID);

      expect(loaded.getUncommittedEvents()).toHaveLength(0);
    });

    it('restituisce anche gli utenti cancellati', async () => {
      const user = User.create(createProps());
      await repository.add(user);
      user.delete();
      await repository.update(user);

      const loaded = await loadOrFail(repository, USER_ID);

      expect(loaded.isDeleted).toBe(true);
    });

    it('restituisce istanze indipendenti: mutarne una non tocca l altra', async () => {
      await repository.add(User.create(createProps()));

      const primo = await loadOrFail(repository, USER_ID);
      const secondo = await loadOrFail(repository, USER_ID);
      primo.changeSubscription('pro');

      expect(secondo.subscription).toBe('free');
    });
  });

  describe('add', () => {
    it('rende l aggregato ritrovabile per id', async () => {
      await repository.add(User.create(createProps()));

      await expect(repository.findById(USER_ID)).resolves.not.toBeNull();
    });

    it('rifiuta un id gia presente con UserAlreadyExistsError', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(
          User.create(createProps({ email: 'altra@example.com' })),
        ),
      ).rejects.toThrow(UserAlreadyExistsError);
    });

    it('non sovrascrive lo stato esistente quando rifiuta un id duplicato', async () => {
      await repository.add(User.create(createProps({ firstName: 'Mario' })));

      await expect(
        repository.add(
          User.create(
            createProps({ firstName: 'Luigi', email: 'altra@example.com' }),
          ),
        ),
      ).rejects.toThrow(UserAlreadyExistsError);

      const loaded = await loadOrFail(repository, USER_ID);
      expect(loaded.snapshot().firstName).toBe('Mario');
    });

    it('rifiuta un email gia registrata con UserEmailAlreadyTakenError', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(User.create(createProps({ userId: 'user-2' }))),
      ).rejects.toThrow(UserEmailAlreadyTakenError);
    });

    it('indicizza l email normalizzata: il case non aggira il vincolo', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(
          User.create(
            createProps({
              userId: 'user-2',
              email: 'MARIO.ROSSI@EXAMPLE.COM',
            }),
          ),
        ),
      ).rejects.toThrow(UserEmailAlreadyTakenError);
    });

    it('non inserisce nulla quando rifiuta per email duplicata', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(User.create(createProps({ userId: 'user-2' }))),
      ).rejects.toThrow(UserEmailAlreadyTakenError);

      await expect(repository.findById('user-2')).resolves.toBeNull();
    });

    it('accetta email diverse per utenti diversi', async () => {
      await repository.add(User.create(createProps()));
      await repository.add(
        User.create(
          createProps({ userId: 'user-2', email: 'luigi@example.com' }),
        ),
      );

      await expect(repository.findById('user-2')).resolves.not.toBeNull();
    });

    it('conserva lo stato e non l istanza: mutare l aggregato dopo l add non lo altera', async () => {
      const user = User.create(createProps());
      await repository.add(user);

      user.changeSubscription('pro');

      const loaded = await loadOrFail(repository, USER_ID);
      expect(loaded.subscription).toBe('free');
    });

    /*
     * Questo caso non esiste nella spec dell'adapter in memoria, dove i due
     * vincoli sono due `Map` controllate in sequenza. Qui li fa valere SQLite,
     * che riporta un vincolo solo e sceglie in base all'ordine delle colonne —
     * con `user_id` prima di `email` riporterebbe l'email. L'adapter usa `ON
     * CONFLICT DO NOTHING` proprio per non dipendere da quella scelta e tenere
     * l'ordine dell'altro adapter: prima l'id.
     */
    it('quando id ed email collidono insieme, riporta l id come l adapter in memoria', async () => {
      await repository.add(User.create(createProps()));

      await expect(repository.add(User.create(createProps()))).rejects.toThrow(
        UserAlreadyExistsError,
      );
    });
  });

  describe('update', () => {
    it('sovrascrive lo stato di un aggregato esistente', async () => {
      const user = User.create(createProps());
      await repository.add(user);

      user.update({ firstName: 'Luigi' });
      await repository.update(user);

      const loaded = await loadOrFail(repository, USER_ID);
      expect(loaded.snapshot().firstName).toBe('Luigi');
    });

    it('persiste il cambio di piano', async () => {
      const user = User.create(createProps());
      await repository.add(user);

      user.changeSubscription('pro');
      await repository.update(user);

      const loaded = await loadOrFail(repository, USER_ID);
      expect(loaded.subscription).toBe('pro');
    });

    it('persiste la cancellazione logica', async () => {
      const user = User.create(createProps());
      await repository.add(user);

      user.delete();
      await repository.update(user);

      const loaded = await loadOrFail(repository, USER_ID);
      expect(loaded.isDeleted).toBe(true);
    });

    it('rifiuta un id assente con UserNoLongerExistsError', async () => {
      await expect(
        repository.update(User.create(createProps())),
      ).rejects.toThrow(UserNoLongerExistsError);
    });

    it('non inserisce l aggregato quando rifiuta: non e un upsert', async () => {
      await expect(
        repository.update(User.create(createProps())),
      ).rejects.toThrow(UserNoLongerExistsError);

      await expect(repository.findById(USER_ID)).resolves.toBeNull();
    });

    it('non libera l email dell utente cancellato', async () => {
      const user = User.create(createProps());
      await repository.add(user);
      user.delete();
      await repository.update(user);

      await expect(
        repository.add(User.create(createProps({ userId: 'user-2' }))),
      ).rejects.toThrow(UserEmailAlreadyTakenError);
    });

    it('riesce anche quando nessun valore cambia davvero', async () => {
      // SQLite conta le righe processate, non quelle il cui contenuto cambia:
      // e' la premessa su cui poggia `changes === 0` per la riga assente.
      const user = User.create(createProps());
      await repository.add(user);

      await expect(repository.update(user)).resolves.toBeUndefined();
    });
  });

  describe('una riga che il dominio non sa rappresentare', () => {
    it('non passa per un valore valido', async () => {
      await repository.add(User.create(createProps()));
      // Scritto aggirando l'adapter, che non potrebbe produrlo: e' il caso di
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
