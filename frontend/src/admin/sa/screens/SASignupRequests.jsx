/*
 * File-ID: 4.2-FRONT
 * File-Path: frontend/src/admin/sa/screens/SASignupRequests.jsx
 * Gate: 4
 * Phase: 4
 * Domain: FRONT
 * Purpose: Super Admin onboarding queue surface for pending ERP signup review and approval actions
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import {
  handleGridNavigation,
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import ErpInlineApprovalRow from "../../../components/data/ErpInlineApprovalRow.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchSignupRequests() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/signup-requests`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json.data)) {
    throw new Error("SIGNUP_REQUEST_LIST_READ_FAILED");
  }

  return json.data;
}

function formatDateTime(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value) {
  if (!value) return "N/A";
  return String(value).slice(0, 8);
}

function formatLifecycleState(value) {
  if (!value) return "UNKNOWN";
  return String(value).replaceAll("_", " ");
}

// ---------------------------------------------------------------------------
// Edit Panel — shown below the table when SA clicks "Edit" on a row
// ---------------------------------------------------------------------------
function EditPanel({ request, onSave, onCancel }) {
  const [name, setName] = useState(request.name ?? "");
  const [company, setCompany] = useState(request.parent_company_name ?? "");
  const [designation, setDesignation] = useState(request.designation_hint ?? "");
  const [phone, setPhone] = useState(request.phone_number ?? "");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim()) {
      setLocalError("Name is required.");
      nameRef.current?.focus();
      return;
    }
    if (!company.trim()) {
      setLocalError("Company name is required.");
      return;
    }

    setSaving(true);
    setLocalError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/signup-requests/correct`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_user_id: request.auth_user_id,
            name: name.trim(),
            parent_company_name: company.trim(),
            designation_hint: designation.trim() || null,
            phone_number: phone.trim() || null,
          }),
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok) {
        throw new Error("SAVE_FAILED");
      }

      if (json?.data?.corrected !== true) {
        const reason = json?.data?.reason ?? "UNKNOWN";
        if (reason === "NOT_PENDING_OR_NOT_FOUND") {
          throw new Error("This request is no longer pending and cannot be edited.");
        }
        throw new Error(`Save was rejected by server: ${reason}`);
      }

      onSave();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full border border-slate-300 bg-white px-2 py-1.5 text-[12px] text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200";

  const labelClass =
    "block text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1";

  return (
    <form
      onSubmit={handleSave}
      className="border border-sky-200 bg-[#f8fbff] px-4 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700">
            Correct Signup Request
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Auth {shortId(request.auth_user_id)} — Email cannot be changed (Supabase Auth)
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="border border-slate-300 bg-white px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>

      {localError ? (
        <div className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {localError}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelClass}>Full Name *</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            className={inputClass}
            placeholder="Full name"
          />
        </div>
        <div>
          <label className={labelClass}>Company *</label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            disabled={saving}
            className={inputClass}
            placeholder="Parent company name"
          />
        </div>
        <div>
          <label className={labelClass}>Designation</label>
          <input
            type="text"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            disabled={saving}
            className={inputClass}
            placeholder="e.g. Plant Head"
          />
        </div>
        <div>
          <label className={labelClass}>Phone</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={saving}
            className={inputClass}
            placeholder="+91 98765 43210"
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className={`border border-sky-600 bg-sky-50 px-3 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-800 ${saving ? "cursor-not-allowed opacity-60" : "hover:bg-sky-100"}`}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="border border-slate-300 bg-white px-3 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
export default function SASignupRequests() {
  const FOCUS_FIRST_ROW = "__FIRST_ROW__";
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actingUserId, setActingUserId] = useState("");
  const [editingRequest, setEditingRequest] = useState(null);
  const [pendingFocusTarget, setPendingFocusTarget] = useState(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState(-1);
  const actionBarRefs = useRef([]);
  const rowActionRefs = useRef([]);
  const searchInputRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function loadSignupRequests() {
      setLoading(true);
      setError("");

      try {
        const data = await fetchSignupRequests();

        if (!alive) return;

        setRequests(data);
      } catch {
        if (!alive) return;
        setError("Unable to load pending signup requests right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadSignupRequests();

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");
    setEditingRequest(null);

    try {
      const data = await fetchSignupRequests();
      setRequests(data);
    } catch {
      setError("Unable to refresh pending signup requests right now.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(authUserId, decision, fallbackUserId = "") {
    if (!authUserId) {
      return;
    }

    setActingUserId(authUserId);
    setError("");
    setNotice("");
    setEditingRequest(null);

    const endpoint =
      decision === "APPROVE"
        ? "/api/admin/signup-requests/approve"
        : "/api/admin/signup-requests/reject";

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}${endpoint}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            auth_user_id: authUserId,
          }),
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok) {
        throw new Error("SIGNUP_DECISION_FAILED");
      }

      if (json?.data?.applied !== true) {
        const failureReason = json?.data?.failure_reason ?? "UNKNOWN_FAILURE";
        throw new Error(`SIGNUP_DECISION_NOT_APPLIED:${failureReason}`);
      }

      const refreshedRequests = await fetchSignupRequests();
      const pendingRow = refreshedRequests.find(
        (row) => row.auth_user_id === authUserId
      );

      setRequests(refreshedRequests);
      setPendingFocusTarget(
        refreshedRequests.length > 0 ? fallbackUserId || FOCUS_FIRST_ROW : null
      );
      setNotice(
        decision === "APPROVE"
          ? "Signup request approved."
          : "Signup request rejected."
      );

      if (pendingRow) {
        const lifecycleState = pendingRow.user_state ?? "UNKNOWN";
        throw new Error(`SIGNUP_DECISION_NOT_FINALIZED:${lifecycleState}`);
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "";

      if (message.startsWith("SIGNUP_DECISION_NOT_APPLIED:")) {
        const failureReason = message.split(":")[1] ?? "UNKNOWN_FAILURE";
        setError(
          `Signup decision was rejected by the backend authority. Failure reason: ${failureReason}.`
        );
      } else if (message.startsWith("SIGNUP_DECISION_NOT_FINALIZED:")) {
        const lifecycleState = message.split(":")[1] ?? "UNKNOWN";
        setError(
          `Signup decision was not finalized by the backend. The request is still pending and the current user lifecycle state is ${formatLifecycleState(lifecycleState)}.`
        );
      } else {
        setError(
          "Signup decision was not finalized by the backend. The request is still pending."
        );
      }
    } finally {
      setActingUserId("");
    }
  }

  async function handleEditSaved() {
    setNotice("Signup request details corrected.");
    setEditingRequest(null);
    // Refresh list so the updated values appear
    try {
      const data = await fetchSignupRequests();
      setRequests(data);
    } catch {
      // non-fatal — list will still show stale data until next refresh
    }
  }

  const filteredRequests = useMemo(
    () =>
      applyQuickFilter(requests, searchQuery, [
        "name",
        "auth_user_id",
        "parent_company_name",
        "designation_hint",
        "phone_number",
        "user_state",
      ]),
    [requests, searchQuery]
  );
  const signupPagination = useErpPagination(filteredRequests, 10);

  const { getRowProps, getRowElement, focusRow } = useErpListNavigation(
    signupPagination.pageItems,
    {
      onActivate: (_row, index) => {
        const firstBtn = getRowElement(index)?.querySelector(
          "button:not(:disabled)"
        );
        firstBtn?.focus();
      },
    }
  );

  useEffect(() => {
    if (!pendingFocusTarget || signupPagination.pageItems.length === 0) {
      return;
    }

    let targetIndex = 0;

    if (pendingFocusTarget !== FOCUS_FIRST_ROW) {
      const matchedIndex = signupPagination.pageItems.findIndex(
        (row) => row.auth_user_id === pendingFocusTarget
      );

      if (matchedIndex >= 0) {
        targetIndex = matchedIndex;
      }
    }

    queueMicrotask(() => focusRow(targetIndex));
    setPendingFocusTarget(null);
  }, [focusRow, pendingFocusTarget, signupPagination.pageItems]);

  useErpScreenCommands([
    {
      id: "sa-signups-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing signup queue..." : "Refresh signup queue",
      keywords: ["refresh", "signup", "queue", "requests"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-signups-focus-search",
      group: "Current Screen",
      label: "Focus signup search",
      keywords: ["search", "filter", "signup"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-signups-open-users",
      group: "Current Screen",
      label: "Open user directory",
      keywords: ["users", "directory"],
      perform: () => openScreen("SA_USERS"),
      order: 30,
    },
    {
      id: "sa-signups-open-control-panel",
      group: "Current Screen",
      label: "Open control panel",
      keywords: ["control panel", "sa"],
      perform: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      order: 40,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => searchInputRef.current?.focus(),
    },
  });

  const topActions = [
    {
      key: "control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "user-directory",
      label: "User Directory",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => openScreen("SA_USERS"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh-queue",
      label: loading ? "Refreshing..." : "Refresh Queue",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void handleRefresh(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const filterSection = {
    eyebrow: "Review Queue",
    title: "Pending ERP Onboarding Intake",
    aside: (
      <span className="border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
        {loading ? "Loading" : `${filteredRequests.length} Visible`}
      </span>
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by requester, auth, company, designation, phone, or lifecycle"
        hint="Visible quick filter for the onboarding queue. Alt+Shift+F jumps here."
        primaryFocus
      />
    ),
  };

  const reviewSection = {
    eyebrow: "Decision Rows",
    title: loading
      ? "Refreshing onboarding queue"
      : `${filteredRequests.length} actionable request${filteredRequests.length === 1 ? "" : "s"}`,
    children: loading ? (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        Loading pending signup requests from the onboarding queue.
      </div>
    ) : filteredRequests.length === 0 ? (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        There are no pending signup requests matching the current filter right now.
      </div>
    ) : (
      <>
        <ErpPaginationStrip
          page={signupPagination.page}
          setPage={signupPagination.setPage}
          totalPages={signupPagination.totalPages}
          startIndex={signupPagination.startIndex}
          endIndex={signupPagination.endIndex}
          totalItems={filteredRequests.length}
        />
        <div className="overflow-auto border border-slate-300 bg-white">
          <table className="erp-grid-table min-w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                {[
                  "Requester",
                  "Company",
                  "Designation",
                  "Contact",
                  "Submitted",
                  "Lifecycle",
                  "Actions",
                ].map((label) => (
                  <th
                    key={label}
                    className="sticky top-0 z-10 border-b border-slate-700 bg-slate-800 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signupPagination.pageItems.map((request, index) => {
                const isActing = actingUserId === request.auth_user_id;
                const isEditing = editingRequest?.auth_user_id === request.auth_user_id;
                const rowProps = getRowProps(index);
                const fallbackRequest =
                  signupPagination.pageItems[index + 1] ??
                  signupPagination.pageItems[index - 1] ??
                  null;
                const fallbackUserId = fallbackRequest?.auth_user_id ?? "";

                return (
                  <ErpInlineApprovalRow
                    key={request.auth_user_id}
                    row={request}
                    index={index}
                    isFocused={focusedRowIndex === index}
                    onApprove={() =>
                      void handleDecision(
                        request.auth_user_id,
                        "APPROVE",
                        fallbackUserId
                      )
                    }
                    onReject={() =>
                      void handleDecision(
                        request.auth_user_id,
                        "REJECT",
                        fallbackUserId
                      )
                    }
                    onActivate={() => rowActionRefs.current[index]?.[0]?.focus()}
                    rowProps={{
                      ...rowProps,
                      onFocus: () => setFocusedRowIndex(index),
                    }}
                    columns={[
                      {
                        key: "requester",
                        render: (row) => (
                          <div>
                            <p className="font-medium leading-tight">{row.name ?? "Unnamed Request"}</p>
                            <p className="text-[10px] text-slate-500">Auth {shortId(row.auth_user_id)}</p>
                          </div>
                        ),
                      },
                      {
                        key: "company",
                        render: (row) => row.parent_company_name ?? "Not Provided",
                      },
                      {
                        key: "designation",
                        render: (row) => row.designation_hint ?? "Not Provided",
                      },
                      {
                        key: "contact",
                        render: (row) => row.phone_number ?? "Not Provided",
                      },
                      {
                        key: "submitted",
                        render: (row) => formatDateTime(row.submitted_at),
                      },
                      {
                        key: "lifecycle",
                        render: (row) => (
                          <span className="inline-flex border border-slate-300 bg-slate-100 px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                            {formatLifecycleState(row.user_state)}
                          </span>
                        ),
                      },
                      {
                        key: "actions",
                        render: () => (
                          <div className="flex gap-1">
                            <button
                              ref={(element) => {
                                rowActionRefs.current[index] ??= [];
                                rowActionRefs.current[index][0] = element;
                              }}
                              type="button"
                              disabled={isActing}
                              onClick={() =>
                                void handleDecision(
                                  request.auth_user_id,
                                  "APPROVE",
                                  fallbackUserId
                                )
                              }
                              onKeyDown={(event) =>
                                handleGridNavigation(event, {
                                  rowIndex: index,
                                  columnIndex: 0,
                                  gridRefs: rowActionRefs.current,
                                })
                              }
                              className={`border border-emerald-300 bg-emerald-50 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 ${isActing ? "cursor-not-allowed opacity-60" : ""}`}
                            >
                              {isActing ? "..." : "Approve"}
                            </button>
                            <button
                              ref={(element) => {
                                rowActionRefs.current[index] ??= [];
                                rowActionRefs.current[index][1] = element;
                              }}
                              type="button"
                              disabled={isActing}
                              onClick={() =>
                                void handleDecision(
                                  request.auth_user_id,
                                  "REJECT",
                                  fallbackUserId
                                )
                              }
                              onKeyDown={(event) =>
                                handleGridNavigation(event, {
                                  rowIndex: index,
                                  columnIndex: 1,
                                  gridRefs: rowActionRefs.current,
                                })
                              }
                              className={`border border-rose-300 bg-rose-50 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700 ${isActing ? "cursor-not-allowed opacity-60" : ""}`}
                            >
                              {isActing ? "..." : "Reject"}
                            </button>
                            <button
                              ref={(element) => {
                                rowActionRefs.current[index] ??= [];
                                rowActionRefs.current[index][2] = element;
                              }}
                              type="button"
                              disabled={isActing}
                              onClick={() =>
                                setEditingRequest(isEditing ? null : request)
                              }
                              onKeyDown={(event) =>
                                handleGridNavigation(event, {
                                  rowIndex: index,
                                  columnIndex: 2,
                                  gridRefs: rowActionRefs.current,
                                })
                              }
                              className={`border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                isEditing
                                  ? "border-sky-400 bg-sky-100 text-sky-800"
                                  : "border-slate-300 bg-slate-50 text-slate-600"
                              } ${isActing ? "cursor-not-allowed opacity-60" : ""}`}
                            >
                              {isEditing ? "Close" : "Edit"}
                            </button>
                          </div>
                        ),
                      },
                    ]}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Edit panel — shown below the table when a row is in edit mode */}
        {editingRequest ? (
          <EditPanel
            key={editingRequest.auth_user_id}
            request={editingRequest}
            onSave={() => void handleEditSaved()}
            onCancel={() => setEditingRequest(null)}
          />
        ) : null}
      </>
    ),
  };

  return (
    <ErpApprovalReviewTemplate
      eyebrow="SA Onboarding Queue"
      title="Pending Signup Requests"
      actions={topActions}
      notices={[
        ...(error
          ? [
              {
                key: "error",
                tone: "error",
                message: error,
              },
            ]
          : []),
        ...(notice
          ? [
              {
                key: "notice",
                tone: "success",
                message: notice,
              },
            ]
          : []),
      ]}
      footerHints={["↑↓ Navigate", "A Approve", "R Reject", "F8 Refresh", "Alt+Shift+F Search", "Esc Back", "Ctrl+K Command Bar"]}
      filterSection={filterSection}
      reviewSection={reviewSection}
    />
  );
}
