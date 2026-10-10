/*
 * File-Path: supabase/functions/api/_core/procurement/ac01.handlers.ts
 * Domain: PROCUREMENT / ACCOUNTS
 * Purpose: AC01 GRN Landed Cost Hub — redesigned Invoice Verifications page.
 *          Row = one GRN. List/get for the ErpDenseGrid + center DrawerBase
 *          frontend, and a thin save wrapper around the single atomic RPC
 *          erp_procurement.save_ac01_grn_cost (CLAUDE.md §8D — this handler
 *          never writes goods_receipt/landed_cost/*_line tables directly,
 *          only via that RPC).
 * Authority: Backend
 * Locked design: see feasibility doc's AC01 discovery session + this
 *          project's memory file project_accounts_returns_sales_redesign.md.
 *          Claude direct-implemented (business owner directive 2026-08-21).
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";
import { cascadeRecalculate } from "./opening_stock.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

// Database reads can contain a nullable relation FK (for example a direct GRN
// with no gate-entry line). Never turn that missing UUID into the literal
// string "null": PostgREST would pass it to `uuid = any(...)` and reject the
// complete AC01 list request with 22P02.
function toRelationId(value: unknown): string {
  const id = toTrimmedString(value);
  return id && id.toLowerCase() !== "null" && id.toLowerCase() !== "undefined"
    ? id
    : "";
}

function uniqueRelationIds(values: unknown[]): string[] {
  return [...new Set(values.map(toRelationId).filter(Boolean))];
}

// A CRCP receipt's ITC owner is the Bill-To company, even before an AC01
// user creates a landed_cost header.  The first implementation of the AC01
// mirror queried only landed_cost.itc_owner_company_id, which created a
// circular dependency: Bill-To could not see a newly received CRCP GRN in
// AC01 until somebody had already opened it and created its landed-cost
// header.  Resolve the owner from the PO/STO itself so the read model begins
// at GRN creation and every later QA, payment, freight, and landed-cost
// update is naturally reflected by the ordinary AC01 re-fetch.
async function getCrcpMirrorOwnerByGrnId(
  billToCompanyId: string,
): Promise<Map<string, string>> {
  const [poResponse, stoResponse] = await Promise.all([
    serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .select("id")
      .eq("company_id", billToCompanyId)
      .eq("crcp_enabled", true),
    serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id")
      .eq("receiving_company_id", billToCompanyId)
      .eq("crcp_enabled", true),
  ]);

  if (poResponse.error || stoResponse.error) {
    throw new Error("AC01_CRCP_OWNER_SOURCE_FETCH_FAILED");
  }

  const poIds = uniqueRelationIds(((poResponse.data ?? []) as JsonRecord[]).map((row) => row.id));
  const stoIds = uniqueRelationIds(((stoResponse.data ?? []) as JsonRecord[]).map((row) => row.id));
  const [poGrns, stoGrns] = await Promise.all([
    fetchInChunks<JsonRecord>(poIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .select("id").in("po_id", chunk)),
    fetchInChunks<JsonRecord>(stoIds, (chunk) =>
      serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .select("id").in("sto_id", chunk)),
  ]);

  return new Map(
    uniqueRelationIds([...poGrns, ...stoGrns].map((row) => row.id))
      .map((grnId) => [grnId, billToCompanyId]),
  );
}

// Single-GRN counterpart used by the drawer access check.  This is kept
// independent of landed_cost so a Bill-To user can open the initial read-only
// mirror before any landed-cost, freight, or other AC01 record exists.
async function getCrcpMirrorOwnerForGrn(grn: JsonRecord): Promise<string | null> {
  const [poResponse, stoResponse] = await Promise.all([
    grn.po_id
      ? serviceRoleClient.schema("erp_procurement").from("purchase_order")
        .select("company_id, crcp_enabled").eq("id", String(grn.po_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    grn.sto_id
      ? serviceRoleClient.schema("erp_procurement").from("stock_transfer_order")
        .select("receiving_company_id, crcp_enabled").eq("id", String(grn.sto_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (poResponse.error || stoResponse.error) {
    throw new Error("AC01_CRCP_OWNER_SOURCE_FETCH_FAILED");
  }

  const po = poResponse.data as JsonRecord | null;
  const sto = stoResponse.data as JsonRecord | null;
  if (po?.crcp_enabled === true) return toRelationId(po.company_id) || null;
  if (sto?.crcp_enabled === true) return toRelationId(sto.receiving_company_id) || null;
  return null;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function addDays(input: string, days: number): string {
  const date = new Date(`${input}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// An invoice-later Bulk GRN can be commercially confirmed from Invoice
// Mapping before an Accounts user opens AC01. The mapping stores both the
// invoice rate and the confirmation flag. Prefer the explicit confirmed rate,
// then this proven mapping value (which also repairs old mapped rows), then
// the original GRN rate.
function effectiveCommercialRate(grn: JsonRecord): number {
  if (grn.confirmed_rate != null) return Number(grn.confirmed_rate);
  if (grn.rate_confirmed === true && grn.invoice_rate != null) return Number(grn.invoice_rate);
  return grn.grn_rate != null ? Number(grn.grn_rate) : 0;
}

function gstStateCode(gstNumber: unknown): string {
  const code = toTrimmedString(gstNumber).slice(0, 2);
  return /^\d{2}$/.test(code) ? code : "";
}

// Material GST must be visible separately from landed-cost GST. The split is
// only derived where both registered GSTIN state codes are present; guessing
// CGST/SGST versus IGST from an incomplete master would create a false tax
// record, so such receipts retain the total GST with an UNDETERMINED split.
function computeMaterialTaxBreakup(
  taxableValue: number,
  gstPct: number,
  vendor: JsonRecord | undefined,
  company: JsonRecord | undefined,
): { gstType: "CGST_SGST" | "IGST" | "UNDETERMINED"; gstAmount: number; cgstAmount: number | null; sgstAmount: number | null; igstAmount: number | null } {
  const gstAmount = Number((taxableValue * gstPct / 100).toFixed(4));
  if (gstAmount === 0) return { gstType: "UNDETERMINED", gstAmount, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 };
  const vendorState = gstStateCode(vendor?.gst_number);
  const companyState = gstStateCode(company?.gst_number);
  if (!vendorState || !companyState) return { gstType: "UNDETERMINED", gstAmount, cgstAmount: null, sgstAmount: null, igstAmount: null };
  if (vendorState === companyState) {
    const cgstAmount = Number((gstAmount / 2).toFixed(4));
    return { gstType: "CGST_SGST", gstAmount, cgstAmount, sgstAmount: Number((gstAmount - cgstAmount).toFixed(4)), igstAmount: 0 };
  }
  return { gstType: "IGST", gstAmount, cgstAmount: 0, sgstAmount: 0, igstAmount: gstAmount };
}

// Ported from csn.handlers.ts's enrichTrackerRows() -- same calculation, same
// reference_date_type codes. Found live 2026-08-21: this was wrongly marked
// "deferred until AC02's Vendor Ledger exists" -- that deferral only applies
// to the TRUE fact of when payment was actually recorded as paid; the DUE
// DATE calculated from the PO's payment terms needs no such ledger and this
// exact logic already exists and works elsewhere in the codebase. A payment
// term with no reference_date_type_id (Advance-type terms) correctly returns
// null here, same as CSN Tracker's own blank/"-" display for Advance.
function computeActualPaymentDate(
  grn: JsonRecord,
  referenceCode: string,
  creditDays: number,
): string | null {
  if (!referenceCode) return null;
  const anchor = (() => {
    switch (referenceCode) {
      case "BL_DATE":
        return toTrimmedString(grn.bl_date) || toTrimmedString(grn.lr_date);
      case "LR_DATE":
        return toTrimmedString(grn.lr_date);
      case "GRN_DATE":
        return toTrimmedString(grn.grn_date);
      case "INVOICE_DATE":
        return toTrimmedString(grn.invoice_date);
      // ADVANCE has no anchor by definition -- paid upfront, before any of
      // GRN/invoice/BL/LR dates exist to count credit days from. Confirmed
      // live 2026-08-21: 2 of 30 real prod GRNs carry this reference_date_
      // types code; falling through to null here is exactly the "-" display
      // the business owner asked for (Q3), not an oversight.
      case "ADVANCE":
      default:
        // MANUAL / ATA_AT_PORT / POST_CLEARANCE_LR_DATE also have no
        // equivalent anchor date on goods_receipt -- not computable, user
        // must set Revised Payment Date manually for these terms.
        return "";
    }
  })();
  return anchor ? addDays(anchor, creditDays) : null;
}

// Mirrors save_ac01_grn_cost()'s own Base-UoM landed-cost-per-unit formula
// exactly (migration 20260821090000's save_ac01_grn_cost RPC) -- "Landed
// Cost is always computed on Base UoM, never Purchase/Pack UoM" (locked
// 2026-08-21). The RPC computes this at save time but never persists it
// (landed_cost has no such column), so both list and detail reads must
// recompute it the same way. Found live 2026-08-22: buildListRow's own
// cost_per_unit used a naive effectiveRate + landedCostTotal/receivedQty --
// a latent bug (currently masked because every real GRN has per_pack_qty
// NULL, so the Base-UoM conversion is a no-op today) -- and getAC01GRNHandler
// never computed this field at all, so the drawer's Summary section had no
// per-unit landed price to show, only the total.
// Considered Qty (business owner, 2026-08-26) -- both this and
// computeSuggestedPayables below divide/multiply by grn.considered_qty, not
// grn.received_qty. Considered Qty is always prefilled from Invoice Qty
// (ge_qty) at GRN creation and user-editable in the AC01 drawer thereafter;
// received_qty (actual physical stock) is never touched by any of this.
function computeLandedCostPerUnit(grn: JsonRecord, landedCostTotal: number): number {
  const effectiveRate = effectiveCommercialRate(grn);
  const consideredQty = grn.considered_qty != null ? Number(grn.considered_qty) : Number(grn.received_qty ?? 0);
  const perPackQty = grn.per_pack_qty != null ? Number(grn.per_pack_qty) : null;
  const hasPackConversion = perPackQty != null && perPackQty > 0;
  const baseUomRate = hasPackConversion ? effectiveRate / perPackQty : effectiveRate;
  const consideredQtyBase = hasPackConversion ? consideredQty * perPackQty : consideredQty;
  return consideredQtyBase > 0 ? baseUomRate + landedCostTotal / consideredQtyBase : baseUomRate;
}

// Mirrors save_ac01_grn_cost()'s own per-party suggested-payable math exactly
// (migration 20260822100000) -- the RPC only returns this on SAVE, so GET
// (viewing an already-saved GRN without triggering a write) needs the same
// computation done read-side, from the already-fetched cost/deduction lines.
//
// GROSS-of-GST, not net -- found live 2026-08-22 (business owner): the
// amount actually owed to a party is GST-inclusive (GST is still paid to
// the party, only later claimed back via ITC -- a separate ledger entry,
// not a netting against what's owed). This is deliberately the OPPOSITE
// basis from Landed Cost/WAR (net-of-GST, unchanged, computed elsewhere) --
// EXCLUSIVE lines get GST added on top for Payable; INCLUSIVE lines already
// carry it, no change; the vendor's own base material cost also gets
// grn.gst_pct applied, which the original version never did at all.
//
// 'NONE' party (e.g. Duty, paid straight to the government) contributes to
// Landed Cost but is deliberately excluded from every party bucket here --
// nothing is owed to any of the four tracked parties for it.
function computeSuggestedPayables(
  grn: JsonRecord,
  costLines: JsonRecord[],
  deductionLines: JsonRecord[],
): { vendor: number; transporter: number; lastMile: number; cha: number } {
  const effectiveRate = effectiveCommercialRate(grn);
  // Considered Qty (business owner, 2026-08-26), not received_qty -- see
  // computeLandedCostPerUnit's comment above.
  const consideredQty = grn.considered_qty != null ? Number(grn.considered_qty) : Number(grn.received_qty ?? 0);
  const purchaseCost = effectiveRate * consideredQty;
  const materialGstPct = grn.gst_pct != null ? Number(grn.gst_pct) : 0;
  const purchaseCostGross = purchaseCost * (1 + materialGstPct / 100);
  // PER_UOM lines store a rate, not a total -- mirrors save_ac01_grn_cost()'s
  // own v_considered_qty_base multiplication (migration 20260826100000). Found
  // live 2026-08-22: a real prod GRN (2000000030) saved a PER_UOM line whose
  // amount was never multiplied by qty anywhere -- this read-side mirror
  // must apply the same Base-UoM qty the RPC uses, or GET/LIST would show a
  // different Suggested Payable than what SAVE just computed and returned.
  const perPackQty = grn.per_pack_qty != null ? Number(grn.per_pack_qty) : null;
  const consideredQtyBase = perPackQty != null && perPackQty > 0
    ? consideredQty * perPackQty
    : consideredQty;

  const charges = { VENDOR: 0, TRANSPORTER: 0, LAST_MILE_TRANSPORTER: 0, CHA: 0 } as Record<string, number>;
  for (const line of costLines) {
    let gross = Number(line.amount ?? 0);
    if (line.entry_mode === "PER_UOM") gross = gross * consideredQtyBase;
    const gstRate = line.gst_rate != null ? Number(line.gst_rate) : 0;
    if (line.has_gst === true && gstRate > 0) {
      if (line.gst_treatment === "EXCLUSIVE") gross = gross * (1 + gstRate / 100);
      // INCLUSIVE: already gross, no change.
    }
    const party = toTrimmedString(line.party_type) || "VENDOR";
    if (party === "NONE") continue;
    charges[party] = (charges[party] ?? 0) + gross;
  }

  const deductions = { VENDOR: 0, TRANSPORTER: 0, LAST_MILE_TRANSPORTER: 0, CHA: 0 } as Record<string, number>;
  for (const line of deductionLines) {
    if (line.amount == null) continue;
    const amount = Number(line.amount) + Number(line.round_off ?? 0);
    const party = toTrimmedString(line.party_type) || "VENDOR";
    if (party === "NONE") continue;
    deductions[party] = (deductions[party] ?? 0) + amount;
  }

  return {
    vendor: Number((purchaseCostGross + charges.VENDOR - deductions.VENDOR).toFixed(4)),
    transporter: Number((charges.TRANSPORTER - deductions.TRANSPORTER).toFixed(4)),
    lastMile: Number((charges.LAST_MILE_TRANSPORTER - deductions.LAST_MILE_TRANSPORTER).toFixed(4)),
    cha: Number((charges.CHA - deductions.CHA).toFixed(4)),
  };
}

// Canonical display order for the dynamic per-component columns -- same
// value order as AC01Page.jsx's DUTY_LINE_TYPES + CHARGE_COST_TYPES +
// FINANCE_LINE_TYPES (backend has no reason to import the frontend's label
// strings, only needs a stable ordering for the same codes). Deduction
// columns are appended after these, sorted by their own name.
export const COST_TYPE_CANONICAL_ORDER = [
  "IMPORT_DUTY", "EXCISE_DUTY", "CST", "CUSTOMS_EDN_CESS", "DUTY_SETOFF", "ENTRY_TAX", "CUSTOMS_DUTY",
  "FREIGHT", "CLEARING_CHARGES_CHA", "CHA_CHARGES", "LOADING", "UNLOADING", "LAST_MILE_TRANSPORT",
  "TRANSPORTER_CHARGE_OTHER_THAN_BASIC", "INSURANCE", "PORT_CHARGES", "OTHER",
  "LC_CHARGES", "BANK_CHARGES",
];

// Business owner, 2026-09-03: AC01's list grid should show one column per
// landed-cost COMPONENT actually used (Freight, CHA charges, a specific
// deduction type, etc.), instead of only the single "Landed Cost Total"
// column -- and the column SET must be "smart": derived from whatever
// components are present in the current (filtered) result set, not a fixed
// list, so an unused component never clutters the grid. Two explicit rules
// from that same conversation: (1) a deduction line only ever becomes a
// column when in_landed=true -- an unticked deduction never contributed to
// Landed Cost and must not show as one either; (2) GST must never be part
// of a component's value -- mirrors computeLivePreview's frontend "net"
// math exactly (INCLUSIVE strips GST back out, EXCLUSIVE's stored amount is
// already net, GST is only ever added for the separate Payable-to-party
// figure). ADDITIONAL_DUTY_IGST is a GST/ITC line by definition (always
// net=0 in that same frontend math) so it is never emitted as a component
// at all, same as an un-ticked deduction.
// Exported for reuse by crcp_discrepancy.handlers.ts -- PO12 Tab 1's own
// Bulk Component Mapper grid shows the same "smart" per-component columns
// AC01's own list already has (business owner, 2026-10-06), so the
// breakdown math must be identical, not re-derived.
export function computeComponentBreakdown(
  grn: JsonRecord,
  costLines: JsonRecord[],
  deductionLines: JsonRecord[],
  deductionTypeNameMap: Map<string, string>,
): { breakdown: Record<string, number>; deductionLabels: Map<string, string> } {
  const consideredQty = grn.considered_qty != null ? Number(grn.considered_qty) : Number(grn.received_qty ?? 0);
  const perPackQty = grn.per_pack_qty != null ? Number(grn.per_pack_qty) : null;
  const consideredQtyBase = perPackQty != null && perPackQty > 0 ? consideredQty * perPackQty : consideredQty;

  const breakdown: Record<string, number> = {};
  for (const line of costLines) {
    const costType = toTrimmedString(line.cost_type);
    if (!costType || costType === "ADDITIONAL_DUTY_IGST") continue;
    let net = Number(line.amount ?? 0);
    if (Number.isNaN(net)) continue;
    if (line.entry_mode === "PER_UOM") net *= consideredQtyBase;
    const gstRate = line.gst_rate != null ? Number(line.gst_rate) : 0;
    if (line.has_gst === true && gstRate > 0 && line.gst_treatment === "INCLUSIVE") {
      net = net / (1 + gstRate / 100);
    }
    breakdown[costType] = (breakdown[costType] ?? 0) + net;
  }

  const deductionLabels = new Map<string, string>();
  for (const line of deductionLines) {
    if (line.in_landed !== true) continue;
    if (line.amount == null) continue;
    const deductionTypeId = toTrimmedString(line.deduction_type_id);
    if (!deductionTypeId) continue;
    const amount = Number(line.amount) + Number(line.round_off ?? 0);
    if (Number.isNaN(amount)) continue;
    const key = `deduction:${deductionTypeId}`;
    breakdown[key] = (breakdown[key] ?? 0) + amount;
    deductionLabels.set(key, deductionTypeNameMap.get(deductionTypeId) ?? "Deduction");
  }

  return { breakdown, deductionLabels };
}

// "Smart" component columns (business owner, 2026-09-03) -- the set of
// columns is derived from what's actually present in THIS (filtered) result
// set, never a fixed universe. Recomputed fresh per request, so changing a
// filter naturally changes which columns come back. Exported for reuse by
// crcp_discrepancy.handlers.ts (PO12 Tab 1's own Bulk Component Mapper grid,
// 2026-10-06) -- same rule, same shape, must not drift independently.
export function assembleSmartComponentsList(
  items: JsonRecord[],
  deductionTypeNameMap: Map<string, string>,
): Array<{ key: string; kind: "cost" | "deduction"; label?: string }> {
  const usedCostTypeKeys = new Set<string>();
  const usedDeductionLabels = new Map<string, string>();
  for (const item of items) {
    const breakdown = (item.component_breakdown ?? {}) as Record<string, number>;
    for (const key of Object.keys(breakdown)) {
      if (key.startsWith("deduction:")) {
        usedDeductionLabels.set(key, deductionTypeNameMap.get(key.slice("deduction:".length)) ?? "Deduction");
      } else {
        usedCostTypeKeys.add(key);
      }
    }
  }
  return [
    ...COST_TYPE_CANONICAL_ORDER
      .filter((key) => usedCostTypeKeys.has(key))
      .map((key) => ({ key, kind: "cost" as const })),
    ...[...usedDeductionLabels.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, kind: "deduction" as const, label })),
  ];
}

function ac01ErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

// §112 — must validate, not just resolve a fallback: an explicitly-requested
// companyId that is NOT one of the caller's own erp_map.user_companies rows
// throws COMPANY_SCOPE_VIOLATION rather than being silently honoured.
async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

function toMap<T extends JsonRecord>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

// Every AC01 write handler resolves its own companyId independently of
// ctx.context.companyId (the session's active company) -- assertCompanyScope
// only proves company MEMBERSHIP (erp_map.user_companies), not that the
// caller's ACL grant at THAT specific company is WRITE. Without this explicit
// check, a multi-company user with WRITE at their session's company but only
// VIEW (or no work context) at a different target company could still save
// AC01 cost data there. Same pattern as planning.handlers.ts's
// requirePlanningEditAccess/canMaintainPlanning (found live 2026-08-11,
// PO11 Planning) -- resourceCode/action match this file's own
// PROC_IV_LIST:WRITE registry entries (reused from the pre-existing,
// already-granted resource -- see route-acl-registry.ts's 2026-08-21 note
// for why the originally-planned ACC_GRN_LANDED_COST resource was reverted).
export async function canWriteAC01(ctx: ProcurementHandlerContext, companyId: string): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;

  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds =
      ctx.context.workContextIds && ctx.context.workContextIds.length > 0
        ? ctx.context.workContextIds
        : ctx.context.workContextId
          ? [ctx.context.workContextId]
          : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl")
      .from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id)
      .eq("company_id", companyId);
    if (workContextError) return false;
    workContextIds = ((workContextRows ?? []) as Array<{ work_context: unknown }>)
      .map((row) => {
        const wc = Array.isArray(row.work_context) ? row.work_context[0] : row.work_context;
        return wc && typeof wc === "object" ? (wc as { work_context_id: string; is_active: boolean }) : null;
      })
      .filter((wc): wc is { work_context_id: string; is_active: boolean } => Boolean(wc && wc.is_active === true))
      .map((wc) => wc.work_context_id);
  }
  if (workContextIds.length === 0) return false;

  const { data: versionRow, error: versionError } = await serviceRoleClient
    .schema("acl")
    .from("acl_versions")
    .select("acl_version_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .single();
  if (versionError || !versionRow?.acl_version_id) return false;

  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode: "PROC_IV_LIST",
    actionCode: "WRITE",
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

async function requireAC01WriteAccess(
  req: Request,
  ctx: ProcurementHandlerContext,
  companyId: string,
): Promise<Response | null> {
  const allowed = await canWriteAC01(ctx, companyId);
  if (allowed) return null;
  return ac01ErrorResponse(req, ctx, "AC01_WRITE_FORBIDDEN", 403, "You do not have edit access to AC01 for this company.");
}

function deriveUdStatus(decisionLines: JsonRecord[], qaStockQty: number | null): "GREEN" | "YELLOW" | "RED" | null {
  if (decisionLines.length === 0) return null; // No QA document — material didn't require QA.
  const totalQty = qaStockQty ?? decisionLines.reduce((sum, line) => sum + (Number(line.decision_qty) || 0), 0);
  const releasedQty = decisionLines
    .filter((line) => toTrimmedString(line.usage_decision) === "RELEASE")
    .reduce((sum, line) => sum + (Number(line.decision_qty) || 0), 0);
  if (totalQty > 0 && releasedQty >= totalQty) return "GREEN";
  if (releasedQty <= 0) return "RED";
  return "YELLOW";
}

// DEPENDENT: each GRN row's landed-cost/QA/CSN detail is looked up per row from
// maps built in one earlier batch round (INDEPENDENT reads, §8B) — this loop
// itself does no further I/O, just in-memory assembly.
function buildListRow(
  grn: JsonRecord,
  materialMap: Map<string, JsonRecord>,
  vendorMap: Map<string, JsonRecord>,
  companyMap: Map<string, JsonRecord>,
  poMap: Map<string, JsonRecord>,
  paymentTermsMap: Map<string, JsonRecord>,
  csnMap: Map<string, JsonRecord>,
  landedCostMap: Map<string, JsonRecord>,
  udStatusMap: Map<string, "GREEN" | "YELLOW" | "RED" | null>,
  transporterMap: Map<string, JsonRecord>,
  costLinesByLc: Map<string, JsonRecord[]>,
  deductionLinesByLc: Map<string, JsonRecord[]>,
  deductionTypeNameMap: Map<string, string>,
  splitIntoGrnNumbersMap: Map<string, string[]>,
  settlementInvoiceMap: Map<string, JsonRecord>,
  crcpMirrorOwnerByGrnId: Map<string, string>,
  // Viewer's own resolved company scope (listAC01GRNsHandler's companyId) --
  // "" when no company filter is active (SA/GA viewing across companies).
  // Drives both the "ITC To"/row-lock display and the Settlement Invoice
  // visibility gate below, locked 2026-10-04.
  viewerCompanyId: string,
): JsonRecord {
  const material = materialMap.get(String(grn.material_id));
  const vendor = vendorMap.get(String(grn.vendor_id));
  const company = companyMap.get(String(grn.company_id));
  const po = grn.po_id ? poMap.get(String(grn.po_id)) : null;
  const paymentTerms = po?.payment_term_id ? paymentTermsMap.get(String(po.payment_term_id)) : null;
  const csn = grn.gate_entry_line_id ? csnMap.get(String(grn.gate_entry_line_id)) : null;
  const landedCost = landedCostMap.get(String(grn.id));
  // PO12 "AC01 Settlement Invoice" column (locked 2026-10-04) -- shows the
  // Tally Invoice Number (the primary user-facing identifier), never the
  // internal SETTLEMENT series number -- only ever set for a genuine CRCP
  // discrepancy GRN (settlement_invoice_id only gets set by
  // create_settlement_invoice(), which itself refuses a same-company GRN).
  // Gated (locked 2026-10-04, found missing live 2026-10-05): visible only
  // when the viewing company IS this GRN's itc_owner_company_id -- the
  // Actual Receiver's own unrelated view of its own GRN must not see it.
  //
  // §5 design text: "Defaults to the GRN's own company_id for the ordinary,
  // non-CRCP case ... zero behavior change." That default lives only on the
  // landed_cost row itself (written at CRCP Cost Component Entry/AC01 save
  // time) -- a GRN with no landed_cost row yet (no rate/cost entry done)
  // has nowhere to read it from, so it fell through to NULL/blank instead
  // of the GRN's own company. Found live 2026-10-05 (business owner,
  // CMP003's own AC01): every row without a landed_cost row showed a blank
  // "ITC To" cell instead of its own company code. Falling back to the
  // GRN's own company_id here matches the locked default exactly and keeps
  // isItcOwnerViewer/isEditableForViewer unchanged for the ordinary case
  // (itcOwnerCompanyId === viewerCompanyId was already true for the GRN's
  // own company either way).
  const itcOwnerCompanyId = crcpMirrorOwnerByGrnId.get(String(grn.id))
    ?? (landedCost?.itc_owner_company_id
      ? String(landedCost.itc_owner_company_id)
      : String(grn.company_id));
  const isItcOwnerViewer = !viewerCompanyId || (itcOwnerCompanyId != null && itcOwnerCompanyId === viewerCompanyId);
  const settlementInvoice = isItcOwnerViewer && grn.settlement_invoice_id
    ? settlementInvoiceMap.get(String(grn.settlement_invoice_id))
    : null;
  const itcOwnerCompany = itcOwnerCompanyId ? companyMap.get(itcOwnerCompanyId) : null;
  // CRCP mirrored-row flag (locked 2026-10-04) -- false whenever this row is
  // only visible because the viewer is the ITC owner of a GRN some OTHER
  // company actually received (never direct ownership). Frontend uses this
  // to grey the row out and lock its drawer read-only.
  const isEditableForViewer = !viewerCompanyId || String(grn.company_id) === viewerCompanyId;
  const rowCostLines = landedCost ? (costLinesByLc.get(String(landedCost.id)) ?? []) : [];
  const rowDeductionLines = landedCost ? (deductionLinesByLc.get(String(landedCost.id)) ?? []) : [];
  const suggestedPayables = computeSuggestedPayables(grn, rowCostLines, rowDeductionLines);
  const { breakdown: componentBreakdown } = computeComponentBreakdown(
    grn, rowCostLines, rowDeductionLines, deductionTypeNameMap,
  );
  // §8A Foundation Rule -- never show a raw UUID for business data. Found
  // live 2026-08-21: the Transporter column showed the raw transporter_id.
  const transporter = grn.transporter_id ? transporterMap.get(String(grn.transporter_id)) : null;
  const lastMileTransporter = grn.last_mile_transporter_id
    ? transporterMap.get(String(grn.last_mile_transporter_id))
    : null;

  const effectiveRate = effectiveCommercialRate(grn);
  const landedCostTotal = landedCost ? Number(landedCost.total_cost ?? 0) : 0;
  const invoiceQty = grn.ge_qty != null ? Number(grn.ge_qty) : Number(grn.received_qty ?? 0);
  // GRN/GE quantities are stored in the transaction (PO) UOM, while AC01's
  // displayed unit is explicitly the material base UOM. Never label an MT
  // amount as KG: convert the two displayed quantities with the receipt's
  // captured factor and preserve the raw transaction values separately.
  const transactionUom = toTrimmedString(grn.uom_code);
  const baseUom = toTrimmedString(material?.base_uom_code);
  const conversionFactor = transactionUom && baseUom && transactionUom !== baseUom
    ? (Number(grn.per_pack_qty) > 0 ? Number(grn.per_pack_qty) : 1)
    : 1;
  const grnQtyBase = Number((Number(grn.received_qty ?? 0) * conversionFactor).toFixed(6));
  const invoiceQtyBase = Number((invoiceQty * conversionFactor).toFixed(6));
  // Considered Qty (business owner, 2026-08-26) -- always prefilled from
  // Invoice Qty at GRN creation; drives Payable + Landed Cost/unit, never
  // received_qty. See computeSuggestedPayables/computeLandedCostPerUnit.
  const consideredQty = grn.considered_qty != null ? Number(grn.considered_qty) : invoiceQty;
  const costPerUnit = computeLandedCostPerUnit(grn, landedCostTotal);
  const vendorPayable = effectiveRate * consideredQty;
  const materialTax = computeMaterialTaxBreakup(
    vendorPayable,
    Number(grn.gst_pct ?? 0),
    vendor,
    company,
  );
  const referenceType = paymentTerms?.reference_date_type as JsonRecord | JsonRecord[] | undefined;
  const referenceTypeCode = Array.isArray(referenceType) ? referenceType[0]?.code : referenceType?.code;

  // §3.9.5 "GRN Split" (2026-10-02) — a REVERSED GRN (whether from an
  // ordinary reversal or from a Split) is not payable anymore; the ordinary
  // due-date math below means nothing once the receipt itself has been
  // undone. The frontend uses `status`/`is_reversed` to grey the row out and
  // `split_into_grn_numbers` to show which new GRNs it was split into.
  const isReversed = toTrimmedString(grn.status).toUpperCase() === "REVERSED";

  return {
    grn_id: grn.id,
    grn_number: grn.grn_number,
    status: grn.status ?? null,
    is_reversed: isReversed,
    split_source_grn_id: grn.split_source_grn_id ?? null,
    split_into_grn_numbers: splitIntoGrnNumbersMap.get(String(grn.id)) ?? null,
    csn_number: csn?.csn_display_number ?? csn?.csn_number ?? null,
    company_id: grn.company_id,
    company_code: company?.company_code ?? null,
    supplier_name: vendor?.vendor_name ?? null,
    invoice_number: grn.invoice_number ?? null,
    invoice_date: grn.invoice_date ?? null,
    grn_date: grn.grn_date ?? null,
    item_name: material?.material_name ?? null,
    external_code: material?.external_code ?? null,
    grn_qty: grn.received_qty,
    grn_qty_base: grnQtyBase,
    // Invoice quantity is captured at Gate Entry; GRN quantity is what was actually received.
    invoice_qty: grn.ge_qty ?? grn.received_qty,
    invoice_qty_base: invoiceQtyBase,
    // Considered Qty (business owner, 2026-08-26): what Payable/Landed Cost
    // actually get computed against. discrepancy_qty (= ge_qty - received_qty,
    // grn.handlers.ts's own create-time formula) is the raw Invoice-vs-GRN
    // shortage/excess signal -- positive = shortage (invoiced more than
    // received), negative = excess (received more than invoiced). Left as a
    // plain number here; the drawer derives the shortage/excess label from it.
    considered_qty: consideredQty,
    discrepancy_qty: grn.discrepancy_qty != null ? Number(grn.discrepancy_qty) : null,
    base_uom_code: material?.base_uom_code ?? null,
    pack_uom_code: grn.uom_code ?? null,
    purchase_rate: grn.po_rate,
    invoice_rate: grn.invoice_rate,
    confirmed_rate: grn.confirmed_rate,
    rate_confirmed: grn.rate_confirmed,
    rate_mismatch: grn.invoice_rate != null && grn.po_rate != null
      && Number(grn.invoice_rate) !== Number(grn.po_rate) && !grn.rate_confirmed,
    currency: "INR",
    gst_pct: grn.gst_pct,
    taxable_value: Number((effectiveRate * consideredQty).toFixed(4)),
    material_gst_amount: materialTax.gstAmount,
    material_gst_type: materialTax.gstType,
    material_cgst_amount: materialTax.cgstAmount,
    material_sgst_amount: materialTax.sgstAmount,
    material_igst_amount: materialTax.igstAmount,
    invoice_total_value: Number((vendorPayable + materialTax.gstAmount).toFixed(4)),
    landed_cost_total: landedCostTotal,
    // §126.x "smart" per-component breakdown -- keyed by cost_type (e.g.
    // "FREIGHT") or "deduction:<deduction_type_id>". Only components that
    // actually contribute to Landed Cost Total appear here at all -- see
    // computeComponentBreakdown's own comment for the exact rules.
    component_breakdown: componentBreakdown,
    cost_per_unit: Number(costPerUnit.toFixed(4)),
    vendor_payable: Number(vendorPayable.toFixed(4)),
    // Per-party suggested payable, strictly from this GRN's own cost/deduction
    // lines (never aggregated across other GRNs — that's AC02's Vendor
    // Ledger, a different layer). Confirmed/overwrite value wins when set.
    vendor_suggested_payable: suggestedPayables.vendor,
    transporter_suggested_payable: suggestedPayables.transporter,
    last_mile_suggested_payable: suggestedPayables.lastMile,
    cha_suggested_payable: suggestedPayables.cha,
    vendor_payable_override: grn.vendor_payable_override != null ? Number(grn.vendor_payable_override) : null,
    transporter_payable_override: grn.transporter_payable_override != null ? Number(grn.transporter_payable_override) : null,
    last_mile_payable_override: grn.last_mile_payable_override != null ? Number(grn.last_mile_payable_override) : null,
    cha_payable_override: grn.cha_payable_override != null ? Number(grn.cha_payable_override) : null,
    payment_days: paymentTerms?.credit_days ?? null,
    payment_type: paymentTerms?.name ?? null,
    // This is the original contractual payment/due date from PO terms. A
    // revised date is displayed separately; it must never overwrite history.
    // TRUE "date actually paid" still needs AC02's Vendor Ledger — that's
    // payment_status below, not this.
    // REVERSED (incl. §3.9.5 Split originals) is never payment-relevant —
    // the receipt itself no longer stands, so no due date applies.
    actual_payment_date: isReversed ? null : computeActualPaymentDate(
      grn,
      toUpperTrimmedString(referenceTypeCode),
      Number(paymentTerms?.credit_days ?? 0),
    ),
    revised_payment_date: grn.revised_payment_date ?? null,
    freight_type: po?.freight_term ?? null,
    transporter_id: grn.transporter_id ?? null,
    transporter_name: transporter
      ? `${transporter.transporter_code} — ${transporter.transporter_name}`
      : null,
    last_mile_transporter_id: grn.last_mile_transporter_id ?? null,
    last_mile_transporter_name: lastMileTransporter
      ? `${lastMileTransporter.transporter_code} — ${lastMileTransporter.transporter_name}`
      : null,
    lr_number: grn.lr_number ?? null,
    lr_date: grn.lr_date ?? null,
    bl_number: grn.bl_number ?? null,
    bl_date: grn.bl_date ?? null,
    lc_number: csn?.lc_number ?? null,
    lc_date: csn?.lc_opened_date ?? null,
    boe_number: grn.boe_number ?? null,
    boe_date: grn.boe_date ?? null,
    ud_status: udStatusMap.get(String(grn.id)) ?? null,
    payment_status: null, // Same deferral as actual_payment_date above.
    // AC01 "ITC To" column (locked 2026-10-04) -- who actually gets to claim
    // this GRN's ITC. NULL for the ordinary (non-CRCP) case; a real company
    // for a genuine CRCP discrepancy GRN. Shown to every viewer of the row
    // (unlike Settlement Invoice below, which is viewer-gated) since knowing
    // WHO owns the ITC is relevant to both the Actual Receiver and the owner.
    itc_owner_company_id: itcOwnerCompanyId,
    itc_owner_company_code: itcOwnerCompany?.company_code ?? null,
    // CRCP mirrored-row flag -- see the comment on isEditableForViewer above.
    is_editable_for_viewer: isEditableForViewer,
    // PO12 "AC01 Settlement Invoice" column -- Tally Invoice Number, never
    // the internal SETTLEMENT series number. View/Print reuses that
    // internal settlement_number separately (not surfaced in this column).
    // Gated to isItcOwnerViewer -- see the comment on settlementInvoice above.
    settlement_invoice_id: isItcOwnerViewer ? (grn.settlement_invoice_id ?? null) : null,
    settlement_invoice_tally_number: settlementInvoice?.tally_invoice_number ?? null,
    settlement_invoice_tally_date: settlementInvoice?.tally_invoice_date ?? null,
    settlement_document_number: settlementInvoice?.settlement_number ?? null,
    settlement_document_date: settlementInvoice?.posting_date ?? null,
  };
}

export async function listAC01GRNsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const search = toTrimmedString(url.searchParams.get("search"));
    const rateStatus = toTrimmedString(url.searchParams.get("rate_status")).toUpperCase();
    const dateField = toTrimmedString(url.searchParams.get("date_field")) || "invoice_date";
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);
    const offset = parsePositiveInt(url.searchParams.get("offset"), 0) - 1 >= 0
      ? parsePositiveInt(url.searchParams.get("offset"), 1) - 1
      : 0;

    const ALLOWED_DATE_FIELDS = new Set(["invoice_date", "grn_date", "posting_date"]);
    const dateColumn = ALLOWED_DATE_FIELDS.has(dateField) ? dateField : "invoice_date";

    // AC01 "ITC To" + cross-company visibility: a company sees a GRN when it
    // owns it, when a landed-cost record names it as ITC owner, OR when the
    // receipt belongs to one of its CRCP POs/STOs. The latter is essential
    // before the first landed-cost header exists; otherwise a Bill-To company
    // cannot see the very GRN whose quality/payment/freight it must monitor.
    // Write access remains strictly GRN-company-scoped via canWriteAC01().
    let itcOwnerGrnIds: string[] = [];
    let crcpMirrorOwnerByGrnId = new Map<string, string>();
    if (companyId) {
      const [itcOwnerLcResponse, crcpMirrorOwners] = await Promise.all([
        serviceRoleClient
          .schema("erp_procurement").from("landed_cost")
          .select("grn_id").eq("itc_owner_company_id", companyId).not("grn_id", "is", null),
        getCrcpMirrorOwnerByGrnId(companyId),
      ]);
      if (itcOwnerLcResponse.error) {
        return ac01ErrorResponse(req, ctx, "AC01_ITC_OWNER_FETCH_FAILED", 500, "Unable to resolve AC01 ITC-owner GRNs.");
      }
      crcpMirrorOwnerByGrnId = crcpMirrorOwners;
      itcOwnerGrnIds = uniqueRelationIds([
        ...((itcOwnerLcResponse.data ?? []) as JsonRecord[]).map((row) => row.grn_id),
        ...crcpMirrorOwnerByGrnId.keys(),
      ]);
      // This list is inlined into one .or() URL below. Keep the established
      // cap until the list becomes large enough to justify a dedicated view.
      itcOwnerGrnIds = itcOwnerGrnIds.slice(0, 300);
    }

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId && itcOwnerGrnIds.length > 0) {
      query = query.or(`company_id.eq.${companyId},id.in.(${itcOwnerGrnIds.join(",")})`);
    } else if (companyId) {
      query = query.eq("company_id", companyId);
    }
    if (rateStatus === "PENDING") query = query.eq("rate_confirmed", false);
    if (rateStatus === "CONFIRMED") query = query.eq("rate_confirmed", true);
    if (dateFrom) query = query.gte(dateColumn, dateFrom);
    if (dateTo) query = query.lte(dateColumn, dateTo);
    if (search) {
      // goods_receipt has no denormalized supplier/item name (only vendor_id/
      // material_id FKs) -- the placeholder ("GRN, invoice, item, supplier...")
      // promised those fields but the filter below never actually matched
      // them, live 2026-08-25 (business owner: "Time techno" typed against a
      // visible TIME TECHNOPLAST LIMITED row returned zero results). Resolve
      // matching vendor/material ids by name first, then OR them into the
      // same filter as the existing grn/invoice/lr text match.
      const [vendorMatchResp, materialMatchResp] = await Promise.all([
        serviceRoleClient.schema("erp_master").from("vendor_master")
          .select("id").ilike("vendor_name", `%${search}%`).limit(50),
        serviceRoleClient.schema("erp_master").from("material_master")
          .select("id").or(`material_name.ilike.%${search}%,external_code.ilike.%${search}%`).limit(50),
      ]);
      if (vendorMatchResp.error || materialMatchResp.error) {
        return ac01ErrorResponse(req, ctx, "AC01_LIST_FAILED", 500, "Unable to list AC01 GRN rows.");
      }
      const vendorIdMatches = ((vendorMatchResp.data ?? []) as JsonRecord[]).map((row) => String(row.id));
      const materialIdMatches = ((materialMatchResp.data ?? []) as JsonRecord[]).map((row) => String(row.id));

      const orClauses = [
        `grn_number.ilike.%${search}%`,
        `invoice_number.ilike.%${search}%`,
        `lr_number.ilike.%${search}%`,
      ];
      if (vendorIdMatches.length > 0) orClauses.push(`vendor_id.in.(${vendorIdMatches.join(",")})`);
      if (materialIdMatches.length > 0) orClauses.push(`material_id.in.(${materialIdMatches.join(",")})`);
      query = query.or(orClauses.join(","));
    }

    const { data, error, count } = await query;
    if (error) {
      return ac01ErrorResponse(req, ctx, "AC01_LIST_FAILED", 500, "Unable to list AC01 GRN rows.");
    }

    const rows = (data ?? []) as JsonRecord[];
    const materialIds = uniqueRelationIds(rows.map((row) => row.material_id));
    const vendorIds = uniqueRelationIds(rows.map((row) => row.vendor_id));
    const companyIds = uniqueRelationIds(rows.map((row) => row.company_id));
    const poIds = uniqueRelationIds(rows.map((row) => row.po_id));
    const grnIds = uniqueRelationIds(rows.map((row) => row.id));
    const gateEntryLineIds = uniqueRelationIds(rows.map((row) => row.gate_entry_line_id));
    const transporterIds = uniqueRelationIds(
      rows.flatMap((row) => [row.transporter_id, row.last_mile_transporter_id]),
    );

    const [materials, vendors, companies, purchaseOrders, landedCosts, qaDocuments, csnRows, transporters, splitIntoRows] = await Promise.all([
      fetchInChunks<JsonRecord>(materialIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, material_name, external_code, base_uom_code").in("id", chunk)),
      fetchInChunks<JsonRecord>(vendorIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("vendor_master")
          .select("id, vendor_name, gst_number").in("id", chunk)),
      fetchInChunks<JsonRecord>(companyIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("companies")
          .select("id, company_code, gst_number").in("id", chunk)),
      fetchInChunks<JsonRecord>(poIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("purchase_order")
          .select("id, payment_term_id, freight_term, company_id, crcp_enabled").in("id", chunk)),
      fetchInChunks<JsonRecord>(grnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost")
          // itc_owner_company_id added for the "ITC To" column + Settlement
          // Invoice visibility gate (locked 2026-10-04, found missing live
          // 2026-10-05) -- see buildListRow's own comment on itcOwnerCompanyId.
          .select("id, grn_id, total_cost, created_at, itc_owner_company_id").in("grn_id", chunk)),
      fetchInChunks<JsonRecord>(grnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
          .select("id, grn_id, qa_stock_qty").in("grn_id", chunk)),
      fetchInChunks<JsonRecord>(gateEntryLineIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
          .select("id, csn_id").in("id", chunk)),
      fetchInChunks<JsonRecord>(transporterIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("transporter_master")
          .select("id, transporter_code, transporter_name").in("id", chunk)),
      // §3.9.5 "GRN Split" (2026-10-02) — reverse lookup: for each row on this
      // page, which new GRN(s) (if any) it was split into. INDEPENDENT of the
      // other bulk fetches here (§8B), keyed purely off the page's own ids.
      fetchInChunks<JsonRecord>(grnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("goods_receipt")
          .select("grn_number, split_source_grn_id").in("split_source_grn_id", chunk)),
    ]);

    const paymentTermIds = uniqueRelationIds(purchaseOrders.map((po) => po.payment_term_id));
    const csnIds = uniqueRelationIds(csnRows.map((row) => row.csn_id));
    const qaDocumentIds = uniqueRelationIds(qaDocuments.map((doc) => doc.id));

    const lcIds = uniqueRelationIds(landedCosts.map((lc) => lc.id));

    const [paymentTerms, consignmentNotes, decisionLines, costLineRows, deductionLineRows] = await Promise.all([
      fetchInChunks<JsonRecord>(paymentTermIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("payment_terms_master")
          .select("id, name, credit_days, reference_date_type:reference_date_type_id(code)").in("id", chunk)),
      fetchInChunks<JsonRecord>(csnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("consignment_note")
          // csn_display_number is not a real column -- it's only ever computed at
          // read time (csn.handlers.ts's enrichTrackerRows); buildListRow already
          // falls back to the raw csn_number below when it's absent.
          .select("id, csn_number, lc_number, lc_opened_date").in("id", chunk)),
      fetchInChunks<JsonRecord>(qaDocumentIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("inward_qa_decision_line")
          .select("qa_document_id, usage_decision, decision_qty").in("qa_document_id", chunk)),
      fetchInChunks<JsonRecord>(lcIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost_line")
          // cost_type/entry_mode added 2026-09-03 for the per-component
          // breakdown columns (computeComponentBreakdown below) -- this list
          // query never used to need to know WHICH cost type a line was.
          .select("lc_id, cost_type, amount, entry_mode, has_gst, gst_treatment, gst_rate, party_type").in("lc_id", chunk)),
      fetchInChunks<JsonRecord>(lcIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost_deduction_line")
          // deduction_type_id/in_landed added 2026-09-03, same reason as above.
          .select("lc_id, deduction_type_id, amount, round_off, in_landed, party_type").in("lc_id", chunk)),
    ]);

    // Per-component breakdown columns (business owner, 2026-09-03): the
    // dynamic column set is driven by distinct deduction TYPE NAMES, which
    // are per-company free-text data (deduction_type_master), not a fixed
    // enum like cost_type -- must resolve id -> name here, same §8A rule as
    // every other FK the list already resolves.
    const deductionTypeIds = [...new Set(
      deductionLineRows.map((row) => toTrimmedString(row.deduction_type_id)).filter(Boolean),
    )];
    const deductionTypeRows = deductionTypeIds.length > 0
      ? await fetchInChunks<JsonRecord>(deductionTypeIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("deduction_type_master")
          .select("id, name").in("id", chunk))
      : [];
    const deductionTypeNameMap = new Map(
      deductionTypeRows.map((row) => [String(row.id), toTrimmedString(row.name) || "Deduction"]),
    );

    const materialMap = toMap(materials);
    const vendorMap = toMap(vendors);
    const companyMap = toMap(companies);
    const poMap = toMap(purchaseOrders);
    const paymentTermsMap = toMap(paymentTerms);
    const gateEntryLineToCsn = new Map(csnRows.map((row) => [String(row.id), row.csn_id]));
    const csnByIdMap = toMap(consignmentNotes);
    // gate_entry_line_id -> hydrated CSN row, resolved through the two maps above.
    const csnMap = new Map<string, JsonRecord>();
    for (const [lineId, csnId] of gateEntryLineToCsn) {
      const csn = csnByIdMap.get(String(csnId));
      if (csn) csnMap.set(lineId, csn);
    }
    const landedCostMap = new Map<string, JsonRecord>();
    for (const lc of landedCosts) {
      const existing = landedCostMap.get(String(lc.grn_id));
      if (!existing || String(lc.created_at) > String(existing.created_at)) {
        landedCostMap.set(String(lc.grn_id), lc);
      }
    }
    // "ITC To" column (locked 2026-10-04) -- an ITC-owner company can differ
    // from every company already covered by `companies` above (that fetch
    // only covers rows' own company_id). Resolve any not already known.
    const itcOwnerCompanyIds = [...new Set(
      [
        ...landedCosts.map((lc) => toTrimmedString(lc.itc_owner_company_id)),
        ...crcpMirrorOwnerByGrnId.values(),
      ].filter(Boolean),
    )].filter((id) => !companyMap.has(id));
    if (itcOwnerCompanyIds.length > 0) {
      const extraCompanies = await fetchInChunks<JsonRecord>(itcOwnerCompanyIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("companies")
          .select("id, company_code").in("id", chunk));
      for (const company of extraCompanies) companyMap.set(String(company.id), company);
    }
    const qaDocByGrn = new Map(qaDocuments.map((doc) => [String(doc.id), doc]));
    const decisionsByQaDoc = new Map<string, JsonRecord[]>();
    for (const line of decisionLines) {
      const key = String(line.qa_document_id);
      if (!decisionsByQaDoc.has(key)) decisionsByQaDoc.set(key, []);
      decisionsByQaDoc.get(key)!.push(line);
    }
    const udStatusMap = new Map<string, "GREEN" | "YELLOW" | "RED" | null>();
    for (const doc of qaDocuments) {
      const lines = decisionsByQaDoc.get(String(doc.id)) ?? [];
      udStatusMap.set(String(doc.grn_id), deriveUdStatus(lines, doc.qa_stock_qty != null ? Number(doc.qa_stock_qty) : null));
    }
    void qaDocByGrn;
    const transporterMap = toMap(transporters);
    const costLinesByLc = new Map<string, JsonRecord[]>();
    for (const line of costLineRows) {
      const key = String(line.lc_id);
      if (!costLinesByLc.has(key)) costLinesByLc.set(key, []);
      costLinesByLc.get(key)!.push(line);
    }
    const deductionLinesByLc = new Map<string, JsonRecord[]>();
    for (const line of deductionLineRows) {
      const key = String(line.lc_id);
      if (!deductionLinesByLc.has(key)) deductionLinesByLc.set(key, []);
      deductionLinesByLc.get(key)!.push(line);
    }
    const splitIntoGrnNumbersMap = new Map<string, string[]>();
    for (const row of splitIntoRows) {
      const key = String(row.split_source_grn_id);
      const grnNumber = toTrimmedString(row.grn_number);
      if (!grnNumber) continue;
      if (!splitIntoGrnNumbersMap.has(key)) splitIntoGrnNumbersMap.set(key, []);
      splitIntoGrnNumbersMap.get(key)!.push(grnNumber);
    }

    const settlementInvoiceIds = uniqueRelationIds(rows.map((row) => row.settlement_invoice_id));
    const settlementInvoiceRows = settlementInvoiceIds.length > 0
      ? await fetchInChunks<JsonRecord>(settlementInvoiceIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("settlement_invoice")
          .select("id, settlement_number, tally_invoice_number, tally_invoice_date, posting_date").in("id", chunk))
      : [];
    const settlementInvoiceMap = toMap(settlementInvoiceRows);

    // Section 145 -- Bulk "Order in LOT": Lot Number / Lot Balance / PO Balance columns. A GRN's
    // lot is the one on the Gate Entry line it was received against (a split GRN carries that
    // line in source_gate_entry_line_id). Balances are LIVE (this moment), not as of the GRN.
    const lotGeLineIds = uniqueRelationIds(
      rows.map((row) => toRelationId(row.gate_entry_line_id) || toRelationId(row.source_gate_entry_line_id)),
    );
    const lotGeLines = lotGeLineIds.length > 0
      ? await fetchInChunks<JsonRecord>(lotGeLineIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
          .select("id, lot_number, po_line_id").in("id", chunk).not("lot_number", "is", null))
      : [];
    const lotLineByGeLineId = toMap(lotGeLines);
    const lotPoLineIds = uniqueRelationIds(lotGeLines.map((line) => line.po_line_id));
    const lotBalanceByKey = new Map<string, number>();
    const poLineOpenQty = new Map<string, number>();
    if (lotPoLineIds.length > 0) {
      const balanceChunks: string[][] = [];
      for (let i = 0; i < lotPoLineIds.length; i += 100) balanceChunks.push(lotPoLineIds.slice(i, i + 100));
      const [balanceResponses, poLineRows] = await Promise.all([
        Promise.all(balanceChunks.map((chunk) =>
          serviceRoleClient.schema("erp_procurement").rpc("po_lot_balances", { p_po_line_ids: chunk, p_exclude_ge_line_id: null }))),
        fetchInChunks<JsonRecord>(lotPoLineIds, (chunk) =>
          serviceRoleClient.schema("erp_procurement").from("purchase_order_line")
            .select("id, open_qty, ordered_qty").in("id", chunk)),
      ]);
      for (const response of balanceResponses) {
        if (response.error) {
          return ac01ErrorResponse(req, ctx, "AC01_LIST_FAILED", 500, "Unable to resolve lot balances.");
        }
        for (const lot of ((response.data as JsonRecord[] | null) ?? [])) {
          lotBalanceByKey.set(`${toTrimmedString(lot.po_line_id)}::${toTrimmedString(lot.lot_number)}`, Number(lot.balance_qty ?? 0));
        }
      }
      for (const line of poLineRows) {
        poLineOpenQty.set(String(line.id), Number(line.open_qty ?? line.ordered_qty ?? 0));
      }
    }

    const verifierDisplayNames = await resolveUserDisplayNames(
      rows.map((row) => toTrimmedString(row.invoice_verified_by)).filter(Boolean),
    );
    // Explicit return-type annotation is required here: buildListRow's return
    // type (JsonRecord = Record<string, unknown>) has only an index signature,
    // and TS drops a spread's index signature from an inline object literal's
    // inferred type unless the literal itself is annotated -- without this,
    // every `item.<field>` access below (and at every other call site of this
    // handler's response) silently loses type information. Found via
    // deno check while merging in the invoice_verified_by addition below,
    // which never actually passed deno check on its own source branch.
    const items = rows.map((row): JsonRecord => ({
      ...buildListRow(
        row, materialMap, vendorMap, companyMap, poMap, paymentTermsMap, csnMap, landedCostMap,
        udStatusMap, transporterMap, costLinesByLc, deductionLinesByLc, deductionTypeNameMap,
        splitIntoGrnNumbersMap, settlementInvoiceMap, crcpMirrorOwnerByGrnId, companyId,
      ),
      invoice_verified_by: toTrimmedString(row.invoice_verified_by) || null,
      invoice_verified_by_display: verifierDisplayNames.get(toTrimmedString(row.invoice_verified_by)) || null,
      invoice_verified_at: row.invoice_verified_at ?? null,
      ...(() => {
        const lotLine = lotLineByGeLineId.get(toRelationId(row.gate_entry_line_id) || toRelationId(row.source_gate_entry_line_id));
        if (!lotLine) return { lot_number: null, lot_balance_qty: null, po_balance_qty: null };
        const poLineId = toTrimmedString(lotLine.po_line_id);
        const lotNumber = toTrimmedString(lotLine.lot_number);
        return {
          lot_number: lotNumber,
          lot_balance_qty: lotBalanceByKey.get(`${poLineId}::${lotNumber}`) ?? null,
          po_balance_qty: poLineOpenQty.get(poLineId) ?? null,
        };
      })(),
    }));

    const components = assembleSmartComponentsList(items, deductionTypeNameMap);

    return okResponse({ items, total: count ?? items.length, components }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC01_LIST_FAILED";
    return ac01ErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

export async function getAC01GRNHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const grnId = new URL(req.url).pathname.split("/").filter(Boolean)[4] ?? "";
    if (!grnId) {
      return ac01ErrorResponse(req, ctx, "AC01_GRN_ID_REQUIRED", 400, "GRN id is required.");
    }

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt").select("*").eq("id", grnId).single();
    if (grnError || !grn) {
      return ac01ErrorResponse(req, ctx, "AC01_GRN_NOT_FOUND", 404, "GRN not found.");
    }

    // Fetch landed_cost BEFORE the access check -- needed to resolve the CRCP
    // ITC-owner fallback below (locked 2026-10-04, PROCUREMENT-DESIGN-DOC.md
    // "AC01 'ITC To' + cross-company visibility"). Moved out of the
    // materialResp/vendorResp Promise.all it used to share so the access
    // check can run before any other per-GRN detail is fetched.
    const { data: lcRows, error: lcError } = await serviceRoleClient
      .schema("erp_procurement").from("landed_cost").select("*")
      .eq("grn_id", grnId).order("created_at", { ascending: false }).limit(1);
    if (lcError) {
      return ac01ErrorResponse(req, ctx, "AC01_LC_FETCH_FAILED", 500, "Unable to fetch landed cost.");
    }
    const landedCost = (lcRows ?? [])[0] as JsonRecord | undefined;

    // Membership across ALL the caller's companies (erp_map.user_companies),
    // not just the session's currently-pinned company -- a multi-company user
    // viewing a GRN in a company other than their session's active one must
    // still be let in if they're actually a member there. Matches
    // saveAC01GRNCostHandler's own assertCompanyScope call below; this
    // handler previously compared directly against ctx.context.companyId,
    // which wrongly 403'd legitimate multi-company access.
    //
    // CRCP fallback: a company that is NOT this GRN's actual receiver can
    // still open the Bill-To mirror read-only. Resolve from the CRCP PO/STO
    // first, then retain landed_cost as the persisted ITC-owner record. This
    // deliberately works before the first landed-cost header exists.
    const crcpMirrorOwnerCompanyId = await getCrcpMirrorOwnerForGrn(grn as JsonRecord);
    const effectiveItcOwnerCompanyId = (
      crcpMirrorOwnerCompanyId ?? toRelationId(landedCost?.itc_owner_company_id)
    ) || toRelationId(grn.company_id);
    let isDirectOwner = true;
    try {
      await assertCompanyScope(ctx, String(grn.company_id));
    } catch {
      isDirectOwner = false;
    }
    let isItcOwnerViewer = false;
    if (!isDirectOwner && effectiveItcOwnerCompanyId) {
      try {
        await assertCompanyScope(ctx, effectiveItcOwnerCompanyId);
        isItcOwnerViewer = true;
      } catch {
        isItcOwnerViewer = false;
      }
    }
    if (!isDirectOwner && !isItcOwnerViewer) {
      return ac01ErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    // Write access (canWriteAC01/requireAC01WriteAccess, saveAC01GRNCostHandler
    // below) stays exactly as already locked -- strictly GRN-company-scoped,
    // never widened to the ITC-owner mirror. This flag is read-only display
    // metadata so the frontend can lock the drawer for a mirrored view.
    const isEditableForViewer = isDirectOwner;

    // §8A Foundation Rule -- the drawer never showed material/vendor identity
    // at all (only raw material_id/vendor_id sat unused on `grn`), unlike the
    // list row which already resolves these via buildListRow. Found live
    // 2026-08-26 (business owner): fetched INDEPENDENT of each other (§8B).
    const [materialResp, vendorResp, companyResp] = await Promise.all([
      grn.material_id
        ? serviceRoleClient.schema("erp_master").from("material_master")
          .select("material_name, external_code").eq("id", String(grn.material_id)).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      grn.vendor_id
        ? serviceRoleClient.schema("erp_master").from("vendor_master")
          .select("vendor_name, gst_number").eq("id", String(grn.vendor_id)).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      serviceRoleClient.schema("erp_master").from("companies")
        .select("gst_number").eq("id", String(grn.company_id)).maybeSingle(),
    ]);
    const materialName = (materialResp.data as JsonRecord | null)?.material_name ?? null;
    const materialExternalCode = (materialResp.data as JsonRecord | null)?.external_code ?? null;
    const vendorName = (vendorResp.data as JsonRecord | null)?.vendor_name ?? null;

    let costLines: JsonRecord[] = [];
    let deductionLines: JsonRecord[] = [];
    if (landedCost) {
      const [costLinesResp, deductionLinesResp] = await Promise.all([
        serviceRoleClient.schema("erp_procurement").from("landed_cost_line")
          .select("*").eq("lc_id", landedCost.id).order("line_number", { ascending: true }),
        serviceRoleClient.schema("erp_procurement").from("landed_cost_deduction_line")
          .select("*").eq("lc_id", landedCost.id),
      ]);
      costLines = (costLinesResp.data ?? []) as JsonRecord[];
      deductionLines = (deductionLinesResp.data ?? []) as JsonRecord[];
    }

    // §8A Foundation Rule -- the last-mile-transporter picker needs the
    // current selection's display name pre-filled when editing an existing
    // GRN, not just its id (see buildListRow's own note above).
    let lastMileTransporterName: string | null = null;
    if (grn.last_mile_transporter_id) {
      const { data: transporter } = await serviceRoleClient
        .schema("erp_master").from("transporter_master")
        .select("transporter_code, transporter_name")
        .eq("id", String(grn.last_mile_transporter_id))
        .maybeSingle();
      if (transporter) {
        lastMileTransporterName = `${transporter.transporter_code} — ${transporter.transporter_name}`;
      }
    }

    // §3.9.5 "GRN Split" (2026-10-02) — same REVERSED guard as buildListRow's
    // list-row version: a reversed receipt is never payment-relevant.
    const isReversed = toTrimmedString(grn.status).toUpperCase() === "REVERSED";

    // freight_type (for the FOR-aware party UI hint) + the payment-terms
    // reference date, same source buildListRow's list-row version uses.
    let freightType: string | null = null;
    let actualPaymentDate: string | null = null;
    if (!isReversed && grn.po_id) {
      const { data: po } = await serviceRoleClient
        .schema("erp_procurement").from("purchase_order")
        .select("freight_term, payment_term_id")
        .eq("id", String(grn.po_id))
        .maybeSingle();
      freightType = (po?.freight_term as string | null) ?? null;
      if (po?.payment_term_id) {
        const { data: paymentTerm } = await serviceRoleClient
          .schema("erp_master").from("payment_terms_master")
          .select("credit_days, reference_date_type:reference_date_type_id(code)")
          .eq("id", String(po.payment_term_id))
          .maybeSingle();
        const referenceType = paymentTerm?.reference_date_type as JsonRecord | JsonRecord[] | undefined;
        const referenceTypeCode = Array.isArray(referenceType) ? referenceType[0]?.code : referenceType?.code;
        actualPaymentDate = computeActualPaymentDate(
          grn,
          toUpperTrimmedString(referenceTypeCode),
          Number(paymentTerm?.credit_days ?? 0),
        );
      }
    }

    // CHA support (business owner, 2026-08-22): "CSN Tracker-এ import-এর
    // জন্য CHA দেওয়া থাকে, সেটা তো করা উচিত" -- pull the CSN's own cha_id as
    // a default suggestion for this GRN's CHA-party cost lines, and give the
    // frontend the full CHA list for this company so its picker doesn't need
    // a separate round trip (CHA Master is a short list, unlike Transporter
    // Master -- no debounced search needed, a plain dropdown is proportionate).
    let defaultChaId: string | null = null;
    if (grn.gate_entry_line_id) {
      const { data: gateEntryLine } = await serviceRoleClient
        .schema("erp_procurement").from("gate_entry_line")
        .select("csn_id").eq("id", String(grn.gate_entry_line_id)).maybeSingle();
      if (gateEntryLine?.csn_id) {
        const { data: csn } = await serviceRoleClient
          .schema("erp_procurement").from("consignment_note")
          .select("cha_id").eq("id", String(gateEntryLine.csn_id)).maybeSingle();
        defaultChaId = (csn?.cha_id as string | null) ?? null;
      }
    }
    const { data: companyChaMaps } = await serviceRoleClient
      .schema("erp_master").from("cha_company_map")
      .select("cha_id").eq("company_id", String(grn.company_id)).eq("active", true);
    const companyChaIds = [...new Set(((companyChaMaps ?? []) as JsonRecord[]).map((row) => String(row.cha_id)))];
    let chaOptions: JsonRecord[] = [];
    let chaNameMap = new Map<string, JsonRecord>();
    if (companyChaIds.length > 0) {
      const chas = await fetchInChunks<JsonRecord>(companyChaIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("cha_master")
          .select("id, cha_code, cha_name").eq("active", true).in("id", chunk));
      chaOptions = chas;
      chaNameMap = toMap(chas);
    }
    const costLinesWithChaName = costLines.map((line) => {
      const cha = line.cha_id ? chaNameMap.get(String(line.cha_id)) : null;
      return { ...line, cha_name: cha ? `${cha.cha_code} — ${cha.cha_name}` : null };
    });

    // Mirrors save_ac01_grn_cost()'s own math — see computeSuggestedPayables's
    // own comment above. Recomputed read-side since the RPC only returns this
    // on SAVE, and viewing a GRN must not trigger a write.
    const suggestedPayables = computeSuggestedPayables(grn, costLines, deductionLines);
    const landedCostTotalForView = landedCost ? Number(landedCost.total_cost ?? 0) : 0;
    const detailTaxableValue = Number((effectiveCommercialRate(grn)
      * Number(grn.considered_qty ?? grn.ge_qty ?? grn.received_qty ?? 0)).toFixed(4));
    const detailMaterialTax = computeMaterialTaxBreakup(
      detailTaxableValue,
      Number(grn.gst_pct ?? 0),
      (vendorResp.data as JsonRecord | null) ?? undefined,
      (companyResp.data as JsonRecord | null) ?? undefined,
    );

    // §3.9.5 "GRN Split" — if this GRN was the original that got split, show
    // which new GRN(s) it became. Same reverse-lookup as the list endpoint.
    const { data: splitIntoRows } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt")
      .select("grn_number").eq("split_source_grn_id", grnId);
    const splitIntoGrnNumbers = ((splitIntoRows ?? []) as JsonRecord[])
      .map((row) => toTrimmedString(row.grn_number)).filter(Boolean);

    return okResponse({
      ...grn,
      is_reversed: isReversed,
      // CRCP mirrored-view flag (locked 2026-10-04) -- false only when this
      // viewer reached the drawer via the itc_owner_company_id fallback
      // above, never via direct GRN-company ownership. Frontend uses this to
      // lock the whole drawer read-only for the mirrored view.
      is_editable_for_viewer: isEditableForViewer,
      itc_owner_company_id: effectiveItcOwnerCompanyId || null,
      split_into_grn_numbers: splitIntoGrnNumbers.length > 0 ? splitIntoGrnNumbers : null,
      item_name: materialName,
      external_code: materialExternalCode,
      supplier_name: vendorName,
      last_mile_transporter_name: lastMileTransporterName,
      freight_type: freightType,
      actual_payment_date: actualPaymentDate,
      revised_payment_date: grn.revised_payment_date ?? null,
      taxable_value: detailTaxableValue,
      material_gst_amount: detailMaterialTax.gstAmount,
      material_gst_type: detailMaterialTax.gstType,
      material_cgst_amount: detailMaterialTax.cgstAmount,
      material_sgst_amount: detailMaterialTax.sgstAmount,
      material_igst_amount: detailMaterialTax.igstAmount,
      invoice_total_value: Number((detailTaxableValue + detailMaterialTax.gstAmount).toFixed(4)),
      cost_per_unit: Number(computeLandedCostPerUnit(grn, landedCostTotalForView).toFixed(4)),
      vendor_suggested_payable: suggestedPayables.vendor,
      transporter_suggested_payable: suggestedPayables.transporter,
      last_mile_suggested_payable: suggestedPayables.lastMile,
      cha_suggested_payable: suggestedPayables.cha,
      default_cha_id: defaultChaId,
      cha_options: chaOptions,
      landed_cost: landedCost ?? null,
      cost_lines: costLinesWithChaName,
      deduction_lines: deductionLines,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC01_GET_FAILED";
    return ac01ErrorResponse(req, ctx, code, 500, code);
  }
}

export async function saveAC01GRNCostHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const grnId = new URL(req.url).pathname.split("/").filter(Boolean)[4] ?? "";
    if (!grnId) {
      return ac01ErrorResponse(req, ctx, "AC01_GRN_ID_REQUIRED", 400, "GRN id is required.");
    }
    const body = await parseBody(req);

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement").from("goods_receipt").select("id, company_id").eq("id", grnId).single();
    if (grnError || !grn) {
      return ac01ErrorResponse(req, ctx, "AC01_GRN_NOT_FOUND", 404, "GRN not found.");
    }
    try {
      await assertCompanyScope(ctx, String(grn.company_id));
    } catch {
      return ac01ErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const forbidden = await requireAC01WriteAccess(req, ctx, String(grn.company_id));
    if (forbidden) return forbidden;

    const costLines = Array.isArray(body.cost_lines) ? body.cost_lines : [];
    const deductionLines = Array.isArray(body.deduction_lines) ? body.deduction_lines : [];

    // Single atomic entry point — CLAUDE.md §8D. Never split this into
    // separate goods_receipt/landed_cost/*_line writes from TypeScript.
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .rpc("save_ac01_grn_cost_with_verification", {
        p_grn_id: grnId,
        p_actor: ctx.auth_user_id,
        p_confirmed_rate: body.confirmed_rate != null ? Number(body.confirmed_rate) : null,
        p_last_mile_transporter_id: toTrimmedString(body.last_mile_transporter_id) || null,
        p_invoice_number: toTrimmedString(body.invoice_number) || null,
        p_invoice_date: toTrimmedString(body.invoice_date) || null,
        p_gst_pct: body.gst_pct != null ? Number(body.gst_pct) : null,
        p_cost_lines: costLines,
        p_deduction_lines: deductionLines,
        p_reason: toTrimmedString(body.reason) || "AC01 landed cost save",
        p_revised_payment_date: toTrimmedString(body.revised_payment_date) || null,
        p_vendor_payable_override: body.vendor_payable_override != null ? Number(body.vendor_payable_override) : null,
        p_transporter_payable_override: body.transporter_payable_override != null ? Number(body.transporter_payable_override) : null,
        p_last_mile_payable_override: body.last_mile_payable_override != null ? Number(body.last_mile_payable_override) : null,
        p_cha_payable_override: body.cha_payable_override != null ? Number(body.cha_payable_override) : null,
        p_clear_revised_payment_date: body.clear_revised_payment_date === true,
        p_clear_vendor_payable_override: body.clear_vendor_payable_override === true,
        p_clear_transporter_payable_override: body.clear_transporter_payable_override === true,
        p_clear_last_mile_payable_override: body.clear_last_mile_payable_override === true,
        p_clear_cha_payable_override: body.clear_cha_payable_override === true,
        p_considered_qty: body.considered_qty != null ? Number(body.considered_qty) : null,
        p_invoice_verified: body.invoice_verified === true,
        // Each AC01 save is a fresh confirmation point. Unless the user ticks
        // I Verify in this same save, an earlier acknowledgement is removed.
        p_clear_invoice_verification: body.invoice_verified !== true,
      });

    if (error) {
      return ac01ErrorResponse(req, ctx, "AC01_SAVE_FAILED", 500, error.message ?? "Unable to save AC01 GRN cost.");
    }

    // A commercial split has many invoice-only GRNs but exactly one physical
    // P101 ledger. The RPC has already recalculated that source receipt
    // atomically; this follows its normal impacted rows through QA/production
    // so later stock states carry the corrected value too.
    const splitValuation = (data as JsonRecord | null)?.split_source_valuation as JsonRecord | undefined;
    const sourceLedgerId = toTrimmedString(splitValuation?.source_stock_ledger_id);
    const sourceRate = Number(splitValuation?.valuation_rate);
    if (sourceLedgerId && Number.isFinite(sourceRate) && sourceRate >= 0) {
      await cascadeRecalculate(
        [{ ledgerId: sourceLedgerId, newRate: sourceRate }],
        ctx.auth_user_id,
        toTrimmedString(body.reason) || "AC01 commercial split valuation cascade",
      );
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC01_SAVE_FAILED";
    return ac01ErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

export async function listDeductionTypesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    if (!companyId) {
      return ac01ErrorResponse(req, ctx, "AC01_DEDUCTION_COMPANY_REQUIRED", 400, "company_id is required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement").from("deduction_type_master")
      .select("*").eq("company_id", companyId).eq("is_active", true).order("name", { ascending: true });
    if (error) {
      return ac01ErrorResponse(req, ctx, "AC01_DEDUCTION_LIST_FAILED", 500, "Unable to list deduction types.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC01_DEDUCTION_LIST_FAILED";
    return ac01ErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

export async function createDeductionTypeHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const name = toTrimmedString(body.name);
    if (!companyId || !name) {
      return ac01ErrorResponse(req, ctx, "AC01_DEDUCTION_CREATE_INVALID", 400, "company_id and name are required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return ac01ErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    const forbidden = await requireAC01WriteAccess(req, ctx, companyId);
    if (forbidden) return forbidden;

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement").from("deduction_type_master")
      .insert({
        company_id: companyId,
        name,
        category: toTrimmedString(body.category) || null,
        default_percentage: body.default_percentage != null ? Number(body.default_percentage) : null,
        default_in_landed: body.default_in_landed === true,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (error || !data) {
      return ac01ErrorResponse(req, ctx, "AC01_DEDUCTION_CREATE_FAILED", 500, "Unable to create deduction type.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AC01_DEDUCTION_CREATE_FAILED";
    return ac01ErrorResponse(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}
