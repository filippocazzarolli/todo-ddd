/**
 * Scelta del database per gli e2e, applicata **prima** che il modulo Nest venga
 * creato: `SqliteConnection` legge il path nel costruttore, quindi impostarlo
 * dentro un `beforeEach` sarebbe troppo tardi.
 *
 * `:memory:` è privato per connessione, e gli e2e ricreano l'app a ogni test:
 * ogni test parte da un database vuoto e migrato, senza cleanup da ricordare.
 *
 * Sta in `setupFiles` e non in cima a un singolo spec di proposito. Un e2e che
 * dimenticasse questa riga girerebbe sul database di sviluppo: passerebbe, e nel
 * frattempo scriverebbe sui dati veri. È lo stesso genere di errore silenzioso
 * del `mergeObjectContext` dimenticato — quindi come là, va reso impossibile
 * invece di raccomandato.
 */
process.env.DATABASE_URL = ':memory:';
