import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import ErpReportFilterTemplate from "../../../components/templates/ErpReportFilterTemplate.jsx";
import {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
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
} from "./hrApi.js";

const STATUS_TONE_CLASS = Object.freeze({
  PENDING: "border-amber-200 bg-amber-50 text-amber-900",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-900",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-900",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-700",
});

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

function buildHrRequestGridTemplate(columns) {
  return columns.map((column) => column.width).join(" ");
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

function HrRequestRowActions({ mode, request, onCancel, onApprove, onReject }) {
  if (mode === "myRequests" && request.can_cancel) {
    return (
      <button
        type="button"
        onClick={() => onCancel?.(request)}
        className="border border-rose-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700"
      >
        Cancel
      </button>
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

function HrRequestColumnCell({ request, kind, column }) {
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

  const contentByColumn = {
    name: <div className="text-sm font-semibold text-slate-900">{requesterParts.name}</div>,
    code: <div className="text-sm text-slate-700">{requesterParts.code}</div>,
    company: <div className="text-sm text-slate-700">{companyDisplay}</div>,
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

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 lg:hidden">
        {column.label}
      </div>
      {contentByColumn[column.key] ?? <div className="text-sm text-slate-700">-</div>}
    </div>
  );
}

function HrRequestMatrixHeader({ columns }) {
  const templateColumns = buildHrRequestGridTemplate(columns);

  return (
    <div
      className="hidden min-w-max border border-slate-300 bg-slate-100 px-3 py-2 lg:grid lg:gap-3"
      style={{ gridTemplateColumns: templateColumns }}
    >
      {columns.map((column) => (
        <div
          key={column.key}
          className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
        >
          {column.label}
        </div>
      ))}
    </div>
  );
}

function HrRequestColumnPickerModal({
  visible,
  visibleColumnKeys,
  onClose,
  onToggleColumn,
  onResetColumns,
}) {
  return (
    <ModalBase
      visible={visible}
      eyebrow="HR Matrix"
      title="Choose Visible Columns"
      message="Show only the fields the user needs. Hidden columns can be restored anytime."
      onEscape={onClose}
      width="min(680px, calc(100vw - 32px))"
      actions={
        <>
          <button
            type="button"
            onClick={onResetColumns}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Reset Default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900"
          >
            Done
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {HR_REQUEST_COLUMN_DEFS.map((column) => {
          const checked = visibleColumnKeys.includes(column.key);

          return (
            <label
              key={column.key}
              className="flex items-center gap-3 border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleColumn(column.key)}
                disabled={checked && visibleColumnKeys.length === 1}
              />
              <span>{column.label}</span>
            </label>
          );
        })}
      </div>
    </ModalBase>
  );
}

export function HrRequestCard({
  request,
  kind,
  mode,
  visibleColumns,
  onCancel,
  onApprove,
  onReject,
}) {
  const templateColumns = buildHrRequestGridTemplate(visibleColumns);
  const actions = (
    <HrRequestRowActions
      mode={mode}
      request={request}
      onCancel={onCancel}
      onApprove={onApprove}
      onReject={onReject}
    />
  );

  return (
    <div className="border border-slate-300 bg-white">
      <div
        className="grid gap-3 px-3 py-3 lg:min-w-max lg:gap-3"
        style={{ gridTemplateColumns: templateColumns }}
      >
        {visibleColumns.map((column) => (
          <HrRequestColumnCell
            key={column.key}
            request={request}
            kind={kind}
            column={column}
          />
        ))}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Workflow
            </div>
            <div className="mt-1 text-xs text-slate-700">
              {request.workflow_request_id ?? "-"}
              {kind === "leave" ? ` | ${request.leave_request_id ?? "-"}` : ` | ${request.out_work_request_id ?? "-"}`}
            </div>
          </div>
          {actions}
        </div>

        {Array.isArray(request.decision_history) && request.decision_history.length > 0 ? (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Decision History
            </p>
            <div className="mt-2">
              <RequestDecisionHistory history={request.decision_history} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LeaveApplyWorkspace() {
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState(todayDefault());
  const [toDate, setToDate] = useState(todayDefault());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastCreated, setLastCreated] = useState(null);

  const totalDays = calculateInclusiveDays(fromDate, toDate);
  const earliestBackdate = getHrEarliestBackdate();

  async function handleSubmit() {
    if (!fromDate || !toDate || !reason.trim()) {
      setError("From date, to date, and reason are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await createLeaveRequest({
        from_date: fromDate,
        to_date: toDate,
        reason: reason.trim(),
      });
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setLastCreated(data.leave_request ?? null);
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
      description="Users submit leave requests in the parent-company HR universe. Current date theke maximum 3 days back apply allowed."
      actions={[
        {
          key: "my-requests",
          label: "My Requests",
          tone: "neutral",
          onClick: () => {
            openScreen("HR_LEAVE_MY_REQUESTS", { mode: "replace" });
            navigate("/dashboard/hr/leave/my-requests");
          },
        },
        {
          key: "approval-inbox",
          label: "Approval Inbox",
          tone: "neutral",
          onClick: () => {
            openScreen("HR_LEAVE_APPROVAL_INBOX", { mode: "replace" });
            navigate("/dashboard/hr/leave/approval-inbox");
          },
        },
        {
          key: "submit",
          label: saving ? "Submitting..." : "Send Request",
          hint: "Ctrl+S",
          tone: "primary",
          disabled: saving,
          onClick: () => void handleSubmit(),
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      metrics={[
        {
          key: "backdate",
          label: "Backdate Window",
          value: "3 Days",
          tone: "amber",
          caption: `Earliest allowed from-date: ${formatIsoDate(earliestBackdate)}`,
        },
        {
          key: "days",
          label: "Total Days",
          value: totalDays > 0 ? String(totalDays) : "-",
          tone: "sky",
          caption: "Days auto-calculated from selected range.",
        },
        {
          key: "scope",
          label: "Company Scope",
          value: "Parent HR",
          tone: "emerald",
          caption: "Leave never uses work-company transaction truth.",
        },
        {
          key: "cancel",
          label: "Cancel Rule",
          value: "Pending Only",
          tone: "slate",
          caption: "Requester can cancel until first approver decision arrives.",
        },
      ]}
      formEyebrow="Leave Request"
      formTitle="Submit a leave request"
      formDescription="Choose date range, let day count auto-calculate, write a reason, then send into the approval queue."
      formContent={
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                From Date
              </span>
              <input
                type="date"
                value={fromDate}
                min={earliestBackdate}
                onChange={(event) => setFromDate(event.target.value)}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </label>
            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                To Date
              </span>
              <input
                type="date"
                value={toDate}
                min={fromDate || earliestBackdate}
                onChange={(event) => setToDate(event.target.value)}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </label>
            <label className="grid gap-2 border border-slate-300 bg-slate-50 px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Number Of Days
              </span>
              <input
                type="text"
                readOnly
                value={totalDays > 0 ? `${totalDays}` : "-"}
                className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
              />
            </label>
          </div>

          <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Reason
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="Write why you need leave."
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
        </div>
      }
      sideContent={
        <>
          <ErpSectionCard
            eyebrow="Rule"
            title="Business law"
            description="Leave request uses parent-company HR truth. Pending request stays cancellable only while no approver decision exists."
          >
            <div className="grid gap-2">
              <ErpFieldPreview
                label="Backdate Limit"
                value="Current date - 3 days"
                caption="Older leave request will be blocked."
              />
              <ErpFieldPreview
                label="Approval Queue"
                value="Exact resource-driven"
                caption="Approver rules will route the case after submit."
              />
            </div>
          </ErpSectionCard>
          <ErpSectionCard
            eyebrow="Latest Result"
            title="Last submitted request"
            description="Most recent create result from this screen."
          >
            {lastCreated ? (
              <div className="grid gap-2">
                <ErpFieldPreview
                  label="Request"
                  value={`${formatIsoDate(lastCreated.from_date)} to ${formatIsoDate(lastCreated.to_date)}`}
                  caption={`${lastCreated.total_days} day(s) | ${lastCreated.current_state}`}
                />
                <ErpFieldPreview
                  label="Workflow"
                  value={lastCreated.workflow_request_id}
                  caption={lastCreated.parent_company_name ?? lastCreated.parent_company_id}
                />
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Submit a request to see the latest create result here.
              </div>
            )}
          </ErpSectionCard>
        </>
      }
    />
  );
}

export function OutWorkApplyWorkspace() {
  const navigate = useNavigate();
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
  const [lastCreated, setLastCreated] = useState(null);
  const destinationNameRef = useRef(null);

  const totalDays = calculateInclusiveDays(fromDate, toDate);
  const earliestBackdate = getHrEarliestBackdate();

  async function refreshDestinations(preferredDestinationId = "") {
    setLoadingDestinations(true);
    try {
      const data = await listOutWorkDestinations();
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
  }

  useEffect(() => {
    void refreshDestinations();
  }, []);

  async function handleCreateDestination() {
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
      });
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
    if (!fromDate || !toDate || !reason.trim() || !destinationId) {
      setError("From date, to date, destination, and reason are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await createOutWorkRequest({
        from_date: fromDate,
        to_date: toDate,
        destination_id: destinationId,
        reason: reason.trim(),
      });
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      setLastCreated(data.request ?? null);
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
        description="Use this flow when the user is outside office for company work. Destination stays company-reusable for later observation and reporting."
        actions={[
          {
            key: "my-requests",
            label: "My Requests",
            tone: "neutral",
            onClick: () => {
              openScreen("HR_OUT_WORK_MY_REQUESTS", { mode: "replace" });
              navigate("/dashboard/hr/out-work/my-requests");
            },
          },
          {
            key: "approval-inbox",
            label: "Approval Inbox",
            tone: "neutral",
            onClick: () => {
              openScreen("HR_OUT_WORK_APPROVAL_INBOX", { mode: "replace" });
              navigate("/dashboard/hr/out-work/approval-inbox");
            },
          },
          {
            key: "submit",
            label: saving ? "Submitting..." : "Send Request",
            hint: "Ctrl+S",
            tone: "primary",
            disabled: saving,
            onClick: () => void handleSubmit(),
          },
        ]}
        notices={[
          ...(error ? [{ key: "error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
        ]}
        metrics={[
          {
            key: "destinations",
            label: "Destinations",
            value: loadingDestinations ? "..." : String(destinations.length),
            tone: "sky",
            caption: "Parent-company reusable destination master rows.",
          },
          {
            key: "days",
            label: "Total Days",
            value: totalDays > 0 ? String(totalDays) : "-",
            tone: "amber",
            caption: "Auto-calculated from selected range.",
          },
          {
            key: "backdate",
            label: "Backdate Window",
            value: "3 Days",
            tone: "slate",
            caption: `Earliest allowed from-date: ${formatIsoDate(earliestBackdate)}`,
          },
          {
            key: "cancel",
            label: "Cancel Rule",
            value: "Pending Only",
            tone: "emerald",
            caption: "Requester can cancel until first approver decision arrives.",
          },
        ]}
        formEyebrow="Out Work Request"
        formTitle="Submit an out work request"
        formDescription="Choose destination, date range, and reason. If destination is missing, create it once and reuse it later."
        formContent={
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  From Date
                </span>
                <input
                  type="date"
                  value={fromDate}
                  min={earliestBackdate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                />
              </label>
              <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  To Date
                </span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || earliestBackdate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                />
              </label>
              <label className="grid gap-2 border border-slate-300 bg-slate-50 px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Number Of Days
                </span>
                <input
                  type="text"
                  readOnly
                  value={totalDays > 0 ? `${totalDays}` : "-"}
                  className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Destination
                </span>
                <select
                  value={destinationId}
                  onChange={(event) => setDestinationId(event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose destination</option>
                  {destinations.map((row) => (
                    <option key={row.destination_id} value={row.destination_id}>
                      {row.destination_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setShowDestinationModal(true)}
                  className="border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-700"
                >
                  Create Destination
                </button>
              </div>
            </div>

            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Reason
              </span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                placeholder="Write why you are outside office for company work."
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </label>
          </div>
        }
        sideContent={
          <>
            <ErpSectionCard
              eyebrow="Destination Law"
              title="Reusable destination memory"
              description="If preferred destination is not in the list, create it once and the same company will be able to reuse it later."
            >
              <div className="grid gap-2">
                <ErpFieldPreview
                  label="Storage Scope"
                  value="Per Parent Company"
                  caption="Destination master stays company specific."
                />
                <ErpFieldPreview
                  label="Selection"
                  value={
                    destinations.find((row) => row.destination_id === destinationId)?.destination_name ??
                    "No destination selected"
                  }
                  caption={
                    destinations.find((row) => row.destination_id === destinationId)?.destination_address ??
                    "Choose or create a destination."
                  }
                />
              </div>
            </ErpSectionCard>
            <ErpSectionCard
              eyebrow="Latest Result"
              title="Last submitted request"
              description="Most recent create result from this screen."
            >
              {lastCreated ? (
                <div className="grid gap-2">
                  <ErpFieldPreview
                    label="Destination"
                    value={lastCreated.destination_name}
                    caption={lastCreated.destination_address}
                  />
                  <ErpFieldPreview
                    label="Workflow"
                    value={lastCreated.workflow_request_id}
                    caption={`${lastCreated.total_days} day(s) | ${lastCreated.current_state}`}
                  />
                </div>
              ) : (
                <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  Submit a request to see the latest create result here.
                </div>
              )}
            </ErpSectionCard>
          </>
        }
      />
      <ModalBase
        visible={showDestinationModal}
        eyebrow="Out Work"
        title="Create Destination"
        message="Add a new destination for this parent company. It will appear in the dropdown after save."
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

  const refresh = async (...nextArgs) => {
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
  };

  useEffect(() => {
    void refresh(...args);
  }, []);

  return {
    rows,
    loading,
    error,
    setError,
    refresh,
  };
}

function buildListMetrics(rows) {
  return [
    {
      key: "total",
      label: "Total",
      value: String(rows.length),
      tone: "sky",
      caption: "Rows returned by the current business flow.",
    },
    {
      key: "pending",
      label: "Pending",
      value: String(rows.filter((row) => row.current_state === "PENDING").length),
      tone: "amber",
      caption: "Still waiting for approval decision.",
    },
    {
      key: "approved",
      label: "Approved",
      value: String(rows.filter((row) => row.current_state === "APPROVED").length),
      tone: "emerald",
      caption: "Cases already approved in workflow.",
    },
    {
      key: "rejected",
      label: "Rejected/Cancelled",
      value: String(
        rows.filter((row) => ["REJECTED", "CANCELLED"].includes(row.current_state)).length,
      ),
      tone: "slate",
      caption: "Closed requests no longer in pending lane.",
    },
  ];
}

function HrRequestListWorkspace({
  kind,
  title,
  description,
  loader,
  openApply,
  openInbox,
}) {
  const navigate = useNavigate();
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.myRequests`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader);

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
      await refresh();
    } catch (err) {
      setError(formatError(err, "Request could not be cancelled."));
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="HR Management"
      title={title}
      description={description}
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
        {
          key: "inbox",
          label: "Approval Inbox",
          tone: "neutral",
          onClick: () => {
            openScreen(openInbox, { mode: "replace" });
            navigate(
              kind === "leave"
                ? "/dashboard/hr/leave/approval-inbox"
                : "/dashboard/hr/out-work/approval-inbox",
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
          hint: "Alt+R",
          tone: "primary",
          onClick: () => void refresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      metrics={buildListMetrics(rows)}
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
        description: "Pending rows stay cancellable until no approver decision exists.",
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading request history.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No request matches the current filter.
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-max gap-3">
                <HrRequestMatrixHeader columns={visibleColumns} />
                {filteredRows.map((request) => (
                  <HrRequestCard
                    key={request.workflow_request_id}
                    request={request}
                    kind={kind}
                    mode="myRequests"
                    visibleColumns={visibleColumns}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </div>
          </div>
        ),
      }}
      bottomSection={
        <HrRequestColumnPickerModal
          visible={showColumnPicker}
          visibleColumnKeys={visibleColumnKeys}
          onClose={() => setShowColumnPicker(false)}
          onToggleColumn={toggleColumn}
          onResetColumns={resetColumns}
        />
      }
    />
  );
}

function HrApprovalInboxWorkspace({
  kind,
  title,
  description,
  loader,
  openHistory,
}) {
  const navigate = useNavigate();
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [decisionTally, setDecisionTally] = useState({
    approved: 0,
    rejected: 0,
  });
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useHrVisibleColumns(`erp.hr.requestColumns.${kind}.approvalInbox`);
  const { rows, loading, error, setError, refresh } = useHrQueryLoader(loader);

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

  async function handleDecision(request, decision) {
    const approved = await openActionConfirm({
      eyebrow: kind === "leave" ? "Leave Approval" : "Out Work Approval",
      title: `${decision === "APPROVED" ? "Approve" : "Reject"} Request`,
      message: `${decision === "APPROVED" ? "Approve" : "Reject"} workflow ${request.workflow_request_id}?`,
      confirmLabel: decision === "APPROVED" ? "Approve" : "Reject",
      cancelLabel: "Back",
    });

    if (!approved) return;

    try {
      await submitWorkflowDecision(request.workflow_request_id, decision);
      setDecisionTally((current) => ({
        approved: current.approved + (decision === "APPROVED" ? 1 : 0),
        rejected: current.rejected + (decision === "REJECTED" ? 1 : 0),
      }));
      window.dispatchEvent(new CustomEvent("erp:workflow-changed"));
      await refresh();
    } catch (err) {
      setError(formatError(err, "Decision could not be submitted."));
    }
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="HR Management"
      title={title}
      description={description}
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
          hint: "Alt+R",
          tone: "primary",
          onClick: () => void refresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      metrics={[
        {
          key: "queue",
          label: "Queue",
          value: String(rows.length),
          tone: "sky",
          caption: "Rows still actionable for the current approver.",
        },
        {
          key: "pending",
          label: "Pending",
          value: String(rows.filter((row) => row.current_state === "PENDING").length),
          tone: "amber",
          caption: "Still waiting for your decision.",
        },
        {
          key: "approved",
          label: "Approved",
          value: String(decisionTally.approved),
          tone: "emerald",
          caption: "Approved from this inbox during the current session.",
        },
        {
          key: "rejected",
          label: "Rejected",
          value: String(decisionTally.rejected),
          tone: "slate",
          caption: "Rejected from this inbox during the current session.",
        },
      ]}
      filterSection={{
        eyebrow: "Queue Search",
        title: "Filter approval inbox",
        children: (
          <QuickFilterInput
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchRef}
            placeholder="Search requester, reason, destination, or workflow id"
          />
        ),
      }}
      reviewSection={{
        eyebrow: "Pending Queue",
        title: loading
          ? "Loading approval inbox"
          : `${filteredRows.length} actionable request${filteredRows.length === 1 ? "" : "s"}`,
        description: "Only requests currently actionable for the logged-in approver stay in this queue.",
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading approval inbox.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No pending request is currently actionable for this approver.
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-max gap-3">
                <HrRequestMatrixHeader columns={visibleColumns} />
                {filteredRows.map((request) => (
                  <HrRequestCard
                    key={request.workflow_request_id}
                    request={request}
                    kind={kind}
                    mode="approvalInbox"
                    visibleColumns={visibleColumns}
                    onApprove={(row) => void handleDecision(row, "APPROVED")}
                    onReject={(row) => void handleDecision(row, "REJECTED")}
                  />
                ))}
              </div>
            </div>
          </div>
        ),
      }}
      bottomSection={
        <HrRequestColumnPickerModal
          visible={showColumnPicker}
          visibleColumnKeys={visibleColumnKeys}
          onClose={() => setShowColumnPicker(false)}
          onToggleColumn={toggleColumn}
          onResetColumns={resetColumns}
        />
      }
    />
  );
}

function HrApprovalHistoryWorkspace({
  kind,
  title,
  description,
  loader,
}) {
  const searchRef = useRef(null);
  const requesterRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [requesterAuthUserId, setRequesterAuthUserId] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
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

  async function handleRefresh() {
    try {
      await refresh(requesterAuthUserId);
    } catch (err) {
      setError(formatError(err, "Approval history could not be loaded."));
    }
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="HR Management"
      title={title}
      description={description}
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
          hint: "Alt+R",
          tone: "primary",
          onClick: () => void handleRefresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      metrics={buildListMetrics(rows)}
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
        description: "This page shows all cases where the logged-in user belongs to the approver scope, even if somebody else already decided.",
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading approval scope history.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No request is visible in the current approval scope history.
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-max gap-3">
                <HrRequestMatrixHeader columns={visibleColumns} />
                {filteredRows.map((request) => (
                  <HrRequestCard
                    key={request.workflow_request_id}
                    request={request}
                    kind={kind}
                    mode="approvalHistory"
                    visibleColumns={visibleColumns}
                  />
                ))}
              </div>
            </div>
          </div>
        ),
      }}
      bottomSection={
        <HrRequestColumnPickerModal
          visible={showColumnPicker}
          visibleColumnKeys={visibleColumnKeys}
          onClose={() => setShowColumnPicker(false)}
          onToggleColumn={toggleColumn}
          onResetColumns={resetColumns}
        />
      }
    />
  );
}

function HrRegisterWorkspace({
  kind,
  title,
  description,
  loader,
}) {
  const searchRef = useRef(null);
  const requesterRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [requesterAuthUserId, setRequesterAuthUserId] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
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

  async function handleRefresh() {
    try {
      await refresh(requesterAuthUserId);
    } catch (err) {
      setError(formatError(err, "Register could not be loaded."));
    }
  }

  return (
    <ErpReportFilterTemplate
      eyebrow="HR Management"
      title={title}
      description={description}
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
          hint: "Alt+R",
          tone: "primary",
          onClick: () => void handleRefresh(),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      metrics={buildListMetrics(rows)}
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
        description: "HR and reporting visibility lane for the selected company universe.",
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading register.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No request matches the current register filter.
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-max gap-3">
                <HrRequestMatrixHeader columns={visibleColumns} />
                {filteredRows.map((request) => (
                  <HrRequestCard
                    key={request.workflow_request_id}
                    request={request}
                    kind={kind}
                    mode="register"
                    visibleColumns={visibleColumns}
                  />
                ))}
              </div>
            </div>
          </div>
        ),
      }}
      bottomSection={
        <HrRequestColumnPickerModal
          visible={showColumnPicker}
          visibleColumnKeys={visibleColumnKeys}
          onClose={() => setShowColumnPicker(false)}
          onToggleColumn={toggleColumn}
          onResetColumns={resetColumns}
        />
      }
    />
  );
}

export function LeaveMyRequestsWorkspace() {
  return (
    <HrRequestListWorkspace
      kind="leave"
      title="My Leave Requests"
      description="See own leave request history with current workflow status. Pending rows stay cancellable only until the first approver acts."
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
      description="Approvers see only the currently actionable leave requests here and can approve or reject without leaving the queue."
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
      description="See every leave request where the logged-in user belongs to the approver scope, whether or not the logged-in user gave the decision."
      loader={(requesterAuthUserId) => listLeaveApprovalHistory(requesterAuthUserId)}
    />
  );
}

export function LeaveRegisterWorkspace() {
  return (
    <HrRegisterWorkspace
      kind="leave"
      title="HR Leave Register"
      description="Parent-company HR and reporting viewers can inspect cross-user leave request history here."
      loader={(requesterAuthUserId) => listLeaveRegister(requesterAuthUserId)}
    />
  );
}

export function OutWorkMyRequestsWorkspace() {
  return (
    <HrRequestListWorkspace
      kind="outWork"
      title="My Out Work Requests"
      description="See own out work request history with current workflow status. Pending rows stay cancellable only until the first approver acts."
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
      description="Approvers see only the currently actionable out work requests here and can approve or reject without leaving the queue."
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
      description="See every out work request where the logged-in user belongs to the approver scope, whether or not the logged-in user gave the decision."
      loader={(requesterAuthUserId) => listOutWorkApprovalHistory(requesterAuthUserId)}
    />
  );
}

export function OutWorkRegisterWorkspace() {
  return (
    <HrRegisterWorkspace
      kind="outWork"
      title="Out Work Register"
      description="Parent-company HR and reporting viewers can inspect cross-user out work request history here."
      loader={(requesterAuthUserId) => listOutWorkRegister(requesterAuthUserId)}
    />
  );
}
