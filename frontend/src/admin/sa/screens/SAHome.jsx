import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  handleLinearNavigation,
} from "../../../navigation/erpRovingFocus.js";
import { openRoute } from "../../../navigation/screenStackEngine.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
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

async function fetchControlPanelSnapshot({ uiMode = "background" } = {}) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/control-panel`,
    {
      credentials: "include",
      erpUiMode: uiMode,
      erpUiLabel: "Refreshing dashboard snapshot",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data) {
    throw new Error("CONTROL_PANEL_READ_FAILED");
  }

  return json.data;
}

async function fetchSystemHealthSnapshot({ uiMode = "background" } = {}) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/system-health`,
    {
      credentials: "include",
      erpUiMode: uiMode,
      erpUiLabel: "Refreshing dashboard snapshot",
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
  registerRef,
}) {
  return (
    <button
      ref={registerRef}
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
  const [_controlPanel, setControlPanel] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const topActionRefs = useRef([]);
  const cardRefs = useRef([]);

  async function refreshDashboardSnapshot({ userInitiated = false } = {}) {
    setLoading(true);
    setError("");

    try {
      const uiMode = userInitiated ? "blocking" : "background";
      const [controlPanelData, systemHealthData] = await Promise.all([
        fetchControlPanelSnapshot({ uiMode }),
        fetchSystemHealthSnapshot({ uiMode }),
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

  const launchSections = useMemo(() => {
    const sections = buildSaMenuSections(menu, {
      excludeMenuCodes: ["SA_HOME"],
    });

    return sections.map((section) => ({
      ...section,
      pages: section.pages.map((item) => ({
        badge: "Open",
        menuCode: item.menu_code,
        title: item.title,
        description:
          item.description ?? "Open the selected Super Admin workspace.",
        routePath: item.route_path,
        onClick: () => openRoute(item.route_path),
      })),
    }));
  }, [menu]);

  const launchActions = useMemo(
    () =>
      flattenSaMenuSections(
        launchSections.map((section) => ({
          ...section,
          pages: section.pages,
        }))
      ),
    [launchSections]
  );

  const launchIndexByMenuCode = useMemo(
    () =>
      new Map(
        launchActions.map((action, index) => [action.menuCode, index])
      ),
    [launchActions]
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
      onClick: () => void refreshDashboardSnapshot({ userInitiated: true }),
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
      onClick: () => openRoute("/sa/control-panel"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const commands = useMemo(
    () => [
      {
        id: "sa-home-refresh",
        group: "Current Screen",
        label: "Refresh SA dashboard snapshot",
        keywords: ["refresh", "dashboard", "snapshot", "home"],
        perform: () => void refreshDashboardSnapshot({ userInitiated: true }),
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
      perform: () => void refreshDashboardSnapshot({ userInitiated: true }),
    },
    focusPrimary: {
      perform: () => cardRefs.current[0]?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Command"
      title="Super Admin Dashboard"
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
    >
      <ErpSectionCard
        eyebrow="Setup Flow"
        title="Complete setup in the right order"
      >
        <div className="grid gap-6">
          {launchSections.map((section) => (
            <div key={section.key} className="grid gap-2">
              <div className="border border-slate-300 bg-[#eef4fb] px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                  {section.title}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {section.description || "Open the next published workspace from this section."}
                </p>
              </div>
                <div className="grid gap-2">
                  {section.pages.map((action) => {
                    const flatIndex = launchIndexByMenuCode.get(action.menuCode) ?? 0;

                    return (
                      <HomeActionCard
                        key={`${section.key}-${action.title}`}
                        action={action}
                        index={flatIndex}
                        refs={cardRefs}
                        registerRef={(element) => {
                          cardRefs.current[flatIndex] = element;
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </ErpSectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ErpSectionCard
          eyebrow="Working Rule"
          title="How SA Should Move"
        >
          <div className="grid gap-2">
            <div className="grid grid-cols-[140px_minmax(0,1fr)] border border-slate-200 bg-white px-3 py-3">
              <p className="text-sm font-semibold text-slate-900">Step 1</p>
              <p className="text-sm text-slate-600">
                Finish Organization Setup before assigning screen packs or user scope.
              </p>
            </div>
            <div className="grid grid-cols-[140px_minmax(0,1fr)] border border-slate-200 bg-white px-3 py-3">
              <p className="text-sm font-semibold text-slate-900">Step 2</p>
              <p className="text-sm text-slate-600">
                Finish Access Setup before onboarding live users into work scopes.
              </p>
            </div>
            <div className="grid grid-cols-[140px_minmax(0,1fr)] border border-slate-200 bg-white px-3 py-3">
              <p className="text-sm font-semibold text-slate-900">Step 3</p>
              <p className="text-sm text-slate-600">
                Keep approval and report visibility separate from screen access.
              </p>
            </div>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Readiness"
          title="Current runtime health"
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
