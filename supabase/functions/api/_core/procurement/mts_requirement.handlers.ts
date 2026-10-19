/*
 * File-Path: supabase/functions/api/_core/procurement/mts_requirement.handlers.ts
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 Requirement (Procurement → MTS Planning → Requirement).
 *   Tab 1 Requirement Report — deterministic RM/PM requirement, stock, inbound,
 *                              coverage and alert fields (business functions of
 *                              the legacy REPORTS_ALL "REQUIREMENT" sheet).
 *   Tab 2 Material Settings  — company-wise Target / Critical coverage days and
 *                              planning MOQ per individual RM/PM material.
 *
 * This file only LOADS source rows (read-only) and resolves labels; every
 * number is computed by mts_requirement.logic.ts (pure, unit-tested).
 * Contract: docs/mts-planning/PO22-REQUIREMENT-CALCULATION-CONTRACT.md
 *
 * Sources (all read-only):
 *   demand        erp_planning.customer_plan_line (PO21, append-only versions)
 *   stroke        erp_production.stroke_master / stroke_line / mts_current_stroke,
 *                 erp_planning.stroke_plan_setting / _period / stroke_group_primary_decision
 *   pack BOM      erp_production.pack_bom / pack_bom_line (ACTIVE, company)
 *   groups        erp_master.material_category_group_member
 *   stock + cons  erp_inventory.get_stock_history (ledger-strict balance at the
 *                 start of the as-of day; CONS bucket P261/P262 for the month)
 *   reservations  erp_production.reservation_document OPEN / PARTIAL
 *   inbound       erp_procurement purchase_order(_line), gate_entry(_line),
 *                 consignment_note, po_lot_balances()
 *   lead time     erp_master lead_time_master_domestic / _import,
 *                 port_plant_transit_master, vendor_material_info,
 *                 received CSNs (PO date → GRN date), public.history_lead_time_samples
 *   policy        erp_planning.material_requirement_policy (Tab 2)
 *
 * ACL (no role checks in code — CLAUDE.md bug patterns #1/#12):
 *   PROC_MTS_REQUIREMENT         VIEW  = both tabs (read)
 *   PROC_MTS_REQUIREMENT_POLICY  WRITE = save Material Settings (companion, no menu row)
 *   Two resources because viewing and changing policy are different actions (pattern #6).
 *   Each handler re-checks the TARGET company's grant (canMaintainCompanyResource).
 *
 * Writes: ONLY erp_planning.material_requirement_policy via its atomic RPC.
 * Never writes stock, reservation, PO, CSN, GRN, production, dispatch or GL.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { leadTimeMetrics } from "./historical_procurement.logic.ts";
import { loadCompanySkus } from "./mts_customer_plan.handlers.ts";
import { normalizePlanMonth, rpcErrorCode } from "./mts_customer_plan.logic.ts";
import {
  buildCalendar,
  buildRequirementRows,
  buildToBaseFactors,
  canonicalJson,
  computeLeadTime,
  type ConfiguredLeadTime,
  consumptionFromConsBucket,
  type GroupMember,
  type InboundEvent,
  isIsoDate,
  type LeadTimeResult,
  type MaterialInfo,
  type PackBomInfo,
  partitionPoLineInbound,
  type PlanLineVersion,
  type PoLineInboundInput,
  type PolicyRow,
  type PrimaryDecision,
  type ReservationRow,
  type SkuInfo,
  type StockRow,
  type StrokeInfo,
  type StrokePeriod,
  toMaterialBase,
  type UomConversion,
  type Warning,
} from "./mts_requirement.logic.ts";

type JsonRecord = Record<string, unknown>;
type ReqHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE_PAGE = "PROC_MTS_REQUIREMENT";
const RESOURCE_POLICY = "PROC_MTS_REQUIREMENT_POLICY";
const OPEN_RESERVATION_STATUSES = ["OPEN", "PARTIAL"];
const OPEN_PO_LINE_STATUSES = ["OPEN", "PARTIALLY_RECEIVED"];
const OPEN_CSN_STATUSES = ["ORD", "TRN"];
const MAX_POLICY_ROWS_PER_SAVE = 2000;
// Stock-history RPC rows = materials × locations × stock types; 40 materials per
// call keeps one call well inside one PostgREST page.
const STOCK_HISTORY_MATERIAL_CHUNK = 40;

const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];

function fail(req: Request, ctx: ReqHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

/** Calendar date in India (business timezone) — used only as the default as-of date. */
export function todayInIndia(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

// Named require*Access so company-scope-write-acl-guard.mjs recognises the
// target-company check inside each handler body.
async function requireRequirementViewAccess(req: Request, ctx: ReqHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_PAGE, "VIEW");
  return allowed ? null : fail(req, ctx, "MTS_REQ_FORBIDDEN", 403, "You do not have access to the MTS Requirement for this company.");
}
async function requireRequirementPolicyAccess(req: Request, ctx: ReqHandlerContext, companyId: string): Promise<Response | null> {
  const allowed = await canMaintainCompanyResource(ctx, companyId, RESOURCE_POLICY, "WRITE");
  return allowed ? null : fail(req, ctx, "MTS_REQ_FORBIDDEN", 403, "You cannot change Material Settings for this company.");
}

async function resolveCompany(ctx: ReqHandlerContext, raw: unknown): Promise<string> {
  const companyId = text(raw);
  if (!companyId) return "";
  await assertCompanyScope(ctx, companyId);
  return companyId;
}

function handleError(req: Request, ctx: ReqHandlerContext, error: unknown, fallbackCode: string, message: string): Response {
  const code = error instanceof Error ? error.message : fallbackCode;
  if (code === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, code, 403, "Company is outside your scope.");
  console.error(`[mts_requirement] ${fallbackCode}`, code);
  return fail(req, ctx, fallbackCode, 500, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaders (read-only)
// ─────────────────────────────────────────────────────────────────────────────
export async function loadMaterialRows(ids: string[]): Promise<Map<string, JsonRecord>> {
  const list = unique(ids);
  if (list.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(list, (chunk) => serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, external_code, document_name, base_uom_code, material_type, status")
    .in("id", chunk));
  return new Map(rows.map((row) => [text(row.id), row]));
}

export async function loadConversions(ids: string[]): Promise<Map<string, UomConversion[]>> {
  const list = unique(ids);
  const rows = list.length === 0 ? [] : await fetchInChunks<JsonRecord>(list, (chunk) => serviceRoleClient
    .schema("erp_master").from("material_uom_conversion")
    .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion, active")
    .in("material_id", chunk));
  const byMaterial = new Map<string, UomConversion[]>();
  for (const row of rows) {
    const key = text(row.material_id);
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), row as unknown as UomConversion]);
  }
  return byMaterial;
}

export type FormulationMasters = {
  skus: Map<string, SkuInfo>;
  ambiguousCount: number;
  strokes: Map<string, StrokeInfo>;
  currentStrokeByProdshade: Map<string, string | null>;
  groupMembers: Map<string, GroupMember[]>;
  packBoms: Map<string, PackBomInfo>;
  materialUniverse: string[];
  prodshadeIds: string[];
  warnings: Warning[];
};

/**
 * Company MTS SKUs, every APPROVED MTS stroke (+ strokes named by Tab 2
 * periods), current strokes, group members and ACTIVE company Pack BOMs. The
 * RM/PM material universe = every material on those strokes / BOMs and their
 * group members (owner: one policy per individual material).
 */
export async function loadFormulationMasters(companyId: string, extraStrokeIds: string[]): Promise<FormulationMasters> {
  const warnings: Warning[] = [];
  const { skus: companySkus, ambiguous } = await loadCompanySkus(companyId);
  const prodshadeIds = unique(companySkus.map((s) => s.prodshade_material_id));
  const skuIds = unique(companySkus.map((s) => s.sku_material_id));

  const [strokeRows, extraStrokeRows, currentRows, bomRows] = await Promise.all([
    prodshadeIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, prodshade_material_id, stroke_number")
      .eq("company_id", companyId).eq("po_type", "MTS").eq("status", "APPROVED")
      .in("prodshade_material_id", chunk)),
    extraStrokeIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(unique(extraStrokeIds), (chunk) => serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, prodshade_material_id, stroke_number")
      .eq("company_id", companyId).in("id", chunk)),
    prodshadeIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("mts_current_stroke")
      .select("prodshade_material_id, stroke_number")
      .eq("company_id", companyId).in("prodshade_material_id", chunk)),
    skuIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(skuIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("pack_bom")
      .select("id, sku_material_id")
      .eq("company_id", companyId).eq("status", "ACTIVE").in("sku_material_id", chunk)),
  ]);

  const strokeById = new Map<string, JsonRecord>();
  for (const row of [...strokeRows, ...extraStrokeRows]) strokeById.set(text(row.id), row);
  const strokeIds = [...strokeById.keys()];
  const bomIds = unique(bomRows.map((b) => text(b.id)));
  const [strokeLines, bomLines] = await Promise.all([
    strokeIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(strokeIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("stroke_line")
      .select("id, stroke_master_id, material_id, alternate_material_id, dosage_pct, material_group_id, default_storage_location_id, display_order")
      .in("stroke_master_id", chunk)),
    bomIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(bomIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("pack_bom_line")
      .select("id, pack_bom_id, line_type, material_id, qty, uom_code, storage_location_id, material_group_id")
      .in("pack_bom_id", chunk)),
  ]);

  const groupIds = unique([...strokeLines, ...bomLines].map((l) => text(l.material_group_id)));
  const memberRows = groupIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
    .schema("erp_master").from("material_category_group_member")
    .select("id, group_id, material_id, active").in("group_id", chunk));
  const groupMembers = new Map<string, GroupMember[]>();
  for (const member of memberRows) {
    const key = text(member.group_id);
    groupMembers.set(key, [...(groupMembers.get(key) ?? []), {
      material_id: text(member.material_id), active: member.active !== false, group_id: key, source_id: text(member.id) || undefined,
    }]);
  }

  const strokes = new Map<string, StrokeInfo>();
  for (const [id, row] of strokeById) {
    strokes.set(id, {
      stroke_master_id: id,
      stroke_number: text(row.stroke_number),
      prodshade_material_id: text(row.prodshade_material_id),
      lines: strokeLines.filter((l) => text(l.stroke_master_id) === id)
        .map((l) => ({
          stroke_line_id: text(l.id),
          material_id: text(l.material_id),
          dosage_pct: num(l.dosage_pct),
          material_group_id: text(l.material_group_id) || null,
          storage_location_id: text(l.default_storage_location_id) || null,
          display_order: Number(l.display_order ?? 0),
        }))
        .sort((a, b) => a.display_order - b.display_order || a.stroke_line_id.localeCompare(b.stroke_line_id)),
    });
  }
  if (strokeLines.some((l) => text(l.alternate_material_id))) {
    warnings.push({ code: "STROKE_DIRECT_ALTERNATE_IGNORED", message: "Some stroke lines carry a direct alternate material (not a material group); planning uses material groups only and ignores the direct alternate." });
  }

  const currentStrokeByProdshade = new Map<string, string | null>();
  for (const pid of prodshadeIds) {
    const number = text(currentRows.find((c) => text(c.prodshade_material_id) === pid)?.stroke_number);
    const match = strokeRows.find((s) => text(s.prodshade_material_id) === pid && text(s.stroke_number) === number);
    currentStrokeByProdshade.set(pid, match ? text(match.id) : null);
  }

  const packBoms = new Map<string, PackBomInfo>();
  for (const bom of bomRows) {
    const id = text(bom.id);
    const lines = bomLines.filter((l) => text(l.pack_bom_id) === id);
    const sfg = lines.find((l) => text(l.line_type) === "SFG");
    const output = lines.find((l) => text(l.line_type) === "OUTPUT");
    packBoms.set(text(bom.sku_material_id), {
      pack_bom_id: id,
      sfg_qty: num(sfg?.qty),
      output_qty: num(output?.qty),
      output_uom_code: text(output?.uom_code) || null,
      inputs: lines.filter((l) => text(l.line_type) === "INPUT").map((l) => ({
        pack_bom_line_id: text(l.id) || undefined,
        material_id: text(l.material_id),
        qty: Number(l.qty ?? 0),
        uom_code: text(l.uom_code),
        storage_location_id: text(l.storage_location_id) || null,
        material_group_id: text(l.material_group_id) || null,
      })).sort((a, b) => a.material_id.localeCompare(b.material_id)),
    });
  }

  const universe = unique([
    ...strokeLines.map((l) => text(l.material_id)),
    ...bomLines.filter((l) => text(l.line_type) === "INPUT").map((l) => text(l.material_id)),
    ...memberRows.filter((m) => m.active !== false).map((m) => text(m.material_id)),
  ]);

  const skus = new Map<string, SkuInfo>();
  for (const sku of companySkus) {
    skus.set(sku.sku_material_id, { sku_material_id: sku.sku_material_id, prodshade_material_id: sku.prodshade_material_id, base_uom_code: "", kg_per_base_unit: null });
  }
  return { skus, ambiguousCount: ambiguous.length, strokes, currentStrokeByProdshade, groupMembers, packBoms, materialUniverse: universe, prodshadeIds, warnings };
}

export async function loadPlanLines(companyId: string, months: string[]): Promise<PlanLineVersion[]> {
  const data = await fetchAllPages(() => serviceRoleClient.schema("erp_planning").from("customer_plan_line")
    .select("id, entry_id, version_no, plan_month, plan_type, urgent_mode, urgent_from_date, urgent_to_date, sku_material_id, base_qty, is_cancelled, created_at")
    .eq("company_id", companyId).in("plan_month", months)
    .order("created_at", { ascending: true }).order("id", { ascending: true }), "MTS_REQ_PLAN_LOAD_FAILED");
  return data.map((row) => ({
    source_id: text(row.id) || undefined,
    entry_id: text(row.entry_id),
    version_no: Number(row.version_no),
    plan_month: text(row.plan_month).slice(0, 10),
    plan_type: text(row.plan_type) as PlanLineVersion["plan_type"],
    urgent_mode: (text(row.urgent_mode) || null) as PlanLineVersion["urgent_mode"],
    urgent_from_date: text(row.urgent_from_date) || null,
    urgent_to_date: text(row.urgent_to_date) || null,
    sku_material_id: text(row.sku_material_id),
    base_qty: Number(row.base_qty ?? 0),
    is_cancelled: row.is_cancelled === true,
    created_at: text(row.created_at),
  }));
}

export async function loadStrokeSettings(companyId: string, months: string[]) {
  const [settings, decisionData] = await Promise.all([
    fetchAllPages(() => serviceRoleClient.schema("erp_planning").from("stroke_plan_setting")
      .select("id, plan_month, prodshade_material_id, version_no, created_at")
      .eq("company_id", companyId).in("plan_month", months).eq("is_current", true).order("id"), "MTS_REQ_STROKE_SETTING_LOAD_FAILED"),
    fetchAllPages(() => serviceRoleClient.schema("erp_planning").from("stroke_group_primary_decision")
      .select("id, stroke_master_id, material_group_id, effective_month, use_primary")
      .eq("company_id", companyId).eq("is_current", true).lte("effective_month", months[months.length - 1]).order("id"), "MTS_REQ_STROKE_SETTING_LOAD_FAILED"),
  ]);
  const periodRows = settings.length === 0 ? [] : await fetchInChunks<JsonRecord>(settings.map((s) => text(s.id)), (chunk) => serviceRoleClient
    .schema("erp_planning").from("stroke_plan_period")
    .select("setting_id, stroke_master_id, period_from, period_to, planned_base_qty, display_order").in("setting_id", chunk));
  const strokeSettings = new Map<string, StrokePeriod[]>();
  for (const setting of settings) {
    const periods = periodRows.filter((p) => text(p.setting_id) === text(setting.id))
      .sort((a, b) => Number(a.display_order) - Number(b.display_order))
      .map((p) => ({
        stroke_master_id: text(p.stroke_master_id),
        period_from: text(p.period_from),
        period_to: text(p.period_to),
        planned_base_qty: num(p.planned_base_qty),
      }));
    strokeSettings.set(`${text(setting.plan_month).slice(0, 10)}|${text(setting.prodshade_material_id)}`, periods);
  }
  const primaryDecisions: PrimaryDecision[] = decisionData.map((d) => ({
    stroke_master_id: text(d.stroke_master_id),
    material_group_id: text(d.material_group_id),
    effective_month: text(d.effective_month).slice(0, 10),
    use_primary: d.use_primary === true,
  }));
  return { strokeSettings, primaryDecisions, settingCount: settings.length };
}

/** Ledger-strict stock at the START of as-of day + net CM consumption to the day before. */
async function loadStockAndConsumption(companyId: string, cmStart: string, asOf: string, materialIds: string[]) {
  const dayBefore = new Date(Date.parse(`${asOf}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rows = materialIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient
    .schema("erp_inventory").rpc("get_stock_history", {
      p_company_id: companyId,
      p_from_date: cmStart,
      p_to_date: dayBefore,
      p_material_type_codes: null,
      p_material_ids: chunk,
      p_storage_location_ids: null,
    }), STOCK_HISTORY_MATERIAL_CHUNK);
  const stock: StockRow[] = [];
  const consumption = new Map<string, number>();
  for (const row of rows) {
    const materialId = text(row.material_id);
    const closing = Number(row.closing ?? 0);
    if (Math.abs(closing) > 0.0000001) {
      stock.push({ material_id: materialId, storage_location_id: text(row.storage_location_id), stock_type_code: text(row.stock_type_code), qty: closing });
    }
    const buckets = (row.buckets ?? {}) as Record<string, number>;
    if (buckets.CONS !== undefined) {
      consumption.set(materialId, (consumption.get(materialId) ?? 0) + consumptionFromConsBucket(buckets.CONS));
    }
  }
  return { stock, consumption };
}

async function loadReservations(companyId: string, materialIds: string[]): Promise<ReservationRow[]> {
  if (materialIds.length === 0) return [];
  const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient
    .schema("erp_production").from("reservation_document")
    .select("material_id, storage_location_id, balance_qty")
    .eq("company_id", companyId).in("status", OPEN_RESERVATION_STATUSES).in("material_id", chunk));
  return rows
    .filter((row) => text(row.storage_location_id))
    .map((row) => ({ material_id: text(row.material_id), storage_location_id: text(row.storage_location_id), qty: Number(row.balance_qty ?? 0) }));
}

type InboundLoad = { events: InboundEvent[]; warnings: Warning[]; poNumbers: number; csnCount: number };

/** Open PO lines of this company → GE / CSN / lot / remainder partition; plus STO CSNs into this company. */
async function loadInbound(companyId: string, asOf: string, materials: Map<string, MaterialInfo>, universe: Set<string>): Promise<InboundLoad> {
  const warnings: Warning[] = [];
  const pos = await fetchAllPages(() => serviceRoleClient.schema("erp_procurement").from("purchase_order")
    .select("id, po_number, po_date, expected_delivery_date, order_in_lot")
    .eq("company_id", companyId).eq("status", "CONFIRMED").order("id"), "MTS_REQ_PO_LOAD_FAILED");
  const poById = new Map(pos.map((p) => [text(p.id), p]));
  const lines = pos.length === 0 ? [] : (await fetchInChunks<JsonRecord>(pos.map((p) => text(p.id)), (chunk) => serviceRoleClient
    .schema("erp_procurement").from("purchase_order_line")
    .select("id, po_id, line_number, material_id, ordered_qty, ordered_qty_base_uom, po_uom_code, open_qty, line_status")
    .in("po_id", chunk).in("line_status", OPEN_PO_LINE_STATUSES)))
    .filter((line) => universe.has(text(line.material_id)));
  const lineIds = lines.map((l) => text(l.id));
  const lotLineIds = lines.filter((l) => poById.get(text(l.po_id))?.order_in_lot === true).map((l) => text(l.id));

  const [geLines, csns, lots, stoCsns] = await Promise.all([
    lineIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(lineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("gate_entry_line")
      .select("po_line_id, ge_qty, uom_code, gate_entry_id, grn_posted")
      .in("po_line_id", chunk).eq("grn_posted", false)),
    lineIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(lineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("consignment_note")
      .select("id, csn_number, status, po_line_id, dispatch_qty, total_received_qty, eta_to_plant_calculated, is_mother_csn, consignee_company_id")
      .in("po_line_id", chunk).in("status", OPEN_CSN_STATUSES)),
    lotLineIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : serviceRoleClient.schema("erp_procurement")
      .rpc("po_lot_balances", { p_po_line_ids: lotLineIds, p_exclude_ge_line_id: null })
      .then(({ data, error }) => { if (error) throw new Error("MTS_REQ_LOT_LOAD_FAILED"); return (data ?? []) as JsonRecord[]; }),
    fetchAllPages(() => serviceRoleClient.schema("erp_procurement").from("consignment_note")
      .select("id, csn_number, status, material_id, dispatch_qty, total_received_qty, po_uom_code, eta_to_plant_calculated, sto_line_id")
      .eq("consignee_company_id", companyId).not("sto_line_id", "is", null).in("status", OPEN_CSN_STATUSES).order("id"), "MTS_REQ_STO_CSN_LOAD_FAILED"),
  ]);
  const geIds = unique(geLines.map((g) => text(g.gate_entry_id)));
  const csnIds = csns.map((c) => text(c.id));
  const [gateHeaders, children] = await Promise.all([
    geIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(geIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("gate_entry").select("id, ge_number, ge_date, status").in("id", chunk)),
    csnIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(csnIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("consignment_note").select("mother_csn_id").in("mother_csn_id", chunk)),
  ]);
  const gateById = new Map(gateHeaders.map((g) => [text(g.id), g]));
  const mothersWithChildren = new Set(children.map((c) => text(c.mother_csn_id)));

  const events: InboundEvent[] = [];
  for (const line of lines) {
    const po = poById.get(text(line.po_id))!;
    const materialId = text(line.material_id);
    const ordered = Number(line.ordered_qty ?? 0);
    const orderedBase = Number(line.ordered_qty_base_uom ?? 0);
    const ratio = ordered > 0 && orderedBase > 0 ? orderedBase / ordered : null;
    const poUom = text(line.po_uom_code).toUpperCase();
    const material = materials.get(materialId);
    const lineCsns = csns.filter((c) => text(c.po_line_id) === text(line.id));
    // Cross-company receipt: the goods land at the consignee, not here.
    const foreign = lineCsns.filter((c) => text(c.consignee_company_id) && text(c.consignee_company_id) !== companyId);
    if (foreign.length > 0) {
      warnings.push({ code: "CRCP_CSN_EXCLUDED", message: `PO ${text(po.po_number)}: ${foreign.length} CSN(s) are consigned to another company and are not counted here.`, material_id: materialId });
    }
    const input: PoLineInboundInput = {
      material_id: materialId,
      po_number: text(po.po_number),
      line_number: Number(line.line_number ?? 0),
      open_qty: Number(line.open_qty ?? 0),
      base_per_po_unit: ratio,
      expected_delivery_date: text(po.expected_delivery_date) || null,
      at_gate: geLines.filter((g) => text(g.po_line_id) === text(line.id)).flatMap((g) => {
        const gate = gateById.get(text(g.gate_entry_id));
        if (!gate || ["PRUNED", "CANCELLED", "GRN_POSTED"].includes(text(gate.status))) return [];
        const unit = text(g.uom_code).toUpperCase();
        const qty = Number(g.ge_qty ?? 0);
        const base = unit === poUom && ratio ? qty * ratio : toMaterialBase(material, qty, unit);
        if (base === null) {
          warnings.push({ code: "GE_UOM_CONVERSION_MISSING", message: `GE ${text(gate.ge_number)}: unit ${unit} has no verified conversion; not counted.`, material_id: materialId });
          return [];
        }
        return [{ qty_base: base, reference: `GE ${text(gate.ge_number)}`, date: text(gate.ge_date) || null }];
      }),
      csns: lineCsns.filter((c) => !foreign.includes(c)).map((c) => ({
        csn_number: text(c.csn_number),
        status: text(c.status),
        dispatch_qty: num(c.dispatch_qty),
        received_qty: num(c.total_received_qty),
        eta: text(c.eta_to_plant_calculated) || null,
        is_mother_with_children: c.is_mother_csn === true && mothersWithChildren.has(text(c.id)),
      })),
      lots: lots.filter((lot) => text(lot.po_line_id) === text(line.id) && !["CANCELLED", "CLOSED"].includes(text(lot.status)))
        .map((lot) => ({ lot_number: text(lot.lot_number), balance_qty: Number(lot.balance_qty ?? 0), delivery_date: text(lot.delivery_date) || null })),
    };
    events.push(...partitionPoLineInbound(input, asOf, warnings));
  }
  for (const csn of stoCsns) {
    const materialId = text(csn.material_id);
    if (!universe.has(materialId)) continue;
    const open = Math.max(0, Number(csn.dispatch_qty ?? 0) - Number(csn.total_received_qty ?? 0));
    if (open <= 0) continue;
    const base = toMaterialBase(materials.get(materialId), open, text(csn.po_uom_code));
    if (base === null) {
      warnings.push({ code: "STO_UOM_CONVERSION_MISSING", message: `STO CSN ${text(csn.csn_number)}: unit ${text(csn.po_uom_code)} has no verified conversion; not counted.`, material_id: materialId });
      continue;
    }
    events.push({
      material_id: materialId, qty: base, date: text(csn.eta_to_plant_calculated) || null, kind: "STO_IN_TRANSIT",
      date_source: text(csn.eta_to_plant_calculated) ? "CSN_ETA_TO_PLANT" : "NONE", reference: `STO CSN ${text(csn.csn_number)} (${text(csn.status)})`,
    });
  }
  return { events, warnings, poNumbers: pos.length, csnCount: csns.length + stoCsns.length };
}

/** Configured vendor transit + observed (ERP received CSNs + imported history) per material. */
async function loadLeadTimes(companyId: string, asOf: string, universe: string[]): Promise<Map<string, LeadTimeResult>> {
  if (universe.length === 0) return new Map();
  const [vmiRows, vendorMapRows, receivedCsns, historyRes] = await Promise.all([
    fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient.schema("erp_master").from("vendor_material_info")
      .select("vendor_id, material_id").eq("status", "ACTIVE").in("material_id", chunk)),
    fetchAllPages(() => serviceRoleClient.schema("erp_master").from("vendor_company_map").select("id, vendor_id").eq("company_id", companyId).eq("active", true).order("id"), "MTS_REQ_VENDOR_MAP_LOAD_FAILED"),
    fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient.schema("erp_procurement").from("consignment_note")
      .select("material_id, po_id, grn_date").eq("company_id", companyId).eq("status", "GRD").not("grn_date", "is", null).in("material_id", chunk)),
    serviceRoleClient.rpc("history_lead_time_samples", { p_company_id: companyId }),
  ]);
  const companyVendors = new Set(vendorMapRows.map((v) => text(v.vendor_id)));
  const vendorsByMaterial = new Map<string, string[]>();
  for (const row of vmiRows) {
    const vendorId = text(row.vendor_id);
    if (!companyVendors.has(vendorId)) continue;
    const key = text(row.material_id);
    vendorsByMaterial.set(key, unique([...(vendorsByMaterial.get(key) ?? []), vendorId]));
  }
  const vendorIds = unique([...vendorsByMaterial.values()].flat());
  const poIds = unique(receivedCsns.map((c) => text(c.po_id)));
  const [vendorRows, domesticRows, importRows, poRows] = await Promise.all([
    vendorIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient.schema("erp_master").from("vendor_master")
      .select("id, vendor_code, vendor_name").in("id", chunk)),
    vendorIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient.schema("erp_master").from("lead_time_master_domestic")
      .select("vendor_id, transit_days, effective_from, effective_to").eq("company_id", companyId).eq("active", true).in("vendor_id", chunk)),
    vendorIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient.schema("erp_master").from("lead_time_master_import")
      .select("vendor_id, port_of_discharge_id, sail_time_days, clearance_days, effective_from, effective_to").eq("active", true).in("vendor_id", chunk)),
    poIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(poIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("purchase_order")
      .select("id, po_date").in("id", chunk)),
  ]);
  const portIds = unique(importRows.map((r) => text(r.port_of_discharge_id)));
  const portRows = portIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(portIds, (chunk) => serviceRoleClient.schema("erp_master").from("port_plant_transit_master")
    .select("port_id, transit_days").eq("company_id", companyId).eq("active", true).in("port_id", chunk));
  const inland = new Map(portRows.map((p) => [text(p.port_id), Number(p.transit_days ?? 0)]));
  const vendorLabel = new Map(vendorRows.map((v) => [text(v.id), [text(v.vendor_code), text(v.vendor_name)].filter(Boolean).join(" — ")]));
  const effectiveOn = (row: JsonRecord) => (!text(row.effective_from) || text(row.effective_from) <= asOf) && (!text(row.effective_to) || text(row.effective_to) >= asOf);

  const poDate = new Map(poRows.map((p) => [text(p.id), text(p.po_date)]));
  const observed = new Map<string, number[]>();
  for (const csn of receivedCsns) {
    const from = poDate.get(text(csn.po_id));
    const to = text(csn.grn_date);
    if (!from || !to || to < from) continue;
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    const key = text(csn.material_id);
    observed.set(key, [...(observed.get(key) ?? []), days]);
  }
  if (!historyRes.error) {
    for (const row of (historyRes.data ?? []) as JsonRecord[]) {
      const materialId = text(row.material_id);
      if (!materialId) continue;
      const metrics = leadTimeMetrics({
        company_id: companyId, vendor_id: text(row.vendor_id) || null, material_id: materialId,
        supply_type: text(row.supply_type) || null, order_date: text(row.order_date) || null,
        dispatch_date: text(row.dispatch_date) || null, etd_date: text(row.etd_date) || null, atd_date: text(row.atd_date) || null,
        ata_port_date: text(row.ata_port_date) || null, boe_date: text(row.boe_date) || null, lr_date: text(row.lr_date) || null,
        inward_date: text(row.inward_date) || null, cancellation_flag: false, validation_status: "VALIDATED",
      });
      const days = metrics?.metrics.po_to_inward_days ?? metrics?.metrics.po_to_plant_days ?? null;
      if (days !== null && days !== undefined) observed.set(materialId, [...(observed.get(materialId) ?? []), days]);
    }
  }

  const result = new Map<string, LeadTimeResult>();
  for (const materialId of universe) {
    const configured: ConfiguredLeadTime[] = [];
    for (const vendorId of vendorsByMaterial.get(materialId) ?? []) {
      const label = vendorLabel.get(vendorId) ?? "—";
      for (const row of domesticRows.filter((r) => text(r.vendor_id) === vendorId && effectiveOn(r))) {
        configured.push({ vendor_label: label, route: "DOMESTIC", days: Number(row.transit_days ?? 0), detail: `transit ${Number(row.transit_days ?? 0)}` });
      }
      for (const row of importRows.filter((r) => text(r.vendor_id) === vendorId && effectiveOn(r))) {
        const sail = Number(row.sail_time_days ?? 0);
        const clearance = Number(row.clearance_days ?? 0);
        const inlandDays = inland.get(text(row.port_of_discharge_id));
        const days = sail + clearance + (inlandDays ?? 0);
        configured.push({ vendor_label: label, route: "IMPORT", days, detail: `sail ${sail} + clearance ${clearance} + inland ${inlandDays ?? "not configured"}` });
      }
    }
    result.set(materialId, computeLeadTime(configured, observed.get(materialId) ?? []));
  }
  return result;
}

async function loadPolicies(companyId: string): Promise<{ policies: PolicyRow[]; raw: JsonRecord[] }> {
  const raw = await fetchAllPages(() => serviceRoleClient.schema("erp_planning").from("material_requirement_policy")
    .select("id, material_id, effective_from, version_no, target_cov_days, critical_cov_days, moq_qty, moq_uom_code, moq_source, moq_active, remarks, source_system, created_by, created_at")
    .eq("company_id", companyId).eq("is_current", true).order("id"), "MTS_REQ_POLICY_LOAD_FAILED");
  return {
    raw,
    policies: raw.map((row) => ({
      material_id: text(row.material_id),
      effective_from: text(row.effective_from),
      target_cov_days: num(row.target_cov_days),
      critical_cov_days: num(row.critical_cov_days),
      moq_qty: num(row.moq_qty),
      moq_uom_code: text(row.moq_uom_code) || null,
      moq_source: (text(row.moq_source) || "NONE") as PolicyRow["moq_source"],
      moq_active: row.moq_active === true,
      version_no: Number(row.version_no ?? 1),
    })),
  };
}

export function materialInfoMap(rows: Map<string, JsonRecord>, conversions: Map<string, UomConversion[]>): Map<string, MaterialInfo> {
  const result = new Map<string, MaterialInfo>();
  for (const [id, row] of rows) {
    const base = text(row.base_uom_code);
    result.set(id, {
      material_id: id,
      material_type: text(row.material_type),
      base_uom_code: base,
      status: text(row.status) || null,
      to_base_factors: buildToBaseFactors(base, conversions.get(id) ?? []),
    });
  }
  return result;
}

async function loadLocationLabels(ids: string[]): Promise<Map<string, string>> {
  const list = unique(ids);
  if (list.length === 0) return new Map();
  const rows = await fetchInChunks<JsonRecord>(list, (chunk) => serviceRoleClient.schema("erp_inventory").from("storage_location_master")
    .select("id, code, name").in("id", chunk));
  return new Map(rows.map((row) => [text(row.id), text(row.code) || text(row.name) || "—"]));
}

/**
 * Reads every row of a non-id-list query page by page (PostgREST caps one
 * response at its max-rows setting, so a single .range() could silently
 * truncate as data grows — CLAUDE.md §8E family). `build` must return a fresh
 * query with a stable ORDER BY each call.
 */
async function fetchAllPages(build: () => unknown, errorCode: string): Promise<JsonRecord[]> {
  const pageSize = 1000;
  const rows: JsonRecord[] = [];
  for (let from = 0; ; from += pageSize) {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (build() as any).range(from, from + pageSize - 1);
    if (error) throw new Error(errorCode);
    const page = (data ?? []) as JsonRecord[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/procurement/mts-requirement/access
// ─────────────────────────────────────────────────────────────────────────────
export async function getMtsRequirementAccessHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const companyId = await resolveCompany(ctx, new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const canEditPolicy = await canMaintainCompanyResource(ctx, companyId, RESOURCE_POLICY, "WRITE");
    return okResponse({ company_id: companyId, can_view: true, can_edit_policy: canEditPolicy, today: todayInIndia() }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_ACCESS_FAILED", "Could not resolve MTS Requirement access.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/procurement/mts-requirement/report?company_id&plan_month=YYYY-MM&as_of=YYYY-MM-DD[&demand_at=ISO]
// ─────────────────────────────────────────────────────────────────────────────
export async function getMtsRequirementReportHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const planMonth = normalizePlanMonth(url.searchParams.get("plan_month"));
    if (!planMonth) return fail(req, ctx, "MTS_REQ_INVALID_MONTH", 400, "plan_month must be YYYY-MM.");
    const today = todayInIndia();
    const asOf = text(url.searchParams.get("as_of")) || today;
    if (!isIsoDate(asOf)) return fail(req, ctx, "MTS_REQ_INVALID_AS_OF", 400, "as_of must be YYYY-MM-DD.");
    if (asOf > today) return fail(req, ctx, "MTS_REQ_AS_OF_FUTURE", 400, "As-of date cannot be in the future: stock is read from the posted ledger.");
    const calendar = buildCalendar(planMonth, asOf);
    if (!calendar) return fail(req, ctx, "MTS_REQ_AS_OF_OUTSIDE_MONTH", 400, "As-of date must lie inside the selected plan month.");
    const demandAtRaw = text(url.searchParams.get("demand_at"));
    const demandAt = demandAtRaw && Number.isFinite(Date.parse(demandAtRaw)) ? new Date(demandAtRaw).toISOString() : null;
    if (demandAtRaw && !demandAt) return fail(req, ctx, "MTS_REQ_INVALID_DEMAND_AT", 400, "demand_at must be an ISO date-time.");
    const months = [calendar.cmStart, calendar.nmStart];

    const [planLines, settings, policyLoad] = await Promise.all([
      loadPlanLines(companyId, months),
      loadStrokeSettings(companyId, months),
      loadPolicies(companyId),
    ]);
    const periodStrokeIds = [...settings.strokeSettings.values()].flat().map((p) => p.stroke_master_id);
    const masters = await loadFormulationMasters(companyId, periodStrokeIds);
    const universe = unique([...masters.materialUniverse, ...policyLoad.policies.map((p) => p.material_id)]);
    const skuIds = [...masters.skus.keys()];
    const [materialRows, conversions] = await Promise.all([
      loadMaterialRows([...universe, ...skuIds, ...masters.prodshadeIds]),
      loadConversions([...universe, ...skuIds]),
    ]);
    const materials = materialInfoMap(materialRows, conversions);
    for (const [skuId, sku] of masters.skus) {
      const info = materials.get(skuId);
      sku.base_uom_code = info?.base_uom_code ?? "";
      // KG per one SKU base unit: 1 for KG, else a fixed master conversion to KG (never guessed).
      const baseUnit = (info?.base_uom_code ?? "").toUpperCase();
      sku.kg_per_base_unit = !info ? null : baseUnit === "KG" ? 1 : buildToBaseFactors("KG", conversions.get(skuId) ?? [])[baseUnit] ?? null;
    }
    const universeSet = new Set(universe);
    const applyReservations = asOf >= today;
    const [stockLoad, reservations, inbound, leadTimes] = await Promise.all([
      loadStockAndConsumption(companyId, calendar.cmStart, asOf, universe),
      applyReservations ? loadReservations(companyId, universe) : Promise.resolve([] as ReservationRow[]),
      loadInbound(companyId, asOf, materials, universeSet),
      loadLeadTimes(companyId, asOf, universe),
    ]);

    const prodshadeLabels = new Map(masters.prodshadeIds.map((pid) => [pid, text(materialRows.get(pid)?.material_name) || pid]));
    const input = {
      calendar,
      skus: masters.skus,
      currentStrokeByProdshade: masters.currentStrokeByProdshade,
      strokes: masters.strokes,
      strokeSettings: settings.strokeSettings,
      primaryDecisions: settings.primaryDecisions,
      groupMembers: masters.groupMembers,
      packBoms: masters.packBoms,
      materials,
      prodshadeLabels,
      planLines,
      demandAt,
      stockRows: stockLoad.stock,
      reservations,
      applyReservations,
      consumptionByMaterial: stockLoad.consumption,
      inboundEvents: inbound.events,
      policies: policyLoad.policies,
      leadTimes,
      materialUniverse: universe.filter((id) => ["RM", "PM"].includes(materials.get(id)?.material_type ?? "")),
    };
    const output = buildRequirementRows(input);
    const fingerprint = await sha256Hex(canonicalJson({ ...input, prodshadeLabels: null }));

    // Labels (R-01: never show raw ids).
    const locationIds = unique(output.rows.flatMap((row) => [
      ...row.stock.required_locations, ...row.stock.other_locations, ...row.pools.map((p) => p.storage_location_id),
    ]));
    const groupIds = unique(output.rows.flatMap((row) => row.pools.map((p) => p.group_id)));
    const [locationLabels, groupRows, policyUsers] = await Promise.all([
      loadLocationLabels(locationIds),
      groupIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
      resolveUserDisplayNames(policyLoad.raw.map((r) => text(r.created_by))),
    ]);
    const groupLabel = new Map(groupRows.map((g) => [text(g.id), [text(g.group_code), text(g.group_name)].filter(Boolean).join(" — ")]));
    const nameOf = (id: string) => text(materialRows.get(id)?.material_name) || "—";
    const strokeLabel = (id: string) => {
      const stroke = masters.strokes.get(id);
      return stroke ? `${nameOf(stroke.prodshade_material_id)} · Stroke ${stroke.stroke_number}` : "—";
    };
    const loc = (id: string | null) => (id ? locationLabels.get(id) ?? "—" : "—");

    const rows = output.rows.map((row) => {
      const material = materialRows.get(row.material_id);
      const policyRaw = row.policy
        ? policyLoad.raw.find((r) => text(r.material_id) === row.material_id && text(r.effective_from) === row.policy!.effective_from)
        : undefined;
      return {
        material_id: row.material_id,
        material_code: text(material?.pace_code) || null,
        material_name: text(material?.material_name) || "—",
        external_code: text(material?.external_code) || null,
        material_type: row.kind,
        base_uom_code: text(material?.base_uom_code) || null,
        ...row.metrics,
        stock_unrestricted_at_required: row.stock.unrestricted_at_required,
        stock_reserved_at_required: row.stock.reserved_at_required,
        stock_other_sloc: row.stock.other_sloc_unrestricted,
        stock_qa: row.stock.quality_inspection,
        stock_blocked: row.stock.blocked,
        stock_other_types: row.stock.other_stock_types,
        required_locations: row.stock.required_locations.map(loc),
        other_locations: row.stock.other_locations.map(loc),
        intransit_total: row.inbound.total,
        from_stock_qty: row.from_stock_qty,
        lead_time_effective: row.lead_time?.effective ?? null,
        lead_time_source: row.lead_time?.effective_source ?? "UNKNOWN",
        lead_time_configured_min: row.lead_time?.configured_min ?? null,
        lead_time_configured_max: row.lead_time?.configured_max ?? null,
        lead_time_observed_avg: row.lead_time?.observed_avg ?? null,
        lead_time_observed_max: row.lead_time?.observed_max ?? null,
        lead_time_observed_p90: row.lead_time?.observed_p90 ?? null,
        lead_time_observed_count: row.lead_time?.observed_count ?? 0,
        lead_time_routes: row.lead_time?.configured_routes ?? [],
        moq_qty: row.policy?.moq_qty ?? null,
        moq_uom_code: row.policy?.moq_uom_code ?? null,
        moq_source: row.policy?.moq_source ?? null,
        moq_active: row.policy?.moq_active ?? null,
        policy_effective_from: row.policy?.effective_from ?? null,
        policy_version_no: row.policy?.version_no ?? null,
        policy_source_system: text(policyRaw?.source_system) || null,
        policy_updated_by: policyRaw ? policyUsers.get(text(policyRaw.created_by)) ?? "—" : null,
        policy_updated_at: policyRaw?.created_at ?? null,
        inbound_events: row.inbound_events.map((e) => ({ qty: e.qty, date: e.date, kind: e.kind, date_source: e.date_source, reference: e.reference })),
        pools: row.pools.map((p) => ({
          kind: p.kind,
          group_label: p.group_id ? groupLabel.get(p.group_id) ?? "—" : null,
          use_primary: p.use_primary,
          candidates: p.candidates.map(nameOf),
          procurement_target: nameOf(p.candidates[0]),
          required_location: loc(p.storage_location_id),
          pool_total: p.pool_total,
          this_material_qty: p.this_material_qty,
          prodshades: p.prodshade_ids.map(nameOf),
          skus: p.sku_ids.map(nameOf),
          strokes: p.stroke_ids.map(strokeLabel),
          pack_bom_count: p.pack_bom_ids.length,
          outer_qty: p.outer_qty,
          outer_uom_code: p.outer_uom_code,
          fill_qty_per_outer: p.fill_qty_per_outer,
        })),
      };
    }).sort((a, b) => a.material_type.localeCompare(b.material_type) || a.material_name.localeCompare(b.material_name));

    const labelWarning = (w: Warning) => ({
      code: w.code,
      message: w.message,
      material: w.material_id ? nameOf(w.material_id) : null,
      sku: w.sku_material_id ? nameOf(w.sku_material_id) : null,
      prodshade: w.prodshade_material_id ? nameOf(w.prodshade_material_id) : null,
    });
    const notes: Warning[] = [];
    if (!applyReservations) {
      notes.push({ code: "RESERVATIONS_NOT_APPLIED", message: "As-of date is in the past: current open reservations are a present-day state and are not subtracted from historical stock." });
    }
    if (masters.ambiguousCount > 0) {
      notes.push({ code: "AMBIGUOUS_SKUS", message: `${masters.ambiguousCount} Prodshade/pack combination(s) match more than one SKU by name and are excluded (same rule as PO21).` });
    }
    notes.push({ code: "CROSS_COMPANY_ALLOCATION_NOT_AVAILABLE", message: "No cross-company production allocation is stored in PO21 yet; all demand is exploded with this company's Stroke and Pack BOM." });

    return okResponse({
      company_id: companyId,
      calendar: {
        as_of: calendar.asOf, cm_start: calendar.cmStart, cm_end: calendar.cmEnd, nm_start: calendar.nmStart, nm_end: calendar.nmEnd,
        cm_days_in_month: calendar.cmDaysInMonth, cm_days_left: calendar.cmDaysLeft, nm_days_in_month: calendar.nmDaysInMonth,
      },
      demand_version: { demand_at: demandAt, label: demandAt ? `Plan as at ${demandAt}` : "Current effective plan" },
      provenance: {
        calculated_at: new Date().toISOString(),
        source_fingerprint: fingerprint,
        plan_line_versions: planLines.length,
        stroke_settings: settings.settingCount,
        open_purchase_orders: inbound.poNumbers,
        open_csns: inbound.csnCount,
        reservations_applied: applyReservations,
        stock_basis: "Posted stock ledger balance at the start of the as-of day (erp_inventory.get_stock_history).",
        consumption_basis: "Net P261 − P262 posted from the plan-month start to the day before the as-of date.",
      },
      rows,
      exceptions: output.exceptions.map(labelWarning),
      warnings: [...notes, ...masters.warnings, ...output.warnings, ...inbound.warnings].map(labelWarning),
    }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_REPORT_FAILED", "Could not calculate the MTS Requirement.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/procurement/mts-requirement/policies?company_id[&as_of]
// One row per individual RM/PM material of the company's MTS strokes / Pack BOMs.
// ─────────────────────────────────────────────────────────────────────────────
export async function getMtsRequirementPoliciesHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const asOf = text(url.searchParams.get("as_of")) || todayInIndia();
    if (!isIsoDate(asOf)) return fail(req, ctx, "MTS_REQ_INVALID_AS_OF", 400, "as_of must be YYYY-MM-DD.");

    const [masters, policyLoad, canEdit] = await Promise.all([
      loadFormulationMasters(companyId, []),
      loadPolicies(companyId),
      canMaintainCompanyResource(ctx, companyId, RESOURCE_POLICY, "WRITE"),
    ]);
    const universe = unique([...masters.materialUniverse, ...policyLoad.policies.map((p) => p.material_id)]);
    const [materialRows, conversions, leadTimes] = await Promise.all([
      loadMaterialRows(universe),
      loadConversions(universe),
      loadLeadTimes(companyId, asOf, universe),
    ]);
    const users = await resolveUserDisplayNames(policyLoad.raw.map((r) => text(r.created_by)));
    const rows = universe
      .filter((id) => ["RM", "PM"].includes(text(materialRows.get(id)?.material_type)))
      .map((id) => {
        const material = materialRows.get(id)!;
        const all = policyLoad.raw.filter((r) => text(r.material_id) === id).sort((a, b) => text(b.effective_from).localeCompare(text(a.effective_from)));
        const current = all.find((r) => text(r.effective_from) <= asOf) ?? null;
        const future = all.filter((r) => text(r.effective_from) > asOf);
        const lead = leadTimes.get(id) ?? null;
        const base = text(material.base_uom_code);
        return {
          material_id: id,
          material_code: text(material.pace_code) || null,
          material_name: text(material.material_name) || "—",
          material_type: text(material.material_type),
          base_uom_code: base || null,
          moq_uom_options: [base, ...Object.keys(buildToBaseFactors(base, conversions.get(id) ?? []))].filter(Boolean),
          in_current_masters: masters.materialUniverse.includes(id),
          policy: current ? {
            effective_from: text(current.effective_from),
            version_no: Number(current.version_no),
            target_cov_days: num(current.target_cov_days),
            critical_cov_days: num(current.critical_cov_days),
            moq_qty: num(current.moq_qty),
            moq_uom_code: text(current.moq_uom_code) || null,
            moq_source: text(current.moq_source) || "NONE",
            moq_active: current.moq_active === true,
            remarks: text(current.remarks) || null,
            source_system: text(current.source_system),
            updated_by: users.get(text(current.created_by)) ?? "—",
            updated_at: current.created_at,
          } : null,
          future_policies: future.map((f) => ({ effective_from: text(f.effective_from), target_cov_days: num(f.target_cov_days), critical_cov_days: num(f.critical_cov_days) })),
          lead_time_effective: lead?.effective ?? null,
          lead_time_source: lead?.effective_source ?? "UNKNOWN",
          lead_time_configured_max: lead?.configured_max ?? null,
          lead_time_observed_max: lead?.observed_max ?? null,
          lead_time_observed_count: lead?.observed_count ?? 0,
        };
      })
      .sort((a, b) => a.material_type.localeCompare(b.material_type) || a.material_name.localeCompare(b.material_name));
    return okResponse({ company_id: companyId, as_of: asOf, can_edit: canEdit, rows }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_POLICY_LIST_FAILED", "Could not load Material Settings.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/procurement/mts-requirement/policy-history?company_id&material_id
// ─────────────────────────────────────────────────────────────────────────────
export async function getMtsRequirementPolicyHistoryHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const materialId = text(url.searchParams.get("material_id"));
    if (!materialId) return fail(req, ctx, "MTS_REQ_INVALID_INPUT", 400, "material_id is required.");
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("material_requirement_policy")
      .select("effective_from, version_no, is_current, target_cov_days, critical_cov_days, moq_qty, moq_uom_code, moq_source, moq_active, remarks, source_system, created_by, created_at")
      .eq("company_id", companyId).eq("material_id", materialId)
      .order("created_at", { ascending: false }).range(0, 999);
    if (error) throw new Error("MTS_REQ_POLICY_HISTORY_FAILED");
    const rows = (data ?? []) as JsonRecord[];
    const users = await resolveUserDisplayNames(rows.map((r) => text(r.created_by)));
    return okResponse({
      rows: rows.map((r) => ({
        effective_from: text(r.effective_from),
        version_no: Number(r.version_no),
        status: r.is_current === true ? "Current" : "Superseded",
        target_cov_days: num(r.target_cov_days),
        critical_cov_days: num(r.critical_cov_days),
        moq_qty: num(r.moq_qty),
        moq_uom_code: text(r.moq_uom_code) || null,
        moq_source: text(r.moq_source),
        moq_active: r.moq_active === true,
        remarks: text(r.remarks) || null,
        source_system: text(r.source_system),
        updated_by: users.get(text(r.created_by)) ?? "—",
        updated_at: r.created_at,
      })),
    }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_POLICY_HISTORY_FAILED", "Could not load policy history.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/procurement/mts-requirement/policies
// body: { company_id, source_system?: "ERP_ENTRY" | "LEGACY_GOOGLE_SHEETS", rows: [...] }
// ─────────────────────────────────────────────────────────────────────────────
export async function saveMtsRequirementPoliciesHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = await resolveCompany(ctx, body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const sourceSystem = text(body.source_system) || "ERP_ENTRY";
    if (!["ERP_ENTRY", "LEGACY_GOOGLE_SHEETS"].includes(sourceSystem)) return fail(req, ctx, "MTS_REQ_POLICY_INVALID_INPUT", 400, "source_system is invalid.");
    const raw = Array.isArray(body.rows) ? body.rows as JsonRecord[] : [];
    if (raw.length === 0) return fail(req, ctx, "MTS_REQ_POLICY_NO_ROWS", 400, "Nothing to save.");
    if (raw.length > MAX_POLICY_ROWS_PER_SAVE) return fail(req, ctx, "MTS_REQ_POLICY_TOO_MANY_ROWS", 400, `At most ${MAX_POLICY_ROWS_PER_SAVE} rows per save.`);

    // A policy may only be saved for a material of this company's MTS strokes / Pack BOMs
    // (or one that already has a policy here) — never for an unrelated material.
    const [masters, policyLoad] = await Promise.all([loadFormulationMasters(companyId, []), loadPolicies(companyId)]);
    const allowed = new Set([...masters.materialUniverse, ...policyLoad.policies.map((p) => p.material_id)]);
    const rows = [];
    for (const row of raw) {
      const materialId = text(row.material_id);
      const effectiveFrom = text(row.effective_from);
      if (!materialId || !allowed.has(materialId)) {
        return fail(req, ctx, "MTS_REQ_POLICY_MATERIAL_NOT_IN_COMPANY", 400, "A material on this save is not used by this company's MTS Strokes / Pack BOMs.");
      }
      if (!isIsoDate(effectiveFrom)) return fail(req, ctx, "MTS_REQ_POLICY_INVALID_INPUT", 400, "Every row needs a valid Effective From date (YYYY-MM-DD).");
      const numericFields = ["target_cov_days", "critical_cov_days", "moq_qty"] as const;
      for (const field of numericFields) {
        if (row[field] !== null && row[field] !== undefined && row[field] !== "" && num(row[field]) === null) {
          return fail(req, ctx, "MTS_REQ_POLICY_INVALID_INPUT", 400, `${field} must be a number.`);
        }
      }
      rows.push({
        material_id: materialId,
        effective_from: effectiveFrom,
        target_cov_days: num(row.target_cov_days),
        critical_cov_days: num(row.critical_cov_days),
        moq_qty: num(row.moq_qty),
        moq_uom_code: text(row.moq_uom_code) || null,
        moq_source: text(row.moq_source).toUpperCase() || "NONE",
        moq_active: row.moq_active === true,
        remarks: text(row.remarks) || null,
        source_ref: row.source_ref && typeof row.source_ref === "object" ? row.source_ref : null,
      });
    }
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_material_requirement_policies", {
      p_company_id: companyId,
      p_actor: ctx.auth_user_id,
      p_rows: rows,
      p_source_system: sourceSystem,
    });
    if (error) {
      const code = rpcErrorCode(error.message) ?? (/MTS_REQ_POLICY_[A-Z_]+/.exec(String(error.message))?.[0] ?? null);
      if (code) return fail(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_REQ_POLICY_[A-Z_]+|PLANNING_APPEND_ONLY):\s*/, ""));
      throw new Error("MTS_REQ_POLICY_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_REQ_POLICY_SAVE_FAILED", "Could not save Material Settings.");
  }
}
