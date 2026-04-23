import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

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
    {
      credentials: "include",
    },
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
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(describeApiError(json, "REQUEST_FAILED"));
  }

  return json.data;
}

function sortModules(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left.project_code ?? ""} ${left.module_code ?? ""}`.trim();
    const rightValue = `${right.project_code ?? ""} ${right.module_code ?? ""}`.trim();

    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function sortResources(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left.parent_menu_code ?? ""} ${left.title ?? ""}`.trim();
    const rightValue = `${right.parent_menu_code ?? ""} ${right.title ?? ""}`.trim();

    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export default function SAModuleResourceMap() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const [modules, setModules] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedResourceCode, setSelectedResourceCode] = useState("");
  const [targetModuleCode, setTargetModuleCode] = useState("");

  async function loadWorkspace(preferredResourceCode = selectedResourceCode) {
    setLoading(true);
    setError("");

    try {
      const data = await fetchWorkspace();
      const nextModules = sortModules(data?.modules ?? []);
      const nextResources = sortResources(data?.resources ?? []);

      setModules(nextModules);
      setResources(nextResources);

      const nextSelectedResourceCode =
        nextResources.find((row) => row.resource_code === preferredResourceCode)?.resource_code ??
        nextResources[0]?.resource_code ??
        "";
      setSelectedResourceCode(nextSelectedResourceCode);

      const nextSelectedResource =
        nextResources.find((row) => row.resource_code === nextSelectedResourceCode) ?? null;
      setTargetModuleCode(nextSelectedResource?.owner_module_code ?? "");
    } catch (err) {
      setModules([]);
      setResources([]);
      setSelectedResourceCode("");
      setTargetModuleCode("");
      setError(
        err instanceof Error
          ? `Module/page map could not be loaded. ${err.message}`
          : "Module/page map could not be loaded right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const filteredResources = useMemo(() => {
    const needle = String(searchQuery ?? "").trim().toLowerCase();

    if (!needle) {
      return resources;
    }

    return resources.filter((row) =>
      [
        row.title,
        row.resource_code,
        row.route_path,
        row.parent_menu_code,
        row.owner_module_code,
        row.owner_project_code,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [resources, searchQuery]);

  useEffect(() => {
    if (!filteredResources.some((row) => row.resource_code === selectedResourceCode)) {
      setSelectedResourceCode(filteredResources[0]?.resource_code ?? "");
    }
  }, [filteredResources, selectedResourceCode]);

  const selectedResource =
    filteredResources.find((row) => row.resource_code === selectedResourceCode) ??
    filteredResources[0] ??
    null;

  const { getRowProps } = useErpListNavigation(filteredResources);

  useEffect(() => {
    setTargetModuleCode(selectedResource?.owner_module_code ?? "");
  }, [selectedResource]);

  async function handleAssign() {
    if (!selectedResource || !targetModuleCode) {
      setError("Choose both a published page resource and a target module.");
      return;
    }

    const targetModule = modules.find((row) => row.module_code === targetModuleCode) ?? null;
    if (!targetModule) {
      setError("Selected module no longer exists.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Module Page Ownership",
      title: selectedResource.owner_module_code ? "Move Page To Module" : "Assign Page To Module",
      message: `${selectedResource.resource_code} will belong to ${targetModule.module_code}. Continue?`,
      confirmLabel: selectedResource.owner_module_code ? "Move Page" : "Assign Page",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/module-resource-map", {
        resource_code: selectedResource.resource_code,
        module_code: targetModule.module_code,
      });
      await loadWorkspace(selectedResource.resource_code);
      setNotice(`Resource ${selectedResource.resource_code} now belongs to ${targetModule.module_code}.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Module/page mapping failed. ${err.message}`
          : "Module/page mapping failed right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUnassign() {
    if (!selectedResource?.owner_module_code) {
      setError("Selected page is not assigned to any module.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Module Page Ownership",
      title: "Unassign Page",
      message: `Remove ${selectedResource.resource_code} from ${selectedResource.owner_module_code}?`,
      confirmLabel: "Unassign",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/module-resource-map/remove", {
        resource_code: selectedResource.resource_code,
      });
      await loadWorkspace(selectedResource.resource_code);
      setNotice(`Resource ${selectedResource.resource_code} is now unassigned from module ownership.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Module/page unassign failed. ${err.message}`
          : "Module/page unassign failed right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  useErpScreenCommands([
    {
      id: "sa-module-page-map-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing module page map..." : "Refresh module page map",
      keywords: ["refresh", "module page", "resource map"],
      disabled: loading,
      perform: () => void loadWorkspace(selectedResourceCode),
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
      perform: () => void loadWorkspace(selectedResourceCode),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus(),
    },
  });

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
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => {
            openScreen("SA_PAGE_RESOURCE_REGISTRY", { mode: "replace" });
            navigate("/sa/page-registry");
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
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh Map",
          tone: "primary",
          buttonRef: (element) => {
            actionRefs.current[2] = element;
          },
          onClick: () => void loadWorkspace(selectedResourceCode),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 2,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      footerHints={[
        "ALT+R REFRESH",
        "ALT+SHIFT+F SEARCH",
        "ENTER SELECT RESOURCE",
        "CTRL+K COMMAND BAR",
      ]}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <ErpSectionCard
          eyebrow="Published Resources"
          title="ACL Page Resource Inventory"
        >
          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Search Published Pages
            </span>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
              placeholder="Search by title, resource, route, group, or owner module"
            />
          </label>

          <div className="mt-4 grid gap-2">
            {loading ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Loading ACL module/page ownership rows.
              </div>
            ) : filteredResources.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No ACL/business page is published yet. Build real business pages first, then publish and assign them.
              </div>
            ) : (
              filteredResources.map((row, index) => {
                const selected = row.resource_code === selectedResource?.resource_code;

                return (
                  <button
                    key={row.resource_code}
                    {...getRowProps(index)}
                    type="button"
                    onClick={() => setSelectedResourceCode(row.resource_code)}
                    className={`border px-4 py-3 text-left ${
                      selected
                        ? "border-sky-300 bg-sky-50 text-sky-900"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.title}</span>
                      <span className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {row.owner_module_code ? "Assigned" : "Unassigned"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                      {row.resource_code}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.route_path}
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      Group {row.parent_menu_code || "unassigned"} | Owner {row.owner_module_code || "none"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ErpSectionCard>

        <div className="grid gap-3">
          <ErpSectionCard
            eyebrow="Selected Resource"
            title={selectedResource ? selectedResource.title : "Choose A Published Page"}
          >
            {selectedResource ? (
              <div className="grid gap-3">
                <ErpFieldPreview
                  label="Resource Code"
                  value={selectedResource.resource_code}
                  caption={selectedResource.route_path || "No route path"}
                />
                <ErpFieldPreview
                  label="Current Owner"
                  value={selectedResource.owner_module_code || "Unassigned"}
                  caption={
                    selectedResource.owner_module_code
                      ? `${selectedResource.owner_project_code || ""} | ${selectedResource.owner_module_name || ""}`
                      : "This page has not yet been bound to a module."
                  }
                />
                <ErpFieldPreview
                  label="Menu Placement"
                  value={selectedResource.parent_menu_code || "Unassigned"}
                  caption={`Order ${selectedResource.display_order ?? "-"}`}
                />

                <label className="grid gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Target Module
                  </span>
                  <select
                    value={targetModuleCode}
                    onChange={(event) => setTargetModuleCode(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                  >
                    <option value="">Choose module</option>
                    {modules.map((moduleRow) => (
                      <option key={moduleRow.module_code} value={moduleRow.module_code}>
                        {moduleRow.project_code} | {moduleRow.module_code} | {moduleRow.module_name} | {moduleRow.module_active ? "ACTIVE" : "INACTIVE"}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || !targetModuleCode}
                    onClick={() => void handleAssign()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {selectedResource.owner_module_code ? "Move To Module" : "Assign To Module"}
                  </button>

                  <button
                    type="button"
                    disabled={saving || !selectedResource.owner_module_code}
                    onClick={() => void handleUnassign()}
                    className="border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Unassign
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Pick a published page from the left to manage module ownership.
              </p>
            )}
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Rule"
            title="Why This Layer Exists"
          >
            <div className="grid gap-2 text-sm text-slate-700">
              <p>1. Publish a page into menu first.</p>
              <p>2. Bind that published resource to one module here.</p>
              <p>3. Later approval policy will target the exact resource/action.</p>
              <p>4. Company enablement stays in company-module map, not here.</p>
            </div>
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
