/*
 * File-ID: 27.8
 * File-Path: supabase/functions/api/_routes/production.routes.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Route dispatcher for /api/production/* endpoints.
 * Authority: Backend
 */

import type { ContextResolution } from "../_pipeline/context.ts";
import type { SessionResolution } from "../_pipeline/session.ts";
import {
  listStrokeMastersHandler,
  getStrokeMasterHandler,
  createStrokeMasterHandler,
  updateStrokeMasterHandler,
  approveStrokeMasterHandler,
  rejectStrokeMasterHandler,
  deactivateStrokeMasterHandler,
  reactivateStrokeMasterHandler,
  revertStrokeMasterHandler,
} from "../_core/production/stroke_master.handlers.ts";
import {
  listPackCodesHandler,
  createPackCodeHandler,
  updatePackCodeHandler,
  togglePackCodeHandler,
  listApprovedProdshadesHandler,
  listPackConfigsHandler,
  upsertPackConfigHandler,
  deletePackConfigHandler,
} from "../_core/production/pack_config.handlers.ts";
import {
  listBatchSeriesHandler,
  createBatchSeriesHandler,
  updateBatchSeriesHandler,
  listBatchNumbersHandler,
  releaseBatchNumberHandler,
} from "../_core/production/batch_series.handlers.ts";
import {
  listSegmentLocationsHandler,
  upsertSegmentLocationHandler,
} from "../_core/production/segment_location.handlers.ts";
import {
  listConversionRatesHandler,
  createConversionRateHandler,
  getDerivedOpeningRateHandler,
} from "../_core/production/conversion_cost.handlers.ts";
import {
  listMtsSkuRateHandler,
  saveMtsSkuRateDraftHandler,
  listDraftMtsSkuRatesHandler,
  approveMtsSkuRateHandler,
  listApprovedMonthsForSkuHandler,
} from "../_core/production/mts_sku_rate.handlers.ts";
import {
  assignAc06CostingGroupHandler,
  closeAc06MonthHandler,
  createAc06CostingGroupHandler,
  createAc06SlocGroupHandler,
  deleteAc06CostingGroupHandler,
  deleteAc06SlocGroupHandler,
  getAc06HistoryHandler,
  getAc06ReportHandler,
  getAc06WorkspaceHandler,
  listAc06ApprovedMonthsHandler,
  saveAc06RatesHandler,
  setAc06MaterialInclusionHandler,
  unassignAc06CostingGroupHandler,
  updateAc06CostingGroupHandler,
  updateAc06SlocGroupHandler,
  verifyAc06RatesHandler,
} from "../_core/production/ac06_workspace.handlers.ts";
import {
  createOldProcessPoHandler,
  listOldProcessPoBatchesHandler,
  createOldPackingPoHandler,
  listOldPackingPoBatchesHandler,
} from "../_core/production/opening_genealogy.handlers.ts";
import {
  listPlanFeedHandler,
  getPlanFeedHandler,
  createPlanFeedHandler,
  updatePlanFeedHandler,
  cancelPlanFeedHandler,
  reactivatePlanFeedHandler,
  planFeedSummaryHandler,
  listFoAllocationsHandler,
  upsertFoAllocationHandler,
  upsertMtestFoAllocationHandler,
  updateMtestPlanFeedHandler,
  getMtestPlanFeedCapabilityHandler,
  listUnmappedStockHandler,
  checkOrderedStrokeHandler,
  listStrokeOptionsHandler,
  findPlanFeedByNumberHandler,
  listMtestSkusHandler,
  addPlanFeedItemHandler,
  updatePlanFeedItemHandler,
  deletePlanFeedItemHandler,
  addMtestPlanFeedItemHandler,
  updateMtestPlanFeedItemHandler,
  deleteMtestPlanFeedItemHandler,
} from "../_core/production/plan_feed.handlers.ts";
import {
  listProcessOrdersHandler,
  getProcessOrderHandler,
  availabilityPreviewProcessOrderHandler,
  getProcessOrderCreateCapabilityHandler,
  createProcessOrderHandler,
  updateProcessOrderLinesHandler,
  editProcessOrderHandler,
  qaApproveProcessOrderHandler,
  qaRejectProcessOrderHandler,
  startBatchHandler,
  finalizeProcessOrderHandler,
  verifyProcessOrderHandler,
  correctProcessOrderHandler,
  reverseProcessOrderHandler,
  pruneProcessOrderHandler,
} from "../_core/production/process_order.handlers.ts";
import { getOrderInformationReportHandler } from "../_core/production/order_information_system.handlers.ts";
import { searchBatchVarianceHandler, getBatchVarianceDetailHandler } from "../_core/production/batch_variance_report.handlers.ts";
import {
  listPackingOrdersHandler,
  getPackingOrderHandler,
  availabilityPreviewPackingOrderHandler,
  listPackingSfgBatchOptionsHandler,
  listMtestSfgProdshadeOptionsHandler,
  createPackingOrderHandler,
  updatePackingOrderLinesHandler,
  finalizePackingOrderHandler,
  reversePackingOrderHandler,
  correctPackingOrderHandler,
  editPackingOrderHandler,
  cancelPackingOrderHandler,
  fgStockBreakdownHandler,
} from "../_core/production/packing_order.handlers.ts";
import {
  listStrokeChangeRequestsHandler,
  getStrokeChangeRequestHandler,
  createStrokeChangeRequestHandler,
  approveStrokeChangeRequestHandler,
  rejectStrokeChangeRequestHandler,
} from "../_core/production/stroke_change_request.handlers.ts";
import {
  listPackBomEligibleSkusHandler,
  listPackBomsHandler,
  getPackBomHandler,
  createPackBomHandler,
  approvePackBomHandler,
  rejectPackBomHandler,
  createPackBomChangeRequestHandler,
  listPackBomChangeRequestsHandler,
  getPackBomChangeRequestHandler,
  approvePackBomChangeRequestHandler,
  rejectPackBomChangeRequestHandler,
} from "../_core/production/pack_bom.handlers.ts";
import {
  listSfgQaDocumentsHandler,
  getSfgQaDocumentHandler,
  addSfgQaTestLineHandler,
  updateSfgQaTestLineHandler,
  submitSfgQaDecisionHandler,
} from "../_core/production/sfg_qa.handlers.ts";
import {
  listPartialReversalProdshadesHandler,
  resolvePartialReversalBatchHandler,
  listPartialReversalStockLinesHandler,
  listSalvageBatchOptionsHandler,
  getPartialReversalDetailHandler,
  createPartialBatchReversalHandler,
  listPartialBatchReversalsHandler,
  getPartialBatchReversalHandler,
} from "../_core/production/partial_reversal.handlers.ts";

export async function dispatchProductionRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>,
): Promise<Response | null> {
  const ctx = {
    context,
    request_id: requestId,
    auth_user_id: session.authUserId,
    roleCode: context.roleCode,
  };
  const pathname = new URL(req.url).pathname;

  // ── STATIC ROUTES ──────────────────────────────────────────────────────────
  switch (routeKey) {
    // Pack Codes (SA config)
    case "GET:/api/production/pack-codes":
      return await listPackCodesHandler(req, ctx);
    case "POST:/api/production/pack-codes":
      return await createPackCodeHandler(req, ctx);
    case "POST:/api/production/pack-codes/toggle":
      return await togglePackCodeHandler(req, ctx);

    // Approved Prodshades
    case "GET:/api/production/prodshades":
      return await listApprovedProdshadesHandler(req, ctx);

    // Pack Configs (per prodshade)
    case "GET:/api/production/pack-configs":
      return await listPackConfigsHandler(req, ctx);
    case "POST:/api/production/pack-configs":
      return await upsertPackConfigHandler(req, ctx);

    // Batch Series (SA config)
    case "GET:/api/production/batch-series":
      return await listBatchSeriesHandler(req, ctx);
    case "POST:/api/production/batch-series":
      return await createBatchSeriesHandler(req, ctx);
    case "GET:/api/production/batch-numbers":
      return await listBatchNumbersHandler(req, ctx);

    // Segment Location Config
    case "GET:/api/production/segment-locations":
      return await listSegmentLocationsHandler(req, ctx);
    case "POST:/api/production/segment-locations":
      return await upsertSegmentLocationHandler(req, ctx);

    // Conversion Cost Config (Accounts ACL — §104.8, per-KG conversion rate, valid_from dated)
    case "GET:/api/production/conversion-rates":
      return await listConversionRatesHandler(req, ctx);
    case "POST:/api/production/conversion-rates":
      return await createConversionRateHandler(req, ctx);
    // §104.8 — suggested opening rate for a produced material (stroke-derived), used by IN05
    case "GET:/api/production/derived-opening-rate":
      return await getDerivedOpeningRateHandler(req, ctx);
    case "GET:/api/production/mts-sku-rates":
      return await listMtsSkuRateHandler(req, ctx);
    case "POST:/api/production/mts-sku-rates/draft":
      return await saveMtsSkuRateDraftHandler(req, ctx);
    case "GET:/api/production/mts-sku-rates/pending-drafts":
      return await listDraftMtsSkuRatesHandler(req, ctx);
    case "POST:/api/production/mts-sku-rates/approve":
      return await approveMtsSkuRateHandler(req, ctx);
    case "GET:/api/production/mts-sku-rates/available-months":
      return await listApprovedMonthsForSkuHandler(req, ctx);
    case "GET:/api/production/ac06/workspace":
      return await getAc06WorkspaceHandler(req, ctx);
    case "POST:/api/production/ac06/sloc-groups":
      return await createAc06SlocGroupHandler(req, ctx);
    case "POST:/api/production/ac06/costing-groups":
      return await createAc06CostingGroupHandler(req, ctx);
    case "POST:/api/production/ac06/costing-groups/assign":
      return await assignAc06CostingGroupHandler(req, ctx);
    case "POST:/api/production/ac06/costing-groups/unassign":
      return await unassignAc06CostingGroupHandler(req, ctx);
    case "POST:/api/production/ac06/material-inclusion":
      return await setAc06MaterialInclusionHandler(req, ctx);
    case "POST:/api/production/ac06/rates":
      return await saveAc06RatesHandler(req, ctx);
    case "POST:/api/production/ac06/verify":
      return await verifyAc06RatesHandler(req, ctx);
    case "POST:/api/production/ac06/close":
      return await closeAc06MonthHandler(req, ctx);
    case "GET:/api/production/ac06/report":
      return await getAc06ReportHandler(req, ctx);
    case "GET:/api/production/ac06/history":
      return await getAc06HistoryHandler(req, ctx);
    case "GET:/api/production/ac06/approved-months":
      return await listAc06ApprovedMonthsHandler(req, ctx);

    // Opening Genealogy (§104.9) — PR22 Old Process PO + PR23 Old Packing PO (no stock movement)
    case "POST:/api/production/old-process-po":
      return await createOldProcessPoHandler(req, ctx);
    case "GET:/api/production/old-process-po/batches":
      return await listOldProcessPoBatchesHandler(req, ctx);
    case "POST:/api/production/old-packing-po":
      return await createOldPackingPoHandler(req, ctx);
    case "GET:/api/production/old-packing-po/batches":
      return await listOldPackingPoBatchesHandler(req, ctx);

    // Stroke Masters
    case "GET:/api/production/stroke-masters":
      return await listStrokeMastersHandler(req, ctx);
    case "POST:/api/production/stroke-masters":
      return await createStrokeMasterHandler(req, ctx);

    // Plan Feed (FO management)
    case "GET:/api/production/plan-feed":
      return await listPlanFeedHandler(req, ctx);
    case "POST:/api/production/plan-feed":
      return await createPlanFeedHandler(req, ctx);
    case "GET:/api/production/plan-feed/summary":
      return await planFeedSummaryHandler(req, ctx);
    case "GET:/api/production/plan-feed/unmapped-stock":
      return await listUnmappedStockHandler(req, ctx);
    case "GET:/api/production/plan-feed/check-stroke":
      return await checkOrderedStrokeHandler(req, ctx);
    case "GET:/api/production/plan-feed/stroke-options":
      return await listStrokeOptionsHandler(req, ctx);
    case "GET:/api/production/plan-feed/find":
      return await findPlanFeedByNumberHandler(req, ctx);
    case "GET:/api/production/plan-feed/mtest-skus":
      return await listMtestSkusHandler(req, ctx);
    case "GET:/api/production/mtest-skus":
      return await listMtestSkusHandler(req, ctx);
    case "GET:/api/production/plan-feed/mtest-capability":
      return await getMtestPlanFeedCapabilityHandler(req, ctx);

    // PR24 Order Information System
    case "GET:/api/production/order-information-system":
      return await getOrderInformationReportHandler(req, ctx);

    // PR14 Batch Variance Report
    case "GET:/api/production/batch-variance-report":
      return await searchBatchVarianceHandler(req, ctx);

    // Process Orders
    case "GET:/api/production/process-orders":
      return await listProcessOrdersHandler(req, ctx);
    case "GET:/api/production/process-orders/availability-preview":
      return await availabilityPreviewProcessOrderHandler(req, ctx);
    // §131.2 (2026-08-26): read-only self-capability check for PR09's Type dropdown —
    // see the handler's own comment for why this exists instead of a frontend role check.
    case "GET:/api/production/process-orders/create-capability":
      return await getProcessOrderCreateCapabilityHandler(req, ctx);
    case "POST:/api/production/process-orders":
      return await createProcessOrderHandler(req, ctx);
    // §131.2 (2026-08-26): MTEST-only route, same handler as above — createProcessOrderHandler
    // itself branches on body.po_type to pick PROD_PO_CREATE vs PROD_MTEST_PO_CREATE, but the
    // pipeline-level ACL gate (route-acl-registry.ts) is static per-URL and can't see the body,
    // so MTEST needs its own URL to get its own resource code at that gate too. Never grant QA
    // WRITE on PROD_PO_CREATE itself — that would also open MTO/HPS/MTS/INT to QA.
    case "POST:/api/production/process-orders/mtest":
      return await createProcessOrderHandler(req, ctx);

    // Packing Orders
    case "GET:/api/production/packing-orders":
      return await listPackingOrdersHandler(req, ctx);
    case "GET:/api/production/packing-orders/availability-preview":
      return await availabilityPreviewPackingOrderHandler(req, ctx);
    case "GET:/api/production/packing-orders/sfg-batches":
      return await listPackingSfgBatchOptionsHandler(req, ctx);
    // §131.4 item #11 — which Prodshade+Stroke combos have SFG stock at L003, for
    // PTEST's Standard-time picker (no Pack BOM SFG row to derive material_id from).
    case "GET:/api/production/packing-orders/mtest-sfg-options":
      return await listMtestSfgProdshadeOptionsHandler(req, ctx);
    case "POST:/api/production/packing-orders":
      return await createPackingOrderHandler(req, ctx);
    // §131.2 (2026-08-26): PTEST-only route, same handler as above — see the process-orders
    // /mtest route's comment for why a distinct URL is needed (pipeline ACL gate is static
    // per-route, can't see body.po_type).
    case "POST:/api/production/packing-orders/mtest":
      return await createPackingOrderHandler(req, ctx);
    case "GET:/api/production/fg-stock-breakdown":
      return await fgStockBreakdownHandler(req, ctx);

    // SFG QA Result Recording
    case "GET:/api/production/sfg-qa-documents":
      return await listSfgQaDocumentsHandler(req, ctx);

    // Stroke Change Requests (PR03/PR04)
    case "GET:/api/production/stroke-change-requests":
      return await listStrokeChangeRequestsHandler(req, ctx);
    case "POST:/api/production/stroke-change-requests":
      return await createStrokeChangeRequestHandler(req, ctx);

    // Pack BOMs (PR05/PR06)
    case "GET:/api/production/pack-boms/eligible-skus":
      return await listPackBomEligibleSkusHandler(req, ctx);
    case "GET:/api/production/pack-boms":
      return await listPackBomsHandler(req, ctx);
    case "POST:/api/production/pack-boms":
      return await createPackBomHandler(req, ctx);

    // Pack BOM Change Requests (PR07/PR08)
    case "GET:/api/production/pack-bom-change-requests":
      return await listPackBomChangeRequestsHandler(req, ctx);

    // Partial Batch Reversal (PR19) + Partial Reversal Report (PR20)
    case "GET:/api/production/partial-reversals/prodshades":
      return await listPartialReversalProdshadesHandler(req, ctx);
    case "GET:/api/production/partial-reversals/resolve-batch":
      return await resolvePartialReversalBatchHandler(req, ctx);
    case "GET:/api/production/partial-reversals/stock-lines":
      return await listPartialReversalStockLinesHandler(req, ctx);
    case "GET:/api/production/partial-reversals/salvage-batches":
      return await listSalvageBatchOptionsHandler(req, ctx);
    case "GET:/api/production/partial-reversals/detail":
      return await getPartialReversalDetailHandler(req, ctx);
    case "POST:/api/production/partial-reversals":
      return await createPartialBatchReversalHandler(req, ctx);
    case "GET:/api/production/partial-reversals":
      return await listPartialBatchReversalsHandler(req, ctx);
  }

  // ── PARAMETERIZED ROUTES ───────────────────────────────────────────────────

  // Pack Configs /:id
  if (/^\/api\/production\/pack-configs\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deletePackConfigHandler(req, ctx);
  }

  // AC06 SLOC/Costing Group /:id maintenance
  if (/^\/api\/production\/ac06\/sloc-groups\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateAc06SlocGroupHandler(req, ctx);
  }
  if (/^\/api\/production\/ac06\/sloc-groups\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteAc06SlocGroupHandler(req, ctx);
  }
  if (/^\/api\/production\/ac06\/costing-groups\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateAc06CostingGroupHandler(req, ctx);
  }
  if (/^\/api\/production\/ac06\/costing-groups\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteAc06CostingGroupHandler(req, ctx);
  }

  // Pack Codes /:id
  if (/^\/api\/production\/pack-codes\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updatePackCodeHandler(req, ctx);
  }

  // Batch Series /:id
  if (/^\/api\/production\/batch-series\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateBatchSeriesHandler(req, ctx);
  }
  if (/^\/api\/production\/batch-numbers\/[^/]+\/release$/.test(pathname) && req.method === "POST") {
    return await releaseBatchNumberHandler(req, ctx);
  }

  // Stroke Masters /:id
  if (/^\/api\/production\/stroke-masters\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getStrokeMasterHandler(req, ctx);
    if (req.method === "PATCH") return await updateStrokeMasterHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-masters\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approveStrokeMasterHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-masters\/[^/]+\/revert$/.test(pathname) && req.method === "POST") {
    return await revertStrokeMasterHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-masters\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectStrokeMasterHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-masters\/[^/]+\/deactivate$/.test(pathname) && req.method === "POST") {
    return await deactivateStrokeMasterHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-masters\/[^/]+\/reactivate$/.test(pathname) && req.method === "POST") {
    return await reactivateStrokeMasterHandler(req, ctx);
  }

  // Plan Feed /:id actions
  if (/^\/api\/production\/plan-feed\/[^/]+\/items-mtest$/.test(pathname) && req.method === "POST") {
    return await addMtestPlanFeedItemHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/items-mtest\/[^/]+$/.test(pathname)) {
    if (req.method === "PATCH") return await updateMtestPlanFeedItemHandler(req, ctx);
    if (req.method === "DELETE") return await deleteMtestPlanFeedItemHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/items$/.test(pathname) && req.method === "POST") {
    return await addPlanFeedItemHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/items\/[^/]+$/.test(pathname)) {
    if (req.method === "PATCH") return await updatePlanFeedItemHandler(req, ctx);
    if (req.method === "DELETE") return await deletePlanFeedItemHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getPlanFeedHandler(req, ctx);
    if (req.method === "PATCH") return await updatePlanFeedHandler(req, ctx);
  }
  // QA receives this resource only for MTEST FOs. The handler validates the row's party type.
  if (/^\/api\/production\/plan-feed\/[^/]+\/edit-mtest$/.test(pathname) && req.method === "PATCH") {
    return await updateMtestPlanFeedHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelPlanFeedHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/reactivate$/.test(pathname) && req.method === "POST") {
    return await reactivatePlanFeedHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/allocations$/.test(pathname)) {
    if (req.method === "GET") return await listFoAllocationsHandler(req, ctx);
    if (req.method === "POST") return await upsertFoAllocationHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/allocations-mtest$/.test(pathname) && req.method === "POST") {
    return await upsertMtestFoAllocationHandler(req, ctx);
  }

  // PR14 Batch Variance Report /:id detail
  if (/^\/api\/production\/batch-variance-report\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getBatchVarianceDetailHandler(req, ctx);
  }

  // Process Orders /:id actions
  if (/^\/api\/production\/process-orders\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/lines$/.test(pathname) && req.method === "PATCH") {
    return await updateProcessOrderLinesHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/edit$/.test(pathname) && req.method === "PATCH") {
    return await editProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/qa-approve$/.test(pathname) && req.method === "POST") {
    return await qaApproveProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/qa-reject$/.test(pathname) && req.method === "POST") {
    return await qaRejectProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/start-batch$/.test(pathname) && req.method === "POST") {
    return await startBatchHandler(req, ctx);
  }
  // §131.2: MTEST-only route, same handler — see the create-route comment above for why a
  // distinct URL (not just the handler's own po_type branch) is needed here.
  if (/^\/api\/production\/process-orders\/[^/]+\/start-batch-mtest$/.test(pathname) && req.method === "POST") {
    return await startBatchHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/finalize$/.test(pathname) && req.method === "POST") {
    return await finalizeProcessOrderHandler(req, ctx);
  }
  // §131.2: MTEST-only route, same handler — see the create-route comment above.
  if (/^\/api\/production\/process-orders\/[^/]+\/finalize-mtest$/.test(pathname) && req.method === "POST") {
    return await finalizeProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/verify$/.test(pathname) && req.method === "POST") {
    return await verifyProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/correct$/.test(pathname) && req.method === "POST") {
    return await correctProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/reverse$/.test(pathname) && req.method === "POST") {
    return await reverseProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/prune$/.test(pathname) && req.method === "POST") {
    return await pruneProcessOrderHandler(req, ctx);
  }

  // SFG QA /:id actions
  if (/^\/api\/production\/sfg-qa-documents\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getSfgQaDocumentHandler(req, ctx);
  }
  if (/^\/api\/production\/sfg-qa-documents\/[^/]+\/test-lines$/.test(pathname) && req.method === "POST") {
    return await addSfgQaTestLineHandler(req, ctx);
  }
  if (/^\/api\/production\/sfg-qa-documents\/[^/]+\/test-lines\/[^/]+$/.test(pathname) && req.method === "PUT") {
    return await updateSfgQaTestLineHandler(req, ctx);
  }
  if (/^\/api\/production\/sfg-qa-documents\/[^/]+\/decision$/.test(pathname) && req.method === "POST") {
    return await submitSfgQaDecisionHandler(req, ctx);
  }

  // Packing Orders /:id actions
  if (/^\/api\/production\/packing-orders\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getPackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/lines$/.test(pathname) && req.method === "PATCH") {
    return await updatePackingOrderLinesHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/edit$/.test(pathname) && req.method === "PATCH") {
    return await editPackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelPackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/finalize$/.test(pathname) && req.method === "POST") {
    return await finalizePackingOrderHandler(req, ctx);
  }
  // §131.2: PTEST-only route, same handler.
  if (/^\/api\/production\/packing-orders\/[^/]+\/finalize-mtest$/.test(pathname) && req.method === "POST") {
    return await finalizePackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/reverse$/.test(pathname) && req.method === "POST") {
    return await reversePackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/correct$/.test(pathname) && req.method === "POST") {
    return await correctPackingOrderHandler(req, ctx);
  }

  // Stroke Change Requests /:id actions (PR03/PR04)
  if (/^\/api\/production\/stroke-change-requests\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getStrokeChangeRequestHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-change-requests\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approveStrokeChangeRequestHandler(req, ctx);
  }
  if (/^\/api\/production\/stroke-change-requests\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectStrokeChangeRequestHandler(req, ctx);
  }

  // Pack BOMs /:id actions (PR05/PR06)
  if (/^\/api\/production\/pack-boms\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getPackBomHandler(req, ctx);
  }
  if (/^\/api\/production\/pack-boms\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approvePackBomHandler(req, ctx);
  }
  if (/^\/api\/production\/pack-boms\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectPackBomHandler(req, ctx);
  }
  if (/^\/api\/production\/pack-boms\/[^/]+\/change-request$/.test(pathname) && req.method === "POST") {
    return await createPackBomChangeRequestHandler(req, ctx);
  }

  // Partial Batch Reversal /:id (PR20 expand)
  if (/^\/api\/production\/partial-reversals\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getPartialBatchReversalHandler(req, ctx);
  }

  // Pack BOM Change Requests /:id actions (PR07/PR08)
  if (/^\/api\/production\/pack-bom-change-requests\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getPackBomChangeRequestHandler(req, ctx);
  }
  if (/^\/api\/production\/pack-bom-change-requests\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approvePackBomChangeRequestHandler(req, ctx);
  }
  if (/^\/api\/production\/pack-bom-change-requests\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectPackBomChangeRequestHandler(req, ctx);
  }
  return null;
}
