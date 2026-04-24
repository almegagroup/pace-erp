import { useRef } from "react";
import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { dispatchWorkspaceFocusCommand } from "../../../navigation/workspaceFocusBus.js";
import { openErpCommandPalette } from "../../../store/erpCommandPalette.js";

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
      title: "Workspace Focus",
      description: "Jump straight into the active work area and continue operating without pointer travel.",
      hint: "Enter Focus",
      onClick: () => dispatchWorkspaceFocusCommand("FOCUS_CONTENT_ZONE"),
    },
    {
      badge: "Align",
      title: "Command Routing",
      description: "Open the command palette to reach the next allowed GA or shell action immediately.",
      hint: "Ctrl+K / F9",
      onClick: () => openErpCommandPalette(),
    },
    {
      badge: "Escalate",
      title: "New Workspace Window",
      description: "Open another ERP window when portfolio review needs side-by-side monitoring.",
      hint: "Shift+F8",
      onClick: () => dispatchWorkspaceFocusCommand("OPEN_NEW_WINDOW"),
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
    {
      id: "ga-home-open-command-routing",
      group: "Current Screen",
      label: "Open command routing",
      keywords: ["ga home", "command palette", "routing"],
      perform: () => openErpCommandPalette(),
      order: 20,
    },
    {
      id: "ga-home-open-new-window",
      group: "Current Screen",
      label: "Open another workspace window",
      keywords: ["ga home", "new window", "multi window"],
      perform: () => dispatchWorkspaceFocusCommand("OPEN_NEW_WINDOW"),
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
      eyebrow="Group Admin View"
      title="Group Admin Dashboard"
      stats={stats}
      actions={actions}
      topActions={topActions}
      footerHints={[
        "ALT+SHIFT+P FOCUS QUEUE",
        "ENTER OPEN",
        "CTRL+K COMMAND BAR",
      ]}
      workspaceTitle="Keyboard-Native Portfolio Queue"
      noteTitle="GA Keyboard Pattern"
      noteItems={[
        "Alt+Shift+P returns focus to the first GA action card.",
        "Arrow keys move across the dashboard action grid without pointer recovery.",
        "Ctrl+K or F9 opens cross-screen command routing inside the protected shell.",
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
