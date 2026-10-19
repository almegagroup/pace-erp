/*
 * PO22 Phase 3C read-only demand source adapter.
 *
 * This reuses the approved PO21 effective-plan and Requirement explosion
 * functions.  It does not call buildRequirementRows(), allocate material,
 * alter stock, or create a recommendation.
 */
import { buildCalendar, buildToBaseFactors, effectivePlanAt, explodeDemand, type Warning } from "./mts_requirement.logic.ts";
import {
  loadConversions,
  loadFormulationMasters,
  loadMaterialRows,
  loadPlanLines,
  loadStrokeSettings,
  materialInfoMap,
} from "./mts_requirement.handlers.ts";
import { adaptRequirementDemandToOptimizer, type OptimizerDemandAdapterIssue } from "./mts_optimizer_phase3c_demand.logic.ts";
import type { OptimizerDemandSource } from "./mts_optimizer_input.types.ts";
import type { OptimizerGroupMember } from "./mts_optimizer_phase3c.types.ts";

function unique(values: readonly string[]): string[] { return [...new Set(values.filter(Boolean))]; }

export type OptimizerRequirementDemandEvidence = Readonly<{
  company_id: string;
  plan_month: string;
  as_of: string;
  /**
   * customer_plan_line ids of the EFFECTIVE versions only (FINAL over ROLLING,
   * latest version, not cancelled) for CM+NM — the lines demand is built from.
   */
  plan_line_source_ids: readonly string[];
  /** Count of plan-line rows read before effective-version precedence. */
  loaded_plan_line_count: number;
  demand: readonly OptimizerDemandSource[];
  group_members: readonly OptimizerGroupMember[];
  issues: readonly OptimizerDemandAdapterIssue[];
  requirement_warnings: readonly Warning[];
  requirement_exceptions: readonly Warning[];
}>;

/**
 * Loads only verified ERP source fields needed to turn PO21→formulation demand
 * into optimizer evidence.  Caller ACL remains the API handler's obligation;
 * this is a service-reader, not a public endpoint.
 */
export async function readOptimizerRequirementDemandEvidence(
  companyId: string,
  planMonth: string,
  asOf: string,
  demandAt: string | null = null,
): Promise<OptimizerRequirementDemandEvidence> {
  const calendar = buildCalendar(planMonth, asOf);
  if (!calendar) throw new Error("MTS_OPTIMIZER_AS_OF_OUTSIDE_PLAN_MONTH");
  const months = [calendar.cmStart, calendar.nmStart];
  const [planLines, settings] = await Promise.all([
    loadPlanLines(companyId, months),
    loadStrokeSettings(companyId, months),
  ]);
  const periodStrokeIds = [...settings.strokeSettings.values()].flat().map((period) => period.stroke_master_id);
  const masters = await loadFormulationMasters(companyId, periodStrokeIds);
  const skuIds = [...masters.skus.keys()];
  const universe = unique([...masters.materialUniverse, ...skuIds, ...masters.prodshadeIds]);
  const [materialRows, conversions] = await Promise.all([
    loadMaterialRows(universe),
    loadConversions(unique([...masters.materialUniverse, ...skuIds])),
  ]);
  const materials = materialInfoMap(materialRows, conversions);
  for (const [skuId, sku] of masters.skus) {
    const info = materials.get(skuId);
    sku.base_uom_code = info?.base_uom_code ?? "";
    const baseUnit = (info?.base_uom_code ?? "").toUpperCase();
    sku.kg_per_base_unit = !info ? null : baseUnit === "KG" ? 1 : buildToBaseFactors("KG", conversions.get(skuId) ?? [])[baseUnit] ?? null;
  }
  const effective = effectivePlanAt(planLines, demandAt).filter((entry) => months.includes(entry.plan_month));
  const explosion = explodeDemand({
    calendar,
    effective,
    skus: masters.skus,
    currentStrokeByProdshade: masters.currentStrokeByProdshade,
    strokes: masters.strokes,
    strokeSettings: settings.strokeSettings,
    primaryDecisions: settings.primaryDecisions,
    groupMembers: masters.groupMembers,
    packBoms: masters.packBoms,
    materials,
    prodshadeLabels: new Map(masters.prodshadeIds.map((id) => [id, id])),
  });
  const adapted = adaptRequirementDemandToOptimizer(companyId, explosion.records, masters.groupMembers, materials);
  return Object.freeze({
    company_id: companyId,
    plan_month: planMonth,
    as_of: asOf,
    plan_line_source_ids: Object.freeze(unique(effective.flatMap((entry) => (entry.contributors ?? []).map((ref) => ref.source_id ?? ""))).sort()),
    loaded_plan_line_count: planLines.length,
    demand: adapted.demand,
    group_members: adapted.group_members,
    issues: adapted.issues,
    requirement_warnings: Object.freeze([...masters.warnings, ...explosion.warnings]),
    requirement_exceptions: Object.freeze([...explosion.exceptions]),
  });
}
