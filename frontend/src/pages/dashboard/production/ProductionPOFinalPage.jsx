/*
 * File-ID: 27.FE-PR11
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Enter actual quantities for Process or Packing PO (COR6-Final).
 */

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { getProcessOrder, finalizeProcessOrder, getPackingOrder, finalizePackingOrder } from "./prodApi.js";

const STATUS_COLORS = {
  STANDARD:      "bg-slate-100 text-slate-700",
  QA_APPROVED:   "bg-sky-100 text-sky-700",
  QA_REJECTED:   "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-800",
  FINAL:         "bg-purple-100 text-purple-700",
  VERIFIED:      "bg-emerald-100 text-emerald-700",
  REVERSED:      "bg-slate-100 text-slate-500",
};

const ERRORS = {
  PROD_PO_NOT_FOUND:             "Order not found.",
  PROD_PO_FINALIZE_NOT_ALLOWED:  "Finalize is only allowed from BATCH_STARTED status.",
  PROD_PACKING_FINALIZE_NOT_ALLOWED: "Packing PO finalize is only allowed from STANDARD status.",
  PROD_MANAGER_OR_SA_REQUIRED:   "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const TABS = ["Process PO", "Packing PO"];

function LoadAndFinalizePanel({ label, fetcher, finalizer, allowedStatus, qKey }) {
  const qc = useQueryClient();
  const [poInput, setPoInput] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [actualLines, setActualLines] = useState([]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleLoad() {
    if (!poInput.trim()) { toast("Enter an order ID.", "error"); return; }
    setLoading(true);
    setOrder(null);
    setActualLines([]);
    try {
      const data = await fetcher(poInput.trim());
      setOrder(data);
      setActualLines((data.lines ?? []).map((l) => ({ ...l, actual_qty: "" })));
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setLoading(false);
    }
  }

  function updateActual(i, val) {
    setActualLines((ls) => ls.map((l, idx) => idx === i ? { ...l, actual_qty: val } : l));
  }

  async function handleFinalize() {
    if (!order) return;
    if (order.status !== allowedStatus) {
      toast(`Cannot finalize from status ${order.status}. Expected: ${allowedStatus}.`, "error");
      return;
    }
    setSaving(true);
    try {
      await finalizer(order.id, {
        actual_lines: actualLines.map((l) => ({
          line_id: l.id,
          actual_qty: parseFloat(l.actual_qty) || 0,
        })),
      });
      toast(`${label} finalized successfully.`);
      setOrder(null);
      setPoInput("");
      setActualLines([]);
      qc.invalidateQueries({ queryKey: [qKey] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  const canFinalize = order && order.status === allowedStatus;

  return (
    <div className="flex flex-col gap-4">
      {notice.msg && (
        <div className={`rounded px-3 py-2 text-sm ${notice.tone === "error" ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {notice.msg}
        </div>
      )}

      <div className="flex gap-2 items-end max-w-lg">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-slate-600 font-medium">{label} ID</label>
          <input
            className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
            placeholder="Enter order ID…"
            value={poInput}
            onChange={(e) => setPoInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={loading}
          className="bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {order && (
        <>
          <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded p-4 text-sm">
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Order Number</span>
              <p className="font-mono font-semibold">{order.po_number ?? order.id?.slice(0, 8)}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Type</span>
              <p>{order.prod_type ?? "—"}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Status</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] ?? ""}`}>
                {order.status?.replace(/_/g, " ")}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Batch Number</span>
              <p className="font-mono">{order.batch_number ?? "—"}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Planned Qty (KG)</span>
              <p className="font-mono">{order.planned_qty_kg ?? "—"}</p>
            </div>
          </div>

          {!canFinalize && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
              Cannot finalize — current status is <strong>{order.status}</strong>. Expected status: <strong>{allowedStatus}</strong>.
            </div>
          )}

          {canFinalize && (
            <>
              {actualLines.length === 0 ? (
                <p className="text-slate-400 text-sm">No lines on this order.</p>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Actual Quantities</p>
                  <table className="w-full text-sm border-collapse mb-4">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                        <th className="text-left py-2 px-3 border-b">#</th>
                        <th className="text-left py-2 px-3 border-b">Material</th>
                        <th className="text-right py-2 px-3 border-b">Planned Qty</th>
                        <th className="text-right py-2 px-3 border-b">Actual Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actualLines.map((line, i) => (
                        <tr key={line.id ?? i} className="border-b border-slate-100">
                          <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                          <td className="py-2 px-3">{line.material?.pace_code ?? line.material_id?.slice(0, 8)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-500">
                            {Number(line.planned_qty ?? 0).toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              className="border border-slate-300 rounded px-2 py-0.5 text-sm font-mono text-right w-32"
                              placeholder="0.000"
                              value={line.actual_qty}
                              onChange={(e) => updateActual(i, e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                onClick={handleFinalize}
                disabled={saving}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded transition-colors w-fit"
              >
                {saving ? "Finalizing…" : `Finalize ${label}`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function ProductionPOFinalPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <ErpScreenScaffold
      title="Production PO Final — PR11"
      subtitle="Enter actual quantities for Process or Packing PO (COR6-Final)"
    >
      <ErpSectionCard>
        <div className="flex gap-0 border-b border-slate-200 mb-6">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === i
                  ? "border-purple-600 text-purple-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && (
          <LoadAndFinalizePanel
            label="Process Order"
            fetcher={getProcessOrder}
            finalizer={finalizeProcessOrder}
            allowedStatus="BATCH_STARTED"
            qKey="process-orders"
          />
        )}
        {activeTab === 1 && (
          <LoadAndFinalizePanel
            label="Packing Order"
            fetcher={getPackingOrder}
            finalizer={finalizePackingOrder}
            allowedStatus="STANDARD"
            qKey="packing-orders"
          />
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
