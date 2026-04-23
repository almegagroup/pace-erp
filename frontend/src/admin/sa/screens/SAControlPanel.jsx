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
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { openRoute, openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  buildSaMenuSections,
  flattenSaMenuSections,
} from "../saMenuSections.js";

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
      className="grid w-full grid-cols-[96px_minmax(0,1fr)_110px] items-center border border-slate-300 bg-white px-3 py-3 text-left hover:bg-slate-50"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
        {badge}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block truncate text-xs text-slate-500">{description}</span>
      </span>
      <span className="justify-self-end text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Enter Open
      </span>
    </button>
  );
}

function DataTableCard({
  eyebrow,
  title,
  rows,
  columns,
  emptyMessage,
  footer,
  actions,
}) {
  const { getRowProps } = useErpListNavigation(rows);

  return (
    <div className="grid gap-4">
      <div className="border border-slate-300 bg-slate-50 px-4 py-3">
        {eyebrow ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {eyebrow}
          </div>
        ) : null}
        <div className="mt-1 text-base font-semibold text-slate-900">{title}</div>
      </div>
      {rows.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="erp-grid-table min-w-full">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
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
                  {...getRowProps(index)}
                  className="border-b border-slate-200 bg-white"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-3 py-2 text-sm text-slate-700"
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

      {footer || actions ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>{footer}</span>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export default function SAControlPanel() {
  const { menu } = useMenu();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [controlPanel, setControlPanel] = useState(null);
  const [health, setHealth] = useState(null);
  const [detailDrawer, setDetailDrawer] = useState("");
  const topActionRefs = useRef([]);
  const quickLaunchRefs = useRef([]);

  async function handleRefresh({ userInitiated = false } = {}) {
    setLoading(true);
    setError("");

    try {
      const uiMode = userInitiated ? "blocking" : "background";
      const [controlPanelResponse, healthResponse] = await Promise.all([
        fetch(`${import.meta.env.VITE_API_BASE}/api/admin/control-panel`, {
          credentials: "include",
          erpUiMode: uiMode,
          erpUiLabel: "Refreshing control panel",
        }),
        fetch(`${import.meta.env.VITE_API_BASE}/api/admin/system-health`, {
          credentials: "include",
          erpUiMode: uiMode,
          erpUiLabel: "Refreshing control panel",
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
  const sessionPreviewRows = recentSessions.slice(0, 5);
  const auditPreviewRows = recentAudit.slice(0, 5);
  const systemVersion = formatSystemVersion(
    controlPanel?.system_version ?? health?.system_version ?? null
  );

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

  const quickLaunchSections = useMemo(() => {
    const sections = buildSaMenuSections(menu, {
      excludeMenuCodes: ["SA_HOME", "SA_CONTROL_PANEL"],
    });

    const menuSections = sections.map((section) => ({
      ...section,
      pages: section.pages.map((item) => ({
        badge: "Open",
        menuCode: item.menu_code,
        title: item.title,
        description:
          item.description ?? "Open the selected Super Admin governance workspace.",
        onClick: () => openRoute(item.route_path),
      })),
    }));

    return [
      {
        key: "publish-control",
        title: "Publish Control",
        description:
          "System-detected ACL version publish desk. Review company status, then capture and activate the next immutable version from one place.",
        pages: [
          {
            badge: "Publish",
            menuCode: "SA_ACL_VERSION_CENTER",
            title: "ACL Version Center",
            description:
              "Review company-wise publish status and follow system recommendations before runtime users depend on new access changes.",
            onClick: () => openRoute("/sa/acl/version-center"),
          },
        ],
      },
      {
        key: "circulation-reports",
        title: "Circulation Reports",
        description:
          "Flat export surfaces for circulation-ready governance reporting before manual spreadsheet cleanup starts.",
        pages: [
          {
            badge: "Report",
            menuCode: "SA_GOVERNANCE_SUMMARY_REPORT",
            title: "Governance Summary Report",
            description:
              "Download one flat row per company with departments, work contexts, capability packs, inherited projects, modules, and ACL versions aligned together.",
            onClick: () => openRoute("/sa/acl/governance-summary-report"),
          },
          {
            badge: "Report",
            menuCode: "SA_USER_SCOPE_REPORT",
            title: "User Scope Report",
            description:
              "Download one flat row per user assignment with company, role, rank, department, and work-area columns kept separate.",
            onClick: () => openRoute("/sa/users/report"),
          },
        ],
      },
      ...menuSections,
    ];
  }, [menu]);

  const quickLaunch = useMemo(
    () =>
      flattenSaMenuSections(
        quickLaunchSections.map((section) => ({
          ...section,
          pages: section.pages,
        }))
      ),
    [quickLaunchSections]
  );

  const quickLaunchIndexByMenuCode = useMemo(
    () =>
      new Map(
        quickLaunch.map((action, index) => [action.menuCode, index])
      ),
    [quickLaunch]
  );

  useErpScreenCommands([
    {
      id: "sa-control-panel-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing control panel..." : "Refresh control panel",
      keywords: ["refresh", "control panel", "diagnostics", "health"],
      disabled: loading,
      perform: () => void handleRefresh({ userInitiated: true }),
      order: 10,
    },
    {
      id: "sa-control-panel-focus-launch",
      group: "Current Screen",
      label: "Focus quick launch grid",
      keywords: ["focus", "quick launch", "actions"],
      perform: () => quickLaunchRefs.current[0]?.focus?.(),
      order: 20,
    },
    {
      id: "sa-control-panel-open-sessions",
      group: "Current Screen",
      label: "Open recent sessions drawer",
      keywords: ["sessions", "recent sessions", "drawer"],
      disabled: recentSessions.length === 0,
      perform: () => setDetailDrawer("sessions"),
      order: 25,
    },
    {
      id: "sa-control-panel-open-audit",
      group: "Current Screen",
      label: "Open recent audit drawer",
      keywords: ["audit", "recent audit", "drawer"],
      disabled: recentAudit.length === 0,
      perform: () => setDetailDrawer("audit"),
      order: 26,
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
      perform: () => void handleRefresh({ userInitiated: true }),
    },
    focusPrimary: {
      perform: () => quickLaunchRefs.current[0]?.focus?.(),
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
      onClick: () => void handleRefresh({ userInitiated: true }),
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
    {
      key: "acl-version-center",
      label: "ACL Version Center",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[2] = element;
      },
      onClick: () => openRoute("/sa/acl/version-center"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
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
      "Organization foundations first",
      "Role baselines and access packs next",
      "Users after company and business-area assignment is ready",
      "Approver map and report visibility last",
      "ACL Version Center publishes access changes after pack and scope edits",
      "Role rank matters, but approver authority is still explicit",
      "Diagnostics only after setup changes land",
    ],
    []
  );

  return (
    <ErpScreenScaffold
      eyebrow="SA Command Center"
      title="ERP Control Panel"
      actions={topActions}
      notices={notices}
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <DataTableCard
          eyebrow="Live Preview"
          title="Recent Sessions"
          rows={sessionPreviewRows.map((session) => ({
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
          footer={
            recentSessions.length > sessionPreviewRows.length
              ? `Showing ${sessionPreviewRows.length} of ${recentSessions.length} session rows.`
              : "Session preview is already fully visible."
          }
          actions={(
            <button
              type="button"
              disabled={recentSessions.length === 0}
              onClick={() => setDetailDrawer("sessions")}
              className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
            >
              Open Drawer
            </button>
          )}
        />

        <div className="grid gap-6">
          <DataTableCard
            eyebrow="Admin Trail"
            title="Recent Audit"
            rows={auditPreviewRows.map((audit) => ({
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
            footer={
              recentAudit.length > auditPreviewRows.length
                ? `Showing ${auditPreviewRows.length} of ${recentAudit.length} audit rows.`
                : "Audit preview is already fully visible."
            }
            actions={(
              <button
                type="button"
                disabled={recentAudit.length === 0}
                onClick={() => setDetailDrawer("audit")}
                className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
              >
                Open Drawer
              </button>
            )}
          />

          <ErpSectionCard
            eyebrow="Snapshot Readiness"
            title="Access Projection Status"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ErpFieldPreview
                label="ACL Snapshot"
                value={loading ? "..." : health?.acl_snapshot_status ?? "N/A"}
                caption="Permission projection readiness from the backend snapshot service."
                tone={
                  health?.acl_snapshot_status === "READY" ? "success" : "amber"
                }
              />
              <ErpFieldPreview
                label="Menu Snapshot"
                value={loading ? "..." : health?.menu_snapshot_status ?? "N/A"}
                caption="Navigation snapshot integrity for the protected ERP shell."
                tone={
                  health?.menu_snapshot_status === "READY" ? "success" : "amber"
                }
              />
            </div>
          </ErpSectionCard>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ErpSectionCard
          eyebrow="Quick Launch"
          title="Open the next SA workspace"
        >
          <div className="grid gap-6">
            {quickLaunchSections.map((section) => (
              <div key={section.key} className="grid gap-2">
                <div className="border border-slate-300 bg-[#eef4fb] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                    {section.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {section.description || "Open the next governance workspace in this section."}
                  </p>
                </div>
                <div className="grid gap-2">
                  {section.pages.map((action) => {
                    const flatIndex =
                      quickLaunchIndexByMenuCode.get(action.menuCode) ?? 0;

                    return (
                      <LaunchCard
                        key={`${section.key}-${action.menuCode}`}
                        {...action}
                        buttonRef={(element) => {
                          quickLaunchRefs.current[flatIndex] = element;
                        }}
                        primaryFocus={flatIndex === 0}
                        onKeyDown={(event) =>
                          handleLinearNavigation(event, {
                            index: flatIndex,
                            refs: quickLaunchRefs.current,
                            orientation: "vertical",
                          })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="System Snapshot"
          title="Diagnostic context"
        >
          <div className="grid gap-3">
            <ErpFieldPreview
              label="ERP Build"
              value={loading ? "..." : systemVersion}
              caption="Build signature shown in one place so operators do not need to scan raw payload data."
              tone="sky"
            />
            <ErpFieldPreview
              label="Launch Program"
              value={launchSummary.join("\n")}
              caption="Active governance workspaces available from the quick launch rail."
              multiline
              tone="default"
            />
          </div>
        </ErpSectionCard>
      </div>

      <DrawerBase
        visible={detailDrawer === "sessions"}
        title="Recent Sessions Detail"
        onEscape={() => setDetailDrawer("")}
        width="min(980px, calc(100vw - 24px))"
        actions={(
          <button
            type="button"
            onClick={() => setDetailDrawer("")}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        )}
      >
        <DataTableCard
          eyebrow="Full Session Preview"
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
        />
      </DrawerBase>

      <DrawerBase
        visible={detailDrawer === "audit"}
        title="Recent Audit Detail"
        onEscape={() => setDetailDrawer("")}
        width="min(980px, calc(100vw - 24px))"
        actions={(
          <button
            type="button"
            onClick={() => setDetailDrawer("")}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        )}
      >
        <DataTableCard
          eyebrow="Full Audit Preview"
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
        />
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
