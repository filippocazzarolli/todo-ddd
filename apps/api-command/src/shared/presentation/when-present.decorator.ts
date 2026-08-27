import { ValidateIf } from 'class-validator';

/**
 * Valida il campo solo se è presente nel body: assente va bene, `null` no.
 *
 * Serve al posto di `@IsOptional()`, che salta la validazione anche per
 * `null` — un `null` passerebbe intatto fino al command, con un tipo che
 * dichiara `string | undefined` e un valore che è `null`. Bugia di tipo che
 * scoppia dentro al dominio, dove `props.title.trim()` diventa un 500.
 *
 * Sui campi in cui `null` è invece un valore con un significato ("azzera"),
 * `@IsOptional()` è la scelta giusta: vedi `UpdateTodoBody`.
 *
 * Vive in `shared/` per la stessa ragione di `uuidV7`: è meccanismo e non
 * contratto — sa di class-validator e di niente altro, non nomina nessun
 * bounded context e non ha regole da tenere allineate con un dominio.
 */
export function WhenPresent(): PropertyDecorator {
  return ValidateIf((_object: unknown, value: unknown) => value !== undefined);
}
