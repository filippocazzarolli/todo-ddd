import { CommandBus, CqrsModule, EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { Todo } from '../../domain/aggregates/todo.aggregate';
import {
  TodoExpirationInPastError,
  TodoTitleRequiredError,
} from '../../domain/errors/todo.errors';
import { TodoCreatedEvent } from '../../domain/events/todo-created.event';
import { Clock } from '../../domain/ports/clock';
import { TodoIdGenerator } from '../../domain/ports/todo-id.generator';
import { TodoRepository } from '../../domain/ports/todo.repository';
import { InMemoryTodoRepository } from '../../persistence/in-memory-todo.repository';
import { CreateTodoCommand } from './create-todo.command';
import { CreateTodoHandler } from './create-todo.handler';

const GENERATED_ID = 'todo-generato';

/**
 * L'attore del comando. Qui non serve a verificare l'accesso — un todo che
 * nasce non ha ancora un proprietario da confrontare — ma a diventarlo: e` la
 * sola traduzione attore -> proprietario di tutto il modulo.
 */
const OWNER_ID = 'user-1';

/**
 * Il tempo arriva dalla porta `Clock`, quindi il test lo fissa senza fake
 * timer. Componenti locali e non stringa ISO: `Expiration` interpreta data e
 * ora nel fuso del processo (vedi lo spec dell'aggregato).
 */
const NOW = new Date(2026, 0, 15, 10, 30, 45);

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

async function loadOrFail(
  repository: TodoRepository,
  todoId: string,
): Promise<Todo> {
  const todo = await repository.findById(todoId);

  if (todo === null) {
    throw new Error(`Todo ${todoId} atteso nel repository, non trovato`);
  }

  return todo;
}

describe('CreateTodoHandler', () => {
  let moduleRef: TestingModule;
  let handler: CreateTodoHandler;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let repository: InMemoryTodoRepository;
  const todoIds = { next: jest.fn(() => GENERATED_ID) };
  const clock = { now: jest.fn(() => NOW) };

  beforeEach(async () => {
    todoIds.next.mockClear();
    clock.now.mockClear();

    moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        CreateTodoHandler,
        { provide: TodoRepository, useClass: InMemoryTodoRepository },
        { provide: TodoIdGenerator, useValue: todoIds },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    // init() fa registrare l'handler sul CommandBus dall'ExplorerService.
    await moduleRef.init();

    handler = moduleRef.get(CreateTodoHandler);
    commandBus = moduleRef.get(CommandBus);
    eventBus = moduleRef.get(EventBus);
    repository = moduleRef.get<InMemoryTodoRepository>(TodoRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('restituisce l`id prodotto dal generatore, chiamandolo una volta sola', async () => {
    const todoId = await handler.execute(
      new CreateTodoCommand(OWNER_ID, 'Comprare il latte'),
    );

    expect(todoId).toBe(GENERATED_ID);
    expect(todoIds.next).toHaveBeenCalledTimes(1);
  });

  it('persiste l`aggregato nello stato iniziale', async () => {
    await handler.execute(new CreateTodoCommand(OWNER_ID, 'Comprare il latte'));

    expect(
      (await loadOrFail(repository, GENERATED_ID)).snapshot(),
    ).toStrictEqual({
      todoId: GENERATED_ID,
      ownerId: OWNER_ID,
      title: 'Comprare il latte',
      status: 'todo',
      deleted: false,
      description: undefined,
      important: false,
      expiration: undefined,
      tags: [],
    });
  });

  it('non pre-elabora l`input: la normalizzazione resta nell`aggregato', async () => {
    await handler.execute(
      new CreateTodoCommand(
        OWNER_ID,
        '  Comprare il latte  ',
        '  intero  ',
        true,
        [' casa ', 'casa', ''],
      ),
    );

    expect(
      (await loadOrFail(repository, GENERATED_ID)).snapshot(),
    ).toMatchObject({
      title: 'Comprare il latte',
      description: 'intero',
      important: true,
      tags: ['casa'],
    });
  });

  it('assegna l`attore del comando come proprietario del todo', async () => {
    // L'unica traduzione attore -> proprietario del modulo: negli altri
    // handler l'attore serve solo a verificare l'accesso.
    await handler.execute(
      new CreateTodoCommand('user-42', 'Comprare il latte'),
    );

    expect((await loadOrFail(repository, GENERATED_ID)).ownerId).toBe(
      'user-42',
    );
  });

  it('non verifica che l`utente esista: il vincolo sta in persistenza', async () => {
    // `TodoOwnerNotFoundError` e` dichiarato dalla porta ma nessun adapter lo
    // solleva: finche` la persistenza e` in memoria, un todo orfano e`
    // rappresentabile. L'handler non interroga `UserRepository` di proposito,
    // per non accoppiare i due bounded context sul lato write.
    await expect(
      handler.execute(
        new CreateTodoCommand('utente-inesistente', 'Comprare il latte'),
      ),
    ).resolves.toBe(GENERATED_ID);
  });

  it('pubblica TodoCreatedEvent sull`EventBus', async () => {
    /*
     * Gli eventi vanno copiati al momento della chiamata: `commit()` passa a
     * `publishAll` il proprio array interno e subito dopo lo azzera con
     * `.length = 0`, quindi `mock.calls` conserverebbe un riferimento vuoto.
     */
    const published: unknown[] = [];
    const publishAll = jest
      .spyOn(eventBus, 'publishAll')
      .mockImplementation((events: unknown[]) => {
        published.push(...events);
        return [];
      });

    await handler.execute(new CreateTodoCommand(OWNER_ID, 'Comprare il latte'));

    expect(publishAll).toHaveBeenCalledTimes(1);
    expect(published).toStrictEqual([
      new TodoCreatedEvent(
        GENERATED_ID,
        OWNER_ID,
        'Comprare il latte',
        false,
        [],
        undefined,
      ),
    ]);
  });

  it('pubblica dopo aver persistito, non prima', async () => {
    const write = jest.spyOn(repository, 'add');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await handler.execute(new CreateTodoCommand(OWNER_ID, 'Comprare il latte'));

    expect(firstCallOrder(write)).toBeLessThan(firstCallOrder(publishAll));
  });

  it('propaga l`errore di dominio senza persistere né pubblicare', async () => {
    const write = jest.spyOn(repository, 'add');
    const publishAll = jest.spyOn(eventBus, 'publishAll');

    await expect(
      handler.execute(new CreateTodoCommand(OWNER_ID, '   ')),
    ).rejects.toThrow(TodoTitleRequiredError);

    expect(write).not.toHaveBeenCalled();
    expect(publishAll).not.toHaveBeenCalled();
    await expect(repository.findById(GENERATED_ID)).resolves.toBeNull();
  });

  it('passa la scadenza all`aggregato senza comporla né validarla', async () => {
    await handler.execute(
      new CreateTodoCommand(
        OWNER_ID,
        'Comprare il latte',
        undefined,
        undefined,
        [],
        {
          date: '2026-01-15',
          time: '11:30',
        },
      ),
    );

    const todo = await loadOrFail(repository, GENERATED_ID);

    expect(todo.expiration?.toString()).toBe('2026-01-15 11:30');
    // L'istante di riferimento viene chiesto al Clock, non letto dal dominio.
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it('propaga il rifiuto della scadenza nel passato senza persistere', async () => {
    const write = jest.spyOn(repository, 'add');

    await expect(
      handler.execute(
        new CreateTodoCommand(
          OWNER_ID,
          'Comprare il latte',
          undefined,
          undefined,
          [],
          {
            date: '2026-01-15',
            time: '09:00',
          },
        ),
      ),
    ).rejects.toThrow(TodoExpirationInPastError);

    expect(write).not.toHaveBeenCalled();
    await expect(repository.findById(GENERATED_ID)).resolves.toBeNull();
  });

  it('è raggiungibile dal CommandBus con le classi astratte come token DI', async () => {
    /*
     * L'annotazione `: string` è essa stessa un test: se `Command<string>` non
     * tipizzasse il risultato, `execute` restituirebbe `any` e il lint
     * fallirebbe su `no-unsafe-assignment` (max-warnings 0).
     */
    const todoId: string = await commandBus.execute(
      new CreateTodoCommand(OWNER_ID, 'Comprare il latte'),
    );

    expect(todoId).toBe(GENERATED_ID);
    expect((await loadOrFail(repository, GENERATED_ID)).todoId).toBe(
      GENERATED_ID,
    );
  });
});
