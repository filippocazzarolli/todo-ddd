import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { UserNotFoundError } from '../application/errors/user-not-found.error';
import {
  UserAlreadySubscribedError,
  UserDeletedError,
  UserDomainError,
} from '../domain/errors/user.errors';
import { UserPersistenceError } from '../domain/ports/user.repository.errors';

/**
 * Traduce gli errori del modulo user in risposte HTTP.
 *
 * È l'unico posto del modulo che conosce HTTP oltre al controller: il dominio
 * lancia errori che non sanno di essere in un web server, e questa è la
 * mappatura che l'aveva promesso.
 *
 * Registrato sul controller e non globalmente: mappa i tipi di *questo*
 * modulo, e un filtro globale li renderebbe un contratto di tutta l'app.
 */
@Catch(UserDomainError, UserNotFoundError, UserPersistenceError)
export class UserErrorFilter implements ExceptionFilter<Error> {
  catch(error: Error, host: ArgumentsHost): void {
    const statusCode = statusOf(error);

    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      /*
       * Il nome della classe, non `error.name`: nessuno di questi errori
       * sovrascrive `name`, che resterebbe 'Error' per tutti. Serve al client
       * per distinguere i casi che collassano sullo stesso status — 409 può
       * essere "già cancellato", "già su quel piano" o "email già registrata",
       * e la reazione giusta è diversa per ognuno.
       */
      error: error.constructor.name,
      message: error.message,
    });
  }
}

/**
 * Status HTTP per un errore del modulo.
 *
 * L'ordine dei controlli è la logica: prima i casi specifici, poi le due
 * classi base. Le due violazioni di ciclo di vita sono 409 perché la richiesta
 * è formalmente valida e in conflitto con lo stato attuale; ogni altro errore
 * di dominio è 400, perché è un input che il dominio ha rifiutato.
 */
function statusOf(error: Error): HttpStatus {
  if (error instanceof UserNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }

  if (
    error instanceof UserDeletedError ||
    error instanceof UserAlreadySubscribedError
  ) {
    return HttpStatus.CONFLICT;
  }

  /*
   * Scritture andate a vuoto: id duplicato, email già registrata o aggregato
   * scomparso sotto le mani. 409 e non 500 perché non è un guasto — è un
   * vincolo di unicità o una corsa persa, e per il client la reazione è
   * cambiare il dato o ricaricare e riprovare.
   *
   * `UserEmailAlreadyTakenError` finisce qui e non su 400: l'indirizzo è
   * formalmente valido, il problema è che appartiene a un altro. È il caso in
   * cui il campo `error` del body vale davvero — un 409 generico non
   * distinguerebbe "riprova" da "usa un'altra email".
   */
  if (error instanceof UserPersistenceError) {
    return HttpStatus.CONFLICT;
  }

  return HttpStatus.BAD_REQUEST;
}
