/*
 * File-Path: supabase/functions/api/_core/procurement/mts_customer_plan.logic.ts
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: Pure (database-free) rules for the MTS Customer Plan page, kept
 *          separate from the handlers so they are unit-tested directly
 *          (mts_customer_plan.logic.test.ts). Owner decisions:
 *          docs/mts-planning/DECISION-REGISTER.md (agent/chatgpt 31dbfee).
 * Authority: Backend
 */

export const PLAN_TYPES = ["ROLLING", "FINAL", "ADDITIONAL", "URGENT"] as const;
export type PlanType = typeof PLAN_TYPES[number];

// Rolling / Final are the "base" plan (full-access users only);
// Additional / Urgent are add-on entries (also Stores, Logistics, Plant Head).
export const BASE_PLAN_TYPES: PlanType[] = ["ROLLING", "FINAL"];
export const ADDON_PLAN_TYPES: PlanType[] = ["ADDITIONAL", "URGENT"];
export const URGENT_MODES = ["FROM_PLAN", "EXTRA"] as const;
export type UrgentMode = typeof URGENT_MODES[number];

// Report selections are capped so one request stays one bounded query.
export const MAX_REPORT_MONTHS = 60;

const QTY_DECIMALS = 6;

export function roundQty(value: number): number {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function isPlanType(value: unknown): value is PlanType {
  return typeof value === "string" && (PLAN_TYPES as readonly string[]).includes(value);
}

/** "2026-11" or "2026-11-01" (any day) → "2026-11-01"; anything else → null. */
export function normalizePlanMonth(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  if (match[3]) {
    const day = Number(match[3]);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > last) return null;
  }
  return `${match[1]}-${match[2]}-01`;
}

/** "YYYY-MM,YYYY-MM,..." → unique, chronologically sorted month starts. */
export function parseMonthList(raw: unknown): { months: string[]; invalid: string[] } {
  const parts = String(raw ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const months = new Set<string>();
  const invalid: string[] = [];
  for (const part of parts) {
    const month = normalizePlanMonth(part);
    if (month) months.add(month);
    else invalid.push(part);
  }
  return { months: [...months].sort(), invalid };
}

/** Strict ISO calendar date (YYYY-MM-DD) or null. */
export function normalizeIsoDate(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export type UomConversionRow = {
  from_uom_code: string;
  to_uom_code: string;
  conversion_factor: number | null;
  variable_conversion: boolean | null;
  active: boolean | null;
};

export type EntryUomOption = {
  uom_code: string;
  factor_to_base: number;
  source: "BASE" | "STANDARD_MT_KG" | "MATERIAL_CONVERSION";
};

/**
 * Units a user may type a plan quantity in for one SKU. Never invents a
 * factor: base unit (×1); MT only when the base unit is KG (owner rule:
 * 1 MT = 1000 KG); otherwise only the SKU's own ACTIVE, fixed (non-variable)
 * material_uom_conversion rows that convert straight into the base unit.
 */
export function buildEntryUomOptions(baseUomCode: string, conversions: UomConversionRow[]): EntryUomOption[] {
  const base = String(baseUomCode ?? "").trim().toUpperCase();
  if (!base) return [];
  const options = new Map<string, EntryUomOption>();
  options.set(base, { uom_code: base, factor_to_base: 1, source: "BASE" });
  if (base === "KG") options.set("MT", { uom_code: "MT", factor_to_base: 1000, source: "STANDARD_MT_KG" });
  for (const row of conversions) {
    const from = String(row.from_uom_code ?? "").trim().toUpperCase();
    const to = String(row.to_uom_code ?? "").trim().toUpperCase();
    const factor = Number(row.conversion_factor);
    if (row.active === false || row.variable_conversion === true) continue;
    if (!from || to !== base || from === base || options.has(from)) continue;
    if (!Number.isFinite(factor) || factor <= 0) continue;
    options.set(from, { uom_code: from, factor_to_base: factor, source: "MATERIAL_CONVERSION" });
  }
  return [...options.values()];
}

/** Entered quantity → base quantity, or null when the unit is not allowed for this SKU. */
export function toBaseQty(enteredQty: number, uomCode: string, options: EntryUomOption[]): number | null {
  const unit = String(uomCode ?? "").trim().toUpperCase();
  const option = options.find((entry) => entry.uom_code === unit);
  if (!option || !Number.isFinite(enteredQty) || enteredQty < 0) return null;
  return roundQty(enteredQty * option.factor_to_base);
}

export type PlanLineInput = {
  entry_id?: unknown;
  sku_material_id?: unknown;
  entered_qty?: unknown;
  urgent_mode?: unknown;
  urgent_from_date?: unknown;
  urgent_to_date?: unknown;
  remarks?: unknown;
  cancel?: unknown;
};

export type NormalizedPlanLine = {
  entry_id: string | null;
  sku_material_id: string;
  entered_qty: number | null;
  urgent_mode: UrgentMode | null;
  urgent_from_date: string | null;
  urgent_to_date: string | null;
  remarks: string | null;
  cancel: boolean;
};

/**
 * Shape-level validation of one submitted line (the RPC re-validates
 * company/SKU/base-unit/overdraw rules inside its transaction).
 */
export function normalizePlanLine(planType: PlanType, input: PlanLineInput): { line?: NormalizedPlanLine; error?: string } {
  const sku = String(input.sku_material_id ?? "").trim();
  if (!sku) return { error: "MTS_PLAN_SKU_REQUIRED" };
  const cancel = input.cancel === true;
  const entryId = String(input.entry_id ?? "").trim() || null;
  const remarksRaw = String(input.remarks ?? "").trim();
  const remarks = remarksRaw ? remarksRaw.slice(0, 500) : null;

  if (cancel) {
    if (ADDON_PLAN_TYPES.includes(planType) && !entryId) return { error: "MTS_PLAN_ENTRY_REQUIRED_FOR_CANCEL" };
    return {
      line: {
        entry_id: entryId, sku_material_id: sku, entered_qty: null,
        urgent_mode: null, urgent_from_date: null, urgent_to_date: null, remarks, cancel: true,
      },
    };
  }

  const qtyRaw = input.entered_qty;
  if (qtyRaw === null || qtyRaw === undefined || String(qtyRaw).trim() === "") return { error: "MTS_PLAN_QTY_REQUIRED" };
  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty < 0) return { error: "MTS_PLAN_QTY_INVALID" };

  let urgentMode: UrgentMode | null = null;
  let from: string | null = null;
  let to: string | null = null;
  if (planType === "URGENT") {
    const mode = String(input.urgent_mode ?? "").trim().toUpperCase();
    if (!(URGENT_MODES as readonly string[]).includes(mode)) return { error: "MTS_PLAN_URGENT_MODE_REQUIRED" };
    urgentMode = mode as UrgentMode;
    from = normalizeIsoDate(input.urgent_from_date);
    to = normalizeIsoDate(input.urgent_to_date);
    if (!from || !to) return { error: "MTS_PLAN_URGENT_PERIOD_REQUIRED" };
    if (from > to) return { error: "MTS_PLAN_URGENT_PERIOD_INVALID" };
  }

  return {
    line: {
      entry_id: BASE_PLAN_TYPES.includes(planType) ? null : entryId,
      sku_material_id: sku,
      entered_qty: qty,
      urgent_mode: urgentMode,
      urgent_from_date: from,
      urgent_to_date: to,
      remarks,
      cancel: false,
    },
  };
}

export type EffectiveRow = {
  plan_month: string;
  sku_material_id: string;
  effective_qty: number | null;
  base_source: string | null;
  has_legacy_source: boolean | null;
};

export type ReportCell = { qty: number | null; base_source: string | null; legacy: boolean };

/**
 * Pivot effective monthly demand into one PLAN row per SKU with one cell per
 * selected month. A month with no plan stays null (blank), never 0.
 */
export function pivotPlanReport(
  skuIds: string[],
  months: string[],
  effectiveRows: EffectiveRow[],
): Map<string, Record<string, ReportCell>> {
  const byKey = new Map<string, EffectiveRow>();
  for (const row of effectiveRows) byKey.set(`${row.sku_material_id}|${String(row.plan_month).slice(0, 10)}`, row);
  const result = new Map<string, Record<string, ReportCell>>();
  for (const skuId of skuIds) {
    const cells: Record<string, ReportCell> = {};
    for (const month of months) {
      const row = byKey.get(`${skuId}|${month}`);
      cells[month] = {
        qty: row && row.effective_qty !== null && row.effective_qty !== undefined ? roundQty(Number(row.effective_qty)) : null,
        base_source: row?.base_source ?? null,
        legacy: row?.has_legacy_source === true,
      };
    }
    result.set(skuId, cells);
  }
  return result;
}

/** Map an RPC exception message ("MTS_PLAN_X: detail") to its code. */
export function rpcErrorCode(message: unknown): string | null {
  const match = /\b(MTS_PLAN_[A-Z_]+|PLANNING_APPEND_ONLY)\b/.exec(String(message ?? ""));
  return match ? match[1] : null;
}
