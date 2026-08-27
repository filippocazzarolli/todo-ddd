import { uuidV7 } from './uuid-v7';

describe('uuidV7', () => {
  it('genera UUID nel formato canonico, versione 7 e variant RFC', () => {
    // Il terzo gruppo inizia con `7` (version), il quarto con 8|9|a|b (variant).
    const pattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(uuidV7()).toMatch(pattern);
  });

  it('codifica il timestamp corrente nei primi 48 bit', () => {
    const before = Date.now();
    const encoded = Number.parseInt(uuidV7().slice(0, 13).replace('-', ''), 16);
    const after = Date.now();

    expect(encoded).toBeGreaterThanOrEqual(before);
    expect(encoded).toBeLessThanOrEqual(after);
  });

  it('produce ID ordinabili lessicograficamente nel tempo', async () => {
    const first = uuidV7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = uuidV7();

    expect(first < second).toBe(true);
  });

  it('non ripete la stessa identità', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV7()));

    expect(ids.size).toBe(1000);
  });
});
