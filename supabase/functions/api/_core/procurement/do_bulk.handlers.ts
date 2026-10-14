/*
 * File-Path: supabase/functions/api/_core/procurement/do_bulk.handlers.ts
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DO Upload" (SO03 additive button) — resolves a bulk Excel
 *          upload (FO/SO Number, DO Date, Transporter, LR Number, LR Date,
 *          SKU, Pack Qty, Storage Location, Tally Invoice Number/Date,
 *          Inbound Number, Truck Number, Dispatch Date) into Delivery Order
 *          line sets, per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 14-15.
 *          One template row-group = one FO (VDC/Dependent Direct) or one SO
 *          (DC/Dependent Depot) = one Delivery Order.
 *
 *          Strictly additive to the established business transaction: DC
 *          rows drive `createDeliveryOrderUnifiedHandler` and DD/VDC rows
 *          drive its existing deferred bridge.  The handlers retain their
 *          validation/payload logic; their narrowly-scoped bulk opt-in only
 *          records a submission result atomically with that existing RPC.
 *          For a VDC row, if the FO's own Fixed-Depot/address allocation
 *          doesn't exist yet it is created via the EXISTING, unmodified
 *          `saveSoMapGroupHandler` the exact same way — never a new
 *          allocation-write code path. The only genuinely new writes this
 *          file performs are the DC-only auto-depot-mapping bootstrap and
 *          request preparation. Header stamping now occurs inside the same
 *          submission transaction as the DO, eliminating the prior
 *          create-then-patch partial-success window.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { readAclSnapshotDecisionAny } from "../../_shared/acl_snapshot.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../_shared/manualDocumentDateWindow.ts";
import { createDeferredVdcBulkDeliveryOrder, createDeliveryOrderUnifiedHandler } from "./do_unified.handlers.ts";
import { saveSoMapGroupHandler } from "./so_map.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const QTY_TOL = 0.0001;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}
function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}
function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}
function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
// Browser upload normally normalizes dates, but validation must remain safe
// for raw DD/MM/YYYY uploads and restored drafts too. Excel serial values are
// accepted only in a plausible date range, never for document identifiers.
function normalizeInputDate(value: unknown): string {
  const text = toTrimmedString(value);
  if (!text || isIsoDate(text)) return text;
  // Some source workbooks lose the second display separator (`03/102026`
  // for `03/10/2026`). Treat only this constrained day/month/year shape as
  // a date, then validate its calendar value before accepting it.
  const displayMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    || text.match(/^(\d{1,2})[/-](\d{1,2})(\d{4})$/);
  if (displayMatch) {
    const [, day, month, year] = displayMatch;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() === Number(month) - 1 && parsed.getUTCDate() === Number(day)) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return text;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 0 && serial < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return text;
}
function doBulkErrorResponse(req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function getCompanyScope(ctx: ProcurementHandlerContext, requestedCompanyId?: string): Promise<string> {
  const scopedCompanyId = toTrimmedString(ctx.context.companyId);
  const companyId = toTrimmedString(requestedCompanyId) || scopedCompanyId;
  if (companyId) await assertCompanyScope(ctx, companyId);
  return companyId;
}

// do_unified.handlers.ts's own canMaintainDoCreate() is not exported (file
// header note there: "small enough to duplicate rather than widen that
// file's export surface for one Set") — same call here, same reasoning.
export async function canMaintainDoBulkAccess(
  ctx: ProcurementHandlerContext,
  companyId: string,
  actionCode: "VIEW" | "WRITE" | "EDIT",
): Promise<boolean> {
  if (ctx.context.isAdmin) return true;
  if (!companyId) return false;
  let workContextIds: string[];
  if (companyId === ctx.context.companyId) {
    workContextIds = ctx.context.workContextIds && ctx.context.workContextIds.length > 0
      ? ctx.context.workContextIds
      : ctx.context.workContextId ? [ctx.context.workContextId] : [];
  } else {
    const { data: workContextRows, error: workContextError } = await serviceRoleClient
      .schema("erp_acl").from("user_work_contexts")
      .select("work_context:work_context_id!inner(work_context_id, is_active)")
      .eq("auth_user_id", ctx.auth_user_id).eq("company_id", companyId);
    if (workContextError) return false;
    workContextIds = ((workContextRows ?? []) as Array<{ work_context: unknown }>)
      .map((row) => {
        const wc = Array.isArray(row.work_context) ? row.work_context[0] : row.work_context;
        return wc as { work_context_id?: string; is_active?: boolean } | null;
      })
      .filter((wc) => wc?.is_active)
      .map((wc) => toTrimmedString(wc?.work_context_id))
      .filter(Boolean);
  }
  if (workContextIds.length === 0) return false;
  const { data: versionRow, error: versionError } = await serviceRoleClient
    .schema("acl").from("acl_versions").select("acl_version_id")
    .eq("company_id", companyId).eq("is_active", true).single();
  if (versionError || !versionRow?.acl_version_id) return false;
  const { data, error } = await readAclSnapshotDecisionAny({
    db: serviceRoleClient,
    aclVersionId: versionRow.acl_version_id as string,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextIds,
    resourceCode: "PROC_DO_CREATE",
    actionCode,
  });
  if (error || !data) return false;
  return data.decision === "ALLOW";
}

type RawUploadRow = {
  row_index: number;
  fo_or_so_number: string;
  do_date?: string;
  transporter_name?: string;
  lr_number?: string;
  lr_date?: string;
  sku: string;
  pack_qty: number;
  storage_location_code?: string;
  tally_invoice_number?: string;
  tally_invoice_date?: string;
  inbound_number?: string;
  truck_number?: string;
  dispatch_date?: string;
};

async function listFinishedGoodsStorageLocations(): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory").from("storage_location_master")
    .select("id, code, name").ilike("code", "F%").eq("active", true).order("code");
  return error ? [] : (data ?? []) as JsonRecord[];
}

// The uploader frequently has many SKU rows for one FO and many FOs using
// the same transporter/location.  Load the small global active transporter
// master once (paginated so PostgREST's response cap cannot silently omit a
// later record), rather than issuing one substring search per spreadsheet
// row.  This is preview-only reference data; save still revalidates the
// chosen transporter's active state at commit time.
async function listActiveTransporters(): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const pageSize = 1_000;
  for (let from = 0;; from += pageSize) {
    const { data, error } = await serviceRoleClient
      .schema("erp_master").from("transporter_master")
      .select("id, transporter_code, transporter_name")
      .eq("active", true).order("transporter_name").range(from, from + pageSize - 1);
    if (error) throw new Error("DO_BULK_TRANSPORTER_LOOKUP_FAILED");
    const page = (data ?? []) as JsonRecord[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function resolveTransporterFromRows(name: string, rows: JsonRecord[]): {
  status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND";
  transporter_id?: string;
  candidates?: JsonRecord[];
} {
  const target = toTrimmedString(name);
  if (!target) return { status: "NOT_FOUND" };
  const normalized = toUpperTrimmedString(target);
  const matches = rows.filter((row) => toUpperTrimmedString(row.transporter_name).includes(normalized)).slice(0, 10);
  if (matches.length === 0) return { status: "NOT_FOUND" };
  const exact = matches.find((row) => toUpperTrimmedString(row.transporter_name) === normalized);
  if (exact) return { status: "MATCHED", transporter_id: toTrimmedString(exact.id) };
  if (matches.length === 1) return { status: "MATCHED", transporter_id: toTrimmedString(matches[0].id) };
  return { status: "AMBIGUOUS", candidates: matches };
}

// §6 point 14 — one template column takes either an FO Number (VDC/Dependent
// Direct, resolved through the original or revised Sales/Dispatch FO Number — §6
// point 1/T1) or a plain SO Number (DC/Dependent Depot, resolved directly
// against sales_order.so_number). A value that resolves to the WRONG type
// is a type-mismatch error, not a silent fallback.
async function resolveFoOrSo(value: string, companyId: string): Promise<{
  status: "VDC" | "DC" | "VDC_WRONG_FIELD" | "DC_WRONG_FIELD" | "NOT_FOUND";
  so_id?: string;
  so_number?: string;
  map_group_id?: string;
  is_dd_dispatch?: boolean;
}> {
  const [originalResult, revisedResult] = await Promise.all([
    serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, so_id, status, so:so_id(company_id, so_number, dispatch_type, is_dd_dispatch)")
      .eq("external_fo_number", value).eq("status", "ACTIVE").maybeSingle(),
    serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, so_id, status, so:so_id(company_id, so_number, dispatch_type, is_dd_dispatch)")
      .eq("revised_external_fo_number", value).eq("status", "ACTIVE").maybeSingle(),
  ]);
  const groupRow = originalResult.data ?? revisedResult.data;
  const groupError = originalResult.error ?? revisedResult.error;
  if (!groupError && groupRow) {
    const so = (groupRow as JsonRecord).so as JsonRecord | null;
    if (so && toUpperTrimmedString(so.company_id) === toUpperTrimmedString(companyId)) {
      const isDdDispatch = so.is_dd_dispatch === true;
      if (toUpperTrimmedString(so.dispatch_type) === "DEPENDENT_DIRECT") {
        return {
          // Direct/FO resolution and the DD timing flag are deliberately
          // different things.  A non-DD Direct SO still resolves through its
          // FO allocation; it simply follows the normal atomic Invoice+PGI
          // path rather than the DD invoice-now/PGI-later path.
          status: "VDC",
          so_id: toTrimmedString((groupRow as JsonRecord).so_id),
          so_number: toTrimmedString(so.so_number),
          map_group_id: toTrimmedString((groupRow as JsonRecord).id),
          is_dd_dispatch: isDdDispatch,
        };
      }
    }
  }
  const { data: soRow, error: soError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order")
    .select("id, so_number, company_id, dispatch_type, is_dd_dispatch")
    .eq("so_number", value).maybeSingle();
  if (!soError && soRow) {
    const so = soRow as JsonRecord;
    if (toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)) return { status: "NOT_FOUND" };
    const dispatchType = toUpperTrimmedString(so.dispatch_type);
    if (dispatchType === "DEPENDENT_DEPOT") return { status: "DC", so_id: toTrimmedString(so.id), so_number: toTrimmedString(so.so_number), is_dd_dispatch: false };
    if (dispatchType === "DEPENDENT_DIRECT") return { status: "VDC_WRONG_FIELD" };
    return { status: "DC_WRONG_FIELD" };
  }
  return { status: "NOT_FOUND" };
}

type BulkPreviewLookup = {
  resolvedByIdentifier: Map<string, Awaited<ReturnType<typeof resolveFoOrSo>>>;
  allocationsByMapGroup: Map<string, JsonRecord[]>;
  linesBySo: Map<string, JsonRecord[]>;
  lineById: Map<string, JsonRecord>;
  materialById: Map<string, JsonRecord>;
  drawnByAllocation: Map<string, number>;
  drawnByLine: Map<string, number>;
  deliveryOrdersByAllocation: Map<string, ExistingDeliveryOrder[]>;
  deliveryOrdersByLine: Map<string, ExistingDeliveryOrder[]>;
  storageByCode: Map<string, JsonRecord>;
  finishedGoodsLocations: JsonRecord[];
  transporters: JsonRecord[];
};

// Preview exposes these references only to explain an exhausted balance.  They
// are derived from the same non-cancelled DO lines used by the balance check;
// the browser can identify an already-created DO without implying PGI or
// physical dispatch has happened.
type ExistingDeliveryOrder = {
  dc_number: string;
  quantity: number;
};

type DrawnDeliveryOrderLookup = {
  drawnByKey: Map<string, number>;
  deliveryOrdersByKey: Map<string, ExistingDeliveryOrder[]>;
};

// Batch the immutable preview reads.  The business decision remains exactly
// the existing one: Direct rows resolve by FO→SO Map allocation; Depot rows
// resolve by SO line.  `is_dd_dispatch` only decides the later
// invoice/PGI lifecycle, never which Direct allocation is valid.
async function buildBulkPreviewLookup(rows: RawUploadRow[], companyId: string): Promise<BulkPreviewLookup> {
  const identifiers = [...new Set(rows.map((row) => toTrimmedString(row.fo_or_so_number)).filter(Boolean))];
  const [originalGroups, revisedGroups, soByNumberRows, finishedGoodsLocations, transporters] = await Promise.all([
    fetchInChunks<JsonRecord>(identifiers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, so_id, external_fo_number, revised_external_fo_number").in("external_fo_number", chunk).eq("status", "ACTIVE")),
    fetchInChunks<JsonRecord>(identifiers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
      .select("id, so_id, external_fo_number, revised_external_fo_number").in("revised_external_fo_number", chunk).eq("status", "ACTIVE")),
    fetchInChunks<JsonRecord>(identifiers, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order")
      .select("id, so_number, company_id, dispatch_type, is_dd_dispatch").in("so_number", chunk)),
    listFinishedGoodsStorageLocations(),
    listActiveTransporters(),
  ]);
  const mapGroupByIdentifier = new Map<string, JsonRecord>();
  for (const group of [...originalGroups, ...revisedGroups]) {
    const keys = [toTrimmedString(group.external_fo_number), toTrimmedString(group.revised_external_fo_number)].filter(Boolean);
    for (const key of keys) if (!mapGroupByIdentifier.has(key)) mapGroupByIdentifier.set(key, group);
  }
  const mappedSoIds = [...new Set([...mapGroupByIdentifier.values()].map((group) => toTrimmedString(group.so_id)).filter(Boolean))];
  const mappedSoRows = await fetchInChunks<JsonRecord>(mappedSoIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order")
    .select("id, so_number, company_id, dispatch_type, is_dd_dispatch").in("id", chunk));
  const soById = new Map([...soByNumberRows, ...mappedSoRows].map((so) => [toTrimmedString(so.id), so]));
  const soByNumber = new Map(soByNumberRows.map((so) => [toTrimmedString(so.so_number), so]));
  const resolvedByIdentifier = new Map<string, Awaited<ReturnType<typeof resolveFoOrSo>>>();
  for (const identifier of identifiers) {
    const group = mapGroupByIdentifier.get(identifier);
    const mappedSo = group ? soById.get(toTrimmedString(group.so_id)) : undefined;
    if (mappedSo && toUpperTrimmedString(mappedSo.company_id) === toUpperTrimmedString(companyId)
      && toUpperTrimmedString(mappedSo.dispatch_type) === "DEPENDENT_DIRECT") {
      resolvedByIdentifier.set(identifier, { status: "VDC", so_id: toTrimmedString(mappedSo.id), so_number: toTrimmedString(mappedSo.so_number), map_group_id: toTrimmedString(group?.id), is_dd_dispatch: mappedSo.is_dd_dispatch === true });
      continue;
    }
    const so = soByNumber.get(identifier);
    if (!so || toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)) {
      resolvedByIdentifier.set(identifier, { status: "NOT_FOUND" });
    } else if (toUpperTrimmedString(so.dispatch_type) === "DEPENDENT_DEPOT") {
      resolvedByIdentifier.set(identifier, { status: "DC", so_id: toTrimmedString(so.id), so_number: toTrimmedString(so.so_number), is_dd_dispatch: false });
    } else if (toUpperTrimmedString(so.dispatch_type) === "DEPENDENT_DIRECT") {
      resolvedByIdentifier.set(identifier, { status: "VDC_WRONG_FIELD" });
    } else {
      resolvedByIdentifier.set(identifier, { status: "DC_WRONG_FIELD" });
    }
  }

  const vdcMapGroupIds = [...new Set([...resolvedByIdentifier.values()].filter((resolved) => resolved.status === "VDC").map((resolved) => toTrimmedString(resolved.map_group_id)).filter(Boolean))];
  const dcSoIds = [...new Set([...resolvedByIdentifier.values()].filter((resolved) => resolved.status === "DC").map((resolved) => toTrimmedString(resolved.so_id)).filter(Boolean))];
  const [allocations, dcLines] = await Promise.all([
    fetchInChunks<JsonRecord>(vdcMapGroupIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
      .select("id, map_group_id, so_line_id, allocated_qty").in("map_group_id", chunk).eq("status", "ACTIVE")),
    fetchInChunks<JsonRecord>(dcSoIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_line")
      .select("id, so_id, material_id, base_qty, quantity, per_pack_qty").in("so_id", chunk)),
  ]);
  const allocationsByMapGroup = new Map<string, JsonRecord[]>();
  for (const allocation of allocations) {
    const key = toTrimmedString(allocation.map_group_id);
    allocationsByMapGroup.set(key, [...(allocationsByMapGroup.get(key) ?? []), allocation]);
  }
  const allocationLineIds = [...new Set(allocations.map((allocation) => toTrimmedString(allocation.so_line_id)).filter(Boolean))];
  const allocationLines = await fetchInChunks<JsonRecord>(allocationLineIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_line")
    .select("id, so_id, material_id, base_qty, quantity, per_pack_qty").in("id", chunk));
  const allLines = [...dcLines, ...allocationLines];
  const lineById = new Map(allLines.map((line) => [toTrimmedString(line.id), line]));
  const linesBySo = new Map<string, JsonRecord[]>();
  for (const line of dcLines) {
    const key = toTrimmedString(line.so_id);
    linesBySo.set(key, [...(linesBySo.get(key) ?? []), line]);
  }
  const materialIds = [...new Set(allLines.map((line) => toTrimmedString(line.material_id)).filter(Boolean))];
  const [materialRows, allocationDraws, lineDraws] = await Promise.all([
    fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, external_code, material_name").in("id", chunk)),
    computeDrawnDeliveryOrdersByAllocation(allocations.map((allocation) => toTrimmedString(allocation.id))),
    computeDrawnDeliveryOrdersByLine(allLines.map((line) => toTrimmedString(line.id))),
  ]);
  return {
    resolvedByIdentifier,
    allocationsByMapGroup,
    linesBySo,
    lineById,
    materialById: new Map(materialRows.map((material) => [toTrimmedString(material.id), material])),
    drawnByAllocation: allocationDraws.drawnByKey,
    drawnByLine: lineDraws.drawnByKey,
    deliveryOrdersByAllocation: allocationDraws.deliveryOrdersByKey,
    deliveryOrdersByLine: lineDraws.deliveryOrdersByKey,
    storageByCode: new Map(finishedGoodsLocations.map((location) => [toUpperTrimmedString(location.code), location])),
    finishedGoodsLocations,
    transporters,
  };
}

// Preview/resolve is read-only.  It resolves every unique source/master key
// once, then preserves the exact row index and candidate/error contract the
// review drawer already uses.
export async function previewDoBulkUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  const startedAt = performance.now();
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return doBulkErrorResponse(req, ctx, "DO_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "VIEW"))) return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    const rows = Array.isArray(body.rows) ? (body.rows as RawUploadRow[]) : [];
    if (rows.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_ROWS_REQUIRED", 400, "At least one row is required.");
    const lookup = await buildBulkPreviewLookup(rows, companyId);
    const results: JsonRecord[] = [];
    for (const row of rows) {
      const identifier = toTrimmedString(row.fo_or_so_number);
      // A transporter refresh must never make the uploaded source reference
      // disappear from the review grid.  Resolve it before FO/SO validation
      // and include both fields in every response shape, including errors.
      const transporterResolution = resolveTransporterFromRows(toTrimmedString(row.transporter_name), lookup.transporters);
      const previewIdentity = {
        row_index: row.row_index,
        fo_or_so_number: identifier,
        transporter_resolution: transporterResolution,
      };
      if (!identifier) { results.push({ ...previewIdentity, status: "ERROR", error_code: "FO_SO_NUMBER_REQUIRED" }); continue; }
      const resolved = lookup.resolvedByIdentifier.get(identifier) ?? { status: "NOT_FOUND" };
      if (resolved.status === "NOT_FOUND") { results.push({ ...previewIdentity, status: "ERROR", error_code: "FO_SO_NOT_FOUND" }); continue; }
      if (resolved.status === "VDC_WRONG_FIELD") { results.push({ ...previewIdentity, status: "ERROR", error_code: "DO_BULK_VDC_MUST_USE_FO_NUMBER" }); continue; }
      if (resolved.status === "DC_WRONG_FIELD") { results.push({ ...previewIdentity, status: "ERROR", error_code: "DO_BULK_SO_WRONG_DISPATCH_TYPE" }); continue; }
      const isVdc = resolved.status === "VDC";
      const ddFlag = resolved.is_dd_dispatch === true;
      const soId = toTrimmedString(resolved.so_id);
      const skuCandidates: JsonRecord[] = [];
      let matchedAllocationId: string | null = null;
      let matchedSoLineId: string | null = null;
      let matchedMaterialId: string | null = null;
      let lineRemaining = 0;
      let perPackQty: number | null = null;
      let existingDeliveryOrders: ExistingDeliveryOrder[] = [];
      if (isVdc) {
        const mapGroupId = toTrimmedString(resolved.map_group_id);
        if (!mapGroupId) { results.push({ ...previewIdentity, status: "ERROR", error_code: "DO_BULK_FO_NOT_MAPPED" }); continue; }
        for (const allocation of lookup.allocationsByMapGroup.get(mapGroupId) ?? []) {
          const line = lookup.lineById.get(toTrimmedString(allocation.so_line_id));
          const material = line ? lookup.materialById.get(toTrimmedString(line.material_id)) : undefined;
          const display = material ? `${toTrimmedString(material.pace_code)} — ${toTrimmedString(material.material_name)}` : toTrimmedString(allocation.so_line_id);
          skuCandidates.push({ allocation_id: allocation.id, so_line_id: allocation.so_line_id, material_id: line?.material_id, display });
          if (material && [material.pace_code, material.external_code, material.material_name].some((field) => toUpperTrimmedString(field) === toUpperTrimmedString(row.sku))) {
            matchedAllocationId = toTrimmedString(allocation.id);
            matchedSoLineId = toTrimmedString(allocation.so_line_id);
            matchedMaterialId = toTrimmedString(line?.material_id);
            perPackQty = Number(line?.per_pack_qty) || null;
            lineRemaining = Number(allocation.allocated_qty ?? 0) - (lookup.drawnByAllocation.get(toTrimmedString(allocation.id)) ?? 0);
            existingDeliveryOrders = lookup.deliveryOrdersByAllocation.get(toTrimmedString(allocation.id)) ?? [];
          }
        }
      } else {
        for (const line of lookup.linesBySo.get(soId) ?? []) {
          const material = lookup.materialById.get(toTrimmedString(line.material_id));
          const display = material ? `${toTrimmedString(material.pace_code)} — ${toTrimmedString(material.material_name)}` : toTrimmedString(line.id);
          skuCandidates.push({ so_line_id: line.id, material_id: line.material_id, display });
          if (material && [material.pace_code, material.external_code, material.material_name].some((field) => toUpperTrimmedString(field) === toUpperTrimmedString(row.sku))) {
            matchedSoLineId = toTrimmedString(line.id);
            matchedMaterialId = toTrimmedString(line.material_id);
            perPackQty = Number(line.per_pack_qty) || null;
            lineRemaining = Number(line.base_qty ?? line.quantity ?? 0) - (lookup.drawnByLine.get(toTrimmedString(line.id)) ?? 0);
            existingDeliveryOrders = lookup.deliveryOrdersByLine.get(toTrimmedString(line.id)) ?? [];
          }
        }
      }
      const packQty = Number(row.pack_qty ?? 0);
      const baseQty = perPackQty ? packQty * perPackQty : packQty;
      const truckNumber = toTrimmedString(row.truck_number);
      const dispatchDate = normalizeInputDate(row.dispatch_date);
      const doDate = normalizeInputDate(row.do_date);
      const lrNumber = toTrimmedString(row.lr_number);
      const lrDate = normalizeInputDate(row.lr_date);
      const missingRequired: string[] = [];
      const formatErrors: string[] = [];
      if (!doDate) missingRequired.push("do_date"); else if (!isIsoDate(doDate)) formatErrors.push("DO Date is invalid");
      if (!lrNumber) missingRequired.push("lr_number");
      if (!lrDate) missingRequired.push("lr_date"); else if (!isIsoDate(lrDate)) formatErrors.push("LR Date is invalid");
      if (transporterResolution.status === "NOT_FOUND") missingRequired.push("transporter");
      if (!Number.isFinite(packQty) || packQty <= 0) formatErrors.push("Pack Qty must be positive");
      if (normalizeInputDate(row.tally_invoice_date) && !isIsoDate(normalizeInputDate(row.tally_invoice_date))) formatErrors.push("Tally Invoice Date is invalid");
      if (dispatchDate && !isIsoDate(dispatchDate)) formatErrors.push("Dispatch Date is invalid");
      if (!ddFlag) {
        if (!truckNumber) missingRequired.push("truck_number");
        if (!dispatchDate) missingRequired.push("dispatch_date");
      }
      results.push({
        ...previewIdentity, status: "RESOLVED", dd_flag: ddFlag, so_id: soId, so_number: resolved.so_number,
        map_group_id: resolved.map_group_id ?? null,
        sku_resolution: matchedSoLineId ? { status: "MATCHED", so_line_id: matchedSoLineId, so_map_allocation_id: matchedAllocationId, material_id: matchedMaterialId } : { status: "NOT_FOUND", candidates: skuCandidates },
        qty_status: matchedSoLineId && baseQty > lineRemaining + QTY_TOL ? "EXCEEDS_BALANCE" : "OK",
        base_qty: matchedSoLineId ? baseQty : null,
        remaining_base_qty: matchedSoLineId ? Math.max(0, lineRemaining) : null,
        existing_delivery_orders: existingDeliveryOrders,
        transporter_resolution: transporterResolution,
        storage_location: lookup.storageByCode.get(toUpperTrimmedString(row.storage_location_code)) ?? null,
        storage_location_candidates: lookup.finishedGoodsLocations,
        missing_required_fields: missingRequired, format_errors: formatErrors,
      });
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.info("DO_BULK_PREVIEW_TIMING", { request_id: ctx.request_id, row_count: rows.length, unique_source_count: lookup.resolvedByIdentifier.size, elapsed_ms: elapsedMs });
    return okResponse({ data: results, metrics: { row_count: rows.length, unique_source_count: lookup.resolvedByIdentifier.size, elapsed_ms: elapsedMs } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_PREVIEW_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

function accumulateDrawnDeliveryOrders(rows: JsonRecord[], sourceKey: "so_map_allocation_id" | "so_line_id"): DrawnDeliveryOrderLookup {
  const drawnByKey = new Map<string, number>();
  const perSourceDo = new Map<string, Map<string, ExistingDeliveryOrder>>();
  for (const row of rows) {
    const key = toTrimmedString(row[sourceKey]);
    const deliveryChallan = (row.delivery_challan && typeof row.delivery_challan === "object" ? row.delivery_challan : {}) as JsonRecord;
    const dcNumber = toTrimmedString(deliveryChallan.dc_number);
    const dcId = toTrimmedString(deliveryChallan.id) || dcNumber;
    const quantity = Number(row.quantity ?? 0);
    if (!key || !dcId || !Number.isFinite(quantity)) continue;
    drawnByKey.set(key, (drawnByKey.get(key) ?? 0) + quantity);
    const deliveryOrders = perSourceDo.get(key) ?? new Map<string, ExistingDeliveryOrder>();
    const existing = deliveryOrders.get(dcId);
    deliveryOrders.set(dcId, { dc_number: dcNumber || "DO", quantity: (existing?.quantity ?? 0) + quantity });
    perSourceDo.set(key, deliveryOrders);
  }
  return {
    drawnByKey,
    deliveryOrdersByKey: new Map([...perSourceDo.entries()].map(([key, values]) => [key, [...values.values()].sort((left, right) => left.dc_number.localeCompare(right.dc_number))])),
  };
}

async function computeDrawnDeliveryOrdersByAllocation(allocationIds: string[]): Promise<DrawnDeliveryOrderLookup> {
  if (allocationIds.length === 0) return { drawnByKey: new Map(), deliveryOrdersByKey: new Map() };
  const rows = await fetchInChunks<JsonRecord>(allocationIds, (chunk) =>
    serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("so_map_allocation_id, quantity, delivery_challan!inner(id, dc_number, status)")
      .in("so_map_allocation_id", chunk).neq("delivery_challan.status", "CANCELLED"));
  return accumulateDrawnDeliveryOrders(rows, "so_map_allocation_id");
}

async function computeDrawnDeliveryOrdersByLine(soLineIds: string[]): Promise<DrawnDeliveryOrderLookup> {
  if (soLineIds.length === 0) return { drawnByKey: new Map(), deliveryOrdersByKey: new Map() };
  const rows = await fetchInChunks<JsonRecord>(soLineIds, (chunk) =>
    serviceRoleClient.schema("erp_procurement").from("delivery_challan_line")
      .select("so_line_id, quantity, delivery_challan!inner(id, dc_number, status)")
      .in("so_line_id", chunk).neq("delivery_challan.status", "CANCELLED"));
  return accumulateDrawnDeliveryOrders(rows, "so_line_id");
}

type SaveGroupInput = {
  submission_group_key: string;
  fo_or_so_number: string;
  dd_flag: boolean;
  so_id: string;
  map_group_id?: string | null;
  do_date?: string;
  transporter_id: string;
  lr_number: string;
  lr_date: string;
  truck_number?: string;
  dispatch_date?: string;
  tally_invoice_number?: string;
  tally_invoice_date?: string;
  inbound_number?: string;
  rows: Array<{
    so_line_id: string;
    so_map_allocation_id?: string | null;
    base_qty: number;
    storage_location_id: string;
  }>;
};

function canonicalBulkGroupPayload(group: SaveGroupInput): JsonRecord {
  return {
    fo_or_so_number: toTrimmedString(group.fo_or_so_number),
    dd_flag: group.dd_flag === true,
    so_id: toTrimmedString(group.so_id),
    do_date: normalizeInputDate(group.do_date),
    transporter_id: toTrimmedString(group.transporter_id),
    lr_number: toTrimmedString(group.lr_number),
    lr_date: normalizeInputDate(group.lr_date),
    truck_number: toTrimmedString(group.truck_number),
    dispatch_date: normalizeInputDate(group.dispatch_date),
    tally_invoice_number: toTrimmedString(group.tally_invoice_number),
    tally_invoice_date: normalizeInputDate(group.tally_invoice_date),
    inbound_number: toTrimmedString(group.inbound_number),
    rows: [...(group.rows ?? [])].map((row) => ({
      so_line_id: toTrimmedString(row.so_line_id),
      so_map_allocation_id: toTrimmedString(row.so_map_allocation_id),
      base_qty: Number(row.base_qty),
      storage_location_id: toTrimmedString(row.storage_location_id),
    })).sort((left, right) => `${left.so_line_id}:${left.so_map_allocation_id}`.localeCompare(`${right.so_line_id}:${right.so_map_allocation_id}`)),
  };
}

async function fingerprintBulkGroup(group: SaveGroupInput): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalBulkGroupPayload(group)));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function recordBulkGroupFailure(
  submissionId: string,
  group: SaveGroupInput,
  companyId: string,
  actorId: string,
  fingerprint: string,
  errorCode: string,
): Promise<void> {
  const { error } = await serviceRoleClient.schema("erp_procurement").rpc("record_bulk_delivery_order_submission_group_failure", {
    p_submission_id: submissionId,
    p_group_key: group.submission_group_key,
    p_company_id: companyId,
    p_actor: actorId,
    p_source_reference: toTrimmedString(group.fo_or_so_number),
    p_payload_fingerprint: fingerprint,
    p_error_code: errorCode,
  });
  if (error) throw new Error("DO_BULK_SUBMISSION_FAILURE_RECORD_FAILED");
}

// DC-only: a Depot destination needs no customer/address choice at all (the
// depot company itself is always the Ship-To), so when a matched SO line
// has no existing ACTIVE allocation yet, this auto-creates exactly one via
// the EXISTING, unmodified saveSoMapGroupHandler(source:"depot") — the same
// call the business owner's manual "map to Fixed Depot" button in
// SO01MapPage.jsx's MapDrawer already makes. Never invents new allocation
// logic; always re-queries afterward for the real row id/qty the atomic RPC
// actually wrote.
async function ensureDepotAllocation(req: Request, ctx: ProcurementHandlerContext, soId: string, soLineId: string, baseQty: number): Promise<{ allocation_id: string } | { error_code: string }> {
  const { data: existing, error: existingError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation")
    .select("id, allocated_qty").eq("so_line_id", soLineId).eq("status", "ACTIVE");
  if (existingError) return { error_code: "DO_BULK_ALLOCATION_LOOKUP_FAILED" };
  const existingRows = (existing ?? []) as JsonRecord[];
  const alreadyAllocated = existingRows.reduce((sum, row) => sum + Number(row.allocated_qty ?? 0), 0);
  if (existingRows.length > 0 && alreadyAllocated + QTY_TOL >= baseQty) {
    // Reuse the first ACTIVE allocation for this line — createDeliveryOrderUnifiedHandler's
    // own balance check (allocated_qty − already drawn) governs exactly how
    // much of it this DO line may actually draw.
    return { allocation_id: toTrimmedString(existingRows[0].id) };
  }
  const groupReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({ so_id: soId, source: "depot", items: [{ so_line_id: soLineId, allocated_qty: baseQty }] }),
    headers: req.headers,
  });
  const groupResp = await saveSoMapGroupHandler(groupReq, ctx);
  const groupJson = await groupResp.json().catch(() => null) as { ok?: boolean; data?: JsonRecord; error?: JsonRecord } | null;
  if (!groupResp.ok || !groupJson?.ok || !groupJson.data?.group_id) {
    return { error_code: toTrimmedString(groupJson?.error && (groupJson.error as JsonRecord).code) || "DO_BULK_DEPOT_MAP_FAILED" };
  }
  const { data: createdAlloc, error: createdError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_order_map_allocation")
    .select("id").eq("map_group_id", toTrimmedString(groupJson.data.group_id)).eq("so_line_id", soLineId).eq("status", "ACTIVE").maybeSingle();
  if (createdError || !createdAlloc) return { error_code: "DO_BULK_DEPOT_MAP_LOOKUP_FAILED" };
  return { allocation_id: toTrimmedString((createdAlloc as JsonRecord).id) };
}

// Save — one Delivery Order per resolved FO/SO group, driving the EXISTING
// createDeliveryOrderUnifiedHandler exactly as-is (gate_entry.handlers.ts's
// synthetic-Request pattern), then a single additive follow-up UPDATE for
// the columns that handler's own RPC payload has no slot for at all.
export async function saveDoBulkUploadHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  const startedAt = performance.now();
  try {
    const body = await parseBody(req);
    const companyId = await getCompanyScope(ctx, toTrimmedString(body.company_id));
    if (!companyId) return doBulkErrorResponse(req, ctx, "DO_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "WRITE"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    }
    const groups = Array.isArray(body.groups) ? (body.groups as SaveGroupInput[]) : [];
    if (groups.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_GROUPS_REQUIRED", 400, "At least one group is required.");
    const submissionId = toTrimmedString(body.submission_id);
    if (!UUID_PATTERN.test(submissionId) || groups.some((group) => !UUID_PATTERN.test(toTrimmedString(group.submission_group_key)))) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_SUBMISSION_IDENTITY_REQUIRED", 400, "A valid submission and stable group identity are required.");
    }
    if (new Set(groups.map((group) => toTrimmedString(group.submission_group_key))).size !== groups.length) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_SUBMISSION_GROUP_KEY_DUPLICATE", 400, "Each submitted Delivery Order group needs a distinct identity.");
    }

    const results: JsonRecord[] = [];
    const groupDurationsMs: number[] = [];
    for (const group of groups) {
      const groupStartedAt = performance.now();
      let fingerprint = "";
      try {
        fingerprint = await fingerprintBulkGroup(group);
        const doDate = normalizeInputDate(group.do_date);
        const lrDate = normalizeInputDate(group.lr_date);
        const dispatchDate = normalizeInputDate(group.dispatch_date);
        const tallyInvoiceDate = normalizeInputDate(group.tally_invoice_date);
        if (!isIsoDate(doDate)) throw new Error("DO_BULK_DO_DATE_REQUIRED_OR_INVALID");
        if (!toTrimmedString(group.lr_number) || !isIsoDate(lrDate)) throw new Error("DO_BULK_LR_FIELDS_REQUIRED_OR_INVALID");
        if (dispatchDate && !isIsoDate(dispatchDate)) throw new Error("DO_BULK_DISPATCH_DATE_INVALID");
        if (tallyInvoiceDate && !isIsoDate(tallyInvoiceDate)) throw new Error("DO_BULK_TALLY_INVOICE_DATE_INVALID");
        if (!toTrimmedString(group.transporter_id)) throw new Error("DO_BULK_TRANSPORTER_REQUIRED");
        if (!Array.isArray(group.rows) || group.rows.length === 0 || group.rows.some((row) => !Number.isFinite(Number(row.base_qty)) || Number(row.base_qty) <= 0)) {
          throw new Error("DO_BULK_LINE_QTY_INVALID");
        }
        const { data: transporter, error: transporterError } = await serviceRoleClient
          .schema("erp_master").from("transporter_master")
          .select("id").eq("id", toTrimmedString(group.transporter_id)).eq("active", true).maybeSingle();
        if (transporterError || !transporter) throw new Error("DO_BULK_TRANSPORTER_INVALID");
        // Never trust the browser's DD flag. Resolve the SO's persisted DD
        // marker again at commit time: Direct selects the FO/allocation
        // source, while is_dd_dispatch alone selects deferred Invoice→PGI.
        const { data: sourceSo, error: sourceSoError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_order").select("dispatch_type, is_dd_dispatch")
          .eq("id", toTrimmedString(group.so_id)).maybeSingle();
        if (sourceSoError || !sourceSo) throw new Error("DO_BULK_SOURCE_SO_NOT_FOUND");
        const actualDispatchType = toUpperTrimmedString((sourceSo as JsonRecord).dispatch_type);
        const isVdc = actualDispatchType === "DEPENDENT_DIRECT";
        const isDc = actualDispatchType === "DEPENDENT_DEPOT";
        const isDdDispatch = isVdc && (sourceSo as JsonRecord).is_dd_dispatch === true;
        if (Boolean(group.dd_flag) !== isDdDispatch || (!isVdc && !isDc)) {
          throw new Error("DO_BULK_DD_FLAG_SOURCE_MISMATCH");
        }
        const sourceReference = await resolveFoOrSo(toTrimmedString(group.fo_or_so_number), companyId);
        if ((isVdc && (sourceReference.status !== "VDC" || sourceReference.so_id !== group.so_id))
          || (isDc && (sourceReference.status !== "DC" || sourceReference.so_id !== group.so_id))) {
          throw new Error("DO_BULK_SOURCE_REFERENCE_INVALID");
        }
        if (!isDdDispatch) {
          if (!toTrimmedString(group.truck_number) || !dispatchDate) {
            throw new Error("DO_BULK_DC_TRUCK_DISPATCH_REQUIRED");
          }
        }
        const lines: JsonRecord[] = [];
        for (const row of group.rows) {
          const { data: soLine, error: soLineError } = await serviceRoleClient
            .schema("erp_procurement").from("sales_order_line")
            .select("id, so_id").eq("id", toTrimmedString(row.so_line_id)).maybeSingle();
          if (soLineError || !soLine || toTrimmedString((soLine as JsonRecord).so_id) !== toTrimmedString(group.so_id)) {
            throw new Error("DO_BULK_SO_LINE_SOURCE_INVALID");
          }
          const { data: storageLocation, error: storageLocationError } = await serviceRoleClient
            .schema("erp_inventory").from("storage_location_master")
            .select("id, code, active").eq("id", toTrimmedString(row.storage_location_id)).maybeSingle();
          if (storageLocationError || !storageLocation || (storageLocation as JsonRecord).active !== true || !toUpperTrimmedString((storageLocation as JsonRecord).code).startsWith("F")) {
            throw new Error("DO_BULK_FG_STORAGE_LOCATION_REQUIRED");
          }
          let allocationId = toTrimmedString(row.so_map_allocation_id);
          if (isVdc) {
            const { data: allocation, error: allocationError } = await serviceRoleClient
              .schema("erp_procurement").from("sales_order_map_allocation")
              .select("id, map_group_id, so_line_id, status")
              .eq("id", allocationId).maybeSingle();
            if (allocationError || !allocation
              || toUpperTrimmedString((allocation as JsonRecord).status) !== "ACTIVE"
              || toTrimmedString((allocation as JsonRecord).map_group_id) !== toTrimmedString(sourceReference.map_group_id)
              || toTrimmedString((allocation as JsonRecord).so_line_id) !== toTrimmedString(row.so_line_id)) {
              throw new Error("DO_BULK_VDC_ALLOCATION_INVALID");
            }
          }
          if (!allocationId && isDc) {
            const ensured = await ensureDepotAllocation(req, ctx, group.so_id, row.so_line_id, row.base_qty);
            if ("error_code" in ensured) throw new Error(ensured.error_code);
            allocationId = ensured.allocation_id;
          }
          if (!allocationId) throw new Error("DO_BULK_LINE_ALLOCATION_MISSING");
          lines.push({
            so_map_allocation_id: allocationId,
            quantity: row.base_qty,
            storage_location_id: row.storage_location_id,
          });
        }

        const createPayload: JsonRecord = {
          company_id: companyId,
          lines,
          transporter_id: group.transporter_id,
          lr_number: group.lr_number,
          lr_date: lrDate,
          vehicle_number: toTrimmedString(group.truck_number) || undefined,
          // `do_unified` validates the identity then calls the existing
          // transactional DO creator through the DB wrapper.  The wrapper
          // persists the group outcome atomically with the created DO.
          bulk_submission_id: submissionId,
          bulk_submission_group_key: toTrimmedString(group.submission_group_key),
          bulk_submission_fingerprint: fingerprint,
          bulk_submission_source_reference: toTrimmedString(group.fo_or_so_number),
          bulk_submission_patch: {
            do_date: doDate || undefined,
            dispatch_date: dispatchDate || undefined,
            tally_invoice_number: toTrimmedString(group.tally_invoice_number) || undefined,
            tally_invoice_date: tallyInvoiceDate || undefined,
            inbound_number: toTrimmedString(group.inbound_number) || undefined,
          },
        };
        // DD/VDC creation is always commercial-only. Truck/dispatch values
        // may already be present in the source workbook, but they are merely
        // captured on the DO at this point. Physical stock validation,
        // reservation and PGI belong exclusively to the later FO-keyed
        // Truck + Dispatch Date Upload Post action. DC continues through the
        // established create handler and therefore retains its live stock
        // validation/reservation behaviour unchanged.
        const deferVdcReservation = isDdDispatch;
        const createReq = new Request(req.url, {
          method: "POST",
          body: JSON.stringify(createPayload),
          headers: req.headers,
        });
        const createResp = deferVdcReservation
          ? await createDeferredVdcBulkDeliveryOrder(req, ctx, createPayload)
          : await createDeliveryOrderUnifiedHandler(createReq, ctx);
        const createJson = await createResp.json().catch(() => null) as { ok?: boolean; data?: JsonRecord; code?: string; error?: JsonRecord } | null;
        if (!createResp.ok || !createJson?.ok || !createJson.data?.id) {
          // errorResponse() uses a top-level `code`; preserve it so a future
          // row-level failure is actionable instead of collapsing into the
          // unhelpful generic DO_BULK_CREATE_FAILED label.
          throw new Error(toTrimmedString(createJson?.code)
            || toTrimmedString(createJson?.error && (createJson.error as JsonRecord).code)
            || "DO_BULK_CREATE_FAILED");
        }
        const dcId = toTrimmedString(createJson.data.id);
        const reused = (createJson.data.bulk_submission as JsonRecord | undefined)?.reused === true;
        results.push({ submission_group_key: group.submission_group_key, fo_or_so_number: group.fo_or_so_number, status: "CREATED", dc_id: dcId, reused });
      } catch (groupError) {
        const code = groupError instanceof Error ? groupError.message : "DO_BULK_GROUP_FAILED";
        try {
          await recordBulkGroupFailure(submissionId, group, companyId, ctx.auth_user_id, fingerprint, code);
        } catch (recordError) {
          const recordCode = recordError instanceof Error ? recordError.message : "DO_BULK_SUBMISSION_FAILURE_RECORD_FAILED";
          results.push({ submission_group_key: group.submission_group_key, fo_or_so_number: group.fo_or_so_number, status: "ERROR", error_code: recordCode });
          continue;
        }
        results.push({ submission_group_key: group.submission_group_key, fo_or_so_number: group.fo_or_so_number, status: "ERROR", error_code: code });
      } finally {
        groupDurationsMs.push(Math.round(performance.now() - groupStartedAt));
      }
    }

    const { data: outcomeRows, error: outcomeError } = await serviceRoleClient
      .schema("erp_procurement").from("bulk_do_submission_group")
      .select("status").eq("submission_id", submissionId);
    if (!outcomeError) {
      const statuses: string[] = ((outcomeRows ?? []) as JsonRecord[]).map((row: JsonRecord) => toUpperTrimmedString(row.status));
      const created = statuses.filter((status: string) => status === "CREATED").length;
      const failed = statuses.filter((status: string) => status === "FAILED").length;
      const status = failed === 0 ? "COMPLETED" : created > 0 ? "PARTIAL" : "FAILED";
      await serviceRoleClient.schema("erp_procurement").from("bulk_do_submission")
        .update({ status, updated_at: new Date().toISOString() }).eq("id", submissionId).eq("company_id", companyId).eq("submitted_by", ctx.auth_user_id);
    }
    const sortedDurations = [...groupDurationsMs].sort((left, right) => left - right);
    const elapsedMs = Math.round(performance.now() - startedAt);
    const averageGroupMs = sortedDurations.length === 0 ? 0 : Math.round(sortedDurations.reduce((sum, duration) => sum + duration, 0) / sortedDurations.length);
    const p95GroupMs = sortedDurations.length === 0 ? 0 : sortedDurations[Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * 0.95) - 1)];
    console.info("DO_BULK_SAVE_TIMING", {
      request_id: ctx.request_id,
      group_count: groups.length,
      created_count: results.filter((result) => result.status === "CREATED").length,
      failed_count: results.filter((result) => result.status === "ERROR").length,
      elapsed_ms: elapsedMs,
      average_group_ms: averageGroupMs,
      p95_group_ms: p95GroupMs,
    });
    return okResponse({ submission_id: submissionId, data: results, metrics: { group_count: groups.length, elapsed_ms: elapsedMs, average_group_ms: averageGroupMs, p95_group_ms: p95GroupMs } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_SAVE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

// P0 reconciliation endpoint.  It is intentionally read-only and never
// rebuilds a preview or replays business work.  After an HTTP timeout or a
// browser refresh, this is the authority for whether a group committed a DO.
export async function getDoBulkSubmissionStatusHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, toTrimmedString(url.searchParams.get("company_id")));
    const submissionId = toTrimmedString(url.searchParams.get("submission_id"));
    if (!companyId || !UUID_PATTERN.test(submissionId)) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_SUBMISSION_ID_REQUIRED", 400, "company_id and submission_id are required.");
    }
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "VIEW"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Delivery Order access at this company.");
    }
    const { data: submission, error: submissionError } = await serviceRoleClient
      .schema("erp_procurement").from("bulk_do_submission")
      .select("id, status, company_id, submitted_by, created_at, updated_at")
      .eq("id", submissionId).eq("company_id", companyId).eq("submitted_by", ctx.auth_user_id).maybeSingle();
    if (submissionError || !submission) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_SUBMISSION_NOT_FOUND", 404, "The Bulk DO submission was not found for this user and company.");
    }
    const { data: groups, error: groupsError } = await serviceRoleClient
      .schema("erp_procurement").from("bulk_do_submission_group")
      .select("client_group_key, source_reference, status, delivery_challan_id, error_code, attempt_count, updated_at")
      .eq("submission_id", submissionId).order("created_at", { ascending: true });
    if (groupsError) return doBulkErrorResponse(req, ctx, "DO_BULK_SUBMISSION_RECONCILE_FAILED", 500, "Unable to reconcile the Bulk DO submission.");
    const resultRows = (groups ?? []) as JsonRecord[];
    const created = resultRows.filter((row) => toUpperTrimmedString(row.status) === "CREATED").length;
    const failed = resultRows.filter((row) => toUpperTrimmedString(row.status) === "FAILED").length;
    const processing = resultRows.filter((row) => toUpperTrimmedString(row.status) === "PROCESSING").length;
    const status = processing > 0 ? "PROCESSING" : failed === 0 ? "COMPLETED" : created > 0 ? "PARTIAL" : "FAILED";
    if (toUpperTrimmedString((submission as JsonRecord).status) !== status) {
      await serviceRoleClient.schema("erp_procurement").from("bulk_do_submission")
        .update({ status, updated_at: new Date().toISOString() }).eq("id", submissionId).eq("company_id", companyId).eq("submitted_by", ctx.auth_user_id);
    }
    return okResponse({
      submission_id: submissionId,
      status,
      counts: { total: resultRows.length, created, failed, processing, pending: resultRows.length - created - failed - processing },
      groups: resultRows,
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_SUBMISSION_RECONCILE_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

// §6 points 13/16 — the Bulk SO03 editor is FO-keyed because the business
// owner operates from the Sales/Dispatch FO Number, not an internal DO id.
// It remains available after VDC PGI as well: the business rule explicitly
// permits header corrections after DO create, invoice post, and PGI post.
// This additive endpoint never changes a line, reservation, or stock event.
const BULK_DISPATCH_HEADER_EDITABLE_STATUSES = new Set(["CREATED", "INVOICED", "DISPATCHED"]);

export async function findDoByFoNumberHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await getCompanyScope(ctx, toTrimmedString(url.searchParams.get("company_id")));
    if (!companyId) return doBulkErrorResponse(req, ctx, "DO_BULK_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "VIEW"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Create-DO access at this company.");
    }
    const foNumber = toTrimmedString(url.searchParams.get("fo_number"));
    if (!foNumber) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NUMBER_REQUIRED", 400, "fo_number is required.");

    const [originalResult, revisedResult] = await Promise.all([
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select("id, so:so_id(company_id)").eq("external_fo_number", foNumber).eq("status", "ACTIVE").maybeSingle(),
      serviceRoleClient.schema("erp_procurement").from("sales_order_map_group")
        .select("id, so:so_id(company_id)").eq("revised_external_fo_number", foNumber).eq("status", "ACTIVE").maybeSingle(),
    ]);
    const groupRow = originalResult.data ?? revisedResult.data;
    const groupError = originalResult.error ?? revisedResult.error;
    if (groupError) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_LOOKUP_FAILED", 500, "Unable to look up this FO Number.");
    if (!groupRow) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_FOUND", 404, "This FO Number is not mapped yet.");
    const so = (groupRow as JsonRecord).so as JsonRecord | null;
    if (!so || toUpperTrimmedString(so.company_id) !== toUpperTrimmedString(companyId)) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_FOUND", 404, "This FO Number is not mapped in this company.");
    }

    const { data: allocRows, error: allocError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .select("id").eq("map_group_id", toTrimmedString((groupRow as JsonRecord).id));
    if (allocError) return doBulkErrorResponse(req, ctx, "DO_BULK_ALLOCATION_LOOKUP_FAILED", 500, "Unable to look up this FO's allocations.");
    const allocationIds = ((allocRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.id));
    if (allocationIds.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_DISPATCHED", 404, "This FO has no Delivery Order yet.");

    const { data: lineRows, error: lineError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan_line")
      .select("dc_id").in("so_map_allocation_id", allocationIds);
    if (lineError) return doBulkErrorResponse(req, ctx, "DO_BULK_LINE_LOOKUP_FAILED", 500, "Unable to look up this FO's Delivery Order.");
    const dcIds = [...new Set(((lineRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.dc_id)).filter(Boolean))];
    if (dcIds.length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_DISPATCHED", 404, "This FO has no Delivery Order yet.");

    const { data: dcRows, error: dcError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan")
      .select("id, dc_number, status, transporter_id, transporter_name_freetext, lr_number, lr_date, vehicle_number, dispatch_date, pgi_deferred")
      .in("id", dcIds).neq("status", "CANCELLED").order("dc_date", { ascending: false });
    if (dcError) return doBulkErrorResponse(req, ctx, "DO_BULK_DO_LOOKUP_FAILED", 500, "Unable to load this FO's Delivery Order.");
    const dcRow = ((dcRows ?? []) as JsonRecord[])[0];
    if (!dcRow) return doBulkErrorResponse(req, ctx, "DO_BULK_FO_NOT_DISPATCHED", 404, "This FO has no active Delivery Order.");
    if (!BULK_DISPATCH_HEADER_EDITABLE_STATUSES.has(toUpperTrimmedString(dcRow.status))) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_WINDOW_CLOSED", 400, "This Delivery Order is cancelled and cannot be edited.");
    }

    let transporterDisplay: string | null = toTrimmedString(dcRow.transporter_name_freetext) || null;
    if (dcRow.transporter_id) {
      const { data: transporter } = await serviceRoleClient
        .schema("erp_master").from("transporter_master").select("transporter_code, transporter_name").eq("id", toTrimmedString(dcRow.transporter_id)).maybeSingle();
      if (transporter) transporterDisplay = `${toTrimmedString((transporter as JsonRecord).transporter_code)} — ${toTrimmedString((transporter as JsonRecord).transporter_name)}`;
    }

    return okResponse({
      dc_id: dcRow.id,
      dc_number: dcRow.dc_number,
      status: dcRow.status,
      transporter_id: dcRow.transporter_id,
      transporter_display: transporterDisplay,
      lr_number: dcRow.lr_number,
      lr_date: dcRow.lr_date,
      truck_number: dcRow.vehicle_number,
      dispatch_date: dcRow.dispatch_date,
      dd_flag: dcRow.pgi_deferred === true,
      dispatch_date_locked: dcRow.pgi_deferred === true && toUpperTrimmedString(dcRow.status) === "DISPATCHED",
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_FO_LOOKUP_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : code.includes("NOT_FOUND") || code.includes("NOT_DISPATCHED") ? 404 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}

// §6 point 16 — this page only updates data; it never triggers PGI (that
// happens separately via the Truck+Dispatch Date Upload page's Post action,
// §6 point 19/Phase 5). A direct, additive UPDATE on delivery_challan's own
// header columns — never routed through updateDeliveryOrderUnifiedHandler,
// since that handler mandatorily replaces the whole line set and this edit
// never touches lines at all.
export async function editTransporterDetailsHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = await parseBody(req);
    const dcId = toTrimmedString(body.dc_id);
    if (!dcId) return doBulkErrorResponse(req, ctx, "DO_BULK_DC_ID_REQUIRED", 400, "dc_id is required.");
    const lrDate = toTrimmedString(body.lr_date);
    if (lrDate && !isManualDocumentDateWithinWindow(lrDate)) {
      return doBulkErrorResponse(req, ctx, "DO_MANUAL_DATE_OUTSIDE_ALLOWED_WINDOW", 400, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
    }

    const { data: dc, error: dcError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan").select("id, status, selling_company_id, lr_date, dispatch_date, pgi_deferred").eq("id", dcId).maybeSingle();
    if (dcError || !dc) return doBulkErrorResponse(req, ctx, "DO_BULK_DO_NOT_FOUND", 404, "Delivery order not found.");
    const companyId = toTrimmedString((dc as JsonRecord).selling_company_id);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }
    if (!(await canMaintainDoBulkAccess(ctx, companyId, "EDIT"))) {
      return doBulkErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have Edit-DO access at this company.");
    }
    if (!BULK_DISPATCH_HEADER_EDITABLE_STATUSES.has(toUpperTrimmedString((dc as JsonRecord).status))) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_WINDOW_CLOSED", 400, "This Delivery Order is cancelled and cannot be edited.");
    }

    const truckNumber = toTrimmedString(body.truck_number);
    if (truckNumber && truckNumber.length < 4) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_TRUCK_INVALID", 400, "Truck Number must contain at least 4 characters.");
    }
    const dispatchDate = toTrimmedString(body.dispatch_date);
    // DD DO: once PGI is posted (DISPATCHED) the stock movement already carries
    // this Dispatch Date, so it can no longer change.
    if (dispatchDate && (dc as JsonRecord).pgi_deferred === true && toUpperTrimmedString((dc as JsonRecord).status) === "DISPATCHED"
      && dispatchDate !== toTrimmedString((dc as JsonRecord).dispatch_date).slice(0, 10)) {
      return doBulkErrorResponse(req, ctx, "DO_BULK_DISPATCH_DATE_LOCKED", 400, "PGI is already posted for this DO; its Dispatch Date cannot change.");
    }
    if (dispatchDate) {
      const effectiveLrDate = lrDate || toTrimmedString((dc as JsonRecord).lr_date);
      if (!isIsoDate(dispatchDate) || !isIsoDate(effectiveLrDate) || dispatchDate < effectiveLrDate || dispatchDate > todayIsoInKolkata()) {
        return doBulkErrorResponse(req, ctx, "DO_BULK_DISPATCH_DATE_INVALID", 400, "Dispatch Date must be on/after LR Date and cannot be in the future.");
      }
    }

    const patch: JsonRecord = {};
    if (toTrimmedString(body.transporter_id)) patch.transporter_id = toTrimmedString(body.transporter_id);
    if (toTrimmedString(body.lr_number)) patch.lr_number = toTrimmedString(body.lr_number);
    if (lrDate) patch.lr_date = lrDate;
    if (truckNumber) patch.vehicle_number = truckNumber;
    if (dispatchDate) patch.dispatch_date = dispatchDate;
    if (Object.keys(patch).length === 0) return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_NO_FIELDS", 400, "At least one field is required.");

    const { error: patchError } = await serviceRoleClient
      .schema("erp_procurement").from("delivery_challan").update(patch).eq("id", dcId);
    if (patchError) return doBulkErrorResponse(req, ctx, "DO_BULK_EDIT_FAILED", 500, "Unable to update dispatch details.");

    return okResponse({ dc_id: dcId, updated: true }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DO_BULK_EDIT_FAILED";
    const status = code === "COMPANY_SCOPE_VIOLATION" ? 403 : code.includes("REQUIRED") ? 400 : code.includes("NOT_FOUND") ? 404 : 500;
    return doBulkErrorResponse(req, ctx, code, status, code);
  }
}
