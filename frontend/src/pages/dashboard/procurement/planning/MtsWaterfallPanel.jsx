/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsWaterfallPanel.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 4A family table (owner 2026-10-28, docs/mts-planning/PO22-WATERFALL-OWNER-METHOD-2026-10-28.md §13):
 *          Block 1 each level's Min / Max / Critical and cover, Block 2 the flow (receipts, top-ups, waiting levels), Block 2B the
 *          Material x Level grid, one plain sentence on top. Numbers come from the backend engine (`plan.waterfall`) only.
 * Authority: Frontend (display only)
 */
import { useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { flowRows, matrixGrid, waterfallVerdict } from "./mtsWaterfall.js";

const GRID_PROPS = { cellNavigate: true, columnFilter: true, searchBar: true, stickyFirstColumn: true, fitColumnWidths: true, copyTableWithHeaders: true };
const kg = (value) => (value === null || value === undefined ? "—" : Math.round(Number(value) || 0).toLocaleString("en-IN"));
const days = (value) => (value === null || value === undefined ? "—" : String(Math.round(Number(value))));
const TONE = { ok: "border-emerald-300 bg-emerald-50 text-emerald-900", warn: "border-amber-300 bg-amber-50 text-amber-900", bad: "border-rose-300 bg-rose-50 text-rose-900" };

export function WaterfallVerdict({ waterfall, futureOrders }) {
  const verdict = useMemo(() => waterfallVerdict(waterfall, futureOrders), [waterfall, futureOrders]);
  if (!waterfall) return null;
  return <p className={`border px-2 py-1 text-sm font-semibold ${TONE[verdict.tone]}`}>{verdict.text}</p>;
}

export default function MtsWaterfallPanel({ waterfall, futureOrders }) {
  const [day, setDay] = useState("");
  const rows = useMemo(() => flowRows(waterfall), [waterfall]);
  const snapshotDays = useMemo(() => (waterfall?.matrix ?? []).map((s) => s.day), [waterfall]);
  const grid = useMemo(() => matrixGrid(waterfall, day || snapshotDays[0]), [waterfall, day, snapshotDays]);

  if (!waterfall) return <p className="text-sm text-slate-500">No waterfall for this item.</p>;

  const levelColumns = [
    { key: "label", label: "Level", width: "220px" },
    { key: "members", label: "Members", width: "320px", render: (l) => l.members.join("; "), copyValue: (l) => l.members.join("; ") },
    { key: "target_days", label: "Min days", width: "80px", align: "right", render: (l) => days(l.target_days) },
    { key: "max_days", label: "Max days", width: "80px", align: "right", render: (l) => days(l.max_days) },
    { key: "critical_days", label: "Critical days", width: "90px", align: "right", render: (l) => days(l.critical_days) },
    { key: "cover_days_now", label: "Cover now (days)", width: "110px", align: "right", render: (l) => days(l.cover_days_now) },
    { key: "reserve_now", label: "Reserve now (KG)", width: "120px", align: "right", render: (l) => kg(l.reserve_now), copyValue: (l) => l.reserve_now },
    { key: "next_min_day", label: "Next Min", width: "110px", render: (l) => l.next_min_day ?? "not in horizon" },
  ];
  const flowColumns = [
    { key: "day", label: "Date", width: "100px" },
    { key: "what", label: "What happened", width: "340px" },
    { key: "level", label: "Level", width: "200px" },
    { key: "qty", label: "KG", width: "90px", align: "right", render: (r) => kg(r.qty), copyValue: (r) => r.qty },
    { key: "detail", label: "From which material", width: "300px" },
    { key: "shortfall", label: "Short (KG)", width: "100px", align: "right", render: (r) => (r.short ? <span className="font-semibold text-rose-700">{kg(r.shortfall)}</span> : "—"), copyValue: (r) => r.shortfall },
    { key: "pool_before", label: "Pool before", width: "100px", align: "right", render: (r) => (r.what.startsWith("Receipt") ? "" : kg(r.pool_before)) },
    { key: "pool_after", label: "Pool after", width: "100px", align: "right", render: (r) => (r.what.startsWith("Receipt") ? "" : kg(r.pool_after)) },
  ];
  const matrixColumns = [
    { key: "material", label: "Material", width: "260px" },
    ...grid.levels.map((level, index) => ({ key: `l${index}`, label: level, width: "150px", align: "right", render: (r) => (r.cells[index] > 0.5 ? kg(r.cells[index]) : "—"), copyValue: (r) => r.cells[index] })),
    { key: "pool", label: "Pool (excess)", width: "120px", align: "right", render: (r) => kg(r.pool), copyValue: (r) => r.pool },
    { key: "total", label: "Total stock", width: "110px", align: "right", render: (r) => kg(r.total), copyValue: (r) => r.total },
    { key: "ok", label: "Adds up", width: "80px", render: (r) => (r.ok ? "✓" : <span className="font-semibold text-rose-700">✗</span>) },
  ];

  return (
    <div className="grid content-start gap-3">
      <WaterfallVerdict waterfall={waterfall} futureOrders={futureOrders} />
      <section className="grid gap-1">
        <h3 className="text-sm font-semibold text-slate-800">1. Each level — Min / Max days, cover and reserve now</h3>
        <p className="text-xs text-slate-500">Exclusive use first, then each group from narrow to broad. A level takes from the pool only when it falls to its own Min.</p>
        <ErpDenseGrid {...GRID_PROPS} columns={levelColumns} rows={waterfall.levels ?? []} rowKey={(l) => l.label} emptyMessage="No level." maxHeight="22vh" />
      </section>
      <section className="grid gap-1">
        <h3 className="text-sm font-semibold text-slate-800">2. Flow — when stock lands, when a level tops up, where it came from</h3>
        <ErpDenseGrid {...GRID_PROPS} columns={flowColumns} rows={rows} rowKey={(r) => r.key} emptyMessage="No event in the horizon." maxHeight="36vh" />
      </section>
      <section className="grid gap-1">
        <h3 className="text-sm font-semibold text-slate-800">3. Who holds what — Material × Level{grid.ok ? "" : " (does not add up — check)"}</h3>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Day
          <select value={grid.day ?? ""} onChange={(event) => setDay(event.target.value)} className="h-7 border border-slate-300 bg-white px-1 text-xs">
            {snapshotDays.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <ErpDenseGrid {...GRID_PROPS} columns={matrixColumns} rows={grid.rows} rowKey={(r) => r.material} emptyMessage="No stock." maxHeight="26vh" />
      </section>
    </div>
  );
}
