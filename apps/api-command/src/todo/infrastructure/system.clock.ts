import { Clock } from '../domain/ports/clock';

/** Adapter sull'orologio di sistema: l'unico punto che chiama `new Date()`. */
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
