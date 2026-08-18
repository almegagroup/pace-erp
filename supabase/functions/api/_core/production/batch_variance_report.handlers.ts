/*
 * File-ID: 27.FE-PR14-BE
 * File-Path: supabase/functions/api/_core/production/batch_variance_report.handlers.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: PR14 "Batch Variance Report" — search + printable Batch Record detail for a
 *          single Process PO batch (RM/INT reco table, linked Packing PO(s) + PM reco table,
 *          SFG QA test results). See feasibility doc §123.
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { ProdHandlerContext } from "./production.shared.ts";
import { assertProdReadRole, getIdFromPath, toTrimmedString, toUpperTrimmedString } from "./production.shared.ts";

type JsonRecord = Record<string, unknown>;

const MAX_DATE_RANGE_DAYS = 365;
const MAX_ORDERS_MATCHED = 200;

function bvErr(req: Request, ctx: ProdHandlerContext, code: string, status: number, msg: string): Response {
  return errorResponse(code, msg, ctx.request_id, "NONE", status, {}, req);
}

function parseMultiValueParams(url: URL, pluralKey: string, singularKey?: string): string[] {
  const collected = [
    ...url.searchParams.getAll(pluralKey),
    singularKey ? url.searchParams.get(singularKey) ?? "" : "",
  ];
  return [...new Set(
    collected
      .flatMap((entry) => String(entry ?? "").split(","))
      .map((entry) => toTrimmedString(entry))
      .filter(Boolean),
  )];
}

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Same no-leak company-boundary pattern as PR24 (order_information_system.handlers.ts §122.5).
async function resolveAllowedCompanyIds(ctx: ProdHandlerContext): Promise<string[] | null> {
  if (ctx.context.isAdmin === true || ctx.roleCode === "SA" || ctx.roleCode === "GA") {
    return null;
  }
  const { data, error } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);
  if (error) {
    console.error("[batch_variance_report] user_companies query failed:", JSON.stringify(error));
    throw new Error("PROD_BATVAR_SCOPE_FAILED");
  }
  return [...new Set(((data ?? []) as JsonRecord[]).map((row) => String(row.company_id ?? "")).filter(Boolean))];
}

function scopeCompanyIds(allowed: string[] | null, requested: string[]): string[] | null {
  if (!allowed) return requested.length > 0 ? requested : null;
  if (requested.length === 0) return allowed;
  return requested.filter((id) => allowed.includes(id));
}

async function resolveMaterialMap(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(materialIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, external_code, material_name, document_name, material_type")
    .in("id", ids);
  if (error) throw new Error("PROD_BATVAR_MATERIAL_RESOLVE_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

function materialDescription(material: JsonRecord | undefined): string | null {
  if (!material) return null;
  return toTrimmedString(material.document_name) || toTrimmedString(material.material_name) || null;
}

async function resolveStrokeMap(strokeIds: string[]): Promise<Map<string, JsonRecord>> {
  const ids = [...new Set(strokeIds.filter(Boolean))];
  const map = new Map<string, JsonRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await serviceRoleClient
    .schema("erp_production").from("stroke_master")
    .select("id, stroke_number, description")
    .in("id", ids);
  if (error) throw new Error("PROD_BATVAR_STROKE_RESOLVE_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) map.set(String(row.id), row);
  return map;
}

// GET /api/production/batch-variance-report — Screen 2 search/list
export async function searchBatchVarianceHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const url = new URL(req.url);

    const poNumber = toTrimmedString(url.searchParams.get("po_number"));
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const poTypes = parseMultiValueParams(url, "po_types", "po_type").map((s) => s.toUpperCase());
    const batchNumber = toTrimmedString(url.searchParams.get("batch_number"));
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    const companyIds = scopeCompanyIds(allowedCompanyIds, requestedCompanyIds);
    if (companyIds !== null && companyIds.length === 0 && requestedCompanyIds.length > 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    const bypassDateRange = Boolean(poNumber);
    if (!bypassDateRange) {
      if (!dateFrom || !dateTo) {
        return bvErr(req, ctx, "PROD_BATVAR_DATE_RANGE_REQUIRED", 400, "Posting date range is required unless a PO Number is given.");
      }
      const from = parseIsoDate(dateFrom);
      const to = parseIsoDate(dateTo);
      if (!from || !to || to.getTime() < from.getTime()) {
        return bvErr(req, ctx, "PROD_BATVAR_DATE_RANGE_INVALID", 400, "date_from/date_to are invalid.");
      }
      const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000);
      if (diffDays > MAX_DATE_RANGE_DAYS) {
        return bvErr(req, ctx, "PROD_BATVAR_DATE_RANGE_TOO_WIDE", 400, "Date range cannot exceed 365 days.");
      }
    }

    let processOrders: JsonRecord[] = [];

    if (poNumber) {
      // §123 — accepts either a Process PO or a Packing PO number; a Packing PO number
      // resolves to its owning Process PO (the batch record is always Process-PO-rooted).
      const isPackingNumber = poNumber.startsWith("94");
      if (isPackingNumber) {
        let pq = serviceRoleClient.schema("erp_production").from("packing_order")
          .select("process_order_id, company_id").eq("po_number", poNumber);
        if (companyIds) pq = pq.in("company_id", companyIds);
        const { data, error } = await pq;
        if (error) throw new Error("PROD_BATVAR_LOOKUP_FAILED");
        const processOrderIds = [...new Set(((data ?? []) as JsonRecord[]).map((r) => String(r.process_order_id ?? "")).filter(Boolean))];
        if (processOrderIds.length > 0) {
          const { data: parents, error: parentErr } = await serviceRoleClient
            .schema("erp_production").from("process_order")
            .select("id, company_id, po_number, po_type, batch_number, status, material_id, machine_id, stroke_master_id, verified_at")
            .in("id", processOrderIds);
          if (parentErr) throw new Error("PROD_BATVAR_LOOKUP_FAILED");
          processOrders = (parents ?? []) as JsonRecord[];
        }
      } else {
        let pq = serviceRoleClient.schema("erp_production").from("process_order")
          .select("id, company_id, po_number, po_type, batch_number, status, material_id, machine_id, stroke_master_id, verified_at")
          .eq("po_number", poNumber);
        if (companyIds) pq = pq.in("company_id", companyIds);
        const { data, error } = await pq;
        if (error) throw new Error("PROD_BATVAR_LOOKUP_FAILED");
        processOrders = (data ?? []) as JsonRecord[];
      }
    } else {
      let pq = serviceRoleClient.schema("erp_production").from("process_order")
        .select("id, company_id, po_number, po_type, batch_number, status, material_id, machine_id, stroke_master_id, verified_at")
        .order("verified_at", { ascending: false })
        .limit(MAX_ORDERS_MATCHED);
      if (companyIds) pq = pq.in("company_id", companyIds);
      if (poTypes.length > 0) pq = pq.in("po_type", poTypes);
      if (batchNumber) pq = pq.eq("batch_number", batchNumber);
      // Comparisons against NULL verified_at naturally exclude never-verified orders —
      // this report is inherently about VERIFIED batches (reco only exists post-Verify).
      pq = (pq as unknown as { gte: (c: string, v: string) => typeof pq }).gte("verified_at", dateFrom);
      pq = (pq as unknown as { lte: (c: string, v: string) => typeof pq }).lte("verified_at", `${dateTo}T23:59:59.999999+00:00`);
      const { data, error } = await pq;
      if (error) throw new Error("PROD_BATVAR_LOOKUP_FAILED");
      processOrders = (data ?? []) as JsonRecord[];
    }

    if (processOrders.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }

    const processOrderIds = processOrders.map((o) => String(o.id));
    const strokeIds = [...new Set(processOrders.map((o) => toTrimmedString(o.stroke_master_id)).filter(Boolean))];
    const materialIds = [...new Set(processOrders.map((o) => toTrimmedString(o.material_id)).filter(Boolean))];

    const [strokeMap, { data: linkedPacking, error: linkedErr }] = await Promise.all([
      resolveStrokeMap(strokeIds),
      serviceRoleClient.schema("erp_production").from("packing_order")
        .select("id, po_number, process_order_id, material_id, status")
        .in("process_order_id", processOrderIds),
    ]);
    if (linkedErr) throw new Error("PROD_BATVAR_LOOKUP_FAILED");

    const packingRows = (linkedPacking ?? []) as JsonRecord[];
    const skuMaterialIds = packingRows.map((r) => toTrimmedString(r.material_id)).filter(Boolean);
    const materialMap = await resolveMaterialMap([...materialIds, ...skuMaterialIds]);

    const packingByProcessOrder = new Map<string, JsonRecord[]>();
    for (const row of packingRows) {
      const key = String(row.process_order_id);
      const list = packingByProcessOrder.get(key) ?? [];
      list.push({
        id: row.id,
        po_number: row.po_number,
        status: row.status,
        sku_external_code: materialMap.get(String(row.material_id))?.external_code ?? null,
        sku_description: materialDescription(materialMap.get(String(row.material_id))),
      });
      packingByProcessOrder.set(key, list);
    }

    const rows = processOrders.map((o) => {
      const stroke = strokeMap.get(toTrimmedString(o.stroke_master_id));
      const prodshade = materialMap.get(toTrimmedString(o.material_id));
      return {
        id: o.id,
        po_number: o.po_number,
        po_type: o.po_type,
        status: o.status,
        batch_number: o.batch_number,
        verified_at: o.verified_at,
        stroke_number: stroke?.stroke_number ?? null,
        prodshade_external_code: prodshade?.external_code ?? null,
        prodshade_description: materialDescription(prodshade),
        packing_orders: packingByProcessOrder.get(String(o.id)) ?? [],
      };
    });

    rows.sort((a, b) => String(b.verified_at ?? "").localeCompare(String(a.verified_at ?? "")));

    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATVAR_SEARCH_FAILED";
    return bvErr(req, ctx, code, 500, "Batch Variance Report search failed");
  }
}

// GET /api/production/batch-variance-report/:id — Screen 3 printable detail
export async function getBatchVarianceDetailHandler(req: Request, ctx: ProdHandlerContext): Promise<Response> {
  try {
    assertProdReadRole(ctx);
    const processOrderId = getIdFromPath(req);
    if (!processOrderId) {
      return bvErr(req, ctx, "PROD_BATVAR_ID_REQUIRED", 400, "Process PO id is required.");
    }

    const { data: order, error: orderErr } = await serviceRoleClient
      .schema("erp_production").from("process_order")
      .select("id, company_id, po_number, po_type, batch_number, status, material_id, machine_id, stroke_master_id, verified_at")
      .eq("id", processOrderId)
      .maybeSingle();
    if (orderErr) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    if (!order) return bvErr(req, ctx, "PROD_BATVAR_NOT_FOUND", 404, "Process PO not found.");

    const allowedCompanyIds = await resolveAllowedCompanyIds(ctx);
    if (allowedCompanyIds && !allowedCompanyIds.includes(String(order.company_id))) {
      return bvErr(req, ctx, "PROD_BATVAR_COMPANY_SCOPE", 403, "Process PO is outside company scope.");
    }

    const [companyResp, strokeMap, machineResp, packingResp, recoResp, qaDocResp] = await Promise.all([
      serviceRoleClient.schema("erp_master").from("companies")
        .select("id, company_code, company_name").eq("id", order.company_id).maybeSingle(),
      resolveStrokeMap([toTrimmedString(order.stroke_master_id)]),
      order.machine_id
        ? serviceRoleClient.schema("erp_master").from("machine_master")
            .select("id, machine_code, machine_name").eq("id", order.machine_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      serviceRoleClient.schema("erp_production").from("packing_order")
        .select("id, po_number, po_type, pack_code_id, fill_qty_per_pack, num_packs, material_id, status, finalized_at")
        .eq("process_order_id", processOrderId).order("created_at", { ascending: true }),
      serviceRoleClient.schema("erp_production").from("process_order_line_reco")
        .select("material_id, dosage_pct, standard_qty, actual_qty, ap_approved_qty, variance_qty")
        .eq("process_order_id", processOrderId).eq("is_voided", false),
      serviceRoleClient.schema("erp_production").from("sfg_qa_document")
        .select("id, sfg_qa_number, status").eq("process_order_id", processOrderId).maybeSingle(),
    ]);
    if (companyResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    if (machineResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    if (packingResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    if (recoResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    if (qaDocResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");

    const packingOrders = (packingResp.data ?? []) as JsonRecord[];
    const packingOrderIds = packingOrders.map((p) => String(p.id));
    const recoLines = (recoResp.data ?? []) as JsonRecord[];

    const packLineRecoResp = packingOrderIds.length > 0
      ? await serviceRoleClient.schema("erp_production").from("packing_order_line_reco")
          .select("packing_order_id, material_id, actual_qty, ap_approved_qty, variance_qty")
          .in("packing_order_id", packingOrderIds).eq("is_voided", false)
      : { data: [], error: null };
    if (packLineRecoResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    const packLineRecoRows = (packLineRecoResp.data ?? []) as JsonRecord[];

    const packCodeIds = [...new Set(packingOrders.map((p) => toTrimmedString(p.pack_code_id)).filter(Boolean))];
    const packCodeResp = packCodeIds.length > 0
      ? await serviceRoleClient.schema("erp_production").from("pack_code_master")
          .select("id, pack_code").in("id", packCodeIds)
      : { data: [], error: null };
    if (packCodeResp.error) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
    const packCodeMap = new Map(((packCodeResp.data ?? []) as JsonRecord[]).map((r) => [String(r.id), toTrimmedString(r.pack_code)]));

    const materialIds = [
      toTrimmedString(order.material_id),
      ...recoLines.map((l) => toTrimmedString(l.material_id)),
      ...packingOrders.map((p) => toTrimmedString(p.material_id)),
      ...packLineRecoRows.map((l) => toTrimmedString(l.material_id)),
    ];
    const materialMap = await resolveMaterialMap(materialIds);

    const rmIntLines = recoLines.map((l) => {
      const material = materialMap.get(toTrimmedString(l.material_id));
      return {
        external_code: material?.external_code ?? null,
        description: materialDescription(material),
        dosage_pct: l.dosage_pct,
        standard_qty: l.standard_qty,
        actual_qty: l.actual_qty,
        ap_approved_qty: l.ap_approved_qty,
        variance_qty: l.variance_qty,
      };
    });

    const packLinesByOrder = new Map<string, JsonRecord[]>();
    for (const l of packLineRecoRows) {
      const key = String(l.packing_order_id);
      const list = packLinesByOrder.get(key) ?? [];
      const material = materialMap.get(toTrimmedString(l.material_id));
      list.push({
        external_code: material?.external_code ?? null,
        description: materialDescription(material),
        actual_qty: l.actual_qty,
        ap_approved_qty: l.ap_approved_qty,
        variance_qty: l.variance_qty,
      });
      packLinesByOrder.set(key, list);
    }

    const packingOrdersOut = packingOrders.map((p) => {
      const sku = materialMap.get(toTrimmedString(p.material_id));
      return {
        id: p.id,
        po_number: p.po_number,
        po_type: p.po_type,
        status: p.status,
        pack_code: packCodeMap.get(toTrimmedString(p.pack_code_id)) ?? null,
        fill_qty_per_pack: p.fill_qty_per_pack,
        num_packs: p.num_packs,
        finalized_at: p.finalized_at,
        sku_external_code: sku?.external_code ?? null,
        sku_description: materialDescription(sku),
        pm_lines: packLinesByOrder.get(String(p.id)) ?? [],
      };
    });

    let sfgQa: JsonRecord | null = null;
    const qaDoc = qaDocResp.data as JsonRecord | null;
    if (qaDoc) {
      const { data: testLines, error: testLinesErr } = await serviceRoleClient
        .schema("erp_production").from("sfg_qa_test_line")
        .select("test_parameter, test_method_id, lsl, usl, acceptable_range, test_result, pass_fail")
        .eq("qa_document_id", qaDoc.id).order("line_number", { ascending: true });
      if (testLinesErr) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
      const methodIds = [...new Set(((testLines ?? []) as JsonRecord[]).map((l) => toTrimmedString(l.test_method_id)).filter(Boolean))];
      const methodMap = new Map<string, string>();
      if (methodIds.length > 0) {
        const { data: methods, error: methodErr } = await serviceRoleClient
          .schema("erp_master").from("qa_test_method")
          .select("id, method_name").in("id", methodIds);
        if (methodErr) throw new Error("PROD_BATVAR_DETAIL_FETCH_FAILED");
        for (const m of (methods ?? []) as JsonRecord[]) methodMap.set(String(m.id), toTrimmedString(m.method_name));
      }
      sfgQa = {
        sfg_qa_number: qaDoc.sfg_qa_number,
        status: qaDoc.status,
        test_lines: ((testLines ?? []) as JsonRecord[]).map((l) => ({
          test_parameter: l.test_parameter,
          method_name: methodMap.get(toTrimmedString(l.test_method_id)) || null,
          lsl: l.lsl,
          usl: l.usl,
          acceptable_range: l.acceptable_range,
          test_result: l.test_result,
          pass_fail: l.pass_fail,
        })),
      };
    }

    const prodshade = materialMap.get(toTrimmedString(order.material_id));
    const stroke = strokeMap.get(toTrimmedString(order.stroke_master_id));
    const company = companyResp.data as JsonRecord | null;
    const machine = machineResp.data as JsonRecord | null;

    return okResponse({
      process_order: {
        id: order.id,
        po_number: order.po_number,
        po_type: order.po_type,
        status: order.status,
        batch_number: order.batch_number,
        verified_at: order.verified_at,
        company_code: company?.company_code ?? null,
        company_name: company?.company_name ?? null,
        stroke_number: stroke?.stroke_number ?? null,
        machine_code: machine?.machine_code ?? null,
        machine_name: machine?.machine_name ?? null,
        prodshade_external_code: prodshade?.external_code ?? null,
        prodshade_description: materialDescription(prodshade),
      },
      rm_int_lines: rmIntLines,
      packing_orders: packingOrdersOut,
      sfg_qa: sfgQa,
    }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PROD_BATVAR_DETAIL_FAILED";
    return bvErr(req, ctx, code, 500, "Batch Variance Report detail failed");
  }
}
