import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import {
  USER_SUBSCRIPTIONS,
  User,
  UserSubscription,
} from '../../domain/aggregates/user.aggregate';
import {
  UserAlreadySubscribedError,
  UserDeletedError,
} from '../../domain/errors/user.errors';
import { UserSubscriptionChangedEvent } from '../../domain/events/user-subscription-changed.event';
import { UserRepository } from '../../domain/ports/user.repository';
import { InMemoryUserRepository } from '../../persistence/in-memory-user.repository';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { ChangeUserSubscriptionCommand } from './change-user-subscription.command';
import { ChangeUserSubscriptionHandler } from './change-user-subscription.handler';

const USER_ID = 'user-1';

/** Tutte le coppie ordinate di piani distinti: il dominio le ammette tutte. */
const TRANSITIONS: [UserSubscription, UserSubscription][] =
  USER_SUBSCRIPTIONS.flatMap((from) =>
    USER_SUBSCRIPTIONS.filter((to) => to !== from).map(
      (to): [UserSubscription, UserSubscription] => [from, to],
    ),
  );

describe('ChangeUserSubscriptionHandler', () => {
  let moduleRef: TestingModule;
  let handler: ChangeUserSubscriptionHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryUserRepository;

  async function seed(
    subscription: UserSubscription = 'free',
    mutate?: (user: User) => void,
  ): Promise<void> {
    const user = User.create({
      userId: USER_ID,
      email: 'mario.rossi@example.com',
      firstName: 'Mario',
      lastName: 'Rossi',
      subscription,
    });

    mutate?.(user);

    await repository.add(user);
  }

  async function loadOrFail(userId: string): Promise<User> {
    const user = await repository.findById(userId);

    if (user === null) {
      throw new Error(`Utente ${userId} atteso nel repository, non trovato`);
    }

    return user;
  }

  /** Raccoglie gli eventi al momento della chiamata: `commit()` svuota l'array. */
  function collectPublished(): unknown[] {
    const published: unknown[] = [];

    jest
      .spyOn(eventBus, 'publishAll')
      .mockImplementation((events: unknown[]) => {
        published.push(...events);
        return [];
      });

    return published;
  }

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        ChangeUserSubscriptionHandler,
        { provide: UserRepository, useClass: InMemoryUserRepository },
      ],
    }).compile();

    await moduleRef.init();

    handler = moduleRef.get(ChangeUserSubscriptionHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryUserRepository>(UserRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it.each(TRANSITIONS)('persiste il passaggio da %s a %s', async (from, to) => {
    await seed(from);

    await handler.execute(new ChangeUserSubscriptionCommand(USER_ID, to));

    expect((await loadOrFail(USER_ID)).subscription).toBe(to);
  });

  it('pubblica UserSubscriptionChangedEvent con entrambi i piani', async () => {
    await seed('standard');

    const published = collectPublished();

    await handler.execute(new ChangeUserSubscriptionCommand(USER_ID, 'pro'));

    expect(published).toStrictEqual([
      new UserSubscriptionChangedEvent(USER_ID, 'standard', 'pro'),
    ]);
  });

  it('non tocca gli altri campi: cambia solo il piano', async () => {
    await seed('free');

    await handler.execute(new ChangeUserSubscriptionCommand(USER_ID, 'pro'));

    const user = await loadOrFail(USER_ID);

    expect(user.email.toString()).toBe('mario.rossi@example.com');
    expect(user.snapshot()).toMatchObject({
      firstName: 'Mario',
      lastName: 'Rossi',
      deleted: false,
    });
  });

  it('pubblica dopo aver persistito, non prima', async () => {
    await seed('free');

    const calls: string[] = [];
    jest.spyOn(repository, 'update').mockImplementation(() => {
      calls.push('update');
      return Promise.resolve();
    });
    jest.spyOn(eventBus, 'publishAll').mockImplementation(() => {
      calls.push('publishAll');
      return [];
    });

    await handler.execute(new ChangeUserSubscriptionCommand(USER_ID, 'pro'));

    expect(calls).toStrictEqual(['update', 'publishAll']);
  });

  it('solleva UserNotFoundError se l`utente non esiste, senza pubblicare', async () => {
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new ChangeUserSubscriptionCommand('inesistente', 'pro')),
    ).rejects.toThrow(UserNotFoundError);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propaga UserAlreadySubscribedError senza scrivere', async () => {
    await seed('pro');

    const write = jest.spyOn(repository, 'update');

    await expect(
      handler.execute(new ChangeUserSubscriptionCommand(USER_ID, 'pro')),
    ).rejects.toThrow(UserAlreadySubscribedError);

    expect(write).not.toHaveBeenCalled();
  });

  it('rifiuta un utente cancellato con UserDeletedError, non con il conflitto sul piano', async () => {
    await seed('pro', (user) => user.delete());

    await expect(
      handler.execute(new ChangeUserSubscriptionCommand(USER_ID, 'pro')),
    ).rejects.toThrow(UserDeletedError);
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    await seed('free');

    await commandBus.execute(
      new ChangeUserSubscriptionCommand(USER_ID, 'standard'),
    );

    expect((await loadOrFail(USER_ID)).subscription).toBe('standard');
  });
});
