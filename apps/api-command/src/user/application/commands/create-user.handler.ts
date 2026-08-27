import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { User } from '../../domain/aggregates/user.aggregate';
import { UserIdGenerator } from '../../domain/ports/user-id.generator';
import { UserRepository } from '../../domain/ports/user.repository';
import { CreateUserCommand } from './create-user.command';

/**
 * Orchestratore, non decisore: genera l'identità, costruisce l'aggregato,
 * salva, pubblica. Nessuna regola di dominio qui — email valida, nomi non
 * vuoti e default del piano vivono in `User.create`, e l'handler lascia solo
 * propagare gli errori.
 *
 * Nessun controllo preventivo sull'unicità dell'email, di proposito. Un
 * `findByEmail` prima dell'`add` sarebbe una corsa: fra la lettura e la
 * scrittura un altro comando può registrare lo stesso indirizzo, quindi il
 * vincolo nello store resterebbe comunque necessario e questo controllo
 * darebbe solo l'illusione di averlo risolto, a costo di un round trip in più
 * su ogni registrazione. L'autorità è `UserRepository.add`, che dichiara
 * `UserEmailAlreadyTakenError`.
 *
 * Nessun `Clock` iniettato, a differenza di `CreateTodoHandler`: l'utente non
 * ha invarianti che dipendono dal tempo, quindi il dominio non ha bisogno di
 * un istante di riferimento.
 *
 * Le dipendenze sono importate con import normali, non `import type`: con
 * `isolatedModules: true` un tipo importato non emette metadata e la DI per
 * costruttore si romperebbe in silenzio (vedi CLAUDE.md).
 */
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly userIds: UserIdGenerator,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateUserCommand): Promise<string> {
    /*
     * `mergeObjectContext` è obbligatorio: `AggregateRoot.publishAll` di base
     * è un metodo vuoto, quindi senza il merge `commit()` scarterebbe gli
     * eventi senza lanciare nulla — e `api-query` non si aggiornerebbe mai.
     */
    const user = this.publisher.mergeObjectContext(
      User.create({
        userId: this.userIds.next(),
        email: command.email,
        firstName: command.firstName,
        lastName: command.lastName,
        subscription: command.subscription,
      }),
    );

    await this.users.add(user);

    // Prima si persiste, poi si pubblica: il read model non deve vedere una
    // write che potrebbe essere fallita.
    user.commit();

    return user.userId;
  }
}
