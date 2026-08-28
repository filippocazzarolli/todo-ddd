import { AggregateRoot } from '@nestjs/cqrs';

import {
  TodoAlreadyDoneError,
  TodoDeletedError,
  TodoNotDoneError,
  TodoNotOwnedError,
  TodoTitleRequiredError,
} from '../errors/todo.errors';
import { TodoCreatedEvent } from '../events/todo-created.event';
import { TodoDeletedEvent } from '../events/todo-deleted.event';
import { TodoMarkedAsDoneEvent } from '../events/todo-marked-as-done.event';
import { TodoReopenedEvent } from '../events/todo-reopened.event';
import { TodoChanges, TodoUpdatedEvent } from '../events/todo-updated.event';
import {
  Expiration,
  ExpirationProps,
} from '../value-objects/expiration.value-object';

/**
 * Gli stati esistenti, come tupla `as const` da cui si deriva il tipo — come
 * `USER_SUBSCRIPTIONS`, e per la stessa ragione: il tipo non sopravvive alla
 * compilazione, e serve la lista *a runtime* per riconoscere uno `status` che
 * arriva da fuori. L'unico caso oggi è il mapper della persistenza, che deve
 * distinguere un valore ammesso da una riga corrotta senza fidarsi di un cast.
 *
 * L'ordine non è un dato del dominio: non esiste uno stato "maggiore" di un
 * altro, e le due transizioni hanno metodi propri (`markAsDone`, `reopen`).
 */
export const TODO_STATUSES = ['todo', 'done'] as const;

/**
 * Ciclo di vita del todo. Union di string literal e non `enum`: i valori sono
 * già la loro rappresentazione persistita, quindi non serve un livello di
 * indirezione tra nome e valore.
 *
 * `Status` e non `State` perché `TodoProps` sta a un altro livello: lì c'è
 * *tutto* lo stato dell'aggregato, qui solo il punto in cui si trova nel suo
 * ciclo di vita.
 */
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * Forma completa e normalizzata di un todo: `CreateTodoProps` è il suo
 * sottoinsieme grezzo, senza i campi che decide l'aggregato.
 *
 * Un tipo con due ruoli: stato interno dell'aggregato e contratto verso la
 * persistenza (`snapshot()` lo produce, `rehydrate()` lo consuma).
 *
 * Restano un tipo solo anche ora che la persistenza è vera e vuole `expiration`
 * come stringa ISO: quel commento prevedeva una divisione in due tipi, e la
 * soluzione scelta è stata un'altra — la conversione sta in
 * `persistence/todo.mapper.ts`, che è un posto solo invece di un secondo tipo da
 * tenere allineato a questo.
 */
export interface TodoProps {
  todoId: string;
  /**
   * Proprietario del todo: il riferimento a un *altro* aggregato, tenuto per
   * identità e non per oggetto.
   *
   * È una `string` e non un `User` per tre ragioni che valgono insieme: un
   * aggregato annidato allargherebbe il confine transazionale a due aggregati,
   * `todo/` importerebbe da `user/` accoppiando due bounded context che oggi
   * si ignorano, e `TodoProps` è anche il contratto verso la persistenza — un
   * id è una colonna, un aggregato no.
   *
   * `ownerId` e non `userId` perché è il *ruolo* che quell'identità ha qui
   * dentro: questo modulo non conosce l'aggregato `User`, conosce
   * un'identità esterna che possiede il todo.
   *
   * Non compare in `UpdateTodoProps`: il proprietario si assegna alla
   * creazione e non cambia. Trasferire un todo ha precondizioni proprie (il
   * nuovo proprietario esiste? il vecchio perde l'accesso?) e vorrà un comando
   * dedicato con il suo evento, non un campo in un update parziale — la stessa
   * ragione per cui l'email non è in `UpdateUserProps`.
   */
  ownerId: string;
  title: string;
  status: TodoStatus;
  /**
   * Cancellazione logica. Non è un terzo valore di `TodoStatus` perché è
   * ortogonale al ciclo di vita: si cancella sia un todo aperto sia uno
   * completato, e il suo `status` resta un'informazione valida.
   */
  deleted: boolean;
  description?: string;
  important?: boolean;
  /**
   * Scadenza opzionale. È il Value Object e non le sue parti: l'invariante
   * "data e ora reali, mai nel passato" vive dentro `Expiration`, quindi uno
   * stato che compila è già uno stato valido. Immutabile, perciò può stare
   * nello stato e uscire nello `snapshot()` senza copia.
   */
  expiration?: Expiration;
  // category:
  tags?: string[];
}

/** Dati grezzi accettati dalla factory: nessun campo derivato o di lifecycle. */
export interface CreateTodoProps {
  /**
   * Identità assegnata dal chiamante tramite `TodoIdGenerator`: il dominio non
   * genera ID, così `create` resta una funzione pura e testabile senza mock.
   */
  todoId: string;
  /**
   * Proprietario, deciso dal chiamante come il `todoId`.
   *
   * Obbligatorio: un todo senza proprietario non è un todo incompleto, è un
   * todo che non esiste. Che l'utente citato *esista davvero* non è invece
   * un'invariante di questo aggregato — verificarlo richiede di guardare fuori
   * dal suo confine, quindi appartiene al vincolo di chiave esterna in
   * persistenza (vedi `TodoOwnerNotFoundError`).
   */
  ownerId: string;
  title: string;
  /**
   * Istante di riferimento, iniettato come il `todoId`: serve a `Expiration`
   * per rifiutare le scadenze nel passato senza che il dominio legga l'ora di
   * sistema. Obbligatorio anche senza `expiration` — un todo nasce in un
   * momento preciso, e renderlo opzionale renderebbe rappresentabile una
   * creazione senza "adesso" con cui confrontarsi.
   */
  now: Date;
  description?: string;
  important?: boolean;
  /** Parti grezze della scadenza: a validarle e comporle è `Expiration`. */
  expiration?: ExpirationProps;
  tags?: string[];
}

/**
 * Campi modificabili di un todo esistente, tutti opzionali: l'update è
 * parziale, non una sostituzione.
 *
 * Tre stati per ogni campo, e servono tutti e tre:
 * - chiave assente -> non toccare;
 * - valore -> assegna;
 * - `null` -> azzera (solo dove il campo è opzionale nel todo).
 *
 * `title` non ammette `null` perché non è azzerabile: un todo senza titolo non
 * esiste. `important` e `tags` non ne hanno bisogno, hanno un valore neutro
 * proprio (`false`, `[]`).
 */
export interface UpdateTodoProps {
  /**
   * Istante di riferimento, come in `CreateTodoProps`: serve a `Expiration`
   * per rifiutare le scadenze nel passato. Obbligatorio anche quando l'update
   * non tocca la scadenza — un tipo in cui si può chiedere una scadenza senza
   * un "adesso" con cui confrontarla è un tipo che permette di sbagliare.
   */
  now: Date;
  title?: string;
  /** `null` azzera; anche una stringa vuota o di soli spazi, come in `create`. */
  description?: string | null;
  important?: boolean;
  /** `null` rimuove la scadenza; le parti grezze la sostituiscono. */
  expiration?: ExpirationProps | null;
  /** Insieme completo che sostituisce quello attuale, non un delta. */
  tags?: string[];
}

/**
 * Aggregate Root del todo.
 *
 * Ciclo di vita: `todo` <-> `done`, con `deleted` come stato terminale
 * ortogonale che congela ogni ulteriore transizione.
 *
 * Ha un proprietario (`ownerId`), riferito per identità come vuole la regola
 * sui riferimenti tra aggregati. L'ownership è un dato dell'aggregato *e* la
 * base di una regola di accesso (`ensureOwnedBy`), ma non di un invariante
 * sull'esistenza del proprietario: quella verifica sta fuori dal confine
 * transazionale e appartiene alla persistenza.
 */
export class Todo extends AggregateRoot {
  private constructor(private props: TodoProps) {
    super();
  }

  /**
   * Factory: crea un todo nuovo e registra `TodoCreatedEvent`.
   *
   * Da usare solo per todo che nascono ora. Per riportare in memoria un todo
   * già persistito serve `rehydrate`, che non emette eventi.
   */
  static create(props: CreateTodoProps): Todo {
    const title = normalizeTitle(props.title);
    const description =
      props.description === undefined
        ? undefined
        : normalizeDescription(props.description);
    const important = props.important ?? false;
    const tags = normalizeTags(props.tags);
    const expiration =
      props.expiration === undefined
        ? undefined
        : Expiration.create(props.expiration, props.now);

    const todo = new Todo({
      todoId: props.todoId,
      ownerId: props.ownerId,
      title,
      status: 'todo',
      deleted: false,
      description,
      important,
      expiration,
      tags,
    });

    todo.apply(
      new TodoCreatedEvent(
        todo.props.todoId,
        todo.props.ownerId,
        title,
        important,
        tags,
        todo.props.description,
        expiration?.toISOString(),
      ),
    );

    return todo;
  }

  /**
   * Ricostruisce l'aggregato da uno stato persistito, senza emettere eventi:
   * quei fatti sono già accaduti.
   */
  static rehydrate(props: TodoProps): Todo {
    /*
     * `expiration` è ripetuto pur essendo già nello spread perché una chiave
     * assente e una a `undefined` non sono la stessa cosa per lo `snapshot()`
     * che ne deriva: così la forma dello stato non dipende da come è stato
     * costruito lo stato in ingresso.
     */
    return new Todo({
      ...props,
      expiration: props.expiration,
      tags: normalizeTags(props.tags),
    });
  }

  /**
   * Aggiorna i campi modificabili del todo ed emette `TodoUpdatedEvent` con il
   * solo delta.
   *
   * Unico vincolo di stato: il todo non deve essere cancellato. Un todo
   * completato resta modificabile — correggere il titolo di qualcosa che si è
   * già fatto è legittimo, e `done` non è uno stato terminale (esiste
   * `reopen`).
   *
   * No-op silenzioso se nessun valore cambia davvero: nessuna mutazione,
   * nessun evento. A differenza di `markAsDone`, qui non c'è conflitto da
   * segnalare — riscrivere un titolo identico non è un errore del chiamante,
   * è solo una richiesta che non ha niente da fare.
   */
  update(props: UpdateTodoProps): void {
    this.ensureNotDeleted();

    /*
     * Si valida tutto prima di mutare qualsiasi cosa: `normalizeTitle` e
     * `Expiration.create` possono lanciare, e mutando strada facendo un
     * titolo valido con una scadenza nel passato lascerebbe in memoria un
     * aggregato a metà, in uno stato che nessun comando ha chiesto. Il
     * repository non lo salverebbe, ma l'istanza è già stata corrotta.
     */
    const title =
      props.title === undefined ? undefined : normalizeTitle(props.title);
    const expiration =
      props.expiration === undefined || props.expiration === null
        ? undefined
        : Expiration.create(props.expiration, props.now);

    /*
     * Da qui in poi si legge `props.<campo> !== undefined` per sapere se il
     * campo è stato toccato, e non il valore calcolato: è l'input a portare
     * quell'informazione senza ambiguità, mentre un valore `undefined` da solo
     * non distingue "non toccato" da "azzerato".
     */
    const changes: TodoChanges = {};

    if (title !== undefined && title !== this.props.title) {
      this.props.title = title;
      changes.title = title;
    }

    if (props.description !== undefined) {
      const description = normalizeDescription(props.description);

      if (description !== this.props.description) {
        this.props.description = description;
        changes.description = description ?? null;
      }
    }

    if (
      props.important !== undefined &&
      props.important !== this.props.important
    ) {
      this.props.important = props.important;
      changes.important = props.important;
    }

    if (
      props.expiration !== undefined &&
      !sameExpiration(this.props.expiration, expiration)
    ) {
      this.props.expiration = expiration;
      changes.expiration = expiration?.toISOString() ?? null;
    }

    if (props.tags !== undefined) {
      const tags = normalizeTags(props.tags);

      if (!sameTags(this.props.tags, tags)) {
        this.props.tags = tags;
        changes.tags = tags;
      }
    }

    if (Object.keys(changes).length === 0) {
      return;
    }

    this.apply(
      new TodoUpdatedEvent(this.props.todoId, this.props.ownerId, changes),
    );
  }

  /**
   * Transizione `todo` -> `done`.
   *
   * Non è idempotente: ricompletare un todo è un errore del chiamante, non
   * un no-op silenzioso.
   */
  markAsDone(): void {
    this.ensureNotDeleted();

    if (this.props.status === 'done') {
      throw new TodoAlreadyDoneError(this.props.todoId);
    }

    this.props.status = 'done';
    this.apply(
      new TodoMarkedAsDoneEvent(this.props.todoId, this.props.ownerId),
    );
  }

  /**
   * Transizione `done` -> `todo`: inverso di `markAsDone`.
   *
   * Simmetrica anche nella severità: riaprire un todo che non è completato è
   * un errore del chiamante. La transizione è invece ripetibile quante volte
   * serve, il ciclo di vita non è a senso unico.
   */
  reopen(): void {
    this.ensureNotDeleted();

    if (this.props.status === 'todo') {
      throw new TodoNotDoneError(this.props.todoId);
    }

    this.props.status = 'todo';
    this.apply(new TodoReopenedEvent(this.props.todoId, this.props.ownerId));
  }

  /**
   * Cancella il todo.
   *
   * È una cancellazione *logica* a livello di aggregato: il flag serve
   * all'aggregato per rifiutare ogni transizione successiva finché resta in
   * memoria. Se il repository poi esegua una `DELETE` fisica o scriva un
   * tombstone è una decisione di persistenza, invisibile al dominio.
   */
  delete(): void {
    this.ensureNotDeleted();

    this.props.deleted = true;
    this.apply(new TodoDeletedEvent(this.props.todoId, this.props.ownerId));
  }

  get todoId(): string {
    return this.props.todoId;
  }

  get ownerId(): string {
    return this.props.ownerId;
  }

  get status(): TodoStatus {
    return this.props.status;
  }

  get isDone(): boolean {
    return this.props.status === 'done';
  }

  get isDeleted(): boolean {
    return this.props.deleted;
  }

  /** `undefined` se il todo non ha scadenza: è un campo opzionale. */
  get expiration(): Expiration | undefined {
    return this.props.expiration;
  }

  /**
   * Solleva `TodoNotOwnedError` se l'attore non è il proprietario.
   *
   * È l'unico controllo pubblico dell'aggregato, e la ragione è dove va
   * invocato: **in `loadTodo`**, subito dopo il caricamento e insieme al
   * `mergeObjectContext`. La regola vive qui perché è verificabile con i soli
   * dati dell'aggregato; l'invocazione sta là perché un controllo di
   * autorizzazione dimenticato fallisce in silenzio, esattamente come un merge
   * dimenticato — e la cura è la stessa, renderlo non dimenticabile mettendolo
   * nel punto obbligato del caricamento.
   *
   * L'alternativa scartata era passare l'attore a ogni metodo di comando
   * (`markAsDone(actorId)`, `update(props, actorId)`): ugualmente sicura, ma
   * mescola *chi chiede* e *cosa chiede* in cinque firme.
   *
   * Viene prima di `ensureNotDeleted`, per posizione nel flusso: chi non
   * possiede il todo non deve poter distinguere un todo cancellato da uno
   * vivo. Per la stessa ragione l'ownership non è verificata in `create` — lì
   * il proprietario *è* l'attore per costruzione.
   */
  ensureOwnedBy(actorId: string): void {
    if (actorId !== this.props.ownerId) {
      throw new TodoNotOwnedError(this.props.todoId, actorId);
    }
  }

  /**
   * Un aggregato cancellato non accetta più transizioni: la sua esistenza è
   * precondizione di qualunque altra invariante, quindi va verificata prima.
   */
  private ensureNotDeleted(): void {
    if (this.props.deleted) {
      throw new TodoDeletedError(this.props.todoId);
    }
  }

  /** Snapshot immutabile per il repository: lo stato interno non esce mai. */
  snapshot(): Readonly<TodoProps> {
    return { ...this.props, tags: [...normalizeTags(this.props.tags)] };
  }
}

/** Titolo normalizzato, o `TodoTitleRequiredError` se non ne resta nulla. */
function normalizeTitle(title: string): string {
  const trimmed = title.trim();

  if (trimmed.length === 0) {
    throw new TodoTitleRequiredError();
  }

  return trimmed;
}

/**
 * Descrizione normalizzata. `null` e una stringa di soli spazi collassano
 * entrambi su `undefined`: "assente" ha una sola rappresentazione nello stato.
 */
function normalizeDescription(description: string | null): string | undefined {
  if (description === null) {
    return undefined;
  }

  const trimmed = description.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

/** Scadenze uguali, incluso il caso in cui manchino entrambe. */
function sameExpiration(
  current: Expiration | undefined,
  next: Expiration | undefined,
): boolean {
  if (current === undefined || next === undefined) {
    return current === next;
  }

  return current.equals(next);
}

/** Uguaglianza per contenuto: entrambe le liste sono già normalizzate. */
function sameTags(
  current: readonly string[] | undefined,
  next: readonly string[],
): boolean {
  const tags = current ?? [];

  return (
    tags.length === next.length &&
    tags.every((tag, index) => tag === next[index])
  );
}

/** Tag normalizzati: trimmati, senza vuoti, senza duplicati. */
function normalizeTags(tags?: readonly string[]): string[] {
  if (tags === undefined) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
