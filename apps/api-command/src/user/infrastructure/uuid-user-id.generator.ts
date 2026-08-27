import { uuidV7 } from '../../shared/infrastructure/uuid-v7';
import { UserIdGenerator } from '../domain/ports/user-id.generator';

/**
 * Adapter di `UserIdGenerator` sugli UUIDv7 di `shared/infrastructure`.
 *
 * Identico a `UuidTodoIdGenerator` nel corpo e diverso nel tipo, che è il
 * punto: il meccanismo è condiviso, il contratto appartiene al contesto. Il
 * giorno in cui gli id utente volessero un prefisso (`usr_...`) o una ULID,
 * cambia questo file e nient'altro.
 */
export class UuidUserIdGenerator extends UserIdGenerator {
  next(): string {
    return uuidV7();
  }
}
