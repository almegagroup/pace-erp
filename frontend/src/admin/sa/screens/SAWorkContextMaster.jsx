import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";

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
  const rowRefs = useRef([]);
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

  const metrics = useMemo(() => {
    const systemCount = workContexts.filter((row) => row.is_system === true).length;
    const manualCount = workContexts.length - systemCount;
    const activeCount = workContexts.filter((row) => row.is_active === true).length;

    return {
      total: workContexts.length,
      manual: manualCount,
      system: systemCount,
      active: activeCount,
    };
  }, [workContexts]);

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
        description="Keep company-wide and department-derived system scopes visible, then create manual business areas like PROD_POWDER, QA_ADMIX, SCM_OPERATIONS, or MGMT_ALL. Business rule: department is org structure, work scope is runtime business area."
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
        metrics={[
          {
            label: "Total Scopes",
            value: metrics.total,
            caption: "All work scopes currently defined in the selected company.",
            tone: "sky",
          },
          {
            label: "Manual Scopes",
            value: metrics.manual,
            caption: "Business slices created manually for Powder, Admix, SCM, Management, or Audit.",
            tone: "emerald",
          },
          {
            label: "System Scopes",
            value: metrics.system,
            caption: "GENERAL_OPS plus DEPT_* scopes derived from company and department foundations.",
            tone: "amber",
          },
          {
            label: "Active",
            value: metrics.active,
            caption: "Scopes currently available for capability wiring and user assignment.",
            tone: "slate",
          },
        ]}
        footerHints={[
          "ALT+R REFRESH",
          "ALT+S SEARCH",
          "ENTER INSPECT",
          "CTRL+K COMMAND BAR",
        ]}
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <div className="grid gap-3">
            <ErpSectionCard
              eyebrow="Company Scope"
              title="Select Company"
              description="Work scopes remain company-bound. Change company first, then inspect or create manual runtime slices."
            >
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
                        {company.company_code} | {company.company_name}
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
                  hint="Keep the table readable. Dense inspection and editing happen in drawers."
                  className="md:col-span-2"
                />
              </div>
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Inventory"
              title="Work Scope Table"
              description="System scopes stay visible for clarity. Manual scopes are the ones SA creates for Production split, QA split, SCM, Management, Audit, or any other exact runtime slice."
            >
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
                  <table className="min-w-full border-collapse text-sm text-slate-700">
                    <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      <tr>
                        <th className="border-b border-slate-300 px-4 py-3 text-left">
                          Code
                        </th>
                        <th className="border-b border-l border-slate-300 px-4 py-3 text-left">
                          Name
                        </th>
                        <th className="border-b border-l border-slate-300 px-4 py-3 text-left">
                          Type
                        </th>
                        <th className="border-b border-l border-slate-300 px-4 py-3 text-left">
                          Department
                        </th>
                        <th className="border-b border-l border-slate-300 px-4 py-3 text-left">
                          State
                        </th>
                        <th className="border-b border-l border-slate-300 px-4 py-3 text-left">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContexts.map((context, index) => {
                        const selected =
                          context.work_context_id === selectedContextId;
                        const isSystem = context.is_system === true;

                        return (
                          <tr
                            key={context.work_context_id}
                            className={selected ? "bg-sky-50" : "bg-white"}
                          >
                            <td className="border-b border-slate-200 px-4 py-3 align-top">
                              <button
                                ref={(element) => {
                                  rowRefs.current[index] = element;
                                }}
                                type="button"
                                onClick={() => setSelectedContextId(context.work_context_id)}
                                onDoubleClick={() => openInspector(context)}
                                onKeyDown={(event) =>
                                  handleLinearNavigation(event, {
                                    index,
                                    refs: rowRefs.current,
                                    orientation: "vertical",
                                  })
                                }
                                className="w-full text-left"
                              >
                                <div className="font-semibold text-slate-900">
                                  {context.work_context_code}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {context.description || "No description saved yet."}
                                </div>
                              </button>
                            </td>
                            <td className="border-b border-l border-slate-200 px-4 py-3 align-top">
                              <div className="font-semibold text-slate-900">
                                {context.work_context_name}
                              </div>
                            </td>
                            <td className="border-b border-l border-slate-200 px-4 py-3 align-top">
                              <span
                                className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                  isSystem
                                    ? "border-amber-300 bg-amber-50 text-amber-800"
                                    : "border-emerald-300 bg-emerald-50 text-emerald-800"
                                }`}
                              >
                                {isSystem ? "System" : "Manual"}
                              </span>
                            </td>
                            <td className="border-b border-l border-slate-200 px-4 py-3 align-top">
                              <div className="text-sm text-slate-700">
                                {context.department_code
                                  ? `${context.department_code} | ${context.department_name ?? ""}`
                                  : "Company-wide / no team link"}
                              </div>
                            </td>
                            <td className="border-b border-l border-slate-200 px-4 py-3 align-top">
                              <span
                                className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                  context.is_active
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                    : "border-rose-300 bg-rose-50 text-rose-700"
                                }`}
                              >
                                {context.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="border-b border-l border-slate-200 px-4 py-3 align-top">
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
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </ErpSectionCard>
          </div>

          <div className="grid gap-3">
            <ErpSectionCard
              eyebrow="Selected Scope"
              title={
                selectedContext
                  ? `${selectedContext.work_context_code} | ${selectedContext.work_context_name}`
                  : "Choose A Work Scope"
              }
              description="Department remains org structure. Work scope remains runtime business area. Keep these separate for clean governance."
            >
              {selectedContext ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <ErpFieldPreview
                      label="Scope Type"
                      value={selectedContext.is_system ? "SYSTEM" : "MANUAL"}
                      caption={
                        selectedContext.is_system
                          ? "Derived from company or department foundation."
                          : "Created manually for exact business slices."
                      }
                    />
                    <ErpFieldPreview
                      label="Department Link"
                      value={
                        selectedContext.department_code
                          ? `${selectedContext.department_code} | ${selectedContext.department_name ?? ""}`
                          : "No department link"
                      }
                      caption="Optional for manual scopes. Useful when a runtime slice still belongs to one team."
                    />
                    <ErpFieldPreview
                      label="Lifecycle"
                      value={selectedContext.is_active ? "ACTIVE" : "INACTIVE"}
                      caption="Inactive manual scopes stay out of new user assignments until re-enabled."
                    />
                    <ErpFieldPreview
                      label="Foundation"
                      value={selectedCompany?.company_code ?? "No company"}
                      caption="Every work scope stays pinned to one company."
                    />
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
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Pick a row from the table to inspect one work scope at a time.
                </p>
              )}
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Operating Rule"
              title="When To Create Manual Business Areas"
              description="Do not overload Department Master. Create manual business areas only when runtime access needs a finer slice than the team structure gives you."
              tone="warning"
            >
              <div className="grid gap-2">
                {[
                  "Use GENERAL_OPS and DEPT_* as system foundation only.",
                  "Create manual business areas for splits like PROD_POWDER, PROD_ADMIX, QA_POWDER, QA_ADMIX, SCM_OPERATIONS, MGMT_ALL, or AUDIT_ALL.",
                  "Attach access packs in Capability Governance after the business area exists.",
                  "Bind users later in User Scope so cross-company access stays explicit and limited.",
                ].map((line) => (
                  <div
                    key={line}
                    className="border border-amber-200 bg-white px-3 py-3 text-sm text-slate-700"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </ErpSectionCard>
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
              {selectedCompany
                ? `${selectedCompany.company_code} | ${selectedCompany.company_name}`
                : "No company selected"}
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
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Choose a work scope first to inspect it here.
          </p>
        )}
      </DrawerBase>
    </>
  );
}
