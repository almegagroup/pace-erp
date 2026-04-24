import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { pushToast } from "../../../store/uiToast.js";
import { getErrorMessage } from "../../../config/errorMessages.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import {
  resolveDefaultTransactionCompanyId,
} from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpColumnVisibilityDrawer from "../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import ErpReportFilterTemplate from "../../../components/templates/ErpReportFilterTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpInlineApprovalRow from "../../../components/data/ErpInlineApprovalRow.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import {
  calculateInclusiveDays,
  cancelLeaveRequest,
  cancelOutWorkRequest,
  createLeaveRequest,
  createOutWorkDestination,
  createOutWorkRequest,
  formatDateTime,
  formatIsoDate,
  getHrEarliestBackdate,
  listLeaveApprovalHistory,
  listLeaveApprovalInbox,
  listLeaveRegister,
  listMyLeaveRequests,
  listMyOutWorkRequests,
  listOutWorkApprovalHistory,
  listOutWorkApprovalInbox,
  listOutWorkDestinations,
  listOutWorkRegister,
  submitWorkflowDecision,
  updateLeaveRequest,
  updateOutWorkRequest,
} from "./hrApi.js";

const STATUS_TONE_CLASS = Object.freeze({
  PENDING: "border-amber-200 bg-amber-50 text-amber-900",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-900",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-900",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-700",
});

const HR_ENTRY_FOOTER_HINTS = Object.freeze([
  "Tab Next Field",
  "Ctrl+S Submit",
  "Esc Cancel",
]);

const HR_LIST_FOOTER_HINTS = Object.freeze([
  "↑↓ Navigate",
  "Enter Open",
  "Space Select",
  "F8 Refresh",
  "Esc Back",
  "Ctrl+K Command Bar",
]);

const HR_APPROVAL_FOOTER_HINTS = Object.freeze([
  "↑↓ Navigate",
  "Enter View",
  "A Approve",
  "R Reject",
  "F8 Refresh",
  "Esc Back",
]);

function todayDefault() {
  return new Date().toISOString().slice(0, 10);
}

function formatError(error, fallbackMessage) {
  if (!error || typeof error !== "object") {
    return fallbackMessage;
  }

  const decisionTrace =
    typeof error.decisionTrace === "string" ? error.decisionTrace : null;
  const code = typeof error.code === "string" ? error.code : "REQUEST_BLOCKED";
  const gateId = typeof error.gateId === "string" ? ` | Gate ${error.gateId}` : "";
  const requestId =
    typeof error.requestId === "string" ? ` | Req ${error.requestId}` : "";

  return `${error.message ?? fallbackMessage} (${decisionTrace ?? code}${gateId}${requestId})`;
}

function canOpenHrResource(menuSnapshot, resourceCode, routePath) {
  const rows = Array.isArray(menuSnapshot) ? menuSnapshot : [];

  return rows.some(
    (row) => row?.resource_code === resourceCode || row?.route_path === routePath,
  );
}

export function RequestStatusBadge({ state }) {
  return (
    <span
      className={`border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        STATUS_TONE_CLASS[state] ?? STATUS_TONE_CLASS.PENDING
      }`}
    >
      {state ?? "UNKNOWN"}
    </span>
  );
}

export function RequestDecisionHistory({ history = [] }) {
  if (!Array.isArray(history) || history.length === 0) {
    return (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
        No decision yet.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {history.map((row) => (
        <div
          key={`${row.stage_number}-${row.decided_at}-${row.approver_auth_user_id}`}
          className="border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              Stage {row.stage_number} | {row.decision}
            </span>
            <span>{formatDateTime(row.decided_at)}</span>
          </div>
          <div className="mt-1">{row.approver_display ?? row.approver_auth_user_id}</div>
        </div>
      ))}
    </div>
  );
}

function splitDisplay(displayValue, fallbackCode = "", fallbackName = "") {
  const normalizedDisplay = String(displayValue ?? "").trim();

  if (!normalizedDisplay) {
    return {
      name: fallbackName || "Unknown User",
      code: fallbackCode || "-",
    };
  }

  const parts = normalizedDisplay.split("|").map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      name: parts[0] || fallbackName || "Unknown User",
      code: parts[1] || fallbackCode || "-",
    };
  }

  return {
    name: fallbackName || normalizedDisplay,
    code: fallbackCode || "-",
  };
}

function buildApproverStatus(request) {
  const history = Array.isArray(request?.decision_history) ? request.decision_history : [];

  if (history.length === 0) {
    return request?.current_state === "PENDING" ? "Awaiting decision" : "No approver action";
  }

  const latestDecision = history[history.length - 1];
  const approverLabel = latestDecision?.approver_display ?? latestDecision?.approver_auth_user_id ?? "Unknown";
  return `Stage ${latestDecision?.stage_number ?? "-"} ${latestDecision?.decision ?? "DECIDED"} | ${approverLabel}`;
}

const HR_REQUEST_COLUMN_DEFS = Object.freeze([
  {
    key: "name",
    label: "Name",
    width: "minmax(180px, 1.1fr)",
  },
  {
    key: "code",
    label: "Code",
    width: "minmax(110px, 0.7fr)",
  },
  {
    key: "company",
    label: "Company",
    width: "minmax(190px, 1fr)",
  },
  {
    key: "department",
    label: "Department",
    width: "minmax(160px, 0.9fr)",
  },
  {
    key: "fromDate",
    label: "From Date",
    width: "minmax(120px, 0.7fr)",
  },
  {
    key: "toDate",
    label: "To Date",
    width: "minmax(120px, 0.7fr)",
  },
  {
    key: "days",
    label: "Days",
    width: "minmax(80px, 0.45fr)",
  },
  {
    key: "reason",
    label: "Reason",
    width: "minmax(220px, 1.4fr)",
  },
  {
    key: "status",
    label: "Status",
    width: "minmax(120px, 0.7fr)",
  },
  {
    key: "approverStatus",
    label: "Approver Status",
    width: "minmax(220px, 1.35fr)",
  },
  {
    key: "createdAt",
    label: "Created At",
    width: "minmax(170px, 0.9fr)",
  },
  {
    key: "approvalType",
    label: "Approval Type",
    width: "minmax(120px, 0.7fr)",
  },
  {
    key: "workflow",
    label: "Workflow ID",
    width: "minmax(220px, 1fr)",
  },
]);

const HR_DEFAULT_VISIBLE_COLUMN_KEYS = Object.freeze([
  "name",
  "code",
  "company",
  "department",
  "fromDate",
  "toDate",
  "days",
  "reason",
  "status",
  "approverStatus",
  "createdAt",
  "approvalType",
]);

function getHrRequestColumn(key) {
  return HR_REQUEST_COLUMN_DEFS.find((column) => column.key === key) ?? null;
}

function loadHrVisibleColumnKeys(storageKey) {
  if (typeof window === "undefined") {
    return [...HR_DEFAULT_VISIBLE_COLUMN_KEYS];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [...HR_DEFAULT_VISIBLE_COLUMN_KEYS];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...HR_DEFAULT_VISIBLE_COLUMN_KEYS];
    }

    const allowedKeys = parsed.filter((key) => getHrRequestColumn(key));
    return allowedKeys.length > 0 ? allowedKeys : [...HR_DEFAULT_VISIBLE_COLUMN_KEYS];
  } catch {
    return [...HR_DEFAULT_VISIBLE_COLUMN_KEYS];
  }
}

function saveHrVisibleColumnKeys(storageKey, columnKeys) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(columnKeys));
}

function useHrVisibleColumns(storageKey) {
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() =>
    loadHrVisibleColumnKeys(storageKey),
  );

  const visibleColumns = useMemo(
    () =>
      visibleColumnKeys
        .map((key) => getHrRequestColumn(key))
        .filter(Boolean),
    [visibleColumnKeys],
  );

  useEffect(() => {
    saveHrVisibleColumnKeys(storageKey, visibleColumnKeys);
  }, [storageKey, visibleColumnKeys]);

  function toggleColumn(columnKey) {
    setVisibleColumnKeys((current) => {
      if (current.includes(columnKey)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((key) => key !== columnKey);
      }

      return HR_REQUEST_COLUMN_DEFS
        .map((column) => column.key)
        .filter((key) => current.includes(key) || key === columnKey);
    });
  }

  function resetColumns() {
    setVisibleColumnKeys([...HR_DEFAULT_VISIBLE_COLUMN_KEYS]);
  }

  return {
    visibleColumns,
    visibleColumnKeys,
    toggleColumn,
    resetColumns,
  };
}

function HrRequestRowActions({ mode, request, onEdit, onCancel, onApprove, onReject }) {
  if (mode === "myRequests" && request.can_cancel) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEdit?.(request)}
          className="border border-sky-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onCancel?.(request)}
          className="border border-rose-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (mode === "approvalInbox") {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onApprove?.(request)}
          className="border border-emerald-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onReject?.(request)}
          className="border border-rose-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700"
        >
          Reject
        </button>
      </div>
    );
  }

  return null;
}

function renderHrRequestColumnValue(request, kind, columnKey) {
  const requesterParts = splitDisplay(
    request.requester_display,
    request.requester_auth_user_id,
    request.requester_display,
  );
  const approverStatus = buildApproverStatus(request);
  const latestDecisionCount = Number(request.decision_count ?? 0);
  const companyDisplay =
    request.parent_company_name ??
    request.parent_company_code ??
    request.parent_company_id ??
    "-";

  const departmentDisplay =
    request.department_name ??
    request.department_code ??
    "-";

  const contentByColumn = {
    name: <div className="text-sm font-semibold text-slate-900">{requesterParts.name}</div>,
    code: <div className="text-sm text-slate-700">{requesterParts.code}</div>,
    company: <div className="text-sm text-slate-700">{companyDisplay}</div>,
    department: <div className="text-sm text-slate-700">{departmentDisplay}</div>,
    fromDate: <div className="text-sm text-slate-700">{formatIsoDate(request.from_date)}</div>,
    toDate: <div className="text-sm text-slate-700">{formatIsoDate(request.to_date)}</div>,
    days: <div className="text-sm text-slate-700">{request.total_days}</div>,
    reason: (
      <div>
        <div className="text-sm text-slate-700">{request.reason}</div>
        {kind === "outWork" ? (
          <div className="mt-1 text-xs text-slate-500">
            {request.destination_name} | {request.destination_address}
          </div>
        ) : null}
      </div>
    ),
    status: (
      <div className="pt-1">
        <RequestStatusBadge state={request.current_state} />
      </div>
    ),
    approverStatus: (
      <div>
        <div className="text-sm text-slate-700">{approverStatus}</div>
        <div className="mt-1 text-xs text-slate-500">
          {latestDecisionCount} decision{latestDecisionCount === 1 ? "" : "s"} logged
        </div>
      </div>
    ),
    createdAt: <div className="text-sm text-slate-700">{formatDateTime(request.created_at)}</div>,
    approvalType: (
      <div className="text-sm font-semibold text-slate-900">{request.approval_type ?? "-"}</div>
    ),
    workflow: <div className="text-xs text-slate-700">{request.workflow_request_id ?? "-"}</div>,
  };

  return contentByColumn[columnKey] ?? <div className="text-sm text-slate-700">-</div>;
}

function buildHrDenseColumns(visibleColumns, kind) {
  return visibleColumns.map((column) => ({
    key: column.key,
    label: column.label,
    width: column.width,
    align: column.key === "days" ? "right" : "left",
    render: (row) => renderHrRequestColumnValue(row, kind, column.key),
  }));
}

function buildHrSummaryRow(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalDays = safeRows.reduce((sum, row) => sum + Number(row?.total_days ?? 0), 0);

  return {
    label: `Total Rows: ${safeRows.length}`,
    values: {
      days: totalDays > 0 ? `${totalDays}` : "",
    },
  };
}

function HrRequestColumnPickerModal({
  visible,
  visibleColumnKeys,
  onClose,
  onToggleColumn,
  onResetColumns,
}) {
  return (
    <ErpColumnVisibilityDrawer
      visible={visible}
      title="Choose Visible Columns"
      columns={HR_REQUEST_COLUMN_DEFS}
      visibleColumnKeys={visibleColumnKeys}
      onToggleColumn={onToggleColumn}
      onResetColumns={onResetColumns}
      onClose={onClose}
    />
  );
}

function HrRequestDetailModal({
  visible,
  request,
  kind,
  mode,
  onClose,
  onEdit,
  onCancel,
  onApprove,
  onReject,
}) {
  if (!request) {
    return null;
  }

  const requesterParts = splitDisplay(
    request.requester_display,
    request.requester_auth_user_id,
    request.requester_display,
  );
  const companyLabel =
    request.parent_company_name ??
    request.parent_company_code ??
    request.parent_company_id ??
    "-";
  const departmentLabel =
    request.department_name ??
    request.department_code ??
    "-";

  return (
    <ModalBase
      visible={visible}
      eyebrow={kind === "leave" ? "Leave Request Detail" : "Out Work Request Detail"}
      title={requesterParts.name}
      message="Use this detail view to inspect the row and take routine actions without leaving the queue."
      onEscape={onClose}
      width="min(960px, calc(100vw - 32px))"
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Back
          </button>
          <HrRequestRowActions
            mode={mode}
            request={request}
            onEdit={onEdit}
            onCancel={onCancel}
            onApprove={onApprove}
            onReject={onReject}
          />
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Requester</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{requesterParts.name}</div>
            <div className="text-xs text-slate-600">{requesterParts.code}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Company</div>
            <div className="mt-1 text-sm text-slate-900">{companyLabel}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Department</div>
            <div className="mt-1 text-sm text-slate-900">{departmentLabel}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
            <div className="mt-1"><RequestStatusBadge state={request.current_state} /></div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">From Date</div>
            <div className="mt-1">{formatIsoDate(request.from_date)}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">To Date</div>
            <div className="mt-1">{formatIsoDate(request.to_date)}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Days</div>
            <div className="mt-1">{request.total_days ?? "-"}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Workflow</div>
            <div className="mt-1">{request.workflow_request_id ?? "-"}</div>
          </div>
        </div>
        {kind === "outWork" ? (
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Destination</div>
            <div className="mt-1 text-sm text-slate-900">{request.destination_name ?? "-"}</div>
            <div className="text-xs text-slate-600">{request.destination_address ?? "-"}</div>
          </div>
        ) : null}
        <div className="border border-slate-300 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reason</div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{request.reason || "-"}</div>
        </div>
        <div className="grid gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Decision History
          </div>
          <RequestDecisionHistory history={request.decision_history} />
        </div>
      </div>
    </ModalBase>
  );
}

function HrApprovalDenseTable({
  rows,
  columns,
  getRowProps,
  onApprove,
  onReject,
  onActivate,
  emptyMessage,
}) {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  return (
    <div className="overflow-auto border border-slate-300 bg-white" style={{ maxHeight: "calc(100vh - 240px)" }}>
      <table className="erp-grid-table min-w-full text-xs">
        <thead className="bg-slate-800 text-white">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className="sticky top-0 z-10 border-b border-slate-700 bg-slate-800 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
                style={column.width ? { width: column.width } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => {
              const baseRowProps = getRowProps(row, index);
              return (
                <ErpInlineApprovalRow
                  key={row.workflow_request_id ?? `${index}`}
                  row={row}
                  index={index}
                  columns={columns}
                  isFocused={focusedIndex === index}
                  onApprove={onApprove}
                  onReject={onReject}
                  onActivate={onActivate}
                  rowProps={{
                    ...baseRowProps,
                    onFocus: (event) => {
                      baseRowProps.onFocus?.(event);
                      setFocusedIndex(index);
                    },
                  }}
                />
              );
            })
          ) : (
            <tr>
              <td colSpan={Math.max(columns.length, 1)} className="px-3 py-6 text-left text-sm text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function LeaveApplyWorkspace() {
  const navigate = useNavigate();
  const { menu, runtimeContext } = useMenu();
  const [fromDate, setFromDate] = useState(todayDefault());
  const [toDate, setToDate] = useState(todayDefault());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transactionCompanyId, setTransactionCompanyId] = useState(() =>
    resolveDefaultTransactionCompanyId(runtimeContext),
  );

  const totalDays = calculateInclusiveDays(fromDate, toDate);
  const earliestBackdate = getHrEarliestBackdate();
  const canViewApprovalInbox = useMemo(
    () =>
      canOpenHrResource(
        menu,
        "HR_LEAVE_APPROVAL_INBOX",
        "/dashboard/hr/leave/approval-inbox",
      ),
    [menu],
  );

  useEffect(() => {
    const nextCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    setTransactionCompanyId((current) => current || nextCompanyId);
  }, [runtimeContext]);

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleSubmit(),
    },
    focusPrimary: {
      perform: () => {
        const companyField = globalThis.document?.querySelector(
          "[data-transaction-company='leave'] select, [data-transaction-company='leave']",
        );
        companyField?.focus?.();
      },
    },
  });

  const actions = [
    {
      key: "my-requests",
      label: "My Requests",
      tone: "neutral",
      onClick: () => {
        openScreen("HR_LEAVE_MY_REQUESTS", { mode: "replace" });
        navigate("/dashboard/hr/leave/my-requests");
      },
    },
    ...(canViewApprovalInbox
      ? [
          {
            key: "approval-inbox",
            label: "Approval Inbox",
            tone: "neutral",
            onClick: () => {
              openScreen("HR_LEAVE_APPROVAL_INBOX", { mode: "replace" });
              navigate("/dashboard/hr/leave/approval-inbox");
            },
          },
        ]
      : []),
    {
      key: "submit",
      label: saving ? "Submitting..." : "Send Request",
      hint: "Ctrl+S / F2",
      tone: "primary",
      disabled: saving,
      onClick: () => void handleSubmit(),
    },
  ];

  async function handleSubmit() {
    if (!transactionCompanyId) {
      setError("Transaction company is required.");
      return;
    }

    if (!fromDate || !toDate || !reason.trim()) {
      setError("Transaction company, from date, to date, and reason are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await createLeaveRequest({
        from_date: fromDate,
        to_date: toDate,
        reason: reason.trim(),
      }, transactionCompanyId);
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setNotice("Leave request submitted.");
      setReason("");
      setFromDate(todayDefault());
      setToDate(todayDefault());
    } catch (err) {
      setError(formatError(err, "Leave request could not be submitted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="HR Management"
      title="Leave Apply"
      actions={actions}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      footerHints={HR_ENTRY_FOOTER_HINTS}
      formEyebrow="Leave Request"
      formTitle="Submit a leave request"
      formContent={
        <div className="grid gap-[var(--erp-form-gap)]">
          <ErpDenseFormRow label="Company" required>
            <div data-transaction-company="leave" tabIndex={0}>
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={transactionCompanyId}
                onChange={setTransactionCompanyId}
              />
            </div>
          </ErpDenseFormRow>
          <ErpDenseFormRow label="From Date" required>
            <input
              type="date"
              value={fromDate}
              min={earliestBackdate}
              onChange={(event) => setFromDate(event.target.value)}
              className="w-full max-w-[220px] border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="To Date" required>
            <input
              type="date"
              value={toDate}
              min={fromDate || earliestBackdate}
              onChange={(event) => setToDate(event.target.value)}
              className="w-full max-w-[220px] border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Number Of Days">
            <input
              type="text"
              readOnly
              value={totalDays > 0 ? `${totalDays}` : "-"}
              className="w-full max-w-[220px] border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Reason" required>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="Write why you need leave."
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </ErpDenseFormRow>
        </div>
      }
    />
  );
}

export function OutWorkApplyWorkspace() {
  const navigate = useNavigate();
  const { menu, runtimeContext } = useMenu();
  const [fromDate, setFromDate] = useState(todayDefault());
  const [toDate, setToDate] = useState(todayDefault());
  const [reason, setReason] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [destinations, setDestinations] = useState([]);
  const [showDestinationModal, setShowDestinationModal] = useState(false);
  const [destinationName, setDestinationName] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDestinations, setLoadingDestinations] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const destinationNameRef = useRef(null);
  const [transactionCompanyId, setTransactionCompanyId] = useState(() =>
    resolveDefaultTransactionCompanyId(runtimeContext),
  );

  const totalDays = calculateInclusiveDays(fromDate, toDate);
  const earliestBackdate = getHrEarliestBackdate();
  const canViewApprovalInbox = useMemo(
    () =>
      canOpenHrResource(
        menu,
        "HR_OUT_WORK_APPROVAL_INBOX",
        "/dashboard/hr/out-work/approval-inbox",
      ),
    [menu],
  );

  useEffect(() => {
    const nextCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    setTransactionCompanyId((current) => current || nextCompanyId);
  }, [runtimeContext]);

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleSubmit(),
    },
    focusPrimary: {
      perform: () => {
        const companyField = globalThis.document?.querySelector(
          "[data-transaction-company='outwork'] select, [data-transaction-company='outwork']",
        );
        companyField?.focus?.();
      },
    },
  });

  const actions = [
    {
      key: "my-requests",
      label: "My Requests",
      tone: "neutral",
      onClick: () => {
        openScreen("HR_OUT_WORK_MY_REQUESTS", { mode: "replace" });
        navigate("/dashboard/hr/out-work/my-requests");
      },
    },
    ...(canViewApprovalInbox
      ? [
          {
            key: "approval-inbox",
            label: "Approval Inbox",
            tone: "neutral",
            onClick: () => {
              openScreen("HR_OUT_WORK_APPROVAL_INBOX", { mode: "replace" });
              navigate("/dashboard/hr/out-work/approval-inbox");
            },
          },
        ]
      : []),
    {
      key: "submit",
      label: saving ? "Submitting..." : "Send Request",
      hint: "Ctrl+S / F2",
      tone: "primary",
      disabled: saving,
      onClick: () => void handleSubmit(),
    },
  ];

  const refreshDestinations = useCallback(async (preferredDestinationId = "") => {
    setLoadingDestinations(true);
    try {
      const data = await listOutWorkDestinations(transactionCompanyId);
      const rows = data.destinations ?? [];
      setDestinations(rows);
      const nextDestinationId =
        rows.find((row) => row.destination_id === preferredDestinationId)?.destination_id ??
        rows[0]?.destination_id ??
        "";
      setDestinationId(nextDestinationId);
    } catch (err) {
      setDestinations([]);
      setDestinationId("");
      setError(formatError(err, "Destination list could not be loaded."));
    } finally {
      setLoadingDestinations(false);
    }
  }, [transactionCompanyId]);

  useEffect(() => {
    if (!transactionCompanyId) {
      setDestinations([]);
      setDestinationId("");
      setLoadingDestinations(false);
      return;
    }

    void refreshDestinations();
  }, [transactionCompanyId, refreshDestinations]);

  async function handleCreateDestination() {
    if (!transactionCompanyId) {
      setError("Transaction company is required before creating a destination.");
      return;
    }

    if (!destinationName.trim() || !destinationAddress.trim()) {
      setError("Destination name and address are required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const data = await createOutWorkDestination({
        destination_name: destinationName.trim(),
        destination_address: destinationAddress.trim(),
      }, transactionCompanyId);
      setShowDestinationModal(false);
      setDestinationName("");
      setDestinationAddress("");
      setNotice("Destination created and added to the dropdown.");
      await refreshDestinations(data.destination?.destination_id ?? "");
    } catch (err) {
      setError(formatError(err, "Destination could not be created."));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!transactionCompanyId) {
      setError("Transaction company is required.");
      return;
    }

    if (!fromDate || !toDate || !reason.trim() || !destinationId) {
      setError("Transaction company, from date, to date, destination, and reason are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await createOutWorkRequest({
        from_date: fromDate,
        to_date: toDate,
        destination_id: destinationId,
        reason: reason.trim(),
      }, transactionCompanyId);
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setNotice("Out work request submitted.");
      setReason("");
      setFromDate(todayDefault());
      setToDate(todayDefault());
    } catch (err) {
      setError(formatError(err, "Out work request could not be submitted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ErpEntryFormTemplate
        eyebrow="HR Management"
        title="Out Work Apply"
        actions={actions}
        notices={[
          ...(error ? [{ key: "error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
        ]}
        footerHints={HR_ENTRY_FOOTER_HINTS}
        formEyebrow="Out Work Request"
        formTitle="Submit an out work request"
        formContent={
          <div className="grid gap-[var(--erp-form-gap)]">
            <ErpDenseFormRow label="Company" required>
              <div data-transaction-company="outwork" tabIndex={0}>
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={transactionCompanyId}
                  onChange={setTransactionCompanyId}
                />
              </div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="From Date" required>
              <input
                type="date"
                value={fromDate}
                min={earliestBackdate}
                onChange={(event) => setFromDate(event.target.value)}
                className="w-full max-w-[220px] border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="To Date" required>
              <input
                type="date"
                value={toDate}
                min={fromDate || earliestBackdate}
                onChange={(event) => setToDate(event.target.value)}
                className="w-full max-w-[220px] border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Number Of Days">
              <input
                type="text"
                readOnly
                value={totalDays > 0 ? `${totalDays}` : "-"}
                className="w-full max-w-[220px] border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Destination" required>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={destinationId}
                  disabled={loadingDestinations || !transactionCompanyId}
                  onChange={(event) => setDestinationId(event.target.value)}
                  className="min-w-[280px] flex-1 border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">
                    {loadingDestinations ? "Loading destination..." : "Choose destination"}
                  </option>
                  {destinations.map((row) => (
                    <option key={row.destination_id} value={row.destination_id}>
                      {row.destination_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!transactionCompanyId}
                  onClick={() => setShowDestinationModal(true)}
                  className="border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create Destination
                </button>
              </div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Reason" required>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                placeholder="Write why you are outside office for company work."
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </ErpDenseFormRow>
          </div>
        }
      />
      <ModalBase
        visible={showDestinationModal}
        eyebrow="Out Work"
        title="Create Destination"
        message="Add a new destination for the selected transaction company. It will appear in the dropdown after save."
        onEscape={() => setShowDestinationModal(false)}
        initialFocusRef={destinationNameRef}
        width="min(560px, calc(100vw - 32px))"
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowDestinationModal(false)}
              className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreateDestination()}
              className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900"
            >
              Save Destination
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Destination Name
            </span>
            <input
              ref={destinationNameRef}
              type="text"
              value={destinationName}
              onChange={(event) => setDestinationName(event.target.value)}
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Destination Address
            </span>
            <textarea
              rows={4}
              value={destinationAddress}
              onChange={(event) => setDestinationAddress(event.target.value)}
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
        </div>
      </ModalBase>
    </>
  );
}

function useHrQueryLoader(loader, args = []) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const argsRef = useRef(args);
  const argKey = JSON.stringify(args ?? []);

  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  const refresh = useCallback(async (...nextArgs) => {
    setLoading(true);
    setError("");

    try {
      const data = await loader(...nextArgs);
      setRows(data?.requests ?? []);
    } catch (err) {
      setRows([]);
      setError(formatError(err, "Workspace could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    void refresh(...argsRef.current);
  }, [argKey, refresh]);

  return {
    rows,
    loading,
    error,
    setError,
    refresh,
  };
}

function HrRequestListWorkspace({
  kind,
  title,
  loader,
  openApply,
  openInbox,
}) {
  const navigate = useNavigate();
  const { menu } = useMenu();
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.myRequests`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader);
  const [notice, setNotice] = useState("");
  const [editingRequest, setEditingRequest] = useState(null);
  const [detailRequest, setDetailRequest] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editFromDate, setEditFromDate] = useState(todayDefault());
  const [editToDate, setEditToDate] = useState(todayDefault());
  const [editReason, setEditReason] = useState("");
  const [editDestinationId, setEditDestinationId] = useState("");
  const [editDestinations, setEditDestinations] = useState([]);
  const [editDestinationsLoading, setEditDestinationsLoading] = useState(false);
  const earliestBackdate = getHrEarliestBackdate();
  const editTotalDays = calculateInclusiveDays(editFromDate, editToDate);
  const approvalInboxRoute =
    kind === "leave"
      ? "/dashboard/hr/leave/approval-inbox"
      : "/dashboard/hr/out-work/approval-inbox";
  const canViewApprovalInbox = useMemo(
    () => canOpenHrResource(menu, openInbox, approvalInboxRoute),
    [approvalInboxRoute, menu, openInbox],
  );

  const filteredRows = useMemo(
    () =>
      applyQuickFilter(rows, searchQuery, [
        "requester_display",
        "reason",
        "current_state",
        "parent_company_name",
        "parent_company_code",
        "destination_name",
        "destination_address",
        "workflow_request_id",
      ]),
    [rows, searchQuery],
  );
  const denseColumns = useMemo(
    () => buildHrDenseColumns(visibleColumns, kind),
    [visibleColumns, kind],
  );
  const summaryRow = useMemo(() => buildHrSummaryRow(filteredRows), [filteredRows]);
  const { getRowProps } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setDetailRequest(row ?? null),
  });

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void refresh(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus?.(),
    },
  });

  async function loadEditDestinations(preferredDestinationId = "") {
    if (kind !== "outWork") {
      return;
    }

    setEditDestinationsLoading(true);
    try {
      const data = await listOutWorkDestinations();
      const destinationRows = data.destinations ?? [];
      setEditDestinations(destinationRows);
      setEditDestinationId(
        destinationRows.find((row) => row.destination_id === preferredDestinationId)?.destination_id ??
          destinationRows[0]?.destination_id ??
          "",
      );
    } catch (err) {
      setEditDestinations([]);
      setEditDestinationId("");
      setError(formatError(err, "Destination list could not be loaded."));
    } finally {
      setEditDestinationsLoading(false);
    }
  }

  async function handleEdit(request) {
    setNotice("");
    setDetailRequest(null);
    setEditFromDate(request.from_date ?? todayDefault());
    setEditToDate(request.to_date ?? todayDefault());
    setEditReason(request.reason ?? "");
    setEditingRequest(request);

    if (kind === "outWork") {
      await loadEditDestinations(request.destination_id ?? "");
    }
  }

  async function handleCancel(request) {
    const approved = await openActionConfirm({
      eyebrow: kind === "leave" ? "Leave Request" : "Out Work Request",
      title: "Cancel Pending Request",
      message: `Cancel request ${request.workflow_request_id}?`,
      confirmLabel: "Cancel Request",
      cancelLabel: "Keep",
    });

    if (!approved) return;

    try {
      if (kind === "leave") {
        await cancelLeaveRequest(request.leave_request_id);
      } else {
        await cancelOutWorkRequest(request.out_work_request_id);
      }
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setDetailRequest(null);
      await refresh();
      setNotice("Request cancelled.");
    } catch (err) {
      setError(formatError(err, "Request could not be cancelled."));
    }
  }

  async function handleEditSave() {
    if (!editingRequest) {
      return;
    }

    if (!editFromDate || !editToDate || !editReason.trim()) {
      setError("From date, to date, and reason are required.");
      return;
    }

    if (kind === "outWork" && !editDestinationId) {
      setError("Destination is required.");
      return;
    }

    setEditSaving(true);
    setError("");
    setNotice("");

    try {
      if (kind === "leave") {
        await updateLeaveRequest({
          leave_request_id: editingRequest.leave_request_id,
          from_date: editFromDate,
          to_date: editToDate,
          reason: editReason.trim(),
        });
      } else {
        await updateOutWorkRequest({
          out_work_request_id: editingRequest.out_work_request_id,
          from_date: editFromDate,
          to_date: editToDate,
          destination_id: editDestinationId,
          reason: editReason.trim(),
        });
      }

      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setEditingRequest(null);
      setDetailRequest(null);
      await refresh();
      setNotice(kind === "leave" ? "Leave request updated." : "Out work request updated.");
    } catch (err) {
      setError(formatError(err, "Request could not be updated."));
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="HR Management"
      title={title}
      actions={[
        {
          key: "apply",
          label: kind === "leave" ? "Leave Apply" : "Out Work Apply",
          tone: "neutral",
          onClick: () => {
            openScreen(openApply, { mode: "replace" });
            navigate(kind === "leave" ? "/dashboard/hr/leave/apply" : "/dashboard/hr/out-work/apply");
          },
        },
        ...(canViewApprovalInbox
          ? [
              {
                key: "inbox",
                label: "Approval Inbox",
                tone: "neutral",
                onClick: () => {
                  openScreen(openInbox, { mode: "replace" });
                  navigate(approvalInboxRoute);
                },
              },
            ]
          : []),
        {
          key: "columns",
          label: "Columns",
          tone: "neutral",
          onClick: () => setShowColumnPicker(true),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          hint: "Alt+R / F4",
          tone: "primary",
          onClick: () => void refresh(),
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      footerHints={HR_LIST_FOOTER_HINTS}
      filterSection={{
        eyebrow: "Request Search",
        title: "Find request history rows",
        children: (
          <QuickFilterInput
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchRef}
            placeholder="Search by reason, status, requester, destination, or workflow id"
          />
        ),
      }}
      listSection={{
        eyebrow: "Request History",
        title: loading
          ? "Loading request rows"
          : `${filteredRows.length} visible request${filteredRows.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading request history.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No request matches the current filter.
          </div>
        ) : (
          <ErpDenseGrid
            columns={denseColumns}
            rows={filteredRows}
            rowKey={(row) => row.workflow_request_id ?? row.leave_request_id ?? row.out_work_request_id}
            getRowProps={(_row, index) => getRowProps(index)}
            onRowActivate={(row) => setDetailRequest(row ?? null)}
            summaryRow={summaryRow}
            emptyMessage="No request matches the current filter."
          />
        ),
      }}
      bottomSection={
        <>
          <HrRequestColumnPickerModal
            visible={showColumnPicker}
            visibleColumnKeys={visibleColumnKeys}
            onClose={() => setShowColumnPicker(false)}
            onToggleColumn={toggleColumn}
            onResetColumns={resetColumns}
          />
          <HrRequestDetailModal
            visible={Boolean(detailRequest)}
            request={detailRequest}
            kind={kind}
            mode="myRequests"
            onClose={() => setDetailRequest(null)}
            onEdit={(row) => void handleEdit(row)}
            onCancel={(row) => void handleCancel(row)}
          />
          <ModalBase
            visible={Boolean(editingRequest)}
            eyebrow={kind === "leave" ? "Leave Request" : "Out Work Request"}
            title={kind === "leave" ? "Edit Pending Leave" : "Edit Pending Out Work"}
            message="Edit is allowed only until the first approver decision arrives."
            onEscape={() => setEditingRequest(null)}
            width="min(720px, calc(100vw - 32px))"
            actions={
              <>
                <button
                  type="button"
                  onClick={() => setEditingRequest(null)}
                  className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={() => void handleEditSave()}
                  className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900"
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
              </>
            }
          >
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    From Date
                  </span>
                  <input
                    type="date"
                    value={editFromDate}
                    min={earliestBackdate}
                    onChange={(event) => setEditFromDate(event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    To Date
                  </span>
                  <input
                    type="date"
                    value={editToDate}
                    min={editFromDate || earliestBackdate}
                    onChange={(event) => setEditToDate(event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Number Of Days
                  </span>
                  <input
                    type="text"
                    readOnly
                    value={editTotalDays > 0 ? `${editTotalDays}` : "-"}
                    className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </label>
              </div>

              {kind === "outWork" ? (
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Destination
                  </span>
                  <select
                    value={editDestinationId}
                    disabled={editDestinationsLoading}
                    onChange={(event) => setEditDestinationId(event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                  >
                    <option value="">{editDestinationsLoading ? "Loading..." : "Choose destination"}</option>
                    {editDestinations.map((row) => (
                      <option key={row.destination_id} value={row.destination_id}>
                        {row.destination_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Reason
                </span>
                <textarea
                  rows={4}
                  value={editReason}
                  onChange={(event) => setEditReason(event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                />
              </label>
            </div>
          </ModalBase>
        </>
      }
    />
  );
}

function HrApprovalInboxWorkspace({
  kind,
  title,
  loader,
  openHistory,
}) {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const isMulti = runtimeContext?.workspaceMode === "MULTI";
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Company filter for MULTI users: "*" = All Companies (default), or specific company ID
  const [companyFilter, setCompanyFilter] = useState("*");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailRequest, setDetailRequest] = useState(null);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.approvalInbox`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader);

  const filteredRows = useMemo(() => {
    let result = applyQuickFilter(rows, searchQuery, [
      "requester_display",
      "reason",
      "current_state",
      "parent_company_name",
      "parent_company_code",
      "destination_name",
      "destination_address",
      "workflow_request_id",
    ]);
    // MULTI users: apply company filter when a specific company is chosen
    if (isMulti && companyFilter && companyFilter !== "*") {
      result = result.filter(
        (row) => row.parent_company_id === companyFilter,
      );
    }
    return result;
  }, [rows, searchQuery, isMulti, companyFilter]);
  const denseColumns = useMemo(
    () => buildHrDenseColumns(visibleColumns, kind),
    [visibleColumns, kind],
  );
  const { getRowProps } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setDetailRequest(row ?? null),
  });

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void refresh(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus?.(),
    },
  });

  async function handleDecision(request, decision) {
    // Design Authority Law 10: Approval and rejection are immediate — no confirmation dialog.
    // Feedback is delivered via toast only. Dialog is reserved for destructive actions (cancel/delete).
    const companyId = isMulti ? (request.parent_company_id ?? null) : null;

    try {
      await submitWorkflowDecision(request.workflow_request_id, decision, companyId);
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setDetailRequest(null);
      await refresh();
    } catch (err) {
      // Company revoked mid-session: refresh context so the company disappears from selectors.
      const errorCode = typeof err?.code === "string" ? err.code : "";
      const isCompanyRevoked =
        errorCode === "MULTI_COMPANY_ACCESS_DENIED" ||
        errorCode === "ME_CONTEXT_COMPANY_FORBIDDEN" ||
        errorCode === "MULTI_COMPANY_INVALID";

      if (isCompanyRevoked) {
        const humanMessage =
          getErrorMessage(errorCode) ??
          "You no longer have access to that company.";
        pushToast({
          tone: "error",
          title: "Company Access Revoked",
          message: `${humanMessage} The company has been removed from your session.`,
        });
        console.error("WORKFLOW_DECISION_COMPANY_REVOKED", {
          code: errorCode,
          company_id: companyId,
          request_id: err?.requestId ?? null,
        });
        // Refresh context so the revoked company disappears from all selectors.
        window.dispatchEvent(new CustomEvent("erp:menu-refresh-request"));
        await refresh();
        return;
      }

      setError(formatError(err, "Decision could not be submitted."));
    }
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="HR Management"
      title={title}
      actions={[
        {
          key: "history",
          label: "Approval History",
          tone: "neutral",
          onClick: () => {
            openScreen(openHistory, { mode: "replace" });
            navigate(
              kind === "leave"
                ? "/dashboard/hr/leave/approval-history"
                : "/dashboard/hr/out-work/approval-history",
            );
          },
        },
        {
          key: "columns",
          label: "Columns",
          tone: "neutral",
          onClick: () => setShowColumnPicker(true),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          hint: "Alt+R / F4",
          tone: "primary",
          onClick: () => void refresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      footerHints={HR_APPROVAL_FOOTER_HINTS}
      filterSection={{
        eyebrow: "Queue Search",
        title: "Filter approval inbox",
        children: (
          <div className="grid gap-3">
            {isMulti && availableCompanies.length > 0 ? (
              <div className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Company
                </span>
                <select
                  value={companyFilter}
                  onChange={(event) => setCompanyFilter(event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                >
                  <option value="*">* All Companies</option>
                  {availableCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_code} | {company.company_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <QuickFilterInput
              label="Quick Search"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search requester, reason, destination, or workflow id"
            />
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Pending Queue",
        title: loading
          ? "Loading approval inbox"
          : `${filteredRows.length} actionable request${filteredRows.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading approval inbox.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No pending request is currently actionable for this approver.
          </div>
        ) : (
          <HrApprovalDenseTable
            rows={filteredRows}
            columns={denseColumns}
            getRowProps={(_row, index) => getRowProps(index)}
            onApprove={(row) => void handleDecision(row, "APPROVED")}
            onReject={(row) => void handleDecision(row, "REJECTED")}
            onActivate={(row) => setDetailRequest(row ?? null)}
            emptyMessage="No pending request is currently actionable for this approver."
          />
        ),
      }}
      bottomSection={
        <>
          <HrRequestColumnPickerModal
            visible={showColumnPicker}
            visibleColumnKeys={visibleColumnKeys}
            onClose={() => setShowColumnPicker(false)}
            onToggleColumn={toggleColumn}
            onResetColumns={resetColumns}
          />
          <HrRequestDetailModal
            visible={Boolean(detailRequest)}
            request={detailRequest}
            kind={kind}
            mode="approvalInbox"
            onClose={() => setDetailRequest(null)}
            onApprove={(row) => void handleDecision(row, "APPROVED")}
            onReject={(row) => void handleDecision(row, "REJECTED")}
          />
        </>
      }
    />
  );
}

function HrApprovalHistoryWorkspace({
  kind,
  title,
  loader,
}) {
  const searchRef = useRef(null);
  const requesterRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [requesterAuthUserId, setRequesterAuthUserId] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailRequest, setDetailRequest] = useState(null);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.approvalHistory`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader, [
    requesterAuthUserId,
  ]);

  const filteredRows = useMemo(
    () =>
      applyQuickFilter(rows, searchQuery, [
        "requester_display",
        "reason",
        "current_state",
        "parent_company_name",
        "parent_company_code",
        "destination_name",
        "destination_address",
        "workflow_request_id",
      ]),
    [rows, searchQuery],
  );
  const denseColumns = useMemo(
    () => buildHrDenseColumns(visibleColumns, kind),
    [visibleColumns, kind],
  );
  const summaryRow = useMemo(() => buildHrSummaryRow(filteredRows), [filteredRows]);
  const { getRowProps } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setDetailRequest(row ?? null),
  });

  async function handleRefresh() {
    try {
      await refresh(requesterAuthUserId);
    } catch (err) {
      setError(formatError(err, "Approval history could not be loaded."));
    }
  }

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus?.(),
    },
    focusPrimary: {
      perform: () => requesterRef.current?.focus?.(),
    },
  });

  return (
    <ErpApprovalReviewTemplate
      eyebrow="HR Management"
      title={title}
      actions={[
        {
          key: "columns",
          label: "Columns",
          tone: "neutral",
          onClick: () => setShowColumnPicker(true),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          hint: "Alt+R / F4",
          tone: "primary",
          onClick: () => void handleRefresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      footerHints={HR_LIST_FOOTER_HINTS}
      filterSection={{
        eyebrow: "Scope Filter",
        title: "Filter approver scope history",
        children: (
          <div className="grid gap-3 md:grid-cols-2">
            <QuickFilterInput
              label="Quick Search"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search requester, reason, destination, or workflow id"
            />
            <QuickFilterInput
              label="Specific Requester Auth User ID"
              value={requesterAuthUserId}
              onChange={setRequesterAuthUserId}
              inputRef={requesterRef}
              placeholder="Optional requester auth user id"
            />
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Approval Scope History",
        title: loading
          ? "Loading approval scope history"
          : `${filteredRows.length} visible request${filteredRows.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading approval scope history.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No request is visible in the current approval scope history.
          </div>
        ) : (
          <ErpDenseGrid
            columns={denseColumns}
            rows={filteredRows}
            rowKey={(row) => row.workflow_request_id ?? row.leave_request_id ?? row.out_work_request_id}
            getRowProps={(_row, index) => getRowProps(index)}
            onRowActivate={(row) => setDetailRequest(row ?? null)}
            summaryRow={summaryRow}
            emptyMessage="No request is visible in the current approval scope history."
          />
        ),
      }}
      bottomSection={
        <>
          <HrRequestColumnPickerModal
            visible={showColumnPicker}
            visibleColumnKeys={visibleColumnKeys}
            onClose={() => setShowColumnPicker(false)}
            onToggleColumn={toggleColumn}
            onResetColumns={resetColumns}
          />
          <HrRequestDetailModal
            visible={Boolean(detailRequest)}
            request={detailRequest}
            kind={kind}
            mode="approvalHistory"
            onClose={() => setDetailRequest(null)}
          />
        </>
      }
    />
  );
}

function HrRegisterWorkspace({
  kind,
  title,
  loader,
}) {
  const searchRef = useRef(null);
  const requesterRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [requesterAuthUserId, setRequesterAuthUserId] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailRequest, setDetailRequest] = useState(null);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.register`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader, [
    requesterAuthUserId,
  ]);

  const filteredRows = useMemo(
    () =>
      applyQuickFilter(rows, searchQuery, [
        "requester_display",
        "reason",
        "current_state",
        "parent_company_name",
        "parent_company_code",
        "destination_name",
        "destination_address",
        "workflow_request_id",
      ]),
    [rows, searchQuery],
  );
  const denseColumns = useMemo(
    () => buildHrDenseColumns(visibleColumns, kind),
    [visibleColumns, kind],
  );
  const summaryRow = useMemo(() => buildHrSummaryRow(filteredRows), [filteredRows]);
  const { getRowProps } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setDetailRequest(row ?? null),
  });

  async function handleRefresh() {
    try {
      await refresh(requesterAuthUserId);
    } catch (err) {
      setError(formatError(err, "Register could not be loaded."));
    }
  }

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus?.(),
    },
    focusPrimary: {
      perform: () => requesterRef.current?.focus?.(),
    },
  });

  return (
    <ErpReportFilterTemplate
      eyebrow="HR Management"
      title={title}
      actions={[
        {
          key: "columns",
          label: "Columns",
          tone: "neutral",
          onClick: () => setShowColumnPicker(true),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          hint: "Alt+R / F4",
          tone: "primary",
          onClick: () => void handleRefresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      footerHints={HR_LIST_FOOTER_HINTS}
      filterSection={{
        eyebrow: "Register Filters",
        title: "Filter register rows",
        children: (
          <div className="grid gap-3 md:grid-cols-2">
            <QuickFilterInput
              label="Quick Search"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search requester, reason, destination, or workflow id"
            />
            <QuickFilterInput
              label="Specific Requester Auth User ID"
              value={requesterAuthUserId}
              onChange={setRequesterAuthUserId}
              inputRef={requesterRef}
              placeholder="Optional requester auth user id"
            />
          </div>
        ),
      }}
      reportSection={{
        eyebrow: "Register",
        title: loading
          ? "Loading register"
          : `${filteredRows.length} visible request${filteredRows.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading register.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No request matches the current register filter.
          </div>
        ) : (
          <ErpDenseGrid
            columns={denseColumns}
            rows={filteredRows}
            rowKey={(row) => row.workflow_request_id ?? row.leave_request_id ?? row.out_work_request_id}
            getRowProps={(_row, index) => getRowProps(index)}
            onRowActivate={(row) => setDetailRequest(row ?? null)}
            summaryRow={summaryRow}
            emptyMessage="No request matches the current register filter."
          />
        ),
      }}
      bottomSection={
        <>
          <HrRequestColumnPickerModal
            visible={showColumnPicker}
            visibleColumnKeys={visibleColumnKeys}
            onClose={() => setShowColumnPicker(false)}
            onToggleColumn={toggleColumn}
            onResetColumns={resetColumns}
          />
          <HrRequestDetailModal
            visible={Boolean(detailRequest)}
            request={detailRequest}
            kind={kind}
            mode="register"
            onClose={() => setDetailRequest(null)}
          />
        </>
      }
    />
  );
}

export function LeaveMyRequestsWorkspace() {
  return (
    <HrRequestListWorkspace
      kind="leave"
      title="My Leave Requests"
      loader={() => listMyLeaveRequests()}
      openApply="HR_LEAVE_APPLY"
      openInbox="HR_LEAVE_APPROVAL_INBOX"
    />
  );
}

export function LeaveApprovalInboxWorkspace() {
  return (
    <HrApprovalInboxWorkspace
      kind="leave"
      title="Leave Approval Inbox"
      loader={() => listLeaveApprovalInbox()}
      openHistory="HR_LEAVE_APPROVAL_SCOPE_HISTORY"
    />
  );
}

export function LeaveApprovalScopeHistoryWorkspace() {
  return (
    <HrApprovalHistoryWorkspace
      kind="leave"
      title="Leave Approval Scope History"
      loader={(requesterAuthUserId) => listLeaveApprovalHistory(requesterAuthUserId)}
    />
  );
}

export function LeaveRegisterWorkspace() {
  return (
    <HrRegisterWorkspace
      kind="leave"
      title="HR Leave Register"
      loader={(requesterAuthUserId) => listLeaveRegister({ requesterAuthUserId })}
    />
  );
}

export function OutWorkMyRequestsWorkspace() {
  return (
    <HrRequestListWorkspace
      kind="outWork"
      title="My Out Work Requests"
      loader={() => listMyOutWorkRequests()}
      openApply="HR_OUT_WORK_APPLY"
      openInbox="HR_OUT_WORK_APPROVAL_INBOX"
    />
  );
}

export function OutWorkApprovalInboxWorkspace() {
  return (
    <HrApprovalInboxWorkspace
      kind="outWork"
      title="Out Work Approval Inbox"
      loader={() => listOutWorkApprovalInbox()}
      openHistory="HR_OUT_WORK_APPROVAL_SCOPE_HISTORY"
    />
  );
}

export function OutWorkApprovalScopeHistoryWorkspace() {
  return (
    <HrApprovalHistoryWorkspace
      kind="outWork"
      title="Out Work Approval Scope History"
      loader={(requesterAuthUserId) => listOutWorkApprovalHistory(requesterAuthUserId)}
    />
  );
}

export function OutWorkRegisterWorkspace() {
  return (
    <HrRegisterWorkspace
      kind="outWork"
      title="Out Work Register"
      loader={(requesterAuthUserId) => listOutWorkRegister({ requesterAuthUserId })}
    />
  );
}
