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
import { buildCalendar, isIsoDate, moqInBase, toMaterialBase } from "./mts_requirement.logic.ts";
import {
  computeRequirement,
  fail,
  handleError,
  type ReqHandlerContext,
  requireRequirementPolicyAccess,
  requireRequirementViewAccess,
  todayInIndia,
} from "./mts_requirement.handlers.ts";
import { assemblePlanningInput, type VendorTerm } from "./mts_planning.logic.ts";
import { projectDailyCoverage } from "./mts_optimizer_phase3d.logic.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];

type PlanningParams = { companyId: string; planMonth: string; asOf: string; demandAt: string | null; today: string };

function readParams(url: URL | JsonRecord, today: string): { params?: Omit<PlanningParams, "companyId">; error?: [string, string] } {
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
      .select("vendor_id, material_id, moq_qty, order_multiple_qty, delivery_lot_qty, supply_uom_code, booking_time_days, last_purchase_price, last_purchase_currency")
      .eq("status", "ACTIVE").in("material_id", chunk)),
    serviceRoleClient.schema("erp_master").from("vendor_company_map").select("vendor_id").eq("company_id", companyId).eq("active", true).limit(5000),
  ]);
  const companyVendors = new Set(((mapRes.data ?? []) as JsonRecord[]).map((row) => text(row.vendor_id)));
  const rows = vmiRows.filter((row) => companyVendors.has(text(row.vendor_id)));
  const vendorIds = unique(rows.map((row) => text(row.vendor_id)));
  const vendors = vendorIds.length === 0 ? [] : await fetchInChunks<JsonRecord>(vendorIds, (chunk) => serviceRoleClient.schema("erp_master")
    .from("vendor_master").select("id, vendor_code, vendor_name").in("id", chunk));
  const label = new Map(vendors.map((v) => [text(v.id), [text(v.vendor_code), text(v.vendor_name)].filter(Boolean).join(" — ")]));
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

/** Full planning payload (labels resolved, R-01: no raw ids shown). */
export async function computePlanning(p: PlanningParams) {
  const calendar = buildCalendar(p.planMonth, p.asOf);
  if (!calendar) throw new Error("MTS_REQ_AS_OF_OUTSIDE_MONTH");
  const req = await computeRequirement(p.companyId, calendar, p.asOf, p.today, p.demandAt);
  const universe = unique(req.output.rows.map((r) => r.material_id));
  const routesByMaterial = new Map(req.output.rows.map((r) => [r.material_id, (r.lead_time?.configured_routes ?? []).map((route) => ({ vendor_id: route.vendor_id, days: route.days }))]));
  const [vendorTerms, selections] = await Promise.all([
    loadVendorTerms(p.companyId, universe, routesByMaterial, req.materials),
    loadSelections(p.companyId, [calendar.cmStart, calendar.nmStart]),
  ]);
  const policyMoqBase = new Map(req.output.rows.map((r) => [r.material_id, moqInBase(r.policy, req.materials.get(r.material_id))]));
  const assembly = assemblePlanningInput({
    calendar, rows: req.output.rows, groups: req.output.groups, policies: req.policyLoad.policies,
    vendorTerms, selections: selections.map, policyMoqBase,
  });
  const projection = projectDailyCoverage(assembly.input);

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
  const eventRef = new Map<string, string>();
  for (const row of req.output.rows) row.inbound_events.forEach((event, index) => eventRef.set(`A|${row.material_id}|${index}|${event.reference}`, event.reference));

  const activeMaterials = new Set(projection.rows.filter((r) => r.demand_qty_base > 0 || r.confirmed_arrival_qty_base > 0 || r.planned_lot_qty_base > 0).map((r) => r.material_id));
  return {
    company_id: p.companyId,
    calendar: { as_of: calendar.asOf, cm_start: calendar.cmStart, cm_end: calendar.cmEnd, nm_start: calendar.nmStart, nm_end: calendar.nmEnd },
    demand_version: { demand_at: p.demandAt, label: p.demandAt ? `Plan as at ${p.demandAt}` : "Current effective plan" },
    source_fingerprint: req.fingerprint,
    calculated_at: new Date().toISOString(),
    selections_available: selections.available,
    location_policy: req.locationRoles ? "COMPANY_POLICY" : "LEGACY_REQUIRED_LOCATION",
    // Only materials with any use, arrival or proposed lot in CM + NM (keeps the payload small).
    daily: projection.rows.filter((row) => activeMaterials.has(row.material_id)).map((row) => ({ ...row, material_name: nameOf(row.material_id), material_code: codeOf(row.material_id), uom: uom(row.material_id) })),
    risks: projection.risks.map((risk) => ({ ...risk, material_name: nameOf(risk.material_id), material_code: codeOf(risk.material_id) })),
    buys: projection.advisory_buys.map((buy) => {
      const vendor = assembly.chosen_vendor.get(buy.material_id) ?? null;
      return {
        ...buy, material_name: nameOf(buy.material_id), material_code: codeOf(buy.material_id), uom: uom(buy.material_id),
        vendor_label: vendor?.vendor_label ?? null, vendor_moq_base: vendor?.moq_base ?? null, vendor_multiple_base: vendor?.multiple_base ?? null,
        vendor_lot_base: vendor?.lot_base ?? null, booking_time_days: vendor?.booking_days ?? null, route_lead_time_days: vendor?.route_days ?? null,
        vendor_options: (vendorTerms.get(buy.material_id) ?? []).map((t) => ({ vendor_label: t.vendor_label, booking_days: t.booking_days, route_days: t.route_days, moq_base: t.moq_base, multiple_base: t.multiple_base, last_price: t.last_price, currency: t.currency })),
      };
    }),
    groups: req.output.groups.map((g) => ({
      group_id: g.group_id, group_label: groupLabel.get(g.group_id) ?? "—", kind: g.kind,
      members: g.member_ids.map((id) => ({ material_id: id, material_name: nameOf(id), material_code: codeOf(id) })),
    })),
    group_risks: projection.group_pool_risks.map((g) => ({ ...g, group_label: g.group_id ? groupLabel.get(g.group_id) ?? "—" : "—" })),
    group_assignments: assembly.group_assignments.map((a) => ({ ...a, group_label: groupLabel.get(a.group_id) ?? "—", assigned_material_name: a.assigned_material_id ? nameOf(a.assigned_material_id) : null })),
    arrival_flags: projection.arrival_flags.map((f) => ({ ...f, material_name: nameOf(f.material_id), document: eventRef.get(f.source_key) ?? f.source_key })),
    store_rows: req.output.store_rows.map((row) => ({
      ...row,
      product: row.kind === "PM" ? row.sku_ids.map(nameOf).join("; ") : row.prodshade_ids.map(nameOf).join("; "),
      source: row.kind === "PM" ? `Pack BOM (${row.sku_ids.map(nameOf).join("; ")})` : row.stroke_ids.map(strokeLabel).join("; "),
      group_label: row.group_id ? groupLabel.get(row.group_id) ?? "—" : null,
      material_name: row.material_id ? nameOf(row.material_id) : "Group — not assigned",
      material_code: codeOf(row.material_id),
      uom: uom(row.material_id),
    })),
  };
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
