/*
 * PO22 waterfall as the user reads it (owner 2026-10-28, docs/mts-planning/PO22-WATERFALL-OWNER-METHOD-2026-10-28.md §13).
 * Pure: turns the family planner's level policies, event log and Material × Level snapshots into labelled rows for one family.
 * Names only; no UUID leaves the server. Shared by the Item Plan (4A) and the rolling-plan Excel.
 */
import type { FamilyResult } from "./mts_family_planner.logic.ts";

const round = (value: number) => Math.round(value * 1000) / 1000;

export type WaterfallViewInput = {
  projection: Pick<FamilyResult, "level_policies" | "level_events" | "level_matrix">;
  asOf: string;
  memberSet: ReadonlySet<string>;
  groupSet: ReadonlySet<string>;
  groupLabel: (groupId: string) => string;
  materialLabel: (materialId: string) => string;
  uomOf: (materialId: string) => string | null;
};

export function buildWaterfallView(input: WaterfallViewInput) {
  const { projection, asOf, memberSet, groupSet } = input;
  const levelName = (kind: string, id: string | null) => (kind === "OWN" ? `Exclusive — ${input.materialLabel(id ?? "")}` : kind === "GROUP" ? input.groupLabel(id ?? "") : "Pool");
  const inFamily = (kind: string, id: string | null) => (kind === "OWN" ? memberSet.has(id ?? "") : kind === "GROUP" ? groupSet.has(id ?? "") : true);
  const named = (record: Readonly<Record<string, number>>) => Object.entries(record).filter(([id]) => memberSet.has(id))
    .map(([id, qty]) => ({ material: input.materialLabel(id), uom: input.uomOf(id), qty: round(qty) }));
  const policies = projection.level_policies.filter((l) => inFamily(l.level_kind, l.level_id));
  const events = projection.level_events.filter((e) => (e.kind === "RECEIPT" ? Boolean(e.material_id && memberSet.has(e.material_id)) : inFamily(e.level_kind, e.level_id)));
  return {
    levels: policies.map((l) => {
      const mine = events.filter((e) => e.level_kind === l.level_kind && e.level_id === l.level_id && e.day > asOf && (e.kind === "TOP_UP" || e.kind === "WAITING"));
      return {
        level_kind: l.level_kind, label: levelName(l.level_kind, l.level_id), members: l.members.filter((m) => memberSet.has(m)).map(input.materialLabel),
        target_days: l.target_days, critical_days: l.critical_days, max_days: l.desired_days,
        cover_days_now: l.cover_days_now, reserve_now: round(l.reserve_now),
        next_min_day: mine[0]?.day ?? null,
      };
    }),
    events: events.map((e) => ({
      day: e.day, kind: e.kind, level_kind: e.level_kind, level: e.kind === "RECEIPT" ? "Pool" : levelName(e.level_kind, e.level_id),
      material: e.material_id ? input.materialLabel(e.material_id) : null, qty: round(e.qty), wanted: round(e.wanted), shortfall: round(e.shortfall),
      pool_before: round(e.pool_before), pool_after: round(e.pool_after), by_material: named(e.by_material), references: [...e.references],
    })),
    matrix: projection.level_matrix.map((snap) => ({
      day: snap.day,
      levels: snap.levels.filter((l) => inFamily(l.level_kind, l.level_id)).map((l) => ({ level: levelName(l.level_kind, l.level_id), by_material: named(l.by_material) })),
      pool: named(snap.pool), closing: named(snap.closing),
    })),
    materials: [...memberSet].map((id) => ({ material: input.materialLabel(id), uom: input.uomOf(id) })),
  };
}
