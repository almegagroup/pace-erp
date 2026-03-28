/*
 * File-ID: 9.6-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAUsers.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin user governance surface for ERP user inventory, role visibility, and state control
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  handleGridNavigation,
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { applyQuickFilter, sortUsers } from "../../../shared/erpCollections.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

const FILTERS = Object.freeze([
  { key: "ALL", label: "All Users" },
  { key: "ACTIVE", label: "Active" },
  { key: "DISABLED", label: "Disabled" },
]);

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchUsers() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/users`, {
    credentials: "include",
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json.data)) {
    throw new Error("USER_LIST_READ_FAILED");
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

function formatIdentityName(user) {
  return user.name ?? "Unknown User";
}

function canOpenScope(user) {
  return Boolean(user?.is_acl_user ?? user?.role_code);
}

function getStateTone(state) {
  switch (state) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-700";
    case "DISABLED":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getRoleTone(roleCode) {
  switch (roleCode) {
    case "SA":
      return "bg-sky-100 text-sky-700";
    case "GA":
      return "bg-indigo-100 text-indigo-700";
    case "DIRECTOR":
      return "bg-violet-100 text-violet-700";
    case "L3_MANAGER":
    case "L2_MANAGER":
    case "L1_MANAGER":
      return "bg-amber-100 text-amber-700";
    case "L2_AUDITOR":
    case "L1_AUDITOR":
      return "bg-cyan-100 text-cyan-700";
    case "L4_USER":
    case "L3_USER":
    case "L2_USER":
    case "L1_USER":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-rose-50 text-rose-700";
  }
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

export default function SAUsers() {
  const { shellProfile } = useMenu();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState("");
  const actionBarRefs = useRef([]);
  const filterRefs = useRef([]);
  const rowActionRefs = useRef([]);
  const searchInputRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function loadUsers() {
      setLoading(true);
      setError("");

      try {
        const data = await fetchUsers();

        if (!alive) return;

        setUsers(data);
      } catch {
        if (!alive) return;
        setError("Unable to load ERP users right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch {
      setError("Unable to refresh the ERP user list right now.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStateChange(user, nextState) {
    if (!user?.auth_user_id || user.state === nextState) {
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA User Governance",
      title:
        nextState === "DISABLED"
          ? "Disable ERP Access"
          : "Reactivate ERP Access",
      message:
        nextState === "DISABLED"
          ? `Disable ERP access for ${user.user_code ?? shortId(user.auth_user_id)} ${formatIdentityName(user)} now?`
          : `Reactivate ERP access for ${user.user_code ?? shortId(user.auth_user_id)} ${formatIdentityName(user)} now?`,
      confirmLabel: nextState === "DISABLED" ? "Disable" : "Reactivate",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setUpdatingUserId(user.auth_user_id);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/users/state`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target_auth_user_id: user.auth_user_id,
            next_state: nextState,
          }),
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok || json?.data?.applied !== true) {
        throw new Error("USER_STATE_UPDATE_FAILED");
      }

      const refreshedUsers = await fetchUsers();
      const refreshedTarget = refreshedUsers.find(
        (row) => row.auth_user_id === user.auth_user_id
      );

      setUsers(refreshedUsers);

      if (refreshedTarget?.state !== nextState) {
        throw new Error("USER_STATE_NOT_FINALIZED");
      }
    } catch {
      setError("User state change was not finalized by the backend.");
    } finally {
      setUpdatingUserId("");
    }
  }

  const governableUsers = useMemo(
    () =>
      sortUsers(
        users.filter(
          (user) =>
            !shellProfile?.userCode || user.user_code !== shellProfile.userCode,
        ),
      ),
    [shellProfile?.userCode, users],
  );

  const stateFilteredUsers = useMemo(
    () =>
      filter === "ALL"
        ? governableUsers
        : governableUsers.filter((user) => user.state === filter),
    [filter, governableUsers],
  );

  const filteredUsers = useMemo(
    () =>
      applyQuickFilter(stateFilteredUsers, searchQuery, [
        "user_code",
        "name",
        "parent_company_name",
        "designation_hint",
        "auth_user_id",
        "role_code",
        "state",
      ]),
    [searchQuery, stateFilteredUsers],
  );
  const firstScopedUser = useMemo(
    () => filteredUsers.find((user) => canOpenScope(user)) ?? null,
    [filteredUsers],
  );

  function handleOpenScope(user) {
    if (!user?.auth_user_id) {
      return;
    }

    openScreen("SA_USER_SCOPE");
    navigate(`/sa/users/scope?auth_user_id=${encodeURIComponent(user.auth_user_id)}`);
  }

  const activeCount = governableUsers.filter((user) => user.state === "ACTIVE").length;
  const disabledCount = governableUsers.filter((user) => user.state === "DISABLED").length;
  const missingRoleCount = governableUsers.filter((user) => !user.role_code).length;
  const privilegedCount = governableUsers.filter((user) =>
    user.role_code === "SA" || user.role_code === "GA"
  ).length;

  useErpScreenCommands([
    {
      id: "sa-users-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing user directory..." : "Refresh user directory",
      keywords: ["refresh", "users", "directory"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-users-focus-search",
      group: "Current Screen",
      label: "Focus user search",
      keywords: ["search", "filter", "users"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-users-open-roles",
      group: "Current Screen",
      label: "Open role assignment",
      keywords: ["roles", "role assignment"],
      perform: () => openScreen("SA_USER_ROLES"),
      order: 30,
    },
    {
      id: "sa-users-open-signups",
      group: "Current Screen",
      label: "Open signup requests",
      keywords: ["signup", "requests", "onboarding"],
      perform: () => openScreen("SA_SIGNUP_REQUESTS"),
      order: 40,
    },
    {
      id: "sa-users-open-scope",
      group: "Current Screen",
      label: firstScopedUser
        ? `Open scope for ${firstScopedUser.user_code ?? formatIdentityName(firstScopedUser)}`
        : "Open scope for first visible ACL user",
      keywords: ["scope", "mapping", "user scope"],
      disabled: !firstScopedUser,
      perform: () => {
        if (firstScopedUser) {
          handleOpenScope(firstScopedUser);
        }
      },
      order: 50,
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
                SA User Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP User Directory
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review governable ERP users, inspect current role posture, and
                activate or disable access from the Super Admin control plane.
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
                onClick={() => openScreen("SA_SIGNUP_REQUESTS")}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 1,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Signup Queue
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[2] = element;
                }}
                type="button"
                onClick={() => openScreen("SA_USER_ROLES")}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 2,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Role Assignment
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[3] = element;
                }}
                type="button"
                onClick={() => {
                  openScreen("SA_USER_SCOPE");
                  navigate("/sa/users/scope");
                }}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 3,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Scope Mapping
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[4] = element;
                }}
                type="button"
                onClick={() => void handleRefresh()}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 4,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 shadow-[0_10px_24px_rgba(14,116,144,0.08)]"
              >
                {loading ? "Refreshing..." : "Refresh Users"}
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
            label="All Users"
            value={loading ? "..." : String(governableUsers.length)}
            tone="sky"
            caption="Governable ERP users currently visible in the directory. The current operator is excluded."
          />
          <SummaryCard
            label="Active"
            value={loading ? "..." : String(activeCount)}
            tone="emerald"
            caption="Users whose ERP access is currently enabled."
          />
          <SummaryCard
            label="Disabled"
            value={loading ? "..." : String(disabledCount)}
            tone="rose"
            caption="Users whose ERP access has been suspended."
          />
          <SummaryCard
            label="Privileged"
            value={loading ? "..." : String(privilegedCount)}
            tone="amber"
            caption="Users presently carrying SA or GA posture in the ERP role ladder."
          />
        </div>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Contract Status
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Role Visibility Is Now Part of the User Inventory Payload
              </h2>
            </div>
            <span className="rounded-full bg-sky-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              {loading ? "Checking" : `${missingRoleCount} Missing Role`}
            </span>
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-600">
            This screen now reads current role posture directly from the admin
            users endpoint. Dedicated role assignment is now available through
            the linked role panel, and the user-scope surface now opens only
            for ACL users whose role posture is already assigned. The current
            operator is excluded so SA cannot disable themselves by mistake.
          </p>
        </section>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                User Filter
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Governable User Inventory
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((option, index) => (
                <button
                  key={option.key}
                  ref={(element) => {
                    filterRefs.current[index] = element;
                  }}
                  data-workspace-primary-focus={index === 0 ? "true" : undefined}
                  type="button"
                  onClick={() => setFilter(option.key)}
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: filterRefs.current,
                      orientation: "horizontal",
                    })
                  }
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                    filter === option.key
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <QuickFilterInput
            inputRef={searchInputRef}
            className="mt-5"
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by user code, name, company, designation, auth, role, or state"
            hint="Type to filter the governable user inventory instantly."
          />

          {loading ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Loading ERP users from the admin governance endpoint.
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              No ERP users match the current governance filter.
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-3">
                <thead>
                  <tr>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      User
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Role
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      State
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Created
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user, rowIndex) => {
                    const actionLabel =
                      user.state === "ACTIVE" ? "Disable" : "Activate";
                    const nextState =
                      user.state === "ACTIVE" ? "DISABLED" : "ACTIVE";
                    const isUpdating = updatingUserId === user.auth_user_id;
                    const scopeEnabled = canOpenScope(user);

                    return (
                      <tr
                        key={user.auth_user_id}
                        className="bg-slate-50 align-top"
                      >
                        <td className="rounded-none px-4 py-4 text-sm text-slate-700 first:rounded-l-2xl">
                          <div className="font-semibold text-slate-900">
                            {user.user_code ?? "Uncoded User"}{" "}
                            <span className="text-slate-600">
                              {formatIdentityName(user)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                            {user.parent_company_name ?? "Company Not Captured"}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                            {user.designation_hint ?? "Designation Not Captured"}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                            Auth {shortId(user.auth_user_id)}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getRoleTone(user.role_code)}`}
                            >
                              {user.role_code ?? "UNASSIGNED"}
                            </span>
                            {typeof user.role_rank === "number" ? (
                              <span className="text-xs text-slate-500">
                                Rank {user.role_rank}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStateTone(user.state)}`}
                          >
                            {user.state ?? "UNKNOWN"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          {formatDateTime(user.created_at)}
                        </td>
                        <td className="rounded-none px-4 py-4 text-sm text-slate-700 last:rounded-r-2xl">
                          <div className="flex flex-wrap gap-2">
                            {scopeEnabled ? (
                              <button
                                ref={(element) => {
                                  rowActionRefs.current[rowIndex] ??= [];
                                  rowActionRefs.current[rowIndex][0] = element;
                                }}
                                type="button"
                                onClick={() => handleOpenScope(user)}
                                onKeyDown={(event) =>
                                  handleGridNavigation(event, {
                                    rowIndex,
                                    columnIndex: 0,
                                    gridRefs: rowActionRefs.current,
                                  })
                                }
                                className="rounded-2xl bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700"
                              >
                                Scope
                              </button>
                            ) : (
                              <span className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                ACL First
                              </span>
                            )}
                            <button
                              ref={(element) => {
                                rowActionRefs.current[rowIndex] ??= [];
                                rowActionRefs.current[rowIndex][1] = element;
                              }}
                              type="button"
                              disabled={isUpdating}
                              onClick={() => void handleStateChange(user, nextState)}
                              onKeyDown={(event) =>
                                handleGridNavigation(event, {
                                  rowIndex,
                                  columnIndex: 1,
                                  gridRefs: rowActionRefs.current,
                                })
                              }
                              className={`rounded-2xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                                user.state === "ACTIVE"
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-emerald-50 text-emerald-700"
                              } ${isUpdating ? "cursor-not-allowed opacity-60" : ""}`}
                            >
                              {isUpdating ? "Updating..." : actionLabel}
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
