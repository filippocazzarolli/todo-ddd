# Modulo `todo` — lato write

Implementazione DDD dell'aggregato `Todo`: il lato **command** dello split CQRS.
Qui si scrive e si decide; leggere, filtrare ed elencare è di `api-query`.

Tutto il modulo è composto in [`todo.module.ts`](./todo.module.ts) e non ha
dipendenze verso altri moduli dell'app.

## La regola di dipendenza

Le frecce vanno **solo verso il basso**. Nessun file di `domain/` importa da una
qualunque delle altre cartelle: cancellando `presentation/`, `application/`,
`persistence/` e `infrastructure/`, la cartella `domain/` deve continuare a
compilare da sola.

```
presentation/     HTTP: rotte, DTO, validazione di forma, mappatura errori
      |
      v
application/      orchestrazione: command, handler, caricamento aggregato
      |
      v
   domain/        <-- non importa da nessuna cartella sopra o sotto
      ^
      |
persistence/      adapter di TodoRepository
infrastructure/   adapter di Clock e TodoIdGenerator
```

Le **porte** (`domain/ports/`) vivono nel dominio perché è il dominio a
possedere il contratto; gli adapter stanno fuori e lo implementano. È questo
che rende sostituibile la persistenza senza toccare una riga di logica.

## Il flusso di un comando

Creazione — l'unico caso in cui l'aggregato nasce invece di essere caricato:

```
HTTP POST /todos
  -> TodoController                 traduce body -> CreateTodoCommand
  -> CommandBus                     trova l'handler dal tipo del command
  -> CreateTodoHandler              todoId da TodoIdGenerator, now da Clock
  -> Todo.create(...)               valida le invarianti, registra l'evento
  -> TodoRepository.add(todo)       prima si persiste...
  -> todo.commit()                  ...poi si pubblica sull'EventBus
  -> 201 { todoId }
```

Ogni altro comando carica l'aggregato invece di costruirlo:

```
HTTP PATCH /todos/:todoId
  -> TodoController                 -> UpdateTodoCommand(todoId, fields)
  -> UpdateTodoHandler
  -> loadTodo(...)                  findById + mergeObjectContext, o TodoNotFoundError
  -> todo.update(...)               decide cosa è cambiato davvero
  -> TodoRepository.update(todo)
  -> todo.commit()
  -> 204
```

Gli errori non vengono catturati da nessuno lungo la catena: risalgono fino a
`TodoErrorFilter`, che li traduce in status HTTP. Un comando che fallisce non
persiste e non pubblica niente.

## Il modello di dominio

L'aggregato è in [`domain/aggregates/todo.aggregate.ts`](./domain/aggregates/todo.aggregate.ts).

**Ciclo di vita**: `todo` <-> `done`, con `deleted` come stato terminale
**ortogonale** che congela ogni transizione. `deleted` non è un terzo valore di
`TodoStatus` proprio perché è ortogonale: si cancella sia un todo aperto sia
uno completato, e il suo `status` resta un'informazione valida.

**Invarianti, tutte dentro l'aggregato o nei suoi Value Object**:

- il titolo, trimmato, non può essere vuoto;
- i tag sono trimmati, senza vuoti e senza duplicati;
- la descrizione vuota o di soli spazi è `undefined`: "assente" ha una sola
  rappresentazione;
- la scadenza è una data e ora reale e non può essere assegnata nel passato;
- un todo cancellato non accetta nessun comando;
- completare un todo già completato, o riaprirne uno aperto, è un errore — non
  un no-op.

**`Expiration`** ([`domain/value-objects/`](./domain/value-objects/expiration.value-object.ts))
è un Value Object immutabile su un singolo istante con precisione al minuto,
interpretato nel fuso del processo. `create` rifiuta il passato, `rehydrate`
no: "non nel passato" è una regola sull'**assegnazione**, non un'invariante
permanente — altrimenti ogni todo scaduto diventerebbe impossibile da
ricaricare.

**`create` vs `rehydrate`**: la factory è per i todo che nascono ora e registra
`TodoCreatedEvent`; `rehydrate` ricostruisce da uno stato persistito e non
emette niente, perché quei fatti sono già accaduti. `snapshot()` è la direzione
opposta, ed è l'unico modo in cui lo stato esce dall'aggregato.

## Comandi ed eventi

| Rotta                        | Command                 | Metodo di dominio | Evento                  |
| ---------------------------- | ----------------------- | ----------------- | ----------------------- |
| `POST /todos`                | `CreateTodoCommand`     | `Todo.create`     | `TodoCreatedEvent`      |
| `PATCH /todos/:todoId`       | `UpdateTodoCommand`     | `update`          | `TodoUpdatedEvent`      |
| `POST /todos/:todoId/done`   | `MarkTodoAsDoneCommand` | `markAsDone`      | `TodoMarkedAsDoneEvent` |
| `POST /todos/:todoId/reopen` | `ReopenTodoCommand`     | `reopen`          | `TodoReopenedEvent`     |
| `DELETE /todos/:todoId`      | `DeleteTodoCommand`     | `delete`          | `TodoDeletedEvent`      |

`CreateTodoCommand` è l'unico `Command<string>`: restituisce il `todoId` perché
è il server a generarlo. Gli altri sono `Command<void>` e ricevono l'id dalla
rotta.

Le rotte sono per **intenzione** e non per stato della risorsa (`POST
/:id/reopen`, non `PUT /:id/done` con `false`): i due casi hanno esiti diversi
e appiattirli su una scrittura di campo li renderebbe indistinguibili sia in
ingresso sia nell'evento.

`TodoUpdatedEvent` porta il **delta** e non lo stato completo: chiave assente
significa "non toccato", `null` significa "azzerato". Un update che non cambia
niente non emette nessun evento.

## Porte e adapter

| Porta             | Adapter                  | Perché è una porta                           |
| ----------------- | ------------------------ | -------------------------------------------- |
| `TodoRepository`  | `InMemoryTodoRepository` | la persistenza è sostituibile                |
| `TodoIdGenerator` | `UuidTodoIdGenerator`    | `create` resta una funzione pura e testabile |
| `Clock`           | `SystemClock`            | il dominio non legge mai l'ora di sistema    |

La superficie del repository è deliberatamente minima: `findById`, `add`,
`update`. Nessuna ricerca, nessun filtro, nessun elenco — appartengono al read
model, e un `findByStatus` qui renderebbe decorativo lo split CQRS. Nessuna
rimozione: la cancellazione è un cambio di stato, quindi passa per `update`.

## Errori e status HTTP

Tre gerarchie separate, perché la mappatura a valle deve poterle distinguere:

| Gerarchia                                           | Significato                          | Status |
| --------------------------------------------------- | ------------------------------------ | ------ |
| `TodoDomainError` (invariante violata)              | input rifiutato dal dominio          | 400    |
| ┗ `TodoAlreadyDone` / `NotDone` / `Deleted`         | conflitto con lo stato attuale       | 409    |
| `TodoNotFoundError` (application)                   | il comando cita qualcosa che non c'è | 404    |
| `TodoPersistenceError` (`AlreadyExists`/`NoLonger`) | scrittura andata a vuoto             | 409    |

La traduzione è in [`presentation/todo-error.filter.ts`](./presentation/todo-error.filter.ts),
registrato sul controller e non globalmente. Il body porta
`error.constructor.name` come discriminante leggibile dalla macchina: un 409
può essere tre cose diverse, e la reazione giusta del client cambia.

Un errore di dominio nuovo, non elencato nel filtro, diventa **400 e non 500**:
è sempre colpa del chiamante, mai del server.

## Sette decisioni non ovvie

Sono i punti in cui il codice sembra più complicato del necessario, e non lo è.

**1. `mergeObjectContext` è obbligatorio.** `AggregateRoot.publishAll` di base è
un metodo vuoto: un aggregato non mergiato scarta i suoi eventi al `commit()`
**senza lanciare niente**, e te ne accorgi solo perché il read model non si
aggiorna mai. Per questo `loadTodo` fa il merge insieme al caricamento: così non
si può dimenticare.

**2. Le porte sono `abstract class`, non `interface` + `Symbol`.** Servono token
DI risolvibili a runtime. Con `isolatedModules: true` un tipo importato con
`import type` non emette metadata e la DI per costruttore si rompe in silenzio:
le classi iniettate vanno importate con import normali.

**3. Il dominio non legge l'ora di sistema.** `now` arriva sempre dall'esterno
(porta `Clock`), come il `todoId`. Conseguenza: nessun test del dominio usa fake
timer, e i test costruiscono le date da **componenti locali**
(`new Date(2026, 0, 15, 10, 30)`) e non da stringhe ISO, perché `Expiration`
interpreta data e ora nel fuso del processo — così la suite è indipendente dal
`TZ` della macchina.

**4. Prima si persiste, poi si pubblica.** In quest'ordine, in tutti gli
handler: il read model non deve vedere una write che potrebbe essere fallita.
Non è ancora atomico — serve un outbox, vedi _Cosa manca_.

**5. `add` e `update`, non un `save` unico.** Un upsert cancella due segnali che
servono: l'inserimento di un id duplicato (che è la base dell'idempotenza sulle
retry) e la scrittura su un aggregato scomparso. È anche il punto dove entrerà
la concorrenza ottimistica: `UPDATE ... WHERE version = ?` che non tocca righe è
un conflitto, mentre in un upsert diventa un insert silenzioso.

**6. L'update ha tre stati per campo, non due.** Chiave assente = non toccare,
valore = assegna, `null` = azzera. Con il solo `undefined` le prime due
sarebbero indistinguibili. I tre stati sopravvivono dal JSON fino
all'aggregato — da cui `@WhenPresent()` accanto a `@IsOptional()` nei DTO, che
salta la validazione anche per `null`.

**7. Il confine HTTP valida tipi e forma, il dominio valida il significato.**
Nessun `@IsNotEmpty()` su `title` e nessun `@Matches` sul formato della data: il
titolo obbligatorio e il formato della scadenza sono regole di dominio, e
duplicarle nei DTO creerebbe una seconda verità da tenere allineata. Entrambe
finiscono in un 400 comunque.

Un ottavo punto che non è una decisione ma una trappola: **`Todo.update` valida
tutto prima di mutare qualsiasi cosa**. Mutando campo per campo, un update con
titolo valido e scadenza nel passato lascerebbe l'aggregato in memoria a metà —
uno stato che nessun comando ha chiesto e che il repository non salverebbe mai.

## Aggiungere un comando

Nell'ordine, perché ogni passo si appoggia al precedente:

1. **Il comportamento nel dominio**: un metodo sull'aggregato che verifica le
   sue precondizioni (`ensureNotDeleted()` per primo), muta lo stato e chiama
   `this.apply(...)`. Se serve un errore nuovo, va in `domain/errors/`.
2. **L'evento** in `domain/events/`: serializzabile, solo dati primitivi — può
   attraversare una coda verso `api-query`.
3. **Il command** in `application/commands/`: DTO immutabile che `extends
Command<void>` (o `Command<T>` se deve restituire qualcosa), senza logica e
   senza conoscere l'aggregato.
4. **L'handler**: `loadTodo` -> metodo -> `update` -> `commit`. Cinque righe, e
   nessuna regola. Se ti serve un `if` sullo stato dell'aggregato, la regola è
   nel posto sbagliato.
5. **La registrazione** in `todo.module.ts`, tra i `providers`.
6. **La rotta** nel controller, con il DTO se ha un body.
7. **I test**: dominio (invarianti ed eventi registrati), handler (persistenza,
   pubblicazione, ordine, propagazione degli errori), e-2-e per lo status HTTP.

## Test

217 test unitari sul modulo più 17 e2e, divisi per quello che possono provare:

| Dove                              | Cosa verifica                                                         |
| --------------------------------- | --------------------------------------------------------------------- |
| `domain/**/*.spec.ts`             | invarianti, transizioni, eventi registrati — zero mock                |
| `application/**/*.spec.ts`        | orchestrazione: cosa viene persistito, cosa pubblicato, in che ordine |
| `persistence/`, `infrastructure/` | il contratto delle porte lato adapter                                 |
| `presentation/`                   | traduzione body -> command e le opzioni del `ValidationPipe`          |
| `test/todo.e2e-spec.ts`           | rotte, status code e mappatura errori su HTTP vero                    |

```sh
pnpm --filter api-command test                       # unitari
pnpm --filter api-command test:e2e                   # e2e (turbo test NON li esegue)
pnpm --filter api-command exec jest src/todo/domain  # solo il dominio
```

## Cosa manca

In ordine di importanza, non di difficoltà:

1. **Gli eventi non escono dal processo.** Sono pubblicati sull'`EventBus`
   in-process e nessuno è iscritto: `api-query` non riceve niente. Serve prima
   un package condiviso per i contratti degli eventi (oggi le classi vivono
   qui, e l'altro workspace non può importarle) e i metadati che un bus reale
   richiede: `eventId`, `occurredAt`, versione dello schema.
2. **Nessun outbox.** L'ordine persisti-poi-pubblica è best-effort: se il
   processo muore in mezzo, l'evento è perso e il read model diverge in modo
   permanente e silenzioso.
3. **La persistenza è un segnaposto.** Manca il DB, e con lui la concorrenza
   ottimistica (senza una versione, due comandi concorrenti sullo stesso todo si
   sovrascrivono a vicenda) e il confine transazionale che tenga insieme
   scrittura e outbox.
4. **Il todo non ha un proprietario.** Nessun `userId`: è una decisione di
   prodotto da prendere prima della persistenza vera, perché cambia identità,
   autorizzazione e query.
5. **Dettagli**: `category` è ancora solo un commento in `TodoProps`; non c'è
   idempotenza sul bus (i comandi non sono idempotenti per scelta); non c'è
   correlation id per seguire comando -> evento -> proiezione.
