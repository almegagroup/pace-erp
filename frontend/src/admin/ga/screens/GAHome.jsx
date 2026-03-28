import { useRef } from "react";
import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";

export default function GAHome() {
  const topActionRefs = useRef([]);

  const stats = [
    {
      label: "Group Companies",
      value: "07",
      tag: "Portfolio",
      tone: "sky",
      caption: "Companies currently visible inside the group administration portfolio.",
    },
    {
      label: "Shared Policies",
      value: "18",
      tag: "Standard",
      tone: "emerald",
      caption: "Shared standards and governance rules under GA oversight.",
    },
    {
      label: "Open Exceptions",
      value: "05",
      tag: "Attention",
      tone: "amber",
      caption: "Exceptions still requiring review, escalation, or clarification.",
    },
    {
      label: "Operational Readiness",
      value: "96.8%",
      tag: "Health",
      tone: "slate",
      caption: "Headline readiness signal across the governed portfolio.",
    },
  ];

  const actions = [
    {
      badge: "Observe",
      title: "Portfolio Overview",
      description: "Track cross-company readiness and operational posture.",
      hint: "Primary",
      onClick: () => {},
    },
    {
      badge: "Align",
      title: "Shared Standards",
      description: "Review the shared standards used across the group.",
      hint: "Policy",
      onClick: () => {},
    },
    {
      badge: "Escalate",
      title: "Exception Desk",
      description: "Surface the items that still need follow-up and coordination.",
      hint: "Follow-up",
      onClick: () => {},
    },
  ];

  const topActions = [
    {
      key: "focus-ga-queue",
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
      key: "ga-workspace-mode",
      label: "GA Workspace",
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
      id: "ga-home-focus-actions",
      group: "Current Screen",
      label: "Focus GA action queue",
      keywords: ["ga home", "actions", "dashboard"],
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
      eyebrow="Group Admin View"
      title="Group Admin Dashboard"
      subtitle="Keep a simple view of portfolio status, shared standards, and exception follow-up."
      stats={stats}
      actions={actions}
      topActions={topActions}
      workspaceTitle="Keyboard-Native Portfolio Queue"
      workspaceDescription="GA work now follows the same deterministic scaffold used by the rebuilt SA control plane."
      noteTitle="GA Keyboard Pattern"
      noteItems={[
        "Alt+Shift+P returns focus to the first GA action card.",
        "Arrow keys move across the dashboard action grid without pointer recovery.",
        "Ctrl+K stays available for cross-screen command routing inside the protected shell.",
      ]}
      summaryTitle="Group Oversight Snapshot"
      summaryItems={[
        "Portfolio monitoring now sits inside the shared keyboard-native grammar.",
        "Group standards, exception review, and future GA screens can reuse this same shell pattern.",
        "This keeps GA and SA universes aligned instead of diverging into different UI models.",
      ]}
    />
  );
}
