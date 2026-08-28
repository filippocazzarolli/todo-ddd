import { Module } from '@nestjs/common';

import { OutboxWriter } from './outbox.writer';
import { SqliteConnection } from './sqlite.connection';

/**
 * Fornisce la connessione e l'`OutboxWriter` ai moduli che hanno adapter di
 * persistenza.
 *
 * Non è `@Global()` di proposito: il repo tratta la globalità di `CqrsModule`
 * come un'eccezione motivata, non come default, e un `imports: [DatabaseModule]`
 * esplicito rende visibile quali moduli toccano il database.
 *
 * Condividere la connessione **non** accoppia i due bounded context: `todo/` non
 * nomina `User` e continua a non farlo. Il punto in cui si toccano è lo schema,
 * per la chiave esterna su `owner_id`, e quella è una decisione deliberata
 * documentata in `src/todo/README.md`.
 */
@Module({
  providers: [SqliteConnection, OutboxWriter],
  exports: [SqliteConnection, OutboxWriter],
})
export class DatabaseModule {}
