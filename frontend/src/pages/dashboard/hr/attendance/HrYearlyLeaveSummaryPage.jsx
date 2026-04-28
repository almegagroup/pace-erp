/*
 * File-ID: 8.6B3-HR-YEARLY-LEAVE
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrYearlyLeaveSummaryPage.jsx
 * Gate: 8
 * Phase: 6-B
 * Domain: HR
 * Purpose: Yearly leave summary — month-by-month leave day counts for a
 *          selected employee and year, with CSV export.
 * Authority: Frontend
 */

import { useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../../store/uiToast.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { getYearlyLeaveSummary } from "../hrApi.js";

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

function formatError(err, fallback) {
  if (!err || typeof err !== "object") return fallback;
  return `${err.message ?? fallback} (${err.decisionTrace ?? err.code ?? "ERR"})`;
}

function buildCsvRows(data) {
  return (data.months ?? []).map((m) => ({
    "Year":         data.year,
    "Employee":     data.employee_display,
    "Employee Code": data.employee_code ?? "",
    "Month":        MONTHS[m.month - 1],
    "Leave Days":   m.leave_days,
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HrYearlyLeaveSummaryPage() {
  const [year,       setYear]       = useState(currentYear);
  const [employeeId, setEmployeeId] = useState("");
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");

  useErpScreenHotkeys({ onF8: () => handleLoad() });

  async function handleLoad() {
    setError("");
    const trimmedId = employeeId.trim();
    if (!trimmedId) {
      setError("Employee ID is required.");
      return;
    }
    setLoading(true);
    try {
      const result = await getYearlyLeaveSummary({ year, employeeId: trimmedId });
      setData(result);
    } catch (err) {
      setError(formatError(err, "Could not load yearly leave summary."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!data) return;
    const rows = buildCsvRows(data);
    downloadCsvFile(rows, `yearly_leave_${data.year}_${data.employee_code ?? data.employee_auth_user_id}.csv`);
    pushToast({ message: "CSV exported.", type: "success" });
  }

  const months = data?.months ?? [];
  const maxDays = Math.max(...months.map((m) => m.leave_days), 1);

  return (
    <ErpScreenScaffold title="Yearly Leave Summary">
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
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Employee ID (UUID)</label>
            <input
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="Paste employee auth user ID"
              className="border border-slate-300 rounded px-3 py-2 text-sm w-80 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          {data && (
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
          <div className="mb-4">
            <p className="text-sm font-semibold text-slate-700">{data.employee_display}</p>
            {data.employee_code && (
              <p className="text-xs text-slate-400">{data.employee_code}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {data.year} · Total leave days: <span className="font-semibold text-sky-700">{data.total_leave_days}</span>
            </p>
          </div>

          {/* Month chart */}
          <div className="space-y-2">
            {months.map((m) => {
              const pct = maxDays > 0 ? (m.leave_days / maxDays) * 100 : 0;
              return (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-20 shrink-0">{MONTHS[m.month - 1]}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full bg-sky-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-sky-700 w-8 text-right">{m.leave_days}</span>
                </div>
              );
            })}
          </div>

          {/* Table */}
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Month</th>
                  <th className="text-right px-3 py-2 font-semibold text-sky-700">Leave Days</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, idx) => (
                  <tr key={m.month} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-3 py-2 text-slate-700">{MONTHS[m.month - 1]}</td>
                    <td className="px-3 py-2 text-right font-medium text-sky-700">{m.leave_days}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 bg-slate-100 font-semibold">
                  <td className="px-3 py-2 text-slate-700">Total</td>
                  <td className="px-3 py-2 text-right text-sky-800">{data.total_leave_days}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
