/*
 * PO22 — Rolling Plan export data (owner 2026-10-21).
 *   GET /api/procurement/mts-requirement/rolling-plan?company_id&plan_month&as_of&demand_at
 * One company per call; the frontend joins all the user's companies into one Excel file (the old
 * "rolling_plan" workbook: PLAN, family / item planning blocks with Prediction, RM_PM requirement,
 * plus Summary, Buy Plan, Store Instructions and Arrivals).
 * One Engine run per company (CM + NM + 1 month, every saved user lot and reschedule included);
 * every block is derived from that run, so the file shows exactly what the screens show.
 * Read-only: never creates a PO, CSN, transfer or stock posting.
 */
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import { arrivalStatus, type ArrivalOptimum, dayRange, familyClosure, familyDayGrid } from "./mts_item_plan.logic.ts";
import type { OptimizerManualLot } from "./mts_optimizer_phase3d.types.ts";
import { computePlanning, readParams } from "./mts_planning.handlers.ts";
import { fail, handleError, type ReqHandlerContext, requireRequirementViewAccess, todayInIndia } from "./mts_requirement.handlers.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];
const round = (value: number) => Math.round(value * 1000) / 1000;
const addDaysIso = (day: string | null, n: number | null) => (day && n !== null ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : null);

/** Rolling plan horizon = CM + NM + 1 month (the old file's three months). */
const ROLLING_EXTRA_MONTHS = 1;

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
    const { req: reqData, projection, assembly, calendar, vendorOptions } = plan._internal;
    const company = (companyRes.data ?? {}) as JsonRecord;
    const nameOf = (id: string) => text(reqData.materialRows.get(id)?.material_name) || "—";
    const uomOf = (id: string) => text(reqData.materialRows.get(id)?.base_uom_code) || null;
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
      const po = /^PO ([^/]+(?:\/[^/\s]+)*)\/\d+/.exec(reference)?.[1] ?? null;
      return (csnId ? vendorByCsn.get(csnId) : null) ?? (po ? vendorByPo.get(po) ?? null : null);
    };
    const optimumByKey = new Map<string, ArrivalOptimum>(plan.reschedulable_arrivals.map((a) => [a.reschedule_key, a.optimum]));
    const advisory = plan.buys.filter((b) => b.status === "ADVISORY" || b.status === "ADVISORY_LATE");

    // ── Family / item planning blocks: every item with use, arrival or lot in the horizon ──
    const active = new Set(projection.rows.filter((r) => r.demand_qty_base > 0 || r.confirmed_arrival_qty_base > 0 || r.planned_lot_qty_base > 0).map((r) => r.material_id));
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
      const totalUse = new Map<string, number>();
      for (const d of assembly.input.daily_demand) {
        const inFamily = d.material_id ? memberSet.has(d.material_id) : Boolean(d.group_id && groupSet.has(d.group_id));
        if (!inFamily || !d.required_by) continue;
        totalUse.set(d.required_by, (totalUse.get(d.required_by) ?? 0) + d.qty_base);
      }
      const memberUse = new Map<string, number>();
      for (const r of memberRows) memberUse.set(r.day, (memberUse.get(r.day) ?? 0) + r.demand_qty_base);
      const grid = familyDayGrid(days, memberRows, new Map(days.map((day) => [day, Math.max(0, (totalUse.get(day) ?? 0) - (memberUse.get(day) ?? 0))])));
      const gridByDay = new Map(grid.map((g) => [g.day, g]));

      // Left side: today + every day something arrives or you fixed a quantity.
      const events = memberIds.flatMap((m) => (rowById.get(m)?.inbound_events ?? []).map((e) => ({ ...e, member: m })));
      const ownByDay = new Map<string, number>();
      for (const l of userLots) if (memberSet.has(l.material_id)) ownByDay.set(l.plant_eta, (ownByDay.get(l.plant_eta) ?? 0) + l.qty_base);
      const rows = grid.filter((g, index) => index === 0 || g.arrivals > 0 || ownByDay.has(g.day)).map((g) => {
        const today = events.filter((e) => e.date === g.day);
        return {
          day: g.day, opening: g.opening, arrivals: g.arrivals, dispatch: round(ownByDay.get(g.day) ?? 0) || null,
          use: g.use, closing: g.closing, max_days: g.max_days, min_stock: g.min_stock, min_days: g.min_days,
          references: today.map((e) => e.reference),
          qtys: today.map((e) => round(e.qty)),
          suppliers: today.map((e) => supplierOf(e.reference, e.csn_id) ?? "—"),
          statuses: today.map((e) => arrivalStatus(e.kind, e.date_source)),
          best_dates: today.map((e) => {
            const o = e.reschedule_key ? optimumByKey.get(e.reschedule_key) : null;
            return o && o.shift_days !== 0 ? `${o.best.eta} (${o.shift_days < 0 ? "prepone" : "postpone"} ${Math.abs(o.shift_days)} d)` : "";
          }),
        };
      });

      // Right side: Prediction — every Quantity to Dispatch, engine and yours.
      const legs = (m: string, vendorId: string | null | undefined, date: string | null) => {
        const option = vendorId ? (vendorOptions.get(m) ?? []).find((o) => o.vendor_id === vendorId) : undefined;
        const transit = option && option.lead_time_days !== null ? option.lead_time_days - (option.booking_time_days ?? 0) : null;
        const p2p = portToPlant.get(m) ?? null;
        return { port_eta: p2p !== null ? addDaysIso(date, -p2p) : null, import_etd: transit !== null ? addDaysIso(date, -transit) : null };
      };
      const prediction = [
        ...advisory.filter((b) => memberSet.has(b.material_id)).flatMap((b) => (b.lots.length ? b.lots : [{ lot_no: 1, plant_eta: b.estimated_plant_eta, qty_base: b.recommended_po_qty_base ?? 0 }])
          .map((lot) => ({ source: "ENGINE", material: nameOf(b.material_id), supplier: b.vendor_label ?? null, date: lot.plant_eta, qty: round(lot.qty_base), po_by: b.recommended_po_by, ...legs(b.material_id, b.vendor_id, lot.plant_eta) }))),
        ...userLots.filter((l) => memberSet.has(l.material_id)).map((l) => ({
          source: "YOU", material: nameOf(l.material_id),
          supplier: l.vendor_id ? (plan._internal.vendorTerms.get(l.material_id) ?? []).find((t) => t.vendor_id === l.vendor_id)?.vendor_label ?? null : null,
          date: l.plant_eta as string | null, qty: round(l.qty_base), po_by: null as string | null, ...legs(l.material_id, l.vendor_id, l.plant_eta),
        })),
      ].map((p) => ({ ...p, max_days: p.date ? gridByDay.get(p.date)?.max_days ?? null : null, min_days: p.date ? gridByDay.get(p.date)?.min_days ?? null : null }))
        .sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));

      const kind = rowById.get(id)?.kind ?? "RM";
      const selected = rowById.get(id);
      blocks.push({
        kind,
        title: family.is_family ? family.group_ids.map((g) => groupLabel.get(g) ?? "—").sort().join(" / ") : nameOf(id),
        is_family: family.is_family,
        members: memberIds.map(nameOf).sort(),
        uom: uomOf(id),
        target_days: selected?.policy?.target_cov_days ?? null,
        critical_days: selected?.policy?.critical_cov_days ?? null,
        first_shortage_day: grid.find((g) => g.closing < -0.000001)?.day ?? null,
        rows, prediction,
      });
    }

    // ── RM / PM requirement (only rows with demand) ──
    const risks = new Map(projection.risks.map((r) => [r.material_id, r]));
    const requirement = reqData.output.rows.filter((r) => (r.kind === "RM" || r.kind === "PM") && r.metrics.identifier !== "NO_DEMAND").map((r) => ({
      material: nameOf(r.material_id), type: r.kind, uom: uomOf(r.material_id),
      target_cov_days: r.metrics.target_cov_days, critical_cov_days: r.metrics.critical_cov_days,
      current_stk_days: r.metrics.current_stk_days, next_month_cov: r.metrics.next_month_cov,
      current_req: r.metrics.sheet_current_req, current_prorata: r.metrics.current_prorata_daily,
      req_nm: r.metrics.nm_req, prorata_nm: r.metrics.nm_prorata_daily,
      current_stock: r.metrics.current_stock, intransit_cm: r.metrics.intransit_cm, intransit_nm: r.metrics.intransit_nm,
      below_target: r.metrics.below_target_with_in, below_critical: r.metrics.below_critical_with_in,
      first_shortage_day: risks.get(r.material_id)?.first_shortage_day ?? null,
      first_below_critical_day: risks.get(r.material_id)?.first_below_critical_day ?? null,
    })).sort((a, b) => Number(Boolean(b.first_shortage_day)) - Number(Boolean(a.first_shortage_day)) || Number(b.below_critical) - Number(a.below_critical) || a.material.localeCompare(b.material));

    const buys = advisory.map((b) => ({
      material: nameOf(b.material_id), type: rowById.get(b.material_id)?.kind ?? null, uom: uomOf(b.material_id),
      late: b.status === "ADVISORY_LATE", po_by: b.recommended_po_by, qty: b.recommended_po_qty_base,
      plant_eta: b.estimated_plant_eta, lots: (b.lots ?? []).map((l) => `${l.plant_eta}: ${round(l.qty_base)}`).join(" · "),
      supplier: b.vendor_label ?? null, full_cost_per_unit: b.vendor_unit_total_cost ?? null,
      value: b.vendor_unit_total_cost !== null && b.vendor_unit_total_cost !== undefined && b.recommended_po_qty_base !== null ? Math.round(b.vendor_unit_total_cost * b.recommended_po_qty_base) : null,
      cost_missing: (b.vendor_cost_missing ?? []).join(", "), reason: b.reason,
    })).sort((a, b) => String(a.po_by ?? "9999").localeCompare(String(b.po_by ?? "9999")));

    const store = plan.store_rows.filter((r) => r.executable_qty > 0 || r.not_backed_qty > 0 || r.transfer_hint).map((r) => ({
      period: r.period_label, product: r.product, source: r.source, line_type: r.line_type, group: r.group_label,
      material: r.material_name, uom: r.uom, demand_qty: r.demand_qty, from_stock: r.executable_qty, not_backed: r.not_backed_qty, transfer: r.transfer_hint,
    }));

    const arrivals = reqData.output.rows.flatMap((r) => r.inbound_events.map((e) => {
      const o = e.reschedule_key ? optimumByKey.get(e.reschedule_key) : null;
      return {
        material: nameOf(r.material_id), uom: uomOf(r.material_id), reference: e.reference, supplier: supplierOf(e.reference, e.csn_id),
        status: arrivalStatus(e.kind, e.date_source), qty: round(e.qty),
        source_eta: e.original_date !== undefined ? e.original_date : e.date,
        planning_eta: e.original_date !== undefined ? e.date : null,
        overdue: Boolean(e.date && e.date < calendar.asOf), no_eta: !e.date,
        movable: Boolean(e.reschedule_key),
        engine_best_date: o && o.shift_days !== 0 ? o.best.eta : null, engine_reason: o?.reason ?? null,
      };
    })).sort((a, b) => String(a.planning_eta ?? a.source_eta ?? "9999").localeCompare(String(b.planning_eta ?? b.source_eta ?? "9999")));

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
      summary, blocks, requirement, buys, store, arrivals,
      generated_at: new Date().toISOString(),
    }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_ROLLING_PLAN_FAILED", "Could not prepare the rolling plan.");
  }
}
