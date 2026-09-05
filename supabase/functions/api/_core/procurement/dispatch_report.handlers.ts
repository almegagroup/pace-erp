/*
 * File-Path: supabase/functions/api/_core/procurement/dispatch_report.handlers.ts
 * Purpose: SO04 item-wise dispatch report. One row per posted invoice + item;
 *          invoice references repeat when an invoice contains multiple items.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchAllRows } from "../../_shared/fetchAllRows.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type DispatchReportHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type StrokeEntry = { value: string; invalid: boolean };

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function upperValue(value: unknown): string {
  return textValue(value).toUpperCase();
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number, decimals = 4): number {
  return Number(value.toFixed(decimals));
}

function uniqueValues(values: unknown[]): string[] {
  return [...new Set(values.map(textValue).filter(Boolean))];
}

function joined(values: unknown[]): string {
  return uniqueValues(values).join("\n");
}

function parseList(url: URL, name: string): string[] {
  return uniqueValues(url.searchParams.getAll(name).flatMap((value) => value.split(",")));
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthYear(value: unknown): string {
  const normalized = textValue(value);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(normalized);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function reportError(
  req: Request,
  ctx: DispatchReportHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

async function buildStrokeValidation(
  companyId: string,
  materials: JsonRecord[],
): Promise<{
  prodshadeBySkuMaterialId: Map<string, string>;
  validStrokeKeys: Set<string>;
}> {
  const fgMaterials = materials.filter((row) => upperValue(row.material_type) === "FG");
  if (fgMaterials.length === 0) {
    return { prodshadeBySkuMaterialId: new Map(), validStrokeKeys: new Set() };
  }

  const [configs, packCodes, strokes] = await Promise.all([
    // §83.15 lock: prodshade_pack_config is intentionally GLOBAL (no
    // company_id column at all) -- only Pack BOM itself is company-wise.
    // Filtering this by companyId always 42703'd; a company_id column was
    // never added here on purpose.
    fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .select("material_id, pack_code_id, variant")
      .eq("active", true)
      .order("id", { ascending: true }).range(from, to)),
    fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_production").from("pack_code_master")
      .select("id, pack_code").eq("active", true)
      .order("id", { ascending: true }).range(from, to)),
    fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, prodshade_material_id, stroke_number")
      .eq("company_id", companyId).eq("status", "APPROVED")
      .order("id", { ascending: true }).range(from, to)),
  ]);

  const prodshadeIds = uniqueValues(configs.map((row) => row.material_id));
  const prodshades = await fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient
    .schema("erp_master").from("material_master").select("id, external_code").in("id", chunk));
  const packById = new Map(packCodes.map((row) => [textValue(row.id), textValue(row.pack_code)]));
  const prodshadeById = new Map(prodshades.map((row) => [textValue(row.id), textValue(row.external_code)]));
  const prodshadeIdBySkuKey = new Map<string, string>();
  for (const config of configs) {
    const key = upperValue(`${prodshadeById.get(textValue(config.material_id)) ?? ""}${packById.get(textValue(config.pack_code_id)) ?? ""}${textValue(config.variant)}`);
    if (key) prodshadeIdBySkuKey.set(key, textValue(config.material_id));
  }

  const prodshadeBySkuMaterialId = new Map<string, string>();
  for (const material of fgMaterials) {
    const skuKey = upperValue(material.external_code || material.material_name);
    const prodshadeId = prodshadeIdBySkuKey.get(skuKey);
    if (prodshadeId) prodshadeBySkuMaterialId.set(textValue(material.id), prodshadeId);
  }

  const strokeIds = uniqueValues(strokes.map((row) => row.id));
  const applicability = await fetchInChunks<JsonRecord>(strokeIds, (chunk) => serviceRoleClient
    .schema("erp_production").from("stroke_po_type_applicability")
    .select("stroke_master_id, target_po_type")
    .eq("is_active", true).in("target_po_type", ["MTO", "HPS"]).in("stroke_master_id", chunk));
  const strokeById = new Map(strokes.map((row) => [textValue(row.id), row]));
  const validStrokeKeys = new Set<string>();
  for (const row of applicability) {
    const stroke = strokeById.get(textValue(row.stroke_master_id));
    if (!stroke) continue;
    validStrokeKeys.add(`${textValue(stroke.prodshade_material_id)}|${upperValue(row.target_po_type)}|${upperValue(stroke.stroke_number)}`);
  }
  return { prodshadeBySkuMaterialId, validStrokeKeys };
}

export async function getDispatchReportHandler(
  req: Request,
  ctx: DispatchReportHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = textValue(url.searchParams.get("company_id"));
    const dateFrom = textValue(url.searchParams.get("date_from"));
    const dateTo = textValue(url.searchParams.get("date_to"));
    const fromDate = parseIsoDate(dateFrom);
    const toDate = parseIsoDate(dateTo);
    if (!companyId) return reportError(req, ctx, "DISPATCH_REPORT_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!fromDate || !toDate || toDate < fromDate) {
      return reportError(req, ctx, "DISPATCH_REPORT_DATE_INVALID", 400, "A valid Tally Invoice Date range is required.");
    }
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 > 366) {
      return reportError(req, ctx, "DISPATCH_REPORT_DATE_TOO_WIDE", 400, "Date range cannot exceed 366 days.");
    }
    await assertCompanyScope(ctx, companyId);

    const invoices = await fetchAllRows<JsonRecord>((from, to) => serviceRoleClient
      .schema("erp_procurement").from("sales_invoice")
      .select("id, invoice_number, invoice_date, company_id, dc_id, so_id, sto_id, status, tally_invoice_number, tally_invoice_date, inbound_number, fo_id, fo_number, bill_to_name, ship_to_name")
      .eq("company_id", companyId).eq("status", "POSTED")
      .gte("tally_invoice_date", dateFrom).lte("tally_invoice_date", dateTo)
      .order("tally_invoice_date", { ascending: true }).order("id", { ascending: true }).range(from, to));
    if (invoices.length === 0) return okResponse({ data: [] }, ctx.request_id, req);

    const invoiceIds = invoices.map((row) => textValue(row.id));
    const invoiceLines = await fetchInChunks<JsonRecord>(invoiceIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_invoice_line")
      .select("id, invoice_id, line_number, so_line_id, dc_line_id, material_id, quantity, uom_code, taxable_value, cgst_amount, sgst_amount, igst_amount, line_total, pack_qty, pack_uom_code")
      .in("invoice_id", chunk), 50);

    const dcLineIds = uniqueValues(invoiceLines.map((row) => row.dc_line_id));
    const dcLines = await fetchInChunks<JsonRecord>(dcLineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("delivery_challan_line")
      .select("id, so_line_id, sto_line_id, material_id, so_map_allocation_id, batch_number, packing_order_id, pack_qty, pack_uom_code")
      .in("id", chunk));
    const dcLineById = new Map(dcLines.map((row) => [textValue(row.id), row]));

    const soLineIds = uniqueValues(invoiceLines.flatMap((line) => [line.so_line_id, dcLineById.get(textValue(line.dc_line_id))?.so_line_id]));
    const soLines = await fetchInChunks<JsonRecord>(soLineIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_order_line")
      .select("id, so_id, line_material_type, fg_type, declared_stroke_number")
      .in("id", chunk));
    const soLineById = new Map(soLines.map((row) => [textValue(row.id), row]));
    const soIds = uniqueValues([...invoices.map((row) => row.so_id), ...soLines.map((row) => row.so_id)]);
    const salesOrders = await fetchInChunks<JsonRecord>(soIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_order")
      .select("id, customer_po_number, dispatch_type, dispatch_category, bill_to_parent_company_id")
      .in("id", chunk));
    const soById = new Map(salesOrders.map((row) => [textValue(row.id), row]));

    const materialIds = uniqueValues(invoiceLines.map((row) => row.material_id));
    const materials = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient
      .schema("erp_master").from("material_master")
      .select("id, pace_code, external_code, material_name, document_name, material_type, material_category, base_uom_code")
      .in("id", chunk));
    const materialById = new Map(materials.map((row) => [textValue(row.id), row]));

    const packingOrderIds = uniqueValues(dcLines.map((row) => row.packing_order_id));
    const packingOrders = await fetchInChunks<JsonRecord>(packingOrderIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("packing_order")
      .select("id, po_number, process_order_id")
      .in("id", chunk));
    const packingById = new Map(packingOrders.map((row) => [textValue(row.id), row]));
    const processOrderIds = uniqueValues(packingOrders.map((row) => row.process_order_id));
    const processOrders = await fetchInChunks<JsonRecord>(processOrderIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, stroke_master_id")
      .in("id", chunk));
    const processById = new Map(processOrders.map((row) => [textValue(row.id), row]));
    const strokeMasterIds = uniqueValues(processOrders.map((row) => row.stroke_master_id));
    const actualStrokes = await fetchInChunks<JsonRecord>(strokeMasterIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, stroke_number").in("id", chunk));
    const strokeById = new Map(actualStrokes.map((row) => [textValue(row.id), textValue(row.stroke_number)]));

    const allocationIds = uniqueValues(dcLines.map((row) => row.so_map_allocation_id));
    const allocations = await fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .select("id, fo_id, customer_address_id").in("id", chunk));
    const allocationById = new Map(allocations.map((row) => [textValue(row.id), row]));
    const foIds = uniqueValues([...invoices.map((row) => row.fo_id), ...allocations.map((row) => row.fo_id)]);
    const feeds = await fetchInChunks<JsonRecord>(foIds, (chunk) => serviceRoleClient
      .schema("erp_production").from("plan_feed")
      .select("id, fo_number, customer_address_id").in("id", chunk));
    const feedById = new Map(feeds.map((row) => [textValue(row.id), row]));
    const addressIds = uniqueValues([
      ...allocations.map((row) => row.customer_address_id),
      ...feeds.map((row) => row.customer_address_id),
    ]);
    const addresses = await fetchInChunks<JsonRecord>(addressIds, (chunk) => serviceRoleClient
      .schema("erp_master").from("customer_address")
      .select("id, site_name, town").in("id", chunk));
    const addressById = new Map(addresses.map((row) => [textValue(row.id), row]));

    const parentIds = uniqueValues(salesOrders.map((row) => row.bill_to_parent_company_id));
    const parents = await fetchInChunks<JsonRecord>(parentIds, (chunk) => serviceRoleClient
      .schema("erp_master").from("fg_parent_company")
      .select("id, company_name").in("id", chunk));
    const parentById = new Map(parents.map((row) => [textValue(row.id), textValue(row.company_name)]));
    const { prodshadeBySkuMaterialId, validStrokeKeys } = await buildStrokeValidation(companyId, materials);

    const invoiceById = new Map(invoices.map((row) => [textValue(row.id), row]));
    const groups = new Map<string, JsonRecord[]>();
    for (const line of invoiceLines) {
      const key = `${textValue(line.invoice_id)}|${textValue(line.material_id)}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }

    const rows = [...groups.entries()].map(([rowKey, lines]) => {
      const invoice = invoiceById.get(textValue(lines[0]?.invoice_id)) ?? {};
      const materialId = textValue(lines[0]?.material_id);
      const material = materialById.get(materialId) ?? {};
      const lineDetails = lines.map((line) => {
        const dcLine = dcLineById.get(textValue(line.dc_line_id)) ?? {};
        const soLine = soLineById.get(textValue(line.so_line_id || dcLine.so_line_id)) ?? {};
        const so = soById.get(textValue(soLine.so_id || invoice.so_id)) ?? {};
        const packing = packingById.get(textValue(dcLine.packing_order_id)) ?? {};
        const process = processById.get(textValue(packing.process_order_id)) ?? {};
        const allocation = allocationById.get(textValue(dcLine.so_map_allocation_id)) ?? {};
        const feed = feedById.get(textValue(allocation.fo_id || invoice.fo_id)) ?? {};
        const address = addressById.get(textValue(allocation.customer_address_id || feed.customer_address_id)) ?? {};
        const declaredStroke = textValue(soLine.declared_stroke_number);
        const fgType = upperValue(soLine.fg_type);
        const prodshadeId = prodshadeBySkuMaterialId.get(materialId) ?? "";
        const invalidStroke = Boolean(
          prodshadeId && declaredStroke && ["MTO", "HPS"].includes(fgType)
          && !validStrokeKeys.has(`${prodshadeId}|${fgType}|${upperValue(declaredStroke)}`),
        );
        return { line, dcLine, soLine, so, packing, process, allocation, feed, address, declaredStroke, invalidStroke };
      });

      const strokeEntryMap = new Map<string, StrokeEntry>();
      for (const detail of lineDetails) {
        if (!detail.declaredStroke) continue;
        const key = upperValue(detail.declaredStroke);
        const existing = strokeEntryMap.get(key);
        strokeEntryMap.set(key, { value: detail.declaredStroke, invalid: Boolean(existing?.invalid || detail.invalidStroke) });
      }
      const soStrokeEntries = [...strokeEntryMap.values()];
      const tallyDate = textValue(invoice.tally_invoice_date);
      return {
        row_key: rowKey,
        month_year: monthYear(tallyDate),
        type: joined(lineDetails.map((entry) => entry.soLine.line_material_type || material.material_type)),
        fg_type: joined(lineDetails.map((entry) => entry.soLine.fg_type)),
        dispatch_type: joined(lineDetails.map((entry) => entry.so.dispatch_type || (invoice.sto_id ? "STO" : ""))),
        dispatch_category: joined(lineDetails.map((entry) => entry.so.dispatch_category)),
        external_so_number: joined(lineDetails.map((entry) => entry.so.customer_po_number)),
        tally_invoice_number: textValue(invoice.tally_invoice_number),
        tally_invoice_date: tallyDate,
        inbound_number: textValue(invoice.inbound_number),
        pack_qty: rounded(lines.reduce((sum, line) => sum + numberValue(line.pack_qty ?? dcLineById.get(textValue(line.dc_line_id))?.pack_qty), 0), 6),
        pack_uom: joined(lines.map((line) => line.pack_uom_code || dcLineById.get(textValue(line.dc_line_id))?.pack_uom_code)),
        base_qty: rounded(lines.reduce((sum, line) => sum + numberValue(line.quantity), 0), 6),
        base_uom: joined(lines.map((line) => line.uom_code || material.base_uom_code)),
        fo_number: joined([invoice.fo_number, ...lineDetails.map((entry) => entry.feed.fo_number)]),
        batch_number: joined(lineDetails.map((entry) => entry.dcLine.batch_number)),
        packing_po_number: joined(lineDetails.map((entry) => entry.packing.po_number)),
        item: [textValue(material.pace_code), textValue(material.material_name)].filter(Boolean).join(" — "),
        document_name: textValue(material.document_name),
        external_code: textValue(material.external_code),
        so_stroke: soStrokeEntries.map((entry) => entry.value).join("\n"),
        so_stroke_entries: soStrokeEntries,
        actual_stroke: joined(lineDetails.map((entry) => strokeById.get(textValue(entry.process.stroke_master_id)))),
        item_category: textValue(material.material_category),
        taxable: rounded(lines.reduce((sum, line) => sum + numberValue(line.taxable_value), 0)),
        cgst: rounded(lines.reduce((sum, line) => sum + numberValue(line.cgst_amount), 0)),
        sgst: rounded(lines.reduce((sum, line) => sum + numberValue(line.sgst_amount), 0)),
        igst: rounded(lines.reduce((sum, line) => sum + numberValue(line.igst_amount), 0)),
        dispatch_value: rounded(lines.reduce((sum, line) => sum + numberValue(line.line_total), 0)),
        parent_company_name: joined(lineDetails.map((entry) => parentById.get(textValue(entry.so.bill_to_parent_company_id)))),
        bill_to_party_name: textValue(invoice.bill_to_name),
        ship_to_party_name: textValue(invoice.ship_to_name),
        ship_to_site_town: joined(lineDetails.map((entry) => [textValue(entry.address.site_name), textValue(entry.address.town)].filter(Boolean).join(" — "))),
      };
    });

    const typeFilter = new Set(parseList(url, "types").map(upperValue));
    const fgTypeFilter = new Set(parseList(url, "fg_types").map(upperValue));
    const dispatchTypeFilter = new Set(parseList(url, "dispatch_types").map(upperValue));
    const categoryFilter = new Set(parseList(url, "dispatch_categories").map(upperValue));
    const materialFilter = new Set(parseList(url, "material_ids"));
    const filtered = rows.filter((row) => {
      const materialId = row.row_key.split("|")[1] ?? "";
      return (typeFilter.size === 0 || uniqueValues([row.type]).flatMap((v) => v.split("\n")).some((v) => typeFilter.has(upperValue(v))))
        && (fgTypeFilter.size === 0 || uniqueValues([row.fg_type]).flatMap((v) => v.split("\n")).some((v) => fgTypeFilter.has(upperValue(v))))
        && (dispatchTypeFilter.size === 0 || uniqueValues([row.dispatch_type]).flatMap((v) => v.split("\n")).some((v) => dispatchTypeFilter.has(upperValue(v))))
        && (categoryFilter.size === 0 || uniqueValues([row.dispatch_category]).flatMap((v) => v.split("\n")).some((v) => categoryFilter.has(upperValue(v))))
        && (materialFilter.size === 0 || materialFilter.has(materialId));
    });
    filtered.sort((left, right) => textValue(left.tally_invoice_date).localeCompare(textValue(right.tally_invoice_date))
      || textValue(left.tally_invoice_number).localeCompare(textValue(right.tally_invoice_number), undefined, { numeric: true })
      || textValue(left.item).localeCompare(textValue(right.item)));
    return okResponse({ data: filtered }, ctx.request_id, req);
  } catch (err) {
    console.error("DISPATCH_REPORT_FAILED", err);
    const code = err instanceof Error ? err.message : "DISPATCH_REPORT_FAILED";
    return reportError(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, "Unable to load dispatch report.");
  }
}
