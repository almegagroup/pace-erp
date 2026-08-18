/*
 * File-ID: 27.FE-PR24
 * File-Path: frontend/src/pages/dashboard/production/OrderInformationSystemPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: PR24 Order Information System — SAP COOIS-equivalent selection screen + full
 *          transaction ledger report. See feasibility doc §122. Standalone page, not PR13.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { buildTransactionCompanyList } from "../../../components/inputs/transactionCompanyRuntime.js";
import { getOrderInformationReport, listMachines, listStrokeMasters } from "./prodApi.js";

const PROCESS_ORDER_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const PACKING_ORDER_TYPES = ["PMTO", "PHPS", "PMTS", "PTEST"];
const SEGMENTS = ["ADMIX", "HPS", "IWC", "POWDER", "INT"];
const PROCESS_STATUSES = ["STANDARD", "QA_APPROVED", "QA_REJECTED", "BATCH_STARTED", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];
const PACKING_STATUSES = ["STANDARD", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];

const DIR_COLORS = { OUT: "bg-rose-50 text-rose-700", IN: "bg-emerald-50 text-emerald-700" };
const REF_BADGE_COLORS = {
  PROC_PO: "bg-sky-50 text-sky-700",
  PACK_PO: "bg-violet-50 text-violet-700",
  PI: "bg-amber-50 text-amber-700",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const emptyFilters = () => ({
  poNumber: "",
  tab: "PROCESS",
  companyIds: [],
  orderType: "",
  materialSearch: "",
  batchNumber: "",
  machineId: "",
  segmentCode: "",
  strokeMasterId: "",
  statuses: [],
  hasDeviationOnly: false,
  showLinkedPacking: true,
  dateFrom: daysAgoIso(7),
  dateTo: todayIso(),
});

export default function OrderInformationSystemPage() {
  const { runtimeContext } = useMenu();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);

  const [filters, setFilters] = useState(emptyFilters);
  const [executedParams, setExecutedParams] = useState(null);
  const [dateError, setDateError] = useState("");

  const singleCompanyId = filters.companyIds.length === 1 ? filters.companyIds[0] : companies[0]?.id;

  const machinesQ = useQuery({
    queryKey: ["ois-machines", singleCompanyId],
    queryFn: () => listMachines({ company_id: singleCompanyId, active: true }),
    enabled: filters.tab === "PROCESS" && Boolean(singleCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const strokesQ = useQuery({
    queryKey: ["ois-strokes", singleCompanyId],
    queryFn: () => listStrokeMasters({ company_id: singleCompanyId, status: "APPROVED", per_page: 100 }),
    enabled: filters.tab === "PROCESS" && Boolean(singleCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });

  const reportQ = useQuery({
    queryKey: ["order-information-system", executedParams],
    queryFn: () => getOrderInformationReport(executedParams),
    enabled: Boolean(executedParams),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleStatus(status) {
    setFilters((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  }

  function handleReset() {
    setFilters(emptyFilters());
    setExecutedParams(null);
    setDateError("");
  }

  function handleExecute() {
    setDateError("");
    if (!filters.poNumber) {
      if (!filters.dateFrom || !filters.dateTo) {
        setDateError("Posting Date range is required unless a PO Number is given.");
        return;
      }
      if (new Date(filters.dateTo) < new Date(filters.dateFrom)) {
        setDateError("Date To cannot be before Date From.");
        return;
      }
    }
    setExecutedParams({
      po_number: filters.poNumber || undefined,
      tab: filters.tab,
      company_ids: filters.companyIds.length > 0 ? filters.companyIds.join(",") : undefined,
      order_type: filters.orderType || undefined,
      batch_number: filters.batchNumber || undefined,
      machine_id: filters.tab === "PROCESS" ? filters.machineId || undefined : undefined,
      segment_code: filters.segmentCode || undefined,
      stroke_master_id: filters.tab === "PROCESS" ? filters.strokeMasterId || undefined : undefined,
      statuses: filters.statuses.length > 0 ? filters.statuses.join(",") : undefined,
      has_unapproved_deviation: filters.hasDeviationOnly ? "true" : undefined,
      show_linked_packing: filters.tab === "PROCESS" && filters.showLinkedPacking ? "true" : undefined,
      date_from: filters.poNumber ? undefined : filters.dateFrom,
      date_to: filters.poNumber ? undefined : filters.dateTo,
    });
  }

  const statusOptions = filters.tab === "PROCESS" ? PROCESS_STATUSES : PACKING_STATUSES;
  const orderTypeOptions = filters.tab === "PROCESS" ? PROCESS_ORDER_TYPES : PACKING_ORDER_TYPES;
  const rows = reportQ.data ?? [];

  const columns = [
    { key: "company_code", label: "Co.", width: "70px", render: (r) => <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{r.company_code || "--"}</span> },
    { key: "posting_date", label: "Posting Date", width: "100px" },
    { key: "material_name", label: "Material", render: (r) => r.material_name || "--" },
    { key: "external_code", label: "External Code", render: (r) => r.external_code || "--" },
    { key: "movement_type_code", label: "Movement", width: "80px" },
    {
      key: "direction",
      label: "Dir",
      width: "56px",
      align: "center",
      render: (r) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${DIR_COLORS[r.direction] ?? ""}`}>{r.direction}</span>,
    },
    { key: "quantity", label: "Qty", align: "right", width: "100px", render: (r) => Number(r.quantity ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3 }) },
    { key: "batch_number", label: "Batch #", width: "100px", render: (r) => r.batch_number || "--" },
    {
      key: "reference_document_number",
      label: "Ref. Document",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.reference_document_type ? (
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${REF_BADGE_COLORS[r.reference_document_type] ?? "bg-slate-100 text-slate-600"}`}>
              {r.reference_document_type.replace("_", " ")}
            </span>
          ) : null}
          <span className="font-mono text-[11px]">{r.reference_document_number || "--"}</span>
        </span>
      ),
    },
    { key: "apl_qty", label: "APL Qty", align: "right", width: "100px", render: (r) => (r.apl_qty == null ? <span className="text-slate-300">--</span> : Number(r.apl_qty).toLocaleString(undefined, { minimumFractionDigits: 3 })) },
    {
      key: "variance_qty",
      label: "Variance",
      align: "right",
      width: "100px",
      render: (r) => {
        if (r.variance_qty == null) return <span className="text-slate-300">--</span>;
        const v = Number(r.variance_qty);
        return <span className={v !== 0 ? "font-semibold text-amber-700" : "text-slate-400"}>{v.toLocaleString(undefined, { minimumFractionDigits: 3 })}</span>;
      },
    },
  ];

  return (
    <ErpScreenScaffold title="Order Information System - PR24" subtitle="Process & Packing Order transaction report (SAP COOIS equivalent)">
      <ErpSectionCard title="Page 1 - Selection Screen">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[260px] flex-col gap-1">
              <label className="text-xs text-slate-500">PO Number <span className="text-slate-400">(jumps straight to one order's full history — bypasses date range)</span></label>
              <input
                className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                placeholder="e.g. 9300000063 or 9400000037"
                value={filters.poNumber}
                onChange={(e) => updateFilter("poNumber", e.target.value.trim())}
              />
            </div>
          </div>

          <div className="flex gap-0 border-b border-slate-200">
            {["PROCESS", "PACKING"].map((tab) => (
              <button
                key={tab}
                onClick={() => setFilters((prev) => ({ ...prev, tab, orderType: "", machineId: "", strokeMasterId: "" }))}
                className={`px-4 py-2 text-sm font-medium border-b-2 ${filters.tab === tab ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                {tab === "PROCESS" ? "Process Orders" : "Packing Orders"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Company</label>
              <select
                multiple={false}
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
              <label className="text-xs text-slate-500">Order Type</label>
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.orderType} onChange={(e) => updateFilter("orderType", e.target.value)}>
                <option value="">All</option>
                {orderTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Batch Number</label>
              <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="e.g. EV02640" value={filters.batchNumber} onChange={(e) => updateFilter("batchNumber", e.target.value.trim())} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Segment</label>
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.segmentCode} onChange={(e) => updateFilter("segmentCode", e.target.value)}>
                <option value="">All</option>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {filters.tab === "PROCESS" && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Machine</label>
                  <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.machineId} onChange={(e) => updateFilter("machineId", e.target.value)} disabled={!singleCompanyId}>
                    <option value="">All</option>
                    {(machinesQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.machine_code || m.machine_name || m.id}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Stroke Number</label>
                  <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.strokeMasterId} onChange={(e) => updateFilter("strokeMasterId", e.target.value)} disabled={!singleCompanyId}>
                    <option value="">All</option>
                    {(strokesQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.stroke_number ?? s.id}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Posting Date {!filters.poNumber && <span className="text-rose-500">*</span>}</label>
              <div className="flex items-center gap-1.5">
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} disabled={Boolean(filters.poNumber)} />
                <span className="text-slate-400">-</span>
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} disabled={Boolean(filters.poNumber)} />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-slate-500">Status:</p>
            <div className="flex flex-wrap gap-1.5">
              {statusOptions.map((status) => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filters.statuses.includes(status) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                >
                  {status.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={filters.hasDeviationOnly} onChange={(e) => updateFilter("hasDeviationOnly", e.target.checked)} />
              Has unapproved deviation only
            </label>
            {filters.tab === "PROCESS" && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={filters.showLinkedPacking} onChange={(e) => updateFilter("showLinkedPacking", e.target.checked)} />
                <span><b>Show Linked Packing Lines</b> — also pull each order's downstream Packing PO movements (FG/SFG/PM)</span>
              </label>
            )}
          </div>

          {dateError && <p className="text-xs font-medium text-rose-600">{dateError}</p>}
          {reportQ.isError && <p className="text-xs font-medium text-rose-600">{reportQ.error?.message || "Report failed to load."}</p>}

          <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
            <span className="text-xs text-slate-400">Open to every Production/Quality/Audit rank — access is company-scoped only, never rank-gated.</span>
            <div className="flex gap-2">
              <button onClick={handleReset} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-400">Reset</button>
              <button onClick={handleExecute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                Execute
              </button>
            </div>
          </div>
        </div>
      </ErpSectionCard>

      {executedParams && (
        <ErpSectionCard title="Page 2 - Order Transaction Report">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {reportQ.isLoading ? "Loading..." : `${rows.length} movement${rows.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <ErpDenseGrid
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            virtualize
            maxHeight="calc(100vh - 260px)"
            emptyMessage={reportQ.isLoading ? "Loading..." : "No movements match this criteria."}
          />
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
