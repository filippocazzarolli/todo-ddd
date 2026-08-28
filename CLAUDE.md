# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stato attuale

Scaffold `create-turbo` + due app NestJS, split CQRS.

- **`apps/api-command`** — il lato write, ed è dove sta tutto il codice vero. Due moduli DDD completi (`src/todo/`, `src/user/`) con aggregati, Value Object, porte, adapter Drizzle, command handler CQRS e confine HTTP. Ha una suite ampia (unitari + e2e).
- **`packages/db`** — `@repo/db`: schema Drizzle, migrazioni e connessione SQLite, condivisi fra i due servizi. **Il primo package del repo con un build step reale.**
- **`apps/api-query`** — ancora lo scaffold `nest new` con il solo `AppController`. Non esiste nessun read model: ci sono solo le dipendenze (`@repo/db`, `drizzle-orm`, `better-sqlite3`) predisposte.
- **`apps/web`, `apps/docs`** — le landing page del template `create-turbo`, mai toccate.

Conseguenza pratica: **gli eventi di dominio non escono dal processo**. Sono pubblicati sull'`EventBus` in-process di `@nestjs/cqrs` e nessuno è iscritto, quindi nessuna proiezione si aggiorna. Non dare per scontato che esista un percorso command -> query.

La persistenza invece è reale: SQLite via Drizzle, file in `data/todo.sqlite` (gitignored), migrazioni in `packages/db/migrations/`. Gli adapter in memoria **esistono ancora** ma sono retrocessi a test double degli handler spec: non sono più registrati in nessun modulo.

## Comandi

Da root (tutti passano da Turborepo, che rispetta il grafo delle dipendenze):

```sh
pnpm dev            # tutte le app in watch (web:3000, docs:3001)
pnpm build          # build di tutti i workspace
pnpm lint           # eslint su tutti i workspace
pnpm check-types    # next typegen + tsc --noEmit
pnpm format         # prettier --write su **/*.{ts,tsx,md}
pnpm turbo test     # jest (le app Nest e @repo/db)
pnpm db:generate    # drizzle-kit generate, dopo una modifica allo schema
pnpm db:migrate     # applica le migrazioni pendenti (serve al primo clone)
```

**Dopo ogni modifica a `packages/db/src/schema/`, `pnpm db:generate`.** Niente lo impone: `build`, `lint` e `test` passano tutti con schema e migrazioni disallineati, e il disallineamento si scopre a runtime con un errore SQL. L'unico comando che lo verifica è `drizzle-kit check`, che gira dentro il `check-types` di `@repo/db`.

Per lavorare su un singolo workspace usa i filtri Turbo (`--filter` accetta il `name` del package.json):

```sh
pnpm turbo dev --filter=web
pnpm turbo build --filter=docs
pnpm turbo lint --filter=@repo/ui
```

Nuovo componente condiviso: `pnpm turbo gen react-component` da `packages/ui`.

Toolchain vincolata: **pnpm 11.23.0** (`packageManager`) e **Node >= 24** (`engines`). Non usare npm/yarn: i workspace usano protocollo `workspace:*`.

Test: solo le app Nest hanno Jest (`test`, `test:watch`, `test:cov`, `test:e2e`). `web` e `docs` non hanno test — `pnpm turbo test` semplicemente le salta. Un singolo test: `pnpm --filter api-command exec jest src/todo/domain` (o `-t "nome del test"`).

**`pnpm turbo test` non esegue gli e2e**: il task `test` mappa su `jest`, che usa il `jest.config` di default (solo `src/**`). Gli e2e hanno una config propria e vanno lanciati esplicitamente, e una modifica al confine HTTP che li rompe non fa fallire nessun comando da root:

```sh
pnpm --filter api-command test:e2e
```

## Struttura dei workspace

`pnpm-workspace.yaml` include `apps/*` e `packages/*`, e dichiara in `allowBuilds` i pacchetti con script nativi (`better-sqlite3`, `esbuild`).

- `apps/web` (3000) e `apps/docs` (3001): Next.js 16 App Router, React 19, CSS Modules. Configurazione identica.
- `apps/api-command` (3002) e `apps/api-query` (3003): NestJS 11 + Express, lato write e lato read. Configurazione (tsconfig, eslint, jest) identica; il contenuto no — vedi _Stato attuale_.
- `packages/db` → `@repo/db`: schema Drizzle, migrazioni, connessione SQLite. **Ha un build step** (`tsc` -> `dist/`), a differenza di `@repo/ui` — vedi _Il package `db`_ più sotto.
- `packages/ui` → `@repo/ui`: libreria di componenti React condivisa.
- `packages/eslint-config` → `@repo/eslint-config`: config ESLint flat condivise (`base`, `next-js`, `react-internal`, `nest`, `node`).
- `packages/typescript-config` → `@repo/typescript-config`: `tsconfig` base condivisi (`base`, `nextjs`, `react-library`, `nestjs`).
- `data/` alla root: il file SQLite, gitignored. Non è un workspace — è dato mutabile, tenuto fuori da ogni package.

## Il dominio in `api-command`

**Prima di toccare `src/todo/` o `src/user/`, leggi [`apps/api-command/src/todo/README.md`](apps/api-command/src/todo/README.md).** È la fonte di verità sulle convenzioni del lato write: la regola di dipendenza tra i layer, il flusso di un comando, come si aggiunge un comando nuovo, e le decisioni non ovvie con il perché. `src/user/` segue le stesse convenzioni senza avere un README proprio. Quando cambi una di quelle decisioni, aggiorna il README nello stesso commit: è scritto per essere letto invece del codice.

Layout di un modulo (le frecce vanno solo verso `domain/`, che non importa da nessun altro layer):

```
presentation/    rotte, DTO, validazione di forma, mappatura degli errori su HTTP
application/     command, handler, caricamento dell'aggregato
domain/          aggregati, Value Object, eventi, errori, porte
persistence/     adapter del repository + mapper stato <-> riga
infrastructure/  adapter di Clock e generatori di id
```

Il **mapper** sta in `persistence/` e non altrove: importa dal dominio (`TodoProps`, `Expiration`) e da `@repo/db` (la forma della riga), e nessun file di `domain/` lo nomina. Nel dominio farebbe dipendere `domain/` dalla forma della riga; in `@repo/db` farebbe dipendere il package condiviso dal dominio di questa app, e `api-query` se lo porterebbe dietro. È anche la ragione per cui `TodoProps` e `UserProps` **non** si sono dovuti dividere in due tipi, come i loro commenti avevano previsto.

Otto convenzioni che, se violate, **rompono in silenzio** — nessun errore di compilazione, nessun test rosso:

- **Le porte sono `abstract class`, mai `interface` + `Symbol`.** Servono token DI risolvibili a runtime (vedi `isolatedModules` più sotto).
- **`mergeObjectContext` è obbligatorio.** `AggregateRoot.publishAll` di base è un metodo vuoto: un aggregato non mergiato scarta i suoi eventi al `commit()` senza lanciare niente. Per questo il caricamento passa sempre da `loadTodo` / `loadUser`, che fanno il merge insieme alla lettura — e, per il todo, anche il controllo di ownership.
- **Prima si persiste, poi si pubblica**, in tutti gli handler.
- **`add` e `update` sono distinti, mai un upsert.** Servono i due segnali che un upsert cancella: id duplicato e aggregato scomparso.
- **Gli eventi portano solo primitivi serializzabili**, mai Value Object: devono poter attraversare una coda.
- **`SqliteConnection` va dichiarata solo nei `providers` di `DatabaseModule`.** Elencarla anche in un modulo feature fa creare a Nest un'istanza per modulo: nei test, dove il database è `:memory:` e quindi privato per connessione, diventano **due database distinti** — gli utenti in uno, i todo nell'altro, e la chiave esterna violata da ogni `POST /todos`. I moduli feature fanno `imports: [DatabaseModule]`.
- **Gli e2e prendono il database da `test/jest-e2e-setup.ts`**, non da una riga in cima allo spec. Uno spec che dimenticasse di forzare `:memory:` passerebbe scrivendo sul database di sviluppo.
- **Un `update` senza la versione nel `WHERE` è un lost update.** Gli adapter scrivono `WHERE <id> = ? AND version = ?` e avanzano a `version + 1`; togliere quella clausola, o riusare `toRow` senza sovrascrivere la versione, fa passare tutti i test — e in produzione due comandi concorrenti si cancellano a vicenda senza che nessuno lo veda. Vale anche per l'adapter in memoria, che replica il controllo di proposito: la concorrenza ottimistica è una regola della porta, non di SQLite, e la suite di contratto la verifica su entrambi.

**I due moduli non si importano tra loro.** `todo/` non nomina `User` e non ha accesso a `UserRepository`: il legame è il solo `ownerId`, un'identità opaca. Anche i duplicati apparenti (`loadTodo` e `loadUser`, sei righe quasi identiche) sono deliberati — astrarli creerebbe un contratto condiviso tra bounded context.

**L'identità di chi agisce.** I comandi del modulo todo portano un `actorId`, che arriva da `@Actor()` (`src/shared/presentation/actor.decorator.ts`) e mai dal body. Il decoratore legge l'header `x-user-id` ed è un **segnaposto dichiarato**: non c'è autenticazione, chiunque può dichiararsi chiunque. Il modulo `user` non ha ancora l'attore nei suoi comandi — è un'asimmetria nota, non una scelta.

**Lo schema è l'unico punto di contatto fra i due bounded context**, per la chiave esterna `todos.owner_id -> users.user_id`. Nessun import attraversa i due moduli, e la spec dell'adapter todo inserisce l'utente prendendo la tabella `users` da `@repo/db`, non da `src/user/`. La FK richiede `PRAGMA foreign_keys = ON`, che in SQLite è per-connessione e spento per default.

**Lingua.** Commenti, messaggi degli errori di dominio, nomi dei test e README sono in italiano. Il codice (identificatori, tipi, nomi di file) è in inglese. Segui la stessa divisione.

## Punti architetturali non ovvi

### Il package `db`

**`@repo/db` ha un build step, e non è opzionale.** `@repo/ui` esporta TSX crudo perché lo transpila Next; qui i consumatori sono `nest build` (che è `tsc`, e non compila sorgenti fuori dal proprio progetto) e poi `node dist/main`. Esportare `.ts` darebbe test verdi in ts-jest e un `MODULE_NOT_FOUND` in produzione. Conseguenze:

- `check-types` e `dev` dipendono da `^build` in `turbo.json`, altrimenti su un clone pulito `tsc --noEmit` non trova i `.d.ts` di `@repo/db`;
- `nest start --watch` **non** ricompila il package: c'è uno script `dev` con `tsc --watch` che gira in parallelo, e se un cambio allo schema non si riflette, riavvia;
- il `build` fa `rm -rf dist` prima di `tsc`, che a differenza di `nest build` non pulisce l'output — rinominare un file lascerebbe il vecchio `.js` a risolvere via `exports`.

**Il tipo di ritorno di `createSqliteClient` è dichiarato, non inferito.** Con `declaration: true` un tipo inferito che nomina `BetterSqlite3.Database` fa fallire l'emissione dei `.d.ts` con **TS4058** ("cannot be named"), perché quel tipo vive in un percorso dello store pnpm non raggiungibile con un import stabile. Vale la stessa cautela per qualunque nuova funzione esportata che restituisca oggetti del driver o di Drizzle. `skipLibCheck` non aiuta: sopprime il check dei `.d.ts` di terzi, non l'emissione dei propri.

**`better-sqlite3` è un modulo nativo.** pnpm 11 blocca gli script di build per default: senza la voce in `allowBuilds` di `pnpm-workspace.yaml` il binding non viene installato e l'errore arriva **a runtime** (`Cannot find module ...better_sqlite3.node`), non in build. Controllo: `pnpm ignored-builds`. Per la stessa ragione `moduleFileExtensions` di Jest include `"node"` in entrambe le app.

**`better-sqlite3` è sincrono, e questo detta la forma degli adapter.** `db.transaction()` restituisce un valore e non una promise, quindi negli adapter non c'è niente da attendere: sono metodi **non `async`** con firma `Promise`, e gli esiti passano da `shared/persistence/settle.ts`. Un `async` senza `await` fa fallire `require-await`; un `await` messo lì per zittirlo fa scattare `await-thenable`. Vale anche che `SqliteError` espone `code` come **stringa** (`'SQLITE_CONSTRAINT_FOREIGNKEY'`), non un `errcode` numerico — quello appartiene ad altri binding.

**Nessun decoratore Nest in `@repo/db`.** Estende `base.json`, che non ha `emitDecoratorMetadata`: un `@Injectable()` lì compilerebbe senza metadata e la DI si romperebbe a runtime, senza errori in build. La classe iniettabile che avvolge la connessione vive in `api-command`.

**`@repo/ui` non ha build step.** Esporta i sorgenti TSX direttamente: `"exports": { "./*": "./src/*.tsx" }`. Quindi:

- l'import è per-file (`import { Button } from "@repo/ui/button"`), non da un barrel `index`;
- non c'è artefatto `dist` da rigenerare — la transpilazione la fa Next.js dell'app consumatrice;
- un nuovo componente in `src/foo.tsx` è immediatamente importabile come `@repo/ui/foo`.

**I componenti condivisi che usano hook/eventi devono dichiarare `"use client"`** (vedi `packages/ui/src/button.tsx`); i puramente presentazionali no (`packages/ui/src/card.tsx`).

**Il lint è di fatto zero-tolerance.** `eslint-plugin-only-warn` declassa ogni errore a warning, ma gli script usano `eslint --max-warnings 0`: qualsiasi violazione fa fallire il comando. Non trattare i warning come ignorabili.

**Gerarchia ESLint** (flat config): `base.js` (js recommended + typescript-eslint + prettier + `turbo/no-undeclared-env-vars`) → `next.js` (aggiunge `@next/next` recommended + core-web-vitals + react-hooks, per le app Next) e `react-internal.js` (react-hooks, per le librerie React interne). Un nuovo package deve estendere una di queste due, non ricostruire la config.

**Gerarchia TypeScript**: `base.json` (strict, `noUncheckedIndexedAccess`, NodeNext, target ES2022) → `nextjs.json` (usato dalle app) e `react-library.json` (usato da `@repo/ui`). `noUncheckedIndexedAccess` è attivo: gli accessi indicizzati sono `T | undefined` e vanno narrowati.

**`check-types` nelle app è `next typegen && tsc --noEmit`**: il typegen di Next produce `.next/types/**` che il `tsconfig.json` dell'app include. Eseguire `tsc` da solo può quindi dare errori spuri sui tipi delle route.

**Caching Turbo**: `build` dichiara come output `.next/**` escludendo `.next/cache` e `.next/dev`. Se aggiungi un task che produce artefatti, dichiarane gli `outputs` in `turbo.json`, altrimenti il caching remoto/locale li perde.

## TypeScript: due compilatori nello stesso repo

Questo è il vincolo più importante del repo e la fonte della maggior parte dei problemi non ovvi.

`typescript@7.0.2` (pinnato alla root e nelle app Next) è il **compilatore nativo**: espone solo il binario `tsc` e API `unstable/*`, **non** `ts.createProgram`. Qualunque tool che consumi la API JS di TypeScript non può girarci sopra. Da qui tre versioni in convivenza:

| Chi                                         | TypeScript                                                               | Perché                                        |
| ------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| root, `apps/web`, `apps/docs`, `packages/*` | `7.0.2` (nativo)                                                         | solo `tsc` da CLI                             |
| `apps/api-command`, `apps/api-query`        | `^5.9` locale                                                            | `nest build` e `ts-jest` richiedono la API JS |
| parser di `typescript-eslint`               | `6.0.2` (`npm:@typescript/typescript6`, devDep di `@repo/eslint-config`) | typescript-eslint non supporta TS 7           |

**Non "allineare" TypeScript a 7.x nelle app Nest**: `nest build` e Jest si rompono.

Conseguenza pratica: il codice delle app Nest viene compilato da TS 5.9 ma **analizzato dal linter con TS 6**, quindi deve soddisfare entrambi. Due differenze già incontrate:

- **`types` va dichiarato esplicitamente.** TS 6 non fa più l'inclusione automatica di `node_modules/@types/*`. Senza `"types": ["node", "jest"]` nel tsconfig, `tsc` passa ma il lint riempie i file di test di "Unsafe call of a type that could not be resolved" — sintomo fuorviante di un program degradato, non di codice unsafe.
- **`baseUrl` è deprecato** (errore in TS 6, rimosso in TS 7). Un errore di _configurazione_ nel tsconfig degrada silenziosamente il program di typescript-eslint, con lo stesso sintomo di cui sopra. Se vedi warning `no-unsafe-*` a raffica, valida prima il tsconfig con TS 6:
  ```sh
  node node_modules/.pnpm/@typescript+typescript6@6.0.2/node_modules/@typescript/typescript6/lib/tsc.js --noEmit -p apps/api-command/tsconfig.json
  ```

## Path nei tsconfig condivisi

`outDir`, `baseUrl` e ogni path in un tsconfig di `@repo/typescript-config` si risolvono **relativamente al file che li dichiara**, non al progetto che estende. Un `outDir: "./dist"` in `nestjs.json` fa finire la build in `packages/typescript-config/dist` — con `nest build` che riporta successo e Turbo che avvisa "no output files found". `outDir` sta quindi nei tsconfig delle app, non in quello condiviso.

## Note sulle app Nest

- Estendono `@repo/typescript-config/nestjs.json`, che porta `strict: true` e `noUncheckedIndexedAccess` da `base.json` (più severo dei default di `nest new`, che disattivano `noImplicitAny` e `strictBindCallApply`).
- `isolatedModules: true` da `base.json`: un tipo importato con `import type` **non produce metadata**, quindi la DI per costruttore si rompe in silenzio. Importa le classi iniettate con import normali. Verifica del metadata dopo un build: `grep design:paramtypes apps/api-command/dist/*.js`.
- ESLint via `@repo/eslint-config/nest` (base + `recommendedTypeChecked` + globals node/jest). Il blocco `parserOptions.projectService` / `tsconfigRootDir` deve restare nell'`eslint.config.mjs` dell'app: `import.meta.dirname` va valutato lì.
- Il formatting è di `pnpm format` alla root, non di ESLint (`eslint-plugin-prettier` è stato rimosso dallo scaffold). Le app Nest conservano un `.prettierrc` locale con `singleQuote`, che Prettier applica solo a quelle cartelle — il resto del repo usa i default.
- `include` copre `src` e `test`, quindi `check-types` verifica anche i test; `nest build` usa `tsconfig.build.json`, che esclude test e spec.
- Le variabili d'ambiente lette a runtime vanno dichiarate in `turbo.json` (`env` dei task `dev`/`start`/`test`, o `globalEnv`), altrimenti `turbo/no-undeclared-env-vars` fa fallire il lint. `DATABASE_URL` è dichiarata negli `env` per-task e **non** in `globalEnv` di proposito: la regola del linter unisce `global` e tutti i task del turbo.json di root, quindi per-task basta — mentre `globalEnv` metterebbe il _valore_ nell'hash di ogni task, azzerando la condivisione di cache fra CI e locale.

## Ambiente

`engines` richiede Node >= 24 e pnpm 11.23.0. La toolchain gira anche su Node 22, ma pnpm emette un warning `Unsupported engine` a ogni comando.
