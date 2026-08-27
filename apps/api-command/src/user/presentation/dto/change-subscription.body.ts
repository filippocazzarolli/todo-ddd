import { IsIn } from 'class-validator';

import { USER_SUBSCRIPTIONS } from '../../domain/aggregates/user.aggregate';
/*
 * `import type` obbligatorio, non stilistico: con `emitDecoratorMetadata` +
 * `isolatedModules` un tipo usato in una signature decorata deve essere
 * dichiarato type-only (TS1272), altrimenti il compilatore non sa se emettere
 * il riferimento nei metadata. È lo specchio della trappola in CLAUDE.md — là
 * `import type` rompe la DI perché i metadata *servono*, qui l'import normale
 * rompe la compilazione perché i metadata non possono esistere. La tupla
 * `USER_SUBSCRIPTIONS` è invece un valore e resta un import normale.
 */
import type { UserSubscription } from '../../domain/aggregates/user.aggregate';

/**
 * Body di `PUT /users/:userId/subscription`.
 *
 * Un campo solo e obbligatorio: la rotta esprime già l'intenzione, il body
 * porta il solo dato che le serve. `@IsIn` legge la lista da
 * `USER_SUBSCRIPTIONS` perché il tipo non esiste a runtime, ed è l'unico
 * controllo che protegge lo stato dell'aggregato da un piano inventato.
 */
export class ChangeSubscriptionBody {
  @IsIn(USER_SUBSCRIPTIONS)
  subscription!: UserSubscription;
}
