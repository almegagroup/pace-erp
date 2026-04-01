import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";
import {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";

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

async function fetchProjects() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/projects`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.projects)) {
    throw createDebugError(json, "PROJECT_LIST_FAILED");
  }

  return json.data.projects;
}

async function fetchModules(projectId = "") {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/modules${query}`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.modules)) {
    throw createDebugError(json, "MODULE_LIST_FAILED");
  }

  return json.data.modules;
}

async function createModule(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/module`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.module) {
    throw createDebugError(json, "MODULE_CREATE_FAILED");
  }

  return json.data.module;
}

async function updateModuleState(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/module/state`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
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
  const rowRefs = useRef([]);
  const [projects, setProjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalType, setApprovalType] = useState("SEQUENTIAL");
  const [minApprovers, setMinApprovers] = useState("1");
  const [maxApprovers, setMaxApprovers] = useState("3");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeProjects = useMemo(
    () => projects.filter((row) => row.status === "ACTIVE"),
    [projects],
  );

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

  async function handleCreate() {
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
      title: "Create Module",
      message: `Create module ${generateModuleCodePreview(projects, normalizedProjectId, normalizedModuleName)} under project ${project.project_code}?`,
      confirmLabel: "Create Module",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const created = await createModule({
        project_id: normalizedProjectId,
        module_name: normalizedModuleName,
        approval_required: approvalRequired,
        approval_type: approvalRequired ? approvalType : null,
        min_approvers: Number(minApprovers),
        max_approvers: Number(maxApprovers),
      });

      await loadWorkspace(normalizedProjectId, created.module_id);
      setModuleName("");
      setApprovalRequired(false);
      setApprovalType("SEQUENTIAL");
      setMinApprovers("1");
      setMaxApprovers("3");
      setNotice(`Module ${created.module_code} created under ${project.project_code}.`);
      moduleCodeRef.current?.focus();
    } catch (err) {
      const detail = err && typeof err === "object" ? err : null;
      const decisionTrace =
        typeof detail?.decisionTrace === "string" ? detail.decisionTrace : null;
      const requestId = typeof detail?.requestId === "string" ? detail.requestId : null;
      const gateId = typeof detail?.gateId === "string" ? detail.gateId : null;

      setError(
        detail
          ? `Module create blocked. ${decisionTrace ?? detail.code ?? "REQUEST_BLOCKED"}${gateId ? ` | Gate ${gateId}` : ""}${requestId ? ` | Req ${requestId}` : ""}`
          : "Module could not be created right now.",
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

  useErpDenseFormNavigation(formContainerRef, {
    disabled: saving,
    submitOnFinalField: true,
    onSubmit: () => handleCreate(),
  });

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleCreate(),
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
      label: saving ? "Creating module..." : "Create module",
      hint: "Ctrl+S",
      keywords: ["create", "module", "project"],
      disabled: saving,
      perform: () => void handleCreate(),
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
      key: "refresh",
      label: loading ? "Refreshing..." : "Refresh Modules",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void loadWorkspace(selectedProjectId, selectedModuleId),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create",
      label: saving ? "Creating..." : "Create Module",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving,
      buttonRef: (element) => {
        actionBarRefs.current[3] = element;
      },
      onClick: () => void handleCreate(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 3,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  return (
    <ErpEntryFormTemplate
      eyebrow="Module Master"
      title="Module Master Manage"
      description="Create project-bound global modules here. Company rollout happens later from the dedicated company module map surface."
      actions={topActions}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      metrics={[
        {
          key: "projects",
          label: "Active Projects",
          value: loading ? "..." : String(activeProjects.length),
          tone: "sky",
          caption: "Only active projects should receive new modules.",
        },
        {
          key: "modules",
          label: "Modules",
          value: loading ? "..." : String(modules.length),
          tone: "emerald",
          caption: "Global module rows currently registered under reusable projects.",
        },
        {
          key: "approval",
          label: "Approval Required",
          value: loading ? "..." : String(modules.filter((row) => row.approval_required).length),
          tone: "amber",
          caption: "Modules carrying intrinsic approval policy at the registry layer.",
        },
        {
          key: "mapped-companies",
          label: "Selected Rollout",
          value: selectedModule ? String(selectedModule.mapped_company_count ?? 0) : "0",
          tone: "slate",
          caption: selectedModule
            ? "Companies currently using the selected module."
            : "Select a module to inspect rollout count.",
        },
      ]}
      formEyebrow="Create"
      formTitle="Create a new project module"
      formDescription="Each module belongs to one project. Companies can only receive this module after the project itself has been mapped to them."
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
                Auto Module Code
              </span>
              <input
                type="text"
                readOnly
                value={generateModuleCodePreview(projects, selectedProjectId, moduleName)}
                className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
              />
            </label>
          </div>

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
      sideContent={
        <>
          <ErpSectionCard
            eyebrow="Search"
            title="Module quick filter"
            description="Filter the registered module inventory without leaving the create form."
          >
            <QuickFilterInput
              label="Find Module"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchInputRef}
              placeholder="Filter by module code, module name, or project"
              hint="Alt+Shift+F focuses this filter."
            />
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Selected"
            title="Module preview"
            description="Use this read model to confirm intrinsic approval law before rolling the module out to companies."
          >
            <div className="grid gap-3">
              <ErpFieldPreview
                label="Module"
                value={
                  selectedModule
                    ? `${selectedModule.module_code} | ${selectedModule.module_name}`
                    : "No module selected"
                }
                caption={
                  selectedModule
                    ? `${selectedModule.project_code} | ${selectedModule.project_name}`
                    : "Select a module from the inventory."
                }
                tone={selectedModule ? "success" : "default"}
              />
              <ErpFieldPreview
                label="Approval"
                value={
                  selectedModule
                    ? selectedModule.approval_required
                      ? "Required"
                      : "Not required"
                    : "N/A"
                }
                caption={selectedModule ? formatApprovalCaption(selectedModule) : "No module selected."}
              />
              <ErpFieldPreview
                label="Mapped Companies"
                value={selectedModule ? String(selectedModule.mapped_company_count ?? 0) : "0"}
                caption="Rollout count across company-module map."
              />
              {selectedModule ? (
                <div className="flex flex-wrap gap-3">
                  {selectedModule.is_active ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleStateChange("INACTIVE")}
                      className="border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700"
                    >
                      Inactivate Module
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleStateChange("ACTIVE")}
                      className="border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700"
                    >
                      Activate Module
                    </button>
                  )}

                  <button
                    type="button"
                    className="border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-700"
                    onClick={() => {
                      openScreen("SA_COMPANY_MODULE_MAP", { mode: "replace" });
                      navigate("/sa/acl/company-modules");
                    }}
                  >
                    Open Company Module Map
                  </button>
                </div>
              ) : null}
            </div>
          </ErpSectionCard>
        </>
      }
      bottomContent={
        <ErpSectionCard
          eyebrow="Module Inventory"
          title={
            loading
              ? "Loading module rows"
              : `${filteredModules.length} visible module${filteredModules.length === 1 ? "" : "s"}`
          }
          description="Modules stay global under a project. Company-level operational rollout happens separately."
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
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={() => setSelectedModuleId(row.module_id)}
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: rowRefs.current,
                      orientation: "vertical",
                    })
                  }
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
                </button>
              ))}
            </div>
          )}
        </ErpSectionCard>
      }
    />
  );
}
