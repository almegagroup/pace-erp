/*
 * File-ID: 27.104-5
 * File-Path: supabase/functions/api/_core/production/conversion_cost.handlers.ts
 * Gate: 27.104
 * Domain: PRODUCTION / COSTING
 * Purpose: SA config for the per-KG conversion-cost table (§104.8). Append-only, valid_from
 *          dated — a rate change inserts a new row; old rows are never edited/deleted, so the
 *          full rate history is preserved and back-dated postings pick the rate valid then.
 *          The resolver (erp_production.resolve_conversion_rate) is used by Process PO Verify.
 *          Ownership (CORRECTED 2026-07-18): this is an ACCOUNTS function, not SA — SA can't know
 *          when a rate changes. The page lives in the ACL universe under the Accounts menu
 *          (resource ACC_CONVERSION_COST). Access is enforced by the route-ACL registry; these
 *          handlers do not hard-gate on SA.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import {
  assertProdReadRole,
  parseBody,
  toTrimmedString,
  toUpperTrimmedString,
} from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

// Segment codes the config recognises — must match VALID_SEGMENTS in process_order.handlers.ts /
// segment_location.handlers.ts. INT is included for completeness; conversion is only actually
// resolved for MTO/HPS/MTS output today, but the table can hold any segment default.
const VALID_SEGMENTS = new Set(["ADMIX", "HPS", "IWC", "POWDER", "INT"]);

function convError(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function createdOkResponse(data: unknown, requestId: string, req?: Request): Response {
  const response = okResponse(data, requestId, req);
  return new Response(response.body, { status: 201, headers: response.headers });
}

async function getCompanyMapByIds(companyIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(companyIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("companies")
    .select("id, company_code, company_name")
    .in("id", ids);
  if (error) {
    console.error("[conversion_cost.getCompanyMap] query failed:", JSON.stringify(error));
    throw new Error("PROD_CONV_RATE_LIST_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

async function getMaterialMapByIds(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, shade_code")
    .in("id", ids);
  if (error) {
    console.error("[conversion_cost.getMaterialMap] query failed:", JSON.stringify(error));
    throw new Error("PROD_CONV_RATE_LIST_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

// GET /api/production/conversion-rates?company_id=&segment_code=
// Lists every rate row (full history) with company/prodshade display names and a DERIVED
// valid_to (next row's valid_from − 1 day within the same company+segment+prodshade key; the
// newest row shows null = "current"). valid_to is never stored — see §104.8.
export async function listConversionRatesHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const segmentCode = toUpperTrimmedString(url.searchParams.get("segment_code") ?? "");

    let query = serviceRoleClient
      .schema("erp_production").from("conversion_cost_config")
      .select("id, company_id, segment_code, prodshade_material_id, valid_from, conversion_rate_per_kg, created_at, created_by")
      .order("company_id").order("segment_code")
      .order("prodshade_material_id", { nullsFirst: true })
      .order("valid_from", { ascending: true });
    if (companyId) query = query.eq("company_id", companyId);
    if (segmentCode) query = query.eq("segment_code", segmentCode);

    const { data, error } = await query;
    if (error) {
      console.error("[conversion_cost.list] query failed:", JSON.stringify(error));
      throw new Error("PROD_CONV_RATE_LIST_FAILED");
    }
    const rows = (data ?? []) as JsonRecord[];

    const [companyMap, materialMap] = await Promise.all([
      getCompanyMapByIds(rows.map((r) => String(r.company_id ?? ""))),
      getMaterialMapByIds(rows.map((r) => String(r.prodshade_material_id ?? ""))),
    ]);

    // Derive valid_to: the previous row (sorted by valid_from ASC) in the same key group gets
    // this row's valid_from − 1 day. Rows are already ordered by company/segment/prodshade/valid_from.
    const keyOf = (r: JsonRecord) =>
      `${String(r.company_id ?? "")}|${String(r.segment_code ?? "")}|${String(r.prodshade_material_id ?? "")}`;
    const validToById = new Map<string, string | null>();
    for (let i = 0; i < rows.length; i++) {
      const next = rows[i + 1];
      if (next && keyOf(next) === keyOf(rows[i])) {
        const d = new Date(`${String(next.valid_from)}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        validToById.set(String(rows[i].id), d.toISOString().slice(0, 10));
      } else {
        validToById.set(String(rows[i].id), null); // newest in group = current
      }
    }

    return okResponse({
      data: rows.map((row) => {
        const company = companyMap.get(String(row.company_id ?? "")) ?? null;
        const prodshade = row.prodshade_material_id ? (materialMap.get(String(row.prodshade_material_id)) ?? null) : null;
        return {
          ...row,
          valid_to: validToById.get(String(row.id)) ?? null,
          is_current: validToById.get(String(row.id)) === null,
          company_code: company ? String((company as JsonRecord).company_code ?? "") : null,
          company_name: company ? String((company as JsonRecord).company_name ?? "") : null,
          prodshade: prodshade
            ? {
                pace_code: String((prodshade as JsonRecord).pace_code ?? ""),
                material_name: String((prodshade as JsonRecord).material_name ?? ""),
                shade_code: String((prodshade as JsonRecord).shade_code ?? ""),
              }
            : null,
        };
      }),
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_CONV_RATE_LIST_FAILED";
    return convError(req, ctx, code, 500, "Conversion rate list failed");
  }
}

// POST /api/production/conversion-rates
// Accounts (ACL — resource ACC_CONVERSION_COST, enforced by the route registry). Append-only:
// inserts a new (company, segment, nullable prodshade, valid_from) row. prodshade_material_id
// NULL = the segment default; a value = a Prodshade-specific override.
export async function createConversionRateHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const segmentCode = toUpperTrimmedString(body.segment_code);
    const prodshadeMaterialId = toTrimmedString(body.prodshade_material_id) || null;
    const validFrom = toTrimmedString(body.valid_from);
    const rateRaw = body.conversion_rate_per_kg;
    const rate = Number(rateRaw);

    if (!companyId || !VALID_SEGMENTS.has(segmentCode) || !validFrom) {
      return convError(req, ctx, "PROD_CONV_RATE_INVALID", 400, "company_id, segment_code, valid_from required");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      return convError(req, ctx, "PROD_CONV_RATE_DATE_INVALID", 400, "valid_from must be YYYY-MM-DD");
    }
    if (rateRaw === undefined || rateRaw === null || rateRaw === "" || !Number.isFinite(rate) || rate < 0) {
      return convError(req, ctx, "PROD_CONV_RATE_VALUE_INVALID", 400, "conversion_rate_per_kg must be a number ≥ 0");
    }

    const { data, error } = await serviceRoleClient
      .schema("erp_production").from("conversion_cost_config")
      .insert({
        company_id: companyId,
        segment_code: segmentCode,
        prodshade_material_id: prodshadeMaterialId,
        valid_from: validFrom,
        conversion_rate_per_kg: rate,
        created_by: ctx.auth_user_id,
      })
      .select("id").single();

    if (error) {
      if (error.code === "23505") {
        return convError(req, ctx, "PROD_CONV_RATE_EXISTS", 409,
          "A rate for this company/segment/prodshade already has that valid_from date. Pick a different date.");
      }
      console.error("[conversion_cost.create] insert failed:", JSON.stringify(error));
      throw new Error("PROD_CONV_RATE_CREATE_FAILED");
    }
    return createdOkResponse({ id: (data as JsonRecord).id }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_CONV_RATE_CREATE_FAILED";
    return convError(req, ctx, code, 500, "Conversion rate create failed");
  }
}

// GET /api/production/derived-opening-rate?company_id=&material_id=
// §104.8 (LOCKED 2026-07-18): suggests the opening rate for a produced material (INT today, SFG
// later) as Σ(dosage% × that RM's current UNRESTRICTED rate), taken from the material's APPROVED
// stroke. This works because opening stock is loaded bottom-up (RM/PM → INT → SFG → FG), so by the
// time this material's line is entered every input rate already sits in stock_snapshot.
//
// It is a SUGGESTION, never enforced: a *purchased* opening INT must be entered at its purchase
// price, where the stroke-derived figure does not apply. Suggesting also stops a hand-typed opening
// rate from differing from the formula the system will use for in-house production — which would
// make the weighted average jump on the first in-house PO after go-live.
export async function getDerivedOpeningRateHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id") ?? "");
    const materialId = toTrimmedString(url.searchParams.get("material_id") ?? "");
    if (!companyId || !materialId) {
      return convError(req, ctx, "PROD_DERIVED_RATE_INVALID", 400, "company_id and material_id required");
    }

    // The material's own APPROVED stroke (it is the output/prodshade of that stroke).
    const { data: strokeRow, error: strokeErr } = await serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, stroke_number, po_type")
      .eq("company_id", companyId)
      .eq("prodshade_material_id", materialId)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (strokeErr) {
      console.error("[conversion_cost.derivedOpeningRate] stroke query failed:", JSON.stringify(strokeErr));
      throw new Error("PROD_DERIVED_RATE_FAILED");
    }
    const stroke = strokeRow as JsonRecord | null;
    if (!stroke) {
      // Not a produced material (or no approved stroke) — nothing to suggest; caller keeps manual entry.
      return okResponse({ data: { derivable: false, reason: "NO_APPROVED_STROKE", rate: null, lines: [] } }, ctx.request_id, req);
    }

    const { data: lineRows, error: lineErr } = await serviceRoleClient
      .schema("erp_production").from("stroke_line")
      .select("material_id, dosage_pct, display_order")
      .eq("stroke_master_id", String(stroke.id))
      .order("display_order");
    if (lineErr) {
      console.error("[conversion_cost.derivedOpeningRate] stroke_line query failed:", JSON.stringify(lineErr));
      throw new Error("PROD_DERIVED_RATE_FAILED");
    }
    const lines = (lineRows ?? []) as JsonRecord[];
    if (lines.length === 0) {
      return okResponse({ data: { derivable: false, reason: "STROKE_HAS_NO_LINES", rate: null, lines: [] } }, ctx.request_id, req);
    }

    const rmIds = [...new Set(lines.map((l) => String(l.material_id)).filter(Boolean))];
    const [matMap, rateRows] = await Promise.all([
      getMaterialMapByIds(rmIds),
      serviceRoleClient
        .schema("erp_inventory").from("stock_snapshot")
        .select("material_id, quantity, value")
        .eq("company_id", companyId)
        .eq("stock_type_code", "UNRESTRICTED")
        .is("batch_id", null)
        .in("material_id", rmIds),
    ]);
    if ((rateRows as { error?: unknown }).error) {
      console.error("[conversion_cost.derivedOpeningRate] snapshot query failed:", JSON.stringify((rateRows as { error?: unknown }).error));
      throw new Error("PROD_DERIVED_RATE_FAILED");
    }
    // Rate per material = Σvalue ÷ Σqty across that material's locations (its blended current cost).
    const agg = new Map<string, { qty: number; value: number }>();
    for (const row of ((rateRows as { data?: JsonRecord[] }).data ?? [])) {
      const key = String(row.material_id);
      const cur = agg.get(key) ?? { qty: 0, value: 0 };
      cur.qty += Number(row.quantity ?? 0);
      cur.value += Number(row.value ?? 0);
      agg.set(key, cur);
    }

    let rate = 0;
    let anyMissing = false;
    const breakup = lines.map((l) => {
      const rmId = String(l.material_id);
      const a = agg.get(rmId) ?? { qty: 0, value: 0 };
      const rmRate = a.qty > 0 ? a.value / a.qty : 0;
      if (rmRate <= 0) anyMissing = true;
      const dosagePct = Number(l.dosage_pct ?? 0);
      const contribution = (dosagePct / 100) * rmRate;
      rate += contribution;
      const mat = matMap.get(rmId) ?? null;
      return {
        material_id: rmId,
        pace_code: mat ? String((mat as JsonRecord).pace_code ?? "") : null,
        material_name: mat ? String((mat as JsonRecord).material_name ?? "") : null,
        dosage_pct: dosagePct,
        rm_rate: rmRate,
        contribution,
      };
    });

    return okResponse({
      data: {
        derivable: true,
        stroke_number: stroke.stroke_number ?? null,
        po_type: stroke.po_type ?? null,
        rate,
        // true when at least one input has no valued stock yet — the suggestion is then incomplete
        // (load that RM's opening first). Caller should warn rather than silently use a low number.
        incomplete: anyMissing,
        lines: breakup,
      },
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_DERIVED_RATE_FAILED";
    return convError(req, ctx, code, 500, "Derived opening rate failed");
  }
}
