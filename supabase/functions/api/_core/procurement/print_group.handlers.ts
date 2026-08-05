/*
 * File-Path: supabase/functions/api/_core/procurement/print_group.handlers.ts
 * Domain: PROCUREMENT
 * Purpose: Group Number lookup + print-audit log for the PO/STO printed-copy
 *          bulk print/reprint mechanism (feasibility doc §118.6/§118.7).
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";

type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const PRINTABLE_STATUSES = new Set(["CONFIRMED", "CANCELLED"]);

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function printGroupErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function resolveVendorContactBlock(vendorId: string): Promise<{
  vendor_name: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_email: string | null;
}> {
  const [{ data: vendorRow }, { data: contactRows }, { data: emailRows }] = await Promise.all([
    serviceRoleClient.schema("erp_master").from("vendor_master").select("vendor_name").eq("id", vendorId).maybeSingle(),
    serviceRoleClient.schema("erp_master").from("vendor_contacts").select("contact_name, phone, is_primary").eq("vendor_id", vendorId),
    serviceRoleClient.schema("erp_master").from("vendor_emails").select("email, is_primary").eq("vendor_id", vendorId),
  ]);

  const contacts = (contactRows ?? []) as Array<{ contact_name: string | null; phone: string | null; is_primary: boolean }>;
  const emails = (emailRows ?? []) as Array<{ email: string | null; is_primary: boolean }>;
  const primaryContact = contacts.find((row) => row.is_primary) ?? contacts[0] ?? null;
  const primaryEmail = emails.find((row) => row.is_primary) ?? emails[0] ?? null;

  return {
    vendor_name: toTrimmedString((vendorRow as Record<string, unknown> | null)?.vendor_name) || null,
    primary_contact_name: primaryContact ? toTrimmedString(primaryContact.contact_name) || null : null,
    primary_contact_phone: primaryContact ? toTrimmedString(primaryContact.phone) || null : null,
    primary_email: primaryEmail ? toTrimmedString(primaryEmail.email) || null : null,
  };
}

async function resolveCompanyNames(companyIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const { data } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, company_name")
    .in("id", uniqueIds);
  return new Map(
    ((data ?? []) as Array<{ id: string; company_name: string | null }>).map((row) => [
      String(row.id),
      toTrimmedString(row.company_name) || String(row.id),
    ]),
  );
}

export async function lookupPrintGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const groupNumber = toTrimmedString(url.searchParams.get("group_number"));
    if (!groupNumber) {
      return printGroupErrorResponse(req, ctx, "PRINT_GROUP_NUMBER_REQUIRED", 400, "group_number is required");
    }

    const { data: poGroup } = await serviceRoleClient
      .schema("erp_procurement")
      .from("po_order_group")
      .select("id, company_id, vendor_id, created_at")
      .eq("group_number", groupNumber)
      .maybeSingle();

    if (poGroup) {
      const companyId = toTrimmedString((poGroup as Record<string, unknown>).company_id);
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return printGroupErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }

      const orderGroupId = toTrimmedString((poGroup as Record<string, unknown>).id);
      const vendorId = toTrimmedString((poGroup as Record<string, unknown>).vendor_id);

      const { data: poRows, error: poError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("purchase_order")
        .select("id, po_number, po_date, status")
        .eq("order_group_id", orderGroupId)
        .in("status", Array.from(PRINTABLE_STATUSES))
        .order("po_number", { ascending: true });

      if (poError) throw new Error("PRINT_GROUP_PO_LIST_FAILED");

      const poIds = ((poRows ?? []) as Array<{ id: string }>).map((row) => String(row.id));
      const { data: amendmentRows } = poIds.length > 0
        ? await serviceRoleClient
          .schema("erp_procurement")
          .from("po_amendment_log")
          .select("po_id")
          .in("po_id", poIds)
        : { data: [] as Array<{ po_id: string }> };
      const revisedPoIds = new Set(((amendmentRows ?? []) as Array<{ po_id: string }>).map((row) => String(row.po_id)));

      const [vendorBlock, companyNames] = await Promise.all([
        resolveVendorContactBlock(vendorId),
        resolveCompanyNames([companyId]),
      ]);

      return okResponse(
        {
          kind: "PO_GROUP",
          group_number: groupNumber,
          from_company: companyNames.get(companyId) ?? companyId,
          to: vendorBlock,
          date: (poGroup as Record<string, unknown>).created_at,
          count: poIds.length,
          documents: ((poRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: row.id,
            document_number: row.po_number,
            document_date: row.po_date,
            status: row.status,
            revised: revisedPoIds.has(String(row.id)),
          })),
        },
        ctx.request_id,
        req,
      );
    }

    const { data: sto } = await serviceRoleClient
      .schema("erp_procurement")
      .from("stock_transfer_order")
      .select("id, sto_number, sto_date, status, sending_company_id, receiving_company_id")
      .eq("group_number", groupNumber)
      .maybeSingle();

    if (!sto) {
      return printGroupErrorResponse(req, ctx, "PRINT_GROUP_NOT_FOUND", 404, "No PO group or STO found for this Group Number");
    }

    const sendingCompanyId = toTrimmedString((sto as Record<string, unknown>).sending_company_id);
    const receivingCompanyId = toTrimmedString((sto as Record<string, unknown>).receiving_company_id);
    try {
      await assertCompanyScope(ctx, sendingCompanyId);
    } catch {
      try {
        await assertCompanyScope(ctx, receivingCompanyId);
      } catch {
        return printGroupErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
      }
    }

    const stoId = toTrimmedString((sto as Record<string, unknown>).id);
    const status = toTrimmedString((sto as Record<string, unknown>).status).toUpperCase();
    const { data: amendmentRows } = await serviceRoleClient
      .schema("erp_procurement")
      .from("sto_amendment_log")
      .select("sto_id")
      .eq("sto_id", stoId)
      .limit(1);
    const revised = ((amendmentRows ?? []) as unknown[]).length > 0;

    const companyNames = await resolveCompanyNames([sendingCompanyId, receivingCompanyId]);

    return okResponse(
      {
        kind: "STO",
        group_number: groupNumber,
        from_company: companyNames.get(sendingCompanyId) ?? sendingCompanyId,
        to: { company_name: companyNames.get(receivingCompanyId) ?? receivingCompanyId },
        date: (sto as Record<string, unknown>).sto_date,
        count: PRINTABLE_STATUSES.has(status) ? 1 : 0,
        documents: PRINTABLE_STATUSES.has(status)
          ? [
            {
              id: stoId,
              document_number: (sto as Record<string, unknown>).sto_number,
              document_date: (sto as Record<string, unknown>).sto_date,
              status,
              revised,
            },
          ]
          : [],
      },
      ctx.request_id,
      req,
    );
  } catch (err) {
    const code = (err as Error).message || "PRINT_GROUP_LOOKUP_FAILED";
    return printGroupErrorResponse(req, ctx, code, 500, "Print group lookup failed");
  }
}

export async function createPrintLogHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const groupNumber = toTrimmedString(body.group_number);
    const documentKind = toTrimmedString(body.document_kind).toUpperCase();
    const documentIds = Array.isArray(body.document_ids)
      ? (body.document_ids as unknown[]).map((id) => toTrimmedString(id)).filter(Boolean)
      : [];

    if (!groupNumber || !["PO_GROUP", "STO"].includes(documentKind) || documentIds.length === 0) {
      return printGroupErrorResponse(req, ctx, "PRINT_LOG_INVALID", 400, "group_number, document_kind, and at least one document_id are required");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("print_log")
      .insert({
        group_number: groupNumber,
        document_kind: documentKind,
        document_ids: documentIds,
        printed_by: ctx.auth_user_id,
      });

    if (error) throw new Error("PRINT_LOG_CREATE_FAILED");

    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PRINT_LOG_CREATE_FAILED";
    return printGroupErrorResponse(req, ctx, code, 500, "Print log create failed");
  }
}
