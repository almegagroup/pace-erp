/*
 * File-Path: supabase/functions/api/_shared/dateUtils.ts
 * Purpose: Shared IST-correct "today" date helper.
 *
 * `new Date().toISOString().slice(0, 10)` returns the UTC calendar date, which
 * lags IST by up to 5.5 hours -- every day between 00:00 and 05:29 IST it still
 * returns yesterday's date. This business runs entirely on IST, so every
 * document_date/posting_date default computed this way was wrong for that
 * window. Already fixed correctly once, independently, inside the HR module
 * (`_core/hr/shared.ts`'s `todayIsoInKolkata`) -- this is that same
 * implementation, promoted to `_shared` so every other domain can use one
 * source of truth instead of re-deriving (or re-breaking) it per file.
 * Authority: Backend
 */

export function todayIsoInKolkata(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// For display-only timestamp columns (e.g. report "entry date/time" fields).
// Same problem as todayIsoInKolkata but for a full timestamp instead of just
// today's date: passing a timestamptz string straight through to the UI shows
// it in UTC, which can land on a different calendar day than an IST-correct
// date column on the same row -- found live 2026-08-18, IN02 Stock Ledger's
// "Entry Date/Time" showed the 17th next to a "Posting Date" of the 18th for
// the same event.
export function formatDateTimeInKolkata(isoTimestamp: string | null | undefined): string | null {
  if (!isoTimestamp) return null;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}
