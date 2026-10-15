/* SO03 APL Invoice Case — SALES DO only. */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { errorResponse, okResponse } from "../response.ts";
import { canMaintainDoBulkAccess } from "./do_bulk.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = { context: Extract<ContextResolution, { status: "RESOLVED" }>; request_id: string; auth_user_id: string; roleCode: string; };
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const fail = (req: Request, ctx: ProcurementHandlerContext, code: string, status: number, message: string) => errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
const body = (req: Request) => req.json().catch(() => ({} as JsonRecord));
const ids = (rows: JsonRecord[], key = "id") => [...new Set(rows.map((row) => text(row[key])).filter(Boolean))];

async function assertDoAccess(req: Request, ctx: ProcurementHandlerContext, companyId: string, action: "VIEW" | "EDIT") {
  try { await assertCompanyScope(ctx, companyId); } catch { return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company."); }
  if (!(await canMaintainDoBulkAccess(ctx, companyId, action))) return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, `You do not have Delivery Order ${action === "VIEW" ? "view" : "edit"} access at this company.`);
  return null;
}

function stateLabel(row: JsonRecord | undefined) {
  if (!row) return "Not recorded";
  if (upper(row.status) === "YES") return `Yes, received ${text(row.received_date)}`;
  if (upper(row.status) === "CANCELLED") return "Cancelled";
  return `No since ${text(row.updated_at).slice(0, 10)}`;
}

async function candidateRows(companyId: string, lookup: string): Promise<JsonRecord[]> {
  const [foOriginal, foRevised, invoiceErp, invoiceTally] = await Promise.all([
    serviceRoleClient.schema("erp_procurement").from("sales_order_map_group").select("id, external_fo_number, revised_external_fo_number, so:so_id!inner(company_id)").eq("external_fo_number", lookup).eq("status", "ACTIVE"),
    serviceRoleClient.schema("erp_procurement").from("sales_order_map_group").select("id, external_fo_number, revised_external_fo_number, so:so_id!inner(company_id)").eq("revised_external_fo_number", lookup).eq("status", "ACTIVE"),
    serviceRoleClient.schema("erp_procurement").from("sales_invoice").select("dc_id").eq("invoice_number", lookup),
    serviceRoleClient.schema("erp_procurement").from("sales_invoice").select("dc_id").eq("tally_invoice_number", lookup),
  ]);
  if (foOriginal.error || foRevised.error || invoiceErp.error || invoiceTally.error) throw new Error("APL_CASE_LOOKUP_FAILED");
  const groups = [...((foOriginal.data ?? []) as JsonRecord[]), ...((foRevised.data ?? []) as JsonRecord[])]
    .filter((row) => text((Array.isArray(row.so) ? row.so[0] : row.so as JsonRecord | null)?.company_id) === companyId);
  const groupIds = ids(groups);
  const allocations = await fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation").select("id").in("map_group_id", chunk));
  const allocationIds = ids(allocations);
  const foDocs = await fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan_line").select("dc_id").in("so_map_allocation_id", chunk));
  const directIds = [...ids((invoiceErp.data ?? []) as JsonRecord[], "dc_id"), ...ids((invoiceTally.data ?? []) as JsonRecord[], "dc_id")];
  const dcIds = [...new Set([...ids(foDocs, "dc_id"), ...directIds])];
  const docs = await fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
    .select("id, dc_number, status, dc_type, selling_company_id, customer_id, pgi_deferred").eq("selling_company_id", companyId).eq("dc_type", "SALES").neq("status", "CANCELLED").in("id", chunk));
  return docs;
}

async function hydrateCandidates(companyId: string, docs: JsonRecord[]) {
  const dcIds = ids(docs);
  const [invoices, cases, lines] = await Promise.all([
    fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_invoice").select("id, dc_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date, status, created_at").in("dc_id", chunk).order("created_at", { ascending: false })),
    fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_order_apl_invoice_case").select("dc_id, status, received_date, updated_at").eq("company_id", companyId).in("dc_id", chunk)),
    fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan_line").select("dc_id, so_map_allocation_id").in("dc_id", chunk)),
  ]);
  const allocationIds = ids(lines, "so_map_allocation_id");
  const allocations = await fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order_map_allocation")
    .select("id, map_group:map_group_id(external_fo_number, revised_external_fo_number)").in("id", chunk));
  const customerIds = ids(docs, "customer_id");
  const customers = await fetchInChunks<JsonRecord>(customerIds, (chunk) => serviceRoleClient.schema("erp_master").from("customer_master").select("id, customer_code, customer_name").in("id", chunk));
  const invoiceByDc = new Map<string, JsonRecord>();
  for (const invoice of invoices) if (!invoiceByDc.has(text(invoice.dc_id))) invoiceByDc.set(text(invoice.dc_id), invoice);
  const caseByDc = new Map(cases.map((row) => [text(row.dc_id), row]));
  const groupByAllocation = new Map(allocations.map((row) => [text(row.id), (Array.isArray(row.map_group) ? row.map_group[0] : row.map_group) as JsonRecord | null]));
  const foByDc = new Map<string, string>();
  for (const line of lines) {
    const group = groupByAllocation.get(text(line.so_map_allocation_id));
    const fo = text(group?.revised_external_fo_number) || text(group?.external_fo_number);
    if (fo && !foByDc.has(text(line.dc_id))) foByDc.set(text(line.dc_id), fo);
  }
  const customerById = new Map(customers.map((row) => [text(row.id), row]));
  return docs.map((doc) => {
    const invoice = invoiceByDc.get(text(doc.id)); const aplCase = caseByDc.get(text(doc.id)); const customer = customerById.get(text(doc.customer_id));
    return {
      dc_id: text(doc.id), dc_number: text(doc.dc_number), fo_number: foByDc.get(text(doc.id)) || null,
      invoice_number: text(invoice?.tally_invoice_number) || text(invoice?.invoice_number) || null,
      invoice_date: text(invoice?.tally_invoice_date) || text(invoice?.invoice_date) || null,
      party: customer ? [text(customer.customer_code), text(customer.customer_name)].filter(Boolean).join(" — ") : null,
      status: text(doc.status), pgi_done: upper(doc.status) === "DISPATCHED",
      dd_flag: doc.pgi_deferred === true, apl_invoice_state: stateLabel(aplCase), apl_case_status: text(aplCase?.status) || null,
    };
  });
}

export async function lookupAplInvoiceCaseHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url); const companyId = text(url.searchParams.get("company_id")); const lookup = text(url.searchParams.get("lookup"));
    if (!companyId || !lookup) return fail(req, ctx, "APL_CASE_LOOKUP_REQUIRED", 400, "company_id and an FO Number or Invoice Number are required.");
    const denied = await assertDoAccess(req, ctx, companyId, "VIEW"); if (denied) return denied;
    const candidates = await hydrateCandidates(companyId, await candidateRows(companyId, lookup));
    return okResponse({ candidates }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "APL_CASE_LOOKUP_FAILED"; return fail(req, ctx, code, 500, "Unable to look up this APL Invoice Case."); }
}

export async function saveAplInvoiceCaseHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req); const dcId = text(payload.dc_id); const companyId = text(payload.company_id); const status = upper(payload.status); const receivedDate = text(payload.received_date) || null;
    if (!dcId || !companyId || !["NO", "YES"].includes(status) || (status === "YES" && !receivedDate)) return fail(req, ctx, "APL_CASE_SAVE_INVALID", 400, "Delivery Order, company, APL Invoice Received state, and a Received Date for Yes are required.");
    const denied = await assertDoAccess(req, ctx, companyId, "EDIT"); if (denied) return denied;
    const { error } = await serviceRoleClient.schema("erp_procurement").rpc("save_apl_invoice_case", { p_dc_id: dcId, p_company_id: companyId, p_status: status, p_received_date: receivedDate, p_actor: ctx.auth_user_id });
    if (error) return fail(req, ctx, "APL_CASE_SAVE_FAILED", 409, error.message || "Unable to save the APL Invoice Case.");
    return okResponse({ saved: true }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "APL_CASE_SAVE_FAILED"; return fail(req, ctx, code, 500, code); }
}

export async function cancelAplInvoiceCaseHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const payload = await body(req); const dcId = text(payload.dc_id); const companyId = text(payload.company_id); const reason = text(payload.reason);
    if (!dcId || !companyId || !reason) return fail(req, ctx, "APL_CASE_CANCEL_INVALID", 400, "Delivery Order, company, and cancellation reason are required.");
    const denied = await assertDoAccess(req, ctx, companyId, "EDIT"); if (denied) return denied;
    const { error } = await serviceRoleClient.schema("erp_procurement").rpc("cancel_apl_sales_delivery_order_atomic", { p_dc_id: dcId, p_company_id: companyId, p_reason: reason, p_actor: ctx.auth_user_id });
    if (error) return fail(req, ctx, "APL_CASE_CANCEL_FAILED", 409, error.message || "Unable to cancel this APL Invoice Case.");
    return okResponse({ cancelled: true }, ctx.request_id, req);
  } catch (error) { const code = error instanceof Error ? error.message : "APL_CASE_CANCEL_FAILED"; return fail(req, ctx, code, 500, code); }
}
