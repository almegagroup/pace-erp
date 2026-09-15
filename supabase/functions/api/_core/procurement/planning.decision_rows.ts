/*
 * PO11 server-authoritative decision-row builder.
 *
 * This module owns the dashboard/report decision grain: one visible
 * standalone material or one visible Planning Item Group.  It deliberately
 * consumes the material rows already calculated by planning.handlers.ts;
 * stock loading and standalone calculations do not live here.
 */

import type {
  PlanningGroupConfig,
  PlanningWorkspaceRow,
} from "./planning.handlers.ts";

export type ProcurementPlanningStatusTone = "NORMAL" | "WARNING" | "CRITICAL";

export type ProcurementPlanningDecisionType =
  | "ITEM_GROUP"
  | "STANDALONE_MATERIAL";

export type ProcurementPlanningDecisionRow = {
  decision_type: ProcurementPlanningDecisionType;
  /**
   * ITEM_GROUP: stable planning_item_group.id.
   * STANDALONE_MATERIAL: material:<material-id>::sloc_group:<sloc-group-id|none>.
   */
  decision_key: string;
  /** Internal dashboard parity aid; the Communication adapter never exposes it. */
  member_count: number;
  planning_item_group_id: string | null;
  material_id: string | null;
  material_type: string;
  material_code: string;
  material_name: string;
  group_name: string;
  source_sloc_group_id: string | null;
  source_sloc_group_name: string;
  monthly_requirement_qty: number;
  safety_days: number;
  processing_time_days: number;
  lead_time_days: number;
  fixed_safety_stock_qty: number | null;
  fixed_replenishment_stock_qty: number | null;
  derived_safety_stock_qty: number;
  derived_replenishment_stock_qty: number;
  effective_safety_stock_qty: number;
  effective_replenishment_stock_qty: number;
  available_stock_qty: number;
  trn_stock_qty: number;
  ge_stock_qty: number;
  qa_stock_qty: number;
  status_tone: ProcurementPlanningStatusTone;
  base_uom_code: string;
};

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeQty(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number((Number.isFinite(parsed) ? parsed : 0).toFixed(6));
}

function getDaysInMonth(planMonth: string): number {
  const date = new Date(`${planMonth}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? 0
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
      .getUTCDate();
}

/**
 * PO11 shortage semantics: only planning-usable Available stock participates
 * in the threshold comparison.  TRN, Gate Entry, and QA stay informational.
 */
export function getProcurementPlanningStatusTone(
  availableStockQty: number,
  effectiveSafetyStockQty: number,
  effectiveReplenishmentStockQty: number,
): ProcurementPlanningStatusTone {
  if (
    effectiveSafetyStockQty > 0 && availableStockQty <= effectiveSafetyStockQty
  ) {
    return "CRITICAL";
  }
  if (
    effectiveReplenishmentStockQty > 0 &&
    availableStockQty <= effectiveReplenishmentStockQty
  ) {
    return "WARNING";
  }
  return "NORMAL";
}

function sumRows(
  rows: readonly PlanningWorkspaceRow[],
  key: keyof PlanningWorkspaceRow,
): number {
  return normalizeQty(
    rows.reduce((sum, row) => sum + normalizeQty(row[key]), 0),
  );
}

function averageRows(
  rows: readonly PlanningWorkspaceRow[],
  key: keyof PlanningWorkspaceRow,
): number {
  if (rows.length === 0) return 0;
  return normalizeQty(sumRows(rows, key) / rows.length);
}

function aggregateFixedOverride(
  rows: readonly PlanningWorkspaceRow[],
  key: "fixed_safety_stock_qty" | "fixed_replenishment_stock_qty",
): number | null {
  const rowsWithOverride = rows.filter((row) => row[key] !== null);
  if (rowsWithOverride.length === 0) return null;
  return normalizeQty(
    rowsWithOverride.reduce((sum, row) => sum + normalizeQty(row[key]), 0),
  );
}

function resolveSharedValue(
  rows: readonly PlanningWorkspaceRow[],
  key: "material_type" | "base_uom_code" | "source_sloc_group_id",
): string | null {
  const values = [
    ...new Set(rows.map((row) => toTrimmedString(row[key])).filter(Boolean)),
  ].sort();
  if (values.length === 0) return key === "source_sloc_group_id" ? null : "";
  return values.length === 1 ? values[0] : "MIXED";
}

function resolveGroupScopeName(rows: readonly PlanningWorkspaceRow[]): string {
  const names = [
    ...new Set(
      rows.map((row) => toTrimmedString(row.source_sloc_group_name)).filter(
        Boolean,
      ),
    ),
  ].sort();
  return names.join(", ") || "Mixed scope";
}

function buildStandaloneDecisionRow(
  row: PlanningWorkspaceRow,
): ProcurementPlanningDecisionRow {
  const sourceSlocGroupId = row.source_sloc_group_id || null;
  return {
    decision_type: "STANDALONE_MATERIAL",
    decision_key: `material:${row.material_id}::sloc_group:${
      sourceSlocGroupId || "none"
    }`,
    member_count: 1,
    planning_item_group_id: null,
    material_id: row.material_id,
    material_type: toTrimmedString(row.material_type),
    material_code: toTrimmedString(row.material_code),
    material_name: toTrimmedString(row.material_name),
    group_name: "",
    source_sloc_group_id: sourceSlocGroupId,
    source_sloc_group_name: toTrimmedString(row.source_sloc_group_name),
    monthly_requirement_qty: normalizeQty(row.monthly_requirement_qty),
    safety_days: normalizeQty(row.safety_days),
    processing_time_days: normalizeQty(row.processing_time_days),
    lead_time_days: normalizeQty(row.lead_time_days),
    fixed_safety_stock_qty: row.fixed_safety_stock_qty,
    fixed_replenishment_stock_qty: row.fixed_replenishment_stock_qty,
    derived_safety_stock_qty: normalizeQty(row.derived_safety_stock_qty),
    derived_replenishment_stock_qty: normalizeQty(
      row.derived_replenishment_stock_qty,
    ),
    effective_safety_stock_qty: normalizeQty(row.effective_safety_stock_qty),
    effective_replenishment_stock_qty: normalizeQty(
      row.effective_replenishment_stock_qty,
    ),
    available_stock_qty: normalizeQty(row.available_stock_qty),
    trn_stock_qty: normalizeQty(row.trn_stock_qty),
    ge_stock_qty: normalizeQty(row.ge_stock_qty),
    qa_stock_qty: normalizeQty(row.qa_stock_qty),
    status_tone: row.status_tone,
    base_uom_code: toTrimmedString(row.base_uom_code),
  };
}

function buildItemGroupDecisionRow(
  planningItemGroupId: string,
  rows: readonly PlanningWorkspaceRow[],
  groupConfig: PlanningGroupConfig | null,
  planMonth: string,
): ProcurementPlanningDecisionRow {
  const memberRequirementQty = sumRows(rows, "monthly_requirement_qty");
  const monthlyRequirementQty = memberRequirementQty > 0
    ? memberRequirementQty
    : normalizeQty(groupConfig?.monthly_requirement_qty);
  const safetyDays = averageRows(rows, "safety_days");
  const processingTimeDays = averageRows(rows, "processing_time_days");
  const leadTimeDays = averageRows(rows, "lead_time_days");
  const dailyRequirement = getDaysInMonth(planMonth) > 0
    ? monthlyRequirementQty / getDaysInMonth(planMonth)
    : 0;
  const derivedSafetyStockQty = normalizeQty(dailyRequirement * safetyDays);
  const derivedReplenishmentStockQty = normalizeQty(
    derivedSafetyStockQty +
      (dailyRequirement * (processingTimeDays + leadTimeDays)),
  );
  const fixedSafetyStockQty = aggregateFixedOverride(
    rows,
    "fixed_safety_stock_qty",
  );
  const fixedReplenishmentStockQty = aggregateFixedOverride(
    rows,
    "fixed_replenishment_stock_qty",
  );
  const effectiveSafetyStockQty = normalizeQty(
    fixedSafetyStockQty ?? derivedSafetyStockQty,
  );
  const effectiveReplenishmentStockQty = normalizeQty(
    fixedReplenishmentStockQty ?? derivedReplenishmentStockQty,
  );
  const availableStockQty = sumRows(rows, "available_stock_qty");
  const sourceSlocGroupId = resolveSharedValue(rows, "source_sloc_group_id");
  const materialType = resolveSharedValue(rows, "material_type") || "";
  const baseUomCode = resolveSharedValue(rows, "base_uom_code") || "";
  const sortedRows = [...rows].sort((left, right) =>
    toTrimmedString(left.material_name).localeCompare(
      toTrimmedString(right.material_name),
    )
  );

  return {
    decision_type: "ITEM_GROUP",
    decision_key: planningItemGroupId,
    member_count: rows.length,
    planning_item_group_id: planningItemGroupId,
    material_id: null,
    material_type: materialType,
    material_code: "",
    material_name: "",
    group_name: toTrimmedString(sortedRows[0]?.planning_item_group_name),
    source_sloc_group_id: sourceSlocGroupId === "MIXED"
      ? null
      : sourceSlocGroupId,
    source_sloc_group_name: resolveGroupScopeName(rows),
    monthly_requirement_qty: monthlyRequirementQty,
    safety_days: safetyDays,
    processing_time_days: processingTimeDays,
    lead_time_days: leadTimeDays,
    fixed_safety_stock_qty: fixedSafetyStockQty,
    fixed_replenishment_stock_qty: fixedReplenishmentStockQty,
    derived_safety_stock_qty: derivedSafetyStockQty,
    derived_replenishment_stock_qty: derivedReplenishmentStockQty,
    effective_safety_stock_qty: effectiveSafetyStockQty,
    effective_replenishment_stock_qty: effectiveReplenishmentStockQty,
    available_stock_qty: availableStockQty,
    trn_stock_qty: sumRows(rows, "trn_stock_qty"),
    ge_stock_qty: sumRows(rows, "ge_stock_qty"),
    qa_stock_qty: sumRows(rows, "qa_stock_qty"),
    status_tone: getProcurementPlanningStatusTone(
      availableStockQty,
      effectiveSafetyStockQty,
      effectiveReplenishmentStockQty,
    ),
    base_uom_code: baseUomCode,
  };
}

/**
 * Produces PO11's visible decision grain without reading or writing storage.
 * Excluded materials and group-member detail rows are intentionally omitted.
 */
export function buildProcurementPlanningDecisionRows(input: {
  rows: readonly PlanningWorkspaceRow[];
  group_configs: readonly PlanningGroupConfig[];
  plan_month: string;
}): readonly ProcurementPlanningDecisionRow[] {
  const groupedRows = new Map<string, PlanningWorkspaceRow[]>();
  const standaloneRows: PlanningWorkspaceRow[] = [];
  for (const row of input.rows) {
    if (row.excluded_from_dashboard) continue;
    const planningItemGroupId = toTrimmedString(row.planning_item_group_id);
    if (!planningItemGroupId) {
      standaloneRows.push(row);
      continue;
    }
    const bucket = groupedRows.get(planningItemGroupId) ?? [];
    bucket.push(row);
    groupedRows.set(planningItemGroupId, bucket);
  }

  const configByGroupId = new Map(
    input.group_configs.map((
      config,
    ) => [config.planning_item_group_id, config]),
  );
  const decisions: Array<
    { sort_key: string; row: ProcurementPlanningDecisionRow }
  > = [];
  for (const [planningItemGroupId, members] of groupedRows) {
    const sortedMembers = [...members].sort((left, right) =>
      toTrimmedString(left.material_name).localeCompare(
        toTrimmedString(right.material_name),
      )
    );
    decisions.push({
      sort_key: toTrimmedString(sortedMembers[0]?.material_name),
      row: buildItemGroupDecisionRow(
        planningItemGroupId,
        sortedMembers,
        configByGroupId.get(planningItemGroupId) ?? null,
        input.plan_month,
      ),
    });
  }
  for (const row of standaloneRows) {
    decisions.push({
      sort_key: toTrimmedString(row.material_name),
      row: buildStandaloneDecisionRow(row),
    });
  }

  return decisions
    .sort((left, right) => left.sort_key.localeCompare(right.sort_key))
    .map((entry) => entry.row);
}
