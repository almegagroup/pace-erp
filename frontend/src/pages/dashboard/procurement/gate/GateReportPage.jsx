import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getGateReport } from "../procurementApi.js";

const GE_TYPE_OPTIONS = ["INBOUND_PO", "INBOUND_STO"];
const STATUS_OPTIONS = ["OPEN", "GRN_POSTED", "CANCELLED", "PRUNED"];

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

  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((c) => ({
        value: c.id,
        label: c.company_name || c.company_code || c.id,
      })),
    [runtimeContext?.availableCompanies]
  );

  // Auto-select first company
  useMemo(() => {
    if (!companyId && companyOptions.length > 0) {
      setCompanyId(runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "");
    }
  }, [companyId, companyOptions, runtimeContext?.selectedCompanyId]);

  const params = useMemo(
    () => ({ company_id: companyId, date_from: dateFrom, date_to: dateTo, ge_type: geType, status, limit: 500 }),
    [companyId, dateFrom, dateTo, geType, status]
  );

  const reportQuery = useQuery({
    queryKey: ["procurement", "gate-report", params],
    enabled: Boolean(companyId),
    queryFn: () => getGateReport(params),
  });

  const allRows = Array.isArray(reportQuery.data?.items) ? reportQuery.data.items : [];

  const rows = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter((r) =>
      [r.ge_number, r.material_code, r.material_name, r.vendor_name, r.vendor_code,
       r.grn_number, r.gex_number, r.ge_type, r.ge_status, r.vehicle_number, r.invoice_number]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [allRows, search]);

  const loading = reportQuery.isLoading;
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
      ]}
      notices={error ? [{ key: "gate-report-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Criteria",
        title: "Filter",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_160px_160px_160px_160px_minmax(0,1fr)]">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Company
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select company</option>
                {companyOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
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
            emptyMessage={loading ? "Loading…" : companyId ? "No records matched the criteria." : "Select a company to run the report."}
          />
        ),
      }}
    />
  );
}
