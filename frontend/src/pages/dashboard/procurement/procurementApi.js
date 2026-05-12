async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchProcurement(method, path, body, params) {
  const query = new URLSearchParams();

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const url = `${import.meta.env.VITE_API_BASE}${path}${query.toString() ? `?${query.toString()}` : ""}`;
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "PROCUREMENT_REQUEST_FAILED");
  }

  const payload = json.data;

  if (payload && typeof payload === "object" && "data" in payload) {
    if ("total" in payload) {
      return payload;
    }
    return payload.data;
  }

  return payload;
}

export function listPaymentTerms(params) {
  return fetchProcurement("GET", "/api/procurement/payment-terms", undefined, params);
}

export function createPaymentTerm(payload) {
  return fetchProcurement("POST", "/api/procurement/payment-terms", payload);
}

export function getPaymentTerm(id) {
  return fetchProcurement("GET", `/api/procurement/payment-terms/${encodeURIComponent(id)}`);
}

export function updatePaymentTerm(id, payload) {
  return fetchProcurement("PUT", `/api/procurement/payment-terms/${encodeURIComponent(id)}`, payload);
}

export function listPorts(params) {
  return fetchProcurement("GET", "/api/procurement/ports", undefined, params);
}

export function createPort(payload) {
  return fetchProcurement("POST", "/api/procurement/ports", payload);
}

export function updatePort(id, payload) {
  return fetchProcurement("PUT", `/api/procurement/ports/${encodeURIComponent(id)}`, payload);
}

export function listTransitTimes(params) {
  return fetchProcurement("GET", "/api/procurement/port-transit", undefined, params);
}

export function upsertTransitTime(payload) {
  return fetchProcurement("POST", "/api/procurement/port-transit", payload);
}

export function listImportLeadTimes(params) {
  return fetchProcurement("GET", "/api/procurement/lead-times/import", undefined, params);
}

export function upsertImportLeadTime(payload) {
  return fetchProcurement("POST", "/api/procurement/lead-times/import", payload);
}

export function listDomesticLeadTimes(params) {
  return fetchProcurement("GET", "/api/procurement/lead-times/domestic", undefined, params);
}

export function upsertDomesticLeadTime(payload) {
  return fetchProcurement("POST", "/api/procurement/lead-times/domestic", payload);
}

export function listTransporters(params) {
  return fetchProcurement("GET", "/api/procurement/transporters", undefined, params);
}

export function createTransporter(payload) {
  return fetchProcurement("POST", "/api/procurement/transporters", payload);
}

export function updateTransporter(id, payload) {
  return fetchProcurement("PUT", `/api/procurement/transporters/${encodeURIComponent(id)}`, payload);
}

export function listCHAs(params) {
  return fetchProcurement("GET", "/api/procurement/chas", undefined, params);
}

export function createCHA(payload) {
  return fetchProcurement("POST", "/api/procurement/chas", payload);
}

export function listCHAPorts(id) {
  return fetchProcurement("GET", `/api/procurement/chas/${encodeURIComponent(id)}/ports`);
}

export function mapCHAToPort(id, payload) {
  return fetchProcurement("POST", `/api/procurement/chas/${encodeURIComponent(id)}/ports`, payload);
}

export function listMaterialCategories(params) {
  return fetchProcurement("GET", "/api/procurement/material-categories", undefined, params);
}

export function listPurchaseOrders(params) {
  return fetchProcurement("GET", "/api/procurement/purchase-orders", undefined, params);
}

export function getPurchaseOrder(id) {
  return fetchProcurement("GET", `/api/procurement/purchase-orders/${encodeURIComponent(id)}`);
}

export function createPurchaseOrder(data) {
  return fetchProcurement("POST", "/api/procurement/purchase-orders", data);
}

export function updatePurchaseOrder(id, data) {
  return fetchProcurement("PUT", `/api/procurement/purchase-orders/${encodeURIComponent(id)}`, data);
}

export function confirmPurchaseOrder(id, data) {
  return fetchProcurement("POST", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/confirm`, data);
}

export function approvePurchaseOrder(id, data) {
  return fetchProcurement("POST", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/approve`, data);
}

export function rejectPurchaseOrder(id, data) {
  return fetchProcurement("POST", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/reject`, data);
}

export function amendPurchaseOrder(id, data) {
  return fetchProcurement("PUT", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/amend`, data);
}

export function approveAmendment(id) {
  return fetchProcurement("POST", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/approve-amendment`);
}

export function cancelPurchaseOrder(id, data) {
  return fetchProcurement("POST", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/cancel`, data);
}

export function knockOffPOLine(id, lineId, data) {
  return fetchProcurement(
    "POST",
    `/api/procurement/purchase-orders/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/knock-off`,
    data
  );
}

export function knockOffPO(id, data) {
  return fetchProcurement("POST", `/api/procurement/purchase-orders/${encodeURIComponent(id)}/knock-off`, data);
}

export function listCSNs(params) {
  return fetchProcurement("GET", "/api/procurement/csns", undefined, params);
}

export function getCSN(id) {
  return fetchProcurement("GET", `/api/procurement/csns/${encodeURIComponent(id)}`);
}

export function updateCSN(id, data) {
  return fetchProcurement("PUT", `/api/procurement/csns/${encodeURIComponent(id)}`, data);
}

export function createSubCSN(id, data) {
  return fetchProcurement("POST", `/api/procurement/csns/${encodeURIComponent(id)}/sub-csns`, data);
}

export function deleteSubCSN(id, subId) {
  return fetchProcurement(
    "DELETE",
    `/api/procurement/csns/${encodeURIComponent(id)}/sub-csns/${encodeURIComponent(subId)}`
  );
}

export function markCSNInTransit(id, data) {
  return fetchProcurement("POST", `/api/procurement/csns/${encodeURIComponent(id)}/mark-in-transit`, data);
}

export function markCSNArrived(id, data) {
  return fetchProcurement("POST", `/api/procurement/csns/${encodeURIComponent(id)}/mark-arrived`, data);
}

export function getAllAlertCounts(params) {
  return fetchProcurement("GET", "/api/procurement/alerts/counts", undefined, params);
}

export function getLCAlertList(params) {
  return fetchProcurement("GET", "/api/procurement/alerts/lc", undefined, params);
}

export function getVesselBookingAlertList(params) {
  return fetchProcurement("GET", "/api/procurement/alerts/vessel-booking", undefined, params);
}

export function getCSNTracker(params) {
  return fetchProcurement("GET", "/api/procurement/tracker", undefined, params);
}

export function inlineUpdateCSN(id, data) {
  return fetchProcurement("PUT", `/api/procurement/tracker/${encodeURIComponent(id)}/inline`, data);
}

export function listGateEntries(params) {
  return fetchProcurement("GET", "/api/procurement/gate-entries", undefined, params);
}

export function getGateEntry(id) {
  return fetchProcurement("GET", `/api/procurement/gate-entries/${encodeURIComponent(id)}`);
}

export function createGateEntry(data) {
  return fetchProcurement("POST", "/api/procurement/gate-entries", data);
}

export function updateGateEntry(id, data) {
  return fetchProcurement("PUT", `/api/procurement/gate-entries/${encodeURIComponent(id)}`, data);
}

export function listOpenCSNsForGE(params) {
  return fetchProcurement("GET", "/api/procurement/gate-entries/open-csns", undefined, params);
}

export function createGateExitInbound(data) {
  return fetchProcurement("POST", "/api/procurement/gate-exits/inbound", data);
}

export function getGateExitInbound(id) {
  return fetchProcurement("GET", `/api/procurement/gate-exits/inbound/${encodeURIComponent(id)}`);
}

export function listGRNs(params) {
  return fetchProcurement("GET", "/api/procurement/grns", undefined, params);
}

export function getGRN(id) {
  return fetchProcurement("GET", `/api/procurement/grns/${encodeURIComponent(id)}`);
}

export function createGRNDraft(data) {
  return fetchProcurement("POST", "/api/procurement/grns", data);
}

export function updateGRNDraft(id, data) {
  return fetchProcurement("PUT", `/api/procurement/grns/${encodeURIComponent(id)}`, data);
}

export function postGRN(id) {
  return fetchProcurement("POST", `/api/procurement/grns/${encodeURIComponent(id)}/post`);
}

export function reverseGRN(id, data) {
  return fetchProcurement("POST", `/api/procurement/grns/${encodeURIComponent(id)}/reverse`, data);
}

export function listQADocuments(params) {
  return fetchProcurement("GET", "/api/procurement/qa-documents", undefined, params);
}

export function getQADocument(id) {
  return fetchProcurement("GET", `/api/procurement/qa-documents/${encodeURIComponent(id)}`);
}

export function assignQAOfficer(id, data) {
  return fetchProcurement("POST", `/api/procurement/qa-documents/${encodeURIComponent(id)}/assign`, data);
}

export function addQATestLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/qa-documents/${encodeURIComponent(id)}/test-lines`, data);
}

export function updateQATestLine(id, lineId, data) {
  return fetchProcurement(
    "PUT",
    `/api/procurement/qa-documents/${encodeURIComponent(id)}/test-lines/${encodeURIComponent(lineId)}`,
    data
  );
}

export function deleteQATestLine(id, lineId) {
  return fetchProcurement(
    "DELETE",
    `/api/procurement/qa-documents/${encodeURIComponent(id)}/test-lines/${encodeURIComponent(lineId)}`
  );
}

export function submitUsageDecision(id, data) {
  return fetchProcurement("POST", `/api/procurement/qa-documents/${encodeURIComponent(id)}/decision`, data);
}

export function listSTOs(params) {
  return fetchProcurement("GET", "/api/procurement/stos", undefined, params);
}

export function getSTO(id) {
  return fetchProcurement("GET", `/api/procurement/stos/${encodeURIComponent(id)}`);
}

export function createSTO(data) {
  return fetchProcurement("POST", "/api/procurement/stos", data);
}

export function updateSTO(id, data) {
  return fetchProcurement("PUT", `/api/procurement/stos/${encodeURIComponent(id)}`, data);
}

export function cancelSTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/cancel`, data);
}

export function dispatchSTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/dispatch`, data);
}

export function updateGateExitWeight(id, data) {
  return fetchProcurement("PUT", `/api/procurement/gate-exits/outbound/${encodeURIComponent(id)}/weight`, data);
}

export function confirmSTOReceipt(id) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/confirm-receipt`);
}

export function closeSTO(id) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/close`);
}

export function transformSubCSNToSTO(csnId, data) {
  return fetchProcurement("POST", `/api/procurement/csns/${encodeURIComponent(csnId)}/transform-to-sto`, data);
}

export function listRTVs(params) {
  return fetchProcurement("GET", "/api/procurement/rtvs", undefined, params);
}

export function getRTV(id) {
  return fetchProcurement("GET", `/api/procurement/rtvs/${encodeURIComponent(id)}`);
}

export function createRTV(data) {
  return fetchProcurement("POST", "/api/procurement/rtvs", data);
}

export function addRTVLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/rtvs/${encodeURIComponent(id)}/lines`, data);
}

export function postRTV(id, data) {
  return fetchProcurement("POST", `/api/procurement/rtvs/${encodeURIComponent(id)}/post`, data);
}

export function listDebitNotes(params) {
  return fetchProcurement("GET", "/api/procurement/debit-notes", undefined, params);
}

export function getDebitNote(id) {
  return fetchProcurement("GET", `/api/procurement/debit-notes/${encodeURIComponent(id)}`);
}

export function createDebitNote(data) {
  return fetchProcurement("POST", "/api/procurement/debit-notes", data);
}

export function markDebitNoteSent(id) {
  return fetchProcurement("POST", `/api/procurement/debit-notes/${encodeURIComponent(id)}/mark-sent`);
}

export function acknowledgeDebitNote(id) {
  return fetchProcurement("POST", `/api/procurement/debit-notes/${encodeURIComponent(id)}/acknowledge`);
}

export function settleDebitNote(id) {
  return fetchProcurement("POST", `/api/procurement/debit-notes/${encodeURIComponent(id)}/settle`);
}

export function listExchangeRefs(params) {
  return fetchProcurement("GET", "/api/procurement/exchange-refs", undefined, params);
}

export function createExchangeRef(data) {
  return fetchProcurement("POST", "/api/procurement/exchange-refs", data);
}

export function linkReplacementGRN(id, data) {
  return fetchProcurement("PUT", `/api/procurement/exchange-refs/${encodeURIComponent(id)}/link-grn`, data);
}

export function listIVs(params) {
  return fetchProcurement("GET", "/api/procurement/invoice-verifications", undefined, params);
}

export function getIV(id) {
  return fetchProcurement("GET", `/api/procurement/invoice-verifications/${encodeURIComponent(id)}`);
}

export function createIVDraft(data) {
  return fetchProcurement("POST", "/api/procurement/invoice-verifications", data);
}

export function addIVLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/invoice-verifications/${encodeURIComponent(id)}/lines`, data);
}

export function removeIVLine(id, lineId) {
  return fetchProcurement(
    "DELETE",
    `/api/procurement/invoice-verifications/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`
  );
}

export function runIVMatch(id) {
  return fetchProcurement("POST", `/api/procurement/invoice-verifications/${encodeURIComponent(id)}/run-match`);
}

export function postIV(id) {
  return fetchProcurement("POST", `/api/procurement/invoice-verifications/${encodeURIComponent(id)}/post`);
}

export function listBlockedIVs(params) {
  return fetchProcurement("GET", "/api/procurement/invoice-verifications/blocked", undefined, params);
}

export function listLandedCosts(params) {
  return fetchProcurement("GET", "/api/procurement/landed-costs", undefined, params);
}

export function getLandedCost(id) {
  return fetchProcurement("GET", `/api/procurement/landed-costs/${encodeURIComponent(id)}`);
}

export function createLandedCost(data) {
  return fetchProcurement("POST", "/api/procurement/landed-costs", data);
}

export function addLCLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/landed-costs/${encodeURIComponent(id)}/lines`, data);
}

export function updateLCLine(id, lineId, data) {
  return fetchProcurement(
    "PUT",
    `/api/procurement/landed-costs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
    data
  );
}

export function deleteLCLine(id, lineId) {
  return fetchProcurement(
    "DELETE",
    `/api/procurement/landed-costs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`
  );
}

export function postLandedCost(id) {
  return fetchProcurement("POST", `/api/procurement/landed-costs/${encodeURIComponent(id)}/post`);
}

export function getLandedCostByGRN(grnId) {
  return fetchProcurement("GET", `/api/procurement/landed-costs/by-grn/${encodeURIComponent(grnId)}`);
}

export function listSalesOrders(params) {
  return fetchProcurement("GET", "/api/procurement/sales-orders", undefined, params);
}

export function getSalesOrder(id) {
  return fetchProcurement("GET", `/api/procurement/sales-orders/${encodeURIComponent(id)}`);
}

export function createSalesOrder(data) {
  return fetchProcurement("POST", "/api/procurement/sales-orders", data);
}

export function updateSalesOrder(id, data) {
  return fetchProcurement("PUT", `/api/procurement/sales-orders/${encodeURIComponent(id)}`, data);
}

export function cancelSalesOrder(id, data) {
  return fetchProcurement("POST", `/api/procurement/sales-orders/${encodeURIComponent(id)}/cancel`, data);
}

export function issueSOStock(id, data) {
  return fetchProcurement("POST", `/api/procurement/sales-orders/${encodeURIComponent(id)}/issue`, data);
}

export function knockOffSOLine(id, lineId, data) {
  return fetchProcurement(
    "POST",
    `/api/procurement/sales-orders/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/knock-off`,
    data
  );
}

export function listSalesInvoices(params) {
  return fetchProcurement("GET", "/api/procurement/sales-invoices", undefined, params);
}

export function getSalesInvoice(id) {
  return fetchProcurement("GET", `/api/procurement/sales-invoices/${encodeURIComponent(id)}`);
}

export function createSalesInvoice(data) {
  return fetchProcurement("POST", "/api/procurement/sales-invoices", data);
}

export function postSalesInvoice(id) {
  return fetchProcurement("POST", `/api/procurement/sales-invoices/${encodeURIComponent(id)}/post`);
}

export function listGlobalNumberSeries() {
  return fetchProcurement("GET", "/api/procurement/number-series/global");
}

export function updateGlobalStartingNumber(docType, data) {
  return fetchProcurement("PATCH", `/api/procurement/number-series/global/${encodeURIComponent(docType)}`, data);
}

export function listCompanyNumberSeries(params) {
  return fetchProcurement("GET", "/api/procurement/number-series/company", undefined, params);
}

export function createCompanyNumberSeries(data) {
  return fetchProcurement("POST", "/api/procurement/number-series/company", data);
}

export function listCompanyCounters(companyId, docType) {
  return fetchProcurement(
    "GET",
    `/api/procurement/number-series/company/${encodeURIComponent(companyId)}/${encodeURIComponent(docType)}/counters`
  );
}

export function createCompanyCounter(companyId, docType, data) {
  return fetchProcurement(
    "POST",
    `/api/procurement/number-series/company/${encodeURIComponent(companyId)}/${encodeURIComponent(docType)}/counters`,
    data
  );
}

export function listOpeningStockDocuments(params) {
  return fetchProcurement("GET", "/api/procurement/opening-stock", undefined, params);
}

export function createOpeningStockDocument(data) {
  return fetchProcurement("POST", "/api/procurement/opening-stock", data);
}

export function getOpeningStockDocument(id) {
  return fetchProcurement("GET", `/api/procurement/opening-stock/${encodeURIComponent(id)}`);
}

export function addOpeningStockLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines`, data);
}

export function updateOpeningStockLine(id, lineId, data) {
  return fetchProcurement(
    "PUT",
    `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
    data
  );
}

export function removeOpeningStockLine(id, lineId) {
  return fetchProcurement(
    "DELETE",
    `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`
  );
}

export function submitOpeningStockDocument(id) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/submit`);
}

export function approveOpeningStockDocument(id) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/approve`);
}

export function postOpeningStockDocument(id) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/post`);
}

export function listPIDocuments(params) {
  return fetchProcurement("GET", "/api/procurement/physical-inventory", undefined, params);
}

export function createPIDocument(data) {
  return fetchProcurement("POST", "/api/procurement/physical-inventory", data);
}

export function getPIDocument(id) {
  return fetchProcurement("GET", `/api/procurement/physical-inventory/${encodeURIComponent(id)}`);
}

export function addPIItem(id, data) {
  return fetchProcurement("POST", `/api/procurement/physical-inventory/${encodeURIComponent(id)}/items`, data);
}

export function enterPICount(id, itemId, data) {
  return fetchProcurement(
    "PUT",
    `/api/procurement/physical-inventory/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/count`,
    data
  );
}

export function requestPIRecount(id, itemId) {
  return fetchProcurement(
    "POST",
    `/api/procurement/physical-inventory/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/recount`
  );
}

export function postPIDifferences(id) {
  return fetchProcurement("POST", `/api/procurement/physical-inventory/${encodeURIComponent(id)}/post`);
}
