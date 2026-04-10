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
import ErpCompactFilterSelect from "../../../components/inputs/ErpCompactFilterSelect.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import { applyQuickFilter, sortUsers } from "../../../shared/erpCollections.js";
import {
  ERP_ROLE_LABELS,
  ERP_ROLE_OPTIONS,
  ERP_ROLE_RANKS,
} from "../../../shared/erpRoles.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";

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
    case "L4_MANAGER":
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
            !shellProfile?.userCode || user.user_code !== shellProfile.userCode
        )
      ),
    [shellProfile?.userCode, users]
  );

  const roleFilteredUsers = useMemo(
    () =>
      roleFilter === "ALL"
        ? governableUsers
        : roleFilter === "UNASSIGNED"
          ? governableUsers.filter((user) => !user.role_code)
          : governableUsers.filter((user) => user.role_code === roleFilter),
    [governableUsers, roleFilter]
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
    [roleFilteredUsers, searchQuery]
  );

  const assignedCount = governableUsers.filter((user) => user.role_code).length;
  const unassignedCount = governableUsers.filter((user) => !user.role_code).length;
  const managerCount = governableUsers.filter((user) =>
    ["L4_MANAGER", "L3_MANAGER", "L2_MANAGER", "L1_MANAGER"].includes(user.role_code)
  ).length;
  const rolePagination = useErpPagination(filteredUsers, 10);

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
    {
      id: "sa-user-roles-open-role-permissions",
      group: "Current Screen",
      label: "Open role permissions",
      keywords: ["acl", "role permissions", "permission matrix"],
      perform: () => openScreen("SA_ROLE_PERMISSIONS"),
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
    focusPrimary: {
      perform: () => filterRefs.current[0]?.focus(),
    },
  });

  const topActions = [
    {
      key: "user-directory",
      label: "User Directory",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => openScreen("SA_USERS"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "signup-queue",
      label: "Signup Queue",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => openScreen("SA_SIGNUP_REQUESTS"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh-roles",
      label: loading ? "Refreshing..." : "Refresh Roles",
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
    {
      key: "role-permissions",
      label: "ACL Permissions",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[3] = element;
      },
      onClick: () => openScreen("SA_ROLE_PERMISSIONS"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 3,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const metrics = [
    {
      key: "all-users",
      label: "All Users",
      value: loading ? "..." : String(governableUsers.length),
      tone: "sky",
      caption:
        "Governable users visible for role assignment. The current operator is excluded.",
    },
    {
      key: "assigned-users",
      label: "Assigned",
      value: loading ? "..." : String(assignedCount),
      tone: "emerald",
      caption: "Users that currently have a canonical ERP role assignment.",
    },
    {
      key: "unassigned-users",
      label: "Unassigned",
      value: loading ? "..." : String(unassignedCount),
      tone: "rose",
      caption:
        "Users missing an explicit role row and needing assignment attention.",
    },
    {
      key: "manager-users",
      label: "Managers",
      value: loading ? "..." : String(managerCount),
      tone: "amber",
      caption: "Users currently placed in the manager tier of the role ladder.",
    },
  ];

  const roleFilterOptions = useMemo(
    () => [
      { key: "ALL", label: "All Roles" },
      { key: "UNASSIGNED", label: "Unassigned" },
      ...ERP_ROLE_OPTIONS.map((role) => ({
        key: role.code,
        label: role.label,
      })),
    ],
    []
  );

  const filterSection = {
    eyebrow: "Role Filters",
    title: "Role Assignment Control Rail",
    aside: (
      <ErpCompactFilterSelect
        label="Role View"
        value={roleFilter}
        options={roleFilterOptions}
        onChange={setRoleFilter}
        selectRef={(element) => {
          filterRefs.current[0] = element;
        }}
        primaryFocus={true}
        helperText="One compact selector replaces the long role tab rail so keyboard focus reaches the list faster."
      />
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by user code, name, company, designation, auth, role, or state"
        hint="Visible quick filter for dense role governance. Alt+Shift+F jumps here, Alt+Shift+P returns to the role filter selector."
      />
    ),
  };

  const listSection = {
    eyebrow: "Role Panel",
    title: loading
      ? "Refreshing role assignment workspace"
      : `${filteredUsers.length} visible user${filteredUsers.length === 1 ? "" : "s"} in the current role filter`,
    children: loading ? (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        Loading ERP users for role governance.
      </div>
    ) : filteredUsers.length === 0 ? (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        No ERP users match the current role governance filter.
      </div>
    ) : (
      <div className="overflow-x-auto">
        <ErpPaginationStrip
          page={rolePagination.page}
          setPage={rolePagination.setPage}
          totalPages={rolePagination.totalPages}
          startIndex={rolePagination.startIndex}
          endIndex={rolePagination.endIndex}
          totalItems={filteredUsers.length}
        />
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                User Identity
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Current Role
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Next Role
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                State
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rolePagination.pageItems.map((user, index) => {
              const isUpdating = updatingUserId === user.auth_user_id;
              const selectedRole = draftRoles[user.auth_user_id] ?? "";

              return (
                <tr
                  key={user.auth_user_id}
                  className="border-b border-slate-200 bg-white align-top"
                >
                  <td className="px-3 py-3 text-sm text-slate-700">
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
                  <td className="px-3 py-3 text-sm text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getRoleTone(user.role_code)}`}
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
                  <td className="px-3 py-3 text-sm text-slate-700">
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
                      className="min-w-[190px] border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-700 outline-none"
                    >
                      <option value="">Select role</option>
                      {ERP_ROLE_OPTIONS.map((role) => (
                        <option key={role.code} value={role.code}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700">
                    <span
                      className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getStateTone(user.state)}`}
                    >
                      {user.state ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700">
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
                      className={`border border-sky-300 bg-sky-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 ${
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
    ),
  };

  return (
    <ErpMasterListTemplate
      eyebrow="SA Role Governance"
      title="ERP User Role Assignment"
      description="This keyboard-native list keeps role filters, quick search, and inline role application in one structured operating surface."
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
      filterSection={filterSection}
      listSection={listSection}
    />
  );
}
