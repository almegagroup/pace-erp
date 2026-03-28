/*
 * File-ID: 9.17B
 * File-Path: frontend/src/admin/sa/screens/SAControlPanel.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin command center surface consuming admin diagnostics endpoints
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import {
  handleGridNavigation,
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
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

function formatSystemVersion(value) {
  if (!value) return "N/A";

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const system = typeof value.system === "string" ? value.system : "PACE-ERP";
    const version = typeof value.version === "string" ? value.version : "N/A";
    const buildGate =
      typeof value.build_gate === "string" ? value.build_gate : null;

    return buildGate
      ? `${system} ${version} (${buildGate})`
      : `${system} ${version}`;
  }

  return String(value);
}

function LaunchCard({
  badge,
  title,
  description,
  onClick,
  buttonRef,
  onKeyDown,
  primaryFocus,
}) {
  return (
    <button
      ref={buttonRef}
      data-workspace-primary-focus={primaryFocus ? "true" : undefined}
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-[0_12px_34px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_18px_42px_rgba(14,116,144,0.12)]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-full bg-sky-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
          {badge}
        </span>
        <span className="text-slate-300 transition group-hover:text-sky-600">
          {"->"}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </button>
  );
}

function DataTableCard({ eyebrow, title, rows, columns, emptyMessage, footer }) {
  const rowRefs = useRef([]);

  return (
    <ErpSectionCard eyebrow={eyebrow} title={title}>
      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-3">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id ?? `${title}-${index}`}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  tabIndex={0}
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: rowRefs.current,
                      orientation: "vertical",
                    })
                  }
                  className="bg-slate-50"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="rounded-none px-4 py-3 text-sm text-slate-700 first:rounded-l-2xl last:rounded-r-2xl"
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer ? <div className="mt-4 text-sm text-slate-500">{footer}</div> : null}
    </ErpSectionCard>
  );
}

export default function SAControlPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [controlPanel, setControlPanel] = useState(null);
  const [health, setHealth] = useState(null);
  const topActionRefs = useRef([]);
  const quickLaunchRefs = useRef([]);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const [controlPanelResponse, healthResponse] = await Promise.all([
        fetch(`${import.meta.env.VITE_API_BASE}/api/admin/control-panel`, {
          credentials: "include",
        }),
        fetch(`${import.meta.env.VITE_API_BASE}/api/admin/system-health`, {
          credentials: "include",
        }),
      ]);

      const [controlPanelJson, healthJson] = await Promise.all([
        readJsonSafe(controlPanelResponse),
        readJsonSafe(healthResponse),
      ]);

      if (!controlPanelResponse.ok || !controlPanelJson?.ok) {
        throw new Error("CONTROL_PANEL_READ_FAILED");
      }

      setControlPanel(controlPanelJson.data ?? null);
      setHealth(healthJson?.ok ? healthJson.data ?? null : null);
    } catch {
      setError("Unable to load the SA control panel right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void handleRefresh();
  }, []);

  const recentSessions = controlPanel?.recent_sessions ?? [];
  const recentAudit = controlPanel?.recent_audit ?? [];

  const statusAlerts = [
    health?.db_status === "DOWN"
      ? {
          key: "db-down",
          message:
            "Database attention required. The ERP database health probe is failing, so SA should investigate before provisioning new activity.",
          tone: "error",
        }
      : null,
    health?.acl_snapshot_status === "UNAVAILABLE"
      ? {
          key: "acl-unavailable",
          message:
            "ACL snapshot is unavailable. Permission projection is not reporting ready state.",
          tone: "info",
        }
      : null,
    health?.menu_snapshot_status === "UNAVAILABLE"
      ? {
          key: "menu-unavailable",
          message:
            "Menu snapshot is unavailable. Admin navigation integrity may be at risk.",
          tone: "info",
        }
      : null,
    !loading && recentSessions.length === 0
      ? {
          key: "no-sessions",
          message:
            "No active session preview returned in the current payload. Session governance should be reviewed.",
          tone: "neutral",
        }
      : null,
  ].filter(Boolean);

  const quickLaunch = [
    {
      badge: "Health",
      title: "System Health",
      description:
        "Open diagnostics to review database availability, ACL snapshot readiness, and menu snapshot readiness.",
      onClick: () => openScreen("SA_SYSTEM_HEALTH"),
    },
    {
      badge: "Trace",
      title: "Audit Viewer",
      description:
        "Inspect recent administrative actions and review which governance operations succeeded or failed.",
      onClick: () => openScreen("SA_AUDIT"),
    },
    {
      badge: "Secure",
      title: "Session Control",
      description:
        "Review the full ERP session inventory and revoke active access when governance requires it.",
      onClick: () => openScreen("SA_SESSIONS"),
    },
    {
      badge: "Approve",
      title: "Signup Requests",
      description:
        "Review incoming onboarding requests and move approved users into the ERP lifecycle.",
      onClick: () => openScreen("SA_SIGNUP_REQUESTS"),
    },
    {
      badge: "Provision",
      title: "Create Company",
      description:
        "Start a fresh company setup flow and extend the organizational structure from SA control.",
      onClick: () => openScreen("SA_COMPANY_CREATE"),
    },
    {
      badge: "Master",
      title: "Project Master",
      description:
        "Create and review project masters directly inside the keyboard-native org-governance wave.",
      onClick: () => openScreen("SA_PROJECT_MASTER"),
    },
    {
      badge: "ACL",
      title: "Role Permissions",
      description:
        "Review and update role-resource VWED permission rows from the ACL governance surface.",
      onClick: () => openScreen("SA_ROLE_PERMISSIONS"),
    },
    {
      badge: "Route",
      title: "Approval Rules",
      description:
        "Maintain approver routing stages, exact scope, and target identity without leaving the control plane.",
      onClick: () => openScreen("SA_APPROVAL_RULES"),
    },
    {
      badge: "Module",
      title: "Company Modules",
      description:
        "Enable or disable module exposure for a governed company through the ACL company-module map.",
      onClick: () => openScreen("SA_COMPANY_MODULE_MAP"),
    },
    {
      badge: "Govern",
      title: "User Control",
      description:
        "Open user governance to review user posture, lifecycle state, and operational readiness.",
      onClick: () => openScreen("SA_USERS"),
    },
    {
      badge: "Anchor",
      title: "Back To SA Home",
      description:
        "Return to the Super Admin dashboard entry shell and main command overview.",
      onClick: () => openScreen("SA_HOME", { mode: "reset" }),
    },
  ];

  useErpScreenCommands([
    {
      id: "sa-control-panel-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing control panel..." : "Refresh control panel",
      keywords: ["refresh", "control panel", "diagnostics", "health"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-control-panel-focus-launch",
      group: "Current Screen",
      label: "Focus quick launch grid",
      keywords: ["focus", "quick launch", "actions"],
      perform: () => quickLaunchRefs.current[0]?.[0]?.focus?.(),
      order: 20,
    },
    ...quickLaunch.map((action, index) => ({
      id: `sa-control-panel-${action.title.toLowerCase().replaceAll(" ", "-")}`,
      group: "Current Screen",
      label: `Open ${action.title}`,
      keywords: [action.badge, action.title, action.description],
      perform: action.onClick,
      order: 30 + index,
    })),
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
    },
    focusPrimary: {
      perform: () => quickLaunchRefs.current[0]?.[0]?.focus?.(),
    },
  });

  const topActions = [
    {
      key: "refresh-control-panel",
      label: loading ? "Refreshing..." : "Refresh Panel",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        topActionRefs.current[0] = element;
      },
      onClick: () => void handleRefresh(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "sa-home",
      label: "SA Home",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[1] = element;
      },
      onClick: () => openScreen("SA_HOME", { mode: "reset" }),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const metrics = [
    {
      key: "database",
      label: "Database",
      value: loading ? "..." : health?.db_status ?? controlPanel?.db_status ?? "N/A",
      tone: health?.db_status === "DOWN" ? "rose" : "emerald",
      caption: "Live database probe from the admin diagnostics layer.",
    },
    {
      key: "mapped-users",
      label: "Mapped Users",
      value: loading ? "..." : String(controlPanel?.user_count ?? 0),
      tone: "sky",
      caption:
        "Current user-company role mappings visible to the admin control plane.",
    },
    {
      key: "recent-sessions",
      label: "Recent Active Sessions",
      value: loading ? "..." : String(recentSessions.length),
      tone: "amber",
      caption:
        "Preview count from the current active-session diagnostics payload.",
    },
    {
      key: "recent-audit",
      label: "Recent Admin Activity",
      value: loading ? "..." : String(recentAudit.length),
      tone: "slate",
      caption:
        "Most recent admin control-plane audit entries returned by backend.",
    },
  ];

  const notices = [
    ...(error
      ? [
          {
            key: "error",
            tone: "error",
            message: error,
          },
        ]
      : []),
    ...statusAlerts,
  ];

  const launchSummary = useMemo(
    () => [
      "Project master keyboard-native manage screen live",
      "User lifecycle and scope governance live",
      "Company module enablement keyboard surface live",
      "ACL role permission governance live",
      "Workflow and approval rule governance live",
    ],
    []
  );

  return (
    <ErpScreenScaffold
      eyebrow="SA Command Center"
      title="ERP Control Panel"
      description="Use this screen to assess ERP health, review recent activity, and launch the next SA governance surface without leaving the control plane."
      actions={topActions}
      notices={notices}
      metrics={metrics}
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <DataTableCard
          eyebrow="Live Preview"
          title="Recent Sessions"
          rows={recentSessions.map((session) => ({
            id: session.session_id,
            ...session,
          }))}
          columns={[
            {
              key: "session",
              label: "Session",
              render: (row) => (
                <div>
                  <p className="font-medium text-slate-900">{shortId(row.session_id)}</p>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {row.status}
                  </p>
                </div>
              ),
            },
            {
              key: "user",
              label: "Auth User",
              render: (row) => shortId(row.auth_user_id),
            },
            {
              key: "created",
              label: "Created",
              render: (row) => formatDateTime(row.created_at),
            },
            {
              key: "seen",
              label: "Last Seen",
              render: (row) => formatDateTime(row.last_seen_at),
            },
          ]}
          emptyMessage="No recent active sessions are available in the current preview payload."
          footer="Full session governance screen is now available from this same control rail."
        />

        <div className="grid gap-6">
          <DataTableCard
            eyebrow="Admin Trail"
            title="Recent Audit"
            rows={recentAudit.map((audit) => ({
              id: audit.audit_id,
              ...audit,
            }))}
            columns={[
              {
                key: "action",
                label: "Action",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-900">{row.action_code ?? "N/A"}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {row.status ?? "UNKNOWN"}
                    </p>
                  </div>
                ),
              },
              {
                key: "actor",
                label: "Actor",
                render: (row) => shortId(row.admin_user_id),
              },
              {
                key: "when",
                label: "Performed",
                render: (row) => formatDateTime(row.performed_at),
              },
            ]}
            emptyMessage="No recent admin audit entries are available in the current preview payload."
            footer="Dedicated audit viewer provides broader filtering and trace depth."
          />

          <ErpSectionCard
            eyebrow="Snapshot Readiness"
            title="Access Projection Status"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl bg-slate-50 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  ACL Snapshot
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {loading ? "..." : health?.acl_snapshot_status ?? "N/A"}
                </p>
              </div>
              <div className="rounded-3xl bg-slate-50 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Menu Snapshot
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {loading ? "..." : health?.menu_snapshot_status ?? "N/A"}
                </p>
              </div>
            </div>
          </ErpSectionCard>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ErpSectionCard
          eyebrow="Quick Launch"
          title="Open the next SA workspace"
          description="The launch grid is now the primary working target for keyboard-first control-plane movement."
        >
          <div className="grid gap-4 md:grid-cols-2">
            {quickLaunch.map((action, index) => (
              <LaunchCard
                key={action.title}
                {...action}
                buttonRef={(element) => {
                  const rowIndex = Math.floor(index / 2);
                  const columnIndex = index % 2;
                  quickLaunchRefs.current[rowIndex] ??= [];
                  quickLaunchRefs.current[rowIndex][columnIndex] = element;
                }}
                primaryFocus={index === 0}
                onKeyDown={(event) =>
                  handleGridNavigation(event, {
                    rowIndex: Math.floor(index / 2),
                    columnIndex: index % 2,
                    gridRefs: quickLaunchRefs.current,
                  })
                }
              />
            ))}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Build Program"
          title="Next governance waves"
        >
          <div className="space-y-3">
            {launchSummary.map((item) => (
              <div
                key={item}
                className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3"
              >
                <p className="text-sm font-medium text-slate-700">{item}</p>
                <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Live
                </span>
              </div>
            ))}
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
