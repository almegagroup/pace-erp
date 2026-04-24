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
import {
  getActiveScreenContext,
  getPreviousScreen,
  openScreen,
  popScreen,
} from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import {
  applyQuickFilter,
  sortCompanies,
  sortDepartments,
  sortProjects,
} from "../../../shared/erpCollections.js";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function buildApiError(json, fallbackCode) {
  const code = json?.code ?? fallbackCode;
  const requestId = json?.request_id ?? json?.requestId ?? null;
  const decisionTrace = json?.decision_trace ?? json?.decisionTrace ?? null;
  const publicMessage =
    typeof json?.message === "string" && json.message.trim().length > 0
      ? json.message.trim()
      : null;
  const message = [
    code,
    decisionTrace && decisionTrace !== code ? decisionTrace : null,
    publicMessage,
    requestId ? `Req ${requestId}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const error = new Error(message || fallbackCode);
  error.code = code;
  error.requestId = requestId;
  error.decisionTrace = decisionTrace;
  error.publicMessage = publicMessage;
  return error;
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
    throw buildApiError(json, "USER_SCOPE_READ_FAILED");
  }

  return json.data;
}

async function setPrimaryCompany(authUserId, companyId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/users/scope/primary-company`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_user_id: authUserId, company_id: companyId }),
    },
  );
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    throw buildApiError(json, "SET_PRIMARY_COMPANY_FAILED");
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
    throw buildApiError(json, "USER_SCOPE_SAVE_FAILED");
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

function sameIdSet(left, right) {
  const normalizedLeft = [...new Set((left ?? []).filter(Boolean))].sort();
  const normalizedRight = [...new Set((right ?? []).filter(Boolean))].sort();

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
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

function formatSelectionPreview(items, formatter, emptyMessage) {
  if (!Array.isArray(items) || items.length === 0) {
    return emptyMessage;
  }

  const preview = items
    .slice(0, 3)
    .map((item) => formatter(item))
    .filter(Boolean)
    .join("\n");

  return items.length > 3 ? `${preview}\n+${items.length - 3} more` : preview;
}

function formatDepartmentLabel(department) {
  const companyLabel = [department?.company_code, department?.company_name]
    .filter(Boolean)
    .join(" | ");
  const departmentLabel = [department?.department_code, department?.department_name]
    .filter(Boolean)
    .join(" | ");

  if (companyLabel && departmentLabel) {
    return `${companyLabel} | ${departmentLabel}`;
  }

  return departmentLabel || companyLabel || "Unknown Department";
}

function humanizeDecisionTrace(decisionTrace) {
  switch (decisionTrace) {
    case "USER_SCOPE_PROJECT_INVALID":
      return "One or more selected projects do not match the currently selected company scope.";
    case "USER_SCOPE_WORK_CONTEXT_INVALID":
      return "One or more selected work contexts are outside the chosen work companies.";
    case "USER_SCOPE_DEPARTMENT_INVALID":
      return "One or more selected departments are outside the chosen company scope.";
    case "USER_SCOPE_DEPARTMENT_WORK_CONTEXT_MISSING":
      return "A selected department is missing its governed department work context.";
    case "USER_SCOPE_SINGLE_DEPARTMENT_REQUIRED":
      return "A user can hold only one HR department at a time.";
    case "USER_SCOPE_COMPANY_INVALID":
      return "One or more selected companies are inactive or not business companies.";
    default:
      return "";
  }
}

function describeAdjustmentSummary(adjustments) {
  const parts = [];

  if ((adjustments?.dropped_project_ids ?? []).length > 0) {
    parts.push(`${adjustments.dropped_project_ids.length} project dropped`);
  }

  if ((adjustments?.derived_department_ids ?? []).length > 0) {
    parts.push(`${adjustments.derived_department_ids.length} department auto-derived`);
  }

  if ((adjustments?.derived_work_context_ids ?? []).length > 0) {
    parts.push(`${adjustments.derived_work_context_ids.length} work context auto-derived`);
  }

  if ((adjustments?.dropped_work_context_ids ?? []).length > 0) {
    parts.push(`${adjustments.dropped_work_context_ids.length} work context dropped`);
  }

  return parts.join(" | ");
}

function describeAdjustmentDetails(adjustments) {
  const parts = [];

  if ((adjustments?.dropped_projects ?? []).length > 0) {
    const projectReasonSummary = adjustments.dropped_projects
      .map((row) =>
        row?.reason === "PROJECT_NOT_ACTIVE"
          ? `${row.project_id} inactive`
          : `${row.project_id} not mapped to the selected company scope`
      )
      .join(" | ");
    parts.push(`Projects adjusted: ${projectReasonSummary}`);
  }

  if ((adjustments?.derived_department_ids ?? []).length > 0) {
    parts.push(
      `Departments auto-derived: ${adjustments.derived_department_ids.join(", ")}`
    );
  }

  if ((adjustments?.derived_work_context_ids ?? []).length > 0) {
    parts.push(
      `Work contexts auto-derived: ${adjustments.derived_work_context_ids.join(", ")}`
    );
  }

  if ((adjustments?.dropped_work_contexts ?? []).length > 0) {
    parts.push(
      `Work contexts removed because they belonged to a different department: ${adjustments.dropped_work_contexts
        .map((row) => row.work_context_id)
        .join(", ")}`
    );
  }

  return parts.join(" | ");
}

function isBenignDerivedDepartmentContext(adjustments) {
  const droppedProjectCount = adjustments?.dropped_project_ids?.length ?? 0;
  const droppedWorkContextCount = adjustments?.dropped_work_context_ids?.length ?? 0;
  const derivedDepartmentCount = adjustments?.derived_department_ids?.length ?? 0;
  const derivedWorkContextCount = adjustments?.derived_work_context_ids?.length ?? 0;

  return (
    droppedProjectCount === 0 &&
    droppedWorkContextCount === 0 &&
    derivedDepartmentCount === 0 &&
    derivedWorkContextCount > 0
  );
}


export default function SAUserScope() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeScreenContext = useMemo(() => getActiveScreenContext(), []);
  const authUserId =
    searchParams.get("auth_user_id") ??
    activeScreenContext?.auth_user_id ??
    "";

  const actionBarRefs = useRef([]);
  const parentCompanyButtonRef = useRef(null);
  const companySearchRef = useRef(null);
  const workCompanySearchRef = useRef(null);
  const workContextSearchRef = useRef(null);
  const projectSearchRef = useRef(null);
  const departmentSearchRef = useRef(null);

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warningNotice, setWarningNotice] = useState("");

  const [parentCompanyId, setParentCompanyId] = useState("");
  const [primaryWorkCompanyId, setPrimaryWorkCompanyId] = useState("");
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [workCompanyIds, setWorkCompanyIds] = useState([]);
  const [workContextIds, setWorkContextIds] = useState([]);
  const [projectIds, setProjectIds] = useState([]);
  const [departmentIds, setDepartmentIds] = useState([]);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [activeScopeEditor, setActiveScopeEditor] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [workCompanySearch, setWorkCompanySearch] = useState("");
  const [workContextSearch, setWorkContextSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");

  function handleReturnToUserDirectory() {
    const previousScreen = getPreviousScreen();

    if (previousScreen?.screen_code === "SA_USERS") {
      popScreen();
      return;
    }

    openScreen("SA_USERS", { mode: "replace" });
    navigate("/sa/users");
  }

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
      setWarningNotice("");

      try {
        const data = await fetchUserScope(authUserId);

        if (!alive) return;

        setPayload(data);
        setParentCompanyId(data.scope?.parent_company?.id ?? "");
        setPrimaryWorkCompanyId(data.scope?.primary_company_id ?? "");
        setWorkCompanyIds(extractIds(data.scope?.work_companies));
        setWorkContextIds(extractIds(data.scope?.work_contexts));
        setProjectIds(extractIds(data.scope?.project_overrides ?? data.scope?.projects));
        setDepartmentIds(extractIds(data.scope?.departments));
      } catch (caughtError) {
        if (!alive) return;
        console.error("USER_SCOPE_READ_FAILED", {
          auth_user_id: authUserId,
          code: caughtError?.code ?? null,
          decisionTrace: caughtError?.decisionTrace ?? null,
          requestId: caughtError?.requestId ?? null,
          message: caughtError?.message ?? "USER_SCOPE_READ_FAILED",
        });
        setError(
          caughtError?.code === "USER_SCOPE_ACL_USER_REQUIRED" ||
            caughtError?.message === "USER_SCOPE_ACL_USER_REQUIRED"
            ? "Scope mapping is available only after the user receives an ACL role."
            : caughtError?.message || "Unable to load user scope right now."
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
  const eligibleProjectCompanyIds = useMemo(
    () => [...new Set([parentCompanyId, ...workCompanyIds].filter(Boolean))],
    [parentCompanyId, workCompanyIds]
  );
  const availableProjects = useMemo(
    () =>
      sortProjects(
        (options.projects ?? []).filter((project) =>
          eligibleProjectCompanyIds.length === 0
            ? true
            : eligibleProjectCompanyIds.includes(project.company_id)
        )
      ),
    [options.projects, eligibleProjectCompanyIds]
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
  const selectedWorkCompanies = useMemo(
    () => availableCompanies.filter((company) => workCompanyIds.includes(company.id)),
    [availableCompanies, workCompanyIds]
  );
  const selectedProjectOverrides = useMemo(
    () => availableProjects.filter((project) => projectIds.includes(project.id)),
    [availableProjects, projectIds]
  );
  const inheritedProjects = scope?.inherited_projects ?? [];
  const effectiveProjects = scope?.effective_projects ?? [];
  const selectedDepartments = useMemo(
    () =>
      availableDepartments.filter((department) => departmentIds.includes(department.id)),
    [availableDepartments, departmentIds]
  );
  const selectedWorkContexts = useMemo(
    () =>
      availableWorkContexts.filter((workContext) =>
        workContextIds.includes(workContext.id)
      ),
    [availableWorkContexts, workContextIds]
  );

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
        "company_code",
        "company_name",
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

  const { getRowProps: getCompanyRowProps } = useErpListNavigation(filteredCompanies);
  const { getRowProps: getWorkCompanyRowProps } = useErpListNavigation(filteredWorkCompanies);
  const { getRowProps: getWorkContextRowProps } = useErpListNavigation(filteredWorkContexts);
  const { getRowProps: getProjectRowProps } = useErpListNavigation(filteredProjects);
  const { getRowProps: getDepartmentRowProps } = useErpListNavigation(filteredDepartments);

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
    const allowedIds = new Set(availableWorkContexts.map((workContext) => workContext.id));

    setWorkContextIds((current) =>
      current.filter((workContextId) => allowedIds.has(workContextId))
    );
  }, [availableWorkContexts]);

  useEffect(() => {
    const allowedProjectIds = new Set(
      (options.projects ?? [])
        .filter((project) =>
          eligibleProjectCompanyIds.length === 0
            ? true
            : eligibleProjectCompanyIds.includes(project.company_id)
        )
        .map((project) => project.id)
    );

    setProjectIds((current) => current.filter((projectId) => allowedProjectIds.has(projectId)));
  }, [options.projects, eligibleProjectCompanyIds]);

  const isScopeDirty = useMemo(() => {
    if (!payload?.scope) {
      return false;
    }

    return (
      parentCompanyId !== (payload.scope?.parent_company?.id ?? "") ||
      !sameIdSet(workCompanyIds, extractIds(payload.scope?.work_companies)) ||
      !sameIdSet(workContextIds, extractIds(payload.scope?.work_contexts)) ||
      !sameIdSet(projectIds, extractIds(payload.scope?.project_overrides ?? payload.scope?.projects)) ||
      !sameIdSet(departmentIds, extractIds(payload.scope?.departments))
    );
  }, [
    departmentIds,
    parentCompanyId,
    payload,
    projectIds,
    workCompanyIds,
    workContextIds,
  ]);

  function toggleSelection(value, current, setter) {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function toggleSingleDepartment(departmentId) {
    setDepartmentIds((current) =>
      current[0] === departmentId ? [] : [departmentId]
    );
  }

  async function handleSave() {
    if (!authUserId || !parentCompanyId) {
      setError("Select a Parent Company before saving scope.");
      return;
    }

    const requestedScope = {
      parent_company_id: parentCompanyId,
      work_company_ids: [...workCompanyIds],
      work_context_ids: [...workContextIds],
      project_ids: [...projectIds],
      department_ids: [...departmentIds],
    };

    setSaving(true);
    setError("");
    setNotice("");
    setWarningNotice("");

    try {
      const savedScope = await saveUserScope({
        auth_user_id: authUserId,
        ...requestedScope,
      });

      const refreshed = await fetchUserScope(authUserId);
      setPayload(refreshed);
      setParentCompanyId(refreshed.scope?.parent_company?.id ?? "");
      setPrimaryWorkCompanyId(refreshed.scope?.primary_company_id ?? "");
      setWorkCompanyIds(extractIds(refreshed.scope?.work_companies));
      setWorkContextIds(extractIds(refreshed.scope?.work_contexts));
      setProjectIds(extractIds(refreshed.scope?.project_overrides ?? refreshed.scope?.projects));
      setDepartmentIds(extractIds(refreshed.scope?.departments));

      const adjustmentSummary = describeAdjustmentSummary(savedScope?.adjustments);
      const wasAdjusted = Boolean(adjustmentSummary);

      console.info("USER_SCOPE_SAVE_RESULT", {
        auth_user_id: authUserId,
        requested: requestedScope,
        persisted: {
          parent_company_id: savedScope?.parent_company_id ?? null,
          work_company_ids: savedScope?.work_company_ids ?? [],
          work_context_ids: savedScope?.work_context_ids ?? [],
          project_ids: savedScope?.project_ids ?? [],
          department_ids: savedScope?.department_ids ?? [],
        },
        adjustments: savedScope?.adjustments ?? null,
      });

      if (wasAdjusted) {
        const benignDerivedContext = isBenignDerivedDepartmentContext(savedScope?.adjustments);

        (benignDerivedContext ? console.info : console.warn)("USER_SCOPE_SAVE_ADJUSTED", {
          auth_user_id: authUserId,
          requested: requestedScope,
          persisted: savedScope,
          adjustments: savedScope?.adjustments ?? null,
        });
        const adjustmentDetails = describeAdjustmentDetails(savedScope?.adjustments);
        if (benignDerivedContext) {
          setNotice(
            `User scope saved successfully. Department-linked work context was auto-added.${adjustmentDetails ? ` ${adjustmentDetails}.` : ""}`
          );
        } else {
          setWarningNotice(
            `User scope saved with backend adjustments. ${adjustmentSummary}.${adjustmentDetails ? ` ${adjustmentDetails}.` : ""} Check console for exact details.`
          );
        }
      } else {
        setNotice("User scope saved successfully.");
      }

      setActiveScopeEditor("");
    } catch (caughtError) {
      console.error("USER_SCOPE_SAVE_FAILED", {
        auth_user_id: authUserId,
        requested: requestedScope,
        code: caughtError?.code ?? null,
        decisionTrace: caughtError?.decisionTrace ?? null,
        requestId: caughtError?.requestId ?? null,
        message: caughtError?.message ?? "USER_SCOPE_SAVE_FAILED",
      });

      const decisionTraceMessage = humanizeDecisionTrace(caughtError?.decisionTrace);
      setError(
        caughtError?.code === "USER_SCOPE_ACL_USER_REQUIRED" ||
          caughtError?.message === "USER_SCOPE_ACL_USER_REQUIRED"
          ? "Scope mapping is available only for ACL users with an assigned role."
          : decisionTraceMessage ||
              caughtError?.message ||
              "User scope was not finalized by the backend."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimaryCompany(companyId) {
    if (!authUserId || !companyId || settingPrimary) {
      return;
    }

    setSettingPrimary(true);
    setError("");

    try {
      await setPrimaryCompany(authUserId, companyId);
      setPrimaryWorkCompanyId(companyId);
      setNotice(
        "Primary company updated. Change takes effect at the user's next login.",
      );
    } catch (caughtError) {
      console.error("SET_PRIMARY_COMPANY_FAILED", {
        auth_user_id: authUserId,
        company_id: companyId,
        code: caughtError?.code ?? null,
        decisionTrace: caughtError?.decisionTrace ?? null,
        requestId: caughtError?.requestId ?? null,
        message: caughtError?.message ?? "SET_PRIMARY_COMPANY_FAILED",
      });
      setError(
        caughtError?.publicMessage ||
          caughtError?.message ||
          "Primary company could not be updated.",
      );
    } finally {
      setSettingPrimary(false);
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

  async function closeScopeEditor() {
    if (activeScopeEditor && isScopeDirty) {
      const approved = await openActionConfirm({
        eyebrow: "SA User Scope Governance",
        title: "Close Without Saving",
        message: "This scope drawer has unsaved changes. Close it without saving?",
        confirmLabel: "Close Without Saving",
        cancelLabel: "Keep Editing",
      });

      if (!approved) {
        return;
      }
    }

    setActiveScopeEditor("");
  }

  function openScopeEditor(scopeKey) {
    setActiveScopeEditor(scopeKey);

    globalThis.setTimeout(() => {
      if (scopeKey === "work-companies") {
        workCompanySearchRef.current?.focus();
      }
      if (scopeKey === "work-contexts") {
        workContextSearchRef.current?.focus();
      }
      if (scopeKey === "projects") {
        projectSearchRef.current?.focus();
      }
      if (scopeKey === "departments") {
        departmentSearchRef.current?.focus();
      }
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
      perform: () => openScopeEditor("work-companies"),
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
      perform: () => handleReturnToUserDirectory(),
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
      label: "Edit work companies",
      keywords: ["work company", "operational scope"],
      perform: () => openScopeEditor("work-companies"),
      order: 40,
    },
    {
      id: "sa-user-scope-work-contexts",
      group: "Current Screen",
      label: "Edit work contexts",
      keywords: ["work context", "functional context"],
      perform: () => openScopeEditor("work-contexts"),
      order: 50,
    },
    {
      id: "sa-user-scope-projects",
      group: "Current Screen",
      label: "Edit projects",
      keywords: ["projects", "project scope"],
      perform: () => openScopeEditor("projects"),
      order: 60,
    },
    {
      id: "sa-user-scope-departments",
      group: "Current Screen",
      label: "Edit departments",
      keywords: ["departments", "department scope"],
      perform: () => openScopeEditor("departments"),
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
      onClick: () => handleReturnToUserDirectory(),
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
      key: "edit-work-scope",
      label: "Edit Work Scope",
      hint: "F3",
      tone: "neutral",
      disabled: loading || !authUserId,
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => openScopeEditor("work-companies"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save-scope",
      label: saving ? "Saving..." : "Save Scope",
      hint: "Ctrl+S | F2",
      tone: "primary",
      disabled: saving || loading || !authUserId,
      buttonRef: (element) => {
        actionBarRefs.current[3] = element;
      },
      onClick: () => void handleSave(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 3,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

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
    ...(warningNotice
      ? [
          {
            key: "warning",
            tone: "warning",
            message: warningNotice,
          },
        ]
      : []),
  ];

  const mainContent = !authUserId ? (
    <div className="grid gap-3">
      <ErpSelectionSection label="Selection Required" />
      <div className="border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-500">
        Open this screen from the ERP User Directory so a governed user can be selected for scope mapping.
      </div>
    </div>
  ) : loading ? (
    <div className="grid gap-3">
      <ErpSelectionSection label="Loading" />
      <div className="border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-500">
        Loading user scope from the admin governance endpoint.
      </div>
    </div>
  ) : !payload ? null : (
    <>
      <div className="grid gap-[var(--erp-section-gap)] xl:grid-cols-[1.1fr,1fr]">
        <div className="grid gap-1">
          <ErpSelectionSection label="Parent Company" />
          <label className="block">
            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
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
              className="mt-1 w-full border border-slate-300 bg-white px-2 py-1.5 text-left text-[12px] text-slate-700 outline-none transition focus:border-sky-500"
            >
              <span className="block font-semibold text-slate-900">
                {selectedParentCompany
                  ? `${selectedParentCompany.company_code} — ${selectedParentCompany.company_name}`
                  : "Choose Parent Company"}
              </span>
              <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {selectedParentCompany
                  ? formatCompanyMeta(selectedParentCompany)
                  : "Enter = open picker"}
              </span>
              {selectedParentCompany ? (
                <span className="block text-[10px] text-slate-500">
                  {formatCompanyAddress(selectedParentCompany)}
                </span>
              ) : null}
            </button>
            <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Enter = open picker | Ctrl+S = save scope
            </p>
          </label>
        </div>

        <div className="grid gap-1">
          <ErpSelectionSection label="Current Snapshot" />
          <div className="border border-slate-300 bg-white">
            {[
              [`${user?.user_code ?? "N/A"} — ${formatIdentityName(user)}`, ""],
              ["Role", user?.role_code ?? "UNASSIGNED"],
              ["Parent Company", scope?.parent_company?.company_name ?? "Unset"],
              ["Readiness", readinessFlags.length === 0 ? "Ready" : readinessFlags.join(" | ")],
              ["Work Companies", `${workCompanyIds.length} selected`],
              ["Work Contexts", `${workContextIds.length} selected`],
            ].map(([label, value], i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px] last:border-b-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
                {value ? <span className="text-[11px] font-semibold text-slate-900">{value}</span> : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-[var(--erp-section-gap)] xl:grid-cols-[1.15fr,0.85fr]">
        <div className="grid gap-1">
          <ErpSelectionSection label="Work Scope" />
          <div className="border border-slate-300 bg-white">
            {[
              {
                label: "Work Companies",
                count: workCompanyIds.length,
                summary: formatSelectionPreview(
                  selectedWorkCompanies,
                  (company) => `${company.company_code} - ${company.company_name}`,
                  "No work company selected yet."
                ),
                scopeKey: "work-companies",
                required: true,
              },
              {
                label: "Work Contexts",
                count: workContextIds.length,
                summary: formatSelectionPreview(
                  selectedWorkContexts,
                  (workContext) =>
                    `${workContext.work_context_code} - ${workContext.work_context_name}`,
                  workCompanyIds.length === 0
                    ? "Select work companies first."
                    : "No work context selected yet."
                ),
                scopeKey: "work-contexts",
                required: true,
              },
              {
                label: "Project Overrides",
                count: projectIds.length,
                summary: formatSelectionPreview(
                  selectedProjectOverrides,
                  (project) => `${project.project_code} - ${project.project_name}`,
                  "No direct override selected."
                ),
                scopeKey: "projects",
                required: false,
              },
              {
                label: "Departments",
                count: departmentIds.length,
                summary: formatSelectionPreview(
                  selectedDepartments,
                  (department) => formatDepartmentLabel(department),
                  "No department selected yet."
                ),
                scopeKey: "departments",
                required: false,
              },
            ].map(({ label, count, summary, scopeKey, required }) => (
              <div
                key={scopeKey}
                className="grid grid-cols-[140px_24px_1fr_auto] items-center gap-2 border-b border-slate-200 px-2 py-[3px] last:border-b-0"
              >
                <span className="text-[11px] text-slate-600">{label}</span>
                <span
                  className={`text-[11px] font-bold ${
                    count > 0
                      ? "text-emerald-700"
                      : required
                        ? "text-amber-600"
                        : "text-slate-400"
                  }`}
                >
                  {count}
                </span>
                <span className="truncate text-[11px] text-slate-700">{summary}</span>
                <button
                  type="button"
                  onClick={() => openScopeEditor(scopeKey)}
                  disabled={loading || !authUserId}
                  className="border border-sky-300 bg-sky-50 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-900 disabled:opacity-50"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-1">
          <ErpSelectionSection label="Selection Preview" />
          <div className="border border-slate-300 bg-white">
            {[
              {
                label: "Work Companies",
                value: formatSelectionPreview(selectedWorkCompanies, (c) => `${c.company_code} — ${c.company_name}`, "None selected"),
              },
              {
                label: "Work Contexts",
                value: formatSelectionPreview(selectedWorkContexts, (wc) => `${wc.work_context_code} — ${wc.work_context_name}`, workCompanyIds.length === 0 ? "Select work companies first" : "None selected"),
              },
              {
                label: "Project Overrides",
                value: formatSelectionPreview(selectedProjectOverrides, (p) => `${p.project_code} — ${p.project_name}`, "No direct override"),
              },
              {
                label: "Departments",
                value: formatSelectionPreview(selectedDepartments, formatDepartmentLabel, "None selected"),
              },
              {
                label: "Inherited Projects",
                value: formatSelectionPreview(inheritedProjects, (p) => `${p.project_code} — ${p.project_name}`, "No inherited reach yet"),
              },
              {
                label: "Effective Projects",
                value: formatSelectionPreview(effectiveProjects, (p) => `${p.project_code} — ${p.project_name}`, "No effective reach yet"),
              },
            ].map(({ label, value }) => (
              <div key={label} className="border-b border-slate-200 px-2 py-[3px] last:border-b-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                <p className="whitespace-pre-wrap text-[11px] leading-[1.5] text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[9px] uppercase tracking-[0.12em] text-slate-400">
            F3 or summary buttons open the editor drawers
          </p>
        </div>
      </div>
    </>
  );

  return (
    <ErpScreenScaffold
      eyebrow="SA User Scope Governance"
      title="ERP User Scope Mapping"
      actions={topActions}
      notices={notices}
      footerHints={["↑↓ Navigate", "Ctrl+S Save Scope", "F3 Edit Scope", "Esc Back", "Ctrl+K Command Bar"]}
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
            className="border border-slate-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-700"
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
                      {...getCompanyRowProps(index)}
                      type="button"
                      data-erp-nav-item="true"
                      onClick={() => selectParentCompany(company.id)}
                      className={`w-full border px-2 py-1 text-left text-[12px] transition ${
                        selected
                          ? "border-cyan-400 bg-cyan-50 text-cyan-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block font-semibold text-slate-900">
                        {company.company_code} — {company.company_name}
                      </span>
                      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {formatCompanyMeta(company)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={activeScopeEditor === "work-companies"}
        title="Edit Work Companies"
        onEscape={closeScopeEditor}
        initialFocusRef={workCompanySearchRef}
        width="min(760px, calc(100vw - 24px))"
        actions={(
          <>
            <button
              type="button"
              onClick={() => void closeScopeEditor()}
              className="border border-slate-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-700"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving || loading || !authUserId}
              onClick={() => void handleSave()}
              className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold text-sky-950"
            >
              {saving ? "Saving..." : "Save Scope"}
            </button>
          </>
        )}
      >
        <div className="grid gap-4">
          <QuickFilterInput
            label="Filter Work Companies"
            value={workCompanySearch}
            onChange={setWorkCompanySearch}
            inputRef={workCompanySearchRef}
            placeholder="Filter by code, name, state, pin, or address"
            hint="Arrow Down moves into the company checkbox list."
          />

          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {filteredWorkCompanies.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No work company matches the current filter.
              </div>
            ) : (
              filteredWorkCompanies.map((company, index) => {
                const selected = workCompanyIds.includes(company.id);
                const isPrimary = selected && company.id === primaryWorkCompanyId;

                return (
                  <div
                    key={company.id}
                    className={`border px-2 py-1 text-[12px] ${
                      selected
                        ? "border-cyan-300 bg-cyan-50 text-cyan-900"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        {...getWorkCompanyRowProps(index)}
                        data-erp-nav-item="true"
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          toggleSelection(company.id, workCompanyIds, setWorkCompanyIds)
                        }
                        className="h-3 w-3 border-slate-300 bg-white text-cyan-600"
                      />
                      <span className="flex-1">
                        <span className="font-semibold">{company.company_code}</span>
                        {" — "}
                        {company.company_name}
                        <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          {formatCompanyMeta(company)}
                        </span>
                      </span>
                      {selected ? (
                        isPrimary ? (
                          <span className="border border-emerald-300 bg-emerald-50 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-800">
                            Primary
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={settingPrimary || !authUserId}
                            onClick={() => void handleSetPrimaryCompany(company.id)}
                            className="border border-slate-300 bg-white px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-700 hover:border-sky-300 hover:text-sky-800 disabled:opacity-50"
                          >
                            {settingPrimary ? "..." : "Set Primary"}
                          </button>
                        )
                      ) : null}
                    </label>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={activeScopeEditor === "work-contexts"}
        title="Edit Work Contexts"
        onEscape={closeScopeEditor}
        initialFocusRef={workContextSearchRef}
        width="min(860px, calc(100vw - 24px))"
        actions={(
          <>
            <button
              type="button"
              onClick={() => void closeScopeEditor()}
              className="border border-slate-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-700"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving || loading || !authUserId}
              onClick={() => void handleSave()}
              className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold text-sky-950"
            >
              {saving ? "Saving..." : "Save Scope"}
            </button>
          </>
        )}
      >
        <div className="grid gap-4">
          <QuickFilterInput
            label="Filter Work Contexts"
            value={workContextSearch}
            onChange={setWorkContextSearch}
            inputRef={workContextSearchRef}
            placeholder="Filter by company, context, or department"
            hint="Arrow Down moves into the work-context checkbox list."
          />

          <div className="grid gap-3 md:grid-cols-2">
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
                    className={`flex items-center gap-2 border px-2 py-1 text-[12px] cursor-pointer ${
                      selected
                        ? "border-violet-300 bg-violet-50 text-violet-900"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      {...getWorkContextRowProps(index)}
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
                      className="h-3 w-3 border-slate-300 bg-white text-violet-600"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold">{workContext.work_context_code}</span>
                      {" — "}
                      {workContext.work_context_name}
                      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {workContext.company_code}
                        {workContext.department_code ? ` | ${workContext.department_code}` : ""}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={activeScopeEditor === "projects"}
        title="Edit Project Overrides"
        onEscape={closeScopeEditor}
        initialFocusRef={projectSearchRef}
        width="min(760px, calc(100vw - 24px))"
        actions={(
          <>
            <button
              type="button"
              onClick={() => void closeScopeEditor()}
              className="border border-slate-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-700"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving || loading || !authUserId}
              onClick={() => void handleSave()}
              className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold text-sky-950"
            >
              {saving ? "Saving..." : "Save Scope"}
            </button>
          </>
        )}
      >
        <div className="grid gap-4">
          <QuickFilterInput
            label="Filter Projects"
            value={projectSearch}
            onChange={setProjectSearch}
            inputRef={projectSearchRef}
            placeholder="Filter by project code or project name"
            hint="Arrow Down moves into the override checkbox list."
          />

          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
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
                    className={`flex items-center gap-2 border px-2 py-1 text-[12px] cursor-pointer ${
                      selected
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      {...getProjectRowProps(index)}
                      data-erp-nav-item="true"
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        toggleSelection(project.id, projectIds, setProjectIds)
                      }
                      className="h-3 w-3 border-slate-300 bg-white text-emerald-600"
                    />
                    <span className="font-semibold">{project.project_code}</span>
                    {" — "}
                    {project.project_name}
                  </label>
                );
              })
            )}
          </div>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={activeScopeEditor === "departments"}
        title="Edit Departments"
        onEscape={closeScopeEditor}
        initialFocusRef={departmentSearchRef}
        width="min(760px, calc(100vw - 24px))"
        actions={(
          <>
            <button
              type="button"
              onClick={() => void closeScopeEditor()}
              className="border border-slate-300 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-700"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving || loading || !authUserId}
              onClick={() => void handleSave()}
              className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold text-sky-950"
            >
              {saving ? "Saving..." : "Save Scope"}
            </button>
          </>
        )}
      >
        <div className="grid gap-4">
          <QuickFilterInput
            label="Filter Departments"
            value={departmentSearch}
            onChange={setDepartmentSearch}
            inputRef={departmentSearchRef}
            placeholder="Filter by department code or department name"
            hint="Arrow Down moves into the department list. Only one department can stay selected."
          />

          <div className="grid gap-3 md:grid-cols-2">
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
                    className={`flex items-center gap-2 border px-2 py-1 text-[12px] cursor-pointer ${
                      selected
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      {...getDepartmentRowProps(index)}
                      data-erp-nav-item="true"
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSingleDepartment(department.id)}
                      className="h-3 w-3 border-slate-300 bg-white text-amber-600"
                    />
                    <span className="font-semibold">{formatDepartmentLabel(department)}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
