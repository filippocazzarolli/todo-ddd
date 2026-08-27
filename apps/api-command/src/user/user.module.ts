import { Module } from '@nestjs/common';

import { ChangeUserSubscriptionHandler } from './application/commands/change-user-subscription.handler';
import { CreateUserHandler } from './application/commands/create-user.handler';
import { DeleteUserHandler } from './application/commands/delete-user.handler';
import { UpdateUserHandler } from './application/commands/update-user.handler';
import { UserIdGenerator } from './domain/ports/user-id.generator';
import { UserRepository } from './domain/ports/user.repository';
import { UuidUserIdGenerator } from './infrastructure/uuid-user-id.generator';
import { InMemoryUserRepository } from './persistence/in-memory-user.repository';
import { UserController } from './presentation/user.controller';

/**
 * Composizione del modulo user: è qui, e solo qui, che le porte del dominio
 * incontrano i loro adapter.
 *
 * Due porte e non tre come in `TodoModule`: non c'è `Clock`, perché l'utente
 * non ha invarianti che dipendono dal tempo.
 *
 * I token sono le classi astratte delle porte, non stringhe o Symbol: sono
 * valori a runtime, quindi la DI per costruttore funziona senza `@Inject()` e
 * senza il rischio dei tipi importati con `import type`, che con
 * `isolatedModules: true` non emettono metadata (vedi CLAUDE.md).
 *
 * Sostituire un adapter è una riga: `useClass: InMemoryUserRepository` ->
 * `useClass: PostgresUserRepository`. Nessun handler, nessun test e nessuna
 * riga di dominio cambia, perché nessuno di loro nomina mai l'adapter.
 *
 * `CqrsModule` non è tra gli import: `CqrsModule.forRoot()` è dichiarato
 * `global: true` e va registrato una volta sola, nel modulo radice.
 * Registrarlo anche qui creerebbe un secondo `CommandBus` con un secondo
 * registro di handler, e i comandi finirebbero su quello sbagliato.
 */
@Module({
  controllers: [UserController],
  providers: [
    CreateUserHandler,
    UpdateUserHandler,
    ChangeUserSubscriptionHandler,
    DeleteUserHandler,
    { provide: UserRepository, useClass: InMemoryUserRepository },
    { provide: UserIdGenerator, useClass: UuidUserIdGenerator },
  ],
})
export class UserModule {}
