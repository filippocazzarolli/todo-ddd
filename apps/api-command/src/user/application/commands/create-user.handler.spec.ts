import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { User } from '../../domain/aggregates/user.aggregate';
import {
  UserEmailInvalidError,
  UserNameRequiredError,
} from '../../domain/errors/user.errors';
import { UserCreatedEvent } from '../../domain/events/user-created.event';
import { UserIdGenerator } from '../../domain/ports/user-id.generator';
import { UserRepository } from '../../domain/ports/user.repository';
import { UserEmailAlreadyTakenError } from '../../domain/ports/user.repository.errors';
import { InMemoryUserRepository } from '../../persistence/in-memory-user.repository';
import { CreateUserCommand } from './create-user.command';
import { CreateUserHandler } from './create-user.handler';

const GENERATED_ID = 'user-generato';

/** Ordine di invocazione tra due spy, senza dipendere dai tipi di jest. */
function firstCallOrder(spy: {
  mock: { invocationCallOrder: number[] };
}): number {
  const [order] = spy.mock.invocationCallOrder;

  if (order === undefined) {
    throw new Error('Spy mai invocato');
  }

  return order;
}

describe('CreateUserHandler', () => {
  let moduleRef: TestingModule;
  let handler: CreateUserHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryUserRepository;
  const userIds = { next: jest.fn(() => GENERATED_ID) };

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
    userIds.next.mockClear();
    userIds.next.mockReturnValue(GENERATED_ID);

    moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        CreateUserHandler,
        { provide: UserRepository, useClass: InMemoryUserRepository },
        { provide: UserIdGenerator, useValue: userIds },
      ],
    }).compile();

    // init() fa registrare l'handler sul CommandBus dall'ExplorerService.
    await moduleRef.init();

    handler = moduleRef.get(CreateUserHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryUserRepository>(UserRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('restituisce l`id prodotto dal generatore, chiamandolo una volta sola', async () => {
    const userId = await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    expect(userId).toBe(GENERATED_ID);
    expect(userIds.next).toHaveBeenCalledTimes(1);
  });

  it('persiste l`aggregato nello stato iniziale, con il piano di default', async () => {
    await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    const user = await loadOrFail(GENERATED_ID);

    expect(user.snapshot()).toMatchObject({
      userId: GENERATED_ID,
      firstName: 'Mario',
      lastName: 'Rossi',
      subscription: 'free',
      deleted: false,
    });
    expect(user.email.toString()).toBe('mario.rossi@example.com');
  });

  it('rispetta il piano scelto dal chiamante', async () => {
    await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi', 'pro'),
    );

    expect((await loadOrFail(GENERATED_ID)).subscription).toBe('pro');
  });

  it('non pre-elabora l`input: la normalizzazione resta nell`aggregato', async () => {
    await handler.execute(
      new CreateUserCommand(
        '  Mario.Rossi@Example.COM  ',
        ' Mario ',
        ' Rossi ',
      ),
    );

    const user = await loadOrFail(GENERATED_ID);

    expect(user.email.toString()).toBe('mario.rossi@example.com');
    expect(user.snapshot()).toMatchObject({
      firstName: 'Mario',
      lastName: 'Rossi',
    });
  });

  it('pubblica UserCreatedEvent sull`EventBus', async () => {
    const published = collectPublished();

    await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    expect(published).toStrictEqual([
      new UserCreatedEvent(
        GENERATED_ID,
        'mario.rossi@example.com',
        'Mario',
        'Rossi',
        'free',
      ),
    ]);
  });

  it('pubblica dopo aver persistito, non prima', async () => {
    const write = jest.spyOn(repository, 'add');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    expect(firstCallOrder(write)).toBeLessThan(firstCallOrder(publishAll));
  });

  it('propaga il rifiuto dell`email invalida senza persistere né pubblicare', async () => {
    const write = jest.spyOn(repository, 'add');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new CreateUserCommand('mario', 'Mario', 'Rossi')),
    ).rejects.toThrow(UserEmailInvalidError);

    expect(write).not.toHaveBeenCalled();
    expect(publishAll).not.toHaveBeenCalled();
    await expect(repository.findById(GENERATED_ID)).resolves.toBeNull();
  });

  it('propaga il rifiuto del nome vuoto senza persistere', async () => {
    const write = jest.spyOn(repository, 'add');

    await expect(
      handler.execute(
        new CreateUserCommand('mario.rossi@example.com', '   ', 'Rossi'),
      ),
    ).rejects.toThrow(UserNameRequiredError);

    expect(write).not.toHaveBeenCalled();
  });

  it('non verifica l`unicità dell`email: nessuna lettura prima della scrittura', async () => {
    /*
     * Il controllo preventivo sarebbe una corsa e non sostituirebbe il vincolo
     * nello store: l'handler non deve nemmeno provarci. Questo test è il
     * guardiano di quella decisione.
     */
    const read = jest.spyOn(repository, 'findById');

    await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    expect(read).not.toHaveBeenCalled();
  });

  it('propaga UserEmailAlreadyTakenError dal repository, senza pubblicare', async () => {
    userIds.next.mockReturnValueOnce('user-1').mockReturnValueOnce('user-2');

    await handler.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    const publishAll = jest.spyOn(eventBus, 'publishAll');

    // Stessa email con case diverso: l'indice è sull'indirizzo normalizzato.
    await expect(
      handler.execute(
        new CreateUserCommand('MARIO.ROSSI@EXAMPLE.COM', 'Luigi', 'Verdi'),
      ),
    ).rejects.toThrow(UserEmailAlreadyTakenError);

    expect(publishAll).not.toHaveBeenCalled();
    await expect(repository.findById('user-2')).resolves.toBeNull();
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    /*
     * L'annotazione `: string` è essa stessa un test: se `Command<string>` non
     * tipizzasse il risultato, `execute` restituirebbe `any` e il lint
     * fallirebbe su `no-unsafe-assignment` (max-warnings 0).
     */
    const userId: string = await commandBus.execute(
      new CreateUserCommand('mario.rossi@example.com', 'Mario', 'Rossi'),
    );

    expect(userId).toBe(GENERATED_ID);
    expect((await loadOrFail(GENERATED_ID)).userId).toBe(GENERATED_ID);
  });
});
