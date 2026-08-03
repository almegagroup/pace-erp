/*
 * File-ID: 27.FE-06
 * File-Path: frontend/src/pages/dashboard/production/OrderOverviewPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Combined production overview — Process Orders + linked Packing Orders,
 *          batch drill-down, FO links, status at a glance.
 *          Read-only dashboard; navigate to dedicated pages to act.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { listProcessOrders, listPackingOrders } from "./prodApi.js";

const PO_STATUS_COLORS = {
  STANDARD:      "bg-slate-100 text-slate-700",
  QA_APPROVED:   "bg-sky-100 text-sky-700",
  QA_REJECTED:   "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-700",
  FINAL:         "bg-purple-100 text-purple-700",
  VERIFIED:      "bg-emerald-100 text-emerald-700",
  REVERSED:      "bg-gray-100 text-gray-500",
};

const PACK_STATUS_COLORS = {
  STANDARD: "bg-slate-100 text-slate-700",
  FINAL:    "bg-emerald-100 text-emerald-700",
  REVERSED: "bg-gray-100 text-gray-500",
};

function Badge({ status, colorMap }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}

const ACTIVE_STATUS_OPTIONS = ["", "STANDARD", "QA_APPROVED", "BATCH_STARTED", "FINAL", "VERIFIED"];

export default function OrderOverviewPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [poStatus, setPoStatus]   = useState("");
  const [expanded, setExpanded]   = useState(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const processQ = useQuery({
    queryKey: ["overview-proc", effectiveCompanyId, poStatus],
    queryFn: () => listProcessOrders({
      company_id: effectiveCompanyId || undefined,
      status: poStatus || undefined,
      per_page: 100,
    }),
    enabled: Boolean(effectiveCompanyId),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });

  const packQ = useQuery({
    queryKey: ["overview-pack", effectiveCompanyId],
    queryFn: () => listPackingOrders({ company_id: effectiveCompanyId || undefined, per_page: 200 }),
    enabled: Boolean(effectiveCompanyId),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });

  const processOrders = processQ.data ?? [];
  const packingOrders = packQ.data ?? [];

  // Group packing orders by process_order_id
  const packByProcess = packingOrders.reduce((acc, po) => {
    const key = po.process_order_id;
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(po);
    return acc;
  }, {});

  // Summary counts
  const counts = {
    STANDARD:      processOrders.filter(o => o.status === "STANDARD").length,
    QA_APPROVED:   processOrders.filter(o => o.status === "QA_APPROVED").length,
    BATCH_STARTED: processOrders.filter(o => o.status === "BATCH_STARTED").length,
    FINAL:         processOrders.filter(o => o.status === "FINAL").length,
    VERIFIED:      processOrders.filter(o => o.status === "VERIFIED").length,
  };

  return (
    <ErpScreenScaffold
      title="Order Overview"
      subtitle="Production pipeline — Process Orders with linked Packing Orders"
    >
      {/* Filter bar */}
      <ErpSectionCard>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="w-72">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
              hint=""
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Process Order Status</label>
            <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={poStatus} onChange={e => setPoStatus(e.target.value)}>
              {ACTIVE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </div>
        </div>
      </ErpSectionCard>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Object.entries(counts).map(([status, count]) => (
          <button
            key={status}
            onClick={() => setPoStatus(status === poStatus ? "" : status)}
            className={`rounded-lg border p-3 text-left transition-all ${poStatus === status ? "border-sky-400 bg-sky-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
          >
            <p className="text-2xl font-bold text-slate-800">{count}</p>
            <p className="text-xs text-slate-500 mt-0.5">{status.replace(/_/g, " ")}</p>
          </button>
        ))}
      </div>

      {/* Main Table */}
      <ErpSectionCard title={`Process Orders${processOrders.length ? ` (${processOrders.length})` : ""}`}>
        {!effectiveCompanyId ? (
          <p className="text-slate-400 text-sm py-6 text-center">Select a company to view the order overview.</p>
        ) : processQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading…</p>
        ) : processOrders.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No orders found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[750px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left py-2 px-3 border-b w-8"></th>
                  <th className="text-left py-2 px-3 border-b">Process PO #</th>
                  <th className="text-left py-2 px-3 border-b">Type</th>
                  <th className="text-left py-2 px-3 border-b">Batch #</th>
                  <th className="text-right py-2 px-3 border-b">Planned KG</th>
                  <th className="text-right py-2 px-3 border-b">Actual KG</th>
                  <th className="text-center py-2 px-3 border-b">Pack Orders</th>
                  <th className="text-left py-2 px-3 border-b">Status</th>
                </tr>
              </thead>
              <tbody>
                {processOrders.map(po => {
                  const packs = packByProcess[po.id] ?? [];
                  const isExpanded = expanded === po.id;
                  return (
                    <React.Fragment key={po.id}>
                      <tr
                        className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${isExpanded ? "bg-sky-50" : ""}`}
                        onClick={() => setExpanded(isExpanded ? null : po.id)}
                      >
                        <td className="py-2 px-3 text-slate-400 text-xs">
                          {packs.length > 0 ? (isExpanded ? "▼" : "▶") : ""}
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold text-sky-700">{po.po_number}</td>
                        <td className="py-2 px-3">
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{po.production_type}</span>
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-500">{po.batch_number ?? "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{Number(po.planned_qty).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-700">{po.actual_qty != null ? Number(po.actual_qty).toLocaleString() : "—"}</td>
                        <td className="py-2 px-3 text-center">
                          {packs.length > 0 ? (
                            <span className="text-xs font-mono font-semibold text-sky-600">{packs.length}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3"><Badge status={po.status} colorMap={PO_STATUS_COLORS} /></td>
                      </tr>

                      {/* Expanded packing orders */}
                      {isExpanded && packs.map(pack => (
                        <tr key={pack.id} className="border-b border-slate-100 bg-sky-50">
                          <td className="py-1.5 px-3"></td>
                          <td className="py-1.5 px-3 pl-8">
                            <span className="text-xs text-slate-400 mr-1">↳</span>
                            <span className="font-mono text-xs font-medium text-sky-600">{pack.po_number}</span>
                          </td>
                          <td className="py-1.5 px-3 text-xs text-slate-500">Pack</td>
                          <td className="py-1.5 px-3 text-xs font-mono text-slate-400">{pack.fo_id ? pack.fo_id.slice(0, 8) + "…" : "No FO"}</td>
                          <td className="py-1.5 px-3 text-right text-xs font-mono">{Number(pack.planned_qty_kg).toLocaleString()}</td>
                          <td className="py-1.5 px-3 text-right text-xs font-mono text-emerald-700">{pack.total_qty_kg != null ? Number(pack.total_qty_kg).toLocaleString() : "—"}</td>
                          <td></td>
                          <td className="py-1.5 px-3"><Badge status={pack.status} colorMap={PACK_STATUS_COLORS} /></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
