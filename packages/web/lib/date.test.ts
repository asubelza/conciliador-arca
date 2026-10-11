import { currentLocalYearMonth } from './date';

/**
 * Fix 1 (review 2026-10-11): `app/page.tsx`'s "Crear nuevo período" used to
 * call `createPeriodo` with `new Date().toISOString().slice(0, 7)`, which
 * reads the UTC month. In Argentina (UTC-3) that rolls over a day early —
 * clicking between 21:00-23:59 local on the last day of the month created
 * a período for NEXT month. `currentLocalYearMonth()` fixes this by
 * reading local date parts (`getFullYear`/`getMonth`) instead.
 */
describe('currentLocalYearMonth', () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    jest.useRealTimers();
    process.env.TZ = ORIGINAL_TZ;
  });

  it('returns the local calendar month even when UTC has already rolled over to the next month', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires'; // UTC-3, no DST
    // 2026-08-31 23:30 local (ART) == 2026-09-01 02:30 UTC.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T02:30:00.000Z'));

    expect(currentLocalYearMonth()).toBe('2026-08');
  });

  it('matches the UTC-derived month when there is no rollover between local and UTC', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00.000Z'));

    expect(currentLocalYearMonth()).toBe('2026-08');
  });
});
