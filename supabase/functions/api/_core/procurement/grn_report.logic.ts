/*
 * File-Path: supabase/functions/api/_core/procurement/grn_report.logic.ts
 * Purpose: GRN register report -- pure row filter (no DB), unit-tested.
 * Authority: Backend
 */

export type GrnReportRow = {
  id: string;
  status: string;
  material_id: string | null;
  material_type: string | null;
};

export type GrnReportFilters = {
  statuses: string[];
  materialIds: string[];
  materialTypes: string[];
};

// All three filters combine with AND; an empty list means "no restriction". A row whose material is unknown has no
// type, so an Item Type filter never guesses it into a type.
export function filterGrnReportRows<T extends GrnReportRow>(rows: T[], filters: GrnReportFilters): T[] {
  const statuses = new Set(filters.statuses.map((value) => value.toUpperCase()));
  const materialIds = new Set(filters.materialIds);
  const materialTypes = new Set(filters.materialTypes.map((value) => value.toUpperCase()));
  return rows.filter((row) => {
    if (statuses.size > 0 && !statuses.has(String(row.status ?? "").toUpperCase())) return false;
    if (materialIds.size > 0 && !materialIds.has(String(row.material_id ?? ""))) return false;
    if (materialTypes.size > 0 && !materialTypes.has(String(row.material_type ?? "").toUpperCase())) return false;
    return true;
  });
}
