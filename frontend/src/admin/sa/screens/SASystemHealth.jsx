/*
 * File-ID: 9.16B-FRONT
 * File-Path: frontend/src/admin/sa/screens/SASystemHealth.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin diagnostics surface for ERP system health visibility
 * Authority: Frontend
 */

import { useEffect, useRef, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import {
  readViewSnapshotCache,
  writeViewSnapshotCache,
} from "../../../store/viewSnapshotCache.js";

const SA_SYSTEM_HEALTH_CACHE_KEY = "sa-system-health";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
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

export default function SASystemHealth() {
  const cachedSnapshot = readViewSnapshotCache(SA_SYSTEM_HEALTH_CACHE_KEY);
  const actionBarRefs = useRef([]);
  const [health, setHealth] = useState(() => cachedSnapshot?.health ?? null);
  const [loading, setLoading] = useState(() => !cachedSnapshot?.health);
  const [error, setError] = useState("");

  async function loadHealth({ userInitiated = false } = {}) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/system-health`,
        {
          credentials: "include",
          erpUiMode: userInitiated ? "blocking" : "background",
          erpUiLabel: "Refreshing system health",
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok) {
        throw new Error(
          userInitiated
            ? "SYSTEM_HEALTH_REFRESH_FAILED"
            : "SYSTEM_HEALTH_READ_FAILED"
        );
      }

      setHealth(json.data ?? null);
      writeViewSnapshotCache(SA_SYSTEM_HEALTH_CACHE_KEY, {
        health: json.data ?? null,
      });
    } catch {
      setError(
        userInitiated
          ? "Unable to refresh ERP system health right now."
          : "Unable to load ERP system health right now."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    void loadHealth().catch(() => {
      if (!alive) {
        return;
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    await loadHealth({ userInitiated: true });
  }

  const dbStatus = health?.db_status ?? "N/A";
  const aclStatus = health?.acl_snapshot_status ?? "N/A";
  const menuStatus = health?.menu_snapshot_status ?? "N/A";
  const systemVersion = formatSystemVersion(health?.system_version);

  const alerts = [
    dbStatus === "DOWN"
      ? {
          title: "Database probe is failing",
          body: "Core ERP database health is reporting DOWN. This should be treated as operationally urgent.",
          tone: "error",
        }
      : null,
    aclStatus === "UNAVAILABLE"
      ? {
          title: "ACL snapshot is unavailable",
          body: "Permission projection is not reporting healthy status. Access governance may need attention.",
          tone: "info",
        }
      : null,
    menuStatus === "UNAVAILABLE"
      ? {
          title: "Menu snapshot is unavailable",
          body: "Navigation projection is not ready. Menu visibility and route reachability may be affected.",
          tone: "info",
        }
      : null,
  ].filter(Boolean);

  useErpScreenCommands([
    {
      id: "sa-system-health-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing system health..." : "Refresh system health",
      keywords: ["refresh", "system health", "diagnostics"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-system-health-open-control-panel",
      group: "Current Screen",
      label: "Open control panel",
      keywords: ["control panel", "sa"],
      perform: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      order: 20,
    },
    {
      id: "sa-system-health-open-role-permissions",
      group: "Current Screen",
      label: "Open ACL role permissions",
      keywords: ["acl", "permissions", "snapshot follow-up"],
      perform: () => openScreen("SA_ROLE_PERMISSIONS"),
      order: 30,
    },
    {
      id: "sa-system-health-open-company-modules",
      group: "Current Screen",
      label: "Open company module map",
      keywords: ["module map", "acl modules", "menu readiness"],
      perform: () => openScreen("SA_COMPANY_MODULE_MAP"),
      order: 40,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
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
      key: "refresh-health",
      label: loading ? "Refreshing..." : "Refresh Health",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => void handleRefresh(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "acl-permissions",
      label: "ACL Permissions",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => openScreen("SA_ROLE_PERMISSIONS"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "company-modules",
      label: "Company Modules",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[3] = element;
      },
      onClick: () => openScreen("SA_COMPANY_MODULE_MAP"),
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
      key: "system-version",
      label: "System Version",
      value: loading ? "..." : systemVersion,
      tone: "sky",
      caption:
        "Current backend system version reported by the diagnostics endpoint.",
    },
    {
      key: "database-status",
      label: "Database",
      value: loading ? "..." : dbStatus,
      tone: dbStatus === "DOWN" ? "rose" : "emerald",
      caption:
        "Authoritative database connectivity check against ERP session storage.",
    },
    {
      key: "acl-status",
      label: "ACL Snapshot",
      value: loading ? "..." : aclStatus,
      tone: aclStatus === "UNAVAILABLE" ? "amber" : "emerald",
      caption:
        "Readiness of the permission projection layer used by controlled access flow.",
    },
    {
      key: "menu-status",
      label: "Menu Snapshot",
      value: loading ? "..." : menuStatus,
      tone: menuStatus === "UNAVAILABLE" ? "amber" : "emerald",
      caption:
        "Readiness of the menu projection layer that feeds controlled navigation.",
    },
  ];

  return (
    <ErpScreenScaffold
      eyebrow="SA Diagnostics"
      title="ERP System Health"
      description="This diagnostics surface now follows the same keyboard-native shell grammar while keeping runtime health, alerts, and operator guidance in predictable zones."
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
          : alerts
      }
      metrics={metrics}
    >
      <ErpSectionCard
        eyebrow="Diagnostics Interpretation"
        title="What SA should do next"
        description="Use these operator notes as the immediate response rail after checking the live health metrics above."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="border border-slate-300 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              If Database is DOWN
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Treat this as operationally urgent. Avoid provisioning new governance actions until the core runtime is stable again.
            </p>
          </div>
          <div className="border border-slate-300 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              If ACL Snapshot is UNAVAILABLE
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Review access-governance inputs and upcoming ACL administration surfaces before expanding user scope.
            </p>
          </div>
          <div className="border border-slate-300 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              If Menu Snapshot is UNAVAILABLE
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Review menu-governance readiness because route visibility and navigation projection may be incomplete.
            </p>
          </div>
        </div>
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
