# Modulo `user` — lato write

Implementazione DDD dell'aggregato `User`: il lato **command** dello split CQRS.
Qui si scrive e si decide; leggere, filtrare ed elencare è di `api-query`.

Tutto il modulo è composto in [`user.module.ts`](./user.module.ts) e non ha
dipendenze verso altri moduli dell'app — **`todo/` incluso**. Il legame tra i
due è il solo `ownerId` che il todo conserva: un'identità opaca, che questo
modulo non sa nemmeno di aver prestato.

Convenzioni, layer e flusso sono gli stessi del
[modulo `todo`](../todo/README.md), che li documenta per esteso. Qui si spiega
ciò che è **diverso**, e perché.

## La regola di dipendenza

Identica: le frecce vanno **solo verso il basso**, e nessun file di `domain/`
importa da una qualunque delle altre cartelle.

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
persistence/      adapter di UserRepository
infrastructure/   adapter di UserIdGenerator
```

Una differenza sola: **non c'è `Clock`**. L'utente non ha nessuna invariante
che dipenda dal tempo — nessuna scadenza da confrontare con "adesso" — quindi
`UserModule` compone due porte invece di tre.

## Il flusso di un comando

Creazione — l'unico caso in cui l'aggregato nasce invece di essere caricato:

```
HTTP POST /users
  -> UserController                 traduce body -> CreateUserCommand
  -> CommandBus                     trova l'handler dal tipo del command
  -> CreateUserHandler              userId da UserIdGenerator
  -> User.create(...)               valida le invarianti, registra l'evento
  -> UserRepository.add(user)       qui, e solo qui, si verifica l'unicità
  -> user.commit()                  prima si persiste, poi si pubblica
  -> 201 { userId }
```

Ogni altro comando carica l'aggregato invece di costruirlo:

```
HTTP PUT /users/:userId/subscription
  -> UserController                 -> ChangeUserSubscriptionCommand(userId, piano)
  -> ChangeUserSubscriptionHandler
  -> loadUser(...)                  findById + mergeObjectContext, o UserNotFoundError
  -> user.changeSubscription(...)   confronta con il piano attuale
  -> UserRepository.update(user)
  -> user.commit()
  -> 204
```

`loadUser` è la gemella di `loadTodo`, e le sei righe duplicate sono
deliberate: astrarle richiederebbe un tipo di repository comune e un errore
"not found" comune, cioè un contratto condiviso fra bounded context. Il
duplicato qui sono sei righe, l'accoppiamento durerebbe.

**`loadUser` non ha l'attore.** `loadTodo` verifica l'ownership subito dopo il
caricamento; qui non c'è niente di equivalente, perché nessun comando del
modulo porta un `actorId`. Non è una scelta: è il buco descritto in
_Cosa manca_.

## Il modello di dominio

L'aggregato è in [`domain/aggregates/user.aggregate.ts`](./domain/aggregates/user.aggregate.ts).

**Ciclo di vita**: nessuna sequenza di stati. A differenza del todo, che oscilla
fra `todo` e `done`, l'utente ha **due assi indipendenti** — il piano, che
cambia liberamente in qualunque direzione, e `deleted`, stato terminale
ortogonale che congela ogni transizione. `deleted` non è un valore di
`UserSubscription` proprio perché è ortogonale: si cancella sia un utente
`free` sia uno `pro`, e il piano che aveva resta un'informazione valida — alla
fatturazione serve anche dopo.

**Nessun campo dello stato è opzionale.** Un utente senza email, senza nome o
senza piano non è un utente incompleto: è un utente che non esiste. È la
differenza più visibile con `TodoProps`, dove `description`, `expiration` e
`tags` sono assenti finché qualcuno non li mette.

**Invarianti, tutte dentro l'aggregato o nel suo Value Object**:

- l'email è sintatticamente valida e normalizzata;
- nome e cognome, trimmati, non possono essere vuoti;
- il piano è uno dei tre dichiarati, `free` se il chiamante non sceglie;
- un utente cancellato non accetta nessun comando;
- passare al piano su cui si è già è un errore — non un no-op.

**L'ordine di validazione in `create` è fissato e conta**: email, nome,
cognome. I tre controlli sono indipendenti, quindi con più campi invalidi il
primo errore vince; fissarlo rende l'errore prevedibile per chi lo mappa a
valle, invece di dipendere da come sono disposte le assegnazioni. Il piano non
entra nell'ordine perché non ha niente da validare: il tipo l'ha già fatto.

**`create` vs `rehydrate`**: come nel todo, la factory è per gli utenti che
nascono ora e registra `UserCreatedEvent`; `rehydrate` ricostruisce da uno
stato persistito e non emette niente. `rehydrate` **non rinormalizza e non
rivalida**: `UserProps` è già la forma normalizzata e l'`Email` in ingresso è
un VO che non può esistere invalido. Un nome vuoto in persistenza non è un
input da respingere, è un dato rotto — e nasconderlo dietro un errore di
invariante al caricamento lo renderebbe indistinguibile da una richiesta
malformata.

### `Email`

[`domain/value-objects/email.value-object.ts`](./domain/value-objects/email.value-object.ts).
Value Object immutabile con identità per valore, come `Expiration`. Due punti
non ovvi.

**Normalizza in minuscolo la parte locale, non solo il dominio.** È
tecnicamente una perdita di informazione — RFC 5321 dichiara la parte locale
case-sensitive — ma nessun provider reale la tratta così, e conservare il case
renderebbe `Email` inutile come chiave: `Mario@x.it` e `mario@x.it` sarebbero
due utenti diversi con la stessa casella. Il VO modella "l'indirizzo con cui
identifichiamo una persona", non la stringa che ci hanno scritto.

**Ha un solo costruttore, e non la coppia `create`/`rehydrate` di
`Expiration`.** Là la coppia serve perché `create` applica una regola
_sull'assegnazione_ ("non nel passato") che il tempo rende falsa, e senza una
`rehydrate` più permissiva ogni todo scaduto diventerebbe irricaricabile. Qui
la regola è un invariante permanente del valore: un indirizzo valido resta
valido, quindi caricare e assegnare hanno le stesse precondizioni. L'asimmetria
nascerà il giorno in cui il formato accettato si stringerà, e sarà quello il
momento di introdurre una `rehydrate` tollerante — non prima.

Il pattern è deliberatamente permissivo: nessuna regex può decidere se un
indirizzo esiste, e le implementazioni complete di RFC 5322 accettano forme che
nessun sistema reale usa. Il compito è scartare ciò che _certamente_ non è un
indirizzo; la verifica vera è mandare un'email.

### I piani

`USER_SUBSCRIPTIONS` è una **tupla `as const`** da cui si deriva la union
`UserSubscription`. Non è una scelta stilistica: il tipo non sopravvive alla
compilazione, e al confine HTTP serve la lista _a runtime_ perché `@IsIn` la
legga. Scrivere l'elenco due volte — union nel dominio, array nel DTO — è la
duplicazione che si disallinea al primo piano aggiunto, e in silenzio.

**L'ordine degli elementi non è un dato del dominio.** Qui non esiste un "piano
superiore": la posizione nell'array è solo l'ordine in cui li abbiamo scritti.
Da qui la conseguenza più visibile del modello — un solo `changeSubscription` e
non la coppia `upgrade`/`downgrade`, che pretenderebbe una gerarchia che nessuna
regola usa. Il verso resta comunque ricostruibile a valle, perché l'evento
porta anche il piano di partenza.

**`changeSubscription` non è idempotente**: passare al piano su cui si è già
solleva `UserAlreadySubscribedError`. Qui la scelta pesa più che su un todo —
dietro un cambio piano c'è un pagamento, e assorbire in silenzio una richiesta
duplicata nasconde esattamente il caso che si vuole vedere. È anche il motivo
per cui `changeSubscription` lancia mentre `update` resta un no-op silenzioso:
là l'input è un insieme sparso di campi e "niente è cambiato" è una conseguenza
innocua di cosa il client ha spedito, qui è una transizione su un asse solo,
chiesta esplicitamente.

Nessun vincolo sulle coppie ammesse: da `pro` si può andare a `free` e
viceversa. Le regole su chi possa cambiare piano e a quali condizioni
(pagamento andato a buon fine, periodo minimo, credito residuo) non sono
invarianti dell'utente — vivono dove vive il processo di fatturazione.

## L'unicità dell'email

È il punto più interessante del modulo, e **non è un invariante
dell'aggregato**. `User` non può verificarla: gli altri utenti sono fuori dal
suo confine transazionale.

Non è nemmeno un controllo dell'handler. Un `SELECT` prima dell'`INSERT` non è
atomico: due richieste concorrenti con lo stesso indirizzo lo superano
entrambe, e il vincolo servirebbe comunque. Un controllo preventivo darebbe
l'illusione della sicurezza senza togliere la necessità di quello vero.

L'unico posto che vede tutti gli utenti è lo store, quindi è lui l'autorità:
`UNIQUE (email)` sulla tabella, e l'adapter traduce la violazione in
`UserEmailAlreadyTakenError`. Per questo `UserRepository` **non espone un
`existsByEmail`**: quel controllo non è una lettura del lato write, è un
vincolo, e sta in `add`.

Oggi l'indice è vero: `CREATE UNIQUE INDEX users_email_unique ON users(email)`,
in `packages/db`. Il valore scritto in colonna è quello che esce dal Value
Object, non la stringa grezza: se lo fosse, `Mario@x.it` e `mario@x.it` sarebbero
due righe diverse e il vincolo non varrebbe niente. `InMemoryUserRepository`
riproduce lo stesso vincolo con una seconda `Map` (`email normalizzata ->
userId`), per la stessa ragione e con la stessa chiave.

**Un utente cancellato continua a occupare la sua email**, ed è la decisione
presa quando si è scritto lo schema — non un effetto collaterale. La riga esiste
ancora e il vincolo vale: è la conseguenza diretta della cancellazione logica.
L'alternativa era un indice parziale `WHERE deleted = false`, che permette la
re-registrazione al prezzo di rendere ambigua la storia di quell'indirizzo: chi
legge una riga cancellata non saprebbe più se quell'email è ancora sua o è già
di qualcun altro. Scartata a favore della variante conservativa, che è anche
quella che l'adapter in memoria riproduceva.

### L'ordine fra i due vincoli

Un `add` può violare **entrambi** i vincoli insieme — stesso id e stessa email —
e i due adapter devono riportare lo stesso errore, altrimenti non implementano
la stessa porta. SQLite però riporta un vincolo solo, e quale dipende
dall'ordine di dichiarazione delle colonne: con `user_id` prima di `email`,
riporta l'email. `InMemoryUserRepository` controlla l'id per primo.

Da qui la forma di `DrizzleUserRepository.add`: `INSERT ... ON CONFLICT DO
NOTHING`, che non solleva niente e lascia `changes = 0` per entrambi i casi, poi
due `SELECT` **dentro la stessa transazione** nell'ordine id -> email. Non è il
controllo preventivo scartato sopra: lì `SELECT` e `INSERT` hanno una finestra in
mezzo, qui l'insert è già avvenuto e SQLite tiene il write lock.

## Comandi ed eventi

| Rotta                             | Command                         | Metodo di dominio    | Evento                         |
| --------------------------------- | ------------------------------- | -------------------- | ------------------------------ |
| `POST /users`                     | `CreateUserCommand`             | `User.create`        | `UserCreatedEvent`             |
| `PATCH /users/:userId`            | `UpdateUserCommand`             | `update`             | `UserUpdatedEvent`             |
| `PUT /users/:userId/subscription` | `ChangeUserSubscriptionCommand` | `changeSubscription` | `UserSubscriptionChangedEvent` |
| `DELETE /users/:userId`           | `DeleteUserCommand`             | `delete`             | `UserDeletedEvent`             |

`CreateUserCommand` è l'unico `Command<string>`: restituisce lo `userId` perché
è il server a generarlo. Gli altri sono `Command<void>` e ricevono l'id dalla
rotta.

**Nessun comando porta un `actorId`**, a differenza di quelli del modulo todo:
oggi chiunque può modificare qualunque utente. Vedi _Cosa manca_.

`UserUpdatedEvent` porta il **delta**, come `TodoUpdatedEvent`, ma con due stati
per campo invece di tre: chiave assente significa "non toccato", presente
significa "assegnato", e non esiste "azzerato" perché né il nome né il cognome
sono azzerabili. Il terzo stato di `TodoChanges` esiste solo perché il todo ha
campi opzionali da svuotare.

`UserSubscriptionChangedEvent` porta **entrambi** i piani, mentre
`TodoMarkedAsDoneEvent` si accontenta dell'id: là il nome dell'evento identifica
da solo l'unica transizione possibile, qui le coppie sono sei e il nome non ne
distingue nessuna. E `from` non è ridondante nemmeno per un read model che tiene
già il piano corrente — è ciò che permette a chi conosce un ordinamento dei
piani di dire se è stato un upgrade o un downgrade, informazione che il lato
write non possiede e non deve possedere.

`UserCreatedEvent` porta il piano anche se ha un default, mentre
`TodoCreatedEvent` omette lo `status`: là il valore iniziale è uno solo e il
lato query lo conosce, qui il chiamante può scegliere e senza quel campo la
proiezione lo indovinerebbe.

### Perché `PUT /:userId/subscription` e non `POST /:userId/upgrade`

Sembra in contrasto con `POST /todos/:id/done`, e non lo è. Lì `done` e
`reopen` sono due _intenzioni diverse_ schiacciate su un campo booleano, quindi
meritano due rotte. Qui l'intenzione è una sola — cambiare piano — e ciò che
varia è il **dato**, su tre valori senza ordinamento. Tre rotte (`/free`,
`/standard`, `/pro`) moltiplicherebbero l'intenzione per i suoi valori, e
`/upgrade` pretenderebbe quella gerarchia fra piani che il dominio non dichiara.

`PUT` e non `PATCH` perché la sostituzione è totale: il piano non ha parti.

## Porte e adapter

| Porta             | Adapter                 | Perché è una porta                           |
| ----------------- | ----------------------- | -------------------------------------------- |
| `UserRepository`  | `DrizzleUserRepository` | la persistenza è sostituibile                |
| `UserIdGenerator` | `UuidUserIdGenerator`   | `create` resta una funzione pura e testabile |

`InMemoryUserRepository` esiste ancora ma non è più l'adapter dell'app: è il
**test double** degli handler spec, dove un database sarebbe I/O senza guadagno.
Che la sostituzione sia costata una riga in `user.module.ts` — senza toccare un
handler, una riga di dominio o un test di dominio — è la prova che la porta
serviva a qualcosa.

Superficie minima come in `TodoRepository`: `findById`, `add`, `update`.
Nessuna ricerca, nessun elenco, nessun `findByEmail` — appartengono al read
model. Nessuna rimozione: la cancellazione è un cambio di stato, quindi passa
per `update`.

**`UserIdGenerator` è una porta propria e non `TodoIdGenerator` riusata, né una
`IdGenerator` condivisa in `shared/`.** Il contratto è di questo bounded
context. Ciò che i due contesti condividono è il _meccanismo_ (`uuidV7` in
`shared/infrastructure/`), che i rispettivi adapter chiamano. Una porta unica
farebbe sì che un cambio di formato degli id dei todo si propaghi agli utenti:
esattamente l'accoppiamento che i bounded context servono a evitare.

Stessa logica per `USER_VALIDATION`, duplicato rispetto a `TODO_VALIDATION`
invece che condiviso: il contenuto identico è una coincidenza, non un vincolo.
Tre righe non sono l'accoppiamento giusto da comprare.

## Errori e status HTTP

Tre gerarchie separate, perché la mappatura a valle deve poterle distinguere:

| Gerarchia                                           | Significato                          | Status |
| --------------------------------------------------- | ------------------------------------ | ------ |
| `UserDomainError` (invariante violata)              | input rifiutato dal dominio          | 400    |
| ┗ `UserDeleted` / `UserAlreadySubscribed`           | conflitto con lo stato attuale       | 409    |
| `UserNotFoundError` (application)                   | il comando cita qualcosa che non c'è | 404    |
| `UserPersistenceError` (`AlreadyExists`/`NoLonger`) | scrittura andata a vuoto             | 409    |
| ┗ `UserEmailAlreadyTakenError`                      | l'indirizzo è di un altro            | 409    |

La traduzione è in [`presentation/user-error.filter.ts`](./presentation/user-error.filter.ts),
registrato sul controller e non globalmente. Un errore di dominio nuovo, non
elencato nel filtro, diventa **400 e non 500**: è sempre colpa del chiamante.

`UserEmailAlreadyTakenError` è **409 e non 400**: l'indirizzo è formalmente
valido, il problema è che appartiene a un altro. È il caso in cui il campo
`error` del body vale davvero — un 409 generico non distinguerebbe "riprova" da
"usa un'altra email", e qui il 409 può essere tre cose diverse.

`UserNameRequiredError` è **una classe sola parametrizzata** e non due gemelle
per nome e cognome: la regola violata è la stessa e la mappatura è la stessa,
ma chi la riceve deve poter dire _quale_ campo indicare. Il campo è un dato
dell'errore, non la sua identità.

## Il confine HTTP

Vale il principio del modulo todo — **il confine valida tipi e forma, il dominio
valida il significato** — con un'eccezione che sembra contraddirlo e non lo fa.

**Nessun `@IsEmail()` su `email`.** Che l'indirizzo sia un'email vive in
`Email.create`, e duplicare la regola creerebbe una seconda verità da tenere
allineata. Le due implementazioni non concordano nemmeno oggi: `@IsEmail()`
accetta `a@b` senza punto, `Email` no. Entrambe finirebbero in un 400 comunque.

**`@IsIn` su `subscription` è invece necessario**, e non è la stessa cosa: "uno
di questi tre valori" _è_ il tipo, e un tipo non esiste a runtime. Senza quel
controllo un `"gold"` arriverebbe fino allo stato dell'aggregato, che non lo
verifica — la union lo esclude a compile time, e lì il compilatore non c'è più.
La lista arriva da `USER_SUBSCRIPTIONS`, così la verità resta una sola.

**`@WhenPresent()` e mai `@IsOptional()`** in `UpdateUserBody`, al contrario di
`UpdateTodoBody`: `@IsOptional()` salta la validazione anche per `null`, che
passerebbe intatto fino al command dichiarando `string | undefined` — e
`props.firstName.trim()` diventerebbe un 500 dentro il dominio. Nessuno dei due
campi è azzerabile, quindi non c'è nessun `null` con un significato da lasciar
passare.

Un dettaglio di compilazione che vale la pena conoscere: nei DTO,
`UserSubscription` **deve** essere importato con `import type`. Con
`emitDecoratorMetadata` + `isolatedModules`, un tipo usato in una signature
decorata va dichiarato type-only o il compilatore fallisce con TS1272. È lo
specchio della trappola in [CLAUDE.md](../../../../CLAUDE.md): là `import type`
rompe la DI perché i metadata _servono_, qui l'import normale rompe la
compilazione perché i metadata non possono esistere. `USER_SUBSCRIPTIONS` è
invece un valore, e resta un import normale.

## Aggiungere un comando

Nell'ordine, perché ogni passo si appoggia al precedente:

1. **Il comportamento nel dominio**: un metodo sull'aggregato che verifica le
   sue precondizioni (`ensureNotDeleted()` per primo), muta lo stato e chiama
   `this.apply(...)`. Se serve un errore nuovo, va in `domain/errors/`.
2. **L'evento** in `domain/events/`: serializzabile, solo dati primitivi.
3. **Il command** in `application/commands/`: DTO immutabile che
   `extends Command<void>`, senza logica e senza conoscere l'aggregato.
4. **L'handler**: `loadUser` -> metodo -> `update` -> `commit`. Se ti serve un
   `if` sullo stato dell'aggregato, la regola è nel posto sbagliato.
5. **La registrazione** in `user.module.ts`, tra i `providers`.
6. **La rotta** nel controller, con il DTO se ha un body.
7. **I test**: dominio, handler, e — a differenza di oggi — e2e.

## Test

225 test unitari sul modulo, **nessun e2e**: è la differenza pratica più
importante con il modulo todo, che ne ha 27. Le rotte, gli status code reali e
il comportamento del `ValidationPipe` su HTTP vero non sono coperti da niente.

| Dove                              | Cosa verifica                                                         |
| --------------------------------- | --------------------------------------------------------------------- |
| `domain/**/*.spec.ts`             | invarianti, transizioni, eventi registrati — zero mock                |
| `application/**/*.spec.ts`        | orchestrazione: cosa viene persistito, cosa pubblicato, in che ordine |
| `persistence/`, `infrastructure/` | il contratto delle porte lato adapter, unicità dell'email inclusa     |
| `presentation/`                   | traduzione body -> command e le opzioni del `ValidationPipe`          |

```sh
pnpm --filter api-command exec jest src/user            # tutto il modulo
pnpm --filter api-command exec jest src/user/domain     # solo il dominio
```

## Cosa manca

In ordine di importanza, non di difficoltà:

1. **Nessuno sa chi sta agendo.** I comandi non portano un `actorId` e non
   esiste un equivalente di `Todo.ensureOwnedBy`: oggi chiunque può modificare,
   cambiare piano o cancellare qualunque utente. Il modulo todo ha già il
   decoratore `@Actor()` in `shared/presentation/`, quindi il pezzo mancante è
   la regola — "un utente può modificare solo sé stesso, e un amministratore
   chiunque" — non il meccanismo. Va deciso prima di esporre l'API.
2. **Nessun e2e.** Vedi _Test_.
3. **`changeEmail` non esiste.** L'email non è modificabile, e il metodo manca
   di proposito: cambiarla ha una precondizione che l'aggregato non può
   verificare (l'unicità), quindi vuole un comando proprio dove quel controllo
   sia visibile. Quando arriverà, `UserRepository.update` erediterà
   `UserEmailAlreadyTakenError` e l'adapter in memoria dovrà spostare la voce
   dell'indice.
4. **Gli eventi non escono dal processo.** Sono pubblicati sull'`EventBus`
   in-process e nessuno è iscritto: `api-query` non riceve niente. In
   particolare `UserDeletedEvent` non innesca nulla, quindi i todo di un utente
   cancellato restano orfani — vedi il punto corrispondente nel
   [README del modulo todo](../todo/README.md#cosa-manca).
5. **Nessun outbox.** L'ordine persisti-poi-pubblica è best-effort: se il
   processo muore in mezzo, l'evento è perso e il read model diverge in modo
   permanente e silenzioso.
6. **Nessuna concorrenza ottimistica.** Il DB c'è (SQLite via Drizzle, schema in
   `packages/db`), e con lui il vincolo `UNIQUE` vero. Restano l'assenza di una
   colonna `version` — due comandi concorrenti sullo stesso utente si
   sovrascrivono a vicenda — e il confine transazionale che tenga insieme
   scrittura e outbox.
7. **Dettagli**: nessuna regola su chi possa cambiare piano (il processo di
   fatturazione non esiste); nessun correlation id per seguire comando ->
   evento -> proiezione.
