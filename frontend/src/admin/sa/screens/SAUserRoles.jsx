/*
 * File-ID: 9.6A-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAUserRoles.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin role assignment surface for ERP user role governance
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import {
  handleGridNavigation,
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import { useMenu } from "../../../context/useMenu.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { applyQuickFilter, sortUsers } from "../../../shared/erpCollections.js";
import {
  ERP_ROLE_FILTERS,
  ERP_ROLE_LABELS,
  ERP_ROLE_OPTIONS,
  ERP_ROLE_RANKS,
} from "../../../shared/erpRoles.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

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
    throw new Error("USER_ROLE_LIST_READ_FAILED");
  }

  return json.data;
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

function shortId(value) {
  if (!value) return "N/A";
  return String(value).slice(0, 8);
}

function formatIdentityName(user) {
  return user.name ?? "Unknown User";
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

export default function SAUserRoles() {
  const { shellProfile } = useMenu();
  const [users, setUsers] = useState([]);
  const [draftRoles, setDraftRoles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState("");
  const actionBarRefs = useRef([]);
  const filterRefs = useRef([]);
  const rowControlRefs = useRef([]);
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
        setDraftRoles(
          Object.fromEntries(
            data.map((user) => [user.auth_user_id, user.role_code ?? ""])
          )
        );
      } catch {
        if (!alive) return;
        setError("Unable to load ERP user roles right now.");
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
      setDraftRoles(
        Object.fromEntries(
          data.map((user) => [user.auth_user_id, user.role_code ?? ""])
        )
      );
    } catch {
      setError("Unable to refresh ERP user roles right now.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyRole(user) {
    const nextRole = draftRoles[user.auth_user_id] ?? "";

    if (!user?.auth_user_id || !nextRole) {
      setError("Select a role before applying the assignment.");
      return;
    }

    if (user.role_code === nextRole) {
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA Role Governance",
      title: "Apply ERP Role",
      message: `Apply role ${ERP_ROLE_LABELS[nextRole] ?? nextRole} to ${user.user_code ?? shortId(user.auth_user_id)} ${formatIdentityName(user)} now?`,
      confirmLabel: "Apply Role",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setUpdatingUserId(user.auth_user_id);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/users/role`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target_auth_user_id: user.auth_user_id,
            next_role: nextRole,
          }),
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok || json?.data?.applied !== true) {
        throw new Error("USER_ROLE_UPDATE_FAILED");
      }

      const refreshedUsers = await fetchUsers();
      const refreshedTarget = refreshedUsers.find(
        (row) => row.auth_user_id === user.auth_user_id
      );

      setUsers(refreshedUsers);
      setDraftRoles(
        Object.fromEntries(
          refreshedUsers.map((row) => [row.auth_user_id, row.role_code ?? ""])
        )
      );

      if (
        refreshedTarget?.role_code !== nextRole ||
        refreshedTarget?.role_rank !== (ERP_ROLE_RANKS[nextRole] ?? null)
      ) {
        throw new Error("USER_ROLE_NOT_FINALIZED");
      }
    } catch {
      setError("User role change was not finalized by the backend.");
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

  const roleFilteredUsers = useMemo(
    () =>
      roleFilter === "ALL"
        ? governableUsers
        : roleFilter === "UNASSIGNED"
          ? governableUsers.filter((user) => !user.role_code)
          : governableUsers.filter((user) => user.role_code === roleFilter),
    [governableUsers, roleFilter],
  );

  const filteredUsers = useMemo(
    () =>
      applyQuickFilter(roleFilteredUsers, searchQuery, [
        "user_code",
        "name",
        "parent_company_name",
        "designation_hint",
        "auth_user_id",
        "role_code",
        "state",
      ]),
    [roleFilteredUsers, searchQuery],
  );

  const privilegedCount = governableUsers.filter((user) =>
    user.role_code === "SA" || user.role_code === "GA"
  ).length;
  const assignedCount = governableUsers.filter((user) => user.role_code).length;
  const unassignedCount = governableUsers.filter((user) => !user.role_code).length;
  const managerCount = governableUsers.filter((user) =>
    ["L3_MANAGER", "L2_MANAGER", "L1_MANAGER"].includes(user.role_code)
  ).length;

  useErpScreenCommands([
    {
      id: "sa-user-roles-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing role assignments..." : "Refresh role assignment list",
      keywords: ["refresh", "roles", "role assignment"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-user-roles-focus-search",
      group: "Current Screen",
      label: "Focus role search",
      keywords: ["search", "filter", "roles"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-user-roles-open-users",
      group: "Current Screen",
      label: "Open user directory",
      keywords: ["users", "directory"],
      perform: () => openScreen("SA_USERS"),
      order: 30,
    },
    {
      id: "sa-user-roles-open-signups",
      group: "Current Screen",
      label: "Open signup requests",
      keywords: ["signup", "requests"],
      perform: () => openScreen("SA_SIGNUP_REQUESTS"),
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
                SA Role Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP User Role Assignment
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review ERP identity details, confirm current role posture, and
                assign the canonical role ladder with enough business context
                to identify each user before applying authority changes.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                ref={(element) => {
                  actionBarRefs.current[0] = element;
                }}
                type="button"
                onClick={() => openScreen("SA_USERS")}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 0,
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
                {loading ? "Refreshing..." : "Refresh Roles"}
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
            caption="Governable users visible for role assignment. The current operator is excluded."
          />
          <SummaryCard
            label="Assigned"
            value={loading ? "..." : String(assignedCount)}
            tone="emerald"
            caption="Users that currently have a canonical ERP role assignment."
          />
          <SummaryCard
            label="Unassigned"
            value={loading ? "..." : String(unassignedCount)}
            tone="rose"
            caption="Users missing an explicit role row and needing assignment attention."
          />
          <SummaryCard
            label="Managers"
            value={loading ? "..." : String(managerCount)}
            tone="amber"
            caption="Users currently placed in the manager tier of the role ladder."
          />
        </div>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Role Contract
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Role Assignment Now Supports Both Existing And Missing Role Rows
              </h2>
            </div>
            <span className="rounded-full bg-sky-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              {loading ? "Checking" : `${privilegedCount} Privileged`}
            </span>
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-600">
            This screen reads the shared admin user inventory and writes role
            decisions to the existing admin role endpoint. Backend role updates
            now use upsert semantics so assignment remains robust even if a user
            role row is missing and needs to be created during governance.
            The current operator is intentionally excluded so SA cannot change
            their own role from this workspace.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              ref={(element) => {
                filterRefs.current[0] = element;
              }}
              data-workspace-primary-focus="true"
              type="button"
              onClick={() => setRoleFilter("ALL")}
              onKeyDown={(event) =>
                handleLinearNavigation(event, {
                  index: 0,
                  refs: filterRefs.current,
                  orientation: "horizontal",
                })
              }
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                roleFilter === "ALL"
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              All Roles
            </button>
            <button
              ref={(element) => {
                filterRefs.current[1] = element;
              }}
              type="button"
              onClick={() => setRoleFilter("UNASSIGNED")}
              onKeyDown={(event) =>
                handleLinearNavigation(event, {
                  index: 1,
                  refs: filterRefs.current,
                  orientation: "horizontal",
                })
              }
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                roleFilter === "UNASSIGNED"
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              Unassigned
            </button>
            {ERP_ROLE_FILTERS.map((role, index) => (
              <button
                key={role.key}
                ref={(element) => {
                  filterRefs.current[index + 2] = element;
                }}
                type="button"
                onClick={() => setRoleFilter(role.key)}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: index + 2,
                    refs: filterRefs.current,
                    orientation: "horizontal",
                  })
                }
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                  roleFilter === role.key
                    ? "bg-sky-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {role.label}
              </button>
            ))}
          </div>

          <QuickFilterInput
            inputRef={searchInputRef}
            className="mt-5"
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by user code, name, company, designation, auth, role, or state"
            hint="Visible quick filter for dense role governance."
          />
        </section>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Role Panel
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                User Role Assignment Workspace
              </h2>
            </div>

            <span className="rounded-full bg-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              {loading ? "Loading" : `${filteredUsers.length} Visible`}
            </span>
          </div>

          {loading ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Loading ERP users for role governance.
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              No ERP users match the current role governance filter.
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-3">
                <thead>
                  <tr>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      User Identity
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Current Role
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Next Role
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      State
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user, index) => {
                    const isUpdating = updatingUserId === user.auth_user_id;
                    const selectedRole = draftRoles[user.auth_user_id] ?? "";

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
                          <select
                            ref={(element) => {
                              rowControlRefs.current[index] ??= [];
                              rowControlRefs.current[index][0] = element;
                            }}
                            value={selectedRole}
                            onChange={(event) =>
                              setDraftRoles((current) => ({
                                ...current,
                                [user.auth_user_id]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "ArrowLeft" ||
                                event.key === "ArrowRight" ||
                                event.key === "Home" ||
                                event.key === "End"
                              ) {
                                handleGridNavigation(event, {
                                  rowIndex: index,
                                  columnIndex: 0,
                                  gridRefs: rowControlRefs.current,
                                });
                              }
                            }}
                            className="min-w-[190px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                          >
                            <option value="">Select role</option>
                            {ERP_ROLE_OPTIONS.map((role) => (
                              <option key={role.code} value={role.code}>
                                {role.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStateTone(user.state)}`}
                          >
                            {user.state ?? "UNKNOWN"}
                          </span>
                        </td>
                        <td className="rounded-none px-4 py-4 text-sm text-slate-700 last:rounded-r-2xl">
                          <button
                            ref={(element) => {
                              rowControlRefs.current[index] ??= [];
                              rowControlRefs.current[index][1] = element;
                            }}
                            type="button"
                            disabled={
                              isUpdating ||
                              !selectedRole ||
                              selectedRole === user.role_code
                            }
                            onClick={() => void handleApplyRole(user)}
                            onKeyDown={(event) =>
                              handleGridNavigation(event, {
                                rowIndex: index,
                                columnIndex: 1,
                                gridRefs: rowControlRefs.current,
                              })
                            }
                            className={`rounded-2xl bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 ${
                              isUpdating ||
                              !selectedRole ||
                              selectedRole === user.role_code
                                ? "cursor-not-allowed opacity-60"
                                : ""
                            }`}
                          >
                            {isUpdating ? "Updating..." : "Apply Role"}
                          </button>
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
