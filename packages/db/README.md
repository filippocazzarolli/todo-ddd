# `@repo/db` — schema e connessione

Lo schema Drizzle del database SQLite, le sue migrazioni e la funzione che apre la connessione. Consumato da [`api-command`](../../apps/api-command) (che scrive) e da [`api-query`](../../apps/api-query) (che leggerà).

## Perché è un package e non una cartella di `api-command`

Il query builder di Drizzle lavora sugli **oggetti tabella**: `db.select().from(todos).where(eq(todos.ownerId, x))` non si scrive senza importare `todos`. Quando il lato read verrà implementato importerà quelle stesse tabelle, e l'unica alternativa sarebbe SQL raw, che rinuncia al type safety proprio dove serve. Da qui un workspace che entrambe le app possono importare.

**Ha un build step**, a differenza di `@repo/ui`. Quel package esporta TSX crudo perché lo transpila Next; qui i consumatori sono `nest build` (che è `tsc`, e non compila sorgenti fuori dal proprio progetto) e poi `node dist/main`. Esportare `.ts` produrrebbe test verdi e un `MODULE_NOT_FOUND` in produzione: divergenza test/prod perfettamente silenziosa.

## Dove stanno le cose

Sono quattro categorie con destinazioni diverse, e mescolarle è l'errore da evitare:

| Cosa                                          | Dove                           | Perché lì                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema (`src/schema/`)                        | in questo package              | è codice sorgente versionato, e lo importano due app                                                                                                                                                                                           |
| Migrazioni (`migrations/`)                    | in questo package              | drizzle-kit le tiene in sync con lo schema tramite lo snapshot in `meta/`, e `drizzle-kit check` verifica quella coerenza; il migrator le risolve da un path relativo al package, non alla cwd; vanno reviewate nello stesso diff dello schema |
| File di database (`*.sqlite`, `-wal`, `-shm`) | `data/` nella root, gitignored | è dato mutabile e non codice; è condiviso fra i due lati, quindi non appartiene a nessuno dei due; nessuna pulizia di build lo può raggiungere; non entra negli input di hash di nessun workspace                                              |
| Path della connessione                        | `DATABASE_URL`                 | in produzione sarà un volume montato con path assoluto — il default locale serve solo alla DX                                                                                                                                                  |

`src/paths.ts` è l'unico posto che conosce quei percorsi. La risalita a `REPO_ROOT` conta lo stesso numero di livelli sia da `dist/` sia da `src/` (sono allo stesso livello), quindi vale sia a runtime sia quando drizzle-kit transpila lo schema con esbuild-register. Il conteggio dei `..` è l'unica fragilità del layout, e `paths.spec.ts` esiste per farlo fallire in `pnpm test` invece che a runtime.

## Comandi

```sh
pnpm --filter @repo/db build          # tsc -> dist/, con i .d.ts
pnpm --filter @repo/db dev            # tsc --watch (nest start --watch non ricompila questo package)
pnpm --filter @repo/db test           # i test sui path
pnpm db:generate                      # drizzle-kit generate, dopo una modifica allo schema
pnpm db:migrate                       # applica le migrazioni pendenti
```

**Dopo ogni modifica a `src/schema/`, `pnpm db:generate`.** Niente lo impone: `build`, `lint` e `test` passano tutti con lo schema e le migrazioni disallineati, e il disallineamento si scopre a runtime con un errore SQL. L'unico comando che lo verifica è `drizzle-kit check`, che gira dentro `check-types` di questo package.

## Lo schema

Due tabelle, `users` e `todos`, in due file separati perché la chiave esterna fra loro è l'unico punto in cui i due bounded context del lato write si toccano — e conviene che si veda.

Le decisioni non ovvie sono documentate nei rispettivi file. In sintesi:

- **`todos.owner_id` ha una chiave esterna verso `users.user_id`**, e richiede `PRAGMA foreign_keys = ON` (per-connessione, spento per default in SQLite). È il posto in cui `TodoOwnerNotFoundError` viene fatto valere, perché è l'unico in cui la verifica è atomica.
- **`users.email` ha un `UNIQUE` pieno, non parziale**: un utente cancellato continua a occupare la sua email.
- **`status` e `subscription` sono `text` puro**, senza tipi tipizzati: `.$type<TodoStatus>()` costringerebbe questo package a importare il dominio di `api-command`, e `api-query` se lo porterebbe dietro. Il narrowing vive nei mapper delle app.
- **`tags` è `text` con dentro un JSON**, non una colonna `json`: quel modo richiede un cast non verificato a runtime.
- **Entrambe le tabelle hanno una colonna `version`**, per la concorrenza ottimistica del lato write: l'adapter scrive `UPDATE ... SET version = ? WHERE <id> = ? AND version = ?`, e zero righe toccate significa che qualcun altro è arrivato prima. Il `default 1` non serve all'adapter, che la valorizza sempre: serve alle righe che nascono altrove — una migrazione, una fixture, un import — perché non partano da un valore che il dominio non si aspetta.

## La connessione

`createSqliteClient({ url, readOnly })` applica i pragma, e non sono interscambiabili fra i due ruoli:

| Pragma         | Writer                | Reader                                                     |
| -------------- | --------------------- | ---------------------------------------------------------- |
| `journal_mode` | `WAL`, una volta sola | **mai** — è persistente nell'header, non nella connessione |
| `foreign_keys` | `ON`                  | irrilevante                                                |
| `synchronous`  | `NORMAL`              | —                                                          |
| `busy_timeout` | sì                    | sì — senza, `SQLITE_BUSY` invece di aspettare              |
| `query_only`   | —                     | `ON`, seconda rete oltre a `readonly`                      |

Il client crea anche la cartella `data/` se manca: è gitignored, quindi su un clone pulito non esiste, e better-sqlite3 non crea directory — senza, il primo avvio morirebbe con `SQLITE_CANTOPEN`.

Su `:memory:` (che è ciò che usano tutti i test) il `PRAGMA journal_mode = WAL` **non ha effetto** e non fallisce: resta `memory`. La suite non esercita il journal mode di produzione, e non ci si può costruire sopra un test di concorrenza.

## Due vincoli

**Nessun decoratore Nest qui.** Questo package estende `@repo/typescript-config/base.json`, che non ha `emitDecoratorMetadata`: un `@Injectable()` compilerebbe senza metadata e la DI per costruttore si romperebbe a runtime, senza errori in build. Il package è framework-agnostico, e la classe iniettabile che avvolge la connessione vive in `api-command`.

**Import relativi senza estensione.** drizzle-kit legge lo schema con esbuild-register, che non risolve `./foo.js`.

## Altro

- [README del progetto](../../README.md)
- [CLAUDE.md](../../CLAUDE.md) — in particolare: `better-sqlite3` è un modulo nativo e richiede una voce in `allowBuilds` di `pnpm-workspace.yaml`, altrimenti il binding non viene installato e l'errore arriva a runtime.
