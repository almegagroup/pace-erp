import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getGateReport } from "../procurementApi.js";

const GE_TYPE_OPTIONS = ["INBOUND_PO", "INBOUND_STO"];
const STATUS_OPTIONS = ["OPEN", "GRN_POSTED", "CANCELLED", "PRUNED"];

// Excel export columns: same order and headings as the grid, raw values (so
// quantities, weights and day counts stay numbers in Excel).
const num = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? "" : Number(value));
const EXPORT_COLUMNS = [
  { key: "ge_number", label: "GE Number", width: "120px" },
  { key: "company_code", label: "Company", width: "90px" },
  { key: "ge_type", label: "GE Type", width: "110px" },
  { key: "ge_status", label: "GE Status", width: "100px" },
  { key: "vehicle_number", label: "Vehicle No.", width: "110px" },
  { key: "ge_person_name", label: "GE Person Name", width: "140px" },
  { key: "gex_person_name", label: "GEX Person Name", width: "140px" },
  { key: "vendor", label: "Vendor", width: "220px", value: (r) => (r.vendor_name ? `${r.vendor_code || ""} — ${r.vendor_name}`.replace(/^ — /, "") : "") },
  { key: "material_code", label: "Material Code", width: "120px" },
  { key: "material_name", label: "Material Name", width: "260px" },
  { key: "ge_qty", label: "Qty", width: "90px", align: "right", numFmt: "#,##0.###", value: (r) => num(r.ge_qty) },
  { key: "uom_code", label: "UOM", width: "60px" },
  { key: "grn_number", label: "GRN No.", width: "110px" },
  { key: "invoice_number", label: "Invoice No.", width: "120px" },
  { key: "gex_number", label: "GEX No.", width: "110px" },
  { key: "ge_date", label: "GE Date", width: "100px" },
  { key: "grn_date", label: "GRN Date", width: "100px" },
  { key: "gex_date", label: "GEX Date", width: "100px" },
  { key: "remarks", label: "Remarks", width: "180px", value: (r) => r.gex_remarks || r.ge_remarks || "" },
  { key: "gross_weight", label: "Gross Wt", width: "90px", align: "right", numFmt: "#,##0.###", value: (r) => num(r.gross_weight) },
  { key: "tare_weight", label: "Tare Wt", width: "90px", align: "right", numFmt: "#,##0.###", value: (r) => num(r.tare_weight) },
  { key: "net_weight_calculated", label: "Net Wt (Calc)", width: "100px", align: "right", numFmt: "#,##0.###", value: (r) => num(r.net_weight_calculated) },
  { key: "days_ge_to_gex", label: "GEX−GE (days)", width: "110px", align: "right", value: (r) => num(r.days_ge_to_gex) },
  { key: "days_ge_to_grn", label: "GRN−GE (days)", width: "110px", align: "right", value: (r) => num(r.days_ge_to_grn) },
];

function daysBadge(days) {
  if (days == null) return "—";
  if (days > 2) return <span className="font-semibold text-rose-700">{days}d</span>;
  return `${days}d`;
}

export default function GateReportPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [geType, setGeType] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const params = useMemo(
    () => ({ company_id: effectiveCompanyId, date_from: dateFrom, date_to: dateTo, ge_type: geType, status }),
    [effectiveCompanyId, dateFrom, dateTo, geType, status]
  );

  const reportQuery = useQuery({
    queryKey: ["procurement", "gate-report", params],
    enabled: Boolean(effectiveCompanyId),
    queryFn: () => getGateReport(params),
  });

  const allRows = useMemo(
    () => (Array.isArray(reportQuery.data?.items) ? reportQuery.data.items : []),
    [reportQuery.data],
  );

  const rows = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter((r) =>
      [r.ge_number, r.material_code, r.material_name, r.vendor_name, r.vendor_code,
       r.grn_number, r.gex_number, r.ge_type, r.ge_status, r.vehicle_number, r.invoice_number,
       r.ge_person_name, r.gex_person_name]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [allRows, search]);

  const loading = reportQuery.isLoading;

  // Exports exactly the rows on screen (criteria + search) with the report
  // context and the export date-time above the header.
  async function handleExport() {
    if (rows.length === 0) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      const now = new Date();
      const exportStamp = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
      const fileStamp = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const company = buildTransactionCompanyList(runtimeContext).find((entry) => String(entry.id) === String(effectiveCompanyId));
      const companyCode = String(company?.company_code || "company").replace(/[^A-Za-z0-9_-]+/g, "_");
      await downloadColoredExcelFile({
        fileName: `gate_entry_report_${companyCode}_exported_${fileStamp}.xlsx`,
        sheetName: "Gate Entry Report",
        columns: EXPORT_COLUMNS,
        rows,
        preambleRows: [
          ["Report", "Gate Entry Report (ZGATE)"],
          ["Company", company ? [company.company_code, company.company_name].filter(Boolean).join(" — ") : "-"],
          ["GE Date", dateFrom || dateTo ? `${dateFrom || "…"} to ${dateTo || "…"}` : "All dates"],
          ["GE Type", geType || "All"],
          ["Status", status || "All"],
          ...(search.trim() ? [["Search", search.trim()]] : []),
          ["Rows", rows.length],
          ["Export Date", `${exportStamp} IST`],
        ],
        getCellValue: (row, column) => (typeof column.value === "function" ? column.value(row) : (row?.[column.key] ?? "")),
        // Same signal as the screen: more than 2 days is shown in red.
        getCellColor: (row, column) =>
          (column.key === "days_ge_to_gex" || column.key === "days_ge_to_grn") && Number(row[column.key]) > 2
            ? { fontArgb: "FFBE123C", bold: true }
            : null,
      });
    } catch (exportFailure) {
      setExportError(exportFailure instanceof Error ? exportFailure.message : "GATE_REPORT_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }
  const error = reportQuery.error?.message ?? "";

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void queryClient.invalidateQueries({ queryKey: ["procurement", "gate-report"] }),
    },
  });

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Gate Entry Report (ZGATE)"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing…" : "Refresh",
          tone: "neutral",
          onClick: () => queryClient.invalidateQueries({ queryKey: ["procurement", "gate-report"] }),
        },
        {
          key: "export",
          label: exporting ? "Exporting…" : "Export Excel",
          tone: "neutral",
          onClick: () => void handleExport(),
          disabled: exporting || rows.length === 0,
        },
      ]}
      notices={[
        ...(error ? [{ key: "gate-report-error", tone: "error", message: error }] : []),
        ...(exportError ? [{ key: "gate-report-export-error", tone: "error", message: exportError }] : []),
      ]}
      filterSection={{
        eyebrow: "Criteria",
        title: "Filter",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_160px_160px_160px_160px_minmax(0,1fr)]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date from
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date to
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              GE Type
              <select value={geType} onChange={(e) => setGeType(e.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                <option value="">ALL</option>
                {GE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                <option value="">ALL</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <QuickFilterInput label="Search" value={search} onChange={setSearch} placeholder="GE, material, vendor, GRN, GEX…" />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Report",
        title: loading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"}${allRows.length !== rows.length ? ` (filtered from ${allRows.length})` : ""}`,
        children: (
          <ErpDenseGrid
            columns={[
              { key: "ge_number",       label: "GE Number",     width: "120px" },
              { key: "company_code",    label: "Company",       width: "90px",  render: (r) => r.company_code || "—" },
              { key: "vehicle_number",  label: "Vehicle No.",   width: "110px", render: (r) => r.vehicle_number || "—" },
              { key: "ge_person_name",  label: "GE Person Name",  width: "140px", render: (r) => r.ge_person_name || "—" },
              { key: "gex_person_name", label: "GEX Person Name", width: "140px", render: (r) => r.gex_person_name || "—" },
              { key: "vendor",          label: "Vendor",        width: "180px", render: (r) => r.vendor_name ? `${r.vendor_code || ""} — ${r.vendor_name}`.replace(/^ — /, "") : "—" },
              { key: "material_code",   label: "Material Code", width: "120px", render: (r) => r.material_code || "—" },
              { key: "material_name",   label: "Material Name", render: (r) => r.material_name || "—" },
              { key: "ge_qty",          label: "Qty",           width: "90px",  render: (r) => r.ge_qty != null ? `${Number(r.ge_qty).toFixed(3)} ${r.uom_code || ""}`.trim() : "—" },
              { key: "grn_number",      label: "GRN No.",       width: "110px", render: (r) => r.grn_number || "—" },
              { key: "invoice_number",  label: "Invoice No.",   width: "120px", render: (r) => r.invoice_number || "—" },
              { key: "gex_number",      label: "GEX No.",       width: "110px", render: (r) => r.gex_number || "—" },
              { key: "ge_date",         label: "GE Date",       width: "100px" },
              { key: "grn_date",        label: "GRN Date",      width: "100px", render: (r) => r.grn_date || "—" },
              { key: "gex_date",        label: "GEX Date",      width: "100px", render: (r) => r.gex_date || "—" },
              { key: "ge_remarks",      label: "Remarks",       width: "140px", render: (r) => r.gex_remarks || r.ge_remarks || "—" },
              { key: "gross_weight",    label: "Gross Wt",      width: "90px",  render: (r) => r.gross_weight ?? "—" },
              { key: "tare_weight",     label: "Tare Wt",       width: "90px",  render: (r) => r.tare_weight ?? "—" },
              { key: "net_weight_calc", label: "Net Wt (Calc)", width: "100px", render: (r) => r.net_weight_calculated ?? "—" },
              { key: "days_gex",        label: "GEX−GE (days)", width: "110px", render: (r) => daysBadge(r.days_ge_to_gex) },
              { key: "days_grn",        label: "GRN−GE (days)", width: "110px", render: (r) => daysBadge(r.days_ge_to_grn) },
            ]}
            rows={rows}
            rowKey={(r, i) => `${r.ge_number}-${r.line_number ?? i}`}
            emptyMessage={loading ? "Loading…" : effectiveCompanyId ? "No records matched the criteria." : "No company resolved for this session."}
          />
        ),
      }}
    />
  );
}
