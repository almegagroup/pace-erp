import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";
import {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";

const MIN_REQUIRED_APPROVERS = "1";
const MAX_ALLOWED_APPROVERS = "3";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function createDebugError(json, fallbackCode) {
  return {
    code: json?.code ?? fallbackCode,
    requestId: json?.request_id ?? null,
    gateId: json?.gate_id ?? null,
    routeKey: json?.route_key ?? null,
    decisionTrace: json?.decision_trace ?? null,
    message: json?.message ?? "Request blocked by security policy",
  };
}

function createNetworkError(error, fallbackCode) {
  return {
    code: fallbackCode,
    requestId: null,
    gateId: null,
    routeKey: null,
    decisionTrace: fallbackCode,
    message: error instanceof Error ? error.message : "Network request failed",
  };
}

async function fetchProjects() {
  let response;

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/projects`, {
      credentials: "include",
    });
  } catch (error) {
    throw createNetworkError(error, "NETWORK_ERROR_PROJECT_LIST");
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.projects)) {
    throw createDebugError(json, "PROJECT_LIST_FAILED");
  }

  return json.data.projects;
}

async function fetchModules(projectId = "") {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  let response;

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/modules${query}`, {
      credentials: "include",
    });
  } catch (error) {
    throw createNetworkError(error, "NETWORK_ERROR_MODULE_LIST");
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.modules)) {
    throw createDebugError(json, "MODULE_LIST_FAILED");
  }

  return json.data.modules;
}

async function createModule(payload) {
  let response;

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/module`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw createNetworkError(error, "NETWORK_ERROR_MODULE_CREATE");
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.module) {
    throw createDebugError(json, "MODULE_CREATE_FAILED");
  }

  return json.data.module;
}

async function updateModule(payload) {
  let response;

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/module/update`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw createNetworkError(error, "NETWORK_ERROR_MODULE_UPDATE");
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.module) {
    throw createDebugError(json, "MODULE_UPDATE_FAILED");
  }

  return json.data.module;
}

async function updateModuleState(payload) {
  let response;

  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/module/state`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw createNetworkError(error, "NETWORK_ERROR_MODULE_STATE");
  }

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw createDebugError(json, "MODULE_STATE_UPDATE_FAILED");
  }

  return json.data;
}

function sortModules(rows) {
  return [...rows].sort((left, right) => {
    const projectCompare = String(left.project_code ?? "").localeCompare(
      String(right.project_code ?? ""),
      "en",
      { sensitivity: "base" },
    );
    if (projectCompare !== 0) {
      return projectCompare;
    }

    return String(left.module_code ?? "").localeCompare(
      String(right.module_code ?? ""),
      "en",
      { sensitivity: "base" },
    );
  });
}

function formatApprovalCaption(row) {
  if (!row.approval_required) {
    return "No intrinsic approval required.";
  }

  return `${row.approval_type ?? "UNKNOWN"} | ${row.min_approvers}-${row.max_approvers} approver slot`;
}

function generateModuleCodePreview(projects, projectId, moduleName) {
  const project = projects.find((row) => row.id === projectId) ?? null;
  const normalizedName = String(moduleName ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!project?.project_code || !normalizedName) {
    return "Will auto-generate after project + module name";
  }

  return `${project.project_code}_${normalizedName}`;
}

export default function SAModuleMaster() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const projectRef = useRef(null);
  const moduleCodeRef = useRef(null);
  const searchInputRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalType, setApprovalType] = useState("SEQUENTIAL");
  const [minApprovers, setMinApprovers] = useState(MIN_REQUIRED_APPROVERS);
  const [maxApprovers, setMaxApprovers] = useState(MAX_ALLOWED_APPROVERS);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorMode, setEditorMode] = useState("create");

  const activeProjects = useMemo(
    () => projects.filter((row) => row.status === "ACTIVE"),
    [projects],
  );

  function resetEditor(preferredProjectId = selectedProjectId) {
    setEditorMode("create");
    setSelectedProjectId(preferredProjectId);
    setModuleName("");
    setApprovalRequired(false);
    setApprovalType("SEQUENTIAL");
    setMinApprovers(MIN_REQUIRED_APPROVERS);
    setMaxApprovers(MAX_ALLOWED_APPROVERS);
  }

  function loadSelectedModuleIntoEditor(moduleRow) {
    if (!moduleRow) {
      return;
    }

    setEditorMode("edit");
    setSelectedModuleId(moduleRow.module_id);
    setSelectedProjectId(moduleRow.project_id);
    setModuleName(moduleRow.module_name ?? "");
    setApprovalRequired(moduleRow.approval_required === true);
    setApprovalType(moduleRow.approval_type ?? "SEQUENTIAL");
    setMinApprovers(String(moduleRow.min_approvers ?? MIN_REQUIRED_APPROVERS));
    setMaxApprovers(String(moduleRow.max_approvers ?? MAX_ALLOWED_APPROVERS));
  }

  async function loadWorkspace(preferredProjectId = selectedProjectId, preferredModuleId = selectedModuleId) {
    setLoading(true);
    setError("");

    try {
      const [projectRows, moduleRows] = await Promise.all([
        fetchProjects(),
        fetchModules(),
      ]);

      const nextProjects = [...projectRows].sort((left, right) =>
        String(left.project_code ?? "").localeCompare(String(right.project_code ?? ""), "en", {
          sensitivity: "base",
        }),
      );
      const nextModules = sortModules(moduleRows);

      setProjects(nextProjects);
      setModules(nextModules);

      const nextProjectId =
        nextProjects.find((row) => row.id === preferredProjectId)?.id ??
        nextProjects.find((row) => row.status === "ACTIVE")?.id ??
        nextProjects[0]?.id ??
        "";
      setSelectedProjectId(nextProjectId);

      const nextModuleId =
        nextModules.find((row) => row.module_id === preferredModuleId)?.module_id ??
        nextModules[0]?.module_id ??
        "";
      setSelectedModuleId(nextModuleId);
    } catch {
      setProjects([]);
      setModules([]);
      setSelectedProjectId("");
      setSelectedModuleId("");
      setError("Module workspace could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function handleSave() {
    const normalizedProjectId = selectedProjectId.trim();
    const normalizedModuleName = moduleName.trim();

    if (!normalizedProjectId || !normalizedModuleName) {
      setError("Project and module name are required.");
      return;
    }

    const project = projects.find((row) => row.id === normalizedProjectId) ?? null;
    if (!project || project.status !== "ACTIVE") {
      setError("Choose an active project before creating a module.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Module Master",
      title: editorMode === "edit" ? "Update Module" : "Create Module",
      message:
        editorMode === "edit"
          ? `Update module ${selectedModule?.module_code ?? "selected module"} under project ${project.project_code}?`
          : `Create module ${generateModuleCodePreview(projects, normalizedProjectId, normalizedModuleName)} under project ${project.project_code}?`,
      confirmLabel: editorMode === "edit" ? "Update Module" : "Create Module",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (editorMode === "edit" && selectedModule?.module_id) {
        const updated = await updateModule({
          module_id: selectedModule.module_id,
          module_name: normalizedModuleName,
          approval_required: approvalRequired,
          approval_type: approvalRequired ? approvalType : null,
          min_approvers: Number(minApprovers),
          max_approvers: Number(maxApprovers),
        });

        await loadWorkspace(normalizedProjectId, updated.module_id);
        setNotice(`Module ${updated.module_code} updated successfully.`);
      } else {
        const created = await createModule({
          project_id: normalizedProjectId,
          module_name: normalizedModuleName,
          approval_required: approvalRequired,
          approval_type: approvalRequired ? approvalType : null,
          min_approvers: Number(minApprovers),
          max_approvers: Number(maxApprovers),
        });

        await loadWorkspace(normalizedProjectId, created.module_id);
        setNotice(`Module ${created.module_code} created under ${project.project_code}.`);
      }

      resetEditor(normalizedProjectId);
      moduleCodeRef.current?.focus();
    } catch (err) {
      const detail = err && typeof err === "object" ? err : null;
      const decisionTrace =
        typeof detail?.decisionTrace === "string" ? detail.decisionTrace : null;
      const requestId = typeof detail?.requestId === "string" ? detail.requestId : null;
      const gateId = typeof detail?.gateId === "string" ? detail.gateId : null;

      setError(
        detail
          ? `Module ${editorMode === "edit" ? "update" : "create"} blocked. ${(detail.message && String(detail.message).includes("Failed to fetch")) ? detail.code ?? "NETWORK_ERROR" : decisionTrace ?? detail.code ?? "REQUEST_BLOCKED"}${gateId ? ` | Gate ${gateId}` : ""}${requestId ? ` | Req ${requestId}` : ""}`
          : `Module could not be ${editorMode === "edit" ? "updated" : "created"} right now.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStateChange(nextState) {
    const selectedModule = modules.find((row) => row.module_id === selectedModuleId) ?? null;

    if (!selectedModule) {
      return;
    }

    const currentState = selectedModule.is_active ? "ACTIVE" : "INACTIVE";
    if (currentState === nextState) {
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Module Lifecycle",
      title: `${nextState === "ACTIVE" ? "Activate" : "Inactivate"} Module`,
      message: `${nextState === "ACTIVE" ? "Activate" : "Inactivate"} ${selectedModule.module_code} under ${selectedModule.project_code}?`,
      confirmLabel: nextState === "ACTIVE" ? "Activate" : "Inactivate",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await updateModuleState({
        module_id: selectedModule.module_id,
        next_state: nextState,
      });
      await loadWorkspace(selectedProjectId, selectedModule.module_id);
      setNotice(`Module ${selectedModule.module_code} is now ${nextState}.`);
    } catch (err) {
      const detail = err && typeof err === "object" ? err : null;
      setError(
        detail
          ? `Module state blocked. ${detail.decisionTrace ?? detail.code ?? "REQUEST_BLOCKED"}`
          : "Module state could not be updated right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  const filteredModules = useMemo(
    () =>
      applyQuickFilter(modules, searchQuery, [
        "module_code",
        "module_name",
        "project_code",
        "project_name",
        "approval_type",
        "module_active",
      ]),
    [modules, searchQuery],
  );

  const selectedModule =
    modules.find((row) => row.module_id === selectedModuleId) ??
    filteredModules[0] ??
    null;

  useEffect(() => {
    if (!filteredModules.some((row) => row.module_id === selectedModuleId)) {
      setSelectedModuleId(filteredModules[0]?.module_id ?? "");
    }
  }, [filteredModules, selectedModuleId]);

  const modulePagination = useErpPagination(filteredModules, 10);
  const { getRowProps } = useErpListNavigation(modulePagination.pageItems);

  useErpDenseFormNavigation(formContainerRef, {
    disabled: saving,
    submitOnFinalField: true,
    onSubmit: () => handleSave(),
  });

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleSave(),
    },
    refresh: {
      disabled: loading,
      perform: () => void loadWorkspace(selectedProjectId, selectedModuleId),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => projectRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-module-master-control-panel",
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
      id: "sa-module-master-company-map",
      group: "Current Screen",
      label: "Open company module map",
      keywords: ["company module map", "module rollout"],
      perform: () => {
        openScreen("SA_COMPANY_MODULE_MAP", { mode: "replace" });
        navigate("/sa/acl/company-modules");
      },
      order: 20,
    },
    {
      id: "sa-module-master-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing modules..." : "Refresh modules",
      keywords: ["refresh", "module master"],
      disabled: loading,
      perform: () => void loadWorkspace(selectedProjectId, selectedModuleId),
      order: 30,
    },
    {
      id: "sa-module-master-save",
      group: "Current Screen",
      label: saving
        ? editorMode === "edit"
          ? "Updating module..."
          : "Creating module..."
        : editorMode === "edit"
          ? "Update module"
          : "Create module",
      hint: "Ctrl+S",
      keywords: ["create", "update", "module", "project"],
      disabled: saving,
      perform: () => void handleSave(),
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
      key: "company-module-map",
      label: "Company Module Map",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => {
        openScreen("SA_COMPANY_MODULE_MAP", { mode: "replace" });
        navigate("/sa/acl/company-modules");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "page-registry",
      label: "Page Registry",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => {
        openScreen("SA_PAGE_RESOURCE_REGISTRY", { mode: "replace" });
        navigate("/sa/page-registry");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "module-page-map",
      label: "Module Page Map",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[3] = element;
      },
      onClick: () => {
        openScreen("SA_MODULE_RESOURCE_MAP", { mode: "replace" });
        navigate("/sa/module-pages");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 3,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh",
      label: loading ? "Refreshing..." : "Refresh Modules",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[4] = element;
      },
      onClick: () => void loadWorkspace(selectedProjectId, selectedModuleId),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 4,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create",
      label: saving
        ? editorMode === "edit"
          ? "Updating..."
          : "Creating..."
        : editorMode === "edit"
          ? "Update Module"
          : "Create Module",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving,
      buttonRef: (element) => {
        actionBarRefs.current[5] = element;
      },
      onClick: () => void handleSave(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 5,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  return (
    <ErpEntryFormTemplate
      eyebrow="Module Master"
      title="Module Master Manage"
      actions={topActions}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow={editorMode === "edit" ? "Edit" : "Create"}
      formTitle={editorMode === "edit" ? "Edit selected module" : "Create a new project module"}
      formContent={
        <div ref={formContainerRef} className="grid gap-3">
          <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Project
            </span>
            <select
              ref={projectRef}
              data-workspace-primary-focus="true"
              data-erp-form-field="true"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              disabled={editorMode === "edit"}
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
            >
              <option value="">Choose active project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_code} | {project.project_name} | {project.status}
                </option>
              ))}
            </select>
          </label>

            <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Module Name
              </span>
              <input
                ref={moduleCodeRef}
                data-erp-form-field="true"
                type="text"
                value={moduleName}
                onChange={(event) => setModuleName(event.target.value)}
                placeholder="Procurement"
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
              />
            </label>

            <label className="grid gap-2 border border-slate-300 bg-slate-50 px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {editorMode === "edit" ? "Locked Module Code" : "Auto Module Code"}
              </span>
              <input
                type="text"
                readOnly
                value={
                  editorMode === "edit" && selectedModule
                    ? selectedModule.module_code
                    : generateModuleCodePreview(projects, selectedProjectId, moduleName)
                }
                className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
              />
            </label>
          </div>

          {editorMode === "edit" ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => resetEditor(selectedProjectId)}
                className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Switch To Create
              </button>
            </div>
          ) : null}

          <label className="flex items-center gap-3 border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
            <input
              data-erp-form-field="true"
              type="checkbox"
              checked={approvalRequired}
              onChange={(event) => setApprovalRequired(event.target.checked)}
              className="h-4 w-4 border border-slate-300"
            />
            This module needs intrinsic approval policy
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Approval Type
              </span>
              <select
                data-erp-form-field="true"
                value={approvalType}
                onChange={(event) => setApprovalType(event.target.value)}
                disabled={!approvalRequired}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition disabled:bg-slate-100 focus:border-sky-500 focus:bg-white"
              >
                <option value="ANYONE">ANYONE</option>
                <option value="SEQUENTIAL">SEQUENTIAL</option>
                <option value="MUST_ALL">MUST_ALL</option>
              </select>
            </label>

            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Min Approvers
              </span>
              <select
                data-erp-form-field="true"
                value={minApprovers}
                onChange={(event) => setMinApprovers(event.target.value)}
                disabled={!approvalRequired}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition disabled:bg-slate-100 focus:border-sky-500 focus:bg-white"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </label>

            <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Max Approvers
              </span>
              <select
                data-erp-form-field="true"
                value={maxApprovers}
                onChange={(event) => setMaxApprovers(event.target.value)}
                disabled={!approvalRequired}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition disabled:bg-slate-100 focus:border-sky-500 focus:bg-white"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </label>
          </div>
        </div>
      }
      bottomContent={
        <ErpSectionCard
          eyebrow="Module Inventory"
          title={
            loading
              ? "Loading module rows"
              : `${filteredModules.length} visible module${filteredModules.length === 1 ? "" : "s"}`
          }
        >
          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading module rows.
            </div>
          ) : filteredModules.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No module matches the current filter.
            </div>
          ) : (
            <div className="space-y-0 border border-slate-300">
              <ErpPaginationStrip
                page={modulePagination.page}
                setPage={modulePagination.setPage}
                totalPages={modulePagination.totalPages}
                startIndex={modulePagination.startIndex}
                endIndex={modulePagination.endIndex}
                totalItems={filteredModules.length}
              />
              {modulePagination.pageItems.map((row, index) => (
                <button
                  key={row.module_id}
                  {...getRowProps(index)}
                  type="button"
                  onClick={() => setSelectedModuleId(row.module_id)}
                  className={`w-full border-b border-slate-300 px-4 py-3 text-left text-sm transition last:border-b-0 ${
                    row.module_id === selectedModuleId
                      ? "bg-sky-50 text-slate-900"
                      : "bg-white text-slate-700"
                  }`}
                >
                  <span className="block font-semibold">
                    {row.module_code} - {row.module_name}
                  </span>
                  <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                    {row.project_code} | {row.is_active ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatApprovalCaption(row)} | {row.mapped_company_count ?? 0} company mapped
                  </span>
                  <span className="mt-2 block text-[10px] uppercase tracking-[0.14em] text-cyan-700">
                    Open the selected preview pane to edit this module.
                  </span>
                </button>
              ))}
            </div>
          )}
        </ErpSectionCard>
      }
    />
  );
}
