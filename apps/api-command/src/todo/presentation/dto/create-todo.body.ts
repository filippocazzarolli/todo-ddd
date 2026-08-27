import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

import { ExpirationBody } from './expiration.body';
import { WhenPresent } from '../../../shared/presentation/when-present.decorator';

/**
 * Body di `POST /todos`.
 *
 * Solo tipi e forma: nessun `@IsNotEmpty()` su `title`, perché "il titolo è
 * obbligatorio" è un'invariante del dominio e vive in `Todo.create`
 * (`TodoTitleRequiredError`, che il filtro traduce in 400 esattamente come
 * farebbe class-validator). Metterla anche qui significherebbe cambiarla in
 * due posti.
 *
 * `!` sui campi obbligatori e non un valore di default: l'istanza la costruisce
 * `plainToInstance` dal JSON, il costruttore non viene mai chiamato con
 * argomenti.
 */
export class CreateTodoBody {
  @IsString()
  title!: string;

  @WhenPresent()
  @IsString()
  description?: string;

  @WhenPresent()
  @IsBoolean()
  important?: boolean;

  @WhenPresent()
  @ValidateNested()
  @Type(() => ExpirationBody)
  expiration?: ExpirationBody;

  @WhenPresent()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
