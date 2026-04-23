/*
 * File-ID: 9.12-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAMenuGovernance.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin menu governance surface for registry, hierarchy, state, and preview control
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { SCREEN_REGISTRY } from "../../../navigation/screenRegistry.js";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

function inputClassName() {
  return "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500";
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
    {
      credentials: "include",
    }
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
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "MENU_CREATE_FAILED");
  }

  return json.data;
}

async function updateMenu(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "MENU_UPDATE_FAILED");
  }

  return json.data;
}

async function updateMenuTree(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu/tree`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "MENU_TREE_UPDATE_FAILED");
  }

  return json.data;
}

async function updateMenuState(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu/state`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "MENU_STATE_UPDATE_FAILED");
  }

  return json.data;
}

async function deleteMenu(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/menu`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "MENU_DELETE_FAILED");
  }

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

  if (route.startsWith("/sa") || route.startsWith("/ga")) {
    return "SA";
  }

  if (route.startsWith("/dashboard")) {
    return "ACL";
  }

  return null;
}

function resolveRegisteredPageMenu(menus, screen) {
  const route = String(screen?.route ?? "");
  const screenCode = String(screen?.screen_code ?? "");

  return (
    menus.find(
      (item) =>
        item.menu_type === "PAGE" &&
        item.route_path === route
    ) ??
    menus.find(
      (item) =>
        item.menu_type === "PAGE" &&
        item.menu_code === screenCode
    ) ??
    null
  );
}

function pickDefaultGroup(menus, universe, selectedMenuCode) {
  const universeMenus = menus.filter((item) => item.universe === universe);
  const selectedGroup = universeMenus.find(
    (item) => item.menu_code === selectedMenuCode && item.menu_type === "GROUP"
  );

  if (selectedGroup) {
    return selectedGroup;
  }

  return (
    universeMenus.find((item) => item.menu_type === "GROUP") ??
    universeMenus[0] ??
    null
  );
}

function findReservedScreenByCode(screenCode, universe) {
  const normalizedCode = normalizeMenuCode(screenCode);

  return Object.values(SCREEN_REGISTRY).find(
    (screen) =>
      resolveGovernanceUniverse(screen) === universe &&
      normalizeMenuCode(screen?.screen_code) === normalizedCode
  ) ?? null;
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
  window.dispatchEvent(
    new CustomEvent("erp:menu-refresh-request", {
      detail: { reason },
    })
  );
}

function pageFilterButtonClass(isActive) {
  return `border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] ${
    isActive
      ? "border-sky-300 bg-sky-50 text-sky-900"
      : "border-slate-300 bg-white text-slate-600"
  }`;
}

export default function SAMenuGovernance() {
  const topActionRefs = useRef([]);
  const createCodeRef = useRef(null);
  const pageTitleRef = useRef(null);
  const groupPickerRefs = useRef([]);
  const [universe, setUniverse] = useState("SA");
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedMenuCode, setSelectedMenuCode] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [pageCatalogFilter, setPageCatalogFilter] = useState("ALL");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [showLegacyPageEditor] = useState(false);
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

  async function loadRegistry(nextUniverse = universe) {
    setLoading(true);
    setError("");

    try {
      const data = await fetchMenuRegistry(nextUniverse);
      setMenus(data);

      const nextSelected = pickDefaultGroup(
        data,
        nextUniverse,
        selectedMenuCode
      );

      setSelectedMenuCode(nextSelected?.menu_code ?? "");
    } catch {
      setError("Unable to load menu governance registry right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRegistry(universe);
  }, [universe]);

  const selectedMenu = useMemo(
    () => menus.find((item) => item.menu_code === selectedMenuCode) ?? null,
    [menus, selectedMenuCode]
  );

  useEffect(() => {
    if (!selectedMenu) {
      return;
    }

    setEditForm({
      menu_code: selectedMenu.menu_code ?? "",
      resource_code: selectedMenu.resource_code ?? "",
      title: selectedMenu.title ?? "",
      description: selectedMenu.description ?? "",
      route_path: selectedMenu.route_path ?? "",
      display_order: String(selectedMenu.display_order ?? selectedMenu.tree_display_order ?? 0),
      parent_menu_code: selectedMenu.parent_menu_code ?? "",
    });
  }, [selectedMenu]);

  const normalizedCreateMenuCode = useMemo(
    () => normalizeMenuCode(createForm.menu_code),
    [createForm.menu_code]
  );

  const normalizedCreateResourceCode = useMemo(
    () => normalizeMenuCode(createForm.resource_code || createForm.menu_code),
    [createForm.resource_code, createForm.menu_code]
  );

  const createReservedScreenByMenuCode = useMemo(
    () => findReservedScreenByCode(normalizedCreateMenuCode, universe),
    [normalizedCreateMenuCode, universe]
  );

  const createReservedScreenByResourceCode = useMemo(
    () => findReservedScreenByCode(normalizedCreateResourceCode, universe),
    [normalizedCreateResourceCode, universe]
  );

  const createCodeConflict = useMemo(
    () =>
      menus.find(
        (item) => item.universe === universe && item.menu_code === normalizedCreateMenuCode
      ) ?? null,
    [menus, normalizedCreateMenuCode, universe]
  );

  const createResourceConflict = useMemo(
    () =>
      menus.find(
        (item) =>
          item.universe === universe &&
          item.resource_code === normalizedCreateResourceCode
      ) ?? null,
    [menus, normalizedCreateResourceCode, universe]
  );

  const suggestedCreateOrder = useMemo(
    () => getNextAvailableOrder(createForm.parent_menu_code || ""),
    [createForm.parent_menu_code, menus]
  );

  const selectedGroupSuggestedOrder = useMemo(
    () => getNextAvailableOrder(editForm.parent_menu_code || "", selectedMenuCode),
    [editForm.parent_menu_code, menus, selectedMenuCode]
  );

  const selectedGroupOrderConflict = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return null;
    }

    const parsedOrder = Number(editForm.display_order || 0);
    if (!Number.isFinite(parsedOrder)) {
      return null;
    }

    return (
      menus.find(
        (item) =>
          item.menu_code !== selectedMenu.menu_code &&
          (item.parent_menu_code ?? "") === (editForm.parent_menu_code ?? "") &&
          Number(item.tree_display_order ?? item.display_order ?? 0) === parsedOrder
      ) ?? null
    );
  }, [editForm.display_order, editForm.parent_menu_code, menus, selectedMenu]);

  const selectedGroupCodeConflict = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return null;
    }

    const normalizedCode = normalizeMenuCode(editForm.menu_code);
    return (
      menus.find(
        (item) =>
          item.menu_code === normalizedCode &&
          item.menu_code !== selectedMenu.menu_code
      ) ?? null
    );
  }, [editForm.menu_code, menus, selectedMenu]);

  const selectedGroupResourceConflict = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return null;
    }

    const normalizedResourceCode = normalizeMenuCode(
      editForm.resource_code || editForm.menu_code
    );

    return (
      menus.find(
        (item) =>
          item.resource_code === normalizedResourceCode &&
          item.menu_code !== selectedMenu.menu_code
      ) ?? null
    );
  }, [editForm.menu_code, editForm.resource_code, menus, selectedMenu]);

  const selectedGroupReservedScreenByCode = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return null;
    }

    return findReservedScreenByCode(normalizeMenuCode(editForm.menu_code), universe);
  }, [editForm.menu_code, selectedMenu, universe]);

  const selectedGroupReservedScreenByResource = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return null;
    }

    return findReservedScreenByCode(
      normalizeMenuCode(editForm.resource_code || editForm.menu_code),
      universe
    );
  }, [editForm.menu_code, editForm.resource_code, selectedMenu, universe]);

  const selectedGroupChildren = useMemo(() => {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return [];
    }

    return menus.filter(
      (item) => (item.parent_menu_code ?? "") === selectedMenu.menu_code
    );
  }, [menus, selectedMenu]);

  const pageEditorSuggestedOrder = useMemo(
    () =>
      pageEditor
        ? getNextAvailableOrder(pageEditor.parent_menu_code || "", pageEditor.menu_code)
        : 0,
    [menus, pageEditor]
  );

  const pageEditorBlockingGroupConflict = useMemo(() => {
    if (!pageEditor || pageEditor.is_registered) {
      return null;
    }

    return (
      menus.find(
        (item) =>
          item.menu_code === pageEditor.menu_code &&
          item.menu_type !== "PAGE"
      ) ?? null
    );
  }, [menus, pageEditor]);

  const pageEditorResourceConflict = useMemo(() => {
    if (!pageEditor) {
      return null;
    }

    const targetResourceCode = pageEditor.resource_code.trim() || pageEditor.menu_code;

    return (
      menus.find(
        (item) =>
          item.resource_code === targetResourceCode &&
          item.menu_code !== pageEditor.menu_code
      ) ?? null
    );
  }, [menus, pageEditor]);

  const pageEditorRouteConflict = useMemo(() => {
    if (!pageEditor) {
      return null;
    }

    return (
      menus.find(
        (item) =>
          item.route_path === pageEditor.route_path &&
          item.menu_code !== pageEditor.menu_code
      ) ?? null
    );
  }, [menus, pageEditor]);

  useEffect(() => {
    if (!groupPickerOpen) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      groupPickerRefs.current[0]?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [groupPickerOpen]);

  const parentOptions = useMemo(
    () =>
      menus.filter(
        (item) =>
          item.universe === universe &&
          item.menu_code !== selectedMenuCode &&
          item.menu_type === "GROUP"
      ),
    [menus, selectedMenuCode, universe]
  );

  const registryRows = useMemo(
    () =>
      menus
        .filter((item) => item.universe === universe)
        .sort((left, right) => {
          const leftOrder = left.tree_display_order ?? left.display_order ?? 0;
          const rightOrder = right.tree_display_order ?? right.display_order ?? 0;
          return leftOrder - rightOrder || left.title.localeCompare(right.title);
        }),
    [menus, universe]
  );

  const groupRows = useMemo(
    () => registryRows.filter((item) => item.menu_type === "GROUP"),
    [registryRows]
  );

  const catalogBasePages = useMemo(() => {
    return Object.values(SCREEN_REGISTRY)
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
            registeredMenu?.tree_display_order ??
            registeredMenu?.display_order ??
            null,
        };
      });
  }, [menus, universe]);

  const pageCatalogCounts = useMemo(() => {
    const inMenu = catalogBasePages.filter((page) => page.registeredMenu).length;
    const disabled = catalogBasePages.filter(
      (page) => page.registeredMenu && !page.is_active
    ).length;

    return {
      all: catalogBasePages.length,
      inMenu,
      notInMenu: catalogBasePages.length - inMenu,
      disabled,
    };
  }, [catalogBasePages]);

  const availablePages = useMemo(() => {
    const searchTerm = catalogSearch.trim().toLowerCase();

    return catalogBasePages
      .filter((page) => {
        if (!searchTerm) {
          return true;
        }

        return [page.screen_code, page.title, page.route_path]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(searchTerm));
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
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [catalogBasePages, catalogSearch, pageCatalogFilter]);

  async function handleCreateMenu() {
    const normalizedMenuCode = normalizeMenuCode(createForm.menu_code);
    const normalizedResourceCode = normalizeMenuCode(
      createForm.resource_code || createForm.menu_code
    );
    const reservedScreenByMenuCode = findReservedScreenByCode(
      normalizedMenuCode,
      universe
    );
    const reservedScreenByResourceCode = findReservedScreenByCode(
      normalizedResourceCode,
      universe
    );

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
    const createOrderConflict = menus.find(
      (item) =>
        (item.parent_menu_code ?? "") === (payload.parent_menu_code ?? "") &&
        Number(item.tree_display_order ?? item.display_order ?? 0) === payload.display_order
    );

    if (!payload.menu_code || !payload.title) {
      setError("Group code and title are required.");
      return;
    }

    if (reservedScreenByMenuCode) {
      setError(
        `${normalizedMenuCode} is reserved for page ${reservedScreenByMenuCode.route}. Use a group code like ${normalizedMenuCode}_GROUP or ${normalizedMenuCode}_GOVERNANCE.`
      );
      return;
    }

    if (reservedScreenByResourceCode) {
      setError(
        `${normalizedResourceCode} is reserved for page ${reservedScreenByResourceCode.route}. Use a different group resource code.`
      );
      return;
    }

    if (createOrderConflict) {
      setError(
        `Order ${payload.display_order} is already used under ${payload.parent_menu_code || "root"} by ${createOrderConflict.title}. Suggested next order is ${suggestedCreateOrder}.`
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
      setCreateForm((current) => ({
        ...current,
        menu_code: "",
        resource_code: "",
        title: "",
        description: "",
      }));
      closeCreateGroupModal();
      setNotice(`Group ${payload.menu_code} created.`);
      topActionRefs.current[1]?.focus?.();
    } catch (error) {
      setError(
        resolveMenuGovernanceErrorMessage(
          error instanceof Error ? error.message : "",
          "Group could not be created right now."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSelectedMenu() {
    if (!selectedMenu) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    const parsedOrder = Number(editForm.display_order || 0);
    const nextMenuCode = normalizeMenuCode(editForm.menu_code);
    const nextResourceCode = normalizeMenuCode(
      editForm.resource_code || editForm.menu_code
    );

    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      setError("Enter a valid order number.");
      setSaving(false);
      return;
    }

    if (selectedGroupOrderConflict) {
      setError(
        `Order ${parsedOrder} is already used under ${editForm.parent_menu_code || "root"} by ${selectedGroupOrderConflict.title}. Suggested next order is ${selectedGroupSuggestedOrder}.`
      );
      setSaving(false);
      return;
    }

    if (!nextMenuCode || !editForm.title.trim()) {
      setError("Group code and title are required.");
      setSaving(false);
      return;
    }

    if (selectedGroupReservedScreenByCode) {
      setError(
        `${nextMenuCode} is reserved for page ${selectedGroupReservedScreenByCode.route}. Use a group code like ${nextMenuCode}_GROUP.`
      );
      setSaving(false);
      return;
    }

    if (selectedGroupReservedScreenByResource) {
      setError(
        `${nextResourceCode} is reserved for page ${selectedGroupReservedScreenByResource.route}. Use another group resource code.`
      );
      setSaving(false);
      return;
    }

    if (selectedGroupCodeConflict) {
      setError(
        `${nextMenuCode} is already used by ${selectedGroupCodeConflict.title}.`
      );
      setSaving(false);
      return;
    }

    if (selectedGroupResourceConflict) {
      setError(
        `${nextResourceCode} is already used by ${selectedGroupResourceConflict.title}.`
      );
      setSaving(false);
      return;
    }

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
    } catch (error) {
      setError(
        resolveMenuGovernanceErrorMessage(
          error instanceof Error ? error.message : "",
          "Selected group could not be updated right now."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSelectedMenu() {
    if (!selectedMenu || selectedMenu.menu_type !== "GROUP") {
      return;
    }

    if (selectedMenu.is_system) {
      setError("System groups cannot be removed.");
      return;
    }

    if (selectedGroupChildren.length > 0) {
      setError(
        `This group still contains ${selectedGroupChildren.length} child item(s). Move or remove them first.`
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
      setNotice(`Group ${selectedMenu.menu_code} removed.`);
    } catch (error) {
      setError(
        resolveMenuGovernanceErrorMessage(
          error instanceof Error ? error.message : "",
          "Selected group could not be removed right now."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSelectedMenuState() {
    if (!selectedMenu) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const nextState = !selectedMenu.is_active;
      await updateMenuState({
        menu_code: selectedMenu.menu_code,
        is_active: nextState,
      });
      await loadRegistry(universe);
      requestLiveMenuRefresh("group-state-updated");
      setNotice(
        `Group ${selectedMenu.menu_code} is now ${nextState ? "active" : "disabled"}.`
      );
    } catch {
      setError("Group state could not be updated right now.");
    } finally {
      setSaving(false);
    }
  }

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

  const topActions = [
    {
      key: "refresh-menu-governance",
      label: loading ? "Refreshing..." : "Refresh Registry",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        topActionRefs.current[0] = element;
      },
      onClick: () => void loadRegistry(universe),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create-group",
      label: "Create Group",
      hint: "F3",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[1] = element;
      },
      onClick: openCreateGroupModal,
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "sa-control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[2] = element;
      },
      onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "replace" }),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: topActionRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  function getNextAvailableOrder(parentMenuCode = "", excludeMenuCode = "") {
    const takenOrders = menus
      .filter((item) => (item.parent_menu_code ?? "") === parentMenuCode)
      .filter((item) => item.menu_code !== excludeMenuCode)
      .map((item) => Number(item.tree_display_order ?? item.display_order ?? 0))
      .filter((value) => Number.isFinite(value));

    if (takenOrders.length === 0) {
      return 0;
    }

    return Math.max(...takenOrders) + 1;
  }

  function openPageEditor(page) {
    const safeParent =
      page.parent_menu_code && page.parent_menu_code !== page.screen_code
        ? page.parent_menu_code
        : "";
    const defaultOrder =
      page.display_order ?? getNextAvailableOrder(safeParent, page.registeredMenu?.menu_code ?? "");

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
            display_order: String(
              getNextAvailableOrder(groupCode, current.menu_code)
            ),
          }
        : current
    );
    setGroupPickerOpen(false);
  }

  async function handleSavePageEditor() {
    if (!pageEditor) {
      return;
    }

    const targetMenuCode = pageEditor.menu_code;
    const targetResourceCode = pageEditor.resource_code.trim() || targetMenuCode;
    const targetParent = pageEditor.parent_menu_code || null;
    const parsedOrder = Number(pageEditor.display_order || 0);

    if (targetParent === targetMenuCode) {
      setError("A page cannot be its own group. Choose another group or leave it unassigned.");
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
        Number(item.tree_display_order ?? item.display_order ?? 0) === parsedOrder
    );

    if (orderConflict) {
      setError(
        `Order ${parsedOrder} is already used under ${targetParent || "root"} by ${orderConflict.title}.`
      );
      return;
    }

    const blockingCodeConflict = menus.find(
      (item) => item.menu_code === targetMenuCode && item.menu_type !== "PAGE"
    );

    if (!pageEditor.is_registered && blockingCodeConflict) {
      setError(
        `${targetMenuCode} is already used by group ${blockingCodeConflict.title}. Page codes are reserved for pages. Rename or remove that group first.`
      );
      return;
    }

    const blockingResourceConflict = menus.find(
      (item) =>
        item.resource_code === targetResourceCode &&
        item.menu_code !== targetMenuCode
    );

    if (blockingResourceConflict) {
      setError(
        `${targetResourceCode} is already used by ${blockingResourceConflict.title}. A page needs its own unique resource code.`
      );
      return;
    }

    const blockingRouteConflict = menus.find(
      (item) =>
        item.route_path === pageEditor.route_path &&
        item.menu_code !== targetMenuCode
    );

    if (blockingRouteConflict) {
      setError(
        `${pageEditor.route_path} is already published by ${blockingRouteConflict.title}.`
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
      setNotice(`${pageEditor.title} has been saved into the menu registry and tree.`);
    } catch (error) {
      setError(
        resolveMenuGovernanceErrorMessage(
          error instanceof Error ? error.message : "",
          "That page could not be saved right now."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePageState(page) {
    if (!page.registeredMenu) {
      return;
    }

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

  return (
    <ErpScreenScaffold
      eyebrow="Menu Governance"
      title="Super Admin Menu Governance"
      actions={topActions}
      notices={[
        ...(error
          ? [
              {
                key: "error",
                tone: "error",
                message: error,
              },
            ]
          : []),
        ...(notice
          ? [
              {
                key: "notice",
                tone: "success",
                message: notice,
              },
            ]
          : []),
      ]}
    >
      <ErpSectionCard
        eyebrow="Universe"
        title="Choose Universe"
        aside={
          <div className="flex gap-2">
            {["SA", "ACL"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setUniverse(value)}
                className={`border px-3 py-2 text-sm font-semibold ${
                  universe === value
                    ? "border-sky-300 bg-sky-50 text-sky-900"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <ErpSectionCard
          eyebrow="Groups"
          title="1. Groups: Create, Select, Manage"
        >
          <div className="grid gap-6">
            <div className="grid gap-3">
              {groupRows.map((item) => (
                <button
                  key={item.menu_code}
                  type="button"
                  onClick={() => setSelectedMenuCode(item.menu_code)}
                  className={`grid w-full grid-cols-[1fr_120px] gap-3 border px-3 py-3 text-left ${
                    item.menu_code === selectedMenuCode
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-300 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                      <span className="border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                        Group
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.menu_code}</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Parent {item.parent_menu_code || "root"} | Order {item.tree_display_order ?? item.display_order ?? 0}
                    </div>
                  </div>
                  <div className="justify-self-end text-right text-xs">
                    <div
                      className={`inline-flex border px-2 py-1 font-semibold uppercase tracking-[0.14em] ${
                        item.is_active
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-rose-300 bg-rose-50 text-rose-700"
                      }`}
                    >
                      {item.is_active ? "Active" : "Disabled"}
                    </div>
                  </div>
                </button>
              ))}

              {!loading && groupRows.length === 0 ? (
                <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No groups found in this universe.
                </div>
              ) : null}
            </div>

            <ErpSectionCard
              eyebrow="Selected Group"
              title={selectedMenu ? selectedMenu.title : "Choose a group"}
            >
              {selectedMenu && selectedMenu.menu_type === "GROUP" ? (
                <div className="grid gap-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-semibold">Group Code</span>
                      <input
                        value={editForm.menu_code}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            menu_code: event.target.value,
                          }))
                        }
                        className={inputClassName()}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-semibold">ACL Resource Code</span>
                      <input
                        value={editForm.resource_code}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            resource_code: event.target.value,
                          }))
                        }
                        className={inputClassName()}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-semibold">Title</span>
                      <input
                        value={editForm.title}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        className={inputClassName()}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-semibold">Description</span>
                      <textarea
                        value={editForm.description}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        rows={3}
                        className={inputClassName()}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-semibold">Display Order</span>
                      <input
                        type="number"
                        value={editForm.display_order}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            display_order: event.target.value,
                          }))
                        }
                        className={inputClassName()}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-semibold">Parent Group</span>
                      <select
                        value={editForm.parent_menu_code}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            parent_menu_code: event.target.value,
                            display_order: String(
                              getNextAvailableOrder(event.target.value, selectedMenu?.menu_code ?? "")
                            ),
                          }))
                        }
                        className={inputClassName()}
                      >
                        <option value="">No parent</option>
                        {parentOptions.map((option) => (
                          <option key={option.menu_code} value={option.menu_code}>
                            {option.title} ({option.menu_code})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveSelectedMenu()}
                      className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                    >
                      Save Group
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleToggleSelectedMenuState()}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      {selectedMenu.is_active ? "Disable Group" : "Enable Group"}
                    </button>
                    {!selectedMenu.is_system ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleDeleteSelectedMenu()}
                        className="border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
                      >
                        Remove Group
                      </button>
                    ) : null}
                  </div>

                  <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Suggested next free order under {editForm.parent_menu_code || "root"}:{" "}
                    <span className="font-semibold text-slate-900">{selectedGroupSuggestedOrder}</span>
                    {selectedGroupOrderConflict ? (
                      <span className="ml-2 text-rose-700">
                        Current order collides with {selectedGroupOrderConflict.title}.
                      </span>
                    ) : null}
                  </div>

                  {(selectedGroupReservedScreenByCode ||
                    selectedGroupReservedScreenByResource ||
                    selectedGroupCodeConflict ||
                    selectedGroupResourceConflict ||
                    selectedGroupChildren.length > 0) ? (
                    <div className="grid gap-1 border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      {selectedGroupReservedScreenByCode ? (
                        <div className="text-amber-800">
                          Group code `{normalizeMenuCode(editForm.menu_code)}` is reserved for page {selectedGroupReservedScreenByCode.route}.
                        </div>
                      ) : null}
                      {selectedGroupReservedScreenByResource ? (
                        <div className="text-amber-800">
                          Resource `{normalizeMenuCode(editForm.resource_code || editForm.menu_code)}` is reserved for page {selectedGroupReservedScreenByResource.route}.
                        </div>
                      ) : null}
                      {selectedGroupCodeConflict ? (
                        <div className="text-rose-700">
                          Group code conflict with {selectedGroupCodeConflict.title}.
                        </div>
                      ) : null}
                      {selectedGroupResourceConflict ? (
                        <div className="text-rose-700">
                          Resource conflict with {selectedGroupResourceConflict.title}.
                        </div>
                      ) : null}
                      {selectedGroupChildren.length > 0 ? (
                        <div>
                          This group currently has {selectedGroupChildren.length} child item(s), so remove is blocked until those items are moved out.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid gap-2 md:grid-cols-2">
                    <ErpFieldPreview
                      label="Parent Binding"
                      value={selectedMenu.parent_menu_code || "No parent"}
                      caption="Tree location currently driving menu projection."
                    />
                    <ErpFieldPreview
                      label="Child Count"
                      value={String(selectedGroupChildren.length)}
                      caption="Move these out before removing this group."
                    />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  Select a group to edit its settings.
                </div>
              )}
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Create Group"
              title="Create New Group"
            >
              <div className="grid gap-3">
                <div className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Open the group-create modal only when you need a new drawer bucket.
                  The main registry stays focused on selection and maintenance now.
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <ErpFieldPreview
                    label="Prepared Code"
                    value={normalizedCreateMenuCode || "Not started"}
                    caption="Group codes stay separate from page screen codes."
                    tone={normalizedCreateMenuCode ? "sky" : "default"}
                  />
                  <ErpFieldPreview
                    label="Next Order"
                    value={String(suggestedCreateOrder)}
                    caption={`Suggested under ${createForm.parent_menu_code || "root"}.`}
                    tone="default"
                  />
                </div>
                <button
                  type="button"
                  onClick={openCreateGroupModal}
                  className="w-fit border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                >
                  Open Create Group Modal
                </button>
              </div>
            </ErpSectionCard>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Pages"
          title="2. Pages: Publish, Move, Enable"
        >
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-semibold">Search Pages</span>
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                className={inputClassName()}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPageCatalogFilter("ALL")}
                className={pageFilterButtonClass(pageCatalogFilter === "ALL")}
              >
                All ({pageCatalogCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setPageCatalogFilter("IN_MENU")}
                className={pageFilterButtonClass(pageCatalogFilter === "IN_MENU")}
              >
                In Menu ({pageCatalogCounts.inMenu})
              </button>
              <button
                type="button"
                onClick={() => setPageCatalogFilter("NOT_IN_MENU")}
                className={pageFilterButtonClass(pageCatalogFilter === "NOT_IN_MENU")}
              >
                Not In Menu ({pageCatalogCounts.notInMenu})
              </button>
              <button
                type="button"
                onClick={() => setPageCatalogFilter("DISABLED")}
                className={pageFilterButtonClass(pageCatalogFilter === "DISABLED")}
              >
                Disabled ({pageCatalogCounts.disabled})
              </button>
            </div>

            <div className="grid gap-2">
              {availablePages.map((page) => (
                <div
                  key={page.screen_code}
                  className="border border-slate-300 bg-white px-3 py-3"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {page.title}
                        </div>
                        <span className="border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                          Page
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {page.screen_code}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-slate-500">
                        {page.route_path}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Group {page.parent_menu_code || "unassigned"} | Order {page.display_order ?? "-"}
                      </div>
                    </div>

                    <div className="flex flex-col items-stretch gap-2">
                      <div className="flex items-center justify-end gap-2">
                        <div
                          className={`inline-flex border px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                            page.is_active
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-rose-300 bg-rose-50 text-rose-700"
                          }`}
                        >
                          {page.registeredMenu ? (page.is_active ? "Active" : "Disabled") : "Not In Menu"}
                        </div>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        {page.registeredMenu ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleTogglePageState(page)}
                            className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                          >
                            {page.is_active ? "Disable" : "Enable"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => openPageEditor(page)}
                          className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                        >
                          {page.registeredMenu ? "Page Settings" : "Publish Page"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {availablePages.length === 0 ? (
                <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No pages match the current filter.
                </div>
              ) : null}
            </div>
          </div>
        </ErpSectionCard>
      </div>

      {showLegacyPageEditor && pageEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-6 py-8">
          <div className="grid max-h-[88vh] w-full max-w-5xl overflow-hidden border border-slate-300 bg-white shadow-2xl md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                    Page Registry
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {pageEditor.title}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {pageEditor.screen_code} | {pageEditor.route_path}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGroupPickerOpen(false);
                    setPageEditor(null);
                  }}
                  className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-semibold">Title</span>
                    <input
                      ref={pageTitleRef}
                      value={pageEditor.title}
                      onChange={(event) =>
                        setPageEditor((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-semibold">Resource Code</span>
                    <input
                      value={pageEditor.resource_code}
                      disabled={pageEditor.is_registered}
                      onChange={(event) =>
                        setPageEditor((current) => ({
                          ...current,
                          resource_code: event.target.value,
                        }))
                      }
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                    <span className="font-semibold">Description</span>
                    <textarea
                      value={pageEditor.description}
                      onChange={(event) =>
                        setPageEditor((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      rows={3}
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-semibold">Parent Group</span>
                    <button
                      type="button"
                      onClick={() => setGroupPickerOpen((current) => !current)}
                      className="border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
                    >
                      {pageEditor.parent_menu_code || "Choose parent group"}
                    </button>
                  </label>

                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-semibold">Order</span>
                    <input
                      type="number"
                      value={pageEditor.display_order}
                      onChange={(event) =>
                        setPageEditor((current) => ({
                          ...current,
                          display_order: event.target.value,
                        }))
                      }
                      className={inputClassName()}
                    />
                  </label>
                </div>

                <div className="grid gap-2 border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                  <div>
                    Suggested next free order under {pageEditor.parent_menu_code || "root"}:{" "}
                    <span className="font-semibold text-slate-900">{pageEditorSuggestedOrder}</span>
                  </div>
                  {pageEditorBlockingGroupConflict ? (
                    <div className="flex flex-wrap items-center gap-2 text-rose-700">
                      <span>
                        `{pageEditor.menu_code}` is already used by group {pageEditorBlockingGroupConflict.title}. Rename or remove that group first.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMenuCode(pageEditorBlockingGroupConflict.menu_code);
                          setGroupPickerOpen(false);
                          setPageEditor(null);
                        }}
                        className="border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700"
                      >
                        Open Conflicting Group
                      </button>
                    </div>
                  ) : null}
                  {pageEditorResourceConflict ? (
                    <div className="text-rose-700">
                      Resource `{pageEditor.resource_code.trim() || pageEditor.menu_code}` is already used by {pageEditorResourceConflict.title}.
                    </div>
                  ) : null}
                  {pageEditorRouteConflict ? (
                    <div className="text-rose-700">
                      Route `{pageEditor.route_path}` is already published by {pageEditorRouteConflict.title}.
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSavePageEditor()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                  >
                    Save Page Placement
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setGroupPickerOpen(false);
                      setPageEditor(null);
                    }}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            <aside className="border-l border-slate-200 bg-[#eef4fb]">
              <div className="border-b border-slate-200 px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                  Group Drawer
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {groupPickerOpen
                    ? "Arrow keys and Enter দিয়ে parent group select করো."
                    : "Parent Group field থেকে drawer open করো."}
                </div>
              </div>

              <div className="max-h-[72vh] overflow-y-auto px-3 py-3">
                {groupPickerOpen ? (
                  <div className="grid gap-2">
                    {groupRows.map((group, index) => (
                      <button
                        key={group.menu_code}
                        ref={(element) => {
                          groupPickerRefs.current[index] = element;
                        }}
                        type="button"
                        onClick={() => {
                          setPageEditor((current) => ({
                            ...current,
                            parent_menu_code: group.menu_code,
                            display_order: String(
                              getNextAvailableOrder(
                                group.menu_code,
                                pageEditor.menu_code
                              )
                            ),
                          }));
                          setGroupPickerOpen(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            handleLinearNavigation(event, {
                              index,
                              refs: groupPickerRefs.current,
                              orientation: "vertical",
                            });
                          }

                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            handleLinearNavigation(event, {
                              index,
                              refs: groupPickerRefs.current,
                              orientation: "vertical",
                            });
                          }

                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.click();
                          }

                          if (event.key === "Escape" || event.key === "ArrowLeft") {
                            event.preventDefault();
                            setGroupPickerOpen(false);
                            pageTitleRef.current?.focus();
                          }
                        }}
                        className={`border px-3 py-2 text-left text-sm ${
                          pageEditor.parent_menu_code === group.menu_code
                            ? "border-sky-300 bg-sky-50 text-sky-900"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className="font-semibold">{group.title}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {group.menu_code}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">
                    Drawer closed. Parent group choose করতে field-এ click করো.
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      ) : null}

      <ModalBase
        visible={createGroupOpen}
        eyebrow="Group Registry"
        title="Create New Group"
        message="Create drawer groups here. Publish actual screens from the page catalog."
        onEscape={closeCreateGroupModal}
        initialFocusRef={createCodeRef}
        width="min(920px, calc(100vw - 32px))"
        actions={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={closeCreateGroupModal}
              className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreateMenu()}
              className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950"
            >
              {saving ? "Creating..." : "Create Group"}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-semibold">Group Code</span>
              <input
                ref={createCodeRef}
                value={createForm.menu_code}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    menu_code: event.target.value,
                  }))
                }
                className={inputClassName()}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-semibold">ACL Resource Code</span>
              <input
                value={createForm.resource_code}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    resource_code: event.target.value,
                  }))
                }
                className={inputClassName()}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-semibold">Title</span>
              <input
                value={createForm.title}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className={inputClassName()}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
              <span className="font-semibold">Description</span>
              <textarea
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                className={inputClassName()}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-semibold">Parent Group</span>
              <select
                value={createForm.parent_menu_code}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    parent_menu_code: event.target.value,
                    display_order: String(getNextAvailableOrder(event.target.value)),
                  }))
                }
                className={inputClassName()}
              >
                <option value="">No parent</option>
                {menus
                  .filter(
                    (item) => item.universe === universe && item.menu_type === "GROUP"
                  )
                  .map((option) => (
                    <option key={option.menu_code} value={option.menu_code}>
                      {option.title} ({option.menu_code})
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-semibold">Display Order</span>
              <input
                type="number"
                value={createForm.display_order}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    display_order: event.target.value,
                  }))
                }
                className={inputClassName()}
              />
            </label>
          </div>

          <div className="grid gap-2 border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
            <div>
              Suggested next free order under {createForm.parent_menu_code || "root"}:{" "}
              <span className="font-semibold text-slate-900">{suggestedCreateOrder}</span>
            </div>
            {createReservedScreenByMenuCode ? (
              <div className="text-amber-800">
                `{normalizedCreateMenuCode}` is reserved for page {createReservedScreenByMenuCode.route}. Suggested group code:{" "}
                <span className="font-semibold">{normalizedCreateMenuCode}_GROUP</span>
              </div>
            ) : null}
            {createReservedScreenByResourceCode ? (
              <div className="text-amber-800">
                Resource `{normalizedCreateResourceCode}` is reserved for page {createReservedScreenByResourceCode.route}. Suggested resource:{" "}
                <span className="font-semibold">{normalizedCreateResourceCode}_GROUP</span>
              </div>
            ) : null}
            {createCodeConflict ? (
              <div className="text-rose-700">
                Group code `{normalizedCreateMenuCode}` is already used by {createCodeConflict.title}.
              </div>
            ) : null}
            {createResourceConflict ? (
              <div className="text-rose-700">
                Resource `{normalizedCreateResourceCode}` is already used by {createResourceConflict.title}.
              </div>
            ) : null}
          </div>
        </div>
      </ModalBase>

      <ModalBase
        visible={Boolean(pageEditor)}
        eyebrow="Page Registry"
        title={pageEditor?.title ?? "Page Settings"}
        message={
          pageEditor
            ? `${pageEditor.screen_code} | ${pageEditor.route_path}`
            : ""
        }
        onEscape={closePageEditor}
        initialFocusRef={pageTitleRef}
        width="min(920px, calc(100vw - 32px))"
        actions={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={closePageEditor}
              className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !pageEditor}
              onClick={() => void handleSavePageEditor()}
              className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950"
            >
              {saving ? "Saving..." : "Save Page Placement"}
            </button>
          </>
        }
      >
        {pageEditor ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-700">
                <span className="font-semibold">Title</span>
                <input
                  ref={pageTitleRef}
                  value={pageEditor.title}
                  onChange={(event) =>
                    setPageEditor((current) =>
                      current
                        ? {
                            ...current,
                            title: event.target.value,
                          }
                        : current
                    )
                  }
                  className={inputClassName()}
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-700">
                <span className="font-semibold">Resource Code</span>
                <input
                  value={pageEditor.resource_code}
                  disabled={pageEditor.is_registered}
                  onChange={(event) =>
                    setPageEditor((current) =>
                      current
                        ? {
                            ...current,
                            resource_code: event.target.value,
                          }
                        : current
                    )
                  }
                  className={inputClassName()}
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                <span className="font-semibold">Description</span>
                <textarea
                  value={pageEditor.description}
                  onChange={(event) =>
                    setPageEditor((current) =>
                      current
                        ? {
                            ...current,
                            description: event.target.value,
                          }
                        : current
                    )
                  }
                  rows={3}
                  className={inputClassName()}
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-700">
                <span className="font-semibold">Parent Group</span>
                <button
                  type="button"
                  onClick={() => setGroupPickerOpen((current) => !current)}
                  className="border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
                >
                  {pageEditor.parent_menu_code || "Choose parent group"}
                </button>
              </label>

              <label className="grid gap-1 text-sm text-slate-700">
                <span className="font-semibold">Order</span>
                <input
                  type="number"
                  value={pageEditor.display_order}
                  onChange={(event) =>
                    setPageEditor((current) =>
                      current
                        ? {
                            ...current,
                            display_order: event.target.value,
                          }
                        : current
                    )
                  }
                  className={inputClassName()}
                />
              </label>
            </div>

            <div className="grid gap-2 border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
              <div>
                Suggested next free order under {pageEditor.parent_menu_code || "root"}:{" "}
                <span className="font-semibold text-slate-900">
                  {pageEditorSuggestedOrder}
                </span>
              </div>
              {pageEditorBlockingGroupConflict ? (
                <div className="flex flex-wrap items-center gap-2 text-rose-700">
                  <span>
                    `{pageEditor.menu_code}` is already used by group {pageEditorBlockingGroupConflict.title}. Rename or remove that group first.
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
              ) : null}
              {pageEditorResourceConflict ? (
                <div className="text-rose-700">
                  Resource `{pageEditor.resource_code.trim() || pageEditor.menu_code}` is already used by {pageEditorResourceConflict.title}.
                </div>
              ) : null}
              {pageEditorRouteConflict ? (
                <div className="text-rose-700">
                  Route `{pageEditor.route_path}` is already published by {pageEditorRouteConflict.title}.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </ModalBase>

      <DrawerBase
        visible={Boolean(pageEditor) && groupPickerOpen}
        title="Choose Parent Group"
        onEscape={() => {
          setGroupPickerOpen(false);
          pageTitleRef.current?.focus();
        }}
        width="min(420px, calc(100vw - 24px))"
        actions={
          <button
            type="button"
            onClick={() => {
              setGroupPickerOpen(false);
              pageTitleRef.current?.focus();
            }}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-slate-700"
          >
            Close
          </button>
        }
      >
        <div className="grid gap-3">
          <div className="grid gap-2">
            {groupRows.map((group, index) => (
              <button
                key={group.menu_code}
                ref={(element) => {
                  groupPickerRefs.current[index] = element;
                }}
                type="button"
                onClick={() => assignParentGroup(group.menu_code)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    handleLinearNavigation(event, {
                      index,
                      refs: groupPickerRefs.current,
                      orientation: "vertical",
                    });
                  }

                  if (event.key === "Enter") {
                    event.preventDefault();
                    assignParentGroup(group.menu_code);
                  }

                  if (event.key === "Escape" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    setGroupPickerOpen(false);
                    pageTitleRef.current?.focus();
                  }
                }}
                className={`border px-3 py-2 text-left text-sm ${
                  pageEditor?.parent_menu_code === group.menu_code
                    ? "border-sky-300 bg-sky-50 text-sky-900"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="font-semibold">{group.title}</div>
                <div className="mt-1 text-[11px] text-slate-500">{group.menu_code}</div>
              </button>
            ))}
          </div>
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
