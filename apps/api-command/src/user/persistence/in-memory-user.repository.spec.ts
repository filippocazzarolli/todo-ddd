import { CreateUserProps, User } from '../domain/aggregates/user.aggregate';
import { Email } from '../domain/value-objects/email.value-object';
import { UserRepository } from '../domain/ports/user.repository';
import {
  UserAlreadyExistsError,
  UserEmailAlreadyTakenError,
  UserNoLongerExistsError,
} from '../domain/ports/user.repository.errors';
import { InMemoryUserRepository } from './in-memory-user.repository';

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

describe('InMemoryUserRepository', () => {
  let repository: InMemoryUserRepository;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
  });

  describe('findById', () => {
    it('restituisce null per un id sconosciuto', async () => {
      await expect(repository.findById('inesistente')).resolves.toBeNull();
    });

    it('reidrata l`aggregato con lo stato persistito', async () => {
      await repository.add(User.create(createProps({ subscription: 'pro' })));

      const user = await loadOrFail(repository, USER_ID);

      expect(user.snapshot()).toStrictEqual({
        userId: USER_ID,
        email: Email.create('mario.rossi@example.com'),
        firstName: 'Mario',
        lastName: 'Rossi',
        subscription: 'pro',
        deleted: false,
      });
      expect(user.email.toString()).toBe('mario.rossi@example.com');
    });

    it('non registra eventi: l`aggregato torna reidratato, non creato', async () => {
      await repository.add(User.create(createProps()));

      expect(
        (await loadOrFail(repository, USER_ID)).getUncommittedEvents(),
      ).toStrictEqual([]);
    });

    it('restituisce anche gli utenti cancellati', async () => {
      const user = User.create(createProps());
      user.delete();
      await repository.add(user);

      expect((await loadOrFail(repository, USER_ID)).isDeleted).toBe(true);
    });

    it('restituisce istanze indipendenti: mutarne una non tocca l`altra', async () => {
      await repository.add(User.create(createProps()));

      const first = await loadOrFail(repository, USER_ID);
      const second = await loadOrFail(repository, USER_ID);

      first.update({ firstName: 'Luigi' });

      expect(second.snapshot().firstName).toBe('Mario');
      expect((await loadOrFail(repository, USER_ID)).snapshot().firstName).toBe(
        'Mario',
      );
    });
  });

  describe('add', () => {
    it('rende l`aggregato ritrovabile per id', async () => {
      await repository.add(User.create(createProps()));

      expect((await loadOrFail(repository, USER_ID)).userId).toBe(USER_ID);
    });

    it('rifiuta un id già presente con UserAlreadyExistsError', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(
          User.create(createProps({ email: 'altro@example.com' })),
        ),
      ).rejects.toThrow(UserAlreadyExistsError);
    });

    it('non sovrascrive lo stato esistente quando rifiuta un id duplicato', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(
          User.create(
            createProps({ email: 'altro@example.com', firstName: 'Luigi' }),
          ),
        ),
      ).rejects.toThrow(UserAlreadyExistsError);

      expect((await loadOrFail(repository, USER_ID)).snapshot().firstName).toBe(
        'Mario',
      );
    });

    it('rifiuta un`email già registrata con UserEmailAlreadyTakenError', async () => {
      await repository.add(User.create(createProps()));

      await expect(
        repository.add(User.create(createProps({ userId: 'user-2' }))),
      ).rejects.toThrow(UserEmailAlreadyTakenError);
    });

    it('indicizza l`email normalizzata: il case non aggira il vincolo', async () => {
      await repository.add(
        User.create(createProps({ email: 'Mario.Rossi@Example.COM' })),
      );

      await expect(
        repository.add(
          User.create(
            createProps({ userId: 'user-2', email: 'mario.rossi@example.com' }),
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

      expect((await loadOrFail(repository, 'user-2')).email.toString()).toBe(
        'luigi@example.com',
      );
    });

    it('conserva lo stato e non l`istanza: mutare l`aggregato dopo l`add non lo altera', async () => {
      const user = User.create(createProps());

      await repository.add(user);
      user.update({ firstName: 'Luigi' });

      expect((await loadOrFail(repository, USER_ID)).snapshot().firstName).toBe(
        'Mario',
      );
    });
  });

  describe('update', () => {
    it('sovrascrive lo stato di un aggregato esistente', async () => {
      await repository.add(User.create(createProps()));

      const user = await loadOrFail(repository, USER_ID);
      user.update({ firstName: 'Luigi', lastName: 'Verdi' });
      await repository.update(user);

      expect((await loadOrFail(repository, USER_ID)).snapshot()).toMatchObject({
        firstName: 'Luigi',
        lastName: 'Verdi',
      });
    });

    it('persiste il cambio di piano', async () => {
      await repository.add(User.create(createProps()));

      const user = await loadOrFail(repository, USER_ID);
      user.changeSubscription('pro');
      await repository.update(user);

      expect((await loadOrFail(repository, USER_ID)).subscription).toBe('pro');
    });

    it('persiste la cancellazione logica', async () => {
      await repository.add(User.create(createProps()));

      const user = await loadOrFail(repository, USER_ID);
      user.delete();
      await repository.update(user);

      expect((await loadOrFail(repository, USER_ID)).isDeleted).toBe(true);
    });

    it('rifiuta un id assente con UserNoLongerExistsError', async () => {
      await expect(
        repository.update(User.create(createProps())),
      ).rejects.toThrow(UserNoLongerExistsError);
    });

    it('non inserisce l`aggregato quando rifiuta: non è un upsert', async () => {
      await expect(
        repository.update(User.create(createProps())),
      ).rejects.toThrow(UserNoLongerExistsError);

      await expect(repository.findById(USER_ID)).resolves.toBeNull();
    });

    it('non libera l`email dell`utente cancellato', async () => {
      await repository.add(User.create(createProps()));

      const user = await loadOrFail(repository, USER_ID);
      user.delete();
      await repository.update(user);

      // La riga c'è ancora, quindi il vincolo di unicità vale ancora.
      await expect(
        repository.add(User.create(createProps({ userId: 'user-2' }))),
      ).rejects.toThrow(UserEmailAlreadyTakenError);
    });
  });
});
