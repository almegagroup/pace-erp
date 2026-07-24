/*
 * File-ID: 16.2.2
 * File-Path: supabase/functions/api/_routes/procurement.routes.ts
 * Gate: 16.2
 * Phase: 16
 * Domain: PROCUREMENT
 * Purpose: Dispatch purchase order backend routes under /api/procurement/.
 * Authority: Backend
 */

import type { ContextResolution } from "../_pipeline/context.ts";
import type { SessionResolution } from "../_pipeline/session.ts";
import {
  confirmDispatchQtyAdjustmentHandler,
  createSubCSNHandler,
  createTrackerLayoutHandler,
  deleteTrackerLayoutHandler,
  deleteSubCSNHandler,
  getAllAlertCountsHandler,
  getCSNHandler,
  getLCAlertCountHandler,
  getLCAlertListHandler,
  getTrackerHandler,
  getVesselBookingAlertCountHandler,
  getVesselBookingAlertListHandler,
  inlineUpdateCSNHandler,
  listAvailableSubCsnsForStoHandler,
  listCsnFieldHistoryHandler,
  listCSNsHandler,
  listTrackerLayoutsHandler,
  previewDispatchQtyAdjustmentHandler,
  updateCSNHandler,
} from "../_core/procurement/csn.handlers.ts";
import {
  createGateEntryHandler,
  createGateExitInboundHandler,
  gateReportHandler,
  getGateEntryByNumberHandler,
  getGateEntryHandler,
  getGateExitInboundHandler,
  listGateEntriesHandler,
  listOpenCSNsForGEHandler,
  listOpenPOsForGEHandler,
  pruneGateEntryHandler,
  updateGateEntryHandler,
} from "../_core/procurement/gate_entry.handlers.ts";
import {
  createAndPostGRNFromLineHandler,
  createGRNDraftHandler,
  getGELinesForGRNHandler,
  getGRNHandler,
  getMaterialVendorDocNamesHandler,
  listGRNsHandler,
  postGRNHandler,
  reverseGRNHandler,
  updateGRNDraftHandler,
} from "../_core/procurement/grn.handlers.ts";
import { getProcurementPlanningHandler } from "../_core/procurement/planning.handlers.ts";
import { getDocumentFlowHandler } from "../_core/procurement/document_flow.handlers.ts";
import {
  getCurrentStockHandler,
  getStockLedgerReportHandler,
  getStockValuationHandler,
} from "../_core/procurement/stock_reports.handlers.ts";
import {
  approvePTOHandler,
  cancelPTOHandler,
  createPTOHandler,
  getPTOHandler,
  issueTransferHandler,
  listPTOsHandler,
  oneStepTransferHandler,
  receiveTransferHandler,
  storageLocationTransferHandler,
} from "../_core/procurement/pto.handlers.ts";
import {
  addIVLineHandler,
  createIVDraftHandler,
  getIVHandler,
  listBlockedIVsHandler,
  listIVsHandler,
  postIVHandler,
  removeIVLineHandler,
  runMatchHandler,
} from "../_core/procurement/invoice_verification.handlers.ts";
import {
  addTestLineHandler,
  deleteTestLineHandler,
  getQADocumentHandler,
  listQADocumentsHandler,
  submitUsageDecisionHandler,
  updateTestLineHandler,
} from "../_core/procurement/inward_qa.handlers.ts";
import {
  createCategoryTestConfigHandler,
  createTestMethodHandler,
  deleteCategoryTestConfigHandler,
  listCategoryTestConfigHandler,
  listTestMethodsHandler,
  updateCategoryTestConfigHandler,
} from "../_core/procurement/qa_test_method.handlers.ts";
import {
  addLCLineHandler,
  createLandedCostHandler,
  deleteLCLineHandler,
  getLandedCostForGRNHandler,
  getLandedCostHandler,
  listLandedCostsHandler,
  postLandedCostHandler,
  updateLCLineHandler,
} from "../_core/procurement/landed_cost.handlers.ts";
import {
  createCompanyCounterHandler,
  createCompanySeriesHandler,
  deleteCompanyCounterHandler,
  deleteCompanySeriesHandler,
  listCompanyCountersHandler,
  listCompanySeriesHandler,
  listGlobalSeriesHandler,
  updateCompanySeriesHandler,
  updateGlobalStartingHandler,
} from "../_core/procurement/number_series.handlers.ts";
import {
  addOpeningStockLineHandler,
  approveOpeningStockDocumentHandler,
  batchUpdateOpeningStockLinesHandler,
  createOpeningStockDocumentHandler,
  getOpeningStockDocumentByNumberHandler,
  getOpeningStockDocumentHandler,
  listOpeningStockDocumentsHandler,
  postOpeningStockDocumentHandler,
  recalculateValuationHandler,
  removeOpeningStockLineHandler,
  submitOpeningStockDocumentHandler,
  updateOpeningStockLineHandler,
} from "../_core/procurement/opening_stock.handlers.ts";
import {
  addPIItemHandler,
  createPIDHandler,
  enterCountHandler,
  getPIDHandler,
  listPIDsHandler,
  postDifferencesHandler,
  requestRecountHandler,
} from "../_core/procurement/physical_inventory.handlers.ts";
import {
  createCHAHandler,
  deleteImportLeadTimeHandler,
  deleteDomesticLeadTimeHandler,
  updateImportLeadTimeHandler,
  updateDomesticLeadTimeHandler,
  deleteTransitTimeHandler,
  listProcurementCompaniesHandler,
  createMaterialCategoryHandler,
  createPaymentTermsHandler,
  createPortHandler,
  createReferenceDateTypeHandler,
  createTransporterHandler,
  deleteCHAHandler,
  deletePaymentTermsHandler,
  deletePortHandler,
  deleteTransporterHandler,
  getChaContactsHandler,
  getChaEmailsHandler,
  getGstProfileLookupHandler,
  getPaymentTermsHandler,
  getTransporterContactsHandler,
  getTransporterEmailsHandler,
  listCHAPortsHandler,
  listCHAsHandler,
  listChaCompanyMapsHandler,
  listDomesticLeadTimesHandler,
  listImportLeadTimesHandler,
  listMaterialCategoriesHandler,
  listPaymentTermsHandler,
  listPortsHandler,
  listReferenceDateTypesHandler,
  listTransitTimesHandler,
  listTransportersHandler,
  listTransporterCompanyMapsHandler,
  mapCHAToPortHandler,
  mapChaToCompanyHandler,
  mapTransporterToCompanyHandler,
  toggleCHAHandler,
  togglePaymentTermsHandler,
  togglePortHandler,
  toggleReferenceDateTypeHandler,
  unmapCHAPortHandler,
  updateCHAHandler,
  updatePaymentTermsHandler,
  updatePortHandler,
  updateTransporterHandler,
  upsertDomesticLeadTimeHandler,
  upsertImportLeadTimeHandler,
  upsertChaContactsHandler,
  upsertChaEmailsHandler,
  upsertTransitTimeHandler,
  upsertTransporterContactsHandler,
  upsertTransporterEmailsHandler,
} from "../_core/procurement/l2_masters.handlers.ts";
import {
  amendPOHandler,
  approveAmendmentHandler,
  approvePOHandler,
  approvePOOrderGroupHandler,
  cancelPOHandler,
  confirmPOHandler,
  confirmPOOrderGroupHandler,
  createPOHandler,
  deletePOHandler,
  getPOHandler,
  getPOOrderGroupHandler,
  getPoFilterOptionsHandler,
  knockOffPOLineHandler,
  knockOffPOHandler,
  listMaterialUomConversionsForProcurementHandler,
  listPOsHandler,
  listPOOrderGroupsHandler,
  rejectPOHandler,
  rejectPOOrderGroupHandler,
  updatePOHandler,
} from "../_core/procurement/po.handlers.ts";
import {
  acknowledgeDebitNoteHandler,
  addRTVLineHandler,
  createDebitNoteHandler,
  createExchangeRefHandler,
  createRTVHandler,
  getDebitNoteHandler,
  getRTVHandler,
  linkReplacementGRNHandler,
  listDebitNotesHandler,
  listExchangeRefsHandler,
  listRTVsHandler,
  markDebitNoteSentHandler,
  postRTVHandler,
  settleDebitNoteHandler,
} from "../_core/procurement/rtv.handlers.ts";
import {
  cancelSOHandler,
  createSalesInvoiceHandler,
  createSOHandler,
  getSalesInvoiceHandler,
  getSOHandler,
  issueSOStockHandler,
  knockOffSOLineHandler,
  listSalesInvoicesHandler,
  listSOsHandler,
  postSalesInvoiceHandler,
  updateSOHandler,
} from "../_core/procurement/sales_order.handlers.ts";
import {
  approveSTOHandler,
  approveSTOAmendmentHandler,
  cancelSTOHandler,
  amendSTOHandler,
  closeSTOHandler,
  confirmSTOHandler,
  confirmSTOReceiptHandler,
  createSTOHandler,
  dispatchSTOHandler,
  getSTOHandler,
  getLastStoPaymentTermHandler,
  listSTOsHandler,
  rejectSTOHandler,
  transformSubCSNToSTOHandler,
  updateGateExitOutboundWeightHandler,
  updateSTOHandler,
} from "../_core/procurement/sto.handlers.ts";

export async function dispatchProcurementRoutes(
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

  switch (routeKey) {
    case "GET:/api/procurement/csns":
      return await listCSNsHandler(req, ctx);
    case "GET:/api/procurement/csns/available-for-sto":
      return await listAvailableSubCsnsForStoHandler(req, ctx);
    case "GET:/api/procurement/alerts/lc-count":
      return await getLCAlertCountHandler(req, ctx);
    case "GET:/api/procurement/alerts/lc":
      return await getLCAlertListHandler(req, ctx);
    case "GET:/api/procurement/alerts/vessel-booking-count":
      return await getVesselBookingAlertCountHandler(req, ctx);
    case "GET:/api/procurement/alerts/vessel-booking":
      return await getVesselBookingAlertListHandler(req, ctx);
    case "GET:/api/procurement/alerts/counts":
      return await getAllAlertCountsHandler(req, ctx);
    case "GET:/api/procurement/tracker":
      return await getTrackerHandler(req, ctx);
    case "GET:/api/procurement/tracker/layouts":
      return await listTrackerLayoutsHandler(req, ctx);
    case "POST:/api/procurement/tracker/layouts":
      return await createTrackerLayoutHandler(req, ctx);
    case "GET:/api/procurement/payment-terms":
      return await listPaymentTermsHandler(req, ctx);
    case "POST:/api/procurement/payment-terms":
      return await createPaymentTermsHandler(req, ctx);
    case "POST:/api/procurement/payment-terms/toggle":
      return await togglePaymentTermsHandler(req, ctx);
    case "GET:/api/procurement/reference-date-types":
      return await listReferenceDateTypesHandler(req, ctx);
    case "POST:/api/procurement/reference-date-type":
      return await createReferenceDateTypeHandler(req, ctx);
    case "POST:/api/procurement/reference-date-type/toggle":
      return await toggleReferenceDateTypeHandler(req, ctx);
    case "GET:/api/procurement/ports":
      return await listPortsHandler(req, ctx);
    case "POST:/api/procurement/ports":
      return await createPortHandler(req, ctx);
    case "POST:/api/procurement/ports/toggle":
      return await togglePortHandler(req, ctx);
    case "GET:/api/procurement/port-transit":
      return await listTransitTimesHandler(req, ctx);
    case "POST:/api/procurement/port-transit":
      return await upsertTransitTimeHandler(req, ctx);

    case "GET:/api/procurement/material-categories":
      return await listMaterialCategoriesHandler(req, ctx);
    case "POST:/api/procurement/material-categories":
      return await createMaterialCategoryHandler(req, ctx);
    case "GET:/api/procurement/lead-times/import":
      return await listImportLeadTimesHandler(req, ctx);
    case "POST:/api/procurement/lead-times/import":
      return await upsertImportLeadTimeHandler(req, ctx);
    case "GET:/api/procurement/lead-times/domestic":
      return await listDomesticLeadTimesHandler(req, ctx);
    case "POST:/api/procurement/lead-times/domestic":
      return await upsertDomesticLeadTimeHandler(req, ctx);
    case "GET:/api/procurement/transporters":
      return await listTransportersHandler(req, ctx);
    case "POST:/api/procurement/transporters":
      return await createTransporterHandler(req, ctx);
    case "GET:/api/procurement/gst-profile":
      return await getGstProfileLookupHandler(req, ctx);
    case "GET:/api/procurement/transporters/contacts":
      return await getTransporterContactsHandler(req, ctx);
    case "POST:/api/procurement/transporters/contacts":
      return await upsertTransporterContactsHandler(req, ctx);
    case "GET:/api/procurement/transporters/emails":
      return await getTransporterEmailsHandler(req, ctx);
    case "POST:/api/procurement/transporters/emails":
      return await upsertTransporterEmailsHandler(req, ctx);
    case "GET:/api/procurement/transporters/company-map":
      return await listTransporterCompanyMapsHandler(req, ctx);
    case "POST:/api/procurement/transporters/company-map":
      return await mapTransporterToCompanyHandler(req, ctx);
    case "GET:/api/procurement/chas":
      return await listCHAsHandler(req, ctx);
    case "POST:/api/procurement/chas":
      return await createCHAHandler(req, ctx);
    case "GET:/api/procurement/chas/contacts":
      return await getChaContactsHandler(req, ctx);
    case "POST:/api/procurement/chas/contacts":
      return await upsertChaContactsHandler(req, ctx);
    case "GET:/api/procurement/chas/emails":
      return await getChaEmailsHandler(req, ctx);
    case "POST:/api/procurement/chas/emails":
      return await upsertChaEmailsHandler(req, ctx);
    case "GET:/api/procurement/chas/company-map":
      return await listChaCompanyMapsHandler(req, ctx);
    case "POST:/api/procurement/chas/company-map":
      return await mapChaToCompanyHandler(req, ctx);
    case "GET:/api/procurement/companies":
      return await listProcurementCompaniesHandler(req, ctx);
    case "POST:/api/procurement/chas/toggle":
      return await toggleCHAHandler(req, ctx);
    case "GET:/api/procurement/number-series/global":
      return await listGlobalSeriesHandler(req, ctx);
    case "GET:/api/procurement/number-series/company":
      return await listCompanySeriesHandler(req, ctx);
    case "POST:/api/procurement/number-series/company":
      return await createCompanySeriesHandler(req, ctx);
    case "POST:/api/procurement/opening-stock":
      return await createOpeningStockDocumentHandler(req, ctx);
    case "GET:/api/procurement/opening-stock":
      return await listOpeningStockDocumentsHandler(req, ctx);
    case "GET:/api/procurement/opening-stock/by-number":
      return await getOpeningStockDocumentByNumberHandler(req, ctx);
    case "POST:/api/procurement/opening-stock/recalculate-valuation":
      return await recalculateValuationHandler(req, ctx);
    case "POST:/api/procurement/physical-inventory":
      return await createPIDHandler(req, ctx);
    case "GET:/api/procurement/physical-inventory":
      return await listPIDsHandler(req, ctx);
    case "POST:/api/procurement/gate-entries":
      return await createGateEntryHandler(req, ctx);
    case "GET:/api/procurement/gate-entries":
      return await listGateEntriesHandler(req, ctx);
    case "GET:/api/procurement/gate-report":
      return await gateReportHandler(req, ctx);
    case "GET:/api/procurement/gate-entries/open-csns":
      return await listOpenCSNsForGEHandler(req, ctx);
    case "GET:/api/procurement/gate-entries/open-pos":
      return await listOpenPOsForGEHandler(req, ctx);
    case "GET:/api/procurement/gate-entries/by-number":
      return await getGateEntryByNumberHandler(req, ctx);
    case "POST:/api/procurement/gate-exits/inbound":
      return await createGateExitInboundHandler(req, ctx);
    case "GET:/api/procurement/qa-documents":
      return await listQADocumentsHandler(req, ctx);
    case "GET:/api/procurement/qa-test-methods":
      return await listTestMethodsHandler(req, ctx);
    case "POST:/api/procurement/qa-test-methods":
      return await createTestMethodHandler(req, ctx);
    case "GET:/api/procurement/qa-category-test-config":
      return await listCategoryTestConfigHandler(req, ctx);
    case "POST:/api/procurement/qa-category-test-config":
      return await createCategoryTestConfigHandler(req, ctx);
    case "POST:/api/procurement/grns":
      return await createGRNDraftHandler(req, ctx);
    case "POST:/api/procurement/grns/from-line":
      return await createAndPostGRNFromLineHandler(req, ctx);
    case "GET:/api/procurement/grns":
      return await listGRNsHandler(req, ctx);
    case "GET:/api/procurement/grns/ge-lines":
      return await getGELinesForGRNHandler(req, ctx);
    case "GET:/api/procurement/grns/material-vendor-doc-names":
      return await getMaterialVendorDocNamesHandler(req, ctx);
    case "POST:/api/procurement/invoice-verifications":
      return await createIVDraftHandler(req, ctx);
    case "GET:/api/procurement/invoice-verifications":
      return await listIVsHandler(req, ctx);
    case "GET:/api/procurement/invoice-verifications/blocked":
      return await listBlockedIVsHandler(req, ctx);
    case "GET:/api/procurement/planning":
      return await getProcurementPlanningHandler(req, ctx);
    case "GET:/api/procurement/document-flow":
      return await getDocumentFlowHandler(req, ctx);
    case "GET:/api/procurement/stock-ledger":
      return await getStockLedgerReportHandler(req, ctx);
    case "GET:/api/procurement/current-stock":
      return await getCurrentStockHandler(req, ctx);
    case "GET:/api/procurement/stock-valuation":
      return await getStockValuationHandler(req, ctx);
    case "POST:/api/procurement/ptos":
      return await createPTOHandler(req, ctx);
    case "GET:/api/procurement/ptos":
      return await listPTOsHandler(req, ctx);
    case "POST:/api/procurement/sloc-transfer":
      return await storageLocationTransferHandler(req, ctx);
    case "POST:/api/procurement/landed-costs":
      return await createLandedCostHandler(req, ctx);
    case "GET:/api/procurement/landed-costs":
      return await listLandedCostsHandler(req, ctx);
    case "POST:/api/procurement/rtvs":
      return await createRTVHandler(req, ctx);
    case "GET:/api/procurement/rtvs":
      return await listRTVsHandler(req, ctx);
    case "POST:/api/procurement/debit-notes":
      return await createDebitNoteHandler(req, ctx);
    case "GET:/api/procurement/debit-notes":
      return await listDebitNotesHandler(req, ctx);
    case "POST:/api/procurement/exchange-refs":
      return await createExchangeRefHandler(req, ctx);
    case "GET:/api/procurement/exchange-refs":
      return await listExchangeRefsHandler(req, ctx);
    case "POST:/api/procurement/sales-orders":
      return await createSOHandler(req, ctx);
    case "GET:/api/procurement/sales-orders":
      return await listSOsHandler(req, ctx);
    case "POST:/api/procurement/sales-invoices":
      return await createSalesInvoiceHandler(req, ctx);
    case "GET:/api/procurement/sales-invoices":
      return await listSalesInvoicesHandler(req, ctx);
    case "POST:/api/procurement/stos":
      return await createSTOHandler(req, ctx);
    case "GET:/api/procurement/stos":
      return await listSTOsHandler(req, ctx);
    case "GET:/api/procurement/stos/last-payment-term":
      return await getLastStoPaymentTermHandler(req, ctx);
    case "POST:/api/procurement/purchase-orders":
      return await createPOHandler(req, ctx);
    case "GET:/api/procurement/purchase-orders":
      return await listPOsHandler(req, ctx);
    case "GET:/api/procurement/po-order-groups":
      return await listPOOrderGroupsHandler(req, ctx);
    case "GET:/api/procurement/po-filter-options":
      return await getPoFilterOptionsHandler(req, ctx);
    case "GET:/api/procurement/materials/uom-conversion":
      return await listMaterialUomConversionsForProcurementHandler(req, ctx);
    default:
      break;
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getPOHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updatePOHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deletePOHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/po-order-groups\/[^/]+\/confirm$/.test(pathname) && req.method === "POST") {
    return await confirmPOOrderGroupHandler(req, ctx);
  }

  if (/^\/api\/procurement\/po-order-groups\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approvePOOrderGroupHandler(req, ctx);
  }

  if (/^\/api\/procurement\/po-order-groups\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectPOOrderGroupHandler(req, ctx);
  }

  if (/^\/api\/procurement\/po-order-groups\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getPOOrderGroupHandler(req, ctx);
  }

  if (/^\/api\/procurement\/csns\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getCSNHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updateCSNHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/csns\/[^/]+\/sub-csns$/.test(pathname) && req.method === "POST") {
    return await createSubCSNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/csns\/[^/]+\/sub-csns\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteSubCSNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/csns\/[^/]+\/history$/.test(pathname) && req.method === "GET") {
    return await listCsnFieldHistoryHandler(req, ctx);
  }

  if (/^\/api\/procurement\/csns\/[^/]+\/transform-to-sto$/.test(pathname) && req.method === "POST") {
    return await transformSubCSNToSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/csns\/[^/]+\/dispatch-qty\/preview$/.test(pathname) && req.method === "POST") {
    return await previewDispatchQtyAdjustmentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/csns\/[^/]+\/dispatch-qty\/confirm$/.test(pathname) && req.method === "POST") {
    return await confirmDispatchQtyAdjustmentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/tracker\/[^/]+\/inline$/.test(pathname) && req.method === "PUT") {
    return await inlineUpdateCSNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/tracker\/layouts\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteTrackerLayoutHandler(req, ctx);
  }

  if (/^\/api\/procurement\/payment-terms\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getPaymentTermsHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updatePaymentTermsHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deletePaymentTermsHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/ports\/[^/]+$/.test(pathname)) {
    if (req.method === "PUT") {
      return await updatePortHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deletePortHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/transporters\/[^/]+$/.test(pathname)) {
    if (req.method === "PUT") return await updateTransporterHandler(req, ctx);
    if (req.method === "DELETE") return await deleteTransporterHandler(req, ctx);
  }

  if (/^\/api\/procurement\/number-series\/global\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateGlobalStartingHandler(req, ctx);
  }

  if (/^\/api\/procurement\/number-series\/company\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateCompanySeriesHandler(req, ctx);
  }

  if (/^\/api\/procurement\/number-series\/company\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteCompanySeriesHandler(req, ctx);
  }

  if (/^\/api\/procurement\/number-series\/counters\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteCompanyCounterHandler(req, ctx);
  }

  if (/^\/api\/procurement\/number-series\/company\/[^/]+\/[^/]+\/counters$/.test(pathname)) {
    if (req.method === "GET") {
      return await listCompanyCountersHandler(req, ctx);
    }
    if (req.method === "POST") {
      return await createCompanyCounterHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getOpeningStockDocumentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+\/lines$/.test(pathname) && req.method === "POST") {
    return await addOpeningStockLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+\/lines\/batch$/.test(pathname) && req.method === "PUT") {
    return await batchUpdateOpeningStockLinesHandler(req, ctx);
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+\/lines\/[^/]+$/.test(pathname)) {
    if (req.method === "PUT") {
      return await updateOpeningStockLineHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await removeOpeningStockLineHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+\/submit$/.test(pathname) && req.method === "POST") {
    return await submitOpeningStockDocumentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approveOpeningStockDocumentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/opening-stock\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postOpeningStockDocumentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/physical-inventory\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getPIDHandler(req, ctx);
  }

  if (/^\/api\/procurement\/physical-inventory\/[^/]+\/items$/.test(pathname) && req.method === "POST") {
    return await addPIItemHandler(req, ctx);
  }

  if (/^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/count$/.test(pathname) && req.method === "PUT") {
    return await enterCountHandler(req, ctx);
  }

  if (/^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/recount$/.test(pathname) && req.method === "POST") {
    return await requestRecountHandler(req, ctx);
  }

  if (/^\/api\/procurement\/physical-inventory\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postDifferencesHandler(req, ctx);
  }

  if (/^\/api\/procurement\/port-transit\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteTransitTimeHandler(req, ctx);
  }

  if (/^\/api\/procurement\/lead-times\/import\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteImportLeadTimeHandler(req, ctx);
  }

  if (/^\/api\/procurement\/lead-times\/import\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateImportLeadTimeHandler(req, ctx);
  }

  if (/^\/api\/procurement\/lead-times\/domestic\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await deleteDomesticLeadTimeHandler(req, ctx);
  }

  if (/^\/api\/procurement\/lead-times\/domestic\/[^/]+$/.test(pathname) && req.method === "PATCH") {
    return await updateDomesticLeadTimeHandler(req, ctx);
  }

  if (/^\/api\/procurement\/chas\/[^/]+\/ports\/[^/]+$/.test(pathname)) {
    if (req.method === "DELETE") {
      return await unmapCHAPortHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/chas\/[^/]+\/ports$/.test(pathname)) {
    if (req.method === "GET") {
      return await listCHAPortsHandler(req, ctx);
    }
    if (req.method === "POST") {
      return await mapCHAToPortHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/chas\/[^/]+$/.test(pathname)) {
    if (req.method === "PATCH") {
      return await updateCHAHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deleteCHAHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/gate-entries\/[^/]+\/prune$/.test(pathname) && req.method === "POST") {
    return await pruneGateEntryHandler(req, ctx);
  }

  if (/^\/api\/procurement\/gate-entries\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getGateEntryHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updateGateEntryHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/gate-exits\/inbound\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getGateExitInboundHandler(req, ctx);
  }

  if (/^\/api\/procurement\/grns\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getGRNHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updateGRNDraftHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/grns\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postGRNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/grns\/[^/]+\/reverse$/.test(pathname) && req.method === "POST") {
    return await reverseGRNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/invoice-verifications\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getIVHandler(req, ctx);
  }

  if (/^\/api\/procurement\/invoice-verifications\/[^/]+\/lines$/.test(pathname) && req.method === "POST") {
    return await addIVLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/invoice-verifications\/[^/]+\/lines\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    return await removeIVLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/invoice-verifications\/[^/]+\/run-match$/.test(pathname) && req.method === "POST") {
    return await runMatchHandler(req, ctx);
  }

  if (/^\/api\/procurement\/invoice-verifications\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postIVHandler(req, ctx);
  }

  if (/^\/api\/procurement\/landed-costs\/by-grn\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getLandedCostForGRNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/ptos\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getPTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/ptos\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approvePTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/ptos\/[^/]+\/one-step$/.test(pathname) && req.method === "POST") {
    return await oneStepTransferHandler(req, ctx);
  }

  if (/^\/api\/procurement\/ptos\/[^/]+\/issue$/.test(pathname) && req.method === "POST") {
    return await issueTransferHandler(req, ctx);
  }

  if (/^\/api\/procurement\/ptos\/[^/]+\/receive$/.test(pathname) && req.method === "POST") {
    return await receiveTransferHandler(req, ctx);
  }

  if (/^\/api\/procurement\/ptos\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelPTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/landed-costs\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getLandedCostHandler(req, ctx);
  }

  if (/^\/api\/procurement\/landed-costs\/[^/]+\/lines$/.test(pathname) && req.method === "POST") {
    return await addLCLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/landed-costs\/[^/]+\/lines\/[^/]+$/.test(pathname)) {
    if (req.method === "PUT") {
      return await updateLCLineHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deleteLCLineHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/landed-costs\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postLandedCostHandler(req, ctx);
  }

  if (/^\/api\/procurement\/rtvs\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getRTVHandler(req, ctx);
  }

  if (/^\/api\/procurement\/rtvs\/[^/]+\/lines$/.test(pathname) && req.method === "POST") {
    return await addRTVLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/rtvs\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postRTVHandler(req, ctx);
  }

  if (/^\/api\/procurement\/debit-notes\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getDebitNoteHandler(req, ctx);
  }

  if (/^\/api\/procurement\/debit-notes\/[^/]+\/mark-sent$/.test(pathname) && req.method === "POST") {
    return await markDebitNoteSentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/debit-notes\/[^/]+\/acknowledge$/.test(pathname) && req.method === "POST") {
    return await acknowledgeDebitNoteHandler(req, ctx);
  }

  if (/^\/api\/procurement\/debit-notes\/[^/]+\/settle$/.test(pathname) && req.method === "POST") {
    return await settleDebitNoteHandler(req, ctx);
  }

  if (/^\/api\/procurement\/exchange-refs\/[^/]+\/link-grn$/.test(pathname) && req.method === "PUT") {
    return await linkReplacementGRNHandler(req, ctx);
  }

  if (/^\/api\/procurement\/sales-orders\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getSOHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updateSOHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/sales-orders\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelSOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/sales-orders\/[^/]+\/issue$/.test(pathname) && req.method === "POST") {
    return await issueSOStockHandler(req, ctx);
  }

  if (/^\/api\/procurement\/sales-orders\/[^/]+\/lines\/[^/]+\/knock-off$/.test(pathname) && req.method === "POST") {
    return await knockOffSOLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/sales-invoices\/[^/]+$/.test(pathname) && req.method === "GET") {
    return await getSalesInvoiceHandler(req, ctx);
  }

  if (/^\/api\/procurement\/sales-invoices\/[^/]+\/post$/.test(pathname) && req.method === "POST") {
    return await postSalesInvoiceHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getSTOHandler(req, ctx);
    }
    if (req.method === "PUT") {
      return await updateSTOHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/confirm$/.test(pathname) && req.method === "POST") {
    return await confirmSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approveSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/amend$/.test(pathname) && req.method === "PUT") {
    return await amendSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/approve-amendment$/.test(pathname) && req.method === "POST") {
    return await approveSTOAmendmentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/dispatch$/.test(pathname) && req.method === "POST") {
    return await dispatchSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/gate-exits\/outbound\/[^/]+\/weight$/.test(pathname) && req.method === "PUT") {
    return await updateGateExitOutboundWeightHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/confirm-receipt$/.test(pathname) && req.method === "POST") {
    return await confirmSTOReceiptHandler(req, ctx);
  }

  if (/^\/api\/procurement\/stos\/[^/]+\/close$/.test(pathname) && req.method === "POST") {
    return await closeSTOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/qa-documents\/[^/]+$/.test(pathname)) {
    if (req.method === "GET") {
      return await getQADocumentHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/qa-documents\/[^/]+\/test-lines$/.test(pathname) && req.method === "POST") {
    return await addTestLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/qa-documents\/[^/]+\/test-lines\/[^/]+$/.test(pathname)) {
    if (req.method === "PUT") {
      return await updateTestLineHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deleteTestLineHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/qa-documents\/[^/]+\/decision$/.test(pathname) && req.method === "POST") {
    return await submitUsageDecisionHandler(req, ctx);
  }

  if (/^\/api\/procurement\/qa-category-test-config\/[^/]+$/.test(pathname)) {
    if (req.method === "PATCH") {
      return await updateCategoryTestConfigHandler(req, ctx);
    }
    if (req.method === "DELETE") {
      return await deleteCategoryTestConfigHandler(req, ctx);
    }
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/confirm$/.test(pathname) && req.method === "POST") {
    return await confirmPOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
    return await approvePOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/reject$/.test(pathname) && req.method === "POST") {
    return await rejectPOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/amend$/.test(pathname) && req.method === "PUT") {
    return await amendPOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/approve-amendment$/.test(pathname) && req.method === "POST") {
    return await approveAmendmentHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
    return await cancelPOHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/lines\/[^/]+\/knock-off$/.test(pathname) && req.method === "POST") {
    return await knockOffPOLineHandler(req, ctx);
  }

  if (/^\/api\/procurement\/purchase-orders\/[^/]+\/knock-off$/.test(pathname) && req.method === "POST") {
    return await knockOffPOHandler(req, ctx);
  }

  return null;
}
