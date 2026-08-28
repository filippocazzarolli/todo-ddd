import {
  UserAlreadySubscribedError,
  UserDeletedError,
  UserDomainError,
  UserEmailInvalidError,
  UserNameRequiredError,
} from '../errors/user.errors';
import { UserCreatedEvent } from '../events/user-created.event';
import { UserDeletedEvent } from '../events/user-deleted.event';
import { UserSubscriptionChangedEvent } from '../events/user-subscription-changed.event';
import { UserUpdatedEvent } from '../events/user-updated.event';
import { Email } from '../value-objects/email.value-object';
import {
  CreateUserProps,
  INITIAL_VERSION,
  USER_SUBSCRIPTIONS,
  User,
  UserProps,
  UserSubscription,
} from './user.aggregate';

/**
 * Lo userId arriva dall'esterno, quindi qui è un valore fisso: nessun mock,
 * nessuna sorgente non deterministica. A differenza di `Todo`, non serve
 * nemmeno un `now` — l'utente non ha invarianti che dipendono dal tempo.
 */
const USER_ID = 'user-1';

/* Copia mutabile della tupla del dominio: `it.each` non accetta readonly. */
const PLANS: UserSubscription[] = [...USER_SUBSCRIPTIONS];

/** Tutte le coppie ordinate di piani distinti: il dominio le ammette tutte. */
const TRANSITIONS: [UserSubscription, UserSubscription][] = [
  ['free', 'standard'],
  ['free', 'pro'],
  ['standard', 'pro'],
  ['standard', 'free'],
  ['pro', 'free'],
  ['pro', 'standard'],
];

function createProps(overrides: Partial<CreateUserProps> = {}) {
  return {
    userId: USER_ID,
    email: 'mario.rossi@example.com',
    firstName: 'Mario',
    lastName: 'Rossi',
    ...overrides,
  } satisfies CreateUserProps;
}

function persistedState(overrides: Partial<UserProps> = {}) {
  return {
    userId: USER_ID,
    email: Email.create('mario.rossi@example.com'),
    firstName: 'Mario',
    lastName: 'Rossi',
    subscription: 'free',
    deleted: false,
    version: INITIAL_VERSION,
    ...overrides,
  } satisfies UserProps;
}

/** Utente già persistito su un piano dato, senza eventi pendenti. */
function subscribedUser(subscription: UserSubscription): User {
  return User.rehydrate(persistedState({ subscription }));
}

describe('User', () => {
  describe('create', () => {
    it('nasce con lo stato normalizzato', () => {
      const user = User.create(createProps());

      expect(user.snapshot()).toStrictEqual({
        userId: USER_ID,
        email: Email.create('mario.rossi@example.com'),
        firstName: 'Mario',
        lastName: 'Rossi',
        subscription: 'free',
        deleted: false,
        version: INITIAL_VERSION,
      });
      expect(user.userId).toBe(USER_ID);
      expect(user.email.toString()).toBe('mario.rossi@example.com');
      expect(user.subscription).toBe('free');
      expect(user.isDeleted).toBe(false);
    });

    it('compone l`email in un Value Object, non la tiene come stringa', () => {
      const user = User.create(createProps());

      expect(user.email).toBeInstanceOf(Email);
      expect(user.email.equals(Email.create('MARIO.ROSSI@EXAMPLE.COM'))).toBe(
        true,
      );
    });

    it('registra un solo UserCreatedEvent con i valori normalizzati', () => {
      const user = User.create(
        createProps({
          email: '  Mario.Rossi@Example.COM  ',
          firstName: '  Mario  ',
          lastName: '  Rossi \n',
        }),
      );

      // toStrictEqual verifica anche la classe dell'evento, non solo i campi.
      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserCreatedEvent(
          USER_ID,
          'mario.rossi@example.com',
          'Mario',
          'Rossi',
          'free',
        ),
      ]);
    });

    it('porta l`email nell`evento come stringa, non come Value Object', () => {
      // Il payload attraversa una coda verso api-query: deve restare serializzabile.
      const [event] = User.create(createProps()).getUncommittedEvents();

      expect(event).toBeInstanceOf(UserCreatedEvent);
      expect((event as UserCreatedEvent).email).toBe('mario.rossi@example.com');
    });

    it('trimma nome e cognome', () => {
      const user = User.create(
        createProps({ firstName: ' Anna Maria ', lastName: '  De Luca \t' }),
      );

      expect(user.snapshot().firstName).toBe('Anna Maria');
      expect(user.snapshot().lastName).toBe('De Luca');
    });

    it('conserva gli spazi interni: non decide come si scrive un nome', () => {
      const user = User.create(
        createProps({ firstName: 'Anna  Maria', lastName: 'Van der Berg' }),
      );

      expect(user.snapshot().firstName).toBe('Anna  Maria');
      expect(user.snapshot().lastName).toBe('Van der Berg');
    });

    it.each(['', '   ', '\n\t'])(
      'rifiuta il nome vuoto (%j) con UserNameRequiredError su firstName',
      (firstName) => {
        expect(() => User.create(createProps({ firstName }))).toThrow(
          new UserNameRequiredError('firstName'),
        );
      },
    );

    it.each(['', '   ', '\n\t'])(
      'rifiuta il cognome vuoto (%j) con UserNameRequiredError su lastName',
      (lastName) => {
        expect(() => User.create(createProps({ lastName }))).toThrow(
          new UserNameRequiredError('lastName'),
        );
      },
    );

    it('porta il campo nell`errore, per la mappatura a valle', () => {
      expect.assertions(1);

      try {
        User.create(createProps({ lastName: '' }));
      } catch (error) {
        expect((error as UserNameRequiredError).field).toBe('lastName');
      }
    });

    it('rifiuta un`email invalida con UserEmailInvalidError', () => {
      expect(() => User.create(createProps({ email: 'mario' }))).toThrow(
        UserEmailInvalidError,
      );
    });

    it('espone le violazioni di invariante come UserDomainError', () => {
      // Il layer applicativo deve poter mappare la gerarchia, non le foglie.
      expect(() => User.create(createProps({ email: 'mario' }))).toThrow(
        UserDomainError,
      );
      expect(() => User.create(createProps({ firstName: '' }))).toThrow(
        UserDomainError,
      );
    });

    it('valida l`email prima dei nomi: con più campi invalidi vince il primo', () => {
      expect(() =>
        User.create(createProps({ email: 'mario', firstName: '' })),
      ).toThrow(UserEmailInvalidError);
    });

    it('non registra eventi se un campo qualsiasi è invalido', () => {
      // Nessun aggregato costruito, quindi nessun evento: la factory non
      // arriva a `new User` se una validazione lancia.
      expect(() => User.create(createProps({ lastName: '' }))).toThrow(
        UserNameRequiredError,
      );
    });
  });

  describe('create con subscription', () => {
    it('applica il default `free` se il piano non viene scelto', () => {
      expect(User.create(createProps()).subscription).toBe('free');
    });

    it.each(PLANS)('rispetta il piano scelto: %s', (subscription) => {
      const user = User.create(createProps({ subscription }));

      expect(user.subscription).toBe(subscription);
      expect(user.snapshot().subscription).toBe(subscription);
    });

    it.each(PLANS)(
      'porta il piano %s nell`evento di creazione',
      (subscription) => {
        const user = User.create(createProps({ subscription }));

        expect(user.getUncommittedEvents()).toStrictEqual([
          new UserCreatedEvent(
            USER_ID,
            'mario.rossi@example.com',
            'Mario',
            'Rossi',
            subscription,
          ),
        ]);
      },
    );

    it('accetta `free` esplicito senza distinguerlo dal default', () => {
      // Il default non è uno stato a parte: `free` scelto e `free` implicito
      // producono lo stesso aggregato e lo stesso evento.
      expect(
        User.create(createProps({ subscription: 'free' })).snapshot(),
      ).toStrictEqual(User.create(createProps()).snapshot());
    });
  });

  describe('changeSubscription', () => {
    it.each(TRANSITIONS)('esegue la transizione da %s a %s', (from, to) => {
      const user = subscribedUser(from);

      user.changeSubscription(to);

      expect(user.subscription).toBe(to);
      expect(user.snapshot().subscription).toBe(to);
    });

    it.each(TRANSITIONS)(
      'registra UserSubscriptionChangedEvent con entrambi i piani (%s -> %s)',
      (from, to) => {
        const user = subscribedUser(from);

        user.changeSubscription(to);

        expect(user.getUncommittedEvents()).toStrictEqual([
          new UserSubscriptionChangedEvent(USER_ID, from, to),
        ]);
      },
    );

    it('ammette il downgrade: nessun verso è privilegiato', () => {
      const user = subscribedUser('pro');

      user.changeSubscription('free');

      expect(user.subscription).toBe('free');
    });

    it('è ripetibile: il piano può cambiare più volte, un evento per passaggio', () => {
      const user = subscribedUser('free');

      user.changeSubscription('standard');
      user.changeSubscription('pro');
      user.changeSubscription('free');

      expect(user.subscription).toBe('free');
      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserSubscriptionChangedEvent(USER_ID, 'free', 'standard'),
        new UserSubscriptionChangedEvent(USER_ID, 'standard', 'pro'),
        new UserSubscriptionChangedEvent(USER_ID, 'pro', 'free'),
      ]);
    });

    it('registra il cambio dopo UserCreatedEvent, in ordine', () => {
      const user = User.create(createProps());

      user.changeSubscription('pro');

      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserCreatedEvent(
          USER_ID,
          'mario.rossi@example.com',
          'Mario',
          'Rossi',
          'free',
        ),
        new UserSubscriptionChangedEvent(USER_ID, 'free', 'pro'),
      ]);
    });

    it.each(PLANS)(
      'non è idempotente: passare a %s essendoci già lancia UserAlreadySubscribedError',
      (subscription) => {
        const user = subscribedUser(subscription);

        expect(() => user.changeSubscription(subscription)).toThrow(
          UserAlreadySubscribedError,
        );
      },
    );

    it('non muta lo stato e non registra eventi se il piano è lo stesso', () => {
      const user = subscribedUser('standard');

      expect(() => user.changeSubscription('standard')).toThrow(
        UserAlreadySubscribedError,
      );
      expect(user.subscription).toBe('standard');
      expect(user.getUncommittedEvents()).toStrictEqual([]);
    });

    it('porta userId e piano nell`errore, per la mappatura a valle', () => {
      expect.assertions(2);

      const user = subscribedUser('pro');

      try {
        user.changeSubscription('pro');
      } catch (error) {
        expect((error as UserAlreadySubscribedError).userId).toBe(USER_ID);
        expect((error as UserAlreadySubscribedError).subscription).toBe('pro');
      }
    });

    it('espone la violazione come UserDomainError', () => {
      const user = subscribedUser('free');

      expect(() => user.changeSubscription('free')).toThrow(UserDomainError);
    });

    it('rifiuta un aggregato cancellato con UserDeletedError', () => {
      const user = subscribedUser('free');
      user.delete();

      expect(() => user.changeSubscription('pro')).toThrow(UserDeletedError);
      expect(user.subscription).toBe('free');
    });

    it('l`esistenza precede il conflitto: un utente cancellato non riceve UserAlreadySubscribedError', () => {
      const user = subscribedUser('pro');
      user.delete();

      expect(() => user.changeSubscription('pro')).toThrow(UserDeletedError);
    });

    it('registra il solo evento di cambio su un aggregato reidratato', () => {
      const user = subscribedUser('standard');

      user.changeSubscription('pro');

      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserSubscriptionChangedEvent(USER_ID, 'standard', 'pro'),
      ]);
    });
  });

  describe('update', () => {
    it('modifica nome e cognome in una sola chiamata, con un solo evento', () => {
      const user = User.rehydrate(persistedState());

      user.update({ firstName: 'Luigi', lastName: 'Verdi' });

      expect(user.snapshot()).toStrictEqual({
        ...persistedState(),
        firstName: 'Luigi',
        lastName: 'Verdi',
      });
      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserUpdatedEvent(USER_ID, {
          firstName: 'Luigi',
          lastName: 'Verdi',
        }),
      ]);
    });

    it('l`evento porta il solo delta, non i campi rimasti fermi', () => {
      const user = User.rehydrate(persistedState());

      user.update({ firstName: 'Luigi', lastName: 'Rossi' });

      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserUpdatedEvent(USER_ID, { firstName: 'Luigi' }),
      ]);
    });

    it('non tocca i campi assenti dall`update', () => {
      const user = User.rehydrate(persistedState());

      user.update({ lastName: 'Verdi' });

      expect(user.snapshot().firstName).toBe('Mario');
      expect(user.snapshot().lastName).toBe('Verdi');
    });

    it('trimma i bordi e conserva gli spazi interni, come `create`', () => {
      const user = User.rehydrate(persistedState());

      user.update({
        firstName: '  Anna Maria  ',
        lastName: ' Van der Berg \t',
      });

      expect(user.snapshot().firstName).toBe('Anna Maria');
      expect(user.snapshot().lastName).toBe('Van der Berg');
    });

    it('e` un no-op se i valori sono identici a quelli attuali', () => {
      const user = User.rehydrate(persistedState());

      user.update({ firstName: 'Mario', lastName: 'Rossi' });

      expect(user.getUncommittedEvents()).toStrictEqual([]);
    });

    it('e` un no-op se non viene passato nessun campo', () => {
      const user = User.rehydrate(persistedState());

      user.update({});

      expect(user.getUncommittedEvents()).toStrictEqual([]);
    });

    it('normalizza prima di confrontare: gli spazi non sono un cambio', () => {
      const user = User.rehydrate(persistedState());

      user.update({ firstName: '  Mario  ' });

      expect(user.getUncommittedEvents()).toStrictEqual([]);
    });

    it.each(['', '   ', '\n\t'])(
      'rifiuta il nome vuoto (%j) con UserNameRequiredError',
      (firstName) => {
        const user = User.rehydrate(persistedState());

        expect(() => user.update({ firstName })).toThrow(
          new UserNameRequiredError('firstName'),
        );
      },
    );

    it.each(['', '   ', '\n\t'])(
      'rifiuta il cognome vuoto (%j) con UserNameRequiredError',
      (lastName) => {
        const user = User.rehydrate(persistedState());

        expect(() => user.update({ lastName })).toThrow(
          new UserNameRequiredError('lastName'),
        );
      },
    );

    it('non applica niente se un campo qualsiasi e` invalido', () => {
      // Si valida tutto prima di mutare: un nome valido con un cognome vuoto
      // non deve lasciare l`aggregato a metà.
      const user = User.rehydrate(persistedState());

      expect(() => user.update({ firstName: 'Luigi', lastName: '' })).toThrow(
        UserNameRequiredError,
      );
      expect(user.snapshot().firstName).toBe('Mario');
      expect(user.getUncommittedEvents()).toStrictEqual([]);
    });

    it('non tocca email e piano: da qui non sono modificabili', () => {
      const user = User.rehydrate(persistedState({ subscription: 'pro' }));

      user.update({ firstName: 'Luigi' });

      expect(user.email.toString()).toBe('mario.rossi@example.com');
      expect(user.subscription).toBe('pro');
    });

    it('rifiuta un aggregato cancellato con UserDeletedError', () => {
      const user = User.rehydrate(persistedState({ deleted: true }));

      expect(() => user.update({ firstName: 'Luigi' })).toThrow(
        UserDeletedError,
      );
      expect(user.snapshot().firstName).toBe('Mario');
    });
  });

  describe('delete', () => {
    it('marca l`aggregato come cancellato', () => {
      const user = User.rehydrate(persistedState());

      user.delete();

      expect(user.isDeleted).toBe(true);
      expect(user.snapshot().deleted).toBe(true);
    });

    it('registra UserDeletedEvent', () => {
      const user = User.rehydrate(persistedState());

      user.delete();

      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserDeletedEvent(USER_ID),
      ]);
    });

    it.each(PLANS)(
      'e` ortogonale al piano: cancella un utente %s, che resta su quel piano',
      (subscription) => {
        const user = subscribedUser(subscription);

        user.delete();

        expect(user.isDeleted).toBe(true);
        expect(user.subscription).toBe(subscription);
      },
    );

    it('non e` idempotente: la seconda chiamata lancia UserDeletedError', () => {
      const user = User.rehydrate(persistedState());

      user.delete();

      expect(() => user.delete()).toThrow(UserDeletedError);
    });

    it('congela l`aggregato: nessuna transizione dopo la cancellazione', () => {
      const user = subscribedUser('standard');

      user.delete();

      expect(() => user.update({ firstName: 'Luigi' })).toThrow(
        UserDeletedError,
      );
      expect(() => user.changeSubscription('pro')).toThrow(UserDeletedError);
      expect(() => user.delete()).toThrow(UserDeletedError);

      // Il solo evento resta quello della cancellazione.
      expect(user.getUncommittedEvents()).toStrictEqual([
        new UserDeletedEvent(USER_ID),
      ]);
    });

    it('espone la violazione come UserDomainError e porta lo userId', () => {
      expect.assertions(2);

      const user = User.rehydrate(persistedState({ deleted: true }));

      try {
        user.delete();
      } catch (error) {
        expect(error).toBeInstanceOf(UserDomainError);
        expect((error as UserDeletedError).userId).toBe(USER_ID);
      }
    });
  });

  describe('rehydrate', () => {
    it('non registra eventi: quei fatti sono già accaduti', () => {
      const user = User.rehydrate(persistedState());

      expect(user.getUncommittedEvents()).toStrictEqual([]);
    });

    it('preserva la cancellazione: un aggregato cancellato resta congelato', () => {
      const user = User.rehydrate(persistedState({ deleted: true }));

      expect(user.isDeleted).toBe(true);
      expect(() => user.delete()).toThrow(UserDeletedError);
    });

    it('preserva lo stato persistito', () => {
      const state = persistedState({
        userId: 'user-42',
        email: Email.create('luigi@example.com'),
        firstName: 'Luigi',
        lastName: 'Verdi',
        subscription: 'pro',
      });

      const user = User.rehydrate(state);

      expect(user.snapshot()).toStrictEqual(state);
      expect(user.userId).toBe('user-42');
      expect(user.email.toString()).toBe('luigi@example.com');
      expect(user.subscription).toBe('pro');
    });

    it('non rivalida lo stato: un dato rotto in persistenza non è un errore di dominio', () => {
      // Un nome vuoto qui non può arrivare da una richiesta — `create` lo
      // rifiuta — quindi non c'è invariante da riaffermare al caricamento.
      const user = User.rehydrate(persistedState({ firstName: '' }));

      expect(user.snapshot().firstName).toBe('');
    });

    it('copia le props: mutare l`oggetto del chiamante non altera l`aggregato', () => {
      const state = persistedState();
      const user = User.rehydrate(state);

      state.firstName = 'Manomesso';
      state.subscription = 'pro';

      expect(user.snapshot().firstName).toBe('Mario');
      expect(user.subscription).toBe('free');
    });
  });

  describe('snapshot', () => {
    it('non espone lo stato interno: mutare lo snapshot è innocuo', () => {
      const user = User.create(createProps());
      const snapshot = user.snapshot() as UserProps;

      snapshot.firstName = 'Manomesso';
      snapshot.subscription = 'pro';

      expect(user.snapshot().firstName).toBe('Mario');
      expect(user.subscription).toBe('free');
    });

    it('condivide il Value Object senza copiarlo: `Email` è immutabile', () => {
      const user = User.create(createProps());

      expect(user.snapshot().email).toBe(user.email);
    });
  });
});
