import { uuidV7 } from '../../shared/infrastructure/uuid-v7';
import { TodoIdGenerator } from '../domain/ports/todo-id.generator';

/**
 * Adapter di `TodoIdGenerator` sugli UUIDv7 di `shared/infrastructure`.
 *
 * Tre righe di glue, e va bene così: il *meccanismo* è condiviso con gli altri
 * bounded context, il *contratto* no. Una porta `IdGenerator` unica per tutti
 * accoppierebbe i domini — il giorno in cui il todo volesse un id con prefisso
 * o una ULID, la cambierebbe anche all'utente.
 */
export class UuidTodoIdGenerator extends TodoIdGenerator {
  next(): string {
    return uuidV7();
  }
}
