/*
 * File-ID: 27.FE-PR17
 * File-Path: frontend/src/pages/dashboard/production/BatchReleasePage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Manager releases batch numbers for approved Process POs (calls startBatch endpoint).
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { useMenu } from "../../../context/useMenu.js";
import { listProcessOrders, startBatch } from "./prodApi.js";

const ERRORS = {
  PROD_PO_NOT_FOUND:              "Process Order not found.",
  PROD_PO_BATCH_NOT_ALLOWED:      "Batch release is only allowed for QA_APPROVED orders.",
  PROD_BATCH_SERIES_NOT_FOUND:    "Batch number series not configured for this company/type.",
  PROD_MANAGER_OR_SA_REQUIRED:    "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function BatchReleasePage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [releasingId, setReleasingId] = useState(null);
  const [releasedBatches, setReleasedBatches] = useState({});
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  const ordersQ = useQuery({
    queryKey: ["batch-release-queue", effectiveCompanyId],
    queryFn: () => listProcessOrders({
      company_id: effectiveCompanyId || undefined,
      status: "QA_APPROVED",
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    refetchInterval: 30000,
  });

  async function handleRelease(order) {
    setReleasingId(order.id);
    try {
      const result = await startBatch(order.id);
      const batchNumber = result?.batch_number ?? "—";
      setReleasedBatches((prev) => ({ ...prev, [order.id]: batchNumber }));
      toast(`Batch ${batchNumber} released for PO ${order.po_number ?? order.id?.slice(0, 8)}.`);
      qc.invalidateQueries({ queryKey: ["batch-release-queue"] });
      qc.invalidateQueries({ queryKey: ["process-orders"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setReleasingId(null);
    }
  }

  const orders = ordersQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="Batch Release — PR17"
      subtitle="Manager releases batch numbers for QA_APPROVED Process Orders"
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="w-72">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
              hint=""
            />
          </div>
          <div className="text-xs text-slate-400 pb-1">
            Showing QA_APPROVED orders — auto-refreshes every 30 seconds
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Pending Batch Release (${orders.length})`}>
        {!effectiveCompanyId ? (
          <p className="text-slate-400 text-sm py-4 text-center">Select a company to view pending batch releases.</p>
        ) : ordersQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-slate-500 text-sm">No QA_APPROVED orders pending batch release.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">PO Number</th>
                <th className="text-left py-2 px-3 border-b">Type</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-right py-2 px-3 border-b">Planned Qty (KG)</th>
                <th className="text-left py-2 px-3 border-b">QA Approved At</th>
                <th className="text-center py-2 px-3 border-b">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const released = releasedBatches[o.id];
                const isReleasing = releasingId === o.id;

                return (
                  <tr key={o.id} className={`border-b border-slate-100 ${released ? "bg-emerald-50" : "hover:bg-sky-50"} transition-colors`}>
                    <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number ?? o.id?.slice(0, 8)}</td>
                    <td className="py-2 px-3">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{o.prod_type}</span>
                    </td>
                    <td className="py-2 px-3">{o.material?.pace_code ?? o.prodshade_material_id?.slice(0, 8)}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{o.stroke?.stroke_number ?? "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{Number(o.planned_qty_kg ?? 0).toLocaleString()}</td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{o.qa_approved_at?.slice(0, 16)?.replace("T", " ") ?? "—"}</td>
                    <td className="py-2 px-3 text-center">
                      {released ? (
                        <span className="text-emerald-700 font-mono text-xs font-semibold">
                          Batch: {released}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRelease(o)}
                          disabled={isReleasing || releasingId !== null}
                          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1 rounded transition-colors"
                        >
                          {isReleasing ? "Releasing…" : "Release Batch"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
