/*
 * File-ID: 8.4C-HR-CORR-PAGE
 * File-Path: frontend/src/pages/dashboard/hr/attendance/HrAttendanceCorrectionPage.jsx
 * Gate: 8
 * Phase: 4-C
 * Domain: HR
 * Purpose: HR attendance correction — browse employee day records, apply
 *          backdated leave or out-work on behalf of any employee.
 * Authority: Frontend
 */

import { useEffect, useRef, useState } from "react";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../../store/uiToast.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import {
  backdatedLeaveApply,
  backdatedOutWorkApply,
  formatIsoDate,
  listDayRecords,
  listLeaveTypes,
  listOutWorkDestinations,
  submitCorrectionRequest,
  shiftIsoDate,
} from "../hrApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatError(err, fallback) {
  if (!err || typeof err !== "object") return fallback;
  const trace = typeof err.decisionTrace === "string" ? err.decisionTrace : null;
  const code = typeof err.code === "string" ? err.code : "REQUEST_BLOCKED";
  return `${err.message ?? fallback} (${trace ?? code})`;
}

const STATUS_TONE = {
  LEAVE:      "border-sky-200 bg-sky-50 text-sky-800",
  OUT_WORK:   "border-indigo-200 bg-indigo-50 text-indigo-800",
  HOLIDAY:    "border-emerald-200 bg-emerald-50 text-emerald-800",
  WEEK_OFF:   "border-teal-200 bg-teal-50 text-teal-800",
  PRESENT:    "border-green-200 bg-green-50 text-green-800",
  ABSENT:     "border-rose-200 bg-rose-50 text-rose-800",
  MISS_PUNCH: "border-amber-200 bg-amber-50 text-amber-800",
};

const SOURCE_LABEL = {
  LEAVE_APPROVED:    "Leave",
  OUT_WORK_APPROVED: "Out-Work",
  HOLIDAY_CALENDAR:  "Holiday",
  WEEK_OFF_CALENDAR: "Week-Off",
  MANUAL_HR:         "Manual (HR)",
  BIOMETRIC_AUTO:    "Biometric",
};

function StatusBadge({ status }) {
  const cls = STATUS_TONE[status] ?? "border-slate-200 bg-slate-50 text-slate-700";
  const label = status?.replace(/_/g, " ") ?? "—";
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Criteria Panel
// ---------------------------------------------------------------------------

function CriteriaPanel({ employeeId, setEmployeeId, fromDate, setFromDate, toDate, setToDate, onLoad, loading, employeeRef }) {
  return (
    <ErpSectionCard eyebrow="HR Attendance Correction" title="Select Employee & Date Range">
      <div className="grid gap-2">
        <ErpDenseFormRow label="Employee Code" required>
          <input
            ref={employeeRef}
            type="text"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
            placeholder="Enter employee code (e.g. P0003)"
            className="h-7 w-full max-w-sm border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500 font-mono uppercase"
          />
        </ErpDenseFormRow>
        <ErpDenseFormRow label="Date Range" required>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-7 border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-7 border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </div>
        </ErpDenseFormRow>
        <div className="pt-1">
          <button
            type="button"
            disabled={loading}
            onClick={onLoad}
            className="border border-sky-700 bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-sky-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load Records"}
          </button>
        </div>
      </div>
    </ErpSectionCard>
  );
}

// ---------------------------------------------------------------------------
// Day Records Table
// ---------------------------------------------------------------------------

function DayRecordsTable({ records, selectedId, onRowClick }) {
  if (records.length === 0) {
    return (
      <div className="border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        No day records found for the selected employee and date range.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Date</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Source</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Applied By</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Correction</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Action</th>
          </tr>
        </thead>
        <tbody>
          {records.map((row) => {
            const isSelected = row.day_record_id === selectedId;
            const isLocked = ["HOLIDAY", "WEEK_OFF"].includes(row.declared_status);
            return (
              <tr
                key={row.day_record_id}
                className={`border-b border-slate-100 transition-colors ${
                  isSelected ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <td className="px-3 py-2 font-mono text-xs text-slate-800">
                  {formatIsoDate(row.record_date)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.declared_status} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {SOURCE_LABEL[row.source] ?? row.source ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {row.applied_by_display ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {row.manually_corrected ? (
                    <div className="grid gap-0.5">
                      <span className="inline-block border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-800">
                        Corrected
                      </span>
                      {row.previous_status ? (
                        <span className="text-[9px] text-slate-500">
                          was: {row.previous_status.replace(/_/g, " ")}
                        </span>
                      ) : null}
                      {row.correction_note ? (
                        <span className="max-w-[160px] truncate text-[9px] text-slate-500" title={row.correction_note}>
                          {row.correction_note}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isLocked ? (
                    <span className="text-[10px] text-slate-400 italic">locked</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRowClick(row)}
                      className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
                        isSelected
                          ? "border-slate-400 bg-white text-slate-700 hover:bg-slate-50"
                          : "border-sky-600 bg-sky-50 text-sky-800 hover:bg-sky-100"
                      }`}
                    >
                      {isSelected ? "Close" : "Apply / Correct"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Apply Panel (Leave)
// ---------------------------------------------------------------------------

function LeaveApplyPanel({ record, employeeId, leaveTypes, onSuccess, onClose }) {
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.leave_type_id ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!leaveTypeId) { setError("Leave type is required."); return; }
    if (!reason.trim()) { setError("Reason is required."); return; }
    setSaving(true);
    setError("");
    try {
      await backdatedLeaveApply({
        target_employee_id: employeeId,
        leave_type_id: leaveTypeId,
        from_date: record.record_date,
        to_date: record.record_date,
        reason: reason.trim(),
      });
      pushToast({ id: `leave-applied-${record.record_date}`, tone: "success", title: "Saved", message: `Leave applied for ${formatIsoDate(record.record_date)}.` });
      onSuccess();
    } catch (err) {
      setError(formatError(err, "Leave could not be applied."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 border border-sky-200 bg-[#f8fbff] px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
          Apply Leave — {formatIsoDate(record.record_date)}
        </p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">✕ Close</button>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      <div className="grid gap-2">
        <ErpDenseFormRow label="Leave Type" required>
          <ErpComboboxField
            value={leaveTypeId}
            onChange={setLeaveTypeId}
            options={leaveTypes.map((lt) => ({ value: lt.leave_type_id, label: `${lt.type_name} (${lt.type_code})` }))}
          />
        </ErpDenseFormRow>

        <ErpDenseFormRow label="Reason" required>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-sky-500 resize-none"
            placeholder="Reason for backdated leave…"
          />
        </ErpDenseFormRow>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="border border-sky-700 bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-sky-950 hover:bg-sky-200 disabled:opacity-50"
        >
          {saving ? "Submitting…" : "Submit Leave Request"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="border border-slate-400 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Apply Panel (Out Work)
// ---------------------------------------------------------------------------

function OutWorkApplyPanel({ record, employeeId, destinations, onSuccess, onClose }) {
  const [destinationId, setDestinationId] = useState(destinations[0]?.destination_id ?? "");
  const [inlineName, setInlineName] = useState("");
  const [inlineAddress, setInlineAddress] = useState("");
  const [reason, setReason] = useState("");
  const [dayScope, setDayScope] = useState("FULL_DAY");
  const [departureTime, setDepartureTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const useInline = !destinationId;

  async function handleSubmit() {
    if (!destinationId && (inlineName.trim().length < 2 || inlineAddress.trim().length < 5)) {
      setError("Provide a destination (choose from list or enter name + address).");
      return;
    }
    if (!reason.trim()) { setError("Reason is required."); return; }
    if (dayScope === "PARTIAL_DAY" && !/^\d{2}:\d{2}$/.test(departureTime)) {
      setError("Departure time (HH:MM) is required for partial day.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await backdatedOutWorkApply({
        target_employee_id: employeeId,
        from_date: record.record_date,
        to_date: record.record_date,
        reason: reason.trim(),
        destination_id: destinationId || null,
        destination_name: destinationId ? undefined : inlineName.trim(),
        destination_address: destinationId ? undefined : inlineAddress.trim(),
        day_scope: dayScope,
        office_departure_time: dayScope === "PARTIAL_DAY" ? departureTime : null,
      });
      pushToast({ id: `out-work-applied-${record.record_date}`, tone: "success", title: "Saved", message: `Out-work applied for ${formatIsoDate(record.record_date)}.` });
      onSuccess();
    } catch (err) {
      setError(formatError(err, "Out-work could not be applied."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 border border-indigo-200 bg-[#f8f9ff] px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
          Apply Out-Work — {formatIsoDate(record.record_date)}
        </p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">✕ Close</button>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      <div className="grid gap-2">
        {/* Day Scope toggle */}
        <ErpDenseFormRow label="Day Scope">
          <div className="flex">
            {["FULL_DAY", "PARTIAL_DAY"].map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => { setDayScope(scope); if (scope === "FULL_DAY") setDepartureTime(""); }}
                className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
                  dayScope === scope
                    ? "border-indigo-600 bg-indigo-100 text-indigo-800"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                } ${scope === "PARTIAL_DAY" ? "border-l-0" : ""}`}
              >
                {scope === "FULL_DAY" ? "Full Day" : "Partial Day"}
              </button>
            ))}
          </div>
        </ErpDenseFormRow>

        {/* Destination */}
        {destinations.length > 0 ? (
          <ErpDenseFormRow label="Destination">
            <ErpComboboxField
              value={destinationId}
              onChange={setDestinationId}
              options={[
                { value: "", label: "— Enter custom —" },
                ...destinations.map((d) => ({ value: d.destination_id, label: d.destination_name })),
              ]}
            />
          </ErpDenseFormRow>
        ) : null}

        {useInline || destinations.length === 0 ? (
          <>
            <ErpDenseFormRow label="Location Name" required>
              <input
                type="text"
                value={inlineName}
                onChange={(e) => setInlineName(e.target.value)}
                className="h-7 w-full border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500"
                placeholder="e.g. Client Office"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Address" required>
              <input
                type="text"
                value={inlineAddress}
                onChange={(e) => setInlineAddress(e.target.value)}
                className="h-7 w-full border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500"
                placeholder="e.g. 123 MG Road, Bengaluru"
              />
            </ErpDenseFormRow>
          </>
        ) : null}

        {/* Departure time for partial day */}
        {dayScope === "PARTIAL_DAY" ? (
          <ErpDenseFormRow label="Departed Office At" required>
            <input
              type="time"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              className="h-7 border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
        ) : null}

        <ErpDenseFormRow label="Reason" required>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-sky-500 resize-none"
            placeholder="Reason for backdated out-work…"
          />
        </ErpDenseFormRow>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="border border-indigo-700 bg-indigo-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-indigo-950 hover:bg-indigo-200 disabled:opacity-50"
        >
          {saving ? "Submitting…" : "Submit Out-Work Request"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="border border-slate-400 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Manual Correction Panel
// ---------------------------------------------------------------------------

const CORRECTION_STATUS_OPTIONS = [
  { value: "PRESENT",    label: "Present" },
  { value: "ABSENT",     label: "Absent" },
  { value: "MISS_PUNCH", label: "Miss Punch" },
];

function ManualCorrectionPanel({ record, employeeId, onSuccess, onClose }) {
  const [newStatus, setNewStatus] = useState("PRESENT");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!note.trim()) { setError("Correction note is required."); return; }
    setSaving(true);
    setError("");
    try {
      await submitCorrectionRequest({
        target_employee_id: employeeId,
        target_date:        record.record_date,
        requested_status:   newStatus,
        correction_note:    note.trim(),
      });
      pushToast({
        id: `correction-submitted-${record.record_date}`,
        tone: "success",
        title: "Correction Request Submitted",
        message: `Correction to ${newStatus.replace(/_/g, " ")} for ${formatIsoDate(record.record_date)} is pending approval.`,
      });
      onSuccess();
    } catch (err) {
      setError(formatError(err, "Correction request could not be submitted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 border border-amber-200 bg-[#fffef7] px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          Correct Status — {formatIsoDate(record.record_date)}
          {record.declared_status ? (
            <span className="ml-2 font-normal normal-case text-slate-500">
              (currently: {record.declared_status.replace(/_/g, " ")})
            </span>
          ) : null}
        </p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">✕ Close</button>
      </div>

      <div className="border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Correction requires approval. After submission, the Plant Manager will review and approve or reject this request. The day record will only be updated after approval.
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      <div className="grid gap-2">
        <ErpDenseFormRow label="New Status" required>
          <div className="flex">
            {CORRECTION_STATUS_OPTIONS.map(({ value, label }, i) => (
              <button
                key={value}
                type="button"
                onClick={() => setNewStatus(value)}
                className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
                  i > 0 ? "border-l-0" : ""
                } ${
                  newStatus === value
                    ? "border-amber-600 bg-amber-100 text-amber-900"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </ErpDenseFormRow>

        <ErpDenseFormRow label="Correction Note" required>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-amber-500 resize-none"
            placeholder="Reason for correction (required for audit trail)…"
          />
        </ErpDenseFormRow>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="border border-amber-700 bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-amber-950 hover:bg-amber-200 disabled:opacity-50"
        >
          {saving ? "Submitting…" : "Submit for Approval"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="border border-slate-400 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HrAttendanceCorrectionPage() {
  const employeeRef = useRef(null);

  // Criteria state
  const [employeeId, setEmployeeId] = useState("");
  const [fromDate, setFromDate] = useState(() => shiftIsoDate(todayIso(), -14));
  const [toDate, setToDate] = useState(todayIso);

  // Records state
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");

  // Selected row for inline apply form
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [applyKind, setApplyKind] = useState("leave"); // "leave" | "outWork"

  // Supporting data
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [destinations, setDestinations] = useState([]);

  // Load leave types + destinations on mount
  useEffect(() => {
    listLeaveTypes()
      .then((data) => setLeaveTypes(data?.leave_types ?? []))
      .catch(() => {});
    listOutWorkDestinations()
      .then((data) => setDestinations(data?.destinations ?? []))
      .catch(() => {});
  }, []);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading || !employeeId,
      perform: handleLoad,
    },
    focusPrimary: { perform: () => employeeRef.current?.focus?.() },
  });

  async function handleLoad() {
    if (!employeeId.trim()) {
      setError("Employee code is required.");
      employeeRef.current?.focus?.();
      return;
    }
    if (!fromDate || !toDate) {
      setError("Date range is required.");
      return;
    }
    if (toDate < fromDate) {
      setError("To date must be on or after from date.");
      return;
    }

    setLoading(true);
    setError("");
    setHasLoaded(false);
    setSelectedRecord(null);

    try {
      const data = await listDayRecords({
        employeeId: employeeId.trim(),
        fromDate,
        toDate,
      });
      setRecords(data?.records ?? []);
      setHasLoaded(true);
    } catch (err) {
      setError(formatError(err, "Day records could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  function handleRowClick(record) {
    if (selectedRecord?.day_record_id === record.day_record_id) {
      setSelectedRecord(null);
    } else {
      setSelectedRecord(record);
      setApplyKind("leave");
    }
  }

  function handleApplySuccess() {
    setSelectedRecord(null);
    handleLoad();
  }

  return (
    <ErpScreenScaffold
      eyebrow="HR"
      title="Attendance Correction"
      footerHints={["F8 Load Records", "Esc Back", "Ctrl+K Command Bar"]}
      actions={[
        {
          key: "load",
          label: "Load Records",
          hint: "F8",
          tone: "primary",
          disabled: loading,
          onClick: handleLoad,
        },
      ]}
      error={error}
    >
      {/* Criteria */}
      <CriteriaPanel
        employeeId={employeeId}
        setEmployeeId={setEmployeeId}
        fromDate={fromDate}
        setFromDate={setFromDate}
        toDate={toDate}
        setToDate={setToDate}
        onLoad={handleLoad}
        loading={loading}
        employeeRef={employeeRef}
      />

      {/* Results */}
      {hasLoaded ? (
        <ErpSectionCard
          eyebrow="Day Records"
          title={`${records.length} record${records.length !== 1 ? "s" : ""} found`}
        >
          <div className="grid gap-4">
            <DayRecordsTable
              records={records}
              selectedId={selectedRecord?.day_record_id ?? null}
              onRowClick={handleRowClick}
            />

            {/* Inline apply panel */}
            {selectedRecord ? (
              <div className="grid gap-0">
                {/* Kind toggle */}
                <div className="flex flex-wrap border-b border-slate-200 bg-slate-50 px-4 py-2 gap-2">
                  <span className="self-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mr-2">
                    Action:
                  </span>
                  {[
                    { key: "leave",   label: "Apply Leave" },
                    { key: "outWork", label: "Apply Out-Work" },
                    { key: "correct", label: "Correct Status" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setApplyKind(key)}
                      className={`border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                        applyKind === key
                          ? key === "leave"
                            ? "border-sky-600 bg-sky-100 text-sky-800"
                            : key === "outWork"
                            ? "border-indigo-600 bg-indigo-100 text-indigo-800"
                            : "border-amber-600 bg-amber-100 text-amber-800"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {applyKind === "leave" ? (
                  <LeaveApplyPanel
                    record={selectedRecord}
                    employeeId={employeeId.trim()}
                    leaveTypes={leaveTypes}
                    onSuccess={handleApplySuccess}
                    onClose={() => setSelectedRecord(null)}
                  />
                ) : applyKind === "outWork" ? (
                  <OutWorkApplyPanel
                    record={selectedRecord}
                    employeeId={employeeId.trim()}
                    destinations={destinations}
                    onSuccess={handleApplySuccess}
                    onClose={() => setSelectedRecord(null)}
                  />
                ) : (
                  <ManualCorrectionPanel
                    record={selectedRecord}
                    employeeId={employeeId.trim()}
                    onSuccess={handleApplySuccess}
                    onClose={() => setSelectedRecord(null)}
                  />
                )}
              </div>
            ) : null}
          </div>
        </ErpSectionCard>
      ) : null}

      {loading ? (
        <div className="border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Loading day records…
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
