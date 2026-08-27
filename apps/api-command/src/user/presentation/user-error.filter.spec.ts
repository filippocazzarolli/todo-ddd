import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { UserNotFoundError } from '../application/errors/user-not-found.error';
import {
  UserAlreadySubscribedError,
  UserDeletedError,
  UserDomainError,
  UserEmailInvalidError,
  UserNameRequiredError,
} from '../domain/errors/user.errors';
import {
  UserAlreadyExistsError,
  UserEmailAlreadyTakenError,
  UserNoLongerExistsError,
} from '../domain/ports/user.repository.errors';
import { UserErrorFilter } from './user-error.filter';

const USER_ID = 'user-1';
const EMAIL = 'mario.rossi@example.com';

/** Risposta express finta: `status` è concatenabile come l'originale. */
function responseSpy() {
  /*
   * `bodies` accanto allo spy, e non `json.mock.calls[0][0]`: un `jest.fn()`
   * senza implementazione tipizza gli argomenti come `any`, e leggerli
   * farebbe fallire il lint su `no-unsafe-member-access` (max-warnings 0).
   * L'implementazione dà a `json` una firma vera.
   */
  const bodies: unknown[] = [];
  const json = jest.fn((body: unknown) => {
    bodies.push(body);
  });
  const response = { status: jest.fn(() => ({ json })), json };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, status: response.status, json, bodies };
}

describe('UserErrorFilter', () => {
  const filter = new UserErrorFilter();

  it.each([
    [new UserNotFoundError(USER_ID), HttpStatus.NOT_FOUND],
    [new UserDeletedError(USER_ID), HttpStatus.CONFLICT],
    [new UserAlreadySubscribedError(USER_ID, 'pro'), HttpStatus.CONFLICT],
    [new UserAlreadyExistsError(USER_ID), HttpStatus.CONFLICT],
    [new UserEmailAlreadyTakenError(EMAIL), HttpStatus.CONFLICT],
    [new UserNoLongerExistsError(USER_ID), HttpStatus.CONFLICT],
    [new UserNameRequiredError('firstName'), HttpStatus.BAD_REQUEST],
    [new UserNameRequiredError('lastName'), HttpStatus.BAD_REQUEST],
    [new UserEmailInvalidError('mario'), HttpStatus.BAD_REQUEST],
  ])('mappa $constructor.name su %i', (error, expected) => {
    const { host, status } = responseSpy();

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(expected);
  });

  it('manda l`email già registrata su 409 e non su 400', () => {
    // L'indirizzo è formalmente valido: il problema è che è di qualcun altro.
    const { host, status } = responseSpy();

    filter.catch(new UserEmailAlreadyTakenError(EMAIL), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it('porta nel body il nome della classe, non `name`', () => {
    const { host, json } = responseSpy();
    const error = new UserAlreadySubscribedError(USER_ID, 'pro');

    filter.catch(error, host);

    // `error.name` sarebbe 'Error' per tutti: nessuno lo sovrascrive.
    expect(error.name).toBe('Error');
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'UserAlreadySubscribedError',
      message: `L'utente ${USER_ID} è già sul piano pro`,
    });
  });

  it('distingue i 409 fra loro con il campo `error`', () => {
    /*
     * Tre fatti diversi sullo stesso status: la reazione giusta del client è
     * "l`utente non c`è più", "sei già su quel piano" e "usa un`altra email".
     */
    const nomi = [
      new UserDeletedError(USER_ID),
      new UserAlreadySubscribedError(USER_ID, 'free'),
      new UserEmailAlreadyTakenError(EMAIL),
    ].map((error) => {
      const { host, bodies } = responseSpy();

      filter.catch(error, host);

      return (bodies[0] as { error: string }).error;
    });

    expect(nomi).toStrictEqual([
      'UserDeletedError',
      'UserAlreadySubscribedError',
      'UserEmailAlreadyTakenError',
    ]);
  });

  it('manda su 400 ogni altro errore di dominio, anche uno nuovo', () => {
    // Il default della gerarchia: un invariante violato è un input rifiutato.
    class UserQualcosaError extends UserDomainError {}

    const { host, status } = responseSpy();

    filter.catch(new UserQualcosaError('qualcosa'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });
});
