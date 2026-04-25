import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { PROJECT_SCREENS } from "../../../navigation/screens/projects/projectScreens.js";
import { HR_SCREENS } from "../../../navigation/screens/projects/hrModule/hrScreens.js";
import { OPERATION_SCREENS } from "../../../navigation/screens/projects/operationModule/operationScreens.js";
import { WORKFLOW_SCREENS } from "../../../navigation/screens/workflowScreens.js";
import { REPORTING_SCREENS } from "../../../navigation/screens/reportingScreens.js";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

const ACL_SCREEN_REGISTRY = Object.freeze({
  ...PROJECT_SCREENS,
  ...HR_SCREENS,
  ...OPERATION_SCREENS,
  ...WORKFLOW_SCREENS,
  ...REPORTING_SCREENS,
});

async function fetchMenuRegistry(universe) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/menu?universe=${encodeURIComponent(universe)}`,
    {
      credentials: "include",
    },
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.menus)) {
    throw new Error(json?.code ?? "PAGE_RESOURCE_REGISTRY_READ_FAILED");
  }

  return json.data.menus;
}

function resolveRegisteredPageMenu(menus, screen) {
  const route = String(screen?.route ?? "");
  const screenCode = String(screen?.screen_code ?? "");

  return (
    menus.find(
      (item) =>
        item.menu_type === "PAGE" &&
        item.route_path === route,
    ) ??
    menus.find(
      (item) =>
        item.menu_type === "PAGE" &&
        item.menu_code === screenCode,
    ) ??
    null
  );
}

function formatScreenTitle(screenCode) {
  return String(screenCode ?? "")
    .replace(/^(SA|GA|ACL|DASHBOARD)_/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function createPageRows(menus) {
  return Object.values(ACL_SCREEN_REGISTRY)
    .filter((screen) => screen.publishableInMenu !== false)
    .filter((screen) => Boolean(screen?.screen_code) && Boolean(screen?.route))
    .map((screen) => {
      const registeredMenu = resolveRegisteredPageMenu(menus, screen);

      return {
        screen_code: screen.screen_code,
        title: formatScreenTitle(screen.screen_code),
        route_path: screen.route,
        registeredMenu,
        resource_code:
          registeredMenu?.resource_code ??
          screen.screen_code,
        parent_menu_code: registeredMenu?.parent_menu_code ?? "",
        display_order:
          registeredMenu?.tree_display_order ??
          registeredMenu?.display_order ??
          null,
        is_published: Boolean(registeredMenu),
        is_active: registeredMenu?.is_active ?? false,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, "en", { sensitivity: "base" }));
}

export default function SAPageResourceRegistry() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedScreenCode, setSelectedScreenCode] = useState("");

  async function loadRegistry() {
    setLoading(true);
    setError("");

    try {
      const nextMenus = await fetchMenuRegistry("SA");
      setMenus(nextMenus);
    } catch (err) {
      setMenus([]);
      setError(
        err instanceof Error
          ? `Page registry could not be loaded. ${err.message}`
          : "Page registry could not be loaded right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRegistry();
  }, []);

  const pageRows = useMemo(() => createPageRows(menus), [menus]);

  const filteredRows = useMemo(() => {
    const needle = String(searchQuery ?? "").trim().toLowerCase();

    if (!needle) {
      return pageRows;
    }

    return pageRows.filter((row) =>
      [
        row.screen_code,
        row.title,
        row.route_path,
        row.resource_code,
        row.parent_menu_code,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [pageRows, searchQuery]);

  useEffect(() => {
    if (!filteredRows.some((row) => row.screen_code === selectedScreenCode)) {
      setSelectedScreenCode(filteredRows[0]?.screen_code ?? "");
    }
  }, [filteredRows, selectedScreenCode]);

  const selectedRow =
    filteredRows.find((row) => row.screen_code === selectedScreenCode) ??
    filteredRows[0] ??
    null;

  const { getRowProps } = useErpListNavigation(filteredRows, {
    onActivate: (row) => setSelectedScreenCode(row.screen_code),
  });

  useErpScreenCommands([
    {
      id: "sa-page-registry-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing page registry..." : "Refresh page registry",
      keywords: ["refresh", "page", "resource", "registry"],
      disabled: loading,
      perform: () => void loadRegistry(),
      order: 10,
    },
    {
      id: "sa-page-registry-menu-governance",
      group: "Current Screen",
      label: "Open menu governance",
      keywords: ["menu governance", "publish page"],
      perform: () => {
        openScreen("SA_MENU_GOVERNANCE", { mode: "replace" });
        navigate("/sa/menu");
      },
      order: 20,
    },
    {
      id: "sa-page-registry-module-page-map",
      group: "Current Screen",
      label: "Open module page map",
      keywords: ["module page map", "page ownership"],
      perform: () => {
        openScreen("SA_MODULE_RESOURCE_MAP", { mode: "replace" });
        navigate("/sa/module-pages");
      },
      order: 25,
    },
    {
      id: "sa-page-registry-module-master",
      group: "Current Screen",
      label: "Back to module master",
      keywords: ["module master", "module"],
      perform: () => {
        openScreen("SA_MODULE_MASTER", { mode: "replace" });
        navigate("/sa/module-master");
      },
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadRegistry(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus(),
    },
  });

  return (
    <ErpScreenScaffold
      eyebrow="Page Registry"
      title="ACL Page And Resource Registry"
      notices={error ? [{ tone: "error", message: error }] : []}
      actions={[
        {
          key: "module-master",
          label: "Module Master",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => {
            openScreen("SA_MODULE_MASTER", { mode: "replace" });
            navigate("/sa/module-master");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "menu-governance",
          label: "Menu Governance",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[1] = element;
          },
          onClick: () => {
            openScreen("SA_MENU_GOVERNANCE", { mode: "replace" });
            navigate("/sa/menu");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "module-page-map",
          label: "Module Page Map",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[2] = element;
          },
          onClick: () => {
            openScreen("SA_MODULE_RESOURCE_MAP", { mode: "replace" });
            navigate("/sa/module-pages");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 2,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh Registry",
          tone: "primary",
          buttonRef: (element) => {
            actionRefs.current[3] = element;
          },
          onClick: () => void loadRegistry(),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 3,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      footerHints={["↑↓ Navigate", "F8 Refresh", "Alt+Shift+F Search", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="grid gap-1">
          <ErpSelectionSection label="Registered ACL Pages" />
          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Search Pages
            </span>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
              placeholder="Search by title, screen code, route, resource, or group"
            />
          </label>

          <div className="mt-2 grid gap-2">
            {loading ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Loading ACL page registry.
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No ACL/business page exists yet. Build the real business screens first, then they will appear here.
              </div>
            ) : (
              <ErpDenseGrid
                columns={[
                  {
                    key: "title",
                    label: "Page",
                    render: (row) => (
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{row.title}</span>
                          <span className="border border-slate-200 bg-slate-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                            {row.is_published ? (row.is_active ? "Published" : "Disabled") : "Not In Menu"}
                          </span>
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {row.screen_code}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "route_path",
                    label: "Route",
                    render: (row) => (
                      <span className="block max-w-[26rem] truncate text-[11px] text-slate-600">
                        {row.route_path}
                      </span>
                    ),
                  },
                  {
                    key: "placement",
                    label: "Registry Status",
                    render: (row) => (
                      <span className="text-[11px] text-slate-600">
                        {row.parent_menu_code || "Unassigned"} / {row.display_order ?? "-"}
                      </span>
                    ),
                  },
                ]}
                rows={filteredRows}
                rowKey={(row) => row.screen_code}
                getRowProps={(_row, index) => getRowProps(index)}
                onRowActivate={(row) => setSelectedScreenCode(row.screen_code)}
                maxHeight="none"
                emptyMessage="No ACL/business page exists yet. Build the real business screens first, then they will appear here."
              />
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="grid gap-1">
            <ErpSelectionSection label={selectedRow ? `${selectedRow.title}` : "Choose A Page"} />
            {selectedRow ? (
              <div className="grid gap-[var(--erp-form-gap)]">
                <div className="border border-slate-300 bg-white">
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Screen Code</span>
                    <span className="break-all text-right text-[11px] font-semibold text-slate-900">{selectedRow.screen_code}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Route</span>
                    <span className="break-all text-right text-[11px] font-semibold text-slate-900">{selectedRow.route_path}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Resource Code</span>
                    <span className="break-all text-right text-[11px] font-semibold text-slate-900">{selectedRow.resource_code}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Menu Placement</span>
                    <span className="text-right text-[11px] font-semibold text-slate-900">{selectedRow.parent_menu_code || "Unassigned"}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Module Ownership</span>
                    <span className="text-right text-[11px] font-semibold text-slate-900">Pending next step</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      openScreen("SA_MENU_GOVERNANCE", { mode: "replace" });
                      navigate("/sa/menu");
                    }}
                    className="h-8 border border-sky-300 bg-sky-50 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-900"
                  >
                    Menu Governance
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      openScreen("SA_MODULE_RESOURCE_MAP", { mode: "replace" });
                      navigate("/sa/module-pages");
                    }}
                    className="h-8 border border-cyan-300 bg-cyan-50 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700"
                  >
                    Module Page Map
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      openScreen(selectedRow.screen_code, { mode: "replace" });
                      navigate(selectedRow.route_path);
                    }}
                    className="h-8 border border-slate-300 bg-white px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700"
                  >
                    Open Screen
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Select a page from the registry to inspect it.
              </p>
            )}
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Operator Rule" />
            <div className="border border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-700">
              Registry first. Then menu placement. Then module ownership. Approval and ACL hang off this exact resource code.
            </div>
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
