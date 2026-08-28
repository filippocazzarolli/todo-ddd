import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createSqliteClient, runMigrations, SqliteClient } from '@repo/db';

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
