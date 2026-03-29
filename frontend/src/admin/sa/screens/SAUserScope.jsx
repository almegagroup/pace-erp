/*
 * File-ID: 9.6B-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAUserScope.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin user scope governance surface for Parent Company, Work Company, Work Context, Project, and Department mapping
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import {
  applyQuickFilter,
  sortCompanies,
  sortDepartments,
  sortProjects,
} from "../../../shared/erpCollections.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchUserScope(authUserId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/users/scope?auth_user_id=${encodeURIComponent(authUserId)}`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data) {
    const error = new Error(json?.code ?? "USER_SCOPE_READ_FAILED");
    throw error;
  }

  return json.data;
}

async function saveUserScope(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/users/scope`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    const error = new Error(json?.code ?? "USER_SCOPE_SAVE_FAILED");
    throw error;
  }

  return json.data;
}

function formatIdentityName(user) {
  return user?.name ?? "Unknown User";
}

function extractIds(rows, key = "id") {
  return Array.isArray(rows)
    ? rows.map((row) => row?.[key]).filter(Boolean)
    : [];
}

function formatCompanyMeta(company) {
  const parts = [
    company?.state_name,
    company?.pin_code ? `PIN ${company.pin_code}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "State and PIN not captured";
}

function formatCompanyAddress(company) {
  return company?.full_address ?? "Address not captured";
}

export default function SAUserScope() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authUserId = searchParams.get("auth_user_id") ?? "";

  const actionBarRefs = useRef([]);
  const parentCompanyButtonRef = useRef(null);
  const companySearchRef = useRef(null);
  const workCompanySearchRef = useRef(null);
  const workContextSearchRef = useRef(null);
  const projectSearchRef = useRef(null);
  const departmentSearchRef = useRef(null);
  const companyOptionRefs = useRef([]);
  const workCompanyRefs = useRef([]);
  const workContextRefs = useRef([]);
  const projectRefs = useRef([]);
  const departmentRefs = useRef([]);

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [parentCompanyId, setParentCompanyId] = useState("");
  const [workCompanyIds, setWorkCompanyIds] = useState([]);
  const [workContextIds, setWorkContextIds] = useState([]);
  const [projectIds, setProjectIds] = useState([]);
  const [departmentIds, setDepartmentIds] = useState([]);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [workCompanySearch, setWorkCompanySearch] = useState("");
  const [workContextSearch, setWorkContextSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadScope() {
      if (!authUserId) {
        setLoading(false);
        setPayload(null);
        return;
      }

      setLoading(true);
      setError("");
      setNotice("");

      try {
        const data = await fetchUserScope(authUserId);

        if (!alive) return;

        setPayload(data);
        setParentCompanyId(data.scope?.parent_company?.id ?? "");
        setWorkCompanyIds(extractIds(data.scope?.work_companies));
        setWorkContextIds(extractIds(data.scope?.work_contexts));
        setProjectIds(extractIds(data.scope?.projects));
        setDepartmentIds(extractIds(data.scope?.departments));
      } catch (caughtError) {
        if (!alive) return;
        setError(
          caughtError?.message === "USER_SCOPE_ACL_USER_REQUIRED"
            ? "Scope mapping is available only after the user receives an ACL role."
            : "Unable to load user scope right now."
        );
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadScope();

    return () => {
      alive = false;
    };
  }, [authUserId]);

  const options = payload?.options ?? {};
  const user = payload?.user ?? null;
  const scope = payload?.scope ?? null;

  const availableCompanies = useMemo(
    () => sortCompanies(options.companies ?? []),
    [options.companies]
  );
  const availableProjects = useMemo(
    () => sortProjects(options.projects ?? []),
    [options.projects]
  );
  const availableDepartments = useMemo(
    () => sortDepartments(options.departments ?? []),
    [options.departments]
  );
  const availableWorkContexts = useMemo(
    () =>
      (options.work_contexts ?? [])
        .filter((workContext) =>
          workCompanyIds.length === 0
            ? true
            : workCompanyIds.includes(workContext.company_id)
        )
        .slice()
        .sort((left, right) =>
          `${left.company_code ?? ""}|${left.work_context_code ?? ""}|${left.work_context_name ?? ""}`.localeCompare(
            `${right.company_code ?? ""}|${right.work_context_code ?? ""}|${right.work_context_name ?? ""}`,
            "en",
            { numeric: true, sensitivity: "base" }
          )
        ),
    [options.work_contexts, workCompanyIds]
  );

  const selectedParentCompany =
    availableCompanies.find((company) => company.id === parentCompanyId) ?? null;

  const filteredCompanies = useMemo(
    () =>
      applyQuickFilter(availableCompanies, companySearch, [
        "company_code",
        "company_name",
        "state_name",
        "pin_code",
        "full_address",
      ]),
    [availableCompanies, companySearch]
  );

  const filteredWorkCompanies = useMemo(
    () =>
      applyQuickFilter(availableCompanies, workCompanySearch, [
        "company_code",
        "company_name",
        "state_name",
        "pin_code",
        "full_address",
      ]),
    [availableCompanies, workCompanySearch]
  );

  const filteredProjects = useMemo(
    () =>
      applyQuickFilter(availableProjects, projectSearch, [
        "project_code",
        "project_name",
      ]),
    [availableProjects, projectSearch]
  );

  const filteredDepartments = useMemo(
    () =>
      applyQuickFilter(availableDepartments, departmentSearch, [
        "department_code",
        "department_name",
      ]),
    [availableDepartments, departmentSearch]
  );
  const filteredWorkContexts = useMemo(
    () =>
      applyQuickFilter(availableWorkContexts, workContextSearch, [
        "work_context_code",
        "work_context_name",
        "company_code",
        "company_name",
        "department_code",
        "department_name",
      ]),
    [availableWorkContexts, workContextSearch]
  );

  const readinessFlags = useMemo(
    () =>
      [
        !parentCompanyId ? "Missing Parent Company" : null,
        workCompanyIds.length === 0 ? "No Work Company" : null,
        workContextIds.length === 0 ? "No Work Context" : null,
        !user?.role_code ? "No Role Assigned" : null,
      ].filter(Boolean),
    [parentCompanyId, workCompanyIds.length, workContextIds.length, user?.role_code]
  );

  useEffect(() => {
    const allowedIds = new Set(
      (options.work_contexts ?? [])
        .filter((workContext) => workCompanyIds.includes(workContext.company_id))
        .map((workContext) => workContext.id)
    );

    setWorkContextIds((current) =>
      current.filter((workContextId) => allowedIds.has(workContextId))
    );
  }, [options.work_contexts, workCompanyIds]);

  function toggleSelection(value, current, setter) {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  async function handleSave() {
    if (!authUserId || !parentCompanyId) {
      setError("Select a Parent Company before saving scope.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA User Scope Governance",
      title: "Save ERP User Scope",
      message: `Persist Parent Company and operational scope for ${user?.user_code ?? authUserId} ${formatIdentityName(user)} now?`,
      confirmLabel: "Save Scope",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await saveUserScope({
        auth_user_id: authUserId,
        parent_company_id: parentCompanyId,
        work_company_ids: workCompanyIds,
        work_context_ids: workContextIds,
        project_ids: projectIds,
        department_ids: departmentIds,
      });

      const refreshed = await fetchUserScope(authUserId);
      setPayload(refreshed);
      setParentCompanyId(refreshed.scope?.parent_company?.id ?? "");
      setWorkCompanyIds(extractIds(refreshed.scope?.work_companies));
      setWorkContextIds(extractIds(refreshed.scope?.work_contexts));
      setProjectIds(extractIds(refreshed.scope?.projects));
      setDepartmentIds(extractIds(refreshed.scope?.departments));
      setNotice("User scope saved successfully.");
    } catch (caughtError) {
      setError(
        caughtError?.message === "USER_SCOPE_ACL_USER_REQUIRED"
          ? "Scope mapping is available only for ACL users with an assigned role."
          : "User scope was not finalized by the backend."
      );
    } finally {
      setSaving(false);
    }
  }

  function closeCompanyPicker() {
    setCompanyPickerOpen(false);
    setCompanySearch("");
  }

  function openParentCompanyPicker() {
    setCompanyPickerOpen(true);
    globalThis.setTimeout(() => {
      companySearchRef.current?.focus();
    }, 0);
  }

  function selectParentCompany(companyId) {
    setParentCompanyId(companyId);
    setNotice("");
    closeCompanyPicker();
  }

  useErpScreenHotkeys({
    save: {
      disabled: loading || saving || !authUserId,
      perform: () => void handleSave(),
    },
    focusSearch: {
      perform: () => workCompanySearchRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => parentCompanyButtonRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-user-scope-directory",
      group: "Current Screen",
      label: "Go to user directory",
      keywords: ["users", "directory", "sa users"],
      perform: () => {
        openScreen("SA_USERS", { mode: "replace" });
        navigate("/sa/users");
      },
      order: 10,
    },
    {
      id: "sa-user-scope-roles",
      group: "Current Screen",
      label: "Go to role assignment",
      keywords: ["role assignment", "user roles"],
      perform: () => {
        openScreen("SA_USER_ROLES");
        navigate("/sa/users/roles");
      },
      order: 20,
    },
    {
      id: "sa-user-scope-parent",
      group: "Current Screen",
      label: "Open parent company picker",
      keywords: ["parent company", "company picker", "hr identity"],
      perform: openParentCompanyPicker,
      order: 30,
    },
    {
      id: "sa-user-scope-work",
      group: "Current Screen",
      label: "Focus work company filter",
      keywords: ["work company", "operational scope"],
      perform: () => workCompanySearchRef.current?.focus(),
      order: 40,
    },
    {
      id: "sa-user-scope-work-contexts",
      group: "Current Screen",
      label: "Focus work context filter",
      keywords: ["work context", "functional context"],
      perform: () => workContextSearchRef.current?.focus(),
      order: 50,
    },
    {
      id: "sa-user-scope-projects",
      group: "Current Screen",
      label: "Focus project filter",
      keywords: ["projects", "project scope"],
      perform: () => projectSearchRef.current?.focus(),
      order: 60,
    },
    {
      id: "sa-user-scope-departments",
      group: "Current Screen",
      label: "Focus department filter",
      keywords: ["departments", "department scope"],
      perform: () => departmentSearchRef.current?.focus(),
      order: 65,
    },
    {
      id: "sa-user-scope-save",
      group: "Current Screen",
      label: saving ? "Saving scope..." : "Save user scope",
      hint: "Ctrl+S",
      keywords: ["save scope", "user scope", "persist"],
      disabled: saving || loading || !authUserId,
      perform: () => void handleSave(),
      order: 70,
    },
  ]);

  const topActions = [
    {
      key: "user-directory",
      label: "User Directory",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => {
        openScreen("SA_USERS", { mode: "replace" });
        navigate("/sa/users");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "role-assignment",
      label: "Role Assignment",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => {
        openScreen("SA_USER_ROLES");
        navigate("/sa/users/roles");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save-scope",
      label: saving ? "Saving..." : "Save Scope",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving || loading || !authUserId,
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void handleSave(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const metrics =
    authUserId && payload
      ? [
          {
            key: "user",
            label: "User",
            value: user?.user_code ?? "N/A",
            caption: `${formatIdentityName(user)}${user?.designation_hint ? ` | ${user.designation_hint}` : ""}`,
            tone: "sky",
          },
          {
            key: "parent-company",
            label: "Parent Company",
            value: scope?.parent_company?.company_code ?? "Unset",
            caption:
              scope?.parent_company?.company_name ??
              "HR identity truth is not yet mapped.",
            tone: scope?.parent_company?.company_code ? "emerald" : "amber",
          },
          {
            key: "work-companies",
            label: "Work Companies",
            value: String(workCompanyIds.length),
            caption:
              "Operational company scope currently assigned to this user.",
            tone: workCompanyIds.length > 0 ? "emerald" : "amber",
          },
          {
            key: "work-contexts",
            label: "Work Contexts",
            value: String(workContextIds.length),
            caption:
              "Runtime functional contexts currently available to this user.",
            tone: workContextIds.length > 0 ? "emerald" : "amber",
          },
          {
            key: "readiness",
            label: "Readiness",
            value: readinessFlags.length === 0 ? "Ready" : "Attention",
            caption:
              readinessFlags.length === 0
                ? "Parent, role, and operational company scope are present."
                : readinessFlags.join(" | "),
            tone: readinessFlags.length === 0 ? "emerald" : "rose",
          },
        ]
      : [];

  const notices = [
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
  ];

  const mainContent = !authUserId ? (
    <ErpSectionCard
      eyebrow="Selection Required"
      title="Open this screen from the User Directory"
      description="A governed user must be selected before scope mapping can begin."
    >
      <div className="border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-500">
        Open this screen from the ERP User Directory so a governed user can be selected for scope mapping.
      </div>
    </ErpSectionCard>
  ) : loading ? (
    <ErpSectionCard eyebrow="Loading" title="Fetching scope payload">
      <div className="border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-500">
        Loading user scope from the admin governance endpoint.
      </div>
    </ErpSectionCard>
  ) : !payload ? null : (
    <>
      <div className="grid gap-6 xl:grid-cols-[1.1fr,1fr]">
        <ErpSectionCard
          eyebrow="Parent Company"
          title="HR Identity Binding"
          description="This is the HR authority source for the user. It is not the same thing as operational work scope."
        >
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Select Parent Company
            </span>
            <button
              ref={parentCompanyButtonRef}
              data-workspace-primary-focus="true"
              type="button"
              onClick={openParentCompanyPicker}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" ||
                  event.key === " " ||
                  event.key === "ArrowDown"
                ) {
                  event.preventDefault();
                  openParentCompanyPicker();
                }
              }}
              className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-4 py-3 text-left text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:bg-white"
            >
              <span className="block font-semibold text-slate-900">
                {selectedParentCompany
                  ? `${selectedParentCompany.company_code} - ${selectedParentCompany.company_name}`
                  : "Choose Parent Company"}
              </span>
              <span className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500">
                {selectedParentCompany
                  ? formatCompanyMeta(selectedParentCompany)
                  : "Press Enter to open company picker"}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-600">
                {selectedParentCompany
                  ? formatCompanyAddress(selectedParentCompany)
                  : "State, address, and PIN stay visible during selection."}
              </span>
            </button>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Enter = open picker | Ctrl+S = save scope
            </p>
          </label>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Current Snapshot"
          title="Selected user and readiness"
          description="Keep HR identity and operational scope visible together while editing."
        >
          <div className="space-y-3">
            <div className="border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">
                {user?.user_code ?? "N/A"}
              </span>
              {" - "}
              {formatIdentityName(user)}
            </div>
            <div className="border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
              Role: {user?.role_code ?? "UNASSIGNED"}
            </div>
            <div className="border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
              Parent company: {scope?.parent_company?.company_name ?? "Unset"}
            </div>
            <div className="border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
              Readiness:{" "}
              {readinessFlags.length === 0
                ? "Ready"
                : readinessFlags.join(" | ")}
            </div>
          </div>
        </ErpSectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr,1fr]">
        <ErpSectionCard
          eyebrow="Work Company"
          title="Operational Company Scope"
          description="The user may operate only inside these assigned Work Companies. Approval authority is still governed separately."
        >
          <QuickFilterInput
            label="Filter Work Companies"
            value={workCompanySearch}
            onChange={setWorkCompanySearch}
            inputRef={workCompanySearchRef}
            placeholder="Filter by code, name, state, pin, or address"
            hint="Arrow Down moves into the company checkbox list."
            inputProps={{
              onKeyDown: (event) => {
                if (
                  event.key === "ArrowDown" &&
                  filteredWorkCompanies.length > 0
                ) {
                  event.preventDefault();
                  workCompanyRefs.current[0]?.focus();
                }
              },
            }}
          />

          <div className="mt-5 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
            {filteredWorkCompanies.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No work company matches the current filter.
              </div>
            ) : (
              filteredWorkCompanies.map((company, index) => {
                const selected = workCompanyIds.includes(company.id);

                return (
                  <label
                    key={company.id}
                    className={`flex items-start gap-3 border px-4 py-3 text-sm ${
                      selected
                        ? "border-cyan-300 bg-cyan-50 text-cyan-900"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      ref={(element) => {
                        workCompanyRefs.current[index] = element;
                      }}
                      data-erp-nav-item="true"
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        toggleSelection(company.id, workCompanyIds, setWorkCompanyIds)
                      }
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: workCompanyRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className="mt-1 h-4 w-4 border-slate-300 bg-white text-cyan-600"
                    />
                    <span>
                      <span className="font-semibold">{company.company_code}</span>
                      {" - "}
                      {company.company_name}
                      <span className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {formatCompanyMeta(company)}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">
                        {formatCompanyAddress(company)}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Project Scope"
          title="Reusable Project Mapping"
          description="Projects remain reusable. This surface only maps the user to the project universe they can work inside."
        >
          <QuickFilterInput
            label="Filter Projects"
            value={projectSearch}
            onChange={setProjectSearch}
            inputRef={projectSearchRef}
            placeholder="Filter by project code or project name"
            hint="Arrow Down moves into the project checkbox list."
            inputProps={{
              onKeyDown: (event) => {
                if (
                  event.key === "ArrowDown" &&
                  filteredProjects.length > 0
                ) {
                  event.preventDefault();
                  projectRefs.current[0]?.focus();
                }
              },
            }}
          />

          <div className="mt-5 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
            {filteredProjects.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No project matches the current filter.
              </div>
            ) : (
              filteredProjects.map((project, index) => {
                const selected = projectIds.includes(project.id);

                return (
                  <label
                    key={project.id}
                    className={`flex items-start gap-3 border px-4 py-3 text-sm ${
                      selected
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      ref={(element) => {
                        projectRefs.current[index] = element;
                      }}
                      data-erp-nav-item="true"
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        toggleSelection(project.id, projectIds, setProjectIds)
                      }
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: projectRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className="mt-1 h-4 w-4 border-slate-300 bg-white text-emerald-600"
                    />
                    <span>
                      <span className="font-semibold">{project.project_code}</span>
                      {" - "}
                      {project.project_name}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </ErpSectionCard>
      </div>

      <div className="mt-6">
        <ErpSectionCard
          eyebrow="Work Context"
          title="Runtime Functional Context"
          description="Selected Work Contexts decide which functional capability packs the user may activate inside the selected Work Companies."
        >
          <QuickFilterInput
            label="Filter Work Contexts"
            value={workContextSearch}
            onChange={setWorkContextSearch}
            inputRef={workContextSearchRef}
            placeholder="Filter by company, context, or department"
            hint="Arrow Down moves into the work-context checkbox list."
            inputProps={{
              onKeyDown: (event) => {
                if (
                  event.key === "ArrowDown" &&
                  filteredWorkContexts.length > 0
                ) {
                  event.preventDefault();
                  workContextRefs.current[0]?.focus();
                }
              },
            }}
          />

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {filteredWorkContexts.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                {workCompanyIds.length === 0
                  ? "Select at least one work company to see work-context options."
                  : "No work context matches the current filter."}
              </div>
            ) : (
              filteredWorkContexts.map((workContext, index) => {
                const selected = workContextIds.includes(workContext.id);

                return (
                  <label
                    key={workContext.id}
                    className={`flex items-start gap-3 border px-4 py-3 text-sm ${
                      selected
                        ? "border-violet-300 bg-violet-50 text-violet-900"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      ref={(element) => {
                        workContextRefs.current[index] = element;
                      }}
                      data-erp-nav-item="true"
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        toggleSelection(
                          workContext.id,
                          workContextIds,
                          setWorkContextIds
                        )
                      }
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: workContextRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className="mt-1 h-4 w-4 border-slate-300 bg-white text-violet-600"
                    />
                    <span>
                      <span className="font-semibold">
                        {workContext.work_context_code}
                      </span>
                      {" - "}
                      {workContext.work_context_name}
                      <span className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {workContext.company_code} | {workContext.company_name}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">
                        {workContext.department_code
                          ? `${workContext.department_code} | ${workContext.department_name}`
                          : "Company-wide functional context"}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </ErpSectionCard>
      </div>

      <div className="mt-6">
        <ErpSectionCard
          eyebrow="Department Scope"
          title="Department Mapping"
          description="Department mapping remains visible here so HR identity and later operational readiness can be prepared from one control surface."
        >
          <QuickFilterInput
            label="Filter Departments"
            value={departmentSearch}
            onChange={setDepartmentSearch}
            inputRef={departmentSearchRef}
            placeholder="Filter by department code or department name"
            hint="Arrow Down moves into the department checkbox list."
            inputProps={{
              onKeyDown: (event) => {
                if (
                  event.key === "ArrowDown" &&
                  filteredDepartments.length > 0
                ) {
                  event.preventDefault();
                  departmentRefs.current[0]?.focus();
                }
              },
            }}
          />

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {filteredDepartments.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No department matches the current filter.
              </div>
            ) : (
              filteredDepartments.map((department, index) => {
                const selected = departmentIds.includes(department.id);

                return (
                  <label
                    key={department.id}
                    className={`flex items-start gap-3 border px-4 py-3 text-sm ${
                      selected
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      ref={(element) => {
                        departmentRefs.current[index] = element;
                      }}
                      data-erp-nav-item="true"
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        toggleSelection(
                          department.id,
                          departmentIds,
                          setDepartmentIds
                        )
                      }
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: departmentRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className="mt-1 h-4 w-4 border-slate-300 bg-white text-amber-600"
                    />
                    <span>
                      <span className="font-semibold">
                        {department.department_code}
                      </span>
                      {" - "}
                      {department.department_name}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </ErpSectionCard>
      </div>
    </>
  );

  return (
    <ErpScreenScaffold
      eyebrow="SA User Scope Governance"
      title="ERP User Scope Mapping"
      description="Bind HR identity truth through Parent Company, then assign Work Companies and future operational scope without mixing those responsibilities into a single vague user record."
      actions={topActions}
      notices={notices}
      metrics={metrics}
    >
      {mainContent}

      <DrawerBase
        visible={companyPickerOpen}
        title="Select Parent Company"
        onEscape={closeCompanyPicker}
        initialFocusRef={companySearchRef}
        width="min(620px, calc(100vw - 24px))"
        actions={(
          <button
            type="button"
            onClick={closeCompanyPicker}
            className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <QuickFilterInput
            label="Search Company"
            value={companySearch}
            onChange={setCompanySearch}
            inputRef={companySearchRef}
            placeholder="Search by code, name, state, pin, or address"
            hint="Arrow Down moves into the results. Enter selects the focused company."
            inputProps={{
              onKeyDown: (event) => {
                if (event.key === "ArrowDown" && filteredCompanies.length > 0) {
                  event.preventDefault();
                  companyOptionRefs.current[0]?.focus();
                }
              },
            }}
          />

          <div
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
            style={{ overscrollBehavior: "contain" }}
          >
            {filteredCompanies.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No company matches the current search.
              </div>
            ) : (
              <div
                data-erp-nav-group="true"
                data-erp-nav-axis="vertical"
                className="space-y-2"
              >
                {filteredCompanies.map((company, index) => {
                  const selected = company.id === parentCompanyId;

                  return (
                    <button
                      key={company.id}
                      ref={(element) => {
                        companyOptionRefs.current[index] = element;
                      }}
                      type="button"
                      data-erp-nav-item="true"
                      onClick={() => selectParentCompany(company.id)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: companyOptionRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className={`w-full border px-4 py-4 text-left text-sm transition ${
                        selected
                          ? "border-cyan-300 bg-cyan-50 text-cyan-900"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      <span className="block font-semibold">
                        {company.company_code} - {company.company_name}
                      </span>
                      <span className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {formatCompanyMeta(company)}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {formatCompanyAddress(company)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
