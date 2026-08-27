/**
 * Emesso quando un nuovo todo entra nel sistema.
 *
 * Il payload è uno snapshot completo dello stato iniziale: il lato query
 * deve poter costruire la sua proiezione senza rileggere il write model.
 */
export class TodoCreatedEvent {
  constructor(
    public readonly todoId: string,
    /**
     * Proprietario del todo. Presente qui e in **tutti** gli altri eventi del
     * modulo, non solo in questo: un evento deve essere autoconsistente per
     * chi lo consuma, e il lato query deve poter autorizzare e partizionare la
     * proiezione senza tenere una tabella di lookup `todoId -> owner`. Il
     * costo di metterlo ovunque adesso è una riga per evento; aggiungerlo dopo,
     * con eventi già su una coda, è una migrazione di schema con due versioni
     * in volo.
     */
    public readonly ownerId: string,
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
