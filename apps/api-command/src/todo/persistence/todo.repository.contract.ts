import {
  CreateTodoProps,
  INITIAL_VERSION,
  Todo,
} from '../domain/aggregates/todo.aggregate';
import { TodoDeletedError } from '../domain/errors/todo.errors';
import { TodoRepository } from '../domain/ports/todo.repository';
import {
  TodoAlreadyExistsError,
  TodoConcurrencyConflictError,
  TodoNoLongerExistsError,
} from '../domain/ports/todo.repository.errors';

/**
 * Suite di contratto di `TodoRepository`: i casi che **ogni** adapter della
 * porta deve superare, indipendentemente da dove finiscono i dati.
 *
 * Esiste perché le due spec degli adapter erano quasi identiche e stavano
 * divergendo: l'una aveva il round-trip della scadenza e i tag vuoti, l'altra
 * il congelamento dopo la cancellazione e l'aliasing dei tag — casi validi per
 * entrambi, presenti in uno solo. Un contratto scritto due volte è un contratto
 * che a un certo punto smette di essere lo stesso.
 *
 * **Non è il minimo comune denominatore.** L'obiezione a una suite parametrica
 * era che avrebbe costretto a un contratto più povero di entrambi gli adapter;
 * l'hook `seedOwner` è ciò che la disinnesca. I casi che un adapter non *può*
 * avere restano nella sua spec: la chiave esterna e le righe corrotte in
 * `drizzle-todo.repository.spec.ts`, l'isolamento fra istanze in
 * `in-memory-todo.repository.spec.ts`.
 *
 * Il file non si chiama `.spec.ts` di proposito: il `testRegex` di Jest lo
 * raccoglierebbe come suite a sé, che non contiene nessun test.
 */

export const TODO_ID = 'todo-1';
export const OTHER_TODO_ID = 'todo-2';

/** Il proprietario che il fixture ha già seminato quando il contratto parte. */
export const OWNER_ID = 'user-1';

/** Un secondo proprietario, che il caso dedicato semina con `seedOwner`. */
export const OTHER_OWNER_ID = 'user-2';

/** Istante fisso: arriva dalla porta `Clock`, nessun fake timer. */
export const NOW = new Date(2026, 0, 15, 10, 30);

/** Scadenza futura rispetto a NOW, in componenti locali come nel dominio. */
export const EXPIRATION = { date: '2026-03-01', time: '09:00' };

export function createTodoProps(
  overrides: Partial<CreateTodoProps> = {},
): CreateTodoProps {
  return {
    todoId: TODO_ID,
    ownerId: OWNER_ID,
    title: 'Comprare il latte',
    now: NOW,
    ...overrides,
  } satisfies CreateTodoProps;
}

/** Evita il narrowing di `Todo | null` in ogni test. */
export async function loadOrFail(
  repository: TodoRepository,
  todoId: string,
): Promise<Todo> {
  const todo = await repository.findById(todoId);

  if (todo === null) {
    throw new Error(`Todo ${todoId} atteso nel repository, non trovato`);
  }

  return todo;
}

/**
 * Ciò che una spec deve fornire al contratto, ricostruito a ogni test.
 *
 * `seedOwner` è l'unica concessione alle differenze fra adapter, e ce n'è una
 * sola: quello Drizzle ha una chiave esterna su `owner_id` e pretende che
 * l'utente esista, quello in memoria non vede gli utenti e non ha niente da
 * fare. Senza questo hook il caso "accetta proprietari diversi" sarebbe uscito
 * dal contratto, ed è invece una regola della porta.
 *
 * `OWNER_ID` deve essere già stato seminato quando il contratto comincia: è la
 * spec a farlo nel proprio `beforeEach`, insieme alla costruzione del
 * repository.
 */
export interface TodoRepositoryFixture {
  repository: TodoRepository;
  seedOwner(ownerId: string): Promise<void>;
}

export function describeTodoRepositoryContract(
  provide: () => TodoRepositoryFixture,
): void {
  describe('il contratto di TodoRepository', () => {
    let repository: TodoRepository;
    let seedOwner: (ownerId: string) => Promise<void>;

    /*
     * Gira dopo il `beforeEach` della spec che lo ospita — Jest esegue gli hook
     * dal describe più esterno al più interno — quindi il fixture qui è già
     * costruito.
     */
    beforeEach(() => {
      const fixture = provide();

      repository = fixture.repository;
      seedOwner = (ownerId) => fixture.seedOwner(ownerId);
    });

    it('è risolvibile come TodoRepository: la classe astratta è il token DI', () => {
      expect(repository).toBeInstanceOf(TodoRepository);
    });

    describe('findById', () => {
      it('restituisce null per un id sconosciuto', async () => {
        await expect(repository.findById('inesistente')).resolves.toBeNull();
      });

      it('restituisce un aggregato senza eventi pendenti', async () => {
        // Passa da rehydrate, non da create: altrimenti il TodoCreatedEvent
        // verrebbe ripubblicato a ogni caricamento.
        await repository.add(Todo.create(createTodoProps()));

        const caricato = await loadOrFail(repository, TODO_ID);

        expect(caricato.getUncommittedEvents()).toStrictEqual([]);
      });

      it('restituisce una nuova istanza a ogni chiamata', async () => {
        await repository.add(Todo.create(createTodoProps()));

        const primo = await loadOrFail(repository, TODO_ID);
        const secondo = await loadOrFail(repository, TODO_ID);

        expect(primo).not.toBe(secondo);

        primo.markAsDone();

        // Nessun aliasing: la modifica non salvata non contamina gli altri.
        expect(secondo.isDone).toBe(false);
        expect((await loadOrFail(repository, TODO_ID)).isDone).toBe(false);
      });

      it('restituisce anche i todo cancellati, per far decidere l’aggregato', async () => {
        const todo = Todo.create(createTodoProps());
        await repository.add(todo);
        todo.delete();
        await repository.update(todo);

        const caricato = await loadOrFail(repository, TODO_ID);

        // Se il repository li filtrasse, qui arriverebbe un "non trovato"
        // invece del TodoDeletedError dell'aggregato.
        expect(caricato.isDeleted).toBe(true);
      });
    });

    describe('add', () => {
      it('esegue il round-trip preservando tutti i campi', async () => {
        const todo = Todo.create(
          createTodoProps({
            description: 'Intero, non scremato',
            important: true,
            tags: ['casa', 'spesa'],
            expiration: EXPIRATION,
          }),
        );

        await repository.add(todo);

        // `toStrictEqual` e non `toEqual`: distingue una chiave assente da una
        // a `undefined`, che è esattamente ciò che il mapper deve preservare.
        expect(
          (await loadOrFail(repository, TODO_ID)).snapshot(),
        ).toStrictEqual(todo.snapshot());
      });

      it('esegue il round-trip anche di un todo senza campi opzionali', async () => {
        const todo = Todo.create(createTodoProps());

        await repository.add(todo);

        expect(
          (await loadOrFail(repository, TODO_ID)).snapshot(),
        ).toStrictEqual(todo.snapshot());
      });

      it('conserva la scadenza al minuto, senza secondi', async () => {
        await repository.add(
          Todo.create(createTodoProps({ expiration: EXPIRATION })),
        );

        const caricato = await loadOrFail(repository, TODO_ID);

        expect(caricato.expiration?.date).toBe(EXPIRATION.date);
        expect(caricato.expiration?.time).toBe(EXPIRATION.time);
      });

      it('conserva una scadenza già passata: rehydrate non rivalida', async () => {
        // `Expiration.create` rifiuta il passato, `rehydrate` no: altrimenti
        // ogni todo scaduto diventerebbe impossibile da ricaricare.
        await repository.add(
          Todo.create(
            createTodoProps({
              expiration: { date: '2026-01-16', time: '09:00' },
            }),
          ),
        );

        const caricato = await loadOrFail(repository, TODO_ID);

        expect(caricato.expiration?.date).toBe('2026-01-16');
      });

      it('conserva la lista dei tag vuota come lista, non come assenza', async () => {
        await repository.add(Todo.create(createTodoProps({ tags: [] })));

        expect(
          (await loadOrFail(repository, TODO_ID)).snapshot().tags,
        ).toStrictEqual([]);
      });

      it('rifiuta un id già presente con TodoAlreadyExistsError', async () => {
        await repository.add(Todo.create(createTodoProps()));

        /*
         * Sta al posto del vincolo di chiave primaria. Senza questo controllo
         * `add` sarebbe un upsert, e la riconsegna di un comando di creazione
         * riporterebbe il todo allo stato iniziale in silenzio.
         */
        await expect(
          repository.add(Todo.create(createTodoProps())),
        ).rejects.toThrow(new TodoAlreadyExistsError(TODO_ID));
      });

      it('non altera lo stato già presente quando rifiuta', async () => {
        await repository.add(Todo.create(createTodoProps()));

        const caricato = await loadOrFail(repository, TODO_ID);
        caricato.markAsDone();
        await repository.update(caricato);

        await expect(
          repository.add(Todo.create(createTodoProps({ title: 'Altro' }))),
        ).rejects.toThrow(TodoAlreadyExistsError);

        const finale = await loadOrFail(repository, TODO_ID);
        expect(finale.isDone).toBe(true);
        expect(finale.snapshot().title).toBe('Comprare il latte');
      });

      it('congela l’aggregato caricato dopo una cancellazione salvata', async () => {
        const todo = Todo.create(createTodoProps());
        await repository.add(todo);
        todo.delete();
        await repository.update(todo);

        const caricato = await loadOrFail(repository, TODO_ID);

        expect(() => caricato.markAsDone()).toThrow(TodoDeletedError);
      });

      it('non tiene il riferimento all’aggregato salvato', async () => {
        const todo = Todo.create(createTodoProps());
        await repository.add(todo);

        // Transizione applicata ma mai salvata: il repository non deve vederla.
        todo.markAsDone();

        expect((await loadOrFail(repository, TODO_ID)).isDone).toBe(false);
      });

      it('non tiene il riferimento ai tag salvati', async () => {
        const tags = ['casa'];
        await repository.add(Todo.create(createTodoProps({ tags })));

        tags.push('iniettato');

        expect(
          (await loadOrFail(repository, TODO_ID)).snapshot().tags,
        ).toStrictEqual(['casa']);
      });

      it('mantiene aggregati distinti separati', async () => {
        await repository.add(Todo.create(createTodoProps()));
        await repository.add(
          Todo.create(
            createTodoProps({
              todoId: OTHER_TODO_ID,
              title: 'Pagare bolletta',
            }),
          ),
        );

        const primo = await loadOrFail(repository, TODO_ID);
        const secondo = await loadOrFail(repository, OTHER_TODO_ID);

        expect(primo.snapshot().title).toBe('Comprare il latte');
        expect(secondo.snapshot().title).toBe('Pagare bolletta');
      });

      it('accetta proprietari diversi, purché esistano', async () => {
        await seedOwner(OTHER_OWNER_ID);

        await repository.add(Todo.create(createTodoProps()));
        await repository.add(
          Todo.create(
            createTodoProps({
              todoId: OTHER_TODO_ID,
              ownerId: OTHER_OWNER_ID,
            }),
          ),
        );

        expect((await loadOrFail(repository, OTHER_TODO_ID)).ownerId).toBe(
          OTHER_OWNER_ID,
        );
      });
    });

    describe('update', () => {
      it('sovrascrive lo stato di un aggregato esistente', async () => {
        const todo = Todo.create(createTodoProps());
        await repository.add(todo);

        todo.update({ now: NOW, title: 'Comprare il pane' });
        await repository.update(todo);

        expect((await loadOrFail(repository, TODO_ID)).snapshot().title).toBe(
          'Comprare il pane',
        );
      });

      it('persiste ogni transizione del ciclo di vita', async () => {
        await repository.add(Todo.create(createTodoProps()));

        /*
         * Ogni transizione riparte da un caricamento, e non è verbosità: con la
         * concorrenza ottimistica un'istanza che ha già scritto è indietro di
         * una versione e il secondo `update` sarebbe un conflitto. È anche il
         * modo in cui lavorano gli handler, che caricano, mutano e scrivono una
         * volta sola.
         */
        const daCompletare = await loadOrFail(repository, TODO_ID);
        daCompletare.markAsDone();
        await repository.update(daCompletare);
        expect((await loadOrFail(repository, TODO_ID)).status).toBe('done');

        const daRiaprire = await loadOrFail(repository, TODO_ID);
        daRiaprire.reopen();
        await repository.update(daRiaprire);
        expect((await loadOrFail(repository, TODO_ID)).status).toBe('todo');

        const daCancellare = await loadOrFail(repository, TODO_ID);
        daCancellare.delete();
        await repository.update(daCancellare);
        expect((await loadOrFail(repository, TODO_ID)).isDeleted).toBe(true);
      });

      it('azzera i campi opzionali, invece di lasciare il valore precedente', async () => {
        // Il caso che un UPDATE parziale sbaglierebbe in silenzio: senza
        // scrivere NULL esplicitamente, la descrizione rimossa resterebbe.
        const todo = Todo.create(
          createTodoProps({
            description: 'Da rimuovere',
            expiration: EXPIRATION,
          }),
        );
        await repository.add(todo);

        todo.update({ now: NOW, description: null, expiration: null });
        await repository.update(todo);

        const caricato = await loadOrFail(repository, TODO_ID);
        expect(caricato.snapshot().description).toBeUndefined();
        expect(caricato.snapshot().expiration).toBeUndefined();
      });

      it('riesce anche quando nessun valore cambia davvero', async () => {
        /*
         * Premessa dell'adapter SQL: SQLite conta le righe *processate*, non
         * quelle il cui contenuto cambia, quindi un UPDATE che riscrive gli
         * stessi valori conta comunque 1. Senza, `changes === 0` sarebbe un
         * falso positivo su ogni no-op invece di un segnale.
         */
        const todo = Todo.create(createTodoProps());
        await repository.add(todo);

        await expect(repository.update(todo)).resolves.toBeUndefined();
      });

      it('rifiuta un id assente con TodoNoLongerExistsError', async () => {
        /*
         * Sta al posto del conteggio delle righe toccate. Con un upsert questa
         * scrittura reinserirebbe l'aggregato, resuscitando una riga che
         * qualcun altro ha rimosso mentre la stavamo modificando.
         */
        await expect(
          repository.update(Todo.create(createTodoProps())),
        ).rejects.toThrow(new TodoNoLongerExistsError(TODO_ID));
      });

      it('non inserisce niente quando rifiuta', async () => {
        await expect(
          repository.update(Todo.create(createTodoProps())),
        ).rejects.toThrow(TodoNoLongerExistsError);

        await expect(repository.findById(TODO_ID)).resolves.toBeNull();
      });

      it('aggiorna il solo aggregato indicato', async () => {
        const primo = Todo.create(createTodoProps());
        await repository.add(primo);
        await repository.add(
          Todo.create(
            createTodoProps({
              todoId: OTHER_TODO_ID,
              title: 'Pagare bolletta',
            }),
          ),
        );

        primo.markAsDone();
        await repository.update(primo);

        expect((await loadOrFail(repository, OTHER_TODO_ID)).isDone).toBe(
          false,
        );
      });
    });

    /**
     * La concorrenza ottimistica è una regola della **porta**, non un dettaglio
     * dell'adapter SQL: sta qui, e non nella spec di Drizzle, perché i due
     * adapter devono rispondere allo stesso modo allo stesso input.
     */
    describe('la concorrenza ottimistica', () => {
      it('un aggregato appena inserito parte dalla versione iniziale', async () => {
        await repository.add(Todo.create(createTodoProps()));

        expect((await loadOrFail(repository, TODO_ID)).snapshot().version).toBe(
          INITIAL_VERSION,
        );
      });

      it('la versione avanza a ogni scrittura riuscita', async () => {
        await repository.add(Todo.create(createTodoProps()));

        const primo = await loadOrFail(repository, TODO_ID);
        primo.markAsDone();
        await repository.update(primo);

        const secondo = await loadOrFail(repository, TODO_ID);
        secondo.reopen();
        await repository.update(secondo);

        expect((await loadOrFail(repository, TODO_ID)).snapshot().version).toBe(
          INITIAL_VERSION + 2,
        );
      });

      it('rifiuta la scrittura di un aggregato caricato prima di un’altra', async () => {
        await repository.add(Todo.create(createTodoProps()));

        // Due caricamenti dalla stessa versione: è la corsa, riprodotta senza
        // bisogno di concorrenza vera.
        const primo = await loadOrFail(repository, TODO_ID);
        const secondo = await loadOrFail(repository, TODO_ID);

        primo.markAsDone();
        await repository.update(primo);

        secondo.update({ now: NOW, title: 'Comprare il pane' });

        await expect(repository.update(secondo)).rejects.toThrow(
          TodoConcurrencyConflictError,
        );
      });

      it('non applica la scrittura che rifiuta', async () => {
        await repository.add(Todo.create(createTodoProps()));

        const primo = await loadOrFail(repository, TODO_ID);
        const secondo = await loadOrFail(repository, TODO_ID);

        primo.markAsDone();
        await repository.update(primo);

        secondo.update({ now: NOW, title: 'Comprare il pane' });
        await expect(repository.update(secondo)).rejects.toThrow(
          TodoConcurrencyConflictError,
        );

        /*
         * Il punto di tutto il meccanismo: senza la versione, questo `update`
         * avrebbe riscritto l'aggregato *intero* e cancellato il `markAsDone`
         * del primo, in silenzio e senza che nessuno se ne accorgesse.
         */
        const finale = await loadOrFail(repository, TODO_ID);
        expect(finale.isDone).toBe(true);
        expect(finale.snapshot().title).toBe('Comprare il latte');
      });

      it('accetta la stessa scrittura dopo un ricaricamento', async () => {
        await repository.add(Todo.create(createTodoProps()));

        const primo = await loadOrFail(repository, TODO_ID);
        const secondo = await loadOrFail(repository, TODO_ID);

        primo.markAsDone();
        await repository.update(primo);

        secondo.update({ now: NOW, title: 'Comprare il pane' });
        await expect(repository.update(secondo)).rejects.toThrow(
          TodoConcurrencyConflictError,
        );

        // La reazione giusta del chiamante: ricaricare e ridecidere.
        const terzo = await loadOrFail(repository, TODO_ID);
        terzo.update({ now: NOW, title: 'Comprare il pane' });
        await expect(repository.update(terzo)).resolves.toBeUndefined();

        expect((await loadOrFail(repository, TODO_ID)).snapshot().title).toBe(
          'Comprare il pane',
        );
      });

      it('l’istanza che ha già scritto non è più scrivibile', async () => {
        /*
         * Conseguenza diretta del fatto che l'aggregato non incrementa la
         * propria versione: dopo un `update` è indietro di uno. Gli handler la
         * buttano subito dopo il `commit()`, ma se qualcuno provasse a
         * riusarla, il rifiuto è il comportamento voluto.
         */
        const todo = Todo.create(createTodoProps());
        await repository.add(todo);

        todo.markAsDone();
        await repository.update(todo);

        todo.reopen();
        await expect(repository.update(todo)).rejects.toThrow(
          TodoConcurrencyConflictError,
        );
      });

      it('un aggregato assente è "non esiste più", non un conflitto', async () => {
        // I due esiti nascono dallo stesso `changes === 0` e vanno distinti:
        // per il client sono rinunciare e riprovare.
        await expect(
          repository.update(Todo.create(createTodoProps())),
        ).rejects.toThrow(TodoNoLongerExistsError);
      });
    });
  });
}
