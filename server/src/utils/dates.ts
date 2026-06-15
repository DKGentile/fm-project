/**
 * Calendar-day date math, normalised to UTC midnight so results never depend on
 * the time of day the process runs at. Used by both the policy engine (return
 * window) and the CRM store (date anchoring) so they share one notion of "day".
 */

export const DAY_MS = 86_400_000;

/** Milliseconds at UTC midnight of the given date. */
export function toUtcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole days between an ISO date (YYYY-MM-DD…) and `to` (default: now). */
export function daysSince(fromIso: string, to: Date = new Date()): number {
  const from = new Date(fromIso.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((toUtcMidnight(to) - from) / DAY_MS);
}

/** Shift an ISO date string (YYYY-MM-DD) by a whole number of days. */
export function shiftIsoDate(iso: string, offsetDays: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
