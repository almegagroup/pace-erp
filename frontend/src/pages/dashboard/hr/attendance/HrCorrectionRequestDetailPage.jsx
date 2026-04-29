/*
 * File-ID: 8.5D-HR-CORR-DETAIL
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrCorrectionRequestDetailPage.jsx
 * Gate: 8
 * Phase: 5-D-3
 * Domain: HR
 * Purpose: Detail view for a single attendance correction request.
 *          When mode = "approvalInbox", the approver can approve or reject.
 *          When mode = "myRequests" or "approvalHistory", read-only.
 * Authority: Frontend
 */

import { useState } from "react";
import {
  getActiveScreenContext,
  popScreen,
} from "../../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import {
  formatDateTime,
  formatIsoDate,
  submitWorkflowDecision,
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
    <span className={`inline-block border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${cls}`}>
      {state ?? "—"}
    </span>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-sm text-slate-400">—</span>;
  const cls = STATUS_TONE[status] ?? "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-block border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function DecisionHistory({ history }) {
  if (!Array.isArray(history) || history.length === 0) {
    return (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
        No decisions yet.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {history.map((row) => (
        <div
          key={`${row.stage_number}-${row.decided_at}`}
          className="border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              Stage {row.stage_number} | {row.decision}
            </span>
            <span>{formatDateTime(row.decided_at)}</span>
          </div>
          <div className="mt-1 text-slate-500">
            {row.approver_display
              ? row.approver_display.split("|")[0]?.trim() ?? row.approver_display
              : row.approver_auth_user_id}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HrCorrectionRequestDetailPage() {
  const context = getActiveScreenContext() ?? {};
  const request = context.request ?? null;
  const mode = context.mode ?? "myRequests"; // "myRequests" | "approvalInbox" | "approvalHistory"

  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");

  const isApprovalMode = mode === "approvalInbox";
  const canDecide = isApprovalMode && request?.current_state === "PENDING";

  useErpScreenHotkeys({
    approve: {
      disabled: !canDecide || deciding,
      perform: () => handleDecision("APPROVED"),
    },
    reject: {
      disabled: !canDecide || deciding,
      perform: () => handleDecision("REJECTED"),
    },
  });

  async function handleDecision(decision) {
    if (!canDecide) return;

    const confirmed = await openActionConfirm({
      eyebrow: "Attendance Correction",
      title: decision === "APPROVED" ? "Approve Correction Request" : "Reject Correction Request",
      message: decision === "APPROVED"
        ? `Approve this correction request? The employee's day record for ${formatIsoDate(request.target_date)} will be updated to ${request.requested_status?.replace(/_/g, " ")}.`
        : `Reject this correction request? The day record will remain unchanged.`,
      confirmLabel: decision === "APPROVED" ? "Approve" : "Reject",
      cancelLabel: "Cancel",
    });

    if (!confirmed) return;

    setDeciding(true);
    setError("");
    try {
      await submitWorkflowDecision(
        request.workflow_request_id,
        decision,
        request.parent_company_id ?? null,
      );
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      popScreen();
    } catch (err) {
      setError(formatError(err, "Decision could not be submitted."));
    } finally {
      setDeciding(false);
    }
  }

  const approveAction = canDecide
    ? {
        key: "approve",
        label: "Approve",
        hint: "A",
        tone: "success",
        disabled: deciding,
        onClick: () => handleDecision("APPROVED"),
      }
    : null;

  const rejectAction = canDecide
    ? {
        key: "reject",
        label: "Reject",
        hint: "R",
        tone: "danger",
        disabled: deciding,
        onClick: () => handleDecision("REJECTED"),
      }
    : null;

  const backAction = {
    key: "back",
    label: "Back",
    tone: "neutral",
    onClick: () => popScreen(),
  };

  const actions = [
    ...(approveAction ? [approveAction] : []),
    ...(rejectAction ? [rejectAction] : []),
    backAction,
  ];

  return (
    <ErpScreenScaffold
      eyebrow="HR Attendance"
      title="Correction Request Detail"
      actions={actions}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      footerHints={
        canDecide
          ? ["A Approve", "R Reject", "Esc Back", "Ctrl+K Command Bar"]
          : ["Esc Back", "Ctrl+K Command Bar"]
      }
    >
      {!request ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No request context found. Return to the list and open the row again.
        </div>
      ) : (
        <div className="grid gap-4">
          {/* Status + state */}
          <ErpSectionCard eyebrow="Correction Request" title="Overview">
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-3 items-center">
                <StateBadge state={request.current_state} />
                {request.current_state === "PENDING" && isApprovalMode ? (
                  <span className="text-xs text-amber-700 font-medium">Awaiting your decision</span>
                ) : null}
              </div>

              <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <ErpDenseFormRow label="Target Date">
                  <span className="font-mono text-slate-800">{formatIsoDate(request.target_date)}</span>
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Employee">
                  <span className="text-slate-800">
                    {request.target_employee_display
                      ? request.target_employee_display.split("|")[0]?.trim() ?? request.target_employee_display
                      : request.target_employee_id}
                  </span>
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Previous Status">
                  <StatusBadge status={request.previous_status} />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Requested Status">
                  <StatusBadge status={request.requested_status} />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Correction Note">
                  <span className="text-slate-700">{request.correction_note ?? "—"}</span>
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Submitted By">
                  <span className="text-slate-700">
                    {request.requester_display
                      ? request.requester_display.split("|")[0]?.trim() ?? request.requester_display
                      : request.requester_auth_user_id}
                  </span>
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Submitted At">
                  <span className="text-slate-500 text-xs">{formatDateTime(request.created_at)}</span>
                </ErpDenseFormRow>
              </div>
            </div>
          </ErpSectionCard>

          {/* Decision history */}
          <ErpSectionCard eyebrow="Approval" title="Decision History">
            <DecisionHistory history={request.decision_history ?? []} />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
