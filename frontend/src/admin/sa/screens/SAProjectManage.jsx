import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { applyQuickFilter, sortProjects } from "../../../shared/erpCollections.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialProjectId = searchParams.get("project_id") ?? "";
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

  async function loadProjects(preferredProjectId = selectedProjectId) {
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
  }

  useEffect(() => {
    void loadProjects(initialProjectId);
  }, [initialProjectId]);

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
      label: "Open project master",
      keywords: ["project master", "create project"],
      perform: () => {
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

    const approved = await openActionConfirm({
      eyebrow: "Project Lifecycle",
      title: `${nextState === "ACTIVE" ? "Activate" : "Inactivate"} Project`,
      message: `${nextState === "ACTIVE" ? "Activate" : "Inactivate"} ${selectedProject.project_code} | ${selectedProject.project_name}?`,
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
      description="Review reusable projects, control lifecycle, and move into company mapping when a project is ready for operational use."
      actions={[
        {
          key: "project-master",
          label: "Project Master",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => {
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
          hint: "Alt+R",
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
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ErpSectionCard
          eyebrow="Inventory"
          title="Project roster"
          description="Choose the project you want to manage, then move into lifecycle or company mapping."
        >
          <div className="grid gap-4">
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
              <div className="space-y-0 border border-slate-300">
                {filteredProjects.map((project, index) => {
                  const isSelected = project.id === selectedProjectId;

                  return (
                    <button
                      key={project.id}
                      {...getRowProps(index)}
                      type="button"
                      onClick={() => setSelectedProjectId(project.id)}
                      className={`w-full border-b border-slate-300 px-4 py-3 text-left text-sm transition last:border-b-0 ${
                        isSelected
                          ? "bg-sky-50 text-slate-900"
                          : "bg-white text-slate-700"
                      }`}
                    >
                      <span className="block font-semibold">
                        {project.project_code} - {project.project_name}
                      </span>
                      <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                        {project.status ?? "UNKNOWN"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ErpSectionCard>

        <div className="grid gap-6">
          <ErpSectionCard
            eyebrow="Selected Project"
            title={selectedProject ? `${selectedProject.project_code} | ${selectedProject.project_name}` : "No project selected"}
            description="Keep project lifecycle separate from company mapping. First stabilize the reusable project, then attach it to operational companies."
          >
            {selectedProject ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ErpFieldPreview
                  label="Status"
                  value={selectedProject.status ?? "UNKNOWN"}
                  tone={selectedProject.status === "ACTIVE" ? "success" : "warning"}
                  caption="Lifecycle state from the project master registry."
                />
                <ErpFieldPreview
                  label="Created"
                  value={formatDateTime(selectedProject.created_at)}
                  caption="Registry timestamp."
                />
                <ErpFieldPreview
                  label="Mapped Companies"
                  value={String(mappedCompanyCount)}
                  caption="Companies currently using this project."
                />
                <ErpFieldPreview
                  label="Handling Rule"
                  value="Global Project"
                  caption="Same project can be reused across many companies."
                />

                <div className="md:col-span-2 flex flex-wrap gap-3">
                  {selectedProject.status === "ACTIVE" ? (
                    <button
                      type="button"
                      className="border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700"
                      onClick={() => void handleStateChange("INACTIVE")}
                      disabled={saving}
                    >
                      Inactivate Project
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700"
                      onClick={() => void handleStateChange("ACTIVE")}
                      disabled={saving}
                    >
                      Activate Project
                    </button>
                  )}

                  <button
                    type="button"
                    className="border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-700"
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
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
