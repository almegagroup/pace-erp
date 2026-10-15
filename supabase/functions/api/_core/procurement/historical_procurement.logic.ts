/* Historical procurement import and lead-time calculations. Reporting only. */

export type LeadTimeKind = "DOMESTIC" | "IMPORT";
export type HistoricalLeadTimeInput = {
  company_id: string;
  vendor_id: string | null;
  material_id: string | null;
  supply_type: string | null;
  order_date: string | null;
  dispatch_date: string | null;
  etd_date: string | null;
  atd_date: string | null;
  ata_port_date: string | null;
  boe_date: string | null;
  lr_date: string | null;
  inward_date: string | null;
  cancellation_flag: boolean;
  validation_status: string;
};

export type LeadTimeMetrics = Record<string, number | null>;

function dateValue(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(result) ? result : null;
}

export function wholeDays(from: string | null, to: string | null): number | null {
  const start = dateValue(from); const end = dateValue(to);
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

export function leadTimeMetrics(row: HistoricalLeadTimeInput): { kind: LeadTimeKind; metrics: LeadTimeMetrics } | null {
  if (row.cancellation_flag || row.validation_status !== "VALIDATED") return null;
  const supply = String(row.supply_type ?? "").toUpperCase();
  if (supply === "LOCAL" || supply === "DOMESTIC") {
    return { kind: "DOMESTIC", metrics: {
      po_to_dispatch_days: wholeDays(row.order_date, row.dispatch_date),
      dispatch_to_inward_days: wholeDays(row.dispatch_date, row.inward_date),
      po_to_inward_days: wholeDays(row.order_date, row.inward_date),
    } };
  }
  if (supply === "IMPORT") {
    return { kind: "IMPORT", metrics: {
      po_to_etd_days: wholeDays(row.order_date, row.etd_date),
      sailing_days: wholeDays(row.atd_date, row.ata_port_date),
      port_clearance_days: wholeDays(row.ata_port_date, row.boe_date),
      inland_transport_days: wholeDays(row.lr_date, row.inward_date),
      po_to_plant_days: wholeDays(row.order_date, row.inward_date),
    } };
  }
  return null;
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function distributionStats(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (valid.length === 0) return { sample_count: 0, average: null, median: null, p80: null, p90: null, variability: null };
  const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance = valid.reduce((sum, value) => sum + ((value - average) ** 2), 0) / valid.length;
  return {
    sample_count: valid.length,
    average: Math.round(average * 1000) / 1000,
    median: percentile(valid, 0.5),
    p80: percentile(valid, 0.8),
    p90: percentile(valid, 0.9),
    variability: Math.round(Math.sqrt(variance) * 1000) / 1000,
  };
}

export function aggregateLeadTimes(rows: HistoricalLeadTimeInput[], groupBy: "COMPANY" | "VENDOR" | "MATERIAL") {
  const groups = new Map<string, { kind: LeadTimeKind; values: Record<string, number[]> }>();
  for (const row of rows) {
    const calculated = leadTimeMetrics(row);
    if (!calculated) continue;
    const key = groupBy === "VENDOR" ? (row.vendor_id || "UNMAPPED_VENDOR") : groupBy === "MATERIAL" ? (row.material_id || "UNMAPPED_MATERIAL") : row.company_id;
    const group = groups.get(key) ?? { kind: calculated.kind, values: {} };
    for (const [metric, value] of Object.entries(calculated.metrics)) {
      if (value !== null) group.values[metric] = [...(group.values[metric] ?? []), value];
    }
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    group_key: key,
    supply_type: group.kind,
    metrics: Object.fromEntries(Object.entries(group.values).map(([metric, values]) => [metric, distributionStats(values)])),
  })).sort((a, b) => a.group_key.localeCompare(b.group_key));
}
