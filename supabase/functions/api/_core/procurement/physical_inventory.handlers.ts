/*
 * File-ID: 20.2.1
 * File-Path: supabase/functions/api/_core/procurement/physical_inventory.handlers.ts
 * Gate: 20 (original), redesigned per feasibility doc Section 119 (2026-08-13)
 * Domain: PROCUREMENT
 * Purpose: Physical inventory document lifecycle (MI01-MI07 equivalent) — RM/PM/INT/SFG/FG,
 *          multi-location documents, batch/Packing-PO grain, escalating maker-checker,
 *          document-wide atomic Post with batch-genealogy reco adjustment.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { assertCompanyScope, isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { ROLE } from "../../_shared/role_ladder.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
type PidRow = Record<string, unknown>;
type PiItemRow = Record<string, unknown>;

const PID_RESOURCE = "PROC_PI_LIST";
const PID_MODES = new Set(["LOCATION_WISE", "ITEM_WISE"]);
const PID_STATUSES = new Set(["OPEN", "COUNTED", "PENDING_APPROVAL", "POSTED", "CANCELLED"]);
const STOCK_TYPES = new Set(["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"]);
// §119.7 — RM/PM/INT/MTS-FG/MTS-SFG are blended (no batch dimension). SFG/FG under MTO/HPS/MTEST
// split by batch (+ Packing PO for FG) — resolved separately in getItemCandidates, not via this set.
const PI_BLENDED_MATERIAL_TYPES = new Set(["RM", "PM", "INT"]);
const PI_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);
const BATCH_TRACKED_PO_TYPES = new Set(["MTO", "HPS", "MTEST"]);
const AUDITOR_ROLES = new Set<string>([ROLE.L1_AUDITOR, ROLE.L2_AUDITOR]);

function parseBody(req: Request): Promise<JsonRecord> {
  return req.json().catch(() => ({} as JsonRecord));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getPathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}

function getDocumentIdFromPath(req: Request): string {
  return getPathSegments(req)[3] ?? "";
}

function getItemIdFromPath(req: Request): string {
  return getPathSegments(req)[5] ?? "";
}

function piErrorResponse(
  req: Request,
  ctx: ProcurementHandlerContext,
  code: string,
  status: number,
  message: string,
  extra?: JsonRecord,
): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, extra ?? {}, req);
}

function assertProcurementReadRole(_ctx: ProcurementHandlerContext): void {
  // Protected by upstream pipeline / ACL layer.
}

function derivePIMovementType(stockType: string, difference: number): string {
  const isSurplus = difference > 0;
  switch (toUpperTrimmedString(stockType)) {
    case "QUALITY_INSPECTION":
      return isSurplus ? "P703" : "P704";
    case "BLOCKED":
      return isSurplus ? "P705" : "P706";
    default:
      return isSurplus ? "P701" : "P702";
  }
}

async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }

  return String(data);
}

async function fetchPID(documentId: string): Promise<PidRow> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_document")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) {
    throw new Error("PI_DOCUMENT_NOT_FOUND");
  }

  return data as PidRow;
}

async function fetchPIItems(documentId: string): Promise<PiItemRow[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_item")
    .select("*")
    .eq("document_id", documentId)
    .order("line_number", { ascending: true });

  if (error) {
    throw new Error("PI_ITEM_FETCH_FAILED");
  }

  return (data ?? []) as PiItemRow[];
}

async function hydratePID(documentId: string): Promise<JsonRecord> {
  const [document, items] = await Promise.all([fetchPID(documentId), fetchPIItems(documentId)]);
  return {
    ...document,
    items,
  };
}

async function getStorageLocationScope(storageLocationId: string): Promise<{ company_id: string }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("storage_location_plant_map")
    .select("company_id")
    .eq("storage_location_id", storageLocationId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.company_id) {
    throw new Error("PI_STORAGE_LOCATION_SCOPE_NOT_FOUND");
  }

  return {
    company_id: String(data.company_id),
  };
}

// §119.2 fix (2026-08-03, commit 65107269) kept, extended for §119.12's multi-location documents:
// document-level scope now checks the document's own company_id (always present), not a single
// storage_location_id (which is now optional/mode-dependent).
async function assertPIDocumentCompanyScope(
  ctx: ProcurementHandlerContext,
  companyId: string,
): Promise<void> {
  try {
    await assertCompanyScope(ctx, companyId);
  } catch {
    throw new Error("PI_SCOPE_VIOLATION");
  }
}

// §119.2/Phase-2 write-ACL fix: membership (assertCompanyScope) is necessary but not sufficient —
// this additionally proves an action-level grant on PROC_PI_LIST at the SPECIFIC target company,
// not just the session's active one. `action` must match whatever the route registry already
// gates that same path with (EDIT for create/add-item/cancel/remove-item — Auditor-only tier;
// WRITE for count/recount/submit — count-entry tier; APPROVE for reopen/post — escalating tier,
// on top of which resolvePidActionAuthority() layers the Auditor-vs-Director split).
async function assertPIDCompanyActionAccess(
  ctx: ProcurementHandlerContext,
  companyId: string,
  action: "EDIT" | "WRITE" | "APPROVE",
): Promise<void> {
  await assertPIDocumentCompanyScope(ctx, companyId);
  if (isCompanyScopeAdminBypass(ctx)) return;
  const allowed = await canMaintainCompanyResource(ctx, companyId, PID_RESOURCE, action);
  if (!allowed) throw new Error("PI_SCOPE_VIOLATION");
}

async function assertPIDCompanyEditAccess(ctx: ProcurementHandlerContext, companyId: string): Promise<void> {
  return assertPIDCompanyActionAccess(ctx, companyId, "EDIT");
}

async function listPIScopedCompanyIds(ctx: ProcurementHandlerContext): Promise<string[] | null> {
  if (isCompanyScopeAdminBypass(ctx)) {
    return null;
  }

  const { data: companyRows, error: companyError } = await serviceRoleClient
    .schema("erp_map")
    .from("user_companies")
    .select("company_id")
    .eq("auth_user_id", ctx.auth_user_id);

  if (companyError) {
    throw new Error("PI_SCOPE_LOOKUP_FAILED");
  }

  return [...new Set(((companyRows ?? []) as JsonRecord[]).map((row) => toTrimmedString(row.company_id)).filter(Boolean))];
}

async function getMaterialInfo(materialIds: string[]): Promise<Map<string, JsonRecord>> {
  if (materialIds.length === 0) {
    return new Map();
  }

  const { data, error } = await serviceRoleClient
    .schema("erp_master")
    .from("material_master")
    .select("id, material_type, base_uom_code, material_name, pace_code")
    .in("id", materialIds);

  if (error) {
    throw new Error("PI_MATERIAL_LOOKUP_FAILED");
  }

  return new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
}

// §119.7 — for a batch_number, resolve its owning Process PO's po_type (SFG grain decision).
async function getProcessOrderPoTypeByBatch(batchNumbers: string[]): Promise<Map<string, JsonRecord>> {
  if (batchNumbers.length === 0) return new Map();
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("process_order")
    .select("id, batch_number, po_type, actual_qty, company_id")
    .in("batch_number", batchNumbers);
  if (error) throw new Error("PI_PROCESS_ORDER_LOOKUP_FAILED");
  return new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.batch_number), row]));
}

async function getPackingOrdersByIds(packingOrderIds: string[]): Promise<Map<string, JsonRecord>> {
  if (packingOrderIds.length === 0) return new Map();
  const { data, error } = await serviceRoleClient
    .schema("erp_production")
    .from("packing_order")
    .select("id, po_number, batch_number, actual_qty_kg, process_order_id, company_id")
    .in("id", packingOrderIds);
  if (error) throw new Error("PI_PACKING_ORDER_LOOKUP_FAILED");
  return new Map(((data ?? []) as JsonRecord[]).map((row) => [String(row.id), row]));
}

/*
 * §119.7/§119.12 — book-qty + grain resolution for ONE material at ONE storage location, for a
 * given company. Aggregates `stock_ledger` (IN-OUT) grouped by stock_type — and, for batch-tracked
 * SFG/FG under MTO/HPS/MTEST, ALSO grouped by batch_number (SFG) or batch_number+packing_order_id
 * (FG, packing-order linkage read from stock_document.reference_document_type='PACK_PO').
 *
 * Deliberate scope note: this is a leaner aggregate-only version of IN03's (§116) full
 * ledger-trail resolver (CurrentStockPage/getCurrentStockHandler) — PID only needs "what
 * (material, location[, batch[, packing PO]]) combinations currently have positive book stock",
 * not IN03's arbitrary multi-filter report shape. If IN03's resolver logic changes, re-check this
 * stays consistent, but do not blindly import IN03's heavier machinery here.
 */
async function getBookSnapshotsForMaterial(
  companyId: string,
  storageLocationId: string,
  materialId: string,
  material: JsonRecord,
): Promise<Array<{ material_id: string; stock_type: string; book_qty: number; base_uom_code: string; batch_number: string | null; packing_order_id: string | null }>> {
  const materialType = toUpperTrimmedString(material.material_type);
  if (!PI_MATERIAL_TYPES.has(materialType)) return [];

  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("stock_type_code, base_uom_code, direction, quantity, batch_number, stock_document_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .eq("material_id", materialId);
  if (error) throw new Error("PI_STOCK_LEDGER_LOOKUP_FAILED");

  const rows = (data ?? []) as JsonRecord[];
  const isBlended = PI_BLENDED_MATERIAL_TYPES.has(materialType);

  // FG needs the packing_order_id per ledger row — resolved via stock_document once, batched.
  let pkoByDocId = new Map<string, string>();
  if (materialType === "FG" && !isBlended) {
    const docIds = [...new Set(rows.map((r) => toTrimmedString(r.stock_document_id)).filter(Boolean))];
    if (docIds.length > 0) {
      const { data: docRows, error: docErr } = await serviceRoleClient
        .schema("erp_inventory")
        .from("stock_document")
        .select("id, reference_document_type, reference_document_id")
        .in("id", docIds);
      if (docErr) throw new Error("PI_STOCK_DOCUMENT_LOOKUP_FAILED");
      pkoByDocId = new Map(
        ((docRows ?? []) as JsonRecord[])
          .filter((d) => toTrimmedString(d.reference_document_type) === "PACK_PO")
          .map((d) => [toTrimmedString(d.id), toTrimmedString(d.reference_document_id)]),
      );
    }
  }

  // For batch-tracked SFG, whether it's batch-tracked at all depends on the OWNING Process PO's
  // po_type — resolve once for every distinct batch seen.
  let poTypeByBatch = new Map<string, JsonRecord>();
  if ((materialType === "SFG" || materialType === "FG")) {
    const batches = [...new Set(rows.map((r) => toTrimmedString(r.batch_number)).filter(Boolean))];
    poTypeByBatch = await getProcessOrderPoTypeByBatch(batches);
  }

  const aggregates = new Map<string, { stock_type: string; qty: number; base_uom_code: string; batch_number: string | null; packing_order_id: string | null }>();
  for (const row of rows) {
    const stockType = toUpperTrimmedString(row.stock_type_code);
    if (!STOCK_TYPES.has(stockType)) continue;
    const sign = toUpperTrimmedString(row.direction) === "OUT" ? -1 : 1;
    const qty = Number((parseNullableNumber(row.quantity) ?? 0) * sign);
    const batchNumber = toTrimmedString(row.batch_number) || null;

    let key: string;
    let effectiveBatch: string | null = null;
    let effectivePko: string | null = null;

    if (materialType === "SFG" && batchNumber) {
      const owner = poTypeByBatch.get(batchNumber);
      const ownerPoType = toUpperTrimmedString(owner?.po_type);
      if (BATCH_TRACKED_PO_TYPES.has(ownerPoType)) {
        effectiveBatch = batchNumber;
        key = `${stockType}::${batchNumber}`;
      } else {
        key = stockType; // MTS SFG — blended
      }
    } else if (materialType === "FG" && batchNumber) {
      const owner = poTypeByBatch.get(batchNumber);
      const ownerPoType = toUpperTrimmedString(owner?.po_type);
      if (BATCH_TRACKED_PO_TYPES.has(ownerPoType)) {
        const pkoId = pkoByDocId.get(toTrimmedString(row.stock_document_id)) || null;
        effectiveBatch = batchNumber;
        effectivePko = pkoId;
        key = `${stockType}::${batchNumber}::${pkoId ?? ""}`;
      } else {
        key = stockType; // MTS FG — blended
      }
    } else {
      key = stockType; // RM/PM/INT — always blended
    }

    const current = aggregates.get(key) ?? {
      stock_type: stockType,
      qty: 0,
      base_uom_code: toTrimmedString(row.base_uom_code),
      batch_number: effectiveBatch,
      packing_order_id: effectivePko,
    };
    current.qty = Number((current.qty + qty).toFixed(4));
    if (!current.base_uom_code) current.base_uom_code = toTrimmedString(row.base_uom_code);
    aggregates.set(key, current);
  }

  return [...aggregates.values()]
    .filter((entry) => entry.qty > 0)
    .map((entry) => ({
      material_id: materialId,
      stock_type: entry.stock_type,
      book_qty: Number(entry.qty.toFixed(4)),
      base_uom_code: entry.base_uom_code || toTrimmedString(material.base_uom_code),
      batch_number: entry.batch_number,
      packing_order_id: entry.packing_order_id,
    }));
}

type ItemCandidate = {
  material_id: string;
  stock_type: string;
  book_qty: number;
  base_uom_code: string;
  storage_location_id: string;
  batch_number: string | null;
  packing_order_id: string | null;
};

// LOCATION_WISE: every material with positive book stock at ONE location.
async function getLocationWiseCandidates(companyId: string, storageLocationId: string): Promise<ItemCandidate[]> {
  const { data: ledgerMaterialRows, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_ledger")
    .select("material_id")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId);
  if (error) throw new Error("PI_STOCK_LEDGER_LOOKUP_FAILED");
  const materialIds = [...new Set(((ledgerMaterialRows ?? []) as JsonRecord[]).map((r) => toTrimmedString(r.material_id)).filter(Boolean))];
  const materialInfo = await getMaterialInfo(materialIds);

  const results: ItemCandidate[] = [];
  for (const materialId of materialIds) {
    const material = materialInfo.get(materialId);
    if (!material) continue;
    const snaps = await getBookSnapshotsForMaterial(companyId, storageLocationId, materialId, material);
    for (const snap of snaps) {
      results.push({ ...snap, storage_location_id: storageLocationId });
    }
  }
  return results;
}

// ITEM_WISE (§119.12): caller supplies [{material_id, stock_type, storage_location_id}] — each can
// be at a DIFFERENT location within the same company. Batch/PO auto-split still applies per item.
async function getItemWiseCandidates(
  companyId: string,
  rawItems: Array<{ material_id: string; stock_type: string; storage_location_id: string }>,
): Promise<ItemCandidate[]> {
  const materialInfo = await getMaterialInfo([...new Set(rawItems.map((i) => i.material_id))]);
  const results: ItemCandidate[] = [];
  for (const target of rawItems) {
    const material = materialInfo.get(target.material_id);
    if (!material) continue;
    const snaps = await getBookSnapshotsForMaterial(companyId, target.storage_location_id, target.material_id, material);
    const matches = snaps.filter((s) => s.stock_type === target.stock_type);
    if (matches.length > 0) {
      for (const snap of matches) {
        results.push({ ...snap, storage_location_id: target.storage_location_id });
      }
    } else {
      // Not currently in stock at this location — "found but not in system" case (§119.12 step 2).
      // book_qty=0, allowed for RM/PM/INT and blended SFG/FG only (batch/PO can't be guessed).
      if (PI_BLENDED_MATERIAL_TYPES.has(toUpperTrimmedString(material.material_type))) {
        results.push({
          material_id: target.material_id,
          stock_type: target.stock_type,
          book_qty: 0,
          base_uom_code: toTrimmedString(material.base_uom_code),
          storage_location_id: target.storage_location_id,
          batch_number: null,
          packing_order_id: null,
        });
      }
    }
  }
  return results;
}

async function checkPostingBlock(
  materialId: string,
  storageLocationId: string,
  batchNumber: string | null,
): Promise<{ pi_document_id: string; document_number: string } | null> {
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("pi_document_id")
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId);
  query = batchNumber ? query.eq("batch_number", batchNumber) : query.is("batch_number", null);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error("PI_BLOCK_LOOKUP_FAILED");
  }
  if (!data?.pi_document_id) return null;

  const { data: doc } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_document")
    .select("document_number")
    .eq("id", String(data.pi_document_id))
    .maybeSingle();

  return {
    pi_document_id: String(data.pi_document_id),
    document_number: toTrimmedString(doc?.document_number),
  };
}

function blockedResponse(req: Request, ctx: ProcurementHandlerContext, block: { pi_document_id: string; document_number: string }): Response {
  // §119.9 decision 2 — informative, not a bare 409: caller learns WHICH PID document is
  // responsible so the frontend can show a proper modal instead of a generic toast.
  return piErrorResponse(
    req,
    ctx,
    "MATERIAL_POSTING_BLOCKED",
    409,
    `This item is blocked by active Physical Inventory ${block.document_number}.`,
    { pi_document_id: block.pi_document_id, pi_document_number: block.document_number },
  );
}

async function countNullPhysicalQty(documentId: string): Promise<number> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_item")
    .select("id")
    .eq("document_id", documentId)
    .is("physical_qty", null);

  if (error) {
    throw new Error("PI_ITEM_COUNT_LOOKUP_FAILED");
  }

  return Number((data ?? []).length);
}

// §119.5 — escalating maker-checker: whoever COUNTED this document determines who may Post/Reopen
// it. Document-level (any one counted item's counter is representative — §119.5, mixed-counter
// scenario deliberately not guarded against, business owner confirm). SA/GA always pass (blanket).
async function resolvePidActionAuthority(
  ctx: ProcurementHandlerContext,
  documentId: string,
): Promise<{ allowed: boolean; requiredTier: "AUDITOR_OR_DIRECTOR" | "DIRECTOR_ONLY" }> {
  if (isCompanyScopeAdminBypass(ctx)) {
    return { allowed: true, requiredTier: "AUDITOR_OR_DIRECTOR" };
  }

  const { data: countedItem } = await serviceRoleClient
    .schema("erp_procurement")
    .from("physical_inventory_item")
    .select("counted_by")
    .eq("document_id", documentId)
    .not("counted_by", "is", null)
    .limit(1)
    .maybeSingle();

  let counterIsAuditor = false;
  const counterId = toTrimmedString(countedItem?.counted_by);
  if (counterId) {
    const { data: counterRole } = await serviceRoleClient
      .schema("erp_acl")
      .from("user_roles")
      .select("role_code")
      .eq("auth_user_id", counterId)
      .maybeSingle();
    counterIsAuditor = AUDITOR_ROLES.has(toUpperTrimmedString(counterRole?.role_code));
  }

  const callerRole = toUpperTrimmedString(ctx.roleCode);
  const requiredTier = counterIsAuditor ? "DIRECTOR_ONLY" : "AUDITOR_OR_DIRECTOR";
  const allowed = requiredTier === "DIRECTOR_ONLY"
    ? callerRole === ROLE.DIRECTOR
    : callerRole === ROLE.DIRECTOR || AUDITOR_ROLES.has(callerRole);

  return { allowed, requiredTier };
}

function isItemFullyProcessed(item: PiItemRow): boolean {
  const physicalQty = parseNullableNumber(item.physical_qty);
  const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
  return physicalQty !== null && (differenceQty === 0 || Boolean(item.posted_stock_document_id));
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MI01 — Create
// ═══════════════════════════════════════════════════════════════════════════════════════

export async function createPIDHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const body = await parseBody(req);
    const companyId = toTrimmedString(body.company_id);
    const storageLocationId = toTrimmedString(body.storage_location_id);
    const countDate = toTrimmedString(body.count_date);
    const postingDate = toTrimmedString(body.posting_date) || countDate;
    const mode = toUpperTrimmedString(body.mode);
    const notes = toTrimmedString(body.notes);
    const isOpeningStockSource = body.is_opening_stock_source === true;
    const rawItems = Array.isArray(body.items) ? (body.items as JsonRecord[]) : [];

    if (!companyId || !countDate || !postingDate || !PID_MODES.has(mode)) {
      return piErrorResponse(req, ctx, "PI_CREATE_INVALID", 400, "company_id, count_date, posting_date, and valid mode are required.");
    }
    if (mode === "LOCATION_WISE" && !storageLocationId) {
      return piErrorResponse(req, ctx, "PI_CREATE_INVALID", 400, "storage_location_id is required for LOCATION_WISE mode.");
    }

    await assertPIDCompanyEditAccess(ctx, companyId);

    let candidates: ItemCandidate[];
    if (mode === "LOCATION_WISE") {
      const locScope = await getStorageLocationScope(storageLocationId);
      if (locScope.company_id !== companyId) {
        return piErrorResponse(req, ctx, "PI_CREATE_INVALID", 400, "storage_location_id does not belong to company_id.");
      }
      candidates = await getLocationWiseCandidates(companyId, storageLocationId);
    } else {
      const targetItems = rawItems
        .map((entry) => ({
          material_id: toTrimmedString(entry.material_id),
          stock_type: toUpperTrimmedString(entry.stock_type),
          storage_location_id: toTrimmedString(entry.storage_location_id),
        }))
        .filter((entry) => entry.material_id && entry.storage_location_id && STOCK_TYPES.has(entry.stock_type));
      candidates = targetItems.length > 0 ? await getItemWiseCandidates(companyId, targetItems) : [];
    }

    // §119.12 step 6 — check every staged combo's block BEFORE creating anything.
    for (const candidate of candidates) {
      const block = await checkPostingBlock(candidate.material_id, candidate.storage_location_id, candidate.batch_number);
      if (block) return blockedResponse(req, ctx, block);
    }

    const documentNumber = await generateProcurementDocNumber("PI");
    const { data: document, error: documentError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .insert({
        document_number: documentNumber,
        company_id: companyId,
        storage_location_id: mode === "LOCATION_WISE" ? storageLocationId : null,
        count_date: countDate,
        posting_date: postingDate,
        mode,
        status: "OPEN",
        notes: notes || null,
        is_opening_stock_source: isOpeningStockSource,
        created_by: ctx.auth_user_id,
      })
      .select("*")
      .single();

    if (documentError || !document) {
      return piErrorResponse(req, ctx, "PI_CREATE_FAILED", 500, "Unable to create physical inventory document.");
    }

    if (candidates.length > 0) {
      const itemPayload = candidates.map((candidate, index) => ({
        document_id: document.id,
        line_number: index + 1,
        material_id: candidate.material_id,
        stock_type: candidate.stock_type,
        storage_location_id: candidate.storage_location_id,
        batch_number: candidate.batch_number,
        packing_order_id: candidate.packing_order_id,
        book_qty: candidate.book_qty,
        base_uom_code: candidate.base_uom_code,
      }));

      const { error: itemError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_item")
        .insert(itemPayload);

      if (itemError) {
        return piErrorResponse(req, ctx, "PI_ITEM_CREATE_FAILED", 500, "Unable to create physical inventory items.");
      }

      const blockPayload = candidates.map((candidate) => ({
        material_id: candidate.material_id,
        storage_location_id: candidate.storage_location_id,
        batch_number: candidate.batch_number,
        pi_document_id: document.id,
      }));
      const { error: blockError } = await serviceRoleClient
        .schema("erp_inventory")
        .from("physical_inventory_block")
        .insert(blockPayload);

      if (blockError) {
        const status = String(blockError.code || "").startsWith("23") ? 409 : 500;
        return piErrorResponse(
          req,
          ctx,
          status === 409 ? "MATERIAL_POSTING_BLOCKED" : "PI_BLOCK_CREATE_FAILED",
          status,
          status === 409 ? "Material has an active physical inventory count in progress." : "Unable to create physical inventory posting blocks.",
        );
      }
    }

    return okResponse(await hydratePID(String(document.id)), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_CREATE_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "MATERIAL_POSTING_BLOCKED" ? 409 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// List / Get / Print-detail (MI03)
// ═══════════════════════════════════════════════════════════════════════════════════════

export async function listPIDsHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100);

    let query = serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && PID_STATUSES.has(status)) {
      query = query.eq("status", status);
    }

    const scopedCompanyIds = await listPIScopedCompanyIds(ctx);
    if (scopedCompanyIds && scopedCompanyIds.length === 0) {
      return okResponse({ items: [] }, ctx.request_id, req);
    }
    if (scopedCompanyIds) {
      query = query.in("company_id", scopedCompanyIds);
    }

    const { data, error } = await query;
    if (error) {
      return piErrorResponse(req, ctx, "PI_LIST_FAILED", 500, "Unable to list physical inventory documents.");
    }

    const rows = (data ?? []) as PidRow[];
    const documentIds = rows.map((row) => String(row.id)).filter(Boolean);
    const counts = new Map<string, { item_count: number; counted_count: number }>();

    if (documentIds.length > 0) {
      const { data: items, error: itemError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_item")
        .select("document_id, physical_qty")
        .in("document_id", documentIds);

      if (itemError) {
        return piErrorResponse(req, ctx, "PI_LIST_COUNTS_FAILED", 500, "Unable to load item counts.");
      }

      for (const item of items ?? []) {
        const documentId = String(item.document_id ?? "");
        if (!documentId) continue;
        const current = counts.get(documentId) ?? { item_count: 0, counted_count: 0 };
        current.item_count += 1;
        if (item.physical_qty !== null && item.physical_qty !== undefined) {
          current.counted_count += 1;
        }
        counts.set(documentId, current);
      }
    }

    // §8A — companies/locations resolved for display, never raw UUIDs.
    const companyIds = [...new Set(rows.map((r) => toTrimmedString(r.company_id)).filter(Boolean))];
    const { data: companyRows } = companyIds.length
      ? await serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", companyIds)
      : { data: [] };
    const companyMap = new Map(((companyRows ?? []) as JsonRecord[]).map((c) => [String(c.id), c]));

    return okResponse(
      {
        items: rows.map((row) => {
          const company = companyMap.get(toTrimmedString(row.company_id));
          return {
            ...row,
            company_code: company?.company_code ?? null,
            company_name: company?.company_name ?? null,
            item_count: counts.get(String(row.id))?.item_count ?? 0,
            counted_count: counts.get(String(row.id))?.counted_count ?? 0,
          };
        }),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_LIST_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function getPIDHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    if (!documentId) {
      return piErrorResponse(req, ctx, "PI_ID_REQUIRED", 400, "Physical inventory document id is required.");
    }

    const document = await fetchPID(documentId);
    await assertPIDocumentCompanyScope(ctx, toTrimmedString(document.company_id));
    const hydrated = await hydratePID(documentId);

    // §8A — resolve material/location names in bulk, never raw UUIDs in the response.
    const items = (hydrated.items as JsonRecord[]) ?? [];
    const materialIds = [...new Set(items.map((i) => toTrimmedString(i.material_id)).filter(Boolean))];
    const locationIds = [...new Set([
      toTrimmedString(document.storage_location_id),
      ...items.map((i) => toTrimmedString(i.storage_location_id)),
    ].filter(Boolean))];

    const [materialRows, locationRows] = await Promise.all([
      materialIds.length
        ? serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name, material_type").in("id", materialIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
      locationIds.length
        ? serviceRoleClient.schema("erp_master").from("storage_location_master").select("id, location_code, location_name").in("id", locationIds)
        : Promise.resolve({ data: [] as JsonRecord[] }),
    ]);

    const materialMap = new Map(((materialRows.data ?? []) as JsonRecord[]).map((m) => [String(m.id), m]));
    const locationMap = new Map(((locationRows.data ?? []) as JsonRecord[]).map((l) => [String(l.id), l]));

    return okResponse(
      {
        ...hydrated,
        storage_location_code: locationMap.get(toTrimmedString(document.storage_location_id))?.location_code ?? null,
        storage_location_name: locationMap.get(toTrimmedString(document.storage_location_id))?.location_name ?? null,
        items: items.map((item) => {
          const material = materialMap.get(toTrimmedString(item.material_id));
          const location = locationMap.get(toTrimmedString(item.storage_location_id));
          return {
            ...item,
            material_pace_code: material?.pace_code ?? null,
            material_name: material?.material_name ?? null,
            material_type: material?.material_type ?? null,
            storage_location_code: location?.location_code ?? null,
            storage_location_name: location?.location_name ?? null,
          };
        }),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_FETCH_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MI02 — item add / remove / document cancel
// ═══════════════════════════════════════════════════════════════════════════════════════

export async function addPIItemHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const materialId = toTrimmedString(body.material_id);
    const stockType = toUpperTrimmedString(body.stock_type);
    const storageLocationId = toTrimmedString(body.storage_location_id);

    if (!documentId || !materialId || !storageLocationId || !STOCK_TYPES.has(stockType)) {
      return piErrorResponse(req, ctx, "PI_ITEM_ADD_INVALID", 400, "document id, material_id, storage_location_id, and valid stock_type are required.");
    }

    const document = await fetchPID(documentId);
    await assertPIDCompanyEditAccess(ctx, toTrimmedString(document.company_id));
    if (toUpperTrimmedString(document.status) !== "OPEN") {
      return piErrorResponse(req, ctx, "PI_ITEM_ADD_BLOCKED", 409, "Items can only be added while PI document is OPEN.");
    }

    const locScope = await getStorageLocationScope(storageLocationId);
    if (locScope.company_id !== toTrimmedString(document.company_id)) {
      return piErrorResponse(req, ctx, "PI_ITEM_ADD_INVALID", 400, "storage_location_id does not belong to this document's company.");
    }

    const materialInfo = await getMaterialInfo([materialId]);
    const material = materialInfo.get(materialId);
    if (!material || !PI_MATERIAL_TYPES.has(toUpperTrimmedString(material.material_type))) {
      return piErrorResponse(req, ctx, "PI_ITEM_MATERIAL_INVALID", 400, "Only RM, PM, Intermediate, SFG, and FG materials are allowed.");
    }

    const snaps = await getBookSnapshotsForMaterial(toTrimmedString(document.company_id), storageLocationId, materialId, material);
    const matches = snaps.filter((s) => s.stock_type === stockType);
    const targets = matches.length > 0
      ? matches
      : PI_BLENDED_MATERIAL_TYPES.has(toUpperTrimmedString(material.material_type))
        ? [{ material_id: materialId, stock_type: stockType, book_qty: 0, base_uom_code: toTrimmedString(material.base_uom_code), batch_number: null, packing_order_id: null }]
        : [];

    if (targets.length === 0) {
      return piErrorResponse(req, ctx, "PI_ITEM_NOT_FOUND_AT_LOCATION", 404, "No stock found for this material/stock type at the selected location.");
    }

    for (const target of targets) {
      const block = await checkPostingBlock(materialId, storageLocationId, target.batch_number);
      if (block) return blockedResponse(req, ctx, block);
    }

    const existingItems = await fetchPIItems(documentId);
    const insertedItems: JsonRecord[] = [];
    let lineOffset = existingItems.length;

    // DEPENDENT: line_number must stay sequential and blocks must not double-insert for the
    // same (material, location, batch) if this material spans multiple batches/POs.
    for (const target of targets) {
      lineOffset += 1;
      const { data: item, error: itemError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_item")
        .insert({
          document_id: documentId,
          line_number: lineOffset,
          material_id: materialId,
          stock_type: stockType,
          storage_location_id: storageLocationId,
          batch_number: target.batch_number,
          packing_order_id: target.packing_order_id,
          book_qty: Number((target.book_qty ?? 0).toFixed(4)),
          base_uom_code: target.base_uom_code || toTrimmedString(material.base_uom_code),
        })
        .select("*")
        .single();

      if (itemError || !item) {
        const status = String(itemError?.code || "").startsWith("23") ? 409 : 500;
        return piErrorResponse(req, ctx, status === 409 ? "PI_ITEM_ALREADY_EXISTS" : "PI_ITEM_ADD_FAILED", status, status === 409 ? "PI item already exists for this material/location/batch." : "Unable to add PI item.");
      }

      const { error: blockError } = await serviceRoleClient
        .schema("erp_inventory")
        .from("physical_inventory_block")
        .insert({
          material_id: materialId,
          storage_location_id: storageLocationId,
          batch_number: target.batch_number,
          pi_document_id: documentId,
        });

      if (blockError) {
        const status = String(blockError.code || "").startsWith("23") ? 409 : 500;
        return piErrorResponse(
          req,
          ctx,
          status === 409 ? "MATERIAL_POSTING_BLOCKED" : "PI_BLOCK_CREATE_FAILED",
          status,
          status === 409 ? "Material has an active physical inventory count in progress." : "Unable to create physical inventory posting block.",
        );
      }

      insertedItems.push(item);
    }

    return okResponse({ items: insertedItems }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_ITEM_ADD_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "MATERIAL_POSTING_BLOCKED" ? 409 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// MI02 — remove an uncounted item (§119.11: counted items cannot be casually removed).
export async function removePIItemHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const itemId = getItemIdFromPath(req);
    if (!documentId || !itemId) {
      return piErrorResponse(req, ctx, "PI_ITEM_REMOVE_INVALID", 400, "document id and item id are required.");
    }

    const document = await fetchPID(documentId);
    await assertPIDCompanyEditAccess(ctx, toTrimmedString(document.company_id));
    if (toUpperTrimmedString(document.status) !== "OPEN") {
      return piErrorResponse(req, ctx, "PI_ITEM_REMOVE_BLOCKED", 409, "Items can only be removed while PI document is OPEN.");
    }

    const { data: item, error: itemError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .select("*")
      .eq("id", itemId)
      .eq("document_id", documentId)
      .maybeSingle();
    if (itemError) throw new Error("PI_ITEM_REMOVE_FAILED");
    if (!item) return piErrorResponse(req, ctx, "PI_ITEM_NOT_FOUND", 404, "Item not found on this document.");
    if (item.physical_qty !== null && item.physical_qty !== undefined) {
      return piErrorResponse(req, ctx, "PI_ITEM_ALREADY_COUNTED", 409, "A counted item cannot be removed — request a recount and enter zero if it is genuinely absent.");
    }

    const { error: deleteError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .delete()
      .eq("id", itemId);
    if (deleteError) throw new Error("PI_ITEM_REMOVE_FAILED");

    let blockQuery = serviceRoleClient
      .schema("erp_inventory")
      .from("physical_inventory_block")
      .delete()
      .eq("pi_document_id", documentId)
      .eq("material_id", String(item.material_id))
      .eq("storage_location_id", String(item.storage_location_id));
    blockQuery = item.batch_number
      ? blockQuery.eq("batch_number", String(item.batch_number))
      : blockQuery.is("batch_number", null);
    const { error: blockDeleteError } = await blockQuery;
    if (blockDeleteError) throw new Error("PI_BLOCK_RELEASE_FAILED");

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_ITEM_REMOVE_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// MI02 — cancel the whole document (only while OPEN, nothing posted yet).
export async function cancelPIDHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!documentId || !reason) {
      return piErrorResponse(req, ctx, "PI_CANCEL_INVALID", 400, "document id and reason are required.");
    }

    const document = await fetchPID(documentId);
    await assertPIDCompanyEditAccess(ctx, toTrimmedString(document.company_id));
    if (toUpperTrimmedString(document.status) !== "OPEN") {
      return piErrorResponse(req, ctx, "PI_CANCEL_BLOCKED", 409, "Only an OPEN document (nothing posted) can be cancelled.");
    }

    const { error: blockDeleteError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("physical_inventory_block")
      .delete()
      .eq("pi_document_id", documentId);
    if (blockDeleteError) throw new Error("PI_BLOCK_RELEASE_FAILED");

    const { error: cancelError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .update({
        status: "CANCELLED",
        cancel_reason: reason,
        cancelled_by: ctx.auth_user_id,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    if (cancelError) throw new Error("PI_CANCEL_FAILED");

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_CANCEL_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MI04/MI05 — count entry, recount
// ═══════════════════════════════════════════════════════════════════════════════════════

export async function enterCountHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const itemId = getItemIdFromPath(req);
    const body = await parseBody(req);
    // §119.6 — Zero Stock checkbox: pure frontend mutual-exclusion, no new column. If the
    // checkbox is ticked the frontend sends is_zero_stock:true and no physical_qty (or 0) —
    // either way this always resolves to physical_qty=0.
    const isZeroStock = body.is_zero_stock === true;
    const physicalQty = isZeroStock ? 0 : parseNonNegativeNumber(body.physical_qty);
    // Multi-UoM (§119.8): caller may send entered_qty+entered_uom_code (already converted to
    // base UoM client-side via UomQuantityInput, same as IN05) alongside physical_qty for audit.
    const enteredUomCode = toTrimmedString(body.entered_uom_code) || null;
    const enteredQty = parseNullableNumber(body.entered_qty);

    if (!documentId || !itemId || physicalQty === null) {
      return piErrorResponse(req, ctx, "PI_COUNT_INVALID", 400, "Valid physical_qty >= 0 (or is_zero_stock) is required.");
    }

    const document = await fetchPID(documentId);
    await assertPIDCompanyActionAccess(ctx, toTrimmedString(document.company_id), "WRITE");
    const status = toUpperTrimmedString(document.status);
    if (!["OPEN", "COUNTED"].includes(status)) {
      return piErrorResponse(req, ctx, "PI_COUNT_BLOCKED", 409, "Counts can only be entered while PI document is OPEN or COUNTED.");
    }

    const { data: item, error: itemError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .update({
        physical_qty: physicalQty,
        counted_by: ctx.auth_user_id,
        counted_at: new Date().toISOString(),
        is_recount_requested: false,
        ...(enteredUomCode ? { entered_uom_code: enteredUomCode, entered_qty: enteredQty } : {}),
      })
      .eq("id", itemId)
      .eq("document_id", documentId)
      .is("posted_stock_document_id", null)
      .select("*")
      .single();

    if (itemError || !item) {
      return piErrorResponse(req, ctx, "PI_COUNT_SAVE_FAILED", 500, "Unable to save physical count.");
    }

    const nullCount = await countNullPhysicalQty(documentId);
    if (nullCount === 0) {
      const { error: documentError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_document")
        .update({ status: "COUNTED" })
        .eq("id", documentId)
        .in("status", ["OPEN", "COUNTED"]);

      if (documentError) {
        return piErrorResponse(req, ctx, "PI_COUNT_STATUS_UPDATE_FAILED", 500, "Unable to update PI document status.");
      }
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_COUNT_SAVE_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function requestRecountHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const itemId = getItemIdFromPath(req);
    const document = await fetchPID(documentId);
    await assertPIDCompanyActionAccess(ctx, toTrimmedString(document.company_id), "WRITE");

    const status = toUpperTrimmedString(document.status);
    if (["POSTED", "PENDING_APPROVAL", "CANCELLED"].includes(status)) {
      return piErrorResponse(req, ctx, "PI_RECOUNT_BLOCKED", 409, "Recount is only available while the document is OPEN or COUNTED — reopen it first if it is Pending Approval.");
    }

    const { data: item, error: itemError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .update({
        physical_qty: null,
        counted_by: null,
        counted_at: null,
        is_recount_requested: true,
      })
      .eq("id", itemId)
      .eq("document_id", documentId)
      .is("posted_stock_document_id", null)
      .select("*")
      .single();

    if (itemError || !item) {
      return piErrorResponse(req, ctx, "PI_RECOUNT_FAILED", 500, "Unable to request recount.");
    }

    if (status === "COUNTED") {
      const { error: documentError } = await serviceRoleClient
        .schema("erp_procurement")
        .from("physical_inventory_document")
        .update({ status: "OPEN" })
        .eq("id", documentId);

      if (documentError) {
        return piErrorResponse(req, ctx, "PI_RECOUNT_STATUS_UPDATE_FAILED", 500, "Unable to reopen PI document.");
      }
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_RECOUNT_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Submit for Approval / Reopen (§119.6 state machine)
// ═══════════════════════════════════════════════════════════════════════════════════════

export async function submitPIDForApprovalHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchPID(documentId);
    await assertPIDCompanyActionAccess(ctx, toTrimmedString(document.company_id), "WRITE");

    if (toUpperTrimmedString(document.status) !== "COUNTED") {
      return piErrorResponse(req, ctx, "PI_SUBMIT_BLOCKED", 409, "Only a fully COUNTED document (every item counted or zero-confirmed) can be submitted for approval.");
    }

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .update({
        status: "PENDING_APPROVAL",
        submitted_by: ctx.auth_user_id,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("status", "COUNTED");

    if (error) {
      return piErrorResponse(req, ctx, "PI_SUBMIT_FAILED", 500, "Unable to submit for approval.");
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_SUBMIT_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

export async function reopenPIDHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const body = await parseBody(req);
    const reason = toTrimmedString(body.reason);
    if (!reason) {
      return piErrorResponse(req, ctx, "PI_REOPEN_REASON_REQUIRED", 400, "A reason is required to reopen a submitted PID.");
    }

    const document = await fetchPID(documentId);
    await assertPIDCompanyActionAccess(ctx, toTrimmedString(document.company_id), "APPROVE");

    if (toUpperTrimmedString(document.status) !== "PENDING_APPROVAL") {
      return piErrorResponse(req, ctx, "PI_REOPEN_BLOCKED", 409, "Only a document Pending Approval can be reopened.");
    }

    // §119.5/§119.6 — Reopen authority = exactly whoever can Post this specific document.
    const authority = await resolvePidActionAuthority(ctx, documentId);
    if (!authority.allowed) {
      return piErrorResponse(
        req,
        ctx,
        "PI_REOPEN_AUTHORITY_REQUIRED",
        403,
        authority.requiredTier === "DIRECTOR_ONLY"
          ? "This document was counted by an Auditor — only Director can reopen it."
          : "Only an Auditor or Director can reopen this document.",
      );
    }

    const { error: logError } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_reopen_log")
      .insert({ document_id: documentId, reopened_by: ctx.auth_user_id, reason });
    if (logError) throw new Error("PI_REOPEN_LOG_FAILED");

    const { error } = await serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .update({ status: "COUNTED" })
      .eq("id", documentId)
      .eq("status", "PENDING_APPROVAL");

    if (error) {
      return piErrorResponse(req, ctx, "PI_REOPEN_FAILED", 500, "Unable to reopen PI document.");
    }

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_REOPEN_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MI07 — Post Differences (document-wide atomic, §119.9)
// ═══════════════════════════════════════════════════════════════════════════════════════

type MovementSpec = Record<string, unknown>;

async function postDocument(args: {
  referenceDocumentType: string;
  referenceDocumentId: string;
  movements: MovementSpec[];
  postedBy: string;
  context: Record<string, unknown>;
}): Promise<{ postings: Array<{ line_ref: string; stock_document_id: string; stock_ledger_id: string; valuation_rate: number | null }> }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_document", {
      p_reference_document_type: args.referenceDocumentType,
      p_reference_document_id: args.referenceDocumentId,
      p_movements: args.movements,
      p_posted_by: args.postedBy,
      p_context: args.context,
    });
  if (error) {
    console.error("[physical_inventory.postDocument] rpc failed:", JSON.stringify(error));
    throw new Error("PI_POST_RPC_FAILED");
  }
  const postings = (data as { postings?: unknown } | null)?.postings;
  return { postings: (Array.isArray(postings) ? postings : []) as Array<{ line_ref: string; stock_document_id: string; stock_ledger_id: string; valuation_rate: number | null }> };
}

// §119.10 — live WAR rate at post time (never cached), so PID automatically tracks whatever the
// WAR/costing engine looks like later (§111 Landed Cost, etc.) without PID's own code changing.
async function fetchCurrentValuationRates(
  companyId: string,
  keys: Array<{ materialId: string; slocId: string; stockType: string }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (keys.length === 0) return map;
  const materialIds = [...new Set(keys.map((k) => k.materialId))];
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("material_id, storage_location_id, stock_type_code, valuation_rate")
    .eq("company_id", companyId)
    .in("material_id", materialIds);
  if (error) throw new Error("PI_VALUATION_RATE_LOOKUP_FAILED");
  for (const row of (data ?? []) as JsonRecord[]) {
    const key = `${toTrimmedString(row.material_id)}|${toTrimmedString(row.storage_location_id)}|${toUpperTrimmedString(row.stock_type_code)}`;
    map.set(key, Number(row.valuation_rate ?? 0));
  }
  return map;
}

export async function postDifferencesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const documentId = getDocumentIdFromPath(req);
    const document = await fetchPID(documentId);
    await assertPIDCompanyActionAccess(ctx, toTrimmedString(document.company_id), "APPROVE");

    // §119.9 correction — Post only fires from PENDING_APPROVAL now (document-wide atomic,
    // every item is guaranteed counted since COUNTED->PENDING_APPROVAL already required 100%).
    if (toUpperTrimmedString(document.status) !== "PENDING_APPROVAL") {
      return piErrorResponse(req, ctx, "PI_POST_BLOCKED", 409, "PI document must be Pending Approval (submitted) before posting.");
    }

    // §119.5 — escalating maker-checker authority check.
    const authority = await resolvePidActionAuthority(ctx, documentId);
    if (!authority.allowed) {
      return piErrorResponse(
        req,
        ctx,
        "PI_POST_AUTHORITY_REQUIRED",
        403,
        authority.requiredTier === "DIRECTOR_ONLY"
          ? "This document was counted by an Auditor — only Director can post it."
          : "Only an Auditor or Director can post this document.",
      );
    }

    const items = await fetchPIItems(documentId);
    const companyId = toTrimmedString(document.company_id);
    const piMatDoc = await generateMaterialDocNumber(companyId);

    const materialIds = [...new Set(items.map((i) => toTrimmedString(i.material_id)))];
    const materialInfo = await getMaterialInfo(materialIds);
    const rateKeys = items
      .filter((item) => (parseNullableNumber(item.difference_qty) ?? 0) !== 0)
      .map((item) => ({ materialId: toTrimmedString(item.material_id), slocId: toTrimmedString(item.storage_location_id), stockType: toUpperTrimmedString(item.stock_type) }));
    const rateMap = await fetchCurrentValuationRates(companyId, rateKeys);

    const movements: MovementSpec[] = [];
    const zeroDiffItemIds: string[] = [];

    for (const item of items) {
      if (item.posted_stock_document_id) continue; // already posted (idempotency — shouldn't
                                                     // happen given document-wide atomicity, kept
                                                     // as a defensive no-op).
      const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
      if (differenceQty === 0) {
        zeroDiffItemIds.push(String(item.id));
        continue;
      }
      const movementType = derivePIMovementType(String(item.stock_type), differenceQty);
      const rateKey = `${toTrimmedString(item.material_id)}|${toTrimmedString(item.storage_location_id)}|${toUpperTrimmedString(item.stock_type)}`;
      const rate = rateMap.get(rateKey) ?? 0;
      movements.push({
        line_ref: String(item.id),
        document_number: document.document_number,
        document_date: document.count_date,
        posting_date: document.posting_date,
        movement_type_code: movementType,
        company_id: companyId,
        storage_location_id: item.storage_location_id,
        material_id: item.material_id,
        quantity: Math.abs(differenceQty),
        base_uom_code: item.base_uom_code,
        unit_value: rate,
        stock_type_code: item.stock_type,
        direction: differenceQty > 0 ? "IN" : "OUT",
        reversal_of_id: null,
        batch_number: item.batch_number ?? null,
        material_doc_number: piMatDoc.docNumber,
        material_doc_year: piMatDoc.docYear,
        reference_document_number: document.document_number,
      });
    }

    // §119.14 — batch-tracked SFG/FG genealogy adjustment (reco-only, main RM/PM/INT stock
    // untouched). Built here (TS does the arithmetic, same discipline as complete_process_po_
    // verify/§107.8) and handed to complete_pid_post as prepared context.
    const genealogy = await buildGenealogyAdjustments(companyId, String(document.document_number), items, materialInfo);

    if (movements.length === 0 && genealogy.processOrderRecoRows.length === 0 && genealogy.packingOrderRecoRows.length === 0) {
      // Every item was zero-diff and nothing to adjust — still must reach POSTED + release
      // blocks. post_document requires >=1 movement, so post_document/complete_pid_post is
      // still the vehicle, but there's nothing to post: fall back to a direct, single-purpose
      // update (no ledger activity means no atomicity risk either).
      const { error: blockDeleteError } = await serviceRoleClient
        .schema("erp_inventory").from("physical_inventory_block").delete().eq("pi_document_id", documentId);
      if (blockDeleteError) throw new Error("PI_BLOCK_RELEASE_FAILED");
      const { error: docError } = await serviceRoleClient
        .schema("erp_procurement").from("physical_inventory_document")
        .update({ status: "POSTED", posted_by: ctx.auth_user_id, posted_at: new Date().toISOString() })
        .eq("id", documentId);
      if (docError) throw new Error("PI_POST_STATUS_UPDATE_FAILED");
      return okResponse(await hydratePID(documentId), ctx.request_id, req);
    }

    await postDocument({
      referenceDocumentType: "PI",
      referenceDocumentId: documentId,
      movements,
      postedBy: ctx.auth_user_id,
      context: {
        posted_by: ctx.auth_user_id,
        zero_diff_item_ids: zeroDiffItemIds,
        process_order_reco_rows: genealogy.processOrderRecoRows,
        packing_order_reco_rows: genealogy.packingOrderRecoRows,
        process_order_header_updates: genealogy.processOrderHeaderUpdates,
        packing_order_header_updates: genealogy.packingOrderHeaderUpdates,
      },
    });

    return okResponse(await hydratePID(documentId), ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_POST_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : code === "PI_DOCUMENT_NOT_FOUND" ? 404 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// §119.14 — for every item that is (a) SFG or FG, (b) batch-tracked (batch_number set), and
// (c) has a non-zero difference: compute the batch's reco delta rows + header total delta.
// Ratio is signed (positive=gain, negative=loss) so both directions share one code path.
async function buildGenealogyAdjustments(
  companyId: string,
  piDocumentNumber: string,
  items: PiItemRow[],
  materialInfo: Map<string, JsonRecord>,
): Promise<{
  processOrderRecoRows: JsonRecord[];
  packingOrderRecoRows: JsonRecord[];
  processOrderHeaderUpdates: JsonRecord[];
  packingOrderHeaderUpdates: JsonRecord[];
}> {
  const processOrderRecoRows: JsonRecord[] = [];
  const packingOrderRecoRows: JsonRecord[] = [];
  const processOrderHeaderUpdates: JsonRecord[] = [];
  const packingOrderHeaderUpdates: JsonRecord[] = [];

  const batchTrackedItems = items.filter((item) => {
    const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
    const materialType = toUpperTrimmedString(materialInfo.get(toTrimmedString(item.material_id))?.material_type);
    return differenceQty !== 0 && toTrimmedString(item.batch_number) && (materialType === "SFG" || materialType === "FG");
  });
  if (batchTrackedItems.length === 0) {
    return { processOrderRecoRows, packingOrderRecoRows, processOrderHeaderUpdates, packingOrderHeaderUpdates };
  }

  for (const item of batchTrackedItems) {
    const materialType = toUpperTrimmedString(materialInfo.get(toTrimmedString(item.material_id))?.material_type);
    const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
    const batchNumber = toTrimmedString(item.batch_number);

    if (materialType === "SFG") {
      const [processOrder] = [...(await getProcessOrderPoTypeByBatch([batchNumber])).values()];
      if (!processOrder || processOrder.company_id !== companyId) continue;
      const currentTotal = Number(processOrder.actual_qty ?? 0);
      if (!currentTotal) continue;
      const ratio = differenceQty / currentTotal;

      const { data: recoRows, error: recoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("process_order_line_reco")
        .select("process_order_line_id, material_id, line_material_type, actual_qty, ap_approved_qty, variance_qty, company_id, po_number, batch_number, po_type, prodshade_material_id, machine_id, segment_code, storage_location_id")
        .eq("process_order_id", String(processOrder.id))
        .eq("is_voided", false)
        .in("source_txn_type", ["PRODUCTION", "OPENING", "PID_ADJUSTMENT"])
        .in("line_material_type", ["RM", "INT"]);
      if (recoErr) throw new Error("PI_GENEALOGY_RECO_LOOKUP_FAILED");

      for (const row of (recoRows ?? []) as JsonRecord[]) {
        const delta = Number(row.actual_qty ?? 0) * ratio;
        if (!delta) continue;
        processOrderRecoRows.push({
          company_id: row.company_id,
          po_number: row.po_number,
          batch_number: row.batch_number,
          po_type: row.po_type,
          prodshade_material_id: row.prodshade_material_id,
          machine_id: row.machine_id,
          segment_code: row.segment_code,
          process_order_id: String(processOrder.id),
          process_order_line_id: row.process_order_line_id,
          material_id: row.material_id,
          line_material_type: row.line_material_type,
          storage_location_id: row.storage_location_id,
          standard_qty: 0,
          actual_qty: delta,
          approved_status: "YES",
          ap_approved_qty: Number(row.ap_approved_qty ?? 0) * ratio,
          variance_qty: Number(row.variance_qty ?? 0) * ratio,
          reference_document_number: piDocumentNumber,
        });
      }
      processOrderHeaderUpdates.push({ process_order_id: String(processOrder.id), delta_qty: differenceQty });
    }

    if (materialType === "FG" && item.packing_order_id) {
      const packingOrderMap = await getPackingOrdersByIds([String(item.packing_order_id)]);
      const packingOrder = packingOrderMap.get(String(item.packing_order_id));
      if (!packingOrder || packingOrder.company_id !== companyId) continue;
      const currentTotal = Number(packingOrder.actual_qty_kg ?? 0);
      if (!currentTotal) continue;
      const ratio = differenceQty / currentTotal;

      const { data: recoRows, error: recoErr } = await serviceRoleClient
        .schema("erp_production")
        .from("packing_order_line_reco")
        .select("packing_order_line_id, material_id, actual_qty, ap_approved_qty, variance_qty, company_id, po_number, batch_number, po_type, sku_material_id, formulation_material_id")
        .eq("packing_order_id", String(packingOrder.id))
        .eq("is_voided", false)
        .in("source_txn_type", ["PRODUCTION", "OPENING", "PID_ADJUSTMENT"]);
      if (recoErr) throw new Error("PI_GENEALOGY_RECO_LOOKUP_FAILED");

      for (const row of (recoRows ?? []) as JsonRecord[]) {
        const delta = Number(row.actual_qty ?? 0) * ratio;
        if (!delta) continue;
        packingOrderRecoRows.push({
          company_id: row.company_id,
          po_number: row.po_number,
          sku_material_id: row.sku_material_id,
          batch_number: row.batch_number,
          po_type: row.po_type,
          packing_order_id: String(packingOrder.id),
          packing_order_line_id: row.packing_order_line_id,
          material_id: row.material_id,
          formulation_material_id: row.formulation_material_id,
          standard_qty: 0,
          actual_qty: delta,
          approved_status: "YES",
          ap_approved_qty: Number(row.ap_approved_qty ?? 0) * ratio,
          variance_qty: Number(row.variance_qty ?? 0) * ratio,
          reference_document_number: piDocumentNumber,
        });
      }
      packingOrderHeaderUpdates.push({ packing_order_id: String(packingOrder.id), delta_qty: differenceQty });
    }
  }

  return { processOrderRecoRows, packingOrderRecoRows, processOrderHeaderUpdates, packingOrderHeaderUpdates };
}

// §119.12 step 2 — Create page (ITEM_WISE) preview: for a selected material, show every
// location currently holding stock (+ batch/PO grain already resolved), so the Auditor can
// tick which ones to add to the staged list. Read-only, no document created here.
export async function getMaterialLocationBreakdownHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const companyId = toTrimmedString(url.searchParams.get("company_id"));
    const materialId = toTrimmedString(url.searchParams.get("material_id"));
    if (!companyId || !materialId) {
      return piErrorResponse(req, ctx, "PI_MATERIAL_LOCATIONS_INVALID", 400, "company_id and material_id are required.");
    }
    // Route registry gates this GET at PROC_PI_LIST:EDIT (helper lookup for the Create/Add-Item
    // flow, Auditor-only tier) — must re-check EDIT at the *target* company_id, not just
    // membership, same reasoning as every other EDIT-tier PID handler (see assertPIDCompanyActionAccess
    // doc comment above): the pipeline gate only proves EDIT at the caller's active session company.
    await assertPIDCompanyActionAccess(ctx, companyId, "EDIT");

    const materialInfo = await getMaterialInfo([materialId]);
    const material = materialInfo.get(materialId);
    if (!material || !PI_MATERIAL_TYPES.has(toUpperTrimmedString(material.material_type))) {
      return piErrorResponse(req, ctx, "PI_ITEM_MATERIAL_INVALID", 400, "Only RM, PM, Intermediate, SFG, and FG materials are allowed.");
    }

    const { data: locRows, error: locError } = await serviceRoleClient
      .schema("erp_inventory")
      .from("stock_ledger")
      .select("storage_location_id")
      .eq("company_id", companyId)
      .eq("material_id", materialId);
    if (locError) throw new Error("PI_MATERIAL_LOCATIONS_FAILED");
    const locationIds = [...new Set(((locRows ?? []) as JsonRecord[]).map((r) => toTrimmedString(r.storage_location_id)).filter(Boolean))];

    const breakdown: JsonRecord[] = [];
    for (const locationId of locationIds) {
      const snaps = await getBookSnapshotsForMaterial(companyId, locationId, materialId, material);
      for (const snap of snaps) breakdown.push({ ...snap, storage_location_id: locationId });
    }

    const { data: locationRows } = locationIds.length
      ? await serviceRoleClient.schema("erp_master").from("storage_location_master").select("id, location_code, location_name").in("id", locationIds)
      : { data: [] as JsonRecord[] };
    const locationMap = new Map(((locationRows ?? []) as JsonRecord[]).map((l) => [String(l.id), l]));

    return okResponse({
      material: { id: materialId, pace_code: material.pace_code, material_name: material.material_name, material_type: material.material_type, base_uom_code: material.base_uom_code },
      items: breakdown.map((row) => ({
        ...row,
        storage_location_code: locationMap.get(toTrimmedString(row.storage_location_id))?.location_code ?? null,
        storage_location_name: locationMap.get(toTrimmedString(row.storage_location_id))?.location_name ?? null,
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_MATERIAL_LOCATIONS_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MI20 — Difference Report (IN07, §119.15). Standalone, cross-document, company-scoped,
// shows BOTH posted and pending differences (matches SAP MI20 — useful for review before Post).
// ═══════════════════════════════════════════════════════════════════════════════════════

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

export async function listPIDifferencesHandler(
  req: Request,
  ctx: ProcurementHandlerContext,
): Promise<Response> {
  try {
    assertProcurementReadRole(ctx);
    const url = new URL(req.url);
    const requestedCompanyIds = parseMultiValueParams(url, "company_ids", "company_id");
    const storageLocationIds = parseMultiValueParams(url, "storage_location_ids", "storage_location_id");
    const materialIds = parseMultiValueParams(url, "material_ids", "material_id");
    const documentNumber = toTrimmedString(url.searchParams.get("document_number"));
    const status = toUpperTrimmedString(url.searchParams.get("status"));
    const differenceType = toUpperTrimmedString(url.searchParams.get("difference_type")); // GAIN/LOSS/ZERO
    const dateFrom = toTrimmedString(url.searchParams.get("date_from"));
    const dateTo = toTrimmedString(url.searchParams.get("date_to"));
    const limit = parsePositiveInt(url.searchParams.get("limit"), 200);

    // §116/117 "wrong company source" lesson — scope from the caller's own memberships,
    // never an admin/global company list. Empty request = every allowed company.
    const scopedCompanyIds = await listPIScopedCompanyIds(ctx);
    let effectiveCompanyIds: string[] | null;
    if (requestedCompanyIds.length > 0) {
      if (scopedCompanyIds && requestedCompanyIds.some((id) => !scopedCompanyIds.includes(id))) {
        return piErrorResponse(req, ctx, "PI_SCOPE_VIOLATION", 403, "One or more requested companies are outside your access.");
      }
      effectiveCompanyIds = requestedCompanyIds;
    } else {
      effectiveCompanyIds = scopedCompanyIds;
    }
    if (effectiveCompanyIds && effectiveCompanyIds.length === 0) {
      return okResponse({ items: [] }, ctx.request_id, req);
    }

    let docQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_document")
      .select("id, document_number, company_id, storage_location_id, count_date, posting_date, mode, status")
      .order("posting_date", { ascending: false })
      .limit(limit);
    if (effectiveCompanyIds) docQuery = docQuery.in("company_id", effectiveCompanyIds);
    if (documentNumber) docQuery = docQuery.ilike("document_number", `%${documentNumber}%`);
    if (status && PID_STATUSES.has(status)) docQuery = docQuery.eq("status", status);
    if (dateFrom) docQuery = docQuery.gte("posting_date", dateFrom);
    if (dateTo) docQuery = docQuery.lte("posting_date", dateTo);

    const { data: docRows, error: docError } = await docQuery;
    if (docError) throw new Error("PI_DIFF_REPORT_FAILED");
    const documents = (docRows ?? []) as PidRow[];
    if (documents.length === 0) return okResponse({ items: [] }, ctx.request_id, req);

    const documentIds = documents.map((d) => String(d.id));
    let itemQuery = serviceRoleClient
      .schema("erp_procurement")
      .from("physical_inventory_item")
      .select("id, document_id, material_id, stock_type, storage_location_id, batch_number, book_qty, physical_qty, difference_qty, base_uom_code, posted_stock_document_id, counted_by, counted_at")
      .in("document_id", documentIds);
    if (storageLocationIds.length > 0) itemQuery = itemQuery.in("storage_location_id", storageLocationIds);
    if (materialIds.length > 0) itemQuery = itemQuery.in("material_id", materialIds);

    const { data: itemRows, error: itemError } = await itemQuery;
    if (itemError) throw new Error("PI_DIFF_REPORT_FAILED");
    let items = (itemRows ?? []) as PiItemRow[];

    if (differenceType === "GAIN") items = items.filter((i) => (parseNullableNumber(i.difference_qty) ?? 0) > 0);
    else if (differenceType === "LOSS") items = items.filter((i) => (parseNullableNumber(i.difference_qty) ?? 0) < 0);
    else if (differenceType === "ZERO") items = items.filter((i) => (parseNullableNumber(i.difference_qty) ?? 0) === 0);

    // §8A — bulk-resolve every FK, never raw UUIDs.
    const docMap = new Map(documents.map((d) => [String(d.id), d]));
    const companyIds = [...new Set(documents.map((d) => toTrimmedString(d.company_id)).filter(Boolean))];
    const locationIds = [...new Set(items.map((i) => toTrimmedString(i.storage_location_id)).filter(Boolean))];
    const matIds = [...new Set(items.map((i) => toTrimmedString(i.material_id)).filter(Boolean))];

    const [companyRows, locationRows, materialRows] = await Promise.all([
      companyIds.length ? serviceRoleClient.schema("erp_master").from("companies").select("id, company_code, company_name").in("id", companyIds) : Promise.resolve({ data: [] as JsonRecord[] }),
      locationIds.length ? serviceRoleClient.schema("erp_master").from("storage_location_master").select("id, location_code, location_name").in("id", locationIds) : Promise.resolve({ data: [] as JsonRecord[] }),
      matIds.length ? serviceRoleClient.schema("erp_master").from("material_master").select("id, pace_code, material_name, material_type").in("id", matIds) : Promise.resolve({ data: [] as JsonRecord[] }),
    ]);
    const companyMap = new Map(((companyRows.data ?? []) as JsonRecord[]).map((c) => [String(c.id), c]));
    const locationMap = new Map(((locationRows.data ?? []) as JsonRecord[]).map((l) => [String(l.id), l]));
    const materialMap = new Map(((materialRows.data ?? []) as JsonRecord[]).map((m) => [String(m.id), m]));

    const result = items.map((item) => {
      const doc = docMap.get(toTrimmedString(item.document_id));
      const company = companyMap.get(toTrimmedString(doc?.company_id));
      const location = locationMap.get(toTrimmedString(item.storage_location_id));
      const material = materialMap.get(toTrimmedString(item.material_id));
      const differenceQty = parseNullableNumber(item.difference_qty) ?? 0;
      return {
        pi_document_id: doc?.id ?? null,
        pi_document_number: doc?.document_number ?? null,
        pi_status: doc?.status ?? null,
        posting_date: doc?.posting_date ?? null,
        company_code: company?.company_code ?? null,
        company_name: company?.company_name ?? null,
        storage_location_code: location?.location_code ?? null,
        storage_location_name: location?.location_name ?? null,
        material_pace_code: material?.pace_code ?? null,
        material_name: material?.material_name ?? null,
        batch_number: item.batch_number ?? null,
        stock_type: item.stock_type,
        book_qty: item.book_qty,
        physical_qty: item.physical_qty,
        difference_qty: differenceQty,
        difference_pct: item.book_qty ? Number(((differenceQty / Number(item.book_qty)) * 100).toFixed(2)) : null,
        base_uom_code: item.base_uom_code,
        movement_type: item.posted_stock_document_id
          ? derivePIMovementType(String(item.stock_type), differenceQty)
          : null,
        posted: Boolean(item.posted_stock_document_id),
      };
    });

    return okResponse({ items: result }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PI_DIFF_REPORT_FAILED";
    const status = code === "PI_SCOPE_VIOLATION" ? 403 : 500;
    return piErrorResponse(req, ctx, code, status, code);
  }
}
