/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DraftSoExcelUploadPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §4.2-§4.4 (FG-STO-MTS-DISPATCH-DESIGN-DOC.md) — "Draft SO and
 *          Excel Upload" page: lists every is_excel_upload=true Draft SO,
 *          offers a blank Excel template download, parses an uploaded
 *          workbook client-side, reviews it (stale-SO check, SKU
 *          resolution, AC05 rate cross-check, duplicate detection) in a
 *          center drawer, and submits the reviewed batch. "Enter SO" opens
 *          SO01CreatePage directly at Page 2 to confirm a Draft SO.
 * Authority: Frontend
 */

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { listDraftExcelUploadSalesOrders, reviewSoExcelUploadBatch, submitSoExcelUploadBatch } from "../procurementApi.js";

const FG_TYPE_CHOICES = ["MTO", "HPS", "MTEST", "MTS"];
const RATE_BASIS_CHOICES = ["PACK_UOM", "BASE_UOM"];
const GST_TREATMENT_CHOICES = ["EXCLUSIVE", "INCLUSIVE"];
const TEMPLATE_HEADERS = [
  "SO Number", "External SO Number", "FG Type", "SKU", "HSN",
  "Pack Qty", "Rate", "Rate Basis", "GST Treatment", "GST %",
];

const DRAFT_LIST_COLUMNS = [
  { key: "vendor_code_display", label: "Vendor Code", width: "160px", render: (row) => row.vendor_code_display || "—" },
  { key: "so_number", label: "SO Number", width: "130px" },
  { key: "customer_po_number", label: "External SO Number", width: "160px", render: (row) => row.customer_po_number || "—" },
  { key: "so_date", label: "SO Date", width: "110px" },
  { key: "parent_company_display", label: "Parent Company", width: "200px", render: (row) => row.parent_company_display || "—" },
  { key: "depot_code_display", label: "VDC / DC", width: "180px", render: (row) => row.depot_code_display || "—" },
  { key: "status", label: "Status", width: "90px" },
  { key: "excel_uploaded", label: "Excel Uploaded", width: "110px", render: (row) => (row.excel_uploaded ? "YES" : "NO") },
  { key: "total_items", label: "Total Items", width: "100px", align: "right" },
  { key: "total_packs", label: "Total Packs", width: "110px", align: "right", render: (row) => Number(row.total_packs ?? 0).toFixed(2) },
];

async function buildTemplateWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("SO Excel Upload");
  sheet.addRow(TEMPLATE_HEADERS);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  const lastRow = 500;
  const dvColumn = (columnIndex, choices) => {
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
      sheet.getCell(rowNumber, columnIndex).dataValidation = {
        type: "list", allowBlank: true, formulae: [`"${choices.join(",")}"`],
      };
    }
  };
  dvColumn(3, FG_TYPE_CHOICES);
  dvColumn(8, RATE_BASIS_CHOICES);
  dvColumn(9, GST_TREATMENT_CHOICES);
  sheet.columns.forEach((column) => { column.width = 18; });
  return workbook;
}

async function downloadTemplate() {
  const workbook = await buildTemplateWorkbook();
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "so01_excel_upload_template.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

async function parseUploadedWorkbook(file) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows = [];
  let rowKeySeq = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (index) => {
      const value = row.getCell(index).value;
      if (value == null) return "";
      if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
      return String(value).trim();
    };
    const soNumber = cell(1);
    if (!soNumber) return;
    rowKeySeq += 1;
    rows.push({
      row_key: `row-${rowKeySeq}-${soNumber}`,
      so_number: soNumber,
      external_so_number: cell(2),
      fg_type: cell(3).toUpperCase(),
      sku: cell(4),
      hsn_code: cell(5),
      pack_qty: cell(6),
      rate: cell(7),
      rate_basis: cell(8).toUpperCase(),
      gst_treatment: cell(9).toUpperCase(),
      gst_rate: cell(10),
    });
  });
  return rows;
}

export default function DraftSoExcelUploadPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewRows, setReviewRows] = useState(null);
  const fileInputRef = useRef(null);

  const draftQuery = useQuery({
    queryKey: ["procurement", "sales-orders", "draft-excel-upload", effectiveCompanyId],
    queryFn: () => listDraftExcelUploadSalesOrders({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
  });
  const rows = useMemo(() => (Array.isArray(draftQuery.data?.items) ? draftQuery.data.items : []), [draftQuery.data]);
  const loading = draftQuery.isLoading;

  function openEnterSo(row) {
    openScreenWithContext(OPERATION_SCREENS.PROC_SO_CREATE.screen_code, {
      enterDraftSoId: row.id, refreshOnReturn: true,
    });
  }

  function handleExport() {
    if (rows.length === 0) return;
    downloadCsvFile({
      fileName: `draft_so_excel_upload_${effectiveCompanyId || "all"}.csv`,
      columns: DRAFT_LIST_COLUMNS.map(({ key, label }) => ({ key, label })),
      rows: rows.map((row) => ({ ...row, excel_uploaded: row.excel_uploaded ? "YES" : "NO" })),
    });
  }

  async function handleFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setNotice(""); setUploading(true);
    try {
      const parsedRows = await parseUploadedWorkbook(file);
      if (parsedRows.length === 0) {
        setError("The uploaded file has no data rows.");
        return;
      }
      const result = await reviewSoExcelUploadBatch({ company_id: effectiveCompanyId, rows: parsedRows });
      setReviewRows(Array.isArray(result?.rows) ? result.rows : []);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "SO_EXCEL_UPLOAD_PARSE_FAILED");
    } finally {
      setUploading(false);
    }
  }

  function removeReviewRow(rowKey) {
    setReviewRows((current) => (current ?? []).filter((row) => row.row_key !== rowKey));
  }

  function chooseRate(rowKey, rate) {
    setReviewRows((current) => (current ?? []).map((row) => (row.row_key === rowKey ? { ...row, rate, ac05_rate_match: true } : row)));
  }

  function addManualReviewRow() {
    const existingSoNumbers = [...new Set((reviewRows ?? []).map((row) => row.so_number))];
    const firstSoNumber = existingSoNumbers[0] || "";
    setReviewRows((current) => [...(current ?? []), {
      row_key: `manual-${Date.now()}`, so_number: firstSoNumber, external_so_number: "", fg_type: "MTS",
      sku: "", hsn_code: "", pack_qty: "", rate: "", rate_basis: "BASE_UOM", gst_treatment: "EXCLUSIVE", gst_rate: "",
      material_id: null, manual_sku_name: "", document_name: null, pack_uom_code: null, base_uom_code: null,
      per_pack_qty: null, base_qty: 0, ac05_rate: null, ac05_rate_match: null, taxable_value: 0, gst_amount: 0,
      cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_value: 0, skip_reason: null, is_duplicate: false,
      __manualAdd: true, so_id: null,
    }]);
  }

  const hasUnresolvedDuplicate = (reviewRows ?? []).some((row) => row.is_duplicate && !row.skip_reason);
  const submittableCount = (reviewRows ?? []).filter((row) => !row.skip_reason).length;

  async function handleSubmitReview() {
    setError(""); setNotice(""); setSubmitting(true);
    try {
      const submittableRows = (reviewRows ?? []).filter((row) => !row.skip_reason);
      const result = await submitSoExcelUploadBatch({ company_id: effectiveCompanyId, rows: submittableRows });
      const skippedCount = (result?.rows ?? []).filter((row) => row.skipped).length;
      const savedCount = (result?.rows ?? []).length - skippedCount;
      setNotice(`${savedCount} line(s) saved${skippedCount ? `, ${skippedCount} skipped — resolve in Enter SO` : ""}.`);
      setReviewRows(null);
      queryClient.invalidateQueries({ queryKey: ["procurement", "sales-orders", "draft-excel-upload"] });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "SO_EXCEL_SUBMIT_FAILED");
    } finally {
      setSubmitting(false);
    }
  }

  function reviewRowClassName(row) {
    if (row.skip_reason) return "bg-slate-100 text-slate-400";
    if (row.is_duplicate) return "bg-rose-50";
    return undefined;
  }

  return (
    <>
      <ErpMasterListTemplate
        eyebrow="Procurement"
        title="Draft SO and Excel Upload"
        actions={[
          { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => draftQuery.refetch() },
          { key: "template", label: "Template Download", tone: "neutral", onClick: () => void downloadTemplate() },
          { key: "upload", label: uploading ? "Parsing..." : "Upload", tone: "primary", disabled: uploading || !effectiveCompanyId, onClick: () => fileInputRef.current?.click() },
          { key: "export", label: "Export Excel", tone: "neutral", onClick: handleExport, disabled: rows.length === 0 },
        ]}
        notices={[
          ...(error ? [{ key: "draft-so-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "draft-so-notice", tone: "success", message: notice }] : []),
          ...(draftQuery.error ? [{ key: "draft-so-list-error", tone: "error", message: draftQuery.error instanceof Error ? draftQuery.error.message : "SO_DRAFT_LIST_FAILED" }] : []),
        ]}
        filterSection={{
          eyebrow: "Company",
          title: "Only Excel-Upload Draft SOs — confirmed SOs disappear from this list",
          children: (
            <div className="grid gap-3 xl:grid-cols-[220px]">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" hint="" />
              <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void handleFileChosen(event)} />
            </div>
          ),
        }}
        listSection={{
          eyebrow: "Draft SO Register",
          title: loading ? "Loading draft sales orders" : `${rows.length} draft sales order row${rows.length === 1 ? "" : "s"}`,
          children: !effectiveCompanyId ? (
            <p className="text-slate-400 text-sm py-6 text-center">Select a company to view draft sales orders.</p>
          ) : (
            <ErpDenseGrid
              columns={[
                ...DRAFT_LIST_COLUMNS,
                { key: "actions", label: "", width: "110px", render: (row) => (
                  <button type="button" onClick={() => openEnterSo(row)} className="border border-sky-700 bg-sky-100 px-3 py-1 text-[11px] font-semibold text-sky-950">
                    Enter SO
                  </button>
                ) },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              emptyMessage={loading ? "Loading draft sales orders..." : "No draft Excel-Upload sales orders for this company."}
            />
          ),
        }}
      />

      <DrawerBase
        visible={Array.isArray(reviewRows)}
        onClose={() => setReviewRows(null)}
        side="center"
        width="min(1500px, calc(100vw - 32px))"
        title="Review Excel Upload"
        actions={[
          <button key="add" type="button" onClick={addManualReviewRow} className="border border-slate-400 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Add Row</button>,
          <button key="cancel" type="button" onClick={() => setReviewRows(null)} className="border border-slate-400 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>,
          <button key="submit" type="button" disabled={submitting || hasUnresolvedDuplicate || submittableCount === 0}
            onClick={() => void handleSubmitReview()}
            className="border border-emerald-700 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-950 disabled:opacity-50">
            {submitting ? "Saving..." : `Submit (${submittableCount})`}
          </button>,
        ]}
      >
        {hasUnresolvedDuplicate ? (
          <p className="mb-2 text-xs font-semibold text-rose-700">Resolve every duplicate row (remove one of each pair) before submitting.</p>
        ) : null}
        <ErpDenseGrid
          columns={[
            { key: "so_number", label: "SO Number", width: "110px" },
            { key: "external_so_number", label: "External SO Number", width: "140px" },
            { key: "fg_type", label: "FG Type", width: "80px" },
            { key: "sku", label: "SKU / Document Name", width: "180px", render: (row) => row.document_name || row.sku || "—" },
            { key: "hsn_code", label: "HSN", width: "90px" },
            { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right" },
            { key: "pack_uom_code", label: "Pack UoM", width: "80px", render: (row) => row.pack_uom_code || "—" },
            { key: "base_qty", label: "Base Qty", width: "90px", align: "right", render: (row) => Number(row.base_qty ?? 0).toFixed(4) },
            { key: "base_uom_code", label: "Base UoM", width: "80px", render: (row) => row.base_uom_code || "—" },
            { key: "rate", label: "Rate", width: "150px", render: (row) => {
              if (row.ac05_rate == null || row.ac05_rate_match) {
                return <span>{row.rate}{row.ac05_rate != null ? <span className="ml-1 text-emerald-600">✓</span> : null}</span>;
              }
              return (
                <div className="grid gap-0.5 text-[11px]">
                  <label className="flex items-center gap-1"><input type="radio" checked readOnly onChange={() => {}} />Uploaded: {row.rate}</label>
                  <button type="button" className="text-left text-sky-700 underline" onClick={() => chooseRate(row.row_key, row.ac05_rate)}>
                    Use AC05: {row.ac05_rate}
                  </button>
                </div>
              );
            } },
            { key: "rate_basis", label: "Rate Basis", width: "90px" },
            { key: "gst_treatment", label: "GST", width: "90px" },
            { key: "gst_rate", label: "GST %", width: "70px" },
            { key: "taxable_value", label: "Amount", width: "100px", align: "right", render: (row) => Number(row.taxable_value ?? 0).toFixed(2) },
            { key: "cgst_amount", label: "CGST", width: "80px", align: "right", render: (row) => Number(row.cgst_amount ?? 0).toFixed(2) },
            { key: "sgst_amount", label: "SGST", width: "80px", align: "right", render: (row) => Number(row.sgst_amount ?? 0).toFixed(2) },
            { key: "igst_amount", label: "IGST", width: "80px", align: "right", render: (row) => Number(row.igst_amount ?? 0).toFixed(2) },
            { key: "total_value", label: "Total Value", width: "100px", align: "right", render: (row) => Number(row.total_value ?? 0).toFixed(2) },
            { key: "status", label: "Status", width: "190px", render: (row) => (
              row.skip_reason
                ? <span className="text-[11px] font-semibold text-slate-500">{row.skip_reason}</span>
                : row.is_duplicate ? <span className="text-[11px] font-semibold text-rose-700">Duplicate</span> : null
            ) },
            { key: "actions", label: "", width: "80px", render: (row) => (
              <button type="button" onClick={() => removeReviewRow(row.row_key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
            ) },
          ]}
          rows={reviewRows ?? []}
          rowKey={(row) => row.row_key}
          getRowProps={(row) => ({ className: reviewRowClassName(row) })}
          fitColumnWidths
          emptyMessage="No rows."
        />
      </DrawerBase>
    </>
  );
}
