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
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";

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

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
async function canWriteAC01(ctx: ProcurementHandlerContext, companyId: string): Promise<boolean> {
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
): JsonRecord {
  const material = materialMap.get(String(grn.material_id));
  const vendor = vendorMap.get(String(grn.vendor_id));
  const company = companyMap.get(String(grn.company_id));
  const po = grn.po_id ? poMap.get(String(grn.po_id)) : null;
  const paymentTerms = po?.payment_term_id ? paymentTermsMap.get(String(po.payment_term_id)) : null;
  const csn = grn.gate_entry_line_id ? csnMap.get(String(grn.gate_entry_line_id)) : null;
  const landedCost = landedCostMap.get(String(grn.id));

  const confirmedRate = grn.confirmed_rate != null ? Number(grn.confirmed_rate) : null;
  const grnRate = grn.grn_rate != null ? Number(grn.grn_rate) : null;
  const effectiveRate = confirmedRate ?? grnRate ?? 0;
  const landedCostTotal = landedCost ? Number(landedCost.total_cost ?? 0) : 0;
  const receivedQty = Number(grn.received_qty ?? 0);
  const costPerUnit = receivedQty > 0 ? effectiveRate + landedCostTotal / receivedQty : effectiveRate;
  const vendorPayable = effectiveRate * receivedQty;

  return {
    grn_id: grn.id,
    grn_number: grn.grn_number,
    csn_number: csn?.csn_display_number ?? csn?.csn_number ?? null,
    company_id: grn.company_id,
    company_code: company?.company_code ?? null,
    supplier_name: vendor?.vendor_name ?? null,
    invoice_number: grn.invoice_number ?? null,
    invoice_date: grn.invoice_date ?? null,
    item_name: material?.material_name ?? null,
    external_code: material?.external_code ?? null,
    grn_qty: grn.received_qty,
    invoice_qty: grn.received_qty,
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
    taxable_value: Number((effectiveRate * receivedQty).toFixed(4)),
    landed_cost_total: landedCostTotal,
    cost_per_unit: Number(costPerUnit.toFixed(4)),
    vendor_payable: Number(vendorPayable.toFixed(4)),
    payment_days: paymentTerms?.credit_days ?? null,
    payment_type: paymentTerms?.name ?? null,
    actual_payment_date: null, // Derived once AC02's Vendor Ledger exists — deliberately deferred.
    revised_payment_date: grn.revised_payment_date ?? null,
    freight_type: po?.freight_term ?? null,
    transporter_id: grn.transporter_id ?? null,
    last_mile_transporter_id: grn.last_mile_transporter_id ?? null,
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

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (rateStatus === "PENDING") query = query.eq("rate_confirmed", false);
    if (rateStatus === "CONFIRMED") query = query.eq("rate_confirmed", true);
    if (dateFrom) query = query.gte(dateColumn, dateFrom);
    if (dateTo) query = query.lte(dateColumn, dateTo);
    if (search) {
      query = query.or(
        `grn_number.ilike.%${search}%,invoice_number.ilike.%${search}%,lr_number.ilike.%${search}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) {
      return ac01ErrorResponse(req, ctx, "AC01_LIST_FAILED", 500, "Unable to list AC01 GRN rows.");
    }

    const rows = (data ?? []) as JsonRecord[];
    const materialIds = [...new Set(rows.map((row) => String(row.material_id)).filter(Boolean))];
    const vendorIds = [...new Set(rows.map((row) => String(row.vendor_id)).filter(Boolean))];
    const companyIds = [...new Set(rows.map((row) => String(row.company_id)).filter(Boolean))];
    const poIds = [...new Set(rows.map((row) => String(row.po_id)).filter(Boolean))];
    const grnIds = rows.map((row) => String(row.id));
    const gateEntryLineIds = [...new Set(rows.map((row) => String(row.gate_entry_line_id)).filter(Boolean))];

    const [materials, vendors, companies, purchaseOrders, landedCosts, qaDocuments, csnRows] = await Promise.all([
      fetchInChunks<JsonRecord>(materialIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, material_name, external_code, base_uom_code").in("id", chunk)),
      fetchInChunks<JsonRecord>(vendorIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("vendor_master")
          .select("id, vendor_name").in("id", chunk)),
      fetchInChunks<JsonRecord>(companyIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("companies")
          .select("id, company_code").in("id", chunk)),
      fetchInChunks<JsonRecord>(poIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("purchase_order")
          .select("id, payment_term_id, freight_term").in("id", chunk)),
      fetchInChunks<JsonRecord>(grnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost")
          .select("id, grn_id, total_cost, created_at").in("grn_id", chunk)),
      fetchInChunks<JsonRecord>(grnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
          .select("id, grn_id, qa_stock_qty").in("grn_id", chunk)),
      fetchInChunks<JsonRecord>(gateEntryLineIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("gate_entry_line")
          .select("id, csn_id").in("id", chunk)),
    ]);

    const paymentTermIds = [...new Set(purchaseOrders.map((po) => String(po.payment_term_id)).filter(Boolean))];
    const csnIds = [...new Set(csnRows.map((row) => String(row.csn_id)).filter(Boolean))];
    const qaDocumentIds = qaDocuments.map((doc) => String(doc.id));

    const [paymentTerms, consignmentNotes, decisionLines] = await Promise.all([
      fetchInChunks<JsonRecord>(paymentTermIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("payment_terms_master")
          .select("id, name, credit_days").in("id", chunk)),
      fetchInChunks<JsonRecord>(csnIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("consignment_note")
          // csn_display_number is not a real column -- it's only ever computed at
          // read time (csn.handlers.ts's enrichTrackerRows); buildListRow already
          // falls back to the raw csn_number below when it's absent.
          .select("id, csn_number, lc_number, lc_opened_date").in("id", chunk)),
      fetchInChunks<JsonRecord>(qaDocumentIds, (chunk) =>
        serviceRoleClient.schema("erp_procurement").from("inward_qa_decision_line")
          .select("qa_document_id, usage_decision, decision_qty").in("qa_document_id", chunk)),
    ]);

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

    const items = rows.map((row) =>
      buildListRow(row, materialMap, vendorMap, companyMap, poMap, paymentTermsMap, csnMap, landedCostMap, udStatusMap),
    );

    return okResponse({ items, total: count ?? items.length }, ctx.request_id, req);
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

    // Membership across ALL the caller's companies (erp_map.user_companies),
    // not just the session's currently-pinned company -- a multi-company user
    // viewing a GRN in a company other than their session's active one must
    // still be let in if they're actually a member there. Matches
    // saveAC01GRNCostHandler's own assertCompanyScope call below; this
    // handler previously compared directly against ctx.context.companyId,
    // which wrongly 403'd legitimate multi-company access.
    try {
      await assertCompanyScope(ctx, String(grn.company_id));
    } catch {
      return ac01ErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: lcRows, error: lcError } = await serviceRoleClient
      .schema("erp_procurement").from("landed_cost").select("*")
      .eq("grn_id", grnId).order("created_at", { ascending: false }).limit(1);
    if (lcError) {
      return ac01ErrorResponse(req, ctx, "AC01_LC_FETCH_FAILED", 500, "Unable to fetch landed cost.");
    }
    const landedCost = (lcRows ?? [])[0] as JsonRecord | undefined;

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

    return okResponse({ ...grn, landed_cost: landedCost ?? null, cost_lines: costLines, deduction_lines: deductionLines }, ctx.request_id, req);
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
      .rpc("save_ac01_grn_cost", {
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
      });

    if (error) {
      return ac01ErrorResponse(req, ctx, "AC01_SAVE_FAILED", 500, error.message ?? "Unable to save AC01 GRN cost.");
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
