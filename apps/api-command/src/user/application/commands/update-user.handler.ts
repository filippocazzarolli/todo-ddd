import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { UserRepository } from '../../domain/ports/user.repository';
import { loadUser } from '../load-user';
import { UpdateUserCommand } from './update-user.command';

/**
 * Orchestratore: carica, applica il patch, salva, pubblica.
 *
 * Non ispeziona `command.fields` né confronta niente: quali campi siano
 * cambiati davvero, e se valga la pena emettere un evento, lo decide
 * `User.update`. Un handler che provasse a saltare il salvataggio per gli
 * update a vuoto duplicherebbe quel confronto fuori dall'aggregato.
 *
 * Salva anche quando l'update non ha cambiato niente. È una scrittura inutile
 * ma innocua, e l'alternativa — chiedere all'aggregato se ha eventi pendenti —
 * legherebbe la decisione di persistere a un dettaglio del meccanismo degli
 * eventi. Quando servirà evitarla, il posto giusto è il controllo di
 * concorrenza ottimistica, non un `if` qui.
 */
@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<UpdateUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: UpdateUserCommand): Promise<void> {
    const user = await loadUser(this.users, this.publisher, command.userId);

    user.update(command.fields);

    await this.users.update(user);

    // Prima si persiste, poi si pubblica: il read model non deve vedere una
    // write che potrebbe essere fallita.
    user.commit();
  }
}
