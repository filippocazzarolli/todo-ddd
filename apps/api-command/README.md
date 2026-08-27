# `api-command` — il lato write

Servizio NestJS 11 + Express che espone il lato **command** dello split CQRS: qui si scrive e si decide. Leggere, filtrare ed elencare è di [`api-query`](../api-query), che è ancora lo scaffold vuoto.

Ascolta su `PORT`, default **3002**.

È l'unica app del monorepo con codice di dominio. Per il contesto generale — struttura del monorepo, comandi da root, vincoli della toolchain — vedi il [README del progetto](../../README.md).

## Mappa

```
src/
  main.ts            bootstrap: NestFactory + listen
  app.module.ts      composizione radice, CqrsModule.forRoot()
  todo/              modulo di dominio  -> src/todo/README.md
  user/              modulo di dominio  -> src/user/README.md
  shared/            meccanismo comune ai due, senza dominio
test/
  todo.e2e-spec.ts   e2e su HTTP vero (solo il modulo todo)
```

Ogni modulo di dominio ha gli stessi cinque layer (`presentation/`, `application/`, `domain/`, `persistence/`, `infrastructure/`) con le dipendenze rivolte **solo verso `domain/`**. Il [README del modulo todo](src/todo/README.md) documenta la regola per esteso ed è la fonte di verità sulle convenzioni; quello del [modulo user](src/user/README.md) spiega dove e perché il secondo aggregato diverge.

**I due moduli non si importano tra loro.** Il legame è il solo `ownerId` che il todo conserva: un'identità opaca, non un riferimento a un aggregato. Se ti trovi a scrivere `import ... from '../../user/...'` dentro `todo/`, la soluzione non è quell'import.

## L'API

Tutte le rotte del modulo todo richiedono l'header **`x-user-id`**, che identifica l'attore. È un **segnaposto**: nessuno lo verifica, chiunque può dichiararsi chiunque. Header assente o vuoto → `401`.

| Metodo   | Rotta                         | Esito      | Comando                         |
| -------- | ----------------------------- | ---------- | ------------------------------- |
| `POST`   | `/todos`                      | `201 {id}` | `CreateTodoCommand`             |
| `PATCH`  | `/todos/:todoId`              | `204`      | `UpdateTodoCommand`             |
| `POST`   | `/todos/:todoId/done`         | `204`      | `MarkTodoAsDoneCommand`         |
| `POST`   | `/todos/:todoId/reopen`       | `204`      | `ReopenTodoCommand`             |
| `DELETE` | `/todos/:todoId`              | `204`      | `DeleteTodoCommand`             |
| `POST`   | `/users`                      | `201 {id}` | `CreateUserCommand`             |
| `PATCH`  | `/users/:userId`              | `204`      | `UpdateUserCommand`             |
| `PUT`    | `/users/:userId/subscription` | `204`      | `ChangeUserSubscriptionCommand` |
| `DELETE` | `/users/:userId`              | `204`      | `DeleteUserCommand`             |

Le rotte dei **user non hanno l'attore**: oggi chiunque può modificare qualunque utente. È il primo punto di _Cosa manca_ nel [README del modulo](src/user/README.md#cosa-manca).

Nessuna rotta `GET`: leggere è dell'altro servizio, e un `findAll` qui renderebbe decorativo lo split.

Il body degli errori è uniforme e porta il **nome della classe** come discriminante leggibile dalla macchina — serve perché più cause collassano sullo stesso status:

```json
{
  "statusCode": 409,
  "error": "TodoAlreadyDoneError",
  "message": "Il todo todo-1 è già stato completato"
}
```

Ogni modulo ha il proprio exception filter, registrato **sul controller e non globalmente**: mappa i tipi di quel modulo, e un filtro globale li renderebbe un contratto di tutta l'app. Le tabelle degli status stanno nei rispettivi README.

```sh
curl -X POST localhost:3002/todos \
  -H 'content-type: application/json' \
  -H 'x-user-id: user-1' \
  -d '{"title":"Comprare il latte"}'
```

## La composizione radice

`app.module.ts` non ha codice proprio, solo composizione. L'unica riga non ovvia è `CqrsModule.forRoot()`:

```ts
@Module({
  imports: [CqrsModule.forRoot(), TodoModule, UserModule],
})
export class AppModule {}
```

Sta **qui e solo qui** perché è dichiarato `global: true`: una registrazione mette `CommandBus`, `EventBus` ed `EventPublisher` a disposizione di tutti i moduli feature, presenti e futuri. Registrarlo anche in `TodoModule` creerebbe un secondo `CommandBus` con un secondo registro di handler, e i comandi finirebbero su quello sbagliato — **senza errori**, semplicemente non verrebbero eseguiti.

Ogni modulo feature è invece il posto in cui le porte del suo dominio incontrano gli adapter, e l'unico che nomina un'implementazione concreta:

```ts
{ provide: TodoRepository, useClass: InMemoryTodoRepository }
```

I token sono le classi astratte delle porte, non stringhe o `Symbol`: sono valori a runtime, quindi la DI per costruttore funziona senza `@Inject()`. Sostituire la persistenza è quella riga, e nessun handler, nessun test e nessuna riga di dominio cambia.

## `shared/`

Contiene solo ciò che è **meccanismo e non contratto**: codice che non nomina nessun bounded context, non ha regole da tenere allineate con un dominio e non passa dalla DI.

| File                                     | Cos'è                                           |
| ---------------------------------------- | ----------------------------------------------- |
| `infrastructure/uuid-v7.ts`              | generatore di UUIDv7 (Node non ce l'ha nativo)  |
| `presentation/when-present.decorator.ts` | `@WhenPresent()`, alternativa a `@IsOptional()` |
| `presentation/actor.decorator.ts`        | `@Actor()`, l'identità dalla richiesta          |

**Cosa non ci va, anche quando sembra identico.** Le porte `TodoIdGenerator` e `UserIdGenerator` hanno la stessa forma esatta e restano separate: una porta condivisa farebbe sì che un cambio di formato degli id dei todo si propaghi agli utenti. I due contesti condividono `uuidV7`, che è il meccanismo; gli adapter sono tre righe di glue sopra.

Vale lo stesso per `TODO_VALIDATION` e `USER_VALIDATION` (identiche oggi, ma per coincidenza) e per `loadTodo` e `loadUser` (sei righe quasi uguali). La domanda giusta non è "sono uguali?" ma "devono cambiare insieme?". Quasi sempre la risposta è no, e tre righe non sono l'accoppiamento giusto da comprare.

## Comandi

```sh
pnpm dev            # nest start --watch
pnpm build          # nest build  -> dist/
pnpm start          # node dist/main
pnpm lint           # eslint --max-warnings 0
pnpm check-types    # tsc --noEmit (copre anche i test)
pnpm test           # jest — solo src/**
pnpm test:e2e       # jest --config ./test/jest-e2e.json
pnpm test:cov       # coverage
```

Da root, con i filtri Turbo:

```sh
pnpm --filter api-command test
pnpm --filter api-command exec jest src/todo/domain     # una cartella
pnpm --filter api-command exec jest -t "nome del test"  # un test
```

**`pnpm turbo test` da root non esegue gli e2e**: il task `test` mappa su `jest`, che ha `rootDir: "src"` — la cartella `test/` è fuori portata. Vanno lanciati esplicitamente, e una rottura del confine HTTP non fa fallire nessun comando da root.

## Configurazione

Quattro cose che sorprendono se non le sai. La più importante — le **tre versioni di TypeScript** che convivono nel repo — è in [CLAUDE.md](../../CLAUDE.md), insieme al resto dei vincoli della toolchain.

**TypeScript resta a `^5.9`, non allinearlo a 7.** Il `7.0.2` della root è il compilatore nativo: espone solo il binario `tsc` e non `ts.createProgram`. `nest build` e `ts-jest` consumano la API JS e si rompono. In compenso il codice viene compilato da TS 5.9 ma **analizzato dal linter con TS 6**, quindi deve soddisfare entrambi: da qui il `"types": ["node", "jest"]` esplicito nel tsconfig, che TS 6 non deduce più da solo — senza, `tsc` passa e il lint riempie i test di `no-unsafe-*` senza motivo apparente.

**`isolatedModules: true` rende `import type` pericoloso nella DI.** Un tipo importato così non emette metadata, e l'iniezione per costruttore si rompe **in silenzio**: importa le classi iniettate con import normali. Verifica dopo un build:

```sh
grep design:paramtypes dist/todo/presentation/todo.controller.js
```

Lo specchio della stessa trappola: nei DTO, un tipo usato in una signature decorata **deve** essere `import type` (TS1272), o la compilazione fallisce. Vedi `CreateUserBody`.

**`tsconfig.json` include `src` e `test`, `tsconfig.build.json` no.** Quindi `check-types` verifica anche i test, mentre `nest build` li esclude insieme agli `*.spec.ts`. `outDir` sta qui e non nel tsconfig condiviso: i path si risolvono relativamente al file che li dichiara, e un `outDir` in `@repo/typescript-config` farebbe finire la build dentro `packages/`, con `nest build` che riporta successo.

**Il formatting locale differisce dal resto del repo.** C'è un `.prettierrc` con `singleQuote` e `trailingComma`, che Prettier applica solo a questa cartella — il resto del monorepo usa i default. È `pnpm format` da root a formattare, non ESLint (`eslint-plugin-prettier` è stato rimosso dallo scaffold).

Le variabili d'ambiente lette a runtime vanno dichiarate in `turbo.json` (`env` dei task `dev`/`start`, o `globalEnv`), o `turbo/no-undeclared-env-vars` fa fallire il lint. Oggi c'è solo `PORT`.

## Aggiungere un modulo di dominio

Nell'ordine:

1. `src/<nome>/` con i cinque layer. Parti da `domain/`: aggregato, Value Object, eventi, errori, porte.
2. Le porte sono **`abstract class`**, mai `interface` + `Symbol`: servono token DI risolvibili a runtime.
3. Gli adapter in `persistence/` e `infrastructure/` implementano le porte; nessuno di loro è mai nominato fuori dal modulo.
4. `<nome>.module.ts` con i provider e il binding porta → adapter. **Non** importare `CqrsModule`.
5. Registra il modulo in `app.module.ts`.
6. Un `README.md` nella cartella del modulo, con le decisioni non ovvie e il loro perché.

Per aggiungere un comando a un modulo esistente, la sequenza è nel README di quel modulo.

## Cosa manca

Buchi a livello di applicazione; quelli specifici dei singoli aggregati stanno nei README dei moduli.

1. **Gli eventi non escono dal processo.** Sono pubblicati sull'`EventBus` in-process e nessuno è iscritto: `api-query` non riceve niente. Serve prima un package condiviso per i contratti degli eventi — oggi le classi vivono dentro i moduli e l'altro workspace non può importarle — con i metadati che un bus reale richiede: `eventId`, `occurredAt`, versione dello schema.
2. **Nessun outbox.** L'ordine persisti-poi-pubblica, rispettato in tutti gli handler, resta best-effort: se il processo muore in mezzo, l'evento è perso e il read model diverge in modo permanente e silenzioso.
3. **La persistenza è in memoria.** Ogni riavvio riparte da zero. Con il DB arriveranno anche la concorrenza ottimistica (senza una versione, due comandi concorrenti sullo stesso aggregato si sovrascrivono) e il confine transazionale che tenga insieme scrittura e outbox.
4. **Non c'è autenticazione.** `@Actor()` si fida di un header. L'ownership dei todo è modellata e verificata, ma l'identità su cui poggia non è provata — e il modulo user non ha nemmeno l'attore.
5. **Nessuna configurazione.** Niente `ConfigModule`, niente validazione dell'ambiente: l'unica variabile letta è `PORT`. Mancano anche health check, logging strutturato e correlation id per seguire comando → evento → proiezione.
