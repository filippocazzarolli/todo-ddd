import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CreateTodoCommand } from '../application/commands/create-todo.command';
import { DeleteTodoCommand } from '../application/commands/delete-todo.command';
import { MarkTodoAsDoneCommand } from '../application/commands/mark-todo-as-done.command';
import { ReopenTodoCommand } from '../application/commands/reopen-todo.command';
import { UpdateTodoCommand } from '../application/commands/update-todo.command';
import { CreateTodoBody } from './dto/create-todo.body';
import { ExpirationBody } from './dto/expiration.body';
import { UpdateTodoBody } from './dto/update-todo.body';
import { TodoController } from './todo.controller';
import { TODO_VALIDATION } from './todo-validation';

const TODO_ID = 'todo-1';

/**
 * L'attore arriva da `@Actor()`, non dal body: qui il decorator e` gia` stato
 * risolto e il controller lo riceve come primo parametro.
 */
const ACTOR_ID = 'user-1';
const EXPIRATION = { date: '2026-01-15', time: '11:30' };

describe('TodoController', () => {
  const commands = { execute: jest.fn() };
  let controller: TodoController;

  /** Il body arriva già validato: qui si testa la sola traduzione. */
  function createBody(overrides: Partial<CreateTodoBody> = {}): CreateTodoBody {
    return Object.assign(new CreateTodoBody(), {
      title: 'Comprare il latte',
      ...overrides,
    });
  }

  beforeEach(() => {
    commands.execute.mockReset();
    commands.execute.mockResolvedValue(undefined);
    controller = new TodoController(commands as unknown as CommandBus);
  });

  describe('create', () => {
    it('costruisce il command e restituisce l`id prodotto dall`handler', async () => {
      commands.execute.mockResolvedValue('todo-generato');

      await expect(
        controller.create(ACTOR_ID, createBody()),
      ).resolves.toStrictEqual({
        todoId: 'todo-generato',
      });
    });

    it('passa i campi nell`ordine posizionale del command', async () => {
      await controller.create(
        ACTOR_ID,
        createBody({
          description: 'intero',
          important: true,
          tags: ['casa'],
          expiration: Object.assign(new ExpirationBody(), EXPIRATION),
        }),
      );

      expect(commands.execute).toHaveBeenCalledWith(
        new CreateTodoCommand(
          ACTOR_ID,
          'Comprare il latte',
          'intero',
          true,
          ['casa'],
          EXPIRATION,
        ),
      );
    });

    it('non inventa default per i campi assenti: li decide l`aggregato', async () => {
      await controller.create(ACTOR_ID, createBody());

      expect(commands.execute).toHaveBeenCalledWith(
        new CreateTodoCommand(
          ACTOR_ID,
          'Comprare il latte',
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      );
    });
  });

  describe('update', () => {
    it('costruisce il command con il todoId della rotta e i campi del body', async () => {
      const body = Object.assign(new UpdateTodoBody(), {
        title: 'Comprare il pane',
        description: null,
      });

      await controller.update(ACTOR_ID, TODO_ID, body);

      expect(commands.execute).toHaveBeenCalledWith(
        new UpdateTodoCommand(ACTOR_ID, TODO_ID, {
          title: 'Comprare il pane',
          description: null,
          important: undefined,
          expiration: undefined,
          tags: undefined,
        }),
      );
    });

    it('copia il body in un oggetto piano: il command resta serializzabile', async () => {
      const body = Object.assign(new UpdateTodoBody(), { title: 'X' });

      await controller.update(ACTOR_ID, TODO_ID, body);

      const [command] = commands.execute.mock.calls[0] as [UpdateTodoCommand];

      expect(command.fields).not.toBeInstanceOf(UpdateTodoBody);
      expect(command.fields).not.toBe(body);
    });
  });

  /*
   * Tre test separati e non un `it.each` sui nomi dei metodi: indicizzare il
   * controller con una stringa costringerebbe a un cast, e un cast in un test
   * di traduzione nasconde proprio l'errore che il test dovrebbe trovare.
   */
  it('markAsDone costruisce il command con attore e todoId', async () => {
    await controller.markAsDone(ACTOR_ID, TODO_ID);

    expect(commands.execute).toHaveBeenCalledWith(
      new MarkTodoAsDoneCommand(ACTOR_ID, TODO_ID),
    );
  });

  it('reopen costruisce il command con attore e todoId', async () => {
    await controller.reopen(ACTOR_ID, TODO_ID);

    expect(commands.execute).toHaveBeenCalledWith(
      new ReopenTodoCommand(ACTOR_ID, TODO_ID),
    );
  });

  it('delete costruisce il command con attore e todoId', async () => {
    await controller.delete(ACTOR_ID, TODO_ID);

    expect(commands.execute).toHaveBeenCalledWith(
      new DeleteTodoCommand(ACTOR_ID, TODO_ID),
    );
  });
});

/**
 * Il pipe è costruito con le stesse `TODO_VALIDATION` del controller: testarlo
 * con opzioni diverse da quelle in produzione non proverebbe niente.
 */
describe('ValidationPipe del modulo todo', () => {
  const pipe = new ValidationPipe(TODO_VALIDATION);

  function bodyMetadata(metatype: ArgumentMetadata['metatype']) {
    return { type: 'body', metatype } satisfies ArgumentMetadata;
  }

  async function validate(
    metatype: ArgumentMetadata['metatype'],
    value: unknown,
  ): Promise<unknown> {
    return pipe.transform(value, bodyMetadata(metatype));
  }

  describe('CreateTodoBody', () => {
    it('accetta il body minimo', async () => {
      await expect(
        validate(CreateTodoBody, { title: 'Comprare il latte' }),
      ).resolves.toMatchObject({ title: 'Comprare il latte' });
    });

    it('trasforma la scadenza annidata nella sua classe', async () => {
      const result = await validate(CreateTodoBody, {
        title: 'Comprare il latte',
        expiration: EXPIRATION,
      });

      // Senza `transform` + `@Type`, `@ValidateNested` non avrebbe una classe
      // su cui validare e l'oggetto passerebbe senza controlli.
      expect((result as CreateTodoBody).expiration).toBeInstanceOf(
        ExpirationBody,
      );
    });

    it.each([
      ['title non stringa', { title: 123 }],
      ['title assente', {}],
      ['title null', { title: null }],
      ['campo sconosciuto', { title: 'x', titolo: 'y' }],
      ['tags non array', { title: 'x', tags: 'casa' }],
      ['tags con elementi non stringa', { title: 'x', tags: [1] }],
      ['important non booleano', { title: 'x', important: 'si' }],
      ['description null', { title: 'x', description: null }],
      [
        'scadenza senza time',
        { title: 'x', expiration: { date: '2026-01-15' } },
      ],
      [
        'scadenza con campo in eccesso',
        { title: 'x', expiration: { ...EXPIRATION, ora: '11:30' } },
      ],
    ])('rifiuta: %s', async (_label, body) => {
      await expect(validate(CreateTodoBody, body)).rejects.toThrow();
    });
  });

  describe('UpdateTodoBody', () => {
    it('accetta un body vuoto', async () => {
      await expect(validate(UpdateTodoBody, {})).resolves.toBeDefined();
    });

    it.each([
      ['description', { description: null }],
      ['expiration', { expiration: null }],
    ])('accetta null su %s, che è azzerabile', async (_label, body) => {
      await expect(validate(UpdateTodoBody, body)).resolves.toMatchObject(body);
    });

    it.each([
      ['title', { title: null }],
      ['important', { important: null }],
      ['tags', { tags: null }],
    ])('rifiuta null su %s, che non è azzerabile', async (_label, body) => {
      await expect(validate(UpdateTodoBody, body)).rejects.toThrow();
    });
  });
});
