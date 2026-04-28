/*
 * File-ID: 8.6B2-HR-DAILY-REGISTER
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrDailyAttendanceRegisterPage.jsx
 * Gate: 8
 * Phase: 6-B
 * Domain: HR
 * Purpose: Daily attendance register — employee × date grid, max 31 days,
 *          with CSV flat export.
 * Authority: Frontend
 */

import { useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../../store/uiToast.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { getDailyAttendanceRegister, shiftIsoDate } from "../hrApi.js";

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

function generateDateRange(from, to) {
  const dates = [];
  const end = new Date(`${to}T00:00:00.000Z`);
  let cur = new Date(`${from}T00:00:00.000Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return dates;
}

const STATUS_ABBR = {
  PRESENT:    { label: "P",  cls: "bg-green-100 text-green-800" },
  LEAVE:      { label: "L",  cls: "bg-sky-100 text-sky-800" },
  OUT_WORK:   { label: "OW", cls: "bg-indigo-100 text-indigo-800" },
  ABSENT:     { label: "AB", cls: "bg-rose-100 text-rose-800" },
  MISS_PUNCH: { label: "MP", cls: "bg-amber-100 text-amber-800" },
  HOLIDAY:    { label: "H",  cls: "bg-emerald-100 text-emerald-800" },
  WEEK_OFF:   { label: "WO", cls: "bg-teal-100 text-teal-800" },
};

function buildRecordMap(records) {
  // empId → date → status
  const map = new Map();
  for (const r of records ?? []) {
    if (!map.has(r.employee_auth_user_id)) {
      map.set(r.employee_auth_user_id, new Map());
    }
    map.get(r.employee_auth_user_id).set(r.record_date, r.declared_status);
  }
  return map;
}

function buildCsvRows(employees, dates, recordMap) {
  return employees.map((emp) => {
    const row = {
      "Employee":      emp.employee_display,
      "Employee Code": emp.employee_code ?? "",
    };
    for (const d of dates) {
      const status = recordMap.get(emp.employee_auth_user_id)?.get(d) ?? "—";
      row[d] = status;
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HrDailyAttendanceRegisterPage() {
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
      const result = await getDailyAttendanceRegister({ fromDate, toDate });
      setData(result);
    } catch (err) {
      setError(formatError(err, "Could not load daily register."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!data) return;
    const dates = generateDateRange(data.from_date, data.to_date);
    const recordMap = buildRecordMap(data.records);
    const rows = buildCsvRows(data.employees ?? [], dates, recordMap);
    downloadCsvFile(rows, `daily_attendance_${data.from_date}_${data.to_date}.csv`);
    pushToast({ message: "CSV exported.", type: "success" });
  }

  const employees = data?.employees ?? [];
  const dates     = data ? generateDateRange(data.from_date, data.to_date) : [];
  const recordMap = buildRecordMap(data?.records);

  return (
    <ErpScreenScaffold title="Daily Attendance Register">
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

          {employees.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="self-end px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700"
            >
              Export CSV
            </button>
          )}
        </div>

        <p className="mt-2 text-xs text-slate-400">Maximum 31-day window. Each cell shows abbreviated status.</p>

        {error && (
          <p className="mt-3 text-sm text-rose-600 font-medium">{error}</p>
        )}
      </ErpSectionCard>

      {/* ── Legend ── */}
      {data && (
        <ErpSectionCard>
          <div className="flex flex-wrap gap-3 text-xs">
            {Object.entries(STATUS_ABBR).map(([status, { label, cls }]) => (
              <span key={status} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium ${cls}`}>
                <span className="font-bold">{label}</span>
                <span className="opacity-70">= {status.replace("_", " ")}</span>
              </span>
            ))}
            <span className="text-slate-400 self-center">— = no record</span>
          </div>
        </ErpSectionCard>
      )}

      {/* ── Grid ── */}
      {data && (
        <ErpSectionCard>
          <div className="mb-3">
            <span className="text-sm font-semibold text-slate-700">
              {data.from_date} → {data.to_date}
              <span className="ml-2 text-xs text-slate-400 font-normal">
                {data.total_days} day{data.total_days !== 1 ? "s" : ""} · {employees.length} employee{employees.length !== 1 ? "s" : ""}
              </span>
            </span>
          </div>

          {employees.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No records found for this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap sticky left-0 bg-slate-50 z-10 min-w-[160px]">
                      Employee
                    </th>
                    {dates.map((d) => {
                      const dayNum = new Date(`${d}T00:00:00.000Z`).getUTCDay();
                      const isWknd = dayNum === 0 || dayNum === 6;
                      return (
                        <th
                          key={d}
                          className={`text-center px-1 py-2 font-medium whitespace-nowrap min-w-[42px] ${isWknd ? "text-slate-400" : "text-slate-600"}`}
                        >
                          {d.slice(5)} {/* MM-DD */}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, idx) => (
                    <tr key={emp.employee_auth_user_id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-1.5 text-slate-800 whitespace-nowrap sticky left-0 bg-inherit z-10">
                        <div className="font-medium">{emp.employee_display}</div>
                        {emp.employee_code && (
                          <div className="text-slate-400 text-[10px]">{emp.employee_code}</div>
                        )}
                      </td>
                      {dates.map((d) => {
                        const status = recordMap.get(emp.employee_auth_user_id)?.get(d);
                        const abbr   = status ? STATUS_ABBR[status] : null;
                        return (
                          <td key={d} className="text-center px-1 py-1.5">
                            {abbr ? (
                              <span className={`inline-block px-1 py-0.5 rounded text-[10px] font-bold min-w-[22px] ${abbr.cls}`}>
                                {abbr.label}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
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
