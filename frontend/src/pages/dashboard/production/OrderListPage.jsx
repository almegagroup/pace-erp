/*
 * File-ID: 27.FE-PR13
 * File-Path: frontend/src/pages/dashboard/production/OrderListPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Combined Process PO + Packing PO list (COID — main production order list).
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { listProcessOrders, listPackingOrders } from "./prodApi.js";

const PROCESS_STATUS_COLORS = {
  STANDARD:      "bg-slate-100 text-slate-700",
  QA_APPROVED:   "bg-sky-100 text-sky-700",
  QA_REJECTED:   "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-800",
  FINAL:         "bg-purple-100 text-purple-700",
  VERIFIED:      "bg-emerald-100 text-emerald-700",
  REVERSED:      "bg-slate-100 text-slate-500",
  CANCELLED:     "bg-slate-100 text-slate-500",
};

const ALL_PROCESS_STATUSES = ["STANDARD", "QA_APPROVED", "QA_REJECTED", "BATCH_STARTED", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];
const TABS = ["Process Orders", "Packing Orders"];

function StatusChips({ selected, onToggle, statuses, colors }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {statuses.map((s) => (
        <button
          key={s}
          onClick={() => onToggle(s)}
          className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-all ${
            selected === s
              ? (colors[s] ?? "bg-slate-100 text-slate-700") + " border-transparent shadow-sm"
              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
          }`}
        >
          {s.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}

export default function OrderListPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [processStatus, setProcessStatus] = useState("");
  const [packingStatus, setPackingStatus] = useState("");

  const processQ = useQuery({
    queryKey: ["process-orders", companyId, processStatus, search],
    queryFn: () => listProcessOrders({
      company_id: companyId || undefined,
      status: processStatus || undefined,
      search: search || undefined,
    }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: activeTab === 0,
  });

  const packingQ = useQuery({
    queryKey: ["packing-orders", companyId, packingStatus, search],
    queryFn: () => listPackingOrders({
      company_id: companyId || undefined,
      status: packingStatus || undefined,
      search: search || undefined,
    }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: activeTab === 1,
  });

  function toggleProcessStatus(s) {
    setProcessStatus((cur) => cur === s ? "" : s);
  }

  function togglePackingStatus(s) {
    setPackingStatus((cur) => cur === s ? "" : s);
  }

  const processOrders = processQ.data ?? [];
  const packingOrders = packingQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="Order List — PR13"
      subtitle="Combined Process PO and Packing PO list (COID)"
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1 text-sm w-56"
              placeholder="Filter by company…"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Search</label>
            <input
              className="border border-slate-300 rounded px-2 py-1 text-sm w-56"
              placeholder="PO number, batch, prodshade…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard>
        {/* Tab Bar */}
        <div className="flex gap-0 border-b border-slate-200 mb-4">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === i
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Process Orders */}
        {activeTab === 0 && (
          <>
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1.5">Quick filter by status:</p>
              <StatusChips
                selected={processStatus}
                onToggle={toggleProcessStatus}
                statuses={ALL_PROCESS_STATUSES}
                colors={PROCESS_STATUS_COLORS}
              />
            </div>
            {processQ.isLoading ? (
              <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
            ) : processOrders.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center">No process orders found.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="text-left py-2 px-3 border-b">PO Number</th>
                    <th className="text-left py-2 px-3 border-b">Type</th>
                    <th className="text-left py-2 px-3 border-b">Prodshade</th>
                    <th className="text-right py-2 px-3 border-b">Planned Qty (KG)</th>
                    <th className="text-left py-2 px-3 border-b">Batch #</th>
                    <th className="text-left py-2 px-3 border-b">Status</th>
                    <th className="text-left py-2 px-3 border-b">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {processOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50 border-b border-slate-100">
                      <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number ?? o.id?.slice(0, 8)}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{o.prod_type}</span>
                      </td>
                      <td className="py-2 px-3">{o.material?.pace_code ?? o.prodshade_material_id?.slice(0, 8)}</td>
                      <td className="py-2 px-3 text-right font-mono">{Number(o.planned_qty_kg ?? 0).toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono text-slate-500">{o.batch_number ?? "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PROCESS_STATUS_COLORS[o.status] ?? ""}`}>
                          {o.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-xs">{o.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* Packing Orders */}
        {activeTab === 1 && (
          <>
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1.5">Quick filter by status:</p>
              <StatusChips
                selected={packingStatus}
                onToggle={togglePackingStatus}
                statuses={["STANDARD", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"]}
                colors={PROCESS_STATUS_COLORS}
              />
            </div>
            {packingQ.isLoading ? (
              <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
            ) : packingOrders.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center">No packing orders found.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="text-left py-2 px-3 border-b">PO Number</th>
                    <th className="text-left py-2 px-3 border-b">Process PO Ref</th>
                    <th className="text-left py-2 px-3 border-b">Pack Code Config</th>
                    <th className="text-right py-2 px-3 border-b">Planned Qty (KG)</th>
                    <th className="text-left py-2 px-3 border-b">FO Ref</th>
                    <th className="text-left py-2 px-3 border-b">Status</th>
                    <th className="text-left py-2 px-3 border-b">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {packingOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50 border-b border-slate-100">
                      <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number ?? o.id?.slice(0, 8)}</td>
                      <td className="py-2 px-3 font-mono text-slate-500">{o.process_order_id?.slice(0, 8)}</td>
                      <td className="py-2 px-3 text-slate-500">{o.pack_code_config_id?.slice(0, 8)}</td>
                      <td className="py-2 px-3 text-right font-mono">{Number(o.planned_qty_kg ?? 0).toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{o.fo_id ? o.fo_id.slice(0, 8) : "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PROCESS_STATUS_COLORS[o.status] ?? ""}`}>
                          {o.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-xs">{o.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
