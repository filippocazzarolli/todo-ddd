import {
  TodoExpirationInPastError,
  TodoExpirationInvalidError,
} from '../errors/todo.errors';

/** Parti grezze della scadenza: data `YYYY-MM-DD` e ora `HH:mm`. */
export interface ExpirationProps {
  date: string;
  time: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const MINUTE_MS = 60_000;

/**
 * Value Object della scadenza: un istante, sempre composto da data *e* ora.
 *
 * Precisione al minuto: secondi e millisecondi non hanno significato per una
 * scadenza, e ammetterli renderebbe diverse due scadenze che l'utente ha
 * espresso allo stesso modo.
 *
 * Identità per valore e immutabile: non ha setter, `toDate()` restituisce una
 * copia e cambiare scadenza significa sostituire l'intero oggetto. Per questo
 * l'aggregato può tenerlo nel proprio stato e restituirlo nello `snapshot()`
 * senza clonarlo.
 *
 * Data e ora sono interpretate nel **fuso locale del processo**: il modello
 * non ha (ancora) un concetto di utente a cui associare un timezone, e
 * "scade il 1/9 alle 18:30" è un'affermazione sull'ora di chi scrive, non su
 * UTC. Quando servirà il multi-fuso, l'offset diventerà una terza parte del VO
 * e `rehydrate` continuerà a funzionare: `toISOString()` persiste già
 * l'istante assoluto.
 */
export class Expiration {
  private constructor(private readonly instant: Date) {}

  /**
   * Costruisce una scadenza *nuova*, rifiutando il passato rispetto a `now`.
   *
   * `now` arriva dall'esterno e non da `new Date()`: come per il `todoId`, il
   * dominio non conosce la fonte del tempo e resta puro e testabile senza
   * fake timer (vedi la porta `Clock`).
   */
  static create(props: ExpirationProps, now: Date): Expiration {
    const expiration = new Expiration(parseInstant(props));

    if (expiration.isPast(now)) {
      throw new TodoExpirationInPastError(expiration.toString());
    }

    return expiration;
  }

  /**
   * Ricostruisce una scadenza già persistita da un istante ISO 8601.
   *
   * Valida che il valore sia un istante parsabile — non la sua semantica: il
   * solo produttore di questi valori è `toISOString()`, e un ISO corrotto che
   * `Date` normalizza silenziosamente (il 30 febbraio) non è un input di
   * dominio ma un dato rotto in persistenza.
   *
   * Non valida il passato: "non nel passato" è una regola
   * sull'assegnazione, non un invariante permanente del valore. Il tempo passa
   * e una scadenza scaduta resta un dato legittimo — validarla qui renderebbe
   * irricaricabile ogni todo scaduto.
   */
  static rehydrate(value: string): Expiration {
    const instant = new Date(value);

    if (Number.isNaN(instant.getTime())) {
      throw new TodoExpirationInvalidError(value);
    }

    // Riallineato alla precisione del VO: la persistenza potrebbe portare
    // secondi (un mapper diverso, una migrazione) che qui non esistono.
    instant.setSeconds(0, 0);

    return new Expiration(instant);
  }

  /** La parte data, `YYYY-MM-DD`, nel fuso locale. */
  get date(): string {
    const year = String(this.instant.getFullYear()).padStart(4, '0');
    const month = String(this.instant.getMonth() + 1).padStart(2, '0');
    const day = String(this.instant.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /** La parte ora, `HH:mm`, nel fuso locale. */
  get time(): string {
    const hour = String(this.instant.getHours()).padStart(2, '0');
    const minute = String(this.instant.getMinutes()).padStart(2, '0');

    return `${hour}:${minute}`;
  }

  /**
   * Confronto alla granularità del VO: il minuto in corso non è passato.
   *
   * Senza il troncamento di `now`, assegnare le 18:30 alle 18:30:20 sarebbe
   * rifiutato — un minuto che l'utente considera ancora futuro.
   */
  isPast(now: Date): boolean {
    return this.instant.getTime() < truncateToMinute(now);
  }

  /** Uguaglianza per valore: è un Value Object, non ha identità. */
  equals(other: Expiration): boolean {
    return this.instant.getTime() === other.instant.getTime();
  }

  /** Copia difensiva: mutare il `Date` restituito non altera il VO. */
  toDate(): Date {
    return new Date(this.instant);
  }

  /** Rappresentazione per la persistenza: istante assoluto, fuso-indipendente. */
  toISOString(): string {
    return this.instant.toISOString();
  }

  /** Rappresentazione leggibile, nelle stesse parti accettate da `create`. */
  toString(): string {
    return `${this.date} ${this.time}`;
  }
}

/**
 * Compone l'istante dalle due parti, rifiutando ciò che non è una data e ora
 * reale.
 */
function parseInstant({ date, time }: ExpirationProps): Date {
  const trimmedDate = date.trim();
  const trimmedTime = time.trim();
  const raw = `${trimmedDate} ${trimmedTime}`;

  if (!DATE_PATTERN.test(trimmedDate) || !TIME_PATTERN.test(trimmedTime)) {
    throw new TodoExpirationInvalidError(raw);
  }

  // Posizioni garantite dai pattern: `slice` restituisce sempre una stringa
  // numerica, quindi nessun narrowing e nessun NaN da gestire qui.
  const year = Number(trimmedDate.slice(0, 4));
  const month = Number(trimmedDate.slice(5, 7));
  const day = Number(trimmedDate.slice(8, 10));
  const hour = Number(trimmedTime.slice(0, 2));
  const minute = Number(trimmedTime.slice(3, 5));

  const instant = new Date(year, month - 1, day, hour, minute, 0, 0);

  /*
   * `new Date` normalizza silenziosamente l'input (il 30 febbraio diventa il
   * 2 marzo, le 25:00 il giorno dopo): l'unico modo per distinguere una data
   * valida da una normalizzata è rileggere i componenti. Rifiuta anche le ore
   * che non esistono per il cambio d'ora legale — che infatti non esistono.
   */
  if (
    instant.getFullYear() !== year ||
    instant.getMonth() !== month - 1 ||
    instant.getDate() !== day ||
    instant.getHours() !== hour ||
    instant.getMinutes() !== minute
  ) {
    throw new TodoExpirationInvalidError(raw);
  }

  return instant;
}

function truncateToMinute(instant: Date): number {
  const time = instant.getTime();

  return time - (time % MINUTE_MS);
}
