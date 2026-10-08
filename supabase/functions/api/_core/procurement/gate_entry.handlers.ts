/*
 * File-ID: 16.4.1
 * File-Path: supabase/functions/api/_core/procurement/gate_entry.handlers.ts
 * Gate: 16.4
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Implement Gate Entry and inbound Gate Exit handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { isSameOrHigher } from "../../_shared/role_ladder.ts";
import { enrichTrackerRows, generateProcurementDocNumber, getCsnById } from "./csn.handlers.ts";
import { listPagination, parseListSearchPage } from "../../_shared/list_pagination.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type GateEntryRow = Record<string, unknown>;
type GateEntryLineRow = Record<string, unknown>;
type PurchaseOrderRow = Record<string, unknown>;
type PurchaseOrderLineRow = Record<string, unknown>;
type CsnRow = Record<string, unknown>;

const GE_HEADER_STATUSES = new Set(["OPEN", "GRN_POSTED", "CANCELLED", "PRUNED"]);
const GE_TYPES = new Set(["INBOUND_PO", "INBOUND_STO"]);
const OPEN_CSN_STATUSES = ["ORD", "TRN", "GED"];
const OPEN_PO_LINE_STATUSES = new Set(["OPEN", "PARTIALLY_RECEIVED"]);
const BULK_DELIVERY_TYPES = new Set(["BULK", "TANKER"]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIsoDate(): string {
  return todayIsoInKolkata();
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function procurementErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline.
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

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = Math.abs(new Date(b).getTime() - new Date(a).getTime());
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchPoLineBundle(
  poLineId: string,
  options: { requireOpen?: boolean } = {},
): Promise<{
  poLine: PurchaseOrderLineRow;
  po: PurchaseOrderRow;
}> {
  const { data: poLine, error: poLineError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("*")
    .eq("id", poLineId)
    .single();

  if (poLineError || !poLine) {
    throw new Error("PO_LINE_NOT_FOUND");
  }

  const requireOpen = options.requireOpen !== false;
  const lineStatus = toUpperTrimmedString(poLine.line_status);
  if (requireOpen && !OPEN_PO_LINE_STATUSES.has(lineStatus)) {
    throw new Error("PO_LINE_NOT_OPEN");
  }

  const { data: po, error: poError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("*")
    .eq("id", String(poLine.po_id))
    .single();

  if (poError || !po) {
    throw new Error("PO_NOT_FOUND");
  }

  return { poLine, po };
}

// CRCP (Cross Company) — PROCUREMENT-DESIGN-DOC.md §3.7 Point 3.2.1/3.2.2.
// Returns true only when crcpEnabled is set AND companyId appears in that
// document's own allow-list junction table -- the document's own company is
// checked by the caller separately (never stored in this table).
async function isCrcpSharedCompany(
  table: "purchase_order_crcp_company" | "stock_transfer_order_crcp_company",
  idColumn: "po_id" | "sto_id",
  documentId: string,
  companyId: string,
  crcpEnabled: boolean,
): Promise<boolean> {
  if (!crcpEnabled || !companyId) return false;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from(table)
    .select("id")
    .eq(idColumn, documentId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

// CRCP (Cross Company) — PROCUREMENT-DESIGN-DOC.md §3.7 Points 3.2.3/3.2.4/3.2.5.
// Called only when a CRCP-shared company (not the document's own company) is
// the one actually raising this GE, and a CSN is linked. Decides full vs.
// partial purely from the CSN's own remaining dispatch_qty at this instant —
// no pre-known ratio, just a direct readout of this actual GE.
// Full: the whole remainder goes to this company — tag consignee_company_id
// on the SAME CSN, no new row.
// Partial: clone into a Sub-CSN carrying exactly this GE's qty as its own
// dispatch_qty (same clone shape as csn.handlers.ts's manual
// createSubCSNHandler, auto-triggered here instead of the "+" button).
// sto_line_id is always nulled on the clone (consignment_note_sto_line_unique
// allows only one CSN per STO line — the mother keeps that ownership);
// sto_id is deliberately left as-is (unlike createSubCSNHandler's classic
// PO-origin clone) so an STO-origin split stays traceable to the same STO
// instead of showing as a "detached" Sub-CSN.
async function resolveCrossCompanyCsnLink(
  csnId: string,
  geQty: number,
  companyId: string,
  actorId: string,
): Promise<string> {
  const mother = await getCsnById(csnId);
  if (!mother) {
    throw new Error("CSN_NOT_FOUND");
  }

  const remainingQty = Number(mother.dispatch_qty ?? 0);
  if (!(remainingQty > 0) || geQty >= remainingQty) {
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        consignee_company_id: companyId,
        last_updated_by: actorId,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", csnId);
    if (error) {
      throw new Error("CRCP_CSN_UPDATE_FAILED");
    }
    return csnId;
  }

  const csnNumber = await generateProcurementDocNumber("CSN");
  const insertPayload: JsonRecord = {
    ...mother,
    id: undefined,
    csn_number: csnNumber,
    mother_csn_id: mother.id,
    is_mother_csn: false,
    consignee_company_id: companyId,
    dispatch_qty: geQty,
    total_received_qty: 0,
    sto_line_id: null,
    gate_entry_id: null,
    gate_entry_date: null,
    grn_id: null,
    grn_date: null,
    received_qty: null,
    created_at: undefined,
    created_by: actorId,
    last_updated_at: null,
    last_updated_by: null,
  };

  const { data: subCsn, error: subCsnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .insert(insertPayload)
    .select("id")
    .single();
  if (subCsnError || !subCsn) {
    throw new Error("CRCP_SUB_CSN_CREATE_FAILED");
  }

  const { error: motherUpdateError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .update({
      dispatch_qty: remainingQty - geQty,
      is_mother_csn: true,
      last_updated_by: actorId,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", csnId);
  if (motherUpdateError) {
    throw new Error("CRCP_MOTHER_CSN_UPDATE_FAILED");
  }

  return String(subCsn.id);
}

// §3.7 "Bulk GE-Creation Drawer" design — Person Name (all GE, not Bulk-only).
// Non-Security department: auto-fill read-only with the logged-in user's own
// name (name only, no user code/ID, per business owner). Security department:
// left blank for the gate user to type manually (mandatory), since Security
// terminals are commonly shared logins across shifts.
async function isSecurityDepartmentUser(ctx: ProcurementHandlerContext): Promise<boolean> {
  const workContextId = ctx.context.workContextId
    || (ctx.context.workContextIds && ctx.context.workContextIds[0]);
  if (!workContextId) return false;
  const { data: wc } = await serviceRoleClient
    .schema("erp_acl")
    .from("work_contexts")
    .select("department_id")
    .eq("work_context_id", workContextId)
    .maybeSingle();
  const departmentId = toTrimmedString((wc as JsonRecord | null)?.department_id);
  if (!departmentId) return false;
  const { data: dept } = await serviceRoleClient
    .schema("erp_master")
    .from("departments")
    .select("department_name")
    .eq("id", departmentId)
    .maybeSingle();
  return toUpperTrimmedString((dept as JsonRecord | null)?.department_name) === "SECURITY";
}

async function resolveGePersonName(
  ctx: ProcurementHandlerContext,
  personNameInput: string,
): Promise<{ personName: string } | { error: string }> {
  if (await isSecurityDepartmentUser(ctx)) {
    if (!personNameInput) {
      return { error: "GE_PERSON_NAME_REQUIRED" };
    }
    return { personName: personNameInput };
  }
  const { data: signup } = await serviceRoleClient
    .schema("erp_core")
    .from("signup_requests")
    .select("name")
    .eq("auth_user_id", ctx.auth_user_id)
    .maybeSingle();
  const ownName = toTrimmedString((signup as JsonRecord | null)?.name);
  return { personName: ownName || personNameInput };
}

// §3.7 "Bulk PO/STO — Effective Date + Cutoff mechanism" — resolves a Bulk
// document's own validity window: [effective_start_date, upper bound), where
// the upper bound is whichever comes first of (a) the next PO/STO's own
// effective_start_date for the same grouping key, or (b) this document's own
// cutoff_date if it was knocked off/cancelled with no successor. Returns null
// upper bound when the window is still open (no successor, no cutoff yet).
async function resolveBulkDocumentWindowUpperBound(
  table: "purchase_order" | "stock_transfer_order",
  documentId: string,
  groupingFilters: Record<string, string>,
  materialId: string,
  currentEffectiveDate: string,
  currentCutoffDate: string | null,
): Promise<string | null> {
  const lineTable = table === "purchase_order" ? "purchase_order_line" : "stock_transfer_order_line";
  let query = serviceRoleClient
    .schema("erp_procurement")
    .from(table)
    .select(`id, effective_start_date, ${lineTable}!inner(material_id)`)
    .neq("id", documentId)
    .not("effective_start_date", "is", null)
    .eq(`${lineTable}.material_id`, materialId)
    .limit(50);
  for (const [column, value] of Object.entries(groupingFilters)) {
    query = query.eq(column, value);
  }
  const { data: candidates } = await query;
  const successorDates = ((candidates ?? []) as JsonRecord[])
    .map((row) => toTrimmedString(row.effective_start_date))
    .filter((date) => date && date > currentEffectiveDate)
    .sort();
  if (successorDates.length > 0) {
    return successorDates[0];
  }
  return currentCutoffDate || null;
}

// Validates a Bulk vendor document (Challan/Invoice) date against the
// document's own effective window. Returns an error code string, or null if
// the date is within range.
function validateBulkDocumentDate(
  documentDate: string,
  windowStart: string,
  windowUpperBound: string | null,
): string | null {
  if (!documentDate) return null;
  if (windowStart && documentDate < windowStart) {
    return "GE_BULK_DOCUMENT_DATE_BEFORE_EFFECTIVE_WINDOW";
  }
  if (windowUpperBound && documentDate >= windowUpperBound) {
    return "GE_BULK_DOCUMENT_DATE_OUTSIDE_EFFECTIVE_WINDOW";
  }
  return null;
}

// §3.7 "Bulk GE-Creation Drawer" — Bulk has no CSN, so these identifier/date
// fields are captured directly at GE and carried forward to GRN unchanged.
// At least one of the four identifier fields is mandatory; a filled
// Challan/Invoice Number makes its own paired Date mandatory. Whichever
// vendor-document date(s) are filled are also checked against the parent
// PO/STO's own Bulk Effective Date window.
async function validateAndPrepareBulkLineFields(
  line: JsonRecord,
  index: number,
  table: "purchase_order" | "stock_transfer_order",
  documentId: string,
  groupingFilters: Record<string, string>,
  materialId: string,
  currentEffectiveDate: string,
  currentCutoffDate: string | null,
): Promise<{ fields: JsonRecord } | { error: string; message: string }> {
  const challanNumber = toTrimmedString(line.bulk_challan_number);
  const challanDate = toTrimmedString(line.bulk_challan_date);
  const invoiceNumber = toTrimmedString(line.bulk_invoice_number);
  const invoiceDate = toTrimmedString(line.bulk_invoice_date);
  const containerNumber = toTrimmedString(line.bulk_container_number);
  const ewaybillNumber = toTrimmedString(line.bulk_ewaybill_number);
  const lrNumber = toTrimmedString(line.bulk_lr_number);

  if (!challanNumber && !invoiceNumber && !containerNumber && !ewaybillNumber) {
    return {
      error: "GE_BULK_IDENTIFIER_REQUIRED",
      message: `Line {n} requires at least one of Challan Number, Invoice Number, Container Number, or Ewaybill Number.`,
    };
  }
  if (challanNumber && !challanDate) {
    return { error: "GE_BULK_CHALLAN_DATE_REQUIRED", message: `Line {n}'s Challan Date is required when Challan Number is entered.` };
  }
  if (invoiceNumber && !invoiceDate) {
    return { error: "GE_BULK_INVOICE_DATE_REQUIRED", message: `Line {n}'s Invoice Date is required when Invoice Number is entered.` };
  }

  if (!currentEffectiveDate) {
    return { error: "GE_BULK_EFFECTIVE_DATE_MISSING", message: `Line {n}'s document has no Effective Start Date configured.` };
  }

  const windowUpperBound = await resolveBulkDocumentWindowUpperBound(
    table, documentId, groupingFilters, materialId, currentEffectiveDate, currentCutoffDate,
  );

  for (const [dateValue, label] of [[challanDate, "Challan"], [invoiceDate, "Invoice"]] as const) {
    if (!dateValue) continue;
    const dateError = validateBulkDocumentDate(dateValue, currentEffectiveDate, windowUpperBound);
    if (dateError) {
      return {
        error: dateError,
        message: `Line {n}'s ${label} Date is outside the document's Bulk Effective Date window.`,
      };
    }
  }

  return {
    fields: {
      bulk_challan_number: challanNumber || null,
      bulk_challan_date: challanDate || null,
      bulk_invoice_number: invoiceNumber || null,
      bulk_invoice_date: invoiceDate || null,
      bulk_container_number: containerNumber || null,
      bulk_ewaybill_number: ewaybillNumber || null,
      bulk_lr_number: lrNumber || null,
    },
  };
}

async function fetchActiveCsnForGateEntry(csnId: string): Promise<CsnRow> {
  const { data: csn, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("id, po_id, po_line_id, sto_id, status")
    .eq("id", csnId)
    .single();

  if (error || !csn) {
    throw new Error("CSN_NOT_FOUND");
  }

  const status = toUpperTrimmedString(csn.status);
  if (!OPEN_CSN_STATUSES.includes(status)) {
    throw new Error("CSN_NOT_OPEN");
  }

  return csn as CsnRow;
}

function effectiveNetWeight(exitRow: Record<string, unknown>): number | null {
  const override = parseNullableNumber(exitRow.net_weight_override);
  if (override !== null) return override;
  return parseNullableNumber(exitRow.net_weight_calculated);
}

async function fetchGateEntryBundle(ctx: ProcurementHandlerContext, gateEntryId: string): Promise<{
  gateEntry: GateEntryRow;
  lines: GateEntryLineRow[];
}> {
  const { data: gateEntry, error: gateEntryError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry")
    .select("*")
    .eq("id", gateEntryId)
    .single();

  if (gateEntryError || !gateEntry) {
    throw new Error("GATE_ENTRY_NOT_FOUND");
  }

  await assertCompanyScope(ctx, String((gateEntry as GateEntryRow).company_id));

  const { data: lines, error: linesError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry_line")
    .select("*")
    .eq("gate_entry_id", gateEntryId)
    .order("line_number", { ascending: true });

  if (linesError) {
    throw new Error("GATE_ENTRY_LINE_FETCH_FAILED");
  }

  return { gateEntry, lines: (lines ?? []) as GateEntryLineRow[] };
}

async function hydrateGateEntry(ctx: ProcurementHandlerContext, gateEntryId: string): Promise<JsonRecord> {
  const { gateEntry, lines } = await fetchGateEntryBundle(ctx, gateEntryId);

  const csnIds = Array.from(new Set(lines.map((l) => toTrimmedString(l.csn_id)).filter(Boolean)));
  const matIds = Array.from(new Set(lines.map((l) => toTrimmedString(l.material_id)).filter(Boolean)));

  const [csns, mats, gateExitResp, grnsResp] = await Promise.all([
    csnIds.length > 0
      ? serviceRoleClient.schema("erp_procurement").from("consignment_note")
          .select("id, csn_number, status, grn_id, gate_entry_id, gate_entry_date, received_qty")
          .in("id", csnIds)
      : Promise.resolve({ data: [], error: null }),
    matIds.length > 0
      ? serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, pace_code, material_name")
          .in("id", matIds)
      : Promise.resolve({ data: [], error: null }),
    serviceRoleClient.schema("erp_procurement").from("gate_exit_inbound")
      .select("*").eq("gate_entry_id", gateEntryId).maybeSingle(),
    serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, status").eq("gate_entry_id", gateEntryId),
  ]);

  if (csns.error) throw new Error("CSN_FETCH_FAILED");
  if (mats.error) throw new Error("MATERIAL_FETCH_FAILED");
  if (gateExitResp.error) throw new Error("GATE_EXIT_FETCH_FAILED");

  const matMap = new Map<string, JsonRecord>();
  for (const m of (mats.data ?? []) as JsonRecord[]) matMap.set(String(m.id), m);

  const linkedGrns = (grnsResp.data ?? []) as JsonRecord[];

  return {
    ...gateEntry,
    lines: lines.map((line) => {
      const mat = matMap.get(String(line.material_id));
      return {
        ...line,
        material_name: mat ? `${mat.pace_code} — ${mat.material_name}` : null,
        linked_csn: (csns.data ?? []).find((csn: JsonRecord) => String(csn.id) === String(line.csn_id)) ?? null,
      };
    }),
    gate_exit_inbound: gateExitResp.data ?? null,
    linked_grns: linkedGrns,
  };
}

async function upsertCsnArrival(
  csnId: string,
  geDate: string,
  gateEntryId: string,
  qty: number,
): Promise<void> {
  const { data: csn, error: csnError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("id, status, total_received_qty")
    .eq("id", csnId)
    .single();

  if (csnError || !csn) {
    throw new Error("CSN_NOT_FOUND");
  }

  const currentStatus = toUpperTrimmedString(csn.status);
  const nextStatus = currentStatus === "TRN" || currentStatus === "ORD"
    ? "GED"
    : currentStatus;
  const totalReceivedQty = parseNullableNumber(csn.total_received_qty) ?? 0;

  const { error: updateError } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .update({
      status: nextStatus,
      pre_ge_status: currentStatus,
      gate_entry_date: geDate,
      gate_entry_id: gateEntryId,
      received_qty: qty,
      total_received_qty: totalReceivedQty + qty,
      last_updated_at: new Date().toISOString(),
      last_updated_by: null,
    })
    .eq("id", csnId);

  if (updateError) {
    throw new Error("CSN_ARRIVAL_UPDATE_FAILED");
  }
}

function distributeNetWeight(lines: GateEntryLineRow[], totalNetWeight: number): GateEntryLineRow[] {
  if (lines.length === 0) return [];

  const weightBasis = lines.map((line) => {
    const gross = parseNullableNumber(line.gross_weight);
    const qty = parsePositiveNumber(line.ge_qty) ?? 0;
    return gross !== null && gross > 0 ? gross : qty;
  });
  const basisTotal = weightBasis.reduce((sum, value) => sum + value, 0);

  if (basisTotal <= 0) {
    const perLine = totalNetWeight / lines.length;
    return lines.map((line) => ({
      ...line,
      net_weight: Number(perLine.toFixed(6)),
      net_weight_is_manual: true,
    }));
  }

  let allocated = 0;
  return lines.map((line, index) => {
    if (index === lines.length - 1) {
      const remaining = Number((totalNetWeight - allocated).toFixed(6));
      return {
        ...line,
        net_weight: remaining,
        net_weight_is_manual: true,
      };
    }
    const allocatedValue = Number(((totalNetWeight * weightBasis[index]) / basisTotal).toFixed(6));
    allocated += allocatedValue;
    return {
      ...line,
      net_weight: allocatedValue,
      net_weight_is_manual: true,
    };
  });
}

// ── Section 145 — Bulk "Order in LOT" ──────────────────────────────────────────
// "1", "01" and "0001" are the same lot: digits only, 1-4 of them, canonicalised to 4.
// Mirrors erp_procurement.normalize_lot_number().
function normalizeLotNumber(input: unknown): string | null {
  const text = String(input ?? "").trim();
  if (!/^[0-9]{1,4}$/.test(text)) return null;
  return Number(text) > 0 ? text.padStart(4, "0") : null;
}

// Live balance of one lot (lot_qty − posted GRNs − Gate Entries not yet GRN'd). Null when the PO
// line has no such lot. excludeGeLineId leaves one GE line out (a GRN must not subtract its own GE).
async function fetchLotBalance(
  poLineId: string,
  lotNumber: string,
  excludeGeLineId?: string,
): Promise<JsonRecord | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("po_lot_balances", { p_po_line_ids: [poLineId], p_exclude_ge_line_id: excludeGeLineId ?? null });
  if (error) {
    console.error("GE_LOT_BALANCE_ERROR", JSON.stringify(error));
    throw new Error("GE_LOT_BALANCE_LOOKUP_FAILED");
  }
  return ((data as JsonRecord[] | null) ?? []).find((row) => toTrimmedString(row.lot_number) === lotNumber) ?? null;
}

export async function createGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    const geDate = toTrimmedString(body.entry_date ?? body.ge_date) || todayIsoDate();
    const vehicleNumber = toTrimmedString(body.vehicle_number);
    const gateStaffId = toTrimmedString(body.gate_staff_id) || ctx.auth_user_id;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!companyId || !vehicleNumber || !gateStaffId || lines.length === 0) {
      return procurementErrorResponse(req, ctx, "GE_CREATE_INVALID", 400, "Company, vehicle, gate staff, and lines are required.");
    }
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return procurementErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    // §4.1 "GE duplicate CSN/line selection across rows" -- the frontend
    // drawers now exclude already-used CSN/STO-line candidates, but this is
    // the actual save-time guard: a stale client (or any other caller) could
    // still submit the same csn_id/sto_line_id on two lines of one GE.
    {
      const seenCsnIds = new Set<string>();
      const seenStoLineIds = new Set<string>();
      for (let index = 0; index < lines.length; index += 1) {
        const dupCsnId = toTrimmedString(lines[index].csn_id);
        if (dupCsnId) {
          if (seenCsnIds.has(dupCsnId)) {
            return procurementErrorResponse(req, ctx, "GE_DUPLICATE_CSN", 400, `Line ${index + 1} selects a CSN already used by another line in this Gate Entry.`);
          }
          seenCsnIds.add(dupCsnId);
        }
        const dupStoLineId = toTrimmedString(lines[index].sto_line_id);
        if (dupStoLineId) {
          if (seenStoLineIds.has(dupStoLineId)) {
            return procurementErrorResponse(req, ctx, "GE_DUPLICATE_STO_LINE", 400, `Line ${index + 1} selects an STO line already used by another line in this Gate Entry.`);
          }
          seenStoLineIds.add(dupStoLineId);
        }
      }
    }

    const personNameResult = await resolveGePersonName(ctx, toTrimmedString(body.person_name));
    if ("error" in personNameResult) {
      return procurementErrorResponse(req, ctx, personNameResult.error, 400, "Person Name is required.");
    }
    const personName = personNameResult.personName;

    const preparedLines: JsonRecord[] = [];
    let geType = "INBOUND_PO";
    // Two lines of one Gate Entry against the same lot must fit the lot's balance together.
    const lotQtyInThisRequest = new Map<string, number>();

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      let resolvedLotNumber: string | null = null;
      const poLineId = toTrimmedString(line.po_line_id);
      const csnId = toTrimmedString(line.csn_id);
      const stoId = toTrimmedString(line.sto_id);
      const stoLineId = toTrimmedString(line.sto_line_id);
      const geQty = parsePositiveNumber(line.ge_qty);
      const uomCode = toTrimmedString(line.uom_code);
      const materialId = toTrimmedString(line.material_id);

      if (!geQty || !uomCode || !materialId) {
        return procurementErrorResponse(req, ctx, "GE_LINE_INVALID", 400, `Line ${index + 1} is missing required quantity, UOM, or material.`);
      }

      if (!poLineId && !stoLineId) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REF_MISSING", 400, `Line ${index + 1} must reference a PO line or STO line.`);
      }

      let resolvedCsnId = toTrimmedString(line.csn_id) || null;

      let poId: string | null = null;
      if (poLineId) {
        const hasCsnReference = Boolean(csnId);
        let activeCsn: CsnRow | null = null;
        if (hasCsnReference) {
          try {
            activeCsn = await fetchActiveCsnForGateEntry(csnId);
          } catch (error) {
            const code = error instanceof Error ? error.message : "CSN_NOT_OPEN";
            const message = code === "CSN_NOT_FOUND" ? "Selected CSN was not found." : "Selected CSN is no longer open for Gate Entry.";
            return procurementErrorResponse(req, ctx, code, code === "CSN_NOT_FOUND" ? 404 : 400, message);
          }
        }

        const { poLine, po } = await fetchPoLineBundle(poLineId, { requireOpen: !hasCsnReference });
        poId = String(poLine.po_id);
        if (activeCsn && toTrimmedString(activeCsn.po_line_id) !== poLineId) {
          return procurementErrorResponse(req, ctx, "GE_CSN_PO_LINE_MISMATCH", 400, `Line ${index + 1} selected CSN does not belong to the referenced PO line.`);
        }
        if (String(po.company_id) !== companyId) {
          const crcpAllowed = await isCrcpSharedCompany(
            "purchase_order_crcp_company", "po_id", String(po.id), companyId, Boolean((po as JsonRecord).crcp_enabled),
          );
          if (!crcpAllowed) {
            return procurementErrorResponse(req, ctx, "GE_COMPANY_SCOPE", 403, `PO line on line ${index + 1} is outside company scope.`);
          }
          // §3.7 Points 3.2.3/3.2.4/3.2.5 — a CRCP-shared company actually
          // raising this GE: resolve full-vs-partial against the CSN's own
          // remaining dispatch_qty now, at GE time (not GRN).
          if (activeCsn) {
            try {
              resolvedCsnId = await resolveCrossCompanyCsnLink(String(activeCsn.id), geQty, companyId, gateStaffId);
            } catch (error) {
              const code = error instanceof Error ? error.message : "CRCP_CSN_RESOLVE_FAILED";
              return procurementErrorResponse(req, ctx, code, 500, `Line ${index + 1} could not resolve the CRCP consignment note.`);
            }
          }
        }
        const deliveryType = toUpperTrimmedString(po.delivery_type);
        if (BULK_DELIVERY_TYPES.has(deliveryType) && parseNullableNumber(line.gross_weight) === null) {
          return procurementErrorResponse(req, ctx, "GE_GROSS_WEIGHT_REQUIRED", 400, `Line ${index + 1} requires gross_weight for BULK/TANKER deliveries.`);
        }
        // §3.7 "Bulk GE-Creation Drawer" + "Effective Date + Cutoff mechanism"
        // — BULK only (not TANKER, which stays on the CSN-based path).
        if (deliveryType === "BULK") {
          // Re-read the live balance on save. The picker is only a preview;
          // another Gate Entry may have reserved the PO while this drawer was
          // open. Posted GRNs are already reflected in po_line.open_qty, so
          // only active GE lines without a DRAFT/POSTED GRN are reserved here.
          const { data: activeGeLines } = await serviceRoleClient
            .schema("erp_procurement").from("gate_entry_line")
            .select("id, ge_qty, gate_entry_id").eq("po_line_id", poLineId);
          const activeHeaderIds = [...new Set((activeGeLines ?? []).map((entry: JsonRecord) => toTrimmedString(entry.gate_entry_id)).filter(Boolean))];
          const { data: activeHeaders } = activeHeaderIds.length > 0
            ? await serviceRoleClient.schema("erp_procurement").from("gate_entry").select("id, status").in("id", activeHeaderIds)
            : { data: [] };
          const liveHeaderIds = new Set((activeHeaders ?? [])
            .filter((header: JsonRecord) => !["CANCELLED", "PRUNED"].includes(toUpperTrimmedString(header.status)))
            .map((header: JsonRecord) => String(header.id)));
          const activeGeLineIds = (activeGeLines ?? [])
            .filter((entry: JsonRecord) => liveHeaderIds.has(toTrimmedString(entry.gate_entry_id)))
            .map((entry: JsonRecord) => String(entry.id));
          const { data: linkedGrns } = activeGeLineIds.length > 0
            ? await serviceRoleClient.schema("erp_procurement").from("goods_receipt")
              .select("gate_entry_line_id, status").in("gate_entry_line_id", activeGeLineIds)
            : { data: [] };
          const grnLineIds = new Set((linkedGrns ?? [])
            .filter((grn: JsonRecord) => ["DRAFT", "POSTED"].includes(toUpperTrimmedString(grn.status)))
            .map((grn: JsonRecord) => toTrimmedString(grn.gate_entry_line_id)));
          const reservedQty = (activeGeLines ?? [])
            .filter((entry: JsonRecord) => liveHeaderIds.has(toTrimmedString(entry.gate_entry_id)) && !grnLineIds.has(toTrimmedString(entry.id)))
            .reduce((sum: number, entry: JsonRecord) => sum + Number(entry.ge_qty ?? 0), 0);
          const availableQty = Math.max(0, Number(poLine.open_qty ?? poLine.ordered_qty ?? 0) - reservedQty);
          if (geQty > availableQty + 0.000001) {
            return procurementErrorResponse(req, ctx, "GE_PO_BALANCE_EXCEEDED", 400,
              `Line ${index + 1} exceeds the PO's live balance (${availableQty.toFixed(6)} ${uomCode}).`);
          }
          // Section 145 -- an Order in LOT PO is received against a lot: the lot number is mandatory,
          // must be an ACTIVE lot of this PO line (the system never creates one here), and the
          // quantity must fit that lot's own balance as well as the PO's (checked above).
          if (po.order_in_lot === true) {
            const rawLot = toTrimmedString(line.lot_number);
            if (!rawLot) {
              return procurementErrorResponse(req, ctx, "GE_LOT_NUMBER_REQUIRED", 400, `Line ${index + 1} needs a Lot Number (this PO is ordered in lots).`);
            }
            const lotNumber = normalizeLotNumber(rawLot);
            if (!lotNumber) {
              return procurementErrorResponse(req, ctx, "GE_LOT_NUMBER_INVALID", 400, `Line ${index + 1}: Lot Number must be 1 to 4 digits, e.g. 1 or 0001.`);
            }
            const lot = await fetchLotBalance(poLineId, lotNumber);
            if (!lot || toUpperTrimmedString(lot.status) !== "ACTIVE") {
              return procurementErrorResponse(req, ctx, "GE_LOT_NOT_FOUND", 404, `Line ${index + 1}: Lot ${lotNumber} does not exist on this PO.`);
            }
            const lotKey = `${poLineId}::${lotNumber}`;
            const alreadyInRequest = lotQtyInThisRequest.get(lotKey) ?? 0;
            const lotBalance = Number(lot.balance_qty ?? 0);
            if (geQty + alreadyInRequest > lotBalance + 0.000001) {
              return procurementErrorResponse(req, ctx, "GE_LOT_BALANCE_EXCEEDED", 400,
                `Line ${index + 1} exceeds Lot ${lotNumber}'s live balance (${lotBalance.toFixed(6)} ${uomCode}).`);
            }
            lotQtyInThisRequest.set(lotKey, alreadyInRequest + geQty);
            resolvedLotNumber = lotNumber;
          }
          const bulkError = await validateAndPrepareBulkLineFields(
            line, index, "purchase_order", String(po.id),
            { vendor_id: toTrimmedString(po.vendor_id), company_id: toTrimmedString(po.company_id) },
            materialId, toTrimmedString(po.effective_start_date), toTrimmedString(po.cutoff_date) || null,
          );
          if ("error" in bulkError) {
            return procurementErrorResponse(req, ctx, bulkError.error, 400, bulkError.message.replace("{n}", String(index + 1)));
          }
          Object.assign(line, bulkError.fields);
        }
      }

      // §133 gap found 2026-09-11 (Codex root-cause audit): the STO branch
      // used to accept sto_id/sto_line_id straight from the client with no
      // ownership/scope/status check at all -- unlike the PO branch above,
      // which validates company scope, open status, and CSN/line linkage.
      // Any caller who could reach this endpoint could stamp any STO id onto
      // a Gate Entry for a company that STO never targeted.
      if (stoLineId) {
        const { data: stoLine, error: stoLineError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("stock_transfer_order_line")
          .select("id, sto_id, line_status")
          .eq("id", stoLineId)
          .maybeSingle();
        if (stoLineError || !stoLine) {
          return procurementErrorResponse(req, ctx, "GE_STO_LINE_NOT_FOUND", 404, `Line ${index + 1}'s STO line was not found.`);
        }
        const resolvedStoId = String(stoLine.sto_id);
        if (stoId && stoId !== resolvedStoId) {
          return procurementErrorResponse(req, ctx, "GE_STO_LINE_MISMATCH", 400, `Line ${index + 1}'s STO line does not belong to the referenced STO.`);
        }

        const csnHasStoReference = Boolean(csnId);
        let activeStoCsn: CsnRow | null = null;
        if (csnHasStoReference) {
          try {
            activeStoCsn = await fetchActiveCsnForGateEntry(csnId);
          } catch (error) {
            const code = error instanceof Error ? error.message : "CSN_NOT_OPEN";
            const message = code === "CSN_NOT_FOUND" ? "Selected CSN was not found." : "Selected CSN is no longer open for Gate Entry.";
            return procurementErrorResponse(req, ctx, code, code === "CSN_NOT_FOUND" ? 404 : 400, message);
          }
          if (toTrimmedString(activeStoCsn.sto_id) !== resolvedStoId) {
            return procurementErrorResponse(req, ctx, "GE_CSN_STO_MISMATCH", 400, `Line ${index + 1} selected CSN does not belong to the referenced STO.`);
          }
        }
        if (!csnHasStoReference && toUpperTrimmedString(stoLine.line_status) !== "OPEN") {
          return procurementErrorResponse(req, ctx, "GE_STO_LINE_NOT_OPEN", 400, `Line ${index + 1}'s STO line is not open for Gate Entry.`);
        }

        const { data: sto, error: stoError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("stock_transfer_order")
          .select("id, sending_company_id, receiving_company_id, status, crcp_enabled, delivery_type, effective_start_date, cutoff_date")
          .eq("id", resolvedStoId)
          .maybeSingle();
        if (stoError || !sto) {
          return procurementErrorResponse(req, ctx, "GE_STO_NOT_FOUND", 404, `Line ${index + 1}'s STO was not found.`);
        }
        if (String(sto.receiving_company_id) !== companyId) {
          const stoCrcpAllowed = await isCrcpSharedCompany(
            "stock_transfer_order_crcp_company", "sto_id", String(sto.id), companyId, Boolean((sto as JsonRecord).crcp_enabled),
          );
          if (!stoCrcpAllowed) {
            return procurementErrorResponse(req, ctx, "GE_COMPANY_SCOPE", 403, `STO on line ${index + 1} is outside company scope.`);
          }
          if (activeStoCsn) {
            try {
              resolvedCsnId = await resolveCrossCompanyCsnLink(String(activeStoCsn.id), geQty, companyId, gateStaffId);
            } catch (error) {
              const code = error instanceof Error ? error.message : "CRCP_CSN_RESOLVE_FAILED";
              return procurementErrorResponse(req, ctx, code, 500, `Line ${index + 1} could not resolve the CRCP consignment note.`);
            }
          }
        }
        if (!["CREATED", "DISPATCHED"].includes(toUpperTrimmedString(sto.status))) {
          return procurementErrorResponse(req, ctx, "GE_STO_NOT_OPEN", 400, `Line ${index + 1}'s STO is not open for receiving.`);
        }
        const stoDeliveryType = toUpperTrimmedString(sto.delivery_type);
        if (BULK_DELIVERY_TYPES.has(stoDeliveryType) && parseNullableNumber(line.gross_weight) === null) {
          return procurementErrorResponse(req, ctx, "GE_GROSS_WEIGHT_REQUIRED", 400, `Line ${index + 1} requires gross_weight for BULK/TANKER deliveries.`);
        }
        // §3.7 "Bulk GE-Creation Drawer" + "Effective Date + Cutoff mechanism"
        // -- STO twin of the PO branch above, grouped by sending/receiving
        // company instead of vendor (STO has no external vendor).
        if (stoDeliveryType === "BULK") {
          const bulkError = await validateAndPrepareBulkLineFields(
            line, index, "stock_transfer_order", resolvedStoId,
            { sending_company_id: toTrimmedString(sto.sending_company_id), receiving_company_id: toTrimmedString(sto.receiving_company_id) },
            materialId, toTrimmedString(sto.effective_start_date), toTrimmedString(sto.cutoff_date) || null,
          );
          if ("error" in bulkError) {
            return procurementErrorResponse(req, ctx, bulkError.error, 400, bulkError.message.replace("{n}", String(index + 1)));
          }
          Object.assign(line, bulkError.fields);
        }
      }

      if (stoId || stoLineId) {
        geType = "INBOUND_STO";
      }

      preparedLines.push({
        line_number: index + 1,
        po_id: poId,
        po_line_id: poLineId || null,
        sto_id: stoId || null,
        sto_line_id: stoLineId || null,
        csn_id: resolvedCsnId,
        material_id: materialId,
        ge_qty: geQty,
        uom_code: uomCode,
        challan_or_invoice_no: toTrimmedString(line.challan_or_invoice_no) || null,
        rst_number: toTrimmedString(line.rst_number) || null,
        gross_weight: parseNullableNumber(line.gross_weight),
        tare_weight: parseNullableNumber(line.tare_weight),
        net_weight: parseNullableNumber(line.net_weight),
        net_weight_is_manual: Boolean(line.net_weight_is_manual),
        bulk_challan_number: toTrimmedString(line.bulk_challan_number) || null,
        bulk_challan_date: toTrimmedString(line.bulk_challan_date) || null,
        bulk_invoice_number: toTrimmedString(line.bulk_invoice_number) || null,
        bulk_invoice_date: toTrimmedString(line.bulk_invoice_date) || null,
        bulk_container_number: toTrimmedString(line.bulk_container_number) || null,
        bulk_ewaybill_number: toTrimmedString(line.bulk_ewaybill_number) || null,
        bulk_lr_number: toTrimmedString(line.bulk_lr_number) || null,
        lot_number: resolvedLotNumber,
      });
    }

    if (!GE_TYPES.has(geType)) {
      return procurementErrorResponse(req, ctx, "GE_TYPE_INVALID", 400, "Invalid gate entry type.");
    }

    // A vehicle cannot open a new gate entry while an earlier gate entry for
    // the same vehicle is still on-site (i.e. has not been gate-exited yet).
    const { data: vehicleGEs, error: vehicleGEsError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("id, ge_number")
      .eq("vehicle_number", vehicleNumber)
      .not("status", "in", '("PRUNED","CANCELLED")');

    if (vehicleGEsError) {
      return procurementErrorResponse(req, ctx, "GE_VEHICLE_CHECK_FAILED", 500, "Unable to validate vehicle gate status.");
    }

    if ((vehicleGEs ?? []).length > 0) {
      const geIds = vehicleGEs.map((g) => String((g as JsonRecord).id));
      const { data: exits, error: exitsError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_exit_inbound")
        .select("gate_entry_id")
        .in("gate_entry_id", geIds);

      if (exitsError) {
        return procurementErrorResponse(req, ctx, "GE_VEHICLE_CHECK_FAILED", 500, "Unable to validate vehicle gate status.");
      }

      const exitedIds = new Set((exits ?? []).map((e) => String((e as JsonRecord).gate_entry_id)));
      const pendingGE = (vehicleGEs as JsonRecord[]).find((g) => !exitedIds.has(String(g.id)));

      if (pendingGE) {
        return procurementErrorResponse(
          req, ctx, "GE_VEHICLE_NOT_EXITED", 400,
          `Vehicle ${vehicleNumber} already has an open gate entry (${pendingGE.ge_number}) that has not been gate-exited yet.`,
        );
      }
    }

    const geNumber = await generateProcurementDocNumber("GE");
    const { data: gateEntry, error: gateEntryError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .insert({
        ge_number: geNumber,
        ge_date: geDate,
        company_id: companyId,
        ge_type: geType,
        vehicle_number: vehicleNumber,
        driver_name: toTrimmedString(body.driver_name) || null,
        gate_staff_id: gateStaffId,
        person_name: personName,
        status: "OPEN",
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (gateEntryError || !gateEntry) {
      return procurementErrorResponse(req, ctx, "GE_CREATE_FAILED", 500, "Unable to create gate entry.");
    }

    const linePayload = preparedLines.map((line) => ({
      gate_entry_id: gateEntry.id,
      ...line,
    }));
    const { error: linesError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .insert(linePayload);

    if (linesError) {
      return procurementErrorResponse(req, ctx, "GE_LINE_CREATE_FAILED", 500, "Unable to create gate entry lines.");
    }

    for (const line of preparedLines) {
      const csnId = toTrimmedString(line.csn_id);
      if (csnId) {
        await upsertCsnArrival(csnId, geDate, String(gateEntry.id), Number(line.ge_qty));
      }
    }

    return okResponse(await hydrateGateEntry(ctx, String(gateEntry.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_CREATE_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : message.includes("REQUIRED") || message.includes("INVALID") ? 400 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function listGateEntriesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const { page, perPage: limit, offset, search } = parseListSearchPage(url);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("*", { count: "exact" })
      .order("ge_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyId) query = query.eq("company_id", companyId);
    if (status && GE_HEADER_STATUSES.has(status)) query = query.eq("status", status);
    if (dateFrom) query = query.gte("ge_date", dateFrom);
    if (dateTo) query = query.lte("ge_date", dateTo);
    if (search) query = query.or(`ge_number.ilike.%${search}%,vehicle_number.ilike.%${search}%,driver_name.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) {
      return procurementErrorResponse(req, ctx, "GE_LIST_FAILED", 500, "Unable to list gate entries.");
    }

    const rows = data ?? [];
    let items = rows as JsonRecord[];

    if (rows.length > 0) {
      const geIds = rows.map((r) => String((r as JsonRecord).id));
      const { data: lineAgg } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .select("gate_entry_id, ge_qty")
        .in("gate_entry_id", geIds);

      const aggMap = new Map<string, { num_lines: number; total_qty: number }>();
      for (const line of (lineAgg ?? []) as JsonRecord[]) {
        const geid = String(line.gate_entry_id);
        const existing = aggMap.get(geid) ?? { num_lines: 0, total_qty: 0 };
        existing.num_lines += 1;
        existing.total_qty += Number(line.ge_qty ?? 0);
        aggMap.set(geid, existing);
      }

      items = rows.map((r) => {
        const agg = aggMap.get(String((r as JsonRecord).id)) ?? { num_lines: 0, total_qty: 0 };
        return { ...(r as JsonRecord), num_lines: agg.num_lines, total_qty: Number(agg.total_qty.toFixed(6)) };
      });
    }

    return okResponse({ items, total: count ?? items.length, limit, offset, pagination: listPagination(page, limit, count ?? items.length) }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function getGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateEntryId = getIdFromPath(req);
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GE_ID_REQUIRED", 400, "Gate entry id is required.");
    }
    return okResponse(await hydrateGateEntry(ctx, gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_FETCH_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function getGateEntryByNumberHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const geNumber = toTrimmedString(url.searchParams.get("ge_number"));
    if (!geNumber) {
      return procurementErrorResponse(req, ctx, "GE_NUMBER_REQUIRED", 400, "ge_number is required.");
    }

    const { data: gateEntry, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("id")
      .eq("ge_number", geNumber)
      .maybeSingle();

    if (error || !gateEntry) {
      return procurementErrorResponse(req, ctx, "GE_NOT_FOUND", 404, "Gate entry not found.");
    }

    return okResponse(await hydrateGateEntry(ctx, String(gateEntry.id)), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_FETCH_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function updateGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateEntryId = getIdFromPath(req);
    const body = await parseBody(req);
    const { gateEntry } = await fetchGateEntryBundle(ctx, gateEntryId);

    if (toUpperTrimmedString(gateEntry.status) !== "OPEN") {
      return procurementErrorResponse(req, ctx, "GE_NOT_OPEN", 400, "Only OPEN gate entries can be updated.");
    }

    const headerPatch: JsonRecord = {};
    const geDate = toTrimmedString(body.entry_date ?? body.ge_date);
    const vehicleNumber = toTrimmedString(body.vehicle_number);
    const driverName = toTrimmedString(body.driver_name);
    const remarks = toTrimmedString(body.remarks);
    if (geDate) headerPatch.ge_date = geDate;
    if (vehicleNumber) headerPatch.vehicle_number = vehicleNumber;
    if (driverName || body.driver_name === null) headerPatch.driver_name = driverName || null;
    if (remarks || body.remarks === null) headerPatch.remarks = remarks || null;
    headerPatch.last_updated_at = new Date().toISOString();

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .update(headerPatch)
      .eq("id", gateEntryId);

    if (headerError) {
      return procurementErrorResponse(req, ctx, "GE_UPDATE_FAILED", 500, "Unable to update gate entry.");
    }

    if (Array.isArray(body.lines)) {
      const deleteResp = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .delete()
        .eq("gate_entry_id", gateEntryId);
      if (deleteResp.error) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to replace gate entry lines.");
      }

      const lineReq = new Request(req.url, {
        method: "POST",
        body: JSON.stringify({
          company_id: gateEntry.company_id,
          entry_date: geDate || gateEntry.ge_date,
          vehicle_number: vehicleNumber || gateEntry.vehicle_number,
          driver_name: driverName || gateEntry.driver_name,
          gate_staff_id: gateEntry.gate_staff_id,
          remarks: remarks || gateEntry.remarks,
          lines: body.lines,
        }),
        headers: req.headers,
      });

      const createResp = await createGateEntryHandler(lineReq, ctx);
      const createJson = await createResp.json();
      if (!createResp.ok || !createJson?.ok) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to replace gate entry lines.");
      }

      await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry")
        .delete()
        .eq("id", String(createJson.data.id));

      const { error: tempLineDeleteError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("gate_entry_line")
        .delete()
        .eq("gate_entry_id", String(createJson.data.id));
      if (tempLineDeleteError) {
        return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to finalize gate entry line replacement.");
      }

      const recreatedLines = Array.isArray(createJson.data.lines) ? createJson.data.lines : [];
      if (recreatedLines.length > 0) {
        const { error: insertError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("gate_entry_line")
          .insert(
            recreatedLines.map((line: JsonRecord) => ({
              gate_entry_id: gateEntryId,
              line_number: line.line_number,
              po_id: line.po_id,
              po_line_id: line.po_line_id,
              sto_id: line.sto_id,
              sto_line_id: line.sto_line_id,
              csn_id: line.csn_id,
              material_id: line.material_id,
              ge_qty: line.ge_qty,
              uom_code: line.uom_code,
              challan_or_invoice_no: line.challan_or_invoice_no,
              rst_number: line.rst_number,
              gross_weight: line.gross_weight,
              tare_weight: line.tare_weight,
              net_weight: line.net_weight,
              net_weight_is_manual: line.net_weight_is_manual,
              // Section 145 -- the lot a truck is received against must survive an edit; the Bulk
              // document fields (re-validated by the create call above) were being dropped here too.
              lot_number: line.lot_number ?? null,
              bulk_challan_number: line.bulk_challan_number ?? null,
              bulk_challan_date: line.bulk_challan_date ?? null,
              bulk_invoice_number: line.bulk_invoice_number ?? null,
              bulk_invoice_date: line.bulk_invoice_date ?? null,
              bulk_container_number: line.bulk_container_number ?? null,
              bulk_ewaybill_number: line.bulk_ewaybill_number ?? null,
              bulk_lr_number: line.bulk_lr_number ?? null,
            })),
          );
        if (insertError) {
          return procurementErrorResponse(req, ctx, "GE_LINE_REPLACE_FAILED", 500, "Unable to finalize gate entry line replacement.");
        }
      }
    }

    return okResponse(await hydrateGateEntry(ctx, gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_UPDATE_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : message.includes("OPEN") ? 400 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

// §3.7 "Bulk GE-Creation Drawer" — lets the Create GE page prefill/lock the
// Person Name field before the user ever submits: Security department users
// get an empty, mandatory-manual field; everyone else gets their own name,
// read-only.
export async function getGePersonNameContextHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const isSecurity = await isSecurityDepartmentUser(ctx);
    if (isSecurity) {
      return okResponse({ is_security: true, person_name: null }, ctx.request_id, req);
    }
    const { data: signup } = await serviceRoleClient
      .schema("erp_core")
      .from("signup_requests")
      .select("name")
      .eq("auth_user_id", ctx.auth_user_id)
      .maybeSingle();
    const ownName = toTrimmedString((signup as JsonRecord | null)?.name);
    return okResponse({ is_security: false, person_name: ownName || null }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_PERSON_NAME_CONTEXT_FAILED";
    return procurementErrorResponse(req, ctx, message, 500, message);
  }
}

export async function listOpenCSNsForGEHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    // CRCP (Cross Company) — §3.7 Point 3.2.3 drawer-visibility fix. A CSN's
    // own company_id is always the issuing/mother company; a CRCP-shared
    // company also needs to see it here, same pattern as
    // listOpenPOsForGEHandler/listOpenSTOsForGEHandler above.
    const [{ data: crcpPoRows }, { data: crcpStoRows }] = await Promise.all([
      serviceRoleClient.schema("erp_procurement").from("purchase_order_crcp_company").select("po_id").eq("company_id", companyId),
      serviceRoleClient.schema("erp_procurement").from("stock_transfer_order_crcp_company").select("sto_id").eq("company_id", companyId),
    ]);
    const crcpPoIds = [...new Set((crcpPoRows ?? []).map((row: JsonRecord) => String(row.po_id)))];
    const crcpStoIds = [...new Set((crcpStoRows ?? []).map((row: JsonRecord) => String(row.sto_id)))];

    let csnQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .select(
        "id, csn_number, csn_type, status, company_id, po_id, po_line_id, sto_id, " +
        "material_id, vendor_id, dispatch_qty, po_qty, po_uom_code, " +
        "invoice_number, boe_number, bl_date, lr_date, lr_number, delivery_type"
      )
      .in("status", OPEN_CSN_STATUSES)
      .order("created_at", { ascending: false });
    if (crcpPoIds.length > 0 || crcpStoIds.length > 0) {
      const orClauses = [`company_id.eq.${companyId}`];
      if (crcpPoIds.length > 0) orClauses.push(`po_id.in.(${crcpPoIds.join(",")})`);
      if (crcpStoIds.length > 0) orClauses.push(`sto_id.in.(${crcpStoIds.join(",")})`);
      csnQuery = csnQuery.or(orClauses.join(","));
    } else {
      csnQuery = csnQuery.eq("company_id", companyId);
    }
    const { data, error } = await csnQuery;

    if (error) {
      return procurementErrorResponse(req, ctx, "CSN_OPEN_LIST_FAILED", 500, "Unable to list open CSNs.");
    }

    const items = await enrichTrackerRows((data ?? []) as CsnRow[]);

    return okResponse({ items }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSN_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function listOpenPOsForGEHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    // CRCP (Cross Company) — a PO's own company always sees it; additionally
    // surface POs where this company was CRCP-shared (§3.7 Point 3.2.1),
    // so a shared company's gate staff can find it too.
    const { data: crcpRows } = await serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order_crcp_company")
      .select("po_id")
      .eq("company_id", companyId);
    const crcpPoIds = [...new Set((crcpRows ?? []).map((row) => String((row as JsonRecord).po_id)))];

    let poQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("purchase_order")
      .select("id, po_number, delivery_type, vendor_id, status, company_id, crcp_enabled, effective_start_date, cutoff_date, order_in_lot")
      .in("status", ["CONFIRMED", "PARTIALLY_RECEIVED"])
      .order("created_at", { ascending: false });
    poQuery = crcpPoIds.length > 0
      ? poQuery.or(`company_id.eq.${companyId},id.in.(${crcpPoIds.join(",")})`)
      : poQuery.eq("company_id", companyId);
    const { data: pos, error: posError } = await poQuery;

    if (posError) {
      return procurementErrorResponse(req, ctx, "PO_OPEN_LIST_FAILED", 500, "Unable to list open POs.");
    }

    const poIds = (pos ?? []).map((p) => String(p.id));
    const vendorIds = [...new Set((pos ?? []).map((p: JsonRecord) => toTrimmedString(p.vendor_id)).filter(Boolean))];
    let lines: JsonRecord[] = [];
    if (poIds.length > 0) {
      const { data: lineData, error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order_line")
        .select("id, po_id, material_id, po_uom_code, line_status, ordered_qty, open_qty")
        .in("po_id", poIds)
        .in("line_status", ["OPEN", "PARTIALLY_RECEIVED"]);

      if (!lineError) {
        lines = (lineData ?? []) as JsonRecord[];
      }
    }

    // The Bulk GE drawer identifies the selected PO by both document number
    // and vendor.  POs only carry vendor_id, so resolve the display values
    // here rather than leaving a valid Bulk PO drawer looking incomplete.
    const { data: vendorRows, error: vendorError } = vendorIds.length > 0
      ? await serviceRoleClient
        .schema("erp_master")
        .from("vendor_master")
        .select("id, vendor_code, vendor_name")
        .in("id", vendorIds)
      : { data: [], error: null };
    if (vendorError) {
      return procurementErrorResponse(req, ctx, "PO_OPEN_VENDOR_LOOKUP_FAILED", 500, "Unable to resolve PO vendors.");
    }
    const vendorMap = new Map((vendorRows ?? []).map((vendor: JsonRecord) => [String(vendor.id), vendor]));

    const lineMatIds = [...new Set(lines.map((l) => l.material_id).filter(Boolean))] as string[];
    const lineMatMap = new Map<string, string>();
    if (lineMatIds.length > 0) {
      const { data: mats } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, material_name")
        .in("id", lineMatIds);
      for (const m of mats ?? []) lineMatMap.set(String(m.id), String(m.material_name ?? ""));
    }

    // `open_qty` already excludes successfully posted GRNs. Reserve only
    // active Gate Entries that have not reached a GRN yet, otherwise a PO
    // would be double-subtracted. Pruned/cancelled GEs are deliberately not
    // reserved, so their balance returns automatically.
    const poLineIds = lines.map((line) => String(line.id));
    const [existingGeLineResp, existingGrnResp] = await Promise.all([
      poLineIds.length > 0
        ? fetchInChunks<JsonRecord>(poLineIds, (idChunk) => serviceRoleClient
            .schema("erp_procurement").from("gate_entry_line")
            .select("id, po_line_id, ge_qty, gate_entry_id").in("po_line_id", idChunk))
        : Promise.resolve([] as JsonRecord[]),
      poLineIds.length > 0
        ? fetchInChunks<JsonRecord>(poLineIds, (idChunk) => serviceRoleClient
            .schema("erp_procurement").from("goods_receipt")
            .select("gate_entry_line_id, status").in("po_line_id", idChunk))
        : Promise.resolve([] as JsonRecord[]),
    ]);
    const existingGeLines = existingGeLineResp as JsonRecord[];
    const existingGeHeaderIds = [...new Set(existingGeLines.map((line) => toTrimmedString(line.gate_entry_id)).filter(Boolean))];
    const { data: existingGeHeaders } = existingGeHeaderIds.length > 0
      ? await serviceRoleClient.schema("erp_procurement").from("gate_entry").select("id, status").in("id", existingGeHeaderIds)
      : { data: [] };
    const activeGeIds = new Set((existingGeHeaders ?? [])
      .filter((header: JsonRecord) => !["CANCELLED", "PRUNED"].includes(toUpperTrimmedString(header.status)))
      .map((header: JsonRecord) => String(header.id)));
    const grnByGeLine = new Set((existingGrnResp as JsonRecord[])
      .filter((grn) => ["DRAFT", "POSTED"].includes(toUpperTrimmedString(grn.status)))
      .map((grn) => toTrimmedString(grn.gate_entry_line_id)));
    const reservedByPoLine = new Map<string, number>();
    for (const geLine of existingGeLines) {
      if (!activeGeIds.has(toTrimmedString(geLine.gate_entry_id)) || grnByGeLine.has(toTrimmedString(geLine.id))) continue;
      const poLineId = toTrimmedString(geLine.po_line_id);
      reservedByPoLine.set(poLineId, (reservedByPoLine.get(poLineId) ?? 0) + Number(geLine.ge_qty ?? 0));
    }

    // Section 145 -- lots (ACTIVE only) with live balances, for the Order in LOT drawer, fetched
    // only for the lines of POs that actually carry the flag.
    const lotPoIds = new Set((pos ?? []).filter((po: JsonRecord) => po.order_in_lot === true).map((po: JsonRecord) => String(po.id)));
    const lotLineIds = lines.filter((line) => lotPoIds.has(String(line.po_id))).map((line) => String(line.id));
    const lotsByPoLine = new Map<string, JsonRecord[]>();
    if (lotLineIds.length > 0) {
      const lotChunks: string[][] = [];
      for (let i = 0; i < lotLineIds.length; i += 100) lotChunks.push(lotLineIds.slice(i, i + 100));
      const lotResponses = await Promise.all(lotChunks.map((chunk) =>
        serviceRoleClient.schema("erp_procurement").rpc("po_lot_balances", { p_po_line_ids: chunk, p_exclude_ge_line_id: null })));
      for (const response of lotResponses) {
        if (response.error) {
          return procurementErrorResponse(req, ctx, "PO_OPEN_LOT_LOOKUP_FAILED", 500, "Unable to load PO lots.");
        }
        for (const lot of ((response.data as JsonRecord[] | null) ?? [])) {
          if (toUpperTrimmedString(lot.status) !== "ACTIVE") continue;
          const key = toTrimmedString(lot.po_line_id);
          const list = lotsByPoLine.get(key) ?? [];
          list.push({
            lot_number: lot.lot_number,
            lot_qty: Number(lot.lot_qty ?? 0),
            delivery_date: lot.delivery_date,
            balance_qty: Number(lot.balance_qty ?? 0),
          });
          lotsByPoLine.set(key, list);
        }
      }
      for (const list of lotsByPoLine.values()) {
        list.sort((a, b) => toTrimmedString(a.lot_number).localeCompare(toTrimmedString(b.lot_number)));
      }
    }

    const linesMap = new Map<string, JsonRecord[]>();
    for (const line of lines) {
      const poId = String(line.po_id);
      if (!linesMap.has(poId)) linesMap.set(poId, []);
      const openQty = Number(line.open_qty ?? line.ordered_qty ?? 0);
      const reservedQty = Number((reservedByPoLine.get(String(line.id)) ?? 0).toFixed(6));
      const availableQty = Number(Math.max(0, openQty - reservedQty).toFixed(6));
      linesMap.get(poId)!.push({
        ...line,
        material_name: lineMatMap.get(String(line.material_id)) ?? null,
        open_qty: openQty,
        pending_ge_qty: reservedQty,
        available_ge_qty: availableQty,
        expected_qty: availableQty,
        lots: lotsByPoLine.get(String(line.id)) ?? [],
      });
    }

    const result = (pos ?? []).map((po: JsonRecord) => {
      const vendor = vendorMap.get(toTrimmedString(po.vendor_id));
      return {
        ...po,
        vendor_code: vendor?.vendor_code ?? null,
        vendor_name: vendor?.vendor_name ?? null,
        lines: linesMap.get(String(po.id)) ?? [],
      };
    });

    // §3.7 "Bulk GE-Creation Drawer" — surface each BULK PO's own Effective
    // Date window upper bound so the drawer can validate Challan/Invoice
    // dates in real time, without a round trip per keystroke. INDEPENDENT
    // per PO (§8B), resolved in parallel.
    await Promise.all(result.map(async (po: JsonRecord) => {
      const deliveryType = toUpperTrimmedString((po as JsonRecord).delivery_type);
      const materialId = toTrimmedString((po.lines as JsonRecord[] | undefined)?.[0]?.material_id);
      const effectiveStartDate = toTrimmedString((po as JsonRecord).effective_start_date);
      if (deliveryType !== "BULK" || !materialId || !effectiveStartDate) return;
      (po as JsonRecord).bulk_window_upper_bound = await resolveBulkDocumentWindowUpperBound(
        "purchase_order", String(po.id),
        { vendor_id: toTrimmedString((po as JsonRecord).vendor_id), company_id: toTrimmedString((po as JsonRecord).company_id) },
        materialId, effectiveStartDate, toTrimmedString((po as JsonRecord).cutoff_date) || null,
      );
    }));

    return okResponse({ items: result }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PO_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

// §111 (2026-07-25) — mirrors listOpenPOsForGEHandler exactly, but for
// INTER_PLANT STOs: Gate Entry today could only search by PO number, so an
// STO-originated shipment (no po_id at all) had no way to be found at the
// gate. GE happens at the RECEIVING company, so this filters on
// receiving_company_id (not sending_company_id).
export async function listOpenSTOsForGEHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);

    // CRCP (Cross Company) — same pattern as listOpenPOsForGEHandler above.
    const { data: stoCrcpRows } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_crcp_company")
      .select("sto_id")
      .eq("company_id", companyId);
    const crcpStoIds = [...new Set((stoCrcpRows ?? []).map((row) => String((row as JsonRecord).sto_id)))];

    let stoQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id, sto_number, sto_type, sending_company_id, receiving_company_id, status, crcp_enabled, delivery_type, effective_start_date, cutoff_date")
      .in("status", ["CREATED", "DISPATCHED"])
      .order("created_at", { ascending: false });
    stoQuery = crcpStoIds.length > 0
      ? stoQuery.or(`receiving_company_id.eq.${companyId},id.in.(${crcpStoIds.join(",")})`)
      : stoQuery.eq("receiving_company_id", companyId);
    const { data: stos, error: stosError } = await stoQuery;

    if (stosError) {
      return procurementErrorResponse(req, ctx, "STO_OPEN_LIST_FAILED", 500, "Unable to list open STOs.");
    }

    const stoIds = (stos ?? []).map((s) => String(s.id));
    let lines: JsonRecord[] = [];
    if (stoIds.length > 0) {
      const { data: lineData, error: lineError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .select("id, sto_id, material_id, uom_code, quantity, line_status")
        .in("sto_id", stoIds)
        .eq("line_status", "OPEN");

      if (!lineError) {
        lines = (lineData ?? []) as JsonRecord[];
      }
    }

    const lineMatIds = [...new Set(lines.map((l) => l.material_id).filter(Boolean))] as string[];
    const lineMatMap = new Map<string, string>();
    if (lineMatIds.length > 0) {
      const { data: mats } = await serviceRoleClient
        .schema("erp_master")
        .from("material_master")
        .select("id, material_name")
        .in("id", lineMatIds);
      for (const m of mats ?? []) lineMatMap.set(String(m.id), String(m.material_name ?? ""));
    }

    // §3.7 STO GE-Creation Drawer design — each STO line's CSN (linked via
    // sto_line_id, one per line, auto-created at STO approval time) already
    // carries the sending company's dispatch_qty and — once the sending side
    // posts its PGI+Invoice (§113.15/116) — invoice/LR/BOE details. This is
    // the "Expected qty" and the Invoice/LR prefill for the drawer table,
    // reusing the exact same CSN fields the PO/CSN drawer already reads.
    const lineIds = lines.map((l) => String(l.id));
    const csnByStoLineId = new Map<string, JsonRecord>();
    let motherCsnMap = new Map<string, JsonRecord>();
    if (lineIds.length > 0) {
      const { data: csnRows } = await serviceRoleClient
        .schema("erp_procurement")
        .from("consignment_note")
        .select("id, csn_number, sto_line_id, dispatch_qty, invoice_number, invoice_date, lr_number, lr_date, boe_number, mother_csn_id, status")
        .in("sto_line_id", lineIds);
      for (const row of (csnRows ?? []) as JsonRecord[]) {
        csnByStoLineId.set(String(row.sto_line_id), row);
      }

      // Distribution STO header traceability (drawer header) — Mother PO
      // Number/Invoice/BOE, resolved via each line's CSN -> its mother_csn_id
      // -> the Mother CSN's own po_id/invoice_number/boe_number.
      const motherCsnIds = [...new Set(
        Array.from(csnByStoLineId.values()).map((row) => toTrimmedString(row.mother_csn_id)).filter(Boolean),
      )];
      if (motherCsnIds.length > 0) {
        const { data: motherRows } = await serviceRoleClient
          .schema("erp_procurement")
          .from("consignment_note")
          .select("id, po_id, invoice_number, boe_number")
          .in("id", motherCsnIds);
        const motherPoIds = [...new Set((motherRows ?? []).map((row: JsonRecord) => toTrimmedString(row.po_id)).filter(Boolean))];
        const motherPoNumberMap = new Map<string, string>();
        if (motherPoIds.length > 0) {
          const { data: motherPos } = await serviceRoleClient
            .schema("erp_procurement")
            .from("purchase_order")
            .select("id, po_number")
            .in("id", motherPoIds);
          for (const po of motherPos ?? []) motherPoNumberMap.set(String(po.id), String(po.po_number ?? ""));
        }
        motherCsnMap = new Map(
          (motherRows ?? []).map((row: JsonRecord) => [
            String(row.id),
            {
              mother_po_number: motherPoNumberMap.get(toTrimmedString((row as JsonRecord).po_id)) ?? null,
              mother_invoice_number: (row as JsonRecord).invoice_number ?? null,
              mother_boe_number: (row as JsonRecord).boe_number ?? null,
            },
          ]),
        );
      }
    }

    const linesMap = new Map<string, JsonRecord[]>();
    for (const line of lines) {
      const stoId = String(line.sto_id);
      if (!linesMap.has(stoId)) linesMap.set(stoId, []);
      const csn = csnByStoLineId.get(String(line.id)) ?? null;
      linesMap.get(stoId)!.push({
        ...line,
        material_name: lineMatMap.get(String(line.material_id)) ?? null,
        expected_qty: csn ? Number(csn.dispatch_qty ?? 0) : Number(line.quantity ?? 0),
        csn_id: csn?.id ?? null,
        csn_number: csn?.csn_number ?? null,
        invoice_number: csn?.invoice_number ?? null,
        lr_date: csn?.lr_date ?? null,
        boe_number: csn?.boe_number ?? null,
        mother_csn_id: csn?.mother_csn_id ?? null,
      });
    }

    const result = (stos ?? []).map((sto: JsonRecord) => {
      const stoLines = linesMap.get(String(sto.id)) ?? [];
      const distributionMother = toUpperTrimmedString(sto.sto_type) === "CONSIGNMENT_DISTRIBUTION"
        ? (stoLines.map((l) => motherCsnMap.get(toTrimmedString((l as JsonRecord).mother_csn_id))).find(Boolean) ?? null)
        : null;
      return {
        ...sto,
        lines: stoLines,
        mother: distributionMother,
      };
    });

    // §3.7 "Bulk GE-Creation Drawer" — STO twin of the PO window-bound
    // surfacing above, grouped by sending/receiving company instead of vendor.
    await Promise.all(result.map(async (sto: JsonRecord) => {
      const deliveryType = toUpperTrimmedString((sto as JsonRecord).delivery_type);
      const materialId = toTrimmedString((sto.lines as JsonRecord[] | undefined)?.[0]?.material_id);
      const effectiveStartDate = toTrimmedString((sto as JsonRecord).effective_start_date);
      if (deliveryType !== "BULK" || !materialId || !effectiveStartDate) return;
      (sto as JsonRecord).bulk_window_upper_bound = await resolveBulkDocumentWindowUpperBound(
        "stock_transfer_order", String(sto.id),
        { sending_company_id: toTrimmedString((sto as JsonRecord).sending_company_id), receiving_company_id: toTrimmedString((sto as JsonRecord).receiving_company_id) },
        materialId, effectiveStartDate, toTrimmedString((sto as JsonRecord).cutoff_date) || null,
      );
    }));

    return okResponse({ items: result }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "STO_OPEN_LIST_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function createGateExitInboundHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const gateEntryId = toTrimmedString(body.gate_entry_id);
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GEX_GATE_ENTRY_REQUIRED", 400, "gate_entry_id is required.");
    }

    const { gateEntry, lines } = await fetchGateEntryBundle(ctx, gateEntryId);
    const existingResp = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .select("*")
      .eq("gate_entry_id", gateEntryId)
      .maybeSingle();

    if (existingResp.error) {
      return procurementErrorResponse(req, ctx, "GEX_FETCH_FAILED", 500, "Unable to validate existing gate exit.");
    }
    if (existingResp.data) {
      return procurementErrorResponse(req, ctx, "GEX_ALREADY_EXISTS", 400, "Inbound gate exit already exists for this gate entry.");
    }

    // Found live 2026-09-01 (business owner, SNF LIQUID GRN backfill): a vehicle exited the
    // gate a day BEFORE its own Gate Entry date -- both rows were data-entered the same morning
    // (backdating a real-world event days later), and nothing stopped the exit date from landing
    // before the entry date it belongs to. Hard-block that ordering here.
    const effectiveExitDate = toTrimmedString(body.exit_date) || todayIsoDate();
    const gateEntryDate = toTrimmedString((gateEntry as GateEntryRow).ge_date);
    if (gateEntryDate && effectiveExitDate < gateEntryDate) {
      return procurementErrorResponse(
        req, ctx, "GEX_EXIT_DATE_BEFORE_ENTRY", 400,
        `Gate Exit date (${effectiveExitDate}) cannot be earlier than this Gate Entry's date (${gateEntryDate}).`,
      );
    }

    const grossWeightTotal = lines.reduce((sum, line) => sum + (parseNullableNumber(line.gross_weight) ?? 0), 0);
    const tareWeight = parseNullableNumber(body.tare_weight);
    const hasBulkLine = lines.some((line) => parseNullableNumber(line.gross_weight) !== null);
    if (hasBulkLine && tareWeight === null) {
      return procurementErrorResponse(req, ctx, "GEX_TARE_REQUIRED", 400, "tare_weight is required for weighed inbound gate exits.");
    }

    const netCalculated = tareWeight === null ? null : Number((grossWeightTotal - tareWeight).toFixed(6));
    const netOverride = parseNullableNumber(body.net_weight_override);
    const effectiveNet = netOverride ?? netCalculated;

    const exitNumber = await generateProcurementDocNumber("GEX");
    const { data: gateExit, error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .insert({
        exit_number: exitNumber,
        exit_date: effectiveExitDate,
        exit_time: toTrimmedString(body.exit_time) || null,
        company_id: gateEntry.company_id,
        gate_entry_id: gateEntryId,
        vehicle_number: toTrimmedString(body.vehicle_number) || gateEntry.vehicle_number,
        driver_name: toTrimmedString(body.driver_name) || gateEntry.driver_name || null,
        gate_staff_id: toTrimmedString(body.gate_staff_id) || ctx.auth_user_id,
        rst_number_tare: toTrimmedString(body.rst_number_tare) || null,
        tare_weight: tareWeight,
        net_weight_calculated: netCalculated,
        net_weight_override: netOverride,
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (gateExitError || !gateExit) {
      return procurementErrorResponse(req, ctx, "GEX_CREATE_FAILED", 500, "Unable to create inbound gate exit.");
    }

    if (effectiveNet !== null) {
      const distributedLines = distributeNetWeight(lines, effectiveNet);
      const lineUpdateErrors = await Promise.all(
        distributedLines.map(async (line) => {
          const { error: lineUpdateError } = await serviceRoleClient
            .schema("erp_procurement")
            .from("gate_entry_line")
            .update({
              net_weight: line.net_weight,
              net_weight_is_manual: true,
            })
            .eq("id", String(line.id));
          return lineUpdateError;
        }),
      );
      if (lineUpdateErrors.some(Boolean)) {
        return procurementErrorResponse(req, ctx, "GEX_LINE_UPDATE_FAILED", 500, "Unable to write back net weight to gate entry lines.");
      }
    }

    return okResponse(
      {
        ...gateExit,
        effective_net_weight: effectiveNet,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "GEX_CREATE_FAILED";
    const status = message.includes("REQUIRED") ? 400 : message.includes("NOT_FOUND") ? 404 : message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500;
    return procurementErrorResponse(req, ctx, message, status, message);
  }
}

export async function pruneGateEntryHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    // Prune shares its ACL action (PROC_GRN_LIST:WRITE) with plain GRN
    // creation, which every Stores rank needs — so the L3_USER+ ceiling for
    // Prune specifically can't be expressed at the ACL layer and is
    // enforced here instead. isSameOrHigher naturally lets SA/GA/DIRECTOR/
    // Managers through too; ACL's own department gate (Stores-only) already
    // keeps this from reaching unrelated departments.
    if (!isSameOrHigher(ctx.roleCode, "L3_USER")) {
      return procurementErrorResponse(req, ctx, "GE_PRUNE_RANK_REQUIRED", 403, "L3_USER rank or higher is required to prune a gate entry.");
    }
    const gateEntryId = getPathSegments(req)[3] ?? "";
    if (!gateEntryId) {
      return procurementErrorResponse(req, ctx, "GE_ID_REQUIRED", 400, "Gate entry id is required.");
    }

    const { gateEntry, lines } = await fetchGateEntryBundle(ctx, gateEntryId);
    const geStatus = toUpperTrimmedString(gateEntry.status);

    if (geStatus === "PRUNED") {
      return procurementErrorResponse(req, ctx, "GE_ALREADY_PRUNED", 400, "Gate entry is already pruned.");
    }
    if (geStatus === "CANCELLED") {
      return procurementErrorResponse(req, ctx, "GE_CANCELLED", 400, "Cannot prune a cancelled gate entry.");
    }

    // Check all linked GRNs are reversed
    const { data: grns, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("id, grn_number, status")
      .eq("gate_entry_id", gateEntryId);

    if (grnError) {
      return procurementErrorResponse(req, ctx, "GE_PRUNE_GRN_CHECK_FAILED", 500, "Unable to check linked GRNs.");
    }

    const blockedGrns = (grns ?? []).filter((g) => toUpperTrimmedString((g as JsonRecord).status) !== "REVERSED");
    if (blockedGrns.length > 0) {
      const nums = blockedGrns.map((g) => (g as JsonRecord).grn_number).join(", ");
      return procurementErrorResponse(
        req, ctx, "GE_PRUNE_BLOCKED_BY_GRN", 400,
        `Reverse all GRNs before pruning. Pending: ${nums}`
      );
    }

    // Release linked CSNs back to open
    const csnIds = Array.from(new Set(lines.map((l) => toTrimmedString(l.csn_id)).filter(Boolean)));
    if (csnIds.length > 0) {
      const { data: csnRows, error: csnLookupError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("consignment_note")
        .select("id, pre_ge_status")
        .in("id", csnIds);
      if (csnLookupError) {
        return procurementErrorResponse(req, ctx, "GE_PRUNE_FAILED", 500, "Unable to restore linked CSN status.");
      }

      const nowIso = new Date().toISOString();
      const csnIdsByStatus = new Map<string, string[]>();
      for (const csn of (csnRows ?? []) as JsonRecord[]) {
        const restoreStatus = toUpperTrimmedString(csn.pre_ge_status) || "ORD";
        const groupedIds = csnIdsByStatus.get(restoreStatus) ?? [];
        groupedIds.push(String(csn.id));
        csnIdsByStatus.set(restoreStatus, groupedIds);
      }
      const restoreErrors = await Promise.all(
        Array.from(csnIdsByStatus.entries()).map(async ([restoreStatus, groupedIds]) => {
          const { error: restoreError } = await serviceRoleClient
            .schema("erp_procurement")
            .from("consignment_note")
            .update({
              status: restoreStatus,
              pre_ge_status: null,
              gate_entry_id: null,
              gate_entry_date: null,
              last_updated_at: nowIso,
            })
            .in("id", groupedIds);
          return restoreError;
        }),
      );
      if (restoreErrors.some(Boolean)) {
        return procurementErrorResponse(req, ctx, "GE_PRUNE_FAILED", 500, "Unable to restore linked CSN status.");
      }
    }

    // Mark GE as PRUNED
    const { error: pruneError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .update({ status: "PRUNED", last_updated_at: new Date().toISOString() })
      .eq("id", gateEntryId);

    if (pruneError) {
      return procurementErrorResponse(req, ctx, "GE_PRUNE_FAILED", 500, "Unable to prune gate entry.");
    }

    return okResponse(await hydrateGateEntry(ctx, gateEntryId), ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GE_PRUNE_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function getGateExitInboundHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateExitId = getPathSegments(req)[4] ?? "";
    if (!gateExitId) {
      return procurementErrorResponse(req, ctx, "GEX_ID_REQUIRED", 400, "Gate exit id is required.");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .select("*")
      .eq("id", gateExitId)
      .single();

    if (error || !data) {
      return procurementErrorResponse(req, ctx, "GEX_NOT_FOUND", 404, "Inbound gate exit not found.");
    }

    return okResponse(
      {
        ...data,
        effective_net_weight: effectiveNetWeight(data),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "GEX_FETCH_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}

export async function gateReportHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const geType = toUpperTrimmedString(url.searchParams.get("ge_type"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const vendorId = toTrimmedString(url.searchParams.get("vendor_id"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 200);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    // 1. Gate entry lines with GE header
    let lineQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .select("id, gate_entry_id, line_number, material_id, ge_qty, uom_code, gross_weight, net_weight, csn_id, po_id")
      .range(offset, offset + limit - 1);

    // Subfilter via gate_entry using inner join approach
    // We'll fetch gate_entries first, then filter lines
    let geQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry")
      .select("id, ge_number, ge_date, company_id, ge_type, status, remarks, vehicle_number")
      .order("ge_date", { ascending: false });

    if (companyId) geQuery = geQuery.eq("company_id", companyId);
    if (dateFrom) geQuery = geQuery.gte("ge_date", dateFrom);
    if (dateTo) geQuery = geQuery.lte("ge_date", dateTo);
    if (geType) geQuery = geQuery.eq("ge_type", geType);
    if (status) geQuery = geQuery.eq("status", status);

    const { data: geRows, error: geError } = await geQuery;
    if (geError) return procurementErrorResponse(req, ctx, "GATE_REPORT_GE_FAILED", 500, "Unable to fetch gate entries.");

    const geList = (geRows ?? []) as JsonRecord[];
    if (geList.length === 0) return okResponse({ items: [], total: 0 }, ctx.request_id, req);

    const geIds = geList.map((g) => String(g.id));
    const geMap = new Map(geList.map((g) => [String(g.id), g]));

    // 2. Lines for these GEs
    const { data: lineRows, error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_entry_line")
      .select("id, gate_entry_id, line_number, material_id, ge_qty, uom_code, gross_weight, net_weight")
      .in("gate_entry_id", geIds);

    if (lineError) return procurementErrorResponse(req, ctx, "GATE_REPORT_LINE_FAILED", 500, "Unable to fetch gate entry lines.");
    const lines = (lineRows ?? []) as JsonRecord[];
    const lineIds = lines.map((l) => String(l.id));

    // 3. Gate exits (one per GE)
    const { data: gexRows } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_inbound")
      .select("id, gate_entry_id, exit_number, exit_date, tare_weight, net_weight_calculated, remarks")
      .in("gate_entry_id", geIds);
    const gexMap = new Map(
      ((gexRows ?? []) as JsonRecord[]).map((g) => [String(g.gate_entry_id), g])
    );

    // 4. GRNs per line
    const { data: grnRows } = lineIds.length > 0
      ? await serviceRoleClient
          .schema("erp_procurement")
          .from("goods_receipt")
          .select("id, gate_entry_line_id, grn_number, grn_date, vendor_id, invoice_number")
          .in("gate_entry_line_id", lineIds)
      : { data: [] };
    const grnByLineMap = new Map(
      ((grnRows ?? []) as JsonRecord[]).map((g) => [String(g.gate_entry_line_id), g])
    );

    // 5. Bulk resolve
    const materialIds = [...new Set(lines.map((l) => String(l.material_id ?? "")).filter(Boolean))];
    const vendorIds = [...new Set(((grnRows ?? []) as JsonRecord[]).map((g) => String(g.vendor_id ?? "")).filter(Boolean))];
    const companyIds = [...new Set(geList.map((g) => String(g.company_id ?? "")).filter(Boolean))];

    const [matResp, vendorResp, companyResp] = await Promise.all([
      materialIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("material_master")
            .select("id, pace_code, material_name").in("id", materialIds)
        : { data: [] },
      vendorIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("vendor_master")
            .select("id, vendor_code, vendor_name").in("id", vendorIds)
        : { data: [] },
      companyIds.length > 0
        ? serviceRoleClient.schema("erp_master").from("companies")
            .select("id, company_code, company_name").in("id", companyIds)
        : { data: [] },
    ]);

    const matMap = new Map(((matResp.data ?? []) as JsonRecord[]).map((m) => [String(m.id), m]));
    const vendorMap = new Map(((vendorResp.data ?? []) as JsonRecord[]).map((v) => [String(v.id), v]));
    const companyMap = new Map(((companyResp.data ?? []) as JsonRecord[]).map((c) => [String(c.id), c]));

    // 6. Vendor filter (post-resolve, since vendor comes from GRN)
    const items: JsonRecord[] = [];
    for (const line of lines) {
      const ge = geMap.get(String(line.gate_entry_id));
      if (!ge) continue;
      const gex = gexMap.get(String(line.gate_entry_id)) ?? null;
      const grn = grnByLineMap.get(String(line.id)) ?? null;
      const mat = matMap.get(String(line.material_id));
      const vendor = grn ? vendorMap.get(String((grn as JsonRecord).vendor_id)) : null;
      const company = companyMap.get(String(ge.company_id));

      if (vendorId && String((grn as JsonRecord | null)?.vendor_id) !== vendorId) continue;

      const geDate = String(ge.ge_date ?? "");
      const grnDate = grn ? String((grn as JsonRecord).grn_date ?? "") : null;
      const gexDate = gex ? String((gex as JsonRecord).exit_date ?? "") : null;

      items.push({
        ge_number: ge.ge_number,
        company_code: company?.company_code ?? null,
        ge_date: geDate,
        ge_type: ge.ge_type,
        ge_status: ge.status,
        ge_remarks: ge.remarks ?? null,
        vehicle_number: ge.vehicle_number ?? null,
        line_number: line.line_number,
        material_code: mat?.pace_code ?? null,
        material_name: mat?.material_name ?? null,
        ge_qty: line.ge_qty,
        uom_code: line.uom_code,
        gross_weight: line.gross_weight ?? null,
        net_weight: line.net_weight ?? null,
        vendor_code: vendor?.vendor_code ?? null,
        vendor_name: vendor?.vendor_name ?? null,
        grn_number: grn ? (grn as JsonRecord).grn_number : null,
        grn_date: grnDate,
        invoice_number: grn ? (grn as JsonRecord).invoice_number ?? null : null,
        gex_number: gex ? (gex as JsonRecord).exit_number : null,
        gex_date: gexDate,
        tare_weight: gex ? (gex as JsonRecord).tare_weight : null,
        net_weight_calculated: gex ? (gex as JsonRecord).net_weight_calculated : null,
        gex_remarks: gex ? (gex as JsonRecord).remarks : null,
        days_ge_to_gex: daysBetween(geDate, gexDate),
        days_ge_to_grn: daysBetween(geDate, grnDate),
      });
    }

    return okResponse({ items, total: items.length }, ctx.request_id, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GATE_REPORT_FAILED";
    return procurementErrorResponse(req, ctx, message, message === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, message);
  }
}
