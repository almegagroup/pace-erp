/*
 * File-ID: 27.FE-PR14
 * File-Path: frontend/src/pages/dashboard/production/BatchVariancePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: PR14 Batch Variance Report — a printable Batch Record for one Process PO batch
 *          (RM/INT dosage/standard/actual/APL/variance, linked Packing PO(s) + PM lines, SFG
 *          QA test results). See feasibility doc §123. Standalone 3-screen page: Page 1
 *          (Filters) -> Page 2 (matching batches list) -> Page 3 (printable Batch Record).
 *          Only one screen visible at a time — same pattern as PR24/IN02.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useScreenBackInterceptor } from "../../../hooks/useScreenBackInterceptor.js";
import { buildTransactionCompanyList } from "../../../components/inputs/transactionCompanyRuntime.js";
import { searchBatchVarianceReport, getBatchVarianceDetail } from "./prodApi.js";

// process_order_line_reco is only ever written at Verify — INT and MTEST never reach Verify
// (they run Standard->Final direct / full-cycle-minus-Verify respectively), so they never
// produce a variance row here. Only offer the types that actually populate this report.
const PROCESS_ORDER_TYPES = ["MTO", "HPS", "MTS"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtQty(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : null;
}
function fmtVariance(value) {
  const formatted = fmtQty(value);
  if (formatted === null) return null;
  const n = Number(value);
  return n > 0 ? `+${formatted}` : formatted;
}
function fmtPct(value) {
  if (value === null || value === undefined || value === "") return null;
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
}
function sumBy(list, key) {
  return list.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
}

const emptyFilters = () => ({
  poNumber: "",
  companyIds: [],
  poTypes: [],
  batchNumber: "",
  dateFrom: daysAgoIso(30),
  dateTo: todayIso(),
  showLinkedPacking: true,
  showTestResults: true,
});

const LIST_COLUMNS = [
  { key: "po_number", label: "Process PO", width: "110px", render: (r) => <span className="font-mono font-semibold text-sky-700">{r.po_number}</span> },
  { key: "prodshade", label: "Prodshade", render: (r) => (r.prodshade_external_code || r.prodshade_description ? `${r.prodshade_external_code ?? "—"} — ${r.prodshade_description ?? "—"}` : "—") },
  {
    key: "packing_orders",
    label: "Packing PO",
    render: (r) => {
      const list = Array.isArray(r.packing_orders) ? r.packing_orders : [];
      if (list.length === 0) return <span className="text-slate-300">—</span>;
      const first = list[0].po_number;
      return list.length > 1 ? `${first} +${list.length - 1} more` : first;
    },
  },
  {
    key: "sku",
    label: "SKU",
    render: (r) => {
      const first = (Array.isArray(r.packing_orders) ? r.packing_orders : [])[0];
      if (!first) return <span className="text-slate-300">—</span>;
      return first.sku_external_code || first.sku_description || "—";
    },
  },
  { key: "batch_number", label: "Batch #", width: "100px", render: (r) => <span className="font-mono">{r.batch_number || "—"}</span> },
  { key: "status", label: "Status", width: "90px", render: (r) => <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{r.status}</span> },
  { key: "verified_at", label: "Verified", width: "100px", render: (r) => fmtDate(r.verified_at) },
];

function RmIntTable({ lines }) {
  if (!lines || lines.length === 0) {
    return <p className="empty-note">No RM/INT consumption recorded for this batch.</p>;
  }
  return (
    <table className="items">
      <thead className="print-repeat-head">
        <tr><th>External Code</th><th>Description</th><th className="num">Dosage</th><th className="num">Standard</th><th className="num">Actual</th><th className="num">APL</th><th className="num">Variance</th></tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{l.external_code || "—"}</td>
            <td>{l.description || "—"}</td>
            <td className="num">{fmtPct(l.dosage_pct) ?? "—"}</td>
            <td className="num">{fmtQty(l.standard_qty) ?? "—"}</td>
            <td className="num">{fmtQty(l.actual_qty) ?? "—"}</td>
            <td className="num">{fmtQty(l.ap_approved_qty) ?? "—"}</td>
            <td className="num">{fmtVariance(l.variance_qty) ?? "—"}</td>
          </tr>
        ))}
        <tr className="total">
          <td colSpan={3}>Total</td>
          <td className="num">{fmtQty(sumBy(lines, "standard_qty"))}</td>
          <td className="num">{fmtQty(sumBy(lines, "actual_qty"))}</td>
          <td className="num">{fmtQty(sumBy(lines, "ap_approved_qty"))}</td>
          <td className="num">{fmtVariance(sumBy(lines, "variance_qty"))}</td>
        </tr>
      </tbody>
    </table>
  );
}

function PmTable({ lines }) {
  return (
    <table className="items">
      <thead className="print-repeat-head">
        <tr><th>External Code</th><th>Description</th><th className="num">Dosage</th><th className="num">Standard</th><th className="num">Actual</th><th className="num">APL</th><th className="num">Variance</th></tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{l.external_code || "—"}</td>
            <td>{l.description || "—"}</td>
            <td className="num dash">—</td>
            <td className="num dash">—</td>
            <td className="num">{fmtQty(l.actual_qty) ?? "—"}</td>
            <td className="num">{fmtQty(l.ap_approved_qty) ?? "—"}</td>
            <td className="num">{fmtVariance(l.variance_qty) ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BatchRecordDoc({ detail, showLinkedPacking, showTestResults }) {
  const order = detail.process_order;
  const packingOrders = Array.isArray(detail.packing_orders) ? detail.packing_orders : [];
  return (
    <div className="paper">
      <div className="plain-title">Batch Variance Report</div>

      <div className="parties">
        <div className="party-block">
          <table className="doc-id-table"><tbody>
            <tr><td className="k">Company Code / Name</td><td className="v">{order.company_code ?? "—"} — {order.company_name ?? "—"}</td></tr>
            <tr><td className="k">Process PO Number</td><td className="v">{order.po_number}</td></tr>
            <tr><td className="k">Order Type</td><td className="v">{order.po_type ?? "—"}</td></tr>
            <tr><td className="k">Prodshade Description</td><td className="v">{[order.prodshade_external_code, order.prodshade_description].filter(Boolean).join(" — ") || "—"}</td></tr>
          </tbody></table>
        </div>
        <div className="party-block">
          <table className="doc-id-table"><tbody>
            <tr><td className="k">Stroke Number</td><td className="v">{order.stroke_number ?? "—"}</td></tr>
            <tr><td className="k">Machine</td><td className="v">{[order.machine_code, order.machine_name].filter(Boolean).join(" — ") || "—"}</td></tr>
            <tr><td className="k">Batch Posting Date</td><td className="v">{fmtDate(order.verified_at)}</td></tr>
            <tr><td className="k">Batch Number</td><td className="v">{order.batch_number ?? "—"}</td></tr>
          </tbody></table>
        </div>
      </div>

      <div className="section-title">RM / INT Consumption</div>
      <RmIntTable lines={detail.rm_int_lines} />

      {showLinkedPacking ? (
        packingOrders.length === 0 ? (
          <>
            <div className="section-title">Linked Packing PO</div>
            <p className="empty-note">No Packing PO linked to this batch.</p>
          </>
        ) : (
          packingOrders.map((po) => (
            <React.Fragment key={po.id}>
              <div className="section-title">Linked Packing PO</div>
              <div className="section-sub">
                {po.po_number} &middot; FG {[po.sku_external_code, po.sku_description].filter(Boolean).join(" — ") || "—"}
                {po.pack_code ? ` · Pack Code ${po.pack_code}` : ""}
                {po.num_packs != null && po.fill_qty_per_pack != null ? ` · ${po.num_packs} × ${fmtQty(po.fill_qty_per_pack)} KG` : ""}
                {po.finalized_at ? ` · Finalized ${fmtDate(po.finalized_at)}` : ""}
              </div>
              {po.pm_lines.length === 0 ? (
                <p className="empty-note">No PM lines recorded for this Packing PO.</p>
              ) : (
                <PmTable lines={po.pm_lines} />
              )}
            </React.Fragment>
          ))
        )
      ) : null}

      {showTestResults ? (
        <>
          <div className="section-title">SFG Test Results</div>
          <div className="section-sub">
            {[order.prodshade_external_code, order.prodshade_description].filter(Boolean).join(" — ") || "—"}
            {order.batch_number ? ` · Batch ${order.batch_number}` : ""}
          </div>
          {!detail.sfg_qa || detail.sfg_qa.test_lines.length === 0 ? (
            <p className="empty-note">No QA test results recorded for this batch yet.</p>
          ) : (
            <table className="items">
              <thead className="print-repeat-head">
                <tr><th>Test Parameter</th><th>Method</th><th>Range (LSL&ndash;USL)</th><th>Result</th><th>Pass / Fail</th></tr>
              </thead>
              <tbody>
                {detail.sfg_qa.test_lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.test_parameter || "—"}</td>
                    <td>{l.method_name || "—"}</td>
                    <td>{l.lsl != null || l.usl != null ? `${l.lsl ?? "—"} – ${l.usl ?? "—"}` : (l.acceptable_range || "—")}</td>
                    <td>{l.test_result || "—"}</td>
                    <td>{l.pass_fail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function BatchVariancePage() {
  const { runtimeContext } = useMenu();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);

  const [filters, setFilters] = useState(emptyFilters);
  const [submittedParams, setSubmittedParams] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [printOptions, setPrintOptions] = useState({ showLinkedPacking: true, showTestResults: true });
  const [error, setError] = useState("");
  // Page 1 (Filters), Page 2 (Matching Batches), Page 3 (Printable Batch Record) — only one
  // visible at a time, same pattern as PR24/IN02.
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ["batch-variance-search", submittedParams],
    queryFn: () => searchBatchVarianceReport(submittedParams),
    enabled: Boolean(submittedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const rows = listQ.data ?? [];

  const detailQ = useQuery({
    queryKey: ["batch-variance-detail", selectedOrderId],
    queryFn: () => getBatchVarianceDetail(selectedOrderId),
    enabled: page === 3 && Boolean(selectedOrderId),
  });

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function togglePoType(type) {
    setFilters((prev) => ({
      ...prev,
      poTypes: prev.poTypes.includes(type) ? prev.poTypes.filter((t) => t !== type) : [...prev.poTypes, type],
    }));
  }

  function handleReset() {
    setFilters(emptyFilters());
    setSubmittedParams(null);
    setSelectedOrderId(null);
    setError("");
    setPage(1);
  }

  function handleExecute() {
    setError("");
    if (!filters.poNumber) {
      if (!filters.dateFrom || !filters.dateTo) {
        setError("Posting Date range is required unless a PO Number is given.");
        return;
      }
      if (new Date(filters.dateTo) < new Date(filters.dateFrom)) {
        setError("Date To cannot be before Date From.");
        return;
      }
    }
    const nextParams = {
      po_number: filters.poNumber || undefined,
      company_ids: filters.companyIds.length > 0 ? filters.companyIds.join(",") : undefined,
      po_types: filters.poTypes.length > 0 ? filters.poTypes.join(",") : undefined,
      batch_number: filters.batchNumber || undefined,
      date_from: filters.poNumber ? undefined : filters.dateFrom,
      date_to: filters.poNumber ? undefined : filters.dateTo,
    };
    setPrintOptions({ showLinkedPacking: filters.showLinkedPacking, showTestResults: filters.showTestResults });
    if (submittedParams && JSON.stringify(submittedParams) === JSON.stringify(nextParams)) {
      void listQ.refetch();
      setPage(2);
      return;
    }
    setSubmittedParams(nextParams);
    setPage(2);
  }

  function openBatchRecord(row) {
    setSelectedOrderId(row.id);
    setPage(3);
  }

  // Esc / shell Back steps back one screen at a time (3 -> 2 -> 1) instead of leaving the route.
  useScreenBackInterceptor(() => {
    if (page === 3) { setPage(2); return true; }
    if (page === 2) { setPage(1); return true; }
    return false;
  });

  useErpScreenHotkeys({
    focusPrimary: { perform: () => (page === 3 ? window.print() : handleExecute()) },
    refresh: { disabled: page !== 2, perform: () => void listQ.refetch() },
  });

  const activeError = error || (listQ.error instanceof Error ? listQ.error.message : "") || (detailQ.error instanceof Error ? detailQ.error.message : "");

  return (
    <ErpScreenScaffold
      eyebrow="Production Reports"
      title="Batch Variance Report"
      notices={activeError ? [{ key: "batvar-error", tone: "error", message: activeError }] : []}
      actions={
        page === 1
          ? [
              { key: "reset", label: "Reset", onClick: handleReset },
              { key: "execute", label: "Execute", tone: "primary", onClick: handleExecute },
            ]
          : page === 2
          ? [
              { key: "back", label: "Back to Filters", hint: "Esc", onClick: () => setPage(1) },
              {
                key: "execute",
                label: listQ.isFetching ? "Executing..." : "Execute Again",
                tone: "primary",
                onClick: handleExecute,
                disabled: listQ.isFetching,
              },
            ]
          : [
              { key: "back", label: "Back to List", hint: "Esc", onClick: () => setPage(2) },
              { key: "print", label: "Print", tone: "primary", onClick: () => window.print(), disabled: !detailQ.data },
            ]
      }
    >
      {page === 1 ? (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 1" title="Selection Screen">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-[260px] flex-col gap-1">
                  <label className="text-xs text-slate-500">PO Number <span className="text-slate-400">(Process PO or Packing PO — bypasses date range)</span></label>
                  <input
                    className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                    placeholder="e.g. 9300000063 or 9400000037"
                    value={filters.poNumber}
                    onChange={(e) => updateFilter("poNumber", e.target.value.trim())}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Company</label>
                  <select
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                    value={filters.companyIds[0] ?? ""}
                    onChange={(e) => updateFilter("companyIds", e.target.value ? [e.target.value] : [])}
                  >
                    <option value="">All my companies ({companies.length})</option>
                    {companies.map((c) => (
                      <option key={c.id ?? c.company_id} value={c.id ?? c.company_id}>{c.company_code} — {c.company_name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Batch Number</label>
                  <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="e.g. EV02640" value={filters.batchNumber} onChange={(e) => updateFilter("batchNumber", e.target.value.trim())} />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="text-xs text-slate-500">Posting Date {!filters.poNumber && <span className="text-rose-500">*</span>}</label>
                  <div className="flex items-center gap-1.5">
                    <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} disabled={Boolean(filters.poNumber)} />
                    <span className="text-slate-400">-</span>
                    <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} disabled={Boolean(filters.poNumber)} />
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-slate-500">PO Type:</p>
                <div className="flex flex-wrap gap-1.5">
                  {PROCESS_ORDER_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => togglePoType(type)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.poTypes.includes(type) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={filters.showLinkedPacking} onChange={(e) => updateFilter("showLinkedPacking", e.target.checked)} />
                  Show Linked Packing PO
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={filters.showTestResults} onChange={(e) => updateFilter("showTestResults", e.target.checked)} />
                  Show Test Results
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <span className="text-xs text-slate-400">Open to everyone — access is company-scoped only, never rank or department-gated.</span>
                <button type="button" onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                  Execute
                </button>
              </div>
            </div>
          </ErpSectionCard>
        </div>
      ) : page === 2 ? (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="Matching Batches">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setPage(1)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Back to Filters
              </button>
              <span className="text-xs text-slate-500">
                {listQ.isLoading ? "Loading..." : `${rows.length} batch${rows.length === 1 ? "" : "es"} — press Enter or double-click a row to open its Batch Record`}
              </span>
            </div>
            <ErpDenseGrid
              columns={LIST_COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openBatchRecord}
              getRowProps={(row) => ({ onDoubleClick: () => openBatchRecord(row), className: "cursor-pointer hover:bg-sky-50" })}
              maxHeight="calc(100vh - 260px)"
              emptyMessage={listQ.isLoading ? "Loading..." : "No VERIFIED batches match this criteria."}
            />
          </ErpSectionCard>
        </div>
      ) : (
        <div className="batch-record-shell">
          <style>{PRINT_CSS}</style>
          <div className="no-print mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setPage(2)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Back to List
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!detailQ.data}
              className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              Print
            </button>
          </div>
          {detailQ.isLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading batch record...</p>
          ) : detailQ.data ? (
            <BatchRecordDoc detail={detailQ.data} showLinkedPacking={printOptions.showLinkedPacking} showTestResults={printOptions.showTestResults} />
          ) : (
            <p className="p-6 text-sm text-rose-600">Batch record is unavailable.</p>
          )}
        </div>
      )}
    </ErpScreenScaffold>
  );
}

const PRINT_CSS = `
  .batch-record-shell { background:#eef0f2; min-height:60vh; padding:20px 0; }
  .paper { position:relative; background:#fdfbf9; color:#22201e; width:794px; max-width:100%; margin:0 auto 24px; padding:38px 48px 36px; box-shadow:0 1px 3px rgba(0,0,0,.1),0 12px 32px rgba(0,0,0,.16); font-family:Georgia, "Times New Roman", serif; }

  .plain-title { font-size:17px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; text-align:center; color:#22201e; padding-bottom:12px; border-bottom:2.5px solid #7a2a2a; }

  .parties { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin:18px 0; break-inside:avoid; page-break-inside:avoid; }
  .party-block { border-top:1px solid #ddd5d1; padding-top:10px; }
  .doc-id-table { width:100%; font-family:Arial, sans-serif; font-size:11.5px; border-collapse:collapse; }
  .doc-id-table td { padding:2.5px 0; }
  .doc-id-table td.k { color:#8a8078; text-transform:uppercase; letter-spacing:.04em; font-size:9.5px; padding-right:14px; white-space:nowrap; vertical-align:top; width:1%; }
  .doc-id-table td.v { font-weight:600; text-align:left; white-space:normal; }

  .section-title { font-family:Arial, sans-serif; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#7a2a2a; margin:20px 0 4px; border-bottom:1px solid #ddd5d1; padding-bottom:4px; }
  .section-sub { font-family:Arial, sans-serif; font-size:10.5px; color:#8a8078; margin:-2px 0 8px; }
  .empty-note { font-family:Arial, sans-serif; font-size:10.5px; font-style:italic; color:#8a8078; margin:4px 0 10px; }

  table.items { width:100%; border-collapse:collapse; margin:4px 0 4px; font-family:Arial, sans-serif; font-size:11px; }
  table.items thead th { background:#f3e8e6; font-size:9.5px; font-weight:700; text-transform:uppercase; text-align:left; padding:6px 8px; border-top:1px solid #b8ada7; border-bottom:1px solid #b8ada7; }
  table.items thead th.num { text-align:right; }
  table.items tbody td { padding:6px 8px; border-bottom:1px solid #ddd5d1; white-space:normal; }
  table.items tbody td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  table.items tbody td.dash { color:#b8ada7; }
  table.items tbody tr.total td { font-weight:700; border-top:1.5px solid #7a2a2a; }

  @page { size:A4; margin:0; }
  @media print {
    body { background:#fff; }
    .no-print { display:none !important; }
    .batch-record-shell { background:#fff; padding:0; }
    .paper { width:794px; margin:0 auto; box-shadow:none; }
    .print-repeat-head { display: table-header-group; }
    table.items { break-inside:auto; page-break-inside:auto; }
    table.items tbody tr { break-inside:avoid; page-break-inside:avoid; }
    .parties, .section-title { break-inside:avoid; page-break-inside:avoid; }
  }
`;
