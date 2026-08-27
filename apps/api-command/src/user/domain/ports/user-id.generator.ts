/**
 * Porta per la generazione dell'identità di un `User`.
 *
 * Esiste perché il dominio non deve conoscere la fonte degli ID: l'aggregato
 * riceve uno `userId` già formato e resta puro e deterministico.
 *
 * È una `abstract class` e non una `interface` + `Symbol` perché serve un
 * token risolvibile a runtime: con `isolatedModules: true` un tipo importato
 * con `import type` non emette metadata e la DI per costruttore si romperebbe
 * in silenzio (vedi CLAUDE.md).
 *
 * Porta propria e non `TodoIdGenerator` riusata, né una `IdGenerator`
 * condivisa in `shared/`: il contratto è di questo bounded context. Ciò che i
 * due contesti condividono è il *meccanismo* (`uuidV7` in
 * `shared/infrastructure`), che i rispettivi adapter chiamano. Una porta unica
 * farebbe sì che un cambio di formato degli id dei todo si propaghi agli
 * utenti, che è esattamente l'accoppiamento che i bounded context servono a
 * evitare.
 */
export abstract class UserIdGenerator {
  abstract next(): string;
}
