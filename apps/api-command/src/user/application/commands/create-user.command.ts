import { Command } from '@nestjs/cqrs';

import { UserSubscription } from '../../domain/aggregates/user.aggregate';

/**
 * Intenzione di creare un utente.
 *
 * DTO immutabile: nessuna logica, nessuna dipendenza, serializzabile — può
 * arrivare da una coda. Non conosce l'aggregato né il repository: a
 * orchestrarli è l'handler.
 *
 * Non porta lo `userId`: lo genera l'handler tramite `UserIdGenerator` e lo
 * restituisce al chiamante. Il giorno in cui servisse l'idempotenza sulle
 * retry, basta aggiungerlo qui — `CreateUserProps.userId` è già obbligatorio.
 *
 * `email` è una stringa grezza e non un `Email`: il command resta
 * serializzabile e non conosce i Value Object del dominio. A validarla e
 * normalizzarla è `User.create`.
 *
 * `subscription` è tipizzata sulla union del dominio e non su `string`: è un
 * insieme chiuso di tre valori, e lasciare passare una stringa qualunque
 * significherebbe rimandare al runtime un errore che il tipo può già
 * intercettare. Il controllo *a runtime* resta al confine HTTP (`@IsIn` nel
 * DTO), che è l'unico posto dove arrivano dati non tipizzati.
 *
 * `extends Command<string>` tipizza il risultato: `commandBus.execute(cmd)` è
 * `Promise<string>` senza generics al call site.
 */
export class CreateUserCommand extends Command<string> {
  constructor(
    public readonly email: string,
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly subscription?: UserSubscription,
  ) {
    super();
  }
}
