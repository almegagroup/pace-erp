/*
 * File-Path: supabase/functions/api/_core/procurement/grn_gst_backfill.handlers.ts
 * Purpose: One-time correction of GRNs posted against a GST-INCLUSIVE PO before the GRN started netting GST
 *          (business owner 2026-11-06). Those GRNs stored the PO's gross rate as `grn_rate` and valued stock at it,
 *          so stock value (WAR) and AC01 (taxable value, GST, payable) carried GST twice.
 *          Dry run lists every affected GRN with its old/new rate; apply re-values the receipt legs of ONE material
 *          through the shared §109 cascade (RM -> SFG -> FG, every root of the material in one replay, as the
 *          cascade requires) and only then stores the net `grn_rate`. Re-running finds nothing left to do.
 *          Same authority as the other valuation correction (PROC_OPENING_STOCK_APPROVAL / APPROVE).
 *          Second kind of correction (same tool, same cascade): "re-sync" GRNs whose receipt leg was posted at a rate that is not
 *          the GRN's commercial rate -- the invoice-later Bulk GRNs (leg posted at 0, rate set later in Invoice Mapping) whose
 *          correction used to stop at the empty Quality-Inspection bucket and never reach the stock on hand (cascade now follows
 *          the Inward QA release leg, see findDownstreamGroup). GRNs carrying AC01 landed cost are left to AC01 (re-save there).
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
  // INCLUSIVE = net GST out of a gross PO rate (also stores the net grn_rate); RESYNC = leg rate differs from the commercial rate.
  // QA_RATE = an Inward QA decision leg (QI -> Unrestricted/Blocked/...) posted at a rate that is not the GRN leg's own rate
  //           (the PO-UoM rate was used on a base-UoM quantity: MT rate on kg = 1000x).
  // LEG_SYNC = (separate "leg_sync" mode) an Inward QA IN leg set to its GRN's real base-UoM rate incl. landed cost.
  kind: "INCLUSIVE" | "RESYNC" | "QA_RATE" | "LEG_SYNC";
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
  storage_location_id?: string;
  stock_type_code?: string;
};

async function findCandidates(ctx: Ctx, materialId: string): Promise<{ candidates: Candidate[]; skipped: JsonRecord[] }> {
  const inclusive = await findInclusiveCandidates(ctx, materialId);
  const resync = await findResyncCandidates(ctx, materialId, new Set(inclusive.candidates.map((c) => c.grn_id)));
  // GRNs another kind is already correcting are left to it, so no receipt is re-valued twice in one action.
  const claimed = new Set([...inclusive.candidates, ...resync.candidates].map((c) => c.grn_id));
  const qaRate = await findQaRateCandidates(ctx, materialId, claimed);
  return {
    candidates: [...inclusive.candidates, ...resync.candidates, ...qaRate.candidates],
    skipped: [...inclusive.skipped, ...resync.skipped, ...qaRate.skipped],
  };
}

async function findInclusiveCandidates(ctx: Ctx, materialId: string): Promise<{ candidates: Candidate[]; skipped: JsonRecord[] }> {
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
      kind: "INCLUSIVE",
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

const LEG_SYNC_REASON = "Release-leg rate re-sync (every Inward QA leg at its GRN's real rate)";
const LEG_SYNC_TOLERANCE = 0.005; // 0.5 %

// "leg_sync" mode. Found live 2026-11-19 (CMP003 Fine Sand): old valuation corrections were logged without the per-leg rate, so
// every later bucket replay dropped them, and split parents' release legs were never corrected -- the Unrestricted WAR sat at
// 2.04 while a replay with every QA leg at its GRN's real rate gives ~2.95. The cure is ONE replay per bucket carrying EVERY
// leg's real rate (the engine now stores it as the leg's memory, so this cannot recur). Real rate per GRN comes from
// derive_grn_leg_rates(): commercial rate per base unit + that GRN's own landed cost per base unit (split parent = its children).
// A GRN whose rate is not known yet (invoice-later, no invoice) yields NULL and is left at its ledger rate.
async function findLegSyncCandidates(ctx: Ctx, materialId: string): Promise<{ candidates: Candidate[]; skipped: JsonRecord[]; buckets: JsonRecord[] }> {
  const skipped: JsonRecord[] = [];
  const qaDocs: JsonRecord[] = [];
  for (let from = 0; ; from += 1000) {
    let query = serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
      .select("id, grn_id, material_id, company_id").not("grn_id", "is", null)
      .order("id", { ascending: true }).range(from, from + 999);
    if (materialId) query = query.eq("material_id", materialId);
    const { data, error } = await query;
    if (error) throw new Error("GST_BACKFILL_LOOKUP_FAILED");
    qaDocs.push(...((data ?? []) as JsonRecord[]));
    if ((data ?? []).length < 1000) break;
  }
  if (qaDocs.length === 0) return { candidates: [], skipped, buckets: [] };
  const qaById = new Map(qaDocs.map((q) => [text(q.id), q]));
  const stockDocs = await fetchInChunks<JsonRecord>([...qaById.keys()], (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_document")
    .select("id, reference_document_id").eq("reference_document_type", "QA").in("reference_document_id", chunk).order("id", { ascending: true }));
  const qaByStockDoc = new Map(stockDocs.map((d) => [text(d.id), text(d.reference_document_id)]));
  const legs = await fetchInChunks<JsonRecord>([...qaByStockDoc.keys()], (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_ledger")
    .select("id, stock_document_id, quantity, valuation_rate, company_id, material_id, storage_location_id, stock_type_code")
    .eq("direction", "IN").in("stock_document_id", chunk).order("id", { ascending: true }));

  const grnIds = [...new Set(qaDocs.map((q) => text(q.grn_id)))];
  const grnRows = await fetchInChunks<JsonRecord>(grnIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
    .select("id, grn_number, status").in("id", chunk).order("id", { ascending: true }));
  const grnById = new Map(grnRows.map((g) => [text(g.id), g]));
  const derivedByGrn = new Map<string, number | null>();
  for (let i = 0; i < grnIds.length; i += 200) {
    const { data, error } = await serviceRoleClient.schema("erp_procurement").rpc("derive_grn_leg_rates", { p_grn_ids: grnIds.slice(i, i + 200) });
    if (error) throw new Error("LEG_SYNC_DERIVE_FAILED");
    for (const row of (data ?? []) as JsonRecord[]) {
      derivedByGrn.set(text(row.grn_id), row.leg_rate == null ? null : Number(row.leg_rate));
    }
  }

  const scoped = new Set<string>();
  const candidates: Candidate[] = [];
  for (const leg of legs) {
    const qa = qaById.get(qaByStockDoc.get(text(leg.stock_document_id)) ?? "");
    const grn = qa ? grnById.get(text(qa.grn_id)) : null;
    if (!qa || !grn) continue;
    const status = text(grn.status);
    if (status !== "POSTED" && status !== "SPLIT") continue; // REVERSED etc.: nothing to value
    const target = derivedByGrn.get(text(grn.id));
    if (target == null || !(target > 0)) {
      skipped.push({ grn_number: grn.grn_number, reason: "rate not known yet (no invoice) - left at its ledger rate" });
      continue;
    }
    const quantity = Number(leg.quantity ?? 0);
    const oldRate = Number(leg.valuation_rate ?? 0);
    if (!(quantity > 0) || Math.abs(oldRate - target) <= LEG_SYNC_TOLERANCE * Math.max(target, 0.01)) continue;
    const companyId = text(leg.company_id);
    if (!scoped.has(companyId)) { await assertCompanyScope(ctx, companyId); scoped.add(companyId); }
    candidates.push({
      kind: "LEG_SYNC",
      grn_id: text(grn.id),
      grn_number: text(grn.grn_number),
      company_id: companyId,
      material_id: text(leg.material_id),
      ledger_id: text(leg.id),
      target_grn_rate: target,
      old_grn_rate: oldRate,
      quantity_base: quantity,
      old_leg_rate: oldRate,
      new_leg_rate: target,
      storage_location_id: text(leg.storage_location_id),
      stock_type_code: text(leg.stock_type_code),
    });
  }

  // Dry-run view: per snapshot bucket, the WAR now and the WAR after ONE replay carrying every leg's real rate.
  const byBucket = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.company_id}|${c.material_id}|${c.storage_location_id}|${c.stock_type_code}`;
    byBucket.set(key, [...(byBucket.get(key) ?? []), c]);
  }
  const buckets: JsonRecord[] = [];
  for (const rows of byBucket.values()) {
    const { data, error } = await serviceRoleClient.schema("erp_inventory")
      .rpc("simulate_valuation_at_rows", { p_corrections: rows.map((r) => ({ stock_ledger_id: r.ledger_id, new_rate: r.new_leg_rate })) });
    if (error || !data) { skipped.push({ grn_number: rows[0].grn_number, reason: "bucket cannot be simulated" }); continue; }
    const sim = data as JsonRecord;
    buckets.push({
      company_id: rows[0].company_id,
      material_id: rows[0].material_id,
      storage_location_id: rows[0].storage_location_id,
      stock_type_code: rows[0].stock_type_code,
      legs: rows.length,
      quantity_base: Number(rows.reduce((sum, r) => sum + r.quantity_base, 0).toFixed(3)),
      old_rate: Number(sim.old_rate ?? 0),
      new_rate: Number(sim.new_rate ?? 0),
      quantity_on_hand: Number(sim.quantity_on_hand ?? 0),
    });
  }
  return { candidates, skipped, buckets };
}
const QA_RATE_REASON = "Inward QA leg rate set to the GRN leg rate (UoM mix-up)";
const QA_RATE_TOLERANCE = 0.005; // 0.5 %

// Inward QA posted the usage-decision legs at the GRN's PO-UoM rate while the quantity is in base UoM (MT rate on kg: 1000x).
// For every QA decision leg that went IN to a bucket, the right leg rate is the GRN's own receipt-leg rate
// (commercial rate / base-per-PO-unit), the same figure the GRN posted. Left alone: GRNs another correction already handles,
// and GRNs with AC01 landed cost (their leg legitimately differs; re-saving AC01 re-values the QA legs through the cascade).
async function findQaRateCandidates(ctx: Ctx, materialId: string, claimedGrnIds: Set<string>): Promise<{ candidates: Candidate[]; skipped: JsonRecord[] }> {
  const skipped: JsonRecord[] = [];
  const qaDocs: JsonRecord[] = [];
  for (let from = 0; ; from += 1000) {
    let query = serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
      .select("id, grn_id, material_id, company_id").not("grn_id", "is", null)
      .order("id", { ascending: true }).range(from, from + 999);
    if (materialId) query = query.eq("material_id", materialId);
    const { data, error } = await query;
    if (error) throw new Error("GST_BACKFILL_LOOKUP_FAILED");
    qaDocs.push(...((data ?? []) as JsonRecord[]));
    if ((data ?? []).length < 1000) break;
  }
  const qaPool = qaDocs.filter((q) => !claimedGrnIds.has(text(q.grn_id)));
  if (qaPool.length === 0) return { candidates: [], skipped };

  const grnIds = [...new Set(qaPool.map((q) => text(q.grn_id)))];
  const grns = await fetchInChunks<JsonRecord>(grnIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("goods_receipt")
    .select("id, grn_number, status, received_qty, grn_rate, confirmed_rate, stock_ledger_id").in("id", chunk).order("id", { ascending: true }));
  const grnById = new Map(grns.map((g) => [text(g.id), g]));
  const grnLedgerRows = await fetchInChunks<JsonRecord>(
    grns.map((g) => text(g.stock_ledger_id)).filter(Boolean),
    (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_ledger").select("id, direction, quantity").in("id", chunk).order("id", { ascending: true }),
  );
  const grnLedgerById = new Map(grnLedgerRows.map((row) => [text(row.id), row]));
  const landed = await fetchInChunks<JsonRecord>(grnIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("landed_cost")
    .select("id, grn_id, total_cost").in("grn_id", chunk).order("id", { ascending: true }));
  const landedGrnIds = new Set(landed.filter((row) => Number(row.total_cost ?? 0) > 0).map((row) => text(row.grn_id)));

  const qaIds = qaPool.map((q) => text(q.id));
  const stockDocs = await fetchInChunks<JsonRecord>(qaIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_document")
    .select("id, reference_document_id").eq("reference_document_type", "QA").in("reference_document_id", chunk).order("id", { ascending: true }));
  const qaByStockDoc = new Map(stockDocs.map((d) => [text(d.id), text(d.reference_document_id)]));
  const qaById = new Map(qaPool.map((q) => [text(q.id), q]));
  const legs = await fetchInChunks<JsonRecord>([...qaByStockDoc.keys()], (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_ledger")
    .select("id, stock_document_id, direction, quantity, value, valuation_rate").eq("direction", "IN").in("stock_document_id", chunk).order("id", { ascending: true }));
  const markers = await fetchInChunks<JsonRecord>(legs.map((l) => text(l.id)), (chunk) => serviceRoleClient.schema("erp_inventory").from("valuation_correction_log")
    .select("id, target_ledger_id").in("target_ledger_id", chunk).order("id", { ascending: true }));
  // ANY earlier correction aimed at a leg counts (the 15 Oct "Historical QA MT-to-KG" run used its own reason text).
  // The ledger keeps the wrong original rate forever (append-only), so the leg still LOOKS wrong although the stock value was
  // fixed; only a log row says it was handled.
  const doneLedgerIds = new Set(markers.map((row) => text(row.target_ledger_id)));
  const legBucketKey = (leg: JsonRecord) => {
    const qa = qaById.get(qaByStockDoc.get(text(leg.stock_document_id)) ?? "");
    return `${text(qa?.company_id)}|${text(qa?.material_id)}`;
  };
  // A correction replays the whole bucket from the immutable ledger, so a bucket that already had some legs corrected would
  // lose those corrections if only the remaining legs were passed in. Such buckets are not offered here.
  const partlyDoneBuckets = new Set(legs.filter((leg) => doneLedgerIds.has(text(leg.id))).map(legBucketKey));

  const scoped = new Set<string>();
  const candidates: Candidate[] = [];
  for (const leg of legs) {
    if (doneLedgerIds.has(text(leg.id))) continue;
    const qa = qaById.get(qaByStockDoc.get(text(leg.stock_document_id)) ?? "");
    const grn = qa ? grnById.get(text(qa.grn_id)) : null;
    if (!qa || !grn || text(grn.status) !== "POSTED") continue;
    const grnLedger = grnLedgerById.get(text(grn.stock_ledger_id));
    const grnQty = Number(grnLedger?.quantity ?? 0);
    const received = Number(grn.received_qty ?? 0);
    const commercial = Number(grn.confirmed_rate ?? grn.grn_rate ?? 0);
    if (!grnLedger || text(grnLedger.direction) !== "IN" || !(grnQty > 0) || !(received > 0) || !(commercial > 0)) continue;
    if (landedGrnIds.has(text(grn.id))) { skipped.push({ grn_number: grn.grn_number, reason: "has AC01 landed cost - re-save it in AC01" }); continue; }
    const target = commercial / (grnQty / received);
    const quantity = Number(leg.quantity ?? 0);
    const oldRate = Number(leg.valuation_rate ?? 0);
    if (!(quantity > 0) || Math.abs(oldRate - target) <= QA_RATE_TOLERANCE * Math.max(target, 0.01)) continue;
    if (partlyDoneBuckets.has(legBucketKey(leg))) {
      skipped.push({ grn_number: grn.grn_number, reason: "Inward QA leg in a bucket that was already partly corrected - needs the leg-rate memory fix first" });
      continue;
    }
    const companyId = text(qa.company_id);
    if (!scoped.has(companyId)) { await assertCompanyScope(ctx, companyId); scoped.add(companyId); }
    candidates.push({
      kind: "QA_RATE",
      grn_id: text(grn.id),
      grn_number: text(grn.grn_number),
      company_id: companyId,
      material_id: text(qa.material_id),
      ledger_id: text(leg.id),
      target_grn_rate: Number(grn.grn_rate ?? 0),
      old_grn_rate: Number(grn.grn_rate ?? 0),
      quantity_base: quantity,
      old_leg_rate: oldRate,
      new_leg_rate: target,
    });
  }
  return { candidates, skipped };
}

async function findResyncCandidates(ctx: Ctx, materialId: string, alreadyInclusive: Set<string>): Promise<{ candidates: Candidate[]; skipped: JsonRecord[] }> {
  const skipped: JsonRecord[] = [];
  const grns: JsonRecord[] = [];
  for (let from = 0; ; from += 1000) {
    let query = serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .select("id, grn_number, company_id, material_id, grn_rate, confirmed_rate, received_qty, stock_ledger_id")
      .eq("status", "POSTED").not("stock_ledger_id", "is", null)
      .order("id", { ascending: true }).range(from, from + 999);
    if (materialId) query = query.eq("material_id", materialId);
    const { data, error } = await query;
    if (error) throw new Error("GST_BACKFILL_LOOKUP_FAILED");
    grns.push(...((data ?? []) as JsonRecord[]));
    if ((data ?? []).length < 1000) break;
  }
  const pool = grns.filter((grn) => !alreadyInclusive.has(text(grn.id)));
  if (pool.length === 0) return { candidates: [], skipped };

  const grnIds = pool.map((grn) => text(grn.id));
  const ledgerIds = pool.map((grn) => text(grn.stock_ledger_id));
  const [ledgerRows, qaDocs, landed, markers] = await Promise.all([
    fetchInChunks<JsonRecord>(ledgerIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("stock_ledger")
      .select("id, direction, quantity, value").in("id", chunk).order("id", { ascending: true })),
    fetchInChunks<JsonRecord>(grnIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("inward_qa_document")
      .select("id, grn_id").in("grn_id", chunk).order("id", { ascending: true })),
    fetchInChunks<JsonRecord>(grnIds, (chunk) => serviceRoleClient.schema("erp_procurement").from("landed_cost")
      .select("id, grn_id, total_cost").in("grn_id", chunk).order("id", { ascending: true })),
    fetchInChunks<JsonRecord>(ledgerIds, (chunk) => serviceRoleClient.schema("erp_inventory").from("valuation_correction_log")
      .select("id, target_ledger_id").eq("reason", RESYNC_REASON).in("target_ledger_id", chunk).order("id", { ascending: true })),
  ]);
  const decisions = await fetchInChunks<JsonRecord>(qaDocs.map((q) => text(q.id)), (chunk) =>
    serviceRoleClient.schema("erp_procurement").from("inward_qa_decision_line")
      .select("id, qa_document_id").in("qa_document_id", chunk).order("id", { ascending: true }));
  const decidedQaIds = new Set(decisions.map((d) => text(d.qa_document_id)));
  const decidedGrnIds = new Set(qaDocs.filter((q) => decidedQaIds.has(text(q.id))).map((q) => text(q.grn_id)));
  const landedGrnIds = new Set(landed.filter((row) => Number(row.total_cost ?? 0) > 0).map((row) => text(row.grn_id)));
  const doneLedgerIds = new Set(markers.map((row) => text(row.target_ledger_id)));
  const ledgerById = new Map(ledgerRows.map((row) => [text(row.id), row]));

  const scoped = new Set<string>();
  const candidates: Candidate[] = [];
  for (const grn of pool) {
    const ledger = ledgerById.get(text(grn.stock_ledger_id));
    const quantity = Number(ledger?.quantity ?? 0);
    const received = Number(grn.received_qty ?? 0);
    if (!ledger || text(ledger.direction) !== "IN" || !(quantity > 0) || !(received > 0)) continue;
    const commercial = Number(grn.confirmed_rate ?? grn.grn_rate ?? 0);
    if (!(commercial > 0)) continue; // rate genuinely not known yet: nothing to sync
    const factor = quantity / received;
    const target = commercial / factor;
    const oldLeg = Number(ledger.value ?? 0) / quantity;
    if (Math.abs(target - oldLeg) <= 0.0005 * Math.max(oldLeg, 0.01)) continue; // already at the commercial rate
    if (!decidedGrnIds.has(text(grn.id))) continue; // still in QI: the normal mapping/AC01 correction already covers that bucket
    if (doneLedgerIds.has(text(grn.stock_ledger_id))) continue; // re-synced already
    if (landedGrnIds.has(text(grn.id))) { skipped.push({ grn_number: grn.grn_number, reason: "has AC01 landed cost - re-save it in AC01" }); continue; }
    const companyId = text(grn.company_id);
    if (!scoped.has(companyId)) { await assertCompanyScope(ctx, companyId); scoped.add(companyId); }
    candidates.push({
      kind: "RESYNC",
      grn_id: text(grn.id),
      grn_number: text(grn.grn_number),
      company_id: companyId,
      material_id: text(grn.material_id),
      ledger_id: text(grn.stock_ledger_id),
      target_grn_rate: Number(grn.grn_rate ?? 0),
      old_grn_rate: Number(grn.grn_rate ?? 0),
      quantity_base: quantity,
      old_leg_rate: oldLeg,
      new_leg_rate: target,
    });
  }
  return { candidates, skipped };
}

// POST /api/procurement/grn-gst-inclusive-backfill   { apply?: boolean, material_id?: string, reason?: string }
//   no apply        -> dry run: every affected GRN, grouped by material, with the value change
//   apply + material_id -> starts a background job for that material and answers at once with { job_id }.
//                          The cascade can take minutes; holding the HTTP request open that long left the browser (and its
//                          blocking overlay) hanging whenever a proxy dropped the idle connection, although the work itself
//                          had finished. The job row (grn_gst_backfill_job) is what the screen polls instead.
// GET  /api/procurement/grn-gst-inclusive-backfill/job?job_id=...  -> { status: RUNNING | DONE | FAILED, result, error }
const JOB_STALE_MINUTES = 20; // a RUNNING job older than this lost its server (restart/deploy): it can be re-applied safely

type Summary = { grns: number; quantity_base: number; value_change: number };
const summarize = (rows: Candidate[]): Summary => ({
  grns: rows.length,
  quantity_base: Number(rows.reduce((sum, r) => sum + r.quantity_base, 0).toFixed(3)),
  value_change: Number(rows.reduce((sum, r) => sum + (r.new_leg_rate - r.old_leg_rate) * r.quantity_base, 0).toFixed(2)),
});

async function materialLabelFor(materialIds: string[]): Promise<(id: string) => string> {
  const materials = await fetchInChunks<JsonRecord>(materialIds, (chunk) =>
    serviceRoleClient.schema("erp_master").from("material_master")
      .select("id, pace_code, material_name, base_uom_code").in("id", chunk).order("id", { ascending: true }),
  ).catch(() => [] as JsonRecord[]);
  const byId = new Map(materials.map((m) => [text(m.id), m]));
  return (id: string) => {
    const m = byId.get(id);
    return [m?.pace_code, m?.material_name].filter(Boolean).join(" — ") || "—";
  };
}

// The actual correction of one material (what the old synchronous apply did). Returns the payload the screen shows.
async function applyMaterial(ctx: Ctx, materialId: string, reason: string, legSync = false): Promise<JsonRecord> {
  const label = await materialLabelFor([materialId]);
  if (legSync) {
    const found = await findLegSyncCandidates(ctx, materialId);
    if (found.candidates.length === 0) return { dry_run: false, corrected: 0, failed: 0, material: label(materialId), skipped: dedupeSkipped(found.skipped) };
    // ONE cascade carrying every leg of every bucket: the replay of a bucket needs all its legs' real rates together.
    const legResults = await cascadeRecalculate(
      found.candidates.map((c) => ({ ledgerId: c.ledger_id, newRate: c.new_leg_rate })),
      ctx.auth_user_id,
      LEG_SYNC_REASON,
    );
    const okLegs = new Set(legResults.filter((r) => r.ok).map((r) => r.ledgerId));
    const doneLegs = found.candidates.filter((c) => okLegs.has(c.ledger_id));
    const failedLegs = found.candidates.filter((c) => !okLegs.has(c.ledger_id)).map((c) => c.grn_number);
    return {
      dry_run: false,
      material: label(materialId),
      corrected: new Set(doneLegs.map((c) => c.grn_number)).size,
      failed: new Set(failedLegs).size,
      failed_grns: [...new Set(failedLegs)],
      cascade_steps: legResults.length,
      cascade_errors: legResults.filter((r) => !r.ok).map((r) => ({ ledger_id: r.ledgerId, error: r.error })),
      skipped: dedupeSkipped(found.skipped),
      grns: new Set(doneLegs.map((c) => c.grn_number)).size,
      quantity_base: Number(doneLegs.reduce((sum, c) => sum + c.quantity_base, 0).toFixed(3)),
      value_change: Number(found.buckets.reduce((sum, b) => sum + (Number(b.new_rate) - Number(b.old_rate)) * Number(b.quantity_on_hand), 0).toFixed(2)),
    };
  }
  const { candidates, skipped } = await findCandidates(ctx, materialId);
  if (candidates.length === 0) {
    return { dry_run: false, corrected: 0, failed: 0, material: label(materialId), skipped };
  }
  // One replay per snapshot bucket needs ALL of that bucket's roots together, so both kinds go in one cascade; the reason
  // string doubles as the "already re-synced" marker for the RESYNC kind.
  const results = await cascadeRecalculate(
    candidates.map((c) => ({ ledgerId: c.ledger_id, newRate: c.new_leg_rate })),
    ctx.auth_user_id,
    candidates.some((c) => c.kind === "RESYNC") ? RESYNC_REASON : candidates.some((c) => c.kind === "QA_RATE") ? QA_RATE_REASON : reason,
  );
  const okLedgers = new Set(results.filter((r) => r.ok).map((r) => r.ledgerId));
  const done = candidates.filter((c) => okLedgers.has(c.ledger_id));
  // The net GRN rate is stored only for receipts whose stock really was re-valued.
  for (const c of done.filter((entry) => entry.kind === "INCLUSIVE")) {
    const { error } = await serviceRoleClient.schema("erp_procurement").from("goods_receipt")
      .update({ grn_rate: c.target_grn_rate }).eq("id", c.grn_id);
    if (error) throw new Error("GST_BACKFILL_RATE_UPDATE_FAILED");
  }
  const failedRoots = candidates.filter((c) => !okLedgers.has(c.ledger_id)).map((c) => c.grn_number);
  return {
    dry_run: false,
    material: label(materialId),
    corrected: done.length,
    failed: failedRoots.length,
    failed_grns: failedRoots,
    cascade_steps: results.length,
    cascade_errors: results.filter((r) => !r.ok).map((r) => ({ ledger_id: r.ledgerId, error: r.error })),
    skipped,
    ...summarize(done),
  };
}

// One line per GRN, capped: the same GRN can own several legs and the list is only a hint on screen.
function dedupeSkipped(skipped: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const out: JsonRecord[] = [];
  for (const row of skipped) {
    const key = `${text(row.grn_number)}|${text(row.reason)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 50) break;
  }
  return out;
}

async function runJob(jobId: string, ctx: Ctx, materialId: string, reason: string, legSync = false): Promise<void> {
  const jobs = serviceRoleClient.schema("erp_procurement").from("grn_gst_backfill_job");
  try {
    const result = await applyMaterial(ctx, materialId, reason, legSync);
    await jobs.update({ status: "DONE", result, finished_at: new Date().toISOString() }).eq("id", jobId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GST_BACKFILL_FAILED";
    await jobs.update({ status: "FAILED", error: code, finished_at: new Date().toISOString() }).eq("id", jobId);
  }
}

export async function grnGstInclusiveBackfillHandler(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const apply = body.apply === true;
    const materialId = text(body.material_id);
    const legSync = text(body.mode) === "leg_sync";
    if (apply && !materialId) return fail(req, ctx, "GST_BACKFILL_MATERIAL_REQUIRED", 400, "Apply one material at a time.");
    const reason = text(body.reason) || "GST-inclusive PO rate netted of GST (backfill)";

    if (apply) {
      const jobs = serviceRoleClient.schema("erp_procurement").from("grn_gst_backfill_job");
      // A job whose server went away (restart / deploy) stays RUNNING forever: release it so the material is not blocked.
      const staleBefore = new Date(Date.now() - JOB_STALE_MINUTES * 60_000).toISOString();
      await serviceRoleClient.schema("erp_procurement").from("grn_gst_backfill_job")
        .update({ status: "FAILED", error: "INTERRUPTED", finished_at: new Date().toISOString() })
        .eq("status", "RUNNING").lt("started_at", staleBefore);

      const { data: job, error: jobError } = await jobs
        .insert({ material_id: materialId, status: "RUNNING", created_by: ctx.auth_user_id })
        .select("id").single();
      if (jobError || !job) {
        // The partial unique index allows one RUNNING job per material.
        if (String(jobError?.code) === "23505") {
          return fail(req, ctx, "GST_BACKFILL_ALREADY_RUNNING", 409, "This material is already being corrected. Wait for it to finish.");
        }
        throw new Error("GST_BACKFILL_JOB_CREATE_FAILED");
      }
      // Fire and forget: the process keeps running after the response (Render's long-lived Node server).
      void runJob(String(job.id), ctx, materialId, reason, legSync);
      return okResponse({ data: { job_id: job.id, status: "RUNNING" } }, ctx.request_id, req);
    }

    if (legSync) {
      const found = await findLegSyncCandidates(ctx, materialId);
      const ids = [...new Set(found.candidates.map((c) => c.material_id))];
      const legLabel = await materialLabelFor(ids);
      const legBaseUom = new Map<string, string>();
      if (ids.length > 0) {
        const uomRows = await fetchInChunks<JsonRecord>(ids, (chunk) =>
          serviceRoleClient.schema("erp_master").from("material_master").select("id, base_uom_code").in("id", chunk).order("id", { ascending: true }),
        ).catch(() => [] as JsonRecord[]);
        for (const row of uomRows) legBaseUom.set(text(row.id), text(row.base_uom_code));
      }
      const companies = await fetchInChunks<JsonRecord>([...new Set(found.candidates.map((c) => c.company_id))], (chunk) =>
        serviceRoleClient.schema("erp_master").from("companies").select("id, company_code").in("id", chunk).order("id", { ascending: true }),
      ).catch(() => [] as JsonRecord[]);
      const companyCode = new Map(companies.map((row) => [text(row.id), text(row.company_code)]));
      const locationIds = [...new Set(found.candidates.map((c) => c.storage_location_id ?? "").filter(Boolean))];
      const locations = await fetchInChunks<JsonRecord>(locationIds, (chunk) =>
        serviceRoleClient.schema("erp_inventory").from("storage_location_master").select("id, code").in("id", chunk).order("id", { ascending: true }),
      ).catch(() => [] as JsonRecord[]);
      const locationCode = new Map(locations.map((row) => [text(row.id), text(row.code)]));
      const legMaterials = ids.map((id) => {
        const rows = found.candidates.filter((c) => c.material_id === id);
        const mBuckets = found.buckets.filter((b) => b.material_id === id);
        return {
          material_id: id,
          material: legLabel(id),
          base_uom_code: legBaseUom.get(id) || "—",
          grns: new Set(rows.map((r) => r.grn_number)).size,
          quantity_base: Number(rows.reduce((sum, r) => sum + r.quantity_base, 0).toFixed(3)),
          value_change: Number(mBuckets.reduce((sum, b) => sum + (Number(b.new_rate) - Number(b.old_rate)) * Number(b.quantity_on_hand), 0).toFixed(2)),
          grn_numbers: [...new Set(rows.map((r) => r.grn_number))],
          buckets: mBuckets.map((b) => ({
            company: companyCode.get(text(b.company_id)) || "—",
            location: locationCode.get(text(b.storage_location_id)) || "—",
            stock_type_code: b.stock_type_code,
            legs: b.legs,
            quantity_on_hand: b.quantity_on_hand,
            old_rate: b.old_rate,
            new_rate: b.new_rate,
          })),
        };
      });
      return okResponse({
        data: {
          dry_run: true,
          mode: "leg_sync",
          materials: legMaterials,
          skipped: dedupeSkipped(found.skipped),
          total: {
            grns: legMaterials.reduce((sum, m) => sum + m.grns, 0),
            quantity_base: Number(legMaterials.reduce((sum, m) => sum + m.quantity_base, 0).toFixed(3)),
            value_change: Number(legMaterials.reduce((sum, m) => sum + m.value_change, 0).toFixed(2)),
          },
        },
      }, ctx.request_id, req);
    }

    const { candidates, skipped } = await findCandidates(ctx, materialId);
    const materialIds = [...new Set(candidates.map((c) => c.material_id))];
    const label = await materialLabelFor(materialIds);
    const baseUom = new Map<string, string>();
    if (materialIds.length > 0) {
      const rows = await fetchInChunks<JsonRecord>(materialIds, (chunk) =>
        serviceRoleClient.schema("erp_master").from("material_master").select("id, base_uom_code").in("id", chunk).order("id", { ascending: true }),
      ).catch(() => [] as JsonRecord[]);
      for (const row of rows) baseUom.set(text(row.id), text(row.base_uom_code));
    }
    const byMaterial = materialIds.map((id) => {
      const rows = candidates.filter((c) => c.material_id === id);
      return {
        material_id: id,
        material: label(id),
        base_uom_code: baseUom.get(id) || "—",
        ...summarize(rows),
        grn_numbers: rows.map((r) => r.grn_number),
      };
    });
    return okResponse({ data: { dry_run: true, materials: byMaterial, skipped, total: summarize(candidates) } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GST_BACKFILL_FAILED";
    return fail(req, ctx, code, code === "COMPANY_SCOPE_VIOLATION" ? 403 : 500, code);
  }
}

export async function grnGstInclusiveBackfillJobHandler(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const jobId = text(new URL(req.url).searchParams.get("job_id"));
    if (!jobId) return fail(req, ctx, "GST_BACKFILL_JOB_REQUIRED", 400, "job_id is required.");
    const { data: job, error } = await serviceRoleClient.schema("erp_procurement").from("grn_gst_backfill_job")
      .select("id, status, started_at, finished_at, result, error").eq("id", jobId).maybeSingle();
    if (error) throw new Error("GST_BACKFILL_JOB_LOOKUP_FAILED");
    if (!job) return fail(req, ctx, "GST_BACKFILL_JOB_NOT_FOUND", 404, "Job not found.");
    let status = text(job.status);
    let jobError = job.error ?? null;
    // Same rule as the start path: a RUNNING job that outlived its server is reported as interrupted, not as still running.
    if (status === "RUNNING" && Date.now() - new Date(String(job.started_at)).getTime() > JOB_STALE_MINUTES * 60_000) {
      status = "FAILED";
      jobError = "INTERRUPTED";
    }
    return okResponse({ data: { job_id: job.id, status, started_at: job.started_at, finished_at: job.finished_at, result: job.result ?? null, error: jobError } }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GST_BACKFILL_JOB_FAILED";
    return fail(req, ctx, code, 500, code);
  }
}
