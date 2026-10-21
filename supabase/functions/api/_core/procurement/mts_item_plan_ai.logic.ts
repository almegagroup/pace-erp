/*
 * PO22 P4 — Engine + AI joint planning for one item / family (owner 2026-10-20).
 * Pure: the prompt sent to the AI, strict parsing of its proposed lots, and the engine-side
 * metrics used to compare the plan before / after (AI never produces a number on its own — every
 * proposal is re-simulated by the engine before it is shown or applied).
 */

export const ITEM_PLAN_AI_MAX_PROMPT_CHARS = 14000;
export const ITEM_PLAN_AI_MAX_LOTS = 12;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const clean = (value: unknown) => String(value ?? "").replace(UUID, "").replace(/\s+/g, " ").trim();
const n = (value: unknown) => (value === null || value === undefined || value === "" ? "?" : String(Math.round(Number(value) * 100) / 100));

export type GridRow = { day: string; opening: number; arrivals: number; planned_lot: number; use: number; unmet_group: number; closing: number; max_days: number | null; min_days: number | null };

export type PlanMetrics = {
  shortage_days: number;
  first_shortage_day: string | null;
  days_below_target: number;
  lowest_max_days: number | null;
  average_closing: number;
  /** Σ closing × unit cost / days — average money held in stock (null = no price). */
  average_stock_value: number | null;
};

export function planMetrics(grid: readonly GridRow[], familyTargetDays: number | null, unitCost: number | null): PlanMetrics {
  const shortage = grid.filter((g) => g.closing < -0.000001);
  const below = familyTargetDays === null ? [] : grid.filter((g) => g.max_days !== null && g.max_days <= familyTargetDays);
  const maxDays = grid.map((g) => g.max_days).filter((d): d is number => d !== null);
  const avgClosing = grid.length ? grid.reduce((s, g) => s + Math.max(0, g.closing), 0) / grid.length : 0;
  return {
    shortage_days: shortage.length,
    first_shortage_day: shortage[0]?.day ?? null,
    days_below_target: below.length,
    lowest_max_days: maxDays.length ? Math.min(...maxDays) : null,
    average_closing: Math.round(avgClosing * 100) / 100,
    average_stock_value: unitCost === null ? null : Math.round(avgClosing * unitCost * 100) / 100,
  };
}

export type AiPlanContext = {
  item_label: string;
  is_family: boolean;
  groups: string[];
  uom: string | null;
  horizon: { from: string; to: string };
  members: Array<{ code: string | null; name: string; exclusive: boolean; groups: string[]; stock: number; target_days: number | null; critical_days: number | null }>;
  weekly: Array<{ week_start: string; opening: number; arrivals: number; planned_lot: number; use: number; closing: number; min_max_days: number | null }>;
  arrivals: Array<{ code: string | null; reference: string; status: string; qty: number; eta_plant: string | null; advice: string | null }>;
  future_orders: Array<{ code: string | null; vendor: string | null; qty: number; po_by: string | null; eta_plant: string | null; bridge: boolean; late: boolean; max_days_planned: number | null }>;
  user_lots: Array<{ code: string | null; plant_eta: string; qty: number }>;
  alternatives: string[];
  metrics: PlanMetrics;
  question: string | null;
};

export function buildItemPlanAiPrompt(c: AiPlanContext): string {
  const L: string[] = [];
  L.push("You are the AI planner of an ERP procurement team, planning together with a deterministic engine. Plan this item / family for the horizon below.");
  L.push("Rules: use only the numbers given; you may PROPOSE extra lots (material code, plant date, qty) — the engine will re-simulate them and show their real effect; never claim a PO, CSN or transfer was created; respect each vendor's fixed MOQ; do not move in-transit stock; prefer: group member spare → R store transfer → advancing ordered lots → other company → other vendor → safety compromise → trader last.");
  L.push("Goals in order: no production stop (no shortage), keep every member at or above its Target days, then hold as little stock (working capital) as possible above Max days.");
  L.push(`ITEM: ${clean(c.item_label)} (${c.is_family ? `family of ${c.members.length}, groups ${c.groups.map(clean).join("; ")}` : "single item, no group"}); unit ${clean(c.uom)}; horizon ${c.horizon.from} → ${c.horizon.to}.`);
  L.push("MEMBERS:");
  for (const m of c.members) L.push(`- ${clean(m.code)} ${clean(m.name)}: ${m.exclusive ? "exclusive" : ""}${m.groups.length ? ` groups ${m.groups.map(clean).join("/")}` : ""}; stock ${n(m.stock)}; Target ${n(m.target_days)} d / Critical ${n(m.critical_days)} d`);
  L.push("WEEKLY FAMILY PROJECTION (opening, arrivals, engine lots, use, closing, lowest Max days):");
  for (const w of c.weekly) L.push(`- ${w.week_start}: ${n(w.opening)}, +${n(w.arrivals)}, +${n(w.planned_lot)}, -${n(w.use)}, = ${n(w.closing)}, min Max ${n(w.min_max_days)} d`);
  if (c.arrivals.length) {
    L.push("OPEN ARRIVALS:");
    for (const a of c.arrivals.slice(0, 25)) L.push(`- ${clean(a.code)} ${clean(a.reference)} ${clean(a.status)} ${n(a.qty)} plant ${clean(a.eta_plant) || "?"}${a.advice ? `; engine advice: ${clean(a.advice)}` : ""}`);
  }
  if (c.future_orders.length) {
    L.push("ENGINE FUTURE ORDERS:");
    for (const f of c.future_orders.slice(0, 25)) L.push(`- ${clean(f.code)} ${clean(f.vendor)} ${n(f.qty)} PO by ${clean(f.po_by) || "?"} plant ${clean(f.eta_plant) || "?"}${f.bridge ? " BRIDGE" : ""}${f.late ? " LATE" : ""}; sized to ${n(f.max_days_planned)} d`);
  }
  if (c.user_lots.length) {
    L.push("LOTS THE USER FIXED (keep them unless clearly harmful):");
    for (const u of c.user_lots) L.push(`- ${clean(u.code)} ${n(u.qty)} on ${u.plant_eta}`);
  }
  if (c.alternatives.length) { L.push("OPTIONS THE ENGINE FOUND:"); for (const a of c.alternatives.slice(0, 15)) L.push(`- ${clean(a)}`); }
  L.push(`CURRENT RESULT: shortage days ${c.metrics.shortage_days} (first ${c.metrics.first_shortage_day ?? "none"}), days at/below Target ${c.metrics.days_below_target}, lowest Max days ${n(c.metrics.lowest_max_days)}, average stock ${n(c.metrics.average_closing)}${c.metrics.average_stock_value !== null ? ` (≈ ₹${n(c.metrics.average_stock_value)})` : ""}.`);
  if (c.question) L.push(`PLANNER SAYS / ASKS: ${clean(c.question).slice(0, 600)}`);
  L.push(`Reply with a short verdict (good / bad and why, at most 8 bullet points, plain English), then ONE JSON block exactly like:\n\`\`\`json\n{"lots":[{"material_code":"RM-00000","plant_eta":"YYYY-MM-DD","qty":0,"reason":"..."}]}\n\`\`\`\nAt most ${ITEM_PLAN_AI_MAX_LOTS} lots; an empty list if the plan is already best.`);
  let prompt = L.join("\n");
  if (prompt.length > ITEM_PLAN_AI_MAX_PROMPT_CHARS) prompt = prompt.slice(0, ITEM_PLAN_AI_MAX_PROMPT_CHARS - 20) + "\n[truncated]";
  return prompt;
}

export type AiLot = { material_id: string; material_code: string; plant_eta: string; qty: number; reason: string };

/**
 * Strict parse of the AI's JSON block. Only family members, dates inside the horizon and positive
 * quantities pass; everything else is dropped and reported. The AI text never becomes a number
 * that is shown without an engine re-simulation.
 */
export function parseAiLots(text: string, codeToMaterial: ReadonlyMap<string, string>, horizon: { from: string; to: string }): { verdict: string; lots: AiLot[]; rejected: string[] } {
  const rejected: string[] = [];
  const fence = /```json\s*([\s\S]*?)```/i.exec(text);
  const verdict = (fence ? text.slice(0, fence.index) : text).trim();
  if (!fence) return { verdict, lots: [], rejected };
  let parsed: unknown;
  try { parsed = JSON.parse(fence[1]); } catch { return { verdict, lots: [], rejected: ["AI JSON could not be read"] }; }
  const raw = Array.isArray((parsed as { lots?: unknown })?.lots) ? (parsed as { lots: unknown[] }).lots : [];
  const lots: AiLot[] = [];
  for (const item of raw.slice(0, ITEM_PLAN_AI_MAX_LOTS)) {
    const r = (item ?? {}) as Record<string, unknown>;
    const code = String(r.material_code ?? "").trim();
    const day = String(r.plant_eta ?? "").trim();
    const qty = Number(r.qty);
    const materialId = codeToMaterial.get(code);
    if (!materialId) { rejected.push(`${code || "?"}: not a member of this plan`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < horizon.from || day > horizon.to) { rejected.push(`${code}: date ${day || "?"} outside the horizon`); continue; }
    if (!Number.isFinite(qty) || qty <= 0) { rejected.push(`${code}: quantity must be positive`); continue; }
    lots.push({ material_id: materialId, material_code: code, plant_eta: day, qty: Math.round(qty * 1000) / 1000, reason: String(r.reason ?? "").slice(0, 300) });
  }
  return { verdict, lots, rejected };
}

/** Week buckets (Monday-agnostic: every 7 days from the first day) for the AI summary. */
export function weeklySummary(grid: readonly GridRow[]): AiPlanContext["weekly"] {
  const out: AiPlanContext["weekly"] = [];
  for (let i = 0; i < grid.length; i += 7) {
    const week = grid.slice(i, i + 7);
    const maxDays = week.map((g) => g.max_days).filter((d): d is number => d !== null);
    out.push({
      week_start: week[0].day, opening: week[0].opening,
      arrivals: week.reduce((s, g) => s + g.arrivals, 0), planned_lot: week.reduce((s, g) => s + g.planned_lot, 0),
      use: week.reduce((s, g) => s + g.use + 0, 0), closing: week[week.length - 1].closing,
      min_max_days: maxDays.length ? Math.min(...maxDays) : null,
    });
  }
  return out;
}
