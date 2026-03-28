/*
 * File-ID: 7.7
 * File-Path: frontend/src/layout/MenuShell.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Render the protected ERP shell using fixed keyboard-native menu, action, and work zones
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import {
  getScreenForRoute,
  getStackDepth,
  openRoute,
  popScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";
import { confirmAndRequestLogout } from "../store/sessionWarning.js";
import {
  subscribeWorkspaceShell,
  toggleSidebarCollapsed,
  unsubscribeWorkspaceShell,
} from "../store/workspaceShell.js";
import { lockWorkspace } from "../store/workspaceLock.js";
import {
  getClusterAdmission,
  openPendingClusterWindow,
  requestOpenClusterWindow,
  subscribeClusterAdmission,
  unsubscribeClusterAdmission,
} from "../store/sessionCluster.js";
import { subscribeWorkspaceFocusCommands } from "../navigation/workspaceFocusBus.js";
import ErpCommandPalette from "../components/ErpCommandPalette.jsx";
import { subscribeRegisteredScreenCommands } from "../store/erpCommandPalette.js";
import { subscribeRegisteredScreenHotkeys } from "../store/erpScreenHotkeys.js";

const WORKSPACE_ZONES = Object.freeze(["menu", "actions", "content"]);
const SHORTCUT_GUIDE = Object.freeze([
  "Ctrl+K Command Bar",
  "Ctrl+S Save",
  "Alt+R Refresh",
  "Alt+Shift+F Search",
  "Alt+Shift+P Primary Focus",
  "Alt+M Menu Zone",
  "Alt+A Action Rail",
  "Alt+C Work Canvas",
  "Alt+H Home",
  "Alt+L Lock",
  "Ctrl+Shift+L Logout",
  "Esc Back",
]);
const SCREEN_HOTKEY_LABELS = Object.freeze({
  save: {
    key: "Ctrl+S",
    label: "Save current work",
  },
  refresh: {
    key: "Alt+R",
    label: "Refresh current surface",
  },
  focusSearch: {
    key: "Alt+Shift+F",
    label: "Focus search or filter target",
  },
  focusPrimary: {
    key: "Alt+Shift+P",
    label: "Focus primary work target",
  },
});

function focusElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  element.focus();
  return true;
}

function moveFocus(refs, nextIndex) {
  const target = refs[nextIndex];

  if (target instanceof HTMLElement) {
    target.focus();
  }
}

function isFocusableElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.hasAttribute("disabled")) {
    return false;
  }

  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  return true;
}

function findFirstFocusableWithin(container) {
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  const preferred = container.querySelector("[data-workspace-primary-focus='true']");
  if (isFocusableElement(preferred)) {
    return preferred;
  }

  const focusable = container.querySelectorAll(
    "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  );

  return (
    Array.from(focusable).find((element) => isFocusableElement(element)) ?? null
  );
}

function getClusterWindowErrorMessage(code) {
  switch (code) {
    case "SESSION_CLUSTER_WINDOW_POPUP_BLOCKED":
      return "Browser blocked the new ERP window. Allow popups for this site and try again.";
    case "SESSION_CLUSTER_OPEN_WINDOW_BLOCKED":
    case "SESSION_CLUSTER_OPEN_WINDOW_FAILED":
      return "Unable to open a new ERP window right now. Please try again.";
    case "SESSION_CLUSTER_ADMISSION_LIMIT_REACHED":
    case "SESSION_CLUSTER_OPEN_WINDOW_MAX_REACHED":
    case "SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED":
      return "Maximum 3 ERP windows are already open for this session.";
    case "SESSION_CLUSTER_WINDOW_NAVIGATION_FAILED":
      return "A new window opened, but navigation into the ERP workspace failed.";
    default:
      return "Unable to open a new ERP window right now.";
  }
}

function getZoneShellClass(active, zone) {
  return active === zone
    ? "border-emerald-400/70 shadow-[0_0_0_1px_rgba(52,211,153,0.22)]"
    : "border-white/8";
}

function formatScreenTitle(screenCode) {
  return screenCode
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export default function MenuShell() {
  const location = useLocation();
  const { menu, loading, shellProfile } = useMenu();
  const [collapsed, setCollapsed] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [activeZone, setActiveZone] = useState("content");
  const [menuFocusIndex, setMenuFocusIndex] = useState(0);
  const [clusterAdmission, setClusterAdmission] = useState(() =>
    getClusterAdmission()
  );
  const [clusterWindowMessage, setClusterWindowMessage] = useState("");
  const [screenCommandRegistry, setScreenCommandRegistry] = useState(() => new Map());
  const [screenHotkeyRegistry, setScreenHotkeyRegistry] = useState(() => new Map());

  const menuButtonRefs = useRef([]);
  const actionButtonRefs = useRef([]);
  const contentRegionRef = useRef(null);
  const stackDepth = getStackDepth();

  const activeMenuIndex = useMemo(
    () => menu.findIndex((item) => item.route_path === location.pathname),
    [location.pathname, menu]
  );
  const resolvedMenuFocusIndex =
    menuFocusIndex >= 0 && menuFocusIndex < menu.length
      ? menuFocusIndex
      : activeMenuIndex >= 0
        ? activeMenuIndex
        : 0;

  const activeTitle = useMemo(() => {
    const menuMatch = menu.find((item) => item.route_path === location.pathname);
    if (menuMatch?.title) {
      return menuMatch.title;
    }

    const screenMatch = getScreenForRoute(location.pathname);
    if (screenMatch?.screen_code) {
      return formatScreenTitle(screenMatch.screen_code);
    }

    return "Workspace";
  }, [location.pathname, menu]);
  const activeScreenCommands = useMemo(
    () =>
      (screenCommandRegistry.get(location.pathname) ?? [])
        .filter((command) => !command.disabled)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    [location.pathname, screenCommandRegistry]
  );
  const activeScreenHotkeys = useMemo(() => {
    const routeHotkeys = screenHotkeyRegistry.get(location.pathname) ?? {};

    return Object.entries(SCREEN_HOTKEY_LABELS)
      .map(([type, meta]) => {
        const action = routeHotkeys[type];

        if (!action || action.disabled) {
          return null;
        }

        return {
          id: type,
          key: meta.key,
          label: meta.label,
        };
      })
      .filter(Boolean);
  }, [location.pathname, screenHotkeyRegistry]);

  useEffect(() => {
    document.body.dataset.workspaceMode = "protected";

    return () => {
      delete document.body.dataset.workspaceMode;
    };
  }, []);

  useEffect(() => {
    const listener = (snapshot) => {
      setCollapsed(snapshot.sidebarCollapsed);
    };

    subscribeWorkspaceShell(listener);
    return () => unsubscribeWorkspaceShell(listener);
  }, []);

  useEffect(() => {
    const listener = (snapshot) => {
      setClusterAdmission(snapshot);
    };

    subscribeClusterAdmission(listener);
    return () => unsubscribeClusterAdmission(listener);
  }, []);

  useEffect(() => {
    const unsubscribeCommands = subscribeRegisteredScreenCommands((snapshot) => {
      setScreenCommandRegistry(snapshot);
    });
    const unsubscribeHotkeys = subscribeRegisteredScreenHotkeys((snapshot) => {
      setScreenHotkeyRegistry(snapshot);
    });

    return () => {
      unsubscribeCommands();
      unsubscribeHotkeys();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target =
        findFirstFocusableWithin(contentRegionRef.current) ?? contentRegionRef.current;
      focusElement(target);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => {
    if (!clusterWindowMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setClusterWindowMessage("");
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [clusterWindowMessage]);

  const focusContentZone = useCallback(() => {
    const target =
      findFirstFocusableWithin(contentRegionRef.current) ?? contentRegionRef.current;

    if (focusElement(target)) {
      setActiveZone("content");
    }
  }, []);

  const focusZone = useCallback(
    (zone) => {
      if (zone === "menu") {
        const button =
          menuButtonRefs.current[resolvedMenuFocusIndex] ??
          menuButtonRefs.current.find((item) => item instanceof HTMLElement);

        if (focusElement(button)) {
          setActiveZone("menu");
        }

        return;
      }

      if (zone === "actions") {
        const button = actionButtonRefs.current.find(
          (item) => item instanceof HTMLElement
        );

        if (focusElement(button)) {
          setActiveZone("actions");
        }

        return;
      }

      focusContentZone();
    },
    [focusContentZone, resolvedMenuFocusIndex]
  );

  const cycleZoneFocus = useCallback(
    (direction) => {
      const currentIndex = WORKSPACE_ZONES.indexOf(activeZone);
      const nextIndex =
        (currentIndex + direction + WORKSPACE_ZONES.length) %
        WORKSPACE_ZONES.length;

      focusZone(WORKSPACE_ZONES[nextIndex]);
    },
    [activeZone, focusZone]
  );

  function getHomeRouteTarget() {
    if (location.pathname.startsWith("/sa")) {
      return "SA_HOME";
    }

    if (location.pathname.startsWith("/ga")) {
      return "GA_HOME";
    }

    return "DASHBOARD_HOME";
  }

  function handleMenuRoute(routePath) {
    if (!getScreenForRoute(routePath)) {
      console.warn(`[NAVIGATION_ROUTE_MISSING] ${routePath}`);
      return;
    }

    openRoute(routePath);
  }

  async function handleLogout() {
    await confirmAndRequestLogout();
  }

  async function handleBack() {
    if (stackDepth <= 1) {
      await confirmAndRequestLogout();
      return;
    }

    popScreen();
  }

  function handleGoHome() {
    resetToScreen(getHomeRouteTarget());
  }

  function handleLockWorkspace() {
    lockWorkspace();
  }

  async function handleOpenNewWindow() {
    const homePath = location.pathname.startsWith("/sa")
      ? "/sa/home"
      : location.pathname.startsWith("/ga")
        ? "/ga/home"
        : "/dashboard";
    const pendingWindow = openPendingClusterWindow();

    if (!pendingWindow) {
      setClusterWindowMessage(
        getClusterWindowErrorMessage("SESSION_CLUSTER_WINDOW_POPUP_BLOCKED")
      );
      return;
    }

    setClusterWindowMessage("");

    const result = await requestOpenClusterWindow(homePath, {
      openedWindow: pendingWindow,
    });

    if (!result.ok) {
      setClusterWindowMessage(getClusterWindowErrorMessage(result.code));
      console.error("SESSION_CLUSTER_OPEN_WINDOW_FAILED", result.code);
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeWorkspaceFocusCommands((command) => {
      if (command === "GO_HOME") {
        handleGoHome();
      }

      if (command === "FOCUS_MENU_ZONE") {
        focusZone("menu");
      }

      if (command === "FOCUS_ACTIONS_ZONE") {
        focusZone("actions");
      }

      if (command === "FOCUS_CONTENT_ZONE") {
        focusZone("content");
      }

      if (command === "OPEN_NEW_WINDOW") {
        void handleOpenNewWindow();
      }

      if (command === "FOCUS_NEXT_ZONE") {
        cycleZoneFocus(1);
      }

      if (command === "FOCUS_PREVIOUS_ZONE") {
        cycleZoneFocus(-1);
      }

      if (command === "TOGGLE_SHORTCUT_HELP") {
        setShowKeyboardHelp((current) => !current);
      }
    });

    return unsubscribe;
  }, [cycleZoneFocus, focusZone]);

  function handleMenuKeyDown(event, index) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (index + 1) % menu.length;
      setMenuFocusIndex(nextIndex);
      moveFocus(menuButtonRefs.current, nextIndex);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = (index - 1 + menu.length) % menu.length;
      setMenuFocusIndex(nextIndex);
      moveFocus(menuButtonRefs.current, nextIndex);
    }

    if (event.key === "Home") {
      event.preventDefault();
      setMenuFocusIndex(0);
      moveFocus(menuButtonRefs.current, 0);
    }

    if (event.key === "End") {
      event.preventDefault();
      const nextIndex = menu.length - 1;
      setMenuFocusIndex(nextIndex);
      moveFocus(menuButtonRefs.current, nextIndex);
    }
  }

  function handleActionKeyDown(event, index) {
    const maxIndex = actionButtonRefs.current.length - 1;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(actionButtonRefs.current, index >= maxIndex ? 0 : index + 1);
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(actionButtonRefs.current, index <= 0 ? maxIndex : index - 1);
    }

    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(actionButtonRefs.current, 0);
    }

    if (event.key === "End") {
      event.preventDefault();
      moveFocus(actionButtonRefs.current, maxIndex);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#061017] text-sm uppercase tracking-[0.24em] text-slate-400">
        Loading governed workspace
      </div>
    );
  }

  const shellActions = [
    {
      label: stackDepth <= 1 ? "Logout Flow" : "Back",
      hint: "Esc",
      onClick: () => void handleBack(),
      tone: "warning",
    },
    {
      label: "Home",
      hint: "Alt+H",
      onClick: handleGoHome,
      tone: "primary",
    },
    {
      label: collapsed ? "Expand Menu" : "Collapse Menu",
      hint: collapsed ? "Ctrl+Right" : "Ctrl+Left",
      onClick: () => toggleSidebarCollapsed(),
      tone: "neutral",
    },
    {
      label: "New Window",
      hint: "Shift+F8",
      onClick: () => void handleOpenNewWindow(),
      tone: "neutral",
    },
    {
      label: "Lock",
      hint: "Alt+L",
      onClick: handleLockWorkspace,
      tone: "neutral",
    },
    {
      label: showKeyboardHelp ? "Hide Help" : "Show Help",
      hint: "?",
      onClick: () => setShowKeyboardHelp((current) => !current),
      tone: "neutral",
    },
    {
      label: "Logout",
      hint: "Ctrl+Shift+L",
      onClick: () => void handleLogout(),
      tone: "danger",
    },
  ];

  const shellCommands = [
    {
      id: "shell-back",
      group: "Shell",
      label: stackDepth <= 1 ? "Exit to logout confirmation" : "Back one screen",
      hint: "Esc",
      keywords: ["back", "previous", "logout"],
      perform: () => void handleBack(),
      order: 10,
    },
    {
      id: "shell-home",
      group: "Shell",
      label: "Go to dashboard home",
      hint: "Alt+H",
      keywords: ["home", "dashboard", "start"],
      perform: handleGoHome,
      order: 20,
    },
    {
      id: "shell-toggle-menu",
      group: "Shell",
      label: collapsed ? "Expand menu zone" : "Collapse menu zone",
      hint: collapsed ? "Ctrl+Right" : "Ctrl+Left",
      keywords: ["sidebar", "menu", "collapse", "expand"],
      perform: () => toggleSidebarCollapsed(),
      order: 25,
    },
    {
      id: "shell-window",
      group: "Shell",
      label: "Open new ERP window",
      hint: "Shift+F8",
      keywords: ["new window", "side by side", "cluster"],
      perform: () => void handleOpenNewWindow(),
      order: 30,
    },
    {
      id: "shell-lock",
      group: "Shell",
      label: "Lock workspace",
      hint: "Alt+L",
      keywords: ["lock", "secure", "pause"],
      perform: handleLockWorkspace,
      order: 40,
    },
    {
      id: "shell-logout",
      group: "Shell",
      label: "Open logout confirmation",
      hint: "Ctrl+Shift+L",
      keywords: ["logout", "sign out", "session"],
      perform: () => void handleLogout(),
      order: 50,
    },
    {
      id: "shell-focus-menu",
      group: "Focus",
      label: "Focus menu zone",
      hint: "Alt+M",
      keywords: ["focus", "zone", "menu"],
      perform: () => focusZone("menu"),
      order: 60,
    },
    {
      id: "shell-focus-actions",
      group: "Focus",
      label: "Focus action rail",
      hint: "Alt+A",
      keywords: ["focus", "actions", "rail"],
      perform: () => focusZone("actions"),
      order: 70,
    },
    {
      id: "shell-focus-content",
      group: "Focus",
      label: "Focus active work canvas",
      hint: "Alt+C",
      keywords: ["focus", "content", "work canvas"],
      perform: () => focusZone("content"),
      order: 80,
    },
    {
      id: "shell-help",
      group: "Shell",
      label: showKeyboardHelp ? "Hide keyboard help" : "Show keyboard help",
      hint: "?",
      keywords: ["keyboard help", "shortcut guide", "help"],
      perform: () => setShowKeyboardHelp((current) => !current),
      order: 90,
    },
  ];

  const menuCommands = menu
    .filter((item) => item.route_path)
    .map((item, index) => ({
      id: `menu-${item.menu_code}`,
      group: "Navigation",
      label: `Open ${item.title}`,
      hint: `${index + 1}`,
      keywords: [item.title, item.route_path, item.menu_code].filter(Boolean),
      perform: () => handleMenuRoute(item.route_path),
      order: 200 + index,
    }));

  const universeCommands = [];

  if (location.pathname.startsWith("/sa")) {
    universeCommands.push(
      {
        id: "sa-open-project-master",
        group: "Navigation",
        label: "Open Project Master",
        keywords: ["project master", "org master", "projects"],
        perform: () => openRoute("/sa/project-master"),
        order: 320,
      },
      {
        id: "sa-open-role-permissions",
        group: "Navigation",
        label: "Open ACL Role Permissions",
        keywords: ["acl", "role permissions", "permission matrix"],
        perform: () => openRoute("/sa/acl/role-permissions"),
        order: 321,
      },
      {
        id: "sa-open-approval-rules",
        group: "Navigation",
        label: "Open Approval Rules",
        keywords: ["approval rules", "approver scope", "workflow routing"],
        perform: () => openRoute("/sa/approval-rules"),
        order: 322,
      },
      {
        id: "sa-open-company-modules",
        group: "Navigation",
        label: "Open Company Module Map",
        keywords: ["company modules", "module map", "acl module enablement"],
        perform: () => openRoute("/sa/acl/company-modules"),
        order: 323,
      }
    );
  }

  const visibleScreenCommands = activeScreenCommands.slice(0, 6);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#061017] text-slate-100 lg:flex-row">
      <aside
        aria-label="Workspace navigation"
        className={`flex shrink-0 flex-col overflow-hidden border-b border-r bg-[#0a171d] transition-all duration-150 lg:border-b-0 ${collapsed ? "lg:w-[92px]" : "lg:w-[272px]"} ${getZoneShellClass(activeZone, "menu")}`}
      >
        <div className="border-b border-white/8 bg-[#071116] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-emerald-300">
                Pace ERP
              </p>
              {!collapsed ? (
                <>
                  <h1 className="mt-2 text-sm font-semibold text-slate-50">
                    {shellProfile?.roleCode || "Protected Workspace"}
                  </h1>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                    {shellProfile?.userCode || "ERP Operator"}
                  </p>
                </>
              ) : null}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              Z1
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className={`mb-3 ${collapsed ? "text-center" : ""}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {collapsed ? "Nav" : "Menu Zone"}
            </p>
            {!collapsed ? (
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Arrow keys move through governed routes. Alt+M always returns here.
              </p>
            ) : null}
          </div>

          <nav>
            <ul className="space-y-2">
              {menu.map((item, index) => {
                const isActive = location.pathname === item.route_path;

                return (
                  <li key={item.menu_code}>
                    {item.route_path ? (
                      <button
                        ref={(element) => {
                          menuButtonRefs.current[index] = element;
                        }}
                        type="button"
                        onFocus={() => {
                          setActiveZone("menu");
                          setMenuFocusIndex(index);
                        }}
                        onKeyDown={(event) => handleMenuKeyDown(event, index)}
                        onClick={() => handleMenuRoute(item.route_path)}
                        aria-current={isActive ? "page" : undefined}
                        className={`grid w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[34px_minmax(0,1fr)]"} ${
                          isActive
                            ? "border-emerald-400/60 bg-emerald-400/12 text-white"
                            : "border-white/6 bg-white/[0.03] text-slate-200 hover:border-white/12 hover:bg-white/[0.05]"
                        }`}
                      >
                        <span className="font-mono text-[11px] font-semibold text-slate-400">
                          {(index + 1).toString().padStart(2, "0")}
                        </span>
                        {!collapsed ? (
                          <span className="truncate text-sm font-medium">
                            {item.title}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <span className="block rounded-2xl border border-white/4 bg-white/[0.02] px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                        {collapsed ? item.title.slice(0, 2).toUpperCase() : item.title}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <div className="border-t border-white/8 bg-[#071116] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Active Route
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            {collapsed ? activeTitle.slice(0, 10) : activeTitle}
          </p>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-white/8 lg:border-b-0 lg:border-x">
        <header className="border-b border-white/8 bg-[#09151b] px-4 py-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_340px]">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  {shellProfile?.roleCode || "Protected Role"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  {shellProfile?.userCode || "ERP User"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  Zone {WORKSPACE_ZONES.indexOf(activeZone) + 1}
                </span>
                {clusterAdmission?.windowSlot ? (
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">
                    Window {clusterAdmission.windowSlot}/
                    {clusterAdmission.maxWindowCount ?? 3}
                  </span>
                ) : null}
              </div>

              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                {activeTitle}
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
                Keyboard-native operator canvas with stable menu, stable action rail, and deterministic work-area return. Use Alt+M, Alt+A, and Alt+C instead of mouse recovery.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Focus Ownership
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-200">
                <div className="flex items-center justify-between rounded-2xl border border-white/6 bg-black/10 px-3 py-2">
                  <span>Menu Zone</span>
                  <span className={activeZone === "menu" ? "text-emerald-300" : "text-slate-500"}>
                    Alt+M
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/6 bg-black/10 px-3 py-2">
                  <span>Action Rail</span>
                  <span className={activeZone === "actions" ? "text-emerald-300" : "text-slate-500"}>
                    Alt+A
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/6 bg-black/10 px-3 py-2">
                  <span>Work Canvas</span>
                  <span className={activeZone === "content" ? "text-emerald-300" : "text-slate-500"}>
                    Alt+C
                  </span>
                </div>
              </div>
            </div>
          </div>

          {showKeyboardHelp ? (
            <div className="mt-4 grid gap-3 rounded-[24px] border border-white/8 bg-[#0d1f28] px-4 py-4 text-sm text-slate-200 xl:grid-cols-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Menu
                </p>
                <p className="mt-2 leading-6 text-slate-300">
                  Arrow Up and Arrow Down move through governed routes. Home and End jump to route boundaries.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Action Rail
                </p>
                <p className="mt-2 leading-6 text-slate-300">
                  Arrow keys rotate through shell actions. Esc stays back-oriented, not context-breaking.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Work Canvas
                </p>
                <p className="mt-2 leading-6 text-slate-300">
                  Alt+Shift+F jumps into filters, Alt+Shift+P jumps into the page primary target, and Ctrl+K stays the universal command doorway.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Current Screen Hotkeys
                </p>
                <div className="mt-2 grid gap-2">
                  {activeScreenHotkeys.length > 0 ? (
                    activeScreenHotkeys.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/10 px-3 py-2"
                      >
                        <span className="text-slate-300">{item.label}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                          {item.key}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="leading-6 text-slate-400">
                      This surface has no extra hotkeys registered beyond the shell defaults.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {clusterWindowMessage ? (
            <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              {clusterWindowMessage}
            </div>
          ) : null}
        </header>

        <div
          ref={contentRegionRef}
          tabIndex={-1}
          onFocus={() => setActiveZone("content")}
          aria-label="Active workspace content"
          className={`min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.09),_transparent_30%),linear-gradient(180deg,_rgba(6,16,23,1)_0%,_rgba(8,20,28,1)_100%)] px-3 py-3 outline-none md:px-4 md:py-4 ${getZoneShellClass(activeZone, "content")}`}
        >
          <Outlet />
        </div>

        <footer className="border-t border-white/8 bg-[#071116] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {SHORTCUT_GUIDE.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300"
              >
                {item}
              </span>
            ))}
            {activeScreenHotkeys.map((item) => (
              <span
                key={item.id}
                className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100"
              >
                {item.key} {item.label}
              </span>
            ))}
          </div>
        </footer>
      </main>

      <aside
        aria-label="Workspace action rail"
        className={`flex shrink-0 flex-col border-t border-white/8 bg-[#0a171d] lg:w-[260px] lg:border-t-0 ${getZoneShellClass(activeZone, "actions")}`}
      >
        <div className="border-b border-white/8 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Action Rail
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                Stable shell actions stay here for every screen.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              Z2
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className="grid gap-2">
            {shellActions.map((action, index) => {
              const toneClass =
                action.tone === "danger"
                  ? "border-rose-400/30 bg-rose-400/12 text-rose-100"
                  : action.tone === "warning"
                    ? "border-amber-400/30 bg-amber-300/12 text-amber-50"
                    : action.tone === "primary"
                      ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-50"
                      : "border-white/8 bg-white/[0.04] text-slate-100";

              return (
                <button
                  key={action.label + action.hint}
                  ref={(element) => {
                    actionButtonRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={action.onClick}
                  onFocus={() => setActiveZone("actions")}
                  onKeyDown={(event) => handleActionKeyDown(event, index)}
                  className={`grid w-full gap-1 rounded-2xl border px-4 py-3 text-left transition hover:bg-white/[0.08] ${toneClass}`}
                >
                  <span className="text-sm font-semibold">{action.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    {action.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-[22px] border border-white/8 bg-[#091319] px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Current Screen Shortcuts
            </p>
            <div className="mt-3 grid gap-2">
              {activeScreenHotkeys.length > 0 ? (
                activeScreenHotkeys.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2"
                  >
                    <span className="text-xs text-slate-300">{item.label}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                      {item.key}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs leading-5 text-slate-400">
                  No extra route-level hotkeys are registered on this screen yet.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border border-white/8 bg-[#091319] px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Current Screen Commands
            </p>
            <div className="mt-3 grid gap-2">
              {visibleScreenCommands.length > 0 ? (
                visibleScreenCommands.map((command) => (
                  <div
                    key={command.id}
                    className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-slate-200">
                        {command.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        {command.hint || "Command"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs leading-5 text-slate-400">
                  No route-level screen commands are visible here yet. Shell commands remain available through Ctrl+K.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-white/8 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Current Stack
          </p>
          <p className="mt-2 text-sm text-slate-200">
            {stackDepth <= 1 ? "Root surface" : `${stackDepth} screens in stack`}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Action rail stays stable so keyboard flow never needs mouse rescue.
          </p>
        </div>
      </aside>

      <ErpCommandPalette
        activeRoute={location.pathname}
        shellCommands={shellCommands}
        menuCommands={[...menuCommands, ...universeCommands]}
      />
    </div>
  );
}
