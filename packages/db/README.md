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

Tre tabelle. `users` e `todos` in due file separati perché la chiave esterna fra loro è l'unico punto in cui i due bounded context del lato write si toccano — e conviene che si veda. `outbox` non appartiene a nessuno dei due: è il registro ordinato degli eventi di dominio, scritto nella stessa transazione dell'aggregato che li ha prodotti, e `aggregate_type` ne distingue la provenienza come stringa opaca.

Le decisioni non ovvie sono documentate nei rispettivi file. In sintesi:

- **`todos.owner_id` ha una chiave esterna verso `users.user_id`**, e richiede `PRAGMA foreign_keys = ON` (per-connessione, spento per default in SQLite). È il posto in cui `TodoOwnerNotFoundError` viene fatto valere, perché è l'unico in cui la verifica è atomica.
- **`users.email` ha un `UNIQUE` pieno, non parziale**: un utente cancellato continua a occupare la sua email.
- **`status` e `subscription` sono `text` puro**, senza tipi tipizzati: `.$type<TodoStatus>()` costringerebbe questo package a importare il dominio di `api-command`, e `api-query` se lo porterebbe dietro. Il narrowing vive nei mapper delle app.
- **`tags` è `text` con dentro un JSON**, non una colonna `json`: quel modo richiede un cast non verificato a runtime.
- **`outbox` si ordina per `sequence`, non per `event_id`.** L'id è un UUIDv7 e _sembra_ già ordinato, ma la nostra implementazione non garantisce la monotonicità dentro lo stesso millisecondo: due eventi dello stesso comando si ordinerebbero a caso. `sequence` è `INTEGER PRIMARY KEY AUTOINCREMENT` — con `AUTOINCREMENT` e non il rowid implicito, perché senza, SQLite riusa i valori liberati da una cancellazione e un relay con un cursore ripubblicherebbe eventi vecchi dopo una potatura. L'`event_id` resta unico perché è ciò su cui un consumatore costruisce l'idempotenza.
- **`outbox.recorded_at` non è un `occurred_at`.** Dice quando la riga è stata scritta, con il `CURRENT_TIMESTAMP` del database e non l'orologio del processo. Il momento in cui il fatto è accaduto appartiene all'evento, e arriverà quando gli eventi avranno i loro metadati.
- **`todos` e `users` hanno una colonna `version`**, per la concorrenza ottimistica del lato write: l'adapter scrive `UPDATE ... SET version = ? WHERE <id> = ? AND version = ?`, e zero righe toccate significa che qualcun altro è arrivato prima. Il `default 1` non serve all'adapter, che la valorizza sempre: serve alle righe che nascono altrove — una migrazione, una fixture, un import — perché non partano da un valore che il dominio non si aspetta.

## Il contratto di lettura, e chi comanda su questo package

Questo package è consumato da tre parti — i due bounded context del lato write e
il lato read — quindi **è uno Shared Kernel**, con la proprietà che quel nome
porta con sé: nessuno dei consumatori può cambiarlo da solo. Oggi il costo è
zero (tre tabelle, un team), ma è una proprietà del pattern e non una
conseguenza della dimensione, e conviene averla scritta prima che serva.

Le regole che ne derivano:

- **`api-query` legge le view di [`src/schema/read.ts`](./src/schema/read.ts)**,
  `todos_read` e `users_read`, mai le tabelle base. Sono il confine che assorbe i
  rename di colonna del lato write: cambiare `todos.title` è una riga qui invece
  che ogni query dall'altra parte. `src/schema/read.spec.ts` verifica che le view
  esistano e che espongano **esattamente** le colonne del contratto — è la parte
  che si romperebbe in silenzio, perché una colonna nuova che spunta in una view
  non dà nessun errore.
- **`version` e `outbox` restano fuori dal contratto.** La prima è il meccanismo
  di concorrenza ottimistica del lato write; la seconda è macchinario interno, e
  il giorno in cui il reader dovrà consumare gli eventi lo farà da un bus, non da
  una `SELECT`.
- **La chiave esterna `todos.owner_id -> users.user_id` è il costo del kernel con
  l'orizzonte più lungo.** Vincola i due bounded context a vivere nello stesso
  database: il giorno in cui `user` migrasse altrove, `TodoOwnerNotFoundError`
  resterebbe senza chi lo faccia valere, e la verifica diventerebbe una policy in
  coerenza eventuale. Non è un motivo per toglierla oggi — è un motivo per non
  scoprirlo quel giorno.

Le view **non risolvono** il problema di fondo, e vale la pena dirlo invece di
lasciarlo intendere: leggere lo stato del write model non è un read model. Quello
vero sono tabelle di proiezione alimentate dagli eventi, e richiede il relay che
oggi non legge l'`outbox`. Le view sono il confine più economico che si possa
mettere nel frattempo, e spariranno insieme a questa dipendenza.

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
