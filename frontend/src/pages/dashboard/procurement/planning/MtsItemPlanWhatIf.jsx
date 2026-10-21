/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsItemPlanWhatIf.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 Item Plan helpers (owner 2026-10-21):
 *          - VendorDateCompare: which vendor, which plant date, how much → can it arrive, real lot
 *            (MOQ / multiple), full cost; add it as the user's lot and preview the effect.
 *          - TargetWhatIf: the engine re-plans the item at other Safety (Target) days, compares
 *            risk and money, recommends one; the AI may add a verdict; "Use" saves the days.
 * Authority: Frontend (numbers come from the backend engine only)
 */

import { useState } from "react";
import { getMtsRequirementPolicies, saveMtsRequirementPolicies, whatIfMtsItemPlanTarget } from "../procurementApi.js";
import { pushToast } from "../../../../store/uiToast.js";
import { vendorLotQty } from "./mtsItemPlanLots.js";

const CELL_INPUT = "h-7 border border-sky-300 bg-sky-50 px-1.5 text-xs text-sky-900 outline-none focus:border-sky-600";
const FREIGHT_LABEL = { FOR: "FOR (in price)", FREIGHT_SEPARATE: "Separate (we pay)", EX_TRANSPORTER_GODOWN: "Ex godown (we pay)" };

function fmtQty(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
/** Days are whole, rounded down like the sheet. */
function fmtDays(value) {
  return value === null || value === undefined ? "—" : String(Math.floor(Number(value) + 1e-9));
}
function fmtMoney(value) {
  return value === null || value === undefined ? "—" : `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function VendorDateCompare({ plan, materialId, defaultDate, onAddLot }) {
  const [memberId, setMemberId] = useState(materialId);
  const [date, setDate] = useState(defaultDate ?? "");
  const [qty, setQty] = useState("");
  const choice = (plan.vendor_choices ?? []).find((c) => c.material_id === memberId) ?? (plan.vendor_choices ?? [])[0] ?? null;
  const options = choice?.options ?? [];
  const wanted = Number(qty) || 0;
  const rows = options.map((o) => {
    const lot = wanted > 0 ? vendorLotQty(wanted, o) : null;
    const inTime = !date || !o.earliest_plant_eta ? null : date >= o.earliest_plant_eta;
    return { ...o, lot, inTime, value: lot !== null && o.unit_total_cost !== null ? lot * o.unit_total_cost : null };
  });
  const best = rows.filter((r) => r.inTime !== false && r.value !== null).sort((a, b) => a.value - b.value)[0] ?? null;

  return (
    <section className="grid gap-1 border border-emerald-200 bg-emerald-50 p-2">
      <h3 className="text-sm font-semibold text-slate-800">Compare vendors — which vendor, which date, how much</h3>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="grid gap-0.5">
          <span>Member</span>
          <select value={choice?.material_id ?? ""} onChange={(event) => setMemberId(event.target.value)} className={CELL_INPUT}>
            {(plan.vendor_choices ?? []).map((c) => <option key={c.material_id} value={c.material_id}>{`${c.material_code ?? ""} ${c.material_name}`.trim()}</option>)}
          </select>
        </label>
        <label className="grid gap-0.5">
          <span>Plant date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={CELL_INPUT} />
        </label>
        <label className="grid gap-0.5">
          <span>Qty ({choice?.uom ?? ""})</span>
          <input type="number" min="0" value={qty} onChange={(event) => setQty(event.target.value)} className={`${CELL_INPUT} w-28`} />
        </label>
      </div>
      {options.length === 0 ? <p className="text-xs text-slate-500">No vendor linked to this member for this company (MM03).</p> : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="pr-3">Vendor</th><th className="pr-3">Lead days</th><th className="pr-3">Earliest at plant</th><th className="pr-3">By your date?</th>
                <th className="pr-3">MOQ / multiple</th><th className="pr-3">Lot qty</th><th className="pr-3">Full cost / unit</th><th className="pr-3">Lot value</th>
                <th className="pr-3">Freight</th><th className="pr-3">Cost gaps</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vendor_id} className={best && best.vendor_id === r.vendor_id ? "bg-emerald-100 font-semibold" : ""}>
                  <td className="pr-3">{r.vendor_label}{best && best.vendor_id === r.vendor_id ? " ★" : ""}</td>
                  <td className="pr-3">{fmtDays(r.lead_time_days)}</td>
                  <td className="pr-3">{r.earliest_plant_eta ?? "—"}</td>
                  <td className={`pr-3 ${r.inTime === false ? "text-rose-700" : ""}`}>{r.inTime === null ? "—" : r.inTime ? "Yes" : "No — too early"}</td>
                  <td className="pr-3">{fmtQty(r.moq_qty)} / {fmtQty(r.order_multiple_qty)}</td>
                  <td className="pr-3">{r.lot === null ? "—" : fmtQty(r.lot)}</td>
                  <td className="pr-3">{r.unit_total_cost === null ? "—" : `₹${r.unit_total_cost.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}</td>
                  <td className="pr-3">{fmtMoney(r.value)}</td>
                  <td className="pr-3">{FREIGHT_LABEL[r.freight_term] ?? r.freight_term ?? "—"}</td>
                  <td className="pr-3">{r.cost_missing?.length ? r.cost_missing.join(", ") : "Complete"}</td>
                  <td className="whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!date || !r.lot}
                      onClick={() => onAddLot({ material_id: choice.material_id, plant_eta: date, qty_base: r.lot, vendor_id: r.vendor_id }, false)}
                      className="mr-1 h-6 border border-slate-300 bg-white px-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >Add as my lot</button>
                    <button
                      type="button"
                      disabled={!date || !r.lot}
                      onClick={() => onAddLot({ material_id: choice.material_id, plant_eta: date, qty_base: r.lot, vendor_id: r.vendor_id }, true)}
                      className="h-6 border border-emerald-600 bg-emerald-600 px-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >Add & preview</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">★ = lowest lot value that arrives by your date. "Add & preview" shows the day-by-day effect (Min / Max days) before you save.</p>
    </section>
  );
}

export function TargetWhatIf({ plan, companyId, planMonth, asOf, demandAt, materialId, onPreviewTarget, onSaved }) {
  const selected = (plan.members ?? []).find((m) => m.is_selected);
  const current = selected?.target_days ?? null;
  const suggestion = current === null ? "15, 20, 30" : [current - 10, current - 5, current + 5].filter((d) => d >= 1).join(", ");
  const [values, setValues] = useState(suggestion);
  const [withAi, setWithAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  async function compare() {
    setBusy(true);
    setResult(null);
    try {
      const candidates = values.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      setResult(await whatIfMtsItemPlanTarget({
        company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined, material_id: materialId,
        candidates: [...new Set([...(current === null ? [] : [current]), ...candidates])].slice(0, 5), with_ai: withAi,
      }));
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  // "Use": a new policy version from the as-of date with the chosen days; MOQ / Rate kept as saved.
  async function applyTarget(row) {
    setSaving(true);
    try {
      const policies = await getMtsRequirementPolicies({ company_id: companyId, as_of: asOf });
      const saved = (policies?.rows ?? []).find((r) => r.material_id === materialId)?.policy ?? null;
      await saveMtsRequirementPolicies({
        company_id: companyId, source_system: "ERP_ENTRY",
        rows: [{
          material_id: materialId, effective_from: asOf,
          target_cov_days: row.target_days, critical_cov_days: row.critical_days,
          moq_qty: saved?.moq_qty ?? null, moq_uom_code: saved?.moq_qty === null || saved?.moq_qty === undefined ? null : saved.moq_uom_code,
          moq_source: saved?.moq_source ?? "NONE", moq_active: Boolean(saved?.moq_active),
          carrying_rate_per_uom: saved?.carrying_rate_per_uom ?? null,
          remarks: `What-if: Target ${saved?.target_cov_days ?? "—"} → ${row.target_days} days`,
        }],
      });
      pushToast({ message: `Target ${row.target_days} / Critical ${row.critical_days ?? "—"} days saved from ${asOf}. Recalculating…`, tone: "success" });
      setResult(null);
      await onSaved?.();
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const pick = result?.engine_pick?.target_days ?? null;
  return (
    <section className="grid gap-1 border border-amber-200 bg-amber-50 p-2">
      <h3 className="text-sm font-semibold text-slate-800">What-if Safety days — {`${selected?.material_code ?? ""} ${selected?.material_name ?? ""}`.trim()} (now Target {fmtDays(current)} / Critical {fmtDays(selected?.critical_days)})</h3>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Try Target days
          <input type="text" value={values} onChange={(event) => setValues(event.target.value)} className={`${CELL_INPUT} w-36`} placeholder="e.g. 10, 15, 25" />
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={withAi} onChange={(event) => setWithAi(event.target.checked)} /> Ask AI too</label>
        <button type="button" onClick={() => void compare()} disabled={busy} className="h-7 border border-amber-600 bg-amber-600 px-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">{busy ? "Engine is re-planning…" : "Compare"}</button>
        <span className="text-slate-500">Up to 4 values besides today's. Critical stays as saved (lowered only if above the new Target).</span>
      </div>
      {result ? (
        <div className="grid gap-2 text-xs">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="pr-3">Target</th><th className="pr-3">Critical</th><th className="pr-3">Shortage days</th><th className="pr-3">Days ≤ today's Critical</th>
                  <th className="pr-3">Lowest Max days</th><th className="pr-3">Avg stock</th><th className="pr-3">Avg money in stock</th><th className="pr-3">New orders</th><th className="pr-3">Order value</th><th />
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.target_days} className={r.target_days === pick ? "bg-emerald-100 font-semibold" : r.metrics.shortage_days > 0 ? "text-rose-700" : ""}>
                    <td className="pr-3">{r.target_days}{r.is_current ? " (now)" : ""}{r.target_days === pick ? " ★" : ""}</td>
                    <td className="pr-3">{fmtDays(r.critical_days)}</td>
                    <td className="pr-3">{r.metrics.shortage_days}</td>
                    <td className="pr-3">{r.metrics.days_below_critical}</td>
                    <td className="pr-3">{fmtDays(r.metrics.lowest_max_days)}</td>
                    <td className="pr-3">{fmtQty(r.metrics.average_closing)}</td>
                    <td className="pr-3">{fmtMoney(r.metrics.average_stock_value)}</td>
                    <td className="pr-3">{r.order_count} ({fmtQty(r.order_qty)})</td>
                    <td className="pr-3">{fmtMoney(r.order_value)}{r.order_value_partial ? " (partial)" : ""}</td>
                    <td className="whitespace-nowrap">
                      <button type="button" onClick={() => onPreviewTarget(r)} className="mr-1 h-6 border border-slate-300 bg-white px-1.5 text-xs text-slate-700 hover:bg-slate-50">Preview</button>
                      {r.is_current ? null : <button type="button" disabled={saving} onClick={() => void applyTarget(r)} className="h-6 border border-amber-600 bg-white px-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">Use</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-800"><span className="font-semibold">Engine: </span>{result.engine_pick ? result.engine_pick.reason : "No value is free of shortage — keep today's days and fix supply first."}</p>
          {result.ai_verdict ? <p className="whitespace-pre-wrap text-violet-900"><span className="font-semibold">AI: </span>{result.ai_verdict}</p> : null}
          {result.ai_error ? <p className="text-slate-500">AI: {result.ai_error}</p> : null}
          <p className="text-slate-500">{result.note}</p>
        </div>
      ) : null}
    </section>
  );
}
