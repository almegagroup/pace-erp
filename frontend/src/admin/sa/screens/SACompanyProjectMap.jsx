import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import { applyQuickFilter, sortProjects } from "../../../shared/erpCollections.js";
import {
  formatCompanyAddress,
  formatCompanyLabel,
} from "../../../shared/companyDisplay.js";

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

async function postJson(path, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "REQUEST_FAILED");
  }

  return json.data;
}

export default function SACompanyProjectMap() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialProjectId = searchParams.get("project_id") ?? "";
  const actionRefs = useRef([]);
  const projectSearchRef = useRef(null);
  const companySearchRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const [projectDetail, setProjectDetail] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");
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

      if (!nextProjectId) {
        setProjectDetail(null);
        setCompanies([]);
      }
    } catch (err) {
      console.error("PROJECT_LIST_LOAD_FAILED", {
        project_id: preferredProjectId || null,
        message: err?.message ?? "PROJECT_LIST_FAILED",
      });
      setProjects([]);
      setProjectDetail(null);
      setCompanies([]);
      setError("Project mapping workspace could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  const loadCompanyMap = useCallback(async (projectId = selectedProjectId) => {
    if (!projectId) {
      setProjectDetail(null);
      setCompanies([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await fetchProjectCompanyMap(projectId);
      setProjectDetail(data.project ?? null);
      setCompanies(data.companies ?? []);
    } catch (err) {
      console.error("PROJECT_COMPANY_MAP_LOAD_FAILED", {
        project_id: projectId,
        message: err?.message ?? "PROJECT_COMPANY_MAP_FAILED",
      });
      setProjectDetail(null);
      setCompanies([]);
      setError("Company project mapping could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadProjects(initialProjectId);
  }, [initialProjectId, loadProjects]);

  useEffect(() => {
    void loadCompanyMap(selectedProjectId);
  }, [loadCompanyMap, selectedProjectId]);

  const filteredProjects = useMemo(
    () =>
      applyQuickFilter(projects, projectSearch, [
        "project_code",
        "project_name",
        "status",
      ]),
    [projects, projectSearch]
  );

  useEffect(() => {
    if (!filteredProjects.some((row) => row.id === selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0]?.id ?? "");
    }
  }, [filteredProjects, selectedProjectId]);

  const filteredCompanies = useMemo(
    () =>
      applyQuickFilter(companies, companySearch, [
        "company_code",
        "company_name",
        "gst_number",
        "status",
        "is_mapped",
      ]),
    [companies, companySearch]
  );

  const mappedCompanies = companies.filter((row) => row.is_mapped);

  const { getRowProps: getProjectRowProps } = useErpListNavigation(filteredProjects);
  const { getRowProps: getCompanyRowProps } = useErpListNavigation(filteredCompanies);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadCompanyMap(selectedProjectId),
    },
    focusSearch: {
      perform: () => companySearchRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => projectSearchRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-company-project-map-master",
      group: "Current Screen",
      label: "Open project master",
      keywords: ["project master", "create"],
      perform: () => {
        openScreen("SA_PROJECT_MASTER", { mode: "replace" });
        navigate("/sa/project-master");
      },
      order: 10,
    },
    {
      id: "sa-company-project-map-manage",
      group: "Current Screen",
      label: "Open project manage",
      keywords: ["project manage", "lifecycle"],
      perform: () => {
        openScreen("SA_PROJECT_MANAGE", { mode: "replace" });
        navigate(
          `/sa/projects/manage${selectedProjectId ? `?project_id=${encodeURIComponent(selectedProjectId)}` : ""}`
        );
      },
      order: 20,
    },
  ]);

  async function handleMapToggle(company) {
    if (!projectDetail) {
      return;
    }

    const isMapped = Boolean(company.is_mapped);

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const path = isMapped
        ? "/api/admin/project/unmap-company"
        : "/api/admin/project/map-company";
      const payload = {
        company_id: company.id,
        project_id: projectDetail.id,
      };
      const result = await postJson(path, payload);
      console.info("PROJECT_COMPANY_MAP_TOGGLE_RESULT", {
        path,
        requested: payload,
        persisted: result ?? null,
      });
      setNotice(
        `Company ${company.company_code} ${isMapped ? "removed from" : "attached to"} ${projectDetail.project_code}.`
      );
      await loadCompanyMap(projectDetail.id);
    } catch (err) {
      console.error("PROJECT_COMPANY_MAP_TOGGLE_FAILED", {
        company_id: company.id,
        project_id: projectDetail.id,
        mapped_before: isMapped,
        message: err?.message ?? "REQUEST_FAILED",
      });
      setError(
        err instanceof Error
          ? `Project mapping could not be saved. ${err.message}`
          : "Project mapping could not be saved right now."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Project Mapping"
      title="Company Project Map"
      actions={[
        {
          key: "project-manage",
          label: "Project Manage",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => {
            openScreen("SA_PROJECT_MANAGE", { mode: "replace" });
            navigate(
              `/sa/projects/manage${selectedProjectId ? `?project_id=${encodeURIComponent(selectedProjectId)}` : ""}`
            );
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
          onClick: () => void loadCompanyMap(selectedProjectId),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      footerHints={["↑↓ Navigate", "Space Select", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3">
          <ErpSelectionSection label="Choose Project" />
          <QuickFilterInput
            label="Find project"
            value={projectSearch}
            onChange={setProjectSearch}
            inputRef={projectSearchRef}
            placeholder="Filter by project code or project name"
          />

          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading projects.
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
              ]}
              rows={filteredProjects}
              rowKey={(project) => project.id}
              getRowProps={(project, index) => ({
                ...getProjectRowProps(index),
                onClick: () => setSelectedProjectId(project.id),
                className: project.id === selectedProjectId ? "bg-sky-50" : "",
              })}
              onRowActivate={(project) => setSelectedProjectId(project.id)}
              emptyMessage="No project matches the current filter."
              maxHeight="340px"
            />
          )}
        </div>

        <div className="grid gap-6">
          <div className="grid gap-3">
            <ErpSelectionSection
              label={
                projectDetail
                  ? `${projectDetail.project_code} | ${projectDetail.project_name}`
                  : "No Project Selected"
              }
            />
            {projectDetail ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
                  <div className="text-sm text-slate-900">{projectDetail.status ?? "UNKNOWN"}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Mapped Companies</div>
                  <div className="text-sm text-slate-900">{mappedCompanies.length}</div>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a project to begin company mapping.
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <ErpSelectionSection label="Business Company Rollout" />
            <QuickFilterInput
              label="Find company"
              value={companySearch}
              onChange={setCompanySearch}
              inputRef={companySearchRef}
              placeholder="Filter by company code, name, GST, or state"
            />

            {loading ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Loading company rollout rows.
              </div>
            ) : filteredCompanies.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No company matches the current filter.
              </div>
            ) : (
              <ErpDenseGrid
                columns={[
                  {
                    key: "company",
                    label: "Company",
                    render: (company) => (
                      <div>
                        <div className="font-semibold text-slate-900">{formatCompanyLabel(company, { separator: " - " })}</div>
                        <div className="text-[10px] text-slate-500">{formatCompanyAddress(company)}</div>
                      </div>
                    ),
                  },
                  {
                    key: "state",
                    label: "State",
                    render: (company) => `${company.status ?? "UNKNOWN"} | ${company.gst_number ?? "GST not captured"}`,
                  },
                  {
                    key: "action",
                    label: "Action",
                    render: (company) => (
                      <button
                        type="button"
                        disabled={!projectDetail || saving}
                        className={`border px-3 py-1 text-xs font-semibold ${
                          company.is_mapped
                            ? "border-rose-300 bg-white text-rose-700"
                            : "border-sky-300 bg-white text-sky-700"
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleMapToggle(company);
                        }}
                      >
                        {company.is_mapped ? "Unmap" : "Map"}
                      </button>
                    ),
                  },
                ]}
                rows={filteredCompanies}
                rowKey={(company) => company.id}
                getRowProps={(_company, index) => getCompanyRowProps(index)}
                emptyMessage="No company matches the current filter."
                maxHeight="380px"
              />
            )}
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
