# todo-ddd

> [!IMPORTANT]
> **Questo repo è incompleto e non è più sviluppato. La versione 2 è [filippocazzarolli/todo-v2-ddd](https://github.com/filippocazzarolli/todo-v2-ddd).**
>
> Qui il lato read non è mai stato scritto e gli eventi di dominio non escono dal processo. Ma la ragione vera della riscrittura è un'altra: **tenere tutto dentro `apps/api-command` non fa vedere la separazione fra i layer.** `domain/`, `application/`, `persistence/`, `presentation/` e `infrastructure/` sono solo cartelle dentro lo stesso workspace — la regola di dipendenza è una convenzione scritta nei README, non un confine che qualcosa impone: nessun package separato, nessun build indipendente, nessuna regola di lint che vieti a `domain/` di importare da `persistence/`. Basta una riga sbagliata perché il dominio dipenda dalla sua infrastruttura, e niente se ne accorge. La versione 2 rende quei confini espliciti.
>
> Il resto di questo README descrive lo stato di questo repo, che resta consultabile come riferimento.

Monorepo Turborepo con un'applicazione di gestione todo modellata in **Domain-Driven Design**, su uno split **CQRS** in due servizi separati: `api-command` scrive, `api-query` legge.

## Stato

Il lato write è implementato; il lato read no.

| Workspace          | Porta | Stato                                                                       |
| ------------------ | ----- | --------------------------------------------------------------------------- |
| `apps/api-command` | 3002  | Due moduli DDD completi: [`todo`](#i-moduli) e [`user`](#i-moduli)          |
| `apps/api-query`   | 3003  | Scaffold `nest new`: nessun read model, dipendenze e view di lettura pronte |
| `apps/web`         | 3000  | Landing page del template `create-turbo`, mai toccata                       |
| `apps/docs`        | 3001  | Landing page del template `create-turbo`, mai toccata                       |
| `packages/db`      | —     | Schema Drizzle e migrazioni, condivisi fra i due servizi                    |

Conseguenza da tenere presente: **gli eventi di dominio non escono dal processo**. Sono pubblicati sull'`EventBus` in-process di `@nestjs/cqrs` e nessuno è iscritto, quindi non esiste ancora un percorso command → query e nessuna proiezione si aggiorna.

La persistenza è **SQLite via Drizzle**: il file sta in `data/todo.sqlite` (gitignored) e le migrazioni in [`packages/db`](packages/db/README.md). Il lato write lo scrive, il lato read lo leggerà in sola lettura. Su un clone pulito serve `pnpm db:migrate` prima del primo avvio.

## Avvio

Servono **Node >= 24** e **pnpm 11.23.0** (`packageManager`). La toolchain gira anche su Node 22, ma pnpm emette un warning `Unsupported engine` a ogni comando. Non usare npm o yarn: i workspace usano il protocollo `workspace:*`.

```sh
pnpm install
pnpm db:migrate                       # crea data/todo.sqlite — serve una volta
pnpm dev                              # tutte le app in watch
pnpm turbo dev --filter=api-command   # solo il lato write
```

L'API di scrittura richiede l'header `x-user-id` su ogni rotta dei todo — è un **segnaposto**, non autenticazione (vedi il [README del modulo todo](apps/api-command/src/todo/README.md#lattore-al-confine-http)):

```sh
curl -X POST localhost:3002/todos \
  -H 'content-type: application/json' \
  -H 'x-user-id: user-1' \
  -d '{"title":"Comprare il latte"}'
```

## Comandi

Da root, tutti attraverso Turborepo, che rispetta il grafo delle dipendenze:

```sh
pnpm build          # build di tutti i workspace
pnpm lint           # eslint (zero-tolerance: --max-warnings 0)
pnpm check-types    # next typegen + tsc --noEmit
pnpm format         # prettier --write su **/*.{ts,tsx,md}
pnpm turbo test     # jest — solo le app Nest lo implementano
```

Per un singolo workspace, `--filter` accetta il `name` del `package.json`:

```sh
pnpm turbo lint --filter=api-command
pnpm --filter api-command exec jest src/todo/domain
```

**`pnpm turbo test` non esegue gli e2e**: la config Jest di default copre solo `src/**`. Vanno lanciati a parte, e una rottura del confine HTTP non fa fallire nessun comando da root:

```sh
pnpm --filter api-command test:e2e
```

## Struttura

`pnpm-workspace.yaml` include `apps/*` e `packages/*`.

```
apps/
  api-command/      NestJS 11 — lato write: aggregati, comandi, eventi
  api-query/        NestJS 11 — lato read (da fare)
  web/ docs/        Next.js 16 — template create-turbo
packages/
  db/                  @repo/db — schema Drizzle, migrazioni, connessione. Ha un build step
  ui/                  @repo/ui — componenti React condivisi, senza build step
  eslint-config/       @repo/eslint-config — flat config: base, next-js, react-internal, nest, node
  typescript-config/   @repo/typescript-config — base, nextjs, react-library, nestjs
data/                  il file SQLite, gitignored: dato mutabile, fuori da ogni package
```

## L'architettura del lato write

Ogni modulo di dominio in `api-command` ha gli stessi cinque layer, e le dipendenze puntano **solo verso `domain/`**: cancellando tutte le altre cartelle, `domain/` deve continuare a compilare da sola.

```
presentation/     HTTP: rotte, DTO, validazione di forma, mappatura errori
      |
      v
application/      orchestrazione: command, handler, caricamento aggregato
      |
      v
   domain/        aggregati, Value Object, eventi, errori, porte
      ^
      |
persistence/      adapter dei repository
infrastructure/   adapter di Clock e generatori di id
```

Le **porte** vivono in `domain/ports/` perché è il dominio a possedere il contratto; gli adapter stanno fuori e lo implementano. È questo che rende sostituibile la persistenza senza toccare una riga di logica, e la prova è che è già successo: il passaggio da `InMemoryTodoRepository` a `DrizzleTodoRepository` è stato una riga in `todo.module.ts`, senza toccare un handler, un test di dominio o una riga di aggregato. Gli adapter in memoria non sono stati cancellati: sono i test double degli handler spec.

### I moduli

Ognuno documenta le proprie decisioni, con il perché di quelle non ovvie:

- **[`src/todo/`](apps/api-command/src/todo/README.md)** — l'aggregato `Todo`. Ciclo di vita `todo ↔ done` con cancellazione logica ortogonale, scadenza come Value Object, ownership e controllo di accesso. È il README più completo: le convenzioni comuni sono spiegate lì per esteso.
- **[`src/user/`](apps/api-command/src/user/README.md)** — l'aggregato `User`. Email come Value Object, piani di abbonamento senza gerarchia, e il caso più interessante del progetto: l'unicità dell'email, che non è un invariante dell'aggregato e vive nel vincolo di persistenza.

**I due moduli non si importano tra loro.** Il legame è il solo `ownerId` che il todo conserva: un'identità opaca, non un riferimento a un aggregato. Anche i duplicati apparenti fra i due (`loadTodo` e `loadUser`, `TODO_VALIDATION` e `USER_VALIDATION`) sono deliberati — condividerli creerebbe un contratto fra bounded context.

## Prima di modificare il codice

Due letture, in quest'ordine:

- **[CLAUDE.md](CLAUDE.md)** — i vincoli del repo. Il più importante è che qui convivono **tre versioni di TypeScript** (7.0.2 nativo alla root e nelle app Next, 5.9 nelle app Nest, 6.0.2 per il parser di typescript-eslint) e "allinearle" rompe `nest build` e Jest. Contiene anche le trappole che falliscono in silenzio: `isolatedModules` che azzera i metadata della DI, gli `outDir` dei tsconfig condivisi, le env var non dichiarate in `turbo.json`.
- **Il README del modulo che stai toccando** — e va aggiornato nello stesso commit in cui cambi una delle decisioni che documenta.

Il lint è di fatto zero-tolerance: `eslint-plugin-only-warn` declassa ogni errore a warning, ma gli script usano `--max-warnings 0`. Nessun warning è ignorabile.

Commenti, messaggi degli errori di dominio, nomi dei test e documentazione sono in **italiano**; il codice (identificatori, tipi, nomi di file) in **inglese**.

## Link utili

- [Turborepo — Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Turborepo — Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Turborepo — Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [NestJS — CQRS](https://docs.nestjs.com/recipes/cqrs)
