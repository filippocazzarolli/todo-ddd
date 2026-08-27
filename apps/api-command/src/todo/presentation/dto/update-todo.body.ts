import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { ExpirationBody } from './expiration.body';
import { WhenPresent } from '../../../shared/presentation/when-present.decorator';

/**
 * Body di `PATCH /todos/:todoId`. Update parziale: i tre stati di
 * `UpdateTodoProps` arrivano fin qui dal JSON.
 *
 * - chiave assente -> non toccare;
 * - valore -> assegna;
 * - `null` -> azzera, e solo dove il campo è azzerabile.
 *
 * Da cui i due decoratori diversi: `@IsOptional()` su ciò che `null` può
 * azzerare (salta la validazione sia per `undefined` sia per `null`),
 * `@WhenPresent()` su ciò che non è azzerabile — `title` non lo è, un todo
 * senza titolo non esiste, e `important` e `tags` hanno un valore neutro
 * proprio (`false`, `[]`) che rende `null` inutile.
 *
 * Nota sui campi assenti: con `target: ES2023` le proprietà dichiarate
 * diventano comunque chiavi dell'istanza con valore `undefined`, quindi
 * `'title' in body` è sempre vero. È irrilevante perché `Todo.update` decide
 * con `!== undefined` e non con `in`, ma è il motivo per cui non va cambiato
 * quel test nell'aggregato.
 */
export class UpdateTodoBody {
  @WhenPresent()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @WhenPresent()
  @IsBoolean()
  important?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExpirationBody)
  expiration?: ExpirationBody | null;

  @WhenPresent()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
