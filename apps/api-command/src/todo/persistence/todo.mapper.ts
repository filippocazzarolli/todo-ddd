import { NewTodoRow, TodoRow } from '@repo/db';

import {
  TODO_STATUSES,
  TodoProps,
  TodoStatus,
} from '../domain/aggregates/todo.aggregate';
import { Expiration } from '../domain/value-objects/expiration.value-object';

/**
 * Traduzione fra lo stato dell'aggregato e la riga della tabella.
 *
 * Vive in `persistence/` per la stessa ragione del mapper di `user`: importa dal
 * dominio e da `@repo/db`, e nessun file di `domain/` lo nomina.
 *
 * **`toProps` costruisce un letterale con tutte le chiavi, mai uno spread
 * condizionale.** Le props di un todo hanno tutte le chiavi presenti anche
 * quando valgono `undefined` — `Todo.rehydrate` ripete `expiration` nello spread
 * proprio per questo — e `toStrictEqual` distingue una chiave assente da una a
 * `undefined`. Omettere `description` quando la colonna è NULL farebbe fallire il
 * test di round-trip con un diff su chiavi mancanti, non su valori.
 */

/**
 * Riga corrotta: un valore in tabella che il dominio non può rappresentare.
 *
 * `cause` porta l'errore di dominio che ha fatto scattare il rifiuto, dove ce
 * n'è uno. Serve a chi legge i log: questa gerarchia esce come 500, e un 500
 * senza il motivo per cui il Value Object ha detto di no è un'ora persa.
 */
export class TodoRowInvalidError extends Error {
  constructor(
    public readonly todoId: string,
    public readonly column: string,
    public readonly value: unknown,
    options?: ErrorOptions,
  ) {
    super(
      `La riga del todo ${todoId} ha un valore non valido in ${column}: ${String(value)}`,
      options,
    );
  }
}

export function toRow(state: Readonly<TodoProps>): NewTodoRow {
  return {
    todoId: state.todoId,
    ownerId: state.ownerId,
    title: state.title,
    status: state.status,
    deleted: state.deleted,
    // `undefined` diventerebbe "colonna non menzionata" in un UPDATE parziale,
    // lasciando il valore precedente: `null` dice esplicitamente "azzerata".
    description: state.description ?? null,
    important: state.important ?? false,
    expiration: state.expiration?.toISOString() ?? null,
    // Sempre un array, mai NULL: la colonna è `notNull` perché NULL e `'[]'`
    // sarebbero due rappresentazioni dello stesso stato.
    tags: JSON.stringify(state.tags ?? []),
  };
}

export function toProps(row: TodoRow): TodoProps {
  return {
    todoId: row.todoId,
    ownerId: row.ownerId,
    title: row.title,
    status: toStatus(row.todoId, row.status),
    deleted: row.deleted,
    description: row.description ?? undefined,
    important: row.important,
    expiration: toExpiration(row.todoId, row.expiration),
    tags: toTags(row.todoId, row.tags),
  };
}

/**
 * Ricostruisce la scadenza dalla riga, **senza** lasciare che il dominio decida
 * l'esito.
 *
 * `Expiration.rehydrate` e non `create`, perché "non nel passato" è una regola
 * sull'assegnazione e non un invariante permanente — un todo scaduto deve poter
 * tornare in memoria. Ma anche `rehydrate` rifiuta ciò che non è una data, e lo
 * fa con un `TodoExpirationInvalidError`, che **è** un `TodoDomainError`:
 * lasciandolo passare, il filtro lo tradurrebbe in un 400 e darebbe la colpa a
 * un chiamante che ha solo chiesto di leggere. Una colonna che il dominio non sa
 * rappresentare è un guasto del server, non una richiesta sbagliata.
 *
 * Nessun confronto con il valore riscritto, a differenza dell'email: qui la
 * normalizzazione è l'azzeramento dei secondi, che il docblock di `rehydrate`
 * dichiara come tolleranza voluta verso una migrazione o un mapper diverso. Là
 * invece cambia il case dell'identità, e riscriverlo in silenzio ha conseguenze.
 */
function toExpiration(
  todoId: string,
  value: string | null,
): Expiration | undefined {
  if (value === null) {
    return undefined;
  }

  try {
    return Expiration.rehydrate(value);
  } catch (error) {
    throw new TodoRowInvalidError(todoId, 'expiration', value, {
      cause: error,
    });
  }
}

/**
 * Narrowing e non un cast, come per `subscription`: la colonna è `text` puro
 * nello schema perché tipizzarla lì costringerebbe `@repo/db` a importare questo
 * dominio.
 */
function toStatus(todoId: string, value: string): TodoStatus {
  const status = TODO_STATUSES.find((known) => known === value);

  if (status === undefined) {
    throw new TodoRowInvalidError(todoId, 'status', value);
  }

  return status;
}

/**
 * Parse **verificato** del JSON dei tag.
 *
 * È la ragione per cui la colonna non usa il `mode: 'json'` di Drizzle: quel
 * modo va accompagnato da `.$type<string[]>()`, che è un cast non controllato a
 * runtime, e una riga con `'[1,2]'` o `'{"a":1}'` entrerebbe nell'aggregato
 * dichiarando di essere `string[]`. Il danno si manifesterebbe altrove, molto
 * dopo, in un punto che sembra corretto.
 */
function toTags(todoId: string, value: string): string[] {
  // `JSON.parse` restituisce `any`: l'annotazione a `unknown` è ciò che
  // costringe al type guard invece di lasciar passare tutto.
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TodoRowInvalidError(todoId, 'tags', value);
  }

  if (!isStringArray(parsed)) {
    throw new TodoRowInvalidError(todoId, 'tags', value);
  }

  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
