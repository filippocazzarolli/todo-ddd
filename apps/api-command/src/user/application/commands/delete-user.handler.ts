import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { UserRepository } from '../../domain/ports/user.repository';
import { loadUser } from '../load-user';
import { DeleteUserCommand } from './delete-user.command';

/**
 * Cancella l'utente.
 *
 * `update` anche qui, come nelle altre transizioni: per il dominio la
 * cancellazione è un cambio di stato dell'aggregato, e se il repository la
 * tradurrà in una `DELETE` fisica o in un tombstone è affare suo. L'handler
 * non chiama nessun `remove`, e infatti `UserRepository` non lo espone.
 *
 * Non è idempotente: ricancellare solleva `UserDeletedError`. La ripetizione
 * di un comando è un problema di consegna, e va risolta con l'idempotenza sul
 * bus, non ammorbidendo l'aggregato.
 */
@CommandHandler(DeleteUserCommand)
export class DeleteUserHandler implements ICommandHandler<DeleteUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    const user = await loadUser(this.users, this.publisher, command.userId);

    user.delete();

    await this.users.update(user);

    user.commit();
  }
}
