import { Command } from '@nestjs/cqrs';

/**
 * Intenzione di creare un todo.
 *
 * DTO immutabile: nessuna logica, nessuna dipendenza, serializzabile — può
 * arrivare da una coda. Non conosce l'aggregato né il repository: a
 * orchestrarli è l'handler.
 *
 * Non porta il `todoId`: lo genera l'handler tramite `TodoIdGenerator` e lo
 * restituisce al chiamante. Il giorno in cui servisse l'idempotenza sulle
 * retry, basta aggiungerlo qui — `CreateTodoProps.todoId` è già obbligatorio.
 *
 * `extends Command<string>` tipizza il risultato: `commandBus.execute(cmd)` è
 * `Promise<string>` senza generics al call site.
 */
export class CreateTodoCommand extends Command<string> {
  constructor(
    public readonly title: string,
    public readonly description?: string,
    public readonly important?: boolean,
    public readonly tags?: string[],
    /**
     * Scadenza come parti grezze (`YYYY-MM-DD`, `HH:mm`): il command è un DTO
     * serializzabile e non conosce `Expiration`. A comporla e validarla è
     * `Todo.create`.
     */
    public readonly expiration?: { date: string; time: string },
  ) {
    super();
  }
}
