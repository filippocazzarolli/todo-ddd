import { IsString } from 'class-validator';

import { WhenPresent } from '../../../shared/presentation/when-present.decorator';

/**
 * Body di `PATCH /users/:userId`. Update parziale: i due stati di
 * `UpdateUserProps` arrivano fin qui dal JSON.
 *
 * - chiave assente -> non toccare;
 * - valore -> assegna.
 *
 * `@WhenPresent()` su entrambi e mai `@IsOptional()`, a differenza di
 * `UpdateTodoBody`: `@IsOptional()` salta la validazione anche per `null`, che
 * passerebbe intatto fino al command dichiarando `string | undefined` — e
 * `props.firstName.trim()` diventerebbe un 500 dentro il dominio. Nessuno dei
 * due campi è azzerabile, quindi non c'è nessun `null` con un significato da
 * lasciar passare.
 *
 * Non ci sono `email` né `subscription`: hanno le loro rotte. Un client che le
 * mandasse qui riceve un 400 da `forbidNonWhitelisted`, che è la risposta
 * giusta — non un silenzioso "ignorato".
 */
export class UpdateUserBody {
  @WhenPresent()
  @IsString()
  firstName?: string;

  @WhenPresent()
  @IsString()
  lastName?: string;
}
