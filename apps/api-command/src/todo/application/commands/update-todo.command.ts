import { Command } from '@nestjs/cqrs';

/**
 * Campi da aggiornare, nella forma grezza e serializzabile: nessun Value
 * Object, come in `CreateTodoCommand`.
 *
 * La semantica dei tre stati (assente / valore / `null`) è quella di
 * `UpdateTodoProps` — questo tipo la trasporta, l'aggregato la interpreta.
 */
export interface UpdateTodoFields {
  title?: string;
  /** `null` (o una stringa vuota) rimuove la descrizione. */
  description?: string | null;
  important?: boolean;
  /** `null` rimuove la scadenza. */
  expiration?: { date: string; time: string } | null;
  /** Insieme completo dei tag, non un delta. */
  tags?: string[];
}

/**
 * Intenzione di modificare un todo esistente.
 *
 * Un comando solo per cinque campi, e non cinque comandi granulari: una
 * modifica dall'interfaccia tocca più campi insieme, e spezzarla in cinque
 * comandi significherebbe cinque transazioni e cinque eventi per un'unica
 * azione dell'utente, con stati intermedi visibili al lato query che nessuno
 * ha mai chiesto. Il prezzo è che l'evento porta un delta invece di
 * un'intenzione specifica: se un giorno servirà distinguere "rinominato" da
 * "riprogrammato", quei casi diventeranno comandi propri accanto a questo, non
 * al posto suo.
 *
 * `fields` è un oggetto e non una lista di parametri posizionali come in
 * `CreateTodoCommand`: qui i campi sono tutti opzionali e sparsi, e cinque
 * posizionali costringerebbero a scrivere `undefined` per arrivare all'ultimo.
 */
export class UpdateTodoCommand extends Command<void> {
  constructor(
    /**
     * Chi esegue il comando, dal contesto di autenticazione e mai dal body:
     * vedi `CreateTodoCommand`. Qui non assegna niente, serve a `loadTodo` per
     * verificare che l'attore sia il proprietario del todo.
     */
    public readonly actorId: string,
    public readonly todoId: string,
    public readonly fields: UpdateTodoFields,
  ) {
    super();
  }
}
