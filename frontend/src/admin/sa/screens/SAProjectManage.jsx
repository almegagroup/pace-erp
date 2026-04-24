import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openScreen, getActiveScreenContext, popScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import { applyQuickFilter, sortProjects } from "../../../shared/erpCollections.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";

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

async function fetchProjectCompanyMap(projectId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/project/company-map?project_id=${encodeURIComponent(projectId)}`,
    {
      credentials: "include",
    }
  );
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.project) {
    throw new Error(json?.code ?? "PROJECT_COMPANY_MAP_FAILED");
  }

  return json.data;
}

async function updateProjectState(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/project/state`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "PROJECT_STATE_UPDATE_FAILED");
  }

  return json.data;
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

export default function SAProjectManage() {
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialProjectId = initialContext.projectId ?? searchParams.get("project_id") ?? "";
  const isDrillThrough = initialContext.contextKind === "DRILL_THROUGH";
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const [mappedCompanyCount, setMappedCompanyCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProjects = useCallback(async (preferredProjectId = selectedProjectId) => {
    setLoading(true);
    setError("");

    try {
      const rows = sortProjects(await fetchProjects());
      setProjects(rows);
      const nextProjectId =
        rows.find((row) => row.id === preferredProjectId)?.id ??
        rows[0]?.id ??
        "";
      setSelectedProjectId(nextProjectId);

      if (nextProjectId) {
        const data = await fetchProjectCompanyMap(nextProjectId);
        setMappedCompanyCount(data.mapped_company_count ?? 0);
      } else {
        setMappedCompanyCount(0);
      }
    } catch {
      setProjects([]);
      setMappedCompanyCount(0);
      setError("Project management inventory could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadProjects(initialProjectId);
  }, [initialProjectId, loadProjects]);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectMap() {
      if (!selectedProjectId) {
        setMappedCompanyCount(0);
        return;
      }

      try {
        const data = await fetchProjectCompanyMap(selectedProjectId);
        if (!cancelled) {
          setMappedCompanyCount(data.mapped_company_count ?? 0);
        }
      } catch {
        if (!cancelled) {
          setMappedCompanyCount(0);
        }
      }
    }

    void loadProjectMap();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const filteredProjects = useMemo(
    () =>
      applyQuickFilter(projects, search, [
        "project_code",
        "project_name",
        "status",
        "created_at",
      ]),
    [projects, search]
  );

  useEffect(() => {
    if (!filteredProjects.some((row) => row.id === selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0]?.id ?? "");
    }
  }, [filteredProjects, selectedProjectId]);

  const selectedProject =
    projects.find((row) => row.id === selectedProjectId) ?? null;

  const { getRowProps } = useErpListNavigation(filteredProjects);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadProjects(selectedProjectId),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => searchRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-project-manage-master",
      group: "Current Screen",
      label: isDrillThrough ? "Back to project register" : "Open project master",
      keywords: ["project master", "create project"],
      perform: () => {
        if (isDrillThrough) {
          popScreen();
          return;
        }
        openScreen("SA_PROJECT_MASTER", { mode: "replace" });
        navigate("/sa/project-master");
      },
      order: 10,
    },
    {
      id: "sa-project-manage-map",
      group: "Current Screen",
      label: "Open company project map",
      keywords: ["company project map", "project mapping"],
      disabled: !selectedProject,
      perform: () => {
        if (!selectedProject) return;
        openScreen("SA_COMPANY_PROJECT_MAP", { mode: "replace" });
        navigate(`/sa/projects/map?project_id=${encodeURIComponent(selectedProject.id)}`);
      },
      order: 20,
    },
  ]);

  async function handleStateChange(nextState) {
    if (!selectedProject || selectedProject.status === nextState) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await updateProjectState({
        project_id: selectedProject.id,
        next_state: nextState,
      });
      setNotice(`Project ${selectedProject.project_code} is now ${nextState}.`);
      await loadProjects(selectedProject.id);
    } catch {
      setError("Project state could not be updated right now.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Project Governance"
      title="Project Manage"
      actions={[
        {
          key: "project-master",
          label: isDrillThrough ? "Back To Project Register" : "Project Master",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => {
            if (isDrillThrough) {
              popScreen();
              return;
            }
            openScreen("SA_PROJECT_MASTER", { mode: "replace" });
            navigate("/sa/project-master");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[1] = element;
          },
          onClick: () => void loadProjects(selectedProjectId),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "company-map",
          label: "Company Project Map",
          tone: "primary",
          disabled: !selectedProject,
          buttonRef: (element) => {
            actionRefs.current[2] = element;
          },
          onClick: () => {
            if (!selectedProject) return;
            openScreen("SA_COMPANY_PROJECT_MAP", { mode: "replace" });
            navigate(`/sa/projects/map?project_id=${encodeURIComponent(selectedProject.id)}`);
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 2,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      footerHints={["↑↓ Navigate", "Enter Select", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3">
          <ErpSelectionSection label="Project Roster" />
          <QuickFilterInput
            label="Find project"
            value={search}
            onChange={setSearch}
            inputRef={searchRef}
            placeholder="Filter by code, name, or state"
            hint="Alt+Shift+F focuses this filter."
          />

          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading project governance rows.
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No project matches the current filter.
            </div>
          ) : (
            <ErpDenseGrid
              columns={[
                {
                  key: "project",
                  label: "Project",
                  render: (project) => (
                    <div>
                      <div className="font-semibold text-slate-900">{project.project_code} - {project.project_name}</div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{project.status ?? "UNKNOWN"}</div>
                    </div>
                  ),
                },
                {
                  key: "created",
                  label: "Created",
                  render: (project) => formatDateTime(project.created_at),
                },
              ]}
              rows={filteredProjects}
              rowKey={(project) => project.id}
              getRowProps={(project, index) => ({
                ...getRowProps(index),
                onClick: () => setSelectedProjectId(project.id),
                className: project.id === selectedProjectId ? "bg-sky-50" : "",
              })}
              onRowActivate={(project) => setSelectedProjectId(project.id)}
              emptyMessage="No project matches the current filter."
              maxHeight="380px"
            />
          )}
        </div>

        <div className="grid gap-6">
          <div className="grid gap-3">
            <ErpSelectionSection label={selectedProject ? `${selectedProject.project_code} | ${selectedProject.project_name}` : "No Project Selected"} />
            {selectedProject ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
                  <div className="text-sm text-slate-900">{selectedProject.status ?? "UNKNOWN"}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created</div>
                  <div className="text-sm text-slate-900">{formatDateTime(selectedProject.created_at)}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Mapped Companies</div>
                  <div className="text-sm text-slate-900">{mappedCompanyCount}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Handling Rule</div>
                  <div className="text-sm text-slate-900">Global Project</div>
                </div>

                <div className="md:col-span-2 flex flex-wrap gap-3">
                  {selectedProject.status === "ACTIVE" ? (
                    <button
                      type="button"
                      className="border border-rose-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-rose-700"
                      onClick={() => void handleStateChange("INACTIVE")}
                      disabled={saving}
                    >
                      Inactivate Project
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="border border-emerald-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-emerald-700"
                      onClick={() => void handleStateChange("ACTIVE")}
                      disabled={saving}
                    >
                      Activate Project
                    </button>
                  )}

                  <button
                    type="button"
                    className="border border-sky-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-sky-700"
                    onClick={() => {
                      openScreen("SA_COMPANY_PROJECT_MAP", { mode: "replace" });
                      navigate(`/sa/projects/map?project_id=${encodeURIComponent(selectedProject.id)}`);
                    }}
                  >
                    Open Company Project Map
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a project from the roster to manage its lifecycle and company usage.
              </div>
            )}
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
