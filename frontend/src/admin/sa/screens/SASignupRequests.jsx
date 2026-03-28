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

function SummaryCard({ label, value, caption, tone = "sky" }) {
  const toneClassMap = {
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <article className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold text-slate-900">{value}</h3>
        <span
          className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneClassMap[tone] ?? toneClassMap.sky}`}
        >
          Live
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
    </article>
  );
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
    [requests, searchQuery],
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
  });

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-4 z-20 rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Onboarding Queue
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Pending Signup Requests
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review new ERP access requests, inspect intake details, and
                approve or reject onboarding from the Super Admin queue.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                ref={(element) => {
                  actionBarRefs.current[0] = element;
                }}
                type="button"
                onClick={() => openScreen("SA_CONTROL_PANEL", { mode: "reset" })}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 0,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Control Panel
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[1] = element;
                }}
                type="button"
                onClick={() => openScreen("SA_USERS")}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 1,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                User Directory
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[2] = element;
                }}
                data-workspace-primary-focus="true"
                type="button"
                onClick={() => void handleRefresh()}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 2,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 shadow-[0_10px_24px_rgba(14,116,144,0.08)]"
              >
                {loading ? "Refreshing..." : "Refresh Queue"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Pending Queue"
            value={loading ? "..." : String(totalRequests)}
            tone="sky"
            caption="Current pending ERP access requests awaiting Super Admin review."
          />
          <SummaryCard
            label="Company Hint"
            value={loading ? "..." : String(withCompanyHintCount)}
            tone="amber"
            caption="Requests that already include a parent company hint for onboarding context."
          />
          <SummaryCard
            label="Phone Ready"
            value={loading ? "..." : String(withPhoneCount)}
            tone="emerald"
            caption="Requests with contact number present for quick follow-up if needed."
          />
          <SummaryCard
            label="Designation Hint"
            value={loading ? "..." : String(withDesignationCount)}
            tone="slate"
            caption="Requests that already include a designation hint for role review."
          />
        </div>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Onboarding Contract
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Approval And Rejection Remain DB-Owned Atomic Actions
              </h2>
            </div>
            <span className="rounded-full bg-sky-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Gate 4 Intake
            </span>
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-600">
            This screen consumes the pending queue and sends decisions to the
            existing atomic backend authority. Approval creates the ERP user
            lifecycle through the DB-owned function, while rejection closes the
            request without frontend-owned mutation logic.
          </p>
        </section>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Review Queue
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Pending ERP Onboarding Intake
              </h2>
            </div>

            <span className="rounded-full bg-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              {loading ? "Loading" : `${filteredRequests.length} Visible`}
            </span>
          </div>

          <QuickFilterInput
            inputRef={searchInputRef}
            className="mt-5"
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by requester, auth, company, designation, phone, or lifecycle"
            hint="Visible quick filter for the onboarding queue."
          />

          {loading ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Loading pending signup requests from the onboarding queue.
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              There are no pending signup requests matching the current filter right now.
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
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
                      <tr
                        key={request.auth_user_id}
                        className="bg-slate-50 align-top"
                      >
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
          )}
        </section>
      </div>
    </section>
  );
}
