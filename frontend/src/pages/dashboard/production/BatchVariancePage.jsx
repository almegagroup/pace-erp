/*
 * File-ID: 27.FE-PR14
 * File-Path: frontend/src/pages/dashboard/production/BatchVariancePage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Report on variance between planned and actual batch quantities.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { listProcessOrders } from "./prodApi.js";

function varianceColor(variance) {
  if (variance === 0) return "text-emerald-600";
  if (variance > 0) return "text-amber-600";
  return "text-rose-600";
}

function varianceBg(variance) {
  if (variance === 0) return "bg-emerald-50";
  if (variance > 0) return "bg-amber-50";
  return "bg-rose-50";
}

export default function BatchVariancePage() {
  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const ordersQ = useQuery({
    queryKey: ["batch-variance", companyId, dateFrom, dateTo],
    queryFn: () => listProcessOrders({
      company_id: companyId || undefined,
      status: "VERIFIED",
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  const orders = ordersQ.data ?? [];

  // Compute variance stats
  const stats = orders.reduce((acc, o) => {
    const planned = parseFloat(o.planned_qty_kg ?? 0);
    const actual = parseFloat(o.actual_qty_kg ?? o.actual_output_kg ?? 0);
    const variance = actual - planned;
    return {
      count: acc.count + 1,
      totalPlanned: acc.totalPlanned + planned,
      totalActual: acc.totalActual + actual,
      totalVariance: acc.totalVariance + variance,
      overCount: acc.overCount + (variance > 0 ? 1 : 0),
      underCount: acc.underCount + (variance < 0 ? 1 : 0),
    };
  }, { count: 0, totalPlanned: 0, totalActual: 0, totalVariance: 0, overCount: 0, underCount: 0 });

  return (
    <ErpScreenScaffold
      title="Batch Variance — PR14"
      subtitle="Planned vs. actual qty variance for VERIFIED process orders"
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
            <label className="text-xs text-slate-500">Date From</label>
            <input
              type="date"
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Date To</label>
            <input
              type="date"
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </ErpSectionCard>

      {/* Summary Stats */}
      {orders.length > 0 && (
        <ErpSectionCard title="Summary">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 rounded p-3 text-center">
              <p className="text-2xl font-bold text-slate-700">{stats.count}</p>
              <p className="text-xs text-slate-500 mt-0.5">Batches</p>
            </div>
            <div className="bg-amber-50 rounded p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">{stats.overCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">Over-produced</p>
            </div>
            <div className="bg-rose-50 rounded p-3 text-center">
              <p className="text-2xl font-bold text-rose-700">{stats.underCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">Under-produced</p>
            </div>
            <div className={`rounded p-3 text-center ${varianceBg(stats.totalVariance)}`}>
              <p className={`text-2xl font-bold ${varianceColor(stats.totalVariance)}`}>
                {stats.totalVariance >= 0 ? "+" : ""}{stats.totalVariance.toFixed(1)} KG
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Net Variance</p>
            </div>
          </div>
        </ErpSectionCard>
      )}

      <ErpSectionCard title={`Variance Report (${orders.length} VERIFIED orders)`}>
        {ordersQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No verified orders found for the selected filters.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">PO Number</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Batch #</th>
                <th className="text-right py-2 px-3 border-b">Planned (KG)</th>
                <th className="text-right py-2 px-3 border-b">Actual (KG)</th>
                <th className="text-right py-2 px-3 border-b">Variance (KG)</th>
                <th className="text-right py-2 px-3 border-b">Variance %</th>
                <th className="text-left py-2 px-3 border-b">Verified</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const planned = parseFloat(o.planned_qty_kg ?? 0);
                const actual = parseFloat(o.actual_qty_kg ?? o.actual_output_kg ?? 0);
                const variance = actual - planned;
                const variancePct = planned > 0 ? (variance / planned) * 100 : 0;

                return (
                  <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number ?? o.id?.slice(0, 8)}</td>
                    <td className="py-2 px-3">{o.material?.pace_code ?? o.prodshade_material_id?.slice(0, 8)}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{o.batch_number ?? "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{planned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-2 px-3 text-right font-mono">{actual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`py-2 px-3 text-right font-mono font-semibold ${varianceColor(variance)}`}>
                      {variance >= 0 ? "+" : ""}{variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`py-2 px-3 text-right font-mono font-semibold ${varianceColor(variance)}`}>
                      {variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{o.verified_at?.slice(0, 10) ?? o.updated_at?.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={3} className="py-2 px-3 text-right text-slate-500 text-xs">Totals</td>
                <td className="py-2 px-3 text-right font-mono">{stats.totalPlanned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="py-2 px-3 text-right font-mono">{stats.totalActual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={`py-2 px-3 text-right font-mono ${varianceColor(stats.totalVariance)}`}>
                  {stats.totalVariance >= 0 ? "+" : ""}{stats.totalVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
