/**
 * Porta per la lettura del tempo.
 *
 * Esiste per la stessa ragione di `TodoIdGenerator`: il dominio non deve
 * conoscere la fonte di un valore non deterministico. `Expiration.create`
 * riceve l'istante di riferimento come parametro, così la regola "nessuna
 * scadenza nel passato" si testa senza fake timer e senza mockare `Date`.
 *
 * È una `abstract class` e non una `interface` perché serve un token DI
 * risolvibile a runtime: con `isolatedModules: true` un tipo importato con
 * `import type` non emette metadata e la DI per costruttore si romperebbe in
 * silenzio (vedi CLAUDE.md).
 */
export abstract class Clock {
  abstract now(): Date;
}
