/*
 * File-ID: 9.6B-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAUserScope.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin user scope governance surface for Parent Company, Work Company, Project, and Department mapping
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
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
    },
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

function SummaryCard({ label, value, caption }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <h3 className="mt-3 text-2xl font-semibold text-slate-900">{value}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
    </article>
  );
}

function formatIdentityName(user) {
  return user?.name ?? "Unknown User";
}

function extractIds(rows, key = "id") {
  return Array.isArray(rows) ? rows.map((row) => row?.[key]).filter(Boolean) : [];
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

function formatCompanyOptionLabel(company) {
  const suffixParts = [
    company?.state_name,
    company?.pin_code ? `PIN ${company.pin_code}` : null,
    company?.full_address,
  ].filter(Boolean);

  return suffixParts.length > 0
    ? `${company.company_code} - ${company.company_name} | ${suffixParts.join(" | ")}`
    : `${company.company_code} - ${company.company_name}`;
}

export default function SAUserScope() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authUserId = searchParams.get("auth_user_id") ?? "";
  const companySearchRef = useRef(null);
  const actionBarRefs = useRef([]);
  const companyOptionRefs = useRef([]);
  const workCompanyRefs = useRef([]);
  const projectRefs = useRef([]);
  const departmentRefs = useRef([]);

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [parentCompanyId, setParentCompanyId] = useState("");
  const [workCompanyIds, setWorkCompanyIds] = useState([]);
  const [projectIds, setProjectIds] = useState([]);
  const [departmentIds, setDepartmentIds] = useState([]);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [workCompanySearch, setWorkCompanySearch] = useState("");
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

      try {
        const data = await fetchUserScope(authUserId);

        if (!alive) return;

        setPayload(data);
        setParentCompanyId(data.scope?.parent_company?.id ?? "");
        setWorkCompanyIds(extractIds(data.scope?.work_companies));
        setProjectIds(extractIds(data.scope?.projects));
        setDepartmentIds(extractIds(data.scope?.departments));
      } catch (error) {
        if (!alive) return;
        setError(
          error?.message === "USER_SCOPE_ACL_USER_REQUIRED"
            ? "Scope mapping is available only after the user receives an ACL role."
            : "Unable to load user scope right now.",
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
    [options.companies],
  );
  const availableProjects = useMemo(
    () => sortProjects(options.projects ?? []),
    [options.projects],
  );
  const availableDepartments = useMemo(
    () => sortDepartments(options.departments ?? []),
    [options.departments],
  );
  const selectedParentCompany =
    availableCompanies.find((company) => company.id === parentCompanyId) ?? null;

  const filteredCompanies = useMemo(() => {
    return applyQuickFilter(availableCompanies, companySearch, [
      "company_code",
      "company_name",
      "state_name",
      "pin_code",
      "full_address",
    ]);
  }, [availableCompanies, companySearch]);

  const filteredWorkCompanies = useMemo(
    () =>
      applyQuickFilter(availableCompanies, workCompanySearch, [
        "company_code",
        "company_name",
        "state_name",
        "pin_code",
        "full_address",
      ]),
    [availableCompanies, workCompanySearch],
  );

  const filteredProjects = useMemo(
    () =>
      applyQuickFilter(availableProjects, projectSearch, [
        "project_code",
        "project_name",
      ]),
    [availableProjects, projectSearch],
  );

  const filteredDepartments = useMemo(
    () =>
      applyQuickFilter(availableDepartments, departmentSearch, [
        "department_code",
        "department_name",
      ]),
    [availableDepartments, departmentSearch],
  );

  const readinessFlags = useMemo(
    () => [
      !parentCompanyId ? "Missing Parent Company" : null,
      workCompanyIds.length === 0 ? "No Work Company" : null,
      !user?.role_code ? "No Role Assigned" : null,
    ].filter(Boolean),
    [parentCompanyId, workCompanyIds.length, user?.role_code],
  );

  function toggleSelection(value, current, setter) {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
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

    try {
      await saveUserScope({
        auth_user_id: authUserId,
        parent_company_id: parentCompanyId,
        work_company_ids: workCompanyIds,
        project_ids: projectIds,
        department_ids: departmentIds,
      });

      const refreshed = await fetchUserScope(authUserId);
      setPayload(refreshed);
      setParentCompanyId(refreshed.scope?.parent_company?.id ?? "");
      setWorkCompanyIds(extractIds(refreshed.scope?.work_companies));
      setProjectIds(extractIds(refreshed.scope?.projects));
      setDepartmentIds(extractIds(refreshed.scope?.departments));
    } catch (error) {
      setError(
        error?.message === "USER_SCOPE_ACL_USER_REQUIRED"
          ? "Scope mapping is available only for ACL users with an assigned role."
          : "User scope was not finalized by the backend.",
      );
    } finally {
      setSaving(false);
    }
  }

  function closeCompanyPicker() {
    setCompanyPickerOpen(false);
    setCompanySearch("");
  }

  function selectParentCompany(companyId) {
    setParentCompanyId(companyId);
    closeCompanyPicker();
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();

      if (!loading && !saving && authUserId) {
        void handleSave();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, saving, authUserId, parentCompanyId, workCompanyIds, projectIds, departmentIds, user]);

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-4 z-20 rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA User Scope Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP User Scope Mapping
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Bind HR identity truth through Parent Company, then assign
                Work Companies and future operational scope without mixing
                those responsibilities into a single vague user record.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                ref={(element) => {
                  actionBarRefs.current[0] = element;
                }}
                type="button"
                onClick={() => {
                  openScreen("SA_USERS", { mode: "replace" });
                  navigate("/sa/users");
                }}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 0,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                User Directory
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[1] = element;
                }}
                type="button"
                onClick={() => {
                  openScreen("SA_USER_ROLES");
                  navigate("/sa/users/roles");
                }}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 1,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Role Assignment
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[2] = element;
                }}
                type="button"
                disabled={saving || loading || !authUserId}
                onClick={() => void handleSave()}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 2,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className={`rounded-2xl px-4 py-3 text-sm font-semibold shadow-[0_10px_24px_rgba(14,116,144,0.08)] ${
                  saving || loading || !authUserId
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "border border-sky-200 bg-sky-50 text-sky-700"
                }`}
              >
                {saving ? "Saving..." : "Save Scope"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]">
            {error}
          </div>
        ) : null}

        {!authUserId ? (
          <div className="mt-6 rounded-[30px] border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-600">
            Open this screen from the ERP User Directory so a governed user can
            be selected for scope mapping.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-[30px] border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-600">
            Loading user scope from the admin governance endpoint.
          </div>
        ) : !payload ? null : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="User"
                value={user?.user_code ?? "N/A"}
                caption={`${formatIdentityName(user)}${user?.designation_hint ? ` • ${user.designation_hint}` : ""}`}
              />
              <SummaryCard
                label="Parent Company"
                value={scope?.parent_company?.company_code ?? "Unset"}
                caption={scope?.parent_company?.company_name ?? "HR identity truth is not yet mapped."}
              />
              <SummaryCard
                label="Work Companies"
                value={String(workCompanyIds.length)}
                caption="Operational company scope currently assigned to this user."
              />
              <SummaryCard
                label="Readiness"
                value={readinessFlags.length === 0 ? "Ready" : "Attention"}
                caption={
                  readinessFlags.length === 0
                    ? "Parent, role, and operational company scope are present."
                    : readinessFlags.join(" • ")
                }
              />
            </div>

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr,1fr]">
              <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Parent Company
                </p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">
                  HR Identity Binding
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  This is the HR authority source for the user. It is not the
                  same thing as operational work scope.
                </p>

                <label className="mt-5 block">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Select Parent Company
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompanyPickerOpen(true)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" ||
                        event.key === " " ||
                        event.key === "ArrowDown"
                      ) {
                        event.preventDefault();
                        setCompanyPickerOpen(true);
                      }
                    }}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
                  >
                    <span className="block font-semibold text-slate-900">
                      {selectedParentCompany
                        ? `${selectedParentCompany.company_code} - ${selectedParentCompany.company_name}`
                        : "Choose Parent Company"}
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                      {selectedParentCompany
                        ? formatCompanyMeta(selectedParentCompany)
                        : "Press Enter to open company picker"}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      {selectedParentCompany
                        ? formatCompanyAddress(selectedParentCompany)
                        : "State, address, and PIN stay visible during selection."}
                    </span>
                  </button>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Enter = open picker | Ctrl+S = save scope
                  </p>
                </label>
              </article>

              <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Work Company
                </p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">
                  Operational Company Scope
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  The user may operate only inside these assigned Work
                  Companies. Approval authority is still governed separately.
                </p>

                <QuickFilterInput
                  className="mt-5"
                  label="Filter Work Companies"
                  value={workCompanySearch}
                  onChange={setWorkCompanySearch}
                  placeholder="Filter by code, name, state, pin, or address"
                  hint="Arrow keys move through company checkboxes."
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
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      No work company matches the current filter.
                    </div>
                  ) : filteredWorkCompanies.map((company, index) => {
                    const selected = workCompanyIds.includes(company.id);

                    return (
                      <label
                        key={company.id}
                        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                          selected
                            ? "border-sky-200 bg-sky-50 text-sky-800"
                            : "border-slate-200 bg-slate-50 text-slate-700"
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
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600"
                        />
                        <span>
                          <span className="font-semibold">{company.company_code}</span>
                          {" - "}
                          {company.company_name}
                          <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                            {formatCompanyMeta(company)}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {formatCompanyAddress(company)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </article>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-2">
              <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Project Scope
                </p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">
                  Reusable Project Mapping
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Projects remain reusable. This surface only maps the user to
                  the project universe they can work inside.
                </p>

                <QuickFilterInput
                  className="mt-5"
                  label="Filter Projects"
                  value={projectSearch}
                  onChange={setProjectSearch}
                  placeholder="Filter by project code or project name"
                  hint="Arrow keys move through project checkboxes."
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
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      No project matches the current filter.
                    </div>
                  ) : filteredProjects.map((project, index) => {
                    const selected = projectIds.includes(project.id);

                    return (
                      <label
                        key={project.id}
                        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                          selected
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-slate-50 text-slate-700"
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
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                        <span>
                          <span className="font-semibold">{project.project_code}</span>
                          {" - "}
                          {project.project_name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </article>

              <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Department Scope
                </p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">
                  Department Mapping
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Department mapping remains visible here so HR identity and
                  later operational readiness can be prepared from one control
                  surface.
                </p>

                <QuickFilterInput
                  className="mt-5"
                  label="Filter Departments"
                  value={departmentSearch}
                  onChange={setDepartmentSearch}
                  placeholder="Filter by department code or department name"
                  hint="Arrow keys move through department checkboxes."
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

                <div className="mt-5 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
                  {filteredDepartments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      No department matches the current filter.
                    </div>
                  ) : filteredDepartments.map((department, index) => {
                    const selected = departmentIds.includes(department.id);

                    return (
                      <label
                        key={department.id}
                        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                          selected
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-slate-50 text-slate-700"
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
                              setDepartmentIds,
                            )
                          }
                          onKeyDown={(event) =>
                            handleLinearNavigation(event, {
                              index,
                              refs: departmentRefs.current,
                              orientation: "vertical",
                            })
                          }
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600"
                        />
                        <span>
                          <span className="font-semibold">{department.department_code}</span>
                          {" - "}
                          {department.department_name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </article>
            </section>
          </>
        )}

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
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
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

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {filteredCompanies.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  No company matches the current search.
                </div>
              ) : (
                <div className="space-y-3">
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
                      className={`w-full rounded-2xl border px-4 py-4 text-left text-sm transition ${
                        selected
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <span className="block font-semibold">
                        {company.company_code} - {company.company_name}
                      </span>
                      <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
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
      </div>
    </section>
  );
}
