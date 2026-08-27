import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { ACTOR_HEADER, actorFrom } from './actor.decorator';

/**
 * Contesto di esecuzione finto con il solo metodo che il decoratore usa.
 * `header` è case-insensitive nell'Express vero, quindi qui il confronto è
 * sul nome esatto: al decoratore basta chiedere quello giusto.
 */
function contextWith(header?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => (name === ACTOR_HEADER ? header : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('actorFrom', () => {
  it('restituisce l`identità presente nell`header', () => {
    expect(actorFrom(undefined, contextWith('user-1'))).toBe('user-1');
  });

  it('trimma: è l`unico punto in cui l`identità viene normalizzata', () => {
    // Il dominio confronta per uguaglianza esatta (`ensureOwnedBy`), quindi
    // un id sporco che arrivasse fin lì diventerebbe un 403 inspiegabile.
    expect(actorFrom(undefined, contextWith('  user-1\n'))).toBe('user-1');
  });

  it.each([
    ['header assente', undefined],
    ['header vuoto', ''],
    ['header di soli spazi', '   '],
  ])('solleva UnauthorizedException: %s', (_label, header) => {
    expect(() => actorFrom(undefined, contextWith(header))).toThrow(
      UnauthorizedException,
    );
  });

  it('è un 401 e non un 400: la richiesta è ben formata, manca l`identità', () => {
    try {
      actorFrom(undefined, contextWith());
      throw new Error('Atteso UnauthorizedException');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getStatus()).toBe(401);
    }
  });
});
