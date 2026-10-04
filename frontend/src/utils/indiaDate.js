/*
 * Business calendar helpers.
 *
 * ERP document dates follow the India business day, regardless of the browser
 * or server's own time zone. Never use Date#toISOString() for "today": it is
 * UTC and returns yesterday between 00:00 and 05:29 in India.
 */

export const INDIA_TIME_ZONE = "Asia/Kolkata";

export function isoDateInTimeZone(date = new Date(), timeZone = INDIA_TIME_ZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("A valid Date is required");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function todayIsoInIndia(now = new Date()) {
  return isoDateInTimeZone(now, INDIA_TIME_ZONE);
}
