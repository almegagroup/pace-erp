import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  handleGridNavigation,
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchControlPanelSnapshot() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/control-panel`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data) {
    throw new Error("CONTROL_PANEL_READ_FAILED");
  }

  return json.data;
}

async function fetchSystemHealthSnapshot() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/system-health`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data) {
    throw new Error("SYSTEM_HEALTH_READ_FAILED");
  }

  return json.data;
}

function deriveSnapshotHealth(health) {
  if (!health) {
    return "Loading";
  }

  const statuses = [
    health.db_status,
    health.acl_snapshot_status,
    health.menu_snapshot_status,
  ];

  const isHealthy = statuses.every((value) => ["UP", "READY"].includes(value));

  return isHealthy ? "READY" : "DEGRADED";
}

function HomeActionCard({
  action,
  index,
  gridRefs,
}) {
  const rowIndex = Math.floor(index / 2);
  const columnIndex = index % 2;

  return (
    <button
      ref={(element) => {
        gridRefs.current[rowIndex] ??= [];
        gridRefs.current[rowIndex][columnIndex] = element;
      }}
      data-workspace-primary-focus={index === 0 ? "true" : undefined}
      type="button"
      onClick={action.onClick}
      onKeyDown={(event) =>
        handleGridNavigation(event, {
          rowIndex,
          columnIndex,
          gridRefs: gridRefs.current,
        })
      }
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-[0_12px_34px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_18px_42px_rgba(14,116,144,0.12)]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-full bg-sky-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
          {action.badge}
        </span>
        <span className="text-slate-300 transition group-hover:text-sky-600">
          {"->"}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">
        {action.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {action.description}
      </p>
    </button>
  );
}

export default function SAHome() {
  const [controlPanel, setControlPanel] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const topActionRefs = useRef([]);
  const cardGridRefs = useRef([]);

  async function refreshDashboardSnapshot() {
    setLoading(true);
    setError("");

    try {
      const [controlPanelData, systemHealthData] = await Promise.all([
        fetchControlPanelSnapshot(),
        fetchSystemHealthSnapshot(),
      ]);

      setControlPanel(controlPanelData);
      setSystemHealth(systemHealthData);
    } catch {
      setControlPanel(null);
      setSystemHealth(null);
      setError("Unable to refresh the SA dashboard snapshot right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshDashboardSnapshot();
  }, []);

  const launchActions = [
    {
      badge: "Command",
      title: "Control Panel",
      description:
        "Open the SA command center to review runtime health, recent sessions, and admin activity.",
      onClick: () => openScreen("SA_CONTROL_PANEL"),
    },
    {
      badge: "Provision",
      title: "Create Company",
      description:
        "Launch the company setup workspace for a fresh operational entity.",
      onClick: () => openScreen("SA_COMPANY_CREATE"),
    },
    {
      badge: "Master",
      title: "Project Master",
      description:
        "Open project master manage for the current company-bound project wave.",
      onClick: () => openScreen("SA_PROJECT_MASTER"),
    },
    {
      badge: "Govern",
      title: "User Control",
      description:
        "Review users, role posture, and lifecycle state from the admin control surface.",
      onClick: () => openScreen("SA_USERS"),
    },
    {
      badge: "ACL",
      title: "Role Permissions",
      description:
        "Review role-resource VWED permissions from the ACL governance surface.",
      onClick: () => openScreen("SA_ROLE_PERMISSIONS"),
    },
    {
      badge: "Route",
      title: "Approval Rules",
      description:
        "Maintain approver routing stages and exact governed scope for approval flow.",
      onClick: () => openScreen("SA_APPROVAL_RULES"),
    },
    {
      badge: "Module",
      title: "Company Modules",
      description:
        "Enable or disable module exposure for a governed company by company ID.",
      onClick: () => openScreen("SA_COMPANY_MODULE_MAP"),
    },
    {
      badge: "Approve",
      title: "Signup Requests",
      description:
        "Process incoming signup approvals with a clear enterprise review queue.",
      onClick: () => openScreen("SA_SIGNUP_REQUESTS"),
    },
  ];

  const topActions = [
    {
      key: "refresh-home",
      label: loading ? "Refreshing..." : "Refresh Snapshot",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        topActionRefs.current[0] = element;
      },
      onClick: () => void refreshDashboardSnapshot(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "open-control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[1] = element;
      },
      onClick: () => openScreen("SA_CONTROL_PANEL"),
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
      key: "companies",
      label: "Companies",
      value: String(controlPanel?.company_count ?? "..."),
      caption: "Current company inventory visible inside the SA control plane.",
      tone: "sky",
      badge: "Live",
    },
    {
      key: "users",
      label: "Users",
      value: String(controlPanel?.erp_user_count ?? "..."),
      caption: "Mapped ERP users currently available to governance workflows.",
      tone: "emerald",
      badge: "ERP",
    },
    {
      key: "pending-signups",
      label: "Pending Signups",
      value: String(controlPanel?.pending_signup_count ?? "..."),
      caption: "Onboarding queue items still waiting for SA decision.",
      tone: "amber",
      badge: "Queue",
    },
    {
      key: "snapshot-health",
      label: "Snapshot Health",
      value: deriveSnapshotHealth(systemHealth),
      caption: "Combined health view over DB, ACL snapshot, and menu snapshot readiness.",
      tone: deriveSnapshotHealth(systemHealth) === "READY" ? "emerald" : "rose",
      badge: systemHealth?.db_status ?? "Runtime",
    },
  ];

  const commands = useMemo(
    () => [
      {
        id: "sa-home-refresh",
        group: "Current Screen",
        label: "Refresh SA dashboard snapshot",
        keywords: ["refresh", "dashboard", "snapshot", "home"],
        perform: () => void refreshDashboardSnapshot(),
        order: 10,
      },
      {
        id: "sa-home-focus-launch",
        group: "Current Screen",
        label: "Focus launch grid",
        keywords: ["focus", "launch", "actions", "home"],
        perform: () => cardGridRefs.current[0]?.[0]?.focus?.(),
        order: 20,
      },
      ...launchActions.map((action, index) => ({
        id: `sa-home-${action.title.toLowerCase().replaceAll(" ", "-")}`,
        group: "Current Screen",
        label: `Open ${action.title}`,
        keywords: [action.badge, action.title, action.description],
        perform: action.onClick,
        order: 30 + index,
      })),
    ],
    [launchActions]
  );

  useErpScreenCommands(commands);

  useErpScreenHotkeys({
    refresh: {
      perform: () => void refreshDashboardSnapshot(),
    },
    focusPrimary: {
      perform: () => cardGridRefs.current[0]?.[0]?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Command"
      title="Super Admin Dashboard"
      description="This entry surface now follows the same keyboard-native grammar as the rest of the SA control plane, with deterministic launch paths into the next governed workspace."
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
    >
      <ErpSectionCard
        eyebrow="Launch Rail"
        title="Open the next SA workspace"
        description="Use the first-card focus rail with arrows, Enter, or the command bar to move straight into the next governance job."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {launchActions.map((action, index) => (
            <HomeActionCard
              key={action.title}
              action={action}
              index={index}
              gridRefs={cardGridRefs}
            />
          ))}
        </div>
      </ErpSectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ErpSectionCard
          eyebrow="Operating Pattern"
          title="Keyboard-first shell notes"
          description="This dashboard no longer acts as a passive landing page. It is a working launch surface."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-slate-50 px-5 py-5">
              <p className="text-sm font-semibold text-slate-900">
                Alt+Shift+P
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Returns focus to the launch rail so you can move card-to-card without a mouse.
              </p>
            </div>
            <div className="rounded-3xl bg-slate-50 px-5 py-5">
              <p className="text-sm font-semibold text-slate-900">
                Alt+R
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Reloads the control-plane snapshot without leaving the shell.
              </p>
            </div>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Snapshot Summary"
          title="Current readiness view"
          description="These figures are derived from the same backend-owned admin projections used by the deeper SA surfaces."
        >
          <div className="space-y-3">
            {[
              `System health: ${deriveSnapshotHealth(systemHealth)}`,
              `Database: ${systemHealth?.db_status ?? "Loading"}`,
              `ACL snapshot: ${systemHealth?.acl_snapshot_status ?? "Loading"}`,
              `Menu snapshot: ${systemHealth?.menu_snapshot_status ?? "Loading"}`,
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
