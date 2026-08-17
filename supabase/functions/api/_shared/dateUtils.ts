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
