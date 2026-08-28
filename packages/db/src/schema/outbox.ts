import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Gli eventi di dominio, scritti **nella stessa transazione** dell'aggregato che
 * li ha prodotti.
 *
 * È il pattern outbox, e risolve un problema che l'ordine persisti-poi-pubblica
 * non poteva risolvere: fra la scrittura e la pubblicazione c'è una finestra, e
 * un processo che muore lì dentro perde l'evento per sempre. Il read model
 * divergerebbe in modo permanente e silenzioso — nessun errore, nessun log,
 * solo un dato che non arriva mai. Con la riga di outbox dentro la transazione,
 * l'evento o è scritto insieme all'aggregato o non lo è nessuno dei due.
 *
 * **La tabella non appartiene a nessuno dei due bounded context**, ed è il primo
 * oggetto dello schema a non appartenere a un aggregato: `aggregate_type`
 * distingue le due provenienze come stringa opaca, senza che lo schema conosca
 * l'insieme dei valori — la stessa scelta di `status` e `subscription`.
 *
 * Quello che ancora manca è il **relay**: nessuno legge questa tabella e
 * pubblica. Finché non esiste, l'outbox è una registrazione durevole e basta —
 * ma è la metà che non si può recuperare a posteriori, perché un evento non
 * scritto non lo si ritrova più.
 */
export const outbox = sqliteTable(
  "outbox",
  {
    /**
     * L'ordine di produzione, e la chiave primaria.
     *
     * **Serve una sequenza vera e non basta l'id dell'evento**, anche se è un
     * UUIDv7 con il timestamp nei primi 48 bit: la nostra implementazione non
     * garantisce la monotonicità *dentro* lo stesso millisecondo, quindi due
     * eventi prodotti dallo stesso comando si ordinerebbero fra loro a caso. Il
     * relay deve consegnare nell'ordine in cui i fatti sono accaduti — riaprire
     * prima di completare non è la stessa storia — e un ordinamento che è
     * corretto quasi sempre è peggio di uno sbagliato sempre, perché non lo si
     * scopre.
     *
     * `AUTOINCREMENT` e non il rowid implicito: senza, SQLite riusa i valori
     * liberati da una cancellazione, e un relay che tiene un cursore
     * ripubblicherebbe eventi vecchi dopo una potatura della tabella.
     */
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    /**
     * L'identità dell'evento, come UUIDv7. Non è la chiave primaria ma resta
     * unica: è ciò su cui un consumatore costruisce l'idempotenza, dato che una
     * consegna "at least once" gli farà vedere lo stesso evento più volte.
     */
    eventId: text("event_id").notNull().unique(),
    /** `todo` o `user`, come stringa opaca: lo schema non conosce i domini. */
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    /** Il nome della classe dell'evento, che è il suo discriminante. */
    name: text("name").notNull(),
    /** L'evento serializzato in JSON. */
    payload: text("payload").notNull(),
    /**
     * Quando la riga è stata **registrata**, non quando il fatto è accaduto.
     *
     * La differenza non è pedanteria: un `occurredAt` vero appartiene
     * all'evento e deve arrivare dalla porta `Clock` del dominio, insieme a
     * `eventId` e alla versione dello schema. Finché gli eventi non portano quei
     * metadati, questa colonna dice solo ciò che sa davvero — e il default di
     * SQLite la rende l'orologio del database invece che quello del processo,
     * che è la scelta giusta per un ordinamento fra scrittori diversi.
     */
    recordedAt: text("recorded_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    /**
     * NULL finché il relay non l'ha pubblicato. È l'unica colonna che il relay
     * scriverà, ed è la ragione dell'indice: la sua query è "le non pubblicate,
     * in ordine".
     */
    publishedAt: text("published_at"),
  },
  (table) => [index("outbox_pending").on(table.publishedAt, table.sequence)],
);
