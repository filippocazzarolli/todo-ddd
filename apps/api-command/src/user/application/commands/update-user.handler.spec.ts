import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { User } from '../../domain/aggregates/user.aggregate';
import {
  UserDeletedError,
  UserNameRequiredError,
} from '../../domain/errors/user.errors';
import { UserUpdatedEvent } from '../../domain/events/user-updated.event';
import { UserRepository } from '../../domain/ports/user.repository';
import { InMemoryUserRepository } from '../../persistence/in-memory-user.repository';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { UpdateUserCommand } from './update-user.command';
import { UpdateUserHandler } from './update-user.handler';

const USER_ID = 'user-1';

describe('UpdateUserHandler', () => {
  let moduleRef: TestingModule;
  let handler: UpdateUserHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryUserRepository;

  async function seed(mutate?: (user: User) => void): Promise<void> {
    const user = User.create({
      userId: USER_ID,
      email: 'mario.rossi@example.com',
      firstName: 'Mario',
      lastName: 'Rossi',
      subscription: 'pro',
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
        UpdateUserHandler,
        { provide: UserRepository, useClass: InMemoryUserRepository },
      ],
    }).compile();

    await moduleRef.init();

    handler = moduleRef.get(UpdateUserHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryUserRepository>(UserRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('applica il patch e ne persiste lo stato', async () => {
    await seed();

    await handler.execute(
      new UpdateUserCommand(USER_ID, { firstName: 'Luigi', lastName: 'Verdi' }),
    );

    expect((await loadOrFail(USER_ID)).snapshot()).toMatchObject({
      firstName: 'Luigi',
      lastName: 'Verdi',
    });
  });

  it('non tocca i campi assenti dal comando', async () => {
    await seed();

    await handler.execute(
      new UpdateUserCommand(USER_ID, { lastName: 'Verdi' }),
    );

    expect((await loadOrFail(USER_ID)).snapshot()).toMatchObject({
      firstName: 'Mario',
      lastName: 'Verdi',
    });
  });

  it('non tocca email e piano: non sono nel contratto dell`update', async () => {
    await seed();

    await handler.execute(
      new UpdateUserCommand(USER_ID, { firstName: 'Luigi' }),
    );

    const user = await loadOrFail(USER_ID);

    expect(user.email.toString()).toBe('mario.rossi@example.com');
    expect(user.subscription).toBe('pro');
  });

  it('pubblica UserUpdatedEvent con il solo delta', async () => {
    await seed();

    const published = collectPublished();

    // `lastName` identico: non è un cambiamento, non entra nel delta.
    await handler.execute(
      new UpdateUserCommand(USER_ID, { firstName: 'Luigi', lastName: 'Rossi' }),
    );

    expect(published).toStrictEqual([
      new UserUpdatedEvent(USER_ID, { firstName: 'Luigi' }),
    ]);
  });

  it('non pubblica niente se l`update non cambia niente', async () => {
    await seed();

    const published = collectPublished();

    await handler.execute(
      new UpdateUserCommand(USER_ID, { firstName: 'Mario' }),
    );

    /*
     * Si verifica la lista degli eventi e non `publishAll`: `commit()` lo
     * chiama sempre, anche con l'array vuoto. Il fatto che conta è che nessun
     * evento sia uscito.
     */
    expect(published).toStrictEqual([]);
  });

  it('non ispeziona i campi: salva anche l`update a vuoto', async () => {
    await seed();

    const write = jest.spyOn(repository, 'update');

    await handler.execute(new UpdateUserCommand(USER_ID, {}));

    // La decisione su cosa sia cambiato è dell'aggregato, non dell'handler:
    // qui la scrittura inutile è il prezzo di non duplicare quel confronto.
    expect(write).toHaveBeenCalledTimes(1);
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

    await handler.execute(
      new UpdateUserCommand(USER_ID, { firstName: 'Luigi' }),
    );

    expect(calls).toStrictEqual(['update', 'publishAll']);
  });

  it('solleva UserNotFoundError se l`utente non esiste, senza pubblicare', async () => {
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(
        new UpdateUserCommand('inesistente', { firstName: 'Luigi' }),
      ),
    ).rejects.toThrow(UserNotFoundError);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propaga UserNameRequiredError senza scrivere', async () => {
    await seed();

    const write = jest.spyOn(repository, 'update');

    await expect(
      handler.execute(new UpdateUserCommand(USER_ID, { lastName: '  ' })),
    ).rejects.toThrow(UserNameRequiredError);

    expect(write).not.toHaveBeenCalled();
    expect((await loadOrFail(USER_ID)).snapshot().lastName).toBe('Rossi');
  });

  it('rifiuta l`update di un utente cancellato con UserDeletedError', async () => {
    await seed((user) => user.delete());

    const write = jest.spyOn(repository, 'update');

    await expect(
      handler.execute(new UpdateUserCommand(USER_ID, { firstName: 'Luigi' })),
    ).rejects.toThrow(UserDeletedError);

    expect(write).not.toHaveBeenCalled();
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    await seed();

    await commandBus.execute(
      new UpdateUserCommand(USER_ID, { firstName: 'Luigi' }),
    );

    expect((await loadOrFail(USER_ID)).snapshot().firstName).toBe('Luigi');
  });
});
