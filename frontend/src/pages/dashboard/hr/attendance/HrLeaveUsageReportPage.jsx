/*
 * File-ID: 8.6B5-HR-LEAVE-USAGE
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrLeaveUsageReportPage.jsx
 * Gate: 8
 * Phase: 6-B
 * Domain: HR
 * Purpose: Leave usage report — per-employee per-type days taken for a year.
 *          Balance column shows "Not configured" (Phase 8 placeholder).
 *          CSV export included.
 * Authority: Frontend
 */

import { useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../../store/uiToast.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { getLeaveUsageReport } from "../hrApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentYear() {
  return new Date().getFullYear();
}

function formatError(err, fallback) {
  if (!err || typeof err !== "object") return fallback;
  return `${err.message ?? fallback} (${err.decisionTrace ?? err.code ?? "ERR"})`;
}

function buildCsvRows(usageRows) {
  const rows = [];
  for (const emp of usageRows) {
    for (const t of emp.by_type ?? []) {
      rows.push({
        "Employee":      emp.employee_display,
        "Employee Code": emp.employee_code ?? "",
        "Leave Type":    t.type_name,
        "Type Code":     t.type_code,
        "Days Taken":    t.days_taken,
        "Balance":       "Not configured",
      });
    }
    // Summary row per employee
    rows.push({
      "Employee":      emp.employee_display,
      "Employee Code": emp.employee_code ?? "",
      "Leave Type":    "(Total)",
      "Type Code":     "",
      "Days Taken":    emp.total_leave_days,
      "Balance":       "",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HrLeaveUsageReportPage() {
  const [year,    setYear]    = useState(currentYear);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  useErpScreenHotkeys({ onF8: () => handleLoad() });

  async function handleLoad() {
    setError("");
    setLoading(true);
    try {
      const result = await getLeaveUsageReport({ year });
      setData(result);
    } catch (err) {
      setError(formatError(err, "Could not load leave usage report."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!data?.usage?.length) return;
    const rows = buildCsvRows(data.usage);
    downloadCsvFile(rows, `leave_usage_${data.year}.csv`);
    pushToast({ message: "CSV exported.", type: "success" });
  }

  const usage = data?.usage ?? [];

  return (
    <ErpScreenScaffold title="Leave Usage Report">
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

          <button
            type="button"
            onClick={handleLoad}
            disabled={loading}
            className="self-end px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load (F8)"}
          </button>

          {usage.length > 0 && (
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

      {/* ── Phase 8 notice ── */}
      {data && (
        <div className="mx-4 mb-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          <strong>Balance tracking not configured.</strong> Days taken are accurate. Leave balance (entitlement −
          taken) requires Phase 8 (Leave Policy &amp; Balance Management).
        </div>
      )}

      {/* ── Results ── */}
      {data && (
        <ErpSectionCard>
          <div className="mb-3">
            <span className="text-sm font-semibold text-slate-700">
              {data.year} · {data.total_employees} employee{data.total_employees !== 1 ? "s" : ""}
            </span>
          </div>

          {usage.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No leave records found for this year.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Employee</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs whitespace-nowrap">Code</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Leave Type</th>
                    <th className="text-right px-3 py-2 font-semibold text-sky-700 whitespace-nowrap">Days Taken</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-400 whitespace-nowrap">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((emp) => {
                    const types = emp.by_type ?? [];
                    return types.map((t, tIdx) => (
                      <tr
                        key={`${emp.employee_auth_user_id}-${t.leave_type_id}`}
                        className={tIdx === 0 ? "border-t border-slate-200 bg-white" : "bg-white"}
                      >
                        {tIdx === 0 ? (
                          <td rowSpan={types.length + 1} className="px-3 py-2 text-slate-800 align-top whitespace-nowrap border-r border-slate-100">
                            <div className="font-medium">{emp.employee_display}</div>
                          </td>
                        ) : null}
                        {tIdx === 0 ? (
                          <td rowSpan={types.length + 1} className="px-3 py-2 text-slate-400 text-xs align-top whitespace-nowrap border-r border-slate-100">
                            {emp.employee_code ?? "—"}
                          </td>
                        ) : null}
                        <td className="px-3 py-1.5 text-slate-700">
                          <span className="text-xs text-slate-400 mr-1">[{t.type_code}]</span>
                          {t.type_name}
                        </td>
                        <td className="px-3 py-1.5 text-right text-sky-700 font-medium">{t.days_taken}</td>
                        <td className="px-3 py-1.5 text-right text-slate-400 italic text-xs">Not configured</td>
                      </tr>
                    )).concat(
                      // Summary row
                      <tr key={`${emp.employee_auth_user_id}-total`} className="bg-slate-50 border-t border-slate-100">
                        <td className="px-3 py-1.5 text-xs text-slate-500 italic">All types</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-sky-800">{emp.total_leave_days}</td>
                        <td className="px-3 py-1.5" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
