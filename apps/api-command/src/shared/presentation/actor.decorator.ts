import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Header da cui si legge l'identità dell'attore.
 *
 * **Segnaposto**: chiunque può scrivere qualunque valore qui dentro, quindi
 * questa non è autenticazione — è un modo di far arrivare l'identità ai
 * comandi mentre l'autenticazione vera non c'è. Il nome è esportato perché i
 * test e2e devono usarlo, ed è l'unico posto del repo che lo nomina.
 */
export const ACTOR_HEADER = 'x-user-id';

/**
 * Identità di chi sta eseguendo la richiesta, come `string`.
 *
 * Esiste per una ragione sola: tenere l'attore **fuori dai DTO**. Un
 * `ownerId` nel body di `POST /todos` sarebbe un campo che il client
 * controlla, e chiunque potrebbe creare o modificare todo per conto di
 * chiunque; peggio, sembrerebbe legittimo e resterebbe lì. Passando dal
 * contesto della richiesta, il giorno in cui arriva l'autenticazione vera
 * cambia questo file e nient'altro — i controller, i comandi e il dominio non
 * si accorgono di niente.
 *
 * `401` e non `400` sull'header mancante: la richiesta è ben formata, manca
 * l'identità. È un'`HttpException` di Nest e non un errore del modulo todo,
 * quindi non passa da `TodoErrorFilter`: l'autenticazione precede il dominio e
 * non è un contratto del modulo.
 *
 * Vive in `shared/presentation/` come `@WhenPresent()`: è meccanismo e non
 * contratto, non nomina nessun bounded context, e il modulo `user` ne avrà
 * bisogno appena i suoi comandi dovranno sapere chi li invia.
 */
export function actorFrom(_data: unknown, context: ExecutionContext): string {
  const actorId = context
    .switchToHttp()
    .getRequest<Request>()
    .header(ACTOR_HEADER);

  /*
   * Trimmato e verificato non vuoto: una stringa di soli spazi diventerebbe
   * l'`ownerId` di un todo che non appartiene a nessun utente raggiungibile,
   * e nessun controllo a valle se ne accorgerebbe. È l'unico punto in cui
   * l'identità viene normalizzata: il dominio confronta per uguaglianza esatta
   * e non ha nessun motivo per sapere che esistono spazi in giro.
   */
  const trimmed = actorId?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    throw new UnauthorizedException(
      `Header ${ACTOR_HEADER} mancante: la richiesta non ha un attore`,
    );
  }

  return trimmed;
}

/**
 * La funzione è esportata a parte e il decoratore è solo il suo involucro:
 * `createParamDecorator` nasconde la factory nei metadata della rotta, e
 * l'unico modo di raggiungerla da un test sarebbe leggere quei metadata —
 * accoppiando il test a un dettaglio interno di Nest per verificare tre righe.
 */
export const Actor = createParamDecorator(actorFrom);
