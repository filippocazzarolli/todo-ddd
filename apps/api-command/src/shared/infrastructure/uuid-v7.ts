import { randomBytes } from 'node:crypto';

/**
 * Genera un identificatore come UUIDv7 (RFC 9562), formato canonico.
 *
 * v7 e non v4 perché i primi 48 bit sono il timestamp Unix in millisecondi:
 * gli ID sono ordinati nel tempo, quindi gli insert cadono in coda all'indice
 * come farebbe una sequence, senza la frammentazione del B-tree tipica degli
 * UUID casuali.
 *
 * Implementato a mano perché Node non ha ancora UUIDv7 nativo:
 * `randomUUID({ version: 7 })` ignora l'opzione e restituisce un v4.
 *
 * Nessuna garanzia di monotonicità *dentro* lo stesso millisecondo (il
 * contatore opzionale della RFC non è implementato): due ID generati nello
 * stesso ms si ordinano tra loro in modo casuale. Irrilevante per la locality
 * di inserimento, da rivedere se servisse un ordinamento totale stretto.
 *
 * Vive in `shared/` perché è **meccanismo, non contratto**: è una funzione
 * pura e non sa cosa sta identificando. È il criterio che governa tutto
 * `shared/`, e non il passare o no dalla DI — `SqliteConnection` sta lì pur
 * essendo un provider. Ciò che si condivide è il meccanismo: le porte
 * (`TodoIdGenerator`, `UserIdGenerator`) restano ognuna nel proprio dominio, e
 * i rispettivi adapter sono tre righe di glue su questa funzione.
 */
export function uuidV7(): string {
  const bytes = randomBytes(16);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const timestampMs = Date.now();

  // unix_ts_ms: 48 bit big-endian, spezzati perché DataView non ha setUint48.
  view.setUint16(0, Math.floor(timestampMs / 2 ** 32));
  view.setUint32(2, timestampMs % 2 ** 32);

  // version = 7 (nibble alto del byte 6), variant = 0b10 (bit alti del byte 8).
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x70);
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
