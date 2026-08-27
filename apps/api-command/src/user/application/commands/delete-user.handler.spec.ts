import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import {
  USER_SUBSCRIPTIONS,
  User,
  UserSubscription,
} from '../../domain/aggregates/user.aggregate';
import { UserDeletedError } from '../../domain/errors/user.errors';
import { UserDeletedEvent } from '../../domain/events/user-deleted.event';
import { UserRepository } from '../../domain/ports/user.repository';
import { UserEmailAlreadyTakenError } from '../../domain/ports/user.repository.errors';
import { InMemoryUserRepository } from '../../persistence/in-memory-user.repository';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { DeleteUserCommand } from './delete-user.command';
import { DeleteUserHandler } from './delete-user.handler';

const USER_ID = 'user-1';
const PLANS: UserSubscription[] = [...USER_SUBSCRIPTIONS];

describe('DeleteUserHandler', () => {
  let moduleRef: TestingModule;
  let handler: DeleteUserHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryUserRepository;

  async function seed(
    subscription: UserSubscription = 'free',
    userId: string = USER_ID,
  ): Promise<void> {
    await repository.add(
      User.create({
        userId,
        email: 'mario.rossi@example.com',
        firstName: 'Mario',
        lastName: 'Rossi',
        subscription,
      }),
    );
  }

  async function loadOrFail(userId: string): Promise<User> {
    const user = await repository.findById(userId);

    if (user === null) {
      throw new Error(`Utente ${userId} atteso nel repository, non trovato`);
    }

    return user;
  }

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        DeleteUserHandler,
        { provide: UserRepository, useClass: InMemoryUserRepository },
      ],
    }).compile();

    await moduleRef.init();

    handler = moduleRef.get(DeleteUserHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryUserRepository>(UserRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('marca l`utente come cancellato e ne persiste lo stato', async () => {
    await seed();

    await handler.execute(new DeleteUserCommand(USER_ID));

    expect((await loadOrFail(USER_ID)).isDeleted).toBe(true);
  });

  it('l`aggregato resta caricabile: la cancellazione è logica', async () => {
    await seed();

    await handler.execute(new DeleteUserCommand(USER_ID));

    // Il repository non filtra i cancellati, altrimenti apparirebbero
    // inesistenti e questo comando restituirebbe UserNotFoundError.
    await expect(repository.findById(USER_ID)).resolves.not.toBeNull();
  });

  it.each(PLANS)(
    'non altera il piano %s: deleted è ortogonale',
    async (subscription) => {
      await seed(subscription);

      await handler.execute(new DeleteUserCommand(USER_ID));

      const user = await loadOrFail(USER_ID);

      expect(user.isDeleted).toBe(true);
      expect(user.subscription).toBe(subscription);
    },
  );

  it('pubblica UserDeletedEvent', async () => {
    await seed();

    const published: unknown[] = [];
    jest
      .spyOn(eventBus, 'publishAll')
      .mockImplementation((events: unknown[]) => {
        published.push(...events);
        return [];
      });

    await handler.execute(new DeleteUserCommand(USER_ID));

    expect(published).toStrictEqual([new UserDeletedEvent(USER_ID)]);
  });

  it('pubblica dopo aver persistito, non prima', async () => {
    await seed();

    const calls: string[] = [];
    jest.spyOn(repository, 'update').mockImplementation(() => {
      calls.push('update');
      return Promise.resolve();
    });
    jest.spyOn(eventBus, 'publishAll').mockImplementation(() => {
      calls.push('publishAll');
      return [];
    });

    await handler.execute(new DeleteUserCommand(USER_ID));

    expect(calls).toStrictEqual(['update', 'publishAll']);
  });

  it('solleva UserNotFoundError se l`utente non esiste, senza pubblicare', async () => {
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new DeleteUserCommand('inesistente')),
    ).rejects.toThrow(UserNotFoundError);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it('non è idempotente: la seconda cancellazione è un errore', async () => {
    await seed();

    await handler.execute(new DeleteUserCommand(USER_ID));

    const write = jest.spyOn(repository, 'update');

    await expect(
      handler.execute(new DeleteUserCommand(USER_ID)),
    ).rejects.toThrow(UserDeletedError);

    expect(write).not.toHaveBeenCalled();
  });

  it('non libera l`email: la cancellazione logica non permette la re-registrazione', async () => {
    /*
     * Conseguenza documentata della cancellazione logica: la riga esiste
     * ancora, quindi il vincolo di unicità vale. Se un giorno si volesse
     * l'opposto, è un indice parziale nello schema — e questo test è il posto
     * dove quella scelta si vede.
     */
    await seed();

    await handler.execute(new DeleteUserCommand(USER_ID));

    const altro = User.create({
      userId: 'user-2',
      email: 'mario.rossi@example.com',
      firstName: 'Luigi',
      lastName: 'Verdi',
    });

    await expect(repository.add(altro)).rejects.toThrow(
      UserEmailAlreadyTakenError,
    );
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    await seed();

    await commandBus.execute(new DeleteUserCommand(USER_ID));

    expect((await loadOrFail(USER_ID)).isDeleted).toBe(true);
  });
});
