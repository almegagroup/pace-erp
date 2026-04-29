/*
 * File-ID: 8.5D-HR-CORR-HISTORY
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrCorrectionApprovalHistoryPage.jsx
 * Gate: 8
 * Phase: 5-D-3
 * Domain: HR
 * Purpose: Approval scope history — shows all correction requests (any state)
 *          that fall within the current approver's scope. Read-only view.
 * Authority: Frontend
 */

import { useCallback, useEffect, useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  formatDateTime,
  formatIsoDate,
  listCorrectionApprovalHistory,
} from "../hrApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatError(err, fallback) {
  if (!err || typeof err !== "object") return fallback;
  const trace = typeof err.decisionTrace === "string" ? err.decisionTrace : null;
  const code = typeof err.code === "string" ? err.code : "REQUEST_BLOCKED";
  return `${err.message ?? fallback} (${trace ?? code})`;
}

const STATE_TONE = {
  PENDING:   "border-amber-200 bg-amber-50 text-amber-900",
  APPROVED:  "border-emerald-200 bg-emerald-50 text-emerald-900",
  REJECTED:  "border-rose-200 bg-rose-50 text-rose-900",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-600",
};

const STATUS_TONE = {
  PRESENT:    "border-green-200 bg-green-50 text-green-800",
  ABSENT:     "border-rose-200 bg-rose-50 text-rose-800",
  MISS_PUNCH: "border-amber-200 bg-amber-50 text-amber-800",
};

function StateBadge({ state }) {
  const cls = STATE_TONE[state] ?? STATE_TONE.PENDING;
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${cls}`}>
      {state ?? "—"}
    </span>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-[10px] text-slate-400">—</span>;
  const cls = STATUS_TONE[status] ?? "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HrCorrectionApprovalHistoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listCorrectionApprovalHistory();
      setRows(data?.requests ?? []);
    } catch (err) {
      setError(formatError(err, "Correction approval history could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: load },
  });

  function openDetail(row) {
    openScreenWithContext("HR_ATTENDANCE_CORRECTION_REQUEST_DETAIL", { request: row, mode: "approvalHistory" });
  }

  return (
    <ErpScreenScaffold
      eyebrow="HR Attendance"
      title="Correction Approval History"
      footerHints={["F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
      actions={[
        {
          key: "refresh",
          label: "Refresh",
          hint: "F8",
          tone: "neutral",
          disabled: loading,
          onClick: load,
        },
      ]}
      error={error}
    >
      <ErpSectionCard
        eyebrow="All Corrections in Your Scope"
        title={loading ? "Loading…" : `${rows.length} request${rows.length !== 1 ? "s" : ""}`}
      >
        {rows.length === 0 && !loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No correction requests found in your approval scope.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Employee</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Was</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Requested</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted By</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted At</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.correction_request_id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-800">
                      {formatIsoDate(row.target_date)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {row.target_employee_display
                        ? row.target_employee_display.split("|")[0]?.trim() ?? row.target_employee_display
                        : row.target_employee_id}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.previous_status} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.requested_status} />
                    </td>
                    <td className="px-3 py-2">
                      <StateBadge state={row.current_state} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {row.requester_display
                        ? row.requester_display.split("|")[0]?.trim() ?? row.requester_display
                        : row.requester_auth_user_id}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openDetail(row)}
                        className="border border-sky-600 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-800 hover:bg-sky-100 transition"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
