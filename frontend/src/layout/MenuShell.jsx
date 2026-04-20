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
  buildMenuTree,
  flattenRouteableMenu,
  getAncestorMenuCodes,
  getSidebarRoots,
} from "../navigation/menuProjection.js";
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
import {
  getNetworkActivitySnapshot,
  subscribeNetworkActivity,
} from "../store/networkActivity.js";
import { pushToast } from "../store/uiToast.js";
import { confirmNavigationLeaveIfNeeded } from "../store/navigationLeaveGuard.js";
import BlockingLayer from "../components/layer/BlockingLayer.jsx";
import ErpCommandPalette from "../components/ErpCommandPalette.jsx";

const WORKSPACE_ZONES = Object.freeze(["menu", "actions", "content"]);
const SCREEN_HOTKEY_LABELS = Object.freeze({
  save: { key: "Ctrl+S / F2", label: "Save" },
  refresh: { key: "Alt+R / F4", label: "Refresh" },
  focusSearch: { key: "Alt+Shift+F / F3", label: "Search" },
  focusPrimary: { key: "Alt+Shift+P / F7", label: "Primary" },
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

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function buildRuntimeContextError(json, fallbackCode, fallbackMessage) {
  const code = json?.code ?? fallbackCode;
  const decisionTrace = json?.decision_trace ?? json?.decisionTrace ?? null;
  const requestId = json?.request_id ?? json?.requestId ?? null;

  return [code, decisionTrace, requestId ? `Req ${requestId}` : null]
    .filter(Boolean)
    .join(" | ") || fallbackMessage;
}

function zoneBorder(activeZone, zone) {
  return activeZone === zone ? "border-sky-500" : "border-slate-300";
}

function resolveDrawerTrail(nodes, drawerPath) {
  const trail = [];
  let branch = Array.isArray(nodes) ? nodes : [];

  for (const menuCode of drawerPath) {
    const match = branch.find((node) => node.item?.menu_code === menuCode) ?? null;

    if (!match) {
      break;
    }

    trail.push(match);
    branch = match.children ?? [];
  }

  return trail;
}

function resolveTopLevelIndex(nodes, routePath) {
  return nodes.findIndex((node) => {
    if (node.item?.route_path === routePath) {
      return true;
    }

    return getAncestorMenuCodes([node], routePath).length > 0;
  });
}

function resolveTopLevelIndexByMenuCode(nodes, menuCode) {
  return nodes.findIndex((node) => node.item?.menu_code === menuCode);
}

async function fetchLiveRuntimeSnapshot() {
  const [contextResponse, menuResponse] = await Promise.all([
    fetch(`${import.meta.env.VITE_API_BASE}/api/me/context`, {
      credentials: "include",
      erpUiMode: "blocking",
      erpUiLabel: "Refreshing workspace shell",
    }),
    fetch(`${import.meta.env.VITE_API_BASE}/api/me/menu`, {
      credentials: "include",
      erpUiMode: "blocking",
      erpUiLabel: "Refreshing workspace shell",
    }),
  ]);

  const [contextJson, menuJson] = await Promise.all([
    contextResponse.json().catch(() => null),
    menuResponse.json().catch(() => null),
  ]);

  if (!contextResponse.ok || !contextJson?.ok || !contextJson?.data) {
    throw new Error(contextJson?.code ?? "RUNTIME_CONTEXT_REFRESH_FAILED");
  }

  if (!menuResponse.ok || !menuJson?.ok) {
    throw new Error(menuJson?.code ?? "MENU_REFRESH_FAILED");
  }

  return {
    runtimeContext: {
      isAdmin: contextJson.data.is_admin === true,
      workspaceMode: contextJson.data.workspace_mode ?? null,
      selectedCompanyId: contextJson.data.selected_company_id ?? "",
      currentCompany: contextJson.data.current_company ?? null,
      availableCompanies: contextJson.data.available_companies ?? [],
      availableWorkContexts: contextJson.data.available_work_contexts ?? [],
      selectedWorkContext: contextJson.data.selected_work_context ?? null,
    },
    menu: menuJson?.data?.menu ?? [],
  };
}

export default function MenuShell() {
  const location = useLocation();
  const {
    menu,
    loading,
    shellProfile,
    runtimeContext,
    setMenuSnapshot,
    setRuntimeContext,
  } = useMenu();
  const [collapsed, setCollapsed] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [actionRailCollapsed, setActionRailCollapsed] = useState(false);
  const [activeZone, setActiveZone] = useState("content");
  const [menuFocusIndex, setMenuFocusIndex] = useState(0);
  const [drawerPath, setDrawerPath] = useState([]);
  const [drawerFocusIndex, setDrawerFocusIndex] = useState(0);
  const [clusterAdmission, setClusterAdmission] = useState(() =>
    getClusterAdmission()
  );
  const [clusterWindowMessage, setClusterWindowMessage] = useState("");
  const [runtimeContextError, setRuntimeContextError] = useState("");
  const [screenCommandRegistry, setScreenCommandRegistry] = useState(() => new Map());
  const [screenHotkeyRegistry, setScreenHotkeyRegistry] = useState(() => new Map());
  const [networkActivity, setNetworkActivity] = useState(() =>
    getNetworkActivitySnapshot()
  );
  const [busyElapsedSeconds, setBusyElapsedSeconds] = useState(0);
  const [runtimeSwitchState, setRuntimeSwitchState] = useState({
    active: false,
    label: "",
  });
  const [modeBHintDismissed, setModeBHintDismissed] = useState(() => {
    try {
      return window.localStorage.getItem("pace.erp.hint.modeb.v1") === "dismissed";
    } catch {
      return false;
    }
  });

  const showModeBHint =
    runtimeContext?.workspaceMode === "MULTI" && !modeBHintDismissed;

  const dismissModeBHint = () => {
    try {
      window.localStorage.setItem("pace.erp.hint.modeb.v1", "dismissed");
    } catch {
      // Best-effort only.
    }
    setModeBHintDismissed(true);
  };

  const menuButtonRefs = useRef([]);
  const drawerButtonRefs = useRef([]);
  const actionButtonRefs = useRef([]);
  const contentRegionRef = useRef(null);
  const workContextSelectRef = useRef(null);
  const lastNetworkToastRef = useRef({
    completedAt: 0,
    errorAt: 0,
  });
  const stackDepth = getStackDepth();

  const navigationTree = useMemo(() => buildMenuTree(menu), [menu]);
  const sidebarRoots = useMemo(
    () => getSidebarRoots(navigationTree),
    [navigationTree]
  );
  const navigationMenu = useMemo(
    () => flattenRouteableMenu(navigationTree),
    [navigationTree]
  );
  const previousScreen = getPreviousScreen();
  const workspaceMode = stackDepth > 1;
  const aclWorkspace = location.pathname.startsWith("/dashboard");

  const activeMenuIndex = useMemo(
    () => resolveTopLevelIndex(sidebarRoots, location.pathname),
    [location.pathname, sidebarRoots]
  );

  const resolvedMenuFocusIndex =
    menuFocusIndex >= 0 && menuFocusIndex < sidebarRoots.length
      ? menuFocusIndex
      : activeMenuIndex >= 0
        ? activeMenuIndex
        : 0;
  const drawerTrail = useMemo(
    () => resolveDrawerTrail(sidebarRoots, drawerPath),
    [drawerPath, sidebarRoots]
  );
  const activeDrawerNode = drawerTrail[drawerTrail.length - 1] ?? null;
  const drawerEntries = activeDrawerNode?.children ?? [];
  const drawerVisible =
    !workspaceMode && drawerTrail.length > 0 && drawerEntries.length > 0;
  const resolvedDrawerFocusIndex =
    drawerFocusIndex >= 0 && drawerFocusIndex < drawerEntries.length
      ? drawerFocusIndex
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
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];
  const availableWorkContexts = Array.isArray(runtimeContext?.availableWorkContexts)
    ? runtimeContext.availableWorkContexts
    : [];
  // MULTI (Type 2) users see the global menu — no shell company switcher.
  // They select company per transaction via in-page selectors.
  const showCompanySwitcher =
    shellProfile?.roleCode !== "SA" &&
    shellProfile?.roleCode !== "GA" &&
    runtimeContext?.workspaceMode !== "MULTI" &&
    availableCompanies.length > 1;
  const showWorkContextSwitcher =
    shellProfile?.roleCode !== "SA" &&
    shellProfile?.roleCode !== "GA" &&
    availableWorkContexts.length > 1;
  const currentCompanyLabel = runtimeContext?.currentCompany
    ? `${runtimeContext.currentCompany.company_code} | ${runtimeContext.currentCompany.company_name}`
    : "No work company selected";
  const currentWorkContextLabel = runtimeContext?.selectedWorkContext
    ? `${runtimeContext.selectedWorkContext.work_context_code} | ${runtimeContext.selectedWorkContext.work_context_name}`
    : "No work context selected";
  const companySwitcherLabel = aclWorkspace ? "Company" : "Work Company";
  const workContextSwitcherLabel = aclWorkspace ? "Work Area" : "Work Context";
  const networkStatusLabel =
    networkActivity.blockingInFlightCount > 0
      ? `Processing ${networkActivity.blockingInFlightCount} action${networkActivity.blockingInFlightCount === 1 ? "" : "s"}`
      : networkActivity.lastOutcome === "error"
        ? "Last sync failed"
        : networkActivity.lastCompletedAt > 0
          ? "System ready"
          : "Waiting";
  const networkStatusTone =
    networkActivity.blockingInFlightCount > 0
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : networkActivity.lastOutcome === "error"
        ? "border-rose-300 bg-rose-50 text-rose-900"
        : "border-emerald-300 bg-emerald-50 text-emerald-900";
  const busyOverlayVisible =
    runtimeSwitchState.active || networkActivity.blockingInFlightCount > 0;
  const busyOverlayLabel =
    runtimeSwitchState.label ||
    networkActivity.lastBlockingLabel ||
    networkActivity.lastLabel ||
    "Processing ERP action";
  const shellShortcutLine = workspaceMode
    ? `Esc Back | Alt+H Home | Alt+Left Hide Rail | Alt+Right Show Rail | Alt+W Or F8 ${workContextSwitcherLabel} | Ctrl+K Or F9 Command Bar`
    : aclWorkspace
      ? `Alt+M Menu | Alt+A Function Rail | Alt+C Work Canvas | Alt+W Or F8 ${workContextSwitcherLabel} | Ctrl+K Or F9 Command Bar`
      : `Alt+M Menu | Alt+A Function Rail | Alt+C Work Area | Alt+W Or F8 ${workContextSwitcherLabel} | Ctrl+K Or F9 Command Bar`;
  const footerShortcutLine =
    `Esc Back | Alt+H Home | Alt+W Or F8 ${workContextSwitcherLabel} | Alt+PgUp Prev Page | Alt+PgDn Next Page | Ctrl+K Or F9 Command Bar | Ctrl+S Or F2 Save | Alt+R Or F4 Refresh | Alt+Shift+F Or F3 Search | Alt+Shift+P Or F7 Primary`;

  useEffect(() => {
    if (aclWorkspace) {
      setActionRailCollapsed(true);
    }
  }, [aclWorkspace]);

  useEffect(() => {
    if (
      networkActivity.lastOutcome === "error" &&
      networkActivity.lastErrorAt > 0 &&
      networkActivity.lastErrorAt !== lastNetworkToastRef.current.errorAt
    ) {
      lastNetworkToastRef.current.errorAt = networkActivity.lastErrorAt;
      pushToast({
        id: `network-error:${networkActivity.lastErrorAt}`,
        tone: "error",
        title: "Last Sync Failed",
        message: networkActivity.lastLabel || "ERP action failed.",
        durationMs: 7000,
      });
      return;
    }

    if (
      networkActivity.lastOutcome === "success" &&
      networkActivity.lastResolvedMode === "blocking" &&
      networkActivity.lastCompletedAt > 0 &&
      networkActivity.lastCompletedAt !== lastNetworkToastRef.current.completedAt
    ) {
      lastNetworkToastRef.current.completedAt = networkActivity.lastCompletedAt;
      pushToast({
        id: `network-success:${networkActivity.lastCompletedAt}`,
        tone: "success",
        title: "Saved",
        message: networkActivity.lastLabel || "ERP action completed.",
        durationMs: 3200,
      });
    }
  }, [networkActivity]);

  const holdRuntimeSwitchOverlayUntilPaint = useCallback(async () => {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }, []);

  const focusWorkContextSwitcher = useCallback(() => {
    if (!showWorkContextSwitcher) {
      return;
    }

    const target = workContextSelectRef.current;

    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    if (focusElement(target)) {
      setActiveZone("menu");
    }

    try {
      if (typeof target.showPicker === "function") {
        target.showPicker();
        return;
      }
    } catch {
      // Fallback below keeps the shortcut functional even where showPicker is unsupported.
    }

    window.requestAnimationFrame(() => {
      target.click();
    });
  }, [showWorkContextSwitcher]);

  const handleWorkCompanyChange = useCallback(
    async (nextCompanyId) => {
      if (!nextCompanyId || nextCompanyId === runtimeContext?.selectedCompanyId) {
        return;
      }

      const approved = await confirmNavigationLeaveIfNeeded("ACL_VERSION_CENTER");
      if (!approved) {
        return;
      }

      setRuntimeContextError("");
      setRuntimeSwitchState({
        active: true,
        label: "Switching work company",
      });

      try {
        const contextResponse = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/context`,
          {
            method: "POST",
            credentials: "include",
            erpUiMode: "blocking",
            erpUiLabel: "Switching work company",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              selected_company_id: nextCompanyId,
            }),
          }
        );
        const contextJson = await readJsonSafe(contextResponse);

        if (!contextResponse.ok || !contextJson?.ok || !contextJson?.data) {
          throw new Error(
            buildRuntimeContextError(
              contextJson,
              "WORK_COMPANY_SWITCH_FAILED",
              "Work company could not be switched."
            )
          );
        }

        setMenuSnapshot([]);

        const menuResponse = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/menu`,
          {
            credentials: "include",
            erpUiMode: "blocking",
            erpUiLabel: "Refreshing workspace after work company switch",
          }
        );
        const menuJson = await readJsonSafe(menuResponse);

        if (!menuResponse.ok || !menuJson?.ok) {
          throw new Error(
            buildRuntimeContextError(
              menuJson,
              "MENU_REFRESH_FAILED",
              "Menu could not be refreshed."
            )
          );
        }

        setRuntimeContext({
          isAdmin: contextJson.data.is_admin === true,
          workspaceMode: contextJson.data.workspace_mode ?? null,
          selectedCompanyId: contextJson.data.selected_company_id ?? "",
          currentCompany: contextJson.data.current_company ?? null,
          availableCompanies: contextJson.data.available_companies ?? [],
          availableWorkContexts: contextJson.data.available_work_contexts ?? [],
          selectedWorkContext: contextJson.data.selected_work_context ?? null,
          shellIssueCode: "",
          shellIssueMessage: "",
        });
        setMenuSnapshot(menuJson?.data?.menu ?? []);
        resetToScreen("DASHBOARD_HOME");
        await holdRuntimeSwitchOverlayUntilPaint();
      } catch (error) {
        console.error("WORK_COMPANY_SWITCH_FAILED", error);
        setRuntimeContextError(
          error instanceof Error ? error.message : "Work company could not be switched."
        );
      } finally {
        setRuntimeSwitchState({
          active: false,
          label: "",
        });
      }
    },
    [
      holdRuntimeSwitchOverlayUntilPaint,
      runtimeContext?.selectedCompanyId,
      setMenuSnapshot,
      setRuntimeContext,
    ]
  );

  const refreshLiveMenuAndContext = useCallback(async () => {
    setRuntimeContextError("");

    try {
      const snapshot = await fetchLiveRuntimeSnapshot();
      setRuntimeContext(snapshot.runtimeContext);
      setMenuSnapshot(snapshot.menu);
    } catch (error) {
      console.error("LIVE_MENU_REFRESH_FAILED", error);
      setRuntimeContextError("Latest menu changes could not be refreshed.");
    }
  }, [setMenuSnapshot, setRuntimeContext]);

  const handleWorkContextChange = useCallback(
    async (nextWorkContextId) => {
      const currentWorkContextId =
        runtimeContext?.selectedWorkContext?.work_context_id ?? "";

      if (
        !nextWorkContextId ||
        !runtimeContext?.selectedCompanyId ||
        nextWorkContextId === currentWorkContextId
      ) {
        return;
      }

      const approved = await confirmNavigationLeaveIfNeeded("ACL_VERSION_CENTER");
      if (!approved) {
        return;
      }

      setRuntimeContextError("");
      setRuntimeSwitchState({
        active: true,
        label: "Switching work context",
      });

      try {
        const contextResponse = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/context`,
          {
            method: "POST",
            credentials: "include",
            erpUiMode: "blocking",
            erpUiLabel: "Switching work context",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              selected_company_id: runtimeContext.selectedCompanyId,
              selected_work_context_id: nextWorkContextId,
            }),
          }
        );
        const contextJson = await readJsonSafe(contextResponse);

        if (!contextResponse.ok || !contextJson?.ok || !contextJson?.data) {
          throw new Error(
            buildRuntimeContextError(
              contextJson,
              "WORK_CONTEXT_SWITCH_FAILED",
              "Work context could not be switched."
            )
          );
        }

        setMenuSnapshot([]);

        const menuResponse = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/menu`,
          {
            credentials: "include",
            erpUiMode: "blocking",
            erpUiLabel: "Refreshing workspace after work context switch",
          }
        );
        const menuJson = await readJsonSafe(menuResponse);

        if (!menuResponse.ok || !menuJson?.ok) {
          throw new Error(
            buildRuntimeContextError(
              menuJson,
              "MENU_REFRESH_FAILED",
              "Menu could not be refreshed."
            )
          );
        }

        setRuntimeContext({
          isAdmin: contextJson.data.is_admin === true,
          workspaceMode: contextJson.data.workspace_mode ?? null,
          selectedCompanyId: contextJson.data.selected_company_id ?? "",
          currentCompany: contextJson.data.current_company ?? null,
          availableCompanies: contextJson.data.available_companies ?? [],
          availableWorkContexts: contextJson.data.available_work_contexts ?? [],
          selectedWorkContext: contextJson.data.selected_work_context ?? null,
          shellIssueCode: "",
          shellIssueMessage: "",
        });
        setMenuSnapshot(menuJson?.data?.menu ?? []);
        resetToScreen("DASHBOARD_HOME");
        await holdRuntimeSwitchOverlayUntilPaint();
      } catch (error) {
        console.error("WORK_CONTEXT_SWITCH_FAILED", error);
        setRuntimeContextError(
          error instanceof Error ? error.message : "Work context could not be switched."
        );
      } finally {
        setRuntimeSwitchState({
          active: false,
          label: "",
        });
      }
    },
    [
      holdRuntimeSwitchOverlayUntilPaint,
      runtimeContext?.selectedCompanyId,
      runtimeContext?.selectedWorkContext?.work_context_id,
      setMenuSnapshot,
      setRuntimeContext,
    ]
  );

  useEffect(() => {
    const handleMenuRefreshRequest = () => {
      void refreshLiveMenuAndContext();
    };

    window.addEventListener("erp:menu-refresh-request", handleMenuRefreshRequest);

    return () => {
      window.removeEventListener("erp:menu-refresh-request", handleMenuRefreshRequest);
    };
  }, [refreshLiveMenuAndContext]);

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
    return subscribeNetworkActivity((snapshot) => {
      setNetworkActivity(snapshot);
    });
  }, []);

  useEffect(() => {
    if (
      networkActivity.blockingInFlightCount <= 0 ||
      !networkActivity.blockingStartedAt
    ) {
      setBusyElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = () => {
      setBusyElapsedSeconds(
        Math.max(
          1,
          Math.ceil((Date.now() - networkActivity.blockingStartedAt) / 1000)
        )
      );
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 250);

    return () => window.clearInterval(intervalId);
  }, [networkActivity.blockingInFlightCount, networkActivity.blockingStartedAt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target =
        findFirstFocusableWithin(contentRegionRef.current) ?? contentRegionRef.current;
      focusElement(target);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => {
    setActionRailCollapsed(workspaceMode);
  }, [workspaceMode]);

  useEffect(() => {
    setDrawerPath(getAncestorMenuCodes(sidebarRoots, location.pathname));
    setDrawerFocusIndex(0);
  }, [location.pathname, sidebarRoots]);

  useEffect(() => {
    if (!drawerVisible) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      const target =
        drawerButtonRefs.current[resolvedDrawerFocusIndex] ??
        drawerButtonRefs.current.find((item) => item instanceof HTMLElement);

      if (focusElement(target)) {
        setActiveZone("menu");
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [drawerVisible, drawerPath, resolvedDrawerFocusIndex]);

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
        if (actionRailCollapsed) {
          setActionRailCollapsed(false);
          window.requestAnimationFrame(() => {
            const button = actionButtonRefs.current.find(
              (item) => item instanceof HTMLElement
            );

            if (focusElement(button)) {
              setActiveZone("actions");
            }
          });
          return;
        }

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
    [actionRailCollapsed, focusContentZone, resolvedMenuFocusIndex]
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

  async function handleMenuRoute(routePath) {
    if (!getScreenForRoute(routePath)) {
      return;
    }

    const approved = await confirmNavigationLeaveIfNeeded("ACL_VERSION_CENTER");
    if (!approved) {
      return;
    }

    openRoute(routePath);
  }

  function handleSidebarSelection(node) {
    if (!node) {
      return;
    }

    if (node.children?.length) {
      setDrawerPath([node.item.menu_code]);
      setDrawerFocusIndex(0);
      return;
    }

    if (node.item?.route_path) {
      setDrawerPath([]);
      void handleMenuRoute(node.item.route_path);
    }
  }

  function handleDrawerSelection(node) {
    if (!node) {
      return;
    }

    if (node.children?.length) {
      setDrawerPath((current) => [...current, node.item.menu_code]);
      setDrawerFocusIndex(0);
      return;
    }

    if (node.item?.route_path) {
      void handleMenuRoute(node.item.route_path);
    }
  }

  function handleDrawerBack() {
    const currentPath = [...drawerPath];

    if (currentPath.length <= 1) {
      const rootMenuCode = currentPath[0] ?? "";
      const rootIndex = resolveTopLevelIndexByMenuCode(sidebarRoots, rootMenuCode);

      setDrawerPath([]);
      setDrawerFocusIndex(0);

      window.requestAnimationFrame(() => {
        const safeIndex = rootIndex >= 0 ? rootIndex : 0;
        setMenuFocusIndex(safeIndex);
        focusElement(menuButtonRefs.current[safeIndex] ?? menuButtonRefs.current[0]);
      });
      return;
    }

    const parentEntries = drawerTrail[drawerTrail.length - 2]?.children ?? [];
    const returningMenuCode = currentPath[currentPath.length - 1];
    const parentIndex = parentEntries.findIndex(
      (node) => node.item?.menu_code === returningMenuCode
    );

    setDrawerPath(currentPath.slice(0, -1));
    setDrawerFocusIndex(parentIndex >= 0 ? parentIndex : 0);

    window.requestAnimationFrame(() => {
      const safeIndex = parentIndex >= 0 ? parentIndex : 0;
      focusElement(
        drawerButtonRefs.current[safeIndex] ?? drawerButtonRefs.current[0]
      );
    });
  }

  async function handleLogout() {
    await confirmAndRequestLogout();
  }

  const handleBack = useCallback(async () => {
    if (drawerVisible) {
      const parentNode =
        drawerTrail.length > 1 ? drawerTrail[drawerTrail.length - 2] : sidebarRoots[resolvedMenuFocusIndex] ?? null;
      const parentEntries = parentNode?.children ?? [];
      const currentMenuCode = drawerTrail[drawerTrail.length - 1]?.item?.menu_code ?? "";
      const parentIndex = parentEntries.findIndex(
        (node) => node.item?.menu_code === currentMenuCode
      );

      setDrawerPath((currentPath) => currentPath.slice(0, -1));
      setDrawerFocusIndex(parentIndex >= 0 ? parentIndex : 0);

      window.requestAnimationFrame(() => {
        const safeIndex = parentIndex >= 0 ? parentIndex : 0;
        focusElement(
          drawerButtonRefs.current[safeIndex] ?? drawerButtonRefs.current[0]
        );
      });
      return;
    }

    if (stackDepth <= 1) {
      await confirmAndRequestLogout();
      return;
    }

    const approved = await confirmNavigationLeaveIfNeeded("ACL_VERSION_CENTER");
    if (!approved) {
      return;
    }

    popScreen();
  }, [drawerTrail, drawerVisible, resolvedMenuFocusIndex, sidebarRoots, stackDepth]);

  const handleGoHome = useCallback(async () => {
    const target = location.pathname.startsWith("/sa")
      ? "SA_HOME"
      : location.pathname.startsWith("/ga")
        ? "GA_HOME"
        : "DASHBOARD_HOME";

    const approved = await confirmNavigationLeaveIfNeeded("ACL_VERSION_CENTER");
    if (!approved) {
      return;
    }

    resetToScreen(target);
  }, [location.pathname]);

  function handleLockWorkspace() {
    lockWorkspace();
  }

  const handleOpenNewWindow = useCallback(async () => {
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
  }, [location.pathname]);

  useEffect(() => {
    const unsubscribe = subscribeWorkspaceFocusCommands((command) => {
      if (command === "GO_HOME") void handleGoHome();
      if (command === "FOCUS_MENU_ZONE") focusZone("menu");
      if (command === "FOCUS_ACTIONS_ZONE") focusZone("actions");
      if (command === "FOCUS_CONTENT_ZONE") focusZone("content");
      if (command === "FOCUS_WORK_CONTEXT") focusWorkContextSwitcher();
      if (command === "OPEN_NEW_WINDOW") void handleOpenNewWindow();
      if (command === "FOCUS_NEXT_ZONE") cycleZoneFocus(1);
      if (command === "FOCUS_PREVIOUS_ZONE") cycleZoneFocus(-1);
      if (command === "TOGGLE_SHORTCUT_HELP") {
        setShowKeyboardHelp((current) => !current);
      }
    });

    return unsubscribe;
  }, [
    cycleZoneFocus,
    focusWorkContextSwitcher,
    focusZone,
    handleGoHome,
    handleOpenNewWindow,
  ]);

  useEffect(() => {
    function handleShellBackRequest(event) {
      event.preventDefault();
      void handleBack();
    }

    window.addEventListener("erp:shell-back-request", handleShellBackRequest);
    return () => {
      window.removeEventListener("erp:shell-back-request", handleShellBackRequest);
    };
  }, [handleBack]);

  useEffect(() => {
    function handleRailToggle(event) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActionRailCollapsed(true);
        setActiveZone("content");
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActionRailCollapsed(false);
      }
    }

    window.addEventListener("keydown", handleRailToggle, true);
    return () => window.removeEventListener("keydown", handleRailToggle, true);
  }, []);

  function handleMenuKeyDown(event, index) {
    if (sidebarRoots.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (index + 1) % sidebarRoots.length;
      setMenuFocusIndex(nextIndex);
      moveFocus(menuButtonRefs.current, nextIndex);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = (index - 1 + sidebarRoots.length) % sidebarRoots.length;
      setMenuFocusIndex(nextIndex);
      moveFocus(menuButtonRefs.current, nextIndex);
    }

    if (event.key === "Enter" || event.key === "ArrowRight") {
      const entry = sidebarRoots[index];

      if (!entry) {
        return;
      }

      event.preventDefault();
      handleSidebarSelection(entry);
    }

    if (event.key === "ArrowLeft") {
      if (drawerPath.length > 0) {
        event.preventDefault();
        handleDrawerBack();
      }
    }
  }

  function handleDrawerKeyDown(event, index) {
    if (drawerEntries.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (index + 1) % drawerEntries.length;
      setDrawerFocusIndex(nextIndex);
      moveFocus(drawerButtonRefs.current, nextIndex);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = (index - 1 + drawerEntries.length) % drawerEntries.length;
      setDrawerFocusIndex(nextIndex);
      moveFocus(drawerButtonRefs.current, nextIndex);
    }

    if (event.key === "Enter" || event.key === "ArrowRight") {
      event.preventDefault();
      handleDrawerSelection(drawerEntries[index]);
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handleDrawerBack();
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
      label: actionRailCollapsed ? "Alt+Right" : "Alt+Left",
      title: actionRailCollapsed ? "Show Rail" : "Hide Rail",
      onClick: () => setActionRailCollapsed((current) => !current),
    },
    {
      label: collapsed ? "Ctrl+Right" : "Ctrl+Left",
      title: collapsed ? "Show Menu" : "Hide Menu",
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
      id: "shell-action-rail-toggle",
      group: "Shell",
      label: actionRailCollapsed ? "Show function rail" : "Hide function rail",
      hint: actionRailCollapsed ? "Alt+Right" : "Alt+Left",
      keywords: ["function rail", "action rail", "collapse"],
      perform: () => setActionRailCollapsed((current) => !current),
      order: 35,
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

  const menuCommands = navigationMenu
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
    <div className="erp-app-shell flex h-screen overflow-hidden text-slate-900">
      <aside
        aria-label="Workspace navigation"
        className={`flex shrink-0 flex-col border-r bg-[#f4f7fa] ${workspaceMode ? "w-[92px]" : collapsed ? "w-[92px]" : aclWorkspace ? "w-[236px]" : "w-[272px]"} ${zoneBorder(activeZone, "menu")}`}
      >
        <div className="border-b border-slate-500 bg-[linear-gradient(180deg,#0d4f90_0%,#13426f_100%)] px-3 py-3 text-white">
          <div className="flex items-center gap-2">
            <img
              src="/lm.jpg"
              alt="PACE ERP"
              className="h-9 w-9 border border-white/25 object-cover"
            />
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em]">
              Pace ERP
            </p>
          </div>
          {!workspaceMode && !collapsed ? (
            <>
              <p className={`mt-2 font-semibold ${aclWorkspace ? "text-base" : "text-xl"}`}>
                {shellProfile?.name || shellProfile?.roleCode || "ERP"}
              </p>
              <p className={`${aclWorkspace ? "text-xs" : "text-sm"} opacity-90`}>
                {[shellProfile?.roleCode || "Role", shellProfile?.userCode || "User"]
                  .filter(Boolean)
                  .join(" | ")}
              </p>
              {showCompanySwitcher ? (
                <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">
                  {companySwitcherLabel}
                  <select
                    value={runtimeContext?.selectedCompanyId ?? ""}
                    onChange={(event) => void handleWorkCompanyChange(event.target.value)}
                    className="mt-1 w-full border border-white/30 bg-white/10 px-2 py-1 text-xs font-medium text-white outline-none"
                  >
                    {availableCompanies.map((company) => (
                      <option
                        key={company.id}
                        value={company.id}
                        className="text-slate-900"
                      >
                        {company.company_code} | {company.company_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : !runtimeContext?.isAdmin && runtimeContext?.currentCompany ? (
                <p className="mt-3 text-xs opacity-90">{currentCompanyLabel}</p>
              ) : null}
              {showWorkContextSwitcher ? (
                <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">
                  {workContextSwitcherLabel}
                  <span className="ml-2 text-[9px] tracking-[0.16em] text-white/60">
                    Alt+W / F8
                  </span>
                  <select
                    ref={workContextSelectRef}
                    value={runtimeContext?.selectedWorkContext?.work_context_id ?? ""}
                    onChange={(event) => void handleWorkContextChange(event.target.value)}
                    className="mt-1 w-full border border-white/30 bg-white/10 px-2 py-1 text-xs font-medium text-white outline-none"
                  >
                    {availableWorkContexts.filter((wc) => !wc.work_context_code?.startsWith("DEPT_")).map((workContext) => (
                      <option
                        key={workContext.work_context_id}
                        value={workContext.work_context_id}
                        className="text-slate-900"
                      >
                        {workContext.work_context_code} | {workContext.work_context_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : !runtimeContext?.isAdmin && runtimeContext?.selectedWorkContext ? (
                <p className="mt-2 text-xs opacity-90">{currentWorkContextLabel}</p>
              ) : null}
            </>
          ) : workspaceMode ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em]">
              Stack
            </p>
          ) : null}
        </div>

        <div className="border-b border-slate-300 bg-[#e6edf4] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
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
                {sidebarRoots.map((node, index) => {
                  const hasChildren = node.children?.length > 0;
                  const isActive = index === activeMenuIndex;

                  return (
                    <li key={node.item.menu_code}>
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
                        onClick={() => handleSidebarSelection(node)}
                        aria-current={!hasChildren && isActive ? "page" : undefined}
                        className={`grid w-full items-center gap-2 border px-2 py-2 text-left text-sm ${
                          collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[32px_minmax(0,1fr)_20px]"
                        } ${
                          isActive
                            ? "border-sky-500 bg-sky-100 font-semibold text-sky-950"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <span className="font-mono text-[11px] text-slate-500">
                          {(index + 1).toString().padStart(2, "0")}
                        </span>
                        {!collapsed ? <span className="truncate">{node.item.title}</span> : null}
                        {!collapsed ? (
                          <span className="justify-self-end text-[11px] text-slate-400">
                            {hasChildren ? "+" : ""}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>

        <div className="border-t border-slate-300 bg-[#eef3f7] px-2 py-2 text-center text-[11px] text-slate-500">
          {workspaceMode ? (
            <>
              <div className="font-semibold text-slate-700">{shellProfile?.roleCode || "ERP"}</div>
              <div className="mt-1 truncate">
                {shellProfile?.name || shellProfile?.userCode || "User"}
              </div>
            </>
          ) : (
            <>{collapsed ? activeTitle.slice(0, 8) : activeTitle}</>
          )}
        </div>
      </aside>

      {drawerVisible ? (
        <aside
          aria-label="Menu drawer"
          className="flex w-[296px] shrink-0 flex-col border-r border-slate-300 bg-[#e8eef4]"
        >
          <div className="border-b border-slate-300 bg-white px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Menu Drawer
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {drawerTrail.map((node) => node.item.title).join(" / ")}
            </div>
            <button
              type="button"
              onClick={handleDrawerBack}
              className="mt-2 border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700"
            >
              Left Back
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <nav>
              <ul className="space-y-2">
                {drawerEntries.map((node, index) => {
                  const hasChildren = node.children?.length > 0;
                  const isActive = node.item.route_path === location.pathname;

                  return (
                    <li key={node.item.menu_code}>
                      <button
                        ref={(element) => {
                          drawerButtonRefs.current[index] = element;
                        }}
                        type="button"
                        onFocus={() => {
                          setActiveZone("menu");
                          setDrawerFocusIndex(index);
                        }}
                        onKeyDown={(event) => handleDrawerKeyDown(event, index)}
                        onClick={() => handleDrawerSelection(node)}
                        aria-current={!hasChildren && isActive ? "page" : undefined}
                        className={`grid w-full grid-cols-[32px_minmax(0,1fr)_20px] items-center gap-2 border px-2 py-2 text-left text-sm ${
                          isActive
                            ? "border-sky-500 bg-sky-100 font-semibold text-sky-950"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="font-mono text-[11px] text-slate-500">
                          {(index + 1).toString().padStart(2, "0")}
                        </span>
                        <span className="truncate">{node.item.title}</span>
                        <span className="justify-self-end text-[11px] text-slate-400">
                          {hasChildren ? "+" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </aside>
      ) : null}

      <main className={`flex min-w-0 flex-1 flex-col border-r bg-[#f7f9fb] ${zoneBorder(activeZone, "content")}`}>
        <div className="sticky top-0 z-30">
          <header className="border-b border-slate-400 bg-[linear-gradient(180deg,#f8fafc_0%,#e9eef4_100%)] px-4 py-3 text-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700">
                  {workspaceMode ? "Focused workspace" : aclWorkspace ? "ACL Task Workspace" : "Protected ERP"}
                </div>
                <div className="mt-1 text-lg font-semibold">
                {workspaceMode && previousScreen?.screen_code
                  ? `${formatScreenTitle(previousScreen.screen_code)} / ${activeTitle}`
                  : activeTitle}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <span>{shellProfile?.name || "Name"}</span>
                  <span>{shellProfile?.roleCode || "Role"}</span>
                  <span>{shellProfile?.userCode || "User"}</span>
                  {!runtimeContext?.isAdmin && runtimeContext?.currentCompany ? (
                    <span>{runtimeContext.currentCompany.company_code}</span>
                  ) : null}
                  {!runtimeContext?.isAdmin && runtimeContext?.selectedWorkContext ? (
                    <span>{runtimeContext.selectedWorkContext.work_context_code}</span>
                  ) : null}
                  <span>{workspaceMode ? `Stack ${stackDepth}` : `Zone ${WORKSPACE_ZONES.indexOf(activeZone) + 1}`}</span>
                  {clusterAdmission?.windowSlot ? (
                    <span>
                      Window {clusterAdmission.windowSlot}/{clusterAdmission.maxWindowCount ?? 3}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-2 text-right">
                <div
                  className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${networkStatusTone} ${
                    networkActivity.blockingInFlightCount > 0
                      ? "erp-status-marquee"
                      : ""
                  }`}
                >
                  {networkStatusLabel}
                  {networkActivity.blockingInFlightCount > 0
                    ? networkActivity.lastBlockingLabel
                      ? ` | ${networkActivity.lastBlockingLabel}`
                      : ""
                    : networkActivity.lastOutcome === "error" && networkActivity.lastLabel
                      ? ` | ${networkActivity.lastLabel}`
                      : ""}
                </div>
              </div>
            </div>
          </header>

          <div className="border-b border-slate-300 bg-[#eef3f7] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {shellShortcutLine}
          </div>

          {showKeyboardHelp || clusterWindowMessage ? (
            <div className="border-b border-slate-300 bg-[#fff8dc] px-4 py-2 text-sm text-slate-700">
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

          {runtimeContextError ? (
            <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              <p>{runtimeContextError}</p>
            </div>
          ) : null}

          {showModeBHint ? (
            <div className="flex items-start justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2">
              <p className="text-sm text-sky-800">
                <span className="font-semibold">Multi-company access enabled.</span>{" "}
                Your menu covers all assigned companies. Use the company selector on each transaction to work across companies.
              </p>
              <button
                type="button"
                onClick={dismissModeBHint}
                className="shrink-0 border border-sky-300 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 hover:bg-sky-50"
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>

        <div
          ref={contentRegionRef}
          tabIndex={-1}
          onFocus={() => setActiveZone("content")}
          aria-label="Active workspace content"
          className={`min-h-0 flex-1 overflow-y-auto bg-[#f2f5f8] outline-none ${workspaceMode ? "px-2 py-2" : "px-4 py-4"}`}
        >
          <Outlet />
        </div>

        <footer className="border-t border-slate-300 bg-[#e8eef4] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {footerShortcutLine}
          {activeScreenHotkeys.length > 0
            ? ` | ${activeScreenHotkeys.map((item) => `${item.key} ${item.label}`).join(" | ")}`
            : ""}
        </footer>
      </main>

      <div className={`border-l border-slate-300 bg-[#edf2f6] transition-all ${actionRailCollapsed ? "w-[18px]" : "w-[188px]"}`}>
        {actionRailCollapsed ? (
          <button
            type="button"
            onClick={() => setActionRailCollapsed(false)}
            className="flex h-full w-full items-start justify-center bg-[#e2eaf2] pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500"
          >
            &gt;
          </button>
        ) : (
          <aside
            aria-label="Workspace action rail"
            className={`flex h-full flex-col ${zoneBorder(activeZone, "actions")}`}
          >
            <div className="border-b border-slate-300 bg-[#dde7f2] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
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

              {showKeyboardHelp && visibleScreenCommands.length > 0 ? (
                <div className="mt-3 border border-slate-300 bg-white">
                  <div className="border-b bg-[#eef4fb] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Page Commands
                  </div>
                  <div className="px-3 py-2 text-xs leading-6 text-slate-700">
                    {visibleScreenCommands.map((command) => (
                      <div key={command.id} className="border-b border-slate-100 py-1 last:border-b-0">
                        <div className="font-medium text-slate-800">{command.label}</div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {command.hint || "Command"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        )}
      </div>

      <ErpCommandPalette
        activeRoute={location.pathname}
        shellCommands={shellCommands}
        menuCommands={menuCommands}
      />

      <BlockingLayer
        visible={busyOverlayVisible}
        overlayStyle={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.22)",
          zIndex: 999998,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
        dialogStyle={{
          width: "min(560px, calc(100vw - 40px))",
          border: "1px solid #f59e0b",
          background: "#fffef7",
          boxShadow: "0 20px 44px rgba(15, 23, 42, 0.22)",
          padding: "24px",
        }}
        dialogProps={{
          "aria-label": "ERP action in progress",
        }}
      >
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              ERP Action In Progress
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {busyElapsedSeconds}s elapsed
            </div>
          </div>
          <div className="grid gap-2 border border-amber-200 bg-white px-4 py-4">
            <p className="text-base font-semibold text-slate-900">{busyOverlayLabel}</p>
            <p className="text-sm leading-6 text-slate-600">
              Please wait until the current action completes. Menu clicks, form clicks,
              and keyboard actions stay blocked so the ERP state does not drift mid-request.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
            Blocking actions: {networkActivity.blockingInFlightCount}
          </div>
        </div>
      </BlockingLayer>
    </div>
  );
}
