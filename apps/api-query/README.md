# `api-query` — il lato read

Servizio NestJS 11 + Express che dovrà esporre il lato **query** dello split CQRS: leggere, filtrare, elencare. Scrivere e decidere è di [`api-command`](../api-command).

Ascolta su `PORT`, default **3003**.

## Stato

**È ancora lo scaffold `nest new`**: il solo `AppController` con un `GET /` che risponde `Hello World!`. Nessun read model, nessuna rotta di lettura, nessuna connessione al database.

Ciò che c'è è la **configurazione**, pronta perché il lavoro cominci senza toccarla:

| Dipendenza                                 | A cosa serve                                   |
| ------------------------------------------ | ---------------------------------------------- |
| `@repo/db`                                 | le view di lettura su cui si scrivono le query |
| `drizzle-orm`                              | gli operatori (`eq`, `and`, `desc`)            |
| `better-sqlite3` + `@types/better-sqlite3` | il driver                                      |

Il primo pezzo di codice del lato read comincia quindi da `import { todosRead } from '@repo/db/schema'` — la **view**, non la tabella: vedi _Il confine_.

## Come si legge lo stesso database

Il file SQLite è condiviso con `api-command`, che è l'unico a scriverlo. Cinque cose da sapere prima di aprire una connessione, perché nessuna si deduce dal codice esistente:

**La connessione va aperta in sola lettura**: `readOnly: true`, `fileMustExist: true`, e `PRAGMA query_only = ON` come seconda rete. `createSqliteClient({ readOnly: true })` di `@repo/db` fa già tutto questo. Il privilegio di scrittura resta del lato write non per convenzione ma per rifiuto del driver.

**Non eseguire `PRAGMA journal_mode`.** Il journal mode è persistente nell'header del file, non una proprietà della connessione: lo imposta il writer una volta sola. Su una connessione readonly il tentativo è un no-op.

**Un reader su un database in WAL ha bisogno di accesso in _scrittura_ al file `-shm`.** Fra due processi dello stesso utente sulla stessa macchina non è un problema. Lo diventa in un container con filesystem read-only, un volume montato `ro`, o un uid diverso: in quel caso il reader non apre affatto il database. E WAL richiede un filesystem locale — mai NFS o SMB.

**L'ordine di avvio conta.** Il reader non può creare né migrare il database: su un clone pulito serve `pnpm db:migrate` (o un avvio di `api-command`) prima. `fileMustExist: true` fa fallire l'avvio in modo esplicito invece di aprire un database vuoto altrove, che è il modo silenzioso di sbagliare.

**Le query si scrivono sulle view `todos_read` e `users_read`, mai sulle tabelle base.** Sono il contratto di lettura, e sono ciò che assorbe un rename di colonna nel lato write: senza, ogni query di qui dipenderebbe dai nomi fisici di un modello su cui questa app non ha voce in capitolo. Restano fuori dal contratto `version` (meccanismo di concorrenza ottimistica del lato write) e `outbox` (macchinario interno). Vedi _Il confine_ qui sotto per ciò che le view **non** risolvono.

## Il confine

Leggere lo stato del write model **aggira** il problema che il progetto ha, invece di risolverlo: non esiste ancora un percorso command → query, quindi non c'è nessuna proiezione da leggere. Le view sono un confine, non una soluzione — e la distinzione conta, perché un confine ben messo rende facile non accorgersi di quello che manca.

Dov'è arrivato il percorso, e dove si ferma:

1. ✅ **Gli eventi sono durevoli.** `api-command` li scrive nella tabella `outbox` nella stessa transazione dell'aggregato: un evento non si perde più fra la write e la pubblicazione.
2. ✅ **Il contratto di lettura è dichiarato.** Le view di [`@repo/db`](../../packages/db/README.md) assorbono i cambi di colonna fisica, e una spec verifica che espongano esattamente ciò che promettono.
3. ❌ **Manca il relay.** Nessuno legge l'`outbox` e pubblica: gli eventi restano lì. Serve prima un package condiviso per i contratti degli eventi — oggi le classi vivono in `api-command` e questo workspace non può importarle — e i metadati che un bus reale richiede (`occurredAt` vero, versione dello schema).
4. ❌ **Manca il read model vero**: tabelle di proiezione alimentate da quegli eventi. È il CQRS che il progetto ha progettato, e il giorno in cui esisterà le view spariranno insieme a questa dipendenza dal write model.

Vedi _Cosa manca_ nel [README del modulo todo](../api-command/src/todo/README.md#cosa-manca).

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
