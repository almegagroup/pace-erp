/*
 * File-ID: 27.FE-PR15
 * File-Path: frontend/src/pages/dashboard/production/ReversalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Reverse a Process PO or Packing PO from any status back toward STANDARD (CORS).
 */

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { getProcessOrder, reverseProcessOrder, getPackingOrder, reversePackingOrder } from "./prodApi.js";

const STATUS_COLORS = {
  STANDARD:      "bg-slate-100 text-slate-700",
  QA_APPROVED:   "bg-sky-100 text-sky-700",
  QA_REJECTED:   "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-800",
  FINAL:         "bg-purple-100 text-purple-700",
  VERIFIED:      "bg-emerald-100 text-emerald-700",
  REVERSED:      "bg-slate-100 text-slate-500",
  CANCELLED:     "bg-slate-100 text-slate-500",
};

const REVERSAL_DESCRIPTIONS = {
  QA_APPROVED:   "Reversal will move PO back to STANDARD status.",
  QA_REJECTED:   "Reversal will move PO back to STANDARD status.",
  BATCH_STARTED: "Reversal will move PO back to QA_APPROVED status. Batch number will be cleared.",
  FINAL:         "Reversal will move PO back to BATCH_STARTED status. Actual quantities will be cleared.",
  VERIFIED:      "Reversal will move PO back to FINAL status and REVERSE all posted stock movements (P261/P231).",
};

const ERRORS = {
  PROD_PO_NOT_FOUND:              "Order not found.",
  PROD_PO_REVERSAL_NOT_ALLOWED:   "This order cannot be reversed from its current status.",
  PROD_PO_ACTIVE_PACKING_EXISTS:  "Cannot reverse Process PO — active Packing POs are linked.",
  PROD_MANAGER_OR_SA_REQUIRED:    "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const TABS = ["Process PO", "Packing PO"];

function ReversalPanel({ label, fetcher, reverser, qKey }) {
  const qc = useQueryClient();
  const [poInput, setPoInput] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleLoad() {
    if (!poInput.trim()) { toast("Enter an order ID.", "error"); return; }
    setLoading(true);
    setOrder(null);
    setReason("");
    setConfirmed(false);
    try {
      const data = await fetcher(poInput.trim());
      setOrder(data);
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleReverse() {
    if (!order) return;
    if (!reason.trim()) { toast("Reversal reason is required.", "error"); return; }
    setSaving(true);
    try {
      await reverser(order.id, { reason: reason.trim() });
      toast(`${label} reversed successfully.`);
      qc.invalidateQueries({ queryKey: [qKey] });
      setOrder(null);
      setPoInput("");
      setReason("");
      setConfirmed(false);
    } catch (err) {
      toast(friendly(err.message), "error");
      setConfirmed(false);
    } finally {
      setSaving(false);
    }
  }

  const isReversible = order && !["STANDARD", "REVERSED", "CANCELLED"].includes(order.status);
  const reversalDesc = order ? REVERSAL_DESCRIPTIONS[order.status] : null;

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
        <div className="flex flex-col gap-4 max-w-xl">
          <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded p-4 text-sm">
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Order Number</span>
              <p className="font-mono font-semibold">{order.po_number ?? order.id?.slice(0, 8)}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Current Status</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] ?? ""}`}>
                {order.status?.replace(/_/g, " ")}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Type</span>
              <p>{order.prod_type ?? "—"}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs block mb-0.5">Batch Number</span>
              <p className="font-mono">{order.batch_number ?? "—"}</p>
            </div>
          </div>

          {!isReversible && (
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm text-slate-600">
              This order is in <strong>{order.status}</strong> status and cannot be reversed.
            </div>
          )}

          {isReversible && (
            <>
              {reversalDesc && (
                <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
                  <strong>What reversal will do:</strong> {reversalDesc}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Reason for Reversal <span className="text-rose-500">*</span></label>
                <textarea
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm resize-none"
                  rows={3}
                  placeholder="Mandatory: explain why this order is being reversed…"
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); setConfirmed(false); }}
                />
              </div>

              {!confirmed ? (
                <button
                  onClick={() => {
                    if (!reason.trim()) { toast("Reason is required before confirming.", "error"); return; }
                    setConfirmed(true);
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-5 py-2 rounded transition-colors w-fit"
                >
                  Reverse {label}
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="bg-rose-100 border border-rose-300 rounded p-3 text-sm text-rose-900 font-medium">
                    Are you sure? This action will reverse the order and cannot be undone directly.
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReverse}
                      disabled={saving}
                      className="bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded transition-colors"
                    >
                      {saving ? "Reversing…" : "Confirm Reversal"}
                    </button>
                    <button
                      onClick={() => setConfirmed(false)}
                      className="text-slate-500 hover:text-slate-700 text-sm px-4 py-2 rounded border border-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReversalPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <ErpScreenScaffold
      title="Reversal — PR15"
      subtitle="Reverse a Process PO or Packing PO back toward STANDARD (CORS)"
    >
      <ErpSectionCard>
        <div className="flex gap-0 border-b border-slate-200 mb-6">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === i
                  ? "border-rose-600 text-rose-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && (
          <ReversalPanel
            label="Process Order"
            fetcher={getProcessOrder}
            reverser={reverseProcessOrder}
            qKey="process-orders"
          />
        )}
        {activeTab === 1 && (
          <ReversalPanel
            label="Packing Order"
            fetcher={getPackingOrder}
            reverser={reversePackingOrder}
            qKey="packing-orders"
          />
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
