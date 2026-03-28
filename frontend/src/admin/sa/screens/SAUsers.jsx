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
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
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
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "DISABLED":
      return "border-rose-300 bg-rose-50 text-rose-700";
    default:
      return "border-slate-300 bg-slate-100 text-slate-700";
  }
}

function getRoleTone(roleCode) {
  switch (roleCode) {
    case "SA":
      return "border-cyan-300 bg-cyan-50 text-cyan-700";
    case "GA":
      return "border-indigo-300 bg-indigo-50 text-indigo-700";
    case "DIRECTOR":
      return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700";
    case "L3_MANAGER":
    case "L2_MANAGER":
    case "L1_MANAGER":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "L2_AUDITOR":
    case "L1_AUDITOR":
      return "border-sky-300 bg-sky-50 text-sky-700";
    case "L4_USER":
    case "L3_USER":
    case "L2_USER":
    case "L1_USER":
      return "border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border-rose-300 bg-rose-50 text-rose-700";
  }
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
            !shellProfile?.userCode || user.user_code !== shellProfile.userCode
        )
      ),
    [shellProfile?.userCode, users]
  );

  const stateFilteredUsers = useMemo(
    () =>
      filter === "ALL"
        ? governableUsers
        : governableUsers.filter((user) => user.state === filter),
    [filter, governableUsers]
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
    [searchQuery, stateFilteredUsers]
  );

  const firstScopedUser = useMemo(
    () => filteredUsers.find((user) => canOpenScope(user)) ?? null,
    [filteredUsers]
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
  const privilegedCount = governableUsers.filter(
    (user) => user.role_code === "SA" || user.role_code === "GA"
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
      key: "role-assignment",
      label: "Role Assignment",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => openScreen("SA_USER_ROLES"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "scope-mapping",
      label: "Scope Mapping",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[3] = element;
      },
      onClick: () => {
        openScreen("SA_USER_SCOPE");
        navigate("/sa/users/scope");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 3,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh-users",
      label: loading ? "Refreshing..." : "Refresh Users",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionBarRefs.current[4] = element;
      },
      onClick: () => void handleRefresh(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 4,
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
        "Governable ERP users currently visible in the directory. The current operator is excluded.",
    },
    {
      key: "active-users",
      label: "Active",
      value: loading ? "..." : String(activeCount),
      tone: "emerald",
      caption: "Users whose ERP access is currently enabled.",
    },
    {
      key: "disabled-users",
      label: "Disabled",
      value: loading ? "..." : String(disabledCount),
      tone: "rose",
      caption: "Users whose ERP access has been suspended.",
    },
    {
      key: "privileged-users",
      label: "Privileged",
      value: loading ? "..." : String(privilegedCount),
      tone: "amber",
      caption: "Users presently carrying SA or GA posture in the ERP role ladder.",
    },
  ];

  const summarySection = {
    eyebrow: "Contract Status",
    title: "Role Visibility Is Now Part of the User Inventory Payload",
    description:
      "This screen now reads current role posture directly from the admin users endpoint. Dedicated role assignment is available through the linked role panel, and the user-scope surface opens only for ACL users whose role posture is already assigned. The current operator is excluded so SA cannot disable themselves by mistake.",
    aside: (
      <span className="border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">
        {loading ? "Checking" : `${missingRoleCount} Missing Role`}
      </span>
    ),
  };

  const filterSection = {
    eyebrow: "User Filter",
    title: "Governable User Inventory",
    aside: (
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
            className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              filter === option.key
                ? "border-sky-400 bg-sky-50 text-sky-900"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by user code, name, company, designation, auth, role, or state"
        hint="Type to filter the governable user inventory instantly. Alt+Shift+F jumps here from anywhere in the screen."
      />
    ),
  };

  const listSection = {
    eyebrow: "Directory List",
    title: loading
      ? "Refreshing governable users"
      : `${filteredUsers.length} visible user${filteredUsers.length === 1 ? "" : "s"} in the current filter`,
    children: loading ? (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        Loading ERP users from the admin governance endpoint.
      </div>
    ) : filteredUsers.length === 0 ? (
      <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        No ERP users match the current governance filter.
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                User
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Role
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                State
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Created
              </th>
              <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
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
                <tr key={user.auth_user_id} className="border-b border-slate-200 bg-white align-top">
                  <td className="px-3 py-3 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">
                      {user.user_code ?? "Uncoded User"}{" "}
                      <span className="text-slate-600">
                        {formatIdentityName(user)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {user.parent_company_name ?? "Company Not Captured"}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {user.designation_hint ?? "Designation Not Captured"}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
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
                        <span className="text-[10px] text-slate-500">
                          Rank {user.role_rank}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700">
                    <span
                      className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getStateTone(user.state)}`}
                    >
                      {user.state ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700">
                    {formatDateTime(user.created_at)}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700">
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
                          className="border border-cyan-300 bg-cyan-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700"
                        >
                          Scope
                        </button>
                      ) : (
                        <span className="border border-slate-300 bg-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
                        className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          user.state === "ACTIVE"
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700"
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
    ),
  };

  return (
    <ErpMasterListTemplate
      eyebrow="SA User Governance"
      title="ERP User Directory"
      description="This keyboard-native list screen keeps search, filter, row actions, and related governance jumps in one structured operating surface."
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
