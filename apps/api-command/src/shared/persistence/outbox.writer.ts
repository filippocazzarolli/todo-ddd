import { Injectable } from '@nestjs/common';
import { outbox } from '@repo/db';

import { uuidV7 } from '../infrastructure/uuid-v7';
import { SqliteTransaction } from './sqlite.connection';

/**
 * Scrive gli eventi di un aggregato nella tabella `outbox`, **dentro la
 * transazione che sta scrivendo l'aggregato stesso**.
 *
 * È il pezzo che rende l'ordine persisti-poi-pubblica non più best-effort. Prima
 * fra `add`/`update` e `commit()` c'era una finestra, e un processo che moriva
 * lì dentro perdeva l'evento per sempre: nessun errore, nessun log, solo un read
 * model che divergeva in silenzio. Ora l'evento o è scritto insieme
 * all'aggregato o non lo è nessuno dei due.
 *
 * **Vuole la transazione come parametro invece di prendersela da sé**, ed è la
 * decisione che dà forma a tutto il resto. L'alternativa — un `UnitOfWork` che
 * l'handler avvolge attorno a repository e outbox — legge meglio ma non
 * funziona: una transazione SQLite non può attraversare un `await`, e l'handler
 * è `async`. Avrebbe funzionato per caso, finché il driver resta sincrono, e si
 * sarebbe rotta in silenzio con qualunque altro. Tenendo la transazione dentro
 * il metodo dell'adapter, il confine è dove avvengono le scritture e non dove si
 * spera che avvengano.
 *
 * Il prezzo è che l'adapter di persistenza conosce l'esistenza degli eventi. È
 * accettabile: il repository *è* già il confine di persistenza dell'aggregato, e
 * "scrivi la radice e ciò che ha prodotto, atomicamente" è la stessa unità di
 * lavoro. Il dominio non se ne accorge — nessuna porta cambia, nessun handler
 * cambia.
 *
 * Sta in `shared/` con il criterio di `settle.ts` e `uuid-v7.ts`: è
 * **meccanismo, non contratto**. Non conosce nessun aggregato — `aggregateType`
 * è una stringa che gli passa chi lo chiama — quindi non crea nessun legame fra
 * i due bounded context.
 */
@Injectable()
export class OutboxWriter {
  /**
   * Nessun evento, nessuna riga: un comando che non cambia niente non emette
   * eventi (`Todo.update` a vuoto), e non deve lasciare traccia.
   */
  append(
    tx: SqliteTransaction,
    aggregateType: string,
    aggregateId: string,
    events: readonly object[],
  ): void {
    if (events.length === 0) {
      return;
    }

    tx.insert(outbox)
      .values(
        events.map((event) => ({
          /*
           * L'identità dell'evento, non il suo ordine: quello è la `sequence`
           * generata da SQLite. Un UUIDv7 *sembra* già ordinato — timestamp nei
           * primi 48 bit — ma `uuidV7` non garantisce la monotonicità dentro lo
           * stesso millisecondo, che è esattamente il caso di due eventi
           * prodotti dallo stesso comando. Serve a chi consuma per essere
           * idempotente su una consegna ripetuta.
           */
          eventId: uuidV7(),
          aggregateType,
          aggregateId,
          /*
           * Il nome della classe, come per il discriminante degli errori nel
           * filtro HTTP: nessun evento sovrascrive `name`, e l'alternativa —
           * una costante per evento — sarebbe una seconda verità da tenere
           * allineata. Regge perché `nest build` non minifica; il giorno in cui
           * qualcosa lo facesse, questo è il punto che si rompe.
           */
          name: event.constructor.name,
          /*
           * Qui la convenzione "gli eventi portano solo primitivi
           * serializzabili, mai Value Object" smette di essere una regola di
           * stile e diventa portante: un `Expiration` dentro un evento
           * finirebbe in tabella come `{}`, senza che niente lo segnali.
           */
          payload: JSON.stringify(event),
        })),
      )
      .run();
  }
}
