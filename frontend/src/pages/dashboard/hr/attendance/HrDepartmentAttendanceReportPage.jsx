/*
 * File-ID: 8.6B4-HR-DEPT-REPORT
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrDepartmentAttendanceReportPage.jsx
 * Gate: 8
 * Phase: 6-B
 * Domain: HR
 * Purpose: Department attendance report — per-work-context status totals
 *          for a date range (max 31 days), with CSV export.
 * Authority: Frontend
 */

import { useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../../store/uiToast.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { getDepartmentAttendanceReport, shiftIsoDate } from "../hrApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

function buildCsvRows(departments) {
  return departments.map((dept) => ({
    "Work Area":   dept.work_context_name,
    "Present":     dept.present,
    "Leave":       dept.leave,
    "Out Work":    dept.out_work,
    "Absent":      dept.absent,
    "Miss Punch":  dept.miss_punch,
    "Holiday":     dept.holiday,
    "Week Off":    dept.week_off,
    "Total Records": dept.total,
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HrDepartmentAttendanceReportPage() {
  const [fromDate, setFromDate] = useState(() => shiftIsoDate(todayIso(), -6));
  const [toDate,   setToDate]   = useState(() => todayIso());
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  useErpScreenHotkeys({ onF8: () => handleLoad() });

  async function handleLoad() {
    setError("");
    setLoading(true);
    try {
      const result = await getDepartmentAttendanceReport({ fromDate, toDate });
      setData(result);
    } catch (err) {
      setError(formatError(err, "Could not load department report."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!data?.departments?.length) return;
    const rows = buildCsvRows(data.departments);
    downloadCsvFile(rows, `dept_attendance_${data.from_date}_${data.to_date}.csv`);
    pushToast({ message: "CSV exported.", type: "success" });
  }

  const departments = data?.departments ?? [];

  // Compute grand totals
  const totals = STATUS_COLS.reduce((acc, col) => {
    acc[col.key] = departments.reduce((sum, d) => sum + (d[col.key] ?? 0), 0);
    return acc;
  }, {});

  return (
    <ErpScreenScaffold title="Department Attendance Report">
      {/* ── Filter bar ── */}
      <ErpSectionCard>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="button"
            onClick={handleLoad}
            disabled={loading}
            className="self-end px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load (F8)"}
          </button>

          {departments.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="self-end px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700"
            >
              Export CSV
            </button>
          )}
        </div>

        <p className="mt-2 text-xs text-slate-400">Maximum 31-day window.</p>

        {error && (
          <p className="mt-3 text-sm text-rose-600 font-medium">{error}</p>
        )}
      </ErpSectionCard>

      {/* ── Results ── */}
      {data && (
        <ErpSectionCard>
          <div className="mb-3">
            <span className="text-sm font-semibold text-slate-700">
              {data.from_date} → {data.to_date}
              <span className="ml-2 text-xs text-slate-400 font-normal">
                {departments.length} work area{departments.length !== 1 ? "s" : ""}
              </span>
            </span>
          </div>

          {departments.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No records found for this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Work Area</th>
                    {STATUS_COLS.map((col) => (
                      <th key={col.key} className={`text-right px-3 py-2 font-semibold whitespace-nowrap text-xs ${col.cls}`}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept, idx) => (
                    <tr key={dept.work_context_id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 text-slate-800 whitespace-nowrap font-medium">{dept.work_context_name}</td>
                      {STATUS_COLS.map((col) => (
                        <td key={col.key} className={`px-3 py-2 text-right whitespace-nowrap ${col.cls}`}>
                          {dept[col.key] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Grand total row */}
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                    <td className="px-3 py-2 text-slate-700">Grand Total</td>
                    {STATUS_COLS.map((col) => (
                      <td key={col.key} className={`px-3 py-2 text-right whitespace-nowrap ${col.cls}`}>
                        {totals[col.key] ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
