import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchRolePermissions(roleCode) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/role-permissions?role_code=${encodeURIComponent(roleCode)}`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.permissions)) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_LIST_FAILED");
  }

  return json.data.permissions;
}

async function fetchResourceCatalog() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/approval/resource-policy`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.resources)) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_RESOURCE_CATALOG_FAILED");
  }

  return json.data.resources;
}

async function saveRolePermission(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/acl/role-permissions`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_UPSERT_FAILED");
  }

  return json.data;
}

async function disableRolePermission(payload) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/role-permissions/disable`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_DISABLE_FAILED");
  }

  return json.data;
}

function countEnabledFlags(row) {
  return [
    row.can_view,
    row.can_write,
    row.can_edit,
    row.can_delete,
    row.can_approve,
    row.can_export,
    Array.isArray(row.denied_actions) && row.denied_actions.length > 0,
  ].filter(Boolean).length;
}

function createEmptyDraft(roleCode) {
  return {
    role_code: roleCode,
    resource_code: "",
    can_view: true,
    can_write: false,
    can_edit: false,
    can_delete: false,
    can_approve: false,
    can_export: false,
    denied_actions: [],
  };
}

const ACTION_MATRIX = [
  ["VIEW", "can_view", "View"],
  ["WRITE", "can_write", "Write"],
  ["EDIT", "can_edit", "Edit"],
  ["DELETE", "can_delete", "Delete"],
  ["APPROVE", "can_approve", "Approve"],
  ["EXPORT", "can_export", "Export"],
];

function createDraftFromRow(roleCode, row) {
  return {
    role_code: roleCode,
    resource_code: row.resource_code,
    can_view: Boolean(row.can_view),
    can_write: Boolean(row.can_write),
    can_edit: Boolean(row.can_edit),
    can_delete: Boolean(row.can_delete),
    can_approve: Boolean(row.can_approve),
    can_export: Boolean(row.can_export),
    denied_actions: Array.isArray(row.denied_actions) ? row.denied_actions : [],
  };
}

export default function SARolePermissions() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const resourceInputRef = useRef(null);
  const rowActionRefs = useRef([]);
  const [selectedRoleCode, setSelectedRoleCode] = useState(ERP_ROLE_OPTIONS[0]?.code ?? "SA");
  const [permissions, setPermissions] = useState([]);
  const [resourceCatalog, setResourceCatalog] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [selectedProjectCode, setSelectedProjectCode] = useState("");
  const [selectedModuleCode, setSelectedModuleCode] = useState("");
  const [draft, setDraft] = useState(() => createEmptyDraft(ERP_ROLE_OPTIONS[0]?.code ?? "SA"));
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadPermissions(roleCode = selectedRoleCode) {
    setLoading(true);
    setError("");

    try {
      const data = await fetchRolePermissions(roleCode);
      setPermissions(data);
    } catch {
      setPermissions([]);
      setError("Unable to load role permissions right now.");
    } finally {
      setLoading(false);
    }
  }

  async function loadResourceCatalog(preferredResourceCode = draft.resource_code) {
    setCatalogLoading(true);

    try {
      const resources = await fetchResourceCatalog();
      setResourceCatalog(resources);

      const hasPreferred = resources.some((row) => row.resource_code === preferredResourceCode);
      if (!hasPreferred && resources.length > 0 && !preferredResourceCode) {
        setDraft((current) => ({
          ...current,
          role_code: selectedRoleCode,
        }));
      }
    } catch {
      setResourceCatalog([]);
      setError("Mapped business resources could not be loaded right now.");
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    setDraft(createEmptyDraft(selectedRoleCode));
    void loadPermissions(selectedRoleCode);
    void loadResourceCatalog("");
  }, [selectedRoleCode]);

  const catalogProjectOptions = useMemo(
    () =>
      [...new Set(
        resourceCatalog
          .map((row) => row.project_code)
          .filter(Boolean)
      )].sort((left, right) =>
        String(left).localeCompare(String(right), "en", {
          numeric: true,
          sensitivity: "base",
        })
      ),
    [resourceCatalog]
  );

  const catalogModuleOptions = useMemo(
    () =>
      [...new Set(
        resourceCatalog
          .filter((row) => !selectedProjectCode || row.project_code === selectedProjectCode)
          .map((row) => row.module_code)
          .filter(Boolean)
      )].sort((left, right) =>
        String(left).localeCompare(String(right), "en", {
          numeric: true,
          sensitivity: "base",
        })
      ),
    [resourceCatalog, selectedProjectCode]
  );

  const filteredCatalogResources = useMemo(() => {
    const needle = String(catalogSearchQuery ?? "").trim().toLowerCase();

    return resourceCatalog.filter((row) => {
      if (selectedProjectCode && row.project_code !== selectedProjectCode) {
        return false;
      }
      if (selectedModuleCode && row.module_code !== selectedModuleCode) {
        return false;
      }
      if (!needle) {
        return true;
      }

      return [
        row.title,
        row.resource_code,
        row.route_path,
        row.project_code,
        row.module_code,
        row.module_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [catalogSearchQuery, resourceCatalog, selectedModuleCode, selectedProjectCode]);

  const enrichedPermissions = useMemo(
    () =>
      permissions.map((row) => {
        const catalogRow = resourceCatalog.find(
          (resource) => resource.resource_code === row.resource_code
        );

        return {
          ...row,
          title: catalogRow?.title ?? row.resource_code,
          module_code: catalogRow?.module_code ?? null,
          project_code: catalogRow?.project_code ?? null,
          route_path: catalogRow?.route_path ?? null,
        };
      }),
    [permissions, resourceCatalog]
  );

  const filteredPermissions = useMemo(
    () =>
      applyQuickFilter(enrichedPermissions, searchQuery, [
        "resource_code",
        "title",
        "module_code",
        "project_code",
        "route_path",
      ]),
    [enrichedPermissions, searchQuery]
  );
  const permissionPagination = useErpPagination(filteredPermissions, 10);

  useEffect(() => {
    if (
      selectedModuleCode &&
      !catalogModuleOptions.includes(selectedModuleCode)
    ) {
      setSelectedModuleCode("");
    }
  }, [catalogModuleOptions, selectedModuleCode]);

  useEffect(() => {
    if (
      draft.resource_code &&
      !filteredCatalogResources.some((row) => row.resource_code === draft.resource_code)
    ) {
      return;
    }

    if (!draft.resource_code && filteredCatalogResources.length > 0) {
      const firstResource = filteredCatalogResources[0];
      setDraft((current) => ({
        ...createEmptyDraft(selectedRoleCode),
        resource_code: firstResource.resource_code,
      }));
    }
  }, [draft.resource_code, filteredCatalogResources, selectedRoleCode]);

  useErpDenseFormNavigation(formContainerRef, {
    disabled: saving,
    submitOnFinalField: true,
    onSubmit: () => handleSave(),
  });

  async function handleSave() {
    if (!draft.resource_code.trim()) {
      setError("Resource code is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await saveRolePermission({
        ...draft,
        role_code: selectedRoleCode,
        resource_code: draft.resource_code.trim(),
        denied_actions: draft.denied_actions,
      });
      await loadPermissions(selectedRoleCode);
      setNotice(`Permission updated for ${selectedRoleCode} on ${draft.resource_code.trim()}.`);
    } catch {
      setError("Role permission could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function selectCatalogResource(resourceCode) {
    const existing = permissions.find((row) => row.resource_code === resourceCode);

    if (existing) {
      setDraft(createDraftFromRow(selectedRoleCode, existing));
      return;
    }

    setDraft({
      ...createEmptyDraft(selectedRoleCode),
      resource_code: resourceCode,
    });
  }

  async function handleDisable(row) {
    const approved = await openActionConfirm({
      eyebrow: "ACL Governance",
      title: "Disable Role Permission",
      message: `Clear all permission flags for ${row.resource_code} on ${selectedRoleCode}?`,
      confirmLabel: "Disable",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await disableRolePermission({
        role_code: selectedRoleCode,
        resource_code: row.resource_code,
      });
      await loadPermissions(selectedRoleCode);
      setNotice(`Permission cleared for ${row.resource_code}.`);
    } catch {
      setError("Role permission could not be disabled.");
    } finally {
      setSaving(false);
    }
  }

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleSave(),
    },
    refresh: {
      disabled: loading,
      perform: () => void loadPermissions(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => resourceInputRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-role-permissions-control-panel",
      group: "Current Screen",
      label: "Go to SA control panel",
      keywords: ["control panel", "sa"],
      perform: () => {
        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      order: 10,
    },
    {
      id: "sa-role-permissions-focus-search",
      group: "Current Screen",
      label: "Focus permission search",
      keywords: ["search", "permission", "resource"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-role-permissions-focus-editor",
      group: "Current Screen",
      label: "Focus permission editor",
      keywords: ["editor", "resource code", "permission flags"],
      perform: () => resourceInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-role-permissions-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing permissions..." : "Refresh permissions",
      keywords: ["refresh", "acl", "role permissions"],
      disabled: loading,
      perform: () => void loadPermissions(),
      order: 40,
    },
    {
      id: "sa-role-permissions-save",
      group: "Current Screen",
      label: saving ? "Saving permission..." : "Save role permission",
      hint: "Ctrl+S",
      keywords: ["save", "upsert", "permission"],
      disabled: saving,
      perform: () => void handleSave(),
      order: 50,
    },
  ]);

  const topActions = [
    {
      key: "control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => {
        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh",
      label: loading ? "Refreshing..." : "Refresh",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => void loadPermissions(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save",
      label: saving ? "Saving..." : "Save Permission",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving,
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void handleSave(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  return (
    <ErpApprovalReviewTemplate
      eyebrow="ACL Governance"
      title="Role Permissions"
      description="Review and maintain role-resource VWED permission rows without leaving a keyboard-native ACL surface."
      actions={topActions}
      notices={[
        ...(error
          ? [{ key: "error", tone: "error", message: error }]
          : []),
        ...(notice
          ? [{ key: "notice", tone: "success", message: notice }]
          : []),
      ]}
      metrics={[
        {
          key: "role",
          label: "Role",
          value: selectedRoleCode,
          tone: "sky",
          caption: ERP_ROLE_LABELS[selectedRoleCode] ?? "Selected role under ACL review.",
        },
        {
          key: "resources",
          label: "Resources",
          value: loading ? "..." : String(permissions.length),
          tone: "emerald",
          caption: "Current resource rows returned by the backend for this role.",
        },
        {
          key: "active",
          label: "Active Rows",
          value: loading ? "..." : String(permissions.filter((row) => countEnabledFlags(row) > 0).length),
          tone: "amber",
          caption: "Rows with at least one explicit allow or deny action.",
        },
        {
          key: "visible",
          label: "Visible",
          value: loading ? "..." : String(filteredPermissions.length),
          tone: "slate",
          caption: "Rows matching the current resource search.",
        },
      ]}
      filterSection={{
        eyebrow: "Role Filter",
        title: "Select role and filter resources",
        children: (
          <div className="space-y-5">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Role Code
              </span>
              <select
                value={selectedRoleCode}
                onChange={(event) => setSelectedRoleCode(event.target.value)}
                className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
              >
                {ERP_ROLE_OPTIONS.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.code} - {role.label}
                  </option>
                ))}
              </select>
            </label>

            <QuickFilterInput
              label="Resource Search"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchInputRef}
              placeholder="Filter saved rows by resource, page, module, or project"
              hint="Alt+Shift+F focuses this saved-row filter."
            />

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Project Picker
                </span>
                <select
                  value={selectedProjectCode}
                  onChange={(event) => setSelectedProjectCode(event.target.value)}
                  className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
                >
                  <option value="">All mapped projects</option>
                  {catalogProjectOptions.map((projectCode) => (
                    <option key={projectCode} value={projectCode}>
                      {projectCode}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Module Picker
                </span>
                <select
                  value={selectedModuleCode}
                  onChange={(event) => setSelectedModuleCode(event.target.value)}
                  className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
                >
                  <option value="">All mapped modules</option>
                  {catalogModuleOptions.map((moduleCode) => (
                    <option key={moduleCode} value={moduleCode}>
                      {moduleCode}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <QuickFilterInput
              label="Mapped Business Resources"
              value={catalogSearchQuery}
              onChange={setCatalogSearchQuery}
              placeholder="Search mapped business resources"
              hint="Choose Project -> Module -> Resource instead of typing manual code."
            />
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Permission Rows",
        title: loading
          ? "Loading permission rows"
          : `${filteredPermissions.length} visible resource row${filteredPermissions.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading role permissions from ACL governance APIs.
          </div>
        ) : filteredPermissions.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No resource row matches the current role filter.
          </div>
        ) : (
          <div className="border border-slate-300">
            <ErpPaginationStrip
              page={permissionPagination.page}
              setPage={permissionPagination.setPage}
              totalPages={permissionPagination.totalPages}
              startIndex={permissionPagination.startIndex}
              endIndex={permissionPagination.endIndex}
              totalItems={filteredPermissions.length}
            />
            <div className="space-y-0">
            {permissionPagination.pageItems.map((row, index) => (
              <div
                key={`${row.resource_code}-${index}`}
                className="border-b border-slate-300 bg-white px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {row.title ?? row.resource_code}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {[row.project_code, row.module_code].filter(Boolean).join(" | ")}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {[
                        row.can_view ? "V" : null,
                        row.can_write ? "W" : null,
                        row.can_edit ? "E" : null,
                        row.can_delete ? "D" : null,
                        row.can_approve ? "A" : null,
                        row.can_export ? "X" : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || "NO FLAGS"}
                    </p>
                    {Array.isArray(row.denied_actions) && row.denied_actions.length > 0 ? (
                      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-rose-600">
                        Deny: {row.denied_actions.join(" ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][0] = element;
                      }}
                      type="button"
                      onClick={() => setDraft(createDraftFromRow(selectedRoleCode, row))}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 0,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="border border-cyan-300 bg-cyan-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700"
                    >
                      Edit
                    </button>
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][1] = element;
                      }}
                      type="button"
                      onClick={() => void handleDisable(row)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 1,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="border border-rose-300 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>
        ),
      }}
      sideSection={{
        eyebrow: "Editor",
        title: "Role permission editor",
        description: "Pick a mapped business resource from project/module/resource selectors, then set action flags for the selected role.",
        children: (
          <div ref={formContainerRef} className="space-y-4">
            <div className="grid gap-4">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Selected Resource
                </span>
                <input
                  ref={resourceInputRef}
                  data-workspace-primary-focus="true"
                  value={draft.resource_code}
                  readOnly
                  placeholder={
                    catalogLoading
                      ? "Loading mapped resources..."
                      : "Search filtered results below and click one resource"
                  }
                  className="mt-2 w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none"
                />
              </label>

              <div className="border border-slate-300 bg-white">
                <div className="border-b border-slate-300 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Search Results
                </div>
                {catalogLoading ? (
                  <div className="px-4 py-4 text-sm text-slate-500">
                    Loading mapped business resources...
                  </div>
                ) : filteredCatalogResources.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-slate-500">
                    No mapped resource matches the current project/module/search filter.
                  </div>
                ) : (
                  <div className="max-h-[18rem] overflow-y-auto">
                    {filteredCatalogResources.map((row) => {
                      const selected = draft.resource_code === row.resource_code;

                      return (
                        <button
                          key={row.resource_code}
                          type="button"
                          onClick={() => selectCatalogResource(row.resource_code)}
                          className={`w-full border-b border-slate-200 px-4 py-3 text-left last:border-b-0 ${
                            selected
                              ? "bg-sky-50 text-sky-900"
                              : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <div className="text-sm font-semibold">
                            {row.title}
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {[row.project_code, row.module_code, row.resource_code]
                              .filter(Boolean)
                              .join(" | ")}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {row.route_path || "No route"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {draft.resource_code ? (
                <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  {(() => {
                    const selectedResource = resourceCatalog.find(
                      (row) => row.resource_code === draft.resource_code
                    );

                    if (!selectedResource) {
                      return `Selected resource: ${draft.resource_code}`;
                    }

                    return [
                      selectedResource.project_code,
                      selectedResource.module_code,
                      selectedResource.route_path,
                    ]
                      .filter(Boolean)
                      .join(" | ");
                  })()}
                </div>
              ) : null}
            </div>

            <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Resource Code
                </span>
              <input
                type="text"
                value={draft.resource_code}
                readOnly
                placeholder="RESOURCE_CODE"
                className="mt-2 w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </label>

            <div className="border border-slate-300 bg-white">
              <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] border-b border-slate-300 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <span>Action</span>
                <span className="text-center">Allow</span>
                <span className="text-center">Deny</span>
              </div>
              {ACTION_MATRIX.map(([action, key, label]) => (
                <div
                  key={action}
                  className="grid grid-cols-[minmax(0,1fr)_84px_84px] items-center border-b border-slate-200 px-4 py-3 text-sm text-slate-700 last:border-b-0"
                >
                  <span>{label}</span>
                  <label className="flex justify-center">
                    <input
                      data-erp-form-field="true"
                      type="checkbox"
                      checked={Boolean(draft[key])}
                      onChange={(event) =>
                        setDraft((current) => {
                          const deniedActions = (current.denied_actions ?? []).filter(
                            (item) => item !== action
                          );

                          return {
                            ...current,
                            [key]: event.target.checked,
                            denied_actions: deniedActions,
                          };
                        })
                      }
                      className="h-4 w-4 border-slate-300 bg-white text-emerald-600"
                    />
                  </label>
                  <label className="flex justify-center">
                    <input
                      data-erp-form-field="true"
                      type="checkbox"
                      checked={(draft.denied_actions ?? []).includes(action)}
                      onChange={(event) =>
                        setDraft((current) => {
                          const deniedActions = new Set(current.denied_actions ?? []);

                          if (event.target.checked) {
                            deniedActions.add(action);
                          } else {
                            deniedActions.delete(action);
                          }

                          return {
                            ...current,
                            [key]: false,
                            denied_actions: Array.from(deniedActions),
                          };
                        })
                      }
                      className="h-4 w-4 border-slate-300 bg-white text-rose-600"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        ),
      }}
    />
  );
}
