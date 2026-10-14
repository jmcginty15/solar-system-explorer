/** Julian Date of J2000.0 epoch (TT/TDB ≈ same for our purposes). */
export const JD_J2000 = 2451545.0;

/** Milliseconds per Julian day. */
const MS_PER_DAY = 86_400_000;

/**
 * Convert a Unix-time Date to Julian Date.
 * Uses the standard civil→JD relation (adequate for visualization;
 * ignores UT1/TT differences of order ~70 s).
 */
export function dateToJulianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + 2440587.5;
}

/** Julian days from J2000.0. */
export function daysFromJ2000(jd: number): number {
  return jd - JD_J2000;
}

/** Julian centuries from J2000.0. */
export function centuriesFromJ2000(jd: number): number {
  return daysFromJ2000(jd) / 36_525;
}

/** Epoch helpers for the current wall-clock time. */
export function epochNow(): { jd: number; d: number; T: number } {
  const jd = dateToJulianDate(new Date());
  const d = daysFromJ2000(jd);
  const T = d / 36_525;
  return { jd, d, T };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Convert Julian Date to a Date (inverse of dateToJulianDate).
 */
export function julianDateToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * MS_PER_DAY);
}

/**
 * Format a Date for `<input type="datetime-local" step="1">` in local time:
 * `YYYY-MM-DDTHH:mm:ss`.
 */
export function formatDatetimeLocal(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/** Human-readable local datetime for the live simulation clock. */
export function formatSimDatetime(jd: number): string {
  return formatDatetimeLocal(julianDateToDate(jd)).replace("T", " ");
}

/**
 * Parse a `datetime-local` value as a local-time Date.
 * Returns null if the string is empty or incomplete.
 */
export function parseDatetimeLocal(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
