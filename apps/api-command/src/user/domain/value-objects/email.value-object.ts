import { UserEmailInvalidError } from '../errors/user.errors';

/**
 * Un `@`, una parte locale non vuota, un dominio con almeno un punto e nessuna
 * etichetta vuota. Nessuno spazio da nessuna parte.
 *
 * Deliberatamente permissivo: nessuna regex può decidere se un indirizzo
 * esiste, e le implementazioni complete di RFC 5322 accettano forme (commenti,
 * quoted-string, indirizzi IP letterali) che nessun sistema reale usa. Il
 * compito qui è scartare ciò che *certamente* non è un indirizzo; la verifica
 * vera è mandare un'email.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Lunghezza massima di un indirizzo secondo RFC 5321. */
const MAX_LENGTH = 254;

/**
 * Value Object dell'indirizzo email.
 *
 * Identità per valore e immutabile: non ha setter, e cambiare email significa
 * sostituire l'intero oggetto. Per questo l'aggregato può tenerlo nel proprio
 * stato e restituirlo nello `snapshot()` senza clonarlo.
 *
 * Normalizza in minuscolo, parte locale inclusa. È tecnicamente una perdita di
 * informazione — RFC 5321 dichiara la parte locale case-sensitive — ma nessun
 * provider reale la tratta così, e conservare il case renderebbe `Email`
 * inutile come chiave: `Mario@x.it` e `mario@x.it` sarebbero due utenti
 * diversi con la stessa casella. La scelta è quindi consapevole: il VO
 * modella "l'indirizzo con cui identifichiamo una persona", non la stringa
 * che ci ha scritto.
 */
export class Email {
  private constructor(private readonly value: string) {}

  /**
   * Costruisce un indirizzo valido e normalizzato, o solleva
   * `UserEmailInvalidError`.
   *
   * Unico costruttore: non esiste una `rehydrate` come in `Expiration`, e non
   * per dimenticanza. Là la coppia serve perché `create` applica una regola
   * *sull'assegnazione* ("non nel passato") che il tempo rende falsa e che
   * renderebbe irricaricabile un dato legittimo. Qui la regola è un invariante
   * permanente del valore: un indirizzo valido resta valido, quindi caricare e
   * assegnare hanno le stesse precondizioni. L'asimmetria nascerà il giorno in
   * cui il formato accettato si stringerà, e sarà quello il momento di
   * introdurre una `rehydrate` più tollerante — non prima.
   */
  static create(value: string): Email {
    const normalized = value.trim().toLowerCase();

    if (normalized.length > MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
      // Nell'errore va il valore trimmato, non quello normalizzato: chi legge
      // il messaggio deve riconoscere ciò che ha scritto, maiuscole comprese.
      throw new UserEmailInvalidError(value.trim());
    }

    return new Email(normalized);
  }

  /** Uguaglianza per valore: è un Value Object, non ha identità. */
  equals(other: Email): boolean {
    return this.value === other.value;
  }

  /**
   * L'indirizzo normalizzato.
   *
   * Serve sia alla lettura umana sia alla persistenza e al payload degli
   * eventi: a differenza di `Expiration`, che ha un `toString()` leggibile e
   * un `toISOString()` assoluto, qui la forma è una sola e non c'è nulla da
   * distinguere.
   */
  toString(): string {
    return this.value;
  }
}
