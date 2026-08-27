import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { TodoNotFoundError } from '../application/errors/todo-not-found.error';
import {
  TodoAlreadyDoneError,
  TodoDeletedError,
  TodoDomainError,
  TodoNotDoneError,
} from '../domain/errors/todo.errors';
import { TodoPersistenceError } from '../domain/ports/todo.repository.errors';

/**
 * Traduce gli errori del modulo todo in risposte HTTP.
 *
 * È l'unico posto del modulo che conosce HTTP oltre al controller: il dominio
 * lancia errori che non sanno di essere in un web server, e questa è la
 * mappatura che l'aveva promesso.
 *
 * Registrato sul controller e non globalmente: mappa i tipi di *questo*
 * modulo, e un filtro globale li renderebbe un contratto di tutta l'app.
 */
@Catch(TodoDomainError, TodoNotFoundError, TodoPersistenceError)
export class TodoErrorFilter implements ExceptionFilter<Error> {
  catch(error: Error, host: ArgumentsHost): void {
    const statusCode = statusOf(error);

    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      /*
       * Il nome della classe, non `error.name`: nessuno di questi errori
       * sovrascrive `name`, che resterebbe 'Error' per tutti. Serve al client
       * per distinguere i casi che collassano sullo stesso status — 409 può
       * essere "già completato", "cancellato" o un conflitto di scrittura, e
       * la reazione giusta è diversa per ognuno.
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
 * classi base. Le tre violazioni di ciclo di vita sono 409 perché la richiesta
 * è formalmente valida e in conflitto con lo stato attuale; ogni altro errore
 * di dominio è 400, perché è un input che il dominio ha rifiutato.
 */
function statusOf(error: Error): HttpStatus {
  if (error instanceof TodoNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }

  if (
    error instanceof TodoAlreadyDoneError ||
    error instanceof TodoNotDoneError ||
    error instanceof TodoDeletedError
  ) {
    return HttpStatus.CONFLICT;
  }

  /*
   * Scritture andate a vuoto: id duplicato o aggregato scomparso sotto le
   * mani. 409 e non 500 perché non è un guasto — è una corsa persa, e per il
   * client la reazione è ricaricare e riprovare.
   */
  if (error instanceof TodoPersistenceError) {
    return HttpStatus.CONFLICT;
  }

  return HttpStatus.BAD_REQUEST;
}
