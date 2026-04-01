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
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const projectNameRef = useRef(null);
  const searchInputRef = useRef(null);
  const projectRowRefs = useRef([]);
  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recentProject, setRecentProject] = useState(null);

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

    const approved = await openActionConfirm({
      eyebrow: "Project Master",
      title: "Create Project",
      message: `Create project master row for ${normalizedName}?`,
      confirmLabel: "Create Project",
      cancelLabel: "Cancel",
    });

    if (!approved) {
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
      setRecentProject(created);
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

  const metrics = [
    {
      key: "total",
      label: "Projects",
      value: loading ? "..." : String(projects.length),
      tone: "sky",
      caption: "Project rows currently returned by the global master list flow.",
    },
    {
      key: "active",
      label: "Active",
      value: loading ? "..." : String(projects.filter((row) => row.status === "ACTIVE").length),
      tone: "emerald",
      caption: "Active project masters from the global backend list endpoint.",
    },
    {
      key: "filtered",
      label: "Visible",
      value: loading ? "..." : String(filteredProjects.length),
      tone: "amber",
      caption: "Rows matching the current quick filter.",
    },
    {
      key: "recent",
      label: "Recent Create",
      value: recentProject?.project_code ?? "None",
      tone: "slate",
      caption: recentProject?.project_name ?? "No project created in this session yet.",
    },
  ];

  return (
    <ErpEntryFormTemplate
      eyebrow="Project Master"
      title="Project Master Manage"
      description="Create reusable global project rows here, then move into dedicated lifecycle and company mapping surfaces when the project is ready."
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
      metrics={metrics}
      formEyebrow="Create"
      formTitle="Create a new project"
      formDescription="Create a reusable global project row here. Company rollout now happens from the dedicated company project map screen."
      formContent={
        <div ref={formContainerRef} className="grid gap-3">
          <label className="grid gap-2 border border-slate-300 bg-white px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Project Name
            </span>
            <input
              ref={projectNameRef}
              data-workspace-primary-focus="true"
              data-erp-form-field="true"
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
            />
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
              Enter moves forward | Ctrl+S creates the project
            </p>
          </label>
        </div>
      }
      sideContent={
        <>
          <ErpSectionCard
            eyebrow="Search"
            title="Project quick filter"
            description="Filter the current global project list without leaving the create form."
          >
            <QuickFilterInput
              label="Find Project"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchInputRef}
              placeholder="Filter by code, name, status, or created time"
              hint="Alt+Shift+F focuses this filter."
            />
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Recent"
            title="Last created project"
            description="The most recent project created in this session stays visible here."
          >
            <ErpFieldPreview
              label="Project"
              value={
                recentProject
                  ? `${recentProject.project_code} | ${recentProject.project_name}`
                  : "No project created yet"
              }
              caption={
                recentProject
                  ? `Status ${recentProject.status ?? "ACTIVE"}`
                  : "Create a project to populate this preview."
              }
              tone={recentProject ? "success" : "default"}
            />
          </ErpSectionCard>
        </>
      }
      bottomContent={
        <ErpSectionCard
          eyebrow="Project List"
          title={
            loading
              ? "Loading project rows"
              : `${filteredProjects.length} visible project${filteredProjects.length === 1 ? "" : "s"}`
          }
          description="The list below comes from the global project master endpoint."
        >
          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading project master rows.
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No project matches the current filter.
            </div>
          ) : (
            <div className="space-y-0 border border-slate-300">
              <ErpPaginationStrip
                page={projectPagination.page}
                setPage={projectPagination.setPage}
                totalPages={projectPagination.totalPages}
                startIndex={projectPagination.startIndex}
                endIndex={projectPagination.endIndex}
                totalItems={filteredProjects.length}
              />
              {projectPagination.pageItems.map((project, index) => (
                <button
                  key={project.id}
                  ref={(element) => {
                    projectRowRefs.current[index] = element;
                  }}
                  type="button"
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: projectRowRefs.current,
                      orientation: "vertical",
                    })
                  }
                  className="w-full border-b border-slate-300 bg-white px-4 py-3 text-left text-sm text-slate-700 transition last:border-b-0 focus:bg-sky-50"
                >
                  <span className="block font-semibold text-slate-900">
                    {project.project_code} - {project.project_name}
                  </span>
                  <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                    {project.status ?? "UNKNOWN"}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Created {formatDateTime(project.created_at)}
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
