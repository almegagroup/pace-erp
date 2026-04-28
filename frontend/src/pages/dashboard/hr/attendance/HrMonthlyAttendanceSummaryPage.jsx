/*
 * File-ID: 8.6B1-HR-MONTHLY-SUMMARY
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrMonthlyAttendanceSummaryPage.jsx
 * Gate: 8
 * Phase: 6-B
 * Domain: HR
 * Purpose: Monthly attendance summary — per-employee status counts for a
 *          selected year + month, with CSV export.
 * Authority: Frontend
 */

import { useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../../store/uiToast.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { getMonthlyAttendanceSummary } from "../hrApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function currentYear() {
  return new Date().getFullYear();
}

function currentMonth() {
  return new Date().getMonth() + 1; // 1-based
}

function formatError(err, fallback) {
  if (!err || typeof err !== "object") return fallback;
  return `${err.message ?? fallback} (${err.decisionTrace ?? err.code ?? "ERR"})`;
}

const STATUS_COLS = [
  { key: "present",    label: "Present",    cls: "text-green-700" },
  { key: "leave",      label: "Leave",      cls: "text-sky-700" },
  { key: "out_work",   label: "Out Work",   cls: "text-indigo-700" },
  { key: "absent",     label: "Absent",     cls: "text-rose-700" },
  { key: "miss_punch", label: "Miss Punch", cls: "text-amber-700" },
  { key: "holiday",    label: "Holiday",    cls: "text-emerald-700" },
  { key: "week_off",   label: "Week Off",   cls: "text-teal-700" },
  { key: "total",      label: "Total",      cls: "text-slate-700 font-semibold" },
];

function buildCsvRows(summary) {
  return summary.map((row) => ({
    "Employee":       row.employee_display,
    "Employee Code":  row.employee_code ?? "",
    "Present":        row.present,
    "Leave":          row.leave,
    "Out Work":       row.out_work,
    "Absent":         row.absent,
    "Miss Punch":     row.miss_punch,
    "Holiday":        row.holiday,
    "Week Off":       row.week_off,
    "Total Records":  row.total,
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HrMonthlyAttendanceSummaryPage() {
  const [year,  setYear]  = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [data,  setData]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  useErpScreenHotkeys({
    onF8: () => handleLoad(),
  });

  async function handleLoad() {
    setError("");
    setLoading(true);
    try {
      const result = await getMonthlyAttendanceSummary({ year, month });
      setData(result);
    } catch (err) {
      setError(formatError(err, "Could not load monthly summary."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!data?.summary?.length) return;
    const rows = buildCsvRows(data.summary);
    downloadCsvFile(rows, `monthly_attendance_${year}_${String(month).padStart(2,"0")}.csv`);
    pushToast({ message: "CSV exported.", type: "success" });
  }

  const summary = data?.summary ?? [];

  return (
    <ErpScreenScaffold title="Monthly Attendance Summary">
      {/* ── Filter bar ── */}
      <ErpSectionCard>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Year</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-slate-300 rounded px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-slate-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleLoad}
            disabled={loading}
            className="self-end px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load (F8)"}
          </button>

          {summary.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="self-end px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700"
            >
              Export CSV
            </button>
          )}
        </div>

        {error && (
          <p className="mt-3 text-sm text-rose-600 font-medium">{error}</p>
        )}
      </ErpSectionCard>

      {/* ── Results ── */}
      {data && (
        <ErpSectionCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">
              {MONTHS[data.month - 1]} {data.year} — {data.total_employees} employee{data.total_employees !== 1 ? "s" : ""}
              <span className="ml-2 text-xs text-slate-400 font-normal">
                ({data.from_date} → {data.to_date})
              </span>
            </h3>
          </div>

          {summary.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No day records found for this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Employee</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs whitespace-nowrap">Code</th>
                    {STATUS_COLS.map((col) => (
                      <th key={col.key} className={`text-right px-3 py-2 font-semibold whitespace-nowrap text-xs ${col.cls}`}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row, idx) => (
                    <tr
                      key={row.employee_auth_user_id}
                      className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}
                    >
                      <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{row.employee_display}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">{row.employee_code ?? "—"}</td>
                      {STATUS_COLS.map((col) => (
                        <td key={col.key} className={`px-3 py-2 text-right whitespace-nowrap ${col.cls}`}>
                          {row[col.key] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
