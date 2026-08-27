import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseFilters,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { ChangeUserSubscriptionCommand } from '../application/commands/change-user-subscription.command';
import { CreateUserCommand } from '../application/commands/create-user.command';
import { DeleteUserCommand } from '../application/commands/delete-user.command';
import { UpdateUserCommand } from '../application/commands/update-user.command';
import { ChangeSubscriptionBody } from './dto/change-subscription.body';
import { CreateUserBody } from './dto/create-user.body';
import { UpdateUserBody } from './dto/update-user.body';
import { USER_VALIDATION } from './user-validation';
import { UserErrorFilter } from './user-error.filter';

/**
 * Adapter HTTP del modulo user.
 *
 * Traduce e niente più: da body a command, da command a status. Nessuna regola,
 * nessun accesso al repository, nessun `User` importato — il controller non sa
 * nemmeno che esiste un aggregato. È il `CommandBus` a trovare l'handler,
 * quindi le rotte non sanno nemmeno chi le serve.
 */
@Controller('users')
@UseFilters(UserErrorFilter)
@UsePipes(new ValidationPipe(USER_VALIDATION))
export class UserController {
  constructor(private readonly commands: CommandBus) {}

  /**
   * L'id è generato dal server (`UserIdGenerator`), quindi la creazione è
   * `POST` sulla collezione e la risposta lo restituisce: è l'unica rotta con
   * un body in uscita.
   */
  @Post()
  async create(@Body() body: CreateUserBody): Promise<{ userId: string }> {
    const userId = await this.commands.execute(
      new CreateUserCommand(
        body.email,
        body.firstName,
        body.lastName,
        body.subscription,
      ),
    );

    return { userId };
  }

  /**
   * `PATCH` e non `PUT`: l'update è parziale per costruzione, e i campi assenti
   * non vengono azzerati.
   *
   * `{ ...body }` copia il DTO in un oggetto piano — il command deve restare
   * serializzabile e non portarsi dietro l'identità di una classe di
   * presentazione. Le chiavi in eccesso non esistono: `whitelist` le ha già
   * rimosse.
   */
  @Patch(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Param('userId') userId: string,
    @Body() body: UpdateUserBody,
  ): Promise<void> {
    await this.commands.execute(new UpdateUserCommand(userId, { ...body }));
  }

  /**
   * `PUT` su una sotto-risorsa a valore singolo, e non `POST /:userId/upgrade`.
   *
   * Sembra in contrasto con `POST /todos/:id/done`, ma la differenza è la
   * stessa che regge lì: `done` e `reopen` sono due *intenzioni diverse*
   * schiacciate su un campo booleano, quindi meritano due rotte. Qui
   * l'intenzione è una sola — cambiare piano — e ciò che varia è il *dato*, su
   * tre valori senza ordinamento. Tre rotte (`/free`, `/standard`, `/pro`)
   * moltiplicherebbero l'intenzione per i suoi valori, e `/upgrade` pretenderebbe
   * quella gerarchia fra piani che il dominio non dichiara.
   *
   * `PUT` e non `PATCH` perché la sostituzione è totale: il piano non ha parti.
   */
  @Put(':userId/subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeSubscription(
    @Param('userId') userId: string,
    @Body() body: ChangeSubscriptionBody,
  ): Promise<void> {
    await this.commands.execute(
      new ChangeUserSubscriptionCommand(userId, body.subscription),
    );
  }

  /**
   * `DELETE` sulla risorsa anche se la cancellazione è logica: per il client
   * l'utente sparisce, e come lo scriva la persistenza non è affare suo.
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('userId') userId: string): Promise<void> {
    await this.commands.execute(new DeleteUserCommand(userId));
  }
}
