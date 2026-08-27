import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { ChangeUserSubscriptionCommand } from '../application/commands/change-user-subscription.command';
import { CreateUserCommand } from '../application/commands/create-user.command';
import { DeleteUserCommand } from '../application/commands/delete-user.command';
import { UpdateUserCommand } from '../application/commands/update-user.command';
import { ChangeSubscriptionBody } from './dto/change-subscription.body';
import { CreateUserBody } from './dto/create-user.body';
import { UpdateUserBody } from './dto/update-user.body';
import { USER_VALIDATION } from './user-validation';
import { UserController } from './user.controller';

const USER_ID = 'user-1';
const EMAIL = 'mario.rossi@example.com';

describe('UserController', () => {
  const commands = { execute: jest.fn() };
  let controller: UserController;

  /** Il body arriva già validato: qui si testa la sola traduzione. */
  function createBody(overrides: Partial<CreateUserBody> = {}): CreateUserBody {
    return Object.assign(new CreateUserBody(), {
      email: EMAIL,
      firstName: 'Mario',
      lastName: 'Rossi',
      ...overrides,
    });
  }

  beforeEach(() => {
    commands.execute.mockReset();
    commands.execute.mockResolvedValue(undefined);
    controller = new UserController(commands as unknown as CommandBus);
  });

  describe('create', () => {
    it('costruisce il command e restituisce l`id prodotto dall`handler', async () => {
      commands.execute.mockResolvedValue('user-generato');

      await expect(controller.create(createBody())).resolves.toStrictEqual({
        userId: 'user-generato',
      });
    });

    it('passa i campi nell`ordine posizionale del command', async () => {
      await controller.create(createBody({ subscription: 'pro' }));

      expect(commands.execute).toHaveBeenCalledWith(
        new CreateUserCommand(EMAIL, 'Mario', 'Rossi', 'pro'),
      );
    });

    it('non inventa default per il piano assente: lo decide l`aggregato', async () => {
      await controller.create(createBody());

      expect(commands.execute).toHaveBeenCalledWith(
        new CreateUserCommand(EMAIL, 'Mario', 'Rossi', undefined),
      );
    });

    it('non normalizza l`email: è lavoro del Value Object', async () => {
      await controller.create(createBody({ email: '  MARIO@Example.COM  ' }));

      const [command] = commands.execute.mock.calls[0] as [CreateUserCommand];

      expect(command.email).toBe('  MARIO@Example.COM  ');
    });
  });

  describe('update', () => {
    it('costruisce il command con id e campi', async () => {
      const body = Object.assign(new UpdateUserBody(), {
        firstName: 'Luigi',
        lastName: 'Verdi',
      });

      await controller.update(USER_ID, body);

      expect(commands.execute).toHaveBeenCalledWith(
        new UpdateUserCommand(USER_ID, {
          firstName: 'Luigi',
          lastName: 'Verdi',
        }),
      );
    });

    it('copia il body in un oggetto piano: il command resta serializzabile', async () => {
      const body = Object.assign(new UpdateUserBody(), { firstName: 'Luigi' });

      await controller.update(USER_ID, body);

      const [command] = commands.execute.mock.calls[0] as [UpdateUserCommand];

      expect(command.fields).not.toBeInstanceOf(UpdateUserBody);
      expect(command.fields).not.toBe(body);
    });
  });

  it('changeSubscription costruisce il command con id e piano', async () => {
    const body = Object.assign(new ChangeSubscriptionBody(), {
      subscription: 'standard' as const,
    });

    await controller.changeSubscription(USER_ID, body);

    expect(commands.execute).toHaveBeenCalledWith(
      new ChangeUserSubscriptionCommand(USER_ID, 'standard'),
    );
  });

  it('delete costruisce il command con il solo userId', async () => {
    await controller.delete(USER_ID);

    expect(commands.execute).toHaveBeenCalledWith(
      new DeleteUserCommand(USER_ID),
    );
  });
});

/**
 * Il pipe è costruito con le stesse `USER_VALIDATION` del controller: testarlo
 * con opzioni diverse da quelle in produzione non proverebbe niente.
 */
describe('ValidationPipe del modulo user', () => {
  const pipe = new ValidationPipe(USER_VALIDATION);

  function bodyMetadata(metatype: ArgumentMetadata['metatype']) {
    return { type: 'body', metatype } satisfies ArgumentMetadata;
  }

  async function validate(
    metatype: ArgumentMetadata['metatype'],
    value: unknown,
  ): Promise<unknown> {
    return pipe.transform(value, bodyMetadata(metatype));
  }

  describe('CreateUserBody', () => {
    it('accetta il body minimo', async () => {
      await expect(
        validate(CreateUserBody, {
          email: EMAIL,
          firstName: 'Mario',
          lastName: 'Rossi',
        }),
      ).resolves.toMatchObject({ email: EMAIL });
    });

    it.each(['free', 'standard', 'pro'])(
      'accetta il piano %s',
      async (subscription) => {
        await expect(
          validate(CreateUserBody, {
            email: EMAIL,
            firstName: 'Mario',
            lastName: 'Rossi',
            subscription,
          }),
        ).resolves.toMatchObject({ subscription });
      },
    );

    it('lascia passare un`email malformata: a rifiutarla è il dominio', async () => {
      /*
       * Nessun `@IsEmail()`, per scelta: la regola vive in `Email.create`, che
       * solleva `UserEmailInvalidError` e il filtro traduce in 400. Il confine
       * HTTP valida tipi e forma, non il significato.
       */
      await expect(
        validate(CreateUserBody, {
          email: 'mario',
          firstName: 'Mario',
          lastName: 'Rossi',
        }),
      ).resolves.toMatchObject({ email: 'mario' });
    });

    it.each([
      ['email assente', { firstName: 'Mario', lastName: 'Rossi' }],
      ['email non stringa', { email: 1, firstName: 'M', lastName: 'R' }],
      ['email null', { email: null, firstName: 'M', lastName: 'R' }],
      ['firstName assente', { email: EMAIL, lastName: 'Rossi' }],
      ['lastName assente', { email: EMAIL, firstName: 'Mario' }],
      ['firstName null', { email: EMAIL, firstName: null, lastName: 'R' }],
      [
        'piano inesistente',
        { email: EMAIL, firstName: 'M', lastName: 'R', subscription: 'gold' },
      ],
      [
        'piano null',
        { email: EMAIL, firstName: 'M', lastName: 'R', subscription: null },
      ],
      [
        'campo sconosciuto',
        { email: EMAIL, firstName: 'M', lastName: 'R', nome: 'Mario' },
      ],
      [
        'campo di stato interno',
        { email: EMAIL, firstName: 'M', lastName: 'R', deleted: false },
      ],
    ])('rifiuta: %s', async (_label, body) => {
      await expect(validate(CreateUserBody, body)).rejects.toThrow();
    });
  });

  describe('UpdateUserBody', () => {
    it('accetta un body vuoto', async () => {
      await expect(validate(UpdateUserBody, {})).resolves.toBeDefined();
    });

    it.each([
      ['solo firstName', { firstName: 'Luigi' }],
      ['solo lastName', { lastName: 'Verdi' }],
      ['entrambi', { firstName: 'Luigi', lastName: 'Verdi' }],
    ])('accetta %s', async (_label, body) => {
      await expect(validate(UpdateUserBody, body)).resolves.toMatchObject(body);
    });

    it.each([
      ['firstName', { firstName: null }],
      ['lastName', { lastName: null }],
    ])('rifiuta null su %s, che non è azzerabile', async (_label, body) => {
      await expect(validate(UpdateUserBody, body)).rejects.toThrow();
    });

    it.each([
      ['email', { email: 'altra@example.com' }],
      ['subscription', { subscription: 'pro' }],
    ])(
      'rifiuta %s: ha la sua rotta, e ignorarla in silenzio sarebbe peggio',
      async (_label, body) => {
        await expect(validate(UpdateUserBody, body)).rejects.toThrow();
      },
    );
  });

  describe('ChangeSubscriptionBody', () => {
    it.each(['free', 'standard', 'pro'])('accetta %s', async (subscription) => {
      await expect(
        validate(ChangeSubscriptionBody, { subscription }),
      ).resolves.toMatchObject({ subscription });
    });

    it.each([
      ['piano inesistente', { subscription: 'gold' }],
      ['piano assente', {}],
      ['piano null', { subscription: null }],
      ['piano non stringa', { subscription: 1 }],
      ['campo sconosciuto', { subscription: 'pro', piano: 'free' }],
    ])('rifiuta: %s', async (_label, body) => {
      await expect(validate(ChangeSubscriptionBody, body)).rejects.toThrow();
    });
  });
});
