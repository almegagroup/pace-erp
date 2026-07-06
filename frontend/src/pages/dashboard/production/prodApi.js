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
  if (!res.ok || !json?.ok) throw new Error(json?.code ?? "PROD_REQUEST_FAILED");
  const payload = json.data;
  if (payload && typeof payload === "object" && "data" in payload) {
    if ("pagination" in payload) return payload;
    return payload.data;
  }
  return payload;
}

// ── Pack Codes ────────────────────────────────────────────────────────────────
export const listPackCodes = (p) => fetchProd("GET", "/api/production/pack-codes", undefined, p);
export const togglePackCode = (body) => fetchProd("POST", "/api/production/pack-codes/toggle", body);

// ── Pack Configs ──────────────────────────────────────────────────────────────
export const listPackConfigs = (p) => fetchProd("GET", "/api/production/pack-configs", undefined, p);
export const upsertPackConfig = (body) => fetchProd("POST", "/api/production/pack-configs", body);
export const deletePackConfig = (id) => fetchProd("DELETE", `/api/production/pack-configs/${id}`);

// ── Batch Number Series ───────────────────────────────────────────────────────
export const listBatchSeries = (p) => fetchProd("GET", "/api/production/batch-series", undefined, p);
export const createBatchSeries = (body) => fetchProd("POST", "/api/production/batch-series", body);
export const updateBatchSeries = (id, body) => fetchProd("PATCH", `/api/production/batch-series/${id}`, body);

// ── Segment Location Config ───────────────────────────────────────────────────
export const listSegmentLocations = (p) => fetchProd("GET", "/api/production/segment-locations", undefined, p);
export const upsertSegmentLocation = (body) => fetchProd("POST", "/api/production/segment-locations", body);

// ── Stroke Masters ────────────────────────────────────────────────────────────
export const listStrokeMasters = (p) => fetchProd("GET", "/api/production/stroke-masters", undefined, p);
export const getStrokeMaster = (id) => fetchProd("GET", `/api/production/stroke-masters/${id}`);
export const createStrokeMaster = (body) => fetchProd("POST", "/api/production/stroke-masters", body);
export const updateStrokeMaster = (id, body) => fetchProd("PATCH", `/api/production/stroke-masters/${id}`, body);
export const approveStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/approve`);
export const revertStrokeMaster = (id) => fetchProd("POST", `/api/production/stroke-masters/${id}/revert`);

// ── Plan Feed (FO) ────────────────────────────────────────────────────────────
export const listPlanFeed = (p) => fetchProd("GET", "/api/production/plan-feed", undefined, p);
export const getPlanFeed = (id) => fetchProd("GET", `/api/production/plan-feed/${id}`);
export const createPlanFeed = (body) => fetchProd("POST", "/api/production/plan-feed", body);
export const updatePlanFeed = (id, body) => fetchProd("PATCH", `/api/production/plan-feed/${id}`, body);
export const cancelPlanFeed = (id) => fetchProd("POST", `/api/production/plan-feed/${id}/cancel`);
export const getPlanFeedSummary = (p) => fetchProd("GET", "/api/production/plan-feed/summary", undefined, p);

// ── Process Orders ────────────────────────────────────────────────────────────
export const listProcessOrders = (p) => fetchProd("GET", "/api/production/process-orders", undefined, p);
export const getProcessOrder = (id) => fetchProd("GET", `/api/production/process-orders/${id}`);
export const createProcessOrder = (body) => fetchProd("POST", "/api/production/process-orders", body);
export const updateProcessOrderLines = (id, body) => fetchProd("PATCH", `/api/production/process-orders/${id}/lines`, body);
export const qaApproveProcessOrder = (id) => fetchProd("POST", `/api/production/process-orders/${id}/qa-approve`);
export const qaRejectProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/qa-reject`, body);
export const startBatch = (id) => fetchProd("POST", `/api/production/process-orders/${id}/start-batch`);
export const finalizeProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/finalize`, body);
export const verifyProcessOrder = (id, body) => fetchProd("POST", `/api/production/process-orders/${id}/verify`, body);
export const reverseProcessOrder = (id) => fetchProd("POST", `/api/production/process-orders/${id}/reverse`);

// ── Packing Orders ────────────────────────────────────────────────────────────
export const listPackingOrders = (p) => fetchProd("GET", "/api/production/packing-orders", undefined, p);
export const getPackingOrder = (id) => fetchProd("GET", `/api/production/packing-orders/${id}`);
export const createPackingOrder = (body) => fetchProd("POST", "/api/production/packing-orders", body);
export const updatePackingOrderLines = (id, body) => fetchProd("PATCH", `/api/production/packing-orders/${id}/lines`, body);
export const linkFo = (id, body) => fetchProd("POST", `/api/production/packing-orders/${id}/link-fo`, body);
export const finalizePackingOrder = (id, body) => fetchProd("POST", `/api/production/packing-orders/${id}/finalize`, body);
export const reversePackingOrder = (id) => fetchProd("POST", `/api/production/packing-orders/${id}/reverse`);

// ── Stroke Change Requests (PR03/PR04) ────────────────────────────────────────
export const listStrokeChangeRequests = (p) => fetchProd("GET", "/api/production/stroke-change-requests", undefined, p);
export const getStrokeChangeRequest = (id) => fetchProd("GET", `/api/production/stroke-change-requests/${id}`);
export const createStrokeChangeRequest = (body) => fetchProd("POST", "/api/production/stroke-change-requests", body);
export const approveStrokeChangeRequest = (id, body) => fetchProd("POST", `/api/production/stroke-change-requests/${id}/approve`, body ?? {});
export const rejectStrokeChangeRequest = (id, body) => fetchProd("POST", `/api/production/stroke-change-requests/${id}/reject`, body);

// ── Pack BOMs (PR05/PR06/PR07/PR08) ──────────────────────────────────────────
export const listPackBoms = (p) => fetchProd("GET", "/api/production/pack-boms", undefined, p);
export const getPackBom = (id) => fetchProd("GET", `/api/production/pack-boms/${id}`);
export const createPackBom = (body) => fetchProd("POST", "/api/production/pack-boms", body);
export const approvePackBom = (id, body) => fetchProd("POST", `/api/production/pack-boms/${id}/approve`, body ?? {});
export const rejectPackBom = (id, body) => fetchProd("POST", `/api/production/pack-boms/${id}/reject`, body);
export const createPackBomChangeRequest = (id, body) => fetchProd("POST", `/api/production/pack-boms/${id}/change-request`, body);
export const listPackBomChangeRequests = (p) => fetchProd("GET", "/api/production/pack-bom-change-requests", undefined, p);
export const approvePackBomChangeRequest = (id, body) => fetchProd("POST", `/api/production/pack-bom-change-requests/${id}/approve`, body ?? {});
export const rejectPackBomChangeRequest = (id, body) => fetchProd("POST", `/api/production/pack-bom-change-requests/${id}/reject`, body);
