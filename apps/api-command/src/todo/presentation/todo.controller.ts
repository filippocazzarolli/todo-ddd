import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseFilters,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CreateTodoCommand } from '../application/commands/create-todo.command';
import { DeleteTodoCommand } from '../application/commands/delete-todo.command';
import { MarkTodoAsDoneCommand } from '../application/commands/mark-todo-as-done.command';
import { ReopenTodoCommand } from '../application/commands/reopen-todo.command';
import { UpdateTodoCommand } from '../application/commands/update-todo.command';
import { CreateTodoBody } from './dto/create-todo.body';
import { UpdateTodoBody } from './dto/update-todo.body';
import { TodoErrorFilter } from './todo-error.filter';
import { TODO_VALIDATION } from './todo-validation';

/**
 * Adapter HTTP del modulo todo.
 *
 * Traduce e niente più: da body a command, da command a status. Nessuna
 * regola, nessun accesso al repository, nessun `Todo` importato — il
 * controller non sa nemmeno che esiste un aggregato. È il `CommandBus` a
 * trovare l'handler, quindi le rotte non sanno nemmeno chi le serve.
 *
 * Rotte per intenzione e non per stato della risorsa: `POST /:id/done` e
 * `POST /:id/reopen` invece di un `PUT /:id/done` con il body a `true`. Un
 * comando è un'intenzione, e i due casi hanno esiti diversi (`reopen` su un
 * todo aperto è un errore); appiattirli su una scrittura di campo li
 * renderebbe indistinguibili sia in ingresso sia nell'evento.
 */
@Controller('todos')
@UseFilters(TodoErrorFilter)
@UsePipes(new ValidationPipe(TODO_VALIDATION))
export class TodoController {
  constructor(private readonly commands: CommandBus) {}

  /**
   * L'id è generato dal server (`TodoIdGenerator`), quindi la creazione è
   * `POST` sulla collezione e la risposta lo restituisce: è l'unica rotta con
   * un body in uscita.
   */
  @Post()
  async create(@Body() body: CreateTodoBody): Promise<{ todoId: string }> {
    const todoId = await this.commands.execute(
      new CreateTodoCommand(
        body.title,
        body.description,
        body.important,
        body.tags,
        body.expiration,
      ),
    );

    return { todoId };
  }

  /**
   * `PATCH` e non `PUT`: l'update è parziale per costruzione, e i campi
   * assenti non vengono azzerati.
   *
   * `{ ...body }` copia il DTO in un oggetto piano — il command deve restare
   * serializzabile e non portarsi dietro l'identità di una classe di
   * presentazione. Le chiavi in eccesso non esistono: `whitelist` le ha già
   * rimosse.
   */
  @Patch(':todoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Param('todoId') todoId: string,
    @Body() body: UpdateTodoBody,
  ): Promise<void> {
    await this.commands.execute(new UpdateTodoCommand(todoId, { ...body }));
  }

  @Post(':todoId/done')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsDone(@Param('todoId') todoId: string): Promise<void> {
    await this.commands.execute(new MarkTodoAsDoneCommand(todoId));
  }

  @Post(':todoId/reopen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reopen(@Param('todoId') todoId: string): Promise<void> {
    await this.commands.execute(new ReopenTodoCommand(todoId));
  }

  /**
   * `DELETE` sulla risorsa anche se la cancellazione è logica: per il client
   * il todo sparisce, e come lo scriva la persistenza non è affare suo.
   */
  @Delete(':todoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('todoId') todoId: string): Promise<void> {
    await this.commands.execute(new DeleteTodoCommand(todoId));
  }
}
