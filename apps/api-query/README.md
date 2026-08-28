# `api-query` — il lato read

Servizio NestJS 11 + Express che dovrà esporre il lato **query** dello split CQRS: leggere, filtrare, elencare. Scrivere e decidere è di [`api-command`](../api-command).

Ascolta su `PORT`, default **3003**.

## Stato

**È ancora lo scaffold `nest new`**: il solo `AppController` con un `GET /` che risponde `Hello World!`. Nessun read model, nessuna rotta di lettura, nessuna connessione al database.

Ciò che c'è è la **configurazione**, pronta perché il lavoro cominci senza toccarla:

| Dipendenza                                 | A cosa serve                                    |
| ------------------------------------------ | ----------------------------------------------- |
| `@repo/db`                                 | gli oggetti tabella su cui si scrivono le query |
| `drizzle-orm`                              | gli operatori (`eq`, `and`, `desc`)             |
| `better-sqlite3` + `@types/better-sqlite3` | il driver                                       |

Il primo pezzo di codice del lato read comincia quindi da `import { todos } from '@repo/db/schema'`.

## Come si legge lo stesso database

Il file SQLite è condiviso con `api-command`, che è l'unico a scriverlo. Cinque cose da sapere prima di aprire una connessione, perché nessuna si deduce dal codice esistente:

**La connessione va aperta in sola lettura**: `readOnly: true`, `fileMustExist: true`, e `PRAGMA query_only = ON` come seconda rete. `createSqliteClient({ readOnly: true })` di `@repo/db` fa già tutto questo. Il privilegio di scrittura resta del lato write non per convenzione ma per rifiuto del driver.

**Non eseguire `PRAGMA journal_mode`.** Il journal mode è persistente nell'header del file, non una proprietà della connessione: lo imposta il writer una volta sola. Su una connessione readonly il tentativo è un no-op.

**Un reader su un database in WAL ha bisogno di accesso in _scrittura_ al file `-shm`.** Fra due processi dello stesso utente sulla stessa macchina non è un problema. Lo diventa in un container con filesystem read-only, un volume montato `ro`, o un uid diverso: in quel caso il reader non apre affatto il database. E WAL richiede un filesystem locale — mai NFS o SMB.

**L'ordine di avvio conta.** Il reader non può creare né migrare il database: su un clone pulito serve `pnpm db:migrate` (o un avvio di `api-command`) prima. `fileMustExist: true` fa fallire l'avvio in modo esplicito invece di aprire un database vuoto altrove, che è il modo silenzioso di sbagliare.

**Le query si scrivono sulle tabelle di scrittura**, e quindi lo schema del lato write è il contratto del lato read: rinominare una colonna in `api-command` è un breaking change qui. È una scelta pragmatica dichiarata, non una dimenticanza — vedi _Il confine_ qui sotto.

## Il confine

Leggere le tabelle di scrittura **aggira** il problema che il progetto ha, invece di risolverlo: gli eventi di dominio non escono dal processo (`EventBus` in-process, nessun iscritto), quindi non esiste un percorso command → query e non c'è nessuna proiezione da leggere.

Le due strade per uscirne, in ordine di costo:

1. **Una view Drizzle** (`sqliteView`) in `@repo/db`, che diventa il contratto di lettura e assorbe i cambi di colonna fisica. Costa una view e non tocca il lato write.
2. **Un read model vero**: tabelle di proiezione alimentate dagli eventi. È il CQRS che il progetto ha progettato, e richiede prima l'outbox e un bus fra i due processi — vedi _Cosa manca_ nel [README del modulo todo](../api-command/src/todo/README.md#cosa-manca).

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

## Altro

- [README del progetto](../../README.md) — monorepo, avvio, architettura d'insieme.
- [`packages/db`](../../packages/db/README.md) — schema, migrazioni, dove sta il file di database.
- [CLAUDE.md](../../CLAUDE.md) — i vincoli del repo. In particolare: qui convivono tre versioni di TypeScript, e **questa app deve restare su `^5.9`**.
