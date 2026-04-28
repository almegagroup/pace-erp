/*
 * File-ID: 9.12-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAMenuGovernance.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin menu governance — groups and page catalog management
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { PROJECT_SCREENS } from "../../../navigation/screens/projects/projectScreens.js";
import { HR_SCREENS } from "../../../navigation/screens/projects/hrModule/hrScreens.js";
import { OPERATION_SCREENS } from "../../../navigation/screens/projects/operationModule/operationScreens.js";
import { WORKFLOW_SCREENS } from "../../../navigation/screens/workflowScreens.js";
import { REPORTING_SCREENS } from "../../../navigation/screens/reportingScreens.js";
import { ADMIN_SCREENS } from "../../../navigation/screens/adminScreens.js";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

// ---------------------------------------------------------------------------
// Screen registry
// ---------------------------------------------------------------------------

const MENU_GOVERNANCE_SCREEN_REGISTRY = Object.freeze({
  ...ADMIN_SCREENS,
  ...PROJECT_SCREENS,
  ...HR_SCREENS,
  ...OPERATION_SCREENS,
  ...WORKFLOW_SCREENS,
  ...REPORTING_SCREENS,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputClass() {
  return "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500";
}

function filterTabClass(active) {
  return `border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
    active
      ? "border-sky-300 bg-sky-50 text-sky-900"
      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
  }`;
}

function normalizeMenuCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchMenuRegistry(universe) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/menu?universe=${encodeURIComponent(universe)}`,
    { credentials: "include" },
  );
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.menus)) {
    throw new Error(json?.code ?? "MENU_REGISTRY_READ_FAILED");
  }
  return json.data.menus;
}

async function createMenu(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) throw new Error(json?.code ?? "MENU_CREATE_FAILED");
  return json.data;
}

async function updateMenu(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) throw new Error(json?.code ?? "MENU_UPDATE_FAILED");
  return json.data;
}

async function updateMenuTree(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu/tree`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) throw new Error(json?.code ?? "MENU_TREE_UPDATE_FAILED");
  return json.data;
}

async function updateMenuState(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu/state`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) throw new Error(json?.code ?? "MENU_STATE_UPDATE_FAILED");
  return json.data;
}

async function deleteMenu(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) throw new Error(json?.code ?? "MENU_DELETE_FAILED");
  return json.data;
}

function formatScreenTitle(screenCode) {
  return String(screenCode ?? "")
    .replace(/^(SA|GA|ACL|DASHBOARD)_/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function resolveGovernanceUniverse(screen) {
  const route = String(screen?.route ?? "");
  if (route.startsWith("/sa") || route.startsWith("/ga")) return "SA";
  if (route.startsWith("/dashboard")) return "ACL";
  return null;
}

function resolveRegisteredPageMenu(menus, screen) {
  const route = String(screen?.route ?? "");
  const screenCode = String(screen?.screen_code ?? "");
  return (
    menus.find((item) => item.menu_type === "PAGE" && item.route_path === route) ??
    menus.find((item) => item.menu_type === "PAGE" && item.menu_code === screenCode) ??
    null
  );
}

function pickDefaultGroup(menus, universe, selectedMenuCode) {
  const universeMenus = menus.filter((item) => item.universe === universe);
  const selectedGroup = universeMenus.find(
    (item) => item.menu_code === selectedMenuCode && item.menu_type === "GROUP",
  );
  if (selectedGroup) return selectedGroup;
  return universeMenus.find((item) => item.menu_type === "GROUP") ?? universeMenus[0] ?? null;
}

function findReservedScreenByCode(screenCode, universe) {
  const normalizedCode = normalizeMenuCode(screenCode);
  return (
    Object.values(MENU_GOVERNANCE_SCREEN_REGISTRY).find(
      (screen) =>
        resolveGovernanceUniverse(screen) === universe &&
        normalizeMenuCode(screen?.screen_code) === normalizedCode,
    ) ?? null
  );
}

function resolveMenuGovernanceErrorMessage(code, fallbackMessage) {
  switch (code) {
    case "MENU_CODE_CONFLICT":
      return "This code is already used. Group codes and page codes cannot collide.";
    case "MENU_RESOURCE_CONFLICT":
      return "This resource code is already used by another row.";
    case "MENU_ROUTE_CONFLICT":
      return "This route is already published by another page.";
    case "MENU_PAGE_ROUTE_REQUIRED":
      return "A page must keep a route path.";
    default:
      return fallbackMessage;
  }
}

function requestLiveMenuRefresh(reason = "menu-governance") {
  window.dispatchEvent(new CustomEvent("erp:menu-refresh-request", { detail: { reason } }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SAMenuGovernance() {
  const topActionRefs = useRef([]);
  const createCodeRef = useRef(null);
  const pageTitleRef = useRef(null);
  const groupEditorFirstRef = useRef(null);
  const groupPickerRefs = useRef([]);

  const [universe, setUniverse] = useState("SA");
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selectedMenuCode, setSelectedMenuCode] = useState("");
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [pageCatalogFilter, setPageCatalogFilter] = useState("ALL");

  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [pageEditor, setPageEditor] = useState(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const [createForm, setCreateForm] = useState({
    menu_code: "",
    resource_code: "",
    title: "",
    description: "",
    menu_type: "GROUP",
    parent_menu_code: "",
    display_order: "0",
  });

  const [editForm, setEditForm] = useState({
    menu_code: "",
    resource_code: "",
    title: "",
    description: "",
    route_path: "",
    display_order: "0",
    parent_menu_code: "",
  });

  // ---------------------------------------------------------------------------
  // Derived helpers
  // ---------------------------------------------------------------------------

  const getNextAvailableOrder = useCallback(
    (parentMenuCode = "", excludeMenuCode = "") => {
      const takenOrders = menus
        .filter((item) => (item.parent_menu_code ?? "") === parentMenuCode)
        .filter((item) => item.menu_code !== excludeMenuCode)
        .map((item) => Number(item.tree_display_order ?? item.display_order ?? 0))
        .filter((value) => Number.isFinite(value));
      if (takenOrders.length === 0) return 0;
      return Math.max(...takenOrders) + 1;
    },
    [menus],
  );

  const loadRegistry = useCallback(
    async (nextUniverse = universe) => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchMenuRegistry(nextUniverse);
        setMenus(data);
        const nextSelected = pickDefaultGroup(data, nextUniverse, selectedMenuCode);
        setSelectedMenuCode(nextSelected?.menu_code ?? "");
      } catch {
        setError("Unable to load menu governance registry right now.");
      } finally {
        setLoading(false);
      }
    },
    [selectedMenuCode, universe],
  );

  useEffect(() => {
    void loadRegistry(universe);
  }, [loadRegistry, universe]);

  const selectedMenu = useMemo(
    () => menus.find((item) => item.menu_code === selectedMenuCode) ?? null,
    [menus, selectedMenuCode],
  );

  useEffect(() => {
    if (!selectedMenu) return;
    setEditForm({
      menu_code: selectedMenu.menu_code ?? "",
      resource_code: selectedMenu.resource_code ?? "",
      title: selectedMenu.title ?? "",
      description: selectedMenu.description ?? "",
      route_path: selectedMenu.route_path ?? "",
      display_order: String(
        selectedMenu.display_order ?? selectedMenu.tree_display_order ?? 0,
      ),
      parent_menu_code: selectedMenu.parent_menu_code ?? "",
    });
  }, [selectedMenu]);

  // Create form validations
  const normalizedCreateMenuCode = useMemo(
    () => normalizeMenuCode(createForm.menu_code),
    [createForm.menu_code],
  );
  const normalizedCreateResourceCode = useMemo(
    () => normalizeMenuCode(createForm.resource_code || createForm.menu_code),
    [createForm.resource_code, createForm.menu_code],
  );
  const createReservedScreenByMenuCode = useMemo(
    () => findReservedScreenByCode(normalizedCreateMenuCode, universe),
    [normalizedCreateMenuCode, universe],
  );
  const createReservedScreenByResourceCode = useMemo(
    () => findReservedScreenByCode(normalizedCreateResourceCode, universe),
    [normalizedCreateResourceCode, universe],
  );
  const createCodeConflict = useMemo(
    () =>
      menus.find(
        (item) => item.universe === universe && item.menu_code === normalizedCreateMenuCode,
      ) ?? null,
    [menus, normalizedCreateMenuCode, universe],
  );
  const createResourceConflict = useMemo(
    () =>
      menus.find(
        (item) =>
          item.universe === universe &&
          item.resource_code === normalizedCreateResourceCode,
      ) ?? null,
    [menus, normalizedCreateResourceCode, universe],
  );
  const suggestedCreateOrder = useMemo(
    () => getNextAvailableOrder(createForm.parent_menu_code || ""),
    [createForm.parent_menu_code, getNextAvailableOrder],
  );

  // Edit form validations
  const selectedGroupSuggestedOrder = useMemo(
    () => getNextAvailableOrder(editForm.parent_menu_code || "", selectedMenuCode),
    [editForm.parent_menu_code, selectedMenuCode, getNextAvailableOrder],
  );
  const selectedGroupOrderConflict = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return null;
    const parsedOrder = Number(editForm.display_order || 0);
    if (!Number.isFinite(parsedOrder)) return null;
    return (
      menus.find(
        (item) =>
          item.menu_code !== selectedMenu.menu_code &&
          (item.parent_menu_code ?? "") === (editForm.parent_menu_code ?? "") &&
          Number(item.tree_display_order ?? item.display_order ?? 0) === parsedOrder,
      ) ?? null
    );
  }, [editForm.display_order, editForm.parent_menu_code, menus, selectedMenu]);
  const selectedGroupCodeConflict = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return null;
    const normalizedCode = normalizeMenuCode(editForm.menu_code);
    return (
      menus.find(
        (item) => item.menu_code === normalizedCode && item.menu_code !== selectedMenu.menu_code,
      ) ?? null
    );
  }, [editForm.menu_code, menus, selectedMenu]);
  const selectedGroupResourceConflict = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return null;
    const normalizedResourceCode = normalizeMenuCode(
      editForm.resource_code || editForm.menu_code,
    );
    return (
      menus.find(
        (item) =>
          item.resource_code === normalizedResourceCode &&
          item.menu_code !== selectedMenu.menu_code,
      ) ?? null
    );
  }, [editForm.menu_code, editForm.resource_code, menus, selectedMenu]);
  const selectedGroupReservedScreenByCode = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return null;
    return findReservedScreenByCode(normalizeMenuCode(editForm.menu_code), universe);
  }, [editForm.menu_code, selectedMenu, universe]);
  const selectedGroupReservedScreenByResource = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return null;
    return findReservedScreenByCode(
      normalizeMenuCode(editForm.resource_code || editForm.menu_code),
      universe,
    );
  }, [editForm.menu_code, editForm.resource_code, selectedMenu, universe]);
  const selectedGroupChildren = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return [];
    return menus.filter((item) => (item.parent_menu_code ?? "") === selectedMenu.menu_code);
  }, [menus, selectedMenu]);

  // Page editor validations
  const pageEditorSuggestedOrder = useMemo(
    () =>
      pageEditor
        ? getNextAvailableOrder(pageEditor.parent_menu_code || "", pageEditor.menu_code)
        : 0,
    [pageEditor, getNextAvailableOrder],
  );
  const pageEditorBlockingGroupConflict = useMemo(() => {
    if (!pageEditor || pageEditor.is_registered) return null;
    return (
      menus.find(
        (item) => item.menu_code === pageEditor.menu_code && item.menu_type !== "PAGE",
      ) ?? null
    );
  }, [menus, pageEditor]);
  const pageEditorResourceConflict = useMemo(() => {
    if (!pageEditor) return null;
    const targetResourceCode = pageEditor.resource_code.trim() || pageEditor.menu_code;
    return (
      menus.find(
        (item) =>
          item.resource_code === targetResourceCode && item.menu_code !== pageEditor.menu_code,
      ) ?? null
    );
  }, [menus, pageEditor]);
  const pageEditorRouteConflict = useMemo(() => {
    if (!pageEditor) return null;
    return (
      menus.find(
        (item) =>
          item.route_path === pageEditor.route_path && item.menu_code !== pageEditor.menu_code,
      ) ?? null
    );
  }, [menus, pageEditor]);

  // Lists
  const parentOptions = useMemo(
    () =>
      menus.filter(
        (item) =>
          item.universe === universe &&
          item.menu_code !== selectedMenuCode &&
          item.menu_type === "GROUP",
      ),
    [menus, selectedMenuCode, universe],
  );
  const registryRows = useMemo(
    () =>
      menus
        .filter((item) => item.universe === universe)
        .sort((l, r) => {
          const lo = l.tree_display_order ?? l.display_order ?? 0;
          const ro = r.tree_display_order ?? r.display_order ?? 0;
          return lo - ro || l.title.localeCompare(r.title);
        }),
    [menus, universe],
  );
  const groupRows = useMemo(
    () => registryRows.filter((item) => item.menu_type === "GROUP"),
    [registryRows],
  );
  const catalogBasePages = useMemo(() => {
    return Object.values(MENU_GOVERNANCE_SCREEN_REGISTRY)
      .filter((screen) => resolveGovernanceUniverse(screen) === universe)
      .filter((screen) => screen.publishableInMenu !== false)
      .filter((screen) => Boolean(screen?.screen_code) && Boolean(screen?.route))
      .map((screen) => {
        const registeredMenu = resolveRegisteredPageMenu(menus, screen);
        return {
          screen_code: screen.screen_code,
          title: formatScreenTitle(screen.screen_code),
          route_path: screen.route,
          registeredMenu,
          is_active: registeredMenu?.is_active ?? false,
          parent_menu_code: registeredMenu?.parent_menu_code ?? "",
          display_order:
            registeredMenu?.tree_display_order ?? registeredMenu?.display_order ?? null,
        };
      });
  }, [menus, universe]);
  const pageCatalogCounts = useMemo(() => {
    const inMenu = catalogBasePages.filter((p) => p.registeredMenu).length;
    const disabled = catalogBasePages.filter((p) => p.registeredMenu && !p.is_active).length;
    return {
      all: catalogBasePages.length,
      inMenu,
      notInMenu: catalogBasePages.length - inMenu,
      disabled,
    };
  }, [catalogBasePages]);
  const availablePages = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    return catalogBasePages
      .filter((page) => {
        if (needle) {
          return [page.screen_code, page.title, page.route_path]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(needle));
        }
        return true;
      })
      .filter((page) => {
        switch (pageCatalogFilter) {
          case "IN_MENU":
            return Boolean(page.registeredMenu);
          case "NOT_IN_MENU":
            return !page.registeredMenu;
          case "DISABLED":
            return Boolean(page.registeredMenu) && !page.is_active;
          default:
            return true;
        }
      })
      .sort((l, r) => l.title.localeCompare(r.title));
  }, [catalogBasePages, catalogSearch, pageCatalogFilter]);

  // ---------------------------------------------------------------------------
  // Group picker focus
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!groupPickerOpen) return undefined;
    const id = window.requestAnimationFrame(() => {
      groupPickerRefs.current[0]?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [groupPickerOpen]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleCreateMenu() {
    const normalizedMenuCode = normalizeMenuCode(createForm.menu_code);
    const normalizedResourceCode = normalizeMenuCode(
      createForm.resource_code || createForm.menu_code,
    );
    const reservedByMenu = findReservedScreenByCode(normalizedMenuCode, universe);
    const reservedByResource = findReservedScreenByCode(normalizedResourceCode, universe);
    const payload = {
      menu_code: normalizedMenuCode,
      resource_code: normalizedResourceCode,
      title: createForm.title.trim(),
      description: createForm.description.trim() || null,
      route_path: null,
      menu_type: "GROUP",
      universe,
      display_order: Number(createForm.display_order || 0),
      parent_menu_code: createForm.parent_menu_code || null,
      tree_display_order: Number(createForm.display_order || 0),
    };
    const orderConflict = menus.find(
      (item) =>
        (item.parent_menu_code ?? "") === (payload.parent_menu_code ?? "") &&
        Number(item.tree_display_order ?? item.display_order ?? 0) === payload.display_order,
    );

    if (!payload.menu_code || !payload.title) {
      setError("Group code and title are required.");
      return;
    }
    if (reservedByMenu) {
      setError(
        `${normalizedMenuCode} is reserved for page ${reservedByMenu.route}. Use a code like ${normalizedMenuCode}_GROUP.`,
      );
      return;
    }
    if (reservedByResource) {
      setError(
        `${normalizedResourceCode} is reserved for page ${reservedByResource.route}. Use a different resource code.`,
      );
      return;
    }
    if (orderConflict) {
      setError(
        `Order ${payload.display_order} is already used under ${payload.parent_menu_code || "root"} by ${orderConflict.title}. Suggested next order: ${suggestedCreateOrder}.`,
      );
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createMenu(payload);
      await loadRegistry(universe);
      requestLiveMenuRefresh("group-created");
      setSelectedMenuCode(created?.menu?.menu_code ?? payload.menu_code);
      setCreateForm((c) => ({
        ...c,
        menu_code: "",
        resource_code: "",
        title: "",
        description: "",
      }));
      closeCreateGroupModal();
      setNotice(`Group ${payload.menu_code} created.`);
    } catch (err) {
      setError(
        resolveMenuGovernanceErrorMessage(
          err instanceof Error ? err.message : "",
          "Group could not be created right now.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSelectedMenu() {
    if (!selectedMenu) return;

    const parsedOrder = Number(editForm.display_order || 0);
    const nextMenuCode = normalizeMenuCode(editForm.menu_code);
    const nextResourceCode = normalizeMenuCode(editForm.resource_code || editForm.menu_code);

    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      setError("Enter a valid order number.");
      return;
    }
    if (selectedGroupOrderConflict) {
      setError(
        `Order ${parsedOrder} is already used under ${editForm.parent_menu_code || "root"} by ${selectedGroupOrderConflict.title}. Suggested: ${selectedGroupSuggestedOrder}.`,
      );
      return;
    }
    if (!nextMenuCode || !editForm.title.trim()) {
      setError("Group code and title are required.");
      return;
    }
    if (selectedGroupReservedScreenByCode) {
      setError(
        `${nextMenuCode} is reserved for page ${selectedGroupReservedScreenByCode.route}. Use ${nextMenuCode}_GROUP.`,
      );
      return;
    }
    if (selectedGroupReservedScreenByResource) {
      setError(
        `${nextResourceCode} is reserved for page ${selectedGroupReservedScreenByResource.route}. Use another resource code.`,
      );
      return;
    }
    if (selectedGroupCodeConflict) {
      setError(`${nextMenuCode} is already used by ${selectedGroupCodeConflict.title}.`);
      return;
    }
    if (selectedGroupResourceConflict) {
      setError(`${nextResourceCode} is already used by ${selectedGroupResourceConflict.title}.`);
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateMenu({
        menu_code: selectedMenu.menu_code,
        next_menu_code: nextMenuCode,
        resource_code: nextResourceCode,
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        route_path: selectedMenu.route_path ?? null,
        display_order: parsedOrder,
      });
      await updateMenuTree({
        child_menu_code: selectedMenu.menu_code,
        parent_menu_code: editForm.parent_menu_code || null,
        display_order: parsedOrder,
      });
      await loadRegistry(universe);
      requestLiveMenuRefresh("group-updated");
      setNotice(`Group ${selectedMenu.menu_code} updated.`);
    } catch (err) {
      setError(
        resolveMenuGovernanceErrorMessage(
          err instanceof Error ? err.message : "",
          "Selected group could not be updated right now.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSelectedMenu() {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") return;
    if (selectedMenu.is_system) {
      setError("System groups cannot be removed.");
      return;
    }
    if (selectedGroupChildren.length > 0) {
      setError(
        `This group has ${selectedGroupChildren.length} child item(s). Move or remove them first.`,
      );
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteMenu({ menu_code: selectedMenu.menu_code });
      await loadRegistry(universe);
      requestLiveMenuRefresh("group-deleted");
      setGroupEditorOpen(false);
      setNotice(`Group ${selectedMenu.menu_code} removed.`);
    } catch (err) {
      setError(
        resolveMenuGovernanceErrorMessage(
          err instanceof Error ? err.message : "",
          "Selected group could not be removed right now.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSelectedMenuState() {
    if (!selectedMenu) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextState = !selectedMenu.is_active;
      await updateMenuState({ menu_code: selectedMenu.menu_code, is_active: nextState });
      await loadRegistry(universe);
      requestLiveMenuRefresh("group-state-updated");
      setNotice(
        `Group ${selectedMenu.menu_code} is now ${nextState ? "active" : "disabled"}.`,
      );
    } catch {
      setError("Group state could not be updated right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePageState(page) {
    if (!page.registeredMenu) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateMenuState({
        menu_code: page.registeredMenu.menu_code,
        is_active: !page.is_active,
      });
      await loadRegistry(universe);
      requestLiveMenuRefresh("page-state-updated");
      setNotice(`${page.title} is now ${page.is_active ? "disabled" : "active"}.`);
    } catch {
      setError("Page state could not be updated right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePageEditor() {
    if (!pageEditor) return;

    const targetMenuCode = pageEditor.menu_code;
    const targetResourceCode = pageEditor.resource_code.trim() || targetMenuCode;
    const targetParent = pageEditor.parent_menu_code || null;
    const parsedOrder = Number(pageEditor.display_order || 0);

    if (targetParent === targetMenuCode) {
      setError("A page cannot be its own group.");
      return;
    }
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      setError("Enter a valid order number.");
      return;
    }
    const orderConflict = menus.find(
      (item) =>
        item.menu_code !== targetMenuCode &&
        (item.parent_menu_code ?? "") === (targetParent ?? "") &&
        Number(item.tree_display_order ?? item.display_order ?? 0) === parsedOrder,
    );
    if (orderConflict) {
      setError(
        `Order ${parsedOrder} is already used under ${targetParent || "root"} by ${orderConflict.title}.`,
      );
      return;
    }
    const blockingCodeConflict = menus.find(
      (item) => item.menu_code === targetMenuCode && item.menu_type !== "PAGE",
    );
    if (!pageEditor.is_registered && blockingCodeConflict) {
      setError(
        `${targetMenuCode} is already used by group ${blockingCodeConflict.title}. Rename or remove that group first.`,
      );
      return;
    }
    const blockingResourceConflict = menus.find(
      (item) =>
        item.resource_code === targetResourceCode && item.menu_code !== targetMenuCode,
    );
    if (blockingResourceConflict) {
      setError(
        `${targetResourceCode} is already used by ${blockingResourceConflict.title}.`,
      );
      return;
    }
    const blockingRouteConflict = menus.find(
      (item) =>
        item.route_path === pageEditor.route_path && item.menu_code !== targetMenuCode,
    );
    if (blockingRouteConflict) {
      setError(
        `${pageEditor.route_path} is already published by ${blockingRouteConflict.title}.`,
      );
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (pageEditor.is_registered) {
        await updateMenu({
          menu_code: targetMenuCode,
          resource_code: targetResourceCode,
          menu_type: "PAGE",
          title: pageEditor.title.trim(),
          description: pageEditor.description.trim() || null,
          route_path: pageEditor.route_path,
          display_order: parsedOrder,
        });
        await updateMenuTree({
          child_menu_code: targetMenuCode,
          parent_menu_code: targetParent,
          display_order: parsedOrder,
        });
      } else {
        await createMenu({
          menu_code: pageEditor.menu_code,
          resource_code: targetResourceCode,
          title: pageEditor.title.trim(),
          description: pageEditor.description.trim() || null,
          route_path: pageEditor.route_path,
          menu_type: "PAGE",
          universe,
          display_order: parsedOrder,
          parent_menu_code: targetParent,
          tree_display_order: parsedOrder,
        });
      }
      await loadRegistry(universe);
      requestLiveMenuRefresh("page-saved");
      setGroupPickerOpen(false);
      setPageEditor(null);
      setNotice(`${pageEditor.title} saved into the menu registry.`);
    } catch (err) {
      setError(
        resolveMenuGovernanceErrorMessage(
          err instanceof Error ? err.message : "",
          "That page could not be saved right now.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  function openPageEditor(page) {
    const safeParent =
      page.parent_menu_code && page.parent_menu_code !== page.screen_code
        ? page.parent_menu_code
        : "";
    const defaultOrder =
      page.display_order ??
      getNextAvailableOrder(safeParent, page.registeredMenu?.menu_code ?? "");
    setPageEditor({
      screen_code: page.screen_code,
      menu_code: page.registeredMenu?.menu_code ?? page.screen_code,
      title: page.registeredMenu?.title ?? page.title,
      resource_code: page.registeredMenu?.resource_code ?? page.screen_code,
      description: page.registeredMenu?.description ?? "",
      parent_menu_code: safeParent,
      display_order: String(defaultOrder),
      route_path: page.route_path,
      is_registered: Boolean(page.registeredMenu),
      is_active: page.is_active,
    });
    setGroupPickerOpen(false);
    window.requestAnimationFrame(() => {
      pageTitleRef.current?.focus();
    });
  }

  function openCreateGroupModal() {
    setCreateGroupOpen(true);
    window.requestAnimationFrame(() => {
      createCodeRef.current?.focus();
    });
  }

  function closeCreateGroupModal() {
    setCreateGroupOpen(false);
  }

  function closePageEditor() {
    setGroupPickerOpen(false);
    setPageEditor(null);
  }

  function assignParentGroup(groupCode) {
    setPageEditor((current) =>
      current
        ? {
            ...current,
            parent_menu_code: groupCode,
            display_order: String(getNextAvailableOrder(groupCode, current.menu_code)),
          }
        : current,
    );
    setGroupPickerOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Commands + hotkeys
  // ---------------------------------------------------------------------------

  useErpScreenCommands([
    {
      id: "sa-menu-governance-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing menu governance..." : "Refresh menu registry",
      keywords: ["refresh", "menu", "governance"],
      disabled: loading,
      perform: () => void loadRegistry(universe),
      order: 10,
    },
    {
      id: "sa-menu-governance-focus-create",
      group: "Current Screen",
      label: "Open create group modal",
      keywords: ["menu code", "create menu"],
      perform: openCreateGroupModal,
      order: 20,
    },
    {
      id: "sa-menu-governance-control-panel",
      group: "Current Screen",
      label: "Back to control panel",
      keywords: ["control panel", "sa"],
      perform: () => openScreen("SA_CONTROL_PANEL", { mode: "replace" }),
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadRegistry(universe),
    },
    focusPrimary: {
      perform: openCreateGroupModal,
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ErpScreenScaffold
      eyebrow="Menu Governance"
      title="Super Admin Menu Governance"
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh Registry",
          hint: "Alt+R",
          tone: "primary",
          buttonRef: (el) => { topActionRefs.current[0] = el; },
          onClick: () => void loadRegistry(universe),
          onKeyDown: (e) =>
            handleLinearNavigation(e, { index: 0, refs: topActionRefs.current, orientation: "horizontal" }),
        },
        {
          key: "create-group",
          label: "Create Group",
          hint: "F3",
          tone: "neutral",
          buttonRef: (el) => { topActionRefs.current[1] = el; },
          onClick: openCreateGroupModal,
          onKeyDown: (e) =>
            handleLinearNavigation(e, { index: 1, refs: topActionRefs.current, orientation: "horizontal" }),
        },
        {
          key: "control-panel",
          label: "Control Panel",
          tone: "neutral",
          buttonRef: (el) => { topActionRefs.current[2] = el; },
          onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "replace" }),
          onKeyDown: (e) =>
            handleLinearNavigation(e, { index: 2, refs: topActionRefs.current, orientation: "horizontal" }),
        },
      ]}
      footerHints={["↑↓ Navigate", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
    >
      {/* Universe selector */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Universe
        </span>
        {["SA", "ACL"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setUniverse(value)}
            className={`border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
              universe === value
                ? "border-sky-300 bg-sky-50 text-sky-900"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {/* Main two-column layout */}
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">

        {/* ---------------------------------------------------------------- */}
        {/* LEFT — Groups                                                     */}
        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Groups ({groupRows.length})
            </span>
            <button
              type="button"
              onClick={openCreateGroupModal}
              className="border border-sky-300 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
            >
              + New Group
            </button>
          </div>

          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Loading groups...
            </div>
          ) : groupRows.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No groups in this universe. Create one to get started.
            </div>
          ) : (
            <div className="grid gap-1">
              {groupRows.map((item) => (
                <button
                  key={item.menu_code}
                  type="button"
                  onClick={() => {
                    setSelectedMenuCode(item.menu_code);
                    setGroupEditorOpen(true);
                  }}
                  className={`flex w-full items-start justify-between gap-3 border px-4 py-3 text-left transition-colors ${
                    item.menu_code === selectedMenuCode
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </span>
                      {item.parent_menu_code && (
                        <span className="text-[10px] text-slate-400">
                          ↳ {item.parent_menu_code}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {item.menu_code} · Order {item.tree_display_order ?? item.display_order ?? 0}
                    </div>
                  </div>
                  <span
                    className={`flex-shrink-0 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      item.is_active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {item.is_active ? "Active" : "Disabled"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* RIGHT — Page Catalog                                              */}
        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Pages
            </span>
          </div>

          {/* Search */}
          <input
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
            className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
            placeholder="Search by screen code, title, or route"
          />

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={filterTabClass(pageCatalogFilter === "ALL")}
              onClick={() => setPageCatalogFilter("ALL")}
            >
              All ({pageCatalogCounts.all})
            </button>
            <button
              type="button"
              className={filterTabClass(pageCatalogFilter === "IN_MENU")}
              onClick={() => setPageCatalogFilter("IN_MENU")}
            >
              In Menu ({pageCatalogCounts.inMenu})
            </button>
            <button
              type="button"
              className={filterTabClass(pageCatalogFilter === "NOT_IN_MENU")}
              onClick={() => setPageCatalogFilter("NOT_IN_MENU")}
            >
              Not In Menu ({pageCatalogCounts.notInMenu})
            </button>
            <button
              type="button"
              className={filterTabClass(pageCatalogFilter === "DISABLED")}
              onClick={() => setPageCatalogFilter("DISABLED")}
            >
              Disabled ({pageCatalogCounts.disabled})
            </button>
          </div>

          {/* Page rows */}
          {availablePages.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No pages match the current filter.
            </div>
          ) : (
            <div className="grid gap-1">
              {availablePages.map((page) => (
                <div
                  key={page.screen_code}
                  className="flex items-start justify-between gap-3 border border-slate-200 bg-white px-4 py-3"
                >
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {page.title}
                      </span>
                      <span className="border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                        Page
                      </span>
                      <span
                        className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          page.registeredMenu
                            ? page.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {page.registeredMenu
                          ? page.is_active
                            ? "Active"
                            : "Disabled"
                          : "Not In Menu"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      {page.screen_code}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{page.route_path}</div>
                    {page.registeredMenu && (
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        Group: {page.parent_menu_code || "unassigned"} · Order:{" "}
                        {page.display_order ?? "—"}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-shrink-0 gap-1">
                    {page.registeredMenu && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleTogglePageState(page)}
                        className="border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {page.is_active ? "Disable" : "Enable"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => openPageEditor(page)}
                      className={`border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                        page.registeredMenu
                          ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          : "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      }`}
                    >
                      {page.registeredMenu ? "Page Settings" : "Publish Page"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Group Editor Drawer                                                 */}
      {/* ------------------------------------------------------------------ */}
      <DrawerBase
        visible={groupEditorOpen && Boolean(selectedMenu)}
        title={selectedMenu?.title ?? "Group Settings"}
        onClose={() => setGroupEditorOpen(false)}
        initialFocusRef={groupEditorFirstRef}
        width="min(480px, calc(100vw - 24px))"
        actions={
          selectedMenu ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => setGroupEditorOpen(false)}
                className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Close
              </button>
              {!selectedMenu.is_system && (
                <button
                  type="button"
                  disabled={saving || selectedGroupChildren.length > 0}
                  onClick={() => void handleDeleteSelectedMenu()}
                  className="border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    selectedGroupChildren.length > 0
                      ? `Cannot remove — ${selectedGroupChildren.length} child item(s) still inside`
                      : "Remove this group"
                  }
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleToggleSelectedMenuState()}
                className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {selectedMenu.is_active ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveSelectedMenu()}
                className="border border-sky-500 bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : null
        }
      >
        {selectedMenu && selectedMenu.menu_type === "GROUP" && (
          <div className="grid gap-5">
            {/* Meta strip */}
            <div className="border border-slate-200 bg-slate-50">
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <span className="text-[11px] text-slate-500">Parent</span>
                <span className="text-[11px] font-semibold text-slate-800">
                  {selectedMenu.parent_menu_code || "Root"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <span className="text-[11px] text-slate-500">Child items</span>
                <span className="text-[11px] font-semibold text-slate-800">
                  {selectedGroupChildren.length}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                <span className="text-[11px] text-slate-500">Suggested next order</span>
                <span className="text-[11px] font-semibold text-slate-800">
                  {selectedGroupSuggestedOrder}
                </span>
              </div>
            </div>

            {/* Warnings */}
            {(selectedGroupReservedScreenByCode ||
              selectedGroupReservedScreenByResource ||
              selectedGroupCodeConflict ||
              selectedGroupResourceConflict ||
              selectedGroupOrderConflict ||
              selectedGroupChildren.length > 0) && (
              <div className="grid gap-1.5 border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                {selectedGroupReservedScreenByCode && (
                  <p className="text-amber-800">
                    Code `{normalizeMenuCode(editForm.menu_code)}` is reserved for page{" "}
                    {selectedGroupReservedScreenByCode.route}.
                  </p>
                )}
                {selectedGroupReservedScreenByResource && (
                  <p className="text-amber-800">
                    Resource `{normalizeMenuCode(editForm.resource_code || editForm.menu_code)}`
                    is reserved for page {selectedGroupReservedScreenByResource.route}.
                  </p>
                )}
                {selectedGroupCodeConflict && (
                  <p className="text-rose-700">
                    Code conflict with {selectedGroupCodeConflict.title}.
                  </p>
                )}
                {selectedGroupResourceConflict && (
                  <p className="text-rose-700">
                    Resource conflict with {selectedGroupResourceConflict.title}.
                  </p>
                )}
                {selectedGroupOrderConflict && (
                  <p className="text-rose-700">
                    Order collides with {selectedGroupOrderConflict.title}.
                  </p>
                )}
                {selectedGroupChildren.length > 0 && (
                  <p className="text-slate-700">
                    Remove is blocked — {selectedGroupChildren.length} child item(s) must be
                    moved out first.
                  </p>
                )}
              </div>
            )}

            {/* Edit fields */}
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Group Code
                </span>
                <input
                  ref={groupEditorFirstRef}
                  value={editForm.menu_code}
                  onChange={(e) =>
                    setEditForm((c) => ({ ...c, menu_code: e.target.value }))
                  }
                  className={inputClass()}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  ACL Resource Code
                </span>
                <input
                  value={editForm.resource_code}
                  onChange={(e) =>
                    setEditForm((c) => ({ ...c, resource_code: e.target.value }))
                  }
                  className={inputClass()}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Title
                </span>
                <input
                  value={editForm.title}
                  onChange={(e) =>
                    setEditForm((c) => ({ ...c, title: e.target.value }))
                  }
                  className={inputClass()}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Description
                </span>
                <textarea
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm((c) => ({ ...c, description: e.target.value }))
                  }
                  rows={2}
                  className={inputClass()}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Display Order
                  </span>
                  <input
                    type="number"
                    value={editForm.display_order}
                    onChange={(e) =>
                      setEditForm((c) => ({ ...c, display_order: e.target.value }))
                    }
                    className={inputClass()}
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Parent Group
                  </span>
                  <ErpComboboxField
                    value={editForm.parent_menu_code}
                    onChange={(val) =>
                      setEditForm((c) => ({
                        ...c,
                        parent_menu_code: val,
                        display_order: String(
                          getNextAvailableOrder(val, selectedMenu?.menu_code ?? ""),
                        ),
                      }))
                    }
                    options={parentOptions.map((opt) => ({
                      value: opt.menu_code,
                      label: `${opt.title} (${opt.menu_code})`,
                    }))}
                    blankLabel="No parent"
                    inputClassName="px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </DrawerBase>

      {/* ------------------------------------------------------------------ */}
      {/* Create Group Modal                                                  */}
      {/* ------------------------------------------------------------------ */}
      <ModalBase
        visible={createGroupOpen}
        eyebrow="Group Registry"
        title="Create New Group"
        message="Groups are drawer buckets. Publish actual screens from the page catalog."
        onEscape={closeCreateGroupModal}
        initialFocusRef={createCodeRef}
        width="min(820px, calc(100vw - 32px))"
        actions={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={closeCreateGroupModal}
              className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreateMenu()}
              className="border border-sky-500 bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Group"}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Group Code
              </span>
              <input
                ref={createCodeRef}
                value={createForm.menu_code}
                onChange={(e) =>
                  setCreateForm((c) => ({ ...c, menu_code: e.target.value }))
                }
                className={inputClass()}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                ACL Resource Code
              </span>
              <input
                value={createForm.resource_code}
                onChange={(e) =>
                  setCreateForm((c) => ({ ...c, resource_code: e.target.value }))
                }
                className={inputClass()}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Title
              </span>
              <input
                value={createForm.title}
                onChange={(e) =>
                  setCreateForm((c) => ({ ...c, title: e.target.value }))
                }
                className={inputClass()}
              />
            </label>
            <label className="grid gap-1.5 md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Description
              </span>
              <textarea
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm((c) => ({ ...c, description: e.target.value }))
                }
                rows={2}
                className={inputClass()}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Parent Group
              </span>
              <ErpComboboxField
                value={createForm.parent_menu_code}
                onChange={(val) =>
                  setCreateForm((c) => ({
                    ...c,
                    parent_menu_code: val,
                    display_order: String(getNextAvailableOrder(val)),
                  }))
                }
                options={menus
                  .filter((item) => item.universe === universe && item.menu_type === "GROUP")
                  .map((opt) => ({
                    value: opt.menu_code,
                    label: `${opt.title} (${opt.menu_code})`,
                  }))}
                blankLabel="No parent"
                inputClassName="px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Display Order
              </span>
              <input
                type="number"
                value={createForm.display_order}
                onChange={(e) =>
                  setCreateForm((c) => ({ ...c, display_order: e.target.value }))
                }
                className={inputClass()}
              />
            </label>
          </div>

          {/* Hints and warnings */}
          <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Suggested next free order under {createForm.parent_menu_code || "root"}:{" "}
            <span className="font-semibold text-slate-900">{suggestedCreateOrder}</span>
          </div>

          {(createReservedScreenByMenuCode ||
            createReservedScreenByResourceCode ||
            createCodeConflict ||
            createResourceConflict) && (
            <div className="grid gap-1.5 border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              {createReservedScreenByMenuCode && (
                <p className="text-amber-800">
                  `{normalizedCreateMenuCode}` is reserved for page{" "}
                  {createReservedScreenByMenuCode.route}. Suggested:{" "}
                  <strong>{normalizedCreateMenuCode}_GROUP</strong>
                </p>
              )}
              {createReservedScreenByResourceCode && (
                <p className="text-amber-800">
                  Resource `{normalizedCreateResourceCode}` is reserved. Suggested:{" "}
                  <strong>{normalizedCreateResourceCode}_GROUP</strong>
                </p>
              )}
              {createCodeConflict && (
                <p className="text-rose-700">
                  Code `{normalizedCreateMenuCode}` already used by {createCodeConflict.title}.
                </p>
              )}
              {createResourceConflict && (
                <p className="text-rose-700">
                  Resource `{normalizedCreateResourceCode}` already used by{" "}
                  {createResourceConflict.title}.
                </p>
              )}
            </div>
          )}
        </div>
      </ModalBase>

      {/* ------------------------------------------------------------------ */}
      {/* Page Settings Modal                                                 */}
      {/* ------------------------------------------------------------------ */}
      <ModalBase
        visible={Boolean(pageEditor)}
        eyebrow="Page Registry"
        title={pageEditor?.title ?? "Page Settings"}
        message={
          pageEditor ? `${pageEditor.screen_code} · ${pageEditor.route_path}` : ""
        }
        onEscape={closePageEditor}
        initialFocusRef={pageTitleRef}
        width="min(820px, calc(100vw - 32px))"
        actions={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={closePageEditor}
              className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !pageEditor}
              onClick={() => void handleSavePageEditor()}
              className="border border-sky-500 bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Page Placement"}
            </button>
          </>
        }
      >
        {pageEditor && (
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Title
                </span>
                <input
                  ref={pageTitleRef}
                  value={pageEditor.title}
                  onChange={(e) =>
                    setPageEditor((c) => (c ? { ...c, title: e.target.value } : c))
                  }
                  className={inputClass()}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Resource Code
                </span>
                <input
                  value={pageEditor.resource_code}
                  disabled={pageEditor.is_registered}
                  onChange={(e) =>
                    setPageEditor((c) => (c ? { ...c, resource_code: e.target.value } : c))
                  }
                  className={`${inputClass()} disabled:bg-slate-50 disabled:text-slate-400`}
                />
              </label>

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Description
                </span>
                <textarea
                  value={pageEditor.description}
                  onChange={(e) =>
                    setPageEditor((c) => (c ? { ...c, description: e.target.value } : c))
                  }
                  rows={2}
                  className={inputClass()}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Parent Group
                </span>
                <button
                  type="button"
                  onClick={() => setGroupPickerOpen((v) => !v)}
                  className="border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-50"
                >
                  {pageEditor.parent_menu_code || "Choose parent group"}
                </button>
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Order
                </span>
                <input
                  type="number"
                  value={pageEditor.display_order}
                  onChange={(e) =>
                    setPageEditor((c) => (c ? { ...c, display_order: e.target.value } : c))
                  }
                  className={inputClass()}
                />
              </label>
            </div>

            {/* Hints */}
            <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Suggested next free order under {pageEditor.parent_menu_code || "root"}:{" "}
              <span className="font-semibold text-slate-900">{pageEditorSuggestedOrder}</span>
            </div>

            {(pageEditorBlockingGroupConflict ||
              pageEditorResourceConflict ||
              pageEditorRouteConflict) && (
              <div className="grid gap-1.5 border border-rose-200 bg-rose-50 px-3 py-2 text-xs">
                {pageEditorBlockingGroupConflict && (
                  <div className="flex flex-wrap items-center gap-2 text-rose-700">
                    <span>
                      `{pageEditor.menu_code}` is already used by group{" "}
                      {pageEditorBlockingGroupConflict.title}. Rename or remove that group first.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMenuCode(pageEditorBlockingGroupConflict.menu_code);
                        closePageEditor();
                      }}
                      className="border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700"
                    >
                      Open Conflicting Group
                    </button>
                  </div>
                )}
                {pageEditorResourceConflict && (
                  <p className="text-rose-700">
                    Resource `{pageEditor.resource_code.trim() || pageEditor.menu_code}` already
                    used by {pageEditorResourceConflict.title}.
                  </p>
                )}
                {pageEditorRouteConflict && (
                  <p className="text-rose-700">
                    Route `{pageEditor.route_path}` already published by{" "}
                    {pageEditorRouteConflict.title}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </ModalBase>

      {/* ------------------------------------------------------------------ */}
      {/* Group Picker Drawer (for Page Settings)                             */}
      {/* ------------------------------------------------------------------ */}
      <DrawerBase
        visible={Boolean(pageEditor) && groupPickerOpen}
        title="Choose Parent Group"
        onEscape={() => {
          setGroupPickerOpen(false);
          pageTitleRef.current?.focus();
        }}
        width="min(380px, calc(100vw - 24px))"
        actions={
          <button
            type="button"
            onClick={() => {
              setGroupPickerOpen(false);
              pageTitleRef.current?.focus();
            }}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        }
      >
        <div className="grid gap-2">
          {groupRows.map((group, index) => (
            <button
              key={group.menu_code}
              ref={(el) => {
                groupPickerRefs.current[index] = el;
              }}
              type="button"
              onClick={() => assignParentGroup(group.menu_code)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  handleLinearNavigation(e, {
                    index,
                    refs: groupPickerRefs.current,
                    orientation: "vertical",
                  });
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  assignParentGroup(group.menu_code);
                }
                if (e.key === "Escape" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  setGroupPickerOpen(false);
                  pageTitleRef.current?.focus();
                }
              }}
              className={`border px-3 py-2.5 text-left text-sm transition-colors ${
                pageEditor?.parent_menu_code === group.menu_code
                  ? "border-sky-300 bg-sky-50 text-sky-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <div className="font-semibold">{group.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{group.menu_code}</div>
            </button>
          ))}
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
