/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsPlanningReschedule.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 Planning tab (owner 2026-10-21) — move not-yet-shipped CSN / PO arrivals earlier
 *          (prepone) or later (postpone), Preview the engine's before / after for every affected
 *          material, then Save. Planning side only: CSN Tracker is never changed.
 * Authority: Frontend (numbers come from the backend engine only)
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { pushToast } from "../../../../store/uiToast.js";
import { previewMtsPlanningReschedule, saveMtsInboundReschedule } from "../procurementApi.js";

const CELL_INPUT = "h-7 border border-sky-300 bg-sky-50 px-1.5 text-xs text-sky-900 outline-none focus:border-sky-600";
const GRID_PROPS = { cellNavigate: true, columnFilter: true, searchBar: true, stickyFirstColumn: true, fitColumnWidths: true };

function fmtQty(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
/** Days are whole, rounded down like the sheet. */
function fmtDays(value) {
  return value === null || value === undefined ? "—" : String(Math.floor(Number(value) + 1e-9));
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}
function shiftDays(from, to) {
  if (!from || !to) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
function addDays(day, n) {
  return day ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : "";
}

export default function MtsPlanningReschedule({ companyId, planMonth, asOf, demandAt, arrivals }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = (a) => a.rescheduled_eta ?? a.eta_plant ?? "";
  const changed = useMemo(
    () => (arrivals ?? []).filter((a) => {
      const d = drafts[a.reschedule_key];
      // A "back to CSN date" draft clears the saved planning date.
      if (d?.clear) return Boolean(a.rescheduled_eta);
      return Boolean(d?.date) && d.date !== (a.rescheduled_eta ?? a.eta_plant ?? "");
    }),
    [arrivals, drafts],
  );
  const setDate = (a, date, reason) => {
    setDrafts((d) => ({ ...d, [a.reschedule_key]: { ...(d[a.reschedule_key] ?? {}), date, ...(reason ? { reason } : {}) } }));
    setPreview(null);
  };
  const undo = (a) => {
    setDrafts((d) => { const next = { ...d }; delete next[a.reschedule_key]; return next; });
    setPreview(null);
  };
  const backToSource = (a) => {
    setDrafts((d) => ({ ...d, [a.reschedule_key]: { clear: true, reason: "Back to CSN / PO date" } }));
    setPreview(null);
  };
  const engineMoves = (arrivals ?? []).filter((a) => a.optimum?.shift_days);
  const useAllEngineDates = () => {
    setDrafts((d) => ({ ...d, ...Object.fromEntries(engineMoves.map((a) => [a.reschedule_key, { ...(d[a.reschedule_key] ?? {}), date: a.optimum.best.eta, reason: a.optimum.reason }])) }));
    setPreview(null);
  };

  async function runPreview() {
    setBusy(true);
    try {
      setPreview(await previewMtsPlanningReschedule({
        company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined,
        reschedules: changed.map((a) => ({ reschedule_key: a.reschedule_key, date: drafts[a.reschedule_key].clear ? null : drafts[a.reschedule_key].date })),
      }));
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await saveMtsInboundReschedule({
        company_id: companyId,
        rows: changed.map((a) => ({
          reschedule_key: a.reschedule_key, material_id: a.material_id, original_eta: a.eta_plant ?? null,
          rescheduled_eta: drafts[a.reschedule_key].clear ? null : drafts[a.reschedule_key].date, reason: drafts[a.reschedule_key].reason || null,
        })),
      });
      pushToast({ message: "New arrival dates saved for planning. CSN Tracker is unchanged — update it there when the vendor confirms.", tone: "success" });
      setDrafts({});
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: "material_name", label: "Material", width: "240px", render: (a) => `${a.material_code ?? ""} ${a.material_name}`.trim() },
    { key: "reference", label: "PO / CSN", width: "280px" },
    { key: "qty", label: "Qty", width: "110px", align: "right", render: (a) => `${fmtQty(a.qty)} ${a.uom ?? ""}`, copyValue: (a) => a.qty },
    { key: "eta_plant", label: "Source ETA (CSN / PO)", width: "130px", render: (a) => a.eta_plant ?? "—" },
    { key: "rescheduled_eta", label: "Saved planning ETA", width: "130px", render: (a) => a.rescheduled_eta ?? "—" },
    {
      key: "now_days", label: "Min / Max on arrival", width: "130px", align: "right",
      render: (a) => (a.optimum ? `${fmtDays(a.optimum.current.min_days)} / ${fmtDays(a.optimum.current.max_days)}` : "—"),
      copyValue: (a) => (a.optimum ? `${a.optimum.current.min_days ?? ""}/${a.optimum.current.max_days ?? ""}` : ""),
    },
    {
      key: "best", label: "Engine best date", width: "170px",
      render: (a) => (a.optimum?.shift_days ? (
        <button type="button" onClick={() => setDate(a, a.optimum.best.eta, a.optimum.reason)} title={a.optimum.reason} className={`text-left text-xs font-semibold hover:underline ${a.optimum.shift_days < 0 ? "text-rose-700" : "text-amber-700"}`}>
          {`${a.optimum.best.eta} (${a.optimum.shift_days < 0 ? `prepone ${-a.optimum.shift_days} d` : `postpone ${a.optimum.shift_days} d`})`}
        </button>
      ) : a.optimum ? <span className="text-xs text-emerald-700">Date is fine</span> : "—"),
      copyValue: (a) => (a.optimum?.shift_days ? a.optimum.best.eta : ""),
    },
    {
      key: "best_days", label: "At best date: Min / Max", width: "150px", align: "right",
      render: (a) => (a.optimum?.shift_days ? `${fmtDays(a.optimum.best.min_days)} / ${fmtDays(a.optimum.best.max_days)}` : ""),
      copyValue: (a) => (a.optimum?.shift_days ? `${a.optimum.best.min_days ?? ""}/${a.optimum.best.max_days ?? ""}` : ""),
    },
    { key: "why", label: "Why", width: "320px", render: (a) => (a.optimum ? <span className="text-xs">{a.optimum.reason}</span> : ""), copyValue: (a) => a.optimum?.reason ?? "" },
    {
      key: "move", label: "Move", width: "150px", filterable: false,
      render: (a) => (
        <span className="flex gap-1">
          {[-7, -1, 1, 7].map((n) => (
            <button key={n} type="button" onClick={() => setDate(a, addDays(drafts[a.reschedule_key]?.date || current(a), n))} disabled={!current(a)} className="h-6 border border-slate-300 bg-white px-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40" title={n < 0 ? "Prepone" : "Postpone"}>{n > 0 ? `+${n}` : n}</button>
          ))}
        </span>
      ),
    },
    {
      key: "new_date", label: "New plant date", width: "150px", filterable: false,
      render: (a) => (drafts[a.reschedule_key]?.clear
        ? <span className="text-xs font-semibold text-sky-800">{`Back to CSN date ${a.eta_plant ?? "—"}`}</span>
        : <input type="date" value={drafts[a.reschedule_key]?.date ?? current(a)} onChange={(event) => setDate(a, event.target.value)} className={CELL_INPUT} />),
      copyValue: (a) => (drafts[a.reschedule_key]?.clear ? a.eta_plant ?? "" : drafts[a.reschedule_key]?.date ?? ""),
    },
    {
      key: "undo", label: "Undo", width: "170px", filterable: false,
      render: (a) => (
        <span className="flex gap-1">
          {drafts[a.reschedule_key] ? (
            <button type="button" onClick={() => undo(a)} title="Drop this unsaved change" className="h-6 border border-slate-300 bg-white px-1.5 text-xs text-slate-700 hover:bg-slate-50">Undo</button>
          ) : null}
          {a.rescheduled_eta && !drafts[a.reschedule_key]?.clear ? (
            <button type="button" onClick={() => backToSource(a)} title="Remove the saved planning date — the CSN / PO date is used again" className="h-6 border border-sky-300 bg-white px-1.5 text-xs text-sky-800 hover:bg-sky-50">Back to CSN date</button>
          ) : null}
        </span>
      ),
    },
    {
      key: "shift", label: "Shift", width: "110px",
      render: (a) => {
        const n = shiftDays(current(a), drafts[a.reschedule_key]?.clear ? a.eta_plant : drafts[a.reschedule_key]?.date);
        return !n ? "" : <span className={`font-semibold ${n < 0 ? "text-emerald-700" : "text-amber-700"}`}>{n < 0 ? `Prepone ${-n} d` : `Postpone ${n} d`}</span>;
      },
    },
    {
      key: "reason", label: "Reason", width: "200px", filterable: false,
      render: (a) => <input type="text" value={drafts[a.reschedule_key]?.reason ?? ""} placeholder="Why" onChange={(event) => setDrafts((d) => ({ ...d, [a.reschedule_key]: { ...(d[a.reschedule_key] ?? {}), reason: event.target.value } }))} className={`${CELL_INPUT} w-full`} />,
    },
  ];

  const cell = (b, a, key, worseIfEarlier) => {
    const before = b[key];
    const after = a[key];
    if (before === after) return <span>{before ?? "—"}</span>;
    const worse = worseIfEarlier ? (after !== null && (before === null || after < before)) : (after !== null && before !== null && after < before);
    return <span className={worse ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>{before ?? "—"} → {after ?? "—"}</span>;
  };

  return (
    <section className="grid gap-1 border border-indigo-200 bg-indigo-50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Arrivals — prepone / postpone</h3>
        <button type="button" onClick={useAllEngineDates} disabled={engineMoves.length === 0} className="h-7 border border-amber-600 bg-white px-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50">{`Use all engine dates${engineMoves.length ? ` (${engineMoves.length})` : ""}`}</button>
        <button type="button" onClick={() => void runPreview()} disabled={busy || changed.length === 0} className="h-7 border border-indigo-600 bg-indigo-600 px-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "Engine is calculating…" : `Preview${changed.length ? ` (${changed.length})` : ""}`}</button>
        <button type="button" onClick={() => void save()} disabled={saving || changed.length === 0} className="h-7 border border-sky-600 bg-sky-600 px-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? "Saving…" : "Save new dates"}</button>
        {changed.length ? <button type="button" onClick={() => { setDrafts({}); setPreview(null); }} className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Undo all</button> : null}
        <span className="text-xs text-slate-500">Engine best date = every day of CM + NM tried: fewest stock-out / below-Critical / below-Target days, then the latest date (least money held). Only not-yet-shipped pieces can move; CSN Tracker is never changed.</span>
      </div>
      <ErpDenseGrid {...GRID_PROPS} columns={columns} rows={arrivals ?? []} rowKey={(a) => a.reschedule_key} emptyMessage="No movable arrival (every open piece is already shipped)." maxHeight="35vh" />
      {preview ? (
        <div className="grid gap-1 text-xs">
          <h4 className="font-semibold text-indigo-900">Effect (preview — not saved). Green = better, red = worse.</h4>
          {(preview.rows ?? []).length === 0 ? <p className="text-slate-600">No material changes its risk or buy plan in CM + NM.</p> : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="pr-3">Material</th><th className="pr-3">Moved</th><th className="pr-3">Runs out</th><th className="pr-3">Below Critical from</th>
                    <th className="pr-3">Below Target from</th><th className="pr-3">Lowest Min days</th><th className="pr-3">New orders</th><th>First PO by</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.material_id} className="align-top">
                      <td className="pr-3 font-semibold">{`${r.material_code ?? ""} ${r.material_name}`.trim()}</td>
                      <td className="pr-3">{r.moved.length ? r.moved.map((m) => `${m.reference}: ${m.from ?? "—"} → ${m.to ?? "—"}`).join("; ") : "— (shares a group)"}</td>
                      <td className="pr-3">{cell(r.before, r.after, "first_shortage_day", true)}</td>
                      <td className="pr-3">{cell(r.before, r.after, "first_below_critical_day", true)}</td>
                      <td className="pr-3">{cell(r.before, r.after, "first_below_target_day", true)}</td>
                      <td className="pr-3">{cell(r.before, r.after, "lowest_min_days", false)}</td>
                      <td className="pr-3">{r.before.new_orders === r.after.new_orders ? r.before.new_orders : `${r.before.new_orders} → ${r.after.new_orders}`}</td>
                      <td>{r.before.first_po_by === r.after.first_po_by ? r.before.first_po_by ?? "—" : `${r.before.first_po_by ?? "—"} → ${r.after.first_po_by ?? "—"}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-slate-500">{preview.note}</p>
        </div>
      ) : null}
    </section>
  );
}
