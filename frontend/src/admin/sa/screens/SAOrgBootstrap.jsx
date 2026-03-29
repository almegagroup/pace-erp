import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchJson(path) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "REQUEST_FAILED");
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

function sortByLabel(rows, codeKey, nameKey) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left?.[codeKey] ?? ""} ${left?.[nameKey] ?? ""}`.trim();
    const rightValue = `${right?.[codeKey] ?? ""} ${right?.[nameKey] ?? ""}`.trim();
    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function compact(value) {
  return String(value ?? "").trim();
}

export default function SAOrgBootstrap() {
  const navigate = useNavigate();
  const companySelectRef = useRef(null);
  const [companies, setCompanies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [companyDraft, setCompanyDraft] = useState({
    company_name: "",
    gst_number: "",
  });
  const [groupDraft, setGroupDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [groupToMapId, setGroupToMapId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedCompany = useMemo(
    () => companies.find((row) => row.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );

  const readiness = useMemo(() => {
    const mappedCompanies = companies.filter((row) => row.group_id).length;

    return {
      companies: companies.length,
      groups: groups.length,
      mappedCompanies,
      projects: projects.length,
      departments: departments.length,
    };
  }, [companies, groups, projects, departments]);

  async function loadCompanyScopedRows(companyId) {
    if (!compact(companyId)) {
      setProjects([]);
      setDepartments([]);
      return;
    }

    const [projectData, departmentData] = await Promise.all([
      fetchJson(`/api/admin/projects?company_id=${encodeURIComponent(companyId)}`),
      fetchJson(`/api/admin/departments?company_id=${encodeURIComponent(companyId)}`),
    ]);

    setProjects(sortByLabel(projectData?.projects ?? [], "project_code", "project_name"));
    setDepartments(
      sortByLabel(departmentData?.departments ?? [], "department_code", "department_name")
    );
  }

  async function loadBootstrap(preferredCompanyId = "") {
    setLoading(true);
    setError("");

    try {
      const [companyData, groupData] = await Promise.all([
        fetchJson("/api/admin/companies"),
        fetchJson("/api/admin/groups"),
      ]);

      const nextCompanies = sortByLabel(
        companyData?.companies ?? [],
        "company_code",
        "company_name"
      );
      const nextGroups = sortByLabel(groupData?.groups ?? [], "group_code", "name");
      const resolvedCompanyId =
        compact(preferredCompanyId) ||
        compact(selectedCompanyId) ||
        nextCompanies[0]?.id ||
        "";

      setCompanies(nextCompanies);
      setGroups(nextGroups);
      setSelectedCompanyId(resolvedCompanyId);
      setGroupToMapId((current) => current || String(nextGroups[0]?.id ?? ""));

      await loadCompanyScopedRows(resolvedCompanyId);
    } catch {
      setError("SA bootstrap workspace could not load governance rows right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (!compact(selectedCompanyId)) {
      return;
    }

    void loadCompanyScopedRows(selectedCompanyId);
  }, [selectedCompanyId]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadBootstrap(selectedCompanyId),
    },
    focusPrimary: {
      perform: () => companySelectRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-org-bootstrap-control-panel",
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
      id: "sa-org-bootstrap-users",
      group: "Current Screen",
      label: "Open Users",
      keywords: ["users", "role", "scope"],
      perform: () => {
        openScreen("SA_USERS", { mode: "replace" });
        navigate("/sa/users");
      },
      order: 20,
    },
    {
      id: "sa-org-bootstrap-modules",
      group: "Current Screen",
      label: "Open Module Governance",
      keywords: ["module", "company modules"],
      perform: () => {
        openScreen("SA_COMPANY_MODULE_MAP", { mode: "replace" });
        navigate("/sa/acl/company-modules");
      },
      order: 30,
    },
    {
      id: "sa-org-bootstrap-approval",
      group: "Current Screen",
      label: "Open Approval Rules",
      keywords: ["approval", "workflow"],
      perform: () => {
        openScreen("SA_APPROVAL_RULES", { mode: "replace" });
        navigate("/sa/approval-rules");
      },
      order: 40,
    },
    {
      id: "sa-org-bootstrap-menu",
      group: "Current Screen",
      label: "Open Menu Governance",
      keywords: ["menu", "navigation"],
      perform: () => {
        openScreen("SA_MENU_GOVERNANCE", { mode: "replace" });
        navigate("/sa/menu");
      },
      order: 50,
    },
  ]);

  async function handleCreateCompany() {
    const companyName = compact(companyDraft.company_name);
    const gstNumber = compact(companyDraft.gst_number).toUpperCase();

    if (!companyName && !gstNumber) {
      setError("Provide a company name or GST number before creating a company.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Org Bootstrap",
      title: "Create Company",
      message: `Create business company ${companyName || gstNumber}?`,
      confirmLabel: "Create Company",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await postJson("/api/admin/company", {
        company_name: companyName || undefined,
        gst_number: gstNumber || undefined,
      });
      const createdCompanyId = data?.company?.id ?? "";

      setCompanyDraft({ company_name: "", gst_number: "" });
      setNotice(
        data?.already_exists
          ? `Company ${data.company.company_code} already existed and is ready for bootstrap.`
          : `Company ${data.company.company_code} created successfully.`
      );
      await loadBootstrap(createdCompanyId);
    } catch {
      setError("Company could not be created right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateGroup() {
    const groupName = compact(groupDraft);

    if (!groupName) {
      setError("Enter a group name before creating a group.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Org Bootstrap",
      title: "Create Group",
      message: `Create group ${groupName}?`,
      confirmLabel: "Create Group",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await postJson("/api/admin/group", {
        name: groupName,
      });
      setGroupDraft("");
      setNotice(`Group ${data.group.group_code} created successfully.`);
      await loadBootstrap(selectedCompanyId);
    } catch {
      setError("Group could not be created right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMapCompanyToGroup() {
    if (!compact(selectedCompanyId) || !compact(groupToMapId)) {
      setError("Select a company and target group before mapping.");
      return;
    }

    const targetGroup = groups.find((row) => String(row.id) === String(groupToMapId));

    const approved = await openActionConfirm({
      eyebrow: "Org Bootstrap",
      title: "Map Company To Group",
      message: `Map ${selectedCompany?.company_code ?? "selected company"} to ${targetGroup?.group_code ?? "selected group"}?`,
      confirmLabel: "Map Company",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/group/map-company", {
        company_id: selectedCompanyId,
        group_id: Number(groupToMapId),
      });
      setNotice(
        `Company ${selectedCompany?.company_code ?? selectedCompanyId} mapped to ${targetGroup?.group_code ?? groupToMapId}.`
      );
      await loadBootstrap(selectedCompanyId);
    } catch {
      setError("Company-to-group mapping could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateProject() {
    const projectName = compact(projectDraft);

    if (!compact(selectedCompanyId) || !projectName) {
      setError("Select a company and enter a project name before creating a project.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Org Bootstrap",
      title: "Create Project",
      message: `Create project ${projectName} for ${selectedCompany?.company_code ?? selectedCompanyId}?`,
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
      const data = await postJson("/api/admin/project", {
        company_id: selectedCompanyId,
        project_name: projectName,
      });
      setProjectDraft("");
      setNotice(`Project ${data.project.project_code} created successfully.`);
      await loadBootstrap(selectedCompanyId);
    } catch {
      setError("Project could not be created right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateDepartment() {
    const departmentName = compact(departmentDraft);

    if (!compact(selectedCompanyId) || !departmentName) {
      setError("Select a company and enter a department name before creating a department.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Org Bootstrap",
      title: "Create Department",
      message: `Create department ${departmentName} for ${selectedCompany?.company_code ?? selectedCompanyId}?`,
      confirmLabel: "Create Department",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await postJson("/api/admin/department", {
        company_id: selectedCompanyId,
        department_name: departmentName,
      });
      setDepartmentDraft("");
      setNotice(`Department ${data.department.department_code} created successfully.`);
      await loadBootstrap(selectedCompanyId);
    } catch {
      setError("Department could not be created right now.");
    } finally {
      setSaving(false);
    }
  }

  const notices = [
    error ? { tone: "error", message: error } : null,
    notice ? { tone: "success", message: notice } : null,
  ].filter(Boolean);

  return (
    <ErpScreenScaffold
      eyebrow="SA Bootstrap"
      title="Organization Bootstrap"
      description="Stand up the organization skeleton from one SA workspace, then hand off into users, modules, approvals, and menu governance without SQL or seed edits."
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh Bootstrap",
          tone: "neutral",
          disabled: loading,
          onClick: () => void loadBootstrap(selectedCompanyId),
        },
        {
          key: "users",
          label: "Users",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_USERS", { mode: "replace" });
            navigate("/sa/users");
          },
        },
        {
          key: "modules",
          label: "Modules",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_COMPANY_MODULE_MAP", { mode: "replace" });
            navigate("/sa/acl/company-modules");
          },
        },
        {
          key: "approval",
          label: "Approval Rules",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_APPROVAL_RULES", { mode: "replace" });
            navigate("/sa/approval-rules");
          },
        },
      ]}
      notices={notices}
      metrics={[
        {
          label: "Companies",
          value: readiness.companies,
          caption: "Business companies ready for steering.",
          tone: "sky",
        },
        {
          label: "Groups",
          value: readiness.groups,
          caption: "Organization groups available for mapping.",
          tone: "emerald",
        },
        {
          label: "Mapped Companies",
          value: readiness.mappedCompanies,
          caption: "Companies already attached to a group.",
          tone: readiness.mappedCompanies === readiness.companies ? "emerald" : "amber",
        },
        {
          label: "Selected Company",
          value: selectedCompany?.company_code ?? "None",
          caption: selectedCompany?.company_name ?? "Pick a company to continue bootstrap.",
          tone: selectedCompany ? "sky" : "amber",
        },
      ]}
      footerHints={[
        "ALT+R REFRESH",
        "ALT+U USERS",
        "ALT+M MENU GOVERNANCE",
        "CTRL+K COMMAND BAR",
      ]}
    >
      <ErpSectionCard
        eyebrow="Context"
        title="Selected Company Context"
        description="Pick the company you want to prepare. Project and department bootstrap work against this target company."
        tone="accent"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
              {companies.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.company_code} | {row.company_name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <ErpFieldPreview
              label="Mapped Group"
              value={
                selectedCompany?.group_code
                  ? `${selectedCompany.group_code} | ${selectedCompany.group_name ?? ""}`
                  : "Not mapped yet"
              }
              caption="A company-to-group map is part of the org skeleton."
            />
            <ErpFieldPreview
              label="Company Status"
              value={selectedCompany?.status ?? "Unknown"}
              caption={selectedCompany?.gst_number ? `GST ${selectedCompany.gst_number}` : "No GST linked yet."}
            />
          </div>
        </div>
      </ErpSectionCard>

      <div className="grid gap-3 xl:grid-cols-2">
        <ErpSectionCard
          eyebrow="Step 1"
          title="Create Company"
          description="Stand up a business company row. GST is optional here; the dedicated company creation workspace is still available when you need GST autofill."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Company Name
              </span>
              <input
                value={companyDraft.company_name}
                onChange={(event) =>
                  setCompanyDraft((current) => ({
                    ...current,
                    company_name: event.target.value,
                  }))
                }
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="Example Industries Private Limited"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                GST Number
              </span>
              <input
                value={companyDraft.gst_number}
                onChange={(event) =>
                  setCompanyDraft((current) => ({
                    ...current,
                    gst_number: event.target.value.toUpperCase(),
                  }))
                }
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="22AAAAA0000A1Z5"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreateCompany()}
              className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Create Company
            </button>
            <button
              type="button"
              onClick={() => {
                openScreen("SA_COMPANY_CREATE", { mode: "replace" });
                navigate("/sa/company/create");
              }}
              className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Open GST Workspace
            </button>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Step 2"
          title="Create Group And Map Company"
          description="Groups hold the organization envelope. Once the group exists, map the selected company into it."
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                New Group Name
              </span>
              <input
                value={groupDraft}
                onChange={(event) => setGroupDraft(event.target.value)}
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="Example Group"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreateGroup()}
              className="self-end border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Create Group
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Map Selected Company To Group
              </span>
              <select
                value={groupToMapId}
                onChange={(event) => setGroupToMapId(event.target.value)}
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
              >
                <option value="">Select group</option>
                {groups.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.group_code} | {row.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={saving || !selectedCompanyId}
              onClick={() => void handleMapCompanyToGroup()}
              className="self-end border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Map Company
            </button>
          </div>
        </ErpSectionCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <ErpSectionCard
          eyebrow="Step 3"
          title="Project Bootstrap"
          description="Create project rows from this bootstrap workspace using the current backend project flow."
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Project Name
              </span>
              <input
                value={projectDraft}
                onChange={(event) => setProjectDraft(event.target.value)}
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="Payroll Implementation"
              />
            </label>
            <button
              type="button"
              disabled={saving || !selectedCompanyId}
              onClick={() => void handleCreateProject()}
              className="self-end border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Create Project
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {projects.length === 0 ? (
              <p className="text-sm text-slate-500">
                No projects yet for the selected company.
              </p>
            ) : (
              projects.map((row) => (
                <div
                  key={row.id}
                  className="border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {row.project_code} | {row.project_name} | {row.status}
                </div>
              ))
            )}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Step 4"
          title="Department Bootstrap"
          description="Departments complete the working scope layer for user mappings and approvals."
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Department Name
              </span>
              <input
                value={departmentDraft}
                onChange={(event) => setDepartmentDraft(event.target.value)}
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="Human Resources"
              />
            </label>
            <button
              type="button"
              disabled={saving || !selectedCompanyId}
              onClick={() => void handleCreateDepartment()}
              className="self-end border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Create Department
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {departments.length === 0 ? (
              <p className="text-sm text-slate-500">
                No departments yet for the selected company.
              </p>
            ) : (
              departments.map((row) => (
                <div
                  key={row.id}
                  className="border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {row.department_code} | {row.department_name} | {row.status}
                </div>
              ))
            )}
          </div>
        </ErpSectionCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <ErpSectionCard
          eyebrow="Read Model"
          title="Companies"
          description="Live business companies with current group mapping state."
        >
          <div className="grid gap-2">
            {companies.length === 0 ? (
              <p className="text-sm text-slate-500">No business companies found yet.</p>
            ) : (
              companies.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedCompanyId(row.id)}
                  className={`border px-3 py-2 text-left text-sm ${
                    row.id === selectedCompanyId
                      ? "border-sky-300 bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <div className="font-semibold">
                    {row.company_code} | {row.company_name}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                    {row.status ?? "UNKNOWN"} | {row.group_code ? `${row.group_code} mapped` : "No group map"}
                  </div>
                </button>
              ))
            )}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Read Model"
          title="Groups"
          description="Active organization envelope with mapped company counts."
        >
          <div className="grid gap-2">
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500">No groups found yet.</p>
            ) : (
              groups.map((row) => (
                <div
                  key={row.id}
                  className="border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  <div className="font-semibold">
                    {row.group_code} | {row.name}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                    {row.state ?? "UNKNOWN"} | {row.company_count} companies
                  </div>
                </div>
              ))
            )}
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
