import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  openScreen,
  openScreenWithContext,
  popScreen,
  getActiveScreenContext,
  updateActiveScreenContext,
  registerScreenRefreshCallback,
} from "../../../navigation/screenStackEngine.js";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { pushToast } from "../../../store/uiToast.js";
import { getErrorMessage } from "../../../config/errorMessages.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
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
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
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
  "Ctrl+S Save",
  "Esc Back",
  "Ctrl+K Command Bar",
]);

const HR_LIST_FOOTER_HINTS = Object.freeze([
  "↑↓ Navigate",
  "Enter Open",
  "Space Select",
  "F8 Refresh",
  "Alt+Shift+F Search",
  "Esc Back",
  "Ctrl+K Command Bar",
]);

const HR_APPROVAL_FOOTER_HINTS = Object.freeze([
  "↑↓ Navigate",
  "Enter Open",
  "A Approve",
  "R Reject",
  "F8 Refresh",
  "Alt+Shift+F Search",
  "Esc Back",
  "Ctrl+K Command Bar",
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

function getHrDetailScreenCode(kind) {
  return kind === "leave" ? "HR_LEAVE_REQUEST_DETAIL" : "HR_OUT_WORK_REQUEST_DETAIL";
}

function getHrDetailRoute(kind) {
  return kind === "leave"
    ? "/dashboard/hr/leave/request-detail"
    : "/dashboard/hr/out-work/request-detail";
}

function getHrRequestKey(request) {
  return (
    request?.workflow_request_id ??
    request?.leave_request_id ??
    request?.out_work_request_id ??
    ""
  );
}

const HR_FOCUS_FIRST_ROW = "__FIRST_ROW__";

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
    company: (
      <div>
        <div className="text-sm text-slate-700">
          {request.parent_company_name ?? request.parent_company_id ?? "-"}
        </div>
        {request.parent_company_code ? (
          <div className="text-xs text-slate-500">{request.parent_company_code}</div>
        ) : null}
      </div>
    ),
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
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {request.parent_company_name ?? request.parent_company_id ?? "-"}
            </div>
            {request.parent_company_code ? (
              <div className="text-xs text-slate-600">{request.parent_company_code}</div>
            ) : null}
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

// ─── Shared edit modal (used by both list workspace and detail workspace) ─────

function HrEditRequestModal({ visible, kind, request, onClose, onSaved }) {
  const earliestBackdate = getHrEarliestBackdate();
  const [editFromDate, setEditFromDate] = useState(todayDefault());
  const [editToDate, setEditToDate] = useState(todayDefault());
  const [editReason, setEditReason] = useState("");
  const [editDestinationId, setEditDestinationId] = useState("");
  const [editDestinations, setEditDestinations] = useState([]);
  const [editDestinationsLoading, setEditDestinationsLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const editTotalDays = calculateInclusiveDays(editFromDate, editToDate);

  // Initialise form state whenever the request being edited changes
  useEffect(() => {
    if (!request) return;
    setEditFromDate(request.from_date ?? todayDefault());
    setEditToDate(request.to_date ?? todayDefault());
    setEditReason(request.reason ?? "");
    setEditError("");

    if (kind === "outWork") {
      setEditDestinationsLoading(true);
      listOutWorkDestinations()
        .then((data) => {
          const rows = data?.destinations ?? [];
          setEditDestinations(rows);
          setEditDestinationId(
            rows.find((r) => r.destination_id === request.destination_id)
              ?.destination_id ??
              rows[0]?.destination_id ??
              "",
          );
        })
        .catch((err) => {
          setEditDestinations([]);
          setEditDestinationId("");
          setEditError(formatError(err, "Destination list could not be loaded."));
        })
        .finally(() => setEditDestinationsLoading(false));
    }
  }, [request, kind]);

  async function handleSave() {
    if (!request) return;

    if (!editFromDate || !editToDate || !editReason.trim()) {
      setEditError("From date, to date, and reason are required.");
      return;
    }

    if (kind === "outWork" && !editDestinationId) {
      setEditError("Destination is required.");
      return;
    }

    setEditSaving(true);
    setEditError("");

    try {
      if (kind === "leave") {
        await updateLeaveRequest({
          leave_request_id: request.leave_request_id,
          from_date: editFromDate,
          to_date: editToDate,
          reason: editReason.trim(),
        });
      } else {
        await updateOutWorkRequest({
          out_work_request_id: request.out_work_request_id,
          from_date: editFromDate,
          to_date: editToDate,
          destination_id: editDestinationId,
          reason: editReason.trim(),
        });
      }

      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      onSaved?.();
    } catch (err) {
      setEditError(formatError(err, "Request could not be updated."));
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <ModalBase
      visible={visible}
      eyebrow={kind === "leave" ? "Leave Request" : "Out Work Request"}
      title={kind === "leave" ? "Edit Pending Leave" : "Edit Pending Out Work"}
      message="Edit is allowed only until the first approver decision arrives."
      onEscape={editSaving ? undefined : onClose}
      width="min(720px, calc(100vw - 32px))"
      actions={
        <>
          <button
            type="button"
            disabled={editSaving}
            onClick={onClose}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={editSaving}
            onClick={() => void handleSave()}
            className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
          >
            {editSaving ? "Saving..." : "Save Changes"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        {editError ? (
          <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {editError}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">From Date</span>
            <input
              type="date"
              value={editFromDate}
              min={earliestBackdate}
              onChange={(event) => setEditFromDate(event.target.value)}
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">To Date</span>
            <input
              type="date"
              value={editToDate}
              min={editFromDate || earliestBackdate}
              onChange={(event) => setEditToDate(event.target.value)}
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Number Of Days</span>
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
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Destination</span>
            <ErpComboboxField
              value={editDestinationId}
              disabled={editDestinationsLoading}
              onChange={(val) => setEditDestinationId(val)}
              options={editDestinations.map((row) => ({
                value: row.destination_id,
                label: row.destination_name,
              }))}
              blankLabel={editDestinationsLoading ? "Loading..." : "Choose destination"}
              inputClassName="px-3 py-2 text-sm"
            />
          </label>
        ) : null}
        <label className="grid gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Reason</span>
          <textarea
            rows={4}
            value={editReason}
            onChange={(event) => setEditReason(event.target.value)}
            className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
          />
        </label>
      </div>
    </ModalBase>
  );
}

// ─── Detail workspace ─────────────────────────────────────────────────────────

function HrRequestDetailWorkspace({ kind }) {
  const context = getActiveScreenContext() ?? {};
  const request = context.request ?? null;
  const mode = context.mode ?? "register";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingRequest, setEditingRequest] = useState(null);
  const requesterParts = splitDisplay(
    request?.requester_display ?? "",
    request?.requester_auth_user_id ?? "",
    request?.requester_display ?? "",
  );

  function handleEdit(row) {
    setNotice("");
    setEditingRequest(row);
  }

  async function handleCancel(row) {
    const approved = await openActionConfirm({
      eyebrow: kind === "leave" ? "Leave Request" : "Out Work Request",
      title: "Cancel Pending Request",
      message: `Cancel request ${row.workflow_request_id}?`,
      confirmLabel: "Cancel Request",
      cancelLabel: "Keep",
    });

    if (!approved) return;

    try {
      if (kind === "leave") {
        await cancelLeaveRequest(row.leave_request_id);
      } else {
        await cancelOutWorkRequest(row.out_work_request_id);
      }
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      popScreen();
    } catch (err) {
      setError(formatError(err, "Request could not be cancelled."));
    }
  }

  async function handleDecision(row, decision) {
    try {
      await submitWorkflowDecision(row.workflow_request_id, decision, row.parent_company_id ?? null);
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      popScreen();
    } catch (err) {
      setError(formatError(err, "Decision could not be submitted."));
    }
  }

  return (
    <>
      <ErpScreenScaffold
        eyebrow="HR Management"
        title={kind === "leave" ? "Leave Request Detail" : "Out Work Request Detail"}
        actions={[
          {
            key: "back",
            label: "Back",
            tone: "neutral",
            onClick: () => popScreen(),
          },
        ]}
        notices={[
          ...(error ? [{ key: "error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
        ]}
        footerHints={mode === "approvalInbox" ? HR_APPROVAL_FOOTER_HINTS : ["Esc Back", "Ctrl+K Command Bar"]}
      >
        {!request ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Request detail context is missing. Return to the previous list and open the row again.
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <HrRequestRowActions
                mode={mode}
                request={request}
                onEdit={(row) => void handleEdit(row)}
                onCancel={(row) => void handleCancel(row)}
                onApprove={(row) => void handleDecision(row, "APPROVED")}
                onReject={(row) => void handleDecision(row, "REJECTED")}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="border border-slate-300 bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Requester</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{requesterParts.name}</div>
                <div className="text-xs text-slate-600">{requesterParts.code}</div>
              </div>
              <div className="border border-slate-300 bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Company</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {request.parent_company_name ?? request.parent_company_id ?? "-"}
                </div>
                {request.parent_company_code ? (
                  <div className="text-xs text-slate-600">{request.parent_company_code}</div>
                ) : null}
              </div>
              <div className="border border-slate-300 bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Department</div>
                <div className="mt-1 text-sm text-slate-900">
                  {request.department_name ?? request.department_code ?? "-"}
                </div>
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
        )}
      </ErpScreenScaffold>
      <HrEditRequestModal
        visible={Boolean(editingRequest)}
        kind={kind}
        request={editingRequest}
        onClose={() => setEditingRequest(null)}
        onSaved={() => {
          setEditingRequest(null);
          popScreen();
        }}
      />
    </>
  );
}

function HrRequesterActionDrawer({
  visible,
  request,
  kind,
  cancelling,
  onEdit,
  onCancel,
  onClose,
}) {
  if (!request) return null;

  const requesterParts = splitDisplay(
    request.requester_display,
    request.requester_auth_user_id,
    request.requester_display,
  );

  return (
    <DrawerBase
      visible={visible}
      title={kind === "leave" ? "Leave Request" : "Out Work Request"}
      onEscape={cancelling ? undefined : onClose}
      width="min(520px, calc(100vw - 24px))"
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={cancelling}
            className="border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:opacity-50"
          >
            Close
          </button>
          {request.can_cancel ? (
            <>
              <button
                type="button"
                onClick={() => onEdit?.(request)}
                disabled={cancelling}
                className="border border-sky-400 bg-sky-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onCancel?.(request)}
                disabled={cancelling}
                className="border border-rose-400 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel Request"}
              </button>
            </>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Requester</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{requesterParts.name}</div>
            <div className="text-xs text-slate-600">{requesterParts.code}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
            <div className="mt-1"><RequestStatusBadge state={request.current_state} /></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">From</div>
            <div className="mt-1 text-sm text-slate-800">{formatIsoDate(request.from_date)}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">To</div>
            <div className="mt-1 text-sm text-slate-800">{formatIsoDate(request.to_date)}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Days</div>
            <div className="mt-1 text-sm text-slate-800">{request.total_days ?? "-"}</div>
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
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Decision History</div>
          <RequestDecisionHistory history={request.decision_history} />
        </div>
      </div>
    </DrawerBase>
  );
}

function HrApprovalDecisionDrawer({
  visible,
  request,
  kind,
  deciding,
  onApprove,
  onReject,
  onClose,
}) {
  if (!request) return null;

  const requesterParts = splitDisplay(
    request.requester_display,
    request.requester_auth_user_id,
    request.requester_display,
  );

  return (
    <DrawerBase
      visible={visible}
      title={kind === "leave" ? "Leave Request" : "Out Work Request"}
      onEscape={deciding ? undefined : onClose}
      width="min(520px, calc(100vw - 24px))"
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deciding}
            className="border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onReject?.(request)}
            disabled={deciding}
            className="border border-rose-400 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700 disabled:opacity-50"
          >
            {deciding ? "Processing…" : "Reject"}
          </button>
          <button
            type="button"
            onClick={() => onApprove?.(request)}
            disabled={deciding}
            className="border border-emerald-400 bg-emerald-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 disabled:opacity-50"
          >
            {deciding ? "Processing…" : "Approve"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Requester</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{requesterParts.name}</div>
            <div className="text-xs text-slate-600">{requesterParts.code}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
            <div className="mt-1"><RequestStatusBadge state={request.current_state} /></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">From</div>
            <div className="mt-1 text-sm text-slate-800">{formatIsoDate(request.from_date)}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">To</div>
            <div className="mt-1 text-sm text-slate-800">{formatIsoDate(request.to_date)}</div>
          </div>
          <div className="border border-slate-300 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Days</div>
            <div className="mt-1 text-sm text-slate-800">{request.total_days ?? "-"}</div>
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
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Decision History</div>
          <RequestDecisionHistory history={request.decision_history} />
        </div>
      </div>
    </DrawerBase>
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
  const transactionCompanyRef = useRef(null);
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
      perform: () => transactionCompanyRef.current?.focus?.(),
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
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={transactionCompanyId}
              onChange={setTransactionCompanyId}
              selectRef={transactionCompanyRef}
            />
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
  const transactionCompanyRef = useRef(null);
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
      perform: () => transactionCompanyRef.current?.focus?.(),
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
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={transactionCompanyId}
                onChange={setTransactionCompanyId}
                selectRef={transactionCompanyRef}
              />
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
                <ErpComboboxField
                  value={destinationId}
                  disabled={loadingDestinations || !transactionCompanyId}
                  onChange={(val) => setDestinationId(val)}
                  options={destinations.map((row) => ({
                    value: row.destination_id,
                    label: row.destination_name,
                  }))}
                  blankLabel={loadingDestinations ? "Loading destination..." : "Choose destination"}
                  inputClassName="px-3 py-2 text-sm"
                  className="min-w-[280px] flex-1"
                />
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
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const { menu } = useMenu();
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  const [focusKey, setFocusKey] = useState(initialContext.parentState?.focusKey ?? "");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [actionDrawerRequest, setActionDrawerRequest] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.myRequests`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader);
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
  function openDetail(row) {
    const nextFocusKey = getHrRequestKey(row);
    const parentState = { searchQuery, focusKey: nextFocusKey };
    setFocusKey(nextFocusKey);
    updateActiveScreenContext({ parentState });
    openScreenWithContext(getHrDetailScreenCode(kind), {
      request: row,
      kind,
      mode: "myRequests",
      parentState,
      refreshOnReturn: true,
    });
    navigate(getHrDetailRoute(kind));
  }

  const { getRowProps, focusRow } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setActionDrawerRequest(row),
  });

  async function handleCancelFromDrawer(row) {
    const approved = await openActionConfirm({
      eyebrow: kind === "leave" ? "Leave Request" : "Out Work Request",
      title: "Cancel Pending Request",
      message: `Cancel request ${row.workflow_request_id}?`,
      confirmLabel: "Cancel Request",
      cancelLabel: "Keep",
    });

    if (!approved) return;

    setCancelling(true);
    try {
      if (kind === "leave") {
        await cancelLeaveRequest(row.leave_request_id);
      } else {
        await cancelOutWorkRequest(row.out_work_request_id);
      }
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setActionDrawerRequest(null);
      await refresh();
    } catch (err) {
      setError(formatError(err, "Request could not be cancelled."));
    } finally {
      setCancelling(false);
    }
  }

  function handleEditFromDrawer(row) {
    setActionDrawerRequest(null);
    setEditingRequest(row);
  }

  useEffect(() => registerScreenRefreshCallback(() => {
    void refresh();
  }), [refresh]);

  useEffect(() => {
    updateActiveScreenContext({ parentState: { searchQuery, focusKey } });
  }, [searchQuery, focusKey]);

  useEffect(() => {
    if (!focusKey || filteredRows.length === 0) {
      return;
    }
    const targetIndex = filteredRows.findIndex((row) => getHrRequestKey(row) === focusKey);
    if (targetIndex >= 0) {
      queueMicrotask(() => focusRow(targetIndex));
    }
  }, [filteredRows, focusKey, focusRow]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void refresh(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus?.(),
    },
  });

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
            onRowActivate={(row) => setActionDrawerRequest(row)}
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
          <HrRequesterActionDrawer
            visible={Boolean(actionDrawerRequest)}
            request={actionDrawerRequest}
            kind={kind}
            cancelling={cancelling}
            onEdit={handleEditFromDrawer}
            onCancel={(row) => void handleCancelFromDrawer(row)}
            onClose={() => setActionDrawerRequest(null)}
          />
          <HrEditRequestModal
            visible={Boolean(editingRequest)}
            kind={kind}
            request={editingRequest}
            onClose={() => setEditingRequest(null)}
            onSaved={async () => {
              setEditingRequest(null);
              await refresh();
            }}
          />
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
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const { runtimeContext } = useMenu();
  const isMulti = runtimeContext?.workspaceMode === "MULTI";
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  // Company filter for MULTI users: "*" = All Companies (default), or specific company ID
  const [companyFilter, setCompanyFilter] = useState(initialContext.parentState?.companyFilter ?? "*");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [focusKey, setFocusKey] = useState(initialContext.parentState?.focusKey ?? "");
  const [decisionDrawerRequest, setDecisionDrawerRequest] = useState(null);
  const [deciding, setDeciding] = useState(false);
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
  function openDetail(row) {
    const nextFocusKey = getHrRequestKey(row);
    const parentState = { searchQuery, companyFilter, focusKey: nextFocusKey };
    setFocusKey(nextFocusKey);
    updateActiveScreenContext({ parentState });
    openScreenWithContext(getHrDetailScreenCode(kind), {
      request: row,
      kind,
      mode: "approvalInbox",
      parentState,
      refreshOnReturn: true,
    });
    navigate(getHrDetailRoute(kind));
  }

  const { getRowProps, focusRow } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setDecisionDrawerRequest(row),
  });

  async function handleDecisionFromDrawer(request, decision) {
    setDeciding(true);
    try {
      await handleDecision(request, decision);
      setDecisionDrawerRequest(null);
    } finally {
      setDeciding(false);
    }
  }

  useEffect(() => registerScreenRefreshCallback(() => {
    void refresh();
  }), [refresh]);

  useEffect(() => {
    updateActiveScreenContext({ parentState: { searchQuery, companyFilter, focusKey } });
  }, [searchQuery, companyFilter, focusKey]);

  useEffect(() => {
    if (!focusKey || filteredRows.length === 0) {
      return;
    }
    const targetIndex =
      focusKey === HR_FOCUS_FIRST_ROW
        ? 0
        : filteredRows.findIndex((row) => getHrRequestKey(row) === focusKey);
    if (targetIndex >= 0) {
      queueMicrotask(() => focusRow(targetIndex));
    }
  }, [filteredRows, focusKey, focusRow]);

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
    const currentIndex = filteredRows.findIndex(
      (row) => getHrRequestKey(row) === getHrRequestKey(request)
    );
    const fallbackRow =
      filteredRows[currentIndex + 1] ??
      filteredRows[currentIndex - 1] ??
      null;
    const fallbackFocusKey =
      fallbackRow ? getHrRequestKey(fallbackRow) : HR_FOCUS_FIRST_ROW;

    try {
      setFocusKey(fallbackFocusKey);
      await submitWorkflowDecision(request.workflow_request_id, decision, companyId);
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
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
                <ErpComboboxField
                  value={companyFilter}
                  onChange={(val) => setCompanyFilter(val || "*")}
                  options={[
                    { value: "*", label: "* All Companies" },
                    ...availableCompanies.map((company) => ({
                      value: company.id,
                      label: `${company.company_code} | ${company.company_name}`,
                    })),
                  ]}
                  blankLabel="-- Company --"
                  inputClassName="px-3 py-2 text-sm"
                />
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
            onActivate={(row) => setDecisionDrawerRequest(row)}
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
          <HrApprovalDecisionDrawer
            visible={Boolean(decisionDrawerRequest)}
            request={decisionDrawerRequest}
            kind={kind}
            deciding={deciding}
            onApprove={(request) => void handleDecisionFromDrawer(request, "APPROVED")}
            onReject={(request) => void handleDecisionFromDrawer(request, "REJECTED")}
            onClose={() => setDecisionDrawerRequest(null)}
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
  const navigate = useNavigate();
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchRef = useRef(null);
  const requesterRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  const [requesterAuthUserId, setRequesterAuthUserId] = useState(initialContext.parentState?.requesterAuthUserId ?? "");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [focusKey, setFocusKey] = useState(initialContext.parentState?.focusKey ?? "");
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
  function openDetail(row) {
    const nextFocusKey = getHrRequestKey(row);
    const parentState = { searchQuery, requesterAuthUserId, focusKey: nextFocusKey };
    setFocusKey(nextFocusKey);
    updateActiveScreenContext({ parentState });
    openScreenWithContext(getHrDetailScreenCode(kind), {
      request: row,
      kind,
      mode: "approvalHistory",
      parentState,
      refreshOnReturn: true,
    });
    navigate(getHrDetailRoute(kind));
  }

  const { getRowProps, focusRow } = useErpListNavigation(filteredRows, {
    onActivate: (row) => openDetail(row),
  });

  const handleRefresh = useCallback(async () => {
    try {
      await refresh(requesterAuthUserId);
    } catch (err) {
      setError(formatError(err, "Approval history could not be loaded."));
    }
  }, [refresh, requesterAuthUserId, setError]);

  useEffect(
    () =>
      registerScreenRefreshCallback(() => {
        void handleRefresh();
      }),
    [handleRefresh],
  );

  useEffect(() => {
    updateActiveScreenContext({ parentState: { searchQuery, requesterAuthUserId, focusKey } });
  }, [searchQuery, requesterAuthUserId, focusKey]);

  useEffect(() => {
    if (!focusKey || filteredRows.length === 0) {
      return;
    }
    const targetIndex = filteredRows.findIndex((row) => getHrRequestKey(row) === focusKey);
    if (targetIndex >= 0) {
      queueMicrotask(() => focusRow(targetIndex));
    }
  }, [filteredRows, focusKey, focusRow]);

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
            onRowActivate={(row) => openDetail(row)}
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
  const navigate = useNavigate();
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchRef = useRef(null);
  const requesterRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  const [requesterAuthUserId, setRequesterAuthUserId] = useState(initialContext.parentState?.requesterAuthUserId ?? "");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [focusKey, setFocusKey] = useState(initialContext.parentState?.focusKey ?? "");
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
  function openDetail(row) {
    const nextFocusKey = getHrRequestKey(row);
    const parentState = { searchQuery, requesterAuthUserId, focusKey: nextFocusKey };
    setFocusKey(nextFocusKey);
    updateActiveScreenContext({ parentState });
    openScreenWithContext(getHrDetailScreenCode(kind), {
      request: row,
      kind,
      mode: "register",
      parentState,
      refreshOnReturn: true,
    });
    navigate(getHrDetailRoute(kind));
  }

  const { getRowProps, focusRow } = useErpListNavigation(filteredRows, {
    onActivate: (row) => openDetail(row),
  });

  const handleRefresh = useCallback(async () => {
    try {
      await refresh(requesterAuthUserId);
    } catch (err) {
      setError(formatError(err, "Register could not be loaded."));
    }
  }, [refresh, requesterAuthUserId, setError]);

  useEffect(
    () =>
      registerScreenRefreshCallback(() => {
        void handleRefresh();
      }),
    [handleRefresh],
  );

  useEffect(() => {
    updateActiveScreenContext({ parentState: { searchQuery, requesterAuthUserId, focusKey } });
  }, [searchQuery, requesterAuthUserId, focusKey]);

  useEffect(() => {
    if (!focusKey || filteredRows.length === 0) {
      return;
    }
    const targetIndex = filteredRows.findIndex((row) => getHrRequestKey(row) === focusKey);
    if (targetIndex >= 0) {
      queueMicrotask(() => focusRow(targetIndex));
    }
  }, [filteredRows, focusKey, focusRow]);

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
            onRowActivate={(row) => openDetail(row)}
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

export function LeaveRequestDetailWorkspace() {
  return <HrRequestDetailWorkspace kind="leave" />;
}

export function OutWorkRequestDetailWorkspace() {
  return <HrRequestDetailWorkspace kind="outWork" />;
}
