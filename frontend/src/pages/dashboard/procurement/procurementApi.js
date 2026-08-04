import { resolveErrorMessage } from "../../../utils/errorMessages.js";

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

  if (response.status === 204) {
    if (!response.ok) {
      throw new Error("PROCUREMENT_REQUEST_FAILED");
    }
    return null;
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    const code = json?.code ?? "PROCUREMENT_REQUEST_FAILED";
    // The UI-facing message is deliberately generic for 5xx/unmapped codes (see
    // resolveErrorMessage) so end users don't see raw backend errors. Log the real
    // response here so it's still visible in the browser console during development.
    console.error(`[PROCUREMENT_API_ERROR] ${method} ${path} -> ${response.status} ${code}: ${json?.message ?? "(no message body)"}`, json);
    const error = new Error(resolveErrorMessage(code, json?.message, response.status));
    error.code = code;
    error.status = response.status;
    error.backendMessage = json?.message ?? null;
    throw error;
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

export function deletePaymentTerm(id) {
  return fetchProcurement("DELETE", `/api/procurement/payment-terms/${encodeURIComponent(id)}`);
}

export function togglePaymentTerm(payload) {
  return fetchProcurement("POST", "/api/procurement/payment-terms/toggle", payload);
}

export function getPoFilterOptions(params) {
  return fetchProcurement("GET", "/api/procurement/po-filter-options", undefined, params);
}

export function listMaterialUomConversionsForProcurement(materialId) {
  return fetchProcurement("GET", "/api/procurement/materials/uom-conversion", undefined, { material_id: materialId });
}

export function listReferenceDateTypes(params) {
  return fetchProcurement("GET", "/api/procurement/reference-date-types", undefined, params);
}

export function createReferenceDateType(payload) {
  return fetchProcurement("POST", "/api/procurement/reference-date-type", payload);
}

export function toggleReferenceDateType(payload) {
  return fetchProcurement("POST", "/api/procurement/reference-date-type/toggle", payload);
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

export function deletePort(id) {
  return fetchProcurement("DELETE", `/api/procurement/ports/${encodeURIComponent(id)}`);
}

export function togglePort(payload) {
  return fetchProcurement("POST", "/api/procurement/ports/toggle", payload);
}

export function listTransitTimes(params) {
  return fetchProcurement("GET", "/api/procurement/port-transit", undefined, params);
}

export function upsertTransitTime(payload) {
  return fetchProcurement("POST", "/api/procurement/port-transit", payload);
}

export function deleteTransitTime(id) {
  return fetchProcurement("DELETE", `/api/procurement/port-transit/${encodeURIComponent(id)}`);
}

export function listCompanies() {
  return fetchProcurement("GET", "/api/procurement/companies");
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

export function deleteImportLeadTime(id) {
  return fetchProcurement("DELETE", `/api/procurement/lead-times/import/${encodeURIComponent(id)}`);
}

export function deleteDomesticLeadTime(id) {
  return fetchProcurement("DELETE", `/api/procurement/lead-times/domestic/${encodeURIComponent(id)}`);
}

export function updateImportLeadTime(id, payload) {
  return fetchProcurement("PATCH", `/api/procurement/lead-times/import/${encodeURIComponent(id)}`, payload);
}

export function updateDomesticLeadTime(id, payload) {
  return fetchProcurement("PATCH", `/api/procurement/lead-times/domestic/${encodeURIComponent(id)}`, payload);
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

export function deleteTransporter(id) {
  return fetchProcurement("DELETE", `/api/procurement/transporters/${encodeURIComponent(id)}`);
}

export function lookupGstProfile(gstNumber) {
  return fetchProcurement("GET", "/api/procurement/gst-profile", undefined, { gst_number: gstNumber });
}

export function listTransporterContacts(transporterId) {
  return fetchProcurement("GET", "/api/procurement/transporters/contacts", undefined, { transporter_id: transporterId });
}

export function saveTransporterContacts(transporterId, contacts) {
  return fetchProcurement("POST", "/api/procurement/transporters/contacts", { transporter_id: transporterId, contacts });
}

export function listTransporterEmails(transporterId) {
  return fetchProcurement("GET", "/api/procurement/transporters/emails", undefined, { transporter_id: transporterId });
}

export function saveTransporterEmails(transporterId, emails) {
  return fetchProcurement("POST", "/api/procurement/transporters/emails", { transporter_id: transporterId, emails });
}

export function listTransporterCompanyMaps(transporterId) {
  return fetchProcurement("GET", "/api/procurement/transporters/company-map", undefined, { transporter_id: transporterId });
}

export function mapTransporterToCompany(payload) {
  return fetchProcurement("POST", "/api/procurement/transporters/company-map", payload);
}

export function listCHAs(params) {
  return fetchProcurement("GET", "/api/procurement/chas", undefined, params);
}

export function createCHA(payload) {
  return fetchProcurement("POST", "/api/procurement/chas", payload);
}

export function updateCHA(id, payload) {
  return fetchProcurement("PATCH", `/api/procurement/chas/${encodeURIComponent(id)}`, payload);
}

export function deleteCHA(id) {
  return fetchProcurement("DELETE", `/api/procurement/chas/${encodeURIComponent(id)}`);
}

export function toggleCHA(payload) {
  return fetchProcurement("POST", "/api/procurement/chas/toggle", payload);
}

export function listCHAPorts(id) {
  return fetchProcurement("GET", `/api/procurement/chas/${encodeURIComponent(id)}/ports`);
}

export function mapCHAToPort(id, payload) {
  return fetchProcurement("POST", `/api/procurement/chas/${encodeURIComponent(id)}/ports`, payload);
}

export function unmapCHAPort(chaId, portId) {
  return fetchProcurement("DELETE", `/api/procurement/chas/${encodeURIComponent(chaId)}/ports/${encodeURIComponent(portId)}`);
}

export function listChaContacts(chaId) {
  return fetchProcurement("GET", "/api/procurement/chas/contacts", undefined, { cha_id: chaId });
}

export function saveChaContacts(chaId, contacts) {
  return fetchProcurement("POST", "/api/procurement/chas/contacts", { cha_id: chaId, contacts });
}

export function listChaEmails(chaId) {
  return fetchProcurement("GET", "/api/procurement/chas/emails", undefined, { cha_id: chaId });
}

export function saveChaEmails(chaId, emails) {
  return fetchProcurement("POST", "/api/procurement/chas/emails", { cha_id: chaId, emails });
}

export function listChaCompanyMaps(chaId) {
  return fetchProcurement("GET", "/api/procurement/chas/company-map", undefined, { cha_id: chaId });
}

export function mapChaToCompany(payload) {
  return fetchProcurement("POST", "/api/procurement/chas/company-map", payload);
}

export function listMaterialCategories(params) {
  return fetchProcurement("GET", "/api/procurement/material-categories", undefined, params);
}

export function createMaterialCategory(payload) {
  return fetchProcurement("POST", "/api/procurement/material-categories", payload);
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

export function listPOOrderGroups(params) {
  return fetchProcurement("GET", "/api/procurement/po-order-groups", undefined, params);
}

export function getPOOrderGroup(id) {
  return fetchProcurement("GET", `/api/procurement/po-order-groups/${encodeURIComponent(id)}`);
}

export function confirmPOOrderGroup(id, payload) {
  return fetchProcurement("POST", `/api/procurement/po-order-groups/${encodeURIComponent(id)}/confirm`, payload);
}

export function approvePOOrderGroup(id, payload) {
  return fetchProcurement("POST", `/api/procurement/po-order-groups/${encodeURIComponent(id)}/approve`, payload);
}

export function rejectPOOrderGroup(id, payload) {
  return fetchProcurement("POST", `/api/procurement/po-order-groups/${encodeURIComponent(id)}/reject`, payload);
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

export function listAvailableSubCsnsForSto(params) {
  return fetchProcurement("GET", "/api/procurement/csns/available-for-sto", undefined, params);
}

export function deleteSubCSN(id, subId) {
  return fetchProcurement(
    "DELETE",
    `/api/procurement/csns/${encodeURIComponent(id)}/sub-csns/${encodeURIComponent(subId)}`
  );
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

export function listCSNTrackerLayouts() {
  return fetchProcurement("GET", "/api/procurement/tracker/layouts");
}

export function createCSNTrackerLayout(data) {
  return fetchProcurement("POST", "/api/procurement/tracker/layouts", data);
}

export function deleteCSNTrackerLayout(id) {
  return fetchProcurement("DELETE", `/api/procurement/tracker/layouts/${encodeURIComponent(id)}`);
}

export function getCSNFieldHistory(id, params) {
  return fetchProcurement("GET", `/api/procurement/csns/${encodeURIComponent(id)}/history`, undefined, params);
}

export function previewCSNDispatchQty(id, data) {
  return fetchProcurement("POST", `/api/procurement/csns/${encodeURIComponent(id)}/dispatch-qty/preview`, data);
}

export function confirmCSNDispatchQty(id, data) {
  return fetchProcurement("POST", `/api/procurement/csns/${encodeURIComponent(id)}/dispatch-qty/confirm`, data);
}

export function inlineUpdateCSN(id, data) {
  return fetchProcurement("PUT", `/api/procurement/tracker/${encodeURIComponent(id)}/inline`, data);
}

export function listGateEntries({ company_id, status, date_from, date_to, limit = 50, offset = 0 } = {}) {
  const params = { company_id, status, date_from, date_to, limit, offset };
  Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);
  return fetchProcurement("GET", "/api/procurement/gate-entries", undefined, params);
}

export function getGateEntry(id) {
  return fetchProcurement("GET", `/api/procurement/gate-entries/${encodeURIComponent(id)}`);
}

export function getGateEntryByNumber(geNumber) {
  return fetchProcurement("GET", "/api/procurement/gate-entries/by-number", undefined, { ge_number: geNumber });
}

export function getGateReport(params) {
  const p = { ...params };
  Object.keys(p).forEach((k) => (p[k] === undefined || p[k] === "") && delete p[k]);
  return fetchProcurement("GET", "/api/procurement/gate-report", undefined, p);
}

export function createGateEntry(data) {
  return fetchProcurement("POST", "/api/procurement/gate-entries", data);
}

export function updateGateEntry(id, data) {
  return fetchProcurement("PUT", `/api/procurement/gate-entries/${encodeURIComponent(id)}`, data);
}

export function pruneGateEntry(id) {
  return fetchProcurement("POST", `/api/procurement/gate-entries/${encodeURIComponent(id)}/prune`);
}

export function listOpenCSNsForGE(params) {
  return fetchProcurement("GET", "/api/procurement/gate-entries/open-csns", undefined, params);
}

export function listOpenPOsForGE(params) {
  return fetchProcurement("GET", "/api/procurement/gate-entries/open-pos", undefined, params);
}

export function listOpenSTOsForGE(params) {
  return fetchProcurement("GET", "/api/procurement/gate-entries/open-stos", undefined, params);
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

export function getGELinesForGRN(geNumber) {
  return fetchProcurement("GET", "/api/procurement/grns/ge-lines", undefined, { ge_number: geNumber });
}

export function createAndPostGRNFromLine(data) {
  return fetchProcurement("POST", "/api/procurement/grns/from-line", data);
}

export function getMaterialVendorDocNames(materialId, vendorId) {
  return fetchProcurement("GET", "/api/procurement/grns/material-vendor-doc-names", undefined, {
    material_id: materialId,
    vendor_id: vendorId,
  });
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

export function listQaTestMethods(params) {
  return fetchProcurement("GET", "/api/procurement/qa-test-methods", undefined, params);
}

export function createQaTestMethod(payload) {
  return fetchProcurement("POST", "/api/procurement/qa-test-methods", payload);
}

export function listQaCategoryTestConfig(params) {
  return fetchProcurement("GET", "/api/procurement/qa-category-test-config", undefined, params);
}

export function createQaCategoryTestConfig(payload) {
  return fetchProcurement("POST", "/api/procurement/qa-category-test-config", payload);
}

export function updateQaCategoryTestConfig(id, payload) {
  return fetchProcurement("PATCH", `/api/procurement/qa-category-test-config/${encodeURIComponent(id)}`, payload);
}

export function deleteQaCategoryTestConfig(id) {
  return fetchProcurement("DELETE", `/api/procurement/qa-category-test-config/${encodeURIComponent(id)}`);
}

export function listSTOs(params) {
  return fetchProcurement("GET", "/api/procurement/stos", undefined, params);
}

export function getSTO(id) {
  return fetchProcurement("GET", `/api/procurement/stos/${encodeURIComponent(id)}`);
}

export function getLastStoPaymentTerm(params) {
  return fetchProcurement("GET", "/api/procurement/stos/last-payment-term", undefined, params);
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

export function knockOffSTOLine(id, lineId, data) {
  return fetchProcurement(
    "POST",
    `/api/procurement/stos/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/knock-off`,
    data
  );
}

export function confirmSTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/confirm`, data);
}

export function approveSTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/approve`, data);
}

export function rejectSTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/reject`, data);
}

export function amendSTO(id, data) {
  return fetchProcurement("PUT", `/api/procurement/stos/${encodeURIComponent(id)}/amend`, data);
}

export function approveSTOAmendment(id, data) {
  return fetchProcurement("POST", `/api/procurement/stos/${encodeURIComponent(id)}/approve-amendment`, data);
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

export function getProcurementPlanning(params) {
  return fetchProcurement("GET", "/api/procurement/planning", undefined, params);
}

export function listPTOs(params) {
  return fetchProcurement("GET", "/api/procurement/ptos", undefined, params);
}

export function getPTO(id) {
  return fetchProcurement("GET", `/api/procurement/ptos/${encodeURIComponent(id)}`);
}

export function createPTO(data) {
  return fetchProcurement("POST", "/api/procurement/ptos", data);
}

export function approvePTO(id) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/approve`);
}

export function oneStepTransfer(id) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/one-step`);
}

export function issueTransfer(id) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/issue`);
}

export function receiveTransfer(id, data) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/receive`, data);
}

export function cancelPTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/cancel`, data);
}

export function slocTransfer(data) {
  return fetchProcurement("POST", "/api/procurement/sloc-transfer", data);
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

export function updateSalesOrderLines(id, data) {
  return fetchProcurement("PATCH", `/api/procurement/sales-orders/${encodeURIComponent(id)}/lines`, data);
}

// §113 Stage 2 — Delivery Order (shared by SO + STO)
export function listDeliveryOrders(params) {
  return fetchProcurement("GET", "/api/procurement/delivery-orders", undefined, params);
}

export function getDeliveryOrder(id) {
  return fetchProcurement("GET", `/api/procurement/delivery-orders/${encodeURIComponent(id)}`);
}

export function createDeliveryOrder(data) {
  return fetchProcurement("POST", "/api/procurement/delivery-orders", data);
}

export function cancelDeliveryOrder(id, data) {
  return fetchProcurement("POST", `/api/procurement/delivery-orders/${encodeURIComponent(id)}/cancel`, data);
}

export function listDOSourceDocuments(params) {
  return fetchProcurement("GET", "/api/procurement/delivery-orders/source-documents", undefined, params);
}

export function listDOSourceLines(params) {
  return fetchProcurement("GET", "/api/procurement/delivery-orders/source-lines", undefined, params);
}

export function listDOStorageLocationOptions(params) {
  return fetchProcurement("GET", "/api/procurement/delivery-orders/storage-locations", undefined, params);
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

export function createPgiInvoice(data) {
  return fetchProcurement("POST", "/api/procurement/sales-invoices/pgi", data);
}

export function reverseSalesInvoice(id, data) {
  return fetchProcurement("POST", `/api/procurement/sales-invoices/${encodeURIComponent(id)}/reverse`, data);
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

export function getOpeningStockDocumentByNumber(documentNumber) {
  return fetchProcurement("GET", "/api/procurement/opening-stock/by-number", undefined, {
    document_number: documentNumber,
  });
}

export function addOpeningStockLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines`, data);
}

export function batchUpdateOpeningStockLines(id, data) {
  return fetchProcurement("PUT", `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/batch`, data);
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

export function recalculateValuation(data) {
  return fetchProcurement("POST", "/api/procurement/opening-stock/recalculate-valuation", data);
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

export function getStockLedgerReport(params) {
  return fetchProcurement("GET", "/api/procurement/stock-ledger", undefined, params);
}

export function listStockLedgerMovementTypes() {
  return fetchProcurement("GET", "/api/procurement/stock-ledger/movement-types");
}

export function searchStockLedgerBatchNumbers(params) {
  return fetchProcurement("GET", "/api/procurement/stock-ledger/batch-search", undefined, params);
}

export function searchStockLedgerPackingPoNumbers(params) {
  return fetchProcurement("GET", "/api/procurement/stock-ledger/po-search", undefined, params);
}

export function listReportLayouts(params) {
  return fetchProcurement("GET", "/api/procurement/report-layouts", undefined, params);
}

export function createReportLayout(payload) {
  return fetchProcurement("POST", "/api/procurement/report-layouts", payload);
}

export function updateReportLayout(id, payload) {
  return fetchProcurement("PATCH", `/api/procurement/report-layouts/${encodeURIComponent(id)}`, payload);
}

export function deleteReportLayout(id) {
  return fetchProcurement("DELETE", `/api/procurement/report-layouts/${encodeURIComponent(id)}`);
}

export function setDefaultReportLayout(id) {
  return fetchProcurement("POST", `/api/procurement/report-layouts/${encodeURIComponent(id)}/set-default`);
}

export function getCurrentStock(params) {
  return fetchProcurement("GET", "/api/procurement/current-stock", undefined, params);
}

export function searchCurrentStockBatchNumbers(params) {
  return fetchProcurement("GET", "/api/procurement/current-stock/batch-search", undefined, params);
}

export function searchCurrentStockPackingPoNumbers(params) {
  return fetchProcurement("GET", "/api/procurement/current-stock/po-search", undefined, params);
}

export function getStockValuation(params) {
  return fetchProcurement("GET", "/api/procurement/stock-valuation", undefined, params);
}

export function getDocumentFlow(params) {
  return fetchProcurement("GET", "/api/procurement/document-flow", undefined, params);
}
