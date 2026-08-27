import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { TodoNotFoundError } from '../application/errors/todo-not-found.error';
import {
  TodoAlreadyDoneError,
  TodoDeletedError,
  TodoDomainError,
  TodoExpirationInPastError,
  TodoExpirationInvalidError,
  TodoNotDoneError,
  TodoTitleRequiredError,
} from '../domain/errors/todo.errors';
import {
  TodoAlreadyExistsError,
  TodoNoLongerExistsError,
} from '../domain/ports/todo.repository.errors';
import { TodoErrorFilter } from './todo-error.filter';

const TODO_ID = 'todo-1';

/** Risposta express finta: `status` è concatenabile come l'originale. */
function responseSpy() {
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })), json };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, status: response.status, json };
}

describe('TodoErrorFilter', () => {
  const filter = new TodoErrorFilter();

  it.each([
    [new TodoNotFoundError(TODO_ID), HttpStatus.NOT_FOUND],
    [new TodoAlreadyDoneError(TODO_ID), HttpStatus.CONFLICT],
    [new TodoNotDoneError(TODO_ID), HttpStatus.CONFLICT],
    [new TodoDeletedError(TODO_ID), HttpStatus.CONFLICT],
    [new TodoAlreadyExistsError(TODO_ID), HttpStatus.CONFLICT],
    [new TodoNoLongerExistsError(TODO_ID), HttpStatus.CONFLICT],
    [new TodoTitleRequiredError(), HttpStatus.BAD_REQUEST],
    [new TodoExpirationInvalidError('domani'), HttpStatus.BAD_REQUEST],
    [new TodoExpirationInPastError('2020-01-01 10:00'), HttpStatus.BAD_REQUEST],
  ])('mappa $constructor.name su %i', (error, expected) => {
    const { host, status } = responseSpy();

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(expected);
  });

  it('porta nel body il nome della classe, non `name`', () => {
    const { host, json } = responseSpy();
    const error = new TodoAlreadyDoneError(TODO_ID);

    filter.catch(error, host);

    // `error.name` sarebbe 'Error' per tutti: nessuno lo sovrascrive.
    expect(error.name).toBe('Error');
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'TodoAlreadyDoneError',
      message: `Il todo ${TODO_ID} è già stato completato`,
    });
  });

  it('un errore di dominio non previsto resta un 4xx, non un 500', () => {
    class TodoRegolaFuturaError extends TodoDomainError {}
    const { host, status } = responseSpy();

    filter.catch(new TodoRegolaFuturaError('regola nuova'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });
});
