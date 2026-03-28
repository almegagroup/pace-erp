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
import { openActionConfirm } from "../../../store/actionConfirm.js";
import {
  handleGridNavigation,
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

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

export default function SASignupRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actingUserId, setActingUserId] = useState("");
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

    try {
      const data = await fetchSignupRequests();
      setRequests(data);
    } catch {
      setError("Unable to refresh pending signup requests right now.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(authUserId, decision) {
    if (!authUserId) {
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA Onboarding Queue",
      title:
        decision === "APPROVE"
          ? "Approve Signup Request"
          : "Reject Signup Request",
      message:
        decision === "APPROVE"
          ? "Approve this ERP signup request and move the user into the governed ERP lifecycle?"
          : "Reject this ERP signup request and close the onboarding request?",
      confirmLabel: decision === "APPROVE" ? "Approve" : "Reject",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setActingUserId(authUserId);
    setError("");

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
      const stillPending = Boolean(pendingRow);

      setRequests(refreshedRequests);

      if (stillPending) {
        const lifecycleState = pendingRow?.user_state ?? "UNKNOWN";
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

  const totalRequests = requests.length;
  const withCompanyHintCount = requests.filter((row) => row.parent_company_name).length;
  const withPhoneCount = requests.filter((row) => row.phone_number).length;
  const withDesignationCount = requests.filter((row) => row.designation_hint).length;

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

  const metrics = [
    {
      key: "pending-queue",
      label: "Pending Queue",
      value: loading ? "..." : String(totalRequests),
      tone: "sky",
      caption:
        "Current pending ERP access requests awaiting Super Admin review.",
    },
    {
      key: "company-hint",
      label: "Company Hint",
      value: loading ? "..." : String(withCompanyHintCount),
      tone: "amber",
      caption:
        "Requests that already include a parent company hint for onboarding context.",
    },
    {
      key: "phone-ready",
      label: "Phone Ready",
      value: loading ? "..." : String(withPhoneCount),
      tone: "emerald",
      caption:
        "Requests with contact number present for quick follow-up if needed.",
    },
    {
      key: "designation-hint",
      label: "Designation Hint",
      value: loading ? "..." : String(withDesignationCount),
      tone: "slate",
      caption:
        "Requests that already include a designation hint for role review.",
    },
  ];

  const summarySection = {
    eyebrow: "Onboarding Contract",
    title: "Approval And Rejection Remain DB-Owned Atomic Actions",
    description:
      "This screen consumes the pending queue and sends decisions to the existing atomic backend authority. Approval creates the ERP user lifecycle through the DB-owned function, while rejection closes the request without frontend-owned mutation logic.",
    aside: (
      <span className="rounded-full bg-sky-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
        Gate 4 Intake
      </span>
    ),
  };

  const filterSection = {
    eyebrow: "Review Queue",
    title: "Pending ERP Onboarding Intake",
    aside: (
      <span className="rounded-full bg-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
        {loading ? "Loading" : `${filteredRequests.length} Visible`}
      </span>
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        className=""
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by requester, auth, company, designation, phone, or lifecycle"
        hint="Visible quick filter for the onboarding queue. Alt+Shift+F jumps here."
        primaryFocus
      />
    ),
  };

  const listSection = {
    eyebrow: "Decision Rows",
    title: loading
      ? "Refreshing onboarding queue"
      : `${filteredRequests.length} visible request${filteredRequests.length === 1 ? "" : "s"}`,
    children: loading ? (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        Loading pending signup requests from the onboarding queue.
      </div>
    ) : filteredRequests.length === 0 ? (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        There are no pending signup requests matching the current filter right now.
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-3">
          <thead>
            <tr>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Requester
              </th>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Company
              </th>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Designation
              </th>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Contact
              </th>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Submitted
              </th>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Lifecycle
              </th>
              <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.map((request, index) => {
              const isActing = actingUserId === request.auth_user_id;

              return (
                <tr key={request.auth_user_id} className="bg-slate-50 align-top">
                  <td className="rounded-none px-4 py-4 text-sm text-slate-700 first:rounded-l-2xl">
                    <div className="font-semibold text-slate-900">
                      {request.name ?? "Unnamed Request"}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                      Auth {shortId(request.auth_user_id)}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">
                    {request.parent_company_name ?? "Not Provided"}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">
                    {request.designation_hint ?? "Not Provided"}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">
                    {request.phone_number ?? "Not Provided"}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">
                    {formatDateTime(request.submitted_at)}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                      {formatLifecycleState(request.user_state)}
                    </span>
                  </td>
                  <td className="rounded-none px-4 py-4 text-sm text-slate-700 last:rounded-r-2xl">
                    <div className="flex flex-wrap gap-2">
                      <button
                        ref={(element) => {
                          rowActionRefs.current[index] ??= [];
                          rowActionRefs.current[index][0] = element;
                        }}
                        type="button"
                        disabled={isActing}
                        onClick={() =>
                          void handleDecision(request.auth_user_id, "APPROVE")
                        }
                        onKeyDown={(event) =>
                          handleGridNavigation(event, {
                            rowIndex: index,
                            columnIndex: 0,
                            gridRefs: rowActionRefs.current,
                          })
                        }
                        className={`rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 ${
                          isActing ? "cursor-not-allowed opacity-60" : ""
                        }`}
                      >
                        {isActing ? "Updating..." : "Approve"}
                      </button>
                      <button
                        ref={(element) => {
                          rowActionRefs.current[index] ??= [];
                          rowActionRefs.current[index][1] = element;
                        }}
                        type="button"
                        disabled={isActing}
                        onClick={() =>
                          void handleDecision(request.auth_user_id, "REJECT")
                        }
                        onKeyDown={(event) =>
                          handleGridNavigation(event, {
                            rowIndex: index,
                            columnIndex: 1,
                            gridRefs: rowActionRefs.current,
                          })
                        }
                        className={`rounded-2xl bg-rose-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700 ${
                          isActing ? "cursor-not-allowed opacity-60" : ""
                        }`}
                      >
                        {isActing ? "Updating..." : "Reject"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ),
  };

  return (
    <ErpMasterListTemplate
      eyebrow="SA Onboarding Queue"
      title="Pending Signup Requests"
      description="This keyboard-native list keeps the onboarding queue, quick search, and approve/reject decisions in one deterministic operating surface."
      actions={topActions}
      notices={
        error
          ? [
              {
                key: "error",
                tone: "error",
                message: error,
              },
            ]
          : []
      }
      metrics={metrics}
      summarySection={summarySection}
      filterSection={filterSection}
      listSection={listSection}
    />
  );
}
