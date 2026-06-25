/*
 * File-ID: 16.6.1
 * File-Path: supabase/functions/api/_core/procurement/sto.handlers.ts
 * Gate: 16.6
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: STO lifecycle handlers including dispatch, receipt confirmation, and sub-CSN transform.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type StoRow = Record<string, unknown>;
type StoLineRow = Record<string, unknown>;
type ApproverMapRow = { approver_user_id: string | null; approver_role_code: string | null };
type PreparedStoLine = {
  material_id: string;
  quantity: number;
  uom_code: string;
  transfer_price: number;
  transfer_price_currency: string;
  payment_term_id: string;
  freight_term: string;
  gst_terms: string | null;
  remarks: string | null;
  has_rebate: boolean;
  rebate_rate: number | null;
  rebate_rate_uom_basis: string | null;
  rebate_remarks: string | null;
  expected_delivery_date: string | null;
  sending_storage_location_id?: string | null;
  receiving_storage_location_id?: string | null;
  source_csn_id?: string | null;
};

const STO_TYPES = new Set(["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"]);
const STO_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"]);
const STO_LINE_STATUSES = new Set(["OPEN", "RECEIVED", "KNOCKED_OFF"]);
const MUTABLE_STO_AMENDMENT_FIELDS = new Set([
  "quantity",
  "transfer_price",
  "expected_delivery_date",
  "payment_term_id",
  "freight_term",
  "gst_terms",
  "remarks",
  "sending_cost_center_id",
  "receiving_cost_center_id",
]);

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
  return new Date().toISOString().slice(0, 10);
}

function collectAuthUserIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAuthUserIds(entry, ids);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("_by")) {
      const authUserId = toTrimmedString(entryValue);
      if (authUserId) {
        ids.add(authUserId);
      }
      continue;
    }

    collectAuthUserIds(entryValue, ids);
  }
}

function attachUserDisplayFields<T>(
  value: T,
  displayNameMap: Map<string, string>,
): T {
  if (Array.isArray(value)) {
    return value.map((entry) => attachUserDisplayFields(entry, displayNameMap)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const enriched: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(record)) {
    if (Array.isArray(entryValue) || (entryValue && typeof entryValue === "object")) {
      enriched[key] = attachUserDisplayFields(entryValue, displayNameMap);
    } else {
      enriched[key] = entryValue;
    }

    if (key.endsWith("_by")) {
      const authUserId = toTrimmedString(entryValue);
      if (authUserId) {
        enriched[`${key}_display`] = displayNameMap.get(authUserId) ?? authUserId;
      }
    }
  }

  return enriched as T;
}

async function enrichProcurementUserDisplays<T>(payload: T): Promise<T> {
  const authUserIds = new Set<string>();
  collectAuthUserIds(payload, authUserIds);
  const displayNameMap = await resolveUserDisplayNames([...authUserIds]);
  return attachUserDisplayFields(payload, displayNameMap);
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function stoErrorResponse(
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

async function loadStoApproverRules(companyId: string): Promise<ApproverMapRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("acl")
    .from("approver_map")
    .select("approver_user_id, approver_role_code")
    .eq("resource_code", "PROC_STO_CREATE")
    .eq("action_code", "WRITE")
    .eq("company_id", companyId);

  if (error) {
    throw new Error("PROCUREMENT_APPROVER_LOOKUP_FAILED");
  }

  return (data as ApproverMapRow[] | null) ?? [];
}

function matchesApprover(rows: ApproverMapRow[], ctx: ProcurementHandlerContext): boolean {
  return rows.some((row) => {
    if (row.approver_user_id) return row.approver_user_id === ctx.auth_user_id;
    if (row.approver_role_code) return row.approver_role_code === ctx.roleCode;
    return false;
  });
}

async function assertStoApproverRole(
  ctx: ProcurementHandlerContext,
  companyId: string,
  createdBy?: string | null,
): Promise<void> {
  if (ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return;
  }

  const rules = await loadStoApproverRules(companyId);
  const isConfiguredApprover = rules.length > 0
    ? matchesApprover(rules, ctx)
    : ctx.roleCode === "DIRECTOR";

  if (!isConfiguredApprover) {
    throw new Error("PROCUREMENT_HEAD_REQUIRED");
  }

  if (createdBy && createdBy === ctx.auth_user_id && ctx.roleCode !== "DIRECTOR") {
    throw new Error("PROCUREMENT_SELF_APPROVAL_FORBIDDEN");
  }
}

function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): string {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId);
  return companyId || scopedCompanyId;
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

async function generateCompanyDocNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_company_doc_number", {
      p_company_id: companyId,
      p_doc_type: docType,
    });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchSto(stoId: string): Promise<StoRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order")
    .select("*")
    .eq("id", stoId)
    .single();

  if (error || !data) {
    throw new Error("STO_NOT_FOUND");
  }

  return data as StoRow;
}

function assertStoVisibleToContext(ctx: ProcurementHandlerContext, sto: StoRow): void {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  if (
    scopedCompanyId
    && scopedCompanyId !== toTrimmedString(sto.sending_company_id)
    && scopedCompanyId !== toTrimmedString(sto.receiving_company_id)
  ) {
    throw new Error("STO_SCOPE_VIOLATION");
  }
}

async function fetchStoLines(stoId: string): Promise<StoLineRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order_line")
    .select("*")
    .eq("sto_id", stoId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("STO_LINE_FETCH_FAILED");
  }

  return (data ?? []) as StoLineRow[];
}

async function getStoApprovalLog(stoId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_approval_log")
    .select("*")
    .eq("sto_id", stoId)
    .order("actioned_at", { ascending: false });

  if (error) {
    throw new Error("STO_APPROVAL_LOG_FETCH_FAILED");
  }

  return (data as JsonRecord[] | null) ?? [];
}

async function getStoAmendmentLog(stoId: string): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_amendment_log")
    .select("*")
    .eq("sto_id", stoId)
    .order("amended_at", { ascending: false });

  if (error) {
    throw new Error("STO_AMENDMENT_LOG_FETCH_FAILED");
  }

  return (data as JsonRecord[] | null) ?? [];
}

async function hydrateSto(stoId: string, ctx?: ProcurementHandlerContext): Promise<JsonRecord> {
  const sto = await fetchSto(stoId);
  if (ctx) {
    assertStoVisibleToContext(ctx, sto);
  }
  const [lines, dcResp, gateExitResp, approvalLog, amendmentLog] = await Promise.all([
    fetchStoLines(stoId),
    serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .select("*")
      .eq("sto_id", stoId)
      .order("created_at", { ascending: false }),
    serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("sto_id", stoId)
      .order("created_at", { ascending: false }),
    getStoApprovalLog(stoId),
    getStoAmendmentLog(stoId),
  ]);

  if (dcResp.error) throw new Error("STO_DC_FETCH_FAILED");
  if (gateExitResp.error) throw new Error("STO_GXO_FETCH_FAILED");

  return await enrichProcurementUserDisplays({
    ...sto,
    lines,
    delivery_challans: dcResp.data ?? [],
    gate_exit_outbound: gateExitResp.data ?? [],
    approval_log: approvalLog,
    amendment_log: amendmentLog,
  });
}

async function hasPhysicalInventoryBlock(
  materialId: string,
  storageLocationId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();

  if (error) {
    throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  }

  return Boolean(data?.id);
}

async function getSnapshotForLine(companyId: string, line: StoLineRow): Promise<JsonRecord> {
  const sendingLocationId = toTrimmedString(line.sending_storage_location_id);
  if (!sendingLocationId) {
    throw new Error("STO_SENDING_LOCATION_REQUIRED");
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("*")
    .eq("company_id", companyId)
    .eq("storage_location_id", sendingLocationId)
    .eq("material_id", String(line.material_id))
    .eq("stock_type_code", "UNRESTRICTED")
    .is("batch_id", null)
    .maybeSingle();

  if (error || !data) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  return data;
}

async function getSubCsnById(csnId: string, companyId: string): Promise<JsonRecord> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("consignment_note")
    .select("*")
    .eq("id", csnId)
    .eq("company_id", companyId)
    .single();

  if (error || !data) {
    throw new Error("CSN_NOT_FOUND");
  }

  return data as JsonRecord;
}

async function getPurchaseOrderById(poId: string): Promise<JsonRecord | null> {
  if (!poId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order")
    .select("id, po_number, status")
    .eq("id", poId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PO_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getPurchaseOrderLineById(lineId: string): Promise<JsonRecord | null> {
  if (!lineId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("purchase_order_line")
    .select("id, line_status")
    .eq("id", lineId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PO_LINE_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getPaymentTermRow(paymentTermId: string): Promise<JsonRecord | null> {
  if (!paymentTermId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("payment_terms_master")
    .select("*")
    .eq("id", paymentTermId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_PAYMENT_TERM_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

async function getCostCenterRow(costCenterId: string): Promise<JsonRecord | null> {
  if (!costCenterId) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("cost_center_master")
    .select("id")
    .eq("id", costCenterId)
    .maybeSingle();

  if (error) {
    throw new Error("PROCUREMENT_COST_CENTER_LOOKUP_FAILED");
  }

  return (data as JsonRecord | null) ?? null;
}

function parseStoLineInput(
  line: JsonRecord,
  index: number,
  options?: { fallbackQuantity?: number | null; fallbackUomCode?: string | null },
): PreparedStoLine {
  const materialId = toTrimmedString(line.material_id);
  const quantity = parsePositiveNumber(line.quantity) ?? options?.fallbackQuantity ?? null;
  const uomCode = toTrimmedString(line.uom_code) || toTrimmedString(options?.fallbackUomCode);
  const transferPrice = parsePositiveNumber(line.transfer_price);
  const paymentTermId = toTrimmedString(line.payment_term_id);
  const freightTerm = toTrimmedString(line.freight_term);
  const hasRebate = line.has_rebate === true;
  const rebateRate = parseNullableNumber(line.rebate_rate);
  const rebateBasis = toTrimmedString(line.rebate_rate_uom_basis) || null;

  if (!materialId || !quantity || !transferPrice || !paymentTermId || !freightTerm) {
    throw new Error(`Each STO line requires material, quantity, rate, payment term, and freight term. (line ${index + 1})`);
  }
  if (!uomCode) {
    throw new Error(`Each STO line requires a UOM code. (line ${index + 1})`);
  }
  if (hasRebate && (!rebateRate || !rebateBasis)) {
    throw new Error(`Each rebate-enabled STO line requires a rebate rate and basis. (line ${index + 1})`);
  }

  return {
    material_id: materialId,
    quantity,
    uom_code: uomCode,
    transfer_price: transferPrice,
    transfer_price_currency: toTrimmedString(line.transfer_price_currency) || "BDT",
    payment_term_id: paymentTermId,
    freight_term: freightTerm,
    gst_terms: toTrimmedString(line.gst_terms) || null,
    remarks: toTrimmedString(line.remarks) || null,
    has_rebate: hasRebate,
    rebate_rate: hasRebate ? rebateRate : null,
    rebate_rate_uom_basis: hasRebate ? rebateBasis : null,
    rebate_remarks: hasRebate ? (toTrimmedString(line.rebate_remarks) || null) : null,
    expected_delivery_date: toTrimmedString(line.expected_delivery_date) || null,
    sending_storage_location_id: line.sending_storage_location_id !== undefined ? (toTrimmedString(line.sending_storage_location_id) || null) : undefined,
    receiving_storage_location_id: line.receiving_storage_location_id !== undefined ? (toTrimmedString(line.receiving_storage_location_id) || null) : undefined,
    source_csn_id: line.source_csn_id !== undefined ? (toTrimmedString(line.source_csn_id) || null) : undefined,
  };
}

async function getLastUsedPaymentTermForStoPair(
  sendingCompanyId: string,
  receivingCompanyId: string,
): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("stock_transfer_order")
    .select("id, created_at, lines:stock_transfer_order_line(payment_term_id)")
    .eq("sending_company_id", sendingCompanyId)
    .eq("receiving_company_id", receivingCompanyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("STO_LAST_PAYMENT_TERM_LOOKUP_FAILED");
  }

  const rows = Array.isArray(data?.lines) ? data.lines : [];
  const paymentTermId = toTrimmedString(rows[0]?.payment_term_id);
  return paymentTermId || null;
}

async function getNextStoAmendmentNumber(stoId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_amendment_log")
    .select("amendment_number")
    .eq("sto_id", stoId)
    .order("amendment_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error("STO_AMENDMENT_SEQUENCE_FAILED");
  }

  const latest = Array.isArray(data) && data.length > 0
    ? Number(data[0]?.amendment_number ?? 0)
    : 0;
  return latest + 1;
}

async function insertStoApprovalLog(input: {
  stoId: string;
  action: "APPROVED" | "REJECTED" | "ESCALATED";
  fromStatus: string;
  toStatus: string;
  remarks?: string | null;
  actionedBy: string;
}): Promise<void> {
  const { error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("sto_approval_log")
    .insert({
      sto_id: input.stoId,
      action: input.action,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      remarks: input.remarks ?? null,
      actioned_by: input.actionedBy,
    });

  if (error) {
    throw new Error("STO_APPROVAL_LOG_INSERT_FAILED");
  }
}

async function createCsnForSto(
  sto: StoRow,
  stoLines: StoLineRow[],
  actionedBy: string,
): Promise<void> {
  if (toUpperTrimmedString(sto.sto_type) !== "INTER_PLANT") {
    return;
  }

  for (const line of stoLines) {
    const orderedQty = Number(line.quantity ?? 0);
    const paymentTermId = toTrimmedString(line.payment_term_id);
    const paymentTerm = paymentTermId ? await getPaymentTermRow(paymentTermId) : null;
    const lcRequired = toUpperTrimmedString(paymentTerm?.payment_method) === "LC";
    const csnNumber = await generateProcurementDocNumber("CSN");
    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .insert({
        csn_number: csnNumber,
        csn_type: "DOMESTIC",
        status: "ORDERED",
        company_id: sto.sending_company_id,
        consignee_company_id: sto.receiving_company_id,
        vendor_id: null,
        material_id: line.material_id,
        po_id: null,
        po_line_id: null,
        sto_id: sto.id,
        po_qty: orderedQty,
        dispatch_qty: orderedQty,
        po_uom_code: line.uom_code,
        payment_term_id: paymentTermId || null,
        lc_required: lcRequired,
        has_rebate: line.has_rebate === true,
        rebate_remarks: line.rebate_remarks ?? null,
        created_by: actionedBy,
      });

    if (error) {
      throw new Error("PROCUREMENT_CSN_CREATE_FAILED");
    }
  }
}

async function buildConsignmentStoFromSubCsns(input: {
  csnIds: string[];
  sendingCompanyId: string;
  receivingCompanyId: string;
  sendingCostCenterId: string;
  receivingCostCenterId: string;
  stoDate: string;
  remarks: string | null;
  lineConfigs: Map<string, JsonRecord>;
  actionedBy: string;
}): Promise<StoRow> {
  let sto: StoRow | null = null;
  let nextLineNumber = 1;

  for (const csnId of input.csnIds) {
    const subCsn = await getSubCsnById(csnId, input.sendingCompanyId);
    const motherCsnId = toTrimmedString(subCsn.mother_csn_id);
    if (!motherCsnId) {
      throw new Error("SUB_CSN_REQUIRED");
    }
    if (toTrimmedString(subCsn.sto_id)) {
      throw new Error("CSN_ALREADY_LINKED_TO_STO");
    }
    const subStatus = toUpperTrimmedString(subCsn.status);
    if (subStatus !== "ORDERED" && subStatus !== "IN_TRANSIT") {
      throw new Error("CSN_STO_LINK_BLOCKED");
    }
    const consigneeCompanyId = toTrimmedString(subCsn.consignee_company_id);
    if (consigneeCompanyId && consigneeCompanyId !== input.receivingCompanyId) {
      throw new Error("CSN_CONSIGNEE_COMPANY_MISMATCH");
    }

    const mother = await getSubCsnById(motherCsnId, input.sendingCompanyId);
    if (toTrimmedString(mother.company_id) !== input.sendingCompanyId) {
      throw new Error("CSN_SOURCE_COMPANY_MISMATCH");
    }

    const po = await getPurchaseOrderById(toTrimmedString(subCsn.po_id));
    if (!po || toUpperTrimmedString(po.status) === "CANCELLED") {
      throw new Error("PROCUREMENT_PO_CANCELLED");
    }

    const poLine = await getPurchaseOrderLineById(toTrimmedString(subCsn.po_line_id));
    if (!poLine || toUpperTrimmedString(poLine.line_status) === "KNOCKED_OFF") {
      throw new Error("PROCUREMENT_PO_LINE_KNOCKED_OFF");
    }

    if (!sto) {
      const stoNumber = await generateCompanyDocNumber(input.sendingCompanyId, "STO");
      const { data: createdSto, error: stoError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order")
        .insert({
          sto_number: stoNumber,
          sto_date: input.stoDate,
          sto_type: "CONSIGNMENT_DISTRIBUTION",
          sending_company_id: input.sendingCompanyId,
          receiving_company_id: input.receivingCompanyId,
          sending_cost_center_id: input.sendingCostCenterId,
          receiving_cost_center_id: input.receivingCostCenterId,
          related_csn_id: csnId,
          status: "CREATED",
          remarks: input.remarks || `Auto-created from sub CSN ${subCsn.csn_number ?? csnId}`,
          created_by: input.actionedBy,
          last_updated_by: input.actionedBy,
        })
        .select("*")
        .single();

      if (stoError || !createdSto) {
        throw new Error("STO_TRANSFORM_CREATE_FAILED");
      }
      sto = createdSto as StoRow;
    }

    const lineConfig = input.lineConfigs.get(csnId) ?? {};
    const dispatchQty = parsePositiveNumber(subCsn.dispatch_qty) ?? parsePositiveNumber(subCsn.po_qty) ?? 0;
    if (!dispatchQty) {
      throw new Error("STO_LINE_INVALID");
    }

    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .insert({
        sto_id: sto.id,
        line_number: nextLineNumber,
        material_id: lineConfig.material_id,
        sending_storage_location_id: lineConfig.sending_storage_location_id ?? null,
        receiving_storage_location_id: lineConfig.receiving_storage_location_id ?? null,
        quantity: dispatchQty,
        uom_code: lineConfig.uom_code || toTrimmedString(subCsn.po_uom_code),
        transfer_price: lineConfig.transfer_price,
        transfer_price_currency: lineConfig.transfer_price_currency,
        payment_term_id: lineConfig.payment_term_id,
        freight_term: lineConfig.freight_term,
        gst_terms: lineConfig.gst_terms,
        remarks: lineConfig.remarks,
        has_rebate: lineConfig.has_rebate,
        rebate_rate: lineConfig.rebate_rate,
        rebate_rate_uom_basis: lineConfig.rebate_rate_uom_basis,
        rebate_remarks: lineConfig.rebate_remarks,
        expected_delivery_date: lineConfig.expected_delivery_date,
        balance_qty: dispatchQty,
      });

    if (lineError) {
      throw new Error("STO_TRANSFORM_LINE_FAILED");
    }

    const { error: csnUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        sto_id: sto.id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: input.actionedBy,
      })
      .eq("id", csnId);

    if (csnUpdateError) {
      throw new Error("CSN_STO_LINK_FAILED");
    }

    nextLineNumber += 1;
  }

  if (!sto) {
    throw new Error("STO_TRANSFORM_FAILED");
  }

  return sto;
}

export async function createSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const isOpeningSto = body.is_opening_sto === true;
    const stoType = toUpperTrimmedString(body.sto_type);
    const sendingCompanyId = getCompanyScope(ctx, toTrimmedString(body.sending_company_id));
    const receivingCompanyId = toTrimmedString(body.receiving_company_id);
    const sendingCostCenterId = toTrimmedString(body.sending_cost_center_id);
    const receivingCostCenterId = toTrimmedString(body.receiving_cost_center_id);
    const stoDate = toTrimmedString(body.sto_date) || todayIsoDate();
    const relatedCsnId = toTrimmedString(body.related_csn_id) || null;
    const lines = Array.isArray(body.lines) ? (body.lines as JsonRecord[]) : [];

    if (!STO_TYPES.has(stoType) || !sendingCompanyId || !receivingCompanyId || lines.length === 0) {
      return stoErrorResponse(req, ctx, "STO_CREATE_INVALID", 400, "sto_type, sending_company_id, receiving_company_id, and lines are required.");
    }
    if (!sendingCostCenterId || !receivingCostCenterId) {
      return stoErrorResponse(req, ctx, "STO_COST_CENTER_REQUIRED", 400, "Sending and receiving cost centers are required.");
    }
    if (!(await getCostCenterRow(sendingCostCenterId)) || !(await getCostCenterRow(receivingCostCenterId))) {
      return stoErrorResponse(req, ctx, "STO_COST_CENTER_INVALID", 400, "A selected STO cost center was not found.");
    }

    if (isOpeningSto && stoType !== "INTER_PLANT") {
      return stoErrorResponse(req, ctx, "STO_OPENING_REQUIRES_INTER_PLANT", 400, "Opening STOs must use INTER_PLANT sto_type.");
    }

    const preparedLines: PreparedStoLine[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      try {
        preparedLines.push(parseStoLineInput(line, index));
      } catch (lineError) {
        const code = lineError instanceof Error ? lineError.message : "STO_LINE_INVALID";
        return stoErrorResponse(req, ctx, "STO_LINE_INVALID", 400, code);
      }
    }

    if (stoType === "CONSIGNMENT_DISTRIBUTION") {
      const csnIds = preparedLines.map((line) => line.source_csn_id).filter(Boolean) as string[];
      if (csnIds.length === 0 || csnIds.length !== preparedLines.length) {
        return stoErrorResponse(req, ctx, "CSN_SELECTION_REQUIRED", 400, "Each consignment STO line requires a source sub-CSN.");
      }

      const lineConfigs = new Map<string, PreparedStoLine>();
      for (const line of preparedLines) {
        lineConfigs.set(toTrimmedString(line.source_csn_id), line);
      }

      const sto = await buildConsignmentStoFromSubCsns({
        csnIds,
        sendingCompanyId,
        receivingCompanyId,
        sendingCostCenterId,
        receivingCostCenterId,
        stoDate,
        remarks: toTrimmedString(body.remarks) || null,
        lineConfigs,
        actionedBy: ctx.auth_user_id,
      });

      return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
    }

    const openingStoNumber = toTrimmedString(body.sto_number);
    if (isOpeningSto && !openingStoNumber) {
      return stoErrorResponse(req, ctx, "PROCUREMENT_OPENING_STO_NUMBER_REQUIRED", 400, "Opening STO number is required.");
    }

    const stoNumber = isOpeningSto
      ? openingStoNumber
      : await generateCompanyDocNumber(sendingCompanyId, "STO");
    const { data: sto, error: stoError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .insert({
        sto_number: stoNumber,
        sto_date: stoDate,
        sto_type: stoType,
        sending_company_id: sendingCompanyId,
        receiving_company_id: receivingCompanyId,
        sending_cost_center_id: sendingCostCenterId,
        receiving_cost_center_id: receivingCostCenterId,
        related_csn_id: relatedCsnId,
        status: "DRAFT",
        is_opening_sto: isOpeningSto,
        remarks: toTrimmedString(body.remarks) || null,
        created_by: ctx.auth_user_id,
        last_updated_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (stoError || !sto) {
      return stoErrorResponse(req, ctx, "STO_CREATE_FAILED", 500, "Unable to create STO.");
    }

    const linePayload = [];
    for (let index = 0; index < preparedLines.length; index += 1) {
      const line = preparedLines[index];
      linePayload.push({
        sto_id: sto.id,
        line_number: index + 1,
        material_id: line.material_id,
        sending_storage_location_id: line.sending_storage_location_id ?? null,
        receiving_storage_location_id: line.receiving_storage_location_id ?? null,
        quantity: line.quantity,
        uom_code: line.uom_code,
        transfer_price: line.transfer_price,
        transfer_price_currency: line.transfer_price_currency,
        payment_term_id: line.payment_term_id,
        freight_term: line.freight_term,
        gst_terms: line.gst_terms,
        remarks: line.remarks,
        has_rebate: line.has_rebate,
        rebate_rate: line.rebate_rate,
        rebate_rate_uom_basis: line.rebate_rate_uom_basis,
        rebate_remarks: line.rebate_remarks,
        expected_delivery_date: line.expected_delivery_date,
        balance_qty: line.quantity,
      });
    }

    const { error: lineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order_line")
      .insert(linePayload);

    if (lineError) {
      return stoErrorResponse(req, ctx, "STO_LINE_CREATE_FAILED", 500, "Unable to create STO lines.");
    }

    return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CREATE_FAILED";
    const status = code.includes("INVALID") ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function listSTOsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = getCompanyScope(ctx, url.searchParams.get("company_id") ?? undefined);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const stoType = toUpperTrimmedString(url.searchParams.get("sto_type"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (companyId) {
      query = query.or(`sending_company_id.eq.${companyId},receiving_company_id.eq.${companyId}`);
    }
    if (status && STO_STATUSES.has(status)) {
      query = query.eq("status", status);
    }
    if (stoType && STO_TYPES.has(stoType)) {
      query = query.eq("sto_type", stoType);
    }

    const { data, error } = await query;
    if (error) {
      return stoErrorResponse(req, ctx, "STO_LIST_FAILED", 500, "Unable to list STOs.");
    }

    return okResponse({ items: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_LIST_FAILED";
    return stoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function getSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    if (!stoId) {
      return stoErrorResponse(req, ctx, "STO_ID_REQUIRED", 400, "STO id is required.");
    }
    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_FETCH_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function getLastStoPaymentTermHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const sendingCompanyId = getCompanyScope(ctx, url.searchParams.get("sending_company_id") ?? undefined);
    const receivingCompanyId = toTrimmedString(url.searchParams.get("receiving_company_id"));

    if (!sendingCompanyId || !receivingCompanyId) {
      return stoErrorResponse(req, ctx, "STO_LAST_PAYMENT_TERM_FILTERS_REQUIRED", 400, "sending_company_id and receiving_company_id are required.");
    }

    const paymentTermId = await getLastUsedPaymentTermForStoPair(sendingCompanyId, receivingCompanyId);
    return okResponse({ payment_term_id: paymentTermId }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_LAST_PAYMENT_TERM_LOOKUP_FAILED";
    return stoErrorResponse(req, ctx, code, 500, code);
  }
}

export async function updateSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (!["DRAFT", "CREATED"].includes(toUpperTrimmedString(sto.status))) {
      return stoErrorResponse(req, ctx, "STO_NOT_EDITABLE", 400, "Only DRAFT or CREATED STO can be updated.");
    }

    const patch: JsonRecord = {
      sto_date: toTrimmedString(body.sto_date) || sto.sto_date,
      sending_cost_center_id: body.sending_cost_center_id !== undefined
        ? (toTrimmedString(body.sending_cost_center_id) || null)
        : sto.sending_cost_center_id,
      receiving_cost_center_id: body.receiving_cost_center_id !== undefined
        ? (toTrimmedString(body.receiving_cost_center_id) || null)
        : sto.receiving_cost_center_id,
      remarks: body.remarks !== undefined ? (toTrimmedString(body.remarks) || null) : sto.remarks,
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };

    const { error: headerError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update(patch)
      .eq("id", stoId);

    if (headerError) {
      return stoErrorResponse(req, ctx, "STO_UPDATE_FAILED", 500, "Unable to update STO.");
    }

    if (Array.isArray(body.lines)) {
      const lines = body.lines as JsonRecord[];
      for (const line of lines) {
        const lineId = toTrimmedString(line.id);
        if (!lineId) continue;
        const quantity = parsePositiveNumber(line.quantity);
        const receivedQty = parseNullableNumber(line.received_qty) ?? 0;
        const balanceQty = quantity !== null ? Number((quantity - receivedQty).toFixed(6)) : undefined;
        const linePatch: JsonRecord = {
          sending_storage_location_id: line.sending_storage_location_id !== undefined ? (toTrimmedString(line.sending_storage_location_id) || null) : undefined,
          receiving_storage_location_id: line.receiving_storage_location_id !== undefined ? (toTrimmedString(line.receiving_storage_location_id) || null) : undefined,
          quantity: quantity ?? undefined,
          uom_code: line.uom_code !== undefined ? toTrimmedString(line.uom_code) : undefined,
          transfer_price: line.transfer_price !== undefined ? parseNullableNumber(line.transfer_price) : undefined,
          transfer_price_currency: line.transfer_price_currency !== undefined ? (toTrimmedString(line.transfer_price_currency) || "BDT") : undefined,
          payment_term_id: line.payment_term_id !== undefined ? (toTrimmedString(line.payment_term_id) || null) : undefined,
          freight_term: line.freight_term !== undefined ? (toTrimmedString(line.freight_term) || null) : undefined,
          gst_terms: line.gst_terms !== undefined ? (toTrimmedString(line.gst_terms) || null) : undefined,
          remarks: line.remarks !== undefined ? (toTrimmedString(line.remarks) || null) : undefined,
          has_rebate: line.has_rebate !== undefined ? line.has_rebate === true : undefined,
          rebate_rate: line.rebate_rate !== undefined ? parseNullableNumber(line.rebate_rate) : undefined,
          rebate_rate_uom_basis: line.rebate_rate_uom_basis !== undefined ? (toTrimmedString(line.rebate_rate_uom_basis) || null) : undefined,
          rebate_remarks: line.rebate_remarks !== undefined ? (toTrimmedString(line.rebate_remarks) || null) : undefined,
          expected_delivery_date: line.expected_delivery_date !== undefined ? (toTrimmedString(line.expected_delivery_date) || null) : undefined,
          balance_qty: balanceQty,
          last_updated_at: new Date().toISOString(),
        };
        const { error: lineError } = await serviceRoleClient
          .schema("erp_procurement")
          .from("stock_transfer_order_line")
          .update(linePatch)
          .eq("id", lineId)
          .eq("sto_id", stoId);
        if (lineError) {
          return stoErrorResponse(req, ctx, "STO_LINE_UPDATE_FAILED", 500, "Unable to update STO line.");
        }
      }
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_UPDATE_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function cancelSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.cancellation_reason);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (!reason) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_REASON_REQUIRED", 400, "cancellation_reason is required.");
    }
    if (!["DRAFT", "PENDING_APPROVAL", "CREATED"].includes(toUpperTrimmedString(sto.status))) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_BLOCKED", 400, "Only DRAFT, PENDING_APPROVAL, or CREATED STO can be cancelled.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CANCELLED",
        cancellation_reason: reason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.auth_user_id,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (error) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_FAILED", 500, "Unable to cancel STO.");
    }

    const { error: unlinkError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("consignment_note")
      .update({
        sto_id: null,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("sto_id", stoId);

    if (unlinkError) {
      return stoErrorResponse(req, ctx, "STO_CANCEL_FAILED", 500, "Unable to unlink sub-CSNs from cancelled STO.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CANCEL_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_SCOPE_VIOLATION" ? 403 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function transformSubCSNToSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const csnId = getIdFromPath(req);
    const body = await parseBody(req);
    const companyId = getCompanyScope(ctx, toTrimmedString(body.company_id));
    const subCsn = await getSubCsnById(csnId, companyId);

    if (!toTrimmedString(subCsn.mother_csn_id)) {
      return stoErrorResponse(req, ctx, "SUB_CSN_REQUIRED", 400, "Only sub CSN can be transformed to STO.");
    }
    if (toTrimmedString(subCsn.sto_id)) {
      return stoErrorResponse(req, ctx, "CSN_ALREADY_LINKED_TO_STO", 400, "CSN is already linked to an STO.");
    }

    const sendingCompanyId = toTrimmedString(body.sending_company_id) || companyId;
    const receivingCompanyId = toTrimmedString(body.receiving_company_id) || toTrimmedString(subCsn.consignee_company_id) || companyId;
    const sendingCostCenterId = toTrimmedString(body.sending_cost_center_id);
    const receivingCostCenterId = toTrimmedString(body.receiving_cost_center_id);
    if (!sendingCostCenterId || !receivingCostCenterId) {
      return stoErrorResponse(req, ctx, "STO_COST_CENTERS_REQUIRED", 400, "sending_cost_center_id and receiving_cost_center_id are required.");
    }
    const sto = await buildConsignmentStoFromSubCsns({
      csnIds: [csnId],
      sendingCompanyId,
      receivingCompanyId,
      sendingCostCenterId,
      receivingCostCenterId,
      stoDate: todayIsoDate(),
      remarks: `Auto-created from sub CSN ${subCsn.csn_number ?? csnId}`,
      lineConfigs: new Map([[csnId, body]]),
      actionedBy: ctx.auth_user_id,
    });

    return okResponse(await hydrateSto(String(sto.id), ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_TRANSFORM_FAILED";
    const status = code === "CSN_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function confirmSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "DRAFT") {
      return stoErrorResponse(req, ctx, "STO_CONFIRM_BLOCKED", 422, "Only DRAFT STO can be confirmed.");
    }

    const requiresApproval = body.approval_required === true;
    const nextStatus = requiresApproval ? "PENDING_APPROVAL" : "CREATED";
    const nowIso = new Date().toISOString();
    const { data: updatedSto, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: nextStatus,
        approved_by: nextStatus === "CREATED" ? ctx.auth_user_id : null,
        approved_at: nextStatus === "CREATED" ? nowIso : null,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (error || !updatedSto) {
      throw new Error("STO_CONFIRM_FAILED");
    }

    if (nextStatus === "PENDING_APPROVAL") {
      await insertStoApprovalLog({
        stoId,
        action: "ESCALATED",
        fromStatus: "DRAFT",
        toStatus: "PENDING_APPROVAL",
        remarks: toTrimmedString(body.remarks) || null,
        actionedBy: ctx.auth_user_id,
      });
    } else {
      await createCsnForSto(updatedSto as StoRow, await fetchStoLines(stoId), ctx.auth_user_id);
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CONFIRM_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code.includes("BLOCKED") ? 422 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function approveSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    await assertStoApproverRole(ctx, toTrimmedString(sto.sending_company_id), toTrimmedString(sto.created_by));

    if (toUpperTrimmedString(sto.status) !== "PENDING_APPROVAL") {
      return stoErrorResponse(req, ctx, "STO_APPROVAL_STATE_INVALID", 422, "STO is not pending approval.");
    }

    const nowIso = new Date().toISOString();
    const { data: updatedSto, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CREATED",
        approved_by: ctx.auth_user_id,
        approved_at: nowIso,
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (error || !updatedSto) {
      throw new Error("STO_APPROVE_FAILED");
    }

    await insertStoApprovalLog({
      stoId,
      action: "APPROVED",
      fromStatus: "PENDING_APPROVAL",
      toStatus: "CREATED",
      remarks: toTrimmedString(body.remarks) || null,
      actionedBy: ctx.auth_user_id,
    });
    await createCsnForSto(updatedSto as StoRow, await fetchStoLines(stoId), ctx.auth_user_id);
    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_APPROVE_FAILED";
    const status = code === "STO_NOT_FOUND"
      ? 404
      : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN"
      ? 403
      : code.includes("INVALID")
      ? 422
      : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function rejectSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const remarks = toTrimmedString(body.remarks);
    if (!remarks) {
      return stoErrorResponse(req, ctx, "PROCUREMENT_REMARKS_REQUIRED", 400, "Remarks are required.");
    }

    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    await assertStoApproverRole(ctx, toTrimmedString(sto.sending_company_id), toTrimmedString(sto.created_by));

    if (toUpperTrimmedString(sto.status) !== "PENDING_APPROVAL") {
      return stoErrorResponse(req, ctx, "STO_APPROVAL_STATE_INVALID", 422, "STO is not pending approval.");
    }

    const { data: updatedSto, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "DRAFT",
        remarks,
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (error || !updatedSto) {
      throw new Error("STO_REJECT_FAILED");
    }

    await insertStoApprovalLog({
      stoId,
      action: "REJECTED",
      fromStatus: "PENDING_APPROVAL",
      toStatus: "DRAFT",
      remarks,
      actionedBy: ctx.auth_user_id,
    });

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_REJECT_FAILED";
    const status = code === "STO_NOT_FOUND"
      ? 404
      : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN"
      ? 403
      : code.includes("REQUIRED")
      ? 400
      : code.includes("INVALID")
      ? 422
      : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function amendSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    const currentStatus = toUpperTrimmedString(sto.status);
    if (currentStatus !== "CREATED" && currentStatus !== "PENDING_APPROVAL") {
      return stoErrorResponse(req, ctx, "STO_AMEND_BLOCKED", 422, "STO cannot be amended in current state.");
    }

    const stoLineId = toTrimmedString(body.sto_line_id);
    const existingLines = await fetchStoLines(stoId);
    const targetLine = stoLineId
      ? existingLines.find((line) => toTrimmedString(line.id) === stoLineId) ?? null
      : null;

    if (stoLineId && !targetLine) {
      return stoErrorResponse(req, ctx, "STO_LINE_NOT_FOUND", 404, "STO line not found.");
    }

    const amendmentNumber = await getNextStoAmendmentNumber(stoId);
    const amendmentEntries: JsonRecord[] = [];
    let requiresApproval = false;
    const headerUpdates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
      last_updated_by: ctx.auth_user_id,
    };
    const lineUpdates: JsonRecord = {
      last_updated_at: new Date().toISOString(),
    };

    const pushAmendment = (
      fieldName: string,
      oldValue: unknown,
      newValue: unknown,
      targetLineId?: string | null,
    ) => {
      const approvalRequired = fieldName === "quantity" || fieldName === "transfer_price";
      amendmentEntries.push({
        sto_id: stoId,
        sto_line_id: targetLineId || null,
        amendment_number: amendmentNumber,
        field_changed: fieldName,
        old_value: oldValue == null ? null : String(oldValue),
        new_value: newValue == null ? null : String(newValue),
        requires_approval: approvalRequired,
        approval_status: approvalRequired ? "PENDING" : "APPROVED",
        approved_by: approvalRequired ? null : ctx.auth_user_id,
        approved_at: approvalRequired ? null : new Date().toISOString(),
        amended_by: ctx.auth_user_id,
      });
    };

    const candidateFields: Record<string, unknown> = {
      quantity: body.quantity,
      transfer_price: body.transfer_price,
      expected_delivery_date: body.expected_delivery_date,
      payment_term_id: body.payment_term_id,
      freight_term: body.freight_term,
      gst_terms: body.gst_terms,
      remarks: body.remarks,
      sending_cost_center_id: body.sending_cost_center_id,
      receiving_cost_center_id: body.receiving_cost_center_id,
    };

    for (const [fieldName, rawValue] of Object.entries(candidateFields)) {
      if (rawValue === undefined || !MUTABLE_STO_AMENDMENT_FIELDS.has(fieldName)) {
        continue;
      }
      const lineScoped = ["quantity", "transfer_price", "expected_delivery_date", "payment_term_id", "freight_term", "gst_terms"].includes(fieldName);
      if (lineScoped && !targetLine) {
        return stoErrorResponse(req, ctx, "STO_LINE_REQUIRED", 400, "STO line id is required for line amendment.");
      }

      const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      const oldValue = lineScoped ? targetLine?.[fieldName] : sto[fieldName];
      if (String(oldValue ?? "") === String(normalizedValue ?? "")) {
        continue;
      }

      if (fieldName === "quantity" || fieldName === "transfer_price") {
        requiresApproval = true;
      }

      pushAmendment(fieldName, oldValue, normalizedValue, targetLine ? toTrimmedString(targetLine.id) : null);

      if (fieldName === "quantity") {
        const quantity = parsePositiveNumber(normalizedValue);
        if (!quantity) {
          return stoErrorResponse(req, ctx, "STO_INVALID_LINE_VALUES", 400, "Invalid quantity.");
        }
        const receivedQty = Number(targetLine?.received_qty ?? 0);
        lineUpdates.quantity = quantity;
        lineUpdates.balance_qty = Number(Math.max(quantity - receivedQty, 0).toFixed(6));
      } else if (fieldName === "transfer_price") {
        const transferPrice = parsePositiveNumber(normalizedValue);
        if (!transferPrice) {
          return stoErrorResponse(req, ctx, "STO_INVALID_LINE_VALUES", 400, "Invalid transfer price.");
        }
        lineUpdates.transfer_price = Number(transferPrice.toFixed(4));
      } else if (fieldName === "payment_term_id") {
        const paymentTermId = toTrimmedString(normalizedValue);
        if (!(await getPaymentTermRow(paymentTermId))) {
          return stoErrorResponse(req, ctx, "PROCUREMENT_PAYMENT_TERM_NOT_FOUND", 404, "Payment term not found.");
        }
        lineUpdates.payment_term_id = paymentTermId;
      } else if (fieldName === "freight_term") {
        lineUpdates.freight_term = toTrimmedString(normalizedValue) || null;
      } else if (fieldName === "gst_terms") {
        lineUpdates.gst_terms = toTrimmedString(normalizedValue) || null;
      } else if (fieldName === "expected_delivery_date") {
        lineUpdates.expected_delivery_date = toTrimmedString(normalizedValue) || null;
      } else if (fieldName === "sending_cost_center_id" || fieldName === "receiving_cost_center_id") {
        const costCenterId = toTrimmedString(normalizedValue);
        if (!(await getCostCenterRow(costCenterId))) {
          return stoErrorResponse(req, ctx, "PROCUREMENT_COST_CENTER_NOT_FOUND", 404, "Cost center not found.");
        }
        headerUpdates[fieldName] = costCenterId;
      } else {
        headerUpdates[fieldName] = normalizedValue || null;
      }
    }

    if (amendmentEntries.length === 0) {
      return stoErrorResponse(req, ctx, "STO_NO_AMENDMENT_CHANGES", 400, "No amendment changes provided.");
    }

    const effectivePendingStatus = requiresApproval ? "PENDING_APPROVAL" : currentStatus;
    const { data: updatedSto, error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        ...headerUpdates,
        status: effectivePendingStatus,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (stoUpdateError || !updatedSto) {
      throw new Error("STO_AMEND_FAILED");
    }

    if (targetLine && Object.keys(lineUpdates).length > 1) {
      const lineUpdateResult = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update(lineUpdates)
        .eq("id", targetLine.id)
        .select("*")
        .single();

      if (lineUpdateResult.error) {
        throw new Error("STO_LINE_AMEND_FAILED");
      }
    }

    const amendmentInsert = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .insert(amendmentEntries);

    if (amendmentInsert.error) {
      throw new Error("STO_AMEND_LOG_FAILED");
    }

    return okResponse(
      await enrichProcurementUserDisplays({
        ...updatedSto,
        requires_approval: requiresApproval,
        workflow_status: requiresApproval ? "PENDING_AMENDMENT" : updatedSto.status,
      }),
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_AMEND_FAILED";
    const status =
      code === "STO_NOT_FOUND" || code === "STO_LINE_NOT_FOUND" || code === "PROCUREMENT_COST_CENTER_NOT_FOUND" || code === "PROCUREMENT_PAYMENT_TERM_NOT_FOUND"
        ? 404
        : code.includes("BLOCKED") || code.includes("INVALID")
          ? 422
          : code.includes("REQUIRED") || code.includes("NO_AMENDMENT")
            ? 400
            : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function approveSTOAmendmentHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);
    await assertStoApproverRole(ctx, toTrimmedString(sto.sending_company_id), toTrimmedString(sto.created_by));

    const { data: pendingLogs, error: logError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .select("*")
      .eq("sto_id", stoId)
      .eq("requires_approval", true)
      .eq("approval_status", "PENDING");

    if (logError) {
      throw new Error("STO_AMEND_LOOKUP_FAILED");
    }
    if (!pendingLogs || pendingLogs.length === 0) {
      return stoErrorResponse(req, ctx, "STO_NO_PENDING_AMENDMENT", 422, "No pending amendment found.");
    }

    const nowIso = new Date().toISOString();
    const logUpdate = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .update({
        approval_status: "APPROVED",
        approved_by: ctx.auth_user_id,
        approved_at: nowIso,
        rejection_reason: null,
      })
      .eq("sto_id", stoId)
      .eq("requires_approval", true)
      .eq("approval_status", "PENDING");

    if (logUpdate.error) {
      throw new Error("STO_AMEND_APPROVE_FAILED");
    }

    const { data: updatedSto, error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CREATED",
        last_updated_at: nowIso,
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId)
      .select("*")
      .single();

    if (stoUpdateError || !updatedSto) {
      throw new Error("STO_AMEND_APPROVE_FAILED");
    }

    await insertStoApprovalLog({
      stoId,
      action: "APPROVED",
      fromStatus: "PENDING_AMENDMENT",
      toStatus: "CREATED",
      remarks: toTrimmedString(body.remarks) || null,
      actionedBy: ctx.auth_user_id,
    });

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_AMEND_APPROVE_FAILED";
    const status =
      code === "STO_NOT_FOUND" ? 404
        : code === "PROCUREMENT_HEAD_REQUIRED" || code === "PROCUREMENT_SELF_APPROVAL_FORBIDDEN" ? 403
        : code.includes("NO_PENDING") ? 422
        : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function dispatchSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const body = await parseBody(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "CREATED") {
      return stoErrorResponse(req, ctx, "STO_DISPATCH_BLOCKED", 400, "Only CREATED STO can be dispatched.");
    }

    const lines = await fetchStoLines(stoId);
    if (lines.length === 0) {
      return stoErrorResponse(req, ctx, "STO_EMPTY", 400, "STO has no lines.");
    }

    const dispatchedLineResults: Array<{ line: StoLineRow; stockDocumentId: string }> = [];
    let totalDispatchQty = 0;

    for (const line of lines) {
      const snapshot = await getSnapshotForLine(String(sto.sending_company_id), line);
      const requiredQty = parsePositiveNumber(line.quantity) ?? 0;
      const availableQty = parseNullableNumber(snapshot.quantity) ?? 0;
      if (availableQty < requiredQty) {
        return stoErrorResponse(req, ctx, "INSUFFICIENT_STOCK", 400, `Insufficient stock for STO line ${line.line_number}.`);
      }

      const postingBlocked = await hasPhysicalInventoryBlock(
        String(line.material_id),
        String(line.sending_storage_location_id),
      );
      if (postingBlocked) {
        return stoErrorResponse(
          req,
          ctx,
          "MATERIAL_POSTING_BLOCKED",
          409,
          "Material has an active physical inventory count in progress.",
        );
      }

      const posting = await serviceRoleClient
        .schema("erp_inventory")
        .rpc("post_stock_movement", {
          p_document_number: sto.sto_number,
          p_document_date: sto.sto_date,
          p_posting_date: todayIsoDate(),
          p_movement_type_code: "STO_ISSUE",
          p_company_id: sto.sending_company_id,
          p_storage_location_id: line.sending_storage_location_id,
          p_material_id: line.material_id,
          p_quantity: requiredQty,
          p_base_uom_code: line.uom_code,
          p_unit_value: parseNullableNumber(snapshot.valuation_rate) ?? 0,
          p_stock_type_code: "UNRESTRICTED",
          p_direction: "OUT",
          p_posted_by: ctx.auth_user_id,
          p_reversal_of_id: null,
        });

      if (posting.error || !Array.isArray(posting.data) || posting.data.length === 0) {
        return stoErrorResponse(req, ctx, "STO_DISPATCH_POST_FAILED", 500, "Unable to post STO issue movement.");
      }

      const stockDocumentId = String(posting.data[0].stock_document_id);
      const issuedQty = requiredQty;
      const balanceQty = Number(((parsePositiveNumber(line.quantity) ?? 0) - issuedQty).toFixed(6));
      const lineStatus = balanceQty <= 0 ? "RECEIVED" : "OPEN";

      const { error: lineUpdateError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update({
          dispatched_qty: issuedQty,
          balance_qty: balanceQty,
          line_status: lineStatus,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", String(line.id));

      if (lineUpdateError) {
        return stoErrorResponse(req, ctx, "STO_LINE_DISPATCH_UPDATE_FAILED", 500, "Unable to update STO line dispatch state.");
      }

      dispatchedLineResults.push({ line, stockDocumentId });
      totalDispatchQty += issuedQty;
    }

    const dcNumber = await generateProcurementDocNumber("DC");
    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan")
      .insert({
        dc_number: dcNumber,
        dc_date: todayIsoDate(),
        dc_type: "STO",
        selling_company_id: sto.sending_company_id,
        receiving_company_id: sto.receiving_company_id,
        sto_id: stoId,
        delivery_address: toTrimmedString(body.delivery_address) || null,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_name_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        vehicle_number: toTrimmedString(body.vehicle_number) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        driver_name: toTrimmedString(body.driver_name) || null,
        status: "AUTO_GENERATED",
        total_value: dispatchedLineResults.reduce((sum, item) => sum + ((parseNullableNumber(item.line.transfer_price) ?? 0) * (parsePositiveNumber(item.line.quantity) ?? 0)), 0),
        remarks: toTrimmedString(body.remarks) || null,
      })
      .select("*")
      .single();

    if (dcError || !dc) {
      return stoErrorResponse(req, ctx, "STO_DC_CREATE_FAILED", 500, "Unable to create delivery challan.");
    }

    const dcLinePayload = dispatchedLineResults.map(({ line, stockDocumentId }, index) => ({
      dc_id: dc.id,
      line_number: index + 1,
      material_id: line.material_id,
      sto_line_id: line.id,
      quantity: line.quantity,
      uom_code: line.uom_code,
      unit_value: line.transfer_price,
      line_total: (parseNullableNumber(line.transfer_price) ?? 0) * (parsePositiveNumber(line.quantity) ?? 0),
      stock_document_id: stockDocumentId,
    }));

    const { error: dcLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("delivery_challan_line")
      .insert(dcLinePayload);

    if (dcLineError) {
      return stoErrorResponse(req, ctx, "STO_DC_LINE_CREATE_FAILED", 500, "Unable to create delivery challan lines.");
    }

    const gxoNumber = await generateProcurementDocNumber("GXO");
    const { error: gateExitError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .insert({
        exit_number: gxoNumber,
        exit_date: todayIsoDate(),
        exit_time: toTrimmedString(body.exit_time) || null,
        exit_type: "STO",
        company_id: sto.sending_company_id,
        sto_id: stoId,
        dc_id: dc.id,
        vehicle_number: toTrimmedString(body.vehicle_number) || "STO-VEHICLE",
        driver_name: toTrimmedString(body.driver_name) || null,
        gate_staff_id: ctx.auth_user_id,
        transporter_id: toTrimmedString(body.transporter_id) || null,
        transporter_freetext: toTrimmedString(body.transporter_name_freetext) || null,
        lr_number: toTrimmedString(body.lr_number) || null,
        rst_number: toTrimmedString(body.rst_number) || null,
        gross_weight: parseNullableNumber(body.gross_weight),
        tare_weight: parseNullableNumber(body.tare_weight),
        net_weight: parseNullableNumber(body.gross_weight) !== null && parseNullableNumber(body.tare_weight) !== null
          ? Number(((parseNullableNumber(body.gross_weight) ?? 0) - (parseNullableNumber(body.tare_weight) ?? 0)).toFixed(6))
          : null,
        dispatch_qty: totalDispatchQty,
        remarks: toTrimmedString(body.remarks) || null,
      });

    if (gateExitError) {
      return stoErrorResponse(req, ctx, "STO_GXO_CREATE_FAILED", 500, "Unable to create outbound gate exit.");
    }

    const { error: stoUpdateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "DISPATCHED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (stoUpdateError) {
      return stoErrorResponse(req, ctx, "STO_DISPATCH_STATUS_FAILED", 500, "Unable to update STO status.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_DISPATCH_FAILED";
    const status = code === "INSUFFICIENT_STOCK" || code.includes("REQUIRED") ? 400 : code === "STO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function updateGateExitOutboundWeightHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const gateExitId = getPathSegments(req)[4] ?? "";
    const body = await parseBody(req);
    const tareWeight = parsePositiveNumber(body.tare_weight);
    if (!gateExitId || !tareWeight) {
      return stoErrorResponse(req, ctx, "GXO_WEIGHT_INVALID", 400, "gate exit id and tare_weight are required.");
    }

    const { data: gateExit, error: fetchError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .select("*")
      .eq("id", gateExitId)
      .single();

    if (fetchError || !gateExit) {
      return stoErrorResponse(req, ctx, "GXO_NOT_FOUND", 404, "Outbound gate exit not found.");
    }

    const grossWeight = parseNullableNumber(gateExit.gross_weight);
    const netWeight = grossWeight !== null ? Number((grossWeight - tareWeight).toFixed(6)) : null;
    const { data, error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("gate_exit_outbound")
      .update({
        tare_weight: tareWeight,
        net_weight: netWeight,
      })
      .eq("id", gateExitId)
      .select("*")
      .single();

    if (error || !data) {
      return stoErrorResponse(req, ctx, "GXO_WEIGHT_UPDATE_FAILED", 500, "Unable to update gate exit outbound weight.");
    }

    return okResponse(data, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GXO_WEIGHT_UPDATE_FAILED";
    const status = code === "GXO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function confirmSTOReceiptHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    const { data: grn, error: grnError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt")
      .select("*")
      .eq("sto_id", stoId)
      .eq("status", "POSTED")
      .order("posted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (grnError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_GRN_CHECK_FAILED", 500, "Unable to validate STO receipt GRN.");
    }
    if (!grn) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_GRN_MISSING", 400, "No POSTED GRN found for this STO.");
    }

    const { data: grnLines, error: grnLineError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("goods_receipt_line")
      .select("*")
      .eq("grn_id", String(grn.id))
      .not("sto_line_id", "is", null);

    if (grnLineError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_LINE_FETCH_FAILED", 500, "Unable to fetch STO GRN lines.");
    }

    for (const grnLine of grnLines ?? []) {
      const stoLineId = toTrimmedString((grnLine as JsonRecord).sto_line_id);
      if (!stoLineId) continue;
      const stoLine = (await fetchStoLines(stoId)).find((line) => String(line.id) === stoLineId);
      if (!stoLine) continue;
      const receivedQty = parsePositiveNumber((grnLine as JsonRecord).received_qty) ?? 0;
      const totalReceivedQty = Number(((parseNullableNumber(stoLine.received_qty) ?? 0) + receivedQty).toFixed(6));
      const balanceQty = Number(((parsePositiveNumber(stoLine.quantity) ?? 0) - totalReceivedQty).toFixed(6));
      const lineStatus = balanceQty <= 0 ? "RECEIVED" : "OPEN";
      await serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order_line")
        .update({
          received_qty: totalReceivedQty,
          balance_qty: balanceQty < 0 ? 0 : balanceQty,
          line_status: lineStatus,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", stoLineId);
    }

    const { error: updateError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "RECEIVED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (updateError) {
      return stoErrorResponse(req, ctx, "STO_RECEIPT_CONFIRM_FAILED", 500, "Unable to confirm STO receipt.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_RECEIPT_CONFIRM_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : code === "STO_RECEIPT_GRN_MISSING" ? 400 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}

export async function closeSTOHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const stoId = getIdFromPath(req);
    const sto = await fetchSto(stoId);
    assertStoVisibleToContext(ctx, sto);

    if (toUpperTrimmedString(sto.status) !== "RECEIVED") {
      return stoErrorResponse(req, ctx, "STO_CLOSE_BLOCKED", 400, "Only RECEIVED STO can be closed.");
    }

    const lines = await fetchStoLines(stoId);
    const hasOpenBalance = lines.some((line) => {
      const balanceQty = parseNullableNumber(line.balance_qty) ?? 0;
      const lineStatus = toUpperTrimmedString(line.line_status);
      return balanceQty > 0 && lineStatus !== "KNOCKED_OFF";
    });

    if (hasOpenBalance) {
      return stoErrorResponse(req, ctx, "STO_CLOSE_BALANCE_REMAINING", 400, "All STO lines must have zero balance or be knocked off before closing.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .update({
        status: "CLOSED",
        last_updated_at: new Date().toISOString(),
        last_updated_by: ctx.auth_user_id,
      })
      .eq("id", stoId);

    if (error) {
      return stoErrorResponse(req, ctx, "STO_CLOSE_FAILED", 500, "Unable to close STO.");
    }

    return okResponse(await hydrateSto(stoId, ctx), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "STO_CLOSE_FAILED";
    const status = code === "STO_NOT_FOUND" ? 404 : 500;
    return stoErrorResponse(req, ctx, code, status, code);
  }
}
