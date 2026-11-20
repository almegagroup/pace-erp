/*
 * File-Path: frontend/src/pages/dashboard/procurement/grn/GrnReceivingReportPage.jsx
 * Domain: PROCUREMENT / Receiving
 * Purpose: PO23 -- GRN Receiving Report. Page 1 selection (company, gate entry date range), Page 2 grid: per gate entry PO line and
 *          per GRN -- vendor, PO, material, PO qty, PO UoM, PO rate, GE qty, GRN qty, QA Blocked qty, balance after that GRN.
 *          Reversed / cancelled GRNs and pruned gate entries never appear. Visible to everyone, company scoped on the server.
 * Authority: Frontend
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { getGrnReceivingReport } from "../procurementApi.js";

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => `${todayIso().slice(0, 8)}01`;
const pill = (on) => `rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`;
const qty = (value) => (value === null || value === undefined ? "" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 }));

export default function GrnReceivingReportPage() {
  const { runtimeContext } = useMenu();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [companyIds, setCompanyIds] = useState([]);
  useEffect(() => {
    if (companyIds.length === 0 && defaultCompanyId) setCompanyIds([defaultCompanyId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCompanyId]);
  const effectiveCompanyIds = companyIds.length > 0 ? companyIds : (defaultCompanyId ? [defaultCompanyId] : []);

  const [dateFrom, setDateFrom] = useState(monthStartIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const reportQ = useQuery({
    queryKey: ["grn-receiving-report", submitted],
    queryFn: () => getGrnReceivingReport(submitted),
    enabled: Boolean(submitted),
    select: (data) => data?.data ?? data ?? {},
  });
  const rows = useMemo(
    () => (reportQ.data?.rows ?? []).map((r, i) => ({ ...r, row_key: `${r.ge_id}|${r.ge_line_number}|${r.grn_id ?? i}` })),
    [reportQ.data],
  );

  function toggleCompany(id) {
    setCompanyIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function execute() {
    setError("");
    if (effectiveCompanyIds.length === 0) return setError("Select a company first.");
    if (!dateFrom || !dateTo) return setError("A date range is required.");
    if (dateTo < dateFrom) return setError("Date To cannot be before Date From.");
    setSubmitted({ company_ids: effectiveCompanyIds.join(","), date_from: dateFrom, date_to: dateTo });
    setPage(2);
  }
  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    setPage(1);
    return true;
  });

  const columns = useMemo(() => {
    const text = (key, label, width, getter) => ({ key, label, width, render: getter, filterValue: getter, excelValue: getter });
    const num = (key, label, getter, width = "100px") => ({
      key, label, width, align: "right",
      render: (r) => qty(getter(r)), filterValue: (r) => qty(getter(r)), excelValue: (r) => (getter(r) === null || getter(r) === undefined ? "" : Number(getter(r))), numFmt: "#,##0.###",
    });
    return [
      text("company_code", "Company", "80px", (r) => r.company_code ?? ""),
      text("ge_number", "Gate Entry", "110px", (r) => `${r.ge_number ?? ""}${r.ge_line_number ? ` / ${r.ge_line_number}` : ""}`),
      text("ge_date", "GE Date", "100px", (r) => r.ge_date ?? ""),
      text("vendor", "Vendor", "190px", (r) => [r.vendor_code, r.vendor_name].filter(Boolean).join(" — ")),
      text("po_number", "PO", "110px", (r) => `${r.po_number ?? ""}${r.line_number ? ` / ${r.line_number}` : ""}`),
      text("material", "Material", "250px", (r) => [r.pace_code, r.material_name].filter(Boolean).join(" — ")),
      num("po_qty", "PO Qty", (r) => r.po_qty),
      text("po_uom", "PO UoM", "70px", (r) => r.po_uom ?? ""),
      num("po_rate", "PO Rate", (r) => r.po_rate, "90px"),
      num("ge_qty", "GE Qty", (r) => r.ge_qty),
      num("grn_count", "GRNs in this GE line", (r) => r.grn_count, "90px"),
      text("grn_number", "GRN", "110px", (r) => r.grn_number ?? ""),
      text("grn_date", "GRN Date", "100px", (r) => r.grn_date ?? ""),
      num("grn_qty", "GRN Qty", (r) => r.grn_qty),
      num("blocked_qty", "QA Blocked", (r) => (r.grn_id ? r.blocked_qty : null)),
      num("balance_after", "Balance after this GRN", (r) => r.balance_after, "120px"),
    ];
  }, []);

  async function exportExcel() {
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `grn_receiving_${dateFrom}_${dateTo}.xlsx`, sheetName: "GRN Receiving",
        columns, rows,
        getCellValue: (row, column) => (typeof column.excelValue === "function" ? column.excelValue(row) : (row?.[column.key] ?? "")),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "GRN_RECEIVING_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  const activeError = error || (reportQ.error instanceof Error ? reportQ.error.message : "");
  const actions = page === 1
    ? [{ key: "execute", label: "Execute", tone: "primary", onClick: execute }]
    : [
      { key: "back", label: "Back to Filters", onClick: () => setPage(1) },
      { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void exportExcel(), disabled: exporting || rows.length === 0 },
      { key: "again", label: reportQ.isFetching ? "Executing..." : "Execute Again", tone: "primary", onClick: execute, disabled: reportQ.isFetching },
    ];

  return (
    <ErpScreenScaffold
      eyebrow="Receiving" title="GRN Receiving Report"
      notices={activeError ? [{ key: "grn-receiving-error", tone: "error", message: activeError }] : []}
      actions={actions}
    >
      {page === 1 ? (
        <ErpSectionCard eyebrow="Page 1" title="Selection Screen">
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Company</p>
              <div className="flex flex-wrap gap-1.5">
                {companies.length <= 1 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {companies[0] ? `${companies[0].company_code} — ${companies[0].company_name ?? ""}` : "—"}
                  </span>
                ) : companies.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggleCompany(String(c.id))} className={pill(effectiveCompanyIds.includes(String(c.id)))} title={c.company_name}>
                    {c.company_code}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Gate entry date range <span className="text-rose-500">*</span></label>
              <div className="flex items-center gap-1.5">
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span className="text-slate-400">-</span>
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>
        </ErpSectionCard>
      ) : (
        <ErpSectionCard eyebrow="Page 2" title={`GRN Receiving (${submitted?.date_from} to ${submitted?.date_to})`}>
          <div className="mb-2 text-right text-xs text-slate-500">{reportQ.isLoading ? "Loading..." : `${rows.length} row${rows.length === 1 ? "" : "s"}`}</div>
          <ErpDenseGrid
            cellNavigate columnFilter searchBar rangeSelect virtualize
            columns={columns} rows={rows} rowKey={(r) => r.row_key}
            maxHeight="calc(100vh - 280px)"
            emptyMessage={reportQ.isLoading ? "Loading..." : "No gate entries for this selection."}
          />
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
