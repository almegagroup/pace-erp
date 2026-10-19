/*
 * PO22 AI explanation (Phase 2D §8, owner D8). Pure prompt building — the AI receives only the
 * deterministic planning result (labels and numbers, never ids) and is told it may explain and
 * advise but must not invent or change any number. Any scenario change is a new deterministic run.
 */

export const PO22_AI_MAX_PROMPT_CHARS = 12000;

type Plan = {
  calendar?: { as_of?: string; nm_end?: string };
  cost_basis?: { interest_pct?: number | null; customer_credit_days?: number | null };
  buys?: Array<Record<string, unknown>>;
  arrival_flags?: Array<Record<string, unknown>>;
  group_assignments?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const clean = (value: unknown) => String(value ?? "").replace(UUID, "").replace(/\s+/g, " ").trim();
const n = (value: unknown) => (value === null || value === undefined || value === "" ? "?" : String(Math.round(Number(value) * 100) / 100));

export function buildPlanningAiPrompt(plan: Plan, focusMaterialName: string | null, question: string | null): string {
  const lines: string[] = [];
  lines.push("You are a procurement planning assistant for an ERP. Explain the deterministic plan below to the planner in simple, plain English (keep material names, numbers and units exactly as given).");
  lines.push("Rules: use ONLY the numbers given here; never invent, round away or change a quantity, date or cost; never say a PO was created. If something is unknown, say it is unknown and what data would fix it. You may suggest what to review or which scenario to re-run (the planner re-runs the system for new numbers).");
  lines.push(`Horizon: ${clean(plan.calendar?.as_of)} to ${clean(plan.calendar?.nm_end)}. Interest ${n(plan.cost_basis?.interest_pct)}%/year, customer pays in ${n(plan.cost_basis?.customer_credit_days)} days.`);
  const buys = (plan.buys ?? []).filter((b) => b.status !== "NO_BUY");
  const focus = focusMaterialName ? buys.filter((b) => clean(b.material_name) === focusMaterialName) : [];
  const pick = focus.length ? focus : buys.slice(0, 25);
  lines.push(focus.length ? `FOCUS MATERIAL: ${focusMaterialName}` : `BUY RECOMMENDATIONS (${buys.length} total, first ${pick.length}):`);
  for (const b of pick) {
    lines.push(`- ${clean(b.material_name)}: ${clean(b.status)}; need ${n(b.required_qty_base)} ${clean(b.uom)}; PO qty ${n(b.recommended_po_qty_base)}; PO by ${clean(b.recommended_po_by) || "?"}; ETA ${clean(b.estimated_plant_eta) || "?"}; vendor ${clean(b.vendor_label) || "?"} (${clean(b.vendor_basis) || "?"}); why: ${clean(b.reason)}`);
    const options = Array.isArray(b.cost_options) ? (b.cost_options as Array<Record<string, unknown>>).slice(0, focus.length ? 6 : 3) : [];
    for (const o of options) {
      lines.push(`    vendor ${clean(o.vendor_label)}: rank ${n(o.rank)}, on time ${o.feasible ? "yes" : "no"}, total/unit ${n(o.total_per_unit)}, total ${n(o.total_cost)}, order ${n(o.order_qty)}, MOQ excess cost ${n(o.excess_cost)}, unknown: ${clean((o.missing as string[] | undefined)?.join(", ")) || "none"}`);
    }
  }
  const flags = (plan.arrival_flags ?? []).slice(0, 15);
  if (flags.length) {
    lines.push(`CSN ETA ISSUES (${(plan.arrival_flags ?? []).length}):`);
    for (const f of flags) lines.push(`- ${clean(f.material_name)} ${clean(f.document)}: ${clean(f.reason)}`);
  }
  const groups = (plan.group_assignments ?? []).slice(0, 15);
  if (groups.length) {
    lines.push("GROUP SHORTAGES:");
    for (const g of groups) lines.push(`- ${clean(g.group_label)} ${clean(g.month).slice(0, 7)}: short ${n(g.uncovered_qty)}, planned through ${clean(g.assigned_material_name) || "NO MEMBER SELECTED"}`);
  }
  if (question) lines.push(`PLANNER QUESTION: ${clean(question).slice(0, 500)}`);
  lines.push("Answer in at most 12 short bullet points: what is urgent, why, and what the planner should check or decide.");
  let prompt = lines.join("\n");
  if (prompt.length > PO22_AI_MAX_PROMPT_CHARS) prompt = prompt.slice(0, PO22_AI_MAX_PROMPT_CHARS - 20) + "\n[truncated]";
  return prompt;
}
