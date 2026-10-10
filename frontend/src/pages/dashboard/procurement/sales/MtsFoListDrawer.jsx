/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/MtsFoListDrawer.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: Per-SO Sales/Dispatch FO register for VDC/DD. This deliberately
 *          does not read Production Plan Feed: its FO terminology is a
 *          separate business concept (FG-STO-MTS-DISPATCH-DESIGN-DOC §6).
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { pushToast } from "../../../../store/uiToast.js";
import { listMtsFoForCompany, listMtsFoForSo, reviseMtsFoNumber } from "../procurementApi.js";

function textValue(row, column) {
  const value = typeof column.copyValue === "function" ? column.copyValue(row) : row?.[column.key];
  return String(value ?? "");
}
function numberCell(value) {
  return Number(value ?? 0).toFixed(4);
}

const FO_COLUMNS = [
  { key: "company_code", label: "Company Code", width: "100px" },
  { key: "company_name", label: "Company", width: "200px" },
  { key: "so_number", label: "SO Number", width: "125px" },
  { key: "external_so_number", label: "External SO Number", width: "145px" },
  { key: "external_so_date", label: "External SO Date", width: "125px" },
  { key: "fo_number", label: "FO Number", width: "125px", render: (row) => <span className="font-mono font-semibold">{row.fo_number || "—"}</span> },
  { key: "revised_fo_number", label: "Revised FO Number", width: "145px", render: (row) => row.revised_fo_number ? <span className="font-mono font-semibold text-sky-800">{row.revised_fo_number}</span> : <span className="text-slate-400">—</span> },
  { key: "effective_fo_number", label: "System FO Number", width: "145px", render: (row) => <span className="font-mono font-semibold text-emerald-800">{row.effective_fo_number || "—"}</span> },
  { key: "parent_company_code", label: "Parent Company", width: "135px", copyValue: (row) => [row.parent_company_code, row.parent_company_name].filter(Boolean).join(" — "), render: (row) => [row.parent_company_code, row.parent_company_name].filter(Boolean).join(" — ") || "—" },
  { key: "parent_company_gst", label: "Parent GST", width: "140px" },
  { key: "bill_to_name", label: "Bill-To Name", width: "190px" },
  { key: "bill_to_address", label: "Bill-To Address", width: "270px" },
  { key: "bill_to_state", label: "Bill-To State", width: "130px" },
  { key: "bill_to_gst", label: "Bill-To GST", width: "140px" },
  { key: "ship_to_name", label: "Ship-To Name", width: "190px" },
  { key: "ship_to_address", label: "Ship-To Address", width: "270px" },
  { key: "ship_to_state", label: "Ship-To State", width: "130px" },
  { key: "ship_to_gst", label: "Ship-To GST", width: "140px" },
  { key: "customer_code", label: "Customer Code", width: "125px" },
  { key: "customer_name", label: "Customer Name", width: "200px" },
  { key: "customer_gst", label: "Customer GST", width: "145px" },
  { key: "customer_billing_address", label: "Customer Billing Address", width: "280px" },
  { key: "customer_billing_state", label: "Customer Billing State", width: "160px" },
  { key: "site_name", label: "Site Name", width: "180px" },
  { key: "site_address", label: "Site Address", width: "280px" },
  { key: "site_town", label: "Site Town", width: "140px" },
  { key: "site_state", label: "Site State", width: "130px" },
  { key: "site_pin_code", label: "Site Pin", width: "100px" },
  { key: "sku", label: "SKU", width: "155px" },
  { key: "material_description", label: "Material Description", width: "240px" },
  { key: "pack_qty", label: "Pack Qty", width: "110px", align: "right", render: (row) => numberCell(row.pack_qty), excelValue: (row) => Number(row.pack_qty ?? 0) },
  { key: "base_qty", label: "Base Qty", width: "110px", align: "right", render: (row) => numberCell(row.base_qty), excelValue: (row) => Number(row.base_qty ?? 0) },
  { key: "rate", label: "Rate", width: "100px", align: "right", render: (row) => numberCell(row.rate), excelValue: (row) => Number(row.rate ?? 0) },
  { key: "gst_rate", label: "GST %", width: "85px", align: "right", render: (row) => numberCell(row.gst_rate), excelValue: (row) => Number(row.gst_rate ?? 0) },
  { key: "taxable_amount", label: "Taxable Amount", width: "135px", align: "right", render: (row) => numberCell(row.taxable_amount), excelValue: (row) => Number(row.taxable_amount ?? 0) },
  { key: "cgst_amount", label: "CGST", width: "110px", align: "right", render: (row) => numberCell(row.cgst_amount), excelValue: (row) => Number(row.cgst_amount ?? 0) },
  { key: "sgst_amount", label: "SGST", width: "110px", align: "right", render: (row) => numberCell(row.sgst_amount), excelValue: (row) => Number(row.sgst_amount ?? 0) },
  { key: "igst_amount", label: "IGST", width: "110px", align: "right", render: (row) => numberCell(row.igst_amount), excelValue: (row) => Number(row.igst_amount ?? 0) },
  { key: "gst_amount", label: "Total GST", width: "115px", align: "right", render: (row) => numberCell(row.gst_amount), excelValue: (row) => Number(row.gst_amount ?? 0) },
  { key: "total_amount", label: "Total Amount", width: "130px", align: "right", render: (row) => numberCell(row.total_amount), excelValue: (row) => Number(row.total_amount ?? 0) },
  { key: "mapped_at", label: "Mapped At", width: "170px" },
];

export default function MtsFoListDrawer({ so = null, companyId = "", onClose }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});
  const [revisionRow, setRevisionRow] = useState(null);
  const [revisedFoNumber, setRevisedFoNumber] = useState("");
  const [savingRevision, setSavingRevision] = useState(false);
  const isCompanyList = !so;
  const scopeKey = so?.id || companyId;
  const scopeLabel = so ? `SO ${so.so_number}` : "All SOs";
  const foQuery = useQuery({
    queryKey: ["procurement", "so-map-mts-fo-list", isCompanyList ? "company" : "so", scopeKey],
    queryFn: () => isCompanyList ? listMtsFoForCompany(companyId) : listMtsFoForSo(so.id),
    enabled: Boolean(scopeKey),
  });
  const rows = useMemo(() => (Array.isArray(foQuery.data) ? foQuery.data : []), [foQuery.data]);
  const suggestions = useMemo(() => [...new Set(rows.flatMap((row) => FO_COLUMNS.map((column) => textValue(row, column)).filter(Boolean)))].sort().slice(0, 500), [rows]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !FO_COLUMNS.some((column) => textValue(row, column).toLowerCase().includes(needle))) return false;
      return Object.entries(columnFilters).every(([key, value]) => {
        if (!String(value ?? "").trim()) return true;
        const column = FO_COLUMNS.find((entry) => entry.key === key);
        return column ? textValue(row, column).toLowerCase().includes(String(value).trim().toLowerCase()) : true;
      });
    });
  }, [rows, search, columnFilters]);

  async function exportExcel() {
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `mts_fo_list_${so?.so_number || "all_sos"}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: "MTS FO List",
        columns: FO_COLUMNS,
        rows: filteredRows,
        getCellValue: (row, column) => typeof column.excelValue === "function" ? column.excelValue(row) : textValue(row, column),
      });
    } catch (error) {
      pushToast({ message: error instanceof Error ? error.message : "MTS_FO_LIST_EXPORT_FAILED", tone: "error" });
    }
  }

  async function saveRevision() {
    const value = revisedFoNumber.trim();
    if (!revisionRow || !value) return;
    setSavingRevision(true);
    try {
      await reviseMtsFoNumber(revisionRow.map_group_id, value);
      await queryClient.invalidateQueries({ queryKey: ["procurement", "so-map-mts-fo-list"] });
      setRevisionRow(null); setRevisedFoNumber("");
      pushToast({ message: `Revised FO Number saved: ${value}`, tone: "success" });
    } catch (error) {
      pushToast({ message: error instanceof Error ? error.message : "SO_MAP_REVISED_FO_UPDATE_FAILED", tone: "error" });
    } finally {
      setSavingRevision(false);
    }
  }

  return (
    <>
      <DrawerBase
        visible
        title={`MTS FO List — ${scopeLabel}`}
        onEscape={onClose}
        onClose={onClose}
        width="calc(100vw - 28px)"
        actions={<div className="flex gap-2"><button type="button" onClick={() => setFiltersOpen((current) => !current)} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{filtersOpen ? "Hide Filters" : "Column Filters"}</button><button type="button" onClick={() => void exportExcel()} disabled={filteredRows.length === 0} className="border border-emerald-700 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50">Export Excel</button><button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950">Done</button></div>}
      >
        <div className="grid gap-3">
          <p className="text-xs text-slate-600">Sales/Dispatch FO register for {isCompanyList ? "every mapped VDC/DD SO in this company" : "this VDC/DD SO"}. Each row is one FO–SKU allocation and shows that exact SO line's rate, tax and amount. Original FO remains auditable; after revision, System FO Number is used for all future lookup.</p>
          <div className="flex items-center gap-2"><input list="mts-fo-list-search-options" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search across every column..." className="h-9 w-full max-w-xl border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" /><datalist id="mts-fo-list-search-options">{suggestions.map((value) => <option key={value} value={value} />)}</datalist><span className="whitespace-nowrap text-xs text-slate-500">{filteredRows.length} of {rows.length} rows</span></div>
          {filtersOpen ? <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">{FO_COLUMNS.map((column) => <label key={column.key} className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{column.label}<input value={columnFilters[column.key] ?? ""} onChange={(event) => setColumnFilters((current) => ({ ...current, [column.key]: event.target.value }))} className="h-7 border border-slate-300 bg-white px-1 text-xs font-normal" /></label>)}</div> : null}
          {foQuery.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading MTS FO List...</p> : foQuery.error ? <p className="border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{foQuery.error instanceof Error ? foQuery.error.message : "SO_MAP_MTS_FO_LIST_FAILED"}</p> : <ErpDenseGrid cellNavigate columns={[...FO_COLUMNS, { key: "revise", label: "", width: "72px", render: (row) => <button type="button" onClick={() => { setRevisionRow(row); setRevisedFoNumber(row.revised_fo_number || ""); }} className="border border-amber-500 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900" title="Revise FO Number">♻</button> }]} rows={filteredRows} rowKey={(row) => row.row_id} emptyMessage="No Sales/Dispatch FO allocations are mapped to this SO." />}
        </div>
      </DrawerBase>
      {revisionRow ? <DrawerBase visible title={`Revise FO — ${revisionRow.fo_number}`} onEscape={() => !savingRevision && setRevisionRow(null)} onClose={() => !savingRevision && setRevisionRow(null)} width="min(500px, calc(100vw - 24px))" actions={<button type="button" disabled={savingRevision || !revisedFoNumber.trim()} onClick={() => void saveRevision()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50">{savingRevision ? "Saving…" : "Save Revised FO"}</button>}><div className="grid gap-3"><p className="text-xs text-slate-600">Original FO <strong>{revisionRow.fo_number}</strong> remains unchanged for audit. Future Bulk DO, transporter update and truck/dispatch lookup will use the revised number.</p><label className="grid gap-1 text-xs font-semibold text-slate-700">New FO Number<input autoFocus value={revisedFoNumber} onChange={(event) => setRevisedFoNumber(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-sm font-normal" /></label></div></DrawerBase> : null}
    </>
  );
}
