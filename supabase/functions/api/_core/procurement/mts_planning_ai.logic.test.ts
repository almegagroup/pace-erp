import { buildPlanningAiPrompt, PO22_AI_MAX_PROMPT_CHARS } from "./mts_planning_ai.logic.ts";

function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }

Deno.test("AI prompt: numbers from the plan, no ids, bounded size, explicit no-change rule", () => {
  const plan = {
    calendar: { as_of: "2026-10-19", nm_end: "2026-11-30" },
    cost_basis: { interest_pct: 12, customer_credit_days: 15 },
    buys: Array.from({ length: 400 }, (_, i) => ({
      material_id: "11111111-2222-3333-4444-555555555555", material_name: `MAT ${i}`, status: "ADVISORY", required_qty_base: 1234.5678, uom: "KG",
      recommended_po_qty_base: 25000, recommended_po_by: "2026-10-25", estimated_plant_eta: "2026-11-30", vendor_label: "V — 11111111-2222-3333-4444-555555555555",
      vendor_basis: "LOWEST_TOTAL_COST", reason: "x".repeat(200), cost_options: [{ vendor_label: "V", rank: 1, feasible: true, total_per_unit: 100, total_cost: 1000, order_qty: 25000, excess_cost: 5, missing: [] }],
    })),
  };
  const prompt = buildPlanningAiPrompt(plan, null, "Which import is most urgent?");
  assert(prompt.length <= PO22_AI_MAX_PROMPT_CHARS, "bounded");
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(prompt), "no uuid");
  assert(prompt.includes("never invent") && prompt.includes("1234.57"), "rule + plan number");
  const focus = buildPlanningAiPrompt(plan, "MAT 7", null);
  assert(focus.includes("FOCUS MATERIAL: MAT 7") && !focus.includes("- MAT 8:"), "focus only that material");
});
