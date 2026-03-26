/*
 * File-ID: 9.6A-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAUserRoles.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin role assignment surface for ERP user role governance
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";

const ROLE_OPTIONS = Object.freeze([
  { code: "SA", label: "Super Admin", rank: 999 },
  { code: "GA", label: "Global Admin", rank: 888 },
  { code: "DIRECTOR", label: "Director", rank: 100 },
  { code: "L3_MANAGER", label: "L3 Manager", rank: 90 },
  { code: "L2_AUDITOR", label: "L2 Auditor", rank: 80 },
  { code: "L1_AUDITOR", label: "L1 Auditor", rank: 70 },
  { code: "L2_MANAGER", label: "L2 Manager", rank: 60 },
  { code: "L1_MANAGER", label: "L1 Manager", rank: 50 },
  { code: "L4_USER", label: "L4 User", rank: 40 },
  { code: "L3_USER", label: "L3 User", rank: 30 },
  { code: "L2_USER", label: "L2 User", rank: 20 },
  { code: "L1_USER", label: "L1 User", rank: 10 },
]);

const ROLE_LABELS = Object.freeze(
  Object.fromEntries(ROLE_OPTIONS.map((role) => [role.code, role.label]))
);

const ROLE_RANKS = Object.freeze(
  Object.fromEntries(ROLE_OPTIONS.map((role) => [role.code, role.rank]))
);

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
  const [users, setUsers] = useState([]);
  const [draftRoles, setDraftRoles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [updatingUserId, setUpdatingUserId] = useState("");

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

    const approved = globalThis.confirm(
      `Apply role ${ROLE_LABELS[nextRole] ?? nextRole} to ${user.user_code ?? shortId(user.auth_user_id)} now?`
    );

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
        refreshedTarget?.role_rank !== (ROLE_RANKS[nextRole] ?? null)
      ) {
        throw new Error("USER_ROLE_NOT_FINALIZED");
      }
    } catch {
      setError("User role change was not finalized by the backend.");
    } finally {
      setUpdatingUserId("");
    }
  }

  const filteredUsers =
    roleFilter === "ALL"
      ? users
      : roleFilter === "UNASSIGNED"
        ? users.filter((user) => !user.role_code)
        : users.filter((user) => user.role_code === roleFilter);

  const privilegedCount = users.filter((user) =>
    user.role_code === "SA" || user.role_code === "GA"
  ).length;
  const assignedCount = users.filter((user) => user.role_code).length;
  const unassignedCount = users.filter((user) => !user.role_code).length;
  const managerCount = users.filter((user) =>
    ["L3_MANAGER", "L2_MANAGER", "L1_MANAGER"].includes(user.role_code)
  ).length;

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Role Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP User Role Assignment
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review current role posture, assign the canonical ERP role
                ladder, and update user authority from the Super Admin control
                plane.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openScreen("SA_USERS")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                User Directory
              </button>
              <button
                type="button"
                onClick={() => openScreen("SA_SIGNUP_REQUESTS")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Signup Queue
              </button>
              <button
                type="button"
                onClick={() => void handleRefresh()}
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
            value={loading ? "..." : String(users.length)}
            tone="sky"
            caption="Users currently visible for ERP role assignment governance."
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
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRoleFilter("ALL")}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                roleFilter === "ALL"
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              All Roles
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter("UNASSIGNED")}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                roleFilter === "UNASSIGNED"
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              Unassigned
            </button>
            {["SA", "GA", "DIRECTOR", "L1_USER"].map((roleCode) => (
              <button
                key={roleCode}
                type="button"
                onClick={() => setRoleFilter(roleCode)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                  roleFilter === roleCode
                    ? "bg-sky-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {roleCode}
              </button>
            ))}
          </div>
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
                      User
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
                  {filteredUsers.map((user) => {
                    const isUpdating = updatingUserId === user.auth_user_id;
                    const selectedRole = draftRoles[user.auth_user_id] ?? "";

                    return (
                      <tr
                        key={user.auth_user_id}
                        className="bg-slate-50 align-top"
                      >
                        <td className="rounded-none px-4 py-4 text-sm text-slate-700 first:rounded-l-2xl">
                          <div className="font-semibold text-slate-900">
                            {user.user_code ?? "Uncoded User"}
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
                            value={selectedRole}
                            onChange={(event) =>
                              setDraftRoles((current) => ({
                                ...current,
                                [user.auth_user_id]: event.target.value,
                              }))
                            }
                            className="min-w-[190px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                          >
                            <option value="">Select role</option>
                            {ROLE_OPTIONS.map((role) => (
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
                            type="button"
                            disabled={
                              isUpdating ||
                              !selectedRole ||
                              selectedRole === user.role_code
                            }
                            onClick={() => void handleApplyRole(user)}
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
