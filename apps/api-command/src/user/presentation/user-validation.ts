import { ValidationPipeOptions } from '@nestjs/common';

/**
 * Opzioni del `ValidationPipe` del modulo user.
 *
 * Esportate come costante e non scritte inline nel decoratore perché lo spec
 * deve poter costruire *lo stesso* pipe: un test che valida con opzioni
 * diverse da quelle in produzione non prova niente.
 *
 * Duplicate rispetto a `TODO_VALIDATION` invece di condivise in `shared/`: qui
 * il contenuto identico è una coincidenza, non un vincolo. Sono le opzioni con
 * cui *questo* modulo accetta i suoi body, e il giorno in cui uno dei due
 * volesse ammettere chiavi extra o disattivare la trasformazione non dovrebbe
 * negoziarlo con l'altro. Tre righe non sono l'accoppiamento giusto da
 * comprare.
 *
 * `whitelist` toglie dal body ogni proprietà senza decoratori, e
 * `forbidNonWhitelisted` la trasforma in un 400 invece di scartarla in
 * silenzio: un client che manda `nome` invece di `firstName` deve sentirselo
 * dire, non vedersi creare un utente senza nome (che il dominio rifiuterebbe
 * comunque, ma con un messaggio che non spiega l'errore vero).
 *
 * `transform: true` fa restituire al pipe l'istanza del DTO invece del literal
 * JSON. Nessun DTO utente ha oggetti annidati, quindi qui non serve a
 * `@Type()` come in `TODO_VALIDATION`: serve a tenere il comportamento del
 * pipe uguale nei due moduli.
 */
export const USER_VALIDATION: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
