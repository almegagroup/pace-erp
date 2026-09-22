/*
 * File-ID: 27.FE-PR13
 * File-Path: frontend/src/pages/dashboard/production/OrderListPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Combined production order list.
 * Authority: Frontend
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { listPackingOrders, listProcessOrders } from "./prodApi.js";

const PROCESS_STATUS_COLORS = {
  STANDARD: "bg-slate-100 text-slate-700",
  QA_APPROVED: "bg-sky-100 text-sky-700",
  QA_REJECTED: "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-800",
  FINAL: "bg-purple-100 text-purple-700",
  VERIFIED: "bg-emerald-100 text-emerald-700",
  REVERSED: "bg-slate-100 text-slate-500",
  CANCELLED: "bg-slate-100 text-slate-500",
};

const ALL_PROCESS_STATUSES = ["STANDARD", "QA_APPROVED", "QA_REJECTED", "BATCH_STARTED", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];
const TABS = ["Process Orders", "Packing Orders"];
// Process Orders tab covers every production type including INT (no packing
// counterpart); Packing Orders tab's Category filters by the underlying
// source_po_type, which is never INT (INT has no packing stage).
const PROCESS_CATEGORY_OPTIONS = ["ALL", "MTO", "HPS", "MTS", "INT", "MTEST"];
const PACKING_CATEGORY_OPTIONS = ["ALL", "MTO", "HPS", "MTS", "MTEST"];

// MTS Process POs cover a produced batch RANGE (batch_number_from/to +
// number_of_batches), never a single batch_number -- show the range instead
// of a blank cell, for both the Process Order row itself and any Packing
// Order that draws from an MTS-typed parent (same shape as ReversalPage.jsx's
// MTS CORS report and SfgResultRecordingPage.jsx's formatBatchDisplay).
function formatBatchRange(source) {
  if (!source) return "--";
  if (source.batch_number_from && source.batch_number_to) {
    const count = source.number_of_batches ? ` (${source.number_of_batches})` : "";
    return `${source.batch_number_from} to ${source.batch_number_to}${count}`;
  }
  return "--";
}

// A material's human-friendly product name (erp_master.material_master.document_name,
// e.g. "SC Maxmoplast PC 300") is separate from its code-like material_name
// (e.g. "6763HB30000") -- falls back to material_name when not set.
function documentNameLabel(material) {
  return material?.document_name || material?.material_name || "--";
}

// Batch Size generalizes to every po_type: MTS splits planned_qty across
// number_of_batches, everything else is one implicit "batch" (batch size ==
// the whole planned qty) -- same derivation as buildMtsPlanHeader on the
// backend (process_order.handlers.ts), computed client-side here since the
// list endpoint already returns both planned_qty and number_of_batches.
function batchSizeDisplay(order) {
  const totalQty = Number(order.planned_qty ?? 0);
  const numberOfBatches = Number(order.number_of_batches ?? 0);
  const batchSize = numberOfBatches > 0 ? totalQty / numberOfBatches : totalQty;
  return Number.isFinite(batchSize) ? batchSize.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "--";
}

function machineLabel(machine) {
  return [machine?.machine_code, machine?.machine_name].filter(Boolean).join(" - ") || "--";
}

// Packing PO has no stored batch count of its own (only process_order does) --
// every batch number's trailing digits are always the zero-padded serial
// (generateBatchNumber in batch_series.handlers.ts), regardless of company
// numbering_method/prefix, so the count this specific Packing PO covers can
// be derived from its own batch_number_from/to range without a schema change.
function deriveBatchCount(order) {
  if (order.source_po_type !== "MTS") return "1";
  const fromMatch = String(order.batch_number_from ?? "").match(/(\d+)$/);
  const toMatch = String(order.batch_number_to ?? "").match(/(\d+)$/);
  if (!fromMatch || !toMatch) return "--";
  const from = parseInt(fromMatch[1], 10);
  const to = parseInt(toMatch[1], 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "--";
  return String(to - from + 1);
}

function StatusChips({ selected, onToggle, statuses, colors }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((status) => (
        <button
          key={status}
          onClick={() => onToggle(status)}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
            selected === status
              ? `${colors[status] ?? "bg-slate-100 text-slate-700"} border-transparent shadow-sm`
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          }`}
        >
          {status.replace(/_/g, " ")}
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
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  function switchTab(index) {
    setActiveTab(index);
    // Category options differ per tab (INT has no packing stage) -- reset
    // rather than carry a selection that may not exist in the new tab's list.
    setCategoryFilter("ALL");
  }

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const processQ = useQuery({
    queryKey: ["process-orders", effectiveCompanyId, processStatus],
    queryFn: () => listProcessOrders({
      company_id: effectiveCompanyId || undefined,
      status: processStatus || undefined,
      per_page: 100,
    }),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    enabled: activeTab === 0 && Boolean(effectiveCompanyId),
  });

  const packingQ = useQuery({
    queryKey: ["packing-orders", effectiveCompanyId, packingStatus],
    queryFn: () => listPackingOrders({
      company_id: effectiveCompanyId || undefined,
      status: packingStatus || undefined,
    }),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    enabled: activeTab === 1 && Boolean(effectiveCompanyId),
  });

  // Category dropdown narrows by production type first, then Quick Search
  // further filters whatever remains -- same two-stage pattern as
  // QAQueuePage.jsx's SFG Category + Quick Search (categoryFilteredQueue ->
  // filteredQueue). Both stages are client-side since neither list endpoint
  // supports cross-column search server-side.
  const searchNeedle = search.trim().toLowerCase();
  const categoryFilteredProcessOrders = (processQ.data ?? []).filter(
    (order) => categoryFilter === "ALL" || order.po_type === categoryFilter,
  );
  const processOrders = categoryFilteredProcessOrders.filter((order) => {
    if (!searchNeedle) return true;
    const haystack = [
      order.po_number, order.po_type, order.material?.material_name, order.material?.pace_code,
      order.material?.document_name, order.material?.external_code, order.planned_qty,
      order.batch_number, order.machine?.machine_code, order.machine?.machine_name,
      order.status, order.created_at?.slice(0, 10),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(searchNeedle);
  });
  const categoryFilteredPackingOrders = (packingQ.data ?? []).filter(
    (order) => categoryFilter === "ALL" || order.source_po_type === categoryFilter,
  );
  const packingOrders = categoryFilteredPackingOrders.filter((order) => {
    if (!searchNeedle) return true;
    const haystack = [
      order.po_number, order.material?.material_name, order.material?.pace_code, order.material?.document_name,
      order.material?.external_code, order.pack_code?.pack_code, order.machine?.machine_code, order.machine?.machine_name,
      order.num_packs, order.fill_qty_per_pack, order.planned_qty_kg, order.actual_qty_kg,
      order.process_order?.po_number, order.process_order?.batch_number, order.status,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(searchNeedle);
  });

  return (
    <ErpScreenScaffold
      title="Order List - PR13"
      subtitle="Combined production order list"
    >
      <ErpSectionCard title="Filters">
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[240px] flex-col gap-1">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Category</label>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-9 rounded border border-slate-300 px-2 text-sm"
            >
              {(activeTab === 0 ? PROCESS_CATEGORY_OPTIONS : PACKING_CATEGORY_OPTIONS).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[280px] flex-1">
            <QuickFilterInput
              label="Quick Search"
              value={search}
              onChange={setSearch}
              placeholder="Search PO number, prodshade/SKU, batch, status..."
              hint="Matches any column in whichever tab is open below."
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => switchTab(index)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && (
          <>
            <div className="mb-4">
              <p className="mb-1.5 text-xs text-slate-500">Quick filter by status:</p>
              <StatusChips
                selected={processStatus}
                onToggle={(status) => setProcessStatus((current) => current === status ? "" : status)}
                statuses={ALL_PROCESS_STATUSES}
                colors={PROCESS_STATUS_COLORS}
              />
            </div>
            {processQ.isLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
            ) : processOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No process orders found.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">PO Number</th>
                    <th className="border-b px-3 py-2 text-left">Type</th>
                    <th className="border-b px-3 py-2 text-left">Prodshade</th>
                    <th className="border-b px-3 py-2 text-left">Document Name</th>
                    <th className="border-b px-3 py-2 text-left">Machine</th>
                    <th className="border-b px-3 py-2 text-right">Planned Qty</th>
                    <th className="border-b px-3 py-2 text-left">Batch Range</th>
                    <th className="border-b px-3 py-2 text-right">Number of Batches</th>
                    <th className="border-b px-3 py-2 text-right">Batch Size</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                    <th className="border-b px-3 py-2 text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {processOrders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-sky-700">{order.po_number || "--"}</td>
                      <td className="px-3 py-2">{order.po_type || "--"}</td>
                      <td className="px-3 py-2">{[order.material?.pace_code, order.material?.material_name].filter(Boolean).join(" - ") || "--"}</td>
                      <td className="px-3 py-2">{documentNameLabel(order.material)}</td>
                      <td className="px-3 py-2">{machineLabel(order.machine)}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(order.planned_qty || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{order.po_type === "MTS" ? formatBatchRange(order) : (order.batch_number || "--")}</td>
                      <td className="px-3 py-2 text-right font-mono">{order.number_of_batches || "1"}</td>
                      <td className="px-3 py-2 text-right font-mono">{batchSizeDisplay(order)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROCESS_STATUS_COLORS[order.status] ?? ""}`}>
                          {order.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{order.created_at?.slice(0, 10) || "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 1 && (
          <>
            <div className="mb-4">
              <p className="mb-1.5 text-xs text-slate-500">Quick filter by status:</p>
              <StatusChips
                selected={packingStatus}
                onToggle={(status) => setPackingStatus((current) => current === status ? "" : status)}
                statuses={["STANDARD", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"]}
                colors={PROCESS_STATUS_COLORS}
              />
            </div>
            {packingQ.isLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
            ) : packingOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No packing orders found.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">PO Number</th>
                    <th className="border-b px-3 py-2 text-left">SKU</th>
                    <th className="border-b px-3 py-2 text-left">Document Name</th>
                    <th className="border-b px-3 py-2 text-left">Machine</th>
                    <th className="border-b px-3 py-2 text-right">Num Packs</th>
                    <th className="border-b px-3 py-2 text-right">Fill Qty / Pack</th>
                    <th className="border-b px-3 py-2 text-right">Total Qty</th>
                    <th className="border-b px-3 py-2 text-left">Batch Number Range</th>
                    <th className="border-b px-3 py-2 text-right">Number of Batches</th>
                    <th className="border-b px-3 py-2 text-left">Linked Process PO</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {packingOrders.map((order) => {
                    const isFinalized = order.status && order.status !== "STANDARD" && order.status !== "CANCELLED";
                    const totalQty = Number(order.actual_qty_kg) || Number(order.planned_qty_kg) || 0;
                    return (
                    <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-sky-700">{order.po_number || "--"}</td>
                      <td className="px-3 py-2">{[order.material?.pace_code, order.material?.material_name].filter(Boolean).join(" - ") || "--"}</td>
                      <td className="px-3 py-2">{documentNameLabel(order.material)}</td>
                      <td className="px-3 py-2">{machineLabel(order.machine)}</td>
                      <td className="px-3 py-2 text-right font-mono">{order.num_packs != null ? Number(order.num_packs).toLocaleString() : "--"}</td>
                      <td className="px-3 py-2 text-right font-mono">{order.fill_qty_per_pack != null ? Number(order.fill_qty_per_pack).toLocaleString() : "--"}</td>
                      <td className="px-3 py-2 text-right font-mono">{totalQty.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {isFinalized ? (order.source_po_type === "MTS" ? formatBatchRange(order.process_order) : (order.process_order?.batch_number || "--")) : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{deriveBatchCount(order)}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{order.process_order?.po_number || "--"}</td>
                      <td className="px-3 py-2">{order.status || "--"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
