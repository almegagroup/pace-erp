import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";
import {
  formatCompanyAddress,
  formatCompanyLabel,
  formatCompanyOptionLabel,
} from "../../../shared/companyDisplay.js";
import {
  deleteViewerRule,
  fetchReportVisibilityWorkspace,
  saveViewerRule,
} from "./approvalWorkspaceApi.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function sortByLabel(rows, labelSelector) {
  return [...rows].sort((left, right) =>
    labelSelector(left).localeCompare(labelSelector(right), "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function buildUserLabel(row) {
  const code = row?.user_code ? `${row.user_code} | ` : "";
  const name = row?.name ?? row?.auth_user_id ?? "Unknown User";
  const role = row?.role_code ? ` | ${row.role_code}` : "";
  const company = row?.parent_company_code ? ` | ${row.parent_company_code}` : "";
  return `${code}${name}${role}${company}`;
}

function buildWorkContextLabel(row) {
  if (!row) {
    return "Company-wide";
  }

  const primary = row.work_context_name || row.department_name || row.work_context_code;
  const secondary = row.work_context_name ? row.work_context_code : row.department_name;
  const company = row.company_code ? `${row.company_code} | ` : "";

  return `${company}${primary}${secondary ? ` | ${secondary}` : ""}`;
}

const VISIBILITY_SCOPE_OPTIONS = [
  {
    value: "COMPANY_WIDE",
    label: "Company-wide",
    description: "Broad report visibility across every requester lane in the company.",
  },
  {
    value: "DEPARTMENT",
    label: "Department",
    description: "Visible for one requester department lane.",
  },
  {
    value: "WORK_CONTEXT",
    label: "Work Context",
    description: "Visible for one exact requester lane or subgroup.",
  },
  {
    value: "USER_EXCEPTION",
    label: "User Exception",
    description: "Visible only when a specific requester is involved.",
  },
  {
    value: "DIRECTOR",
    label: "Director Broad",
    description: "Broad director-level business visibility for the company.",
  },
];

function buildVisibilityScopeLabel(scopeType) {
  return (
    VISIBILITY_SCOPE_OPTIONS.find((option) => option.value === String(scopeType ?? "").trim().toUpperCase())
      ?.label ?? "Company-wide"
  );
}

function createEmptyDraft() {
  return {
    viewer_id: null,
    company_id: "",
    project_code: "",
    module_code: "",
    resource_code: "",
    action_code: "VIEW",
    scope_type: "COMPANY_WIDE",
    subject_work_context_id: "",
    subject_user_id: "",
    target_mode: "user",
    viewer_user_id: "",
    viewer_role_code: ERP_ROLE_OPTIONS[0]?.code ?? "DIRECTOR",
  };
}

export default function SAReportVisibility() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const [workspace, setWorkspace] = useState({
    companies: [],
    projects: [],
    modules: [],
    resources: [],
    work_contexts: [],
    users: [],
    viewer_rules: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState(createEmptyDraft);

  const loadWorkspace = useCallback(async (preferred = draft) => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchReportVisibilityWorkspace();
      setWorkspace({
        companies: data?.companies ?? [],
        projects: data?.projects ?? [],
        modules: data?.modules ?? [],
        resources: data?.resources ?? [],
        work_contexts: data?.work_contexts ?? [],
        users: data?.users ?? [],
        viewer_rules: data?.viewer_rules ?? [],
      });
      setDraft((current) => ({ ...current, ...preferred }));
    } catch (err) {
      console.error("REPORT_VISIBILITY_WORKSPACE_LOAD_FAILED", {
        code: err?.code ?? null,
        decisionTrace: err?.decisionTrace ?? null,
        requestId: err?.requestId ?? null,
        message: err?.message ?? "REPORT_VISIBILITY_WORKSPACE_LIST_FAILED",
      });
      setError(
        err instanceof Error
          ? `Report visibility workspace could not be loaded. ${err.message}`
          : "Report visibility workspace could not be loaded right now.",
      );
    } finally {
      setLoading(false);
    }
  }, [draft]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const companyOptions = useMemo(
    () =>
      sortByLabel(
        workspace.companies,
        (row) => `${row.company_code ?? ""} ${row.company_name ?? ""}`.trim(),
      ),
    [workspace.companies],
  );
  const selectedCompany = useMemo(
    () => workspace.companies.find((row) => row.id === draft.company_id) ?? null,
    [workspace.companies, draft.company_id],
  );

  const projectOptions = useMemo(() => {
    const moduleProjectCodes = new Set(workspace.modules.map((row) => row.project_code).filter(Boolean));
    return sortByLabel(
      workspace.projects.filter((row) => moduleProjectCodes.has(row.project_code)),
      (row) => `${row.project_code ?? ""} ${row.project_name ?? ""}`.trim(),
    );
  }, [workspace.projects, workspace.modules]);

  const moduleOptions = useMemo(
    () =>
      sortByLabel(
        workspace.modules.filter((row) => !draft.project_code || row.project_code === draft.project_code),
        (row) => `${row.project_code ?? ""} ${row.module_code ?? ""} ${row.module_name ?? ""}`.trim(),
      ),
    [workspace.modules, draft.project_code],
  );

  const resourceOptions = useMemo(
    () =>
      sortByLabel(
        workspace.resources.filter((row) =>
          (!draft.project_code || row.project_code === draft.project_code) &&
          (!draft.module_code || row.module_code === draft.module_code) &&
          row.available_actions?.some((action) => ["VIEW", "EXPORT"].includes(action)),
        ),
        (row) => `${row.project_code ?? ""} ${row.module_code ?? ""} ${row.title ?? ""}`.trim(),
      ),
    [workspace.resources, draft.project_code, draft.module_code],
  );

  const actionOptions = useMemo(() => {
    const resource = resourceOptions.find((row) => row.resource_code === draft.resource_code) ?? null;
    const actions = (resource?.available_actions ?? []).filter((action) => ["VIEW", "EXPORT"].includes(action));
    return actions.length > 0 ? actions : ["VIEW"];
  }, [resourceOptions, draft.resource_code]);

  useEffect(() => {
    if (!actionOptions.includes(draft.action_code)) {
      setDraft((current) => ({ ...current, action_code: actionOptions[0] ?? "VIEW" }));
    }
  }, [actionOptions, draft.action_code]);

  const subjectScopeOptions = useMemo(
    () =>
      sortByLabel(
        workspace.work_contexts.filter((row) => {
          if (draft.company_id && row.company_id !== draft.company_id) {
            return false;
          }

          const workContextCode = String(row.work_context_code ?? "").trim().toUpperCase();
          if (draft.scope_type === "DEPARTMENT") {
            return workContextCode.startsWith("DEPT_");
          }

          if (draft.scope_type === "WORK_CONTEXT") {
            return !workContextCode.startsWith("DEPT_");
          }

          return true;
        }),
        (row) =>
          `${row.company_code ?? ""} ${row.work_context_code ?? ""} ${row.department_code ?? ""} ${row.department_name ?? ""}`.trim(),
      ),
    [workspace.work_contexts, draft.company_id, draft.scope_type],
  );

  const userOptions = useMemo(() => {
    return sortByLabel(
      workspace.users.filter((row) => {
        const needle = normalizeText(searchQuery).toLowerCase();
        if (!needle) {
          return true;
        }
        return buildUserLabel(row).toLowerCase().includes(needle);
      }),
      (row) => buildUserLabel(row),
    );
  }, [workspace.users, searchQuery]);

  const filteredRules = useMemo(() => {
    const needle = normalizeText(searchQuery).toLowerCase();

    return workspace.viewer_rules.filter((row) => {
      if (draft.company_id && row.company_id !== draft.company_id) return false;
      if (draft.module_code && row.module_code !== draft.module_code) return false;
      if (draft.resource_code && row.resource_code !== draft.resource_code) return false;
      if (draft.subject_work_context_id && row.subject_work_context_id !== draft.subject_work_context_id) return false;

      if (!needle) return true;

      const targetUser = workspace.users.find((user) => user.auth_user_id === row.viewer_user_id);
      const scope = workspace.work_contexts.find((item) => item.work_context_id === row.subject_work_context_id);
      const requesterUser = workspace.users.find((user) => user.auth_user_id === row.subject_user_id);
      const haystack = [
        row.company_id,
        row.module_code,
        row.resource_code,
        row.action_code,
        row.scope_type,
        row.viewer_role_code,
        targetUser ? buildUserLabel(targetUser) : "",
        requesterUser ? buildUserLabel(requesterUser) : "",
        scope?.work_context_code,
        scope?.department_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [
    workspace.viewer_rules,
    workspace.users,
    workspace.work_contexts,
    draft.company_id,
    draft.module_code,
    draft.resource_code,
    draft.subject_work_context_id,
    searchQuery,
  ]);

  const { getRowProps } = useErpListNavigation(filteredRules);

  async function handleSave() {
    if (!draft.company_id || !draft.module_code || !draft.resource_code) {
      setError("Company, module, and exact report resource are required.");
      return;
    }

    if ((draft.scope_type === "DEPARTMENT" || draft.scope_type === "WORK_CONTEXT") && !draft.subject_work_context_id) {
      setError("Choose the requester lane for DEPARTMENT or WORK_CONTEXT visibility.");
      return;
    }

    if (draft.scope_type === "USER_EXCEPTION" && !draft.subject_user_id) {
      setError("Choose the requester user for USER_EXCEPTION visibility.");
      return;
    }

    if (draft.target_mode === "user" && !draft.viewer_user_id) {
      setError("Choose a viewer user.");
      return;
    }

    if (draft.target_mode === "role" && !draft.viewer_role_code) {
      setError("Choose a viewer role.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const payload = {
        viewer_id: draft.viewer_id ?? undefined,
        company_id: draft.company_id,
        module_code: draft.module_code,
        resource_code: draft.resource_code,
        action_code: draft.action_code,
        scope_type: draft.scope_type,
        subject_work_context_id:
          draft.scope_type === "DEPARTMENT" || draft.scope_type === "WORK_CONTEXT"
            ? draft.subject_work_context_id || undefined
            : undefined,
        subject_user_id: draft.scope_type === "USER_EXCEPTION" ? draft.subject_user_id || undefined : undefined,
        viewer_user_id: draft.target_mode === "user" ? draft.viewer_user_id : undefined,
        viewer_role_code: draft.target_mode === "role" ? draft.viewer_role_code : undefined,
      };
      const savedRule = await saveViewerRule(payload);
      console.info("REPORT_VIEWER_RULE_SAVE_RESULT", {
        requested: payload,
        persisted: savedRule ?? null,
      });
      await loadWorkspace({ ...draft, viewer_id: null });
      setDraft((current) => ({ ...current, viewer_id: null }));
      setNotice("Report visibility rule saved.");
    } catch (err) {
      console.error("REPORT_VIEWER_RULE_SAVE_FAILED", {
        requested: {
          viewer_id: draft.viewer_id ?? null,
          company_id: draft.company_id,
          module_code: draft.module_code,
          resource_code: draft.resource_code,
          action_code: draft.action_code,
          scope_type: draft.scope_type,
          subject_work_context_id:
            draft.scope_type === "DEPARTMENT" || draft.scope_type === "WORK_CONTEXT"
              ? draft.subject_work_context_id || null
              : null,
          subject_user_id: draft.scope_type === "USER_EXCEPTION" ? draft.subject_user_id || null : null,
          viewer_user_id: draft.target_mode === "user" ? draft.viewer_user_id : null,
          viewer_role_code: draft.target_mode === "role" ? draft.viewer_role_code : null,
        },
        code: err?.code ?? null,
        decisionTrace: err?.decisionTrace ?? null,
        requestId: err?.requestId ?? null,
        message: err?.message ?? "REPORT_VIEWER_RULE_UPSERT_FAILED",
      });
      setError(
        err instanceof Error
          ? `Report visibility rule could not be saved. ${err.message}`
          : "Report visibility rule could not be saved right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule) {
    const approved = await openActionConfirm({
      eyebrow: "Approval Governance",
      title: "Delete Report Visibility Rule",
      message: `Delete report visibility rule for ${rule.resource_code}?`,
      confirmLabel: "Delete Rule",
      cancelLabel: "Cancel",
    });

    if (!approved) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await deleteViewerRule(rule.viewer_id);
      console.info("REPORT_VIEWER_RULE_DELETE_RESULT", {
        viewer_id: rule.viewer_id,
        resource_code: rule.resource_code ?? null,
        module_code: rule.module_code ?? null,
      });
      await loadWorkspace(draft);
      setNotice("Report visibility rule deleted.");
    } catch (err) {
      console.error("REPORT_VIEWER_RULE_DELETE_FAILED", {
        viewer_id: rule.viewer_id,
        code: err?.code ?? null,
        decisionTrace: err?.decisionTrace ?? null,
        requestId: err?.requestId ?? null,
        message: err?.message ?? "REPORT_VIEWER_RULE_DELETE_FAILED",
      });
      setError(
        err instanceof Error
          ? `Report visibility rule could not be deleted. ${err.message}`
          : "Report visibility rule could not be deleted right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleRulePick(rule) {
    const resource = workspace.resources.find((row) => row.resource_code === rule.resource_code) ?? null;
    const module = workspace.modules.find((row) => row.module_code === rule.module_code) ?? null;
    setDraft({
      viewer_id: rule.viewer_id,
      company_id: rule.company_id,
      project_code: resource?.project_code ?? module?.project_code ?? "",
      module_code: rule.module_code,
      resource_code: rule.resource_code,
      action_code: rule.action_code ?? "VIEW",
      scope_type: rule.scope_type ?? "COMPANY_WIDE",
      subject_work_context_id: rule.subject_work_context_id ?? "",
      subject_user_id: rule.subject_user_id ?? "",
      target_mode: rule.viewer_user_id ? "user" : "role",
      viewer_user_id: rule.viewer_user_id ?? "",
      viewer_role_code: rule.viewer_role_code ?? ERP_ROLE_OPTIONS[0]?.code ?? "DIRECTOR",
    });
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="Approval Governance"
      title="Who Can See Reports"
      actions={[
        {
          key: "approver",
          label: "Approver Rules",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_APPROVAL_RULES", { mode: "replace" });
            navigate("/sa/approval-rules");
          },
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => void loadWorkspace(),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "save",
          label: saving ? "Saving..." : draft.viewer_id ? "Update Rule" : "Save Rule",
          tone: "primary",
          disabled: saving,
          buttonRef: (element) => {
            actionRefs.current[1] = element;
          },
          onClick: () => void handleSave(),
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
      filterSection={{
        eyebrow: "Visibility Filters",
        title: "Choose report scope",
        children: (
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Company
                </span>
                <select
                  value={draft.company_id}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      company_id: event.target.value,
                      subject_work_context_id: "",
                      subject_user_id: "",
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose company</option>
                  {companyOptions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {formatCompanyOptionLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Project
                </span>
                <select
                  value={draft.project_code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      project_code: event.target.value,
                      module_code: "",
                      resource_code: "",
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose project</option>
                  {projectOptions.map((row) => (
                    <option key={row.id} value={row.project_code}>
                      {row.project_code} | {row.project_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Module
                </span>
                <select
                  value={draft.module_code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      module_code: event.target.value,
                      resource_code: "",
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose module</option>
                  {moduleOptions.map((row) => (
                    <option key={row.module_code} value={row.module_code}>
                      {row.project_code} | {row.module_code} | {row.module_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Report Resource
                </span>
                <select
                  value={draft.resource_code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      resource_code: event.target.value,
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose resource</option>
                  {resourceOptions.map((row) => (
                    <option key={row.resource_code} value={row.resource_code}>
                      {row.title} | {row.resource_code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <QuickFilterInput
              label="Search rules or viewers"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search by viewer, scope, company, module, or resource"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border border-slate-300 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Selected Company
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {selectedCompany ? formatCompanyLabel(selectedCompany) : "Choose company"}
                </p>
              </div>
              <div className="border border-slate-300 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Company Address
                </p>
                <p className="mt-2 text-sm text-slate-700">{formatCompanyAddress(selectedCompany)}</p>
              </div>
            </div>
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Existing Viewer Rules",
        title: loading ? "Loading visibility rules" : `${filteredRules.length} visible viewer rule${filteredRules.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading report visibility rules.
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No report visibility rule matches the current filter.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredRules.map((row, index) => {
              const user = workspace.users.find((item) => item.auth_user_id === row.viewer_user_id) ?? null;
              const scope = workspace.work_contexts.find((item) => item.work_context_id === row.subject_work_context_id) ?? null;
              const resource = workspace.resources.find((item) => item.resource_code === row.resource_code) ?? null;
              const requesterUser = workspace.users.find((item) => item.auth_user_id === row.subject_user_id) ?? null;

              return (
                <button
                  key={row.viewer_id}
                  {...getRowProps(index)}
                  type="button"
                  onClick={() => handleRulePick(row)}
                  className={`border px-4 py-4 text-left ${
                    draft.viewer_id === row.viewer_id ? "border-sky-400 bg-sky-50" : "border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {resource?.title ?? row.resource_code}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {row.module_code} | {row.resource_code} | {row.action_code}
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        {user ? buildUserLabel(user) : ERP_ROLE_LABELS[row.viewer_role_code] ?? row.viewer_role_code}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Scope: {buildVisibilityScopeLabel(row.scope_type)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.scope_type === "USER_EXCEPTION"
                          ? `Requester user: ${buildUserLabel(requesterUser)}`
                          : scope
                            ? `Viewer lane: ${buildWorkContextLabel(scope)}`
                            : row.scope_type === "DIRECTOR"
                              ? "Viewer lane: director broad visibility"
                              : "Viewer lane: company-wide broad visibility"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(row);
                      }}
                      className="border border-rose-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-rose-700"
                    >
                      Delete
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        ),
      }}
      bottomSection={
        <ErpSectionCard
          eyebrow="Viewer Rule Editor"
          title={draft.viewer_id ? "Edit visibility rule" : "Create visibility rule"}
        >
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Action
              </span>
              <select
                value={draft.action_code}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    action_code: event.target.value,
                  }))
                }
                className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Scope Type
              </span>
              <select
                value={draft.scope_type}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    scope_type: event.target.value,
                    subject_work_context_id:
                      event.target.value === "DEPARTMENT" || event.target.value === "WORK_CONTEXT"
                        ? current.subject_work_context_id
                        : "",
                    subject_user_id: event.target.value === "USER_EXCEPTION" ? current.subject_user_id : "",
                  }))
                }
                className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                {VISIBILITY_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {(draft.scope_type === "DEPARTMENT" || draft.scope_type === "WORK_CONTEXT") ? (
              <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {draft.scope_type === "DEPARTMENT" ? "Requester Department Lane" : "Requester Work Context"}
              </span>
              <select
                value={draft.subject_work_context_id}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    subject_work_context_id: event.target.value,
                  }))
                }
                className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                <option value="">
                  {draft.scope_type === "DEPARTMENT" ? "Choose requester department lane" : "Choose requester work context"}
                </option>
                {subjectScopeOptions.map((row) => (
                  <option key={row.work_context_id} value={row.work_context_id}>
                    {buildWorkContextLabel(row)}
                  </option>
                ))}
              </select>
            </label>
            ) : null}

            {draft.scope_type === "USER_EXCEPTION" ? (
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Requester User Exception
                </span>
                <select
                  value={draft.subject_user_id}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      subject_user_id: event.target.value,
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose requester user</option>
                  {userOptions.map((row) => (
                    <option key={row.auth_user_id} value={row.auth_user_id}>
                      {buildUserLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Target Mode
              </span>
              <div className="grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, target_mode: "user" }))}
                  className={`border px-3 py-2 text-sm ${
                    draft.target_mode === "user" ? "border-sky-400 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  Specific User
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, target_mode: "role" }))}
                  className={`border px-3 py-2 text-sm ${
                    draft.target_mode === "role" ? "border-sky-400 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  Role
                </button>
              </div>
            </div>

            {draft.target_mode === "user" ? (
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Viewer User
                </span>
                <select
                  value={draft.viewer_user_id}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      viewer_user_id: event.target.value,
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose user</option>
                  {userOptions.map((row) => (
                    <option key={row.auth_user_id} value={row.auth_user_id}>
                      {buildUserLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Viewer Role
                </span>
                <select
                  value={draft.viewer_role_code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      viewer_role_code: event.target.value,
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  {ERP_ROLE_OPTIONS.map((row) => (
                    <option key={row.code} value={row.code}>
                      {row.code} | {row.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-xs text-slate-600">
              Use company-wide or director viewer rows for broad business visibility. Use department, lane, or user-exception viewer rows when the report must stay tightly scoped.
            </div>
          </div>
        </ErpSectionCard>
      }
    />
  );
}
