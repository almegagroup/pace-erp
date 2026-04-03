import { useEffect, useMemo, useRef, useState } from "react";
import EnterpriseDashboard from "../../components/dashboard/EnterpriseDashboard.jsx";
import { useErpScreenCommands } from "../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../hooks/useErpScreenHotkeys.js";
import { handleLinearNavigation } from "../../navigation/erpRovingFocus.js";
import { openRoute } from "../../navigation/screenStackEngine.js";
import { useMenu } from "../../context/useMenu.js";
import { openErpCommandPalette } from "../../store/erpCommandPalette.js";
import {
  listLeaveApprovalInbox,
  listOutWorkApprovalInbox,
} from "./hr/hrApi.js";

function canOpenApprovalInbox(menuSnapshot) {
  const rows = Array.isArray(menuSnapshot) ? menuSnapshot : [];

  return rows.some(
    (row) =>
      row?.resource_code === "HR_LEAVE_APPROVAL_INBOX" ||
      row?.resource_code === "HR_OUT_WORK_APPROVAL_INBOX" ||
      row?.route_path === "/dashboard/hr/leave/approval-inbox" ||
      row?.route_path === "/dashboard/hr/out-work/approval-inbox",
  );
}

function hasRoute(menuSnapshot, routePath) {
  return Array.isArray(menuSnapshot)
    ? menuSnapshot.some((row) => row?.route_path === routePath)
    : false;
}

function findFirstRoute(menuSnapshot, routePaths = []) {
  return routePaths.find((routePath) => hasRoute(menuSnapshot, routePath)) ?? "";
}

async function loadApprovalSummary(canViewApprovalInbox) {
  if (!canViewApprovalInbox) {
    return {
      approvalsToday: 0,
    };
  }

  const [leaveRows, outWorkRows] = await Promise.allSettled([
    listLeaveApprovalInbox(),
    listOutWorkApprovalInbox(),
  ]);

  const leaveCount =
    leaveRows.status === "fulfilled" ? (leaveRows.value?.length ?? 0) : 0;
  const outWorkCount =
    outWorkRows.status === "fulfilled" ? (outWorkRows.value?.length ?? 0) : 0;

  return {
    approvalsToday: leaveCount + outWorkCount,
  };
}

export default function UserDashboardHome() {
  const topActionRefs = useRef([]);
  const { menu } = useMenu();
  const [approvalSummary, setApprovalSummary] = useState({
    approvalsToday: 0,
  });
  const canViewApprovalInbox = useMemo(() => canOpenApprovalInbox(menu), [menu]);
  const priorityRoute = useMemo(
    () =>
      findFirstRoute(menu, [
        "/dashboard/hr/leave/my-requests",
        "/dashboard/hr/out-work/my-requests",
        "/dashboard/hr/leave/apply",
        "/dashboard/hr/out-work/apply",
      ]),
    [menu]
  );
  const approvalRoute = useMemo(
    () =>
      findFirstRoute(menu, [
        "/dashboard/hr/leave/approval-inbox",
        "/dashboard/hr/out-work/approval-inbox",
      ]),
    [menu]
  );
  const reportingRoute = useMemo(
    () =>
      findFirstRoute(menu, [
        "/dashboard/hr/leave/register",
        "/dashboard/hr/out-work/register",
        "/dashboard/hr/leave/approval-history",
        "/dashboard/hr/out-work/approval-history",
      ]),
    [menu]
  );

  useEffect(() => {
    let alive = true;

    async function refreshApprovalSummary() {
      try {
        const nextSummary = await loadApprovalSummary(canViewApprovalInbox);
        if (alive) {
          setApprovalSummary(nextSummary);
        }
      } catch {
        if (alive) {
          setApprovalSummary({ approvalsToday: 0 });
        }
      }
    }

    void refreshApprovalSummary();

    function handleFocus() {
      void refreshApprovalSummary();
    }

    function handleWorkflowChange() {
      void refreshApprovalSummary();
    }

    window.addEventListener("focus", handleFocus);
    window.addEventListener("erp:workflow-changed", handleWorkflowChange);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      alive = false;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("erp:workflow-changed", handleWorkflowChange);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [canViewApprovalInbox]);

  const stats = useMemo(
    () => [
      {
        label: "My Tasks",
        value: "14",
        tag: "Queue",
        tone: "sky",
        caption: "Work items currently sitting in the user-owned execution lane.",
      },
      {
        label: "Approvals Today",
        value: String(approvalSummary.approvalsToday).padStart(2, "0"),
        tag: "Flow",
        tone: "emerald",
        caption: "Approval decisions likely to need attention during this shift.",
      },
      {
        label: "Module Access",
        value: String(new Set((menu ?? []).map((row) => row?.module_code).filter(Boolean)).size).padStart(2, "0"),
        tag: "Scope",
        tone: "amber",
        caption: "Modules currently reachable through ACL and menu projection.",
      },
      {
        label: "Execution Pace",
        value: "91%",
        tag: "Trend",
        tone: "slate",
        caption: "Current pace indicator for the user's operating session.",
      },
    ],
    [approvalSummary.approvalsToday, menu]
  );

  const actions = [
    {
      badge: "Work",
      title: "Priority Queue",
      description: priorityRoute
        ? "Open the first available request lane and continue work immediately."
        : "No request lane is exposed in the current ACL projection.",
      hint: priorityRoute ? "Enter Open" : "Unavailable",
      disabled: !priorityRoute,
      onClick: () => {
        if (priorityRoute) {
          openRoute(priorityRoute);
        }
      },
    },
    {
      badge: "Review",
      title: "Approvals Board",
      description: approvalRoute
        ? "Open the current approval queue and keep workflow moving."
        : "Approval inbox is not available for this user context.",
      hint: approvalRoute ? "Enter Open" : "Unavailable",
      disabled: !approvalRoute,
      onClick: () => {
        if (approvalRoute) {
          openRoute(approvalRoute);
        }
      },
    },
    {
      badge: "Track",
      title: "Performance Signals",
      description: reportingRoute
        ? "Open the best available register or history view from the current access map."
        : "Open command routing to find the next available workspace.",
      hint: reportingRoute ? "Enter Open" : "Ctrl+K / F9",
      onClick: () => {
        if (reportingRoute) {
          openRoute(reportingRoute);
          return;
        }

        openErpCommandPalette();
      },
    },
  ];

  const topActions = [
    {
      key: "focus-queue",
      label: "Focus Queue",
      hint: "Alt+Shift+P",
      tone: "primary",
      buttonRef: (element) => {
        topActionRefs.current[0] = element;
      },
      onClick: () => {
        const target = document.querySelector("[data-workspace-primary-focus='true']");
        target?.focus?.();
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "focus-content",
      label: "Stay In Workspace",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[1] = element;
      },
      onClick: () => {
        const target = document.querySelector("[data-workspace-primary-focus='true']");
        target?.focus?.();
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  useErpScreenCommands([
    {
      id: "user-home-focus-actions",
      group: "Current Screen",
      label: "Focus user action queue",
      keywords: ["user dashboard", "actions", "queue"],
      perform: () => {
        const target = document.querySelector("[data-workspace-primary-focus='true']");
        target?.focus?.();
      },
      order: 10,
    },
    {
      id: "user-home-open-priority",
      group: "Current Screen",
      label: priorityRoute ? "Open priority queue" : "Priority queue unavailable",
      keywords: ["dashboard", "priority", "queue"],
      disabled: !priorityRoute,
      perform: () => {
        if (priorityRoute) {
          openRoute(priorityRoute);
        }
      },
      order: 20,
    },
    {
      id: "user-home-open-approval-board",
      group: "Current Screen",
      label: approvalRoute ? "Open approvals board" : "Approvals board unavailable",
      keywords: ["dashboard", "approval", "board"],
      disabled: !approvalRoute,
      perform: () => {
        if (approvalRoute) {
          openRoute(approvalRoute);
        }
      },
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    focusPrimary: {
      perform: () => {
        const target = document.querySelector("[data-workspace-primary-focus='true']");
        target?.focus?.();
      },
    },
  });

  return (
    <EnterpriseDashboard
      eyebrow="Operational Workspace"
      title="User Dashboard"
      subtitle="Keep the current work queue, approvals, and access summary in a clean workspace."
      stats={stats}
      actions={actions}
      topActions={topActions}
      workspaceTitle="Keyboard-Native Work Queue"
      workspaceDescription="This ACL-governed dashboard now behaves like a working surface, not a passive landing page."
      noteTitle="Operator Rhythm"
      noteItems={[
        "Alt+Shift+P returns focus to the primary action card.",
        "F6 rotates zones; arrows move deterministically inside the action grid.",
        "Ctrl+K or F9 opens command routing when no direct action lane is available.",
      ]}
      summaryTitle="ACL Workspace Snapshot"
      summaryItems={[
        "Primary work remains keyboard reachable without mouse rescue.",
        "ACL and menu projection still own what the user can actually open.",
        "This dashboard is the base pattern for future keyboard-native ACL modules.",
      ]}
    />
  );
}
