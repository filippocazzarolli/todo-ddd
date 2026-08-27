import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import { Todo } from '../../domain/aggregates/todo.aggregate';
import { Clock } from '../../domain/ports/clock';
import { TodoIdGenerator } from '../../domain/ports/todo-id.generator';
import { TodoRepository } from '../../domain/ports/todo.repository';
import { CreateTodoCommand } from './create-todo.command';

/**
 * Orchestratore, non decisore: genera l'identità, costruisce l'aggregato,
 * salva, pubblica. Nessuna regola di dominio qui — le invarianti (titolo non
 * vuoto, normalizzazione di tag e description, scadenza non nel passato)
 * vivono in `Todo.create`, e
 * l'handler lascia solo propagare gli errori.
 *
 * Le dipendenze sono importate con import normali, non `import type`: con
 * `isolatedModules: true` un tipo importato non emette metadata e la DI per
 * costruttore si romperebbe in silenzio (vedi CLAUDE.md).
 */
@CommandHandler(CreateTodoCommand)
export class CreateTodoHandler implements ICommandHandler<CreateTodoCommand> {
  constructor(
    private readonly todos: TodoRepository,
    private readonly todoIds: TodoIdGenerator,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateTodoCommand): Promise<string> {
    /*
     * `mergeObjectContext` è obbligatorio: `AggregateRoot.publishAll` di base
     * è un metodo vuoto, quindi senza il merge `commit()` scarterebbe gli
     * eventi senza lanciare nulla — e `api-query` non si aggiornerebbe mai.
     */
    const todo = this.publisher.mergeObjectContext(
      Todo.create({
        todoId: this.todoIds.next(),
        /*
         * Chi crea un todo ne è il proprietario: è qui che l'attore del
         * comando diventa l'`ownerId` dell'aggregato. Nessun altro handler fa
         * questa traduzione — gli altri usano l'attore solo per verificare
         * l'accesso a un proprietario già assegnato.
         */
        ownerId: command.actorId,
        now: this.clock.now(),
        title: command.title,
        description: command.description,
        important: command.important,
        expiration: command.expiration,
        tags: command.tags,
      }),
    );

    await this.todos.add(todo);

    // Prima si persiste, poi si pubblica: il read model non deve vedere una
    // write che potrebbe essere fallita.
    todo.commit();

    return todo.todoId;
  }
}
