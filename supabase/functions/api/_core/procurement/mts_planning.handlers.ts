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
import { buildCalendar, isIsoDate, moqInBase, orderUnitOf, type PolicyOverride, toMaterialBase } from "./mts_requirement.logic.ts";
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
} from "./mts_requirement.handlers.ts";
import { familyClosure } from "./mts_item_plan.logic.ts";
import { type FamilyGroupDemand, type FamilyOwnDemand, type FamilyPlannerInput, optimizeFamilyArrival, planFamily } from "./mts_family_planner.logic.ts";
import { assemblePlanningInput, type MemberCost, storePeriodLabel, storeTransferHints, type VendorTerm } from "./mts_planning.logic.ts";
import { applyOrderConstraints, totalLeadTimeDays } from "./mts_optimizer_phase3d.logic.ts";
import type { OptimizerAdvisoryBuy, OptimizerManualLot, OptimizerVendorOption } from "./mts_optimizer_phase3d.types.ts";
import { averageOrderCost, type CostOption, costOption, DEFAULT_CYCLE_DAYS, economicCycleDays, landedAdder, rankCostOptions } from "./mts_cost.logic.ts";
import { interestPctAt } from "./mts_planning_cost.logic.ts";
import { resolveFxRate } from "./mts_planning_cost.handlers.ts";
import { buildPlanningAiPrompt, PO22_AI_MAX_PROMPT_CHARS } from "./mts_planning_ai.logic.ts";
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

async function loadVendorTerms(companyId: string, universe: string[], routesByMaterial: Map<string, Array<{ vendor_id?: string; days: number }>>, materials: Awaited<ReturnType<typeof computeRequirement>>["materials"]) {
  const result = new Map<string, VendorTerm[]>();
  if (universe.length === 0) return result;
  const [vmiRows, mapRes] = await Promise.all([
    fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient.schema("erp_master").from("vendor_material_info")
      .select("id, vendor_id, material_id, moq_qty, order_multiple_qty, delivery_lot_qty, supply_uom_code, booking_time_days, last_purchase_price, last_purchase_currency")
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
  const termRows = vmiIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(vmiIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("vendor_material_payment_term").select("vmi_id, payment_term_id, is_default").in("vmi_id", chunk));
  const termIds = unique(termRows.map((t) => text(t.payment_term_id)));
  const terms = termIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(termIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("payment_terms_master").select("id, credit_days, advance_pct, payment_method, payment_type").in("id", chunk));
  const termById = new Map(terms.map((t) => [text(t.id), t]));
  const termByVmi = new Map<string, JsonRecord>();
  for (const t of termRows) {
    const term = termById.get(text(t.payment_term_id));
    if (term && (t.is_default === true || !termByVmi.has(text(t.vmi_id)))) termByVmi.set(text(t.vmi_id), term);
  }
  for (const row of rows) {
    const materialId = text(row.material_id);
    const vendorId = text(row.vendor_id);
    const material = materials.get(materialId);
    const unit = text(row.supply_uom_code) || material?.base_uom_code || "";
    const toBase = (value: unknown) => { const q = num(value); return q === null ? null : toMaterialBase(material, q, unit); };
    const booking = num(row.booking_time_days);
    const routeDays = (routesByMaterial.get(materialId) ?? []).filter((r) => r.vendor_id === vendorId).map((r) => r.days - (booking ?? 0));
    result.set(materialId, [...(result.get(materialId) ?? []), {
      vendor_id: vendorId, vendor_label: label.get(vendorId) ?? "—", material_id: materialId,
      moq_base: toBase(row.moq_qty), multiple_base: toBase(row.order_multiple_qty), lot_base: toBase(row.delivery_lot_qty),
      booking_days: booking, route_days: routeDays.length ? Math.max(...routeDays) : null,
      last_price: num(row.last_purchase_price), currency: text(row.last_purchase_currency) || null,
      supply_uom_code: text(row.supply_uom_code) || null,
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

type CostInputs = {
  interestPct: number | null;
  customerCreditDays: number | null;
  fxByCurrency: Map<string, { inr: number | null; source: string | null; stale: boolean }>;
  landedByVendorMaterial: Map<string, { adder: number | null; basis: "FINAL" | "PROVISIONAL" | "NONE" }>;
  /** P2: average landed cost of one order (per GRN) per vendor + material. */
  orderCostByVendorMaterial: Map<string, number | null>;
  /** Owner 2026-10-21: freight term of the latest PO per vendor + material (FOR / FREIGHT_SEPARATE / …). */
  freightTermByVendorMaterial: Map<string, string>;
};

async function loadCostInputs(companyId: string, asOf: string, today: string, universe: string[], vendorTerms: Map<string, VendorTerm[]>, materials: Awaited<ReturnType<typeof computeRequirement>>["materials"]): Promise<CostInputs> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const currencies = unique([...vendorTerms.values()].flat().map((t) => (t.currency ?? "INR").toUpperCase()).filter((c) => c !== "INR"));
  const [financeRes, soRes, grns, fxPicks] = await Promise.all([
    serviceRoleClient.schema("erp_planning").from("company_planning_finance").select("effective_from, interest_pct_per_year").eq("company_id", companyId).limit(500),
    serviceRoleClient.schema("erp_procurement").from("sales_order").select("payment_term_id").eq("company_id", companyId).gte("so_date", since).not("payment_term_id", "is", null).limit(5000),
    universe.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(universe, (chunk) => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, vendor_id, material_id, received_qty, uom_code, status, grn_date").eq("company_id", companyId).gte("grn_date", since).in("material_id", chunk)),
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
  for (const grn of postedGrns) {
    const lc = landedByGrn.get(text(grn.id));
    if (!lc) continue;
    const base = toMaterialBase(materials.get(text(grn.material_id)), Number(grn.received_qty ?? 0), text(grn.uom_code));
    if (base === null) continue;
    const key = `${text(grn.vendor_id)}|${text(grn.material_id)}`;
    history.set(key, [...(history.get(key) ?? []), { total_cost: lc.total, received_base_qty: base, status: lc.status }]);
  }
  const landedByVendorMaterial = new Map([...history].map(([key, rows]) => [key, landedAdder(rows)]));
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
    const lead = totalLeadTimeDays({ material_id: term.material_id, target_days: null, critical_days: null, vendor_moq_qty_base: null, order_multiple_qty_base: null, configured_lead_time_days: null, booking_time_days: term.booking_days, route_lead_time_days: term.route_days });
    const need = buy.need_date ?? buy.estimated_plant_eta;
    const feasible = lead !== null && need !== null && new Date(Date.parse(`${need}T00:00:00Z`) - lead * 86_400_000).toISOString().slice(0, 10) >= asOf;
    let orderQty: number | null = null;
    try {
      orderQty = applyOrderConstraints(buy.required_qty_base, { material_id: term.material_id, target_days: null, critical_days: null, vendor_moq_qty_base: term.moq_base, order_multiple_qty_base: term.multiple_base, configured_lead_time_days: null });
    } catch { orderQty = null; }
    const currency = (term.currency ?? "INR").toUpperCase();
    const fx = inputs.fxByCurrency.get(currency) ?? { inr: null, source: null, stale: false };
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
export async function computePlanning(p: PlanningParams) {
  const calendar = buildCalendar(p.planMonth, p.asOf, p.extraMonths ?? 0);
  if (!calendar) throw new Error("MTS_REQ_AS_OF_OUTSIDE_MONTH");
  const req = await computeRequirement(p.companyId, calendar, p.asOf, p.today, p.demandAt, {
    forecastBeyondPlan: (p.extraMonths ?? 0) > 0, rescheduleOverrides: p.rescheduleOverrides, policyOverrides: p.policyOverrides,
    reuseLoads: p.reuseLoads,
  });
  const planningStarted = Date.now();
  const universe = unique(req.output.rows.map((r) => r.material_id));
  const routesByMaterial = new Map(req.output.rows.map((r) => [r.material_id, (r.lead_time?.configured_routes ?? []).map((route) => ({ vendor_id: route.vendor_id, days: route.days }))]));
  const reuse = p.reuseLoads === true;
  const [vendorTerms, selections] = await Promise.all([
    cachedLoad(`${p.companyId}|vendorTerms|${calendar.asOf}|${hashIds(universe)}`, () => loadVendorTerms(p.companyId, universe, routesByMaterial, req.materials), reuse),
    loadSelections(p.companyId, [calendar.cmStart, calendar.nmStart]),
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
      const currency = (term.currency ?? "INR").toUpperCase();
      const fx = costInputs.fxByCurrency.get(currency)?.inr ?? null;
      const priceInr = term.last_price !== null && fx !== null ? term.last_price * fx : null;
      const landed = costInputs.landedByVendorMaterial.get(`${term.vendor_id}|${id}`) ?? { adder: null, basis: "NONE" as const };
      const lead = term.route_days === null ? null : (term.booking_days ?? 0) + term.route_days;
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
      const missing = [...(full?.missing ?? (priceInr === null ? ["price"] : []))];
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
      };
    });
    if (options.length) vendorOptions.set(id, options);
    const best = options.map((o) => o.cycle_days).filter((d): d is number => d !== null);
    cycleDays.set(id, best.length ? Math.min(...best) : DEFAULT_CYCLE_DAYS);
    cycleBasis.set(id, best.length ? "ECONOMIC" : "DEFAULT");
  }
  // Owner 2026-10-20: nothing selected for a group → engine picks the member with the lowest total cost.
  const memberCost = (id: string, qty: number, needDay: string): MemberCost | null => {
    const terms = vendorTerms.get(id) ?? [];
    if (terms.length === 0) return null;
    const probe = { material_id: id, required_qty_base: qty, need_date: needDay, estimated_plant_eta: needDay } as unknown as OptimizerAdvisoryBuy;
    const best = costOptionsFor(probe, terms, costInputs, calendar.asOf, rowDailyUse(id), carryingOf(id))[0];
    return best ? { feasible: best.feasible, total_cost: best.total_cost, lead_time_days: best.lead_time_days } : null;
  };
  // Opening stock, arrivals, policies and vendor options; the lots themselves come from the
  // family planner (owner 2026-10-22: right item, right time, right lot — own use vs group use).
  const assembly = assemblePlanningInput({ ...baseArgs, memberCost, vendorOptions, cycleDays });
  const vendorOverride = new Map<string, string>();
  const ownDemand: FamilyOwnDemand[] = [];
  const groupDemand: FamilyGroupDemand[] = [];
  for (const r of req.output.records) {
    if (r.day < assembly.input.as_of || r.day > assembly.input.horizon_end || !(r.qty > 0)) continue;
    if (r.group_id && r.candidates.length > 1) groupDemand.push({ group_id: r.group_id, candidates: r.candidates, required_by: r.day, qty_base: r.qty });
    else if (r.candidates[0]) ownDemand.push({ material_id: r.candidates[0], required_by: r.day, qty_base: r.qty });
  }
  const familyInput: FamilyPlannerInput = {
    as_of: assembly.input.as_of,
    horizon_end: assembly.input.horizon_end,
    opening_qty_by_material: assembly.input.opening_qty_by_material,
    own_demand: ownDemand,
    group_demand: groupDemand,
    confirmed_arrivals: assembly.input.confirmed_arrivals,
    policies: assembly.input.policies,
    manual_lots: p.manualLots ?? [],
    group_orders: req.input.groupOrders,
    selections: selections.map,
  };
  const plannerStarted = Date.now();
  const projection = planFamily(familyInput);
  const plannerMs = Date.now() - plannerStarted;
  const groupAssignments = (() => {
    const byKey = new Map<string, { group_id: string; month: string; assigned_material_id: string | null; reason: "AUTO_SELECTED"; uncovered_qty: number }>();
    for (const b of projection.advisory_buys) {
      if (b.need_kind !== "GROUP" || !b.need_date || (b.status !== "ADVISORY" && b.status !== "ADVISORY_LATE")) continue;
      for (const groupId of b.covers) {
        const key = `${groupId}|${b.need_date.slice(0, 7)}|${b.material_id}`;
        const seen = byKey.get(key) ?? { group_id: groupId, month: `${b.need_date.slice(0, 7)}-01`, assigned_material_id: b.material_id, reason: "AUTO_SELECTED" as const, uncovered_qty: 0 };
        seen.uncovered_qty += b.required_qty_base;
        byKey.set(key, seen);
      }
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
      own_demand: familyInput.own_demand.filter((d) => members.has(d.material_id)),
      group_demand: groupDemand,
      confirmed_arrivals: familyInput.confirmed_arrivals.filter((a) => members.has(a.material_id)),
      policies: familyInput.policies.filter((pol) => members.has(pol.material_id)),
      manual_lots: (familyInput.manual_lots ?? []).filter((l) => members.has(l.material_id)),
    };
  };

  // Owner 2026-10-22: the Store gets the planner's consumption ratio — a group line's period use is
  // split over its members as the family planner consumes them (stock rotation, own use protected).
  const storeRowsByRatio = (() => {
    const range = (period: string) => (period === "CM" ? [calendar.asOf, calendar.cmEnd] : [calendar.nmStart, calendar.nmEnd]);
    const shareCache = new Map<string, { shares: Map<string, number>; unmet: number } | null>();
    const shareOf = (groupId: string, period: string) => {
      const key = `${groupId}|${period}`;
      if (shareCache.has(key)) return shareCache.get(key)!;
      const [from, to] = range(period);
      const draws = new Map<string, number>();
      for (const m of projection.group_mix) {
        if (m.group_id !== groupId || m.day < from || m.day > to) continue;
        for (const [id, q] of Object.entries(m.draws)) draws.set(id, (draws.get(id) ?? 0) + q);
      }
      const unmet = projection.group_unmet.filter((u) => u.group_id === groupId && u.day >= from && u.day <= to).reduce((sum, u) => sum + u.qty_base, 0);
      const total = [...draws.values()].reduce((a, b) => a + b, 0) + unmet;
      const value = total > 0 ? { shares: new Map([...draws].map(([id, q]) => [id, q / total])), unmet: unmet / total } : null;
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
      if (share.unmet * row.demand_qty > 1e-6) out.push({ ...row, material_id: null, executable_qty: 0, not_backed_qty: r6(row.demand_qty * share.unmet) });
    }
    return out;
  })();
  const arrivalScope = p.arrivalFamilyOf ? new Set(Object.keys(familyInputFor(p.arrivalFamilyOf).opening_qty_by_material)) : null;
  const nameOf = (id: string | null) => (id ? text(req.materialRows.get(id)?.material_name) || "—" : "—");
  const codeOf = (id: string | null) => (id ? text(req.materialRows.get(id)?.pace_code) || null : null);
  const groupIds = unique([...req.output.groups.map((g) => g.group_id), ...req.output.store_rows.map((r) => r.group_id)]);
  const groupRows = groupIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("material_category_group").select("id, group_code, group_name").in("id", chunk));
  const groupLabel = new Map(groupRows.map((g) => [text(g.id), [text(g.group_code), text(g.group_name)].filter(Boolean).join(" — ")]));
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
  const transferHint = storeTransferHints(req.output.rows, notBacked, (id) => locationLabels.get(id) ?? "—", uom);
  const groupHint = storeTransferHints([...groupTransferNeed.keys()].map((id) => rowById.get(id)!).filter(Boolean), groupTransferNeed, (id) => locationLabels.get(id) ?? "—", uom);
  const prodshadesOf = (row: { kind: string; prodshade_ids: string[]; sku_ids: string[] }) =>
    unique(row.kind === "PM" ? row.sku_ids.map((sku) => req.masters.skus.get(sku)?.prodshade_material_id ?? "").filter(Boolean) : row.prodshade_ids);
  const eventRef = new Map<string, string>();
  for (const row of req.output.rows) row.inbound_events.forEach((event, index) => eventRef.set(`A|${row.material_id}|${index}|${event.reference}`, event.reference));

  const activeMaterials = new Set(projection.rows.filter((r) => r.demand_qty_base > 0 || r.confirmed_arrival_qty_base > 0 || r.planned_lot_qty_base > 0).map((r) => r.material_id));
  const payload = {
    company_id: p.companyId,
    calendar: { as_of: calendar.asOf, cm_start: calendar.cmStart, cm_end: calendar.cmEnd, nm_start: calendar.nmStart, nm_end: calendar.nmEnd },
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
    group_risks: projection.group_pool_risks.map((g) => ({ ...g, group_label: g.group_id ? groupLabel.get(g.group_id) ?? "—" : "—" })),
    group_assignments: groupAssignments.map((a) => ({ ...a, group_label: groupLabel.get(a.group_id) ?? "—", assigned_material_name: a.assigned_material_id ? nameOf(a.assigned_material_id) : null })),
    // Owner 2026-10-21: not-yet-shipped CSN / PO pieces the planner may move earlier / later
    // (planning side only; CSN Tracker is never changed).
    reschedulable_arrivals: req.output.rows.filter((row) => !arrivalScope || arrivalScope.has(row.material_id)).flatMap((row) => {
      const pieces = row.inbound_events.filter((event) => event.reschedule_key);
      if (pieces.length === 0) return [];
      // Owner 2026-10-22: best plant date per piece, judged on the whole family (not the item alone).
      const input = familyInputFor(row.material_id);
      const keyOf = new Map(row.inbound_events.map((event, index) => [event, `A|${row.material_id}|${index}|${event.reference}`]));
      const optimum = new Map(pieces.map((event) => [event.reschedule_key as string, optimizeFamilyArrival(input, keyOf.get(event)!)]));
      return pieces.map((event) => ({
        material_id: row.material_id, material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id),
        reference: event.reference, qty: event.qty, kind: event.kind, reschedule_key: event.reschedule_key as string,
        eta_plant: event.original_date !== undefined ? event.original_date : event.date,
        rescheduled_eta: event.original_date !== undefined ? event.date : null,
        optimum: optimum.get(event.reschedule_key as string) ?? null,
      }));
    }).sort((x, y) => String(x.rescheduled_eta ?? x.eta_plant ?? "9999").localeCompare(String(y.rescheduled_eta ?? y.eta_plant ?? "9999")) || x.material_name.localeCompare(y.material_name)),
    arrival_flags: projection.arrival_flags.map((f) => ({ ...f, material_name: nameOf(f.material_id), document: eventRef.get(f.source_key) ?? f.source_key })),
    store_rows: storeRowsByRatio.map((row) => ({
      ...row,
      period_label: storePeriodLabel(row.period, calendar),
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
    })),
  };
  console.log(JSON.stringify({ event: "MTS_TIMING", step: "planning_done", reuse, planner_ms: plannerMs, total_ms: Date.now() - planningStarted }));
  // Internal pieces for the P1 item plan (never serialised by the Planning endpoint).
  const internal = { req, assembly, projection, calendar, vendorOptions, vendorTerms, orderUnitFor, familyInputFor };
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
    return okResponse(await computePlanning({ companyId, ...parsed.params! }), ctx.request_id, req);
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
    const result = await computePlanning({ companyId, ...parsed.params! });
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
    const plan = await computePlanning({ companyId, ...parsed.params! });
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
