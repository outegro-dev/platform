const DAY_MS = 24 * 3600_000;

/** The UTC calendar day of an instant, `YYYY-MM-DD`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The last `count` UTC days, oldest first, today included. */
export function lastDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    utcDay(new Date(now.getTime() - (count - 1 - i) * DAY_MS)),
  );
}
