/*
 * File-Path: supabase/functions/api/_core/production/mts_hold_reason.ts
 * Purpose: QA's reason for putting MTS FG into Quality Inspection / Blocked at Verify (IN15 trail).
 *          Pure helpers -- no DB, so they are unit-tested directly.
 * Authority: Backend
 */

export const MAX_HOLD_REASON_LENGTH = 500;

// Trim + collapse inner whitespace. Empty / non-text -> null. Too long -> throws a stable code the handler maps to 422.
export function normalizeHoldReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > MAX_HOLD_REASON_LENGTH) throw new Error("PROD_MTS_HOLD_REASON_TOO_LONG");
  return text;
}

// Several holds can merge into one stock-status posting; keep each distinct reason once, in input order.
export function mergeHoldReasons(reasons: Array<string | null>): string | null {
  const distinct: string[] = [];
  for (const reason of reasons) {
    if (reason && !distinct.includes(reason)) distinct.push(reason);
  }
  return distinct.length > 0 ? distinct.join("; ") : null;
}

// First problem across a list of requested holds (every hold needs a reason), or null when all are fine.
export function findHoldReasonProblem(holds: Array<Record<string, unknown>>): "PROD_MTS_HOLD_REASON_REQUIRED" | "PROD_MTS_HOLD_REASON_TOO_LONG" | null {
  for (const hold of holds) {
    try {
      if (normalizeHoldReason(hold?.reason) === null) return "PROD_MTS_HOLD_REASON_REQUIRED";
    } catch {
      return "PROD_MTS_HOLD_REASON_TOO_LONG";
    }
  }
  return null;
}
