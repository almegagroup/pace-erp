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
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import { arrivalStatus, dayRange, familyClosure, familyDayGrid, poNumberOfReference } from "./mts_item_plan.logic.ts";
import type { OptimizerManualLot } from "./mts_optimizer_phase3d.types.ts";
import { computePlanning, readParams } from "./mts_planning.handlers.ts";
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
const ROLLING_EXTRA_MONTHS = 4;

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
    const plan = await computePlanning({ companyId, ...parsed.params!, extraMonths: ROLLING_EXTRA_MONTHS, manualLots: userLots });
    const { req: reqData, projection, assembly, calendar, vendorOptions, selections } = plan._internal;
    const mattersForGaps = (m: string) => {
      const rowsOf = projection.rows.filter((r) => r.material_id === m);
      return memberMattersForGaps({
        opening_qty: Number(rowsOf[0]?.opening_qty_base ?? 0),
        horizon_demand_qty: rowsOf.reduce((sum, r) => sum + r.demand_qty_base, 0),
        selected_any_month: [...selections.values()].some((set) => set.has(m)),
      });
    };
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
    const [poRows, csnRows, historyCsns, groupRows] = await Promise.all([
      serviceRoleClient.schema("erp_procurement").from("purchase_order").select("po_number, vendor_id").eq("company_id", companyId).eq("status", "CONFIRMED").limit(10000),
      csnIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(csnIds, (chunk) => serviceRoleClient
        .schema("erp_procurement").from("consignment_note").select("id, vendor_id").in("id", chunk)),
      materialIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(materialIds, (chunk) => serviceRoleClient
        .schema("erp_procurement").from("consignment_note").select("material_id, ata_at_port, eta_at_port, gate_entry_date")
        .eq("company_id", companyId).eq("status", "GRD").not("gate_entry_date", "is", null).in("material_id", chunk)),
      groupIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(groupIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
    ]);
    if (poRows.error) throw new Error("MTS_ROLLING_PO_LOAD_FAILED");
    const pos = (poRows.data ?? []) as JsonRecord[];
    const vendorIds = unique([...pos.map((p) => text(p.vendor_id)), ...csnRows.map((c) => text(c.vendor_id))]);
    const vendorRows = vendorIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient
      .schema("erp_master").from("vendor_master").select("id, vendor_name").in("id", chunk));
    const vendorName = new Map(vendorRows.map((v) => [text(v.id), text(v.vendor_name) || "—"]));
    const vendorByPo = new Map(pos.map((p) => [text(p.po_number), vendorName.get(text(p.vendor_id)) ?? null]));
    const vendorByCsn = new Map(csnRows.map((c) => [text(c.id), vendorName.get(text(c.vendor_id)) ?? null]));
    const groupLabel = new Map(groupRows.map((g) => [text(g.id), text(g.group_name) || text(g.group_code) || "—"]));
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
    const advisory = plan.buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");

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
      const poolSnaps = (projection.level_matrix ?? []).filter((snap) => Object.keys(snap.pool).some((id) => memberSet.has(id)))
        .map((snap) => ({ day: snap.day, qty: Object.entries(snap.pool).reduce((sum, [id, q]) => sum + (memberSet.has(id) ? Number(q) : 0), 0) }))
        .sort((x, y) => x.day.localeCompare(y.day));
      const excessAt = (dayIso: string) => {
        let found: number | null = null;
        for (const snap of poolSnaps) { if (snap.day > dayIso) break; found = snap.qty; }
        return found === null ? null : inUnit(fu, found);
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
          best_dates: today.map((e) => {
            const o = e.reschedule_key ? optimumByKey.get(e.reschedule_key) : null;
            const w = e.reschedule_key ? windowByKey.get(e.reschedule_key) : null;
            if (o && o.shift_days !== 0 && w?.state === "TALK_TO_VENDOR") return `Talk to the vendor (${o.best.eta}, ${o.shift_days < 0 ? "prepone" : "postpone"} ${Math.abs(o.shift_days)} d)`;
            return o && o.shift_days !== 0 ? `${o.best.eta} (${o.shift_days < 0 ? "prepone" : "postpone"} ${Math.abs(o.shift_days)} d)` : "";
          }),
        };
      });

      // Right side: Prediction — every Quantity to Dispatch, engine and yours.
      const legs = (m: string, vendorId: string | null | undefined, date: string | null) => {
        const option = vendorId ? (vendorOptions.get(m) ?? []).find((o) => o.vendor_id === vendorId) : undefined;
        const transit = option && option.lead_time_days !== null ? option.lead_time_days - (option.booking_time_days ?? 0) : null;
        // Port-to-plant days: the median of this material's received CSNs, else the lead-time master's inland days for this vendor's IMPORT route.
        const masterInland = (rowById.get(m)?.lead_time?.configured_routes ?? [])
          .filter((r) => r.route === "IMPORT" && r.inland_days !== undefined && (!vendorId || r.vendor_id === vendorId))
          .map((r) => r.inland_days as number);
        const p2p = portToPlant.get(m) ?? (masterInland.length ? Math.max(...masterInland) : null);
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
          trigger_cover_days: buy?.trigger_cover_days ?? null, trigger_min_days: buy?.trigger_min_days ?? null, trigger_kind: buy?.need_kind ?? null,
        };
      })
        .sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));

      const kind = rowById.get(id)?.kind ?? "RM";
      const selected = rowById.get(id);
      blocks.push({
        kind,
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
        first_shortage_day: grid.find((g) => g.closing < -0.000001)?.day ?? null,
        // Why the engine places no lot (owner 2026-10-21): shown on the block title line.
        gaps: memberIds.flatMap((m) => {
          const r = rowById.get(m);
          const out: string[] = [];
          if (!mattersForGaps(m)) return out;
          if (r?.policy?.target_cov_days == null || r?.policy?.critical_cov_days == null) out.push(`${nameOf(m)}: no Target/Critical`);
          // Owner 2026-10-26: a group is bought through any member that has a vendor.
          if ((vendorOptions.get(m) ?? []).length === 0 && !memberIds.some((member) => (vendorOptions.get(member) ?? []).length > 0)) out.push(`${nameOf(m)}: no vendor`);
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
      current_stock: dq(r.material_id, r.metrics.current_stock), intransit_cm: dq(r.material_id, r.metrics.intransit_cm), intransit_nm: dq(r.material_id, r.metrics.intransit_nm),
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
        engine_best_date: fed ? null : o && o.shift_days !== 0 && w?.state !== "TALK_TO_VENDOR" ? o.best.eta : null,
        engine_reason: fed ? "Lands in the transfer-source store, so it is not MTS supply. The waterfall asks the Store for a transfer when it needs stock."
          : o && o.shift_days !== 0 && w?.message ? `${w.message} ${o.reason}` : o?.reason ?? null,
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
      summary, blocks, requirement, buys, store, arrivals, explain,
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
