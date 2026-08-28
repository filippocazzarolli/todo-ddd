import { NewUserRow, UserRow } from '@repo/db';

import {
  USER_SUBSCRIPTIONS,
  UserProps,
  UserSubscription,
} from '../domain/aggregates/user.aggregate';
import { Email } from '../domain/value-objects/email.value-object';

/**
 * Traduzione fra lo stato dell'aggregato e la riga della tabella.
 *
 * Vive in `persistence/` e non altrove: importa dal dominio (`UserProps`,
 * `Email`) e da `@repo/db` (la forma della riga), e nessun file di `domain/` lo
 * nomina — la regola di dipendenza regge. Nel dominio farebbe dipendere
 * `domain/` dalla forma della riga; in `@repo/db` farebbe dipendere il package
 * condiviso dal dominio di questa app, e `api-query` se lo porterebbe dietro.
 *
 * È qui che si vede perché `UserProps` non si è dovuto dividere in due tipi come
 * annunciava il suo commento: la differenza fra stato interno e riga è un
 * `Email` da un lato e una `string` dall'altro, e sta interamente in queste due
 * funzioni.
 */

/** Riga corrotta: un valore in tabella che il dominio non può rappresentare. */
export class UserRowInvalidError extends Error {
  constructor(
    public readonly userId: string,
    public readonly column: string,
    public readonly value: unknown,
  ) {
    super(
      `La riga dell'utente ${userId} ha un valore non valido in ${column}: ${String(value)}`,
    );
  }
}

export function toRow(state: Readonly<UserProps>): NewUserRow {
  return {
    userId: state.userId,
    // La stringa che esce dal Value Object, quindi già normalizzata: se qui
    // finisse il valore grezzo, `Mario@x.it` e `mario@x.it` sarebbero due righe
    // diverse e `UNIQUE (email)` non varrebbe niente.
    email: state.email.toString(),
    firstName: state.firstName,
    lastName: state.lastName,
    subscription: state.subscription,
    deleted: state.deleted,
  };
}

export function toProps(row: UserRow): UserProps {
  return {
    userId: row.userId,
    /*
     * `Email.create` e non una `Email.rehydrate`, che non esiste: il suo Value
     * Object argomenta contro l'esistenza di quella coppia, e l'argomento tiene
     * anche qui. `create` applica un invariante *permanente* ed è idempotente su
     * ciò che ha prodotto lei stessa — `trim` e `toLowerCase` su un valore già
     * normalizzato sono no-op — mentre `Expiration.rehydrate` esiste perché là
     * la regola è sull'assegnazione e il tempo la rende falsa.
     *
     * Conseguenza accettata: una riga con un'email corrotta esce come
     * `UserEmailInvalidError`, cioè un 400, dove un 500 sarebbe più onesto. Vale
     * lo stesso per `Expiration.rehydrate`, ed è il prezzo di non avere un
     * secondo costruttore più permissivo di quello vero.
     */
    email: Email.create(row.email),
    firstName: row.firstName,
    lastName: row.lastName,
    subscription: toSubscription(row.userId, row.subscription),
    deleted: row.deleted,
  };
}

/**
 * Narrowing e non un cast: la colonna è `text` puro nello schema, perché
 * tipizzarla lì costringerebbe `@repo/db` a importare questo dominio. La lista
 * dei valori ammessi resta una sola, quella che il dominio già possiede come
 * tupla a runtime.
 */
function toSubscription(userId: string, value: string): UserSubscription {
  const subscription = USER_SUBSCRIPTIONS.find((known) => known === value);

  if (subscription === undefined) {
    throw new UserRowInvalidError(userId, 'subscription', value);
  }

  return subscription;
}
