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

async function previewUser(targetUserId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/preview-user`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_user_id: targetUserId,
      }),
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "MENU_PREVIEW_FAILED");
  }

  return json.data;
}

function buildTreeLabel(item) {
  const parent = item.parent_menu_code ? `${item.parent_menu_code} / ` : "";
  return `${parent}${item.title} (${item.menu_code})`;
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

      const nextSelected =
        data.find((item) => item.menu_code === selectedMenuCode) ??
        data.find((item) => item.route_path) ??
        data[0] ??
        null;

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
      title: selectedMenu.title ?? "",
      description: selectedMenu.description ?? "",
      route_path: selectedMenu.route_path ?? "",
      display_order: String(selectedMenu.display_order ?? selectedMenu.tree_display_order ?? 0),
      parent_menu_code: selectedMenu.parent_menu_code ?? "",
    });
  }, [selectedMenu]);

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

  const availablePages = useMemo(() => {
    const searchTerm = catalogSearch.trim().toLowerCase();

    return Object.values(SCREEN_REGISTRY)
      .filter((screen) => resolveGovernanceUniverse(screen) === universe)
      .filter((screen) => screen.publishableInMenu !== false)
      .filter((screen) => Boolean(screen?.screen_code) && Boolean(screen?.route))
      .map((screen) => {
        const registeredMenu =
          menus.find((item) => item.menu_code === screen.screen_code) ??
          menus.find((item) => item.route_path === screen.route) ??
          null;

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
      })
      .filter((page) => {
        if (!searchTerm) {
          return true;
        }

        return [page.screen_code, page.title, page.route_path]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(searchTerm));
      })
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [catalogSearch, menus, universe]);

  async function handleCreateMenu() {
    const payload = {
      menu_code: createForm.menu_code.trim().toUpperCase(),
      resource_code:
        (createForm.resource_code.trim() || createForm.menu_code.trim()).toUpperCase(),
      title: createForm.title.trim(),
      description: createForm.description.trim() || null,
      route_path: null,
      menu_type: "GROUP",
      universe,
      display_order: Number(createForm.display_order || 0),
      parent_menu_code: createForm.parent_menu_code || null,
      tree_display_order: Number(createForm.display_order || 0),
    };

    if (!payload.menu_code || !payload.title) {
      setError("Menu code and title are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const created = await createMenu(payload);
      await loadRegistry(universe);
      setSelectedMenuCode(created?.menu?.menu_code ?? payload.menu_code);
      setCreateForm((current) => ({
        ...current,
        menu_code: "",
        resource_code: "",
        title: "",
        description: "",
      }));
      setNotice(`Menu ${payload.menu_code} created and published to the current SA session snapshot.`);
      createCodeRef.current?.focus();
    } catch {
      setError("Menu could not be created right now.");
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

    try {
      await updateMenu({
        menu_code: selectedMenu.menu_code,
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        route_path: selectedMenu.route_path ?? null,
        display_order: Number(editForm.display_order || 0),
      });

      await updateMenuTree({
        child_menu_code: selectedMenu.menu_code,
        parent_menu_code: editForm.parent_menu_code || null,
        display_order: Number(editForm.display_order || 0),
      });

      await loadRegistry(universe);
      setNotice(`Menu ${selectedMenu.menu_code} updated and republished.`);
    } catch {
      setError("Selected menu could not be updated right now.");
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
      setNotice(
        `${selectedMenu.menu_code} is now ${nextState ? "active" : "disabled"} in the published registry.`
      );
    } catch {
      setError("Menu state could not be updated right now.");
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
      label: "Focus create menu code",
      keywords: ["menu code", "create menu"],
      perform: () => createCodeRef.current?.focus(),
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
      perform: () => createCodeRef.current?.focus(),
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
      key: "sa-control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        topActionRefs.current[1] = element;
      },
      onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "replace" }),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
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
    const defaultParent = page.parent_menu_code ?? "";
    const defaultOrder =
      page.display_order ?? getNextAvailableOrder(defaultParent, page.registeredMenu?.menu_code ?? "");

    setPageEditor({
      screen_code: page.screen_code,
      menu_code: page.registeredMenu?.menu_code ?? page.screen_code,
      title: page.registeredMenu?.title ?? page.title,
      resource_code: page.registeredMenu?.resource_code ?? page.screen_code,
      description: page.registeredMenu?.description ?? "",
      parent_menu_code: defaultParent,
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

  async function handleSavePageEditor() {
    if (!pageEditor) {
      return;
    }

    const targetMenuCode = pageEditor.menu_code;
    const targetParent = pageEditor.parent_menu_code || null;
    const parsedOrder = Number(pageEditor.display_order || 0);

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

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (pageEditor.is_registered) {
        await updateMenu({
          menu_code: targetMenuCode,
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
          resource_code:
            pageEditor.resource_code.trim() || pageEditor.menu_code,
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
      setGroupPickerOpen(false);
      setPageEditor(null);
      setNotice(`${pageEditor.title} has been saved into the menu registry and tree.`);
    } catch {
      setError("That page could not be saved right now.");
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
      description="Govern menu registry, tree position, publish state, and preview output without direct SQL edits."
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
        description="Switch between SA and ACL menu governance."
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
          title="Group Create & Manage"
          description="Create menu groups and manage existing group title, order, parent, and active state."
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
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
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
              eyebrow="Selected Menu"
              title={selectedMenu ? selectedMenu.title : "Choose a group"}
              description="Edit only the selected group from here."
            >
              {selectedMenu && selectedMenu.menu_type === "GROUP" ? (
                <div className="grid gap-3">
                  <div className="grid gap-2 md:grid-cols-2">
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
                      <span className="font-semibold">Parent Menu</span>
                      <select
                        value={editForm.parent_menu_code}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            parent_menu_code: event.target.value,
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
                      Save Menu
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleToggleSelectedMenuState()}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      {selectedMenu.is_active ? "Disable Menu" : "Enable Menu"}
                    </button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <ErpFieldPreview
                      label="Resource Code"
                      value={selectedMenu.resource_code}
                      caption="ACL identity linked to this group."
                    />
                    <ErpFieldPreview
                      label="Parent Binding"
                      value={selectedMenu.parent_menu_code || "No parent"}
                      caption="Tree location currently driving menu projection."
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
              title="Add Group Or Anchor"
              description="Create hierarchy groups and custom anchors here. Coder-made pages should be published from the Available Pages catalog above."
            >
              <div className="grid gap-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-semibold">Menu Code</span>
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
                    <span className="font-semibold">Resource Code</span>
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
                    <span className="font-semibold">Parent Menu</span>
                    <select
                      value={createForm.parent_menu_code}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          parent_menu_code: event.target.value,
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

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleCreateMenu()}
                  className="w-fit border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                >
                  Create Menu
                </button>
              </div>
            </ErpSectionCard>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Pages"
          title="All Pages And Status"
          description="See all pages, their current status, and open per-page assign or reassign settings."
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

            <div className="grid gap-2">
              {availablePages.map((page) => (
                <div
                  key={page.screen_code}
                  className="border border-slate-300 bg-white px-3 py-3"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {page.title}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {page.screen_code}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-slate-500">
                        {page.route_path}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Group {page.parent_menu_code || "not assigned"} | Order {page.display_order ?? "-"}
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
                          {page.registeredMenu ? "Open Settings" : "Add To Registry"}
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

      {pageEditor ? (
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
                    <span className="font-semibold">Group</span>
                    <button
                      type="button"
                      onClick={() => setGroupPickerOpen((current) => !current)}
                      className="border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
                    >
                      {pageEditor.parent_menu_code || "Choose group"}
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

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSavePageEditor()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                  >
                    Save
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
                    ? "Arrow keys and Enter দিয়ে group select করো."
                    : "Group field থেকে drawer open করো."}
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
                    Drawer closed.
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
