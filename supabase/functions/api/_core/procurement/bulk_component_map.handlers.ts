/*
 * File-Path: supabase/functions/api/_core/procurement/bulk_component_map.handlers.ts
 * Domain: PROCUREMENT / ACCOUNTS + PO12
 * Purpose: "Bulk Component Map" — one shared page reachable from both AC01's
 *          and PO12 Tab 1's own "Bulk Component Map" button. Lets the user
 *          build one or more cost/deduction lines (AC01's own Section 5/6
 *          vocabulary) and apply them across many selected GRNs at once,
 *          either "Same-to-Many" (same rate/amount on every GRN) or
 *          "Distributed" (one lump-sum total split Equally or As-per-GRN-
 *          qty). Design: docs/PROCUREMENT-DESIGN-DOC.md Point 3.5.8 (both
 *          the original mechanism lock and the 2026-10-06 Page/UI Design
 *          addendum).
 *
 * Write mechanism — append, never AC01's own save_ac01_grn_cost RPC (that
 * RPC DELETEs and reinserts a GRN's full landed_cost_line set, which would
 * silently wipe pre-existing lines). Mirrors the already-shipped CRCP Cost
 * Component Entry append pattern (crcp_discrepancy.handlers.ts's
 * createCrcpCostComponentHandler) — reuse the GRN's existing landed_cost
 * header, insert new line(s) at the next line_number, recompute total_cost.
 * Same known scope limit as that existing path: this does not recompute
 * landed_cost_per_unit or call erp_inventory.recalculate_valuation_at_row —
 * valuation catches up the next time someone opens that GRN in AC01 and
 * saves (which reads these appended lines back and runs the full RPC).
 *
 * Access — per selected GRN, independently: whichever of AC01's own
 * canWriteAC01() (GRN's own company) or PO12's own canWriteCrcp() (GRN's
 * Bill-To company, CRCP-enabled PO/STO) actually applies. A GRN satisfying
 * neither is reported per-row as forbidden, never failing the whole batch.
 *
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { canWriteAC01 } from "./ac01.handlers.ts";
import { canWriteCrcp } from "./crcp_discrepancy.handlers.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function bulkMapErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Same ADDITIONAL_DUTY_IGST exclusion save_ac01_grn_cost's own v_net_amount
// computation applies — that duty is fully excluded from Landed Cost.
const NET_EXCLUDED_COST_TYPES = new Set(["ADDITIONAL_DUTY_IGST"]);

type CostLineInput = {
  cost_type: string;
  amount: number;
  entry_mode: "AD_HOC" | "PER_UOM";
  has_gst: boolean;
  gst_treatment: "EXCLUSIVE" | "INCLUSIVE" | null;
  gst_rate: number | null;
  party_type: string;
  cha_id: string | null;
  bill_reference: string | null;
  bill_date: string | null;
  description: string | null;
};

type DeductionLineInput = {
  deduction_type_id: string;
  amount: number | null;
  percentage: number | null;
  round_off: number | null;
  party_type: string;
  in_landed: boolean;
};

type GrnPlanRow = {
  grn_id: string;
  grn_number: string;
  company_id: string;
  considered_qty_base: number;
  cost_lines: CostLineInput[];
  deduction_lines: DeductionLineInput[];
  bill_to_company_id: string | null;
};

type ForbiddenRow = { grn_id: string; grn_number: string; reason: string };

function parseCostLines(raw: unknown): CostLineInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const line = entry as JsonRecord;
      const amount = Number(line.amount);
      const costType = toTrimmedString(line.cost_type);
      if (!costType || !Number.isFinite(amount) || amount === 0) return null;
      return {
        cost_type: costType,
        amount,
        entry_mode: line.entry_mode === "PER_UOM" ? "PER_UOM" : "AD_HOC",
        has_gst: line.has_gst === true,
        gst_treatment: line.gst_treatment === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE",
        gst_rate: line.gst_rate != null && line.gst_rate !== "" ? Number(line.gst_rate) : null,
        party_type: toTrimmedString(line.party_type) || "VENDOR",
        cha_id: toTrimmedString(line.cha_id) || null,
        bill_reference: toTrimmedString(line.bill_reference) || null,
        bill_date: toTrimmedString(line.bill_date) || null,
        description: toTrimmedString(line.description) || null,
      } as CostLineInput;
    })
    .filter((line): line is CostLineInput => line !== null);
}

function parseDeductionLines(raw: unknown): DeductionLineInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const line = entry as JsonRecord;
      const deductionTypeId = toTrimmedString(line.deduction_type_id);
      const amount = line.amount != null && line.amount !== "" ? Number(line.amount) : null;
      if (!deductionTypeId || amount === null || !Number.isFinite(amount) || amount === 0) return null;
      return {
        deduction_type_id: deductionTypeId,
        amount,
        percentage: line.percentage != null && line.percentage !== "" ? Number(line.percentage) : null,
        round_off: line.round_off != null && line.round_off !== "" ? Number(line.round_off) : null,
        party_type: toTrimmedString(line.party_type) || "VENDOR",
        in_landed: line.in_landed === true,
      } as DeductionLineInput;
    })
    .filter((line): line is DeductionLineInput => line !== null);
}

// Distributes `total` across `grns` (in the given order), either Equally or
// As-per-GRN-qty (proportional to each GRN's own Base-UoM Considered Qty).
// The last GRN absorbs the rounding remainder so the sum always equals
// `total` exactly -- never silently drops a paisa anywhere.
function distributeAmount(
  total: number,
  grns: Array<{ grn_id: string; considered_qty_base: number }>,
  splitMethod: "EQUALLY" | "AS_PER_QTY",
): Map<string, number> {
  const result = new Map<string, number>();
  if (grns.length === 0) return result;
  if (splitMethod === "AS_PER_QTY") {
    const sumQty = grns.reduce((sum, g) => sum + g.considered_qty_base, 0);
    if (sumQty <= 0) {
      throw new Error("BULK_MAP_ZERO_QTY_FOR_DISTRIBUTION");
    }
    let allocated = 0;
    grns.forEach((g, index) => {
      if (index === grns.length - 1) {
        result.set(g.grn_id, round2(total - allocated));
        return;
      }
      const share = round2(total * (g.considered_qty_base / sumQty));
      allocated += share;
      result.set(g.grn_id, share);
    });
    return result;
  }
  // EQUALLY
  const share = round2(total / grns.length);
  let allocated = 0;
  grns.forEach((g, index) => {
    if (index === grns.length - 1) {
      result.set(g.grn_id, round2(total - allocated));
      return;
    }
    allocated += share;
    result.set(g.grn_id, share);
  });
  return result;
}

// Core plan builder shared by preview (dry-run) and apply (writes). Resolves
// per-GRN access (AC01-or-CRCP, independently), computes each GRN's own
// resulting cost/deduction lines per the chosen mode, and flags duplicate-
// value matches against each GRN's existing lines -- all without writing.
async function buildBulkComponentMapPlan(
  ctx: ProcurementHandlerContext,
  body: JsonRecord,
): Promise<{
  allowed: GrnPlanRow[];
  forbidden: ForbiddenRow[];
  duplicateWarnings: Array<{ grn_id: string; grn_number: string; kind: "cost" | "deduction"; label: string; amount: number }>;
}> {
  const grnIds = Array.isArray(body.grn_ids) ? [...new Set(body.grn_ids.map(toTrimmedString).filter(Boolean))] : [];
  if (grnIds.length === 0) throw new Error("BULK_MAP_NO_GRNS_SELECTED");

  const costLineInputs = parseCostLines(body.cost_lines);
  const deductionLineInputs = parseDeductionLines(body.deduction_lines);
  if (costLineInputs.length === 0 && deductionLineInputs.length === 0) {
    throw new Error("BULK_MAP_NO_LINES_ENTERED");
  }

  const mode = body.mode === "DISTRIBUTED" ? "DISTRIBUTED" : "SAME_TO_MANY";
  const splitMethod = body.split_method === "AS_PER_QTY" ? "AS_PER_QTY" : "EQUALLY";

  const grnRows = await fetchInChunks<JsonRecord>(grnIds, (idChunk) =>
    serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, company_id, po_id, sto_id, considered_qty, received_qty, per_pack_qty")
      .in("id", idChunk));
  const grnMap = new Map(grnRows.map((row) => [String(row.id), row]));

  const poIds = [...new Set(grnRows.map((row) => toTrimmedString(row.po_id)).filter(Boolean))];
  const stoIds = [...new Set(grnRows.map((row) => toTrimmedString(row.sto_id)).filter(Boolean))];
  const [poRows, stoRows] = await Promise.all([
    poIds.length
      ? fetchInChunks<JsonRecord>(poIds, (idChunk) =>
        serviceRoleClient.schema("erp_procurement").from("purchase_order")
          .select("id, company_id, crcp_enabled").in("id", idChunk))
      : Promise.resolve([] as JsonRecord[]),
    stoIds.length
      ? fetchInChunks<JsonRecord>(stoIds, (idChunk) =>
        serviceRoleClient.schema("erp_procurement").from("stock_transfer_order")
          .select("id, receiving_company_id, crcp_enabled").in("id", idChunk))
      : Promise.resolve([] as JsonRecord[]),
  ]);
  const poMap = new Map(poRows.map((row) => [String(row.id), row]));
  const stoMap = new Map(stoRows.map((row) => [String(row.id), row]));

  const allowed: GrnPlanRow[] = [];
  const forbidden: ForbiddenRow[] = [];

  for (const grnId of grnIds) {
    const grn = grnMap.get(grnId);
    if (!grn) {
      forbidden.push({ grn_id: grnId, grn_number: "", reason: "GRN not found." });
      continue;
    }
    const grnNumber = toTrimmedString(grn.grn_number);
    const companyId = toTrimmedString(grn.company_id);
    const ownCompanyAllowed = companyId ? await canWriteAC01(ctx, companyId) : false;

    let billToCompanyId: string | null = null;
    let crcpAllowed = false;
    if (!ownCompanyAllowed) {
      const po = grn.po_id ? poMap.get(toTrimmedString(grn.po_id)) : null;
      const sto = grn.sto_id ? stoMap.get(toTrimmedString(grn.sto_id)) : null;
      const resolvedBillTo = toTrimmedString(po?.company_id ?? sto?.receiving_company_id);
      const crcpEnabled = Boolean(po?.crcp_enabled ?? sto?.crcp_enabled ?? false);
      if (resolvedBillTo && crcpEnabled) {
        billToCompanyId = resolvedBillTo;
        crcpAllowed = await canWriteCrcp(ctx, resolvedBillTo, "WRITE", "PROC_PLANT_TRANSFER_LIST");
      }
    }

    if (!ownCompanyAllowed && !crcpAllowed) {
      forbidden.push({ grn_id: grnId, grn_number: grnNumber, reason: "No write access (neither AC01 nor PO12 CRCP path) for this GRN." });
      continue;
    }

    const perPackQty = grn.per_pack_qty != null ? Number(grn.per_pack_qty) : null;
    const consideredQty = Number(grn.considered_qty ?? grn.received_qty ?? 0);
    const consideredQtyBase = perPackQty != null && perPackQty > 0 ? consideredQty * perPackQty : consideredQty;

    allowed.push({
      grn_id: grnId,
      grn_number: grnNumber,
      company_id: companyId,
      considered_qty_base: consideredQtyBase,
      cost_lines: [],
      deduction_lines: [],
      bill_to_company_id: ownCompanyAllowed ? null : billToCompanyId,
    });
  }

  if (allowed.length === 0) {
    return { allowed, forbidden, duplicateWarnings: [] };
  }

  // Per-line distribution: SAME_TO_MANY copies the line unchanged onto every
  // allowed GRN (PER_UOM's own rate-x-qty math happens later, at apply time,
  // the same way save_ac01_grn_cost already does it). DISTRIBUTED splits
  // that line's own `amount` as one lump-sum total across only the ALLOWED
  // GRNs (a forbidden GRN never silently absorbs part of the typed total).
  for (const lineInput of costLineInputs) {
    if (mode === "DISTRIBUTED") {
      const perGrnAmount = distributeAmount(
        lineInput.amount,
        allowed.map((g) => ({ grn_id: g.grn_id, considered_qty_base: g.considered_qty_base })),
        splitMethod,
      );
      for (const grn of allowed) {
        grn.cost_lines.push({ ...lineInput, amount: perGrnAmount.get(grn.grn_id) ?? 0, entry_mode: "AD_HOC" });
      }
    } else {
      for (const grn of allowed) {
        grn.cost_lines.push({ ...lineInput });
      }
    }
  }
  for (const lineInput of deductionLineInputs) {
    if (mode === "DISTRIBUTED" && lineInput.amount != null) {
      const perGrnAmount = distributeAmount(
        lineInput.amount,
        allowed.map((g) => ({ grn_id: g.grn_id, considered_qty_base: g.considered_qty_base })),
        splitMethod,
      );
      for (const grn of allowed) {
        grn.deduction_lines.push({ ...lineInput, amount: perGrnAmount.get(grn.grn_id) ?? 0 });
      }
    } else {
      for (const grn of allowed) {
        grn.deduction_lines.push({ ...lineInput });
      }
    }
  }

  // Duplicate-prevention check (soft warning, §3.5.8's own lock) -- compare
  // each allowed GRN's about-to-be-added lines against its EXISTING
  // landed_cost_line/landed_cost_deduction_line rows for an exact
  // cost_type/deduction_type_id + amount match.
  const allowedGrnIds = allowed.map((g) => g.grn_id);
  const lcRows = await fetchInChunks<JsonRecord>(allowedGrnIds, (idChunk) =>
    serviceRoleClient.schema("erp_procurement").from("landed_cost")
      .select("id, grn_id").in("grn_id", idChunk));
  const lcIdByGrnId = new Map(lcRows.map((row) => [String(row.grn_id), String(row.id)]));
  const lcIds = [...new Set(lcRows.map((row) => String(row.id)))];
  const [existingCostLines, existingDeductionLines] = await Promise.all([
    lcIds.length
      ? fetchInChunks<JsonRecord>(lcIds, (idChunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost_line")
          .select("lc_id, cost_type, amount").in("lc_id", idChunk))
      : Promise.resolve([] as JsonRecord[]),
    lcIds.length
      ? fetchInChunks<JsonRecord>(lcIds, (idChunk) =>
        serviceRoleClient.schema("erp_procurement").from("landed_cost_deduction_line")
          .select("lc_id, deduction_type_id, amount").in("lc_id", idChunk))
      : Promise.resolve([] as JsonRecord[]),
  ]);

  const duplicateWarnings: Array<{ grn_id: string; grn_number: string; kind: "cost" | "deduction"; label: string; amount: number }> = [];
  for (const grn of allowed) {
    const lcId = lcIdByGrnId.get(grn.grn_id);
    if (!lcId) continue;
    const existingCost = existingCostLines.filter((row) => String(row.lc_id) === lcId);
    const existingDeduction = existingDeductionLines.filter((row) => String(row.lc_id) === lcId);
    for (const line of grn.cost_lines) {
      const match = existingCost.find((row) => toTrimmedString(row.cost_type) === line.cost_type && Number(row.amount) === line.amount);
      if (match) {
        duplicateWarnings.push({ grn_id: grn.grn_id, grn_number: grn.grn_number, kind: "cost", label: line.cost_type, amount: line.amount });
      }
    }
    for (const line of grn.deduction_lines) {
      const match = existingDeduction.find((row) => toTrimmedString(row.deduction_type_id) === line.deduction_type_id && Number(row.amount) === line.amount);
      if (match && line.amount != null) {
        duplicateWarnings.push({ grn_id: grn.grn_id, grn_number: grn.grn_number, kind: "deduction", label: line.deduction_type_id, amount: line.amount });
      }
    }
  }

  return { allowed, forbidden, duplicateWarnings };
}

// CHA dropdown for the page's own cost-line editor -- same
// cha_company_map -> cha_master join getAC01GRNHandler already uses
// per-GRN, exposed here at plain company level since this page deals with
// many GRNs (usually all under the one company the user is working in).
export async function listBulkComponentMapChaOptionsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const companyId = toTrimmedString(new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return okResponse({ items: [] }, ctx.request_id, req);
    try {
      await assertCompanyScope(ctx, companyId);
    } catch {
      return bulkMapErrorResponse(req, ctx, "COMPANY_SCOPE_VIOLATION", 403, "You do not have access to this company.");
    }

    const { data: companyChaMaps } = await serviceRoleClient
      .schema("erp_master").from("cha_company_map")
      .select("cha_id").eq("company_id", companyId).eq("active", true);
    const companyChaIds = [...new Set(((companyChaMaps ?? []) as JsonRecord[]).map((row) => String(row.cha_id)))];
    if (companyChaIds.length === 0) return okResponse({ items: [] }, ctx.request_id, req);

    const chas = await fetchInChunks<JsonRecord>(companyChaIds, (chunk) =>
      serviceRoleClient.schema("erp_master").from("cha_master")
        .select("id, cha_code, cha_name").eq("active", true).in("id", chunk));
    return okResponse({ items: chas }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "BULK_MAP_CHA_OPTIONS_FAILED";
    return bulkMapErrorResponse(req, ctx, code, 500, code);
  }
}

export async function previewBulkComponentMapHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    const plan = await buildBulkComponentMapPlan(ctx, body);
    return okResponse(
      {
        allowed: plan.allowed.map((g) => ({
          grn_id: g.grn_id,
          grn_number: g.grn_number,
          cost_lines: g.cost_lines,
          deduction_lines: g.deduction_lines,
        })),
        forbidden: plan.forbidden,
        duplicate_warnings: plan.duplicateWarnings,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "BULK_MAP_PREVIEW_FAILED";
    return bulkMapErrorResponse(req, ctx, code, 400, code);
  }
}

// Net-amount math for total_cost recompute -- mirrors save_ac01_grn_cost's
// own v_net_amount logic exactly (PER_UOM rate x qty, ADDITIONAL_DUTY_IGST
// zeroed, GST inclusive/exclusive treatment) so a later real AC01 Save for
// this same GRN (which runs the full RPC) lands on the same total.
function computeCostLineNetAmount(line: JsonRecord, consideredQtyBase: number): number {
  let net = Number(line.amount ?? 0);
  if (line.entry_mode === "PER_UOM") net *= consideredQtyBase;
  if (NET_EXCLUDED_COST_TYPES.has(String(line.cost_type))) return 0;
  const gstRate = line.gst_rate != null ? Number(line.gst_rate) : 0;
  if (line.has_gst === true && gstRate > 0 && line.gst_treatment === "INCLUSIVE") {
    net = net / (1 + gstRate / 100);
  }
  return net;
}

export async function applyBulkComponentMapHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    const body = await parseBody(req);
    if (body.invoice_verified !== true) {
      return bulkMapErrorResponse(req, ctx, "BULK_MAP_INVOICE_VERIFICATION_REQUIRED", 400, 'Check "I Verify" before applying.');
    }
    const plan = await buildBulkComponentMapPlan(ctx, body);

    const results: Array<{ grn_id: string; grn_number: string; status: string; lc_id?: string; total_cost?: number }> = [
      ...plan.forbidden.map((row) => ({ grn_id: row.grn_id, grn_number: row.grn_number, status: "FORBIDDEN" })),
    ];

    // DEPENDENT: sequential, not Promise.all — each GRN's own landed_cost
    // header create-or-reuse (SELECT latest -> INSERT-if-missing) is a
    // read-then-write with no unique-constraint backstop; running many in
    // parallel risks two concurrent calls both missing the same GRN's
    // not-yet-committed header and creating two. Per-GRN volume here is low
    // (~a bulk batch, not a high-frequency hot path), so sequential is cheap
    // insurance, not a real throughput concern.
    for (const grn of plan.allowed) {
      try {
        let lcId: string | null = null;
        const { data: existingLc } = await serviceRoleClient
          .schema("erp_procurement").from("landed_cost")
          .select("id").eq("grn_id", grn.grn_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        lcId = existingLc?.id ? String(existingLc.id) : null;

        if (!lcId) {
          const { data: lcNumberData } = await serviceRoleClient
            .schema("erp_procurement").rpc("generate_doc_number", { p_doc_type: "LC" });
          const { data: newLc, error: lcInsertError } = await serviceRoleClient
            .schema("erp_procurement").from("landed_cost")
            .insert({
              lc_number: toTrimmedString(lcNumberData) || `LC-BULK-${grn.grn_id.slice(0, 8)}-${Date.now()}`,
              lc_date: new Date().toISOString().slice(0, 10),
              company_id: grn.company_id,
              grn_id: grn.grn_id,
              status: "DRAFT",
              itc_owner_company_id: grn.bill_to_company_id,
              created_by: ctx.auth_user_id,
            })
            .select("id").single();
          if (lcInsertError || !newLc) throw new Error("BULK_MAP_LANDED_COST_HEADER_CREATE_FAILED");
          lcId = String(newLc.id);
        }

        const { data: lastLine } = await serviceRoleClient
          .schema("erp_procurement").from("landed_cost_line")
          .select("line_number").eq("lc_id", lcId).order("line_number", { ascending: false }).limit(1).maybeSingle();
        let nextLineNumber = (Number(lastLine?.line_number) || 0) + 1;

        for (const line of grn.cost_lines) {
          const { error: insertError } = await serviceRoleClient
            .schema("erp_procurement").from("landed_cost_line")
            .insert({
              lc_id: lcId,
              line_number: nextLineNumber,
              cost_type: line.cost_type,
              cha_id: line.party_type === "CHA" ? line.cha_id : null,
              bill_reference: line.bill_reference,
              bill_date: line.bill_date,
              description: line.description,
              amount: line.amount,
              entry_mode: line.entry_mode,
              has_gst: line.has_gst,
              gst_treatment: line.has_gst ? line.gst_treatment : null,
              gst_rate: line.has_gst ? line.gst_rate : null,
              party_type: line.party_type,
            });
          if (insertError) throw new Error("BULK_MAP_COST_LINE_INSERT_FAILED");
          nextLineNumber += 1;
        }
        for (const line of grn.deduction_lines) {
          const { error: insertError } = await serviceRoleClient
            .schema("erp_procurement").from("landed_cost_deduction_line")
            .insert({
              lc_id: lcId,
              deduction_type_id: line.deduction_type_id,
              amount: line.amount,
              percentage: line.percentage,
              round_off: line.round_off,
              in_landed: line.in_landed,
              created_by: ctx.auth_user_id,
              party_type: line.party_type,
            });
          if (insertError) throw new Error("BULK_MAP_DEDUCTION_LINE_INSERT_FAILED");
        }

        const [allCostLines, allDeductionLines] = await Promise.all([
          serviceRoleClient.schema("erp_procurement").from("landed_cost_line").select("cost_type, amount, entry_mode, has_gst, gst_treatment, gst_rate").eq("lc_id", lcId),
          serviceRoleClient.schema("erp_procurement").from("landed_cost_deduction_line").select("amount, round_off, in_landed").eq("lc_id", lcId),
        ]);
        const totalCharges = ((allCostLines.data ?? []) as JsonRecord[])
          .reduce((sum, row) => sum + computeCostLineNetAmount(row, grn.considered_qty_base), 0);
        const totalDeductions = ((allDeductionLines.data ?? []) as JsonRecord[])
          .filter((row) => row.in_landed === true)
          .reduce((sum, row) => sum + Number(row.amount ?? 0) + Number(row.round_off ?? 0), 0);
        const totalCost = totalCharges + totalDeductions;

        await serviceRoleClient
          .schema("erp_procurement").from("landed_cost")
          .update({ total_cost: totalCost, last_updated_at: new Date().toISOString() })
          .eq("id", lcId);

        await serviceRoleClient
          .schema("erp_procurement").from("goods_receipt")
          .update({ invoice_verified_by: ctx.auth_user_id, invoice_verified_at: new Date().toISOString() })
          .eq("id", grn.grn_id);

        results.push({ grn_id: grn.grn_id, grn_number: grn.grn_number, status: "APPLIED", lc_id: lcId, total_cost: totalCost });
      } catch (grnError) {
        const code = grnError instanceof Error ? grnError.message : "BULK_MAP_APPLY_ROW_FAILED";
        results.push({ grn_id: grn.grn_id, grn_number: grn.grn_number, status: `ERROR:${code}` });
      }
    }

    return okResponse(
      {
        results,
        applied_count: results.filter((r) => r.status === "APPLIED").length,
        forbidden_count: plan.forbidden.length,
        duplicate_warnings: plan.duplicateWarnings,
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "BULK_MAP_APPLY_FAILED";
    return bulkMapErrorResponse(req, ctx, code, 400, code);
  }
}
