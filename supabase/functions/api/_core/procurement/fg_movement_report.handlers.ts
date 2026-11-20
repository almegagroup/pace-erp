/*
 * File-Path: supabase/functions/api/_core/procurement/fg_movement_report.handlers.ts
 * Purpose: SO06 "FG Movement Report" -- FG only. Per SKU: Opening, Production, PID, Other, Dispatch, Closing, In QA, Blocked,
 *          dispatch broken up by SO dispatch type, grouped by the PO21 Mother / Child group (Page 2); and where the dispatch went
 *          by State / Town / month (Page 3). Only POSTED stock movements are counted (the stock ledger is the source), a
 *          reversal counts as a negative posting in the period it was made, an invoice that never moved stock does not appear.
 *          Quantities are returned in BASE UoM with each SKU's conversion factors; the screen switches unit without refetching.
 * Authority: Backend
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type Ctx = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const text = (value: unknown): string => String(value ?? "").trim();
const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const NO_GROUP = "— No group —";
const DISPATCH_TYPES = ["DEPENDENT_DIRECT", "DEPENDENT_DEPOT", "INDEPENDENT_PARTY", "INDEPENDENT_PARTY_ASIAN_BILLED", "DEPENDENT_NO_INBOUND", "STO", "OTHER"] as const;
const TYPE_PRIORITY = ["MTS", "MTO", "HPS", "MTEST"];

function fail(req: Request, ctx: Ctx, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function parseList(url: URL, name: string): string[] {
  return [...new Set(url.searchParams.getAll(name).flatMap((value) => value.split(",")).map(text).filter(Boolean))];
}

function isoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthYear(value: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!match) return "";
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

async function resolveParams(req: Request, ctx: Ctx): Promise<
  | { error: Response }
  | { companyIds: string[]; from: string; to: string; mothers: Set<string>; children: Set<string>; types: Set<string> }
> {
  const url = new URL(req.url);
  const companyIds = parseList(url, "company_ids");
  const from = text(url.searchParams.get("date_from"));
  const to = text(url.searchParams.get("date_to"));
  const fromDate = isoDate(from);
  const toDate = isoDate(to);
  if (companyIds.length === 0) return { error: fail(req, ctx, "FG_MOVEMENT_COMPANY_REQUIRED", 400, "Choose at least one company.") };
  if (!fromDate || !toDate || toDate < fromDate) return { error: fail(req, ctx, "FG_MOVEMENT_DATE_INVALID", 400, "A valid date range is required.") };
  if ((toDate.getTime() - fromDate.getTime()) / 86400000 > 731) {
    return { error: fail(req, ctx, "FG_MOVEMENT_DATE_TOO_WIDE", 400, "Date range cannot exceed 2 years.") };
  }
  // Every requested company must be one of the caller's own (company-scope law); an unknown company is a 403, never silently dropped.
  for (const companyId of companyIds) {
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return { error: fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to one of the selected companies.") };
    }
  }
  return {
    companyIds, from, to,
    mothers: new Set(parseList(url, "mother_groups")),
    children: new Set(parseList(url, "child_groups")),
    types: new Set(parseList(url, "types").map((value) => value.toUpperCase())),
  };
}

// PO21 Mother / Child group of every Prodshade, per company. A SKU belongs to the group of its own Prodshade: the SKU's external code
// is the Prodshade's external code plus the 3-digit pack code (00790908 + 320). NOT the 4-digit shade code -- that one (e.g. 0908) is
// shared by many different Prodshades (7 in CMP003), so matching on it put every white SKU in whichever group came last.
async function loadGroupMap(companyIds: string[]): Promise<Map<string, { mother: string; child: string }>> {
  const members = await fetchInChunks<JsonRecord>(companyIds, (chunk) => serviceRoleClient.schema("erp_planning")
    .from("prodshade_group_member").select("company_id, prodshade_material_id, child_group_id").eq("is_active", true).in("company_id", chunk));
  if (members.length === 0) return new Map();
  const childIds = [...new Set(members.map((row) => text(row.child_group_id)))];
  const children = await fetchInChunks<JsonRecord>(childIds, (chunk) => serviceRoleClient.schema("erp_planning")
    .from("prodshade_child_group").select("id, mother_group_id, group_name").in("id", chunk));
  const motherIds = [...new Set(children.map((row) => text(row.mother_group_id)))];
  const mothers = await fetchInChunks<JsonRecord>(motherIds, (chunk) => serviceRoleClient.schema("erp_planning")
    .from("prodshade_mother_group").select("id, group_name").in("id", chunk));
  const motherName = new Map(mothers.map((row) => [text(row.id), text(row.group_name)]));
  const childInfo = new Map(children.map((row) => [text(row.id), { child: text(row.group_name), mother: motherName.get(text(row.mother_group_id)) ?? "" }]));
  const prodshadeIds = [...new Set(members.map((row) => text(row.prodshade_material_id)))];
  const prodshades = await fetchInChunks<JsonRecord>(prodshadeIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_master").select("id, external_code").in("id", chunk));
  const shadeByProdshade = new Map(prodshades.map((row) => [text(row.id), text(row.external_code)]));
  const result = new Map<string, { mother: string; child: string }>();
  for (const member of members) {
    const shade = shadeByProdshade.get(text(member.prodshade_material_id));
    const info = childInfo.get(text(member.child_group_id));
    if (!shade || !info) continue;
    const key = `${text(member.company_id)}|${shade}`;
    if (!result.has(key)) result.set(key, info);
  }
  return result;
}

type SkuRow = {
  company_id: string; company_code: string; material_id: string; sku: string; description: string;
  mother_group: string; child_group: string; type: string; base_uom: string;
  outer_uom: string | null; base_per_outer: number | null; inner_per_outer: number | null;
  opening: number; production: number; pid: number; other: number; dispatch: number; closing: number; in_qa: number; blocked: number;
  dispatch_by_type: Record<string, number>;
  other_by: Record<string, number>;
};

type OtherCategory = { key: string; label: string };
type Built = { rows: SkuRow[]; placeRows: JsonRecord[]; otherCategories: OtherCategory[] };

// "Other" is shown as one column per kind of movement. Known kinds get a plain business name; anything else falls back to the
// movement type's own name from the master (then its code), so a new kind of posting never disappears into a lump.
const OTHER_LABELS: Record<string, string> = {
  P561: "Opening Stock", "P101|GRN": "GRN Receipt", "P102|GRN": "GRN Reversal",
  P343: "Blocked → Unrestricted", P344: "Unrestricted → Blocked",
};

async function build(ctx: Ctx, p: { companyIds: string[]; from: string; to: string; mothers: Set<string>; children: Set<string>; types: Set<string> }, withPlaces: boolean): Promise<Built> {
  void ctx;
  const [{ data: summary, error: summaryError }, { data: otherData, error: otherError }] = await Promise.all([
    serviceRoleClient.schema("erp_inventory").rpc("fg_movement_summary", { p_company_ids: p.companyIds, p_from: p.from, p_to: p.to }),
    serviceRoleClient.schema("erp_inventory").rpc("fg_movement_other", { p_company_ids: p.companyIds, p_from: p.from, p_to: p.to }),
  ]);
  if (summaryError) throw new Error("FG_MOVEMENT_SUMMARY_FAILED");
  if (otherError) throw new Error("FG_MOVEMENT_OTHER_FAILED");
  const summaryRows = (summary ?? []) as JsonRecord[];
  if (summaryRows.length === 0) return { rows: [], placeRows: [], otherCategories: [] };

  const otherByKey = new Map<string, Record<string, number>>();
  const otherCats = new Set<string>();
  for (const row of (otherData ?? []) as JsonRecord[]) {
    const key = `${text(row.company_id)}|${text(row.material_id)}`;
    const bucket = otherByKey.get(key) ?? {};
    bucket[text(row.cat)] = num(row.qty);
    otherByKey.set(key, bucket);
    otherCats.add(text(row.cat));
  }
  const movementCodes = [...new Set([...otherCats].map((cat) => cat.split("|")[0]))];
  const { data: movementNames } = movementCodes.length
    ? await serviceRoleClient.schema("erp_inventory").from("movement_type_master").select("code, name").in("code", movementCodes)
    : { data: [] as JsonRecord[] };
  const movementName = new Map(((movementNames ?? []) as JsonRecord[]).map((row) => [text(row.code), text(row.name)]));
  const otherCategories: OtherCategory[] = [...otherCats].map((cat) => ({
    key: cat, label: OTHER_LABELS[cat] ?? (movementName.get(cat.split("|")[0]) || cat.replace("|", " ")),
  })).sort((a, b) => a.label.localeCompare(b.label));

  const materialIds = [...new Set(summaryRows.map((row) => text(row.material_id)))];
  const materials = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_master").select("id, external_code, pace_code, document_name, material_name, shade_code, base_uom_code").in("id", chunk));
  const materialById = new Map(materials.map((row) => [text(row.id), row]));
  const companies = await fetchInChunks<JsonRecord>(p.companyIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("companies").select("id, company_code").in("id", chunk));
  const companyCode = new Map(companies.map((row) => [text(row.id), text(row.company_code)]));

  const [groupMap, conversions, packingOrders, boms] = await Promise.all([
    loadGroupMap(p.companyIds),
    fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_uom_conversion")
      .select("material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion").eq("active", true).in("material_id", chunk)),
    fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_production").from("packing_order")
      .select("company_id, material_id, source_po_type").in("material_id", chunk).in("company_id", p.companyIds)),
    fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_production").from("pack_bom")
      .select("id, company_id, sku_material_id").eq("status", "ACTIVE").in("sku_material_id", chunk).in("company_id", p.companyIds)),
  ]);

  const fixedFactor = new Map<string, { uom: string; factor: number }>();
  for (const row of conversions) {
    const material = materialById.get(text(row.material_id));
    if (row.variable_conversion === true || !(num(row.conversion_factor) > 0)) continue;
    if (text(row.to_uom_code) !== text(material?.base_uom_code)) continue;
    fixedFactor.set(text(row.material_id), { uom: text(row.from_uom_code), factor: num(row.conversion_factor) });
  }
  const typeSets = new Map<string, Set<string>>();
  for (const row of packingOrders) {
    const key = `${text(row.company_id)}|${text(row.material_id)}`;
    const set = typeSets.get(key) ?? new Set<string>();
    if (text(row.source_po_type)) set.add(text(row.source_po_type).toUpperCase());
    typeSets.set(key, set);
  }
  // A SKU with no Packing PO of its own in this company (received by STO / GRN, or only ever loaded through Opening Stock) still has its
  // production type: the one on the Opening Stock document it was loaded under (same rule the Current Stock report uses for MTS FG).
  const openingDocs = await fetchInChunks<JsonRecord>(p.companyIds, (chunk) => serviceRoleClient.schema("erp_procurement")
    .from("opening_stock_document").select("id, company_id, po_type").in("company_id", chunk).not("po_type", "is", null));
  const openingDocById = new Map(openingDocs.map((row) => [text(row.id), row]));
  const openingLines = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_procurement")
    .from("opening_stock_line").select("document_id, material_id").in("material_id", chunk));
  for (const line of openingLines) {
    const doc = openingDocById.get(text(line.document_id));
    if (!doc) continue;
    const key = `${text(doc.company_id)}|${text(line.material_id)}`;
    const set = typeSets.get(key) ?? new Set<string>();
    set.add(text(doc.po_type).toUpperCase());
    typeSets.set(key, set);
  }
  // Still no type in this company (e.g. received by GRN / STO from another company, never produced or opened here): the SKU is the
  // same product everywhere, so take the production type it has in any other company (Packing PO first, then Opening Stock).
  const typedHere = new Set([...typeSets.keys()].map((key) => key.split("|")[1]));
  const untypedIds = materialIds.filter((id) => !typedHere.has(id));
  const anyTypeByMaterial = new Map<string, Set<string>>();
  if (untypedIds.length > 0) {
    const [otherPos, otherLines] = await Promise.all([
      fetchInChunks<JsonRecord>(untypedIds, (chunk) => serviceRoleClient.schema("erp_production").from("packing_order")
        .select("material_id, source_po_type").in("material_id", chunk)),
      fetchInChunks<JsonRecord>(untypedIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("opening_stock_line")
        .select("document_id, material_id").in("material_id", chunk)),
    ]);
    const addAny = (materialId: string, type: string) => {
      if (!type) return;
      const set = anyTypeByMaterial.get(materialId) ?? new Set<string>();
      set.add(type.toUpperCase());
      anyTypeByMaterial.set(materialId, set);
    };
    for (const row of otherPos) addAny(text(row.material_id), text(row.source_po_type));
    const docIds = [...new Set(otherLines.map((row) => text(row.document_id)))];
    const docs = await fetchInChunks<JsonRecord>(docIds, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("opening_stock_document").select("id, po_type").in("id", chunk));
    const poTypeByDoc = new Map(docs.map((row) => [text(row.id), text(row.po_type)]));
    for (const row of otherLines) addAny(text(row.material_id), poTypeByDoc.get(text(row.document_id)) ?? "");
  }
  const bomLines = await fetchInChunks<JsonRecord>(boms.map((row) => text(row.id)), (chunk) => serviceRoleClient.schema("erp_production")
    .from("pack_bom_line").select("pack_bom_id, qty").eq("is_primary_container", true).in("pack_bom_id", chunk));
  const innerByBom = new Map(bomLines.map((row) => [text(row.pack_bom_id), num(row.qty)]));
  const innerBySku = new Map<string, number>();
  for (const bom of boms) {
    const inner = innerByBom.get(text(bom.id));
    if (inner && inner > 0) innerBySku.set(`${text(bom.company_id)}|${text(bom.sku_material_id)}`, inner);
  }

  // Dispatch by SO dispatch type (and place) -- one query set shared by Page 2 and Page 3.
  const { data: postings, error: postingError } = await serviceRoleClient.schema("erp_inventory")
    .rpc("fg_dispatch_postings", { p_company_ids: p.companyIds, p_from: p.from, p_to: p.to });
  if (postingError) throw new Error("FG_MOVEMENT_DISPATCH_FAILED");
  const postingRows = (postings ?? []) as JsonRecord[];
  const invoiceIds = [...new Set(postingRows.map((row) => text(row.invoice_id)).filter(Boolean))];
  const invoices = await fetchInChunks<JsonRecord>(invoiceIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_invoice")
    .select("id, so_id, sto_id, dc_id").in("id", chunk), 50);
  const invoiceById = new Map(invoices.map((row) => [text(row.id), row]));
  const soIds = [...new Set(invoices.map((row) => text(row.so_id)).filter(Boolean))];
  const orders = await fetchInChunks<JsonRecord>(soIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("sales_order")
    .select("id, dispatch_type").in("id", chunk), 50);
  const dispatchTypeBySo = new Map(orders.map((row) => [text(row.id), text(row.dispatch_type).toUpperCase()]));
  const typeOfInvoice = (invoiceId: string): string => {
    const invoice = invoiceById.get(invoiceId);
    if (!invoice) return "OTHER";
    const type = dispatchTypeBySo.get(text(invoice.so_id)) ?? "";
    if (type && (DISPATCH_TYPES as readonly string[]).includes(type)) return type;
    return text(invoice.sto_id) ? "STO" : "OTHER";
  };

  const dispatchByKey = new Map<string, Record<string, number>>();
  for (const row of postingRows) {
    const key = `${text(row.company_id)}|${text(row.material_id)}`;
    const bucket = dispatchByKey.get(key) ?? {};
    const type = typeOfInvoice(text(row.invoice_id));
    bucket[type] = (bucket[type] ?? 0) + num(row.qty);
    dispatchByKey.set(key, bucket);
  }

  const groupOf = (companyId: string, material: JsonRecord | undefined) => {
    const externalCode = text(material?.external_code);
    const info = externalCode.length > 3 ? groupMap.get(`${companyId}|${externalCode.slice(0, -3)}`) : undefined;
    return { mother: info?.mother || NO_GROUP, child: info?.child || NO_GROUP };
  };
  const typeOf = (companyId: string, materialId: string): string => {
    const set = typeSets.get(`${companyId}|${materialId}`) ?? anyTypeByMaterial.get(materialId);
    if (!set || set.size === 0) return "—";
    const nonTest = TYPE_PRIORITY.find((t) => t !== "MTEST" && set.has(t));
    return nonTest ?? (set.has("MTEST") ? "MTEST" : [...set][0]);
  };

  const rows: SkuRow[] = [];
  for (const row of summaryRows) {
    const companyId = text(row.company_id);
    const materialId = text(row.material_id);
    const material = materialById.get(materialId);
    const { mother, child } = groupOf(companyId, material);
    const type = typeOf(companyId, materialId);
    if (p.mothers.size > 0 && !p.mothers.has(mother)) continue;
    if (p.children.size > 0 && !p.children.has(child)) continue;
    if (p.types.size > 0 && !p.types.has(type)) continue;
    const factor = fixedFactor.get(materialId);
    rows.push({
      company_id: companyId,
      company_code: companyCode.get(companyId) ?? "—",
      material_id: materialId,
      sku: text(material?.external_code) || text(material?.pace_code),
      description: text(material?.document_name) || text(material?.material_name),
      mother_group: mother, child_group: child, type,
      base_uom: text(material?.base_uom_code) || "KG",
      outer_uom: factor?.uom ?? null,
      base_per_outer: factor?.factor ?? null,
      inner_per_outer: factor ? (innerBySku.get(`${companyId}|${materialId}`) ?? null) : null,
      opening: num(row.opening), production: num(row.production), pid: num(row.pid), other: num(row.other),
      dispatch: num(row.dispatch), closing: num(row.closing), in_qa: num(row.in_qa), blocked: num(row.blocked),
      dispatch_by_type: dispatchByKey.get(`${companyId}|${materialId}`) ?? {},
      other_by: otherByKey.get(`${companyId}|${materialId}`) ?? {},
    });
  }
  rows.sort((a, b) => a.company_code.localeCompare(b.company_code) || a.mother_group.localeCompare(b.mother_group)
    || a.child_group.localeCompare(b.child_group) || a.sku.localeCompare(b.sku));

  const placeRows: JsonRecord[] = [];
  if (withPlaces) {
    const keep = new Set(rows.map((row) => `${row.company_id}|${row.material_id}`));
    const rowByKey = new Map(rows.map((row) => [`${row.company_id}|${row.material_id}`, row]));
    const kept = postingRows.filter((row) => keep.has(`${text(row.company_id)}|${text(row.material_id)}`));
    const keptInvoiceIds = [...new Set(kept.map((row) => text(row.invoice_id)))];
    const dcIds = [...new Set(keptInvoiceIds.map((id) => text(invoiceById.get(id)?.dc_id)).filter(Boolean))];
    const dcs = await fetchInChunks<JsonRecord>(dcIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("delivery_challan")
      .select("id, ship_to_state, delivery_address").in("id", chunk), 50);
    const dcById = new Map(dcs.map((row) => [text(row.id), row]));
    const invLines = await fetchInChunks<JsonRecord>(keptInvoiceIds, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("sales_invoice_line").select("invoice_id, material_id, dc_line_id").in("invoice_id", chunk), 50);
    const dcLineIds = [...new Set(invLines.map((row) => text(row.dc_line_id)).filter(Boolean))];
    const dcLines = await fetchInChunks<JsonRecord>(dcLineIds, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("delivery_challan_line").select("id, so_map_allocation_id").in("id", chunk), 50);
    const allocationIds = [...new Set(dcLines.map((row) => text(row.so_map_allocation_id)).filter(Boolean))];
    const allocations = await fetchInChunks<JsonRecord>(allocationIds, (chunk) => serviceRoleClient.schema("erp_procurement")
      .from("sales_order_map_allocation").select("id, customer_address_id").in("id", chunk), 50);
    const addressIds = [...new Set(allocations.map((row) => text(row.customer_address_id)).filter(Boolean))];
    const addresses = await fetchInChunks<JsonRecord>(addressIds, (chunk) => serviceRoleClient.schema("erp_master")
      .from("customer_address").select("id, state, town").in("id", chunk), 50);
    const addressById = new Map(addresses.map((row) => [text(row.id), row]));
    const allocationAddress = new Map(allocations.map((row) => [text(row.id), text(row.customer_address_id)]));
    const dcLineAllocation = new Map(dcLines.map((row) => [text(row.id), text(row.so_map_allocation_id)]));
    const addressByInvoiceMaterial = new Map<string, JsonRecord>();
    for (const line of invLines) {
      const key = `${text(line.invoice_id)}|${text(line.material_id)}`;
      if (addressByInvoiceMaterial.has(key)) continue;
      const address = addressById.get(allocationAddress.get(dcLineAllocation.get(text(line.dc_line_id)) ?? "") ?? "");
      if (address) addressByInvoiceMaterial.set(key, address);
    }
    const bucket = new Map<string, JsonRecord>();
    for (const posting of kept) {
      const sku = rowByKey.get(`${text(posting.company_id)}|${text(posting.material_id)}`);
      if (!sku) continue;
      const invoice = invoiceById.get(text(posting.invoice_id));
      const dc = dcById.get(text(invoice?.dc_id));
      const address = addressByInvoiceMaterial.get(`${text(posting.invoice_id)}|${text(posting.material_id)}`);
      const state = text(address?.state) || text(dc?.ship_to_state) || "—";
      const town = text(address?.town) || "—";
      const month = monthYear(text(posting.posting_date));
      const key = [sku.company_id, sku.material_id, state, town, month].join("|");
      const existing = bucket.get(key);
      if (existing) existing.dispatch = num(existing.dispatch) + num(posting.qty);
      else bucket.set(key, {
        company_code: sku.company_code, state, town, month_year: month, mother_group: sku.mother_group, child_group: sku.child_group,
        type: sku.type, sku: sku.sku, description: sku.description, base_uom: sku.base_uom,
        outer_uom: sku.outer_uom, base_per_outer: sku.base_per_outer, inner_per_outer: sku.inner_per_outer,
        dispatch: num(posting.qty), month_sort: text(posting.posting_date).slice(0, 7),
      });
    }
    placeRows.push(...[...bucket.values()].filter((row) => Math.abs(num(row.dispatch)) > 0.0000001));
    placeRows.sort((a, b) => text(a.company_code).localeCompare(text(b.company_code)) || text(a.state).localeCompare(text(b.state))
      || text(a.town).localeCompare(text(b.town)) || text(a.month_sort).localeCompare(text(b.month_sort)) || text(a.sku).localeCompare(text(b.sku)));
  }
  return { rows, placeRows, otherCategories };
}

// GET /api/procurement/fg-movement-report?company_ids=&date_from=&date_to=&mother_groups=&child_groups=&types=
export async function getFgMovementReportHandler(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const params = await resolveParams(req, ctx);
    if ("error" in params) return params.error;
    const built = await build(ctx, params, false);
    return okResponse({ data: { rows: built.rows, dispatch_types: DISPATCH_TYPES, other_categories: built.otherCategories } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FG_MOVEMENT_REPORT_FAILED";
    return fail(req, ctx, code, 500, code);
  }
}

// GET /api/procurement/fg-movement-report/places   (same query) -- dispatch by State / Town / month
export async function getFgMovementPlacesHandler(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const params = await resolveParams(req, ctx);
    if ("error" in params) return params.error;
    const built = await build(ctx, params, true);
    return okResponse({ data: { rows: built.placeRows } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FG_MOVEMENT_PLACES_FAILED";
    return fail(req, ctx, code, 500, code);
  }
}

// GET /api/procurement/fg-movement-report/options?company_ids=  -- Mother / Child group names of the chosen companies (PO21)
export async function getFgMovementOptionsHandler(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyIds = parseList(url, "company_ids");
    if (companyIds.length === 0) return okResponse({ data: { groups: [], types: ["MTS", "MTO", "HPS", "MTEST"] } }, ctx.request_id, req);
    for (const companyId of companyIds) {
      try {
        await assertCompanyScope(ctx, companyId);
      } catch {
        return fail(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to one of the selected companies.");
      }
    }
    const mothers = await fetchInChunks<JsonRecord>(companyIds, (chunk) => serviceRoleClient.schema("erp_planning")
      .from("prodshade_mother_group").select("id, company_id, group_name").eq("is_active", true).in("company_id", chunk));
    const children = await fetchInChunks<JsonRecord>(companyIds, (chunk) => serviceRoleClient.schema("erp_planning")
      .from("prodshade_child_group").select("id, company_id, mother_group_id, group_name").eq("is_active", true).in("company_id", chunk));
    const motherName = new Map(mothers.map((row) => [text(row.id), text(row.group_name)]));
    const pairs = new Set<string>();
    for (const child of children) pairs.add(`${motherName.get(text(child.mother_group_id)) ?? ""}\u0000${text(child.group_name)}`);
    for (const mother of mothers) pairs.add(`${text(mother.group_name)}\u0000`);
    const groups = [...pairs].map((pair) => {
      const [mother, child] = pair.split("\u0000");
      return { mother, child };
    }).filter((row) => row.mother).sort((a, b) => a.mother.localeCompare(b.mother) || a.child.localeCompare(b.child));
    groups.push({ mother: NO_GROUP, child: NO_GROUP });
    return okResponse({ data: { groups, types: ["MTS", "MTO", "HPS", "MTEST"] } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FG_MOVEMENT_OPTIONS_FAILED";
    return fail(req, ctx, code, 500, code);
  }
}
