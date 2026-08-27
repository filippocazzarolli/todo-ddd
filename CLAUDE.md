# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stato attuale

Scaffold `create-turbo` + due app NestJS agganciate al monorepo (`api-command`, `api-query`, split CQRS). **Non esiste ancora codice di dominio o layer DDD**: `apps/web` e `apps/docs` sono le landing page del template, le due API sono lo scaffold `nest new` con il solo `AppController`. Non dare per scontata una struttura DDD esistente — va introdotta.

## Comandi

Da root (tutti passano da Turborepo, che rispetta il grafo delle dipendenze):

```sh
pnpm dev            # tutte le app in watch (web:3000, docs:3001)
pnpm build          # build di tutti i workspace
pnpm lint           # eslint su tutti i workspace
pnpm check-types    # next typegen + tsc --noEmit
pnpm format         # prettier --write su **/*.{ts,tsx,md}
pnpm turbo test     # jest (solo le app Nest lo implementano)
```

Per lavorare su un singolo workspace usa i filtri Turbo (`--filter` accetta il `name` del package.json):

```sh
pnpm turbo dev --filter=web
pnpm turbo build --filter=docs
pnpm turbo lint --filter=@repo/ui
```

Nuovo componente condiviso: `pnpm turbo gen react-component` da `packages/ui`.

Toolchain vincolata: **pnpm 11.23.0** (`packageManager`) e **Node >= 24** (`engines`). Non usare npm/yarn: i workspace usano protocollo `workspace:*`.

Test: solo le app Nest hanno Jest (`test`, `test:watch`, `test:cov`, `test:e2e`). `web` e `docs` non hanno test — `pnpm turbo test` semplicemente le salta. Un singolo test: `pnpm --filter api-command exec jest src/app.controller.spec.ts` (o `-t "nome del test"`).

## Struttura dei workspace

`pnpm-workspace.yaml` include `apps/*` e `packages/*`.

- `apps/web` (3000) e `apps/docs` (3001): Next.js 16 App Router, React 19, CSS Modules. Configurazione identica.
- `apps/api-command` (3002) e `apps/api-query` (3003): NestJS 11 + Express, lato write e lato read. Configurazione identica.
- `packages/ui` → `@repo/ui`: libreria di componenti React condivisa.
- `packages/eslint-config` → `@repo/eslint-config`: config ESLint flat condivise (`base`, `next-js`, `react-internal`, `nest`).
- `packages/typescript-config` → `@repo/typescript-config`: `tsconfig` base condivisi (`base`, `nextjs`, `react-library`, `nestjs`).

## Punti architetturali non ovvi

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
- Le variabili d'ambiente lette a runtime vanno dichiarate in `turbo.json` (`env` dei task `dev`/`start`, o `globalEnv`), altrimenti `turbo/no-undeclared-env-vars` fa fallire il lint.

## Ambiente

`engines` richiede Node >= 24 e pnpm 11.23.0. La toolchain gira anche su Node 22, ma pnpm emette un warning `Unsupported engine` a ogni comando.
