/**
 * Emesso quando un nuovo todo entra nel sistema.
 *
 * Il payload è uno snapshot completo dello stato iniziale: il lato query
 * deve poter costruire la sua proiezione senza rileggere il write model.
 */
export class TodoCreatedEvent {
  constructor(
    public readonly todoId: string,
    public readonly title: string,
    public readonly important: boolean,
    public readonly tags: readonly string[],
    public readonly description?: string,
    /**
     * Scadenza come istante ISO 8601, non come Value Object: l'evento può
     * attraversare una coda verso `api-query`, quindi il payload resta
     * serializzabile e privo di dipendenze dal dominio del lato write.
     */
    public readonly expiration?: string,
  ) {}
}
