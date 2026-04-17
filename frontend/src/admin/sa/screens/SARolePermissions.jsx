import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function buildApiError(json, fallbackCode) {
  const code = json?.code ?? fallbackCode ?? "REQUEST_FAILED";
  const decisionTrace = json?.decision_trace ? ` | ${json.decision_trace}` : "";
  const requestId = json?.request_id ? ` | Req ${json.request_id}` : "";
  const publicMessage =
    typeof json?.message === "string" && json.message.trim().length > 0
      ? ` | ${json.message.trim()}`
      : "";
  const error = new Error(`${code}${decisionTrace}${publicMessage}${requestId}`);
  error.code = json?.code ?? fallbackCode ?? "REQUEST_FAILED";
  error.requestId = json?.request_id ?? null;
  error.decisionTrace = json?.decision_trace ?? null;
  error.publicMessage = json?.message ?? null;
  return error;
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
    throw buildApiError(json, "ROLE_PERMISSION_LIST_FAILED");
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
    throw buildApiError(json, "ROLE_PERMISSION_RESOURCE_CATALOG_FAILED");
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
    throw buildApiError(json, "ROLE_PERMISSION_UPSERT_FAILED");
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
    throw buildApiError(json, "ROLE_PERMISSION_DISABLE_FAILED");
  }

  return json.data;
}

const ACTION_MATRIX = [
  ["VIEW", "can_view", "View"],
  ["WRITE", "can_write", "Write"],
  ["EDIT", "can_edit", "Edit"],
  ["DELETE", "can_delete", "Delete"],
  ["APPROVE", "can_approve", "Approve"],
  ["EXPORT", "can_export", "Export"],
];

function createEmptyDraft(roleCode, resourceCode = "") {
  return {
    role_code: roleCode,
    resource_code: resourceCode,
    can_view: false,
    can_write: false,
    can_edit: false,
    can_delete: false,
    can_approve: false,
    can_export: false,
    denied_actions: [],
  };
}

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

function hasAnyExplicitRule(draft) {
  return ACTION_MATRIX.some(([, key]) => Boolean(draft[key])) || draft.denied_actions.length > 0;
}

export default function SARolePermissions() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const searchInputRef = useRef(null);
  const [selectedRoleCode, setSelectedRoleCode] = useState(ERP_ROLE_OPTIONS[0]?.code ?? "SA");
  const [permissions, setPermissions] = useState([]);
  const [resourceCatalog, setResourceCatalog] = useState([]);
  const [selectedProjectCode, setSelectedProjectCode] = useState("");
  const [selectedModuleCode, setSelectedModuleCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedResourceCode, setSelectedResourceCode] = useState("");
  const [matrixDrafts, setMatrixDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadPermissions(roleCode = selectedRoleCode) {
    setLoading(true);
    setError("");
    setPermissions([]);
    setMatrixDrafts({});
    setSelectedResourceCode("");

    try {
      const data = await fetchRolePermissions(roleCode);
      setPermissions(data);
    } catch (err) {
      console.error("ROLE_PERMISSION_LOAD_FAILED", {
        role_code: roleCode,
        message: err?.message ?? "ROLE_PERMISSION_LIST_FAILED",
        code: err?.code ?? null,
        requestId: err?.requestId ?? null,
        decisionTrace: err?.decisionTrace ?? null,
      });
      setPermissions([]);
      setError(
        err instanceof Error
          ? `Unable to load role permissions. ${err.message}`
          : "Unable to load role permissions right now."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadResourceCatalog() {
    setCatalogLoading(true);

    try {
      const resources = await fetchResourceCatalog();
      setResourceCatalog(resources);
    } catch (err) {
      console.error("ROLE_PERMISSION_CATALOG_LOAD_FAILED", {
        message: err?.message ?? "ROLE_PERMISSION_RESOURCE_CATALOG_FAILED",
        code: err?.code ?? null,
        requestId: err?.requestId ?? null,
        decisionTrace: err?.decisionTrace ?? null,
      });
      setResourceCatalog([]);
      setError(
        err instanceof Error
          ? `Mapped business resources could not be loaded. ${err.message}`
          : "Mapped business resources could not be loaded right now."
      );
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    void loadPermissions(selectedRoleCode);
    void loadResourceCatalog();
  }, [selectedRoleCode]);

  const permissionMap = useMemo(
    () => new Map(permissions.map((row) => [row.resource_code, row])),
    [permissions]
  );

  const catalogProjectOptions = useMemo(
    () =>
      [...new Set(resourceCatalog.map((row) => row.project_code).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" })
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
      )].sort((a, b) =>
        String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" })
      ),
    [resourceCatalog, selectedProjectCode]
  );

  useEffect(() => {
    if (selectedModuleCode && !catalogModuleOptions.includes(selectedModuleCode)) {
      setSelectedModuleCode("");
    }
  }, [catalogModuleOptions, selectedModuleCode]);

  const filteredCatalogResources = useMemo(() => {
    const needle = String(searchQuery ?? "").trim().toLowerCase();

    return resourceCatalog.filter((row) => {
      if (selectedProjectCode && row.project_code !== selectedProjectCode) return false;
      if (selectedModuleCode && row.module_code !== selectedModuleCode) return false;
      if (!needle) return true;

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
  }, [resourceCatalog, searchQuery, selectedProjectCode, selectedModuleCode]);

  const visibleMatrixRows = useMemo(
    () =>
      filteredCatalogResources.map((resource) => ({
        resource,
        savedRow: permissionMap.get(resource.resource_code) ?? null,
        draft:
          matrixDrafts[resource.resource_code] ??
          (permissionMap.has(resource.resource_code)
            ? createDraftFromRow(selectedRoleCode, permissionMap.get(resource.resource_code))
            : createEmptyDraft(selectedRoleCode, resource.resource_code)),
      })),
    [filteredCatalogResources, matrixDrafts, permissionMap, selectedRoleCode]
  );

  useEffect(() => {
    if (!visibleMatrixRows.length) {
      setSelectedResourceCode("");
      return;
    }

    if (!selectedResourceCode || !visibleMatrixRows.some((row) => row.resource.resource_code === selectedResourceCode)) {
      setSelectedResourceCode(visibleMatrixRows[0].resource.resource_code);
    }
  }, [selectedResourceCode, visibleMatrixRows]);

  const selectedMatrixRow = useMemo(
    () =>
      visibleMatrixRows.find((row) => row.resource.resource_code === selectedResourceCode) ?? null,
    [selectedResourceCode, visibleMatrixRows]
  );

  function updateDraft(resourceCode, updater) {
    setMatrixDrafts((current) => {
      const base =
        current[resourceCode] ??
        (permissionMap.has(resourceCode)
          ? createDraftFromRow(selectedRoleCode, permissionMap.get(resourceCode))
          : createEmptyDraft(selectedRoleCode, resourceCode));

      return {
        ...current,
        [resourceCode]: updater(base),
      };
    });
  }

  function updateAllowFlag(resourceCode, key, checked, actionCode) {
    updateDraft(resourceCode, (draft) => ({
      ...draft,
      [key]: checked,
      denied_actions: (draft.denied_actions ?? []).filter((item) => item !== actionCode),
    }));
  }

  function updateDenyFlag(resourceCode, actionCode, checked) {
    updateDraft(resourceCode, (draft) => {
      const deniedActions = new Set(draft.denied_actions ?? []);

      if (checked) {
        deniedActions.add(actionCode);
      } else {
        deniedActions.delete(actionCode);
      }

      const next = {
        ...draft,
        denied_actions: Array.from(deniedActions),
      };
      const actionEntry = ACTION_MATRIX.find(([code]) => code === actionCode);
      if (actionEntry) {
        next[actionEntry[1]] = false;
      }
      return next;
    });
  }

  async function handleSaveMatrix() {
    if (!selectedModuleCode) {
      setError("Choose a project and one module before saving the permission matrix.");
      return;
    }

    if (!visibleMatrixRows.length) {
      setError("No mapped business resources are available inside the selected project and module.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const changeSummary = [];
      for (const row of visibleMatrixRows) {
        const payload = row.draft;
        const hadExisting = Boolean(row.savedRow);
        const hasRule = hasAnyExplicitRule(payload);

        if (!hasRule) {
          if (hadExisting) {
            await disableRolePermission({
              role_code: selectedRoleCode,
              resource_code: row.resource.resource_code,
            });
            changeSummary.push({
              resource_code: row.resource.resource_code,
              action: "DISABLE",
            });
          }
          continue;
        }

        await saveRolePermission({
          role_code: selectedRoleCode,
          resource_code: row.resource.resource_code,
          can_view: payload.can_view,
          can_write: payload.can_write,
          can_edit: payload.can_edit,
          can_delete: payload.can_delete,
          can_approve: payload.can_approve,
          can_export: payload.can_export,
          denied_actions: payload.denied_actions,
        });
        changeSummary.push({
          resource_code: row.resource.resource_code,
          action: "UPSERT",
          denied_actions: payload.denied_actions,
        });
      }

      await loadPermissions(selectedRoleCode);
      console.info("ROLE_PERMISSION_MATRIX_SAVE_RESULT", {
        role_code: selectedRoleCode,
        project_code: selectedProjectCode || null,
        module_code: selectedModuleCode || null,
        changes: changeSummary,
      });
      setNotice(`${selectedRoleCode} permissions were saved for the ${selectedModuleCode} module.`);
    } catch (err) {
      console.error("ROLE_PERMISSION_MATRIX_SAVE_FAILED", {
        role_code: selectedRoleCode,
        project_code: selectedProjectCode || null,
        module_code: selectedModuleCode || null,
        selected_resource_code: selectedResourceCode || null,
        message: err?.message ?? "ROLE_PERMISSION_UPSERT_FAILED",
      });
      setError(
        err instanceof Error
          ? `The role permission matrix could not be saved. ${err.message}`
          : "The role permission matrix could not be saved right now."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleClearSelected() {
    if (!selectedMatrixRow) return;

    const approved = await openActionConfirm({
      eyebrow: "ACL Governance",
      title: "Clear Selected Resource Rule",
      message: `Clear the explicit rule for ${selectedMatrixRow.resource.title}?`,
      confirmLabel: "Clear",
      cancelLabel: "Cancel",
    });

    if (!approved) return;

    updateDraft(selectedMatrixRow.resource.resource_code, () =>
      createEmptyDraft(selectedRoleCode, selectedMatrixRow.resource.resource_code)
    );
  }

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleSaveMatrix(),
    },
    refresh: {
      disabled: loading || catalogLoading,
      perform: () => {
        void loadPermissions();
        void loadResourceCatalog();
      },
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
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
      label: "Focus matrix search",
      keywords: ["search", "matrix", "resource"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-role-permissions-refresh",
      group: "Current Screen",
      label: loading || catalogLoading ? "Refreshing matrix..." : "Refresh matrix",
      keywords: ["refresh", "acl", "role permissions"],
      disabled: loading || catalogLoading,
      perform: () => {
        void loadPermissions();
        void loadResourceCatalog();
      },
      order: 30,
    },
    {
      id: "sa-role-permissions-save",
      group: "Current Screen",
      label: saving ? "Saving matrix..." : "Save module matrix",
      hint: "Ctrl+S",
      keywords: ["save", "matrix", "permission"],
      disabled: saving,
      perform: () => void handleSaveMatrix(),
      order: 40,
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
      label: loading || catalogLoading ? "Refreshing..." : "Refresh",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => {
        void loadPermissions();
        void loadResourceCatalog();
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save",
      label: saving ? "Saving..." : "Save Matrix",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving,
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void handleSaveMatrix(),
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
      description="Choose project and module once, then set the full page-action matrix for a role without typing manual resource codes."
      actions={topActions}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
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
          key: "project",
          label: "Project",
          value: selectedProjectCode || "All",
          tone: "emerald",
          caption: "Filter the business universe before touching the matrix.",
        },
        {
          key: "module",
          label: "Module",
          value: selectedModuleCode || "Choose",
          tone: "amber",
          caption: "Matrix works best after choosing one module.",
        },
        {
          key: "resources",
          label: "Rows",
          value: catalogLoading ? "..." : String(visibleMatrixRows.length),
          tone: "slate",
          caption: "Visible mapped resources in the current project/module filter.",
        },
      ]}
      filterSection={{
        eyebrow: "Role Filter",
        title: "Choose role, project, module, and search resources",
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

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Project
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
                  Module
                </span>
                <select
                  value={selectedModuleCode}
                  onChange={(event) => setSelectedModuleCode(event.target.value)}
                  className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
                >
                  <option value="">Choose module</option>
                  {catalogModuleOptions.map((moduleCode) => (
                    <option key={moduleCode} value={moduleCode}>
                      {moduleCode}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <QuickFilterInput
              label="Search Resources"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchInputRef}
              placeholder="Search visible resources inside the selected module"
              hint="First choose one module, then search inside that module."
            />
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Module Matrix",
        title: selectedModuleCode
          ? `${selectedModuleCode} resource permission matrix`
          : "Choose one module to open the permission matrix",
        children:
          loading || catalogLoading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading role permissions and mapped resources.
            </div>
          ) : !selectedModuleCode ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Choose one exact module after selecting the project. Then every mapped page in that module will appear as a row in the matrix.
            </div>
          ) : visibleMatrixRows.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No visible mapped business resources were found in this module.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-300 bg-white">
              <table className="min-w-full border-collapse text-sm text-slate-700">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="border-b border-slate-300 px-4 py-3 text-left">Resource</th>
                    {ACTION_MATRIX.map(([, , label]) => (
                      <th
                        key={label}
                        className="border-b border-l border-slate-300 px-3 py-3 text-center"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleMatrixRows.map(({ resource, draft }) => {
                    const selected = resource.resource_code === selectedResourceCode;

                    return (
                      <tr
                        key={resource.resource_code}
                        className={selected ? "bg-sky-50" : "bg-white"}
                      >
                        <td
                          className="border-b border-slate-200 px-4 py-3 align-top"
                          onClick={() => setSelectedResourceCode(resource.resource_code)}
                        >
                          <button
                            type="button"
                            className="w-full cursor-pointer text-left"
                          >
                            <div className="font-semibold text-slate-900">{resource.title}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              {resource.resource_code}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {resource.route_path || "No route"}
                            </div>
                            {draft.denied_actions.length > 0 ? (
                              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-rose-600">
                                Explicit deny: {draft.denied_actions.join(", ")}
                              </div>
                            ) : null}
                          </button>
                        </td>
                        {ACTION_MATRIX.map(([actionCode, key]) => (
                          <td
                            key={`${resource.resource_code}-${actionCode}`}
                            className="border-b border-l border-slate-200 px-3 py-3 text-center"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(draft[key])}
                              onChange={(event) =>
                                updateAllowFlag(
                                  resource.resource_code,
                                  key,
                                  event.target.checked,
                                  actionCode
                                )
                              }
                              className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-emerald-600"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ),
      }}
      sideSection={{
        eyebrow: "Selected Resource",
        title: selectedMatrixRow?.resource?.title ?? "Advanced deny editor",
        description:
          "Main matrix only handles allow flags. Explicit deny stays here as an advanced override for the selected resource.",
        children: selectedMatrixRow ? (
          <div className="space-y-4">
            <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <div>{selectedMatrixRow.resource.resource_code}</div>
              <div className="mt-1">
                {[selectedMatrixRow.resource.project_code, selectedMatrixRow.resource.module_code, selectedMatrixRow.resource.route_path]
                  .filter(Boolean)
                  .join(" | ")}
              </div>
            </div>

            <div className="border border-slate-300 bg-white">
              <div className="grid grid-cols-[minmax(0,1fr)_84px] border-b border-slate-300 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <span>Advanced Explicit Deny</span>
                <span className="text-center">Deny</span>
              </div>
              {ACTION_MATRIX.map(([actionCode, , label]) => (
                <div
                  key={`deny-${actionCode}`}
                  className="grid grid-cols-[minmax(0,1fr)_84px] items-center border-b border-slate-200 px-4 py-3 text-sm text-slate-700 last:border-b-0"
                >
                  <span>{label}</span>
                  <label className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={selectedMatrixRow.draft.denied_actions.includes(actionCode)}
                      onChange={(event) =>
                        updateDenyFlag(
                          selectedMatrixRow.resource.resource_code,
                          actionCode,
                          event.target.checked
                        )
                      }
                      className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-rose-600"
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleClearSelected()}
                className="border border-rose-300 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700"
              >
                Clear Selected Resource Rule
              </button>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Select one resource row from the matrix to edit advanced deny overrides.
          </div>
        ),
      }}
    />
  );
}
