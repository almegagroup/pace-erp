/*
 * File-Path: frontend/src/components/data/ErpSummaryChips.jsx
 * Domain: FRONT
 * Purpose: Small pill-shaped label:value summary row used above workspace
 *          grids (row counts, verification/status totals, access level).
 * Authority: Frontend
 */

export default function ErpSummaryChips({ items }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map((item) => (
        <span
          key={item.label}
          className={`rounded-full border px-3 py-1 font-semibold ${item.className || "border-slate-300 bg-white text-slate-700"}`}
        >
          {item.label}: {item.value}
        </span>
      ))}
    </div>
  );
}
