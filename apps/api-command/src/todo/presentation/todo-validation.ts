import { ValidationPipeOptions } from '@nestjs/common';

/**
 * Opzioni del `ValidationPipe` del modulo todo.
 *
 * Esportate come costante e non scritte inline nel decoratore perché lo spec
 * deve poter costruire *lo stesso* pipe: un test che valida con opzioni
 * diverse da quelle in produzione non prova niente.
 *
 * `whitelist` toglie dal body ogni proprietà senza decoratori, e
 * `forbidNonWhitelisted` la trasforma in un 400 invece di scartarla in
 * silenzio: un client che manda `titolo` invece di `title` deve sentirselo
 * dire, non vedersi creare un todo senza titolo.
 *
 * `transform` serve a `@Type(() => ExpirationBody)`: senza, l'oggetto annidato
 * resta un literal e `@ValidateNested` non ha una classe su cui validare.
 */
export const TODO_VALIDATION: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
