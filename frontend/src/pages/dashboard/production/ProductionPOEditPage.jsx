/*
 * File-ID: 27.FE-PR10
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOEditPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Edit Process PO (qty adjustments + machine assignment) when status = QA_APPROVED or BATCH_STARTED.
 */

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { getProcessOrder, updateProcessOrderLines } from "./prodApi.js";

const EDITABLE_STATUSES = ["QA_APPROVED", "BATCH_STARTED"];

const STATUS_COLORS = {
  STANDARD:     "bg-slate-100 text-slate-700",
  QA_APPROVED:  "bg-sky-100 text-sky-700",
  QA_REJECTED:  "bg-rose-100 text-rose-700",
  BATCH_STARTED:"bg-amber-100 text-amber-800",
  FINAL:        "bg-purple-100 text-purple-700",
  VERIFIED:     "bg-emerald-100 text-emerald-700",
  REVERSED:     "bg-slate-100 text-slate-500",
  CANCELLED:    "bg-slate-100 text-slate-500",
};

const ERRORS = {
  PROD_PO_NOT_FOUND:            "Process Order not found.",
  PROD_PO_EDIT_NOT_ALLOWED:     "Editing is only allowed when status is QA_APPROVED or BATCH_STARTED.",
  PROD_MANAGER_OR_SA_REQUIRED:  "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function ProductionPOEditPage() {
  const qc = useQueryClient();
  const [poInput, setPoInput] = useState("");
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [editedLines, setEditedLines] = useState([]);
  const [machineId, setMachineId] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleLoad() {
    if (!poInput.trim()) { toast("Enter a Process Order ID.", "error"); return; }
    setLoading(true);
    setPo(null);
    setEditedLines([]);
    setMachineId("");
    try {
      const data = await getProcessOrder(poInput.trim());
      setPo(data);
      setEditedLines((data.lines ?? []).map((l) => ({ ...l, edited_qty: l.planned_qty ?? "" })));
      setMachineId(data.machine_id ?? "");
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setLoading(false);
    }
  }

  function updateLineQty(i, val) {
    setEditedLines((ls) => ls.map((l, idx) => idx === i ? { ...l, edited_qty: val } : l));
  }

  async function handleSave() {
    if (!po) return;
    if (!EDITABLE_STATUSES.includes(po.status)) {
      toast(`Cannot edit PO with status ${po.status}. Only QA_APPROVED or BATCH_STARTED.`, "error");
      return;
    }
    setSaving(true);
    try {
      await updateProcessOrderLines(po.id, {
        machine_id: machineId || undefined,
        lines: editedLines.map((l) => ({
          line_id: l.id,
          planned_qty: parseFloat(l.edited_qty) || 0,
        })),
      });
      toast("Process Order updated successfully.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      // Reload to get fresh data
      const updated = await getProcessOrder(po.id);
      setPo(updated);
      setEditedLines((updated.lines ?? []).map((l) => ({ ...l, edited_qty: l.planned_qty ?? "" })));
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  const canEdit = po && EDITABLE_STATUSES.includes(po.status);

  return (
    <ErpScreenScaffold
      title="Production PO Edit — PR10"
      subtitle="Edit Process PO qty adjustments and machine assignment"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Load Process Order">
        <div className="flex gap-2 items-end max-w-lg">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-slate-600 font-medium">Process Order ID (UUID or PO Number)</label>
            <input
              className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
              placeholder="Enter PO ID or number…"
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

      {po && (
        <>
          <ErpSectionCard title="PO Header">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">PO Number</span>
                <p className="font-mono font-semibold">{po.po_number ?? po.id?.slice(0, 8)}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Type</span>
                <p className="font-medium">{po.prod_type}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[po.status] ?? ""}`}>
                  {po.status?.replace(/_/g, " ")}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Prodshade</span>
                <p>{po.material?.pace_code ?? po.prodshade_material_id?.slice(0, 8)}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Planned Qty (KG)</span>
                <p className="font-mono">{po.planned_qty_kg}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Batch Number</span>
                <p className="font-mono">{po.batch_number ?? "—"}</p>
              </div>
            </div>

            {!canEdit && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
                This PO cannot be edited in its current status (<strong>{po.status}</strong>). Editing is only allowed when status is QA_APPROVED or BATCH_STARTED.
              </div>
            )}
          </ErpSectionCard>

          {canEdit && (
            <>
              <ErpSectionCard title="Machine Assignment">
                <div className="flex flex-col gap-1 max-w-sm">
                  <label className="text-xs text-slate-600 font-medium">Machine ID</label>
                  <input
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                    placeholder="Machine UUID (optional)"
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                  />
                </div>
              </ErpSectionCard>

              <ErpSectionCard title="RM Line Qty Adjustments">
                {editedLines.length === 0 ? (
                  <p className="text-slate-400 text-sm">No RM lines on this order.</p>
                ) : (
                  <>
                    <table className="w-full text-sm border-collapse mb-4">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                          <th className="text-left py-2 px-3 border-b">#</th>
                          <th className="text-left py-2 px-3 border-b">Material</th>
                          <th className="text-right py-2 px-3 border-b">Original Qty</th>
                          <th className="text-right py-2 px-3 border-b">Adjusted Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editedLines.map((line, i) => (
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
                                className="border border-slate-300 rounded px-2 py-0.5 text-sm font-mono text-right w-28"
                                value={line.edited_qty}
                                onChange={(e) => updateLineQty(i, e.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                      >
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </>
                )}
              </ErpSectionCard>
            </>
          )}
        </>
      )}
    </ErpScreenScaffold>
  );
}
