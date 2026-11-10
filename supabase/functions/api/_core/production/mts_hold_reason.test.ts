import { findHoldReasonProblem, mergeHoldReasons, normalizeHoldReason } from "./mts_hold_reason.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("normalizeHoldReason trims and collapses whitespace", () => {
  assertEqual(normalizeHoldReason("  too   late \n now "), "too late now", "collapsed");
});

Deno.test("normalizeHoldReason returns null for empty / non-text input", () => {
  assertEqual(normalizeHoldReason("   "), null, "blank");
  assertEqual(normalizeHoldReason(undefined), null, "undefined");
  assertEqual(normalizeHoldReason(null), null, "null");
});

Deno.test("normalizeHoldReason accepts exactly 500 chars and rejects 501", () => {
  assertEqual(normalizeHoldReason("a".repeat(500))?.length, 500, "500 ok");
  let code = "";
  try { normalizeHoldReason("a".repeat(501)); } catch (error) { code = error instanceof Error ? error.message : ""; }
  assertEqual(code, "PROD_MTS_HOLD_REASON_TOO_LONG", "501 rejected");
});

Deno.test("mergeHoldReasons keeps distinct reasons in input order", () => {
  assertEqual(mergeHoldReasons(["a", "b", "a", null]), "a; b", "distinct");
});

Deno.test("mergeHoldReasons returns null when there is no reason", () => {
  assertEqual(mergeHoldReasons([null, null]), null, "all null");
  assertEqual(mergeHoldReasons([]), null, "empty");
});

Deno.test("findHoldReasonProblem flags a missing or too-long reason and passes valid holds", () => {
  assertEqual(findHoldReasonProblem([{ reason: "visual defect" }, { reason: "  re-test " }]), null, "valid");
  assertEqual(findHoldReasonProblem([{ reason: "ok" }, { reason: "  " }]), "PROD_MTS_HOLD_REASON_REQUIRED", "blank");
  assertEqual(findHoldReasonProblem([{}]), "PROD_MTS_HOLD_REASON_REQUIRED", "missing");
  assertEqual(findHoldReasonProblem([{ reason: "a".repeat(501) }]), "PROD_MTS_HOLD_REASON_TOO_LONG", "too long");
  assertEqual(findHoldReasonProblem([]), null, "no holds means nothing to explain");
});
