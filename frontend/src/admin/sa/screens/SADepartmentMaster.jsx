import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
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

  const { getRowProps: getDepartmentRowProps } = useErpListNavigation(departments);

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
      footerHints={["↑↓ Navigate", "Enter Select", "Ctrl+S Save", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <ErpSelectionSection label="Selected Company" />
            <div className="grid gap-3">
              <label className="grid grid-cols-[100px_1fr] items-center gap-x-2">
                <span className="text-[11px] text-slate-600">Company</span>
                <select
                  ref={companySelectRef}
                  value={selectedCompanyId}
                  onChange={(event) => setSelectedCompanyId(event.target.value)}
                  className="h-7 border border-slate-300 bg-[#fffef7] px-2 py-0.5 text-[12px] text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white"
                >
                  <option value="">Select company</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {formatCompanyOptionLabel(company)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="border border-slate-300 bg-white">
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Company Status</span>
                  <span className="text-[11px] font-semibold text-slate-900">{selectedCompany?.status ?? "Unknown"}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Company Address</span>
                  <span className="max-w-[60%] text-right text-[11px] font-semibold text-slate-900">{formatCompanyAddress(selectedCompany)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Mapped Group</span>
                  <span className="text-[11px] font-semibold text-slate-900">
                    {selectedCompany?.group_code
                      ? `${selectedCompany.group_code} | ${selectedCompany.group_name ?? ""}`
                      : "Not mapped"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Create Department" />
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <label className="grid grid-cols-[100px_1fr] items-center gap-x-2">
                <span className="text-[11px] text-slate-600">Department Name</span>
                <input
                  ref={createInputRef}
                  value={departmentName}
                  onChange={(event) => setDepartmentName(event.target.value)}
                  className="h-7 border border-slate-300 bg-[#fffef7] px-2 py-0.5 text-[12px] text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="QA, HR, Accounts, Purchase"
                />
              </label>

              <button
                type="button"
                disabled={saving || !selectedCompanyId}
                onClick={() => void handleCreateDepartment()}
                className="border border-sky-300 bg-sky-50 px-2 py-[3px] text-[11px] font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                Create Department
              </button>
            </div>
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Department Inventory" />
            <div className="grid gap-2">
              {loading ? (
                <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Loading department inventory...
                </p>
              ) : departments.length === 0 ? (
                <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No departments created for the selected company yet.
                </p>
              ) : (
                departments.map((department, index) => {
                  const isSelected = department.id === selectedDepartmentId;

                  return (
                    <button
                      key={department.id}
                      {...getDepartmentRowProps(index)}
                      type="button"
                      onClick={() => setSelectedDepartmentId(department.id)}
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
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <ErpSelectionSection
              label={
                selectedDepartment
                  ? `${selectedDepartment.department_code} | ${selectedDepartment.department_name}`
                  : "Choose A Department"
              }
            />
            {selectedDepartment ? (
              <>
                <div className="border border-slate-300 bg-white">
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Department Status</span>
                    <span className="text-[11px] font-semibold text-slate-900">{selectedDepartment.status}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Created</span>
                    <span className="text-[11px] font-semibold text-slate-900">{selectedDepartment.created_at ? new Date(selectedDepartment.created_at).toLocaleDateString() : "Unknown"}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Assigned Users</span>
                    <span className="text-[11px] font-semibold text-slate-900">{selectedDepartment.derived_work_context?.assigned_user_count ?? 0}</span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={saving || selectedDepartment.status === "ACTIVE"}
                    onClick={() => void handleDepartmentStateChange("ACTIVE")}
                    className="border border-emerald-300 bg-emerald-50 px-2 py-[3px] text-[11px] font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    disabled={saving || selectedDepartment.status === "INACTIVE"}
                    onClick={() => void handleDepartmentStateChange("INACTIVE")}
                    className="border border-rose-300 bg-rose-50 px-2 py-[3px] text-[11px] font-semibold text-rose-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
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
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Derived Work Context" />
            {selectedDepartment?.derived_work_context ? (
              <div className="border border-slate-300 bg-white">
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Work Context Code</span>
                  <span className="text-[11px] font-semibold text-emerald-800">{selectedDepartment.derived_work_context.work_context_code}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Work Context State</span>
                  <span className="text-[11px] font-semibold text-slate-900">{selectedDepartment.derived_work_context.is_active ? "ACTIVE" : "INACTIVE"}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Capability Count</span>
                  <span className="text-[11px] font-semibold text-slate-900">{selectedDepartment.derived_work_context.capability_count}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]">
                  <span className="text-[11px] text-slate-500">Assigned Users</span>
                  <span className="text-[11px] font-semibold text-slate-900">{selectedDepartment.derived_work_context.assigned_user_count}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No derived work context found yet for this department.
              </p>
            )}
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="How To Use This Foundation" />
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
                  className="border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
