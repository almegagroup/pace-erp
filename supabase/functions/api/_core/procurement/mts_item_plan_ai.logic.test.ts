import { buildItemPlanAiPrompt, buildWhatIfTargetPrompt, parseAiLots, pickTargetCandidate, planMetrics, type TargetCandidateResult, weeklySummary, type GridRow } from "./mts_item_plan_ai.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}
const g = (day: string, closing: number, max_days: number | null): GridRow => ({ day, opening: 0, arrivals: 0, planned_lot: 0, use: 10, unmet_group: 0, closing, max_days, min_days: null });

Deno.test("P4 planMetrics: shortage days, days at/below Target, money held", () => {
  const m = planMetrics([g("2026-11-01", 100, 10), g("2026-11-02", -5, 0), g("2026-11-03", 50, 5)], 6, 2);
  assertEqual([m.shortage_days, m.first_shortage_day, m.days_below_target, m.lowest_max_days, m.average_closing, m.average_stock_value], [1, "2026-11-02", 2, 0, 50, 100], "metrics");
});

Deno.test("P4 parseAiLots: only members, horizon dates and positive qty pass; the rest is reported", () => {
  const text = 'Verdict: too tight in December.\n```json\n{"lots":[{"material_code":"RM-1","plant_eta":"2026-12-05","qty":24000,"reason":"cover Dec"},{"material_code":"RM-X","plant_eta":"2026-12-05","qty":5},{"material_code":"RM-1","plant_eta":"2030-01-01","qty":5},{"material_code":"RM-1","plant_eta":"2026-12-09","qty":-1}]}\n```';
  const r = parseAiLots(text, new Map([["RM-1", "uuid-1"]]), { from: "2026-10-21", to: "2027-03-31" });
  assertEqual(r.lots.map((l) => [l.material_id, l.plant_eta, l.qty]), [["uuid-1", "2026-12-05", 24000]], "one valid lot");
  assertEqual(r.rejected.length, 3, "three rejected with reasons");
  assert(r.verdict.startsWith("Verdict"), "verdict text kept");
  assertEqual(parseAiLots("no json here", new Map(), { from: "a", to: "b" }).lots, [], "no JSON → no lots");
});

Deno.test("P4 prompt: carries the goals, members, options and never ids", () => {
  const prompt = buildItemPlanAiPrompt({
    item_label: "Gabrosa M700", is_family: true, groups: ["MHEC"], uom: "KG", horizon: { from: "2026-10-21", to: "2027-03-31" },
    members: [{ code: "RM-00083", name: "Gabrosa 3f1a2b3c-1111-2222-3333-444455556666", exclusive: true, groups: ["MHEC"], stock: 17802, target_days: 30, critical_days: 15 }],
    weekly: weeklySummary([g("2026-10-21", 100, 10)]), arrivals: [], future_orders: [], user_lots: [], alternatives: ["Group member spare: 500"],
    metrics: planMetrics([g("2026-10-21", 100, 10)], 30, null), question: "Can we skip December?",
  });
  assert(prompt.includes("no production stop") && prompt.includes("RM-00083") && prompt.includes("Can we skip December?"), "content");
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(prompt), "no uuid leaks into the prompt");
});

Deno.test("What-if: days at/below Critical counted against the given Critical", () => {
  const m = planMetrics([g("2026-11-01", 100, 10), g("2026-11-02", 60, 4), g("2026-11-03", 50, 3)], 20, null, 4);
  assertEqual([m.days_below_target, m.days_below_critical], [3, 2], "below target 3, below critical 2");
  assertEqual(planMetrics([g("2026-11-01", 100, 10)], 20, null).days_below_critical, 0, "no Critical → 0");
});

const cand = (target: number, shortage: number, belowCritical: number, value: number | null, isCurrent = false): TargetCandidateResult => ({
  target_days: target, critical_days: 10, is_current: isCurrent,
  metrics: { shortage_days: shortage, first_shortage_day: null, days_below_target: 0, days_below_critical: belowCritical, lowest_max_days: null, average_closing: 0, average_stock_value: value },
  order_count: 1, order_qty: 100, order_value: null, order_value_partial: false,
});

Deno.test("What-if pick: lowest money among candidates no riskier than today", () => {
  const pick = pickTargetCandidate([cand(10, 2, 5, 500), cand(15, 0, 1, 800), cand(20, 0, 1, 1000, true), cand(25, 0, 0, 1200)]);
  assertEqual(pick?.target_days, 15, "15 days: no shortage, Critical days not worse, cheaper");
  assert(pick!.reason.includes("200"), "reason shows the saving");
});

Deno.test("What-if pick: keeps today when nothing lower is safe; null when none is safe", () => {
  assertEqual(pickTargetCandidate([cand(15, 1, 3, 800), cand(20, 0, 1, 1000, true)])?.target_days, 20, "keep current");
  assertEqual(pickTargetCandidate([cand(15, 1, 3, 800), cand(20, 2, 1, 1000, true)]), null, "none safe");
  assertEqual(pickTargetCandidate([cand(15, 0, 0, null), cand(20, 0, 0, null, true)])?.target_days, 15, "no cost → lowest Target");
});

Deno.test("What-if prompt: engine numbers only, no ids", () => {
  const p = buildWhatIfTargetPrompt({ item_label: "VAE 5010 3fa85f64-5717-4562-b3fc-2c963f66afa6", uom: "KG", horizon: { from: "2026-10-21", to: "2027-03-31" },
    current_target: 20, current_critical: 10, results: [cand(15, 0, 1, 800), cand(20, 0, 1, 1000, true)], engine_pick: { target_days: 15, reason: "cheaper" } });
  assert(!p.includes("3fa85f64"), "uuid stripped");
  assert(p.includes("Target 20 (current)") && p.includes("Engine pick: 15 days"), "candidates and pick shown");
});
