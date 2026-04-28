/*
 * File-ID: 9.13-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAModuleResourceMap.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Module-to-page resource ownership — assign / reassign / bulk assign
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function describeApiError(json, fallbackCode) {
  const code = json?.code ?? fallbackCode ?? "REQUEST_FAILED";
  const trace = json?.decision_trace ? ` | Trace ${json.decision_trace}` : "";
  const requestId = json?.request_id ? ` | Req ${json.request_id}` : "";
  return `${code}${trace}${requestId}`;
}

async function fetchWorkspace() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/module-resource-map?universe=ACL`,
    { credentials: "include" },
  );
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    throw new Error(describeApiError(json, "MODULE_RESOURCE_WORKSPACE_READ_FAILED"));
  }
  return json.data;
}

async function postJson(path, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    throw new Error(describeApiError(json, "REQUEST_FAILED"));
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

function sortModules(rows) {
  return [...rows].sort((a, b) => {
    const av = `${a.project_code ?? ""} ${a.module_code ?? ""}`.trim();
    const bv = `${b.project_code ?? ""} ${b.module_code ?? ""}`.trim();
    return av.localeCompare(bv, "en", { numeric: true, sensitivity: "base" });
  });
}

function sortResources(rows) {
  return [...rows].sort((a, b) => {
    const av = `${a.parent_menu_code ?? ""} ${a.title ?? ""}`.trim();
    const bv = `${b.parent_menu_code ?? ""} ${b.title ?? ""}`.trim();
    return av.localeCompare(bv, "en", { numeric: true, sensitivity: "base" });
  });
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function filterTabClass(active) {
  return `border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
    active
      ? "border-sky-300 bg-sky-50 text-sky-900"
      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
  }`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SAModuleResourceMap() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const drawerFirstRef = useRef(null);

  // Data
  const [modules, setModules] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // List UI
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [checkedCodes, setCheckedCodes] = useState(new Set());

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCodes, setDrawerCodes] = useState([]);
  const [drawerProjectCode, setDrawerProjectCode] = useState("");
  const [drawerModuleCode, setDrawerModuleCode] = useState("");
  const [drawerSaving, setDrawerSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchWorkspace();
      setModules(sortModules(data?.modules ?? []));
      setResources(sortResources(data?.resources ?? []));
    } catch (err) {
      setModules([]);
      setResources([]);
      setError(
        err instanceof Error
          ? `Module/page map could not be loaded. ${err.message}`
          : "Module/page map could not be loaded right now.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  // ---------------------------------------------------------------------------
  // Derived: projects list from modules
  // ---------------------------------------------------------------------------

  const projects = useMemo(() => {
    const seen = new Set();
    return modules
      .filter((m) => {
        if (seen.has(m.project_code)) return false;
        seen.add(m.project_code);
        return true;
      })
      .sort((a, b) =>
        (a.project_code ?? "").localeCompare(b.project_code ?? "", "en", {
          sensitivity: "base",
        }),
      );
  }, [modules]);

  const modulesForProject = useMemo(() => {
    if (!drawerProjectCode) return [];
    return modules.filter((m) => m.project_code === drawerProjectCode);
  }, [modules, drawerProjectCode]);

  // ---------------------------------------------------------------------------
  // Filtered list
  // ---------------------------------------------------------------------------

  const filteredResources = useMemo(() => {
    const needle = String(searchQuery ?? "").trim().toLowerCase();

    return resources.filter((row) => {
      if (filter === "ASSIGNED" && !row.owner_module_code) return false;
      if (filter === "UNASSIGNED" && row.owner_module_code) return false;

      if (needle) {
        return [
          row.title,
          row.resource_code,
          row.route_path,
          row.parent_menu_code,
          row.owner_module_code,
          row.owner_project_code,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      }

      return true;
    });
  }, [resources, searchQuery, filter]);

  // Tab counts
  const allCount = resources.length;
  const assignedCount = resources.filter((r) => r.owner_module_code).length;
  const unassignedCount = resources.filter((r) => !r.owner_module_code).length;

  // ---------------------------------------------------------------------------
  // Checkbox logic
  // ---------------------------------------------------------------------------

  const visibleCodes = useMemo(
    () => filteredResources.map((r) => r.resource_code),
    [filteredResources],
  );

  const checkedVisible = visibleCodes.filter((c) => checkedCodes.has(c));
  const allVisibleChecked =
    visibleCodes.length > 0 && checkedVisible.length === visibleCodes.length;
  const someVisibleChecked =
    checkedVisible.length > 0 && checkedVisible.length < visibleCodes.length;

  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleChecked;
    }
  }, [someVisibleChecked]);

  function handleSelectAll(e) {
    if (e.target.checked) {
      setCheckedCodes((prev) => {
        const next = new Set(prev);
        visibleCodes.forEach((c) => next.add(c));
        return next;
      });
    } else {
      setCheckedCodes((prev) => {
        const next = new Set(prev);
        visibleCodes.forEach((c) => next.delete(c));
        return next;
      });
    }
  }

  function handleRowCheck(code, checked) {
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  // Clear selection on filter change
  useEffect(() => {
    setCheckedCodes(new Set());
  }, [filter]);

  // ---------------------------------------------------------------------------
  // Drawer open helpers
  // ---------------------------------------------------------------------------

  function openDrawerSingle(resourceCode) {
    setDrawerCodes([resourceCode]);
    setDrawerProjectCode("");
    setDrawerModuleCode("");
    setDrawerOpen(true);
  }

  function openDrawerBulk() {
    const codes = visibleCodes.filter((c) => checkedCodes.has(c));
    if (codes.length === 0) return;
    setDrawerCodes(codes);
    setDrawerProjectCode("");
    setDrawerModuleCode("");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerCodes([]);
    setDrawerProjectCode("");
    setDrawerModuleCode("");
  }

  // ---------------------------------------------------------------------------
  // Unassign handler (single row only)
  // ---------------------------------------------------------------------------

  async function handleUnassign(resourceCode) {
    const res = resources.find((r) => r.resource_code === resourceCode);
    if (!res?.owner_module_code) return;

    const confirmed = await openActionConfirm({
      eyebrow: "Module Page Ownership",
      title: "Unassign Page from Module",
      message: `Remove "${res.title ?? resourceCode}" from ${res.owner_module_code}? The page will have no module owner.`,
      confirmLabel: "Unassign",
      cancelLabel: "Cancel",
    });

    if (!confirmed) return;

    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/module-resource-map/remove", {
        resource_code: resourceCode,
      });
      await loadWorkspace();
      setNotice(`${resourceCode} is now unassigned from module ownership.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unassign failed. ${err.message}`
          : "Unassign failed right now.",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Assign handler (single or bulk)
  // ---------------------------------------------------------------------------

  async function handleDrawerAssign() {
    if (!drawerModuleCode) return;

    const targetModule = modules.find((m) => m.module_code === drawerModuleCode);
    if (!targetModule) return;

    // Pages already assigned to a DIFFERENT module → need confirmation
    const beingMoved = drawerCodes.filter((code) => {
      const res = resources.find((r) => r.resource_code === code);
      return res?.owner_module_code && res.owner_module_code !== drawerModuleCode;
    });

    if (beingMoved.length > 0) {
      const pageList = beingMoved
        .map((code) => {
          const res = resources.find((r) => r.resource_code === code);
          return `• ${res?.title ?? code} (currently in ${res?.owner_module_code})`;
        })
        .join("\n");

      const confirmed = await openActionConfirm({
        eyebrow: "Module Page Ownership",
        title: `Move ${beingMoved.length === 1 ? "Page" : `${beingMoved.length} Pages`} to ${drawerModuleCode}?`,
        message: `The following ${beingMoved.length === 1 ? "page is" : "pages are"} already assigned and will be moved:\n\n${pageList}`,
        confirmLabel: "Yes, Move",
        cancelLabel: "Cancel",
      });

      // Cancel → stay in drawer so user can re-choose
      if (!confirmed) return;
    }

    setDrawerSaving(true);
    setError("");
    setNotice("");

    try {
      for (const code of drawerCodes) {
        await postJson("/api/admin/module-resource-map", {
          resource_code: code,
          module_code: drawerModuleCode,
        });
      }

      await loadWorkspace();
      setCheckedCodes(new Set());
      closeDrawer();
      setNotice(
        drawerCodes.length === 1
          ? `${drawerCodes[0]} assigned to ${drawerModuleCode}.`
          : `${drawerCodes.length} pages assigned to ${drawerModuleCode}.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Module/page mapping failed. ${err.message}`
          : "Module/page mapping failed right now.",
      );
    } finally {
      setDrawerSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Commands + hotkeys
  // ---------------------------------------------------------------------------

  useErpScreenCommands([
    {
      id: "sa-module-page-map-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing module page map..." : "Refresh module page map",
      keywords: ["refresh", "module page", "resource map"],
      disabled: loading,
      perform: () => void loadWorkspace(),
      order: 10,
    },
    {
      id: "sa-module-page-map-page-registry",
      group: "Current Screen",
      label: "Open page registry",
      keywords: ["page registry", "pages"],
      perform: () => {
        openScreen("SA_PAGE_RESOURCE_REGISTRY", { mode: "replace" });
        navigate("/sa/page-registry");
      },
      order: 20,
    },
    {
      id: "sa-module-page-map-menu-governance",
      group: "Current Screen",
      label: "Open menu governance",
      keywords: ["menu governance", "publish page"],
      perform: () => {
        openScreen("SA_MENU_GOVERNANCE", { mode: "replace" });
        navigate("/sa/menu");
      },
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadWorkspace(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus(),
    },
  });

  const selectedBulkCount = checkedVisible.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ErpScreenScaffold
      eyebrow="Module Page Map"
      title="Module To Page Resource Ownership"
      notices={[
        ...(error ? [{ tone: "error", message: error }] : []),
        ...(notice ? [{ tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "page-registry",
          label: "Page Registry",
          tone: "neutral",
          buttonRef: (el) => {
            actionRefs.current[0] = el;
          },
          onClick: () => {
            openScreen("SA_PAGE_RESOURCE_REGISTRY", { mode: "replace" });
            navigate("/sa/page-registry");
          },
          onKeyDown: (e) =>
            handleLinearNavigation(e, {
              index: 0,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "menu-governance",
          label: "Menu Governance",
          tone: "neutral",
          buttonRef: (el) => {
            actionRefs.current[1] = el;
          },
          onClick: () => {
            openScreen("SA_MENU_GOVERNANCE", { mode: "replace" });
            navigate("/sa/menu");
          },
          onKeyDown: (e) =>
            handleLinearNavigation(e, {
              index: 1,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh Map",
          tone: "primary",
          buttonRef: (el) => {
            actionRefs.current[2] = el;
          },
          onClick: () => void loadWorkspace(),
          onKeyDown: (e) =>
            handleLinearNavigation(e, {
              index: 2,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      footerHints={[
        "↑↓ Navigate",
        "F8 Refresh",
        "Alt+Shift+F Search",
        "Esc Back",
        "Ctrl+K Command Bar",
      ]}
    >
      <div className="grid gap-4">
        {/* Search + Bulk Assign button */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[220px] flex-1 gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Search Published Pages
            </span>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
              placeholder="Search by title, resource, route, group, or owner module"
            />
          </label>

          {selectedBulkCount > 0 && (
            <button
              type="button"
              onClick={openDrawerBulk}
              className="border border-sky-400 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 hover:bg-sky-100"
            >
              Assign Selected ({selectedBulkCount})
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={filterTabClass(filter === "ALL")}
            onClick={() => setFilter("ALL")}
          >
            All ({allCount})
          </button>
          <button
            type="button"
            className={filterTabClass(filter === "ASSIGNED")}
            onClick={() => setFilter("ASSIGNED")}
          >
            Assigned ({assignedCount})
          </button>
          <button
            type="button"
            className={filterTabClass(filter === "UNASSIGNED")}
            onClick={() => setFilter("UNASSIGNED")}
          >
            Not Assigned ({unassignedCount})
          </button>
        </div>

        {/* Page list */}
        {loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading ACL module/page ownership rows...
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No pages found. Try a different filter or search query.
          </div>
        ) : (
          <div className="border border-slate-200">
            {/* Select All header row */}
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleChecked}
                onChange={handleSelectAll}
                className="h-4 w-4 flex-shrink-0 accent-sky-600"
              />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {checkedVisible.length > 0
                  ? `${checkedVisible.length} of ${visibleCodes.length} selected`
                  : `Select All (${visibleCodes.length})`}
              </span>
            </div>

            {/* Resource rows */}
            {filteredResources.map((row) => {
              const isChecked = checkedCodes.has(row.resource_code);
              const isAssigned = Boolean(row.owner_module_code);

              return (
                <div
                  key={row.resource_code}
                  className={`flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
                    isChecked ? "bg-sky-50" : "bg-white hover:bg-slate-50"
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => handleRowCheck(row.resource_code, e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-sky-600"
                  />

                  {/* Page info */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {row.title}
                      </span>
                      <span
                        className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          isAssigned
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {isAssigned ? "Assigned" : "Unassigned"}
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      {row.resource_code}
                    </div>
                    <div className="text-xs text-slate-500">{row.route_path}</div>
                    <div className="text-xs text-slate-500">
                      Group: {row.parent_menu_code || "unassigned"} | Owner:{" "}
                      {row.owner_module_code || "none"}
                    </div>
                  </div>

                  {/* Assign / Reassign + Unassign buttons */}
                  <div className="flex flex-shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => openDrawerSingle(row.resource_code)}
                      className={`border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                        isAssigned
                          ? "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                          : "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      }`}
                    >
                      {isAssigned ? "Reassign" : "Assign"}
                    </button>
                    {isAssigned && (
                      <button
                        type="button"
                        onClick={() => void handleUnassign(row.resource_code)}
                        className="border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600 transition-colors hover:bg-rose-100"
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Assign Drawer                                                        */}
      {/* ------------------------------------------------------------------ */}
      <DrawerBase
        visible={drawerOpen}
        title={
          drawerCodes.length === 1
            ? "Assign Page to Module"
            : `Assign ${drawerCodes.length} Pages to Module`
        }
        onClose={closeDrawer}
        initialFocusRef={drawerFirstRef}
        actions={
          <>
            <button
              type="button"
              onClick={closeDrawer}
              disabled={drawerSaving}
              className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!drawerModuleCode || drawerSaving}
              onClick={() => void handleDrawerAssign()}
              className="border border-sky-500 bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {drawerSaving ? "Assigning..." : "Assign"}
            </button>
          </>
        }
      >
        <div className="grid gap-6">

          {/* Pages being assigned */}
          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {drawerCodes.length === 1 ? "Page" : `Pages (${drawerCodes.length})`}
            </p>
            <div className="grid gap-1">
              {drawerCodes.map((code) => {
                const res = resources.find((r) => r.resource_code === code);
                return (
                  <div key={code} className="border border-slate-200 bg-white px-3 py-2">
                    <div className="text-sm font-semibold text-slate-800">
                      {res?.title ?? code}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {res?.owner_module_code
                        ? `Currently in: ${res.owner_module_code}`
                        : "Currently unassigned"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 1: Project */}
          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Step 1 — Choose Project
            </p>
            <div className="grid gap-1">
              {projects.length === 0 ? (
                <p className="text-sm text-slate-400">No projects available.</p>
              ) : (
                projects.map((proj, i) => (
                  <button
                    key={proj.project_code}
                    type="button"
                    ref={i === 0 ? drawerFirstRef : undefined}
                    onClick={() => {
                      setDrawerProjectCode(proj.project_code);
                      setDrawerModuleCode("");
                    }}
                    className={`border px-3 py-2 text-left text-sm transition-colors ${
                      drawerProjectCode === proj.project_code
                        ? "border-sky-300 bg-sky-50 text-sky-900"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-semibold">{proj.project_code}</span>
                    {proj.project_name && (
                      <span className="ml-2 text-xs text-slate-500">
                        {proj.project_name}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Step 2: Module (visible only after project chosen) */}
          {drawerProjectCode && (
            <div className="grid gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Step 2 — Choose Module
              </p>
              <div className="grid gap-1">
                {modulesForProject.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No modules found under this project.
                  </p>
                ) : (
                  modulesForProject.map((mod) => (
                    <button
                      key={mod.module_code}
                      type="button"
                      onClick={() => setDrawerModuleCode(mod.module_code)}
                      className={`border px-3 py-2 text-left text-sm transition-colors ${
                        drawerModuleCode === mod.module_code
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-semibold">
                        {mod.module_name ?? mod.module_code}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span>{mod.module_code}</span>
                        {!mod.module_active && (
                          <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            INACTIVE
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
