/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/BulkDoUploadDrawer.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: "Bulk DO Upload" — additive to DOListPage.jsx (SO03), per
 *          FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 points 14-15. One template
 *          row-group (same FO/SO Number) = one Delivery Order. A VDC row
 *          carries an FO Number (resolved against the already-mapped SO Map
 *          allocation, §6 points 8-12); a DC row carries a plain SO Number
 *          (no Customer/Site resolution needed, §6 point 10's correction).
 *          Driven entirely by the new previewDoBulkUpload/saveDoBulkUpload
 *          endpoints, which preserve the established unified DO business
 *          transaction while adding durable submission reconciliation.
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { getDoBulkSubmissionStatus, previewDoBulkUpload, saveDoBulkUpload } from "../procurementApi.js";
import { getTransporterMasterRevision } from "./transporterMasterRevision.js";
import { markSpreadsheetDuplicates, prioritizeUploadReviewRows } from "../../../../shared/uploadReviewRows.js";
import { TEMPLATE_HEADERS, parseUploadedWorkbook } from "./bulkDoWorkbook.js";


async function buildTemplateWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bulk DO Upload");
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 20; });
  return workbook;
}

async function saveWorkbook(workbook, fileName) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

async function downloadTemplate() {
  await saveWorkbook(await buildTemplateWorkbook(), "bulk_do_upload_template.xlsx");
}

// One line per FO/SO number that could not be resolved, so the user can map
// them in SO Map first.  Built only from the uploaded Excel + preview result.
function summarizeUnresolvedSources(reviewRows, rawByIndex) {
  const bySource = new Map();
  for (const row of reviewRows) {
    if (row.is_removable_duplicate || row.status !== "ERROR") continue;
    const raw = rawByIndex[row.row_index] ?? {};
    const key = String(row.fo_or_so_number ?? raw.fo_or_so_number ?? "").trim();
    if (!bySource.has(key)) {
      bySource.set(key, { fo_or_so_number: key, error_code: row.error_code, reason: BULK_DO_SOURCE_ERROR_TEXT[row.error_code] ?? row.error_code, row_indexes: [], skus: new Set(), pack_qty: 0, do_dates: new Set(), lr_numbers: new Set() });
    }
    const entry = bySource.get(key);
    entry.row_indexes.push(row.row_index);
    if (raw.sku) entry.skus.add(String(raw.sku));
    entry.pack_qty += Number(raw.pack_qty) || 0;
    if (raw.do_date) entry.do_dates.add(raw.do_date);
    if (raw.lr_number) entry.lr_numbers.add(String(raw.lr_number));
  }
  return [...bySource.values()].map((entry) => ({
    ...entry,
    row_count: entry.row_indexes.length,
    excel_rows: entry.row_indexes.map((rowIndex) => excelRowLabel(rawByIndex, rowIndex)).join(", "),
    skus: [...entry.skus].join(", "),
    do_dates: [...entry.do_dates].sort().join(", "),
    lr_numbers: [...entry.lr_numbers].join(", "),
  }));
}

async function exportUnresolvedSources(summary, rawByIndex) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const summarySheet = workbook.addWorksheet("Unmapped FO-SO");
  summarySheet.addRow(["FO/SO Number", "Reason", "Error Code", "Row Count", "Excel Row Numbers", "SKUs", "Total Pack Qty", "DO Dates", "LR Numbers"]);
  summary.forEach((entry) => summarySheet.addRow([entry.fo_or_so_number, entry.reason, entry.error_code, entry.row_count, entry.excel_rows, entry.skus, entry.pack_qty, entry.do_dates, entry.lr_numbers]));
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.columns.forEach((column) => { column.width = 22; });
  // Same layout as the upload template: after mapping in SO Map, this sheet
  // can be uploaded again as-is.
  const rowsSheet = workbook.addWorksheet("Rows to re-upload");
  rowsSheet.addRow(TEMPLATE_HEADERS);
  summary.flatMap((entry) => entry.row_indexes).sort((left, right) => left - right).forEach((rowIndex) => {
    const raw = rawByIndex[rowIndex] ?? {};
    rowsSheet.addRow([raw.fo_or_so_number, raw.do_date, raw.transporter_name, raw.lr_number, raw.lr_date, raw.sku, raw.pack_qty, raw.storage_location_code, raw.tally_invoice_number, raw.tally_invoice_date, raw.inbound_number, raw.truck_number, raw.dispatch_date]);
  });
  rowsSheet.getRow(1).font = { bold: true };
  rowsSheet.columns.forEach((column) => { column.width = 20; });
  await saveWorkbook(workbook, `bulk_do_unmapped_fo_so_${new Date().toISOString().slice(0, 10)}.xlsx`);
}


// fetchProcurement unwraps the standard `{ data: [...] }` API envelope for
// collection responses.  Keep this tolerant of either shape so a valid
// preview can never be mistaken for an empty upload when the client wrapper
// evolves.
function responseRows(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.data) ? result.data : [];
}

function newSubmissionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function submissionStorageKey(companyId) {
  return `pace-erp:bulk-do-submission:${companyId}`;
}

function safeStoredSubmission(companyId) {
  try {
    const value = window.sessionStorage.getItem(submissionStorageKey(companyId));
    if (!value) return null;
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Transporter Master return is intentionally a narrow refresh.  The original
// preview has already resolved FO/SO, SKU, allocation and quantity against a
// coherent snapshot.  Replacing that with a second full preview can turn a
// valid source reference into FO_SO_NOT_FOUND while the user is only trying
// to resolve the transporter.  Carry only the refreshed transporter decision.
function mergeTransporterRecheckRows(currentRows, refreshedRows) {
  const refreshedByIndex = new Map((refreshedRows ?? []).map((row) => [Number(row.row_index), row]));
  return (currentRows ?? []).map((row) => {
    const refreshed = refreshedByIndex.get(Number(row.row_index));
    if (!refreshed?.transporter_resolution) return row;
    return { ...row, transporter_resolution: refreshed.transporter_resolution };
  });
}

function rawUnresolvedTransporterRows(previewRows, rawByIndex, transporterName = "") {
  const targetName = normalizedTransporterName(transporterName);
  return (previewRows ?? [])
    .filter((row) => row.status === "RESOLVED" && row.transporter_resolution?.status !== "MATCHED")
    .map((row) => rawByIndex[row.row_index])
    .filter((row) => !targetName || normalizedTransporterName(row?.transporter_name) === targetName)
    .filter(Boolean);
}

// The raw codes mean nothing to the person reading the review grid.  Say
// what is wrong with the uploaded FO/SO and where to fix it.
const BULK_DO_SOURCE_ERROR_TEXT = {
  FO_SO_NOT_FOUND: "FO/SO not found — this FO is not mapped in SO Map, and no SO in this company has this SO Number or External SO Number",
  DO_BULK_EXTERNAL_SO_AMBIGUOUS: "More than one SO in this company has this External SO Number — use the PACE SO Number instead",
  FO_SO_NUMBER_REQUIRED: "FO/SO number is blank in the Excel",
  DO_BULK_VDC_MUST_USE_FO_NUMBER: "Dependent Direct SO — enter the FO number, not the SO number",
  DO_BULK_SO_WRONG_DISPATCH_TYPE: "This SO is not a Dependent Depot/Direct SO",
  DO_BULK_FO_NOT_MAPPED: "FO has no SO Map allocation yet",
};

// One primary issue per row, in the order a user has to fix them.  The review
// opens on "Needs action" so the rows that block a DO are in front of the
// user instead of hidden among hundreds of ready rows.
const BULK_DO_ISSUE_FILTERS = [
  { key: "NEEDS_ACTION", label: "Needs action" },
  { key: "SOURCE", label: "FO/SO not mapped" },
  { key: "TRANSPORTER", label: "Transporter" },
  { key: "SKU", label: "SKU" },
  { key: "LOCATION", label: "Storage location" },
  { key: "QTY", label: "Qty exceeds balance" },
  { key: "FIELDS", label: "Missing / invalid fields" },
  { key: "DUPLICATE", label: "Duplicates" },
  { key: "READY", label: "Ready" },
  { key: "ALL", label: "All rows" },
];

function bulkDoRowIssue(row) {
  if (row.review_duplicate_kind) return "DUPLICATE";
  if (row.status !== "RESOLVED") return "SOURCE";
  if (row.transporter_resolution?.status !== "MATCHED") return "TRANSPORTER";
  if (row.sku_resolution?.status !== "MATCHED") return "SKU";
  if (!row.storage_location?.id) return "LOCATION";
  if (row.qty_status === "EXCEEDS_BALANCE") return "QTY";
  if ((row.missing_required_fields ?? []).length > 0 || (row.format_errors ?? []).length > 0) return "FIELDS";
  return "READY";
}

function bulkDoIssueText(row) {
  switch (bulkDoRowIssue(row)) {
    case "DUPLICATE": return row.review_duplicate_kind === "ALREADY_CREATED" ? "Already created as DO — will be skipped" : "Repeated line in Excel — will be skipped";
    case "SOURCE": return BULK_DO_SOURCE_ERROR_TEXT[row.error_code] ?? row.error_code;
    case "TRANSPORTER": return row.transporter_resolution?.status === "AMBIGUOUS" ? "Choose the transporter" : "Transporter not in master";
    case "SKU": return "SKU not on this FO/SO — choose item";
    case "LOCATION": return "Choose storage location";
    case "QTY": return "Pack qty exceeds remaining balance";
    case "FIELDS": return `Fix: ${[...(row.missing_required_fields ?? []), ...(row.format_errors ?? [])].join(", ")}`;
    default: return "Ready";
  }
}

function excelRowLabel(rawByIndex, rowIndex) {
  return rawByIndex[rowIndex]?.excel_row ?? rowIndex;
}

function bulkDoReviewPriority(row) {
  // Historical/excel duplicates are informational and removable. They belong
  // below live work, while unresolved transporters must be immediately visible.
  if (row.review_duplicate_kind) return -10;
  // A transporter can be resolved immediately in this review. Put it before
  // quantity errors that may only be explainable after the original save has
  // been reconciled. Preserve source-row order for every equal priority.
  if (row.transporter_resolution?.status !== "MATCHED") return 30;
  if (row.status !== "RESOLVED") return 20;
  if (row.sku_resolution?.status !== "MATCHED" || !row.storage_location?.id) return 15;
  if ((row.missing_required_fields ?? []).length > 0 || (row.format_errors ?? []).length > 0) return 10;
  if (row.qty_status === "EXCEEDS_BALANCE") return 5;
  return 0;
}

function normalizedUploadKeyPart(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeUploadQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity.toFixed(6) : normalizedUploadKeyPart(value);
}

function deriveBulkDoReviewRows(rows, rawByIndex) {
  // The agreed spreadsheet identity is FO/SO + SKU + Pack Qty.  A repeated
  // physical line is removable from this upload; it does not alter any ERP DO.
  const withUploadDuplicates = markSpreadsheetDuplicates(rows, (row) => {
    const raw = rawByIndex[row.row_index] ?? {};
    return [raw.fo_or_so_number ?? row.fo_or_so_number, raw.sku, normalizeUploadQuantity(raw.pack_qty)].map(normalizedUploadKeyPart).join("::");
  });
  const rowsBySource = new Map();
  for (const row of withUploadDuplicates) {
    const key = normalizedUploadKeyPart(row.fo_or_so_number);
    rowsBySource.set(key, [...(rowsBySource.get(key) ?? []), row]);
  }
  const fullyDispatchedSources = new Map();
  for (const [key, groupRows] of rowsBySource.entries()) {
    const everyLineIsExhaustedByExistingDo = groupRows.length > 0 && groupRows.every((row) => (
      row.qty_status === "EXCEEDS_BALANCE"
      && Number(row.remaining_base_qty ?? 0) <= 0.0001
      && Array.isArray(row.existing_delivery_orders)
      && row.existing_delivery_orders.length > 0
    ));
    if (!everyLineIsExhaustedByExistingDo) continue;
    const references = [...new Set(groupRows.flatMap((row) => (row.existing_delivery_orders ?? []).map((entry) => String(entry.dc_number ?? "").trim()).filter(Boolean)))];
    fullyDispatchedSources.set(key, references);
  }
  return withUploadDuplicates.map((row) => {
    const existingDoNumbers = fullyDispatchedSources.get(normalizedUploadKeyPart(row.fo_or_so_number)) ?? [];
    const existingDeliveryOrderDuplicate = existingDoNumbers.length > 0;
    const reviewDuplicateKind = existingDeliveryOrderDuplicate ? "ALREADY_CREATED" : row.upload_duplicate ? "UPLOAD_DUPLICATE" : null;
    return {
      ...row,
      existing_do_numbers: existingDoNumbers,
      review_duplicate_kind: reviewDuplicateKind,
      is_removable_duplicate: Boolean(reviewDuplicateKind),
    };
  });
}

function normalizedTransporterName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}


export default function BulkDoUploadDrawer({ companyId, onClose, onSaved, initialDraft = null, onDraftRestored, onOpenTransporterMaster }) {
  const [rows, setRows] = useState(null);
  const [rawByIndex, setRawByIndex] = useState({});
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveResults, setSaveResults] = useState(null);
  const [submissionId, setSubmissionId] = useState("");
  const [submissionGroupKeys, setSubmissionGroupKeys] = useState({});
  const [submissionStarted, setSubmissionStarted] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [issueFilter, setIssueFilter] = useState(null);
  const [showReadyGroups, setShowReadyGroups] = useState(false);
  // The company a preview was built for is part of that preview's identity.
  // Re-checks, saves and session persistence must keep using it even if the
  // host page comes back (e.g. after Transporter Master) on another company.
  const [previewCompanyId, setPreviewCompanyId] = useState(() => initialDraft?.company_id || "");
  const activeCompanyId = previewCompanyId || companyId;
  const fileInputRef = useRef(null);
  const restoredDraftRef = useRef(false);

  function updateRaw(rowIndex, patch) {
    setRawByIndex((current) => ({ ...current, [rowIndex]: { ...current[rowIndex], ...patch } }));
  }
  function removeRows(rowIndexes) {
    const indexes = new Set(rowIndexes);
    const nextRows = (rows ?? []).filter((row) => !indexes.has(row.row_index));
    const nextRaw = Object.fromEntries(Object.entries(rawByIndex).filter(([rowIndex]) => !indexes.has(Number(rowIndex))));
    setRows(nextRows);
    setRawByIndex(nextRaw);
    persistSubmission({ rows: nextRows, rawByIndex: nextRaw });
  }
  function removeRow(rowIndex) {
    removeRows([rowIndex]);
  }

  const persistSubmission = useCallback((next = {}) => {
    const persistCompanyId = next.companyId ?? activeCompanyId;
    if (!persistCompanyId) return;
    try {
      const nextRows = next.rows ?? rows;
      const nextRaw = next.rawByIndex ?? rawByIndex;
      const nextSubmissionId = next.submissionId ?? submissionId;
      const nextGroupKeys = next.submissionGroupKeys ?? submissionGroupKeys;
      const nextSubmissionStarted = next.submissionStarted ?? submissionStarted;
      if (!nextSubmissionId || !Array.isArray(nextRows)) return;
      window.sessionStorage.setItem(submissionStorageKey(persistCompanyId), JSON.stringify({
        company_id: persistCompanyId,
        submission_id: nextSubmissionId,
        // A preview UUID is local-only.  It becomes reconciliation-eligible
        // only immediately before the first save request leaves the browser.
        submission_started: Boolean(nextSubmissionStarted),
        group_keys: nextGroupKeys,
        preview_rows: nextRows,
        raw_rows: Object.values(nextRaw),
      }));
    } catch {
      // Session persistence is a safety enhancement, not a reason to block
      // the user from completing a server-authoritative submission.
    }
  }, [activeCompanyId, rawByIndex, rows, submissionGroupKeys, submissionId, submissionStarted]);

  // Transporter picks and targeted re-checks change `rows` without passing
  // through an explicit persist call.  Keep the session copy in step so a
  // reload/back never resurrects the pre-resolution preview.
  useEffect(() => {
    if (submissionId && Array.isArray(rows)) persistSubmission();
  }, [persistSubmission, rows, submissionId]);

  const clearPersistedSubmission = useCallback(() => {
    try { window.sessionStorage.removeItem(submissionStorageKey(activeCompanyId)); } catch { /* no-op */ }
  }, [activeCompanyId]);

  const requestPreview = useCallback(async (parsedRows, previewCompany = activeCompanyId) => {
    const result = await previewDoBulkUpload({ company_id: previewCompany, rows: parsedRows });
    return responseRows(result);
  }, [activeCompanyId]);

  const runPreview = useCallback(async (parsedRows, previewCompany) => {
    const previewRows = await requestPreview(parsedRows, previewCompany);
    setRows(previewRows);
    return previewRows;
  }, [requestPreview]);

  const reconcileSubmission = useCallback(async (activeSubmissionId, activeGroupKeys, currentRows) => {
    if (!activeSubmissionId) return { created: 0, total: 0, groups: [] };
    const result = await getDoBulkSubmissionStatus({ company_id: activeCompanyId, submission_id: activeSubmissionId });
    const statusGroups = Array.isArray(result?.groups) ? result.groups : [];
    const byKey = new Map(statusGroups.map((group) => [group.client_group_key, group]));
    const createdGroups = new Set(statusGroups.filter((group) => group.status === "CREATED").map((group) => group.client_group_key));
    const createdReferences = new Set(statusGroups.filter((group) => group.status === "CREATED").map((group) => group.source_reference));
    const nextRows = (currentRows ?? []).filter((row) => {
      const groupKey = activeGroupKeys[row.fo_or_so_number];
      return !createdGroups.has(groupKey) && !createdReferences.has(row.fo_or_so_number);
    });
    const nextResults = statusGroups.map((group) => ({
      submission_group_key: group.client_group_key,
      fo_or_so_number: group.source_reference,
      status: group.status,
      dc_id: group.delivery_challan_id,
      error_code: group.error_code,
      attempt_count: group.attempt_count,
    }));
    Object.entries(activeGroupKeys)
      .filter(([, groupKey]) => !byKey.has(groupKey))
      .forEach(([sourceReference, groupKey]) => nextResults.push({
        submission_group_key: groupKey,
        fo_or_so_number: sourceReference,
        status: "NOT_STARTED",
      }));
    setRows(nextRows);
    setSaveResults(nextResults);
    persistSubmission({ rows: nextRows, submissionId: activeSubmissionId, submissionGroupKeys: activeGroupKeys });
    return { created: createdGroups.size, total: statusGroups.length, groups: statusGroups, nextRows };
  }, [activeCompanyId, persistSubmission]);

  // Returning from Transporter Master is navigation, not another upload. Keep
  // the already-resolved preview on screen immediately. If a transporter was
  // actually created while away, re-check only the unresolved transporter rows
  // and merge them back into the cached preview.
  useEffect(() => {
    const restoredRows = initialDraft?.raw_rows;
    if (restoredDraftRef.current || !Array.isArray(restoredRows) || restoredRows.length === 0) return;
    restoredDraftRef.current = true;
    const rawMap = {};
    restoredRows.forEach((row) => { rawMap[row.row_index] = row; });
    setRawByIndex(rawMap);
    setError("");
    // Keep the idempotency identity of this upload across the navigation.
    if (initialDraft?.submission_id) {
      setSubmissionId(initialDraft.submission_id);
      setSubmissionGroupKeys(initialDraft.group_keys ?? {});
      setSubmissionStarted(initialDraft.submission_started === true);
    }
    const cachedPreviewRows = Array.isArray(initialDraft?.preview_rows) ? initialDraft.preview_rows : [];
    if (cachedPreviewRows.length === 0) {
      // Compatibility for a draft created before preview caching existed.
      setUploading(true);
      void runPreview(restoredRows)
        .catch((restoreError) => setError(restoreError instanceof Error ? restoreError.message : "DO_BULK_PREVIEW_FAILED"))
        .finally(() => { setUploading(false); onDraftRestored?.(); });
      return;
    }

    setRows(cachedPreviewRows);
    const masterChanged = Number(initialDraft?.transporter_master_revision ?? 0) !== getTransporterMasterRevision();
    const pendingTransporterName = rawMap[initialDraft?.pending_transporter_row_index]?.transporter_name;
    const unresolvedRows = masterChanged
      ? rawUnresolvedTransporterRows(cachedPreviewRows, rawMap, pendingTransporterName)
      : [];
    if (unresolvedRows.length === 0) {
      onDraftRestored?.();
      return;
    }

    setValidating(true);
    void requestPreview(unresolvedRows)
      .then((refreshedRows) => setRows((currentRows) => mergeTransporterRecheckRows(currentRows, refreshedRows)))
      .catch((restoreError) => setError(restoreError instanceof Error ? restoreError.message : "DO_BULK_PREVIEW_FAILED"))
      .finally(() => { setValidating(false); onDraftRestored?.(); });
  }, [initialDraft, onDraftRestored, requestPreview, runPreview]);

  // A lost browser response must not turn into another Create click.  Restore
  // the exact submission identity, then ask the backend which groups actually
  // committed before re-enabling any action.
  useEffect(() => {
    if (initialDraft || restoredDraftRef.current) return;
    const saved = safeStoredSubmission(companyId);
    if (!saved?.submission_id || !Array.isArray(saved.preview_rows)) return;
    restoredDraftRef.current = true;
    const restoredRaw = {};
    (saved.raw_rows ?? []).forEach((row) => { restoredRaw[row.row_index] = row; });
    setRawByIndex(restoredRaw);
    setPreviewCompanyId(saved.company_id || companyId);
    setRows(saved.preview_rows);
    setSubmissionId(saved.submission_id);
    setSubmissionGroupKeys(saved.group_keys ?? {});
    setSubmissionStarted(saved.submission_started === true);
    // Older drawer versions persisted a UUID immediately after preview.
    // That UUID has no server row yet, so it must be restored as a normal
    // preview, not sent to the submission-status endpoint.
    if (saved.submission_started !== true) {
      setNotice("Restored the unsubmitted Bulk DO upload.");
      return;
    }
    setReconciling(true);
    void reconcileSubmission(saved.submission_id, saved.group_keys ?? {}, saved.preview_rows)
      .then((outcome) => setNotice(`${outcome.created} created group(s) reconciled from the previous submission.`))
      .catch((reconcileError) => {
        if (reconcileError?.code === "DO_BULK_SUBMISSION_NOT_FOUND") {
          clearPersistedSubmission();
          setSubmissionStarted(false);
          setNotice("Restored the unsubmitted Bulk DO upload. No Delivery Order was created by the previous preview.");
          return;
        }
        setError("This Bulk DO submission needs reconciliation. Do not create it again until the status check succeeds.");
      })
      .finally(() => setReconciling(false));
  }, [clearPersistedSubmission, companyId, initialDraft, reconcileSubmission]);

  async function handleFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setNotice(""); setSaveResults(null); setUploading(true);
    try {
      const parsedRows = await parseUploadedWorkbook(file);
      if (parsedRows.length === 0) { setError("The uploaded file has no data rows."); return; }
      const rawMap = {};
      parsedRows.forEach((row) => { rawMap[row.row_index] = row; });
      setRawByIndex(rawMap);
      setPreviewCompanyId(companyId);
      const previewRows = await runPreview(parsedRows, companyId);
      const nextSubmissionId = newSubmissionId();
      setSubmissionId(nextSubmissionId);
      setSubmissionGroupKeys({});
      setSubmissionStarted(false);
      persistSubmission({ companyId, rows: previewRows, rawByIndex: rawMap, submissionId: nextSubmissionId, submissionGroupKeys: {}, submissionStarted: false });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "DO_BULK_PREVIEW_FAILED");
    } finally {
      setUploading(false);
    }
  }

  async function handleRevalidate() {
    if (!rows) return;
    setValidating(true); setError("");
    try {
      const unresolvedRows = rawUnresolvedTransporterRows(rows, rawByIndex);
      if (unresolvedRows.length === 0) {
        setNotice("No unresolved transporter rows need re-checking.");
        return;
      }
      const refreshedRows = await requestPreview(unresolvedRows);
      setRows((currentRows) => mergeTransporterRecheckRows(currentRows, refreshedRows));
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "DO_BULK_PREVIEW_FAILED");
    } finally {
      setValidating(false);
    }
  }

  function chooseSku(rowIndex, soLineId, allocationId) {
    setRows((current) => (current ?? []).map((row) => (row.row_index === rowIndex
      ? { ...row, sku_resolution: { status: "MATCHED", so_line_id: soLineId, so_map_allocation_id: allocationId ?? null } }
      : row)));
  }
  function chooseTransporter(rowIndex, transporterId) {
    const selectedName = normalizedTransporterName(rawByIndex[rowIndex]?.transporter_name);
    setRows((current) => (current ?? []).map((row) => (row.row_index === rowIndex
      || (selectedName && normalizedTransporterName(rawByIndex[row.row_index]?.transporter_name) === selectedName)
      ? { ...row, transporter_resolution: { status: "MATCHED", transporter_id: transporterId } }
      : row)));
  }

  function openTransporterMaster(row) {
    const rawRows = Object.values(rawByIndex).sort((left, right) => Number(left.row_index) - Number(right.row_index));
    onOpenTransporterMaster?.({
      company_id: activeCompanyId,
      submission_id: submissionId,
      group_keys: submissionGroupKeys,
      submission_started: submissionStarted,
      raw_rows: rawRows,
      preview_rows: rows ?? [],
      transporter_master_revision: getTransporterMasterRevision(),
      pending_transporter_row_index: row.row_index,
      transporter_name: rawByIndex[row.row_index]?.transporter_name || "",
    });
  }

  // One Delivery Order per (fo_or_so_number) group — §6 point 14/17. Header
  // fields (DO Date/LR/Transporter/Truck/Dispatch/Tally) are repeated on
  // every row of the same group in the source Excel; the first row's raw
  // values are used as the group's header.
  const reviewedRowsWithDuplicates = useMemo(
    () => deriveBulkDoReviewRows(rows, rawByIndex),
    [rawByIndex, rows],
  );
  const removableDuplicateRows = useMemo(
    () => reviewedRowsWithDuplicates.filter((row) => row.is_removable_duplicate),
    [reviewedRowsWithDuplicates],
  );
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const row of reviewedRowsWithDuplicates) {
      if (row.is_removable_duplicate) continue;
      if (row.status !== "RESOLVED") continue;
      const raw = rawByIndex[row.row_index] ?? {};
      const key = row.fo_or_so_number;
      if (!byKey.has(key)) byKey.set(key, { fo_or_so_number: key, dd_flag: row.dd_flag, so_id: row.so_id, raw, rows: [] });
      byKey.get(key).rows.push(row);
    }
    return [...byKey.values()];
  }, [rawByIndex, reviewedRowsWithDuplicates]);

  function groupReadiness(group) {
    const problems = [];
    const raw = group.raw;
    if (!raw.do_date) problems.push("DO Date");
    if (!raw.transporter_name) problems.push("Transporter");
    if (!raw.lr_number) problems.push("LR Number");
    if (!raw.lr_date) problems.push("LR Date");
    if (!group.dd_flag) {
      if (!raw.truck_number) problems.push("Truck Number (DC mandatory)");
      if (!raw.dispatch_date) problems.push("Dispatch Date (DC mandatory)");
    }
    for (const row of group.rows) {
      if (row.transporter_resolution?.status !== "MATCHED") problems.push(`Row ${row.row_index}: Transporter not resolved`);
      if (row.sku_resolution?.status !== "MATCHED") problems.push(`Row ${row.row_index}: SKU not resolved`);
      if (!row.storage_location?.id) problems.push(`Row ${row.row_index}: Storage Location not resolved`);
      if (row.qty_status === "EXCEEDS_BALANCE") problems.push(`Row ${row.row_index}: exceeds remaining balance`);
      if ((row.format_errors ?? []).length) problems.push(`Row ${row.row_index}: ${row.format_errors.join(", ")}`);
    }
    return problems;
  }

  async function handleSaveAll() {
    if (saving || reconciling) return;
    const activeSubmissionId = submissionId || newSubmissionId();
    setSaving(true); setError(""); setNotice(""); setSaveResults(null);
    try {
      const nextGroupKeys = { ...submissionGroupKeys };
      groups.forEach((group) => {
        if (!nextGroupKeys[group.fo_or_so_number]) nextGroupKeys[group.fo_or_so_number] = newSubmissionId();
      });
      setSubmissionId(activeSubmissionId);
      setSubmissionGroupKeys(nextGroupKeys);
      const payloadGroups = groups
        .filter((group) => groupReadiness(group).length === 0)
        .map((group) => {
          const first = group.rows[0];
          const raw = group.raw;
          return {
            submission_group_key: nextGroupKeys[group.fo_or_so_number],
            fo_or_so_number: group.fo_or_so_number,
            dd_flag: group.dd_flag,
            so_id: group.so_id,
            do_date: raw.do_date || undefined,
            transporter_id: first.transporter_resolution?.transporter_id,
            lr_number: raw.lr_number,
            lr_date: raw.lr_date,
            truck_number: raw.truck_number || undefined,
            dispatch_date: raw.dispatch_date || undefined,
            tally_invoice_number: raw.tally_invoice_number || undefined,
            tally_invoice_date: raw.tally_invoice_date || undefined,
            inbound_number: raw.inbound_number || undefined,
            rows: group.rows.map((row) => ({
              so_line_id: row.sku_resolution.so_line_id,
              so_map_allocation_id: row.sku_resolution.so_map_allocation_id || undefined,
              base_qty: row.base_qty,
              storage_location_id: row.storage_location.id,
            })),
          };
        });
      if (payloadGroups.length === 0) { setError("No group is fully ready to save yet."); return; }
      setSubmissionStarted(true);
      persistSubmission({ submissionId: activeSubmissionId, submissionGroupKeys: nextGroupKeys, submissionStarted: true });
      const result = await saveDoBulkUpload({ company_id: activeCompanyId, submission_id: activeSubmissionId, groups: payloadGroups });
      const resultRows = responseRows(result);
      setSaveResults(resultRows);
      const createdCount = resultRows.filter((row) => row.status === "CREATED").length;
      const createdReferences = new Set(resultRows.filter((row) => row.status === "CREATED").map((row) => row.fo_or_so_number));
      const remainingRows = (rows ?? []).filter((row) => !createdReferences.has(row.fo_or_so_number));
      setRows(remainingRows);
      persistSubmission({ rows: remainingRows, submissionId: activeSubmissionId, submissionGroupKeys: nextGroupKeys });
      const failureCount = resultRows.length - createdCount;
      setNotice(failureCount === 0
        ? `${createdCount} Delivery Order(s) created and reconciled.`
        : `${createdCount} created; ${failureCount} failed. Only failed or unresolved groups remain eligible for retry.`);
      if (createdCount > 0) await onSaved?.();
      if (remainingRows.length === 0 && failureCount === 0) {
        clearPersistedSubmission();
        onClose?.();
      }
    } catch (saveError) {
      if (activeSubmissionId) {
        setReconciling(true);
        try {
          const outcome = await reconcileSubmission(activeSubmissionId, submissionGroupKeys, rows);
          setError(`The save response was interrupted. ${outcome.created} group(s) are confirmed created; only unresolved groups may be retried.`);
        } catch {
          setError("The save outcome is unknown. Do not retry yet; keep this drawer open or reopen it to reconcile the saved submission.");
        } finally {
          setReconciling(false);
        }
      } else {
        setError(saveError instanceof Error ? saveError.message : "DO_BULK_SAVE_FAILED");
      }
    } finally {
      setSaving(false);
    }
  }

  const readyGroupCount = groups.filter((group) => groupReadiness(group).length === 0).length;
  // Priority order is decided once per row set (upload, duplicate removal,
  // save).  Picking a transporter must not reshuffle the grid: doing so
  // pulled genuinely unresolved FO/SO rows from below the fold to the top,
  // which looked as if the already-resolved rows had been wiped.
  const reviewMembershipKey = useMemo(
    () => reviewedRowsWithDuplicates.map((row) => row.row_index).join(","),
    [reviewedRowsWithDuplicates],
  );
  const [frozenReviewOrder, setFrozenReviewOrder] = useState({ key: null, order: [] });
  if (frozenReviewOrder.key !== reviewMembershipKey) {
    setFrozenReviewOrder({
      key: reviewMembershipKey,
      order: prioritizeUploadReviewRows(reviewedRowsWithDuplicates, bulkDoReviewPriority).map((row) => row.row_index),
    });
  }
  const reviewRows = useMemo(() => {
    const position = new Map(frozenReviewOrder.order.map((rowIndex, index) => [rowIndex, index]));
    return [...reviewedRowsWithDuplicates].sort((left, right) => (
      (position.get(left.row_index) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.row_index) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [frozenReviewOrder, reviewedRowsWithDuplicates]);
  const unresolvedSources = useMemo(
    () => summarizeUnresolvedSources(reviewedRowsWithDuplicates, rawByIndex),
    [rawByIndex, reviewedRowsWithDuplicates],
  );
  const issueCounts = useMemo(() => {
    const counts = Object.fromEntries(BULK_DO_ISSUE_FILTERS.map((filter) => [filter.key, 0]));
    for (const row of reviewRows) {
      const issue = bulkDoRowIssue(row);
      counts[issue] += 1;
      counts.ALL += 1;
      if (issue !== "READY" && issue !== "DUPLICATE") counts.NEEDS_ACTION += 1;
    }
    return counts;
  }, [reviewRows]);
  // Until the user picks a view, open on the rows that need work.
  const activeIssueFilter = issueFilter ?? (issueCounts.NEEDS_ACTION > 0 ? "NEEDS_ACTION" : "ALL");
  const visibleReviewRows = useMemo(() => reviewRows.filter((row) => {
    if (activeIssueFilter === "ALL") return true;
    const issue = bulkDoRowIssue(row);
    if (activeIssueFilter === "NEEDS_ACTION") return issue !== "READY" && issue !== "DUPLICATE";
    return issue === activeIssueFilter;
  }), [activeIssueFilter, reviewRows]);

  return (
    <DrawerBase
      visible
      title="Bulk DO Upload"
      onEscape={onClose}
      onClose={onClose}
      width="min(1300px, calc(100vw - 24px))"
      actions={
        <button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950">Done</button>
      }
    >
      <div className="grid gap-3">
        {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</div> : null}
        <p className="text-xs text-slate-600">
          One column takes either an FO Number (VDC rows — resolved against this SO's already-mapped SO Map allocation) or an SO Number / External SO Number (DC rows — Customer/Site resolution not required). Each distinct FO/SO Number becomes one Delivery Order.
        </p>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void downloadTemplate()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Download Template</button>
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">
            {uploading ? "Uploading…" : "Upload Excel"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void handleFileChosen(event)} />
          {rows ? (
            <button type="button" disabled={validating} onClick={() => void handleRevalidate()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50">
              {validating ? "Re-checking…" : "Re-check unresolved transporters"}
            </button>
          ) : null}
          {removableDuplicateRows.length ? (
            <button type="button" onClick={() => removeRows(removableDuplicateRows.map((row) => row.row_index))} className="border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">
              Remove {removableDuplicateRows.length} duplicate row(s)
            </button>
          ) : null}
        </div>

        {rows ? (
          <>
            <div className="grid gap-2 border border-slate-300 bg-slate-50 p-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-semibold text-slate-800">{issueCounts.ALL} row(s) uploaded</span>
                <span className="font-semibold text-emerald-800">{issueCounts.READY} ready</span>
                <span className={issueCounts.NEEDS_ACTION ? "font-semibold text-rose-700" : "text-slate-500"}>{issueCounts.NEEDS_ACTION} need action</span>
                <span className="font-semibold text-sky-900">{readyGroupCount} of {groups.length} Delivery Order(s) ready</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {BULK_DO_ISSUE_FILTERS.filter((filter) => ["NEEDS_ACTION", "READY", "ALL"].includes(filter.key) || issueCounts[filter.key] > 0).map((filter) => {
                  const active = activeIssueFilter === filter.key;
                  const problem = !["READY", "ALL", "DUPLICATE"].includes(filter.key) && issueCounts[filter.key] > 0;
                  const tone = active
                    ? "border-sky-700 bg-sky-700 text-white"
                    : problem ? "border-rose-300 bg-white text-rose-800" : "border-slate-300 bg-white text-slate-700";
                  const label = filter.key === "SOURCE" ? `${filter.label} (${unresolvedSources.length} FO/SO · ${issueCounts.SOURCE} rows)` : `${filter.label} (${issueCounts[filter.key]})`;
                  return (
                    <button key={filter.key} type="button" onClick={() => setIssueFilter(filter.key)} className={`border px-2 py-1 text-[11px] font-semibold ${tone}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeIssueFilter === "SOURCE" ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                  <span>These FO/SO numbers from your Excel are not mapped in SO Map (or the SO does not exist in this company). Map them in SO Map, then upload the exported &quot;Rows to re-upload&quot; sheet. All other ready rows can be created now.</span>
                  <button type="button" onClick={() => void exportUnresolvedSources(unresolvedSources, rawByIndex)} className="border border-emerald-600 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">Export Excel</button>
                </div>
                <ErpDenseGrid
                  cellNavigate
                  maxHeight="520px"
                  columns={[
                    { key: "fo_or_so_number", label: "FO/SO Number", width: "130px" },
                    { key: "reason", label: "Reason", width: "360px" },
                    { key: "excel_rows", label: "Excel Row No.", width: "160px" },
                    { key: "row_count", label: "Rows", width: "60px", align: "right" },
                    { key: "skus", label: "SKUs", width: "220px" },
                    { key: "pack_qty", label: "Total Pack Qty", width: "110px", align: "right" },
                    { key: "do_dates", label: "DO Dates", width: "140px" },
                    { key: "lr_numbers", label: "LR Numbers", width: "140px" },
                  ]}
                  rows={unresolvedSources}
                  rowKey={(row) => row.fo_or_so_number}
                  emptyMessage="No unmapped FO/SO."
                />
              </div>
            ) : (
            <ErpDenseGrid
              cellNavigate
              maxHeight="520px"
              columns={[
                { key: "excel_row", label: "Excel Row", width: "80px", align: "right", render: (row) => excelRowLabel(rawByIndex, row.row_index) },
                {
                  key: "issue", label: "Issue", width: "240px", render: (row) => {
                    const issue = bulkDoRowIssue(row);
                    const tone = issue === "READY" ? "text-emerald-800" : issue === "DUPLICATE" ? "text-amber-800" : "font-semibold text-rose-700";
                    return <span title={row.error_code || ""} className={tone}>{bulkDoIssueText(row)}</span>;
                  },
                },
                { key: "fo_or_so", label: "FO/SO Number", width: "130px", render: (row) => row.fo_or_so_number },
                { key: "dd_flag", label: "DD Flag", width: "80px", render: (row) => row.status === "RESOLVED" ? (row.dd_flag ? "Yes" : "No") : "—" },
                { key: "so_number", label: "SO Number", width: "120px", render: (row) => row.so_number || "—" },
                { key: "do_date", label: "DO Date", width: "115px", render: (row) => rawByIndex[row.row_index]?.do_date || "—" },
                {
                  key: "status", label: "Status", width: "320px", render: (row) => {
                    if (row.review_duplicate_kind === "ALREADY_CREATED") return <span className="font-semibold text-amber-800">Already created: {row.existing_do_numbers.join(", ")}</span>;
                    if (row.review_duplicate_kind === "UPLOAD_DUPLICATE") return <span className="font-semibold text-amber-800">Duplicate of Excel row {excelRowLabel(rawByIndex, row.upload_duplicate_of)}</span>;
                    if (row.status === "ERROR") return <span title={row.error_code} className="font-semibold text-rose-700">{BULK_DO_SOURCE_ERROR_TEXT[row.error_code] ?? row.error_code}</span>;
                    return <span className="text-emerald-800">Resolved</span>;
                  },
                },
                { key: "sku", label: "SKU", width: "90px", render: (row) => rawByIndex[row.row_index]?.sku || "—" },
                {
                  key: "sku_status", label: "SKU Resolve", width: "160px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-slate-400">—</span>;
                    if (row.sku_resolution?.status === "MATCHED") return <span className="text-emerald-800">Matched</span>;
                    return (
                      <select className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]" defaultValue=""
                        onChange={(event) => {
                          const candidate = (row.sku_resolution?.candidates ?? []).find((c) => String(c.so_line_id) === event.target.value);
                          chooseSku(row.row_index, event.target.value, candidate?.allocation_id);
                        }}>
                        <option value="">Choose item…</option>
                        {(row.sku_resolution?.candidates ?? []).map((candidate) => (
                          <option key={candidate.so_line_id ?? candidate.allocation_id} value={candidate.so_line_id}>{candidate.display}</option>
                        ))}
                      </select>
                    );
                  },
                },
                { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right", render: (row) => rawByIndex[row.row_index]?.pack_qty ?? "—" },
                { key: "base_qty", label: "Base Qty", width: "90px", align: "right", render: (row) => (row.base_qty != null ? Number(row.base_qty).toFixed(4) : "—") },
                {
                  key: "qty_status", label: "Qty Check", width: "110px", render: (row) => row.qty_status === "EXCEEDS_BALANCE"
                    ? <span className="font-semibold text-rose-700">Exceeds balance</span>
                    : row.status === "RESOLVED" ? <span className="text-emerald-800">OK</span> : <span className="text-slate-400">—</span>,
                },
                {
                  key: "storage_location", label: "Storage Location", width: "200px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-slate-400">—</span>;
                    const resolved = row.storage_location;
                    const options = row.storage_location_candidates ?? [];
                    return (
                      <div className="grid gap-1">
                        {resolved?.id ? (
                          <span className="text-emerald-800">{resolved.code} — {resolved.name}</span>
                        ) : (
                          <span className="font-semibold text-rose-700">Not found</span>
                        )}
                        <select
                          value={rawByIndex[row.row_index]?.storage_location_code || ""}
                          onChange={(event) => updateRaw(row.row_index, { storage_location_code: event.target.value })}
                          className="h-6 border border-slate-300 bg-[#fffef7] px-1 text-[11px]"
                        >
                          <option value="">Choose F-location…</option>
                          {options.map((option) => <option key={option.id} value={option.code}>{option.code} — {option.name}</option>)}
                        </select>
                      </div>
                    );
                  },
                },
                {
                  key: "transporter", label: "Transporter", width: "260px", render: (row) => {
                    if (row.status !== "RESOLVED") return <span className="text-slate-400">—</span>;
                    const resolution = row.transporter_resolution;
                    if (resolution?.status === "MATCHED") return <span className="text-emerald-800">Resolved</span>;
                    const uploadedTransporter = rawByIndex[row.row_index]?.transporter_name || "—";
                    if (resolution?.status === "AMBIGUOUS") {
                      return (
                        <div className="grid gap-1">
                          <span title={uploadedTransporter} className="truncate text-[10px] text-slate-500">Excel: {uploadedTransporter}</span>
                          <select className="h-7 border border-amber-400 bg-amber-50 px-1 text-[11px]" defaultValue=""
                            onChange={(event) => chooseTransporter(row.row_index, event.target.value)}>
                            <option value="">Choose from {resolution.candidates?.length ?? 0}…</option>
                            {(resolution.candidates ?? []).map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{candidate.transporter_code} — {candidate.transporter_name}</option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    return <div className="grid gap-1"><span title={uploadedTransporter} className="truncate text-[10px] text-slate-500">Excel: {uploadedTransporter}</span><button type="button" onClick={() => openTransporterMaster(row)} className="border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800">Not found — Open Transporter Master</button></div>;
                  },
                },
                { key: "lr_number", label: "LR Number", width: "135px", render: (row) => rawByIndex[row.row_index]?.lr_number || "—" },
                { key: "lr_date", label: "LR Date", width: "115px", render: (row) => rawByIndex[row.row_index]?.lr_date || "—" },
                { key: "truck_number", label: "Truck Number", width: "135px", render: (row) => rawByIndex[row.row_index]?.truck_number || "—" },
                { key: "dispatch_date", label: "Dispatch Date", width: "125px", render: (row) => rawByIndex[row.row_index]?.dispatch_date || "—" },
                {
                  key: "missing", label: "Missing", width: "180px", render: (row) => row.status === "RESOLVED" && (row.missing_required_fields ?? []).length > 0
                    ? <span className="font-semibold text-amber-700">{[...(row.missing_required_fields ?? []), ...(row.format_errors ?? [])].join(", ")}</span>
                    : (row.format_errors ?? []).length > 0
                      ? <span className="font-semibold text-rose-700">{row.format_errors.join(", ")}</span>
                    : <span className="text-slate-400">—</span>,
                },
                {
                  key: "actions", label: "", width: "70px", render: (row) => (
                    <button type="button" onClick={() => removeRow(row.row_index)} className="border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700">Remove</button>
                  ),
                },
              ]}
              rows={visibleReviewRows}
              rowKey={(row) => row.row_index}
              getRowProps={(row) => row.review_duplicate_kind ? { className: "bg-slate-100 text-slate-500" } : {}}
              emptyMessage={activeIssueFilter === "NEEDS_ACTION" ? "Nothing needs action — every remaining row is ready." : "No rows in this view."}
            />
            )}

            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Delivery Orders to be created — {readyGroupCount} ready, {groups.length - readyGroupCount} not ready
              </h4>
              <ul className="grid max-h-60 gap-1 overflow-auto text-xs text-slate-700">
                {groups.map((group) => ({ group, problems: groupReadiness(group) }))
                  .filter(({ problems }) => problems.length > 0 || showReadyGroups)
                  .sort((left, right) => Number(right.problems.length > 0) - Number(left.problems.length > 0))
                  .map(({ group, problems }) => (
                    <li key={group.fo_or_so_number} className={problems.length ? "text-rose-700" : "text-emerald-800"}>
                      {group.fo_or_so_number} ({group.dd_flag ? "VDC" : "DC"}, {group.rows.length} line(s)) — {problems.length ? `Not ready: ${problems.join("; ")}` : "Ready"}
                    </li>
                  ))}
              </ul>
              {readyGroupCount > 0 ? (
                <button type="button" onClick={() => setShowReadyGroups((current) => !current)} className="mt-1 text-[11px] font-semibold text-sky-800 underline">
                  {showReadyGroups ? "Hide" : "Show"} {readyGroupCount} ready Delivery Order(s)
                </button>
              ) : null}
            </div>

            <button type="button" disabled={saving || reconciling || readyGroupCount === 0} onClick={() => void handleSaveAll()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {reconciling ? "Reconciling…" : saving ? "Saving…" : `Create ${readyGroupCount} Delivery Order(s)`}
            </button>

            {saveResults ? (
              <ul className="grid gap-1 text-xs">
                {saveResults.map((result) => (
                  <li key={result.submission_group_key ?? result.fo_or_so_number} className={result.status === "CREATED" ? "text-emerald-800" : result.status === "PROCESSING" ? "text-amber-700" : "text-rose-700"}>
                    {result.fo_or_so_number}: {result.status === "CREATED" ? `Created (DO ${result.dc_id})` : result.status === "NOT_STARTED" ? "Not started — safe to submit" : result.status === "PROCESSING" ? "Processing — reconcile before retry" : result.error_code || result.status}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </DrawerBase>
  );
}
