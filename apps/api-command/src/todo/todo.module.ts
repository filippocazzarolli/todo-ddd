import { Module } from '@nestjs/common';

import { DatabaseModule } from '../shared/persistence/database.module';
import { CreateTodoHandler } from './application/commands/create-todo.handler';
import { DeleteTodoHandler } from './application/commands/delete-todo.handler';
import { MarkTodoAsDoneHandler } from './application/commands/mark-todo-as-done.handler';
import { ReopenTodoHandler } from './application/commands/reopen-todo.handler';
import { UpdateTodoHandler } from './application/commands/update-todo.handler';
import { Clock } from './domain/ports/clock';
import { TodoIdGenerator } from './domain/ports/todo-id.generator';
import { TodoRepository } from './domain/ports/todo.repository';
import { SystemClock } from './infrastructure/system.clock';
import { UuidTodoIdGenerator } from './infrastructure/uuid-todo-id.generator';
import { DrizzleTodoRepository } from './persistence/drizzle-todo.repository';
import { TodoController } from './presentation/todo.controller';

/**
 * Composizione del modulo todo: è qui, e solo qui, che le tre porte del
 * dominio incontrano i loro adapter.
 *
 * I token sono le classi astratte delle porte, non stringhe o Symbol: sono
 * valori a runtime, quindi la DI per costruttore funziona senza `@Inject()` e
 * senza il rischio dei tipi importati con `import type`, che con
 * `isolatedModules: true` non emettono metadata (vedi CLAUDE.md).
 *
 * Sostituire un adapter è una riga: `useClass: InMemoryTodoRepository` ->
 * `useClass: PostgresTodoRepository`. Nessun handler, nessun test e nessuna
 * riga di dominio cambia, perché nessuno di loro nomina mai l'adapter.
 *
 * `CqrsModule` non è tra gli import: `CqrsModule.forRoot()` è dichiarato
 * `global: true` e va registrato una volta sola, nel modulo radice.
 * Registrarlo anche qui creerebbe un secondo `CommandBus` con un secondo
 * registro di handler, e i comandi finirebbero su quello sbagliato.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [TodoController],
  providers: [
    CreateTodoHandler,
    UpdateTodoHandler,
    MarkTodoAsDoneHandler,
    ReopenTodoHandler,
    DeleteTodoHandler,
    { provide: TodoRepository, useClass: DrizzleTodoRepository },
    { provide: TodoIdGenerator, useClass: UuidTodoIdGenerator },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class TodoModule {}
