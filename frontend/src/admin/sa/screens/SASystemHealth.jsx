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
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

export default function SASystemHealth() {
  const actionBarRefs = useRef([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const statusRows = [
    {
      key: "database",
      surface: "Database",
      status: dbStatus,
      action:
        dbStatus === "DOWN"
          ? "Stop new governance actions and investigate runtime immediately."
          : "Runtime data layer is accepting health probes.",
    },
    {
      key: "acl",
      surface: "ACL Snapshot",
      status: aclStatus,
      action:
        aclStatus === "UNAVAILABLE"
          ? "Review ACL projection chain before changing access scope."
          : "Permission projection is ready for current runtime.",
    },
    {
      key: "menu",
      surface: "Menu Snapshot",
      status: menuStatus,
      action:
        menuStatus === "UNAVAILABLE"
          ? "Review menu governance before operators depend on route exposure."
          : "Navigation projection is currently healthy.",
    },
  ];

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

  return (
    <ErpScreenScaffold
      eyebrow="SA Diagnostics"
      title="ERP System Health"
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
      footerHints={["CTRL+K COMMAND BAR", "ALT+R REFRESH"]}
    >
      <div className="grid gap-3">
        <ErpSelectionSection label="Diagnostics Interpretation" />
        <ErpDenseGrid
          columns={[
            { key: "surface", label: "Surface", width: "180px" },
            { key: "status", label: "Status", width: "180px" },
            { key: "action", label: "Operator Action" },
          ]}
          rows={statusRows}
          rowKey={(row) => row.key}
          renderCell={(row, column) => row[column.key]}
          maxHeight="none"
          summaryRow={{
            label: "Summary",
            values: {
              status: [dbStatus, aclStatus, menuStatus].join(" | "),
              action: "Refresh after each governance change that could affect runtime projection.",
            },
          }}
        />
      </div>
    </ErpScreenScaffold>
  );
}
