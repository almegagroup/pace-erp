/*
 * File-ID: 27.FE-PR12
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: QA confirms actuals and posts stock movement (COR6-Verify).
 *          Also handles Correction Mode for VERIFIED POs.
 */

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { getProcessOrder, verifyProcessOrder } from "./prodApi.js";

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
  PROD_PO_NOT_FOUND:            "Process Order not found.",
  PROD_PO_VERIFY_NOT_ALLOWED:   "Verify is only allowed from FINAL status.",
  PROD_CORRECTION_NOT_ALLOWED:  "Correction mode is only allowed for VERIFIED orders.",
  PROD_MANAGER_OR_SA_REQUIRED:  "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function ProductionPOVerifyPage() {
  const qc = useQueryClient();
  const [poInput, setPoInput] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [verifyLines, setVerifyLines] = useState([]);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [deltaLines, setDeltaLines] = useState([]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleLoad() {
    if (!poInput.trim()) { toast("Enter a Process Order ID.", "error"); return; }
    setLoading(true);
    setOrder(null);
    setVerifyLines([]);
    setDeltaLines([]);
    setCorrectionMode(false);
    try {
      const data = await getProcessOrder(poInput.trim());
      setOrder(data);
      setVerifyLines((data.lines ?? []).map((l) => ({ ...l, confirmed_qty: l.actual_qty ?? l.planned_qty ?? "" })));
      setDeltaLines((data.lines ?? []).map((l) => ({ ...l, delta_qty: "0" })));
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setLoading(false);
    }
  }

  function updateConfirmed(i, val) {
    setVerifyLines((ls) => ls.map((l, idx) => idx === i ? { ...l, confirmed_qty: val } : l));
  }

  function updateDelta(i, val) {
    setDeltaLines((ls) => ls.map((l, idx) => idx === i ? { ...l, delta_qty: val } : l));
  }

  async function handleVerify() {
    if (!order || order.status !== "FINAL") {
      toast("Verify is only allowed from FINAL status.", "error"); return;
    }
    setSaving(true);
    try {
      await verifyProcessOrder(order.id, {
        confirmed_lines: verifyLines.map((l) => ({
          line_id: l.id,
          confirmed_qty: parseFloat(l.confirmed_qty) || 0,
        })),
      });
      toast("Process Order verified. Stock movements posted.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      // Reload
      const updated = await getProcessOrder(order.id);
      setOrder(updated);
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCorrection() {
    if (!order || order.status !== "VERIFIED") {
      toast("Correction mode is only allowed for VERIFIED orders.", "error"); return;
    }
    const anyNonZero = deltaLines.some((l) => parseFloat(l.delta_qty) !== 0);
    if (!anyNonZero) { toast("No delta quantities entered.", "error"); return; }
    setSaving(true);
    try {
      await verifyProcessOrder(order.id, {
        correction: true,
        delta_lines: deltaLines.map((l) => ({
          line_id: l.id,
          delta_qty: parseFloat(l.delta_qty) || 0,
        })),
      });
      toast("Correction applied. Stock movements adjusted.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      const updated = await getProcessOrder(order.id);
      setOrder(updated);
      setDeltaLines((updated.lines ?? []).map((l) => ({ ...l, delta_qty: "0" })));
      setCorrectionMode(false);
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Production PO Verify — PR12"
      subtitle="QA confirms actuals and posts stock movement (COR6-Verify)"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Load Process Order">
        <div className="flex gap-2 items-end max-w-lg">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-slate-600 font-medium">Process Order ID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
              placeholder="Enter PO ID…"
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
      </ErpSectionCard>

      {order && (
        <>
          <ErpSectionCard title="Order Summary">
            <div className="flex items-center gap-6 text-sm flex-wrap">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">PO Number</span>
                <p className="font-mono font-semibold">{order.po_number ?? order.id?.slice(0, 8)}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Type</span>
                <p>{order.prod_type}</p>
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
                <span className="text-slate-400 text-xs block mb-0.5">Planned Qty</span>
                <p className="font-mono">{order.planned_qty_kg} KG</p>
              </div>
            </div>

            {order.status === "VERIFIED" && !correctionMode && (
              <div className="mt-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-sm text-emerald-800 mb-3">
                  This order is <strong>VERIFIED</strong>. Stock movements have been posted. Use Correction Mode to apply qty deltas.
                </div>
                <button
                  onClick={() => setCorrectionMode(true)}
                  className="text-sm px-4 py-1.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-50 transition-colors"
                >
                  Enter Correction Mode
                </button>
              </div>
            )}
          </ErpSectionCard>

          {/* Verify section — only for FINAL */}
          {order.status === "FINAL" && (
            <ErpSectionCard title="Verify Actual Quantities">
              <p className="text-xs text-slate-500 mb-3">
                Confirm actual quantities per RM line. Stock movements (P261 for RM/PM + P231 for FG) will be posted on Verify.
              </p>
              {verifyLines.length === 0 ? (
                <p className="text-slate-400 text-sm">No lines on this order.</p>
              ) : (
                <table className="w-full text-sm border-collapse mb-4">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                      <th className="text-left py-2 px-3 border-b">#</th>
                      <th className="text-left py-2 px-3 border-b">Material</th>
                      <th className="text-right py-2 px-3 border-b">Planned Qty</th>
                      <th className="text-right py-2 px-3 border-b">Actual Qty</th>
                      <th className="text-right py-2 px-3 border-b">Confirmed Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifyLines.map((line, i) => (
                      <tr key={line.id ?? i} className="border-b border-slate-100">
                        <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                        <td className="py-2 px-3">{line.material?.pace_code ?? line.material_id?.slice(0, 8)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-400">{Number(line.planned_qty ?? 0).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">{Number(line.actual_qty ?? 0).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="border border-slate-300 rounded px-2 py-0.5 text-sm font-mono text-right w-32"
                            value={line.confirmed_qty}
                            onChange={(e) => updateConfirmed(i, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button
                onClick={handleVerify}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded transition-colors"
              >
                {saving ? "Verifying…" : "Verify & Post Stock"}
              </button>
            </ErpSectionCard>
          )}

          {/* Correction Mode — only for VERIFIED */}
          {order.status === "VERIFIED" && correctionMode && (
            <ErpSectionCard title="Correction Mode">
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800 mb-4">
                Enter qty deltas (positive = add stock, negative = reduce stock). Zero entries are skipped.
              </div>
              {deltaLines.length === 0 ? (
                <p className="text-slate-400 text-sm">No lines on this order.</p>
              ) : (
                <table className="w-full text-sm border-collapse mb-4">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                      <th className="text-left py-2 px-3 border-b">#</th>
                      <th className="text-left py-2 px-3 border-b">Material</th>
                      <th className="text-right py-2 px-3 border-b">Verified Qty</th>
                      <th className="text-right py-2 px-3 border-b">Delta Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deltaLines.map((line, i) => (
                      <tr key={line.id ?? i} className="border-b border-slate-100">
                        <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                        <td className="py-2 px-3">{line.material?.pace_code ?? line.material_id?.slice(0, 8)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-500">{Number(line.confirmed_qty ?? line.actual_qty ?? 0).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">
                          <input
                            type="number"
                            step="0.001"
                            className="border border-slate-300 rounded px-2 py-0.5 text-sm font-mono text-right w-32"
                            value={line.delta_qty}
                            onChange={(e) => updateDelta(i, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCorrection}
                  disabled={saving}
                  className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded transition-colors"
                >
                  {saving ? "Applying…" : "Apply Correction"}
                </button>
                <button
                  onClick={() => { setCorrectionMode(false); setDeltaLines((order.lines ?? []).map((l) => ({ ...l, delta_qty: "0" }))); }}
                  className="text-slate-500 hover:text-slate-700 text-sm px-4 py-2 rounded border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </ErpSectionCard>
          )}
        </>
      )}
    </ErpScreenScaffold>
  );
}
