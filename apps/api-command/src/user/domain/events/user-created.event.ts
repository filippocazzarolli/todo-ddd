import type { UserSubscription } from '../aggregates/user.aggregate';

/**
 * Emesso quando un nuovo utente entra nel sistema.
 *
 * Il payload è uno snapshot completo dello stato iniziale: il lato query deve
 * poter costruire la sua proiezione senza rileggere il write model.
 */
export class UserCreatedEvent {
  constructor(
    public readonly userId: string,
    /**
     * L'email come stringa normalizzata, non come Value Object: l'evento può
     * attraversare una coda verso `api-query`, quindi il payload resta
     * serializzabile e privo di dipendenze dal dominio del lato write.
     */
    public readonly email: string,
    public readonly firstName: string,
    public readonly lastName: string,
    /**
     * Il piano è nel payload anche se ha un default, al contrario dello
     * `status` di un todo appena creato che `TodoCreatedEvent` omette: là il
     * valore iniziale è uno solo e il lato query lo conosce, qui il chiamante
     * può scegliere e senza questo campo la proiezione lo indovinerebbe.
     */
    public readonly subscription: UserSubscription,
  ) {}
}
