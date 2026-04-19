import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  formatCompanyAddress,
  formatCompanyLabel,
  formatCompanyOptionLabel,
} from "../../../shared/companyDisplay.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchCompanies() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/companies`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.companies)) {
    throw new Error(json?.code ?? "COMPANY_LIST_FAILED");
  }

  return json.data.companies;
}

async function fetchDepartments(companyId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/departments?company_id=${encodeURIComponent(companyId)}`,
    {
      credentials: "include",
    }
  );
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.departments)) {
    throw new Error(json?.code ?? "DEPARTMENT_LIST_FAILED");
  }

  return json.data.departments;
}

async function createDepartment(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/department`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.department) {
    throw new Error(json?.code ?? "DEPARTMENT_CREATE_FAILED");
  }

  return json.data.department;
}

async function updateDepartmentState(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/department/state`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "DEPARTMENT_STATE_UPDATE_FAILED");
  }

  return json.data;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function sortCompanies(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left.company_code ?? ""} ${left.company_name ?? ""}`.trim();
    const rightValue = `${right.company_code ?? ""} ${right.company_name ?? ""}`.trim();

    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function sortDepartments(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left.department_code ?? ""} ${left.department_name ?? ""}`.trim();
    const rightValue = `${right.department_code ?? ""} ${right.department_name ?? ""}`.trim();

    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export default function SADepartmentMaster() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const createInputRef = useRef(null);
  const departmentRefs = useRef([]);
  const companySelectRef = useRef(null);
  const selectedCompanyIdRef = useRef("");
  const selectedDepartmentIdRef = useRef("");
  const lastLoadedCompanyIdRef = useRef("");
  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedCompany = useMemo(
    () => companies.find((row) => row.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );

  const selectedDepartment = useMemo(
    () => departments.find((row) => row.id === selectedDepartmentId) ?? null,
    [departments, selectedDepartmentId]
  );

  useEffect(() => {
    selectedCompanyIdRef.current = selectedCompanyId;
  }, [selectedCompanyId]);

  useEffect(() => {
    selectedDepartmentIdRef.current = selectedDepartmentId;
  }, [selectedDepartmentId]);

  const readiness = useMemo(() => {
    const activeDepartments = departments.filter((row) => row.status === "ACTIVE").length;
    const readyContexts = departments.filter((row) => row.derived_work_context).length;
    const totalAssignedUsers = departments.reduce(
      (sum, row) => sum + Number(row.derived_work_context?.assigned_user_count ?? 0),
      0
    );

    return {
      departments: departments.length,
      activeDepartments,
      readyContexts,
      totalAssignedUsers,
    };
  }, [departments]);

  const loadCompaniesAndDepartments = useCallback(
    async (preferredCompanyId = "", preferredDepartmentId = "") => {
      setLoading(true);
      setError("");

      try {
        const companyRows = sortCompanies(await fetchCompanies());
        const resolvedCompanyId =
          normalize(preferredCompanyId) ||
          normalize(selectedCompanyIdRef.current) ||
          companyRows[0]?.id ||
          "";

        setCompanies(companyRows);
        setSelectedCompanyId(resolvedCompanyId);
        lastLoadedCompanyIdRef.current = resolvedCompanyId;

        if (!resolvedCompanyId) {
          setDepartments([]);
          setSelectedDepartmentId("");
          return;
        }

        const departmentRows = sortDepartments(await fetchDepartments(resolvedCompanyId));
        setDepartments(departmentRows);

        const resolvedDepartmentId =
          normalize(preferredDepartmentId) ||
          normalize(selectedDepartmentIdRef.current) ||
          departmentRows[0]?.id ||
          "";

        setSelectedDepartmentId(resolvedDepartmentId);
      } catch {
        setError("Department master foundation could not load right now.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadDepartmentsForCompany = useCallback(
    async (companyId, preferredDepartmentId = "") => {
      if (!normalize(companyId)) {
        setDepartments([]);
        setSelectedDepartmentId("");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const departmentRows = sortDepartments(await fetchDepartments(companyId));
        setDepartments(departmentRows);
        lastLoadedCompanyIdRef.current = companyId;
        setSelectedDepartmentId(
          normalize(preferredDepartmentId) ||
            normalize(selectedDepartmentIdRef.current) ||
            departmentRows[0]?.id ||
            ""
        );
      } catch {
        setError("Departments could not be loaded for the selected company.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadCompaniesAndDepartments();
  }, [loadCompaniesAndDepartments]);

  useEffect(() => {
    if (!normalize(selectedCompanyId)) {
      return;
    }

    const existsInCompanyList = companies.some((row) => row.id === selectedCompanyId);
    if (!existsInCompanyList) {
      return;
    }

    if (lastLoadedCompanyIdRef.current === selectedCompanyId) {
      return;
    }

    void loadDepartmentsForCompany(selectedCompanyId);
  }, [companies, loadDepartmentsForCompany, selectedCompanyId]);

  async function handleCreateDepartment() {
    const normalizedName = normalize(departmentName);

    if (!selectedCompanyId || !normalizedName) {
      setError("Select a company and enter a department name before creating.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Department Master",
      title: "Create Department",
      message: `Create ${normalizedName} for ${formatCompanyLabel(selectedCompany, { separator: " - " })}?`,
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
      const createdDepartment = await createDepartment({
        company_id: selectedCompanyId,
        department_name: normalizedName,
      });

      setDepartmentName("");
      setNotice(
        `Department ${createdDepartment.department_code} created with its derived work context foundation.`
      );
      await loadDepartmentsForCompany(selectedCompanyId, createdDepartment.id);
      createInputRef.current?.focus();
    } catch (createError) {
      setError(
        createError?.message === "REQUEST_BLOCKED" && normalizedName.length < 2
          ? "Department name must be at least 2 characters."
          : "Department could not be created right now."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDepartmentStateChange(nextStatus) {
    if (!selectedDepartment) {
      setError("Select a department before changing state.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Department Master",
      title: `${nextStatus === "ACTIVE" ? "Activate" : "Inactivate"} Department`,
      message: `${nextStatus === "ACTIVE" ? "Activate" : "Inactivate"} ${selectedDepartment.department_code}?`,
      confirmLabel: nextStatus === "ACTIVE" ? "Activate" : "Inactivate",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await updateDepartmentState({
        department_id: selectedDepartment.id,
        next_status: nextStatus,
      });
      setNotice(
        `Department ${selectedDepartment.department_code} is now ${nextStatus}. Derived work-context state has been synced.`
      );
      await loadDepartmentsForCompany(selectedCompanyId, selectedDepartment.id);
    } catch {
      setError("Department state could not be updated right now.");
    } finally {
      setSaving(false);
    }
  }

  useErpScreenCommands([
    {
      id: "sa-department-master-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing department foundation..." : "Refresh department foundation",
      keywords: ["refresh", "department", "foundation"],
      disabled: loading,
      perform: () => void loadCompaniesAndDepartments(selectedCompanyId, selectedDepartmentId),
      order: 10,
    },
    {
      id: "sa-department-master-focus-company",
      group: "Current Screen",
      label: "Focus company selector",
      keywords: ["company", "department company"],
      perform: () => companySelectRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-department-master-focus-create",
      group: "Current Screen",
      label: "Focus create department",
      keywords: ["department create", "department name"],
      perform: () => createInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-department-master-user-scope",
      group: "Current Screen",
      label: "Open user scope",
      keywords: ["user scope", "department assignments"],
      perform: () => {
        openScreen("SA_USER_SCOPE", { mode: "replace" });
        navigate("/sa/users/scope");
      },
      order: 40,
    },
    {
      id: "sa-department-master-work-contexts",
      group: "Current Screen",
      label: "Open work context master",
      keywords: ["work context", "work scope", "manual scope"],
      perform: () => {
        openScreen("SA_WORK_CONTEXT_MASTER", { mode: "replace" });
        navigate("/sa/work-contexts");
      },
      order: 45,
    },
    {
      id: "sa-department-master-capability",
      group: "Current Screen",
      label: "Open capability governance",
      keywords: ["capability governance", "work context capabilities"],
      perform: () => {
        openScreen("SA_CAPABILITY_GOVERNANCE", { mode: "replace" });
        navigate("/sa/acl/capabilities");
      },
      order: 50,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadCompaniesAndDepartments(selectedCompanyId, selectedDepartmentId),
    },
    focusPrimary: {
      perform: () => createInputRef.current?.focus(),
    },
    focusSearch: {
      perform: () => companySelectRef.current?.focus(),
    },
  });

  const notices = [
    error ? { tone: "error", message: error } : null,
    notice ? { tone: "success", message: notice } : null,
  ].filter(Boolean);

  return (
    <ErpScreenScaffold
      eyebrow="Department Foundation"
      title="Department Master"
      description="Create company-bound departments now, let the backend derive `DEPT_*` work contexts automatically, and leave detailed business-page capability wiring for later."
      notices={notices}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "primary",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => void loadCompaniesAndDepartments(selectedCompanyId, selectedDepartmentId),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "work-contexts",
          label: "Work Context Master",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[1] = element;
          },
          onClick: () => {
            openScreen("SA_WORK_CONTEXT_MASTER", { mode: "replace" });
            navigate("/sa/work-contexts");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "user-scope",
          label: "User Scope",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[2] = element;
          },
          onClick: () => {
            openScreen("SA_USER_SCOPE", { mode: "replace" });
            navigate("/sa/users/scope");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 2,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "capabilities",
          label: "Capability Governance",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[3] = element;
          },
          onClick: () => {
            openScreen("SA_CAPABILITY_GOVERNANCE", { mode: "replace" });
            navigate("/sa/acl/capabilities");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 3,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      metrics={[
        {
          label: "Departments",
          value: readiness.departments,
          caption: "Departments created inside the selected company.",
          tone: "sky",
        },
        {
          label: "Active",
          value: readiness.activeDepartments,
          caption: "Departments currently available for user mapping.",
          tone: "emerald",
        },
        {
          label: "Derived Contexts",
          value: readiness.readyContexts,
          caption: "Department rows already carrying their `DEPT_*` work context.",
          tone: readiness.readyContexts === readiness.departments ? "emerald" : "amber",
        },
        {
          label: "Assigned Users",
          value: readiness.totalAssignedUsers,
          caption: "Users already bound into department-derived contexts.",
          tone: "slate",
        },
      ]}
      footerHints={[
        "ALT+R REFRESH",
        "ALT+S COMPANY",
        "CTRL+K COMMAND BAR",
        "ENTER CREATE",
      ]}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="grid gap-3">
          <ErpSectionCard
            eyebrow="Context"
            title="Selected Company"
            description="Departments remain per-company. Pick the business company you want to structure."
          >
            <div className="grid gap-3">
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

              <div className="grid gap-3 md:grid-cols-3">
                <ErpFieldPreview
                  label="Company Status"
                  value={selectedCompany?.status ?? "Unknown"}
                  caption="Department activation follows company lifecycle."
                />
                <ErpFieldPreview
                  label="Company Address"
                  value={formatCompanyAddress(selectedCompany)}
                  caption="Keep the registered office visible while creating departments."
                />
                <ErpFieldPreview
                  label="Mapped Group"
                  value={
                    selectedCompany?.group_code
                      ? `${selectedCompany.group_code} | ${selectedCompany.group_name ?? ""}`
                      : "Not mapped"
                  }
                  caption="Useful later for governance grouping, but not required for department create."
                />
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Create"
            title="Create Department"
            description="This creates the department row first. The backend immediately derives the matching `DEPT_*` work context."
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Department Name
                </span>
                <input
                  ref={createInputRef}
                  value={departmentName}
                  onChange={(event) => setDepartmentName(event.target.value)}
                  className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                  placeholder="QA, HR, Accounts, Purchase"
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
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Roster"
            title="Department Inventory"
            description="Choose a department to inspect its derived work context and lifecycle readiness."
          >
            <div className="grid gap-2">
              {loading ? (
                <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  Loading department inventory...
                </p>
              ) : departments.length === 0 ? (
                <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  No departments created for the selected company yet.
                </p>
              ) : (
                departments.map((department, index) => {
                  const isSelected = department.id === selectedDepartmentId;

                  return (
                    <button
                      key={department.id}
                      ref={(element) => {
                        departmentRefs.current[index] = element;
                      }}
                      type="button"
                      onClick={() => setSelectedDepartmentId(department.id)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: departmentRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className={`border px-4 py-3 text-left ${
                        isSelected
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      <div className="font-semibold">
                        {department.department_code} | {department.department_name}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                        {department.status} |{" "}
                        {department.derived_work_context?.work_context_code ?? "No derived context"}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ErpSectionCard>
        </div>

        <div className="grid gap-3">
          <ErpSectionCard
            eyebrow="Selected Department"
            title={
              selectedDepartment
                ? `${selectedDepartment.department_code} | ${selectedDepartment.department_name}`
                : "Choose A Department"
            }
            description="Department is the business identity layer. The derived work context is the runtime access layer."
          >
            {selectedDepartment ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <ErpFieldPreview
                    label="Department Status"
                    value={selectedDepartment.status}
                    caption="Inactive departments also push their derived work context inactive."
                  />
                  <ErpFieldPreview
                    label="Created"
                    value={
                      selectedDepartment.created_at
                        ? new Date(selectedDepartment.created_at).toLocaleDateString()
                        : "Unknown"
                    }
                    caption="Canonical department row create date."
                  />
                  <ErpFieldPreview
                    label="Assigned Users"
                    value={selectedDepartment.derived_work_context?.assigned_user_count ?? 0}
                    caption="Users currently bound to this department-derived context."
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || selectedDepartment.status === "ACTIVE"}
                    onClick={() => void handleDepartmentStateChange("ACTIVE")}
                    className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    disabled={saving || selectedDepartment.status === "INACTIVE"}
                    onClick={() => void handleDepartmentStateChange("INACTIVE")}
                    className="border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Inactivate
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Select a department from the roster to inspect its runtime foundation.
              </p>
            )}
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Runtime Layer"
            title="Derived Work Context"
            description="This is the runtime work scope ACL will evaluate later. Business pages can be assigned after the team foundation already exists."
            tone="accent"
          >
            {selectedDepartment?.derived_work_context ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview
                  label="Work Context Code"
                  value={selectedDepartment.derived_work_context.work_context_code}
                  caption="Auto-derived from the department code."
                  tone="success"
                />
                <ErpFieldPreview
                  label="Work Context State"
                  value={
                    selectedDepartment.derived_work_context.is_active ? "ACTIVE" : "INACTIVE"
                  }
                  caption="Synced from company + department lifecycle."
                  tone="success"
                />
                <ErpFieldPreview
                  label="Capability Count"
                  value={selectedDepartment.derived_work_context.capability_count}
                  caption="Can stay zero for now until business pages and capability packs are ready."
                />
                <ErpFieldPreview
                  label="Assigned Users"
                  value={selectedDepartment.derived_work_context.assigned_user_count}
                  caption="User Scope binds people into this runtime context."
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No derived work context found yet for this department.
              </p>
            )}
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Next Step"
            title="How To Use This Foundation"
            description="You can safely create team foundations now even before business pages exist."
            tone="warning"
          >
            <div className="grid gap-2">
              {[ 
                "Create the department now so the company team structure is real.",
                "Let the backend auto-create the matching DEPT_* work scope.",
                "Open Work Context Master for manual scopes like PROD_POWDER, QA_ADMIX, SCM_OPERATIONS, or MGMT_ALL.",
                "Later, when business pages exist, assign screen packs and ACL to each exact work scope.",
                "Use User Scope to bind users into the right department-derived work scope.",
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
  );
}
