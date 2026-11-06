/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/GstInclusiveBackfillModal.jsx
 * Purpose: One-time correction of GRNs posted against a GST-INCLUSIVE PO before GRN started netting GST
 *          (stock value and AC01 carried GST twice). "Check" is a dry run listing every affected material; "Apply" corrects
 *          ONE material (all its GRNs, then the RM -> SFG -> FG cascade) and can be repeated safely.
 * Authority: Frontend
 */
import { useState } from "react";
import ModalBase from "../../../../components/layer/ModalBase.jsx";
import { grnGstInclusiveBackfill } from "../procurementApi.js";

const money = (value) => Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GstInclusiveBackfillModal({ visible, onClose }) {
  const [checking, setChecking] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [plan, setPlan] = useState(null);
  const [results, setResults] = useState({});
  const [error, setError] = useState("");

  async function check() {
    setChecking(true);
    setError("");
    try {
      setPlan(await grnGstInclusiveBackfill({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "GST_BACKFILL_FAILED");
    } finally {
      setChecking(false);
    }
  }

  async function apply(row) {
    if (!window.confirm(`Correct ${row.grns} GRN(s) of ${row.material}?\nStock value changes by ${money(row.value_change)} and every later SFG/FG cost that used it is recalculated. This takes a while - keep this window open.`)) return;
    setApplyingId(row.material_id);
    setError("");
    try {
      const res = await grnGstInclusiveBackfill({ apply: true, material_id: row.material_id });
      setResults((current) => ({ ...current, [row.material_id]: res }));
      setPlan(await grnGstInclusiveBackfill({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "GST_BACKFILL_FAILED");
    } finally {
      setApplyingId("");
    }
  }

  const materials = plan?.materials ?? [];
  return (
    <ModalBase
      visible={visible}
      eyebrow="AC01"
      title="GST-inclusive GRN correction"
      onEscape={onClose}
      actions={(
        <>
          <button type="button" onClick={onClose} className="border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700">Close</button>
          <button type="button" onClick={() => void check()} disabled={checking || Boolean(applyingId)} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
            {checking ? "Checking..." : "Check (dry run)"}
          </button>
        </>
      )}
    >
      <div className="grid gap-3 text-sm text-slate-700">
        <p>
          GRNs received against a GST-<b>inclusive</b> PO were valued at the PO rate with the GST still inside it, and AC01 then added GST again.
          Check lists what would change; Apply corrects one material at a time (its stock value and every SFG/FG cost built on it). Safe to repeat.
        </p>
        {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{error}</p> : null}
        {plan && materials.length === 0 ? <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">Nothing left to correct.</p> : null}
        {materials.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-200 px-2 py-1">Material</th>
                  <th className="border border-slate-200 px-2 py-1 text-right">GRNs</th>
                  <th className="border border-slate-200 px-2 py-1 text-right">Qty</th>
                  <th className="border border-slate-200 px-2 py-1 text-right">Value change (₹)</th>
                  <th className="border border-slate-200 px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {materials.map((row) => (
                  <tr key={row.material_id}>
                    <td className="border border-slate-200 px-2 py-1">{row.material}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right" title={(row.grn_numbers ?? []).join(", ")}>{row.grns}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right">{Number(row.quantity_base).toLocaleString("en-IN")} {row.base_uom_code}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right">{money(row.value_change)}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right">
                      <button type="button" onClick={() => void apply(row)} disabled={Boolean(applyingId)} className="border border-sky-700 bg-sky-100 px-3 py-1 font-semibold text-sky-950 disabled:opacity-50">
                        {applyingId === row.material_id ? "Applying..." : "Apply"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Total: {plan.total?.grns} GRN(s), value change ₹{money(plan.total?.value_change)}.</p>
          </div>
        ) : null}
        {Object.values(results).map((res) => (
          <p key={res.material} className={`px-3 py-2 text-xs ${res.failed > 0 ? "border border-amber-200 bg-amber-50 text-amber-900" : "border border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {res.material}: corrected {res.corrected} GRN(s), value change ₹{money(res.value_change)}
            {res.failed > 0 ? `; ${res.failed} not corrected (${(res.failed_grns ?? []).join(", ")}) - Check again and re-apply` : ""}
            {(res.cascade_errors ?? []).length > 0 ? `; ${(res.cascade_errors ?? []).length} downstream step(s) reported an error` : ""}.
          </p>
        ))}
      </div>
    </ModalBase>
  );
}
