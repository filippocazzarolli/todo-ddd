import { Command } from '@nestjs/cqrs';

/**
 * Campi da aggiornare, nella forma grezza e serializzabile.
 *
 * Due stati per campo, come in `UpdateUserProps`: chiave assente significa
 * "non toccare", un valore significa "assegna". Nessun `null`, perché né il
 * nome né il cognome sono azzerabili — è la differenza con `UpdateTodoFields`,
 * dove il terzo stato serve a svuotare i campi opzionali del todo.
 *
 * Non contiene `email` né `subscription`: la prima avrà `changeEmail`, che
 * deve rendere visibile il vincolo di unicità; la seconda ha già
 * `ChangeUserSubscriptionCommand`. Un update che le assorbisse le farebbe
 * passare per modifiche come le altre.
 */
export interface UpdateUserFields {
  firstName?: string;
  lastName?: string;
}

/**
 * Intenzione di modificare i dati anagrafici di un utente esistente.
 *
 * Un comando solo per i due campi e non due comandi granulari: una modifica
 * dall'interfaccia li tocca insieme, e spezzarla significherebbe due
 * transazioni e due eventi per un'unica azione dell'utente.
 *
 * `fields` è un oggetto e non parametri posizionali: i campi sono tutti
 * opzionali, e con i posizionali si finirebbe a scrivere `undefined` per
 * arrivare all'ultimo.
 */
export class UpdateUserCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly fields: UpdateUserFields,
  ) {
    super();
  }
}
