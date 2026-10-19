/*
 * PO22 planning cost inputs (owner decisions D10/D11, 2026-10-19):
 *   * dated exchange rates — AUTO fetched from a public reference-rate provider
 *     (default Frankfurter / ECB reference rates, override with
 *     PLANNING_FX_PROVIDER_URL) and MANUAL overrides by the user;
 *   * company interest % per year, effective-dated.
 * Master/planning data only. Never touches PO, CSN status, GRN, stock or GL.
 */
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import { isIsoDate } from "./mts_requirement.logic.ts";
import {
  fail,
  handleError,
  type ReqHandlerContext,
  requireRequirementPolicyAccess,
  requireRequirementViewAccess,
  todayInIndia,
} from "./mts_requirement.handlers.ts";
import { type FxRateRow, parseProviderRate, pickFxRate } from "./mts_planning_cost.logic.ts";

type JsonRecord = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const DEFAULT_PROVIDER = "https://api.frankfurter.app";
const PROVIDER_TIMEOUT_MS = 10_000;
const CURRENCY = /^[A-Z]{3}$/;

function providerBase(): string {
  const env = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno?.env?.get("PLANNING_FX_PROVIDER_URL");
  return (env || DEFAULT_PROVIDER).replace(/\/+$/, "");
}

/** Fetches INR per unit of `currency` for `day` (the provider returns the last business day on/before it). */
async function fetchProviderRate(currency: string, day: string): Promise<{ rate: number; date: string; provider: string } | null> {
  const base = providerBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/${day}?from=${currency}&to=INR`, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return null;
    const parsed = parseProviderRate(await response.json());
    return parsed ? { ...parsed, provider: new URL(base).host } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadFxRows(currencies: string[], from: string, to: string): Promise<FxRateRow[]> {
  const { data, error } = await serviceRoleClient.schema("erp_master").from("currency_exchange_rate")
    .select("currency_code, rate_date, inr_per_unit, source")
    .in("currency_code", currencies).gte("rate_date", from).lte("rate_date", to)
    .order("rate_date", { ascending: false }).limit(5000);
  if (error) throw new Error("MTS_FX_LOAD_FAILED");
  return ((data ?? []) as JsonRecord[]).map((row) => ({ currency_code: text(row.currency_code), rate_date: text(row.rate_date), inr_per_unit: Number(row.inr_per_unit), source: text(row.source) as FxRateRow["source"] }));
}

/**
 * Makes sure an AUTO rate exists for `day` (stored under the asked date, keeping the provider's own
 * rate date). A failed fetch is not an error: callers fall back to the last stored rate (stale).
 */
export async function ensureAutoFxRate(currency: string, day: string): Promise<boolean> {
  const code = currency.toUpperCase();
  if (code === "INR") return true;
  const { data } = await serviceRoleClient.schema("erp_master").from("currency_exchange_rate")
    .select("id").eq("currency_code", code).eq("rate_date", day).eq("source", "AUTO").limit(1);
  if ((data ?? []).length > 0) return true;
  const fetched = await fetchProviderRate(code, day);
  if (!fetched) return false;
  const { error } = await serviceRoleClient.schema("erp_master").from("currency_exchange_rate").upsert({
    currency_code: code, rate_date: day, inr_per_unit: fetched.rate, source: "AUTO",
    provider: fetched.provider, provider_rate_date: fetched.date, updated_at: new Date().toISOString(),
  }, { onConflict: "currency_code,rate_date,source" });
  return !error;
}

/** Rate on `day` with D11 precedence inputs already applied by the caller; fetches today's AUTO rate lazily. */
export async function resolveFxRate(currency: string, day: string) {
  const code = currency.toUpperCase();
  if (code === "INR") return pickFxRate([], code, day);
  if (day <= todayInIndia()) await ensureAutoFxRate(code, day);
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  return pickFxRate(await loadFxRows([code], from, day), code, day);
}

export async function getMtsFxRatesHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const currency = text(url.searchParams.get("currency") || "USD").toUpperCase();
    if (!CURRENCY.test(currency)) return fail(req, ctx, "MTS_FX_INVALID_INPUT", 400, "currency must be a 3-letter code.");
    const today = todayInIndia();
    const to = text(url.searchParams.get("to")) || today;
    const from = text(url.searchParams.get("from")) || new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return fail(req, ctx, "MTS_FX_INVALID_INPUT", 400, "from / to must be dates with from <= to.");
    // Daily auto fetch happens lazily: the first view of the day stores today's rate.
    const fetchedToday = await ensureAutoFxRate(currency, today);
    const { data, error } = await serviceRoleClient.schema("erp_master").from("currency_exchange_rate")
      .select("currency_code, rate_date, inr_per_unit, source, provider, provider_rate_date, remarks, updated_at")
      .eq("currency_code", currency).gte("rate_date", from).lte("rate_date", to)
      .order("rate_date", { ascending: false }).order("source", { ascending: true }).limit(2000);
    if (error) throw new Error("MTS_FX_LOAD_FAILED");
    const rows = (data ?? []) as JsonRecord[];
    const effectiveToday = pickFxRate(rows.map((row) => ({ currency_code: currency, rate_date: text(row.rate_date), inr_per_unit: Number(row.inr_per_unit), source: text(row.source) as FxRateRow["source"] })), currency, today);
    return okResponse({ currency, today, fetched_today: fetchedToday, effective_today: effectiveToday, rows }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_FX_LOAD_FAILED", "Could not load exchange rates.");
  }
}

export async function saveMtsFxRateHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const currency = text(body.currency_code).toUpperCase();
    const rateDate = text(body.rate_date);
    const rate = Number(body.inr_per_unit);
    if (!CURRENCY.test(currency) || currency === "INR" || !isIsoDate(rateDate) || !Number.isFinite(rate) || rate <= 0) {
      return fail(req, ctx, "MTS_FX_INVALID_INPUT", 400, "Currency (not INR), date and a positive rate are required.");
    }
    const remarks = text(body.remarks).slice(0, 300) || null;
    const { data, error } = await serviceRoleClient.schema("erp_master").from("currency_exchange_rate").upsert({
      currency_code: currency, rate_date: rateDate, inr_per_unit: rate, source: "MANUAL", provider: null, provider_rate_date: null,
      remarks, created_by: ctx.auth_user_id, updated_at: new Date().toISOString(),
    }, { onConflict: "currency_code,rate_date,source" }).select("currency_code, rate_date, inr_per_unit, source, remarks").single();
    if (error) throw new Error("MTS_FX_SAVE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_FX_SAVE_FAILED", "Could not save the exchange rate.");
  }
}

export async function getMtsFinanceSettingsHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("company_planning_finance")
      .select("effective_from, interest_pct_per_year, remarks, updated_at").eq("company_id", companyId)
      .order("effective_from", { ascending: false }).limit(500);
    if (error) throw new Error("MTS_FINANCE_LOAD_FAILED");
    return okResponse({ rows: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_FINANCE_LOAD_FAILED", "Could not load finance settings.");
  }
}

export async function saveMtsFinanceSettingHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const effectiveFrom = text(body.effective_from);
    const pct = Number(body.interest_pct_per_year);
    if (!isIsoDate(effectiveFrom) || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return fail(req, ctx, "MTS_FINANCE_INVALID_INPUT", 400, "Effective date and an interest % between 0 and 100 are required.");
    }
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("company_planning_finance").upsert({
      company_id: companyId, effective_from: effectiveFrom, interest_pct_per_year: pct,
      remarks: text(body.remarks).slice(0, 300) || null, created_by: ctx.auth_user_id, updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,effective_from" }).select("effective_from, interest_pct_per_year, remarks").single();
    if (error) throw new Error("MTS_FINANCE_SAVE_FAILED");
    return okResponse({ data }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_FINANCE_SAVE_FAILED", "Could not save the interest %.");
  }
}

const LOCATION_ROLES = new Set(["COUNTED", "TRANSFER_SOURCE", "EXCLUDED"]);

/** Company plant locations with their PO22 planning role (owner D1/D12); no row = TRANSFER_SOURCE. */
export async function getMtsLocationPolicyHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = text(url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementViewAccess(req, ctx, companyId);
    if (denied) return denied;
    const [mapRes, policyRes] = await Promise.all([
      serviceRoleClient.schema("erp_inventory").from("storage_location_plant_map").select("storage_location_id").eq("company_id", companyId).limit(2000),
      serviceRoleClient.schema("erp_planning").from("company_planning_location_policy").select("storage_location_id, role, remarks, updated_at").eq("company_id", companyId).limit(2000),
    ]);
    if (mapRes.error) throw new Error("MTS_LOCATION_POLICY_LOAD_FAILED");
    const policy = new Map(((policyRes.data ?? []) as JsonRecord[]).map((row) => [text(row.storage_location_id), row]));
    const ids = [...new Set(((mapRes.data ?? []) as JsonRecord[]).map((row) => text(row.storage_location_id)).filter(Boolean))];
    const { data: locations, error } = ids.length === 0 ? { data: [], error: null } : await serviceRoleClient.schema("erp_inventory")
      .from("storage_location_master").select("id, code, name").in("id", ids);
    if (error) throw new Error("MTS_LOCATION_POLICY_LOAD_FAILED");
    const rows = ((locations ?? []) as JsonRecord[]).map((location) => {
      const row = policy.get(text(location.id));
      return {
        storage_location_id: text(location.id),
        location_code: text(location.code),
        location_name: text(location.name),
        role: row ? text(row.role) : "TRANSFER_SOURCE",
        configured: Boolean(row),
        remarks: row ? text(row.remarks) || null : null,
        updated_at: row?.updated_at ?? null,
      };
    }).sort((a, b) => a.location_code.localeCompare(b.location_code));
    return okResponse({ rows, policy_table_ready: !policyRes.error }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_LOCATION_POLICY_LOAD_FAILED", "Could not load the location policy.");
  }
}

export async function saveMtsLocationPolicyHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = text(body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_REQ_COMPANY_REQUIRED", 400, "company_id is required.");
    await assertCompanyScope(ctx, companyId);
    const denied = await requireRequirementPolicyAccess(req, ctx, companyId);
    if (denied) return denied;
    const raw = Array.isArray(body.rows) ? body.rows as JsonRecord[] : [];
    if (raw.length === 0 || raw.length > 500) return fail(req, ctx, "MTS_LOCATION_POLICY_INVALID_INPUT", 400, "Send 1–500 location rows.");
    const { data: mapRows, error: mapError } = await serviceRoleClient.schema("erp_inventory").from("storage_location_plant_map")
      .select("storage_location_id").eq("company_id", companyId).limit(2000);
    if (mapError) throw new Error("MTS_LOCATION_POLICY_SAVE_FAILED");
    const allowed = new Set(((mapRows ?? []) as JsonRecord[]).map((row) => text(row.storage_location_id)));
    const now = new Date().toISOString();
    const rows = [];
    for (const row of raw) {
      const locationId = text(row.storage_location_id);
      const role = text(row.role).toUpperCase();
      if (!allowed.has(locationId) || !LOCATION_ROLES.has(role)) {
        return fail(req, ctx, "MTS_LOCATION_POLICY_INVALID_INPUT", 400, "Each row needs one of this company's locations and a role COUNTED / TRANSFER_SOURCE / EXCLUDED.");
      }
      rows.push({ company_id: companyId, storage_location_id: locationId, role, remarks: text(row.remarks).slice(0, 300) || null, updated_by: ctx.auth_user_id, updated_at: now });
    }
    const { error } = await serviceRoleClient.schema("erp_planning").from("company_planning_location_policy")
      .upsert(rows, { onConflict: "company_id,storage_location_id" });
    if (error) throw new Error("MTS_LOCATION_POLICY_SAVE_FAILED");
    return okResponse({ saved: rows.length }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_LOCATION_POLICY_SAVE_FAILED", "Could not save the location policy.");
  }
}
