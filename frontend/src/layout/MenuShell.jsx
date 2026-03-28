/*
 * File-ID: 7.7
 * File-Path: frontend/src/layout/MenuShell.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Render protected ERP shell from backend menu snapshot with keyboard-first workspace flow
 * Authority: Frontend
 */

import { useMenu } from "../context/useMenu.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  getScreenForRoute,
  getStackDepth,
  openRoute,
  popScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";
import {
  confirmAndRequestLogout,
  requestLogout,
} from "../store/sessionWarning.js";
import {
  subscribeWorkspaceShell,
  toggleSidebarCollapsed,
  unsubscribeWorkspaceShell,
} from "../store/workspaceShell.js";
import { lockWorkspace } from "../store/workspaceLock.js";
import {
  getClusterAdmission,
  requestOpenClusterWindow,
  subscribeClusterAdmission,
  unsubscribeClusterAdmission,
} from "../store/sessionCluster.js";
import { subscribeWorkspaceFocusCommands } from "../navigation/workspaceFocusBus.js";

const DASHBOARD_ROUTES = new Set(["/sa/home", "/ga/home", "/dashboard"]);
const DASHBOARD_ZONES = Object.freeze(["menu", "actions", "content"]);
const TASK_ZONES = Object.freeze(["actions", "content"]);

const DASHBOARD_SHORTCUT_GUIDE = Object.freeze([
  "Alt+C Work area",
  "Alt+M Menu",
  "Alt+A Top actions",
  "Alt+H Dashboard home",
  "F6 Next zone",
  "Shift+F6 Previous zone",
  "Ctrl+Shift+N New window",
  "Ctrl+Left Hide menu",
  "Ctrl+Right Show menu",
]);

const TASK_SHORTCUT_GUIDE = Object.freeze([
  "Alt+C Work area",
  "Alt+A Page actions",
  "Alt+H Dashboard home",
  "Esc Back",
  "Alt+L Lock workspace",
  "Ctrl+Shift+L Logout confirm",
]);

function focusElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  element.focus();
  return true;
}

function moveFocus(refs, nextIndex) {
  const target = refs[nextIndex];

  if (!(target instanceof HTMLElement)) {
    return;
  }

  target.focus();
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

export default function MenuShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [activeZone, setActiveZone] = useState("content");
  const [menuFocusIndex, setMenuFocusIndex] = useState(0);
  const [clusterAdmission, setClusterAdmission] = useState(() =>
    getClusterAdmission()
  );

  const menuButtonRefs = useRef([]);
  const actionButtonRefs = useRef([]);
  const contentRegionRef = useRef(null);

  const { menu, loading, shellProfile } = useMenu();
  const shellMode = DASHBOARD_ROUTES.has(location.pathname)
    ? "dashboard"
    : "task";
  const workspaceZones =
    shellMode === "dashboard" ? DASHBOARD_ZONES : TASK_ZONES;
  const shortcutGuide =
    shellMode === "dashboard"
      ? DASHBOARD_SHORTCUT_GUIDE
      : TASK_SHORTCUT_GUIDE;
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
    if (menuMatch?.title) return menuMatch.title;

    const screenMatch = getScreenForRoute(location.pathname);
    if (screenMatch?.screen_code) {
      return screenMatch.screen_code
        .split("_")
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(" ");
    }

    return "Workspace";
  }, [location.pathname, menu]);

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
    setShowKeyboardHelp(false);
  }, [shellMode]);

  useEffect(() => {
    if (!workspaceZones.includes(activeZone)) {
      setActiveZone(workspaceZones[workspaceZones.length - 1]);
    }
  }, [activeZone, workspaceZones]);

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
    await requestLogout();
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
    const result = await requestOpenClusterWindow(
      location.pathname.startsWith("/sa")
        ? "/sa/home"
        : location.pathname.startsWith("/ga")
          ? "/ga/home"
          : "/dashboard"
    );

    if (!result.ok) {
      console.error("SESSION_CLUSTER_OPEN_WINDOW_FAILED", result.code);
    }
  }

  const focusContentZone = useCallback(() => {
    const target =
      findFirstFocusableWithin(contentRegionRef.current) ?? contentRegionRef.current;

    if (focusElement(target)) {
      setActiveZone("content");
    }
  }, []);

  const focusZone = useCallback(
    (zone) => {
      if (zone === "menu" && shellMode !== "dashboard") {
        zone = "actions";
      }

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
    [focusContentZone, resolvedMenuFocusIndex, shellMode]
  );

  const cycleZoneFocus = useCallback(
    (direction) => {
      const currentIndex = workspaceZones.indexOf(activeZone);
      const nextIndex =
        (currentIndex + direction + workspaceZones.length) %
        workspaceZones.length;

      focusZone(workspaceZones[nextIndex]);
    },
    [activeZone, focusZone, workspaceZones]
  );

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

  useEffect(() => {
    if (shellMode === "task") {
      const timer = globalThis.setTimeout(() => {
        focusContentZone();
      }, 0);

      return () => globalThis.clearTimeout(timer);
    }
  }, [focusContentZone, location.pathname, shellMode]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        shellMode === "dashboard" &&
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        void handleOpenNewWindow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [location.pathname, shellMode]);

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
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const nextIndex = (index + 1) % actionButtonRefs.current.length;
      moveFocus(actionButtonRefs.current, nextIndex);
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const nextIndex =
        (index - 1 + actionButtonRefs.current.length) %
        actionButtonRefs.current.length;
      moveFocus(actionButtonRefs.current, nextIndex);
    }

    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(actionButtonRefs.current, 0);
    }

    if (event.key === "End") {
      event.preventDefault();
      moveFocus(actionButtonRefs.current, actionButtonRefs.current.length - 1);
    }
  }

  if (loading) {
    return <div>Loading Menu...</div>;
  }

  const headerActions = [
    {
      label: stackDepth <= 1 ? "Logout" : "Back",
      hint: "Esc",
      onClick: () => void handleBack(),
    },
    {
      label: "Dashboard",
      hint: "Alt+H",
      onClick: handleGoHome,
    },
    {
      label: "Lock",
      hint: "Alt+L",
      onClick: handleLockWorkspace,
    },
    {
      label: "Logout",
      hint: "Ctrl+Shift+L",
      onClick: () => void handleLogout(),
    },
  ];

  if (shellMode === "dashboard") {
    headerActions.splice(2, 0, {
      label: "New Window",
      hint: "Ctrl+Shift+N",
      onClick: () => void handleOpenNewWindow(),
    });

    headerActions.splice(2, 0, {
      label: collapsed ? "Show Menu" : "Hide Menu",
      hint: collapsed ? "Ctrl+Right" : "Ctrl+Left",
      onClick: () => toggleSidebarCollapsed(),
    });
  }

  const zoneNumber = workspaceZones.indexOf(activeZone) + 1;
  const isSidebarVisible = shellMode === "dashboard";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "#dfe7ec",
        color: "#0f172a",
      }}
    >
      {isSidebarVisible ? (
        <aside
          aria-label="Workspace navigation"
          style={{
            width: collapsed ? "92px" : "290px",
            transition: "width 140ms ease",
            borderRight: "1px solid #9fb3c2",
            display: "flex",
            flexDirection: "column",
            background: "#183447",
            color: "#f8fafc",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 14px 14px",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              background: "#102939",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: "11px",
                    letterSpacing: "0.24em",
                    textTransform: "uppercase",
                    color: "#8ed0f7",
                    fontWeight: 700,
                  }}
                >
                  Pace ERP
                </p>
                {!collapsed ? (
                  <>
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#f8fafc",
                      }}
                    >
                      {shellProfile?.roleCode || "Protected Workspace"}
                    </p>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: "12px",
                        color: "rgba(255,255,255,0.72)",
                      }}
                    >
                      {shellProfile?.userCode || "ERP Operator"}
                    </p>
                  </>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => toggleSidebarCollapsed()}
                title={collapsed ? "Show menu" : "Hide menu"}
                style={{
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {collapsed ? ">" : "<"}
              </button>
            </div>
          </div>

          <div style={{ padding: "12px", flex: 1, overflowY: "auto" }}>
            {!collapsed ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "12px",
                  margin: "0 6px 10px",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  color: "rgba(255,255,255,0.58)",
                  fontWeight: 700,
                }}
              >
                <span>Navigation</span>
                <span>Zone 1</span>
              </div>
            ) : null}

            <nav>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {menu.map((item, index) => {
                  const isActive = location.pathname === item.route_path;

                  return (
                    <li key={item.menu_code} style={{ marginBottom: "6px" }}>
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
                          style={{
                            width: "100%",
                            display: "grid",
                            gridTemplateColumns: collapsed ? "1fr" : "44px 1fr",
                            alignItems: "center",
                            gap: "10px",
                            border: isActive
                              ? "1px solid rgba(126,203,255,0.66)"
                              : "1px solid rgba(255,255,255,0.06)",
                            borderRadius: "10px",
                            background: isActive ? "#245574" : "transparent",
                            padding: collapsed ? "12px 8px" : "12px 12px",
                            color: "#f8fafc",
                            cursor: isActive ? "default" : "pointer",
                            textAlign: "left",
                            fontSize: "13px",
                            fontWeight: isActive ? 700 : 600,
                          }}
                        >
                          {collapsed ? (
                            <span
                              style={{
                                textAlign: "center",
                                fontFamily: "Consolas, 'Courier New', monospace",
                                fontSize: "12px",
                              }}
                            >
                              {(index + 1).toString().padStart(2, "0")}
                            </span>
                          ) : (
                            <span
                              style={{
                                color: "rgba(255,255,255,0.66)",
                                fontFamily: "Consolas, 'Courier New', monospace",
                                fontSize: "12px",
                              }}
                            >
                              {(index + 1).toString().padStart(2, "0")}
                            </span>
                          )}
                          {!collapsed ? <span>{item.title}</span> : null}
                        </button>
                      ) : (
                        <span
                          style={{
                            display: "block",
                            padding: collapsed ? "12px 8px" : "12px 12px",
                            color: "rgba(255,255,255,0.56)",
                            fontSize: "13px",
                          }}
                        >
                          {collapsed
                            ? item.title.slice(0, 2).toUpperCase()
                            : item.title}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <div
            style={{
              padding: "12px",
              borderTop: "1px solid rgba(255,255,255,0.12)",
              background: "#102939",
            }}
          >
            <p
              style={{
                margin: collapsed ? 0 : "0 0 6px",
                fontSize: "11px",
                color: "rgba(255,255,255,0.62)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              {collapsed ? "?" : "Keyboard"}
            </p>
            {!collapsed ? (
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: "rgba(255,255,255,0.78)",
                  lineHeight: 1.5,
                }}
              >
                Up/Down moves inside menu. Alt+C jumps straight into the current work surface.
              </p>
            ) : null}
          </div>
        </aside>
      ) : null}

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: shellMode === "dashboard" ? "14px 18px" : "12px 18px",
            borderBottom: "1px solid #b2c3cf",
            background: shellMode === "dashboard" ? "#eef3f6" : "#f4f7f9",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "18px",
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px 14px",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  color: "#526372",
                  fontWeight: 700,
                }}
              >
                <span>{shellProfile?.roleCode || "Protected Role"}</span>
                <span>{shellProfile?.userCode || "ERP User"}</span>
                <span>
                  {shellMode === "dashboard" ? "Dashboard Mode" : "Task Mode"}
                </span>
                <span>Zone {zoneNumber}</span>
                {clusterAdmission?.windowSlot ? (
                  <span>
                    Window {clusterAdmission.windowSlot}/
                    {clusterAdmission.maxWindowCount ?? 3}
                  </span>
                ) : null}
              </div>
              <h1
                style={{
                  margin: "8px 0 0",
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {activeTitle}
              </h1>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#526372" }}>
                {shellMode === "dashboard"
                  ? "Dashboard shell stays visible here. Use Alt+C for the work area, Alt+M for menu, and F6 to rotate zones."
                  : "Focused task page. The work area scrolls independently, and Alt+C returns focus straight into the active page."}
              </p>
            </div>

            <div
              aria-label="Workspace actions"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              {headerActions.map((action, index) => (
                <button
                  key={action.label + action.hint}
                  ref={(element) => {
                    actionButtonRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={action.onClick}
                  onFocus={() => setActiveZone("actions")}
                  onKeyDown={(event) => handleActionKeyDown(event, index)}
                  style={{
                    border: "1px solid #9fb3c2",
                    background:
                      shellMode === "task" && index === 0
                        ? "#d7ebf7"
                        : index === 1
                          ? "#d7ebf7"
                          : "#ffffff",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "grid",
                    gap: "4px",
                    minWidth: "104px",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "13px" }}>{action.label}</span>
                  <span
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    {action.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: "12px",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            {shortcutGuide.map((item) => (
              <span
                key={item}
                style={{
                  border: "1px solid #c8d5de",
                  background: "#ffffff",
                  borderRadius: "999px",
                  padding: "6px 10px",
                  fontSize: "11px",
                  color: "#475569",
                }}
              >
                {item}
              </span>
            ))}
          </div>

          {showKeyboardHelp ? (
            <div
              style={{
                marginTop: "12px",
                border: "1px solid #b2c3cf",
                background: "#ffffff",
                borderRadius: "10px",
                padding: "12px 14px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: "#475569",
                  fontWeight: 700,
                }}
              >
                Keyboard Help
              </p>
              <div
                style={{
                  marginTop: "8px",
                  display: "grid",
                  gap: "6px",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  fontSize: "13px",
                  color: "#0f172a",
                }}
              >
                {shellMode === "dashboard" ? (
                  <>
                    <span>Zone 1: Menu navigation</span>
                    <span>Zone 2: Action strip</span>
                    <span>Zone 3: Active screen content</span>
                    <span>Alt+C jumps to the first usable control in content</span>
                    <span>Up/Down moves inside the left menu</span>
                    <span>Left/Right moves across action buttons</span>
                  </>
                ) : (
                  <>
                    <span>Zone 1: Page actions</span>
                    <span>Zone 2: Active screen content</span>
                    <span>Alt+C jumps to the first usable control in content</span>
                    <span>Esc returns through the protected stack</span>
                    <span>Left/Right moves across top action buttons</span>
                    <span>Tab stays local to the current page content</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div
          ref={contentRegionRef}
          tabIndex={-1}
          onFocus={() => setActiveZone("content")}
          style={{
            flex: 1,
            outline: "none",
            overflowY: "auto",
            overflowX: "hidden",
            minHeight: 0,
          }}
          aria-label="Active workspace content"
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
