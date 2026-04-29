/*
 * File-ID: 8.5D-HR-CORR-INBOX
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrCorrectionApprovalInboxPage.jsx
 * Gate: 8
 * Phase: 5-D-3
 * Domain: HR
 * Purpose: Approval inbox — shows PENDING correction requests the current
 *          approver (Plant Manager) can act on. Clicking a row opens
 *          HrCorrectionRequestDetailPage in approval mode.
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
  listCorrectionApprovalInbox,
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

const STATUS_TONE = {
  PRESENT:    "border-green-200 bg-green-50 text-green-800",
  ABSENT:     "border-rose-200 bg-rose-50 text-rose-800",
  MISS_PUNCH: "border-amber-200 bg-amber-50 text-amber-800",
};

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

export default function HrCorrectionApprovalInboxPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listCorrectionApprovalInbox();
      setRows(data?.requests ?? []);
    } catch (err) {
      setError(formatError(err, "Correction approval inbox could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Reload whenever a workflow decision is made (approval/rejection on detail page)
    function onWorkflowChanged() { load(); }
    window.addEventListener("erp:workflow-changed", onWorkflowChanged);
    load();
    return () => window.removeEventListener("erp:workflow-changed", onWorkflowChanged);
  }, [load]);

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: load },
  });

  function openDetail(row) {
    openScreenWithContext("HR_ATTENDANCE_CORRECTION_REQUEST_DETAIL", { request: row, mode: "approvalInbox" });
  }

  return (
    <ErpScreenScaffold
      eyebrow="HR Attendance"
      title="Correction Approval Inbox"
      footerHints={["Enter Open", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
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
        eyebrow="Pending Corrections"
        title={loading ? "Loading…" : `${rows.length} pending request${rows.length !== 1 ? "s" : ""}`}
      >
        {rows.length === 0 && !loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No pending correction requests in your approval scope.
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
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted By</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted At</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.correction_request_id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => openDetail(row)}
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
                        onClick={(e) => { e.stopPropagation(); openDetail(row); }}
                        className="border border-amber-600 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800 hover:bg-amber-100 transition"
                      >
                        Review
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
