/** Lava periodicity values; ONE_TIME for purchases. */
export const periodicities = [
  "ONE_TIME",
  "MONTHLY",
  "PERIOD_90_DAYS",
  "PERIOD_180_DAYS",
  "PERIOD_YEAR",
] as const;
export type Periodicity = (typeof periodicities)[number];
export type RecurringPeriodicity = Exclude<Periodicity, "ONE_TIME">;

const DAY_MS = 86_400_000;

export const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);

/** Calendar months in UTC; the day is clamped (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUtc(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function addPeriod(start: Date, periodicity: RecurringPeriodicity) {
  switch (periodicity) {
    case "MONTHLY":
      return addMonthsUtc(start, 1);
    case "PERIOD_90_DAYS":
      return addDays(start, 90);
    case "PERIOD_180_DAYS":
      return addDays(start, 180);
    case "PERIOD_YEAR":
      return addMonthsUtc(start, 12);
  }
}

/**
 * The interval one confirmed payment pays for. The first period starts when
 * the provider took the money (never later than now); a renewal continues
 * from the current paid end, or from the payment if the subscription lapsed.
 * The result depends only on the payment, so a repeated event adds nothing.
 */
export function paidInterval(input: {
  paidUntil: Date | null;
  paidAt: Date;
  now: Date;
  periodicity: RecurringPeriodicity;
}) {
  const paidAt = input.paidAt > input.now ? input.now : input.paidAt;
  const start =
    input.paidUntil && input.paidUntil > paidAt ? input.paidUntil : paidAt;
  return { start, end: addPeriod(start, input.periodicity) };
}
