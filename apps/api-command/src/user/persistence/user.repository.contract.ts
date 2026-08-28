import { CreateUserProps, User } from '../domain/aggregates/user.aggregate';
import { UserRepository } from '../domain/ports/user.repository';
import {
  UserAlreadyExistsError,
  UserEmailAlreadyTakenError,
  UserNoLongerExistsError,
} from '../domain/ports/user.repository.errors';
import { Email } from '../domain/value-objects/email.value-object';

/**
 * Suite di contratto di `UserRepository`, per la stessa ragione della gemella
 * in `todo/persistence/`: le due spec degli adapter erano quasi identiche, e un
 * contratto scritto due volte a un certo punto smette di essere lo stesso.
 *
 * Il caso che più di tutti apparteneva qui è **l'ordine fra i due vincoli di
 * unicità quando sono violati insieme**. Viveva solo nella spec dell'adapter
 * Drizzle, dove è motivato — SQLite riporta un vincolo solo e sceglie in base
 * all'ordine delle colonne — ma la regola che quel codice difende è che i *due*
 * adapter rispondano `UserAlreadyExistsError`. Con il caso in un posto solo,
 * l'adapter in memoria poteva cambiare idea senza che niente lo notasse.
 *
 * Fuori restano solo i casi che un adapter non può avere: la riga corrotta in
 * `drizzle-user.repository.spec.ts`.
 *
 * Il file non si chiama `.spec.ts` di proposito: il `testRegex` di Jest lo
 * raccoglierebbe come suite a sé, che non contiene nessun test.
 */

export const USER_ID = 'user-1';
export const OTHER_USER_ID = 'user-2';
export const EMAIL = 'mario.rossi@example.com';

export function createUserProps(
  overrides: Partial<CreateUserProps> = {},
): CreateUserProps {
  return {
    userId: USER_ID,
    email: EMAIL,
    firstName: 'Mario',
    lastName: 'Rossi',
    ...overrides,
  } satisfies CreateUserProps;
}

/** Evita il narrowing di `User | null` in ogni test. */
export async function loadOrFail(
  repository: UserRepository,
  userId: string,
): Promise<User> {
  const user = await repository.findById(userId);

  if (user === null) {
    throw new Error(`Utente ${userId} atteso nel repository, non trovato`);
  }

  return user;
}

export function describeUserRepositoryContract(
  provide: () => UserRepository,
): void {
  describe('il contratto di UserRepository', () => {
    let repository: UserRepository;

    /*
     * Gira dopo il `beforeEach` della spec che lo ospita — Jest esegue gli hook
     * dal describe più esterno al più interno — quindi il repository qui è già
     * costruito.
     */
    beforeEach(() => {
      repository = provide();
    });

    it('è risolvibile come UserRepository: la classe astratta è il token DI', () => {
      expect(repository).toBeInstanceOf(UserRepository);
    });

    describe('findById', () => {
      it('restituisce null per un id sconosciuto', async () => {
        await expect(repository.findById('inesistente')).resolves.toBeNull();
      });

      it('reidrata l’aggregato con lo stato persistito', async () => {
        await repository.add(
          User.create(createUserProps({ subscription: 'pro' })),
        );

        const user = await loadOrFail(repository, USER_ID);

        // Il letterale e non `user.snapshot()` dell'originale: qui la forma
        // dello stato è asserita, non solo la sua conservazione.
        expect(user.snapshot()).toStrictEqual({
          userId: USER_ID,
          email: Email.create(EMAIL),
          firstName: 'Mario',
          lastName: 'Rossi',
          subscription: 'pro',
          deleted: false,
        });
        expect(user.email.toString()).toBe(EMAIL);
      });

      it('non registra eventi: l’aggregato torna reidratato, non creato', async () => {
        await repository.add(User.create(createUserProps()));

        expect(
          (await loadOrFail(repository, USER_ID)).getUncommittedEvents(),
        ).toStrictEqual([]);
      });

      it('restituisce anche gli utenti cancellati', async () => {
        const user = User.create(createUserProps());
        await repository.add(user);
        user.delete();
        await repository.update(user);

        expect((await loadOrFail(repository, USER_ID)).isDeleted).toBe(true);
      });

      it('restituisce istanze indipendenti: mutarne una non tocca l’altra', async () => {
        await repository.add(User.create(createUserProps()));

        const primo = await loadOrFail(repository, USER_ID);
        const secondo = await loadOrFail(repository, USER_ID);

        primo.update({ firstName: 'Luigi' });

        expect(secondo.snapshot().firstName).toBe('Mario');
        expect(
          (await loadOrFail(repository, USER_ID)).snapshot().firstName,
        ).toBe('Mario');
      });
    });

    describe('add', () => {
      it('rende l’aggregato ritrovabile per id', async () => {
        await repository.add(User.create(createUserProps()));

        expect((await loadOrFail(repository, USER_ID)).userId).toBe(USER_ID);
      });

      it('rifiuta un id già presente con UserAlreadyExistsError', async () => {
        await repository.add(User.create(createUserProps()));

        await expect(
          repository.add(
            User.create(createUserProps({ email: 'altra@example.com' })),
          ),
        ).rejects.toThrow(UserAlreadyExistsError);
      });

      it('non sovrascrive lo stato esistente quando rifiuta un id duplicato', async () => {
        await repository.add(User.create(createUserProps()));

        await expect(
          repository.add(
            User.create(
              createUserProps({
                email: 'altra@example.com',
                firstName: 'Luigi',
              }),
            ),
          ),
        ).rejects.toThrow(UserAlreadyExistsError);

        expect(
          (await loadOrFail(repository, USER_ID)).snapshot().firstName,
        ).toBe('Mario');
      });

      it('rifiuta un’email già registrata con UserEmailAlreadyTakenError', async () => {
        await repository.add(User.create(createUserProps()));

        await expect(
          repository.add(
            User.create(createUserProps({ userId: OTHER_USER_ID })),
          ),
        ).rejects.toThrow(UserEmailAlreadyTakenError);
      });

      it('indicizza l’email normalizzata: il case non aggira il vincolo', async () => {
        await repository.add(User.create(createUserProps()));

        await expect(
          repository.add(
            User.create(
              createUserProps({
                userId: OTHER_USER_ID,
                email: 'MARIO.ROSSI@EXAMPLE.COM',
              }),
            ),
          ),
        ).rejects.toThrow(UserEmailAlreadyTakenError);
      });

      it('quando id ed email collidono insieme, riporta l’id', async () => {
        /*
         * La regola che i due adapter devono condividere, e che prima era
         * asserita solo su quello Drizzle. Là SQLite riporta un vincolo solo e
         * sceglie in base all'ordine delle colonne — con `user_id` prima di
         * `email` riporterebbe l'email — quindi l'adapter usa `ON CONFLICT DO
         * NOTHING` per non dipendere da quella scelta e tenere l'ordine
         * dell'altro adapter: prima l'id.
         */
        await repository.add(User.create(createUserProps()));

        await expect(
          repository.add(User.create(createUserProps())),
        ).rejects.toThrow(UserAlreadyExistsError);
      });

      it('non inserisce nulla quando rifiuta per email duplicata', async () => {
        await repository.add(User.create(createUserProps()));

        await expect(
          repository.add(
            User.create(createUserProps({ userId: OTHER_USER_ID })),
          ),
        ).rejects.toThrow(UserEmailAlreadyTakenError);

        await expect(repository.findById(OTHER_USER_ID)).resolves.toBeNull();
      });

      it('accetta email diverse per utenti diversi', async () => {
        await repository.add(User.create(createUserProps()));
        await repository.add(
          User.create(
            createUserProps({
              userId: OTHER_USER_ID,
              email: 'luigi@example.com',
            }),
          ),
        );

        expect(
          (await loadOrFail(repository, OTHER_USER_ID)).email.toString(),
        ).toBe('luigi@example.com');
      });

      it('conserva lo stato e non l’istanza: mutare l’aggregato dopo l’add non lo altera', async () => {
        const user = User.create(createUserProps());
        await repository.add(user);

        user.update({ firstName: 'Luigi' });

        expect(
          (await loadOrFail(repository, USER_ID)).snapshot().firstName,
        ).toBe('Mario');
      });
    });

    describe('update', () => {
      it('sovrascrive lo stato di un aggregato esistente', async () => {
        await repository.add(User.create(createUserProps()));

        const user = await loadOrFail(repository, USER_ID);
        user.update({ firstName: 'Luigi', lastName: 'Verdi' });
        await repository.update(user);

        expect(
          (await loadOrFail(repository, USER_ID)).snapshot(),
        ).toMatchObject({ firstName: 'Luigi', lastName: 'Verdi' });
      });

      it('persiste il cambio di piano', async () => {
        await repository.add(User.create(createUserProps()));

        const user = await loadOrFail(repository, USER_ID);
        user.changeSubscription('pro');
        await repository.update(user);

        expect((await loadOrFail(repository, USER_ID)).subscription).toBe(
          'pro',
        );
      });

      it('persiste la cancellazione logica', async () => {
        await repository.add(User.create(createUserProps()));

        const user = await loadOrFail(repository, USER_ID);
        user.delete();
        await repository.update(user);

        expect((await loadOrFail(repository, USER_ID)).isDeleted).toBe(true);
      });

      it('riesce anche quando nessun valore cambia davvero', async () => {
        // SQLite conta le righe processate, non quelle il cui contenuto cambia:
        // è la premessa su cui poggia `changes === 0` per la riga assente.
        const user = User.create(createUserProps());
        await repository.add(user);

        await expect(repository.update(user)).resolves.toBeUndefined();
      });

      it('rifiuta un id assente con UserNoLongerExistsError', async () => {
        await expect(
          repository.update(User.create(createUserProps())),
        ).rejects.toThrow(UserNoLongerExistsError);
      });

      it('non inserisce l’aggregato quando rifiuta: non è un upsert', async () => {
        await expect(
          repository.update(User.create(createUserProps())),
        ).rejects.toThrow(UserNoLongerExistsError);

        await expect(repository.findById(USER_ID)).resolves.toBeNull();
      });

      it('non libera l’email dell’utente cancellato', async () => {
        await repository.add(User.create(createUserProps()));

        const user = await loadOrFail(repository, USER_ID);
        user.delete();
        await repository.update(user);

        // La riga c'è ancora, quindi il vincolo di unicità vale ancora.
        await expect(
          repository.add(
            User.create(createUserProps({ userId: OTHER_USER_ID })),
          ),
        ).rejects.toThrow(UserEmailAlreadyTakenError);
      });
    });
  });
}
