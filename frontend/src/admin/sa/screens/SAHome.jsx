import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import { openRoute, openScreen } from "../../../navigation/screenStackEngine.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../context/useMenu.js";

const SA_HOME_ACTION_META = Object.freeze({
  SA_CONTROL_PANEL: {
    badge: "Command",
    description:
      "Open the SA command center to review runtime health, recent sessions, and admin activity.",
  },
  SA_COMPANY_CREATE: {
    badge: "Provision",
    description:
      "Launch the company setup workspace for a fresh operational entity.",
  },
  SA_ORG_BOOTSTRAP: {
    badge: "Bootstrap",
    description:
      "Stand up company, group, project, and department skeletons from one SA orchestration workspace.",
  },
  SA_PROJECT_MASTER: {
    badge: "Master",
    description:
      "Open project master manage for the current company-bound project wave.",
  },
  SA_USERS: {
    badge: "Govern",
    description:
      "Review users, role posture, and lifecycle state from the admin control surface.",
  },
  SA_ROLE_PERMISSIONS: {
    badge: "ACL",
    description:
      "Review role-resource VWED permissions from the ACL governance surface.",
  },
  SA_APPROVAL_RULES: {
    badge: "Route",
    description:
      "Maintain approver routing stages and exact governed scope for approval flow.",
  },
  SA_COMPANY_MODULE_MAP: {
    badge: "Module",
    description:
      "Enable or disable module exposure for a governed company by company ID.",
  },
  SA_SIGNUP_REQUESTS: {
    badge: "Approve",
    description:
      "Process incoming signup approvals with a clear enterprise review queue.",
  },
});

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
  refs,
}) {
  return (
    <button
      ref={(element) => {
        refs.current[index] = element;
      }}
      data-workspace-primary-focus={index === 0 ? "true" : undefined}
      type="button"
      onClick={action.onClick}
      onKeyDown={(event) =>
        handleLinearNavigation(event, {
          index,
          refs: refs.current,
          orientation: "vertical",
        })
      }
      className="grid w-full grid-cols-[96px_minmax(0,1fr)_110px] items-center border border-slate-300 bg-white px-3 py-3 text-left hover:bg-slate-50"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
        {action.badge}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{action.title}</span>
        <span className="mt-1 block truncate text-xs text-slate-500">
          {action.description}
        </span>
      </span>
      <span className="justify-self-end text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Enter Open
      </span>
    </button>
  );
}

export default function SAHome() {
  const { menu } = useMenu();
  const [controlPanel, setControlPanel] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const topActionRefs = useRef([]);
  const cardRefs = useRef([]);

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

  const launchActions = useMemo(
    () =>
      menu
        .filter(
          (item) =>
            item.menu_type === "PAGE" &&
            item.parent_menu_code === "SA_ROOT" &&
            item.menu_code !== "SA_HOME" &&
            item.route_path
        )
        .sort((left, right) => (left.display_order ?? 0) - (right.display_order ?? 0))
        .map((item) => {
          const meta = SA_HOME_ACTION_META[item.menu_code] ?? {};

          return {
            badge: meta.badge ?? "Open",
            title: item.title,
            description:
              meta.description ?? "Open the selected Super Admin workspace.",
            onClick: () => openRoute(item.route_path),
          };
        }),
    [menu]
  );

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
        perform: () => cardRefs.current[0]?.focus?.(),
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
      perform: () => cardRefs.current[0]?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Command"
      title="Super Admin Dashboard"
      description="Dense launch surface for Super Admin work. Pick the next governance job directly from the launch list without mouse travel."
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
        description="Use arrows, Enter, or the command bar to move straight into the next governance job."
      >
        <div className="grid gap-2">
          {launchActions.map((action, index) => (
            <HomeActionCard
              key={action.title}
              action={action}
              index={index}
              refs={cardRefs}
            />
          ))}
        </div>
      </ErpSectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ErpSectionCard
          eyebrow="Operating Pattern"
          title="Keyboard Operation"
          description="This page is a worksheet-style launcher, not a poster dashboard."
        >
          <div className="grid gap-2">
            <div className="grid grid-cols-[140px_minmax(0,1fr)] border border-slate-200 bg-white px-3 py-3">
              <p className="text-sm font-semibold text-slate-900">Alt+Shift+P</p>
              <p className="text-sm text-slate-600">
                Returns focus to the launch list.
              </p>
            </div>
            <div className="grid grid-cols-[140px_minmax(0,1fr)] border border-slate-200 bg-white px-3 py-3">
              <p className="text-sm font-semibold text-slate-900">Alt+R</p>
              <p className="text-sm text-slate-600">
                Reloads the snapshot without leaving the shell.
              </p>
            </div>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Snapshot Summary"
          title="Current readiness view"
          description="These figures are derived from the same backend-owned admin projections used by the deeper SA surfaces."
        >
          <div className="grid gap-2">
            {[
              `System health: ${deriveSnapshotHealth(systemHealth)}`,
              `Database: ${systemHealth?.db_status ?? "Loading"}`,
              `ACL snapshot: ${systemHealth?.acl_snapshot_status ?? "Loading"}`,
              `Menu snapshot: ${systemHealth?.menu_snapshot_status ?? "Loading"}`,
            ].map((item) => (
              <div
                key={item}
                className="border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
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
