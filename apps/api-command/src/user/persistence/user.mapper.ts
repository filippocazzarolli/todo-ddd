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

/**
 * Riga corrotta: un valore in tabella che il dominio non può rappresentare.
 *
 * `cause` porta l'errore di dominio che ha fatto scattare il rifiuto, dove ce
 * n'è uno. Serve a chi legge i log: questa gerarchia esce come 500, e un 500
 * senza il motivo per cui il Value Object ha detto di no è un'ora persa.
 */
export class UserRowInvalidError extends Error {
  constructor(
    public readonly userId: string,
    public readonly column: string,
    public readonly value: unknown,
    options?: ErrorOptions,
  ) {
    super(
      `La riga dell'utente ${userId} ha un valore non valido in ${column}: ${String(value)}`,
      options,
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
    email: toEmail(row.userId, row.email),
    firstName: row.firstName,
    lastName: row.lastName,
    subscription: toSubscription(row.userId, row.subscription),
    deleted: row.deleted,
  };
}

/**
 * Ricostruisce l'email dalla riga, **senza** lasciare che il dominio decida
 * l'esito.
 *
 * `Email.create` e non una `Email.rehydrate`, che non esiste: il suo Value
 * Object argomenta contro l'esistenza di quella coppia, e l'argomento tiene
 * anche qui. `create` applica un invariante *permanente*, mentre
 * `Expiration.rehydrate` esiste perché là la regola è sull'assegnazione e il
 * tempo la rende falsa.
 *
 * Quello che il costruttore di dominio non può decidere è **cosa significhi il
 * suo rifiuto**. Chiamato su input dell'utente significa "richiesta sbagliata";
 * chiamato su una riga già in tabella significa "il database contiene qualcosa
 * che non avremmo mai potuto scriverci", che non è colpa del chiamante. Da qui
 * la traduzione in `UserRowInvalidError`, che nessun filtro cattura e che quindi
 * esce come 500.
 *
 * **Il confronto con il valore normalizzato non è pignoleria.** `create`
 * normalizza (trim e minuscolo), quindi una riga con `Mario@X.it` verrebbe
 * caricata come `mario@x.it` e **riscritta normalizzata** al primo `update`:
 * una mutazione che nessun comando ha chiesto, e che può collidere con
 * `UNIQUE (email)` in un punto che sembra non c'entrare niente. L'adapter
 * scrive sempre il valore già normalizzato, quindi una riga che non lo è non
 * l'ha prodotta lui: è corrotta, e va detto invece di aggiustarla in silenzio.
 */
function toEmail(userId: string, value: string): Email {
  let email: Email;

  try {
    email = Email.create(value);
  } catch (error) {
    throw new UserRowInvalidError(userId, 'email', value, { cause: error });
  }

  if (email.toString() !== value) {
    throw new UserRowInvalidError(userId, 'email', value);
  }

  return email;
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
