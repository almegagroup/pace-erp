/*
 * PO22 Planning (sheet PLANNING equivalent) + Store report + saved runs.
 *   GET  /api/procurement/mts-requirement/planning      live calculation (no write)
 *   POST /api/procurement/mts-requirement/planning/runs  recalculates server-side and saves one immutable run
 *   GET  /api/procurement/mts-requirement/planning/runs  saved runs (metadata)
 *   GET  /api/procurement/mts-requirement/planning/run   one saved run
 * Advisory only: never creates a PO, CSN, GRN, reservation, transfer or stock posting.
 */
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import { normalizePlanMonth } from "./mts_customer_plan.logic.ts";
import { buildCalendar, isIsoDate, isTransferFed, monthEnd, moqInBase, orderUnitOf, preferredVendorOrderUom, type PolicyOverride, toMaterialBase } from "./mts_requirement.logic.ts";
import {
  cachedLoad,
  computeRequirement,
  hashIds,
  fetchAllPages,
  fail,
  loadLocationLabels,
  handleError,
  type ReqHandlerContext,
  requireRequirementPolicyAccess,
  requireRequirementViewAccess,
  todayInIndia,
  buildDisplayUnits,
} from "./mts_requirement.handlers.ts";
import { familyClosure } from "./mts_item_plan.logic.ts";
import { loadGroupCoveragePolicyVersions } from "./mts_group_policy.handlers.ts";
import { bulkOnlyGroupIds, loadBulkMaterialIds } from "./mts_bulk_materials.ts";
import { type FamilyGroupDemand, type FamilyOpeningReceipt, type FamilyOwnDemand, type FamilyPlannerInput, familyMoveCost, optimizeFamilyArrival, optimizeFamilyTogether, planFamily } from "./mts_family_planner.logic.ts";
import { assemblePlanningInput, familyArrivalEta, priceUnitCode, familyArrivalRisk, isFamilyAllocatableArrival, storeGroupPeriodShares, storePeriodLabel, storeTransferHints, type VendorTerm } from "./mts_planning.logic.ts";
import { applyOrderConstraints, totalLeadTimeDays } from "./mts_optimizer_phase3d.logic.ts";
import type { OptimizerAdvisoryBuy, OptimizerManualLot, OptimizerVendorOption } from "./mts_optimizer_phase3d.types.ts";
import { averageOrderCost, type CostOption, costOption, DEFAULT_CYCLE_DAYS, economicCycleDays, landedAdder, type LandedCostBasis, rankCostOptions, resolvePurchaseCurrency } from "./mts_cost.logic.ts";
import { interestPctAt } from "./mts_planning_cost.logic.ts";
import { resolveFxRate } from "./mts_planning_cost.handlers.ts";
import { buildPlanningAiPrompt, PO22_AI_MAX_PROMPT_CHARS } from "./mts_planning_ai.logic.ts";
import { loadRescheduleContext } from "./mts_reschedule_window.handlers.ts";
import { rStoreKey, scheduleStoreTransfers } from "./mts_store_instruction.logic.ts";
import { buildStorePlan, type StorePlanPeriod, type StorePlanRecord } from "./mts_store_plan.logic.ts";
import { rescheduleVerdict } from "./mts_reschedule_window.logic.ts";
import { AiProviderError, generateAiText } from "../ai/ai.provider.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];

type PlanningParams = {
  companyId: string; planMonth: string; asOf: string; demandAt: string | null; today: string;
  /** P1 item plan: months after NM (horizon = CM + NM + extra) with a beyond-plan forecast. */
  extraMonths?: number;
  /** P4: lots the user fixed (or applied from AI); the engine plans the rest around them. */
  manualLots?: OptimizerManualLot[];
  /** Simulation only (never saved): reschedule key → plant date. */
  rescheduleOverrides?: ReadonlyMap<string, string | null>;
  /** Simulation only (never saved): what-if Target / Critical days per material. */
  policyOverrides?: ReadonlyMap<string, PolicyOverride>;
  /** Item plan: optimise arrival dates only for this material's family (speed); absent = every material. */
  arrivalFamilyOf?: string;
  /** Preview: reuse the last full load's heavy reads (≤ 3 min). */
  reuseLoads?: boolean;
};

export function readParams(url: URL | JsonRecord, today: string): { params?: Omit<PlanningParams, "companyId">; error?: [string, string] } {
  const get = (key: string) => (url instanceof URL ? url.searchParams.get(key) : (url[key] as string | undefined) ?? null);
  const planMonth = normalizePlanMonth(get("plan_month"));
  if (!planMonth) return { error: ["MTS_REQ_INVALID_MONTH", "plan_month must be YYYY-MM."] };
  const asOf = text(get("as_of")) || today;
  if (!isIsoDate(asOf) || asOf > today) return { error: ["MTS_REQ_INVALID_AS_OF", "as_of must be a date, not in the future."] };
  const demandAtRaw = text(get("demand_at"));
  const demandAt = demandAtRaw && Number.isFinite(Date.parse(demandAtRaw)) ? new Date(demandAtRaw).toISOString() : null;
  return { params: { planMonth, asOf, demandAt, today } };
}

async function loadVendorTerms(companyId: string, universe: string[], routesByMaterial: Map<string, Array<{ vendor_id?: string; days: number }>>, materials: Awaited<ReturnType<typeof computeRequirement>>["materials"], today: string) {
  const result = new Map<string, VendorTerm[]>();
  if (universe.length === 0) return result;
  const [vmiRows, mapRes] = await Promise.all([
    fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient.schema("erp_master").from("vendor_material_info")
      .select("id, vendor_id, material_id, moq_qty, order_multiple_qty, delivery_lot_qty, supply_uom_code, booking_time_days, last_purchase_price, last_purchase_currency, last_grn_date")
      .eq("status", "ACTIVE").in("material_id", chunk)),
    serviceRoleClient.schema("erp_master").from("vendor_company_map").select("vendor_id").eq("company_id", companyId).eq("active", true).limit(5000),
  ]);
  const companyVendors = new Set(((mapRes.data ?? []) as JsonRecord[]).map((row) => text(row.vendor_id)));
  const rows = vmiRows.filter((row) => companyVendors.has(text(row.vendor_id)));
  const vendorIds = unique(rows.map((row) => text(row.vendor_id)));
  const vendors = vendorIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("vendor_master").select("id, vendor_code, vendor_name").in("id", chunk));
  const label = new Map(vendors.map((v) => [text(v.id), [text(v.vendor_code), text(v.vendor_name)].filter(Boolean).join(" — ")]));
  // Default payment term per vendor-material (D10: cash-out timing).
  const vmiIds = unique(rows.map((row) => text(row.id)));
  const [termRows, currencyRows, vendorUomRows, recentPos] = vmiIds.length === 0 ? [[], [], [], []] : await Promise.all([
    fetchInChunks<JsonRecord>(vmiIds, (chunk) => serviceRoleClient.schema("erp_master")
      .from("vendor_material_payment_term").select("vmi_id, payment_term_id, is_default").in("vmi_id", chunk)),
    fetchInChunks<JsonRecord>(vmiIds, (chunk) => serviceRoleClient.schema("erp_master")
      .from("vendor_material_currency").select("vmi_id, currency_code, is_default").in("vmi_id", chunk)),
    fetchInChunks<JsonRecord>(vmiIds, (chunk) => serviceRoleClient.schema("erp_master")
      .from("vendor_material_uom").select("vmi_id, uom_code, is_default").in("vmi_id", chunk)),
    fetchAllPages(() => serviceRoleClient.schema("erp_procurement").from("purchase_order")
      .select("id, po_date, status").eq("company_id", companyId)
      .gte("po_date", new Date(Date.parse(`${today}T00:00:00Z`) - 730 * 86_400_000).toISOString().slice(0, 10)).order("po_date"), "MTS_PLANNING_PO_CURRENCY_READ_FAILED"),
  ]);
  const poById = new Map(recentPos
    .filter((po) => !["CANCELLED", "REJECTED"].includes(text(po.status).toUpperCase()))
    .map((po) => [text(po.id), po]));
  const recentPoLines = poById.size === 0 ? [] : await fetchInChunks<JsonRecord>(vmiIds, (chunk) => serviceRoleClient.schema("erp_procurement")
    .from("purchase_order_line").select("po_id, vendor_material_info_id, currency_code, po_uom_code").in("vendor_material_info_id", chunk));
  const termIds = unique(termRows.map((t) => text(t.payment_term_id)));
  const terms = termIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(termIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("payment_terms_master").select("id, credit_days, advance_pct, payment_method, payment_type").in("id", chunk));
  const termById = new Map(terms.map((t) => [text(t.id), t]));
  const termByVmi = new Map<string, JsonRecord>();
  for (const t of termRows) {
    const term = termById.get(text(t.payment_term_id));
    if (term && (t.is_default === true || !termByVmi.has(text(t.vmi_id)))) termByVmi.set(text(t.vmi_id), term);
  }
  // Legacy VMI rows often have a last price but leave last_purchase_currency
  // blank. MM03's default vendor-material currency is the authoritative
  // fallback; a blank must never be silently treated as INR.
  const currencyByVmi = new Map<string, string>();
  for (const row of currencyRows) {
    const vmiId = text(row.vmi_id);
    const currency = text(row.currency_code).toUpperCase();
    if (currency && (row.is_default === true || !currencyByVmi.has(vmiId))) currencyByVmi.set(vmiId, currency);
  }
  // The PO line records the currency of the price actually paid.  A legacy
  // VMI may carry the price but have no currency, so retain the latest linked
  // non-cancelled PO currency as the strongest source.
  const poCurrencyByVmi = new Map<string, { currency: string; po_date: string }>();
  for (const line of recentPoLines) {
    const po = poById.get(text(line.po_id));
    const vmiId = text(line.vendor_material_info_id);
    const currency = text(line.currency_code).toUpperCase();
    if (!po || !vmiId || !currency) continue;
    const date = text(po.po_date);
    const seen = poCurrencyByVmi.get(vmiId);
    if (!seen || date >= seen.po_date) poCurrencyByVmi.set(vmiId, { currency, po_date: date });
  }
  // Owner 2026-10-27: a VMI price is per the unit of the PO it came from (Dolomite 240# is ₹5,725 per MT, PO UoM MT),
  // but supply_uom_code is often blank. Without it the price was read per KG and the order value came out 1000x.
  // Blank Supply UoM falls back to the latest linked non-cancelled PO line's UoM, then to base.
  const poUomByVmi = new Map<string, { uom: string; po_date: string }>();
  for (const line of recentPoLines) {
    const po = poById.get(text(line.po_id));
    const vmiId = text(line.vendor_material_info_id);
    const uom = text(line.po_uom_code).toUpperCase();
    if (!po || !vmiId || !uom) continue;
    const date = text(po.po_date);
    const seen = poUomByVmi.get(vmiId);
    if (!seen || date >= seen.po_date) poUomByVmi.set(vmiId, { uom, po_date: date });
  }
  const vendorUomsByVmi = new Map<string, JsonRecord[]>();
  for (const row of vendorUomRows) {
    const vmiId = text(row.vmi_id);
    vendorUomsByVmi.set(vmiId, [...(vendorUomsByVmi.get(vmiId) ?? []), row]);
  }
  for (const row of rows) {
    const materialId = text(row.material_id);
    const vendorId = text(row.vendor_id);
    const material = materials.get(materialId);
    // Supply UoM wins; otherwise use MM03's default vendor-material UoM. This
    // shared value drives Order UoM display, MOQ/multiple conversion and price.
    const supplyUom = preferredVendorOrderUom(text(row.supply_uom_code), vendorUomsByVmi.get(text(row.id)) ?? []);
    const unit = supplyUom || material?.base_uom_code || "";
    const toBase = (value: unknown) => { const q = num(value); return q === null ? null : toMaterialBase(material, q, unit); };
    // The price unit (not the MOQ unit): Supply UoM, else the latest PO line UoM, else base.
    // Only a GRN writes the price in the PO unit; a price typed in MM03 (no GRN yet) is per base unit.
    const priceUnit = priceUnitCode({ supply_uom_code: supplyUom, last_grn_date: text(row.last_grn_date), latest_po_uom: poUomByVmi.get(text(row.id))?.uom, base_uom_code: material?.base_uom_code });
    const booking = num(row.booking_time_days);
    const routeDays = (routesByMaterial.get(materialId) ?? []).filter((r) => r.vendor_id === vendorId).map((r) => r.days); // route days only (owner 2026-10-29)
    result.set(materialId, [...(result.get(materialId) ?? []), {
      vendor_id: vendorId, vendor_label: label.get(vendorId) ?? "—", material_id: materialId,
      moq_base: toBase(row.moq_qty), multiple_base: toBase(row.order_multiple_qty), lot_base: toBase(row.delivery_lot_qty),
      booking_days: booking, route_days: routeDays.length ? Math.max(...routeDays) : null,
      // VMI keeps the price per its Supply UoM (e.g. ₹/MT); every cost here is per base unit.
      last_price: (() => { const price = num(row.last_purchase_price); const perSupply = toMaterialBase(material, 1, priceUnit); return price === null || !perSupply || perSupply <= 0 ? null : price / perSupply; })(),
      currency: resolvePurchaseCurrency({
        po_line_currency: poCurrencyByVmi.get(text(row.id))?.currency ?? null,
        vmi_last_purchase_currency: text(row.last_purchase_currency) || null,
        vmi_default_currency: currencyByVmi.get(text(row.id)) ?? null,
      }),
      supply_uom_code: supplyUom,
      ...(() => {
        const term = termByVmi.get(text(row.id));
        if (!term) return { credit_days: null, advance: false };
        const advance = (num(term.advance_pct) ?? 0) >= 100 || text(term.payment_method).toUpperCase() === "ADVANCE" || text(term.payment_type).toUpperCase() === "ADVANCE";
        return { credit_days: num(term.credit_days), advance };
      })(),
    }]);
  }
  return result;
}

async function loadSelections(companyId: string, months: string[]): Promise<{ map: Map<string, Set<string>>; available: boolean }> {
  const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_optimizer_material_selection")
    .select("material_id, selection_month, is_selected_for_new_purchase").eq("company_id", companyId).eq("is_current", true).in("selection_month", months).limit(5000);
  const map = new Map<string, Set<string>>();
  if (error) return { map, available: false };
  for (const row of (data ?? []) as JsonRecord[]) {
    if (row.is_selected_for_new_purchase !== true) continue;
    const month = text(row.selection_month).slice(0, 10);
    map.set(month, new Set([...(map.get(month) ?? []), text(row.material_id)]));
  }
  return { map, available: true };
}

const addCalendarMonths = (day: string, months: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};
const addCalendarDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * PO22 shelf-life convention (owner 2026-10-23): planning is not a physical
 * lot ledger.  We attribute today's counted opening stock to the known Opening
 * Stock / GRN receipts in earliest-valid-until order, then tell Store what to
 * use first.  No stock posting or issue confirmation is made here.
 */
async function loadOpeningReceiptAdvice(
  companyId: string,
  asOf: string,
  openingQty: Readonly<Record<string, number>>,
  materials: Awaited<ReturnType<typeof computeRequirement>>["materials"],
): Promise<FamilyOpeningReceipt[]> {
  const materialIds = Object.keys(openingQty).filter((id) => (openingQty[id] ?? 0) > 0);
  if (materialIds.length === 0) return [];
  const cutoff = addCalendarDays(asOf, -120);
  const [openingDocs, grnPages] = await Promise.all([
    serviceRoleClient.schema("erp_procurement").from("opening_stock_document")
      .select("id, document_number, cut_off_date").eq("company_id", companyId).eq("status", "POSTED").lte("cut_off_date", asOf).limit(1000),
    Promise.all(Array.from({ length: Math.ceil(materialIds.length / 100) }, (_, index) => {
      const chunk = materialIds.slice(index * 100, index * 100 + 100);
      return fetchAllPages(() => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .select("id, grn_number, material_id, received_qty, uom_code, grn_date, expiry_type, expiry_date, shelf_life_months")
        .eq("company_id", companyId).eq("status", "POSTED").lt("grn_date", asOf).in("material_id", chunk)
        // Normal fallback life is 120d; an older GRN matters only when it carries an explicit expiry.
        .or(`grn_date.gte.${cutoff},expiry_date.gte.${asOf}`).order("grn_date").order("id"), "MTS_SHELF_LIFE_GRN_LOAD_FAILED");
    })),
  ]);
  if (openingDocs.error) throw new Error("MTS_SHELF_LIFE_OPENING_DOCUMENT_LOAD_FAILED");
  const docRows = (openingDocs.data ?? []) as JsonRecord[];
  const docById = new Map(docRows.map((row) => [text(row.id), row]));
  const docIds = [...docById.keys()];
  const materialChunks = Array.from({ length: Math.ceil(materialIds.length / 100) }, (_, index) => materialIds.slice(index * 100, index * 100 + 100));
  const openingLines = docIds.length === 0 ? [] : (await Promise.all(materialChunks.map((materialChunk) => fetchInChunks<JsonRecord>(docIds, (docChunk) => serviceRoleClient.schema("erp_procurement")
    .from("opening_stock_line").select("document_id, material_id, quantity").in("document_id", docChunk).in("material_id", materialChunk)))).then((chunks) => chunks.flat()));

  const byMaterial = new Map<string, FamilyOpeningReceipt[]>();
  const put = (receipt: FamilyOpeningReceipt) => byMaterial.set(receipt.material_id, [...(byMaterial.get(receipt.material_id) ?? []), receipt]);
  for (const line of openingLines) {
    const doc = docById.get(text(line.document_id));
    const qty = num(line.quantity) ?? 0;
    const date = text(doc?.cut_off_date);
    const materialId = text(line.material_id);
    if (!doc || qty <= 0 || !materialId || !isIsoDate(date)) continue;
    // Owner 2026-10-28: opening stock has no real expiry; cut-off + 120 days is only its FEFO rank (older counts are used first), never a reason to drop it.
    const validUntil = addCalendarDays(date, 120);
    put({ material_id: materialId, qty_base: qty, valid_until: validUntil, reference: `Opening stock ${text(doc.document_number)}`, expiry_priority: validUntil < addCalendarDays(asOf, 120), no_expiry: true });
  }
  for (const grn of grnPages.flat()) {
    const materialId = text(grn.material_id);
    const grnDate = text(grn.grn_date);
    const receivedQty = num(grn.received_qty);
    const qty = receivedQty === null ? null : toMaterialBase(materials.get(materialId), receivedQty, text(grn.uom_code));
    if (!materialId || !isIsoDate(grnDate) || qty === null || qty <= 0) continue;
    const explicitDate = text(grn.expiry_date);
    const span = num(grn.shelf_life_months);
    const realExpiry = isIsoDate(explicitDate) || (text(grn.expiry_type).toUpperCase() === "SPAN" && span !== null && span > 0);
    const validUntil = isIsoDate(explicitDate)
      ? explicitDate
      : text(grn.expiry_type).toUpperCase() === "SPAN" && span !== null && span > 0
        ? addCalendarMonths(grnDate, Math.floor(span))
        : addCalendarDays(grnDate, 120);
    // Owner 2026-10-28: only a stated expiry (date or span) removes stock; GRN + 120 days is just the FEFO rank.
    if (realExpiry && validUntil < asOf) continue;
    put({
      material_id: materialId,
      qty_base: qty,
      valid_until: validUntil,
      reference: `GRN ${text(grn.grn_number) || text(grn.id)}`,
      expiry_priority: validUntil < addCalendarDays(asOf, 120),
      ...(realExpiry ? {} : { no_expiry: true }),
    });
  }
  const out: FamilyOpeningReceipt[] = [];
  for (const materialId of materialIds) {
    let left = Math.max(0, Number(openingQty[materialId] ?? 0));
    const receipts = [...(byMaterial.get(materialId) ?? [])]
      .sort((a, b) => a.valid_until.localeCompare(b.valid_until) || a.reference.localeCompare(b.reference));
    for (const receipt of receipts) {
      if (left <= 0.000001) break;
      const qty = Math.min(left, receipt.qty_base);
      if (qty <= 0.000001) continue;
      out.push({ ...receipt, qty_base: qty });
      left -= qty;
    }
    // A source gap must remain visible, never be dressed up as a GRN.  This
    // fallback only keeps existing planning behaviour while Store fixes source data.
    if (left > 0.000001) out.push({ material_id: materialId, qty_base: left, valid_until: addCalendarDays(asOf, 120), reference: "Unattributed counted stock", expiry_priority: false, no_expiry: true });
  }
  return out;
}

type CostInputs = {
  interestPct: number | null;
  customerCreditDays: number | null;
  fxByCurrency: Map<string, { inr: number | null; source: string | null; stale: boolean }>;
  landedByVendorMaterial: Map<string, { adder: number | null; basis: LandedCostBasis }>;
  /** P2: average landed cost of one order (per GRN) per vendor + material. */
  orderCostByVendorMaterial: Map<string, number | null>;
  /** Owner 2026-10-21: freight term of the latest PO per vendor + material (FOR / FREIGHT_SEPARATE / …). */
  freightTermByVendorMaterial: Map<string, string>;
};

async function loadCostInputs(companyId: string, asOf: string, today: string, universe: string[], vendorTerms: Map<string, VendorTerm[]>, materials: Awaited<ReturnType<typeof computeRequirement>>["materials"]): Promise<CostInputs> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const currencies = unique([...vendorTerms.values()].flat().map((t) => t.currency?.toUpperCase() ?? null).filter((c) => c !== "INR"));
  const [financeRes, soRes, grns, fxPicks] = await Promise.all([
    serviceRoleClient.schema("erp_planning").from("company_planning_finance").select("effective_from, interest_pct_per_year").eq("company_id", companyId).limit(500),
    serviceRoleClient.schema("erp_procurement").from("sales_order").select("payment_term_id").eq("company_id", companyId).gte("so_date", since).not("payment_term_id", "is", null).limit(5000),
    universe.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, vendor_id, material_id, po_id, received_qty, uom_code, status, grn_date").eq("company_id", companyId).gte("grn_date", since).in("material_id", chunk)),
    Promise.all(currencies.map(async (code) => [code, await resolveFxRate(code, today).catch(() => null)] as const)),
  ]);
  const interestPct = financeRes.error ? null : interestPctAt(((financeRes.data ?? []) as JsonRecord[]).map((r) => ({ effective_from: text(r.effective_from), interest_pct_per_year: Number(r.interest_pct_per_year) })), asOf);
  // Customer credit days = the company's most used sales payment term (D11: invoice date + term).
  const termCounts = new Map<string, number>();
  for (const row of (soRes.data ?? []) as JsonRecord[]) termCounts.set(text(row.payment_term_id), (termCounts.get(text(row.payment_term_id)) ?? 0) + 1);
  const topTerm = [...termCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let customerCreditDays: number | null = null;
  if (topTerm) {
    const { data } = await serviceRoleClient.schema("erp_master").from("payment_terms_master").select("credit_days").eq("id", topTerm).maybeSingle();
    customerCreditDays = num((data as JsonRecord | null)?.credit_days);
  }
  const fxByCurrency = new Map<string, { inr: number | null; source: string | null; stale: boolean }>([["INR", { inr: 1, source: "BASE", stale: false }]]);
  for (const [code, pick] of fxPicks) fxByCurrency.set(code, { inr: pick?.inr_per_unit ?? null, source: pick?.source ?? null, stale: pick?.stale ?? false });
  // Landed cost history per vendor + material (AC01 landed_cost by GRN).
  const postedGrns = grns.filter((g) => !["CANCELLED", "REVERSED", "DRAFT"].includes(text(g.status).toUpperCase()));
  const grnIds = unique(postedGrns.map((g) => text(g.id)));
  const grnPoIds = unique(postedGrns.map((g) => text(g.po_id)));
  const grnPos = grnPoIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(grnPoIds, (chunk) => serviceRoleClient.schema("erp_procurement")
    .from("purchase_order").select("id, vendor_type, freight_term").in("id", chunk));
  const grnPoById = new Map(grnPos.map((po) => [text(po.id), po]));
  const landed = grnIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(grnIds, (chunk) => serviceRoleClient.schema("erp_procurement")
    .from("landed_cost").select("grn_id, total_cost, status").in("grn_id", chunk));
  const landedByGrn = new Map<string, { total: number; status: string }>();
  for (const row of landed) {
    if (text(row.status).toUpperCase() === "CANCELLED") continue;
    const seen = landedByGrn.get(text(row.grn_id)) ?? { total: 0, status: "POSTED" };
    seen.total += Number(row.total_cost ?? 0);
    if (text(row.status).toUpperCase() !== "POSTED") seen.status = "DRAFT";
    landedByGrn.set(text(row.grn_id), seen);
  }
  const history = new Map<string, Array<{ total_cost: number; received_base_qty: number; status: string }>>();
  const includedInPoRate = new Set<string>();
  for (const grn of postedGrns) {
    const lc = landedByGrn.get(text(grn.id));
    const base = toMaterialBase(materials.get(text(grn.material_id)), Number(grn.received_qty ?? 0), text(grn.uom_code));
    if (base === null) continue;
    const key = `${text(grn.vendor_id)}|${text(grn.material_id)}`;
    if (lc) {
      history.set(key, [...(history.get(key) ?? []), { total_cost: lc.total, received_base_qty: base, status: lc.status }]);
      continue;
    }
    const po = grnPoById.get(text(grn.po_id));
    if (text(po?.vendor_type).toUpperCase() === "DOMESTIC" && text(po?.freight_term).toUpperCase() === "FOR") includedInPoRate.add(key);
  }
  const landedByVendorMaterial = new Map([...history].map(([key, rows]) => [key, landedAdder(rows)]));
  for (const key of includedInPoRate) {
    if (!landedByVendorMaterial.has(key)) landedByVendorMaterial.set(key, { adder: 0, basis: "INCLUDED_IN_PO_RATE" });
  }
  const orderCostByVendorMaterial = new Map([...history].map(([key, rows]) => [key, averageOrderCost(rows)]));
  // Freight term of the latest PO per vendor + material (2 years).
  const poSince = new Date(Date.parse(`${today}T00:00:00Z`) - 730 * 86_400_000).toISOString().slice(0, 10);
  const recentPos = await fetchAllPages(() => serviceRoleClient.schema("erp_procurement").from("purchase_order")
    .select("id, vendor_id, freight_term, po_date").eq("company_id", companyId).gte("po_date", poSince).order("id"), "MTS_PLANNING_FREIGHT_TERM_READ_FAILED");
  const poById = new Map(recentPos.map((po) => [text(po.id), po]));
  const poLines = recentPos.length === 0 || universe.length === 0 ? [] : await fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient
    .schema("erp_procurement").from("purchase_order_line").select("po_id, material_id").in("material_id", chunk));
  const freightTermByVendorMaterial = new Map<string, string>();
  const freightDate = new Map<string, string>();
  for (const line of poLines) {
    const po = poById.get(text(line.po_id));
    if (!po || !text(po.freight_term)) continue;
    const key = `${text(po.vendor_id)}|${text(line.material_id)}`;
    if ((freightDate.get(key) ?? "") <= text(po.po_date)) { freightDate.set(key, text(po.po_date)); freightTermByVendorMaterial.set(key, text(po.freight_term).toUpperCase()); }
  }
  return { interestPct, customerCreditDays, fxByCurrency, landedByVendorMaterial, orderCostByVendorMaterial, freightTermByVendorMaterial };
}

function costOptionsFor(
  buy: OptimizerAdvisoryBuy,
  terms: readonly VendorTerm[],
  inputs: CostInputs,
  asOf: string,
  dailyUse: number,
  carryingRate: number | null,
): CostOption[] {
  const options = terms.map((term) => {
    const lead = totalLeadTimeDays({ material_id: term.material_id, target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null, booking_time_days: term.booking_days, route_lead_time_days: term.route_days }); // route only
    const need = buy.need_date ?? buy.estimated_plant_eta;
    const feasible = lead !== null && need !== null && new Date(Date.parse(`${need}T00:00:00Z`) - lead * 86_400_000).toISOString().slice(0, 10) >= asOf;
    let orderQty: number | null = null;
    try {
      orderQty = applyOrderConstraints(buy.required_qty_base, { material_id: term.material_id, target_days: null, critical_days: null, vendor_moq_qty_base: term.moq_base, order_multiple_qty_base: term.multiple_base, configured_lead_time_days: null });
    } catch { orderQty = null; }
    const currency = term.currency?.toUpperCase() || null;
    const fx = currency ? inputs.fxByCurrency.get(currency) ?? { inr: null, source: null, stale: false } : { inr: null, source: null, stale: false };
    const landed = inputs.landedByVendorMaterial.get(`${term.vendor_id}|${term.material_id}`) ?? { adder: null, basis: "NONE" as const };
    return costOption({
      vendor_label: term.vendor_label, price: term.last_price, currency, fx_inr: fx.inr, fx_source: fx.source ? `${fx.source}${fx.stale ? " (last available)" : ""}` : null,
      landed_adder: landed.adder, landed_basis: landed.basis, vendor_credit_days: term.credit_days ?? null, advance: term.advance ?? false,
      order_qty: orderQty, lead_time_days: lead, feasible,
    }, { required_qty: buy.required_qty_base, daily_use: dailyUse, carrying_rate: carryingRate, interest_pct: inputs.interestPct, customer_credit_days: inputs.customerCreditDays });
  });
  return rankCostOptions(options);
}

/** Full planning payload (labels resolved, R-01: no raw ids shown). */
/**
 * Owner 2026-10-30: the Planning / Action view looks as far ahead as the rolling plan and the Item Plan: CM + NM + 4 months (six months).
 * A confirmed receipt that lands inside that window is counted; before this the Action tab called everything after next month "after the planning horizon".
 */
export const PLANNING_EXTRA_MONTHS = 4;

export async function computePlanning(p: PlanningParams) {
  const calendar = buildCalendar(p.planMonth, p.asOf, p.extraMonths ?? 0);
  if (!calendar) throw new Error("MTS_REQ_AS_OF_OUTSIDE_MONTH");
  const req = await computeRequirement(p.companyId, calendar, p.asOf, p.today, p.demandAt, {
    // Owner 2026-10-22: no PO21 plan means zero demand. History is not an
    // authority to create an automatic buy recommendation.
    forecastBeyondPlan: false, rescheduleOverrides: p.rescheduleOverrides, policyOverrides: p.policyOverrides,
    reuseLoads: p.reuseLoads,
  });
  const groupCoveragePolicies = await loadGroupCoveragePolicyVersions(p.companyId);
  const bulkMaterials = await loadBulkMaterialIds(p.companyId);
  const planningStarted = Date.now();
  const universe = unique(req.output.rows.map((r) => r.material_id));
  const routesByMaterial = new Map(req.output.rows.map((r) => [r.material_id, (r.lead_time?.configured_routes ?? []).map((route) => ({ vendor_id: route.vendor_id, days: route.route_days ?? route.days }))]));
  const reuse = p.reuseLoads === true;
  const [vendorTerms, selections] = await Promise.all([
    cachedLoad(`${p.companyId}|vendorTerms|${calendar.asOf}|${hashIds(universe)}`, () => loadVendorTerms(p.companyId, universe, routesByMaterial, req.materials, p.today), reuse),
    // Item Plan runs six months ahead; use a decision from every month in the
    // active horizon, not only CM/NM, when choosing a group member for a new buy.
    loadSelections(p.companyId, calendar.months),
  ]);
  const policyMoqBase = new Map(req.output.rows.map((r) => [r.material_id, moqInBase(r.policy, req.materials.get(r.material_id))]));
  const baseArgs = { calendar, rows: req.output.rows, groups: req.output.groups, policies: req.policyLoad.policies, vendorTerms, selections: selections.map, policyMoqBase };
  const horizonDays = Math.max(1, Math.round((Date.parse(`${calendar.horizonEnd}T00:00:00Z`) - Date.parse(`${calendar.asOf}T00:00:00Z`)) / 86_400_000) + 1);
  const dailyUseOf = (id: string, demand: ReadonlyArray<{ material_id: string | null; qty_base: number }>) =>
    demand.filter((d) => d.material_id === id).reduce((s, d) => s + d.qty_base, 0) / horizonDays;
  const carryingOf = (id: string) => req.output.rows.find((r) => r.material_id === id)?.policy?.carrying_rate_per_uom ?? null;
  // Order UoM (owner 2026-10-22): the lot vendor's MM03 Supply UoM, else Material Settings Order UoM.
  const policyOrderUom = new Map(req.output.rows.map((r) => [r.material_id, r.policy?.order_uom_code ?? null]));
  const orderUnitFor = (id: string, vendorId?: string | null) => orderUnitOf(
    req.materials.get(id),
    vendorId ? (vendorTerms.get(id) ?? []).find((t) => t.vendor_id === vendorId)?.supply_uom_code : null,
    policyOrderUom.get(id),
  );
  const costInputs = await cachedLoad(`${p.companyId}|costInputs|${calendar.asOf}|${p.today}|${hashIds(universe)}`, () => loadCostInputs(p.companyId, calendar.asOf, p.today, universe, vendorTerms, req.materials), reuse);
  const rowDailyUse = (id: string) => {
    const row = req.output.rows.find((r) => r.material_id === id);
    return row ? [...row.daily_demand.values()].reduce((s, q) => s + q, 0) / horizonDays : 0;
  };
  // P2 (owner 2026-10-20): every vendor option with comparable cost (price × FX + landed) and its
  // best order cycle (Max days = Target + cycle); each lot then picks its own vendor.
  const vendorOptions = new Map<string, OptimizerVendorOption[]>();
  const cycleDays = new Map<string, number | null>();
  const cycleBasis = new Map<string, "ECONOMIC" | "DEFAULT">();
  for (const row of req.output.rows) {
    const id = row.material_id;
    const use = rowDailyUse(id);
    const options = (vendorTerms.get(id) ?? []).map((term) => {
    const currency = term.currency?.toUpperCase() || null;
    const fx = currency ? costInputs.fxByCurrency.get(currency)?.inr ?? null : null;
      const priceInr = term.last_price !== null && fx !== null ? term.last_price * fx : null;
      const landed = costInputs.landedByVendorMaterial.get(`${term.vendor_id}|${id}`) ?? { adder: null, basis: "NONE" as const };
      const lead = term.route_days === null ? null : term.route_days; // route only (owner 2026-10-29); booking = PO-by notice
      const cycle = economicCycleDays({ order_cost: costInputs.orderCostByVendorMaterial.get(`${term.vendor_id}|${id}`) ?? null, unit_price_inr: priceInr, interest_pct: costInputs.interestPct, daily_use: use });
      // Owner 2026-10-21: compare vendors on the FULL cost of a typical lot — price × FX + landed
      // + interest on money tied up under the payment term + Item Rate + MOQ excess — not price only.
      const typicalLot = use > 0 ? use * (cycle ?? DEFAULT_CYCLE_DAYS) : 0;
      let orderQty: number | null = null;
      try {
        orderQty = typicalLot > 0 ? applyOrderConstraints(typicalLot, { material_id: id, target_days: null, critical_days: null, vendor_moq_qty_base: term.moq_base, order_multiple_qty_base: term.multiple_base, configured_lead_time_days: null }) : null;
      } catch { orderQty = null; }
      const full = typicalLot > 0 ? costOption({
        vendor_label: term.vendor_label, price: term.last_price, currency, fx_inr: fx, fx_source: null,
        landed_adder: landed.adder, landed_basis: landed.basis, vendor_credit_days: term.credit_days ?? null, advance: term.advance ?? false,
        order_qty: orderQty, lead_time_days: lead, feasible: true,
      }, { required_qty: typicalLot, daily_use: use, carrying_rate: carryingOf(id), interest_pct: costInputs.interestPct, customer_credit_days: costInputs.customerCreditDays }) : null;
      const freightTerm = costInputs.freightTermByVendorMaterial.get(`${term.vendor_id}|${id}`) ?? null;
      const missing = [...(full?.missing ?? (priceInr === null ? [term.last_price === null ? "price" : "exchange rate"] : []))];
      if (currency === null && term.last_price !== null) missing.push("currency");
      // We pay the freight but AC01 has no landed history for this vendor → freight is unknown, not 0.
      if (freightTerm && freightTerm !== "FOR" && landed.basis === "NONE") missing.push(`freight (${freightTerm === "FREIGHT_SEPARATE" ? "freight separate" : "ex godown"} — paid by us, no AC01 history)`);
      const unitCost = full?.total_cost !== null && full?.total_cost !== undefined && typicalLot > 0
        ? full.total_cost / typicalLot
        : priceInr === null ? null : priceInr + (landed.adder ?? 0);
      return {
        vendor_id: term.vendor_id, lead_time_days: lead, booking_time_days: term.booking_days, moq_qty_base: term.moq_base,
        order_multiple_qty_base: term.multiple_base, delivery_lot_qty_base: term.lot_base,
        unit_cost: unitCost === null ? null : Math.round(unitCost * 10000) / 10000, cycle_days: cycle,
        freight_term: freightTerm, cost_missing: missing,
        credit_days: term.advance ? 0 : term.credit_days ?? null,
      };
    });
    if (options.length) vendorOptions.set(id, options);
    const best = options.map((o) => o.cycle_days).filter((d): d is number => d !== null);
    cycleDays.set(id, best.length ? Math.min(...best) : DEFAULT_CYCLE_DAYS);
    cycleBasis.set(id, best.length ? "ECONOMIC" : "DEFAULT");
  }
  // Opening stock, arrivals, policies and vendor options; the lots themselves come from the
  // family planner (owner 2026-10-22: right item, right time, right lot — own use vs group use).
  const assembly = assemblePlanningInput({ ...baseArgs, vendorOptions, cycleDays });
  const openingReceipts = await cachedLoad(
    `${p.companyId}|shelfLifeReceipts|${calendar.asOf}|${hashIds(Object.keys(assembly.input.opening_qty_by_material))}`,
    () => loadOpeningReceiptAdvice(p.companyId, calendar.asOf, assembly.input.opening_qty_by_material, req.materials),
    reuse,
  );
  const vendorOverride = new Map<string, string>();
  const ownDemand: FamilyOwnDemand[] = [];
  const groupDemand: FamilyGroupDemand[] = [];
  for (const r of req.output.records) {
    if (r.day < assembly.input.as_of || r.day > assembly.input.horizon_end || !(r.qty > 0)) continue;
    if (r.group_id && r.candidates.length > 1) groupDemand.push({ group_id: r.group_id, candidates: r.candidates, required_by: r.day, qty_base: r.qty });
    else if (r.candidates[0]) ownDemand.push({ material_id: r.candidates[0], required_by: r.day, qty_base: r.qty });
  }
  // Owner 2026-10-27: a transfer-fed material (stock lives in the transfer-source store) gets no MTS supply from
  // its CSN / PO: they land in that store. The waterfall asks only for what it needs; the Store transfers it.
  const transferFed = new Set(req.output.rows.filter((r) => r.kind === "RM" && isTransferFed(r.stock)).map((r) => r.material_id));
  const transferIncoming = new Map<string, { qty: number; label: string }>();
  for (const arrival of assembly.input.confirmed_arrivals) {
    if (!transferFed.has(arrival.material_id)) continue;
    const seen = transferIncoming.get(arrival.material_id);
    const when = arrival.eta_to_plant ?? "no ETA";
    transferIncoming.set(arrival.material_id, { qty: (seen?.qty ?? 0) + arrival.qty_base, label: seen ? `${seen.label}, ${when}` : `ETA ${when}` });
  }
  const familyArrivalCandidates = assembly.input.confirmed_arrivals.filter((arrival) => !transferFed.has(arrival.material_id));
  const familyInput: FamilyPlannerInput = {
    as_of: assembly.input.as_of,
    horizon_end: assembly.input.horizon_end,
    opening_qty_by_material: assembly.input.opening_qty_by_material,
    opening_receipts: openingReceipts,
    own_demand: ownDemand,
    group_demand: groupDemand,
    group_coverage_policies: groupCoveragePolicies,
    // Every open inbound piece participates: a valid future ETA on that date; a passed or
    // missing ETA on the CC date, flagged (owner 2026-10-26, same as the Requirement tab).
    confirmed_arrivals: familyArrivalCandidates.map((arrival) => ({
      source_key: arrival.source_key,
      material_id: arrival.material_id,
      eta_to_plant: familyArrivalEta(arrival.eta_to_plant, assembly.input.as_of),
      qty_base: arrival.qty_base,
    })),
    arrival_risks: familyArrivalCandidates
      .filter((arrival) => !isFamilyAllocatableArrival(arrival.lifecycle_kind, arrival.eta_to_plant, assembly.input.as_of))
      .map((arrival) => familyArrivalRisk(arrival, assembly.input.as_of)),
    policies: assembly.input.policies,
    manual_lots: p.manualLots ?? [],
    // The Store "keep" quantity is read at the end of each period (owner 2026-10-28).
    checkpoints: calendar.months.map((month) => monthEnd(month)),
    group_orders: req.input.groupOrders,
    selections: selections.map,
    // The month selector is shown for every active group member. Selection is
    // a hard authorization for a new engine lot, never a preference that the
    // solver may override for a lower price or shorter lead time.
    selection_controlled_members: new Set(
      [...req.masters.groupMembers.values()].flat()
        .filter((member) => member.active && req.materials.get(member.material_id)?.status !== "INACTIVE")
        .map((member) => member.material_id),
    ),
  };
  const plannerStarted = Date.now();
  const projection = planFamily(familyInput);
  const plannerMs = Date.now() - plannerStarted;
  const groupAssignments = (() => {
    type AssignmentReason = "SINGLE_SELECTED" | "CHEAPEST_SELECTED" | "NONE_SELECTED";
    const byKey = new Map<string, { group_id: string; month: string; assigned_material_id: string | null; reason: AssignmentReason; uncovered_qty: number }>();
    for (const b of projection.advisory_buys) {
      if (b.need_kind !== "GROUP" || !b.need_date || (b.status !== "ADVISORY" && b.status !== "ADVISORY_LATE")) continue;
      // A consolidated physical receipt can carry both an own/member guard and
      // group purposes.  Only real persisted group ids belong in the monthly
      // group-assignment table; OWN/MEMBER_GUARD are business-purpose labels.
      for (const groupId of b.covers.filter((cover) => cover !== "OWN" && cover !== "MEMBER_GUARD")) {
        const key = `${groupId}|${b.need_date.slice(0, 7)}|${b.material_id}`;
        const month = `${b.need_date.slice(0, 7)}-01`;
        const selected = selections.map.get(month) ?? new Set<string>();
        const seen = byKey.get(key) ?? {
          group_id: groupId, month, assigned_material_id: b.material_id,
          reason: selected.size > 1 ? "CHEAPEST_SELECTED" as const : "SINGLE_SELECTED" as const,
          uncovered_qty: 0,
        };
        seen.uncovered_qty += b.required_qty_base;
        byKey.set(key, seen);
      }
    }
    // No selected candidate means a group need stays visible as a shortfall;
    // it must not disappear merely because the planner correctly refused to
    // invent a purchase through an unchecked member.
    for (const unmet of projection.group_unmet) {
      const month = `${unmet.day.slice(0, 7)}-01`;
      const key = `${unmet.group_id}|${month}|`;
      const seen = byKey.get(key) ?? {
        group_id: unmet.group_id, month, assigned_material_id: null, reason: "NONE_SELECTED" as const, uncovered_qty: 0,
      };
      seen.uncovered_qty += unmet.qty_base;
      byKey.set(key, seen);
    }
    return [...byKey.values()].sort((a, b) => a.month.localeCompare(b.month) || a.group_id.localeCompare(b.group_id));
  })();
  // Family-scoped planner input (item's whole family: members + their groups), for the arrival optimizer.
  const familyInputFor = (materialId: string): FamilyPlannerInput => {
    const family = familyClosure(materialId, req.masters.groupMembers);
    const groups = new Set(family.group_ids);
    const members = new Set([materialId, ...family.member_ids]);
    const groupDemand = familyInput.group_demand.filter((g) => groups.has(g.group_id));
    for (const g of groupDemand) for (const c of g.candidates) members.add(c);
    const pick = <T>(rec: Readonly<Record<string, T>>) => Object.fromEntries(Object.entries(rec).filter(([id]) => members.has(id)));
    return {
      ...familyInput,
      opening_qty_by_material: pick(familyInput.opening_qty_by_material),
      opening_receipts: (familyInput.opening_receipts ?? []).filter((r) => members.has(r.material_id)),
      own_demand: familyInput.own_demand.filter((d) => members.has(d.material_id)),
      group_demand: groupDemand,
      confirmed_arrivals: familyInput.confirmed_arrivals.filter((a) => members.has(a.material_id)),
      arrival_risks: (familyInput.arrival_risks ?? []).filter((a) => members.has(a.material_id)),
      policies: familyInput.policies.filter((pol) => members.has(pol.material_id)),
      manual_lots: (familyInput.manual_lots ?? []).filter((l) => members.has(l.material_id)),
    };
  };

  // Store receives a period total, never a day-by-day issue list. Its material
  // ratio is nevertheless calculated from the canonical event-day group bucket
  // draws, so an ETA, policy date or expired lot changes the next applicable
  // period automatically without a second allocation formula here.
  const storeRowsByRatio = (() => {
    const range = (period: string) => (period === "CM" ? [calendar.asOf, calendar.cmEnd] : [calendar.nmStart, calendar.nmEnd]);
    const shareCache = new Map<string, ReturnType<typeof storeGroupPeriodShares>>();
    const shareOf = (groupId: string, period: string) => {
      const key = `${groupId}|${period}`;
      if (shareCache.has(key)) return shareCache.get(key)!;
      const [from, to] = range(period);
      const value = storeGroupPeriodShares({ group_id: groupId, from, to, group_mix: projection.group_mix, group_unmet: projection.group_unmet });
      shareCache.set(key, value);
      return value;
    };
    const out: typeof req.output.store_rows = [];
    const done = new Set<string>();
    for (const row of req.output.store_rows) {
      const share = row.line_type === "GROUP" && row.group_id ? shareOf(row.group_id, row.period) : null;
      if (!share) { out.push(row); continue; }
      const lineKey = `${row.pool_key}|${row.period}`;
      if (done.has(lineKey)) continue;
      done.add(lineKey);
      const r6 = (q: number) => Math.round(q * 1e6) / 1e6;
      for (const [id, f] of [...share.shares].sort(([a], [b]) => a.localeCompare(b))) {
        if (f * row.demand_qty > 1e-6) out.push({ ...row, material_id: id, executable_qty: r6(row.demand_qty * f), not_backed_qty: 0 });
      }
      if (share.unmet_share * row.demand_qty > 1e-6) out.push({ ...row, material_id: null, executable_qty: 0, not_backed_qty: r6(row.demand_qty * share.unmet_share) });
    }
    return out;
  })();
  // Store does not need a physical issue ledger to receive a useful instruction.
  // Split only the already-backed quantity over the virtual receipt sources in
  // FEFO order.  This never changes stock, a GRN balance, or the user's saved
  // group sequence; it merely makes the planner's recommendation auditable.
  const storeRowsByShelfLife = (() => {
    const remaining = new Map<string, FamilyOpeningReceipt[]>();
    for (const receipt of openingReceipts) {
      // The family projection has already removed it.  Store must never be
      // instructed to issue an expired planning receipt merely because the
      // aggregate counted-stock reader still contains the quantity.
      if (receipt.valid_until < calendar.asOf && receipt.no_expiry !== true) continue;
      remaining.set(receipt.material_id, [...(remaining.get(receipt.material_id) ?? []), { ...receipt }]);
    }
    for (const rows of remaining.values()) rows.sort((a, b) => a.valid_until.localeCompare(b.valid_until) || a.reference.localeCompare(b.reference));
    const periodRank = (period: string) => period === "CM" ? 0 : 1;
    const ordered = [...storeRowsByRatio].sort((a, b) => periodRank(a.period) - periodRank(b.period) || a.pool_key.localeCompare(b.pool_key) || String(a.material_id ?? "").localeCompare(String(b.material_id ?? "")));
    const out: Array<(typeof storeRowsByRatio)[number] & { receipt_reference: string | null; receipt_valid_until: string | null; receipt_expiry_priority: boolean; receipt_basis: "OPENING_STOCK" | "GRN" | "UNATTRIBUTED" | "UNAVAILABLE" | null }> = [];
    for (const row of ordered) {
      if (!row.material_id || row.executable_qty <= 0.000001) {
        out.push({ ...row, receipt_reference: null, receipt_valid_until: null, receipt_expiry_priority: false, receipt_basis: null });
        continue;
      }
      let qtyLeft = row.executable_qty;
      for (const receipt of remaining.get(row.material_id) ?? []) {
        if (qtyLeft <= 0.000001) break;
        const qty = Math.min(qtyLeft, receipt.qty_base);
        if (qty <= 0.000001) continue;
        receipt.qty_base -= qty;
        qtyLeft -= qty;
        out.push({
          ...row,
          executable_qty: Math.round(qty * 1e6) / 1e6,
          receipt_reference: receipt.reference,
          receipt_valid_until: receipt.valid_until,
          receipt_expiry_priority: receipt.expiry_priority,
          receipt_basis: receipt.reference.startsWith("Opening stock") ? "OPENING_STOCK" : receipt.reference.startsWith("GRN ") ? "GRN" : "UNATTRIBUTED",
        });
      }
      // Never issue a source that is expired or missing.  Keep the shortfall
      // explicit instead of inventing a GRN identity or pretending this is
      // executable physical stock.
      if (qtyLeft > 0.000001) out.push({ ...row, executable_qty: 0, not_backed_qty: Math.round((row.not_backed_qty + qtyLeft) * 1e6) / 1e6, receipt_reference: "Unavailable — expired or source not attributable", receipt_valid_until: null, receipt_expiry_priority: false, receipt_basis: "UNAVAILABLE" });
    }
    return out;
  })();
  const movableSourceKeys = new Set(req.output.rows.flatMap((r) => r.inbound_events.map((event, index) => (event.reschedule_key ? `A|${r.material_id}|${index}|${event.reference}` : null)).filter((k): k is string => k !== null)));
  // Owner 2026-10-29: each not-yet-shipped order is first judged alone (every other order as planned). Moving them all at once can leave a level below Critical,
  // so the family's orders are then moved together to their advised dates and the latest-moving order is pulled back to its current date until no extra
  // level-day falls below Critical: the advised dates shown are jointly safe.
  type JointFamily = { moves: Map<string, string>; together: ReturnType<typeof optimizeFamilyTogether>; alone: Map<string, ReturnType<typeof optimizeFamilyArrival>> };
  const jointCache = new Map<string, JointFamily>();
  const jointFor = (input: FamilyPlannerInput, movable: ReadonlyArray<{ source_key: string; eta_to_plant: string | null }>): JointFamily => {
    const cacheKey = movable.map((a) => a.source_key).join("§");
    const hit = jointCache.get(cacheKey);
    if (hit) return hit;
    const alone = new Map(movable.map((a) => [a.source_key, optimizeFamilyArrival(input, a.source_key)] as const));
    const currentOf = new Map(movable.map((a) => [a.source_key, String(a.eta_to_plant)] as const));
    const moves = new Map<string, string>();
    for (const a of movable) {
      const alt = alone.get(a.source_key);
      if (alt) moves.set(a.source_key, alt.not_needed_in_plan ? (alt.plan_end ?? alt.best.eta) : alt.best.eta);
    }
    let together = optimizeFamilyTogether(input, moves);
    const dayDiff = (x: string, y: string) => Math.round((Date.parse(`${x}T00:00:00Z`) - Date.parse(`${y}T00:00:00Z`)) / 86_400_000);
    for (let guard = 0; guard < movable.length && movable.length > 1 && together.below_min_days_moved > together.below_min_days_now; guard += 1) {
      const latest = [...moves.entries()].map(([k, d]) => ({ k, shift: dayDiff(d, currentOf.get(k)!) })).filter((x) => x.shift > 0).sort((x, y) => y.shift - x.shift)[0];
      if (!latest) break;
      moves.set(latest.k, currentOf.get(latest.k)!);
      together = optimizeFamilyTogether(input, moves);
    }
    const result = { moves, together, alone };
    jointCache.set(cacheKey, result);
    return result;
  };
  const arrivalScope = p.arrivalFamilyOf ? new Set(Object.keys(familyInputFor(p.arrivalFamilyOf).opening_qty_by_material)) : null;
  // Owner 2026-10-28 (D9): a proposed move is only advice if the vendor can still move the shipment (ETD window).
  const rescheduleContext = await loadRescheduleContext(p.companyId, req.output.rows
    .filter((row) => !arrivalScope || arrivalScope.has(row.material_id))
    .flatMap((row) => row.inbound_events.filter((event) => event.reschedule_key)));
  const nameOf = (id: string | null) => (id ? text(req.materialRows.get(id)?.material_name) || "—" : "—");
  const codeOf = (id: string | null) => (id ? text(req.materialRows.get(id)?.pace_code) || null : null);
  // `group_assignments` comes from the family planner and can include a group
  // which has no requirement-row entry.  Include it here so the PO22 selector
  // receives both its label and every active, mapped candidate member.
  const groupIds = unique([
    ...req.output.groups.map((g) => g.group_id),
    ...req.output.store_rows.map((r) => r.group_id),
    ...groupAssignments.map((a) => a.group_id),
  ]);
  const groupRows = groupIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_category_group").select("id, group_code, group_name").in("id", chunk));
  const groupLabel = new Map(groupRows.map((g) => [text(g.id), [text(g.group_code), text(g.group_name)].filter(Boolean).join(" — ")]));
  const selectionGroups = groupIds.map((groupId) => {
    // The requirement output is intentionally sparse.  The selector must use
    // the authoritative group map instead, otherwise a valid group shortage
    // appears as a heading with no selectable material rows.
    const memberById = new Map<string, { material_id: string; material_name: string; material_code: string | null }>();
    for (const member of req.masters.groupMembers.get(groupId) ?? []) {
      if (!member.active || req.materials.get(member.material_id)?.status === "INACTIVE") continue;
      memberById.set(member.material_id, {
        material_id: member.material_id,
        material_name: nameOf(member.material_id),
        material_code: codeOf(member.material_id),
      });
    }
    return {
      group_id: groupId,
      group_label: groupLabel.get(groupId) ?? "—",
      members: [...memberById.values()].sort((a, b) =>
        `${a.material_code ?? ""} ${a.material_name}`.localeCompare(`${b.material_code ?? ""} ${b.material_name}`)),
    };
  });
  const strokeLabel = (id: string) => {
    const stroke = req.masters.strokes.get(id);
    return stroke ? `${nameOf(stroke.prodshade_material_id)} · Stroke ${stroke.stroke_number}` : "—";
  };
  const uom = (id: string | null) => (id ? text(req.materialRows.get(id)?.base_uom_code) || null : null);
  const documentName = (id: string | null) => (id ? text(req.materialRows.get(id)?.document_name) || null : null);
  // Store schedule (owner 2026-10-19): product parent/child group, transfer instruction.
  const [productGroups, locationLabels] = await Promise.all([
    loadProdshadeGroups(p.companyId),
    loadLocationLabels(unique(req.output.rows.flatMap((r) => [...r.stock.required_locations, ...r.stock.other_locations, ...r.pools.map((pool) => pool.storage_location_id ?? "")]).filter(Boolean))),
  ]);
  const notBacked = new Map<string, number>();
  const groupShort = new Map<string, number>();
  for (const row of req.output.store_rows) {
    if (row.material_id !== null) notBacked.set(row.material_id, (notBacked.get(row.material_id) ?? 0) + row.not_backed_qty);
    else if (row.group_id) groupShort.set(row.group_id, (groupShort.get(row.group_id) ?? 0) + row.not_backed_qty);
  }
  // A group remainder is backed by its members' transfer-source stock, largest first, never twice.
  const rowById = new Map(req.output.rows.map((r) => [r.material_id, r]));
  const transferLeft = new Map(req.output.rows.map((r) => [r.material_id, Math.max(0, r.stock.other_sloc_unrestricted - (notBacked.get(r.material_id) ?? 0))]));
  const groupTransferNeed = new Map<string, number>(); // material → qty to transfer for groups
  // DEPENDENT: each group consumes the transfer stock the previous groups left.
  for (const [groupId, short] of [...groupShort].sort(([a], [b]) => a.localeCompare(b))) {
    let remaining = short;
    const members = (req.output.groups.find((g) => g.group_id === groupId)?.member_ids ?? []).slice().sort((a, b) => (transferLeft.get(b) ?? 0) - (transferLeft.get(a) ?? 0) || a.localeCompare(b));
    for (const member of members) {
      if (remaining <= 0.000001) break;
      const take = Math.min(remaining, transferLeft.get(member) ?? 0);
      if (take <= 0.000001) continue;
      transferLeft.set(member, (transferLeft.get(member) ?? 0) - take);
      groupTransferNeed.set(member, (groupTransferNeed.get(member) ?? 0) + take);
      remaining -= take;
    }
  }
  const transferHint = storeTransferHints(req.output.rows, notBacked, (id) => locationLabels.get(id) ?? "—", uom, transferIncoming);
  const groupHint = storeTransferHints([...groupTransferNeed.keys()].map((id) => rowById.get(id)!).filter(Boolean), groupTransferNeed, (id) => locationLabels.get(id) ?? "—", uom);
  const prodshadesOf = (row: { kind: string; prodshade_ids: string[]; sku_ids: string[] }) =>
    unique(row.kind === "PM" ? row.sku_ids.map((sku) => req.masters.skus.get(sku)?.prodshade_material_id ?? "").filter(Boolean) : row.prodshade_ids);
  const eventRef = new Map<string, string>();
  for (const row of req.output.rows) row.inbound_events.forEach((event, index) => eventRef.set(`A|${row.material_id}|${index}|${event.reference}`, event.reference));

  // Owner 2026-10-28 — Store instructions cover GROUP items only; a member that also has an exclusive use is part of its group.
  const groupMemberIds = new Set(req.output.groups.flatMap((g) => g.member_ids));
  // Owner 2026-10-28 — the Store plan for the WHOLE horizon, month by month, from the waterfall: use (split by where the stock comes from — only
  // ACTUAL stock may be issued), what to keep at each period end, the excess left. Group items only.
  const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const storePeriods: StorePlanPeriod[] = calendar.months.map((month, index) => {
    const from = index === 0 ? calendar.asOf : month;
    return { key: month.slice(0, 7), label: index === 0 ? `${monthLabel(month)} (from ${Number(calendar.asOf.slice(8))})` : monthLabel(month), from, to: monthEnd(month), order: index };
  });
  const prodshadeOfRecord = (r: { kind: string; prodshade_material_id: string; sku_material_id: string | null }) =>
    (r.kind === "PM" && r.sku_material_id ? req.masters.skus.get(r.sku_material_id)?.prodshade_material_id ?? "" : r.prodshade_material_id);
  const storePlan = buildStorePlan({
    periods: storePeriods,
    draws: projection.allocation_rows.map((d) => ({ day: d.day, material_id: d.material_id, destination_kind: d.destination_kind, group_id: d.group_id, qty_base: d.qty_base, source_kind: d.source_kind, source_reference: d.source_reference })),
    assumedSources: new Set(projection.arrival_flags.filter((f) => f.reason === "ETA_PASSED" || f.reason === "ETA_MISSING").map((f) => f.source_key)),
    groupUnmet: projection.group_unmet,
    records: req.output.records.map((r): StorePlanRecord => ({ day: r.day, candidates: r.candidates, group_id: r.group_id, storage_location_id: r.storage_location_id, qty: r.qty, prodshade_material_id: prodshadeOfRecord(r), sku_material_id: r.sku_material_id, kind: r.kind })),
    matrix: projection.level_matrix,
    maxDays: new Map(projection.level_policies.map((l) => [`${l.level_kind}|${l.level_id}`, l.desired_days])),
    openingByMaterial: assembly.input.opening_qty_by_material,
    groupMemberIds,
    productGroupOf: (r) => {
      const group = productGroups.get(prodshadeOfRecord(r));
      return { mother: group?.mother ?? "", child: group?.child ?? "" };
    },
  });
  // Store transfers: R003 (transfer-source store) -> R001 / R002 and R001 <-> R002, how much and by when — only for stock that is really there.
  const storeTransfers = await (async () => {
    const needs = storePlan.needs.flatMap((n) => {
      const store = rStoreKey(locationLabels.get(n.location_id) ?? "");
      return store ? [{ material_id: n.material_id, period: n.period, store, qty: n.qty }] : [];
    });
    if (needs.length === 0) return [];
    const materialIds = unique(needs.map((n) => n.material_id));
    const stockRows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_snapshot")
      .select("material_id, storage_location_id, quantity").eq("company_id", p.companyId).eq("stock_type_code", "UNRESTRICTED").in("material_id", chunk));
    const stockLabels = await loadLocationLabels(unique(stockRows.map((r) => text(r.storage_location_id))));
    const storeOfLocation = (id: string) => rStoreKey(stockLabels.get(id) ?? locationLabels.get(id) ?? "");
    const sourceStores = new Set<string>();
    for (const [locationId, role] of req.locationRoles ?? []) {
      const store = role === "TRANSFER_SOURCE" ? storeOfLocation(locationId) : null;
      if (store) sourceStores.add(store);
    }
    const stocks = stockRows.flatMap((r) => {
      const store = storeOfLocation(text(r.storage_location_id));
      return store ? [{ material_id: text(r.material_id), store, qty: Number(r.quantity ?? 0) }] : [];
    });
    const labelOf = new Map(storePeriods.map((period) => [period.key, period.label]));
    return scheduleStoreTransfers({ needs, stocks, sourceStores, periods: storePeriods.map((period) => ({ period: period.key, start: period.from })) })
      .map((t2) => ({ ...t2, material_name: nameOf(t2.material_id), material_code: codeOf(t2.material_id), uom: uom(t2.material_id), period_label: labelOf.get(t2.period) ?? t2.period }));
  })();
  // Owner 2026-10-28 — Store instructions are only for GROUP items (a group's member that also has an exclusive use is included).
  // For each item and period: where the period runs, and how much must be KEPT at its end (the level's reserve, up to its Max days).
  const maxDaysOf = new Map(projection.level_policies.map((l) => [`${l.level_kind}|${l.level_id}`, l.desired_days]));
  const keepAt = (period: string, materialId: string | null, groupId: string | null) => {
    if (!materialId) return { qty: null as number | null, days: null as number | null };
    const day = period === "CM" ? calendar.cmEnd : calendar.nmEnd;
    const snapshot = [...projection.level_matrix].reverse().find((snap) => snap.day <= day);
    if (!snapshot) return { qty: null, days: null };
    const level = groupId
      ? snapshot.levels.find((l) => l.level_kind === "GROUP" && l.level_id === groupId)
      : snapshot.levels.find((l) => l.level_kind === "OWN" && l.level_id === materialId);
    return { qty: level ? Math.round((level.by_material[materialId] ?? 0) * 1000) / 1000 : 0, days: maxDaysOf.get(`${groupId ? "GROUP" : "OWN"}|${groupId ?? materialId}`) ?? null };
  };
  const activeMaterials = new Set(projection.rows.filter((r) => r.demand_qty_base > 0 || r.confirmed_arrival_qty_base > 0 || r.planned_lot_qty_base > 0).map((r) => r.material_id));
  const payload = {
    company_id: p.companyId,
    calendar: { as_of: calendar.asOf, cm_start: calendar.cmStart, cm_end: calendar.cmEnd, nm_start: calendar.nmStart, nm_end: calendar.nmEnd, horizon_end: calendar.horizonEnd },
    demand_version: { demand_at: p.demandAt, label: p.demandAt ? `Plan as at ${p.demandAt}` : "Current effective plan" },
    source_fingerprint: req.fingerprint,
    calculated_at: new Date().toISOString(),
    selections_available: selections.available,
    cost_basis: {
      interest_pct: costInputs.interestPct,
      customer_credit_days: costInputs.customerCreditDays,
      fx: Object.fromEntries([...costInputs.fxByCurrency].map(([code, fx]) => [code, fx])),
    },
    location_policy: req.locationRoles ? "COMPANY_POLICY" : "LEGACY_REQUIRED_LOCATION",
    // Only materials with any use, arrival or proposed lot in CM + NM (keeps the payload small).
    daily: projection.rows.filter((row) => activeMaterials.has(row.material_id)).map((row) => ({ ...row, material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id) })),
    risks: projection.risks.map((risk) => ({ ...risk, material_name: nameOf(risk.material_id), material_code: codeOf(risk.material_id) })),
    buys: projection.advisory_buys.map((buy) => {
      // P2: the lot's own vendor when the engine chose one per lot.
      const lotVendor = buy.vendor_id ? (vendorTerms.get(buy.material_id) ?? []).find((t) => t.vendor_id === buy.vendor_id) ?? null : null;
      const vendor = lotVendor ?? assembly.chosen_vendor.get(buy.material_id) ?? null;
      const cheapestLabel = buy.cheapest_vendor_id ? (vendorTerms.get(buy.material_id) ?? []).find((t) => t.vendor_id === buy.cheapest_vendor_id)?.vendor_label ?? null : null;
      return {
        ...buy, material_name: nameOf(buy.material_id), material_code: codeOf(buy.material_id), uom: uom(buy.material_id),
        order_unit: orderUnitFor(buy.material_id, vendor?.vendor_id),
        vendor_label: vendor?.vendor_label ?? null, vendor_moq_base: vendor?.moq_base ?? null, vendor_multiple_base: vendor?.multiple_base ?? null,
        vendor_lot_base: vendor?.lot_base ?? null, booking_time_days: vendor?.booking_days ?? null, route_lead_time_days: vendor?.route_days ?? null,
        vendor_basis: lotVendor ? (buy.bridge ? "BRIDGE" : "CHEAPEST_IN_TIME") : vendorOverride.has(buy.material_id) ? "LOWEST_TOTAL_COST" : vendor ? "FASTEST_FEASIBLE" : null,
        cheapest_vendor_label: cheapestLabel,
        // Owner 2026-10-21: what the chosen vendor's comparable cost includes / misses.
        ...(() => {
          const option = buy.vendor_id ? (vendorOptions.get(buy.material_id) ?? []).find((o) => o.vendor_id === buy.vendor_id) : undefined;
          return option ? { vendor_unit_total_cost: option.unit_cost, vendor_freight_term: option.freight_term ?? null, vendor_cost_missing: option.cost_missing ?? [] } : {};
        })(),
        max_days_basis: cycleBasis.get(buy.material_id) ?? null,
        cost_options: buy.status === "ADVISORY" || buy.status === "ADVISORY_LATE"
          ? costOptionsFor(buy, vendorTerms.get(buy.material_id) ?? [], costInputs, calendar.asOf, dailyUseOf(buy.material_id, projection.rows.map((r) => ({ material_id: r.material_id, qty_base: r.demand_qty_base }))), carryingOf(buy.material_id))
          : [],
      };
    }),
    // P3 (owner 2026-10-20): engine advice per material — best order cycle, Max days, best lot
    // where the vendor has no fixed MOQ. Shown next to the user's values in Material Settings.
    material_advice: req.output.rows.filter((r) => r.kind === "RM" || r.kind === "PM").map((r) => {
      const use = rowDailyUse(r.material_id);
      const cycle = cycleDays.get(r.material_id) ?? null;
      const target = r.policy?.target_cov_days ?? null;
      const options = vendorOptions.get(r.material_id) ?? [];
      const vendorMoq = options.some((o) => o.moq_qty_base !== null);
      const bestLot = cycle !== null && use > 0 ? Math.ceil(use * cycle) : null;
      return {
        material_id: r.material_id, daily_use: Math.round(use * 1000) / 1000, cycle_days: cycle,
        cycle_basis: cycleBasis.get(r.material_id) ?? null, max_days: target !== null && cycle !== null ? target + cycle : null,
        vendor_moq_fixed: vendorMoq, best_lot_qty: vendorMoq ? null : bestLot,
        reason: cycleBasis.get(r.material_id) === "ECONOMIC"
          ? `Best order cycle ${cycle} d: order cost (AC01 landed per GRN) balanced against money tied up (price × interest).`
          : `No order-cost / price / interest data yet — default ${cycle} d cycle.`,
      };
    }),
    groups: req.output.groups.map((g) => ({
      group_id: g.group_id, group_label: groupLabel.get(g.group_id) ?? "—", kind: g.kind,
      members: g.member_ids.map((id) => ({ material_id: id, material_name: nameOf(id), material_code: codeOf(id) })),
    })),
    // PO22's monthly purchasing choice must be able to show every candidate
    // for every group that has a new-buy recommendation, not just sparse rows.
    selection_groups: selectionGroups,
    group_risks: projection.group_pool_risks.map((g) => ({ ...g, group_label: g.group_id ? groupLabel.get(g.group_id) ?? "—" : "—" })),
    group_actions: projection.group_actions.map((action) => ({
      group_label: groupLabel.get(action.group_id) ?? "—",
      first_below_target_day: action.first_below_target_day,
      first_below_critical_day: action.first_below_critical_day,
      first_shortage_day: action.first_shortage_day,
      unresolved_qty_base: action.unresolved_qty_base,
      ordered_actions: action.ordered_actions,
    })),
    group_assignments: groupAssignments.map((a) => ({ ...a, group_label: groupLabel.get(a.group_id) ?? "—", assigned_material_name: a.assigned_material_id ? nameOf(a.assigned_material_id) : null })),
    // Server-owned waterfall evidence.  Keep UUIDs inside the engine only: this
    // endpoint returns business labels so grids and Excel never need a lookup.
    allocation_rows: projection.allocation_rows.map((row) => ({
      day: row.day,
      material_name: nameOf(row.material_id),
      material_code: codeOf(row.material_id),
      uom: uom(row.material_id),
      destination: row.destination_kind === "OWN" ? "Own required use" : groupLabel.get(row.group_id ?? "") ?? "—",
      flow: row.destination_kind === "OWN" ? "Exclusive / direct use" : "Group allocation",
      qty: row.qty_base,
      closing: row.closing_qty_base,
      source_reference: row.source_reference,
      source_kind: row.source_kind === "OPENING" ? "Counted opening stock"
        : row.source_kind === "CONFIRMED_ETA" ? "Confirmed ETA receipt"
        : row.source_kind === "MANUAL_LOT" ? "Your fixed planning lot"
        : "Engine planning lot",
      rule: row.rule === "DIRECT_EXCLUSIVE_RESERVE"
        ? "Hard direct/exclusive protection applies first through this member's Desired Max; only genuine free stock may move to a group."
        : "Waterfall use: direct Desired-Max protection applies first; each group carries its own reserve until Target, then uses only genuine free stock. Within it FEFO, saved sequence, no-future-buy run-down, then normal rotation apply.",
    })),
    group_bucket_reservations: projection.group_bucket_reservations.map((row) => ({
      day: row.day, group_label: groupLabel.get(row.group_id) ?? "—",
      material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id),
      reserved_qty: row.reserved_qty_base, rule: row.rule,
    })),
    allocation_reconciliation: projection.allocation_reconciliation.map((row) => ({
      material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id),
      opening_qty: row.opening_qty_base, confirmed_arrival_qty: row.confirmed_arrival_qty_base, planned_lot_qty: row.planned_lot_qty_base,
      own_allocated_qty: row.own_allocated_qty_base, group_allocated_qty: row.group_allocated_qty_base,
      expired_qty: row.expired_qty_base, closing_qty: row.closing_qty_base, variance_qty: row.variance_qty_base,
    })),
    // W3b's next-coverage reservation ledger is deliberately separate from
    // daily Store consumption. It makes the final real carry's waterfall
    // purpose reviewable without fabricating future demand or exposing UUIDs.
    waterfall_reservations: projection.waterfall_reservations.map((row) => ({
      material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id),
      group_label: row.group_id ? groupLabel.get(row.group_id) ?? "—" : null,
      qty: row.qty_base, available_after_qty: row.available_after_qty_base, stage: row.stage, rule: row.rule,
    })),
    // Owner 2026-10-28: what is already ordered / on the way, per material, so the Action list can say
    // "already on order" next to a buy (the planner counts these pieces; this only makes it visible).
    on_order: req.output.rows
      .filter((row) => !arrivalScope || arrivalScope.has(row.material_id))
      .filter((row) => row.inbound_events.some((event) => event.kind !== "POSTED_GR"))
      .map((row) => ({
        material_id: row.material_id,
        pieces: row.inbound_events.filter((event) => event.kind !== "POSTED_GR")
          .map((event) => ({ reference: event.reference, qty: event.qty, eta: event.date, kind: event.kind })),
      })),
    // Owner 2026-10-21: not-yet-shipped CSN / PO pieces the planner may move earlier / later
    // (planning side only; CSN Tracker is never changed).
    reschedulable_arrivals: req.output.rows.filter((row) => !arrivalScope || arrivalScope.has(row.material_id)).flatMap((row) => {
      const pieces = row.inbound_events.filter((event) => event.reschedule_key);
      if (pieces.length === 0) return [];
      // Owner 2026-10-22: best plant date per piece, judged on the whole family (not the item alone).
      const input = familyInputFor(row.material_id);
      // Owner 2026-10-29: the family's not-yet-shipped pieces, in landing order, for the "if the other order does not come" dates.
      const movableInFamily = input.confirmed_arrivals.filter((a) => movableSourceKeys.has(a.source_key))
        .sort((a, b) => String(a.eta_to_plant).localeCompare(String(b.eta_to_plant)) || a.source_key.localeCompare(b.source_key));
      const refOfKey = (key: string) => key.split("|").slice(3).join("|");
      const keyOf = new Map(row.inbound_events.map((event, index) => [event, `A|${row.material_id}|${index}|${event.reference}`]));
      const optimum = new Map(pieces.map((event) => [event.reschedule_key as string, optimizeFamilyArrival(input, keyOf.get(event)!)]));
      return pieces.map((event) => {
        const facts = rescheduleContext.factsOf(event);
        const bestAlone = optimum.get(event.reschedule_key as string) ?? null;
        const ownKeyJ = keyOf.get(event)!;
        const jointFam = movableInFamily.length > 1 ? jointFor(input, movableInFamily) : null;
        const currentEtaJ = event.original_date !== undefined ? event.original_date : event.date;
        let jointNote: string | null = null;
        let best = bestAlone;
        if (bestAlone && jointFam && currentEtaJ) {
          const jointEta = jointFam.moves.get(ownKeyJ);
          const aloneEta = bestAlone.not_needed_in_plan ? null : bestAlone.best.eta;
          if (jointEta && ((bestAlone.not_needed_in_plan && jointEta === currentEtaJ) || (!bestAlone.not_needed_in_plan && jointEta !== aloneEta))) {
            const shiftJ = Math.round((Date.parse(`${jointEta}T00:00:00Z`) - Date.parse(`${currentEtaJ}T00:00:00Z`)) / 86_400_000);
            jointNote = bestAlone.not_needed_in_plan
              ? "Alone this order is not needed inside the plan, but together with the other not-yet-shipped orders at their advised dates a level would fall below its Min, so keep the current date."
              : `Alone it could wait until ${aloneEta}; together with the other not-yet-shipped orders a level would fall below its Min, so the safe date is ${jointEta}.`;
            best = { ...bestAlone, not_needed_in_plan: false, plan_cover: null, shift_days: shiftJ, best: { ...bestAlone.best, eta: jointEta }, reason: jointNote };
          }
        }
        // Route time only (Booking Time excluded) of the piece's own vendor and route; the largest if several ports.
        const routeDays = (row.lead_time?.configured_routes ?? [])
          .filter((r) => r.route === facts.route && (!facts.vendor_id || r.vendor_id === facts.vendor_id) && r.route_days !== undefined)
          .reduce<number | null>((max, r) => (max === null ? (r.route_days ?? null) : Math.max(max, r.route_days ?? 0)), null);
        const currentEta = event.original_date !== undefined ? event.original_date : event.date;
        // The vendor / route master may hold no route time (e.g. a local vendor on a high-sea-sale PO): then the piece's own ETD-to-plant span is the route time.
        const routeDaysEff = routeDays !== null ? routeDays
          : facts.etd && currentEta && /^\d{4}-\d{2}-\d{2}$/.test(String(facts.etd).slice(0, 10)) && /^\d{4}-\d{2}-\d{2}$/.test(String(currentEta))
            ? Math.round((Date.parse(`${currentEta}T00:00:00Z`) - Date.parse(`${String(facts.etd).slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null;
        // Import only: port-to-plant days of the piece's own route; the best plant date minus these is the date it must reach the port.
        const inlandDays = facts.route === "IMPORT"
          ? (row.lead_time?.configured_routes ?? [])
            .filter((r) => r.route === "IMPORT" && (!facts.vendor_id || r.vendor_id === facts.vendor_id) && r.inland_days !== undefined)
            .reduce<number | null>((max, r) => (max === null ? (r.inland_days ?? null) : Math.max(max, r.inland_days ?? 0)), null)
          : null;
        const bestPortEta = best && inlandDays !== null ? new Date(Date.parse(`${best.best.eta}T00:00:00Z`) - inlandDays * 86_400_000).toISOString().slice(0, 10) : null;
        const bestEtd = best && routeDaysEff !== null && routeDaysEff >= 0 ? new Date(Date.parse(`${best.best.eta}T00:00:00Z`) - routeDaysEff * 86_400_000).toISOString().slice(0, 10) : null;
        const ownKey = keyOf.get(event)!;
        const ifAbsent = best ? [...new Set([movableInFamily.filter((a) => a.source_key !== ownKey && String(a.eta_to_plant) < String(currentEta)).slice(-1)[0], movableInFamily.filter((a) => a.source_key !== ownKey && String(a.eta_to_plant) >= String(currentEta))[0]].filter(Boolean))].map((other) => {
          const alt = optimizeFamilyArrival({ ...input, confirmed_arrivals: input.confirmed_arrivals.filter((a) => a.source_key !== other!.source_key) }, ownKey);
          return {
            reference: refOfKey(other!.source_key), other_eta: String(other!.eta_to_plant),
            best_eta: alt && !alt.not_needed_in_plan ? alt.best.eta : null, shift_days: alt?.shift_days ?? 0, not_needed_in_plan: alt?.not_needed_in_plan ?? false,
            binding_day: alt?.binding?.day ?? null,
          };
        }) : [];
        const together = jointFam ? jointFam.together : null;
        // Owner 2026-10-30: against Target (Min): how many more days the level sits below its Min, and how low its cover goes, at the advised date.
        const critEta = best && !best.not_needed_in_plan ? best.critical_latest_eta : null;
        const moveCost = critEta && currentEta && critEta > best!.best.eta && critEta > currentEta
          ? familyMoveCost(input, ownKey, critEta, best!.binding ? { level_kind: best!.binding.level_kind, level_id: best!.binding.level_id } : null) : null;
        return {
          move_cost: moveCost,
          critical_latest_eta: critEta,
          if_absent: ifAbsent, together, joint_note: jointNote,
          best_port_eta: bestPortEta,
          best_etd: bestEtd,
          route: facts.route,
          binding: best?.binding ? { ...best.binding, level_label: best.binding.level_kind === "OWN" ? `Exclusive — ${nameOf(best.binding.level_id)}` : groupLabel.get(best.binding.level_id) ?? "Group" } : null,
          material_id: row.material_id, material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id),
          reference: event.reference, qty: event.qty, kind: event.kind, reschedule_key: event.reschedule_key as string, shared_note: event.shared_note ?? null,
          eta_plant: currentEta,
          rescheduled_eta: event.original_date !== undefined ? event.date : null,
          optimum: best,
          window: best && best.shift_days !== 0 && !best.not_needed_in_plan
            ? rescheduleVerdict({ today: p.today, route: facts.route, routeDays: routeDaysEff, currentEta, proposedEta: best.best.eta, currentEtd: facts.etd, windows: rescheduleContext.windows })
            : null,
        };
      });
    }).sort((x, y) => String(x.rescheduled_eta ?? x.eta_plant ?? "9999").localeCompare(String(y.rescheduled_eta ?? y.eta_plant ?? "9999")) || x.material_name.localeCompare(y.material_name)),
    arrival_flags: projection.arrival_flags.map((f) => ({ ...f, material_name: nameOf(f.material_id), document: eventRef.get(f.source_key) ?? f.source_key })),
    // Owner 2026-10-26: every quantity is shown in this unit (Order UoM); absent = base UoM.
    display_units: buildDisplayUnits(universe, req.materials, (id) => policyOrderUom.get(id), new Map(universe.map((id) => [id, (vendorTerms.get(id) ?? []).map((t) => t.supply_uom_code ?? "")]))),
    // Owner 2026-10-27: Bulk RM is out of PO22 for now; the Action tab drops these materials and groups.
    transfer_fed_material_ids: [...transferFed],
    bulk_material_ids: [...bulkMaterials],
    bulk_group_ids: bulkOnlyGroupIds(req.masters.groupMembers, bulkMaterials),
    store_transfers: storeTransfers,
    store_plan: {
      periods: storePeriods,
      rows: storePlan.rows.map((r) => ({
        ...r, material_name: r.material_id ? nameOf(r.material_id) : "Group — not assigned", material_code: codeOf(r.material_id), uom: uom(r.material_id),
        group_label: r.group_id ? groupLabel.get(r.group_id) ?? "—" : null,
      })),
      excess: storePlan.excess.map((e) => ({ ...e, material_name: nameOf(e.material_id), material_code: codeOf(e.material_id), uom: uom(e.material_id) })),
    },
    store_rows: storeRowsByShelfLife.map((row) => ({
      ...row,
      period_label: storePeriodLabel(row.period, calendar),
      period_from: row.period === "CM" ? calendar.asOf : calendar.nmStart,
      period_to: row.period === "CM" ? calendar.cmEnd : calendar.nmEnd,
      group_related: Boolean(row.group_id) || Boolean(row.material_id && groupMemberIds.has(row.material_id)),
      keep_qty: keepAt(row.period, row.material_id, row.group_id).qty,
      keep_max_days: keepAt(row.period, row.material_id, row.group_id).days,
      mother_group: unique(prodshadesOf(row).map((id) => productGroups.get(id)?.mother ?? "")).filter(Boolean).join("; ") || null,
      child_group: unique(prodshadesOf(row).map((id) => productGroups.get(id)?.child ?? "")).filter(Boolean).join("; ") || null,
      material_document_name: documentName(row.material_id),
      transfer_hint: row.material_id ? transferHint.get(row.material_id) ?? null
        : (req.output.groups.find((g) => g.group_id === row.group_id)?.member_ids ?? []).map((id) => groupHint.get(id) ? `${nameOf(id)}: ${groupHint.get(id)}` : "").filter(Boolean).join("; ") || null,
      product: row.kind === "PM" ? row.sku_ids.map(nameOf).join("; ") : row.prodshade_ids.map(nameOf).join("; "),
      source: row.kind === "PM" ? `Pack BOM (${row.sku_ids.map(nameOf).join("; ")})` : row.stroke_ids.map(strokeLabel).join("; "),
      group_label: row.group_id ? groupLabel.get(row.group_id) ?? "—" : null,
      material_name: row.material_id ? nameOf(row.material_id) : "Group — not assigned",
      material_code: codeOf(row.material_id),
      uom: uom(row.material_id),
      planned_consumption_reason: row.line_type === "FIXED" && row.group_id
        // A line that names a group but is FIXED has Use Primary = No: only the group's other members may supply it.
        ? `Use Primary = No for ${groupLabel.get(row.group_id) ?? "this group"}: only the group's other member(s) supply this line, the group's primary item is not used.`
        : row.line_type === "FIXED"
        ? "Direct/exclusive product requirement; protected before shared family allocation."
        : row.material_id
          ? `Family waterfall allocation for ${groupLabel.get(row.group_id ?? "") ?? "eligible group"}.`
          : `Family group shortage: no eligible member stock could be allocated for ${groupLabel.get(row.group_id ?? "") ?? "this group"}.`,
    })),
  };
  console.log(JSON.stringify({ event: "MTS_TIMING", step: "planning_done", reuse, planner_ms: plannerMs, total_ms: Date.now() - planningStarted }));
  // Internal pieces for the P1 item plan (never serialised by the Planning endpoint).
  const internal = { req, assembly, projection, calendar, vendorOptions, vendorTerms, orderUnitFor, familyInputFor, selections: selections.map };
  Object.defineProperty(payload, "_internal", { value: internal, enumerable: false });
  return payload as typeof payload & { readonly _internal: typeof internal };
}

/** PO21 product groups (mother → child → prodshade) of the company; read-only. */
async function loadProdshadeGroups(companyId: string): Promise<Map<string, { mother: string; child: string }>> {
  const [mothers, children, members] = await Promise.all([
    serviceRoleClient.schema("erp_planning").from("prodshade_mother_group").select("id, group_name").eq("company_id", companyId).eq("is_active", true),
    serviceRoleClient.schema("erp_planning").from("prodshade_child_group").select("id, group_name, mother_group_id").eq("company_id", companyId).eq("is_active", true),
    serviceRoleClient.schema("erp_planning").from("prodshade_group_member").select("prodshade_material_id, child_group_id").eq("company_id", companyId).eq("is_active", true),
  ]);
  const result = new Map<string, { mother: string; child: string }>();
  if (mothers.error || children.error || members.error) return result; // groups are labels only; never block planning
  const motherName = new Map(((mothers.data ?? []) as JsonRecord[]).map((m) => [text(m.id), text(m.group_name)]));
  const childById = new Map(((children.data ?? []) as JsonRecord[]).map((c) => [text(c.id), c]));
  for (const member of (members.data ?? []) as JsonRecord[]) {
    const child = childById.get(text(member.child_group_id));
    if (!child) continue;
    result.set(text(member.prodshade_material_id), { mother: motherName.get(text(child.mother_group_id)) ?? "", child: text(child.group_name) });
  }
  return result;
}

export async function getMtsPlanningHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(url, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    return okResponse(await computePlanning({ companyId, extraMonths: PLANNING_EXTRA_MONTHS, ...parsed.params! }), ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_PLANNING_FAILED", "Could not calculate the planning.");
  }
}

export async function saveMtsPlanningRunHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(body, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    // Never trust a client payload: the saved run is recalculated here.
    const result = await computePlanning({ companyId, extraMonths: PLANNING_EXTRA_MONTHS, ...parsed.params! });
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_planning_run").insert({
      company_id: companyId, plan_month: parsed.params!.planMonth, as_of: parsed.params!.asOf, demand_at: parsed.params!.demandAt,
      source_fingerprint: result.source_fingerprint, run_label: text(body.run_label).slice(0, 200) || null, result, created_by: ctx.auth_user_id,
    }).select("id, created_at").single();
    if (error) throw new Error("MTS_PLANNING_RUN_SAVE_FAILED");
    return okResponse({ run_id: data.id, created_at: data.created_at, source_fingerprint: result.source_fingerprint }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_PLANNING_RUN_SAVE_FAILED", "Could not save the planning run.");
  }
}

export async function listMtsPlanningRunsHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_planning_run")
      .select("id, plan_month, as_of, demand_at, source_fingerprint, run_label, created_by, created_at")
      .eq("company_id", companyId).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("MTS_PLANNING_RUN_LIST_FAILED");
    const rows = (data ?? []) as JsonRecord[];
    const users = await resolveUserDisplayNames(rows.map((r) => text(r.created_by)));
    return okResponse({ rows: rows.map(({ created_by, ...r }) => ({ ...r, created_by_name: users.get(text(created_by)) ?? "—" })) }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_PLANNING_RUN_LIST_FAILED", "Could not list planning runs.");
  }
}

export async function getMtsPlanningRunHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    const runId = text(url.searchParams.get("id"));
    if (!companyId || !runId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id and id are required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_planning_run")
      .select("id, plan_month, as_of, run_label, created_at, result").eq("company_id", companyId).eq("id", runId).maybeSingle();
    if (error) throw new Error("MTS_PLANNING_RUN_LOAD_FAILED");
    if (!data) return fail(req, ctx, "MTS_PLANNING_RUN_NOT_FOUND", 404, "Planning run not found.");
    return okResponse({ run: data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_PLANNING_RUN_LOAD_FAILED", "Could not load the planning run.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/procurement/mts-requirement/planning/ai-explain  (Phase 2D §8, owner D8)
// AI explains and advises on the deterministic plan; it never changes a number.
// ─────────────────────────────────────────────────────────────────────────────
const AI_MAX_OUTPUT_TOKENS = 1024;

export async function explainMtsPlanningHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    if (process.env.AI_CORE_ENABLED !== "true") return fail(req, ctx, "AI_NOT_ENABLED", 403, "AI explanations are switched off for this environment.");
    const parsed = readParams(body, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    const plan = await computePlanning({ companyId, extraMonths: PLANNING_EXTRA_MONTHS, ...parsed.params! });
    const prompt = buildPlanningAiPrompt(plan, text(body.material_name) || null, text(body.question) || null);
    const cap = Math.max(1, Number(process.env.PO22_AI_MONTHLY_TOKEN_CAP ?? 1_000_000) || 1_000_000);
    const reserve = Math.ceil(prompt.length / 3) + AI_MAX_OUTPUT_TOKENS;
    const month = `${todayInIndia().slice(0, 7)}-01`;
    const { data: reserved, error: reserveError } = await serviceRoleClient.schema("erp_planning").rpc("reserve_mts_ai_budget", {
      p_company_id: companyId, p_month: month, p_tokens: reserve, p_cap: cap,
    });
    if (reserveError) {
      // Keep the real database reason in the server log (it was invisible in the first PROD incident).
      console.error("[mts_planning] AI_BUDGET_UNAVAILABLE", reserveError.code ?? "", reserveError.message ?? "");
      return fail(req, ctx, "AI_BUDGET_UNAVAILABLE", 503, "AI budget tracking is not available yet. Planning itself still works.");
    }
    if (reserved !== true) return fail(req, ctx, "AI_BUDGET_EXCEEDED", 429, "This company's monthly AI budget is used up. Planning itself still works.");
    let used = 0;
    try {
      const result = await generateAiText({ prompt, maxTokens: AI_MAX_OUTPUT_TOKENS, maxPromptChars: PO22_AI_MAX_PROMPT_CHARS });
      used = result.usage.input_tokens + result.usage.output_tokens;
      return okResponse({
        explanation: result.text,
        model: result.model,
        usage: result.usage,
        source_fingerprint: plan.source_fingerprint,
        note: "Advisory text only. Numbers come from the deterministic plan; change settings and recalculate for a new scenario.",
      }, ctx.request_id, req);
    } catch (error) {
      const code = error instanceof AiProviderError ? error.code : "UNAVAILABLE";
      return fail(req, ctx, code === "NOT_CONFIGURED" ? "AI_NOT_CONFIGURED" : "AI_PROVIDER_UNAVAILABLE", code === "NOT_CONFIGURED" ? 503 : 502, "The AI explanation is not available right now. Planning itself still works.");
    } finally {
      const { error: settleError } = await serviceRoleClient.schema("erp_planning").rpc("settle_mts_ai_budget", { p_company_id: companyId, p_month: month, p_reserved: reserve, p_used: used });
      if (settleError) console.error("[mts_planning] AI budget settle failed", settleError.code ?? "", settleError.message ?? "");
    }
  } catch (error) {
    return handleError(req, ctx, error, "MTS_PLANNING_AI_FAILED", "Could not prepare the AI explanation.");
  }
}
