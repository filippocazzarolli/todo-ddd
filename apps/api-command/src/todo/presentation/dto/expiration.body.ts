import { IsString } from 'class-validator';

/**
 * Scadenza come la manda il client: data e ora separate, entrambe stringhe.
 *
 * Nessun `@Matches` sul formato, per scelta. Il confine HTTP valida **tipi e
 * forma**, il dominio valida il **significato**: che `date` sia `YYYY-MM-DD`,
 * che il giorno esista davvero e che l'istante non sia nel passato lo decide
 * `Expiration`, che è l'unico posto dove quelle regole vivono. Duplicare qui
 * la regex creerebbe una seconda verità da tenere allineata, e il primo
 * cambio di formato la disallineerebbe in silenzio.
 */
export class ExpirationBody {
  @IsString()
  date!: string;

  @IsString()
  time!: string;
}
