import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createSqliteClient, runMigrations, SqliteClient } from '@repo/db';

/**
 * Il client dentro una transazione, come lo passa Drizzle al callback di
 * `db.transaction()`.
 *
 * **Derivato invece che importato**, e non è vezzo: il tipo vero è un
 * `SQLiteTransaction<...>` con cinque parametri generici che vive in un percorso
 * dello store pnpm, e nominarlo qui ripeterebbe la trappola TS4058 già
 * documentata in `@repo/db`. Ricavarlo dalla firma del metodo lo tiene
 * automaticamente allineato al client, che è l'unico posto in cui la scelta del
 * driver è dichiarata.
 *
 * Sta qui e non in `@repo/db` per la stessa ragione al contrario: là
 * `declaration: true` dovrebbe emetterlo in un `.d.ts`, qui no.
 */
export type SqliteTransaction = Parameters<
  Parameters<SqliteClient['db']['transaction']>[0]
>[0];

/**
 * La connessione SQLite dell'applicazione, e l'unica.
 *
 * **Non è una porta**, ed è per questo che è una classe concreta invece di una
 * `abstract class`: nessun file di `domain/` la nomina e il dominio non sa che
 * esiste. Una classe concreta è già un token DI valido, quindi non serve altro.
 * Sta in `shared/` con lo stesso criterio di `uuid-v7.ts` — è **meccanismo, non
 * contratto** — pur essendo la prima cosa di `shared/` a passare dalla DI.
 *
 * **Deve esistere in una sola istanza**, e per questo è dichiarata solo nei
 * `providers` di `DatabaseModule`. Elencarla anche in `TodoModule` o
 * `UserModule` farebbe creare a Nest un'istanza per modulo: con un database su
 * file sarebbero due connessioni allo stesso file (e il confine transazionale
 * futuro sarebbe una bugia), ma nei test, dove il database è `:memory:` e quindi
 * privato per connessione, sarebbero **due database distinti** — gli utenti in
 * uno, i todo nell'altro, e la chiave esterna violata da ogni singolo `POST
 * /todos`. Un 400 su tutto, senza niente che indichi la causa.
 *
 * Le migrazioni girano all'avvio e non in un passo separato: così vale sia in
 * produzione sia nei test, e non esiste un passo che un e2e possa dimenticare.
 * `runMigrations` è idempotente — drizzle tiene il registro di quelle già
 * applicate in una tabella propria.
 */
@Injectable()
export class SqliteConnection implements OnModuleInit, OnApplicationShutdown {
  private readonly client: SqliteClient;

  constructor() {
    this.client = createSqliteClient();
  }

  /** Il query builder di Drizzle: è ciò che usano gli adapter dei repository. */
  get db(): SqliteClient['db'] {
    return this.client.db;
  }

  /**
   * Esegue `work` dentro una transazione, restituendo il suo valore.
   *
   * **Sincrona, e non per pigrizia.** `db.transaction()` su `better-sqlite3`
   * restituisce un valore e non una promise, perché il driver è sincrono. È
   * anche l'unico motivo per cui questo metodo può esistere in questa forma: una
   * transazione SQLite **non può attraversare un `await`**, quindi un
   * `transaction(async () => ...)` si aprirebbe e chiuderebbe attorno a niente,
   * lasciando le scritture fuori. Da qui la scelta di tenere la transazione
   * dentro il metodo dell'adapter invece di lasciarla aprire agli handler: lì
   * sarebbe stata `async` per forza, e avrebbe funzionato solo finché il driver
   * resta questo.
   *
   * Un `throw` dentro `work` fa il rollback e propaga: è così che gli adapter
   * annullano una scrittura già eseguita — l'insert del todo con un proprietario
   * inesistente, per dirne una.
   */
  transaction<T>(work: (tx: SqliteTransaction) => T): T {
    return this.client.db.transaction(work);
  }

  onModuleInit(): void {
    runMigrations(this.client.db);
  }

  onApplicationShutdown(): void {
    this.client.connection.close();
  }

  /**
   * Legge un pragma. Serve ai test per verificare che la connessione sia
   * configurata come deve: è l'unica ragione per cui la connessione grezza è
   * raggiungibile da fuori.
   */
  pragma(name: string): unknown {
    return this.client.connection.pragma(name, { simple: true });
  }
}
