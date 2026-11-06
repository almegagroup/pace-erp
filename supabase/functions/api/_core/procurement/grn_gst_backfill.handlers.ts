/*
 * File-Path: supabase/functions/api/_core/procurement/grn_gst_backfill.handlers.ts
 * Purpose: One-time correction of GRNs posted against a GST-INCLUSIVE PO before the GRN started netting GST
 *          (business owner 2026-11-06). Those GRNs stored the PO's gross rate as `grn_rate` and valued stock at it,
 *          so stock value (WAR) and AC01 (taxable value, GST, payable) carried GST twice.
 *          Dry run lists every affected GRN with its old/new rate; apply re-values the receipt legs of ONE material
 *          through the shared §109 cascade (RM -> SFG -> FG, every root of the material in one replay, as the
 *          cascade requires) and only then stores the net `grn_rate`. Re-running finds nothing left to do.
 *          Same authority as the other valuation correction (PROC_OPENING_STOCK_APPROVAL / APPROVE).
 * Authority: Backend
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { errorResponse, okResponse } from "../response.ts";
import { cascadeRecalculate } from "./opening_stock.handlers.ts";

type JsonRecord = Record<string, unknown>;
type Ctx = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const text = (value: unknown): string => String(value ?? "").trim();
const RATE_EPS = 0.00005;

function fail(req: Request, ctx: Ctx, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}

type Candidate = {
  grn_id: string;
  grn_number: string;
  company_id: string;
  material_id: string;
  ledger_id: string;
  target_grn_rate: number;
  old_grn_rate: number;
  quantity_base: number;
  old_leg_rate: number;
  new_leg_rate: number;
};

async function findCandidates(ctx: Ctx, materialId: string): Promise<{ candidates: Candidate[]; skipped: JsonRecord[] }> {
  const { data: poRows, error: poErr } = await serviceRoleClient.schema("erp_procurement").from("purchase_order")
    .select("id").eq("gst_terms", "INCLUSIVE");
  if (poErr) throw new Error("GST_BACKFILL_LOOKUP_FAILED");
  const poIds = ((poRows ?? []) as JsonRecord[]).map((row) => text(row.id));
  if (poIds.length === 0) return { candidates: [], skipped: [] };

  const grns = await fetchInChunks<JsonRecord>(poIds, (chunk) => {
    let query = serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, company_id, material_id, status, grn_rate, po_rate, gst_pct, received_qty, stock_ledger_id, confirmed_rate")
      .in("po_id", chunk)
      .eq("status", "POSTED")
      .order("id", { ascending: true });
    if (materialId) query = query.eq("material_id", materialId);
    return query;
  }).catch(() => { throw new Error("GST_BACKFILL_LOOKUP_FAILED"); });

  const skipped: JsonRecord[] = [];
  const pending = grns.filter((grn) => {
    const gst = Number(grn.gst_pct ?? 0);
    const reason = !grn.stock_ledger_id ? "no stock posting"
      : !(gst > 0) ? "GST % is 0 or missing"
      : grn.confirmed_rate != null ? "rate already confirmed in AC01 (net by nature)"
      : !(Number(grn.grn_rate) > 0) ? "GRN rate is 0 (rate not confirmed)"
      : Math.abs(Number(grn.grn_rate) - Number(grn.po_rate)) > RATE_EPS ? "GRN rate differs from PO rate (custom rate, left alone)"
      : "";
    if (reason) { skipped.push({ grn_number: grn.grn_number, reason }); return false; }
    return true;
  });
  if (pending.length === 0) return { candidates: [], skipped };

  const ledgerRows = await fetchInChunks<JsonRecord>(
    pending.map((grn) => text(grn.stock_ledger_id)),
    (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_ledger")
      .select("id, direction, quantity, value").in("id", chunk).order("id", { ascending: true }),
  ).catch(() => { throw new Error("GST_BACKFILL_LOOKUP_FAILED"); });
  const ledgerById = new Map(ledgerRows.map((row) => [text(row.id), row]));

  const scoped = new Set<string>();
  const candidates: Candidate[] = [];
  for (const grn of pending) {
    const companyId = text(grn.company_id);
    if (!scoped.has(companyId)) { await assertCompanyScope(ctx, companyId); scoped.add(companyId); }
    const ledger = ledgerById.get(text(grn.stock_ledger_id));
    const quantity = Number(ledger?.quantity ?? 0);
    const received = Number(grn.received_qty ?? 0);
    if (!ledger || text(ledger.direction) !== "IN" || !(quantity > 0) || !(received > 0)) {
      skipped.push({ grn_number: grn.grn_number, reason: "receipt leg not found or empty" });
      continue;
    }
    const gst = Number(grn.gst_pct);
    const factor = quantity / received; // base qty per transaction-UoM unit (1 when the GRN is in base UoM)
    const grossRate = Number(grn.grn_rate);
    const netRate = grossRate / (1 + gst / 100);
    const oldLeg = Number(ledger.value ?? 0) / quantity;
    // Anything added on top of the commercial rate (AC01 landed cost per unit) is independent of it, so the
    // leg moves by exactly the GST that was wrongly inside the rate.
    const newLeg = oldLeg - grossRate / factor + netRate / factor;
    if (!(newLeg >= 0)) { skipped.push({ grn_number: grn.grn_number, reason: "corrected value would be negative" }); continue; }
    candidates.push({
      grn_id: text(grn.id),
      grn_number: text(grn.grn_number),
      company_id: companyId,
      material_id: text(grn.material_id),
      ledger_id: text(grn.stock_ledger_id),
      target_grn_rate: Number(netRate.toFixed(4)),
      old_grn_rate: grossRate,
      quantity_base: quantity,
      old_leg_rate: oldLeg,
      new_leg_rate: newLeg,
    });
  }
  return { candidates, skipped };
}

// POST /api/procurement/grn-gst-inclusive-backfill   { apply?: boolean, material_id?: string, reason?: string }
//   no apply        -> dry run: every affected GRN, grouped by material, with the value change
//   apply + material_id -> correct that material (all its affected GRNs in one cascade)
export async function grnGstInclusiveBackfillHandler(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const apply = body.apply === true;
    const materialId = text(body.material_id);
    if (apply && !materialId) return fail(req, ctx, "GST_BACKFILL_MATERIAL_REQUIRED", 400, "Apply one material at a time.");
    const reason = text(body.reason) || "GST-inclusive PO rate netted of GST (backfill)";

    const { candidates, skipped } = await findCandidates(ctx, materialId);

    const materialIds = [...new Set(candidates.map((c) => c.material_id))];
    const materials = await fetchInChunks<JsonRecord>(materialIds, (chunk) =>
      serviceRoleClient.schema("erp_master").from("material_master")
        .select("id, pace_code, material_name, base_uom_code").in("id", chunk).order("id", { ascending: true }),
    ).catch(() => [] as JsonRecord[]);
    const materialById = new Map(materials.map((m) => [text(m.id), m]));
    const label = (id: string) => {
      const m = materialById.get(id);
      return [m?.pace_code, m?.material_name].filter(Boolean).join(" — ") || "—";
    };

    const summarize = (rows: Candidate[]) => ({
      grns: rows.length,
      quantity_base: Number(rows.reduce((sum, r) => sum + r.quantity_base, 0).toFixed(3)),
      value_change: Number(rows.reduce((sum, r) => sum + (r.new_leg_rate - r.old_leg_rate) * r.quantity_base, 0).toFixed(2)),
    });

    if (!apply) {
      const byMaterial = materialIds.map((id) => {
        const rows = candidates.filter((c) => c.material_id === id);
        return {
          material_id: id,
          material: label(id),
          base_uom_code: text(materialById.get(id)?.base_uom_code) || "—",
          ...summarize(rows),
          grn_numbers: rows.map((r) => r.grn_number),
        };
      });
      return okResponse({ data: { dry_run: true, materials: byMaterial, skipped, total: summarize(candidates) } }, ctx.request_id, req);
    }

    if (candidates.length === 0) {
      return okResponse({ data: { dry_run: false, corrected: 0, failed: 0, material: label(materialId), skipped } }, ctx.request_id, req);
    }
    const results = await cascadeRecalculate(
      candidates.map((c) => ({ ledgerId: c.ledger_id, newRate: c.new_leg_rate })),
      ctx.auth_user_id,
      reason,
    );
    const okLedgers = new Set(results.filter((r) => r.ok).map((r) => r.ledgerId));
    const done = candidates.filter((c) => okLedgers.has(c.ledger_id));
    // The net GRN rate is stored only for receipts whose stock really was re-valued.
    for (const c of done) {
      const { error } = await serviceRoleClient.schema("erp_procurement").from("goods_receipt")
        .update({ grn_rate: c.target_grn_rate }).eq("id", c.grn_id);
      if (error) throw new Error("GST_BACKFILL_RATE_UPDATE_FAILED");
    }
    const failedRoots = candidates.filter((c) => !okLedgers.has(c.ledger_id)).map((c) => c.grn_number);
    return okResponse({
      data: {
        dry_run: false,
        material: label(materialId),
        corrected: done.length,
        failed: failedRoots.length,
        failed_grns: failedRoots,
        cascade_steps: results.length,
        cascade_errors: results.filter((r) => !r.ok).map((r) => ({ ledger_id: r.ledgerId, error: r.error })),
        skipped,
        ...summarize(done),
      },
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GST_BACKFILL_FAILED";
    return fail(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}
