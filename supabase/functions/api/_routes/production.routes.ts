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
} from "../_core/production/batch_series.handlers.ts";
import {
  listSegmentLocationsHandler,
  upsertSegmentLocationHandler,
} from "../_core/production/segment_location.handlers.ts";
import {
  listPlanFeedHandler,
  getPlanFeedHandler,
  createPlanFeedHandler,
  updatePlanFeedHandler,
  cancelPlanFeedHandler,
  planFeedSummaryHandler,
} from "../_core/production/plan_feed.handlers.ts";
import {
  listProcessOrdersHandler,
  getProcessOrderHandler,
  createProcessOrderHandler,
  updateProcessOrderLinesHandler,
  qaApproveProcessOrderHandler,
  qaRejectProcessOrderHandler,
  startBatchHandler,
  finalizeProcessOrderHandler,
  verifyProcessOrderHandler,
  reverseProcessOrderHandler,
} from "../_core/production/process_order.handlers.ts";
import {
  listPackingOrdersHandler,
  getPackingOrderHandler,
  createPackingOrderHandler,
  updatePackingOrderLinesHandler,
  linkFoHandler,
  finalizePackingOrderHandler,
  reversePackingOrderHandler,
} from "../_core/production/packing_order.handlers.ts";
import {
  listStrokeChangeRequestsHandler,
  getStrokeChangeRequestHandler,
  createStrokeChangeRequestHandler,
  approveStrokeChangeRequestHandler,
  rejectStrokeChangeRequestHandler,
} from "../_core/production/stroke_change_request.handlers.ts";
import {
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

    // Segment Location Config
    case "GET:/api/production/segment-locations":
      return await listSegmentLocationsHandler(req, ctx);
    case "POST:/api/production/segment-locations":
      return await upsertSegmentLocationHandler(req, ctx);

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

    // Process Orders
    case "GET:/api/production/process-orders":
      return await listProcessOrdersHandler(req, ctx);
    case "POST:/api/production/process-orders":
      return await createProcessOrderHandler(req, ctx);

    // Packing Orders
    case "GET:/api/production/packing-orders":
      return await listPackingOrdersHandler(req, ctx);
    case "POST:/api/production/packing-orders":
      return await createPackingOrderHandler(req, ctx);

    // Stroke Change Requests (PR03/PR04)
    case "GET:/api/production/stroke-change-requests":
      return await listStrokeChangeRequestsHandler(req, ctx);
    case "POST:/api/production/stroke-change-requests":
      return await createStrokeChangeRequestHandler(req, ctx);

    // Pack BOMs (PR05/PR06)
    case "GET:/api/production/pack-boms":
      return await listPackBomsHandler(req, ctx);
    case "POST:/api/production/pack-boms":
      return await createPackBomHandler(req, ctx);

    // Pack BOM Change Requests (PR07/PR08)
    case "GET:/api/production/pack-bom-change-requests":
      return await listPackBomChangeRequestsHandler(req, ctx);
  }

  // ── PARAMETERIZED ROUTES ───────────────────────────────────────────────────

  // Pack Configs /:id
  if (/^\/api\/production\/pack-configs\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deletePackConfigHandler(req, ctx);
  }

  // Pack Codes /:id
  if (/^\/api\/production\/pack-codes\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updatePackCodeHandler(req, ctx);
  }

  // Batch Series /:id
  if (/^\/api\/production\/batch-series\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateBatchSeriesHandler(req, ctx);
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

  // Plan Feed /:id actions
  if (/^\/api\/production\/plan-feed\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getPlanFeedHandler(req, ctx);
    if (req.method === "PATCH") return await updatePlanFeedHandler(req, ctx);
  }
  if (/^\/api\/production\/plan-feed\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelPlanFeedHandler(req, ctx);
  }

  // Process Orders /:id actions
  if (/^\/api\/production\/process-orders\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/lines$/.test(pathname) && req.method === "PATCH") {
    return await updateProcessOrderLinesHandler(req, ctx);
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
  if (/^\/api\/production\/process-orders\/[^/]+\/finalize$/.test(pathname) && req.method === "POST") {
    return await finalizeProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/verify$/.test(pathname) && req.method === "POST") {
    return await verifyProcessOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/process-orders\/[^/]+\/reverse$/.test(pathname) && req.method === "POST") {
    return await reverseProcessOrderHandler(req, ctx);
  }

  // Packing Orders /:id actions
  if (/^\/api\/production\/packing-orders\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") return await getPackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/lines$/.test(pathname) && req.method === "PATCH") {
    return await updatePackingOrderLinesHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/link-fo$/.test(pathname) && req.method === "POST") {
    return await linkFoHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/finalize$/.test(pathname) && req.method === "POST") {
    return await finalizePackingOrderHandler(req, ctx);
  }
  if (/^\/api\/production\/packing-orders\/[^/]+\/reverse$/.test(pathname) && req.method === "POST") {
    return await reversePackingOrderHandler(req, ctx);
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
