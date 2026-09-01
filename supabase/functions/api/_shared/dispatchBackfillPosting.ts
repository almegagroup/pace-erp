/*
 * File-Path: supabase/functions/api/_shared/dispatchBackfillPosting.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: §133.16 Part B -- Go-live Catch-up Backfill. TEMPORARY,
 *          time-boxed mechanism (feasibility doc's own words: "not
 *          backdating -- real historical events posting at their real
 *          date, so WAR's chronological order stays correct with zero
 *          special ripple-recalculation"). August 2026's real dispatches
 *          are being entered in September because Dispatch's design
 *          finalized late -- this resolves what `posting_date` (a plain
 *          DATE column, no time component -- see stock_document/
 *          stock_ledger schema) each PGI action should carry, per
 *          Dispatch Category, across 3 calendar phases. Deliberately
 *          isolated in its own file (not scattered as inline magic dates)
 *          so the whole mechanism can be deleted in one place once Phase 3
 *          is the only phase left standing -- see isPastBackfillWindow().
 * Authority: Backend
 */

// Every date-cutoff lives here, nowhere else -- change/remove in one place.
const PHASE_1_END = "2026-09-07"; // Phase 1: automated posting-date resolution (this file's own rules)
const PHASE_2_END = "2026-09-15"; // Phase 2: grace period, real-time posting expected but not enforced
// Phase 3 (after PHASE_2_END): strict enforcement, this file's resolution logic no longer applies at all.
// Only August invoices are historical catch-up. A new September dispatch must retain its
// own invoice date even while Phase 1 remains open for August backfill.
const HISTORICAL_BACKFILL_INVOICE_END = "2026-08-31";

export type BackfillPhase = "PHASE_1" | "PHASE_2" | "PHASE_3";

export function resolveBackfillPhase(todayIso: string): BackfillPhase {
  if (todayIso <= PHASE_1_END) return "PHASE_1";
  if (todayIso <= PHASE_2_END) return "PHASE_2";
  return "PHASE_3";
}

// Once Phase 3 permanently begins, this whole file's Phase-1-specific
// resolution logic is dead code -- kept only so a mid-Phase-2 retry of an
// already-in-flight request doesn't suddenly change behavior mid-day. Safe
// to delete this file and its one call site entirely once business owner
// confirms Phase 3 is the permanent, sole state (per feasibility doc's own
// "implementation note").
export function isPastBackfillWindow(todayIso: string): boolean {
  return resolveBackfillPhase(todayIso) === "PHASE_3";
}

export function isHistoricalBackfillInvoiceDate(tallyInvoiceDate: string): boolean {
  return tallyInvoiceDate <= HISTORICAL_BACKFILL_INVOICE_END;
}

// Phase 1, MTO/HPS rule -- Packing PO's own Final timestamp + 10 minutes,
// so a dispatch entered in September always posts on/after its own
// production's date. Exception (locked, checked against the Packing PO's
// own raw Final date, BEFORE the +10-minute shift): if that Final date is
// 30 or 31 August, force the posting date to 31 August specifically (never
// 30) -- the design's own stated reason is to keep every MTO/HPS backfill
// entry inside the last day of the month as a clean cutoff, regardless of
// which of the two days the real Packing PO Final fell on. (The locked
// design also names an 11:00PM-11:50PM time window for this case, but
// posting_date is a plain DATE column with no time component -- see
// stock_document/stock_ledger schema -- so only the date half is
// storable; the exact minute has no observable effect either way.)
function resolveMtoHpsPostingDate(packingPoFinalizedAtIso: string): string {
  const finalized = new Date(packingPoFinalizedAtIso);
  const finalizedMonth = finalized.getUTCMonth(); // 0-indexed, 7 = August
  const finalizedDay = finalized.getUTCDate();
  if (finalizedMonth === 7 && (finalizedDay === 30 || finalizedDay === 31)) {
    return "2026-08-31";
  }
  const shifted = new Date(finalized.getTime() + 10 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export type BackfillClassification = {
  hasMtoHpsBatch: boolean;
  hasMtestBatch: boolean;
  mtoHpsPackingPoFinalizedAtIso: string | null;
  // Corrected 2026-08-28 (business owner) -- MTEST used to get a random day
  // in 28-31 August unconditionally, which would mis-date a genuine
  // same-day MTEST dispatch entered for real (e.g. on 1 September) as an
  // August backlog entry. MTEST now uses the SO's own manually-entered
  // "SO Date" directly instead -- a real, user-owned reference date, so a
  // real September dispatch (whose SO is dated in September) resolves
  // correctly, and a genuine August backlog entry (whose SO is dated in
  // August) also resolves correctly. No randomization needed once a real
  // date exists to anchor to.
  mtestSoDate: string | null;
};

// Phase 1 -- resolve an August historical invoice-group's own posting_date.
// September-or-later invoices bypass this resolver and retain their Tally Invoice Date.
// Phase 2/3 callers use today's real date (Phase 2) or hard-block on a
// Tally-Date mismatch (Phase 3, see assertPhase3PostingDateMatch below).
export function resolvePhase1PostingDate(classification: BackfillClassification, tallyInvoiceDate: string): string {
  if (classification.hasMtoHpsBatch && classification.mtoHpsPackingPoFinalizedAtIso) {
    return resolveMtoHpsPostingDate(classification.mtoHpsPackingPoFinalizedAtIso);
  }
  if (classification.hasMtestBatch) {
    return classification.mtestSoDate ?? tallyInvoiceDate;
  }
  // RPS (no batch at all) -- Tally Invoice Date directly.
  return tallyInvoiceDate;
}

// Phase 3 -- strict enforcement. Throws (caller maps to a 400) when the
// Tally Invoice Date and today's real posting date don't match, forcing
// timely entry going forward with no exceptions.
export function assertPhase3PostingDateMatch(tallyInvoiceDate: string, todayIso: string): void {
  if (tallyInvoiceDate !== todayIso) {
    throw new Error("PGI_BACKFILL_WINDOW_CLOSED_DATE_MISMATCH");
  }
}
