import { resolveErrorMessage } from "../../../utils/errorMessages.js";

/*
 * File-ID: 27.FE-API
 * File-Path: frontend/src/pages/dashboard/production/prodApi.js
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: All /api/production/* API calls for Gate-27 production domain.
 */

async function readJsonSafe(res) {
  try { return await res.clone().json(); } catch { return null; }
}

async function fetchProd(method, path, body, params) {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  });
  const url = `${import.meta.env.VITE_API_BASE}${path}${q.toString() ? `?${q}` : ""}`;
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJsonSafe(res);
  if (!res.ok || !json?.ok) {
    const code = json?.code ?? "PROD_REQUEST_FAILED";
    const error = new Error(resolveErrorMessage(code, json?.message, res.status));
    error.code = code;
    error.status = res.status;
    error.backendMessage = json?.message ?? null;
    throw error;
  }
  const payload = json.data;
  if (payload && typeof payload === "object" && "data" in payload) {
    if ("pagination" in payload) return payload;
    return payload.data;
  }
  return payload;
}

// ── Pack Codes ────────────────────────────────────────────────────────────────
export const listPackCodes = (p) => fetchProd("GET", "/api/production/pack-codes", undefined, p);
export const createPackCode = (body) => fetchProd("POST", "/api/production/pack-codes", body);
export const updatePackCode = (id, body) => fetchProd("PATCH", `/api/production/pack-codes/${id}`, body);
export const togglePackCode = (body) => fetchProd("POST", "/api/production/pack-codes/toggle", body);
export const listApprovedProdshades = (p) => fetchProd("GET", "/api/production/prodshades", undefined, p);

// ── Pack Configs ──────────────────────────────────────────────────────────────
export const listPackConfigs = (p) => fetchProd("GET", "/api/production/pack-configs", undefined, p);
export const upsertPackConfig = (body) => fetchProd("POST", "/api/production/pack-configs", body);
export const deletePackConfig = (id) => fetchProd("DELETE", `/api/production/pack-configs/${id}`);

// ── Batch Number Series ───────────────────────────────────────────────────────
export const listBatchSeries = (p) => fetchProd("GET", "/api/production/batch-series", undefined, p);
export const createBatchSeries = (body) => fetchProd("POST", "/api/production/batch-series", body);
export const updateBatchSeries = (id, body) => fetchProd("PATCH", `/api/production/batch-series/${id}`, body);
export const listBatchNumbers = (p) => fetchProd("GET", "/api/production/batch-numbers", undefined, p);
export const releaseBatchNumber = (id, body) => fetchProd("POST", `/api/production/batch-numbers/${id}/release`, body);

// ── Segment Location Config ───────────────────────────────────────────────────
export const listSegmentLocations = (p) => fetchProd("GET", "/api/production/segment-locations", undefined, p);
export const upsertSegmentLocation = (body) => fetchProd("POST", "/api/production/segment-locations", body);

// ── Conversion Cost Config (Accounts ACL — §104.8) ────────────────────────────
export const listConversionRates = (p) => fetchProd("GET", "/api/production/conversion-rates", undefined, p);
export const createConversionRate = (body) => fetchProd("POST", "/api/production/conversion-rates", body);
// §104.8 — stroke-derived opening-rate suggestion, consumed by IN05 Opening Stock
export const getDerivedOpeningRate = (p) => fetchProd("GET", "/api/production/derived-opening-rate", undefined, p);
export const listMtsSkuRates = (p) => fetchProd("GET", "/api/production/mts-sku-rates", undefined, p);
export const saveMtsSkuRateDraft = (body) => fetchProd("POST", "/api/production/mts-sku-rates/draft", body);
export const listPendingMtsSkuRateDrafts = (p) => fetchProd("GET", "/api/production/mts-sku-rates/pending-drafts", undefined, p);
export const approveMtsSkuRate = (body) => fetchProd("POST", "/api/production/mts-sku-rates/approve", body);
export const listApprovedMtsSkuMonths = (p) => fetchProd("GET", "/api/production/mts-sku-rates/available-months", undefined, p);
export const createSlocGroup = (body) => fetchProd("POST", "/api/production/sloc-groups", body);
export const listSlocGroups = (p) => fetchProd("GET", "/api/production/sloc-groups", undefined, p);
export const addSlocGroupMember = (groupId, body) => fetchProd("POST", `/api/production/sloc-groups/${groupId}/members`, body);
export const removeSlocGroupMember = (groupId, memberId) => fetchProd("DELETE", `/api/production/sloc-groups/${groupId}/members/${memberId}`);
export const createCostingGroup = (body) => fetchProd("POST", "/api/production/costing-groups", body);
export const listCostingGroups = (p) => fetchProd("GET", "/api/production/costing-groups", undefined, p);
export const addCostingGroupMembers = (groupId, body) => fetchProd("POST", `/api/production/costing-groups/${groupId}/members`, body);
export const removeCostingGroupMember = (groupId, memberId) => fetchProd("DELETE", `/api/production/costing-groups/${groupId}/members/${memberId}`);
export const listCostingRateMaterials = (p) => fetchProd("GET", "/api/production/costing-rate/materials", undefined, p);
export const saveCostingRateDraft = (body) => fetchProd("POST", "/api/production/costing-rate/draft", body);
export const listPendingCostingDrafts = (p) => fetchProd("GET", "/api/production/costing-rate/pending-drafts", undefined, p);
export const listDraftCostingRateDetail = (p) => fetchProd("GET", "/api/production/costing-rate/draft-detail", undefined, p);
export const approveCostingRate = (body) => fetchProd("POST", "/api/production/costing-rate/approve", body);

// ── Opening Genealogy (§104.9) — PR22 Old Process PO / PR23 Old Packing PO ────
export const createOldProcessPo = (body) => fetchProd("POST", "/api/production/old-process-po", body);
export const listOldProcessPoBatches = (p) => fetchProd("GET", "/api/production/old-process-po/batches", undefined, p);
export const createOldPackingPo = (body) => fetchProd("POST", "/api/production/old-packing-po", body);
export const listOldPackingPoBatches = (p) => fetchProd("GET", "/api/production/old-packing-po/batches", undefined, p);

// ── Stroke Masters ────────────────────────────────────────────────────────────
export const listStrokeMasters = (p) => fetchProd("GET", "/api/production/stroke-masters", undefined, p);
export const getStrokeMaster = (id) => fetchProd("GET", `/api/production/stroke-masters/${id}`);
export const createStrokeMaster = (body) => fetchProd("POST", "/api/production/stroke-masters", body);
export const updateStrokeMaster = (id, body) => fetchProd("PATCH", `/api/production/stroke-masters/${id}`, body);
export const approveStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/approve`);
export const revertStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/revert`);
export const rejectStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/reject`);
export const deactivateStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/deactivate`);
export const reactivateStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/reactivate`);

// ── Plan Feed (FO) ────────────────────────────────────────────────────────────
export const listPlanFeed = (p) => fetchProd("GET", "/api/production/plan-feed", undefined, p);
export const getPlanFeed = (id) => fetchProd("GET", `/api/production/plan-feed/${id}`);
export const createPlanFeed = (body) => fetchProd("POST", "/api/production/plan-feed", body);
export const updatePlanFeed = (id, body) => fetchProd("PATCH", `/api/production/plan-feed/${id}`, body);
export const cancelPlanFeed = (id) => fetchProd("POST", `/api/production/plan-feed/${id}/cancel`);
export const getPlanFeedSummary = (p) => fetchProd("GET", "/api/production/plan-feed/summary", undefined, p);
export const listFoAllocations = (foId) => fetchProd("GET", `/api/production/plan-feed/${foId}/allocations`);
export const upsertFoAllocation = (foId, body) => fetchProd("POST", `/api/production/plan-feed/${foId}/allocations`, body);
export const getUnmappedStock = (p) => fetchProd("GET", "/api/production/plan-feed/unmapped-stock", undefined, p);
export const checkOrderedStroke = (p) => fetchProd("GET", "/api/production/plan-feed/check-stroke", undefined, p);
export const listStrokeOptions = (p) => fetchProd("GET", "/api/production/plan-feed/stroke-options", undefined, p);
export const findPlanFeedByNumber = (p) => fetchProd("GET", "/api/production/plan-feed/find", undefined, p);

// ── Process Orders ────────────────────────────────────────────────────────────
export const listProcessOrders = (p) => fetchProd("GET", "/api/production/process-orders", undefined, p);
export const availabilityPreviewProcessOrder = (params = {}) => fetchProd(
  "GET",
  "/api/production/process-orders/availability-preview",
  undefined,
  {
    ...params,
    overrides: Array.isArray(params.overrides) ? JSON.stringify(params.overrides) : params.overrides,
  },
);
export const getProcessOrder = (id) => fetchProd("GET", `/api/production/process-orders/${id}`);
export const createProcessOrder = (body) => fetchProd("POST", "/api/production/process-orders", body);
export const updateProcessOrderLines = (id, body) => fetchProd("PATCH", `/api/production/process-orders/${id}/lines`, body);
export const editProcessOrder = (id, body) => fetchProd("PATCH", `/api/production/process-orders/${id}/edit`, body);
export const qaApproveProcessOrder = (id) => fetchProd("POST", `/api/production/process-orders/${id}/qa-approve`);
export const qaRejectProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/qa-reject`, body);
export const startBatch = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/start-batch`, body ?? {});
export const completeIntProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/complete-int`, body);
export const finalizeProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/finalize`, body);
export const verifyProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/verify`, body);
export const reverseProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/reverse`, body);

// —— SFG QA Result Recording ————————————————————————————————————————————————————————
export const listSfgQaDocuments = (p) => fetchProd("GET", "/api/production/sfg-qa-documents", undefined, p);
export const getSfgQaDocument = (id) => fetchProd("GET", `/api/production/sfg-qa-documents/${id}`);
export const addSfgQaTestLine = (id, body) => fetchProd("POST", `/api/production/sfg-qa-documents/${id}/test-lines`, body);
export const updateSfgQaTestLine = (id, lineId, body) => fetchProd("PUT", `/api/production/sfg-qa-documents/${id}/test-lines/${lineId}`, body);
export const submitSfgQaDecision = (id, body) => fetchProd("POST", `/api/production/sfg-qa-documents/${id}/decision`, body);

// ── Packing Orders ────────────────────────────────────────────────────────────
export const listPackingOrders = (p) => fetchProd("GET", "/api/production/packing-orders", undefined, p);
export const getPackingOrder = (id) => fetchProd("GET", `/api/production/packing-orders/${id}`);
export const availabilityPreviewPackingOrder = (p) => fetchProd("GET", "/api/production/packing-orders/availability-preview", undefined, p);
export const listPackingSfgBatches = (p) => fetchProd("GET", "/api/production/packing-orders/sfg-batches", undefined, p);
export const createPackingOrder = (body) => fetchProd("POST", "/api/production/packing-orders", body);
export const updatePackingOrderLines = (id, body) => fetchProd("PATCH", `/api/production/packing-orders/${id}/lines`, body);
export const editPackingOrder = (id, body) => fetchProd("PATCH", `/api/production/packing-orders/${id}/edit`, body);
export const cancelPackingOrder = (id, body) => fetchProd("POST", `/api/production/packing-orders/${id}/cancel`, body);
export const finalizePackingOrder = (id, body) => fetchProd("POST", `/api/production/packing-orders/${id}/finalize`, body);
export const reversePackingOrder = (id) => fetchProd("POST", `/api/production/packing-orders/${id}/reverse`);
export const correctPackingOrder = (id, body) => fetchProd("POST", `/api/production/packing-orders/${id}/correct`, body);
export const getFgStockBreakdown = (p) => fetchProd("GET", "/api/production/fg-stock-breakdown", undefined, p);

// ── Stroke Change Requests (PR03/PR04) ────────────────────────────────────────
export const listStrokeChangeRequests = (p) => fetchProd("GET", "/api/production/stroke-change-requests", undefined, p);
export const getStrokeChangeRequest = (id) => fetchProd("GET", `/api/production/stroke-change-requests/${id}`);
export const createStrokeChangeRequest = (body) => fetchProd("POST", "/api/production/stroke-change-requests", body);
export const approveStrokeChangeRequest = (id, body) => fetchProd("POST", `/api/production/stroke-change-requests/${id}/approve`, body ?? {});
export const rejectStrokeChangeRequest = (id, body) => fetchProd("POST", `/api/production/stroke-change-requests/${id}/reject`, body);

// ── Pack BOMs (PR05/PR06/PR07/PR08) ──────────────────────────────────────────
export const listPackBoms = (p) => fetchProd("GET", "/api/production/pack-boms", undefined, p);
export const listPackBomEligibleSkus = (p) => fetchProd("GET", "/api/production/pack-boms/eligible-skus", undefined, p);
export const getPackBom = (id) => fetchProd("GET", `/api/production/pack-boms/${id}`);
export const createPackBom = (body) => fetchProd("POST", "/api/production/pack-boms", body);
export const approvePackBom = (id, body) => fetchProd("POST", `/api/production/pack-boms/${id}/approve`, body ?? {});
export const rejectPackBom = (id, body) => fetchProd("POST", `/api/production/pack-boms/${id}/reject`, body);
export const createPackBomChangeRequest = (id, body) => fetchProd("POST", `/api/production/pack-boms/${id}/change-request`, body);
export const listPackBomChangeRequests = (p) => fetchProd("GET", "/api/production/pack-bom-change-requests", undefined, p);
export const getPackBomChangeRequest = (id) => fetchProd("GET", `/api/production/pack-bom-change-requests/${id}`);
export const approvePackBomChangeRequest = (id, body) => fetchProd("POST", `/api/production/pack-bom-change-requests/${id}/approve`, body ?? {});
export const rejectPackBomChangeRequest = (id, body) => fetchProd("POST", `/api/production/pack-bom-change-requests/${id}/reject`, body);

// ── Partial Batch Reversal (PR19) + Partial Reversal Report (PR20) ──────────
export const listPartialReversalProdshades = (p) => fetchProd("GET", "/api/production/partial-reversals/prodshades", undefined, p);
export const resolvePartialReversalBatch = (p) => fetchProd("GET", "/api/production/partial-reversals/resolve-batch", undefined, p);
export const listPartialReversalStockLines = (p) => fetchProd("GET", "/api/production/partial-reversals/stock-lines", undefined, p);
export const listSalvageBatchOptions = (p) => fetchProd("GET", "/api/production/partial-reversals/salvage-batches", undefined, p);
export const getPartialReversalDetail = (p) => fetchProd("GET", "/api/production/partial-reversals/detail", undefined, p);
export const createPartialBatchReversal = (body) => fetchProd("POST", "/api/production/partial-reversals", body);
export const listPartialBatchReversals = (p) => fetchProd("GET", "/api/production/partial-reversals", undefined, p);
export const getPartialBatchReversal = (id) => fetchProd("GET", `/api/production/partial-reversals/${id}`);
