import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { UserRepository } from '../../domain/ports/user.repository';
import { loadUser } from '../load-user';
import { ChangeUserSubscriptionCommand } from './change-user-subscription.command';

/**
 * Orchestratore: carica, invoca la transizione, salva, pubblica.
 *
 * Nessuna regola qui — che non si possa passare al piano su cui si è già
 * (`UserAlreadySubscribedError`) e che un utente cancellato non accetti
 * transizioni (`UserDeletedError`) lo decide `User.changeSubscription`.
 * L'handler lascia propagare, e non salva: un aggregato che ha rifiutato la
 * transizione non ha cambiato stato, quindi non c'è niente da scrivere.
 *
 * Non c'è nessun passaggio di fatturazione, ed è deliberato: incassare un
 * pagamento non è un'operazione dello stesso confine transazionale del cambio
 * di piano, e metterla qui la renderebbe parte di una write locale che può
 * fallire dopo. È lavoro di un process manager che reagisce a
 * `UserSubscriptionChangedEvent`, o che emette questo comando dopo l'incasso.
 */
@CommandHandler(ChangeUserSubscriptionCommand)
export class ChangeUserSubscriptionHandler implements ICommandHandler<ChangeUserSubscriptionCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ChangeUserSubscriptionCommand): Promise<void> {
    const user = await loadUser(this.users, this.publisher, command.userId);

    user.changeSubscription(command.subscription);

    await this.users.update(user);

    // Prima si persiste, poi si pubblica: il read model non deve vedere una
    // write che potrebbe essere fallita.
    user.commit();
  }
}
