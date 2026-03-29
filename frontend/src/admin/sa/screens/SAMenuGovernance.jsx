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

export default function SAMenuGovernance() {
  const topActionRefs = useRef([]);
  const rowRefs = useRef([]);
  const createCodeRef = useRef(null);
  const [universe, setUniverse] = useState("SA");
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedMenuCode, setSelectedMenuCode] = useState("");
  const [previewTarget, setPreviewTarget] = useState("");
  const [previewResult, setPreviewResult] = useState(null);
  const [createForm, setCreateForm] = useState({
    menu_code: "",
    resource_code: "",
    title: "",
    description: "",
    route_path: "",
    menu_type: "PAGE",
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

  async function handleCreateMenu() {
    const payload = {
      menu_code: createForm.menu_code.trim().toUpperCase(),
      resource_code:
        (createForm.resource_code.trim() || createForm.menu_code.trim()).toUpperCase(),
      title: createForm.title.trim(),
      description: createForm.description.trim() || null,
      route_path:
        createForm.menu_type === "GROUP" ? null : createForm.route_path.trim() || null,
      menu_type: createForm.menu_type,
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
        route_path: "",
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
        route_path:
          selectedMenu.menu_type === "GROUP"
            ? null
            : editForm.route_path.trim() || null,
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

  async function handlePreviewUser() {
    const target = previewTarget.trim();

    if (!target) {
      setError("Enter an auth user id before previewing.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await previewUser(target);
      setPreviewResult(data);
      setNotice(`Preview rebuilt for user ${target}.`);
    } catch {
      setError("Preview-as-user could not be generated right now.");
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

  const metrics = [
    {
      key: "visible-rows",
      label: `${universe} Menus`,
      value: String(registryRows.length),
      caption: "Registry rows currently visible to the governance surface.",
      tone: "sky",
    },
    {
      key: "active-rows",
      label: "Active Rows",
      value: String(registryRows.filter((item) => item.is_active).length),
      caption: "Menus currently publishable into snapshot generation.",
      tone: "emerald",
    },
    {
      key: "group-rows",
      label: "Groups",
      value: String(registryRows.filter((item) => item.menu_type === "GROUP").length),
      caption: "Hierarchy anchors available for steering and projection.",
      tone: "amber",
    },
  ];

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
      metrics={metrics}
    >
      <ErpSectionCard
        eyebrow="Universe"
        title="Govern The Published Menu Registry"
        description="Switch between SA and ACL registry views. SA uses this surface to prepare the visible universe before ACL users consume it."
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
      >
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-2">
            {registryRows.map((item, index) => {
              const isSelected = item.menu_code === selectedMenuCode;

              return (
                <button
                  key={item.menu_code}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={() => setSelectedMenuCode(item.menu_code)}
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: rowRefs.current,
                      orientation: "vertical",
                    })
                  }
                  className={`grid w-full grid-cols-[120px_1fr_120px] items-center gap-3 border px-3 py-3 text-left ${
                    isSelected
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-300 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                      {item.menu_type}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.menu_code}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {buildTreeLabel(item)}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-slate-500">
                      {item.route_path || "Group node"}
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
                    <div className="mt-2 text-slate-500">
                      Order {item.tree_display_order ?? item.display_order ?? 0}
                    </div>
                  </div>
                </button>
              );
            })}

            {!loading && registryRows.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No menu rows are currently visible for the selected universe.
              </div>
            ) : null}
          </div>

          <div className="grid gap-6">
            <ErpSectionCard
              eyebrow="Selected Menu"
              title={selectedMenu ? selectedMenu.title : "Choose a menu row"}
              description="Edit the currently selected menu row, then publish immediately into the current SA session snapshot."
            >
              {selectedMenu ? (
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
                      <span className="font-semibold">Route Path</span>
                      <input
                        value={editForm.route_path}
                        disabled={selectedMenu.menu_type === "GROUP"}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            route_path: event.target.value,
                          }))
                        }
                        className={inputClassName()}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
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
                      caption="ACL identity linked to this menu row."
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
                  Select a menu row from the registry to edit its publishing state.
                </div>
              )}
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Create Menu"
              title="Add New Menu Row"
              description="Create a new menu registry row and place it under the selected universe tree without touching SQL."
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
                    <span className="font-semibold">Menu Type</span>
                    <select
                      value={createForm.menu_type}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          menu_type: event.target.value,
                        }))
                      }
                      className={inputClassName()}
                    >
                      <option value="PAGE">PAGE</option>
                      <option value="GROUP">GROUP</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-semibold">Route Path</span>
                    <input
                      value={createForm.route_path}
                      disabled={createForm.menu_type === "GROUP"}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          route_path: event.target.value,
                        }))
                      }
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

            <ErpSectionCard
              eyebrow="Preview As User"
              title="Preview Published Menu"
              description="Generate a user-facing menu snapshot preview before you continue into ACL rollout."
            >
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-semibold">Target Auth User ID</span>
                  <input
                    value={previewTarget}
                    onChange={(event) => setPreviewTarget(event.target.value)}
                    className={inputClassName()}
                  />
                </label>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handlePreviewUser()}
                  className="w-fit border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Preview User Menu
                </button>

                {previewResult ? (
                  <div className="grid gap-2">
                    <ErpFieldPreview
                      label="Preview Universe"
                      value={previewResult.universe}
                      caption="Universe resolved by preview-as-user."
                    />
                    <ErpFieldPreview
                      label="Visible Menu Count"
                      value={String(previewResult.menu?.length ?? 0)}
                      caption="Rows currently visible after preview snapshot generation."
                    />
                    <div className="border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                      {(previewResult.menu ?? [])
                        .map((item) => `${item.title} (${item.menu_code})`)
                        .join(", ") || "No visible menu rows returned."}
                    </div>
                  </div>
                ) : null}
              </div>
            </ErpSectionCard>
          </div>
        </div>
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
