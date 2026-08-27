import { Command } from '@nestjs/cqrs';

import { UserSubscription } from '../../domain/aggregates/user.aggregate';

/**
 * Intenzione di spostare un utente su un altro piano.
 *
 * Un comando solo e non `UpgradeUser`/`DowngradeUser`: quella coppia richiede
 * un ordinamento fra i piani che il dominio non dichiara (vedi
 * `USER_SUBSCRIPTIONS`). Il piano di destinazione è quindi un dato del
 * comando, non parte della sua identità.
 *
 * Non porta il piano di partenza: sarebbe una precondizione che il chiamante
 * non è in grado di garantire, e il confronto lo fa l'aggregato sullo stato
 * appena caricato. Se un giorno servisse rifiutare un cambio basato su uno
 * stato stantio (compare-and-swap), quello è il controllo di concorrenza
 * ottimistica, non un campo in più qui.
 *
 * `Command<void>`: l'id lo conosce già il chiamante, e il piano è quello che
 * ha chiesto.
 */
export class ChangeUserSubscriptionCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly subscription: UserSubscription,
  ) {
    super();
  }
}
