import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  openScreen,
  openScreenWithContext,
  getActiveScreenContext,
  updateActiveScreenContext,
  registerScreenRefreshCallback,
} from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import { applyQuickFilter, sortProjects } from "../../../shared/erpCollections.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchProjects() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/projects`, {
    credentials: "include",
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.projects)) {
    throw new Error(json?.code ?? "PROJECT_LIST_FAILED");
  }

  return json.data.projects;
}

async function createProject(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/project`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.project) {
    throw new Error(json?.code ?? "PROJECT_CREATE_FAILED");
  }

  return json.data.project;
}

function formatDateTime(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SAProjectMaster() {
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const projectNameRef = useRef(null);
  const searchInputRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(initialContext.parentState?.focusKey ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadProjects() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchProjects();
      setProjects(sortProjects(data));
    } catch {
      setError("Unable to load project master rows right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function handleCreate() {
    const normalizedName = projectName.trim();

    if (!normalizedName) {
      setError("Enter a project name before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const created = await createProject({
        project_name: normalizedName,
      });
      const refreshed = await fetchProjects();
      setProjects(sortProjects(refreshed));
      setProjectName("");
      setNotice(`Project ${created.project_code} created successfully.`);
      projectNameRef.current?.focus();
    } catch {
      setError("Project master could not be created right now.");
    } finally {
      setSaving(false);
    }
  }

  const filteredProjects = useMemo(
    () =>
      applyQuickFilter(projects, searchQuery, [
        "project_code",
        "project_name",
        "status",
        "created_at",
      ]),
    [projects, searchQuery]
  );
  const projectPagination = useErpPagination(filteredProjects, 10);
  const selectedProject =
    filteredProjects.find((row) => row.id === selectedProjectId) ??
    projectPagination.pageItems[0] ??
    null;

  useEffect(() => {
    if (!filteredProjects.some((row) => row.id === selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0]?.id ?? "");
    }
  }, [filteredProjects, selectedProjectId]);

  function openDetail(row) {
    const parentState = {
      searchQuery,
      focusKey: row?.id ?? "",
    };
    setSelectedProjectId(row?.id ?? "");
    updateActiveScreenContext({ parentState });
    openScreenWithContext("SA_PROJECT_MANAGE", {
      projectId: row?.id ?? "",
      parentState,
      refreshOnReturn: true,
    });
    navigate(`/sa/projects/manage?project_id=${encodeURIComponent(row?.id ?? "")}`);
  }

  const { getRowProps, focusRow } = useErpListNavigation(projectPagination.pageItems, {
    onActivate: (row) => openDetail(row),
  });

  useEffect(
    () =>
      registerScreenRefreshCallback(() => {
        void loadProjects();
      }),
    [],
  );

  useEffect(() => {
    updateActiveScreenContext({ parentState: { searchQuery, focusKey: selectedProjectId } });
  }, [searchQuery, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || projectPagination.pageItems.length === 0) {
      return;
    }
    const targetIndex = projectPagination.pageItems.findIndex((row) => row.id === selectedProjectId);
    if (targetIndex >= 0) {
      queueMicrotask(() => focusRow(targetIndex));
    }
  }, [projectPagination.pageItems, selectedProjectId, focusRow]);

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
      perform: () => void loadProjects(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => projectNameRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-project-master-control-panel",
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
      id: "sa-project-master-focus-name",
      group: "Current Screen",
      label: "Focus project name",
      keywords: ["project name", "create project"],
      perform: () => projectNameRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-project-master-focus-search",
      group: "Current Screen",
      label: "Focus project search",
      keywords: ["filter", "search", "projects"],
      perform: () => searchInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-project-master-manage",
      group: "Current Screen",
      label: "Open project manage",
      keywords: ["project manage", "project lifecycle", "mapping"],
      perform: () => {
        openScreen("SA_PROJECT_MANAGE", { mode: "replace" });
        navigate("/sa/projects/manage");
      },
      order: 35,
    },
    {
      id: "sa-project-master-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing projects..." : "Refresh projects",
      keywords: ["refresh", "project master"],
      disabled: loading,
      perform: () => void loadProjects(),
      order: 40,
    },
    {
      id: "sa-project-master-save",
      group: "Current Screen",
      label: saving ? "Creating project..." : "Create project",
      hint: "Ctrl+S",
      keywords: ["save", "create", "project master"],
      disabled: saving,
      perform: () => void handleCreate(),
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
      key: "manage",
      label: "Project Manage",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => {
        openScreen("SA_PROJECT_MANAGE", { mode: "replace" });
        navigate("/sa/projects/manage");
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
      label: loading ? "Refreshing..." : "Refresh Projects",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void loadProjects(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create",
      label: saving ? "Creating..." : "Create Project",
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
      eyebrow="Project Master"
      title="Project Master Manage"
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
      footerHints={["Tab Next Field", "↑↓ Navigate", "Enter Open", "Ctrl+S Save", "Esc Back", "Ctrl+K Command Bar"]}
      formEyebrow="Create"
      formTitle="Create a new project"
      formContent={
        <div ref={formContainerRef} className="grid gap-[var(--erp-form-gap)]">
          <ErpDenseFormRow label="Project Name" required>
            <input
              ref={projectNameRef}
              data-workspace-primary-focus="true"
              data-erp-form-field="true"
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              className="h-7 w-full border border-slate-300 bg-[#fffef7] px-2 py-0.5 text-[12px] text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
            />
          </ErpDenseFormRow>
        </div>
      }
      bottomContent={
        <section className="grid gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Project Register</div>
          <div className="text-sm font-semibold text-slate-900">
            {loading
              ? "Loading project rows"
              : `${filteredProjects.length} visible project${filteredProjects.length === 1 ? "" : "s"}`}
          </div>
          <QuickFilterInput
            label="Search Projects"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchInputRef}
            placeholder="Search by code, name, state, or created time"
          />
          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading project master rows.
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No project matches the current filter.
            </div>
          ) : (
            <div className="grid gap-3">
              <ErpPaginationStrip
                page={projectPagination.page}
                setPage={projectPagination.setPage}
                totalPages={projectPagination.totalPages}
                startIndex={projectPagination.startIndex}
                endIndex={projectPagination.endIndex}
                totalItems={filteredProjects.length}
              />
              <ErpDenseGrid
                columns={[
                  {
                    key: "project",
                    label: "Project",
                    render: (project) => (
                      <div>
                        <div className="font-semibold text-slate-900">
                          {project.project_code} - {project.project_name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Created {formatDateTime(project.created_at)}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (project) => project.status ?? "UNKNOWN",
                  },
                ]}
                rows={projectPagination.pageItems}
                rowKey={(project) => project.id}
                getRowProps={(project, index) => ({
                  ...getRowProps(index),
                  onClick: () => setSelectedProjectId(project.id),
                  className: project.id === selectedProjectId ? "bg-sky-50" : "",
                })}
                onRowActivate={(project) => openDetail(project)}
                maxHeight="none"
              />
              {selectedProject ? (
                <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Selected: <span className="font-semibold text-slate-900">{selectedProject.project_code} - {selectedProject.project_name}</span>
                </div>
              ) : null}
            </div>
          )}
        </section>
      }
    />
  );
}
