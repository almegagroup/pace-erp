import { useRef } from "react";
import EnterpriseDashboard from "../../components/dashboard/EnterpriseDashboard.jsx";
import { useErpScreenCommands } from "../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../hooks/useErpScreenHotkeys.js";
import { handleLinearNavigation } from "../../navigation/erpRovingFocus.js";

export default function UserDashboardHome() {
  const topActionRefs = useRef([]);

  const stats = [
    {
      label: "My Tasks",
      value: "14",
      tag: "Queue",
      tone: "sky",
      caption: "Work items currently sitting in the user-owned execution lane.",
    },
    {
      label: "Approvals Today",
      value: "06",
      tag: "Flow",
      tone: "emerald",
      caption: "Approval decisions likely to need attention during this shift.",
    },
    {
      label: "Module Access",
      value: "09",
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
  ];

  const actions = [
    {
      badge: "Work",
      title: "Priority Queue",
      description: "Start with the highest-priority items waiting for you.",
      hint: "Primary",
      onClick: () => {},
    },
    {
      badge: "Review",
      title: "Approvals Board",
      description: "Open the current approval queue and keep work moving.",
      hint: "Pending",
      onClick: () => {},
    },
    {
      badge: "Track",
      title: "Performance Signals",
      description: "Track pace, workload, and immediate operational signals.",
      hint: "Snapshot",
      onClick: () => {},
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
        "Ctrl+K remains available for command-driven navigation when work expands.",
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
