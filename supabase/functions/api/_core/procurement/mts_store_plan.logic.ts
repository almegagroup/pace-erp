/*
 * PO22 Store plan (owner 2026-10-28): the Store instructions for the whole planning horizon, month by month, built from the family planner
 * (the waterfall), for GROUP items only (a group's member that also has an exclusive use is part of its group).
 *
 * For each period and item: what to USE in that period — split by where the stock comes from: ACTUAL stock now (the only part Store may issue),
 * a CSN/PO piece with a valid ETA that has not arrived, a piece whose ETA passed or is missing (assumed to arrive today by the planner, never received),
 * and a planned lot nobody has ordered — what to KEEP at the period end (the level's reserve, up to its Max days), and the EXCESS that stays in the pool. The PO21 parent / child group of the demand is attached; the child groups of one parent that use the same item share
 * ONE row. Pure, advisory: nothing is issued, transferred or posted.
 */
const EPSILON = 0.000001;
const round = (value: number) => Math.round(value * 1000) / 1000;

export type StorePlanPeriod = { key: string; label: string; from: string; to: string; order: number };
export type StorePlanRecord = {
  day: string; candidates: readonly string[]; group_id: string | null; storage_location_id: string | null; qty: number;
  prodshade_material_id: string; sku_material_id: string | null; kind: "RM" | "PM";
};
/** One simulated draw of the family planner (`allocation_rows`). */
export type StorePlanDraw = {
  day: string; material_id: string; destination_kind: "OWN" | "GROUP"; group_id: string | null; qty_base: number;
  source_kind: "OPENING" | "CONFIRMED_ETA" | "MANUAL_LOT" | "ENGINE_LOT"; source_reference: string;
};
export type StorePlanInput = {
  periods: readonly StorePlanPeriod[];
  draws: readonly StorePlanDraw[];
  /** source_key of CSN / PO pieces whose ETA passed or is missing: the planner counts them from today, but they are NOT received. */
  assumedSources: ReadonlySet<string>;
  groupUnmet: ReadonlyArray<{ group_id: string; day: string; qty_base: number }>;
  records: readonly StorePlanRecord[];
  matrix: ReadonlyArray<{ day: string; levels: ReadonlyArray<{ level_kind: "OWN" | "GROUP"; level_id: string; by_material: Readonly<Record<string, number>> }>; pool: Readonly<Record<string, number>>; closing: Readonly<Record<string, number>> }>;
  /** Max days of a level: key `GROUP|<group id>` or `OWN|<material id>`. */
  maxDays: ReadonlyMap<string, number | null>;
  /** Counted stock today per material (what is physically there now). */
  openingByMaterial?: Readonly<Record<string, number>>;
  /** Materials that belong to some group. */
  groupMemberIds: ReadonlySet<string>;
  /** PO21 parent / child group of a Prodshade (RM) — a SKU is mapped to its Prodshade by the caller. */
  productGroupOf: (record: StorePlanRecord) => { mother: string; child: string };
};

export type StorePlanRow = {
  period: string; period_label: string; period_from: string; period_to: string; period_order: number;
  level_kind: "GROUP" | "OWN"; group_id: string | null; material_id: string | null;
  mother_group: string; child_group: string;
  /** Total planned use of the item in the period = the four parts below. */
  use_qty: number;
  /** Issue from ACTUAL stock now — the only part Store may issue. */
  use_stock: number;
  /** From a CSN / PO piece with a valid ETA that has not arrived yet. */
  use_arrival: number;
  /** From a piece whose ETA passed or is missing (assumed today, never received). */
  use_assumed: number;
  /** From a planned lot nobody has ordered. */
  use_lot: number;
  keep_qty: number | null; keep_max_days: number | null; not_backed_qty: number;
};
export type StorePlanExcess = { period: string; period_label: string; period_order: number; material_id: string; excess_qty: number; closing_qty: number; stock_now: number };
export type StorePlanNeed = { material_id: string; period: string; location_id: string; qty: number };

function share<T>(records: readonly StorePlanRecord[], key: (r: StorePlanRecord) => T, keyText: (k: T) => string) {
  const out = new Map<string, { k: T; qty: number }>();
  let total = 0;
  for (const r of records) {
    const k = key(r);
    const id = keyText(k);
    out.set(id, { k, qty: (out.get(id)?.qty ?? 0) + r.qty });
    total += r.qty;
  }
  return { parts: [...out.values()], total };
}

type UseParts = { stock: number; arrival: number; assumed: number; lot: number; total: number };
const ZERO_USE: UseParts = { stock: 0, arrival: 0, assumed: 0, lot: 0, total: 0 };
function scaled(use: UseParts, f: number) {
  return { use_qty: round(use.total * f), use_stock: round(use.stock * f), use_arrival: round(use.arrival * f), use_assumed: round(use.assumed * f), use_lot: round(use.lot * f) };
}
/** Σ draws per material (group destination) — split by where the stock came from. */
function splitDraws(draws: readonly StorePlanDraw[], assumed: ReadonlySet<string>, _key: "material" = "material"): Map<string, UseParts> {
  const out = new Map<string, UseParts>();
  for (const d of draws) {
    const parts = out.get(d.material_id) ?? { ...ZERO_USE };
    if (d.source_kind === "OPENING") parts.stock += d.qty_base;
    else if (d.source_kind === "CONFIRMED_ETA") { if (assumed.has(d.source_reference)) parts.assumed += d.qty_base; else parts.arrival += d.qty_base; }
    else parts.lot += d.qty_base;
    parts.total += d.qty_base;
    out.set(d.material_id, parts);
  }
  return out;
}

export function buildStorePlan(input: StorePlanInput): { rows: StorePlanRow[]; excess: StorePlanExcess[]; needs: StorePlanNeed[] } {
  const rows: StorePlanRow[] = [];
  const excess: StorePlanExcess[] = [];
  const needs: StorePlanNeed[] = [];
  const inPeriod = (day: string, p: StorePlanPeriod) => day >= p.from && day <= p.to;
  const snapshotFor = (material: string, to: string) => [...input.matrix].reverse().find((snap) => snap.day <= to && material in snap.closing) ?? null;
  const groupIds = [...new Set([...input.draws.filter((d) => d.destination_kind === "GROUP" && d.group_id).map((d) => d.group_id as string), ...input.groupUnmet.map((u) => u.group_id)])].sort();

  for (const period of input.periods) {
    const base = { period: period.key, period_label: period.label, period_from: period.from, period_to: period.to, period_order: period.order };

    // ── GROUP levels: what each group drew from each member in the period ─────────────────────────────
    for (const groupId of groupIds) {
      const draws = splitDraws(input.draws.filter((d) => d.destination_kind === "GROUP" && d.group_id === groupId && inPeriod(d.day, period)), input.assumedSources);
      const unmet = input.groupUnmet.filter((u) => u.group_id === groupId && inPeriod(u.day, period)).reduce((s, u) => s + u.qty_base, 0);
      if (draws.size === 0 && unmet <= EPSILON) continue;
      const mine = input.records.filter((r) => r.group_id === groupId && r.candidates.length > 1 && inPeriod(r.day, period));
      const byMother = share(mine, (r) => input.productGroupOf(r), (g) => g.mother);
      const mothers = byMother.parts.length ? byMother.parts : [{ k: { mother: "", child: "" }, qty: 1 }];
      const motherTotal = byMother.parts.length ? byMother.total : 1;
      const children = (mother: string) => [...new Set(mine.map((r) => input.productGroupOf(r)).filter((g) => g.mother === mother).map((g) => g.child).filter(Boolean))].sort().join("; ");
      for (const [material, use] of [...draws].sort(([a], [b]) => a.localeCompare(b))) {
        const snap = snapshotFor(material, period.to);
        const level = snap?.levels.find((l) => l.level_kind === "GROUP" && l.level_id === groupId);
        const keep = level ? level.by_material[material] ?? 0 : null;
        for (const part of mothers) {
          const f = motherTotal > EPSILON ? part.qty / motherTotal : 1;
          rows.push({ ...base, level_kind: "GROUP", group_id: groupId, material_id: material, mother_group: part.k.mother, child_group: children(part.k.mother),
            ...scaled(use, f), keep_qty: keep === null ? null : round(keep * f), keep_max_days: input.maxDays.get(`GROUP|${groupId}`) ?? null, not_backed_qty: 0 });
        }
        // Where the group's lines sit: the store each member must reach (R-store transfer advice) — ACTUAL stock only.
        const byLocation = share(mine.filter((r) => r.storage_location_id), (r) => r.storage_location_id as string, (id) => id);
        for (const loc of byLocation.parts) if (byLocation.total > EPSILON && use.stock > EPSILON) needs.push({ material_id: material, period: period.key, location_id: loc.k, qty: round(use.stock * loc.qty / byLocation.total) });
      }
      if (unmet > EPSILON) {
        for (const part of mothers) {
          const f = motherTotal > EPSILON ? part.qty / motherTotal : 1;
          rows.push({ ...base, level_kind: "GROUP", group_id: groupId, material_id: null, mother_group: part.k.mother, child_group: children(part.k.mother),
            ...scaled(ZERO_USE, 1), keep_qty: null, keep_max_days: input.maxDays.get(`GROUP|${groupId}`) ?? null, not_backed_qty: round(unmet * f) });
        }
      }
    }

    // ── Exclusive use of a group member ───────────────────────────────────────────────────────────────
    const ownByMaterial = splitDraws(input.draws.filter((d) => d.destination_kind === "OWN" && input.groupMemberIds.has(d.material_id) && inPeriod(d.day, period)), input.assumedSources, "material");
    for (const [material, use] of [...ownByMaterial].sort(([a], [b]) => a.localeCompare(b))) {
      if (use.total <= EPSILON) continue;
      const mine = input.records.filter((r) => r.candidates.length <= 1 && r.candidates[0] === material && inPeriod(r.day, period));
      const byMother = share(mine, (r) => input.productGroupOf(r), (g) => g.mother);
      const mothers = byMother.parts.length ? byMother.parts : [{ k: { mother: "", child: "" }, qty: 1 }];
      const motherTotal = byMother.parts.length ? byMother.total : 1;
      const snap = snapshotFor(material, period.to);
      const level = snap?.levels.find((l) => l.level_kind === "OWN" && l.level_id === material);
      const keep = level ? level.by_material[material] ?? 0 : null;
      for (const part of mothers) {
        const f = motherTotal > EPSILON ? part.qty / motherTotal : 1;
        const child = [...new Set(mine.map((r) => input.productGroupOf(r)).filter((g) => g.mother === part.k.mother).map((g) => g.child).filter(Boolean))].sort().join("; ");
        rows.push({ ...base, level_kind: "OWN", group_id: null, material_id: material, mother_group: part.k.mother, child_group: child,
          ...scaled(use, f), keep_qty: keep === null ? null : round(keep * f), keep_max_days: input.maxDays.get(`OWN|${material}`) ?? null, not_backed_qty: 0 });
      }
      const byLocation = share(mine.filter((r) => r.storage_location_id), (r) => r.storage_location_id as string, (id) => id);
      for (const loc of byLocation.parts) if (byLocation.total > EPSILON && use.stock > EPSILON) needs.push({ material_id: material, period: period.key, location_id: loc.k, qty: round(use.stock * loc.qty / byLocation.total) });
    }

    // ── Excess: what stays in the pool at the end of the period, per group-member material ───────────
    for (const material of [...input.groupMemberIds].sort()) {
      const snap = snapshotFor(material, period.to);
      if (!snap) continue;
      excess.push({ period: period.key, period_label: period.label, period_order: period.order, material_id: material, excess_qty: round(snap.pool[material] ?? 0), closing_qty: round(snap.closing[material] ?? 0), stock_now: round(input.openingByMaterial?.[material] ?? 0) });
    }
  }
  return { rows, excess, needs };
}
