import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  formatCompanyAddress,
  formatCompanyLabel,
  formatCompanyOptionLabel,
} from "../../../shared/companyDisplay.js";

function normalize(value) {
  return String(value ?? "").trim();
}

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchApi(path, options = {}) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "REQUEST_FAILED");
  }

  return json.data ?? {};
}

async function fetchCompanies() {
  const data = await fetchApi("/api/admin/companies");
  return Array.isArray(data.companies) ? data.companies : [];
}

async function fetchDepartments(companyId) {
  const data = await fetchApi(
    `/api/admin/departments?company_id=${encodeURIComponent(companyId)}`
  );
  return Array.isArray(data.departments) ? data.departments : [];
}

async function fetchWorkContexts(companyId) {
  const data = await fetchApi(
    `/api/admin/acl/work-contexts?company_id=${encodeURIComponent(companyId)}`
  );
  return Array.isArray(data.work_contexts) ? data.work_contexts : [];
}

async function fetchWorkContextCapabilities(workContextId) {
  const data = await fetchApi(
    `/api/admin/acl/work-context-capabilities?work_context_id=${encodeURIComponent(workContextId)}`
  );
  return Array.isArray(data.capabilities) ? data.capabilities : [];
}

async function fetchWorkContextProjects(workContextId) {
  const data = await fetchApi(
    `/api/admin/acl/work-context-projects?work_context_id=${encodeURIComponent(workContextId)}`
  );
  return {
    workContext: data.work_context ?? null,
    projects: Array.isArray(data.projects) ? data.projects : [],
  };
}

async function saveWorkContextProjects(payload) {
  const data = await fetchApi("/api/admin/acl/work-context-projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return Array.isArray(data.project_ids) ? data.project_ids : [];
}

async function saveWorkContext(payload) {
  const data = await fetchApi("/api/admin/acl/work-contexts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!data.work_context) {
    throw new Error("WORK_CONTEXT_UPSERT_FAILED");
  }

  return data.work_context;
}

function sortCompanies(rows) {
  return [...rows]
    .filter((row) => row.company_kind === "BUSINESS")
    .sort((left, right) =>
      `${left.company_code ?? ""} ${left.company_name ?? ""}`.localeCompare(
        `${right.company_code ?? ""} ${right.company_name ?? ""}`,
        "en",
        {
          numeric: true,
          sensitivity: "base",
        }
      )
    );
}

function sortDepartments(rows) {
  return [...rows].sort((left, right) =>
    `${left.department_code ?? ""} ${left.department_name ?? ""}`.localeCompare(
      `${right.department_code ?? ""} ${right.department_name ?? ""}`,
      "en",
      {
        numeric: true,
        sensitivity: "base",
      }
    )
  );
}

function sortWorkContexts(rows) {
  return [...rows].sort((left, right) =>
    `${left.work_context_code ?? ""} ${left.work_context_name ?? ""}`.localeCompare(
      `${right.work_context_code ?? ""} ${right.work_context_name ?? ""}`,
      "en",
      {
        numeric: true,
        sensitivity: "base",
      }
    )
  );
}

function emptyDraft() {
  return {
    work_context_code: "",
    work_context_name: "",
    description: "",
    department_id: "",
    is_active: true,
  };
}

function buildEditDraft(context) {
  return {
    work_context_code: context?.work_context_code ?? "",
    work_context_name: context?.work_context_name ?? "",
    description: context?.description ?? "",
    department_id: context?.department_id ?? "",
    is_active: context?.is_active !== false,
  };
}

export default function SAWorkContextMaster() {
  const navigate = useNavigate();
  const topActionRefs = useRef([]);
  const companySelectRef = useRef(null);
  const searchRef = useRef(null);
  const drawerPrimaryRef = useRef(null);
  const lastLoadedCompanyIdRef = useRef("");
  const selectedCompanyIdRef = useRef("");
  const selectedContextIdRef = useRef("");

  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [workContexts, setWorkContexts] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedContextId, setSelectedContextId] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create");
  const [formDraft, setFormDraft] = useState(() => emptyDraft());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [linkedCapabilities, setLinkedCapabilities] = useState([]);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [projectDrawerLoading, setProjectDrawerLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [attachedProjectIds, setAttachedProjectIds] = useState([]);
  const [availableProjects, setAvailableProjects] = useState([]);
  const projectSearchRef = useRef(null);
  const projectCheckboxRefs = useRef([]);

  const selectedCompany = useMemo(
    () => companies.find((row) => row.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );

  const selectedContext = useMemo(
    () =>
      workContexts.find((row) => row.work_context_id === selectedContextId) ?? null,
    [selectedContextId, workContexts]
  );

  useEffect(() => {
    selectedCompanyIdRef.current = selectedCompanyId;
  }, [selectedCompanyId]);

  useEffect(() => {
    selectedContextIdRef.current = selectedContextId;
  }, [selectedContextId]);

  const loadCompanyWorkspace = useCallback(
    async (companyId, preferredContextId = "") => {
      if (!normalize(companyId)) {
        setDepartments([]);
        setWorkContexts([]);
        setSelectedContextId("");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [departmentRows, workContextRows] = await Promise.all([
          fetchDepartments(companyId),
          fetchWorkContexts(companyId),
        ]);

        const nextDepartments = sortDepartments(
          departmentRows.filter((row) => row.status === "ACTIVE")
        );
        const nextContexts = sortWorkContexts(workContextRows);

        setDepartments(nextDepartments);
        setWorkContexts(nextContexts);
        lastLoadedCompanyIdRef.current = companyId;
        setSelectedContextId(
          normalize(preferredContextId) ||
            normalize(selectedContextIdRef.current) ||
            nextContexts[0]?.work_context_id ||
            ""
        );
      } catch {
        setDepartments([]);
        setWorkContexts([]);
        setSelectedContextId("");
        setError("Work context inventory could not be loaded for the selected company.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const nextCompanies = sortCompanies(await fetchCompanies());
      const resolvedCompanyId =
        normalize(selectedCompanyIdRef.current) || nextCompanies[0]?.id || "";

      setCompanies(nextCompanies);
      setSelectedCompanyId(resolvedCompanyId);

      if (!resolvedCompanyId) {
        setDepartments([]);
        setWorkContexts([]);
        setSelectedContextId("");
        return;
      }

      await loadCompanyWorkspace(resolvedCompanyId);
    } catch {
      setError("Work context master foundation could not load right now.");
      setLoading(false);
    }
  }, [loadCompanyWorkspace]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!normalize(selectedCompanyId)) {
      return;
    }

    const exists = companies.some((row) => row.id === selectedCompanyId);

    if (!exists || lastLoadedCompanyIdRef.current === selectedCompanyId) {
      return;
    }

    void loadCompanyWorkspace(selectedCompanyId);
  }, [companies, loadCompanyWorkspace, selectedCompanyId]);

  useEffect(() => {
    if (!inspectorOpen || !selectedContextId) {
      return;
    }

    let active = true;

    async function loadInspectorData() {
      setInspectorLoading(true);

      try {
        const capabilities = await fetchWorkContextCapabilities(selectedContextId);

        if (!active) {
          return;
        }

        setLinkedCapabilities(capabilities);
      } catch {
        if (!active) {
          return;
        }

        setLinkedCapabilities([]);
        setError("Linked screen packs could not be loaded for the selected work scope.");
      } finally {
        if (active) {
          setInspectorLoading(false);
        }
      }
    }

    void loadInspectorData();

    return () => {
      active = false;
    };
  }, [inspectorOpen, selectedContextId]);

  const filteredContexts = useMemo(() => {
    const needle = normalize(search).toLowerCase();

    return workContexts.filter((row) => {
      if (typeFilter === "SYSTEM" && row.is_system !== true) {
        return false;
      }

      if (typeFilter === "MANUAL" && row.is_system === true) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return [
        row.work_context_code,
        row.work_context_name,
        row.description,
        row.department_code,
        row.department_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [search, typeFilter, workContexts]);

  const { getRowProps } = useErpListNavigation(filteredContexts, {
    onActivate: (row) => setSelectedContextId(row?.work_context_id ?? ""),
  });

  const notices = [
    error ? { tone: "error", message: error } : null,
    notice ? { tone: "success", message: notice } : null,
  ].filter(Boolean);

  function closeEditor() {
    setEditorOpen(false);
    setEditorMode("create");
    setFormDraft(emptyDraft());
  }

  function closeInspector() {
    setInspectorOpen(false);
    setLinkedCapabilities([]);
  }

  function closeProjectDrawer() {
    setProjectDrawerOpen(false);
    setProjectSearch("");
    setAttachedProjectIds([]);
    setAvailableProjects([]);
  }

  function openCreateDrawer() {
    if (!selectedCompanyId) {
      setError("Choose a company before creating a manual work scope.");
      return;
    }

    setEditorMode("create");
    setFormDraft(emptyDraft());
    setEditorOpen(true);
    setError("");
  }

  function openEditDrawer(context) {
    if (!context || context.is_system === true) {
      setError("System work scopes stay locked to company or department foundations.");
      return;
    }

    setSelectedContextId(context.work_context_id);
    setEditorMode("edit");
    setFormDraft(buildEditDraft(context));
    setEditorOpen(true);
    setError("");
  }

  function openInspector(context) {
    if (!context) {
      return;
    }

    setSelectedContextId(context.work_context_id);
    setLinkedCapabilities([]);
    setInspectorOpen(true);
    setError("");
  }

  async function openProjectDrawer(context) {
    if (!context) {
      return;
    }

    setSelectedContextId(context.work_context_id);
    setProjectDrawerOpen(true);
    setProjectDrawerLoading(true);
    setProjectSearch("");
    setAttachedProjectIds([]);
    setAvailableProjects([]);
    setError("");

    try {
      const data = await fetchWorkContextProjects(context.work_context_id);
      const projects = data.projects ?? [];
      setAvailableProjects(projects);
      setAttachedProjectIds(
        projects.filter((project) => project.attached === true).map((project) => project.id),
      );
    } catch {
      setError("Project reach could not be loaded for the selected work scope.");
      setProjectDrawerOpen(false);
    } finally {
      setProjectDrawerLoading(false);
    }
  }

  async function handleSaveProjects() {
    if (!selectedContextId) {
      setError("Choose a work scope before saving inherited projects.");
      return;
    }

    setProjectDrawerLoading(true);
    setError("");
    setNotice("");

    try {
      const savedProjectIds = await saveWorkContextProjects({
        work_context_id: selectedContextId,
        project_ids: attachedProjectIds,
      });

      setAttachedProjectIds(savedProjectIds);
      closeProjectDrawer();
      setNotice(
        `Inherited project reach for ${selectedContext?.work_context_code ?? "the selected work scope"} is updated.`,
      );
    } catch {
      setError("Inherited project reach could not be saved right now.");
    } finally {
      setProjectDrawerLoading(false);
    }
  }

  const filteredProjects = useMemo(() => {
    const needle = normalize(projectSearch).toLowerCase();

    return availableProjects.filter((project) => {
      if (!needle) {
        return true;
      }

      return [project.project_code, project.project_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [availableProjects, projectSearch]);

  async function handleSaveContext() {
    const normalizedCode = normalize(formDraft.work_context_code).toUpperCase();
    const normalizedName = normalize(formDraft.work_context_name);

    if (!selectedCompanyId || !normalizedCode || !normalizedName) {
      setError("Company, work-scope code, and work-scope name are required.");
      return;
    }

    if (editorMode === "edit" && selectedContext?.is_system === true) {
      setError("System work scopes stay immutable in this screen.");
      return;
    }

    if (editorMode === "edit" && formDraft.is_active === false) {
      const approved = await openActionConfirm({
        eyebrow: "Work Context Master",
        title: "Inactivate Manual Work Scope",
        message: `Inactivate ${normalizedCode}? Users will lose this manual work-scope option until it is activated again.`,
        confirmLabel: "Inactivate",
        cancelLabel: "Cancel",
      });

      if (!approved) {
        return;
      }
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const saved = await saveWorkContext({
        company_id: selectedCompanyId,
        work_context_code: normalizedCode,
        work_context_name: normalizedName,
        description: normalize(formDraft.description) || null,
        department_id: normalize(formDraft.department_id) || null,
        is_active: formDraft.is_active !== false,
      });

      await loadCompanyWorkspace(selectedCompanyId, saved.work_context_id);
      closeEditor();
      setNotice(
        `Manual work scope ${saved.work_context_code} is ready for capability wiring and user-scope assignment.`
      );
    } catch (saveError) {
      setError(
        saveError?.message === "WORK_CONTEXT_CODE_RESERVED"
          ? "GENERAL_OPS and DEPT_* codes stay reserved for system foundations."
          : "Work context could not be saved right now."
      );
    } finally {
      setSaving(false);
    }
  }

  useErpScreenCommands([
    {
      id: "sa-work-context-master-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing work-scope inventory..." : "Refresh work-scope inventory",
      keywords: ["refresh", "work context", "work scope", "inventory"],
      disabled: loading,
      perform: () => void loadCompanyWorkspace(selectedCompanyId, selectedContextId),
      order: 10,
    },
    {
      id: "sa-work-context-master-focus-company",
      group: "Current Screen",
      label: "Focus company selector",
      keywords: ["company", "selector", "work scope"],
      perform: () => companySelectRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-work-context-master-focus-search",
      group: "Current Screen",
      label: "Focus work-scope search",
      keywords: ["search", "filter", "work scope"],
      perform: () => searchRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-work-context-master-create",
      group: "Current Screen",
      label: "Create manual work scope",
      keywords: ["create", "manual", "work context", "work scope"],
      perform: openCreateDrawer,
      order: 40,
    },
    {
      id: "sa-work-context-master-department",
      group: "Current Screen",
      label: "Open department master",
      keywords: ["department", "team foundation"],
      perform: () => {
        openScreen("SA_DEPARTMENT_MASTER", { mode: "replace" });
        navigate("/sa/department-master");
      },
      order: 50,
    },
    {
      id: "sa-work-context-master-capability",
      group: "Current Screen",
      label: "Open capability governance",
      keywords: ["capability", "screen pack", "work scope"],
      perform: () => {
        openScreen("SA_CAPABILITY_GOVERNANCE", { mode: "replace" });
        navigate("/sa/acl/capabilities");
      },
      order: 60,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadCompanyWorkspace(selectedCompanyId, selectedContextId),
    },
    focusPrimary: {
      perform: openCreateDrawer,
    },
    focusSearch: {
      perform: () => searchRef.current?.focus(),
    },
  });

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Work Scope Foundation"
        title="Work Context Master"
        notices={notices}
        actions={[
          {
            key: "create",
            label: "Create Manual Scope",
            tone: "primary",
            buttonRef: (element) => {
              topActionRefs.current[0] = element;
            },
            onClick: openCreateDrawer,
            onKeyDown: (event) =>
              handleLinearNavigation(event, {
                index: 0,
                refs: topActionRefs.current,
                orientation: "horizontal",
              }),
          },
          {
            key: "department-master",
            label: "Department Master",
            tone: "neutral",
            buttonRef: (element) => {
              topActionRefs.current[1] = element;
            },
            onClick: () => {
              openScreen("SA_DEPARTMENT_MASTER", { mode: "replace" });
              navigate("/sa/department-master");
            },
            onKeyDown: (event) =>
              handleLinearNavigation(event, {
                index: 1,
                refs: topActionRefs.current,
                orientation: "horizontal",
              }),
          },
          {
            key: "capability-governance",
            label: "Capability Governance",
            tone: "neutral",
            buttonRef: (element) => {
              topActionRefs.current[2] = element;
            },
            onClick: () => {
              openScreen("SA_CAPABILITY_GOVERNANCE", { mode: "replace" });
              navigate("/sa/acl/capabilities");
            },
            onKeyDown: (event) =>
              handleLinearNavigation(event, {
                index: 2,
                refs: topActionRefs.current,
                orientation: "horizontal",
              }),
          },
          {
            key: "refresh",
            label: loading ? "Refreshing..." : "Refresh",
            tone: "neutral",
            buttonRef: (element) => {
              topActionRefs.current[3] = element;
            },
            onClick: () => void loadCompanyWorkspace(selectedCompanyId, selectedContextId),
            onKeyDown: (event) =>
              handleLinearNavigation(event, {
                index: 3,
                refs: topActionRefs.current,
                orientation: "horizontal",
              }),
          },
        ]}
        footerHints={["Arrow Keys Navigate", "Enter Select", "Ctrl+S Save", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <div className="grid gap-3">
            <section className="grid gap-2 border-b border-slate-300 pb-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Company Scope
              </div>
              <div className="text-sm font-semibold text-slate-900">Select Company</div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px]">
                <label className="grid gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Company
                  </span>
                  <select
                    ref={companySelectRef}
                    value={selectedCompanyId}
                    onChange={(event) => setSelectedCompanyId(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                  >
                    <option value="">Select company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {formatCompanyOptionLabel(company)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Type
                  </span>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                  >
                    <option value="ALL">All</option>
                    <option value="SYSTEM">System only</option>
                    <option value="MANUAL">Manual only</option>
                  </select>
                </label>

                <QuickFilterInput
                  label="Search"
                  value={search}
                  onChange={setSearch}
                  inputRef={searchRef}
                  placeholder="Search code, name, or department"
                  hint="Keep the table readable. Deep inspection and editing stay in drawers."
                  className="md:col-span-2"
                />
              </div>
            </section>

            <section className="grid gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Inventory
              </div>
              <div className="text-sm font-semibold text-slate-900">Work Scope Register</div>
              <div className="overflow-x-auto border border-slate-300 bg-white">
                {loading ? (
                  <div className="px-4 py-6 text-sm text-slate-500">
                    Loading work-scope inventory...
                  </div>
                ) : filteredContexts.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">
                    No work scope matched the current company and filter selection.
                  </div>
                ) : (
                  <ErpDenseGrid
                    columns={[
                      {
                        key: "code",
                        label: "Code",
                        render: (context) => (
                          <button
                            type="button"
                            onClick={() => setSelectedContextId(context.work_context_id)}
                            className="w-full text-left"
                          >
                            <div className="font-semibold text-slate-900">
                              {context.work_context_code}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {context.description || "No description saved yet."}
                            </div>
                          </button>
                        ),
                      },
                      {
                        key: "name",
                        label: "Name",
                        render: (context) => (
                          <div className="font-semibold text-slate-900">
                            {context.work_context_name}
                          </div>
                        ),
                      },
                      {
                        key: "type",
                        label: "Type",
                        render: (context) => {
                          const isSystem = context.is_system === true;
                          return (
                            <span
                              className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                isSystem
                                  ? "border-amber-300 bg-amber-50 text-amber-800"
                                  : "border-emerald-300 bg-emerald-50 text-emerald-800"
                              }`}
                            >
                              {isSystem ? "System" : "Manual"}
                            </span>
                          );
                        },
                      },
                      {
                        key: "department",
                        label: "Department",
                        render: (context) =>
                          context.department_code
                            ? `${context.department_code} | ${context.department_name ?? ""}`
                            : "Company-wide / no team link",
                      },
                      {
                        key: "state",
                        label: "State",
                        render: (context) => (
                          <span
                            className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                              context.is_active
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                : "border-rose-300 bg-rose-50 text-rose-700"
                            }`}
                          >
                            {context.is_active ? "Active" : "Inactive"}
                          </span>
                        ),
                      },
                      {
                        key: "actions",
                        label: "Actions",
                        render: (context) => {
                          const isSystem = context.is_system === true;
                          return (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openInspector(context)}
                                className="border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700"
                              >
                                Inspect
                              </button>
                              <button
                                type="button"
                                disabled={isSystem}
                                onClick={() => openEditDrawer(context)}
                                className={`border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                  isSystem
                                    ? "border-slate-200 bg-slate-100 text-slate-400"
                                    : "border-sky-300 bg-sky-50 text-sky-800"
                                }`}
                              >
                                {isSystem ? "Locked" : "Edit"}
                              </button>
                            </div>
                          );
                        },
                      },
                    ]}
                    rows={filteredContexts}
                    rowKey={(context) => context.work_context_id}
                    getRowProps={(context, index) => ({
                      ...getRowProps(index),
                      onClick: () => setSelectedContextId(context.work_context_id),
                      className:
                        context.work_context_id === selectedContextId ? "bg-sky-50" : "",
                    })}
                    onRowActivate={(context) => setSelectedContextId(context.work_context_id)}
                    maxHeight="none"
                  />
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-3">
            <section className="grid gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Selected Scope
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {selectedContext
                  ? `${selectedContext.work_context_code} | ${selectedContext.work_context_name}`
                  : "Choose A Work Scope"}
              </div>
              {selectedContext ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      {
                        label: "Scope Type",
                        value: selectedContext.is_system ? "SYSTEM" : "MANUAL",
                        caption: selectedContext.is_system
                          ? "Derived from company or department foundation."
                          : "Created manually for exact business slices.",
                      },
                      {
                        label: "Department Link",
                        value: selectedContext.department_code
                          ? `${selectedContext.department_code} | ${selectedContext.department_name ?? ""}`
                          : "No department link",
                        caption:
                          "Optional for manual scopes. Useful when one runtime slice still belongs to one team.",
                      },
                      {
                        label: "Lifecycle",
                        value: selectedContext.is_active ? "ACTIVE" : "INACTIVE",
                        caption:
                          "Inactive manual scopes stay out of new user assignments until re-enabled.",
                      },
                      {
                        label: "Foundation",
                        value: formatCompanyLabel(selectedCompany),
                        caption: formatCompanyAddress(selectedCompany),
                      },
                    ].map((item) => (
                      <div key={item.label} className="border border-slate-300 bg-slate-50 px-3 py-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {item.label}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{item.value}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.caption}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openInspector(selectedContext)}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Inspect Scope
                    </button>
                    <button
                      type="button"
                      disabled={selectedContext.is_system === true}
                      onClick={() => openEditDrawer(selectedContext)}
                      className={`border px-3 py-2 text-sm font-semibold ${
                        selectedContext.is_system
                          ? "border-slate-200 bg-slate-100 text-slate-400"
                          : "border-sky-300 bg-sky-50 text-sky-800"
                      }`}
                    >
                      {selectedContext.is_system ? "System Locked" : "Edit Manual Scope"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openProjectDrawer(selectedContext)}
                      className="border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800"
                    >
                      Manage Inherited Projects
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Pick a row from the register to inspect one work scope at a time.
                </p>
              )}
            </section>

            <section className="grid gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                Operating Rule
              </div>
              <div className="text-sm font-semibold text-slate-900">
                When To Create Manual Business Areas
              </div>
              <div className="grid gap-2">
                {[
                  "Use GENERAL_OPS and DEPT_* as system foundation only.",
                  "Create manual business areas for splits like PROD_POWDER, PROD_ADMIX, QA_POWDER, QA_ADMIX, SCM_OPERATIONS, MGMT_ALL, or AUDIT_ALL.",
                  "Bind company-safe projects to each work scope so users inherit project reach from their assigned work areas.",
                  "Attach access packs in Capability Governance after the business area exists.",
                  "Bind users later in User Scope so cross-company access stays explicit and limited, and use direct project overrides only for rare exceptions.",
                ].map((line) => (
                  <div
                    key={line}
                    className="border border-amber-200 bg-white px-3 py-3 text-sm text-slate-700"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </ErpScreenScaffold>

      <DrawerBase
        visible={editorOpen}
        title={
          editorMode === "create"
            ? "Create Manual Work Scope"
            : "Edit Manual Work Scope"
        }
        onEscape={closeEditor}
        initialFocusRef={drawerPrimaryRef}
        width="min(520px, calc(100vw - 24px))"
        actions={
          <>
            <button
              type="button"
              onClick={closeEditor}
              className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Close
            </button>
            <button
              ref={drawerPrimaryRef}
              type="button"
              disabled={saving}
              onClick={() => void handleSaveContext()}
              className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
            >
              {saving ? "Saving..." : editorMode === "create" ? "Create Scope" : "Save Scope"}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div className="font-semibold text-slate-900">
              {formatCompanyLabel(selectedCompany)}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              {formatCompanyAddress(selectedCompany)}
            </div>
            <div className="mt-1">
              System scopes stay locked. This drawer creates or edits only manual runtime slices.
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Work Scope Code
            </span>
            <input
              value={formDraft.work_context_code}
              onChange={(event) =>
                setFormDraft((current) => ({
                  ...current,
                  work_context_code: event.target.value.toUpperCase(),
                }))
              }
              disabled={editorMode === "edit"}
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 disabled:bg-slate-100 disabled:text-slate-500"
              placeholder="ASCL_PROD_POWDER or SCM_OPERATIONS"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Work Scope Name
            </span>
            <input
              value={formDraft.work_context_name}
              onChange={(event) =>
                setFormDraft((current) => ({
                  ...current,
                  work_context_name: event.target.value,
                }))
              }
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
              placeholder="Production Powder / SCM Operations / Management All"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Department Link
            </span>
            <select
              value={formDraft.department_id}
              onChange={(event) =>
                setFormDraft((current) => ({
                  ...current,
                  department_id: event.target.value,
                }))
              }
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
            >
              <option value="">No department link</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.department_code} | {department.department_name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Description
            </span>
            <textarea
              rows={4}
              value={formDraft.description}
              onChange={(event) =>
                setFormDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
              placeholder="Explain what this scope is for and why it exists."
            />
          </label>

          <label className="flex items-center gap-3 border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formDraft.is_active !== false}
              onChange={(event) =>
                setFormDraft((current) => ({
                  ...current,
                  is_active: event.target.checked,
                }))
              }
              className="h-4 w-4 border-slate-300"
            />
            Keep this manual scope active and available for future user assignment
          </label>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={inspectorOpen}
        title="Inspect Work Scope"
        onEscape={closeInspector}
        width="min(520px, calc(100vw - 24px))"
        actions={
          <button
            type="button"
            onClick={closeInspector}
            className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        }
      >
        {selectedContext ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <ErpFieldPreview
                label="Work Scope Code"
                value={selectedContext.work_context_code}
                caption="Use this code when defining business slices and naming conventions."
              />
              <ErpFieldPreview
                label="Work Scope Name"
                value={selectedContext.work_context_name}
                caption="Human-readable label for SA and governance surfaces."
              />
              <ErpFieldPreview
                label="Type"
                value={selectedContext.is_system ? "SYSTEM" : "MANUAL"}
                caption={
                  selectedContext.is_system
                    ? "Derived automatically from company or department setup."
                    : "Managed here for runtime access slicing."
                }
              />
              <ErpFieldPreview
                label="State"
                value={selectedContext.is_active ? "ACTIVE" : "INACTIVE"}
                caption="Inactive scopes stay visible in governance but should not be assigned casually."
              />
              <ErpFieldPreview
                label="Company"
                value={
                  selectedCompany
                    ? `${selectedCompany.company_code} | ${selectedCompany.company_name}`
                    : "Unknown"
                }
                caption="One work scope belongs to one company only."
              />
              <ErpFieldPreview
                label="Department Link"
                value={
                  selectedContext.department_code
                    ? `${selectedContext.department_code} | ${selectedContext.department_name ?? ""}`
                    : "No department link"
                }
                caption="Optional for manual scopes. Mandatory only for system DEPT_* foundations."
              />
            </div>

            <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Description
              </div>
              <div className="mt-2">
                {selectedContext.description || "No description saved for this scope yet."}
              </div>
            </div>

            <div className="border border-slate-300 bg-white">
              <div className="border-b border-slate-300 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Linked Screen Packs
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Capability Governance decides which screen packs this work scope can carry.
                </div>
              </div>
              {inspectorLoading ? (
                <div className="px-4 py-4 text-sm text-slate-500">
                  Loading linked screen packs...
                </div>
              ) : linkedCapabilities.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">
                  No screen pack is attached yet.
                </div>
              ) : (
                linkedCapabilities.map((capability) => (
                  <div
                    key={capability.capability_code}
                    className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700 last:border-b-0"
                  >
                    <div className="font-semibold text-slate-900">
                      {capability.capability_code}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {capability.capability_name || "No capability name"}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border border-slate-300 bg-white">
              <div className="border-b border-slate-300 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Project Inheritance
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Project reach now comes from work-scope inheritance first, then optional user overrides.
                </div>
              </div>
              <div className="px-4 py-4">
                <button
                  type="button"
                  onClick={() => void openProjectDrawer(selectedContext)}
                  className="border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800"
                >
                  Manage Inherited Projects
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Choose a work scope first to inspect it here.
          </p>
        )}
      </DrawerBase>

      <DrawerBase
        visible={projectDrawerOpen}
        title="Manage Inherited Projects"
        onEscape={closeProjectDrawer}
        initialFocusRef={projectSearchRef}
        width="min(560px, calc(100vw - 24px))"
        actions={
          <>
            <button
              type="button"
              onClick={closeProjectDrawer}
              className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Close
            </button>
            <button
              type="button"
              disabled={projectDrawerLoading}
              onClick={() => void handleSaveProjects()}
              className="border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900"
            >
              {projectDrawerLoading ? "Saving..." : "Save Inherited Projects"}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div className="font-semibold text-slate-900">
              {selectedContext
                ? `${selectedContext.work_context_code} | ${selectedContext.work_context_name}`
                : "No work scope selected"}
            </div>
            <div className="mt-1">
              Projects attached here become inherited project reach for every user assigned to this work scope. Direct user project overrides should stay rare.
            </div>
          </div>

          <QuickFilterInput
            label="Search Projects"
            value={projectSearch}
            onChange={setProjectSearch}
            inputRef={projectSearchRef}
            placeholder="Search project code or name"
            hint="Only active projects already linked to this company are available here."
          />

          <div className="border border-slate-300 bg-white">
            <div className="border-b border-slate-300 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Available Company Projects
            </div>
            {projectDrawerLoading ? (
              <div className="px-4 py-4 text-sm text-slate-500">
                Loading inherited project options...
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="px-4 py-4 text-sm text-slate-500">
                No active company project matched the current filter.
              </div>
            ) : (
              filteredProjects.map((project, index) => {
                const checked = attachedProjectIds.includes(project.id);
                return (
                  <label
                    key={project.id}
                    className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 text-sm text-slate-700 last:border-b-0"
                  >
                    <input
                      ref={(element) => {
                        projectCheckboxRefs.current[index] = element;
                      }}
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setAttachedProjectIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, project.id])]
                            : current.filter((value) => value !== project.id),
                        )
                      }
                      className="mt-0.5 h-4 w-4 border-slate-300"
                    />
                    <span className="grid gap-1">
                      <span className="font-semibold text-slate-900">
                        {project.project_code} | {project.project_name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {checked
                          ? "Inherited by every user assigned to this work scope."
                          : "Not inherited from this work scope yet."}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </DrawerBase>
    </>
  );
}
