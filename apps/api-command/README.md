# `api-command` — il lato write

Servizio NestJS 11 + Express che espone il lato **command** dello split CQRS: qui si scrive e si decide. Leggere, filtrare ed elencare è di [`api-query`](../api-query), che è ancora lo scaffold vuoto.

Ascolta su `PORT`, default **3002**. Persiste su SQLite via Drizzle: lo schema e le migrazioni stanno in [`packages/db`](../../packages/db/README.md), il file in `data/todo.sqlite`. Su un clone pulito serve `pnpm db:migrate` prima del primo avvio; `DATABASE_URL` sovrascrive il path.

## Struttura

```
src/
  main.ts            bootstrap
  app.module.ts      composizione radice, CqrsModule.forRoot()
  todo/              modulo di dominio
  user/              modulo di dominio
  shared/            meccanismo comune ai due, senza dominio
                     (incluso DatabaseModule: la connessione e' una sola)
test/                e2e su HTTP vero (solo il modulo todo), su un DB :memory:
```

## I moduli

Ogni modulo di dominio ha gli stessi cinque layer (`presentation/`, `application/`, `domain/`, `persistence/`, `infrastructure/`), con le dipendenze rivolte **solo verso `domain/`**. Ognuno documenta le proprie decisioni, con il perché di quelle non ovvie:

- **[`src/todo/`](src/todo/README.md)** — l'aggregato `Todo`: ciclo di vita, scadenza come Value Object, ownership e controllo di accesso. È il README più completo, e spiega per esteso le convenzioni comuni a entrambi i moduli.
- **[`src/user/`](src/user/README.md)** — l'aggregato `User`: email come Value Object, piani di abbonamento, unicità dell'email. Documenta dove e perché diverge dal primo.

**I due moduli non si importano tra loro.** Il legame è il solo `ownerId` che il todo conserva: un'identità opaca, non un riferimento a un aggregato.

## Comandi

```sh
pnpm dev            # nest start --watch
pnpm build          # nest build -> dist/
pnpm start          # node dist/main
pnpm lint           # eslint --max-warnings 0
pnpm check-types    # tsc --noEmit
pnpm test           # jest — solo src/**
pnpm test:e2e       # gli e2e NON sono inclusi in `pnpm test`
```

Un sottoinsieme dei test: `pnpm exec jest src/todo/domain`, oppure `-t "nome del test"`.

## Altro

- [README del progetto](../../README.md) — monorepo, avvio, architettura d'insieme.
- [CLAUDE.md](../../CLAUDE.md) — i vincoli del repo. In particolare: qui convivono tre versioni di TypeScript, e **questa app deve restare su `^5.9`** — allinearla alla 7 della root rompe `nest build` e Jest.
