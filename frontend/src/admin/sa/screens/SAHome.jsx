import { useEffect, useMemo, useState } from "react";
import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";
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

  const isHealthy = statuses.every((value) =>
    ["UP", "READY"].includes(value)
  );

  return isHealthy ? "READY" : "DEGRADED";
}

export default function SAHome() {
  const [controlPanel, setControlPanel] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);

  async function refreshDashboardSnapshot() {
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
    }
  }

  useEffect(() => {
    let alive = true;

    async function loadDashboardSnapshot() {
      try {
        const [controlPanelData, systemHealthData] = await Promise.all([
          fetchControlPanelSnapshot(),
          fetchSystemHealthSnapshot(),
        ]);

        if (!alive) {
          return;
        }

        setControlPanel(controlPanelData);
        setSystemHealth(systemHealthData);
      } catch {
        if (!alive) {
          return;
        }

        setControlPanel(null);
        setSystemHealth(null);
      }
    }

    void loadDashboardSnapshot();

    return () => {
      alive = false;
    };
  }, []);

  const stats = [
    {
      label: "Companies",
      value: String(controlPanel?.company_count ?? "..."),
      tag: "Live",
    },
    {
      label: "Users",
      value: String(controlPanel?.erp_user_count ?? "..."),
      tag: "ERP",
    },
    {
      label: "Pending Signups",
      value: String(controlPanel?.pending_signup_count ?? "..."),
      tag: "Queue",
    },
    {
      label: "Snapshot Health",
      value: deriveSnapshotHealth(systemHealth),
      tag: systemHealth?.db_status ?? "Runtime",
    },
  ];

  const actions = [
    {
      badge: "Command",
      title: "Control Panel",
      description: "Open the SA command center to review runtime health, recent sessions, and admin activity.",
      onClick: () => openScreen("SA_CONTROL_PANEL"),
    },
    {
      badge: "Provision",
      title: "Create Company",
      description: "Launch the company setup workspace for a fresh operational entity.",
      onClick: () => openScreen("SA_COMPANY_CREATE"),
    },
    {
      badge: "Govern",
      title: "User Control",
      description: "Review users, role posture, and lifecycle state from the admin control surface.",
      onClick: () => openScreen("SA_USERS"),
    },
    {
      badge: "Approve",
      title: "Signup Requests",
      description: "Process incoming signup approvals with a clear enterprise review queue.",
      onClick: () => openScreen("SA_SIGNUP_REQUESTS"),
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
      ...actions.map((action, index) => ({
        id: `sa-home-${action.title.toLowerCase().replaceAll(" ", "-")}`,
        group: "Current Screen",
        label: `Open ${action.title}`,
        keywords: [action.badge, action.title, action.description],
        perform: action.onClick,
        order: 20 + index,
      })),
    ],
    [actions]
  );

  useErpScreenCommands(commands);

  useErpScreenHotkeys({
    refresh: {
      perform: () => void refreshDashboardSnapshot(),
    },
  });

  return (
    <EnterpriseDashboard
      eyebrow="Super Admin Command"
      title="Super Admin Dashboard"
      subtitle="Use the shortcuts below to move into the SA control panel, company setup, user control, and signup review."
      stats={stats}
      actions={actions}
    />
  );
}
