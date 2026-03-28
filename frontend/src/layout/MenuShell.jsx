/*
 * File-ID: 7.7
 * File-Path: frontend/src/layout/MenuShell.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Render the protected ERP shell using a dense SAP/Tally-style keyboard workspace grammar
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import {
  getScreenForRoute,
  getPreviousScreen,
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
import { subscribeRegisteredScreenCommands } from "../store/erpCommandPalette.js";
import { subscribeRegisteredScreenHotkeys } from "../store/erpScreenHotkeys.js";
import ErpCommandPalette from "../components/ErpCommandPalette.jsx";

const WORKSPACE_ZONES = Object.freeze(["menu", "actions", "content"]);
const SCREEN_HOTKEY_LABELS = Object.freeze({
  save: { key: "Ctrl+S", label: "Save" },
  refresh: { key: "Alt+R", label: "Refresh" },
  focusSearch: { key: "Alt+Shift+F", label: "Search" },
  focusPrimary: { key: "Alt+Shift+P", label: "Primary" },
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
      return "Allow popups to open the new ERP window.";
    case "SESSION_CLUSTER_ADMISSION_LIMIT_REACHED":
    case "SESSION_CLUSTER_OPEN_WINDOW_MAX_REACHED":
    case "SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED":
      return "Maximum 3 ERP windows are already open.";
    default:
      return "Unable to open a new ERP window right now.";
  }
}

function formatScreenTitle(screenCode) {
  return screenCode
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function zoneBorder(activeZone, zone) {
  return activeZone === zone ? "border-sky-500" : "border-slate-300";
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

  const previousScreen = getPreviousScreen();
  const workspaceMode = stackDepth > 1;

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
    }, 4000);

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

    const result = await requestOpenClusterWindow(homePath, {
      openedWindow: pendingWindow,
    });

    if (!result.ok) {
      setClusterWindowMessage(getClusterWindowErrorMessage(result.code));
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeWorkspaceFocusCommands((command) => {
      if (command === "GO_HOME") handleGoHome();
      if (command === "FOCUS_MENU_ZONE") focusZone("menu");
      if (command === "FOCUS_ACTIONS_ZONE") focusZone("actions");
      if (command === "FOCUS_CONTENT_ZONE") focusZone("content");
      if (command === "OPEN_NEW_WINDOW") void handleOpenNewWindow();
      if (command === "FOCUS_NEXT_ZONE") cycleZoneFocus(1);
      if (command === "FOCUS_PREVIOUS_ZONE") cycleZoneFocus(-1);
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
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f0f4f8] text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
        Loading workspace
      </div>
    );
  }

  const shellActions = [
    { label: "Esc", title: stackDepth <= 1 ? "Logout" : "Back", onClick: () => void handleBack() },
    { label: "Alt+H", title: "Home", onClick: handleGoHome },
    {
      label: collapsed ? "Ctrl+Right" : "Ctrl+Left",
      title: collapsed ? "Expand" : "Collapse",
      onClick: () => toggleSidebarCollapsed(),
    },
    { label: "Shift+F8", title: "Window", onClick: () => void handleOpenNewWindow() },
    { label: "Alt+L", title: "Lock", onClick: handleLockWorkspace },
    { label: "Ctrl+Shift+L", title: "Logout", onClick: () => void handleLogout() },
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
      keywords: ["home", "dashboard"],
      perform: handleGoHome,
      order: 20,
    },
    {
      id: "shell-window",
      group: "Shell",
      label: "Open new ERP window",
      hint: "Shift+F8",
      keywords: ["new window", "cluster"],
      perform: () => void handleOpenNewWindow(),
      order: 30,
    },
    {
      id: "shell-lock",
      group: "Shell",
      label: "Lock workspace",
      hint: "Alt+L",
      keywords: ["lock"],
      perform: handleLockWorkspace,
      order: 40,
    },
    {
      id: "shell-logout",
      group: "Shell",
      label: "Open logout confirmation",
      hint: "Ctrl+Shift+L",
      keywords: ["logout", "sign out"],
      perform: () => void handleLogout(),
      order: 50,
    },
    {
      id: "shell-focus-menu",
      group: "Focus",
      label: "Focus menu zone",
      hint: "Alt+M",
      keywords: ["menu"],
      perform: () => focusZone("menu"),
      order: 60,
    },
    {
      id: "shell-focus-actions",
      group: "Focus",
      label: "Focus action rail",
      hint: "Alt+A",
      keywords: ["actions"],
      perform: () => focusZone("actions"),
      order: 70,
    },
    {
      id: "shell-focus-content",
      group: "Focus",
      label: "Focus active work canvas",
      hint: "Alt+C",
      keywords: ["content"],
      perform: () => focusZone("content"),
      order: 80,
    },
  ];

  const menuCommands = menu
    .filter((item) => item.route_path)
    .map((item, index) => ({
      id: `menu-${item.menu_code}`,
      group: "Navigation",
      label: `Open ${item.title}`,
      hint: `${index + 1}`,
      keywords: [item.title, item.route_path].filter(Boolean),
      perform: () => handleMenuRoute(item.route_path),
      order: 200 + index,
    }));

  const visibleScreenCommands = activeScreenCommands.slice(0, workspaceMode ? 10 : 8);
  const workspaceMenuActions = [
    {
      key: "back",
      code: "Esc",
      title: stackDepth <= 1 ? "Logout" : "Back",
      onClick: () => void handleBack(),
    },
    {
      key: "home",
      code: "Alt+H",
      title: "Home",
      onClick: handleGoHome,
    },
    {
      key: "help",
      code: "?",
      title: "Help",
      onClick: () => setShowKeyboardHelp((current) => !current),
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#dfe7ef] text-slate-900">
      <aside
        aria-label="Workspace navigation"
        className={`flex shrink-0 flex-col border-r bg-[#f7f9fc] ${workspaceMode ? "w-[88px]" : collapsed ? "w-[88px]" : "w-[260px]"} ${zoneBorder(activeZone, "menu")}`}
      >
        <div className="border-b bg-[#1c5aa6] px-3 py-3 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em]">
            Pace ERP
          </p>
          {!workspaceMode && !collapsed ? (
            <>
              <p className="mt-2 text-xl font-semibold">{shellProfile?.roleCode || "ERP"}</p>
              <p className="text-sm opacity-90">{shellProfile?.userCode || "User"}</p>
            </>
          ) : workspaceMode ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em]">
              Stack
            </p>
          ) : null}
        </div>

        <div className="border-b bg-[#eef4fb] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {workspaceMode ? "Rail" : collapsed ? "Menu" : "Menu Zone"}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {workspaceMode ? (
            <div className="grid gap-1">
              {workspaceMenuActions.map((action, index) => (
                <button
                  key={action.key}
                  ref={(element) => {
                    menuButtonRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={action.onClick}
                  onFocus={() => {
                    setActiveZone("menu");
                    setMenuFocusIndex(index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveFocus(menuButtonRefs.current, index >= workspaceMenuActions.length - 1 ? 0 : index + 1);
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveFocus(menuButtonRefs.current, index <= 0 ? workspaceMenuActions.length - 1 : index - 1);
                    }
                  }}
                  className="grid justify-items-center gap-1 border border-slate-300 bg-white px-2 py-3 text-center hover:bg-slate-50"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                    {action.code}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-700">
                    {action.title}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <nav>
              <ul className="space-y-1">
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
                          className={`grid w-full items-center gap-2 border px-2 py-2 text-left text-sm ${collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[32px_minmax(0,1fr)]"} ${
                            isActive
                              ? "border-sky-400 bg-sky-50 font-semibold text-sky-900"
                              : "border-transparent bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <span className="font-mono text-[11px] text-slate-500">
                            {(index + 1).toString().padStart(2, "0")}
                          </span>
                          {!collapsed ? <span className="truncate">{item.title}</span> : null}
                        </button>
                      ) : (
                        <span className="block px-2 py-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                          {collapsed ? item.title.slice(0, 2).toUpperCase() : item.title}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>

        <div className="border-t bg-white px-2 py-2 text-center text-[11px] text-slate-500">
          {workspaceMode ? (
            <>
              <div className="font-semibold text-slate-700">{shellProfile?.roleCode || "ERP"}</div>
              <div className="mt-1 truncate">{shellProfile?.userCode || "User"}</div>
            </>
          ) : (
            <>{collapsed ? activeTitle.slice(0, 8) : activeTitle}</>
          )}
        </div>
      </aside>

      <main className={`flex min-w-0 flex-1 flex-col border-r bg-white ${zoneBorder(activeZone, "content")}`}>
        <header className="border-b bg-[#1c5aa6] px-4 py-2 text-white">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="font-semibold">
              {workspaceMode && previousScreen?.screen_code
                ? `${formatScreenTitle(previousScreen.screen_code)} / ${activeTitle}`
                : activeTitle}
            </span>
            <span>{shellProfile?.roleCode || "Role"}</span>
            <span>{shellProfile?.userCode || "User"}</span>
            <span>{workspaceMode ? `Stack ${stackDepth}` : `Zone ${WORKSPACE_ZONES.indexOf(activeZone) + 1}`}</span>
            {clusterAdmission?.windowSlot ? (
              <span>
                Window {clusterAdmission.windowSlot}/{clusterAdmission.maxWindowCount ?? 3}
              </span>
            ) : null}
          </div>
        </header>

        <div className="border-b bg-[#eef4fb] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {workspaceMode
            ? "Esc Back | Alt+H Home | Alt+A Function Rail | Alt+C Work Area | Ctrl+K Command Bar"
            : "Alt+M Menu | Alt+A Function Rail | Alt+C Work Area | Ctrl+K Command Bar"}
        </div>

        {showKeyboardHelp || clusterWindowMessage ? (
          <div className="border-b bg-[#fffdf2] px-4 py-2 text-sm text-slate-700">
            {clusterWindowMessage ? (
              <p>{clusterWindowMessage}</p>
            ) : (
              <p>
                Screen shortcuts:{" "}
                {activeScreenHotkeys.length > 0
                  ? activeScreenHotkeys.map((item) => `${item.key} ${item.label}`).join(" | ")
                  : "No extra route shortcuts"}
              </p>
            )}
          </div>
        ) : null}

        <div
          ref={contentRegionRef}
          tabIndex={-1}
          onFocus={() => setActiveZone("content")}
          aria-label="Active workspace content"
          className={`min-h-0 flex-1 overflow-y-auto bg-[#f7f9fc] outline-none ${workspaceMode ? "px-2 py-2" : "px-3 py-3"}`}
        >
          <Outlet />
        </div>

        <footer className="border-t bg-[#eef4fb] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Ctrl+S Save | Alt+R Refresh | Alt+Shift+F Search | Alt+Shift+P Primary | Esc Back
          {activeScreenHotkeys.length > 0
            ? ` | ${activeScreenHotkeys.map((item) => `${item.key} ${item.label}`).join(" | ")}`
            : ""}
        </footer>
      </main>

      <aside
        aria-label="Workspace action rail"
        className={`flex shrink-0 flex-col bg-[#f7f9fc] ${workspaceMode ? "w-[176px]" : "w-[196px]"} ${zoneBorder(activeZone, "actions")}`}
      >
        <div className="border-b bg-[#d9e7f8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Function Rail
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="grid gap-1">
            {shellActions.map((action, index) => (
              <button
                key={action.label + action.title}
                ref={(element) => {
                  actionButtonRefs.current[index] = element;
                }}
                type="button"
                onClick={action.onClick}
                onFocus={() => setActiveZone("actions")}
                onKeyDown={(event) => handleActionKeyDown(event, index)}
                className="grid grid-cols-[72px_minmax(0,1fr)] border border-slate-300 bg-white px-2 py-2 text-left hover:bg-slate-50"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                  {action.label}
                </span>
                <span className="truncate text-sm font-medium text-slate-800">
                  {action.title}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 border border-slate-300 bg-white">
            <div className="border-b bg-[#eef4fb] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Screen Shortcuts
            </div>
            <div className="px-3 py-2 text-xs leading-6 text-slate-700">
              {activeScreenHotkeys.length > 0 ? (
                activeScreenHotkeys.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-b-0">
                    <span>{item.label}</span>
                    <span className="font-semibold text-sky-700">{item.key}</span>
                  </div>
                ))
              ) : (
                <p>No extra route shortcuts.</p>
              )}
            </div>
          </div>

          <div className="mt-3 border border-slate-300 bg-white">
            <div className="border-b bg-[#eef4fb] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {workspaceMode ? "Page Commands" : "Current Screen"}
            </div>
            <div className="px-3 py-2 text-xs leading-6 text-slate-700">
              {visibleScreenCommands.length > 0 ? (
                visibleScreenCommands.map((command) => (
                  <div key={command.id} className="border-b border-slate-100 py-1 last:border-b-0">
                    <div className="font-medium text-slate-800">{command.label}</div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {command.hint || "Command"}
                    </div>
                  </div>
                ))
              ) : (
                <p>No current-screen commands.</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      <ErpCommandPalette
        activeRoute={location.pathname}
        shellCommands={shellCommands}
        menuCommands={menuCommands}
      />
    </div>
  );
}
