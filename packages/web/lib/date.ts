/**
 * Fix 1 (review 2026-10-11): `new Date().toISOString().slice(0, 7)` reads
 * the UTC month, not local — in Argentina (UTC-3) that rolls over a day
 * early, so calling it between 21:00-23:59 local on the last day of the
 * month returns NEXT month. `currentLocalYearMonth()` builds the "YYYY-MM"
 * string from local date parts instead, avoiding the UTC conversion.
 *
 * Lives outside app/page.tsx because Next's app-router route modules may
 * only export the handful of names it recognizes (default, metadata,
 * etc.) — any other named export fails `next build`'s route typechecking.
 */
export function currentLocalYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
