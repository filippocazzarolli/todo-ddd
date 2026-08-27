import { IsIn, IsString } from 'class-validator';

import { USER_SUBSCRIPTIONS } from '../../domain/aggregates/user.aggregate';
/*
 * `import type` obbligatorio, non stilistico: con `emitDecoratorMetadata` +
 * `isolatedModules` un tipo usato in una signature decorata deve essere
 * dichiarato type-only (TS1272), altrimenti il compilatore non sa se emettere
 * il riferimento nei metadata. È lo specchio della trappola in CLAUDE.md — là
 * `import type` rompe la DI perché i metadata *servono*, qui l'import normale
 * rompe la compilazione perché i metadata non possono esistere. La tupla
 * `USER_SUBSCRIPTIONS` è invece un valore e resta un import normale.
 */
import type { UserSubscription } from '../../domain/aggregates/user.aggregate';
import { WhenPresent } from '../../../shared/presentation/when-present.decorator';

/**
 * Body di `POST /users`.
 *
 * **Nessun `@IsEmail()` su `email`, per scelta.** Il confine HTTP valida tipi e
 * forma, il dominio valida il significato: che l'indirizzo sia un'email vive
 * in `Email.create` (`UserEmailInvalidError`, che il filtro traduce in 400
 * esattamente come farebbe class-validator). Duplicare qui la regola creerebbe
 * una seconda verità da tenere allineata, e le due implementazioni non
 * concordano nemmeno oggi — `@IsEmail()` accetta `a@b` senza punto, `Email` no.
 * Vale lo stesso ragionamento di `ExpirationBody` nel modulo todo.
 *
 * `@IsIn` su `subscription` è invece necessario, e non contraddice quanto
 * sopra: "uno di questi tre valori" *è* il tipo, e un tipo non esiste a
 * runtime. Senza questo controllo un `"gold"` arriverebbe fino allo stato
 * dell'aggregato, che non lo verifica — la union lo esclude a compile time e
 * lì il compilatore non c'è più. La lista arriva da `USER_SUBSCRIPTIONS`, così
 * la verità resta una sola.
 *
 * Nessun `@IsNotEmpty()` su nome e cognome: "obbligatori" è un'invariante del
 * dominio e vive in `User.create` (`UserNameRequiredError`).
 *
 * `!` sui campi obbligatori e non un valore di default: l'istanza la costruisce
 * `plainToInstance` dal JSON, il costruttore non viene mai chiamato con
 * argomenti.
 */
export class CreateUserBody {
  @IsString()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @WhenPresent()
  @IsIn(USER_SUBSCRIPTIONS)
  subscription?: UserSubscription;
}
