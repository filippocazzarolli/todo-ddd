import {
  TodoDomainError,
  TodoExpirationInPastError,
  TodoExpirationInvalidError,
} from '../errors/todo.errors';
import { Expiration } from './expiration.value-object';

/**
 * Tutte le date sono costruite da componenti locali e non da stringhe ISO:
 * `Expiration` interpreta data e ora nel fuso del processo, quindi confrontare
 * i due nello stesso fuso rende lo spec indipendente dal `TZ` della macchina.
 */
const NOW = new Date(2026, 0, 15, 10, 30, 45);

describe('Expiration', () => {
  describe('create', () => {
    it('compone data e ora in un istante al minuto', () => {
      const expiration = Expiration.create(
        { date: '2026-03-01', time: '18:05' },
        NOW,
      );

      expect(expiration.toDate()).toStrictEqual(new Date(2026, 2, 1, 18, 5));
      expect(expiration.date).toBe('2026-03-01');
      expect(expiration.time).toBe('18:05');
      expect(expiration.toString()).toBe('2026-03-01 18:05');
    });

    it('accetta l`istante esattamente uguale a `now`, al minuto', () => {
      expect(
        Expiration.create({ date: '2026-01-15', time: '10:30' }, NOW).time,
      ).toBe('10:30');
    });

    it('rifiuta il minuto precedente a `now`', () => {
      expect(() =>
        Expiration.create({ date: '2026-01-15', time: '10:29' }, NOW),
      ).toThrow(TodoExpirationInPastError);
    });

    it('espone il rifiuto come TodoDomainError, non come Error generico', () => {
      expect(() =>
        Expiration.create({ date: '2020-01-01', time: '00:00' }, NOW),
      ).toThrow(TodoDomainError);
    });

    it('porta il valore rifiutato nell`errore, per la mappatura a valle', () => {
      expect(() =>
        Expiration.create({ date: '2020-01-01', time: '08:00' }, NOW),
      ).toThrow('2020-01-01 08:00');
    });

    it('trimma le parti', () => {
      expect(
        Expiration.create(
          { date: ' 2026-03-01 ', time: '\t18:05\n' },
          NOW,
        ).toString(),
      ).toBe('2026-03-01 18:05');
    });

    it.each([
      ['2026-1-5', '10:00'],
      ['26-01-05', '10:00'],
      ['2026/01/05', '10:00'],
      ['2026-13-01', '10:00'],
      ['2026-00-01', '10:00'],
      ['2026-02-30', '10:00'],
      ['2027-02-29', '10:00'],
      ['2026-04-31', '10:00'],
      ['', '10:00'],
      ['2026-06-01', '9:00'],
      ['2026-06-01', '25:00'],
      ['2026-06-01', '10:60'],
      ['2026-06-01', '10:00:00'],
      ['2026-06-01', '1000'],
      ['2026-06-01', ''],
    ])('rifiuta (%j %j) con TodoExpirationInvalidError', (date, time) => {
      expect(() => Expiration.create({ date, time }, NOW)).toThrow(
        TodoExpirationInvalidError,
      );
    });

    it('accetta il 29 febbraio di un anno bisestile', () => {
      expect(
        Expiration.create(
          { date: '2028-02-29', time: '10:00' },
          NOW,
        ).toString(),
      ).toBe('2028-02-29 10:00');
    });

    it('azzera secondi e millisecondi: la precisione è il minuto', () => {
      const instant = Expiration.create(
        { date: '2026-03-01', time: '18:05' },
        NOW,
      ).toDate();

      expect(instant.getSeconds()).toBe(0);
      expect(instant.getMilliseconds()).toBe(0);
    });
  });

  describe('rehydrate', () => {
    it('non valida il passato: una scadenza scaduta resta un dato valido', () => {
      const iso = new Date(2020, 0, 1, 8, 0).toISOString();

      expect(Expiration.rehydrate(iso).toString()).toBe('2020-01-01 08:00');
    });

    it('è l`inverso di toISOString', () => {
      const expiration = Expiration.create(
        { date: '2026-03-01', time: '18:05' },
        NOW,
      );

      expect(
        Expiration.rehydrate(expiration.toISOString()).equals(expiration),
      ).toBe(true);
    });

    it('tronca al minuto ciò che la persistenza porta con i secondi', () => {
      const iso = new Date(2026, 2, 1, 18, 5, 42, 500).toISOString();

      expect(Expiration.rehydrate(iso).toDate()).toStrictEqual(
        new Date(2026, 2, 1, 18, 5),
      );
    });

    it.each(['', 'non-una-data', '2026-13-01T10:00:00.000Z'])(
      'rifiuta (%j) con TodoExpirationInvalidError',
      (value) => {
        expect(() => Expiration.rehydrate(value)).toThrow(
          TodoExpirationInvalidError,
        );
      },
    );

    it('non rifiuta un ISO che `Date` normalizza: il 30 febbraio diventa il 2 marzo', () => {
      /*
       * `rehydrate` valida la parsabilità, non la semantica: l'unico produttore
       * di questi valori è `toISOString()`. Ripetere qui il controllo di
       * roll-over di `create` significherebbe riparsare a mano le componenti
       * UTC per difendersi da un dato che solo una corruzione può produrre.
       */
      expect(Expiration.rehydrate('2026-02-30T10:00:00.000Z').date).not.toBe(
        '2026-02-30',
      );
    });
  });

  describe('isPast', () => {
    it('è false per un istante futuro e true per uno passato', () => {
      const expiration = Expiration.create(
        { date: '2026-01-15', time: '11:00' },
        NOW,
      );

      expect(expiration.isPast(NOW)).toBe(false);
      expect(expiration.isPast(new Date(2026, 0, 15, 11, 0, 1))).toBe(false);
      expect(expiration.isPast(new Date(2026, 0, 15, 11, 1))).toBe(true);
    });
  });

  describe('equals', () => {
    it('confronta per valore, non per identità', () => {
      const props = { date: '2026-03-01', time: '18:05' };

      expect(
        Expiration.create(props, NOW).equals(Expiration.create(props, NOW)),
      ).toBe(true);
      expect(
        Expiration.create(props, NOW).equals(
          Expiration.create({ date: '2026-03-01', time: '18:06' }, NOW),
        ),
      ).toBe(false);
    });
  });

  describe('immutabilità', () => {
    it('toDate restituisce una copia: mutarla non altera il VO', () => {
      const expiration = Expiration.create(
        { date: '2026-03-01', time: '18:05' },
        NOW,
      );

      expiration.toDate().setFullYear(1999);

      expect(expiration.toString()).toBe('2026-03-01 18:05');
    });

    it('non tiene il riferimento al `now` del chiamante', () => {
      const now = new Date(NOW);
      const expiration = Expiration.create(
        { date: '2026-01-15', time: '11:00' },
        now,
      );

      now.setFullYear(2030);

      expect(expiration.isPast(NOW)).toBe(false);
    });
  });
});
