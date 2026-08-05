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

async function loadAllowedCompanyIds(ctx: ProcurementHandlerContext): Promise<string[] | null> {
  if (ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return null;
  }
  const { data: userCompanies, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) {
    throw new Error("COMPANY_SCOPE_LOOKUP_FAILED");
  }
  return [...new Set(((userCompanies ?? []) as Array<Record<string, unknown>>).map((row) => toTrimmedString(row.company_id)).filter(Boolean))];
}

async function resolveCompanyScopeList(
  ctx: ProcurementHandlerContext,
  requestedCompanyIds: string[],
): Promise<string[] | null> {
  const normalizedRequested = [...new Set(requestedCompanyIds.map((value) => toTrimmedString(value)).filter(Boolean))];
  const allowedCompanyIds = await loadAllowedCompanyIds(ctx);
  if (normalizedRequested.length === 0) {
    return allowedCompanyIds;
  }
  if (!allowedCompanyIds) {
    return normalizedRequested;
  }
  const denied = normalizedRequested.find((companyId) => !allowedCompanyIds.includes(companyId));
  if (denied) {
    throw new Error("COMPANY_SCOPE_VIOLATION");
  }
  return normalizedRequested;
}

// Full Vendor letterhead block (§118.2) — Name, GSTIN, Registered Address,
// primary Contact (Name+Phone only, no Designation), primary Email.
async function resolveVendorLetterheadBlock(vendorId: string): Promise<{
  vendor_code: string | null;
  vendor_name: string | null;
  gst_number: string | null;
  registered_address: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_email: string | null;
}> {
  const [{ data: vendorRow }, { data: contactRows }, { data: emailRows }] = await Promise.all([
    serviceRoleClient
      .schema("erp_master")
      .from("vendor_master")
      .select("vendor_code, vendor_name, gst_number, reg_address_line1, reg_address_city, reg_address_state, reg_address_pin")
      .eq("id", vendorId)
      .maybeSingle(),
    serviceRoleClient.schema("erp_master").from("vendor_contacts").select("contact_name, phone, is_primary").eq("vendor_id", vendorId),
    serviceRoleClient.schema("erp_master").from("vendor_emails").select("email, is_primary").eq("vendor_id", vendorId),
  ]);

  const vendor = (vendorRow ?? {}) as Record<string, unknown>;
  const contacts = (contactRows ?? []) as Array<{ contact_name: string | null; phone: string | null; is_primary: boolean }>;
  const emails = (emailRows ?? []) as Array<{ email: string | null; is_primary: boolean }>;
  const primaryContact = contacts.find((row) => row.is_primary) ?? contacts[0] ?? null;
  const primaryEmail = emails.find((row) => row.is_primary) ?? emails[0] ?? null;
  const addressParts = [
    toTrimmedString(vendor.reg_address_line1),
    toTrimmedString(vendor.reg_address_city),
    toTrimmedString(vendor.reg_address_state),
    toTrimmedString(vendor.reg_address_pin),
  ].filter(Boolean);

  return {
    vendor_code: toTrimmedString(vendor.vendor_code) || null,
    vendor_name: toTrimmedString(vendor.vendor_name) || null,
    gst_number: toTrimmedString(vendor.gst_number) || null,
    registered_address: addressParts.length > 0 ? addressParts.join(", ") : null,
    primary_contact_name: primaryContact ? toTrimmedString(primaryContact.contact_name) || null : null,
    primary_contact_phone: primaryContact ? toTrimmedString(primaryContact.phone) || null : null,
    primary_email: primaryEmail ? toTrimmedString(primaryEmail.email) || null : null,
  };
}

type CompanyLetterheadBlock = {
  company_code: string | null;
  company_name: string | null;
  gst_number: string | null;
  cin_number: string | null;
  mobile_number_1: string | null;
  mobile_number_2: string | null;
  email_1: string | null;
  email_2: string | null;
  full_address: string | null;
};

// Full Company letterhead block (§118.2/118.3) — used for both the masthead
// (issuer) and the counterpart-company block on an STO. CIN is deliberately
// left present-or-absent as stored (§118.2 conditional-field rule is a
// frontend rendering decision — omit the whole line when null).
async function resolveCompanyLetterheadBlocks(companyIds: string[]): Promise<Map<string, CompanyLetterheadBlock>> {
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const { data } = await serviceRoleClient
    .schema("erp_master")
    .from("companies")
    .select("id, company_code, company_name, gst_number, cin_number, mobile_number_1, mobile_number_2, email_1, email_2, full_address")
    .in("id", uniqueIds);
  return new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      {
        company_code: toTrimmedString(row.company_code) || null,
        company_name: toTrimmedString(row.company_name) || String(row.id),
        gst_number: toTrimmedString(row.gst_number) || null,
        cin_number: toTrimmedString(row.cin_number) || null,
        mobile_number_1: toTrimmedString(row.mobile_number_1) || null,
        mobile_number_2: toTrimmedString(row.mobile_number_2) || null,
        email_1: toTrimmedString(row.email_1) || null,
        email_2: toTrimmedString(row.email_2) || null,
        full_address: toTrimmedString(row.full_address) || null,
      },
    ]),
  );
}

export async function lookupPrintGroupHandler(req: Request, ctx: ProcurementHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const groupNumber = toTrimmedString(url.searchParams.get("group_number"));
    if (!groupNumber) {
      const requestedCompanyId = toTrimmedString(url.searchParams.get("company_id"));
      const companyScopeIds = await resolveCompanyScopeList(ctx, requestedCompanyId ? [requestedCompanyId] : []);

      let poGroupQuery = serviceRoleClient
        .schema("erp_procurement")
        .from("po_order_group")
        .select("id, group_number, company_id, vendor_id, created_at")
        .not("group_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (companyScopeIds) {
        poGroupQuery = poGroupQuery.in("company_id", companyScopeIds);
      }

      let stoQuery = serviceRoleClient
        .schema("erp_procurement")
        .from("stock_transfer_order")
        .select("id, group_number, sending_company_id, receiving_company_id, sto_date, created_at, status")
        .not("group_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (companyScopeIds) {
        stoQuery = (stoQuery as unknown as { or: (filter: string) => typeof stoQuery })
          .or(`sending_company_id.in.(${companyScopeIds.join(",")}),receiving_company_id.in.(${companyScopeIds.join(",")})`);
      }

      const [poGroupResp, stoResp] = await Promise.all([poGroupQuery, stoQuery]);
      if (poGroupResp.error) throw new Error("PRINT_GROUP_LIST_FAILED");
      if (stoResp.error) throw new Error("PRINT_GROUP_LIST_FAILED");

      const poGroups = (poGroupResp.data ?? []) as Array<Record<string, unknown>>;
      const stos = (stoResp.data ?? []) as Array<Record<string, unknown>>;

      const poGroupIds = poGroups.map((row) => toTrimmedString(row.id)).filter(Boolean);
      const poCompanyIds = poGroups.map((row) => toTrimmedString(row.company_id)).filter(Boolean);
      const poVendorIds = poGroups.map((row) => toTrimmedString(row.vendor_id)).filter(Boolean);
      const stoSendingIds = stos.map((row) => toTrimmedString(row.sending_company_id)).filter(Boolean);
      const stoReceivingIds = stos.map((row) => toTrimmedString(row.receiving_company_id)).filter(Boolean);

      const [poRowsResp, vendorResp, companyBlocks] = await Promise.all([
        poGroupIds.length > 0
          ? serviceRoleClient
            .schema("erp_procurement")
            .from("purchase_order")
            .select("id, order_group_id, status")
            .in("order_group_id", poGroupIds)
            .in("status", Array.from(PRINTABLE_STATUSES))
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        poVendorIds.length > 0
          ? serviceRoleClient
            .schema("erp_master")
            .from("vendor_master")
            .select("id, vendor_name")
            .in("id", [...new Set(poVendorIds)])
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        resolveCompanyLetterheadBlocks([...poCompanyIds, ...stoSendingIds, ...stoReceivingIds]),
      ]);

      if (poRowsResp.error || vendorResp.error) {
        throw new Error("PRINT_GROUP_LIST_FAILED");
      }

      const vendorNameById = new Map(
        ((vendorResp.data ?? []) as Array<Record<string, unknown>>).map((row) => [toTrimmedString(row.id), toTrimmedString(row.vendor_name) || "--"]),
      );
      const printablePoRows = (poRowsResp.data ?? []) as Array<Record<string, unknown>>;
      const printablePoCountByGroupId = new Map<string, number>();
      for (const row of printablePoRows) {
        const orderGroupId = toTrimmedString(row.order_group_id);
        printablePoCountByGroupId.set(orderGroupId, (printablePoCountByGroupId.get(orderGroupId) ?? 0) + 1);
      }

      const printablePoIds = printablePoRows.map((row) => toTrimmedString(row.id)).filter(Boolean);
      const stoIds = stos.map((row) => toTrimmedString(row.id)).filter(Boolean);
      const [poAmendmentResp, stoAmendmentResp] = await Promise.all([
        printablePoIds.length > 0
          ? serviceRoleClient
            .schema("erp_procurement")
            .from("po_amendment_log")
            .select("po_id")
            .in("po_id", printablePoIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        stoIds.length > 0
          ? serviceRoleClient
            .schema("erp_procurement")
            .from("sto_amendment_log")
            .select("sto_id")
            .in("sto_id", stoIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      ]);
      if (poAmendmentResp.error || stoAmendmentResp.error) {
        throw new Error("PRINT_GROUP_LIST_FAILED");
      }

      const poGroupIdByPoId = new Map<string, string>();
      for (const row of printablePoRows) {
        poGroupIdByPoId.set(toTrimmedString(row.id), toTrimmedString(row.order_group_id));
      }
      const revisedPoGroupIds = new Set<string>();
      for (const row of ((poAmendmentResp.data ?? []) as Array<Record<string, unknown>>)) {
        const orderGroupId = poGroupIdByPoId.get(toTrimmedString(row.po_id)) ?? "";
        if (orderGroupId) revisedPoGroupIds.add(orderGroupId);
      }
      const revisedStoIds = new Set(
        ((stoAmendmentResp.data ?? []) as Array<Record<string, unknown>>).map((row) => toTrimmedString(row.sto_id)).filter(Boolean),
      );

      const rows = [
        ...poGroups
          .map((row) => {
            const companyId = toTrimmedString(row.company_id);
            const company = companyBlocks.get(companyId);
            const groupId = toTrimmedString(row.id);
            return {
              group_number: toTrimmedString(row.group_number),
              kind: "PO_GROUP",
              company_id: companyId,
              company_name: company?.company_name ?? "--",
              from_name: company?.company_name ?? "--",
              to_name: vendorNameById.get(toTrimmedString(row.vendor_id)) ?? "--",
              date: row.created_at,
              count: printablePoCountByGroupId.get(groupId) ?? 0,
              revised: revisedPoGroupIds.has(groupId),
            };
          })
          .filter((row) => row.group_number),
        ...stos.map((row) => {
          const sendingCompanyId = toTrimmedString(row.sending_company_id);
          const receivingCompanyId = toTrimmedString(row.receiving_company_id);
          const status = toTrimmedString(row.status).toUpperCase();
          const sendingCompany = companyBlocks.get(sendingCompanyId);
          const receivingCompany = companyBlocks.get(receivingCompanyId);
          return {
            group_number: toTrimmedString(row.group_number),
            kind: "STO",
            company_id: requestedCompanyId || sendingCompanyId,
            company_name: sendingCompany?.company_name ?? "--",
            from_name: sendingCompany?.company_name ?? "--",
            to_name: receivingCompany?.company_name ?? "--",
            date: row.sto_date || row.created_at,
            count: PRINTABLE_STATUSES.has(status) ? 1 : 0,
            revised: revisedStoIds.has(toTrimmedString(row.id)),
          };
        }).filter((row) => row.group_number),
      ]
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
        .slice(0, 200);

      return okResponse({ data: rows, total: rows.length }, ctx.request_id, req);
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

      const [vendorBlock, companyBlocks] = await Promise.all([
        resolveVendorLetterheadBlock(vendorId),
        resolveCompanyLetterheadBlocks([companyId]),
      ]);

      return okResponse(
        {
          kind: "PO_GROUP",
          group_number: groupNumber,
          from: companyBlocks.get(companyId) ?? { company_code: null, company_name: companyId },
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

    const companyBlocks = await resolveCompanyLetterheadBlocks([sendingCompanyId, receivingCompanyId]);

    return okResponse(
      {
        kind: "STO",
        group_number: groupNumber,
        from: companyBlocks.get(sendingCompanyId) ?? { company_code: null, company_name: sendingCompanyId },
        to: companyBlocks.get(receivingCompanyId) ?? { company_code: null, company_name: receivingCompanyId },
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

    if (error) {
      console.error("[PRINT_LOG_CREATE_FAILED]", error.message, {
        groupNumber,
        documentKind,
        documentIds,
        authUserId: ctx.auth_user_id,
      });
      throw new Error("PRINT_LOG_CREATE_FAILED");
    }

    return okResponse({ ok: true }, ctx.request_id, req);
  } catch (err) {
    const code = (err as Error).message || "PRINT_LOG_CREATE_FAILED";
    return printGroupErrorResponse(req, ctx, code, 500, "Print log create failed");
  }
}
