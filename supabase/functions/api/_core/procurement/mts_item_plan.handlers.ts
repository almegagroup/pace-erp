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
import { arrivalStatus, dayRange, familyClosure, familyDayGrid } from "./mts_item_plan.logic.ts";
import type { OptimizerDailyProjectionRow } from "./mts_optimizer_phase3d.types.ts";
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

    const plan = await computePlanning({ companyId, ...parsed.params!, extraMonths: ITEM_PLAN_EXTRA_MONTHS });
    const { req: reqData, projection, assembly, calendar } = plan._internal;
    const rowById = new Map(reqData.output.rows.map((r) => [r.material_id, r]));
    if (!rowById.has(materialId)) {
      return fail(req, ctx, "MTS_ITEM_PLAN_MATERIAL_NOT_PLANNED", 404, "This material is not used by this company's planned MTS products.");
    }

    // Family (owner): a grouped item opens its whole family; a non-group item stands alone.
    const family = familyClosure(materialId, reqData.masters.groupMembers);
    const memberIds = family.member_ids.filter((id) => rowById.has(id) || id === materialId);
    const memberSet = new Set(memberIds);
    const groupSet = new Set(family.group_ids);
    const days = dayRange(calendar.asOf, calendar.horizonEnd);

    const memberRows: OptimizerDailyProjectionRow[] = projection.rows.filter((r) => memberSet.has(r.material_id));
    // Total family use per day (exclusive + every group pool, each once); what members did not
    // carry is unmet group demand (shortage).
    const totalUse = new Map<string, number>();
    for (const d of assembly.input.daily_demand) {
      const inFamily = d.material_id ? memberSet.has(d.material_id) : Boolean(d.group_id && groupSet.has(d.group_id));
      if (!inFamily || !d.required_by) continue;
      totalUse.set(d.required_by, (totalUse.get(d.required_by) ?? 0) + d.qty_base);
    }
    const memberUse = new Map<string, number>();
    for (const r of memberRows) memberUse.set(r.day, (memberUse.get(r.day) ?? 0) + r.demand_qty_base);
    const unmet = new Map(days.map((day) => [day, Math.max(0, (totalUse.get(day) ?? 0) - (memberUse.get(day) ?? 0))]));
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
    const [groupRows, csnRows, stockRows] = await Promise.all([
      family.group_ids.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(family.group_ids, (chunk) => serviceRoleClient
        .schema("erp_master").from("material_category_group").select("id, group_code, group_name").in("id", chunk)),
      csnIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(csnIds, (chunk) => serviceRoleClient
        .schema("erp_procurement").from("consignment_note")
        .select("id, csn_number, status, etd, eta_at_port, eta_to_plant_calculated, vendor_id").in("id", chunk)),
      fetchInChunks<JsonRecord>(memberIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_snapshot")
        .select("material_id, storage_location_id, stock_type_code, quantity").eq("company_id", companyId)
        .eq("stock_type_code", "UNRESTRICTED").in("material_id", chunk)),
    ]);
    const groupLabel = new Map(groupRows.map((g) => [text(g.id), [text(g.group_code), text(g.group_name)].filter(Boolean).join(" — ")]));
    const csnById = new Map(csnRows.map((c) => [text(c.id), c]));
    const vendorIds = unique(csnRows.map((c) => text(c.vendor_id)));
    const [vendorRows, locationLabels] = await Promise.all([
      vendorIds.length === 0 ? Promise.resolve([] as JsonRecord[]) : fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient
        .schema("erp_master").from("vendor_master").select("id, vendor_code, vendor_name").in("id", chunk)),
      loadLocationLabels(unique(stockRows.map((s) => text(s.storage_location_id)))),
    ]);
    const vendorLabel = new Map(vendorRows.map((v) => [text(v.id), [text(v.vendor_code), text(v.vendor_name)].filter(Boolean).join(" — ")]));

    const members = memberIds.map((id) => {
      const row = rowById.get(id);
      const locations = stockRows.filter((s) => text(s.material_id) === id && Number(s.quantity ?? 0) > 0.000001)
        .map((s) => ({ location: locationLabels.get(text(s.storage_location_id)) ?? "—", qty: round(Number(s.quantity)) }))
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

    const arrivals = memberIds.flatMap((id) => (rowById.get(id)?.inbound_events ?? []).map((event) => {
      const csn = event.csn_id ? csnById.get(event.csn_id) : undefined;
      return {
        material_id: id, material_code: codeOf(id), material_name: nameOf(id), uom: uomOf(id),
        reference: event.reference, qty: round(event.qty),
        status: arrivalStatus(event.kind, event.date_source),
        vendor: csn ? vendorLabel.get(text(csn.vendor_id)) ?? null : null,
        etd: csn ? text(csn.etd).slice(0, 10) || null : null,
        eta_port: csn ? text(csn.eta_at_port).slice(0, 10) || null : null,
        eta_plant: event.original_date !== undefined ? event.original_date : event.date,
        rescheduled_eta: event.original_date !== undefined ? event.date : null,
        reschedule_key: event.reschedule_key ?? null,
      };
    })).sort((a, b) => String(a.rescheduled_eta ?? a.eta_plant ?? "9999").localeCompare(String(b.rescheduled_eta ?? b.eta_plant ?? "9999")));

    const memberDaily = memberRows.map((r) => ({
      material_id: r.material_id, day: r.day, opening: round(r.opening_qty_base), arrivals: round(r.confirmed_arrival_qty_base),
      planned_lot: round(r.planned_lot_qty_base), use: round(r.demand_qty_base), group_draw: round(r.group_draw_qty_base),
      closing: round(r.closing_qty_base), max_days: r.max_cover_days, min_days: r.min_cover_days,
      target_days: r.target_days, critical_days: r.critical_days,
    }));

    const forecastMonths = new Set(reqData.forecast.forecastMonths);
    return okResponse({
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
      grid,
      member_daily: memberDaily,
      arrivals,
      // Engine proposals with the current lot rule (P2 replaces this with the Engine + AI plan).
      proposals: plan.buys.filter((b) => memberSet.has(b.material_id) && (b.status === "ADVISORY" || b.status === "ADVISORY_LATE")),
      risks: plan.risks.filter((r) => memberSet.has(r.material_id)),
      calculated_at: new Date().toISOString(),
    }, ctx.request_id, req);
  } catch (error) {
    if (error instanceof Error && error.message === "MTS_REQ_AS_OF_OUTSIDE_MONTH") return fail(req, ctx, error.message, 400, "As-of date must lie inside the selected plan month.");
    return handleError(req, ctx, error, "MTS_ITEM_PLAN_FAILED", "Could not calculate the item plan.");
  }
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
