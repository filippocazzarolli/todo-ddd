import { UserEmailInvalidError } from '../errors/user.errors';
import { Email } from './email.value-object';

describe('Email', () => {
  describe('create', () => {
    it('conserva un indirizzo già normalizzato', () => {
      expect(Email.create('mario.rossi@example.com').toString()).toBe(
        'mario.rossi@example.com',
      );
    });

    it('trimma i bordi', () => {
      expect(Email.create('  mario@example.com \n').toString()).toBe(
        'mario@example.com',
      );
    });

    it('normalizza in minuscolo, parte locale compresa', () => {
      expect(Email.create('Mario.Rossi@Example.COM').toString()).toBe(
        'mario.rossi@example.com',
      );
    });

    it.each([
      'a@b.co',
      'mario+newsletter@example.com',
      'mario_rossi@example.co.uk',
      "o'connor@example.com",
      'mario-rossi@sub.example.com',
    ])('accetta %j', (value) => {
      expect(Email.create(value).toString()).toBe(value);
    });

    it.each([
      ['', 'stringa vuota'],
      ['   ', 'soli spazi'],
      ['mario', 'nessuna chiocciola'],
      ['mario@', 'dominio mancante'],
      ['@example.com', 'parte locale mancante'],
      ['mario@example', 'dominio senza punto'],
      ['mario@.com', 'etichetta di dominio vuota'],
      ['mario@example..com', 'etichetta di dominio vuota in mezzo'],
      ['mario@example.com.', 'punto finale'],
      ['mario@@example.com', 'due chiocciole'],
      ['mario rossi@example.com', 'spazio nella parte locale'],
      ['mario@exa mple.com', 'spazio nel dominio'],
    ])('rifiuta %j (%s) con UserEmailInvalidError', (value) => {
      expect(() => Email.create(value)).toThrow(UserEmailInvalidError);
    });

    it('rifiuta un indirizzo oltre i 254 caratteri di RFC 5321', () => {
      const domain = '@example.com';
      const tooLong = 'a'.repeat(255 - domain.length) + domain;

      expect(tooLong).toHaveLength(255);
      expect(() => Email.create(tooLong)).toThrow(UserEmailInvalidError);
    });

    it('accetta esattamente 254 caratteri: il limite è incluso', () => {
      const domain = '@example.com';
      const atLimit = 'a'.repeat(254 - domain.length) + domain;

      expect(Email.create(atLimit).toString()).toHaveLength(254);
    });

    it('porta nell`errore il valore trimmato ma non normalizzato', () => {
      // Chi legge il messaggio deve riconoscere ciò che ha scritto.
      expect(() => Email.create('  Mario Rossi  ')).toThrow(
        new UserEmailInvalidError('Mario Rossi'),
      );
    });
  });

  describe('equals', () => {
    it('confronta per valore, non per riferimento', () => {
      expect(
        Email.create('mario@example.com').equals(
          Email.create('mario@example.com'),
        ),
      ).toBe(true);
    });

    it('ignora case e spazi, perché il confronto avviene dopo la normalizzazione', () => {
      expect(
        Email.create(' MARIO@EXAMPLE.COM ').equals(
          Email.create('mario@example.com'),
        ),
      ).toBe(true);
    });

    it('distingue indirizzi diversi', () => {
      expect(
        Email.create('mario@example.com').equals(
          Email.create('luigi@example.com'),
        ),
      ).toBe(false);
    });
  });
});
