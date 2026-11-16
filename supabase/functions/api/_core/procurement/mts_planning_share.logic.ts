/** Key under which identical, overlapping planning calls share one computation (null = never share: a what-if simulation). */
export type PlanningShareInput = {
  companyId: string; planMonth: string; asOf: string; demandAt: string | null; today: string;
  extraMonths?: number; scheduleChecks?: boolean; reuseLoads?: boolean; arrivalFamilyOf?: string;
  manualLots?: ReadonlyArray<{ material_id: string; plant_eta: string; qty_base: number; vendor_id?: string | null }>;
  rescheduleOverrides?: unknown; policyOverrides?: unknown;
};
export function planningShareKey(p: PlanningShareInput): string | null {
  if (p.rescheduleOverrides || p.policyOverrides || p.arrivalFamilyOf) return null;
  const lots = (p.manualLots ?? []).map((l) => `${l.material_id}:${l.plant_eta}:${l.qty_base}:${l.vendor_id ?? ""}`).sort().join(",");
  return JSON.stringify([p.companyId, p.planMonth, p.asOf, p.demandAt, p.today, p.extraMonths ?? 0, p.scheduleChecks === true, p.reuseLoads === true, lots]);
}
