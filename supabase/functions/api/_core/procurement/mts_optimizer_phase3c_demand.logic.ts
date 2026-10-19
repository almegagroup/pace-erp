/*
 * PO22 Phase 3C — adapter from the approved Requirement explosion to
 * optimizer demand evidence.  It is deliberately pure: database extraction
 * remains in the existing Requirement loaders and no allocation is performed
 * here.  Missing immutable identities or UOM proof fail closed.
 */
import type { DemandRecord, GroupMember, MaterialInfo } from "./mts_requirement.logic.ts";
import type { OptimizerDemandSource } from "./mts_optimizer_input.types.ts";
import type { OptimizerGroupMember } from "./mts_optimizer_phase3c.types.ts";

export type OptimizerDemandAdapterIssue = Readonly<{
  code:
    | "DEMAND_SOURCE_ID_MISSING"
    | "FIXED_MATERIAL_UOM_MISSING"
    | "GROUP_MEMBER_ID_MISSING"
    | "GROUP_MEMBER_GROUP_MISMATCH"
    | "GROUP_MEMBER_UOM_MISMATCH"
    | "GROUP_MEMBER_MISSING";
  demand_source_key: string | null;
  source_line_id: string | null;
  message: string;
}>;

export type OptimizerDemandAdapterResult = Readonly<{
  demand: readonly OptimizerDemandSource[];
  group_members: readonly OptimizerGroupMember[];
  issues: readonly OptimizerDemandAdapterIssue[];
}>;

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) freeze(item);
  return value;
}
function keyFor(companyId: string, record: DemandRecord, sourceLineId: string): string {
  // The key is a deterministic tuple of immutable source identities.  It is
  // never a material-derived default, and is distinct for each daily demand.
  return ["requirement", companyId, record.day, record.kind, sourceLineId,
    record.prodshade_material_id, record.sku_material_id ?? "-", record.stroke_master_id ?? record.pack_bom_id ?? "-"].join(":");
}
function lineId(record: DemandRecord): string | null {
  return record.kind === "RM" ? record.stroke_line_id : record.pack_bom_line_id;
}
function groupPool(record: DemandRecord): boolean {
  // RM retains the approved Use Primary=Yes primary material behaviour.  Only
  // Use Primary=No becomes a material-null group pool.  PM grouped inputs do
  // not have a Use Primary decision and are represented as their true group.
  return !!record.group_id && (record.kind === "PM" || record.use_primary === false);
}
function materialEvidence(material: MaterialInfo | undefined) {
  if (!material?.base_uom_code) return null;
  return freeze({ base_uom_code: material.base_uom_code, to_base_factors: { ...material.to_base_factors }, source: "erp_master.material_master/material_uom_conversion" });
}

/**
 * Converts Requirement explosion records only when their actual source lines,
 * group memberships and base-UOM evidence are present.  GROUP_POOL demand
 * remains material-null; it is never assigned to a sorted or primary member.
 */
export function adaptRequirementDemandToOptimizer(
  companyId: string,
  records: readonly DemandRecord[],
  groupMembers: ReadonlyMap<string, readonly GroupMember[]>,
  materials: ReadonlyMap<string, MaterialInfo>,
): OptimizerDemandAdapterResult {
  const demand: OptimizerDemandSource[] = [];
  const members: OptimizerGroupMember[] = [];
  const issues: OptimizerDemandAdapterIssue[] = [];
  const addIssue = (code: OptimizerDemandAdapterIssue["code"], demand_source_key: string | null, source_line_id: string | null, message: string) =>
    issues.push(freeze({ code, demand_source_key, source_line_id, message }));

  for (const record of [...records].sort((a, b) => a.day.localeCompare(b.day) || a.sort_key.localeCompare(b.sort_key))) {
    const sourceLineId = lineId(record);
    if (!sourceLineId) {
      addIssue("DEMAND_SOURCE_ID_MISSING", null, null, "Demand record has no immutable Stroke Line or Pack BOM INPUT-line identity.");
      continue;
    }
    const sourceKey = keyFor(companyId, record, sourceLineId);
    if (!groupPool(record)) {
      const materialId = record.candidates[0] ?? null;
      const evidence = materialId ? materialEvidence(materials.get(materialId)) : null;
      if (!materialId || !evidence) {
        addIssue("FIXED_MATERIAL_UOM_MISSING", sourceKey, sourceLineId, "Fixed demand lacks a material identity with verified base-UOM evidence.");
        continue;
      }
      demand.push(freeze({
        source_key: sourceKey, company_id: companyId, product_id: record.prodshade_material_id,
        source_line_id: sourceLineId, required_by: record.day, demand_kind: "FIXED_EXCLUSIVE",
        group_id: null, material_id: materialId, uom_evidence: null, qty: record.qty, uom_code: evidence.base_uom_code,
      }));
      continue;
    }

    const groupId = record.group_id!;
    const primaryEvidence = materialEvidence(materials.get(record.candidates[0] ?? ""));
    const active = (groupMembers.get(groupId) ?? []).filter((member) => member.active);
    if (active.length === 0) {
      addIssue("GROUP_MEMBER_MISSING", sourceKey, sourceLineId, "Group-pool demand has no active verified group members.");
      continue;
    }
    if (!primaryEvidence) {
      addIssue("FIXED_MATERIAL_UOM_MISSING", sourceKey, sourceLineId, "Group-pool demand has no verified source-material UOM evidence.");
      continue;
    }
    let valid = true;
    for (const member of active) {
      if (member.group_id !== groupId) {
        addIssue("GROUP_MEMBER_GROUP_MISMATCH", sourceKey, sourceLineId, "Group member evidence belongs to a different actual group and was rejected.");
        valid = false;
      } else if (!member.source_id) {
        addIssue("GROUP_MEMBER_ID_MISSING", sourceKey, sourceLineId, "Group member lacks its immutable membership-row identity.");
        valid = false;
      } else if (materials.get(member.material_id)?.base_uom_code !== primaryEvidence.base_uom_code) {
        addIssue("GROUP_MEMBER_UOM_MISMATCH", sourceKey, sourceLineId, "Active group member has a different base UOM; no conversion was invented.");
        valid = false;
      }
    }
    if (!valid) continue;
    demand.push(freeze({
      source_key: sourceKey, company_id: companyId, product_id: record.prodshade_material_id,
      source_line_id: sourceLineId, required_by: record.day, demand_kind: "GROUP_POOL",
      group_id: groupId, material_id: null, uom_evidence: primaryEvidence, qty: record.qty, uom_code: primaryEvidence.base_uom_code,
    }));
    for (const member of active) members.push(freeze({
      demand_source_key: sourceKey, group_id: groupId, material_id: member.material_id,
      active: true, source_key: member.source_id!,
    }));
  }
  return freeze({
    demand: demand.sort((a, b) => a.source_key.localeCompare(b.source_key)),
    group_members: members.sort((a, b) => a.demand_source_key.localeCompare(b.demand_source_key) || a.source_key.localeCompare(b.source_key)),
    issues: issues.sort((a, b) => `${a.demand_source_key ?? ""}|${a.code}`.localeCompare(`${b.demand_source_key ?? ""}|${b.code}`)),
  });
}
