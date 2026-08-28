/**
 * Esegue un'operazione **sincrona** consegnandone l'esito come `Promise`.
 *
 * Serve perché `better-sqlite3` è un driver sincrono mentre le porte di
 * persistenza dichiarano `Promise`: senza questo, un errore uscirebbe come
 * throw sincrono da un metodo che promette di restituire una promise, e chi
 * chiama avrebbe due modi diversi di fallire da gestire.
 *
 * Non è `async` per la ragione opposta e simmetrica: non c'è niente da
 * attendere, quindi `require-await` boccerebbe la funzione.
 *
 * Vive in `shared/` con lo stesso criterio di `uuid-v7.ts`: è **meccanismo, non
 * contratto**. Non conosce nessun aggregato, nessuna porta e nessun errore di
 * dominio — sa solo convertire una chiamata sincrona in una promise. È la stessa
 * ragione per cui `loadTodo` e `loadUser` restano invece due funzioni quasi
 * identiche: quelle parlano dei rispettivi aggregati, e unificarle creerebbe un
 * contratto condiviso fra bounded context.
 */
export function settle<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
