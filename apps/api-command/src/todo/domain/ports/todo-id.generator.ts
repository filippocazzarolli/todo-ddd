/**
 * Porta per la generazione dell'identità di un `Todo`.
 *
 * Esiste perché il dominio non deve conoscere la fonte degli ID: l'aggregato
 * riceve un `todoId` già formato e resta puro e deterministico.
 *
 * È una `abstract class` e non una `interface` + `Symbol` perché serve un
 * token risolvibile a runtime: con `isolatedModules: true` un tipo importato
 * con `import type` non emette metadata e la DI per costruttore si romperebbe
 * in silenzio (vedi CLAUDE.md).
 */
export abstract class TodoIdGenerator {
  abstract next(): string;
}
