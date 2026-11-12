/*
 * PO22 — Rolling Plan export data (owner 2026-10-21).
 *   GET /api/procurement/mts-requirement/rolling-plan?company_id&plan_month&as_of&demand_at
 * One company per call; the frontend joins all the user's companies into one Excel file (the old
 * "rolling_plan" workbook: PLAN, family / item planning blocks with Prediction, RM_PM requirement,
 * plus Summary, Buy Plan, Store Instructions and Arrivals).
 * One Engine run per company (CM + NM + 4 months = six months, every saved user lot and reschedule included);
 * every block is derived from that run, so the file shows exactly what the screens show.
 * Read-only: never creates a PO, CSN, transfer or stock posting.
 */
import { actionText, bestDateText, bestDateWhy, ifAbsentText, togetherText } from "./mts_best_date_text.logic.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import { arrivalStatus, dayRange, familyClosure, familyDayGrid, poNumberOfReference } from "./mts_item_plan.logic.ts";
import type { OptimizerManualLot } from "./mts_optimizer_phase3d.types.ts";
import { computePlanning, PLANNING_EXTRA_MONTHS, readParams } from "./mts_planning.handlers.ts";
import { groupCoveredBy, isTransferFed } from "./mts_requirement.logic.ts";
import { loadBulkMaterialIds } from "./mts_bulk_materials.ts";
import { memberMattersForGaps } from "./mts_planning.logic.ts";
import { fail, handleError, type ReqHandlerContext, requireRequirementViewAccess, todayInIndia } from "./mts_requirement.handlers.ts";
import { buildWaterfallView } from "./mts_waterfall_view.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];
const round = (value: number) => Math.round(value * 1000) / 1000;
/** Order UoM (owner 2026-10-22): the same quantity in the unit it is ordered in. */
const inOrderUnit = (qty: number | null, unit: { base_per_order_unit: number } | null | undefined) =>
  qty === null || !unit ? null : round(qty / unit.base_per_order_unit);
const EPSILON_USE = 1e-9;
const addDaysIso = (day: string | null, n: number | null) => (day && n !== null ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : null);

/**
 * Rolling plan horizon = CM + NM + 4 months = six calendar months (owner 2026-10-28: "planning from today for 6 months,
 * demand as far as the PO21 plan goes"). A month without a PO21 plan has zero demand. Same as the Item Plan.
 */
const ROLLING_EXTRA_MONTHS = PLANNING_EXTRA_MONTHS;

/** Every user lot of every item of the company (current plan versions). */
async function loadAllCurrentLots(companyId: string): Promise<OptimizerManualLot[]> {
  const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_item_plan_scenario")
    .select("overrides").eq("company_id", companyId).eq("is_current", true).limit(5000);
  if (error) {
    const code = String((error as { code?: string }).code ?? "");
    if (code === "42P01" || code === "PGRST205" || code === "PGRST106") return [];
    throw new Error("MTS_SCENARIO_LOAD_FAILED");
  }
  const lots: OptimizerManualLot[] = [];
  for (const row of (data ?? []) as JsonRecord[]) {
    const list = (row.overrides as { manual_lots?: JsonRecord[] } | null)?.manual_lots ?? [];
    for (const l of list) {
      const lot = { material_id: text(l.material_id), plant_eta: text(l.plant_eta).slice(0, 10), qty_base: Number(l.qty_base ?? 0), vendor_id: text(l.vendor_id) || null };
      if (lot.material_id && /^\d{4}-\d{2}-\d{2}$/.test(lot.plant_eta) && lot.qty_base > 0) lots.push(lot);
    }
  }
  return lots;
}

export async function getMtsRollingPlanHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const parsed = readParams(url, todayInIndia());
    if (parsed.error) return fail(req, ctx, parsed.error[0], 400, parsed.error[1]);

    const [userLots, companyRes] = await Promise.all([
      loadAllCurrentLots(companyId),
      serviceRoleClient.schema("erp_master").from("companies").select("company_code, company_name").eq("id", companyId).maybeSingle(),
    ]);
    const plan = await computePlanning({ companyId, ...parsed.params!, extraMonths: ROLLING_EXTRA_MONTHS, manualLots: userLots, scheduleChecks: true });
    const { req: reqData, projection, assembly, calendar, vendorOptions, selections } = plan._internal;
    const mattersForGaps = (m: string) => {
      const rowsOf = projection.rows.filter((r) => r.material_id === m);
      return memberMattersForGaps({
        opening_qty: Number(rowsOf[0]?.opening_qty_base ?? 0),
        horizon_demand_qty: rowsOf.reduce((sum, r) => sum + r.demand_qty_base, 0),
        selected_any_month: [...selections.values()].some((set) => set.has(m)),
      });
    };
    // Owner 2026-11-03: a group member the buyer never ticked in the monthly Selection can never get a new engine lot
    // (planner rule); the sheet must say so instead of staying silent while the item runs out.
    const selectionControlled = new Set(
      [...reqData.masters.groupMembers.values()].flat()
        .filter((member) => member.active && reqData.materials.get(member.material_id)?.status !== "INACTIVE")
        .map((member) => member.material_id),
    );
    const company = (companyRes.data ?? {}) as JsonRecord;
    const nameOf = (id: string) => text(reqData.materialRows.get(id)?.material_name) || "—";
    // Owner 2026-10-26: every quantity in the material's display (Order) UoM; calculations stay in base.
    const displayUnits = plan.display_units as Record<string, { uom_code: string; base_per_unit: number }>;
    const unitOf = (id: string | null | undefined) => (id ? displayUnits[id] ?? null : null);
    const baseUomOf = (id: string) => text(reqData.materialRows.get(id)?.base_uom_code) || null;
    const uomOf = (id: string) => unitOf(id)?.uom_code ?? baseUomOf(id);
    const inUnit = (unit: { base_per_unit: number } | null, qty: number | null | undefined) => (qty === null || qty === undefined ? null : unit ? round(qty / unit.base_per_unit) : round(qty));
    const dq = (id: string | null | undefined, qty: number | null | undefined) => inUnit(unitOf(id), qty);
    /** A family grid sums members: one unit only when every member shows the same one, else base. */
    const familyUnit = (ids: string[]) => {
      const units = ids.map(unitOf);
      if (units.length === 0 || units.some((u) => !u)) return null;
      return units.every((u) => u!.uom_code === units[0]!.uom_code && u!.base_per_unit === units[0]!.base_per_unit) ? units[0] : null;
    };
    /** A buy / lot in the unit it is ordered in, else the display unit. */
    const shownLot = (id: string, qtyBase: number | null | undefined, orderUnit: { base_per_order_unit: number; order_uom_code: string } | null | undefined) => (orderUnit
      ? { qty: inOrderUnit(qtyBase ?? null, orderUnit), uom: orderUnit.order_uom_code, per: orderUnit.base_per_order_unit }
      : { qty: dq(id, qtyBase), uom: uomOf(id), per: unitOf(id)?.base_per_unit ?? 1 });
    const rowById = new Map(reqData.output.rows.map((r) => [r.material_id, r]));
    const days = dayRange(calendar.asOf, calendar.horizonEnd);

    // Supplier of a PO / CSN arrival, port → plant days, group labels — one bulk round.
    const csnIds = unique(reqData.output.rows.flatMap((r) => r.inbound_events.map((e) => e.csn_id)));
    const materialIds = reqData.output.rows.map((r) => r.material_id);
    const groupIds = unique([...reqData.masters.groupMembers.keys()]);
    const [poRows, csnRows, heldCsnRows, historyCsns, groupRows] = await Promise.all([
      serviceRoleClient.schema("erp_procurement").from("purchase_order").select("po_number, vendor_id").eq("company_id", companyId).eq("status", "CONFIRMED").limit(10000),
      csnIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(csnIds, (chunk) => serviceRoleClient
        .schema("erp_procurement").from("consignment_note").select("id, vendor_id, csn_type, etd, bl_date, eta_at_port, ata_at_port, eta_to_plant_calculated").in("id", chunk)),
      serviceRoleClient.schema("erp_procurement").from("consignment_note")
        .select("csn_number, material_id, vendor_id, dispatch_qty, po_qty, po_uom_code, hold_reason, inactive_from_status, inactive_at, eta_to_plant_calculated")
        .or(`company_id.eq.${companyId},consignee_company_id.eq.${companyId}`).eq("status", "HLD").order("inactive_at", { ascending: false }).limit(10000),
      materialIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient
        .schema("erp_procurement").from("consignment_note").select("material_id, ata_at_port, eta_at_port, gate_entry_date")
        .eq("company_id", companyId).eq("status", "GRD").not("gate_entry_date", "is", null).in("material_id", chunk)),
      groupIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
    ]);
    if (poRows.error) throw new Error("MTS_ROLLING_PO_LOAD_FAILED");
    const pos = (poRows.data ?? []) as JsonRecord[];
    if (heldCsnRows.error) throw new Error("MTS_ROLLING_HELD_CSN_LOAD_FAILED");
    const heldCsns = (heldCsnRows.data ?? []) as JsonRecord[];
    const vendorIds = unique([...pos.map((p) => text(p.vendor_id)), ...csnRows.map((c) => text(c.vendor_id)), ...heldCsns.map((c) => text(c.vendor_id))]);
    const vendorRows = vendorIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient
      .schema("erp_master").from("vendor_master").select("id, vendor_name").in("id", chunk));
    const vendorName = new Map(vendorRows.map((v) => [text(v.id), text(v.vendor_name) || "—"]));
    const vendorByPo = new Map(pos.map((p) => [text(p.po_number), vendorName.get(text(p.vendor_id)) ?? null]));
    const vendorByCsn = new Map(csnRows.map((c) => [text(c.id), vendorName.get(text(c.vendor_id)) ?? null]));
    // CSN Tracker legs of every inbound piece: ATD (BL date) else ETD, ATA at port else ETA at port, ETA to plant (owner 2026-11-04).
    const recordedByCsn = new Map(csnRows.map((c) => {
      const d = (v: unknown) => text(v).slice(0, 10) || null;
      const atd = d(c.bl_date); const ata = d(c.ata_at_port);
      return [text(c.id), { etd: atd ?? d(c.etd), etd_actual: Boolean(atd), port: ata ?? d(c.eta_at_port), port_actual: Boolean(ata), plant: d(c.eta_to_plant_calculated), type: text(c.csn_type) }];
    }));
    const recOf = (csnId?: string | null) => (csnId ? recordedByCsn.get(csnId) ?? null : null);
    const held_csns = heldCsns.map((c) => ({
      csn_number: text(c.csn_number), material: nameOf(text(c.material_id)), supplier: vendorName.get(text(c.vendor_id)) ?? "—",
      qty: Number(c.dispatch_qty ?? c.po_qty ?? 0), uom: text(c.po_uom_code), previous_status: text(c.inactive_from_status),
      reason: text(c.hold_reason), held_at: text(c.inactive_at).slice(0, 10) || null, eta: text(c.eta_to_plant_calculated) || null,
    }));
    const groupLabel = new Map(groupRows.map((g) => [text(g.id), text(g.group_name) || text(g.group_code) || "—"]));
    const groupFullLabel = new Map(groupRows.map((g) => [text(g.id), [text(g.group_code), text(g.group_name)].filter(Boolean).join(" — ") || "—"]));
    const portToPlant = new Map<string, number>();
    for (const id of materialIds) {
      const gaps = historyCsns.filter((c) => text(c.material_id) === id)
        .map((c) => { const port = text(c.ata_at_port || c.eta_at_port).slice(0, 10); const gate = text(c.gate_entry_date).slice(0, 10); return port && gate ? (Date.parse(`${gate}T00:00:00Z`) - Date.parse(`${port}T00:00:00Z`)) / 86_400_000 : null; })
        .filter((g): g is number => g !== null && g >= 0 && g <= 60).sort((a, b) => a - b);
      if (gaps.length) portToPlant.set(id, Math.round(gaps[Math.floor(gaps.length / 2)]));
    }
    const supplierOf = (reference: string, csnId?: string) => {
      const po = poNumberOfReference(reference);
      return (csnId ? vendorByCsn.get(csnId) : null) ?? (po ? vendorByPo.get(po) ?? null : null);
    };
    // Owner 2026-10-26: for now the report leaves out Bulk RM — a material this company buys on
    // Bulk delivery POs (purchase_order.delivery_type = BULK).
    const bulkRm = await loadBulkMaterialIds(companyId);
    const optimumByKey = new Map(plan.reschedulable_arrivals.map((a) => [a.reschedule_key, a.optimum]));
    const windowByKey = new Map(plan.reschedulable_arrivals.map((a) => [a.reschedule_key, a.window]));
    const portByKey = new Map(plan.reschedulable_arrivals.map((a) => [a.reschedule_key, a.best_port_eta]));
    /** Days the recorded plant date is already past while nothing is shipped (owner 2026-10-29). */
    const overdueOf = (eta: string | null): number | null => (eta && /^\d{4}-\d{2}-\d{2}$/.test(eta) && eta < calendar.asOf
      ? Math.round((Date.parse(`${calendar.asOf}T00:00:00Z`) - Date.parse(`${eta}T00:00:00Z`)) / 86_400_000) : null);
    const bestText = (key: string | null | undefined, currentEta: string | null, unit: { base_per_unit: number; uom_code?: string } | null = null, uom = "KG"): string => {
      const o = key ? optimumByKey.get(key) : null;
      if (!o || (o.shift_days === 0 && !o.not_needed_in_plan)) return o ? bestDateText({ current_eta: currentEta, best_eta: o.best.eta, shift_days: 0, not_needed_in_plan: false, plan_end: o.plan_end, best_port_eta: portByKey.get(key as string) ?? null, talk_to_vendor: false, overdue_days: overdueOf(currentEta), shared_note: arrivalByKey.get(key as string)?.shared_note ?? null }) : "";
      const w = key ? windowByKey.get(key) : null;
      return bestDateText({ current_eta: currentEta, best_eta: o.best.eta, shift_days: o.shift_days, not_needed_in_plan: o.not_needed_in_plan, plan_end: o.plan_end, best_port_eta: portByKey.get(key as string) ?? null, talk_to_vendor: w?.state === "TALK_TO_VENDOR", overdue_days: overdueOf(currentEta), shared_note: arrivalByKey.get(key as string)?.shared_note ?? null,
        cover: o.plan_cover ? { plan_days: o.plan_cover.plan_days, left_with: inUnit(unit, o.plan_cover.stock_at_plan_end_with) ?? 0, left_without: o.plan_cover.stock_at_plan_end_without === null ? null : inUnit(unit, o.plan_cover.stock_at_plan_end_without), avg_daily_use: inUnit(unit, o.plan_cover.avg_daily_use) ?? 0, uom } : null });
    };
    const arrivalByKey = new Map(plan.reschedulable_arrivals.map((a) => [a.reschedule_key, a]));
    /** Owner 2026-10-29: the engine's dates for a not-yet-shipped piece as separate cells, with the reason beside them. */
    const bestCells = (key: string | null | undefined, currentEta: string | null, unit: { base_per_unit: number } | null, uom: string) => {
      const o = key ? optimumByKey.get(key) : null;
      const a = key ? arrivalByKey.get(key) : null;
      if (!o || !a) return { etd: "", port: "", plant: "", why: "", absent: "", action: "" };
      const absent = ifAbsentText(a.if_absent ?? [], currentEta, overdueOf(currentEta));
      if (o.not_needed_in_plan) return { etd: "", port: "", plant: "", why: bestText(key, currentEta, unit, uom), absent, action: actionText({ not_needed_in_plan: true, best_eta: o.best.eta, current_eta: currentEta, shift_days: o.shift_days }) };
      const w = key ? windowByKey.get(key) : null;
      const q = (n: number) => inUnit(unit, n) ?? 0;
      const binding = a.binding ? { ...a.binding, topup: a.binding.topup ? { ...a.binding.topup, wanted: q(a.binding.topup.wanted), shortfall: q(a.binding.topup.shortfall), pool_before: q(a.binding.topup.pool_before) } : null } : null;
      return {
        action: actionText({ not_needed_in_plan: false, best_eta: o.best.eta, current_eta: currentEta, shift_days: o.shift_days, overdue_days: overdueOf(currentEta), etd_passed_days: w && w.days_to_current_etd !== null && w.days_to_current_etd < 0 ? -w.days_to_current_etd : null, shared_note: a.shared_note ?? null, alone_eta: a.alone_best_eta ?? null }),
        absent, etd: a.best_etd ?? "", port: a.best_port_eta ?? "", plant: o.best.eta,
        why: bestDateWhy({ current_eta: currentEta, best_eta: o.best.eta, shift_days: o.shift_days, binding, uom, vendor_message: w?.state === "TALK_TO_VENDOR" ? w.message : null, joint_note: a.joint_note ?? null, overdue_days: overdueOf(currentEta), critical_latest_eta: a.critical_latest_eta ?? null, shared_note: a.shared_note ?? null, alone_eta: a.alone_best_eta ?? null,
          move_cost: a.move_cost ? { ...a.move_cost, level_label: a.binding?.level_label ?? null } : null }),
      };
    };
    const advisory = plan.buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");
    /**
     * Owner 2026-10-30: for an engine order, what the SAME need would look like through the OTHER route (import <-> local): every eligible member of the
     * need's group (or the same item) with a vendor of the opposite route type, with the ETD / ETA to Port / ETA to Plant that would land it on the same plant date.
     * Only options that can still connect when ordered from today (the ETD is not in the past) are listed.
     */
    const addDaysIso2 = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const routesOf = (materialId: string, vendorId: string | null | undefined) => (rowById.get(materialId)?.lead_time?.configured_routes ?? [])
      .filter((r) => r.route_days !== undefined && (!vendorId || r.vendor_id === vendorId));
    const alternativesFor = (buy: { material_id: string; vendor_id?: string | null; need_kind?: string; trigger_group_id?: string | null } | undefined, plantDate: string | null) => {
      if (!buy || !plantDate) return [] as Array<{ route: string; material: string; vendor: string; etd: string; port: string | null; plant: string; moq: number | null }>;
      const chosenOption = buy.vendor_id ? (vendorOptions.get(buy.material_id) ?? []).find((o) => o.vendor_id === buy.vendor_id) : undefined;
      const chosenRoutes = routesOf(buy.material_id, buy.vendor_id);
      const chosenRoute = (chosenRoutes.find((r) => chosenOption && r.route_days === chosenOption.lead_time_days) ?? chosenRoutes[0])?.route ?? null;
      if (!chosenRoute) return [];
      const groupMaterials = buy.need_kind === "GROUP" && buy.trigger_group_id
        ? (reqData.masters.groupMembers.get(buy.trigger_group_id) ?? []).filter((m) => m.active).map((m) => m.material_id) : [];
      const candidates = [...new Set([buy.material_id, ...groupMaterials])];
      const out: Array<{ route: string; material: string; vendor: string; etd: string; port: string | null; plant: string; moq: number | null }> = [];
      for (const m of candidates) {
        for (const option of vendorOptions.get(m) ?? []) {
          for (const r of routesOf(m, option.vendor_id)) {
            if (r.route === chosenRoute || r.route_days === undefined || option.lead_time_days === null) continue;
            const etd = addDaysIso2(plantDate, -r.route_days);
            if (etd < calendar.asOf) continue; // ordered from today it would land after the need date: it would not connect
            const port = r.route === "IMPORT" && (r.port_to_plant_days ?? r.inland_days) !== undefined ? addDaysIso2(plantDate, -((r.port_to_plant_days ?? r.inland_days) as number)) : null;
            out.push({ route: r.route, material: nameOf(m), vendor: r.vendor_label, etd, port, plant: plantDate, moq: option.moq_qty_base ?? null });
          }
        }
      }
      return out;
    };


    // Owner 2026-11-03: Group tab. For one family: every Exclusive / group as its own section, each lot (stock today, existing orders, projections) that feeds it,
    // its quantity to that level, the level's Min / Max days and the pool on the Existing ETA and on the Engine ETA, and how each lot is split over the levels.
    type Row = Record<string, unknown>;
    const altText = (list: Array<{ route: string; material: string; vendor: string; etd: string; port: string | null; plant: string; moq: number | null }>) => list.map((x) => `${x.route === "IMPORT" ? "IMPORT" : "LOCAL"} · ${x.material} · ${x.vendor}: ETD ${x.etd}${x.port ? ` · Port ${x.port}` : ""} · Plant ${x.plant}`).join("\n");
    const cmpDay = (a: string | null, b: string | null) => String(a ?? "9999").localeCompare(String(b ?? "9999"));
    const buildSections = (memberIds: string[], fu: { base_per_unit: number } | null, legs: (m: string, vendorId: string | null | undefined, date: string | null) => { port_eta: string | null; import_etd: string | null }, events: Array<{ member: string; reference: string; kind: string; date_source?: string; csn_id?: string; reschedule_key?: string; qty: number }>, wfv: { levels?: Array<{ label: string; target_days: number | null; max_days: number | null; critical_days: number | null; reserve_now: number; cover_days_now: number | null }>; events?: Array<{ day: string; kind: string; level: string; qty: number; by_material?: Array<{ material: string; qty: number }> }>; matrix?: Array<{ day: string; levels: Array<{ level: string; by_material: Array<{ material: string; qty: number }> }>; pool: Array<{ material: string; qty: number }>; closing: Array<{ material: string; qty: number }> }> }) => {
      const waterfallLevels = wfv.levels ?? [];
      const fam = (plan.schedule_checks ?? []).find((f) => f.member_ids.some((m) => memberIds.includes(m)));
      if (!fam) return null;
      const q = (n: number) => inUnit(fu, n) ?? 0;
      // Owner 2026-11-07: pro-rata = the level's own planned use per day; shown for today and on every order's landing date.
      const levelUse = new Map<string, number>();
      const famDemand = plan._internal.familyInputFor(memberIds[0]);
      for (const d of famDemand.own_demand) levelUse.set(`OWN|${d.material_id}|${d.required_by}`, (levelUse.get(`OWN|${d.material_id}|${d.required_by}`) ?? 0) + d.qty_base);
      for (const d of famDemand.group_demand) levelUse.set(`GROUP|${d.group_id}|${d.required_by}`, (levelUse.get(`GROUP|${d.group_id}|${d.required_by}`) ?? 0) + d.qty_base);
      const proRata = (lv: { level_kind: string; level_id: string }, date: string | null) => (date ? q(levelUse.get(`${lv.level_kind}|${lv.level_id}|${date}`) ?? 0) : null);
      const levelMap = new Map<string, { level_kind: "OWN" | "GROUP"; level_id: string; level_key: string; members: readonly string[] }>();
      for (const d of [...fam.days_a, ...fam.days_b]) for (const l of d.levels) if (!levelMap.has(l.level_key)) levelMap.set(l.level_key, l);
      const levels = [...levelMap.values()].sort((a, b) => (a.level_kind === b.level_kind ? a.members.length - b.members.length || a.level_key.localeCompare(b.level_key) : a.level_kind === "OWN" ? -1 : 1));
      const baseLabel = (l: { level_kind: string; level_id: string }) => (l.level_kind === "OWN" ? `Exclusive — ${nameOf(l.level_id)}` : groupFullLabel.get(l.level_id) ?? "Group");
      const dups = new Map<string, number>();
      for (const l of levels) dups.set(baseLabel(l), (dups.get(baseLabel(l)) ?? 0) + 1);
      const labelOf = (l: { level_kind: string; level_id: string; members: readonly string[] }) => ((dups.get(baseLabel(l)) ?? 0) > 1 ? `${baseLabel(l)} (allowed: ${l.members.map(nameOf).join(", ")})` : baseLabel(l));
      const stateAt = (days: typeof fam.days_a, key: string, date: string | null) => {
        if (!date) return null;
        const d = days.find((x) => x.day === date);
        const l = d?.levels.find((x) => x.level_key === key);
        if (!d || !l) return null;
        // Owner 2026-11-07: the excess shown for a level is the spare stock of THIS level's own members only (not the whole family pool).
        const lvMembers = new Set<string>(levelMap.get(key)?.members ?? []);
        const ownPool = d.pool_by.filter((p) => lvMembers.has(p.material_id) && p.qty > 0.5).sort((x, y) => y.qty - x.qty);
        return { cover: l.cover_days, min: l.min_days, max: l.max_days, minD: whole(l.cover_days), maxD: whole(l.max_cover_days !== null && l.max_days !== null ? Math.min(l.max_cover_days, l.max_days) : l.max_cover_days), beyond: l.max_cover_days === null, reserve: q(l.reserve_qty), excess: q(ownPool.reduce((sum, p) => sum + p.qty, 0)), excess_split: ownPool.map((p) => `${nameOf(p.material_id)}: ${dq(p.material_id, p.qty)} ${uomOf(p.material_id) ?? ""}`.trim()).join("\n") };
      };
      // Owner 2026-11-07: the cover on the evening BEFORE the landing day, so the sheet can show 'before → after' for one order.
      const dayBefore = (days: typeof fam.days_a, key: string, date: string | null) => {
        if (!date) return null;
        // level_days holds only the days something happens: take the latest day strictly before this one.
        const prior = days.filter((x) => x.day < date && x.levels.some((l) => l.level_key === key)).map((x) => x.day).sort().pop();
        const cover = prior ? stateAt(days, key, prior)?.minD ?? null : null;
        if (!prior || cover === null) return null;
        // No event between: the cover only shrinks one day per day, so the evening before this day = cover at the prior event day minus the quiet days in between.
        const gap = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${prior}T00:00:00Z`)) / 86_400_000) - 1;
        return Math.max(0, cover - Math.max(0, gap));
      };
      const statusOf = (st: ReturnType<typeof stateAt>, without: boolean) => {
        if (!st || st.cover === null || st.min === null) return "";
        const suffix = without ? ", even without this order" : "";
        if (st.cover + 1e-9 < st.min) return `Below Min by ${Math.max(1, Math.round(st.min - st.cover))} d${without ? " (without this order)" : ""}`;
        if (st.cover < st.min + 1) return `Exactly at Min${suffix}`;
        return `Above Min${suffix}`;
      };
      const whole = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));
      const allocOf = (alloc: typeof fam.alloc_a, ref: string, levelKind: string, destId: string) => alloc.filter((a) => a.ref === ref && a.dest_kind === levelKind && a.dest_id === destId).reduce((sum, a) => sum + a.qty, 0);
      const arrivalByRefMat = new Map(plan.reschedulable_arrivals.map((a) => [`${a.reference}|${a.material_id}`, a]));
      const eventOf = (reference: string, material: string) => events.find((e) => e.reference === reference && e.member === material);
      const buyOf = (ref: string) => advisory.find((b) => `Engine lot ${b.material_id} #${b.sequence}` === ref);
      // Union of projection lots: A (recorded dates) and B (engine dates) matched by their engine reference (material + sequence).
      const lotRefs = [...new Set([...fam.lots_a.map((l) => l.ref), ...fam.lots_b.map((l) => l.ref)])];
      const lotA = new Map(fam.lots_a.map((l) => [l.ref, l]));
      const lotB = new Map(fam.lots_b.map((l) => [l.ref, l]));
      const arrivals = fam.arrivals.filter((a) => a.qty_base > 0 && ((a.advised ?? a.recorded ?? "") >= calendar.asOf || (a.recorded ?? "") >= calendar.asOf));
      const sections: Row[] = [];
      const splits: Row[] = [];
      for (const lv of levels) {
        const wf = waterfallLevels.find((w) => w.label === (lv.level_kind === "OWN" ? baseLabel(lv) : groupLabel.get(lv.level_id)));
        const rows: Row[] = [];
        // Stock today
        const openQty = memberIds.filter((m) => lv.members.includes(m)).reduce((sum, m) => sum + Number(projection.rows.find((r) => r.material_id === m && r.day === calendar.asOf)?.opening_qty_base ?? 0), 0);
        const openState = stateAt(fam.days_b, lv.level_key, calendar.asOf);
        const openAlloc = allocOf(fam.alloc_b, "Unattributed counted stock", lv.level_kind, lv.level_kind === "OWN" ? lv.level_id : lv.level_id);
        rows.push({
          kind: "Stock today", ref: "Opening stock", supplier: lv.members.map(nameOf).join(" + "), status: "On hand", lot_qty: q(openQty), existing_eta: calendar.asOf, engine_eta: calendar.asOf,
          to_level: q(openAlloc), pct: openQty > 0 ? openAlloc / openQty : null, min_a: openState?.minD ?? null, max_a: openState?.maxD ?? null, min_b: openState?.minD ?? null, max_b: openState?.maxD ?? null,
          excess: openState?.excess ?? null, level_status: statusOf(openState, false), reserve_after: openState?.reserve ?? null,
          prorata_a: proRata(lv, calendar.asOf), prorata_b: proRata(lv, calendar.asOf),
        });
        for (const a of arrivals.filter((x) => lv.members.includes(x.material_id)).sort((x, y) => cmpDay(x.advised, y.advised))) {
          const ev = eventOf(a.reference, a.material_id);
          const arr = arrivalByRefMat.get(`${a.reference}|${a.material_id}`);
          const cells = ev?.reschedule_key ? bestCells(ev.reschedule_key, a.recorded ?? null, fu as never, uomOf(a.material_id) ?? "KG") : { etd: "", port: "", plant: "", why: "", absent: "", action: "" };
          // Owner 2026-11-12: an existing order's Min / Max count only today's stock and the existing orders (no suggested lot); a suggested lot that lands before it is mentioned, not counted.
          const stA = stateAt(fam.days_a_pure, lv.level_key, a.recorded);
          const stB = stateAt(fam.days_b_pure, lv.level_key, a.advised);
          const lotsBefore = (lots: typeof fam.lots_a, date: string | null) => (date ? lots.filter((l) => l.day >= calendar.asOf && l.day <= date && lv.members.includes(l.material_id)).map((l) => ({ day: l.day, material: nameOf(l.material_id), qty: q(l.qty_base) })) : []);
          const toLevel = allocOf(fam.alloc_b, a.source_key, lv.level_kind, lv.level_id);
          rows.push({
            kind: "Existing order", ref: `${a.reference}${ev?.csn_id ? "" : ""}`, material: nameOf(a.material_id), supplier: supplierOf(a.reference, ev?.csn_id) ?? "—", status: ev ? (arrivalStatus(ev.kind as never, ev.date_source as never) as string) : "",
            lot_qty: q(a.qty_base), existing_eta: a.recorded, action: cells.action, etd: cells.etd, port: cells.port, plant: cells.plant || a.advised, why: cells.why, absent: cells.absent,
            engine_eta: a.advised, to_level: q(toLevel), pct: a.qty_base > 0 ? toLevel / a.qty_base : null,
            min_a: stA?.minD ?? null, max_a: stA?.maxD ?? null, min_b: stB?.minD ?? null, max_b: stB?.maxD ?? null, excess: stB?.excess ?? null, excess_split: stB?.excess_split ?? null, level_status: statusOf(stB, false), reserve_after: stB?.reserve ?? null,
            arr_note: arr?.shared_note ?? "", rec: recOf(ev?.csn_id),
            prorata_a: proRata(lv, a.recorded ?? null), prorata_b: proRata(lv, a.advised ?? null),
            min_a_before: dayBefore(fam.days_a_pure, lv.level_key, a.recorded ?? null), min_b_before: dayBefore(fam.days_b_pure, lv.level_key, a.advised ?? null),
            new_lots_a: lotsBefore(fam.lots_a, a.recorded ?? null), new_lots_b: lotsBefore(fam.lots_b, a.advised ?? null),
          });
        }
        for (const ref of lotRefs) {
          const a = lotA.get(ref);
          const b = lotB.get(ref);
          const lot = (b ?? a)!;
          if (!lv.members.includes(lot.material_id)) continue;
          const buy = buyOf(ref) ?? advisory.find((x) => x.material_id === lot.material_id);
          const dayA = a?.day ?? null;
          const dayB = b?.day ?? null;
          const stA = stateAt(fam.days_a, lv.level_key, dayA ?? dayB);
          const stB = stateAt(fam.days_b, lv.level_key, dayB ?? dayA);
          const toLevel = b ? allocOf(fam.alloc_b, ref, lv.level_kind, lv.level_id) : allocOf(fam.alloc_a, ref, lv.level_kind, lv.level_id);
          const lg = legs(lot.material_id, buy?.vendor_id, dayB ?? dayA);
          const flag = a && b ? (dayA === dayB ? "both" : "both, dates differ") : a ? "recorded dates only" : "engine dates only";
          const action = a && b
            ? (dayA === dayB ? `Order by ${buy?.recommended_po_by ?? "—"}` : `Order by ${buy?.recommended_po_by ?? "—"} (recorded dates). On engine dates the same order lands ${dayB}`)
            : a ? `Order by ${buy?.recommended_po_by ?? "—"}, only while the existing orders stay on their Existing ETA. If you move them to the Engine ETA: NOT needed`
              : "Needed only if you move the existing orders to their Engine ETA";
          rows.push({
            kind: "Projection", ref: "NEW (engine)", po_by: buy?.recommended_po_by ?? null, material: nameOf(lot.material_id), supplier: buy?.vendor_label ?? "—", status: "Projection", lot_qty: q(lot.qty_base), existing_eta: dayA, action,
            etd: lg.import_etd ?? "", port: lg.port_eta ?? "", plant: dayB ?? "", why: buy ? (buy.need_kind === "GROUP" ? `Triggered by group free stock${buy.trigger_group_id ? ` — ${groupLabel.get(buy.trigger_group_id) ?? ""}` : ""}` : "Triggered by its own use") : "", absent: "",
            engine_eta: dayB, to_level: q(toLevel), pct: lot.qty_base > 0 ? toLevel / lot.qty_base : null,
            min_a: stA?.minD ?? null, max_a: stA?.maxD ?? null, min_b: stB?.minD ?? null, max_b: stB?.maxD ?? null, excess: stB?.excess ?? null, excess_split: stB?.excess_split ?? null,
            level_status: statusOf(stB, !b), reserve_after: stB?.reserve ?? null, flag,
            prorata_a: proRata(lv, dayA), prorata_b: proRata(lv, dayB),
            min_a_before: dayBefore(fam.days_a, lv.level_key, dayA), min_b_before: dayBefore(fam.days_b, lv.level_key, dayB),
            alternatives: buy ? altText(alternativesFor(buy, dayA ?? dayB)) : "",
          });
        }
        sections.push({
          label: labelOf(lv), kind: lv.level_kind, members: lv.members.map(nameOf), target_days: wf?.target_days ?? openState?.min ?? null, max_days: wf?.max_days ?? openState?.max ?? null, critical_days: wf?.critical_days ?? null,
          reserve_now: wf ? wf.reserve_now : openState?.reserve ?? null, cover_now: wf?.cover_days_now ?? openState?.minD ?? null, uom: fu ? undefined : undefined, rows,
          // Owner 2026-11-07: today's cover in days AND the date it reaches (as-of + days), for the stock alone and for the stock plus everything free to this level.
          as_of: calendar.asOf, today_cover: openState?.minD ?? null, today_cover_until: openState?.minD != null ? addDaysIso2(calendar.asOf, openState.minD) : null,
          today_max_cover: openState?.maxD ?? null, today_max_until: openState?.maxD != null ? addDaysIso2(calendar.asOf, openState.maxD) : null, today_beyond_plan: openState?.beyond ?? false,
        });
      }
      // How each lot is split over the levels (engine dates when the lot exists there, else recorded dates).
      const levelOfAlloc = (kind: string, id: string) => levels.find((l) => l.level_kind === kind && l.level_id === id);
      const addSplit = (label: string, lotQty: number, date: string | null, ref: string, alloc: typeof fam.alloc_a) => {
        const parts = alloc.filter((a) => a.ref === ref && a.qty > 0.5).map((a) => ({ level: levelOfAlloc(a.dest_kind, a.dest_id), qty: a.qty })).filter((x) => x.level)
          .map((x) => ({ level: labelOf(x.level!), qty: q(x.qty) }));
        const used = parts.reduce((sum, x) => sum + x.qty, 0);
        splits.push({ label, lot_qty: q(lotQty), date, parts, left: Math.max(0, q(lotQty) - used) });
      };
      for (const a of arrivals.sort((x, y) => cmpDay(x.advised, y.advised))) addSplit(`${a.reference} · ${nameOf(a.material_id)}`, a.qty_base, a.advised, a.source_key, fam.alloc_b);
      for (const ref of lotRefs) { const lot = (lotB.get(ref) ?? lotA.get(ref))!; addSplit(`NEW (engine) · ${nameOf(lot.material_id)}`, lot.qty_base, lot.day, ref, lotB.has(ref) ? fam.alloc_b : fam.alloc_a); }
      // Projection total: one row per new order, both date sets, with the split.
      const projectionTotal = lotRefs.map((ref) => {
        const a = lotA.get(ref); const b = lotB.get(ref); const lot = (b ?? a)!; const buy = buyOf(ref) ?? advisory.find((x) => x.material_id === lot.material_id);
        const alloc = b ? fam.alloc_b : fam.alloc_a;
        const lg = legs(lot.material_id, buy?.vendor_id, b?.day ?? a?.day ?? null);
        return {
          po_by: buy?.recommended_po_by ?? null, material: nameOf(lot.material_id), supplier: buy?.vendor_label ?? "—", qty: q(lot.qty_base), etd: lg.import_etd, port: lg.port_eta,
          recorded_eta: a?.day ?? null, engine_eta: b?.day ?? null, alternatives: buy ? altText(alternativesFor(buy, a?.day ?? b?.day ?? null)) : "",
          parts: levels.map((l) => ({ level: labelOf(l), qty: q(allocOf(alloc, ref, l.level_kind, l.level_id)) })).filter((x) => x.qty > 0.5),
        };
      }).sort((x, y) => cmpDay(x.recorded_eta ?? x.engine_eta, y.recorded_eta ?? y.engine_eta));
      // Owner 2026-11-04: what each level holds TODAY, narrow level first. "Available" = the stock of the level's members after the narrower
      // levels kept theirs; the stock left after the last level is the pool EXCESS. Taken from the engine's own Material x Level matrix.
      const snap = (wfv.matrix ?? []).find((m) => m.pool.length > 0) ?? null;
      const left = new Map<string, number>((snap?.closing ?? []).map((x) => [x.material, x.qty]));
      const lines = (m: Map<string, number> | Array<[string, number]>) => [...(m instanceof Map ? m.entries() : m)].filter(([, v]) => v > 0.5).map(([material, v]) => ({ material, qty: q(v) }));
      const levelToday = snap ? levels.map((lv) => {
        const wf = waterfallLevels.find((w) => w.label === (lv.level_kind === "OWN" ? baseLabel(lv) : groupLabel.get(lv.level_id)));
        const mine = snap.levels.find((x) => x.level === wf?.label);
        const take = new Map<string, number>((mine?.by_material ?? []).map((x) => [x.material, x.qty]));
        const memberNames = new Set(lv.members.map(nameOf));
        const opening = new Map([...left].filter(([m]) => memberNames.has(m)));
        for (const [m, v] of take) left.set(m, Math.max(0, (left.get(m) ?? 0) - v));
        const remaining = new Map([...left].filter(([m]) => memberNames.has(m)));
        return { label: labelOf(lv), opening: lines(opening), reserve: lines(take), left: lines(remaining) };
      }) : [];
      const excessAfter = snap ? lines(left) : [];
      // Pool diary: on every date something lands, what lands and the pool by material in each date set; plus the engine's own top-ups and dips.
      const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
      const dipByDay = new Map<string, string[]>();
      for (const b of advisory.filter((x) => memberIds.includes(x.material_id) && x.min_dip)) {
        const dp = b.min_dip!;
        const lab = dp.level_kind === "GROUP" ? groupLabel.get(dp.level_label_id) ?? "group" : nameOf(dp.level_label_id);
        const day = dp.ask_day ?? dp.from;
        dipByDay.set(day, [...(dipByDay.get(day) ?? []), `${lab} falls to ${Math.round(dp.lowest_cover_days)} d (Min ${Math.round(dp.min_days)} d, Critical ${dp.critical_days === null ? "—" : Math.round(dp.critical_days)} d) for ${dp.days_below_min} d; asks the pool for ${fmt(q(dp.ask_wanted_qty ?? 0))}, gets ${fmt(q(dp.ask_got_qty ?? 0))} (pool held ${fmt(q(dp.pool_qty_at_ask ?? 0))}). The engine therefore adds a new lot (recorded-date view).`]);
      }
      const poolOf = (days: typeof fam.days_a, dt: string) => { const d = days.find((x) => x.day === dt); return d ? { total: q(d.pool_qty), by: d.pool_by.filter((p) => p.qty > 0.5).map((p) => ({ material: nameOf(p.material_id), qty: q(p.qty) })) } : null; };
      const landsOf = (view: "A" | "B", dt: string) => [
        ...fam.arrivals.filter((a) => a.qty_base > 0 && (view === "A" ? a.recorded : a.advised) === dt).map((a) => `+ ${nameOf(a.material_id)} ${fmt(q(a.qty_base))} (${poNumberOfReference(a.reference) ?? a.reference})`),
        ...(view === "A" ? fam.lots_a : fam.lots_b).filter((l) => l.day === dt).map((l) => `+ NEW ${nameOf(l.material_id)} ${fmt(q(l.qty_base))} (suggested, not counted)`),
      ];
      const poolDiary = [...new Set([...fam.days_a.map((d) => d.day), ...fam.days_b.map((d) => d.day)])].sort().map((dt) => ({
        // Owner 2026-11-12: the excess pool counts today's stock and the existing orders only; a suggested lot is listed in 'lands' but never counted.
        day: dt, lands_a: landsOf("A", dt), pool_a: poolOf(fam.days_a_pure, dt), lands_b: landsOf("B", dt), pool_b: poolOf(fam.days_b_pure, dt),
        notes: [
          ...(wfv.events ?? []).filter((e) => e.day === dt && e.kind === "TOP_UP" && e.qty > 0.5).map((e) => `${e.level} refilled ${fmt(q(e.qty))} (${(e.by_material ?? []).filter((x) => x.qty > 0.5).map((x) => `${x.material} ${fmt(q(x.qty))}`).join(", ")}) [recorded-date view]`),
          ...(dipByDay.get(dt) ?? []),
        ],
      }));
      return { level_sections: sections, lot_splits: splits, projection_total: projectionTotal, level_today: levelToday, excess_after: excessAfter, pool_diary: poolDiary };
    };

    // ── Family / item planning blocks: every item with use, arrival or lot in the horizon ──
    const active = new Set(projection.rows.filter((r) => !bulkRm.has(r.material_id) && (r.demand_qty_base > 0 || r.confirmed_arrival_qty_base > 0 || r.planned_lot_qty_base > 0)).map((r) => r.material_id));
    const seen = new Set<string>();
    const blocks = [];
    for (const id of [...active].filter((m) => ["RM", "PM"].includes(rowById.get(m)?.kind ?? "")).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
      if (seen.has(id)) continue;
      const family = familyClosure(id, reqData.masters.groupMembers);
      const memberIds = family.member_ids.filter((m) => rowById.has(m) || m === id);
      memberIds.forEach((m) => seen.add(m));
      const memberSet = new Set(memberIds);
      const groupSet = new Set(family.group_ids);
      const memberRows = projection.rows.filter((r) => memberSet.has(r.material_id));
      const unmet = new Map(days.map((day) => [day, 0]));
      for (const u of projection.group_unmet) if (groupSet.has(u.group_id) && unmet.has(u.day)) unmet.set(u.day, (unmet.get(u.day) ?? 0) + u.qty_base);
      const grid = familyDayGrid(days, memberRows, unmet);
      const fu = familyUnit(memberIds);
      const gridByDay = new Map(grid.map((g) => [g.day, g]));
      // Owner 2026-10-28: what is left in the pool (held for no level) after each day's receipts — the latest Material x Level snapshot on or before the day.
      // A snapshot belongs to one planned part (a family, or a lone item), so several snapshots can share a day: take each member's own
      // latest pool quantity and add them up (the last snapshot of the day alone would show only one part, e.g. 195 KG instead of the pool).
      const poolByMember = new Map<string, Array<{ day: string; qty: number }>>();
      for (const snap of projection.level_matrix ?? []) {
        for (const [id, q] of Object.entries(snap.pool)) {
          if (!memberSet.has(id)) continue;
          const list = poolByMember.get(id) ?? [];
          list.push({ day: snap.day, qty: Number(q) });
          poolByMember.set(id, list);
        }
      }
      for (const list of poolByMember.values()) list.sort((x, y) => x.day.localeCompare(y.day));
      const excessAt = (dayIso: string) => {
        if (poolByMember.size === 0) return null;
        let total = 0;
        let any = false;
        for (const list of poolByMember.values()) {
          let found: number | null = null;
          for (const snap of list) { if (snap.day > dayIso) break; found = snap.qty; }
          if (found !== null) { total += found; any = true; }
        }
        return any ? inUnit(fu, total) : null;
      };

      // Left side: today + every day something arrives or you fixed a quantity.
      const events = memberIds.flatMap((m) => (rowById.get(m)?.inbound_events ?? []).map((e) => ({ ...e, member: m })));
      const ownByDay = new Map<string, number>();
      for (const l of userLots) if (memberSet.has(l.material_id)) ownByDay.set(l.plant_eta, (ownByDay.get(l.plant_eta) ?? 0) + l.qty_base);
      const rows = grid.filter((g, index) => index === 0 || g.arrivals > 0 || ownByDay.has(g.day)).map((g) => {
        // Owner 2026-10-26: an open piece whose ETA passed or is missing is counted today (as the
        // planner does), so it must be listed on today's row with its PO / vendor / status.
        const today = events.filter((e) => (e.date && e.date >= calendar.asOf ? e.date : calendar.asOf) === g.day);
        return {
          day: g.day, opening: inUnit(fu, g.opening), arrivals: inUnit(fu, g.arrivals), dispatch: inUnit(fu, ownByDay.get(g.day) ?? 0) || null,
          use: inUnit(fu, g.use), closing: inUnit(fu, g.closing), excess: excessAt(g.day), max_days: g.max_days, max_days_est: g.max_days_est, min_stock: inUnit(fu, g.min_stock), min_days: g.min_days, min_days_est: g.min_days_est,
          references: today.map((e) => e.reference),
          qtys: today.map((e) => `${dq(e.member, e.qty)} ${uomOf(e.member) ?? ""}`.trim()),
          suppliers: today.map((e) => supplierOf(e.reference, e.csn_id) ?? "—"),
          statuses: today.map((e) => arrivalStatus(e.kind, e.date_source)),
          best_dates: today.map((e) => bestText(e.reschedule_key, e.original_date !== undefined ? e.original_date : e.date, fu, fu?.uom_code ?? uomOf(e.member) ?? "KG")),
          rec_cells: today.map((e) => recOf(e.csn_id)),
          best_cells: today.map((e) => bestCells(e.reschedule_key, e.original_date !== undefined ? e.original_date : e.date, fu, fu?.uom_code ?? uomOf(e.member) ?? "KG")),
        };
      });

      // Right side: Prediction — every Quantity to Dispatch, engine and yours.
      const legs = (m: string, vendorId: string | null | undefined, date: string | null) => {
        const option = vendorId ? (vendorOptions.get(m) ?? []).find((o) => o.vendor_id === vendorId) : undefined;
        const transit = option && option.lead_time_days !== null ? option.lead_time_days : null;
        // Port-to-plant days: the median of this material's received CSNs, else the lead-time master's inland days for this vendor's IMPORT route.
        const masterInland = (rowById.get(m)?.lead_time?.configured_routes ?? [])
          .filter((r) => r.route === "IMPORT" && (r.port_to_plant_days ?? r.inland_days) !== undefined && (!vendorId || r.vendor_id === vendorId))
          .map((r) => (r.port_to_plant_days ?? r.inland_days) as number);
        // Lead-time master first (clearance + road); the median of received CSNs only when the master has no port-to-plant time.
        const p2p = masterInland.length ? Math.max(...masterInland) : portToPlant.get(m) ?? null;
        return { port_eta: p2p !== null ? addDaysIso(date, -p2p) : null, import_etd: transit !== null ? addDaysIso(date, -transit) : null };
      };
      const prediction = [
        ...advisory.filter((b) => memberSet.has(b.material_id)).flatMap((b) => (b.lots.length ? b.lots : [{ lot_no: 1, plant_eta: b.estimated_plant_eta, qty_base: b.recommended_po_qty_base ?? 0 }])
          .map((lot) => ({
            source: "ENGINE", material: nameOf(b.material_id), supplier: b.vendor_label ?? null, date: lot.plant_eta,
            qty: shownLot(b.material_id, lot.qty_base, b.order_unit).qty, uom: shownLot(b.material_id, lot.qty_base, b.order_unit).uom,
            po_by: b.recommended_po_by, ...legs(b.material_id, b.vendor_id, lot.plant_eta),
          }))),
        ...userLots.filter((l) => memberSet.has(l.material_id)).map((l) => ({
          source: "YOU", material: nameOf(l.material_id),
          supplier: l.vendor_id ? (plan._internal.vendorTerms.get(l.material_id) ?? []).find((t) => t.vendor_id === l.vendor_id)?.vendor_label ?? null : null,
          date: l.plant_eta as string | null,
          ...(() => {
            const shown = shownLot(l.material_id, l.qty_base, plan._internal.orderUnitFor(l.material_id, l.vendor_id));
            return { qty: shown.qty, uom: shown.uom };
          })(),
          po_by: null as string | null, ...legs(l.material_id, l.vendor_id, l.plant_eta),
        })),
      ].map((p) => {
        // Owner 2026-10-28: what an engine lot is connected at — the cover that triggered it (the group's free stock for a group need) and the item's own Min it was compared with.
        const buy = p.source === "ENGINE" ? advisory.find((b) => memberSet.has(b.material_id) && nameOf(b.material_id) === p.material && b.lots.some((l) => l.plant_eta === p.date)) : undefined;
        return {
          ...p, max_days: p.date ? gridByDay.get(p.date)?.max_days ?? null : null, min_days: p.date ? gridByDay.get(p.date)?.min_days ?? null : null,
          max_days_est: p.date ? gridByDay.get(p.date)?.max_days_est ?? null : null, min_days_est: p.date ? gridByDay.get(p.date)?.min_days_est ?? null : null,
          trigger_cover_days: buy?.trigger_cover_days ?? null, trigger_min_days: buy?.trigger_min_days ?? null, trigger_kind: buy?.need_kind ?? null, min_gap: buy?.min_gap ?? null,
          min_dip: buy?.min_dip ? { ...buy.min_dip, level_label: buy.min_dip.level_kind === "GROUP" ? groupLabel.get(buy.min_dip.level_label_id) ?? "group" : nameOf(buy.min_dip.level_label_id) } : null,
          alternatives: p.source === "ENGINE" ? alternativesFor(buy, p.date) : [],
          trigger_group: buy?.trigger_group_id ? groupLabel.get(buy.trigger_group_id) ?? null : null,
          // Every group this one physical lot also feeds (same arrival date), so the sheet can name them all.
          trigger_also_groups: (buy?.covers ?? []).filter((c: string) => c !== "OWN" && c !== "MEMBER_GUARD" && c !== buy?.trigger_group_id).map((c: string) => groupLabel.get(c) ?? "—"),
        };
      })
        .sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));

      const kind = rowById.get(id)?.kind ?? "RM";
      const selected = rowById.get(id);
      // Owner 2026-10-29: one line for the family — what moving every not-yet-shipped order to its advised date at once costs.
      const togetherRaw = events.map((e) => (e.reschedule_key ? arrivalByKey.get(e.reschedule_key)?.together : null)).find((t) => Boolean(t)) ?? null;
      const togetherNote = togetherRaw
        ? togetherText({
          extra_buy_qty: inUnit(fu, togetherRaw.extra_buy_qty_base) ?? 0, below_min_days_now: togetherRaw.below_min_days_now, below_min_days_moved: togetherRaw.below_min_days_moved,
          critical_days_now: togetherRaw.critical_days_now, critical_days_moved: togetherRaw.critical_days_moved, uom: fu?.uom_code ?? uomOf(id) ?? "KG",
        })
        : null;
      const sections = buildSections(memberIds, fu, legs, events as never, buildWaterfallView({ projection, asOf: calendar.asOf, memberSet, groupSet, groupLabel: (g) => groupLabel.get(g) ?? "—", materialLabel: (m) => nameOf(m), uomOf: (m) => uomOf(m) }) as never);
      const refillChoice = (projection.refill_choices ?? []).find((c) => c.members.some((m: string) => memberIds.includes(m)));
      const refillLabel = { FIRST: "1st refill", SECOND: "2nd refill", ARRIVAL: "on arrival" } as const;
      const refillWhy = !refillChoice ? null
        : refillChoice.scores.length === 0 ? "no item of this family sits in two levels, so all methods give the same plan"
        : `chosen by the system: ${refillChoice.scores.map((x) => `${refillLabel[x.method]} → ${x.days_below_min} level-days below Min, buys ${Math.round(x.buy_qty).toLocaleString("en-US")}`).join(" · ")}`;
      blocks.push({
        kind, together_note: togetherNote,
        refill_method: refillChoice ? refillLabel[refillChoice.method] : null, refill_method_why: refillWhy, ...(family.is_family ? (sections ?? {}) : {}),
        waterfall: buildWaterfallView({
          projection, asOf: calendar.asOf, memberSet, groupSet,
          groupLabel: (g) => groupLabel.get(g) ?? "—",
          materialLabel: (m) => nameOf(m),
          uomOf: (m) => uomOf(m),
        }),
        title: family.is_family ? family.group_ids.map((g) => groupLabel.get(g) ?? "—").sort().join(" / ") : nameOf(id),
        is_family: family.is_family,
        // Last day the PO21 plan has demand for this family (days beyond it are estimates).
        plan_end: [...grid].reverse().find((g) => g.use > EPSILON_USE)?.day ?? null,
        members: memberIds.map(nameOf).sort(),
        uom: fu?.uom_code ?? baseUomOf(id),
        target_days: selected?.policy?.target_cov_days ?? null,
        critical_days: selected?.policy?.critical_cov_days ?? null,
        // Every member's own Target / Critical (the pair above is only the first member's).
        members_policy: memberIds.map((m) => {
          const pol = rowById.get(m)?.policy;
          return `${nameOf(m)}: ${pol?.target_cov_days ?? "—"} / ${pol?.critical_cov_days ?? "—"} d`;
        }),
        // Each member's own stock and how many days it lasts at its average use (owner 2026-10-26).
        members_stock: memberIds.map((m) => {
          const rowsOf = projection.rows.filter((r) => r.material_id === m);
          const opening = Number(rowsOf[0]?.opening_qty_base ?? 0);
          // Average over the days that actually use stock, so zero-demand months do not stretch the days (owner 2026-10-27).
          const activeDays = rowsOf.filter((r) => r.demand_qty_base > 0.000001).length;
          const daily = activeDays > 0 ? rowsOf.reduce((sum, r) => sum + r.demand_qty_base, 0) / activeDays : 0;
          const lasts = daily > 0.000001 ? `${Math.floor(opening / daily + 1e-9)} d` : "no use";
          return `${nameOf(m)}: ${dq(m, opening)} ${uomOf(m) ?? ""} (${lasts})`.replace(/\s+\(/, " (");
        }),
        // Owner 2026-11-07: stock sitting in QA is NOT counted in the stock, but must be visible: how much, and how many extra days it would cover if it passes.
        qa_stock: memberIds.map((m) => ({ material: nameOf(m), uom: uomOf(m) ?? "", qty: dq(m, Number((rowById.get(m) as { stock?: { quality_inspection?: number } } | undefined)?.stock?.quality_inspection ?? 0)) ?? 0 })).filter((x) => x.qty > 0.5),
        qa_extra_days: (() => {
          const qaBase = memberIds.reduce((sum, m) => sum + Number((rowById.get(m) as { stock?: { quality_inspection?: number } } | undefined)?.stock?.quality_inspection ?? 0), 0);
          const byDay = new Map<string, number>();
          for (const r of memberRows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.demand_qty_base ?? 0));
          const active = [...byDay.values()].filter((v) => v > 0.000001);
          const daily = active.length > 0 ? active.reduce((a, v) => a + v, 0) / active.length : 0;
          return qaBase > 0.5 && daily > 0.000001 ? Math.floor(qaBase / daily + 1e-9) : null;
        })(),
        first_shortage_day: grid.find((g) => g.closing < -0.000001)?.day ?? null,
        // Why the engine places no lot (owner 2026-10-21): shown on the block title line.
        gaps: memberIds.flatMap((m) => {
          const r = rowById.get(m);
          const out: string[] = [];
          if (!mattersForGaps(m)) return out;
          if (r?.policy?.target_cov_days == null || r?.policy?.critical_cov_days == null) out.push(`${nameOf(m)}: no Target/Critical`);
          // Owner 2026-10-26: a group is bought through any member that has a vendor.
          if ((vendorOptions.get(m) ?? []).length === 0 && !memberIds.some((member) => (vendorOptions.get(member) ?? []).length > 0)) out.push(`${nameOf(m)}: no vendor`);
          if (selectionControlled.has(m) && !memberIds.some((member) => [...selections.values()].some((set) => set.has(member)))) out.push(`${nameOf(m)}: no member of this family is ticked in the monthly Selection, so the engine may not place a new order`);
          return out;
        }),
        rows, prediction,
      });
    }

    // ── RM / PM requirement (only rows with demand) ──
    const risks = new Map(projection.risks.map((r) => [r.material_id, r]));
    // Owner 2026-10-27: a group-only item (no exclusive use) that runs out while every group it serves
    // stays above that group's Critical / shortage through the whole horizon is not a purchase
    // problem — the other members carry the group. The alert stays (it is real stock), with this remark.
    const groupActionsById = new Map<string, typeof projection.group_actions[number][]>();
    for (const action of projection.group_actions) groupActionsById.set(action.group_id, [...(groupActionsById.get(action.group_id) ?? []), action]);
    const groupStaysCovered = (r: { material_id: string; fixed_demand_qty: number; pools: ReadonlyArray<{ group_id: string | null }> }): { groups: string[]; members: string[] } | null => {
      if (r.fixed_demand_qty > 0.000001) return null;
      const ids = unique(r.pools.map((pool) => pool.group_id).filter((id): id is string => Boolean(id)));
      if (ids.length === 0) return null;
      if (ids.some((id) => {
        const actions = groupActionsById.get(id) ?? [];
        return actions.length === 0 || actions.some((a) => a.first_shortage_day || a.first_below_critical_day);
      })) return null;
      const members = unique(ids.flatMap((id) => (reqData.output.groups.find((g) => g.group_id === id)?.members ?? [])
        .filter((m) => m.material_id !== r.material_id && (m.drawn_qty > 0.000001 || m.usable_stock > 0.000001)).map((m) => m.material_id)));
      return members.length > 0 ? { groups: ids.map((id) => groupLabel.get(id) ?? "—"), members } : null;
    };
    const requirement = reqData.output.rows.filter((r) => (r.kind === "RM" || r.kind === "PM") && !bulkRm.has(r.material_id) && r.metrics.identifier !== "NO_DEMAND").map((r) => {
      // Owner 2026-10-26: other members of its group carry the group's demand → not critical, with a remark.
      const covering = groupCoveredBy(r, reqData.output.groups);
      const covered = covering !== null;
      const stays = covered ? null : groupStaysCovered(r);
      return {
      note: covering ? `Group demand is met by other members: ${covering.map(nameOf).join(", ")}`
        : stays ? `Its own stock runs out, but group ${stays.groups.join(" + ")} stays covered by: ${stays.members.map(nameOf).join(", ")} — no purchase needed for this item.` : "",
      group_covered: Boolean(stays) && Boolean(risks.get(r.material_id)?.first_shortage_day || r.metrics.below_critical_with_in),
      material: nameOf(r.material_id), type: r.kind, uom: uomOf(r.material_id),
      target_cov_days: r.metrics.target_cov_days, critical_cov_days: r.metrics.critical_cov_days,
      current_stk_days: r.metrics.current_stk_days, next_month_cov: r.metrics.next_month_cov,
      current_req: dq(r.material_id, r.metrics.sheet_current_req), current_prorata: dq(r.material_id, r.metrics.current_prorata_daily),
      req_nm: dq(r.material_id, r.metrics.nm_req), prorata_nm: dq(r.material_id, r.metrics.nm_prorata_daily),
      current_stock: dq(r.material_id, r.metrics.current_stock), intransit_cm: dq(r.material_id, r.metrics.intransit_cm_dispatched), intransit_nm: dq(r.material_id, r.metrics.intransit_nm_dispatched), open_po_cm: dq(r.material_id, r.metrics.open_po_cm), open_po_nm: dq(r.material_id, r.metrics.open_po_nm),
      // Owner 2026-11-08: why the cover is blank — stock outlasts the PO21 plan, or the item is used only through a group.
      current_stk_days_note: r.metrics.current_stk_days === null ? (Number(r.metrics.cm_prorata ?? 0) + Number(r.metrics.nm_req ?? 0) > 0 && Number(r.metrics.current_stock ?? 0) > 0 ? "Beyond plan" : Number(r.group_share_qty ?? 0) > 0 ? `Via ${[...new Set(r.pools.filter((p) => p.group_id).map((p) => groupLabel.get(p.group_id!) ?? "group"))][0] ?? "group"}` : null) : null,
      // Owner 2026-11-12: an item used through a group shows the group and the group's own demand, so its 0 own demand is not read as "no need".
      group_via: [...new Set(r.pools.filter((p) => p.group_id).map((p) => groupFullLabel.get(p.group_id!) ?? "—"))].join("; ") || null,
      group_demand: r.pools.some((p) => p.group_id) ? dq(r.material_id, r.pools.filter((p) => p.group_id).reduce((sum, p) => sum + p.pool_total, 0)) : null,
      below_target: covered ? false : r.metrics.below_target_with_in, below_critical: covered ? false : r.metrics.below_critical_with_in,
      first_shortage_day: covered ? null : risks.get(r.material_id)?.first_shortage_day ?? null,
      first_below_critical_day: covered ? null : risks.get(r.material_id)?.first_below_critical_day ?? null,
      };
    }).sort((a, b) => Number(Boolean(b.first_shortage_day)) - Number(Boolean(a.first_shortage_day)) || Number(b.below_critical) - Number(a.below_critical) || a.material.localeCompare(b.material));

    const buys = advisory.filter((b) => !bulkRm.has(b.material_id)).map((b) => {
      const shown = shownLot(b.material_id, b.recommended_po_qty_base, b.order_unit);
      return {
      material: nameOf(b.material_id), type: rowById.get(b.material_id)?.kind ?? null, uom: shown.uom,
      late: b.status === "ADVISORY_LATE", po_by: b.recommended_po_by, qty: shown.qty,
      plant_eta: b.estimated_plant_eta,
      lots: (b.lots ?? []).map((l) => `${l.plant_eta}: ${shownLot(b.material_id, l.qty_base, b.order_unit).qty} ${shown.uom ?? ""}`.trim()).join(" · "),
      // Cost per the unit shown (engine cost is per base unit).
      supplier: b.vendor_label ?? null, full_cost_per_unit: b.vendor_unit_total_cost === null || b.vendor_unit_total_cost === undefined ? null : Math.round(b.vendor_unit_total_cost * shown.per * 100) / 100,
      value: b.vendor_unit_total_cost !== null && b.vendor_unit_total_cost !== undefined && b.recommended_po_qty_base !== null ? Math.round(b.vendor_unit_total_cost * b.recommended_po_qty_base) : null,
      cost_missing: (b.vendor_cost_missing ?? []).join(", "), reason: b.reason,
      };
    }).sort((a, b) => String(a.po_by ?? "9999").localeCompare(String(b.po_by ?? "9999")));

    const store = plan.store_rows.filter((r) => !(r.material_id && bulkRm.has(r.material_id)) && (r.executable_qty > 0 || r.not_backed_qty > 0 || r.transfer_hint)).map((r) => ({
      period: r.period_label, mother_group: r.mother_group, child_group: r.child_group, product: r.product, source: r.source, line_type: r.line_type, group: r.group_label,
      reason: r.planned_consumption_reason ?? null, use_first: r.receipt_reference ?? null,
      material: r.material_name, uom: r.material_id ? uomOf(r.material_id) : r.uom, demand_qty: dq(r.material_id, r.demand_qty), from_stock: dq(r.material_id, r.executable_qty), not_backed: dq(r.material_id, r.not_backed_qty), transfer: r.transfer_hint,
      // Owner 2026-10-28: Store instructions are for group items; period from-to and the reserve to keep at its end (up to Max days).
      period_from: r.period_from, period_to: r.period_to, group_related: r.group_related, material_key: r.material_id ?? `group:${r.group_id ?? r.group_label}`,
      keep_qty: r.keep_qty === null ? null : dq(r.material_id, r.keep_qty), keep_max_days: r.keep_max_days,
    }));

    const arrivals = reqData.output.rows.filter((r) => !bulkRm.has(r.material_id)).flatMap((r) => r.inbound_events.map((e) => {
      const o = e.reschedule_key ? optimumByKey.get(e.reschedule_key) : null;
      const w = e.reschedule_key ? windowByKey.get(e.reschedule_key) : null;
      const fed = r.kind === "RM" && isTransferFed(r.stock);
      return {
        material: nameOf(r.material_id), uom: uomOf(r.material_id), reference: e.reference, supplier: supplierOf(e.reference, e.csn_id),
        status: arrivalStatus(e.kind, e.date_source), qty: dq(r.material_id, e.qty),
        source_eta: e.original_date !== undefined ? e.original_date : e.date,
        planning_eta: e.original_date !== undefined ? e.date : null,
        overdue: Boolean(e.date && e.date < calendar.asOf), no_eta: !e.date,
        movable: Boolean(e.reschedule_key),
        engine_best_date: fed ? null : o && !o.not_needed_in_plan && o.shift_days !== 0 && w?.state !== "TALK_TO_VENDOR" ? o.best.eta : null,
        engine_reason: fed ? "Lands in the transfer-source store, so it is not MTS supply. The waterfall asks the Store for a transfer when it needs stock."
          : o?.not_needed_in_plan ? bestText(e.reschedule_key, e.original_date !== undefined ? e.original_date : e.date, unitOf(r.material_id), uomOf(r.material_id) ?? "KG") : o && o.shift_days !== 0 && w?.message ? `${w.message} ${o.reason}` : o?.reason ?? null,
        vendor_window: fed ? null : w?.state === "TALK_TO_VENDOR" ? "Talk to the vendor" : w?.state === "RESCHEDULE" ? "Can be rescheduled" : null,
      };
    })).sort((a, b) => String(a.planning_eta ?? a.source_eta ?? "9999").localeCompare(String(b.planning_eta ?? b.source_eta ?? "9999")));

    // ── Explain: the waterfall, day by day (owner 2026-10-27). Base units; one row per material and day. ──
    const roleOf = (id: string) => {
      const row = rowById.get(id);
      if (!row) return "—";
      const hasGroups = row.pools.some((pool) => Boolean(pool.group_id));
      if (row.fixed_demand_qty > 0.000001) return hasGroups ? "Exclusive use + group" : "Exclusive use";
      return hasGroups ? "Group only" : "—";
    };
    const explain = {
      daily: plan.daily.filter((d) => !bulkRm.has(d.material_id)).map((d) => {
        const closing = round(d.closing_qty_base);
        const cover = d.max_cover_days;
        const flag = closing < -0.000001 ? "STOCK-OUT"
          : d.critical_days !== null && cover !== null && cover <= d.critical_days ? "BELOW CRITICAL"
          : d.target_days !== null && cover !== null && cover <= d.target_days ? "AT / BELOW TARGET" : "";
        return {
          material: d.material_name, uom: d.uom, role: roleOf(d.material_id), day: d.day,
          opening: round(d.opening_qty_base), arrival: round(d.confirmed_arrival_qty_base), engine_lot: round(d.planned_lot_qty_base),
          use: round(d.demand_qty_base), group_draw: round(d.group_draw_qty_base), closing,
          cover_days: cover, target_days: d.target_days, critical_days: d.critical_days, flag,
        };
      }),
      draws: plan.allocation_rows.map((a) => ({
        day: a.day, material: a.material_name, uom: a.uom, destination: a.destination, flow: a.flow,
        qty: round(a.qty), closing: round(a.closing), source: a.source_reference, source_kind: a.source_kind,
      })),
      groups: plan.group_actions.map((g) => ({
        group: g.group_label, first_below_target_day: g.first_below_target_day, first_below_critical_day: g.first_below_critical_day,
        first_shortage_day: g.first_shortage_day, unresolved_qty: round(g.unresolved_qty_base), actions: g.ordered_actions.join(" → "),
        members: unique(plan.groups.filter((x) => x.group_label === g.group_label).flatMap((x) => x.members.map((m) => m.material_name))).join(", "),
      })),
    };

    const summary = {
      materials_planned: requirement.length,
      runs_out: requirement.filter((r) => r.first_shortage_day).length,
      below_critical: requirement.filter((r) => r.below_critical).length,
      below_target: requirement.filter((r) => r.below_target).length,
      new_orders: buys.length,
      new_orders_late: buys.filter((b) => b.late).length,
      new_order_value: buys.reduce((s, b) => s + (b.value ?? 0), 0),
      new_order_value_partial: buys.some((b) => b.value === null),
      arrivals_overdue: arrivals.filter((a) => a.overdue).length,
      arrivals_no_eta: arrivals.filter((a) => a.no_eta).length,
      moves_advised: arrivals.filter((a) => a.engine_best_date).length,
    };

    return okResponse({
      company_id: companyId, company_code: text(company.company_code) || null, company_name: text(company.company_name) || null,
      calendar: { as_of: calendar.asOf, horizon_end: calendar.horizonEnd, months: calendar.months },
      demand_label: plan.demand_version.label,
      bulk_rm_excluded: bulkRm.size,
      summary, blocks, requirement, buys, store, arrivals, explain, held_csns,
      // Owner 2026-10-28: R003 -> R001 / R002 and R001 <-> R002, how much and by when.
      // Owner 2026-10-28: Store plan for the whole horizon, month by month (group items; only ACTUAL stock may be issued).
      store_plan: {
        rows: plan.store_plan.rows.map((r) => ({
          period: r.period_label, period_order: r.period_order, period_from: r.period_from, period_to: r.period_to, item: r.material_name, material_key: r.material_id ?? `group:${r.group_id}`,
          group: r.group_label, mother_group: r.mother_group, child_group: r.child_group, uom: r.uom ?? (r.material_id ? uomOf(r.material_id) : null),
          use_stock: dq(r.material_id, r.use_stock), use_arrival: dq(r.material_id, r.use_arrival), use_assumed: dq(r.material_id, r.use_assumed), use_lot: dq(r.material_id, r.use_lot),
          keep_qty: r.keep_qty === null ? null : dq(r.material_id, r.keep_qty), keep_max_days: r.keep_max_days, not_backed: dq(r.material_id, r.not_backed_qty),
        })),
        excess: plan.store_plan.excess.map((e) => ({
          period: e.period_label, period_order: e.period_order, item: e.material_name, uom: uomOf(e.material_id),
          stock_now: dq(e.material_id, e.stock_now), excess_qty: dq(e.material_id, e.excess_qty), closing_qty: dq(e.material_id, e.closing_qty),
        })),
      },
      store_transfers: plan.store_transfers.map((t) => ({
        material: t.material_name, uom: t.uom, period: t.period_label, from: t.from, to: t.to, qty: dq(t.material_id, t.qty), by: t.by,
      })),
      generated_at: new Date().toISOString(),
    }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_ROLLING_PLAN_FAILED", "Could not prepare the rolling plan.");
  }
}
