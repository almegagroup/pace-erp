/*
 * PO22 P1 — item / family plan (owner 2026-10-20).
 *   GET  /api/procurement/mts-requirement/item-plan          one item (or its whole family), day by day, ~6 months
 *   POST /api/procurement/mts-requirement/inbound-reschedule planning-side rescheduled ETA (CSN Tracker untouched)
 * Design: docs/mts-planning/PO22-P1-FAMILY-PLANNING-DETAIL-2026-10-20.md
 * Read-only except the reschedule store; never creates a PO, CSN, transfer or stock posting.
 */
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import {
  buildItemPlanAiPrompt,
  buildWhatIfTargetPrompt,
  ITEM_PLAN_AI_MAX_PROMPT_CHARS,
  parseAiLots,
  pickTargetCandidate,
  planMetrics,
  type TargetCandidateResult,
  weeklySummary,
} from "./mts_item_plan_ai.logic.ts";
import { AiProviderError, generateAiText } from "../ai/ai.provider.ts";
import { resolveUserDisplayNames } from "../../_shared/resolveUserDisplayNames.ts";
import {
  arrivalStatus, companySpare, dayRange, familyClosure, familyDayGrid, locationTransfers, poNumberOfReference, storeKey, wholeDays,
} from "./mts_item_plan.logic.ts";
import type { OptimizerDailyProjectionRow, OptimizerManualLot } from "./mts_optimizer_phase3d.types.ts";
import type { PolicyOverride } from "./mts_requirement.logic.ts";
import { computePlanning, readParams } from "./mts_planning.handlers.ts";
import {
  fail,
  handleError,
  loadLocationLabels,
  type ReqHandlerContext,
  requireRequirementViewAccess,
  todayInIndia,
} from "./mts_requirement.handlers.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Horizon = CM + NM + 4 = about 6 months (owner 2026-10-20). */
const ITEM_PLAN_EXTRA_MONTHS = 4;
const RESOURCE_RESCHEDULE = "PROC_MTS_INBOUND_RESCHEDULE";
const MAX_RESCHEDULE_ROWS = 200;

type ItemPlanParams = NonNullable<ReturnType<typeof readParams>["params"]>;

/** Simulation-only changes (never saved): moved arrivals and what-if Target / Critical days. */
export type ItemPlanSimulation = {
  rescheduleOverrides?: ReadonlyMap<string, string | null>;
  policyOverrides?: ReadonlyMap<string, PolicyOverride>;
  /** Preview / what-if / AI re-check: reuse the item plan's heavy reads (≤ 3 min old). */
  reuseLoads?: boolean;
};

/** P4: lots the user fixed for this item (current version); empty before the first save. */
export async function loadCurrentScenario(companyId: string, materialId: string): Promise<{ version_no: number | null; source: string | null; note: string | null; manual_lots: OptimizerManualLot[] }> {
  const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_item_plan_scenario")
    .select("version_no, source, note, overrides").eq("company_id", companyId).eq("material_id", materialId).eq("is_current", true).maybeSingle();
  if (error) {
    const code = String((error as { code?: string }).code ?? "");
    if (code === "42P01" || code === "PGRST205" || code === "PGRST106") return { version_no: null, source: null, note: null, manual_lots: [] };
    throw new Error("MTS_SCENARIO_LOAD_FAILED");
  }
  const row = (data ?? null) as JsonRecord | null;
  const lots = Array.isArray((row?.overrides as JsonRecord | undefined)?.manual_lots) ? (row!.overrides as { manual_lots: JsonRecord[] }).manual_lots : [];
  return {
    version_no: row ? Number(row.version_no) : null, source: row ? text(row.source) : null, note: row ? text(row.note) || null : null,
    manual_lots: lots.map((l) => ({ material_id: text(l.material_id), plant_eta: text(l.plant_eta).slice(0, 10), qty_base: Number(l.qty_base ?? 0), vendor_id: text(l.vendor_id) || null }))
      .filter((l) => l.material_id && /^\d{4}-\d{2}-\d{2}$/.test(l.plant_eta) && l.qty_base > 0),
  };
}

export async function getMtsItemPlanHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    const materialId = text(url.searchParams.get("material_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    if (!materialId) return fail(req, ctx, "MTS_ITEM_PLAN_MATERIAL_REQUIRED", 400, "Pick a material.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(url, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);

    const scenario = await loadCurrentScenario(companyId, materialId);
    const payload = await buildItemPlan(companyId, parsed.params!, materialId, scenario.manual_lots);
    return okResponse({ ...payload, scenario: { version_no: scenario.version_no, source: scenario.source, note: scenario.note, manual_lots: scenario.manual_lots } }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_ITEM_PLAN_MATERIAL_NOT_PLANNED") return fail(req, ctx, error.message, 404, "This material is not used by this company's planned MTS products.");
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_ITEM_PLAN_FAILED", "Could not calculate the item plan.");
  }
}

/** One item / family plan (P1-P4). Shared by GET, the AI review and simulations. */
export async function buildItemPlan(
  companyId: string, params: ItemPlanParams, materialId: string, manualLots: OptimizerManualLot[], sim: ItemPlanSimulation = {},
) {
    const plan = await computePlanning({
      companyId, ...params, extraMonths: ITEM_PLAN_EXTRA_MONTHS, manualLots,
      rescheduleOverrides: sim.rescheduleOverrides, policyOverrides: sim.policyOverrides, arrivalFamilyOf: materialId,
      reuseLoads: sim.reuseLoads,
    });
    const { req: reqData, projection, assembly, calendar, vendorOptions, vendorTerms, orderUnitFor } = plan._internal;
    // Order UoM (owner 2026-10-22): the same quantity in the unit it is ordered in.
    const orderFields = (id: string, vendorId: string | null | undefined, qtyBase: number) => {
      const unit = orderUnitFor(id, vendorId);
      return { order_uom: unit?.order_uom_code ?? null, order_qty: unit ? round(qtyBase / unit.base_per_order_unit) : null };
    };
    const rowById = new Map(reqData.output.rows.map((r) => [r.material_id, r]));
    if (!rowById.has(materialId)) throw new Error("MTS_ITEM_PLAN_MATERIAL_NOT_PLANNED");

    // Family (owner): a grouped item opens its whole family; a non-group item stands alone.
    const family = familyClosure(materialId, reqData.masters.groupMembers);
    const memberIds = family.member_ids.filter((id) => rowById.has(id) || id === materialId);
    const memberSet = new Set(memberIds);
    const groupSet = new Set(family.group_ids);
    const days = dayRange(calendar.asOf, calendar.horizonEnd);

    const memberRows: OptimizerDailyProjectionRow[] = projection.rows.filter((r) => memberSet.has(r.material_id));
    // Group use no member could carry that day (family planner) is the family's shortage.
    const unmet = new Map(days.map((day) => [day, 0]));
    for (const u of projection.group_unmet) if (groupSet.has(u.group_id) && unmet.has(u.day)) unmet.set(u.day, (unmet.get(u.day) ?? 0) + u.qty_base);
    const grid = familyDayGrid(days, memberRows, unmet);

    const nameOf = (id: string) => text(reqData.materialRows.get(id)?.material_name) || "—";
    const codeOf = (id: string) => text(reqData.materialRows.get(id)?.pace_code) || null;
    const uomOf = (id: string) => text(reqData.materialRows.get(id)?.base_uom_code) || null;

    // Direct (exclusive) use: the material sits on a stroke / Pack BOM line itself.
    const direct = new Set<string>();
    for (const stroke of reqData.masters.strokes.values()) for (const line of stroke.lines) direct.add(line.material_id);
    for (const bom of reqData.masters.packBoms.values()) for (const line of bom.inputs) direct.add(line.material_id);
    const groupsOf = new Map<string, string[]>();
    for (const groupId of family.group_ids) {
      for (const m of reqData.masters.groupMembers.get(groupId) ?? []) {
        if (m.active) groupsOf.set(m.material_id, [...(groupsOf.get(m.material_id) ?? []), groupId]);
      }
    }

    const csnIds = unique(memberIds.flatMap((id) => (rowById.get(id)?.inbound_events ?? []).map((e) => e.csn_id)));
    const [groupRows, csnRows, stockRows, historyCsns] = await Promise.all([
      family.group_ids.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(family.group_ids, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
      csnIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(csnIds, (chunk) => serviceRoleClient
        .schema("erp_procurement").from("consignment_note")
        .select("id, csn_number, status, etd, eta_at_port, eta_to_plant_calculated, vendor_id").in("id", chunk)),
      fetchInChunks<JsonRecord>(memberIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_snapshot")
        .select("material_id, storage_location_id, stock_type_code, quantity").eq("company_id", companyId)
        .eq("stock_type_code", "UNRESTRICTED").in("material_id", chunk)),
      // Port → plant days from received import CSNs (for future-order ETA Port).
      fetchInChunks<JsonRecord>(memberIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("consignment_note")
        .select("material_id, ata_at_port, eta_at_port, gate_entry_date").eq("company_id", companyId).eq("status", "GRD")
        .not("gate_entry_date", "is", null).in("material_id", chunk)),
    ]);
    const groupLabel = new Map(groupRows.map((g) => [text(g.id), [text(g.group_code), text(g.group_name)].filter(Boolean).join(" — ")]));
    const csnById = new Map(csnRows.map((c) => [text(c.id), c]));
    // Supplier of a not-yet-shipped PO piece = the PO's vendor (owner 2026-10-21: was blank).
    const poNumbers = unique(memberIds.flatMap((id) => (rowById.get(id)?.inbound_events ?? []).map((e) => poNumberOfReference(e.reference))));
    const poRows = poNumbers.length === 0 ? [] : await fetchInChunks<JsonRecord>(poNumbers, (chunk) => serviceRoleClient
      .schema("erp_procurement").from("purchase_order").select("po_number, vendor_id").eq("company_id", companyId).in("po_number", chunk));
    const poVendor = new Map(poRows.map((p) => [text(p.po_number), text(p.vendor_id)]));
    const vendorIds = unique([...csnRows.map((c) => text(c.vendor_id)), ...poRows.map((p) => text(p.vendor_id))]);
    const [vendorRows, locationLabels] = await Promise.all([
      vendorIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name").in("id", chunk)),
      loadLocationLabels(unique(stockRows.map((s) => text(s.storage_location_id)))),
    ]);
    const vendorLabel = new Map(vendorRows.map((v) => [text(v.id), [text(v.vendor_code), text(v.vendor_name)].filter(Boolean).join(" — ")]));

    const members = memberIds.map((id) => {
      const row = rowById.get(id);
      // Owner 2026-10-21: excluded locations (OT01 / OT02…) are not in the plan, so not shown;
      // transfer-source locations are shown as "not counted".
      const counted = new Set(row?.stock.required_locations ?? []);
      const other = new Set(row?.stock.other_locations ?? []);
      const locations = stockRows.filter((s) => text(s.material_id) === id && Number(s.quantity ?? 0) > 0.000001)
        .filter((s) => counted.has(text(s.storage_location_id)) || other.has(text(s.storage_location_id)))
        .map((s) => ({ location: `${locationLabels.get(text(s.storage_location_id)) ?? "—"}${other.has(text(s.storage_location_id)) ? " (not counted)" : ""}`, qty: round(Number(s.quantity)) }))
        .sort((a, b) => a.location.localeCompare(b.location));
      return {
        material_id: id, material_code: codeOf(id), material_name: nameOf(id), uom: uomOf(id),
        is_selected: id === materialId,
        exclusive: direct.has(id),
        groups: (groupsOf.get(id) ?? []).map((g) => groupLabel.get(g) ?? "—").sort(),
        usable_stock: round(row?.stock.usable_at_required ?? 0),
        target_days: row?.policy?.target_cov_days ?? null,
        critical_days: row?.policy?.critical_cov_days ?? null,
        locations,
      };
    });

    const buildArrivals = () => memberIds.flatMap((id) => (rowById.get(id)?.inbound_events ?? []).map((event) => {
      const csn = event.csn_id ? csnById.get(event.csn_id) : undefined;
      return {
        material_id: id, material_code: codeOf(id), material_name: nameOf(id), uom: uomOf(id),
        reference: event.reference, qty: round(event.qty),
        status: arrivalStatus(event.kind, event.date_source),
        vendor: (csn ? vendorLabel.get(text(csn.vendor_id)) : null) ?? vendorLabel.get(poVendor.get(poNumberOfReference(event.reference) ?? "") ?? "") ?? null,
        etd: csn ? text(csn.etd).slice(0, 10) || null : null,
        eta_port: csn ? text(csn.eta_at_port).slice(0, 10) || null : null,
        eta_plant: event.original_date !== undefined ? event.original_date : event.date,
        rescheduled_eta: event.original_date !== undefined ? event.date : null,
        reschedule_key: event.reschedule_key ?? null,
        ...adviceFor(id, event.reschedule_key ?? null),
      };
    })).sort((a, b) => String(a.rescheduled_eta ?? a.eta_plant ?? "9999").localeCompare(String(b.rescheduled_eta ?? b.eta_plant ?? "9999")));

    // The detail row must say which group consumed a member's stock.  Keep the
    // internal group id only as a map key; return the resolved business label.
    const groupDrawsByMemberDay = new Map<string, Array<{ group: string; qty: number }>>();
    for (const mix of projection.group_mix) {
      if (!groupSet.has(mix.group_id)) continue;
      for (const [memberId, qty] of Object.entries(mix.draws)) {
        if (!memberSet.has(memberId) || qty <= 0.000001) continue;
        const key = `${memberId}|${mix.day}`;
        groupDrawsByMemberDay.set(key, [...(groupDrawsByMemberDay.get(key) ?? []), {
          group: groupLabel.get(mix.group_id) ?? "—",
          qty: round(qty),
        }]);
      }
    }
    const memberDaily = memberRows.map((r) => ({
      material_id: r.material_id, day: r.day, opening: round(r.opening_qty_base), arrivals: round(r.confirmed_arrival_qty_base),
      planned_lot: round(r.planned_lot_qty_base), use: round(r.demand_qty_base), group_draw: round(r.group_draw_qty_base),
      group_draws: groupDrawsByMemberDay.get(`${r.material_id}|${r.day}`) ?? [],
      closing: round(r.closing_qty_base), max_days: wholeDays(r.max_cover_days), min_days: wholeDays(r.min_cover_days),
      target_days: r.target_days, critical_days: r.critical_days,
    }));

    // ── P2: future orders (engine plan), reschedule advice, R ↔ R transfers ──
    const rowsByMember = new Map<string, OptimizerDailyProjectionRow[]>();
    for (const r of memberRows) rowsByMember.set(r.material_id, [...(rowsByMember.get(r.material_id) ?? []), r]);
    const portToPlant = new Map<string, number>();
    for (const id of memberIds) {
      const gaps = historyCsns.filter((c) => text(c.material_id) === id)
        .map((c) => { const port = text(c.ata_at_port || c.eta_at_port).slice(0, 10); const gate = text(c.gate_entry_date).slice(0, 10); return port && gate ? (Date.parse(`${gate}T00:00:00Z`) - Date.parse(`${port}T00:00:00Z`)) / 86_400_000 : null; })
        .filter((g): g is number => g !== null && g >= 0 && g <= 60).sort((a, b) => a - b);
      if (gaps.length) portToPlant.set(id, Math.round(gaps[Math.floor(gaps.length / 2)]));
    }
    const addDaysIso = (day: string | null, n: number | null) => (day && n !== null ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : null);
    const coverOn = (id: string, day: string | null) => rowsByMember.get(id)?.find((r) => r.day === day) ?? null;
    const coversLabel = (covers: readonly string[]) => covers.map((c) => (c === "OWN" ? "Own use" : groupLabel.get(c) ?? "—")).join(", ") || null;
    const futureOrders = plan.buys
      .filter((b) => memberSet.has(b.material_id) && (b.status === "ADVISORY" || b.status === "ADVISORY_LATE"))
      .flatMap((b) => (b.lots.length ? b.lots : [{ lot_no: 1, plant_eta: b.estimated_plant_eta, qty_base: b.recommended_po_qty_base ?? 0 }]).map((lot) => {
        const at = coverOn(b.material_id, lot.plant_eta);
        const p2p = portToPlant.get(b.material_id) ?? null;
        return {
          material_id: b.material_id, material_code: codeOf(b.material_id), material_name: nameOf(b.material_id), uom: uomOf(b.material_id),
          sequence: b.sequence, lot_no: lot.lot_no, vendor: b.vendor_label ?? null, vendor_id: b.vendor_id ?? null, qty: round(lot.qty_base),
          ...orderFields(b.material_id, b.vendor_id, lot.qty_base),
          po_by: b.recommended_po_by, etd: addDaysIso(b.recommended_po_by, b.booking_time_days ?? null),
          eta_port: p2p !== null ? addDaysIso(lot.plant_eta, -p2p) : null, eta_plant: lot.plant_eta,
          max_days_on_arrival: wholeDays(at?.max_cover_days ?? null), min_days_on_arrival: wholeDays(at?.min_cover_days ?? null),
          max_days_planned: b.max_cover_days ?? null, max_days_basis: b.max_days_basis ?? null,
          bridge: b.bridge === true, late: b.status === "ADVISORY_LATE", cheapest_vendor: b.cheapest_vendor_label ?? null,
          unit_total_cost: b.vendor_unit_total_cost ?? null, freight_term: b.vendor_freight_term ?? null, cost_missing: b.vendor_cost_missing ?? [],
          reason: b.reason,
          // Owner 2026-10-22: what this lot is for (own use or which groups).
          covers: coversLabel((b as { covers?: readonly string[] }).covers ?? []),
        };
      }));

    const memberDays = (id: string) => (rowsByMember.get(id) ?? []).map((r) => ({ day: r.day, closing: r.closing_qty_base, use: r.demand_qty_base, target_days: r.target_days, critical_days: r.critical_days }));
    // Owner 2026-10-21: best plant date per movable arrival, tried on every day of the horizon.
    // Owner 2026-10-22: judged on the whole family (computed once by the planning run).
    const optimumByKey = new Map(plan.reschedulable_arrivals.map((a) => [a.reschedule_key, a.optimum]));
    const adviceFor = (_id: string, key: string | null) => {
      const optimum = key ? optimumByKey.get(key) ?? null : null;
      return {
        optimum,
        advice: optimum && optimum.shift_days !== 0 ? { suggested_eta: optimum.best.eta, shift_days: optimum.shift_days, reason: optimum.reason } : null,
      };
    };

    const poolLocation = new Map<string, string | null>();
    for (const id of memberIds) for (const pool of rowById.get(id)?.pools ?? []) poolLocation.set(pool.pool_key, pool.storage_location_id);
    const poolLocationLabels = await loadLocationLabels(unique([...poolLocation.values()]));
    const transfers = memberIds.flatMap((id) => {
      const needs = new Map<string, { need: number; stock: number }>();
      for (const r of reqData.output.store_rows) {
        if (r.material_id !== id) continue;
        const loc = poolLocationLabels.get(poolLocation.get(r.pool_key) ?? "") ?? null;
        if (!loc || !storeKey(loc)) continue;
        const seen = needs.get(loc) ?? { need: 0, stock: 0 };
        needs.set(loc, { ...seen, need: seen.need + r.executable_qty + r.not_backed_qty });
      }
      for (const st of stockRows.filter((x) => text(x.material_id) === id)) {
        const loc = locationLabels.get(text(st.storage_location_id)) ?? null;
        if (!loc || !storeKey(loc)) continue;
        const seen = needs.get(loc) ?? { need: 0, stock: 0 };
        needs.set(loc, { ...seen, stock: seen.stock + Number(st.quantity ?? 0) });
      }
      return locationTransfers([...needs].map(([location, v]) => ({ location, ...v })))
        .map((t) => ({ material_id: id, material_code: codeOf(id), material_name: nameOf(id), uom: uomOf(id), ...t, by: calendar.asOf }));
    });

    // P2 alternatives when a member falls below Target (owner order): group members' spare →
    // R ↔ R transfer → reschedule → other company (STO / Sub-CSN, on request) → other vendor →
    // safety compromise (Target → Critical; below Critical only with the user's OK) → trader last.
    const spareOf = (id: string) => companySpare(memberDays(id));
    const alternatives = plan.risks.filter((r) => memberSet.has(r.material_id) && (r.first_below_target_day || r.first_shortage_day)).map((risk) => {
      const id = risk.material_id;
      const days = memberDays(id);
      const avgUse = days.length ? days.reduce((sum, d) => sum + d.use, 0) / days.length : 0;
      const target = days.find((d) => d.target_days !== null)?.target_days ?? null;
      const critical = (rowsByMember.get(id) ?? []).find((r) => r.critical_days !== null)?.critical_days ?? null;
      const options: Array<{ rank: number; kind: string; detail: string; qty: number | null }> = [];
      const memberSpare = memberIds.filter((m) => m !== id && family.is_family).map((m) => ({ m, spare: spareOf(m) })).filter((x) => x.spare > 0);
      if (memberSpare.length) options.push({ rank: 1, kind: "GROUP_MEMBER", qty: round(memberSpare.reduce((s2, x) => s2 + x.spare, 0)), detail: memberSpare.map((x) => `${nameOf(x.m)}: ${round(x.spare)}`).join("; ") + " (only where the member is allowed on the line)" });
      const tr = transfers.filter((t) => t.material_id === id);
      if (tr.length) options.push({ rank: 2, kind: "TRANSFER", qty: round(tr.reduce((s2, t) => s2 + t.qty, 0)), detail: tr.map((t) => `${t.from} → ${t.to}: ${t.qty}`).join("; ") });
      const adv = buildArrivals().filter((a) => a.material_id === id && a.advice && a.advice.shift_days < 0);
      if (adv.length) options.push({ rank: 3, kind: "RESCHEDULE", qty: round(adv.reduce((s2, a) => s2 + a.qty, 0)), detail: adv.map((a) => `${a.reference}: advance ${-a.advice!.shift_days} d`).join("; ") });
      options.push({ rank: 4, kind: "OTHER_COMPANY", qty: null, detail: "Use 'Check other companies' — STO / Sub-CSN is raised by the user." });
      const vendors = futureOrders.filter((f) => f.material_id === id && (f.bridge || f.late));
      if (vendors.length) options.push({ rank: 5, kind: "OTHER_VENDOR", qty: round(vendors.reduce((s2, f) => s2 + f.qty, 0)), detail: vendors.map((f) => `${f.vendor ?? "—"} (${f.bridge ? `bridge; cheapest ${f.cheapest_vendor ?? "—"} too late` : "late"})`).join("; ") });
      if (target !== null && critical !== null && target > critical) options.push({ rank: 6, kind: "SAFETY_COMPROMISE", qty: round((target - critical) * avgUse), detail: `Use protected stock from ${target} down to ${critical} days (alert); below Critical only with your OK.` });
      options.push({ rank: 7, kind: "TRADER", qty: null, detail: "Last resort: a domestic trader of the same material (none on record — source one if needed)." });
      return { material_id: id, material_code: codeOf(id), material_name: nameOf(id), first_below_target_day: risk.first_below_target_day, first_shortage_day: risk.first_shortage_day, options };
    });

    // Owner 2026-10-21: every vendor of every member with lead time, earliest plant date and full
    // cost, so the user can compare vendor × date before fixing a lot.
    const vendorChoices = memberIds.map((id) => ({
      material_id: id, material_code: codeOf(id), material_name: nameOf(id), uom: uomOf(id),
      // Material Settings Order UoM (no vendor); each option below may carry the vendor's own.
      order_unit: orderUnitFor(id, null),
      // Median port → plant days from received import CSNs (null = no history).
      port_to_plant_days: portToPlant.get(id) ?? null,
      options: (vendorOptions.get(id) ?? []).map((o) => ({
        vendor_id: o.vendor_id,
        vendor_label: (vendorTerms.get(id) ?? []).find((t) => t.vendor_id === o.vendor_id)?.vendor_label ?? "—",
        lead_time_days: o.lead_time_days, booking_time_days: o.booking_time_days ?? null,
        earliest_plant_eta: addDaysIso(calendar.asOf, o.lead_time_days),
        moq_qty: o.moq_qty_base, order_multiple_qty: o.order_multiple_qty_base,
        unit_total_cost: o.unit_cost, freight_term: o.freight_term ?? null, cost_missing: o.cost_missing ?? [],
        order_unit: orderUnitFor(id, o.vendor_id),
      })).sort((a, b) => (a.unit_total_cost ?? Infinity) - (b.unit_total_cost ?? Infinity) || a.vendor_label.localeCompare(b.vendor_label)),
    }));
    const choiceOf = (id: string, vendorId: string | null | undefined) =>
      vendorId ? vendorChoices.find((c) => c.material_id === id)?.options.find((o) => o.vendor_id === vendorId) ?? null : null;

    // P4: lots the user fixed, and the numbers the AI review compares before / after.
    const userLots = manualLots.filter((l) => memberSet.has(l.material_id)).map((l) => {
      const choice = choiceOf(l.material_id, l.vendor_id);
      return {
        ...l, material_code: codeOf(l.material_id), material_name: nameOf(l.material_id), uom: uomOf(l.material_id),
        ...orderFields(l.material_id, l.vendor_id, l.qty_base),
        vendor_label: choice?.vendor_label ?? null,
        // This vendor cannot deliver by this date if ordered today.
        too_early: Boolean(choice?.earliest_plant_eta && l.plant_eta < choice.earliest_plant_eta),
        below_moq: Boolean(choice?.moq_qty && l.qty_base < choice.moq_qty),
        lot_value: choice?.unit_total_cost !== null && choice?.unit_total_cost !== undefined ? round(l.qty_base * choice.unit_total_cost) : null,
      };
    });
    // Owner 2026-10-21 (sheet PLANNING "Prediction"): every Quantity to Dispatch — engine lots and
    // the user's own — with Max / Min days on that date (family grid, as on the left) and the dates
    // worked back from the plant date: Port ETA = Date − port → plant days (received import CSNs),
    // Import ETD = Date − the vendor's dispatch → plant days (route lead without booking).
    const gridByDay = new Map(grid.map((g) => [g.day, g]));
    const legsFor = (id: string, vendorId: string | null | undefined, plantDate: string | null) => {
      const option = vendorId ? (vendorOptions.get(id) ?? []).find((o) => o.vendor_id === vendorId) : undefined;
      const transit = option && option.lead_time_days !== null ? option.lead_time_days - (option.booking_time_days ?? 0) : null;
      const p2p = portToPlant.get(id) ?? null;
      return {
        port_eta: p2p !== null ? addDaysIso(plantDate, -p2p) : null,
        import_etd: transit !== null ? addDaysIso(plantDate, -transit) : null,
      };
    };
    const prediction = [
      ...futureOrders.map((f) => ({ source: "ENGINE" as const, material_id: f.material_id, vendor_id: f.vendor_id, vendor: f.vendor, date: f.eta_plant, qty: f.qty, covers: f.covers as string | null, why: f.reason as string | null })),
      ...userLots.map((l) => ({ source: "YOU" as const, material_id: l.material_id, vendor_id: l.vendor_id ?? null, vendor: l.vendor_label, date: l.plant_eta as string | null, qty: round(l.qty_base), covers: null as string | null, why: null as string | null })),
    ].map((r) => ({
      ...r, material_code: codeOf(r.material_id), material_name: nameOf(r.material_id), uom: uomOf(r.material_id),
      ...orderFields(r.material_id, r.vendor_id, r.qty),
      ...legsFor(r.material_id, r.vendor_id, r.date),
      max_days: r.date ? gridByDay.get(r.date)?.max_days ?? null : null,
      min_days: r.date ? gridByDay.get(r.date)?.min_days ?? null : null,
    })).sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
    const unitCosts = (vendorOptions.get(materialId) ?? []).map((o) => o.unit_cost).filter((c): c is number => c !== null);
    const selectedTarget = rowById.get(materialId)?.policy?.target_cov_days ?? null;
    const selectedCritical = rowById.get(materialId)?.policy?.critical_cov_days ?? null;
    const metrics = planMetrics(grid, selectedTarget, unitCosts.length ? Math.min(...unitCosts) : null, selectedCritical);

    const forecastMonths = new Set(reqData.forecast.forecastMonths);
    return {
      company_id: companyId,
      material_id: materialId,
      calendar: { as_of: calendar.asOf, horizon_end: calendar.horizonEnd, months: calendar.months },
      month_sources: calendar.months.map((month) => ({ month, source: forecastMonths.has(month) ? "FORECAST" : "PLAN" })),
      forecast_count: reqData.forecast.forecasts.length,
      family: {
        is_family: family.is_family,
        groups: family.group_ids.map((g) => ({ group_id: g, label: groupLabel.get(g) ?? "—" })),
      },
      members,
      // Owner 2026-10-22: every row says what arrives that day — which member, consignment, vendor,
      // status, what it covers and why — so the whole family is readable in one table.
      grid: (() => {
        const events = new Map<string, Array<Record<string, unknown>>>();
        const push = (day: string | null, e: Record<string, unknown>) => { if (day) events.set(day, [...(events.get(day) ?? []), e]); };
        for (const a of buildArrivals()) {
          push(a.rescheduled_eta ?? a.eta_plant ?? calendar.asOf, {
            kind: "ARRIVAL", member: `${a.material_code ?? ""} ${a.material_name}`.trim(), qty: a.qty, uom: a.uom, reference: a.reference,
            vendor: a.vendor, status: a.status, movable: Boolean(a.reschedule_key),
            why: a.advice ? `Engine: ${a.advice.shift_days < 0 ? "prepone" : "postpone"} to ${a.advice.suggested_eta} — ${a.advice.reason}` : null,
          });
        }
        for (const f of futureOrders) {
          push(f.eta_plant, { kind: "ENGINE", member: `${f.material_code ?? ""} ${f.material_name}`.trim(), qty: f.qty, uom: f.uom, vendor: f.vendor, po_by: f.po_by, covers: f.covers, why: f.reason, late: f.late });
        }
        for (const l of userLots) {
          push(l.plant_eta, { kind: "YOU", member: `${l.material_code ?? ""} ${l.material_name}`.trim(), qty: round(l.qty_base), uom: l.uom, vendor: l.vendor_label, why: "Your quantity" });
        }
        return grid.map((g) => ({ ...g, events: events.get(g.day) ?? [] }));
      })(),
      member_daily: memberDaily,
      arrivals: buildArrivals(),
      future_orders: futureOrders,
      transfers,
      alternatives,
      user_lots: userLots,
      prediction,
      // Owner 2026-10-21: why the engine places no lot for a member (stock may still run out).
      plan_gaps: memberIds.map((id) => {
        const row = rowById.get(id);
        const issues: string[] = [];
        if (row?.policy?.target_cov_days === null || row?.policy?.target_cov_days === undefined || row?.policy?.critical_cov_days === null || row?.policy?.critical_cov_days === undefined) issues.push("NO_TARGET_CRITICAL");
        if ((vendorOptions.get(id) ?? []).length === 0) issues.push("NO_VENDOR");
        else if (plan.buys.some((b) => b.material_id === id && b.status === "UNKNOWN_LEAD_TIME")) issues.push("NO_LEAD_TIME");
        const shortage = plan.risks.find((r) => r.material_id === id)?.first_shortage_day ?? null;
        return { material_id: id, material_code: codeOf(id), material_name: nameOf(id), issues, first_shortage_day: shortage };
      }).filter((g) => g.issues.length > 0),
      vendor_choices: vendorChoices,
      metrics,
      unit_cost_for_metrics: unitCosts.length ? Math.min(...unitCosts) : null,
      transfer_note: "Shop floor S00n is fed from store R00n (assumption); packing locations P00n balance among themselves (P ↔ P). Advice only — the Store posts the transfer.",
      // Engine proposals with the current lot rule (P2 replaces this with the Engine + AI plan).
      proposals: plan.buys.filter((b) => memberSet.has(b.material_id) && (b.status === "ADVISORY" || b.status === "ADVISORY_LATE")),
      risks: plan.risks.filter((r) => memberSet.has(r.material_id)),
      calculated_at: new Date().toISOString(),
    };
}

export async function saveInboundRescheduleHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_RESCHEDULE, "WRITE")) {
      return fail(req, ctx, "MTS_RESCHEDULE_FORBIDDEN", 403, "You cannot reschedule arrivals for this company.");
    }
    const rows = (Array.isArray(body.rows) ? body.rows as JsonRecord[] : []).map((row) => ({
      reschedule_key: text(row.reschedule_key),
      material_id: text(row.material_id),
      original_eta: text(row.original_eta) || null,
      rescheduled_eta: text(row.rescheduled_eta) || null,
      reason: text(row.reason) || null,
    }));
    if (rows.length === 0) return fail(req, ctx, "MTS_RESCHEDULE_NO_ROWS", 400, "Nothing to save.");
    if (rows.length > MAX_RESCHEDULE_ROWS) return fail(req, ctx, "MTS_RESCHEDULE_TOO_MANY_ROWS", 400, `At most ${MAX_RESCHEDULE_ROWS} rows per save.`);
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_inbound_eta_reschedule", {
      p_company_id: companyId, p_actor: ctx.auth_user_id, p_rows: rows,
    });
    if (error) {
      const code = /\b(MTS_RESCHEDULE_[A-Z_]+|PLANNING_APPEND_ONLY)\b/.exec(String(error.message ?? ""))?.[1];
      if (code) return fail(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_[A-Z_]+):\s*/, ""));
      throw new Error("MTS_RESCHEDULE_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_RESCHEDULE_SAVE_FAILED", "Could not save the rescheduled dates.");
  }
}

// GET /api/procurement/mts-requirement/item-plan/other-companies?company_id&plan_month&as_of&material_ids=a,b
// Spare stock of the same materials in the user's other companies (owner: suggestion only).
export async function getMtsItemPlanOtherCompaniesHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    const materialIds = unique(text(url.searchParams.get("material_ids")).split(",").map((v) => v.trim())).slice(0, 50);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    if (materialIds.length === 0) return fail(req, ctx, "MTS_ITEM_PLAN_MATERIAL_REQUIRED", 400, "material_ids is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(url, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);

    // Companies where these materials are mapped; only those inside the user's own scope + PO22 access.
    const mapRows = await fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient.schema("erp_master").from("material_company_ext")
      .select("company_id, material_id").eq("status", "ACTIVE").in("material_id", chunk));
    const candidates = unique(mapRows.map((r) => text(r.company_id))).filter((id) => id !== companyId);
    const checks = await Promise.all(candidates.map(async (other) => {
      try { await assertCompanyScope(ctx, other); } catch { return null; }
      return await canMaintainCompanyResource(ctx, other, "PROC_MTS_REQUIREMENT", "VIEW") ? other : null;
    }));
    const allowed = checks.filter((id): id is string => Boolean(id));
    const companyRows = allowed.length === 0 ? [] : await fetchInChunks<JsonRecord>(allowed, (chunk) => serviceRoleClient.schema("erp_master")
      .from("companies").select("id, company_code, company_name").in("id", chunk));
    const label = new Map(companyRows.map((c) => [text(c.id), [text(c.company_code), text(c.company_name)].filter(Boolean).join(" — ")]));
    const perCompany = await Promise.all(allowed.map(async (other) => {
      const results: JsonRecord[] = [];
      try {
        const plan = await computePlanning({ companyId: other, ...parsed.params! });
        const rows = plan._internal.projection.rows;
        for (const id of materialIds) {
          const mine = rows.filter((r) => r.material_id === id).map((r) => ({ closing: r.closing_qty_base, use: r.demand_qty_base, target_days: r.target_days }));
          const spare = mine.length ? companySpare(mine) : Number(plan._internal.req.output.rows.find((r) => r.material_id === id)?.stock.usable_at_required ?? 0);
          if (spare > 0) {
            results.push({
              company_id: other, company: label.get(other) ?? "—", material_id: id,
              material_name: text(plan._internal.req.materialRows.get(id)?.material_name) || "—",
              spare_qty: round(spare), basis: mine.length ? "ABOVE_OWN_TARGET_THROUGH_HORIZON" : "NOT_USED_THERE",
            });
          }
        }
      } catch (error) {
        console.error("[mts_item_plan] other company spare failed", other, error instanceof Error ? error.message : error);
      }
      return results;
    }));
    const results = perCompany.flat();
    return okResponse({ companies_checked: allowed.map((id) => label.get(id) ?? "—"), spare: results, note: "Suggestion only — raise the STO / Sub-CSN yourself." }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_ITEM_PLAN_OTHER_FAILED", "Could not check the other companies.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 (owner 2026-10-20): the user's plan edits (versions) and the Engine + AI review.
// ─────────────────────────────────────────────────────────────────────────────
const RESOURCE_ITEM_PLAN_EDIT = "PROC_MTS_ITEM_PLAN_EDIT";
const ITEM_PLAN_AI_MAX_OUTPUT_TOKENS = 1500;

function readManualLots(raw: unknown): OptimizerManualLot[] {
  return (Array.isArray(raw) ? raw as JsonRecord[] : []).slice(0, 200).map((l) => ({
    material_id: text(l.material_id), plant_eta: text(l.plant_eta).slice(0, 10), qty_base: Number(l.qty_base ?? l.qty ?? 0), vendor_id: text(l.vendor_id) || null,
  })).filter((l) => l.material_id && /^\d{4}-\d{2}-\d{2}$/.test(l.plant_eta) && Number.isFinite(l.qty_base) && l.qty_base > 0);
}

// POST /api/procurement/mts-requirement/item-plan/scenario  { company_id, material_id, manual_lots, source?, note? }
export async function saveMtsItemPlanScenarioHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    const materialId = text(body.material_id);
    if (!companyId || !materialId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id and material_id are required.");
    await assertCompanyScope(ctx, companyId);
    if (!await canMaintainCompanyResource(ctx, companyId, RESOURCE_ITEM_PLAN_EDIT, "WRITE")) {
      return fail(req, ctx, "MTS_SCENARIO_FORBIDDEN", 403, "You cannot change the plan for this company.");
    }
    const lots = readManualLots(body.manual_lots);
    // Every lot must be for a material mapped to this company (never another company's item).
    const ids = unique(lots.map((l) => l.material_id));
    if (ids.length) {
      const mapped = await fetchInChunks<JsonRecord>(ids, (chunk) => serviceRoleClient.schema("erp_master").from("material_company_ext")
        .select("material_id").eq("company_id", companyId).eq("status", "ACTIVE").in("material_id", chunk));
      const ok = new Set(mapped.map((m) => text(m.material_id)));
      if (ids.some((id) => !ok.has(id))) return fail(req, ctx, "MTS_SCENARIO_MATERIAL_NOT_IN_COMPANY", 400, "A lot is for a material not mapped to this company.");
    }
    const source = text(body.source) === "AI_APPLIED" ? "AI_APPLIED" : "USER";
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_mts_item_plan_scenario", {
      p_company_id: companyId, p_material_id: materialId, p_actor: ctx.auth_user_id,
      p_overrides: { manual_lots: lots }, p_source: source, p_note: text(body.note).slice(0, 500) || null,
    });
    if (error) {
      const code = /\b(MTS_SCENARIO_[A-Z_]+)\b/.exec(String(error.message ?? ""))?.[1];
      if (code) return fail(req, ctx, code, 400, String(error.message).replace(/^.*?(MTS_[A-Z_]+):\s*/, ""));
      throw new Error("MTS_SCENARIO_SAVE_FAILED");
    }
    return okResponse({ result: data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_SCENARIO_SAVE_FAILED", "Could not save the plan changes.");
  }
}

// GET /api/procurement/mts-requirement/item-plan/scenarios?company_id&material_id  (plan versions)
export async function listMtsItemPlanScenariosHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    const materialId = text(url.searchParams.get("material_id"));
    if (!companyId || !materialId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id and material_id are required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_item_plan_scenario")
      .select("id, version_no, is_current, source, note, overrides, created_by, created_at")
      .eq("company_id", companyId).eq("material_id", materialId).order("version_no", { ascending: false }).limit(100);
    if (error) throw new Error("MTS_SCENARIO_LOAD_FAILED");
    const rows = (data ?? []) as JsonRecord[];
    const users = await resolveUserDisplayNames(rows.map((r) => text(r.created_by)));
    return okResponse({
      rows: rows.map(({ created_by, overrides, ...r }) => ({
        ...r, lot_count: Array.isArray((overrides as JsonRecord | null)?.manual_lots) ? ((overrides as JsonRecord).manual_lots as unknown[]).length : 0,
        created_by_name: users.get(text(created_by)) ?? "—",
      })),
    }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_SCENARIO_LOAD_FAILED", "Could not list plan versions.");
  }
}

// POST /api/procurement/mts-requirement/item-plan/ai-review
//   { company_id, plan_month, as_of, demand_at?, material_id, manual_lots?, question? }
// Engine plan (+ the user's lots, saved or a draft) → AI verdict + proposed lots → the engine
// re-simulates the proposal and returns the real effect (before / after). Nothing is saved.
export async function reviewMtsItemPlanWithAiHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    const materialId = text(body.material_id);
    if (!companyId || !materialId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id and material_id are required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    if (process.env.AI_CORE_ENABLED !== "true") return fail(req, ctx, "AI_NOT_ENABLED", 403, "AI planning is switched off for this environment.");
    const parsed = readParams(body, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    const lots = Array.isArray(body.manual_lots) ? readManualLots(body.manual_lots) : (await loadCurrentScenario(companyId, materialId)).manual_lots;
    const before = await buildItemPlan(companyId, parsed.params!, materialId, lots, { reuseLoads: true });

    const codeOf = new Map(before.members.map((m) => [m.material_id, m.material_code]));
    const prompt = buildItemPlanAiPrompt({
      item_label: before.members.find((m) => m.is_selected)?.material_name ?? "—",
      is_family: before.family.is_family, groups: before.family.groups.map((g) => g.label),
      uom: before.members.find((m) => m.is_selected)?.uom ?? null,
      horizon: { from: before.calendar.as_of, to: before.calendar.horizon_end },
      members: before.members.map((m) => ({ code: m.material_code, name: m.material_name, exclusive: m.exclusive, groups: m.groups, stock: m.usable_stock, target_days: m.target_days, critical_days: m.critical_days })),
      weekly: weeklySummary(before.grid),
      arrivals: before.arrivals.map((a) => ({ code: a.material_code, reference: a.reference, status: a.status, qty: a.qty, eta_plant: a.rescheduled_eta ?? a.eta_plant, advice: a.advice?.reason ?? null })),
      future_orders: before.future_orders.map((f) => ({ code: f.material_code, vendor: f.vendor, qty: f.qty, po_by: f.po_by, eta_plant: f.eta_plant, bridge: f.bridge, late: f.late, max_days_planned: f.max_days_planned, unit_total_cost: f.unit_total_cost, freight_term: f.freight_term, cost_missing: f.cost_missing })),
      user_lots: before.user_lots.map((l) => ({ code: codeOf.get(l.material_id) ?? null, plant_eta: l.plant_eta, qty: l.qty_base })),
      alternatives: before.alternatives.flatMap((a) => a.options.map((o) => `${a.material_code ?? ""} ${o.kind}: ${o.detail}`)),
      metrics: before.metrics, question: text(body.question) || null,
    });

    const ai = await runBudgetedAi(companyId, prompt);
    if (!ai.ok) return fail(req, ctx, ai.code, ai.status, ai.message);
    const { text: aiText, model } = ai;

    const codeToMaterial = new Map(before.members.filter((m) => m.material_code).map((m) => [m.material_code as string, m.material_id]));
    const parsedAi = parseAiLots(aiText, codeToMaterial, { from: before.calendar.as_of, to: before.calendar.horizon_end });
    // The engine, not the AI, says what the proposal does.
    let after: JsonRecord | null = null;
    if (parsedAi.lots.length) {
      const simulated = await buildItemPlan(companyId, parsed.params!, materialId, [...lots, ...parsedAi.lots.map((l) => ({ material_id: l.material_id, plant_eta: l.plant_eta, qty_base: l.qty, vendor_id: null }))], { reuseLoads: true });
      after = { metrics: simulated.metrics, future_orders: simulated.future_orders };
    }
    return okResponse({
      verdict: parsedAi.verdict, proposed_lots: parsedAi.lots, rejected: parsedAi.rejected,
      metrics_before: before.metrics, metrics_after: after?.metrics ?? null, future_orders_after: after?.future_orders ?? null,
      model, note: "AI proposals are re-simulated by the engine. Nothing is saved until you apply them; no PO is created.",
    }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_ITEM_PLAN_MATERIAL_NOT_PLANNED") return fail(req, ctx, error.message, 404, "This material is not used by this company's planned MTS products.");
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_ITEM_PLAN_AI_FAILED", "Could not prepare the AI review.");
  }
}

/**
 * One AI call inside the company's monthly token budget (reserve → call → settle).
 * Shared by the AI plan review and the what-if Target verdict.
 */
async function runBudgetedAi(companyId: string, prompt: string, maxTokens = ITEM_PLAN_AI_MAX_OUTPUT_TOKENS):
  Promise<{ ok: true; text: string; model: string } | { ok: false; code: string; status: number; message: string }> {
  const cap = Math.max(1, Number(process.env.PO22_AI_MONTHLY_TOKEN_CAP ?? 1_000_000) || 1_000_000);
  const reserve = Math.ceil(prompt.length / 3) + maxTokens;
  const month = `${todayInIndia().slice(0, 7)}-01`;
  const { data: reserved, error: reserveError } = await serviceRoleClient.schema("erp_planning").rpc("reserve_mts_ai_budget", {
    p_company_id: companyId, p_month: month, p_tokens: reserve, p_cap: cap,
  });
  if (reserveError) {
    console.error("[mts_item_plan] AI_BUDGET_UNAVAILABLE", reserveError.code ?? "", reserveError.message ?? "");
    return { ok: false, code: "AI_BUDGET_UNAVAILABLE", status: 503, message: "AI budget tracking is not available. The engine plan still works." };
  }
  if (reserved !== true) return { ok: false, code: "AI_BUDGET_EXCEEDED", status: 429, message: "This company's monthly AI budget is used up. The engine plan still works." };
  let used = 0;
  try {
    const result = await generateAiText({ prompt, maxTokens, maxPromptChars: ITEM_PLAN_AI_MAX_PROMPT_CHARS });
    used = result.usage.input_tokens + result.usage.output_tokens;
    return { ok: true, text: result.text, model: result.model };
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : "UNAVAILABLE";
    return code === "NOT_CONFIGURED"
      ? { ok: false, code: "AI_NOT_CONFIGURED", status: 503, message: "The AI planner is not available right now. The engine plan still works." }
      : { ok: false, code: "AI_PROVIDER_UNAVAILABLE", status: 502, message: "The AI planner is not available right now. The engine plan still works." };
  } finally {
    const { error: settleError } = await serviceRoleClient.schema("erp_planning").rpc("settle_mts_ai_budget", { p_company_id: companyId, p_month: month, p_reserved: reserve, p_used: used });
    if (settleError) console.error("[mts_item_plan] AI budget settle failed", settleError.code ?? "", settleError.message ?? "");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner 2026-10-21: simulations — see the effect before saving anything.
// ─────────────────────────────────────────────────────────────────────────────
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SIM_RESCHEDULES = 100;
const MAX_TARGET_CANDIDATES = 5;

/** [{ reschedule_key, date }] → key → date (null / empty = back to the source date). */
function readReschedules(raw: unknown): { map: Map<string, string | null>; error?: string } {
  const rows = Array.isArray(raw) ? raw as JsonRecord[] : [];
  if (rows.length > MAX_SIM_RESCHEDULES) return { map: new Map(), error: `At most ${MAX_SIM_RESCHEDULES} moved arrivals per preview.` };
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const key = text(row.reschedule_key);
    const date = text(row.date ?? row.rescheduled_eta).slice(0, 10) || null;
    if (!key) continue;
    if (date !== null && !ISO_DAY.test(date)) return { map, error: "A moved date is not a valid date." };
    map.set(key, date);
  }
  return { map };
}

/** [{ material_id, target_days, critical_days }] → what-if policy days (simulation only). */
function readPolicyOverrides(raw: unknown): { map: Map<string, PolicyOverride>; error?: string } {
  const rows = (Array.isArray(raw) ? raw as JsonRecord[] : []).slice(0, 50);
  const map = new Map<string, PolicyOverride>();
  for (const row of rows) {
    const id = text(row.material_id);
    if (!id) continue;
    const days = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const target = days(row.target_days);
    const critical = days(row.critical_days);
    for (const d of [target, critical]) if (d !== null && (!Number.isFinite(d) || d < 0 || d > 365)) return { map, error: "Days must be between 0 and 365." };
    if (target !== null && critical !== null && critical > target) return { map, error: "Critical days cannot be more than Target days." };
    map.set(id, { target_cov_days: target, critical_cov_days: critical });
  }
  return { map };
}

function simulationError(req: Request, ctx: ReqHandlerContext, error: unknown, fallbackCode: string, fallbackMessage: string): Response {
  if (error instanceof Error && error.message === "MTS_ITEM_PLAN_MATERIAL_NOT_PLANNED") return fail(req, ctx, error.message, 404, "This material is not used by this company's planned MTS products.");
  if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
  return handleError(req, ctx, error, fallbackCode, fallbackMessage);
}

// POST /api/procurement/mts-requirement/item-plan/simulate
//   { company_id, plan_month, as_of, demand_at?, material_id, manual_lots?, reschedules?, target_overrides? }
// The full item plan as it would be with these changes. Nothing is saved.
export async function simulateMtsItemPlanHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    const materialId = text(body.material_id);
    if (!companyId || !materialId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id and material_id are required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(body, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    const reschedules = readReschedules(body.reschedules);
    if (reschedules.error) return fail(req, ctx, "MTS_SIM_INVALID_RESCHEDULE", 400, reschedules.error);
    const overrides = readPolicyOverrides(body.target_overrides);
    if (overrides.error) return fail(req, ctx, "MTS_SIM_INVALID_DAYS", 400, overrides.error);
    const lots = Array.isArray(body.manual_lots) ? readManualLots(body.manual_lots) : (await loadCurrentScenario(companyId, materialId)).manual_lots;

    const plan = await buildItemPlan(companyId, parsed.params!, materialId, lots, { rescheduleOverrides: reschedules.map, policyOverrides: overrides.map, reuseLoads: true });
    return okResponse({
      ...plan, simulated: true,
      note: "Preview only — nothing is saved, CSN Tracker is not changed and no PO is created.",
    }, ctx.request_id, req);
  } catch (error) {
    return simulationError(req, ctx, error, "MTS_ITEM_PLAN_SIM_FAILED", "Could not calculate the preview.");
  }
}

// POST /api/procurement/mts-requirement/item-plan/what-if-target
//   { company_id, plan_month, as_of, demand_at?, material_id, candidates: [15, 20, …], with_ai?: boolean }
// The engine re-plans the item at each Target (Critical kept, lowered only to stay ≤ Target),
// compares risk and money and recommends one; the AI may add a verdict. Nothing is saved.
export async function whatIfMtsItemPlanTargetHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    const materialId = text(body.material_id);
    if (!companyId || !materialId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id and material_id are required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(body, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    const candidates = [...new Set((Array.isArray(body.candidates) ? body.candidates : []).map((v) => Math.round(Number(v))))]
      .filter((v) => Number.isFinite(v) && v >= 1 && v <= 365);
    if (candidates.length === 0) return fail(req, ctx, "MTS_WHATIF_NO_CANDIDATES", 400, "Give at least one Target days value to try.");
    if (candidates.length > MAX_TARGET_CANDIDATES) return fail(req, ctx, "MTS_WHATIF_TOO_MANY", 400, `At most ${MAX_TARGET_CANDIDATES} values at a time.`);
    const lots = (await loadCurrentScenario(companyId, materialId)).manual_lots;

    const current = await buildItemPlan(companyId, parsed.params!, materialId, lots, { reuseLoads: true });
    const selected = current.members.find((m) => m.is_selected);
    const currentTarget = selected?.target_days ?? null;
    const currentCritical = selected?.critical_days ?? null;
    const summarise = (plan: Awaited<ReturnType<typeof buildItemPlan>>, target: number, critical: number | null, isCurrent: boolean): TargetCandidateResult => {
      const valued = plan.future_orders.filter((f) => f.unit_total_cost !== null);
      return {
        target_days: target, critical_days: critical, is_current: isCurrent,
        // Days at / below Critical are always counted against today's Critical so candidates compare.
        metrics: planMetrics(plan.grid, target, plan.unit_cost_for_metrics, currentCritical),
        order_count: plan.future_orders.length,
        order_qty: round(plan.future_orders.reduce((sum, f) => sum + f.qty, 0)),
        order_value: valued.length ? Math.round(valued.reduce((sum, f) => sum + f.qty * (f.unit_total_cost as number), 0) * 100) / 100 : null,
        order_value_partial: valued.length > 0 && valued.length < plan.future_orders.length,
      };
    };
    const tries = candidates.filter((t) => t !== currentTarget);
    const runs = await Promise.all(tries.map(async (target) => {
      const critical = currentCritical === null ? null : Math.min(currentCritical, target);
      const plan = await buildItemPlan(companyId, parsed.params!, materialId, lots, {
        policyOverrides: new Map([[materialId, { target_cov_days: target, critical_cov_days: critical }]]), reuseLoads: true,
      });
      return summarise(plan, target, critical, false);
    }));
    const results = [
      ...(currentTarget !== null ? [summarise(current, currentTarget, currentCritical, true)] : []),
      ...runs,
    ].sort((a, b) => a.target_days - b.target_days);
    const enginePick = pickTargetCandidate(results);

    let ai: { verdict: string | null; model: string | null; error: string | null } = { verdict: null, model: null, error: null };
    if (body.with_ai === true) {
      if (process.env.AI_CORE_ENABLED !== "true") ai = { ...ai, error: "AI planning is switched off for this environment." };
      else {
        const prompt = buildWhatIfTargetPrompt({
          item_label: selected?.material_name ?? "—", uom: selected?.uom ?? null,
          horizon: { from: current.calendar.as_of, to: current.calendar.horizon_end },
          current_target: currentTarget, current_critical: currentCritical, results, engine_pick: enginePick,
        });
        const answer = await runBudgetedAi(companyId, prompt, 600);
        ai = answer.ok ? { verdict: answer.text.trim(), model: answer.model, error: null } : { ...ai, error: answer.message };
      }
    }
    return okResponse({
      material_id: materialId, material_name: selected?.material_name ?? "—", uom: selected?.uom ?? null,
      current_target_days: currentTarget, current_critical_days: currentCritical,
      results, engine_pick: enginePick, ai_verdict: ai.verdict, ai_model: ai.model, ai_error: ai.error,
      note: "Engine numbers for each Target. Nothing is saved — 'Use' saves the chosen days as the item's policy.",
    }, ctx.request_id, req);
  } catch (error) {
    return simulationError(req, ctx, error, "MTS_WHATIF_FAILED", "Could not compare the Target days.");
  }
}

// POST /api/procurement/mts-requirement/planning/reschedule-preview
//   { company_id, plan_month, as_of, demand_at?, reschedules: [{ reschedule_key, date }] }
// Planning-page CSN / PO arrivals moved earlier (prepone) or later (postpone): before vs after
// per affected material. Nothing is saved; Save uses the normal reschedule endpoint.
export async function previewPlanningRescheduleHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(body, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);
    const reschedules = readReschedules(body.reschedules);
    if (reschedules.error) return fail(req, ctx, "MTS_SIM_INVALID_RESCHEDULE", 400, reschedules.error);
    if (reschedules.map.size === 0) return fail(req, ctx, "MTS_RESCHEDULE_NO_ROWS", 400, "Move at least one arrival.");

    const [before, after] = await Promise.all([
      computePlanning({ companyId, ...parsed.params! }),
      computePlanning({ companyId, ...parsed.params!, rescheduleOverrides: reschedules.map }),
    ]);
    const moved = new Map<string, Array<{ reference: string; qty: number; from: string | null; to: string | null }>>();
    for (const row of before._internal.req.output.rows) {
      for (const event of row.inbound_events) {
        if (!event.reschedule_key || !reschedules.map.has(event.reschedule_key)) continue;
        const source = event.original_date !== undefined ? event.original_date : event.date;
        moved.set(row.material_id, [...(moved.get(row.material_id) ?? []), {
          reference: event.reference, qty: round(event.qty), from: event.date, to: reschedules.map.get(event.reschedule_key) ?? source,
        }]);
      }
    }
    const lowestMin = (rows: typeof before._internal.projection.rows, id: string) => {
      const days = rows.filter((r) => r.material_id === id).map((r) => r.min_cover_days).filter((d): d is number => d !== null);
      return days.length ? Math.min(...days) : null;
    };
    const state = (plan: typeof before, id: string) => {
      const risk = plan._internal.projection.risks.find((r) => r.material_id === id);
      const buys = plan.buys.filter((b) => b.material_id === id && (b.status === "ADVISORY" || b.status === "ADVISORY_LATE"));
      return {
        first_shortage_day: risk?.first_shortage_day ?? null,
        first_below_critical_day: risk?.first_below_critical_day ?? null,
        first_below_target_day: risk?.first_below_target_day ?? null,
        lowest_min_days: lowestMin(plan._internal.projection.rows, id),
        new_orders: buys.length,
        first_po_by: buys.map((b) => b.recommended_po_by).filter(Boolean).sort()[0] ?? null,
      };
    };
    const ids = unique([...before._internal.projection.risks.map((r) => r.material_id), ...after._internal.projection.risks.map((r) => r.material_id), ...moved.keys()]);
    const nameOf = (id: string) => text(before._internal.req.materialRows.get(id)?.material_name) || "—";
    const codeOf = (id: string) => text(before._internal.req.materialRows.get(id)?.pace_code) || null;
    const rows = ids.map((id) => ({ id, b: state(before, id), a: state(after, id) }))
      .filter(({ id, b, a }) => moved.has(id) || JSON.stringify(b) !== JSON.stringify(a))
      .map(({ id, b, a }) => ({
        material_id: id, material_name: nameOf(id), material_code: codeOf(id),
        uom: text(before._internal.req.materialRows.get(id)?.base_uom_code) || null,
        moved: moved.get(id) ?? [], before: b, after: a,
      }))
      .sort((x, y) => Number(y.moved.length > 0) - Number(x.moved.length > 0) || x.material_name.localeCompare(y.material_name));
    return okResponse({
      rows, note: "Preview only — nothing is saved and CSN Tracker is not changed. Save keeps the new dates on the Planning side.",
    }, ctx.request_id, req);
  } catch (error) {
    return simulationError(req, ctx, error, "MTS_RESCHEDULE_PREVIEW_FAILED", "Could not calculate the preview.");
  }
}
