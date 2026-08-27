import { Clock } from '../domain/ports/clock';
import { SystemClock } from './system.clock';

describe('SystemClock', () => {
  const clock = new SystemClock();

  it('è utilizzabile come `Clock`: la classe astratta è il token DI', () => {
    expect(clock).toBeInstanceOf(Clock);
  });

  it('restituisce l`istante corrente', () => {
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('non restituisce sempre lo stesso oggetto Date', () => {
    expect(clock.now()).not.toBe(clock.now());
  });
});
