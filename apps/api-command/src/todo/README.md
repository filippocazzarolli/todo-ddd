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
HTTP POST /todos                    header x-user-id: l'attore
  -> TodoController                 @Actor() + body -> CreateTodoCommand
  -> CommandBus                     trova l'handler dal tipo del command
  -> CreateTodoHandler              todoId da TodoIdGenerator, now da Clock,
                                    l'attore diventa l'ownerId
  -> Todo.create(...)               valida le invarianti, registra l'evento
  -> TodoRepository.add(todo)       prima si persiste...
  -> todo.commit()                  ...poi si pubblica sull'EventBus
  -> 201 { todoId }
```

Ogni altro comando carica l'aggregato invece di costruirlo:

```
HTTP PATCH /todos/:todoId           header x-user-id: l'attore
  -> TodoController                 -> UpdateTodoCommand(actorId, todoId, fields)
  -> UpdateTodoHandler
  -> loadTodo(...)                  findById -> ensureOwnedBy -> mergeObjectContext,
                                    o TodoNotFoundError / TodoNotOwnedError
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
- solo il proprietario può agire su un todo;
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

## Il proprietario

Ogni todo ha un `ownerId`: il riferimento a un altro aggregato, tenuto **per
identità** e non per oggetto. Non c'è nessun `User` dentro `Todo`, e `todo/` non
importa una riga da `user/` — un aggregato annidato allargherebbe il confine
transazionale a due aggregati, accoppierebbe due bounded context che oggi si
ignorano, e non sarebbe una colonna.

`ownerId` e non `userId` perché è il _ruolo_ che quell'identità ha qui dentro:
questo modulo non conosce l'aggregato `User`, conosce un'identità esterna che
possiede il todo. Per la stessa ragione i comandi parlano invece di `actorId`:
il comando dice _chi chiede_, l'aggregato dice _di chi è_. La sola traduzione
tra i due è in `CreateTodoHandler`, dove chi crea diventa proprietario.

**L'ownership non è modificabile.** `ownerId` sta in `TodoProps` e in
`CreateTodoProps`, non in `UpdateTodoProps`: trasferire un todo ha
precondizioni proprie e vorrà un comando dedicato con il suo evento, non un
campo in un update parziale. È la stessa scelta dell'email in `UpdateUserProps`.

**L'esistenza del proprietario non è un invariante dell'aggregato.**
Verificarla richiede di guardare fuori dal confine transazionale, esattamente
come l'unicità dell'email che `User` si rifiuta di controllare. `Todo.create`
accetta qualunque `ownerId`; il fallimento è dichiarato dalla porta di
persistenza (`TodoOwnerNotFoundError` su `add`) perché l'unico posto in cui la
verifica è atomica è un vincolo di chiave esterna. Lo solleva
`DrizzleTodoRepository`, traducendo `SQLITE_CONSTRAINT_FOREIGNKEY`;
`InMemoryTodoRepository` non può, perché non vede gli utenti, e per il test
double un todo orfano resta rappresentabile. L'alternativa — l'handler che
interroga `UserRepository` — è stata scartata: accoppierebbe i due contesti sul
lato write per una verifica che resta comunque non atomica.

**Il verso dell'associazione è uno solo.** `User` non tiene la lista dei suoi
todo: sarebbe una collection illimitata dentro un aggregato e un secondo punto
di verità, e "quanti todo ha l'utente" è una domanda del read model. L'unica
cosa che romperebbe la regola sarebbe un invariante tipo _"il piano free ammette
al massimo N todo"_ — e neanche allora la risposta sarebbe annidare i todo, ma
la coerenza eventuale su un contatore proiettato o un aggregato quota dedicato.

### Ownership e autorizzazione

Sono due cose diverse. `ownerId` risponde a "di chi è"; "chi può modificarlo" è
una regola _sull'ownership_, e vive in `Todo.ensureOwnedBy` — l'unico controllo
pubblico dell'aggregato — perché è verificabile con i soli dati che l'aggregato
ha, e quindi testabile senza mock.

Ma è invocata in `loadTodo`, insieme al `mergeObjectContext`, e per la stessa
ragione: un controllo di autorizzazione dimenticato in un handler non lancia
niente e non rompe nessun test. Tenendolo nel punto obbligato del caricamento,
non si può dimenticare. `create` non passa da lì e non ne ha bisogno: il
proprietario _è_ l'attore, per costruzione.

L'ordine è `findById` -> `ensureOwnedBy` -> tutto il resto. Chi non possiede il
todo non arriva mai a `ensureNotDeleted`, quindi non distingue un todo
cancellato da uno vivo; e un id inesistente resta un 404 per tutti, perché la
ricerca precede l'autorizzazione.

### L'attore al confine HTTP

Arriva da `@Actor()` (`shared/presentation/actor.decorator.ts`), che lo legge
dall'header `x-user-id`. **Mai dal body**: un campo `ownerId` in
`CreateTodoBody` sarebbe controllato dal client, chiunque potrebbe scrivere per
conto di chiunque, e il buco non si chiuderebbe più senza breaking change.

L'header è un **segnaposto** dichiarato: chiunque può metterci qualunque cosa,
quindi non è autenticazione. Il punto è che il giorno in cui arriva quella vera
cambia solo quel file — controller, comandi e dominio non se ne accorgono.
Header assente o vuoto è `401`, ed è un'`HttpException` di Nest: non passa da
`TodoErrorFilter`, perché l'identità precede il dominio e non è un contratto di
questo modulo.

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
rotta. Tutti portano l'`actorId` come primo campo: chi agisce viene prima di ciò
su cui si agisce.

Le rotte sono per **intenzione** e non per stato della risorsa (`POST
/:id/reopen`, non `PUT /:id/done` con `false`): i due casi hanno esiti diversi
e appiattirli su una scrittura di campo li renderebbe indistinguibili sia in
ingresso sia nell'evento.

**Tutti** gli eventi portano l'`ownerId` oltre al `todoId`, non solo
`TodoCreatedEvent`: un evento deve essere autoconsistente per chi lo consuma, e
il lato query deve poter autorizzare e partizionare la proiezione senza tenere
una tabella di lookup `todoId -> owner`. Il costo di metterlo ovunque adesso è
una riga per evento; aggiungerlo dopo, con eventi già su una coda, è una
migrazione di schema con due versioni in volo.

`TodoUpdatedEvent` porta il **delta** e non lo stato completo: chiave assente
significa "non toccato", `null` significa "azzerato". Un update che non cambia
niente non emette nessun evento.

## Porte e adapter

| Porta             | Adapter                 | Perché è una porta                           |
| ----------------- | ----------------------- | -------------------------------------------- |
| `TodoRepository`  | `DrizzleTodoRepository` | la persistenza è sostituibile                |
| `TodoIdGenerator` | `UuidTodoIdGenerator`   | `create` resta una funzione pura e testabile |
| `Clock`           | `SystemClock`           | il dominio non legge mai l'ora di sistema    |

`InMemoryTodoRepository` esiste ancora ma non è più l'adapter dell'app: è il
**test double** degli handler spec, dove un database vero sarebbe I/O senza
guadagno — là si verifica l'orchestrazione, non lo storage. Che la sostituzione
sia costata una riga in `todo.module.ts` è la prova che la porta serviva a
qualcosa.

La superficie del repository è deliberatamente minima: `findById`, `add`,
`update`. Nessuna ricerca, nessun filtro, nessun elenco — appartengono al read
model, e un `findByStatus` qui renderebbe decorativo lo split CQRS. Nessuna
rimozione: la cancellazione è un cambio di stato, quindi passa per `update`.

### La persistenza

Lo schema è in [`packages/db`](../../../../packages/db), condiviso perché
`api-query` leggerà lo stesso file. Cinque cose che non si deducono dal codice
dell'adapter:

**La chiave esterna `todos.owner_id -> users.user_id` è l'unico punto in cui
questo bounded context e `user/` si toccano.** Nessun import attraversa i due
moduli, né prima né adesso: il contatto è nello schema, e ci è arrivato perché
l'esistenza del proprietario non è un invariante dell'aggregato ma un vincolo
che solo il database può verificare atomicamente. Richiede `PRAGMA
foreign_keys = ON`, che in SQLite è **per-connessione** e spento per default.

**Il mapper esiste al posto della divisione di `TodoProps` in due tipi.** Il
commento su quel tipo annunciava che stato interno e contratto di persistenza si
sarebbero separati quando il DB avesse voluto `expiration` come stringa. Non è
andata così: la differenza è un `Expiration` da un lato e una `string` ISO
dall'altro, e sta tutta in `persistence/todo.mapper.ts`. Un tipo in meno da
tenere allineato.

**`tags` è una colonna `text` con dentro un JSON, non una colonna `json`.** Il
`mode: 'json'` di Drizzle va accompagnato da `.$type<string[]>()`, che è un cast
non verificato a runtime: una riga con `'[1,2]'` entrerebbe nell'aggregato
dichiarando di essere `string[]`, e il danno si manifesterebbe altrove, molto
dopo. Il mapper fa `JSON.parse` e poi un type guard, e una riga corrotta esce
come `TodoRowInvalidError`.

**`tags` e `important` sono `NOT NULL`, `description` no.** `snapshot()`
restituisce sempre un array e `create` normalizza `important` a `false`, quindi
una colonna nullable creerebbe una seconda rappresentazione dello stesso stato —
NULL e `'[]'` per "nessun tag". Per `description` invece la corrispondenza
`undefined` <-> NULL è biunivoca, perché nel dominio "assente" ha una sola
rappresentazione.

**Gli eventi sono scritti nella stessa transazione dell'aggregato.** Ogni `add`
e ogni `update` che va a buon fine lascia in `outbox` una riga per evento, e il
`commit()` dell'handler diventa la strada non durevole: se il processo muore
subito dopo la scrittura, l'evento è ancora lì. Prima non lo era — fra la write
e il `publishAll` c'era una finestra, e un evento perso lì dentro faceva
divergere il read model per sempre, senza un errore da nessuna parte.

La transazione sta **dentro il metodo dell'adapter** e non attorno all'handler,
e la ragione è tecnica prima che estetica: una transazione SQLite non può
attraversare un `await`, e l'handler è `async`. Un `unitOfWork.run(async ...)`
avrebbe letto meglio e avrebbe funzionato per caso, finché il driver resta
sincrono, rompendosi in silenzio con qualunque altro. Il prezzo è che l'adapter
conosce l'esistenza degli eventi; è accettabile perché il repository _è_ già il
confine di persistenza dell'aggregato, e "la radice e ciò che ha prodotto" è la
stessa unità di lavoro. Nessuna porta cambia, nessun handler cambia.

Due dettagli che non si deducono. La riga di outbox si scrive **solo dove la
scrittura è avvenuta davvero** — dentro il ramo `changes > 0` di `update`, e
dopo l'insert di `add`: un `append` messo fuori pubblicherebbe fatti mai
accaduti, e nel caso di `add` con `ON CONFLICT DO NOTHING` non ci sarebbe
neanche un rollback ad annullarlo. E l'ordine di consegna è la colonna
`sequence`, **non** l'`event_id`: l'UUIDv7 sembra già ordinato, ma `uuidV7` non
garantisce la monotonicità dentro lo stesso millisecondo — che è precisamente il
caso di due eventi prodotti dallo stesso comando.

**La scrittura è ottimistica, e l'aggregato non se ne accorge.** Ogni riga porta
una `version`; `update` scrive `WHERE todo_id = ? AND version = ?` e la fa
avanzare di uno. Zero righe toccate non è più un segnale univoco — l'aggregato
può essere sparito o essere stato riscritto — quindi l'adapter distingue i due
casi con una `SELECT` **dentro la stessa transazione**, e solleva
`TodoNoLongerExistsError` o `TodoConcurrencyConflictError`. Per chi chiama sono
due reazioni diverse: rinunciare, o ricaricare e riprovare.

L'incremento è dell'adapter e non dell'aggregato, perché l'`UPDATE` ha bisogno
del valore _originale_ per confrontarlo e un aggregato che si incrementasse a
ogni mutazione ne salterebbe due in un comando che ne applica due. La
conseguenza è che dopo un `update` l'istanza in memoria è indietro di uno e non
è più scrivibile: gli handler la buttano subito dopo il `commit()`, e chi
volesse riscriverla deve ricaricarla — che è precisamente ciò che questa regola
deve imporre.

`version` sta in `TodoProps` pur non essendo un dato di dominio: nessuna
invariante la nomina, nessun comando la cambia, nessun evento la porta. Ci sta
perché `TodoProps` è anche il contratto verso la persistenza, ed è anche il
motivo per cui non ha un getter pubblico.

**Il mapper decide cosa significhi un rifiuto del dominio, e il dominio non lo
sa.** `Expiration.rehydrate` e `Email.create` sollevano errori di _dominio_:
chiamati sull'input dell'utente vogliono dire "richiesta sbagliata" e finiscono
in un 400, ma chiamati su una riga già in tabella vorrebbero dire "il database
contiene qualcosa che non avremmo mai potuto scriverci", che non è colpa del
chiamante. Il mapper li traduce quindi in `TodoRowInvalidError`, che nessun
filtro cattura e che esce come **500**.

Per l'email c'è in più il confronto con il valore normalizzato: `Email.create`
fa `trim` e `toLowerCase`, quindi una riga con `Mario@X.it` tornerebbe
normalizzata e verrebbe **riscritta** al primo `update` — una mutazione che
nessun comando ha chiesto, capace di collidere con `UNIQUE (email)` altrove.
L'adapter scrive sempre il valore normalizzato, quindi una riga che non lo è non
l'ha prodotta lui. Per `Expiration` non vale: là la normalizzazione è
l'azzeramento dei secondi, dichiarata come tolleranza voluta.

**L'adapter non è `async`, ed è deliberato.** `better-sqlite3` è un driver
sincrono: non c'è niente da attendere, quindi un `async` senza `await` farebbe
fallire il lint (`require-await`) e un `await` messo lì per zittirlo farebbe
scattare `await-thenable`. La firma resta `Promise` perché è il contratto della
porta, e gli esiti passano da `shared/persistence/settle.ts`.

## Errori e status HTTP

Tre gerarchie separate, perché la mappatura a valle deve poterle distinguere:

| Gerarchia                                           | Significato                          | Status |
| --------------------------------------------------- | ------------------------------------ | ------ |
| `TodoDomainError` (invariante violata)              | input rifiutato dal dominio          | 400    |
| ┗ `TodoAlreadyDone` / `NotDone` / `Deleted`         | conflitto con lo stato attuale       | 409    |
| ┗ `TodoNotOwnedError`                               | il todo è di qualcun altro           | 403    |
| `TodoNotFoundError` (application)                   | il comando cita qualcosa che non c'è | 404    |
| `TodoPersistenceError` (`AlreadyExists`/`NoLonger`) | scrittura andata a vuoto             | 409    |
| ┗ `TodoConcurrencyConflictError`                    | qualcun altro ha scritto per primo   | 409    |
| ┗ `TodoOwnerNotFoundError`                          | l'`ownerId` non è di nessuno         | 400    |
| `TodoRowInvalidError` (persistence)                 | riga che il dominio non rappresenta  | 500    |

Le due foglie con uno status diverso dalla loro base vanno controllate **prima**
di essa nel filtro, o collasserebbero sul default: l'accesso negato
diventerebbe indistinguibile da un input malformato.

`TodoNotOwnedError` è 403 e non 404: il repo preferisce i segnali distinti, e
con id UUIDv7 non enumerabili il 403 non regala niente a chi tira a indovinare.
Se il modello di minaccia cambiasse, la decisione si ribalta in una riga del
filtro — il dominio continua a sollevare lo stesso errore e non se ne accorge.

L'`UnauthorizedException` del decoratore `@Actor()` **non** passa di qui: 401 è
di Nest, e l'autenticazione precede il dominio.

La traduzione è in [`presentation/todo-error.filter.ts`](./presentation/todo-error.filter.ts),
registrato sul controller e non globalmente. Il body porta
`error.constructor.name` come discriminante leggibile dalla macchina: un 409
può essere tre cose diverse, e la reazione giusta del client cambia.

Un errore di dominio nuovo, non elencato nel filtro, diventa **400 e non 500**:
è sempre colpa del chiamante, mai del server.

## Otto decisioni non ovvie

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
Il `commit()` che pubblica sull'`EventBus` in-process è però la strada **non
durevole**: quella vera è la riga di outbox che l'adapter scrive nella stessa
transazione dell'aggregato — vedi _La persistenza_.

**5. `add` e `update`, non un `save` unico.** Un upsert cancella due segnali che
servono: l'inserimento di un id duplicato (che è la base dell'idempotenza sulle
retry) e la scrittura su un aggregato scomparso. È anche ciò che rende possibile
la concorrenza ottimistica: `UPDATE ... WHERE version = ?` che non tocca righe è
un conflitto, mentre in un upsert diventerebbe un insert silenzioso.

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

**8. L'autorizzazione sta nell'aggregato ma si invoca in `loadTodo`.** La
regola (`ensureOwnedBy`) vive dove sono i dati per verificarla; l'invocazione
sta nel punto obbligato del caricamento perché un check dimenticato fallisce in
silenzio come un merge dimenticato. L'alternativa — l'attore come parametro di
ogni metodo di comando — è ugualmente sicura ma mescola _chi chiede_ e _cosa
chiede_ in cinque firme.

Un nono punto che non è una decisione ma una trappola: **`Todo.update` valida
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

296 test unitari sul modulo (più 17 in `shared/`) e 33 e2e, divisi per quello
che possono provare:

| Dove                              | Cosa verifica                                                         |
| --------------------------------- | --------------------------------------------------------------------- |
| `domain/**/*.spec.ts`             | invarianti, transizioni, eventi registrati — zero mock                |
| `application/**/*.spec.ts`        | orchestrazione: cosa viene persistito, cosa pubblicato, in che ordine |
| `persistence/`, `infrastructure/` | il contratto delle porte lato adapter, su un DB `:memory:`            |
| `presentation/`                   | traduzione body -> command e le opzioni del `ValidationPipe`          |
| `test/todo.e2e-spec.ts`           | rotte, status code e mappatura errori su HTTP vero                    |

**I due adapter di `TodoRepository` girano sulla stessa suite di contratto**,
[`persistence/todo.repository.contract.ts`](./persistence/todo.repository.contract.ts):
31 casi che valgono per qualunque implementazione della porta, eseguiti sia
dall'adapter Drizzle sia dal test double. Restano nelle rispettive spec solo i
casi che un adapter non _può_ avere — la chiave esterna e le righe corrotte da
una parte, l'isolamento fra istanze dall'altra.

L'hook `seedOwner` del fixture è ciò che tiene il contratto ricco invece di
ridurlo al minimo comune denominatore: per l'adapter Drizzle semina l'utente che
la chiave esterna pretende, per quello in memoria non fa niente. Senza,
"accetta proprietari diversi" sarebbe finito fuori dal contratto pur essendo una
regola della porta.

```sh
pnpm --filter api-command test                       # unitari
pnpm --filter api-command test:e2e                   # e2e (turbo test NON li esegue)
pnpm --filter api-command exec jest src/todo/domain  # solo il dominio
```

## Cosa manca

In ordine di importanza, non di difficoltà:

1. **Gli eventi non escono dal processo.** Sono scritti nell'outbox e pubblicati
   sull'`EventBus` in-process, ma **nessun relay legge la tabella**: `api-query`
   non riceve niente. È la metà che si può ancora aggiungere in qualsiasi
   momento — a differenza della scrittura, che se non avviene non si recupera
   più. Serve prima un package condiviso per i contratti degli eventi (oggi le
   classi vivono qui, e l'altro workspace non può importarle) e i metadati che
   un bus reale richiede: `occurredAt` vero, versione dello schema.
2. **`recorded_at` non è `occurred_at`.** La colonna dice quando la riga è stata
   scritta, che è l'unica cosa che si sappia davvero: il momento in cui il fatto
   è accaduto appartiene all'evento e dovrà arrivare dalla porta `Clock`, come
   ogni altro istante di questo modulo.
3. **Nessun confine transazionale oltre il singolo metodo.** `add` e `update`
   sono ognuno una transazione a sé, e gli adapter parlano con la connessione
   attraverso un `db` fisso: non c'è modo di far partecipare una scrittura a una
   transazione decisa da fuori. È il motivo per cui l'outbox del punto 2 non è
   "codice da aggiungere" ma un cambio di forma degli adapter.
4. **Il ciclo di vita del proprietario non è gestito.** Il todo ha un
   `ownerId`, ma niente reagisce a `UserDeletedEvent`: i todo di un utente
   cancellato restano — la chiave esterna impedisce un todo orfano alla
   creazione, non un proprietario che scompare dopo (la cancellazione è logica,
   quindi la riga dell'utente resta e il vincolo continua a essere soddisfatto).
   Non si risolve con una transazione su due aggregati, ma con una policy in
   coerenza eventuale, che richiede prima il package condiviso di contratti del
   punto 1.
5. **L'autenticazione è un segnaposto.** `@Actor()` si fida dell'header
   `x-user-id`: chiunque può dichiararsi chiunque. L'ownership è modellata e
   verificata, ma l'identità su cui si basa non è provata.
6. **Dettagli**: `category` è ancora solo un commento in `TodoProps`; non c'è
   idempotenza sul bus (i comandi non sono idempotenti per scelta); non c'è
   correlation id per seguire comando -> evento -> proiezione.
