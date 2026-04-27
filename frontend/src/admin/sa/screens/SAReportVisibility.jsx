import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";
import {
  formatCompanyAddress,
  formatCompanyLabel,
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
  const draftRef = useRef(createEmptyDraft());
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

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const loadWorkspace = useCallback(async (preferred = null) => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchReportVisibilityWorkspace();
      const nextDraft = preferred ?? draftRef.current;
      setWorkspace({
        companies: data?.companies ?? [],
        projects: data?.projects ?? [],
        modules: data?.modules ?? [],
        resources: data?.resources ?? [],
        work_contexts: data?.work_contexts ?? [],
        users: data?.users ?? [],
        viewer_rules: data?.viewer_rules ?? [],
      });
      setDraft((current) => ({ ...current, ...nextDraft }));
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
  }, []);

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

  const { getRowProps } = useErpListNavigation(filteredRules, {
    onActivate: (row) => handleRulePick(row),
  });

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
            openScreen("SA_APPROVAL_RULES");
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
      footerHints={["↑↓ Navigate", "F8 Refresh", "Ctrl+S Save", "Esc Back", "Ctrl+K Command Bar"]}
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
                <ErpComboboxField
                  value={draft.company_id}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      company_id: val,
                      subject_work_context_id: "",
                      subject_user_id: "",
                    }))
                  }
                  options={companyOptions.map((row) => ({ value: row.id, label: formatCompanyLabel(row) }))}
                  blankLabel="Choose company"
                  inputClassName="px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Project
                </span>
                <ErpComboboxField
                  value={draft.project_code}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      project_code: val,
                      module_code: "",
                      resource_code: "",
                    }))
                  }
                  options={projectOptions.map((row) => ({ value: row.project_code, label: `${row.project_code} | ${row.project_name}` }))}
                  blankLabel="Choose project"
                  inputClassName="px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Module
                </span>
                <ErpComboboxField
                  value={draft.module_code}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      module_code: val,
                      resource_code: "",
                    }))
                  }
                  options={moduleOptions.map((row) => ({ value: row.module_code, label: `${row.project_code} | ${row.module_code} | ${row.module_name}` }))}
                  blankLabel="Choose module"
                  inputClassName="px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Report Resource
                </span>
                <ErpComboboxField
                  value={draft.resource_code}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      resource_code: val,
                    }))
                  }
                  options={resourceOptions.map((row) => ({ value: row.resource_code, label: `${row.title} | ${row.resource_code}` }))}
                  blankLabel="Choose resource"
                  inputClassName="px-3 py-2 text-sm"
                />
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
                  <span className="break-words">
                    {selectedCompany ? formatCompanyLabel(selectedCompany) : "Choose company"}
                  </span>
                </p>
              </div>
              <div className="border border-slate-300 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Company Address
                </p>
                <p className="mt-2 break-words text-sm text-slate-700">
                  {formatCompanyAddress(selectedCompany)}
                </p>
              </div>
            </div>
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Existing Viewer Rules",
        title: loading ? "Loading visibility rules" : `${filteredRules.length} visible viewer rule${filteredRules.length === 1 ? "" : "s"}`,
        count: filteredRules.length,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading report visibility rules.
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No report visibility rule matches the current filter.
          </div>
        ) : (
          <ErpDenseGrid
            columns={[
              {
                key: "resource",
                label: "Resource",
                render: (row) => {
                  const resource = workspace.resources.find((item) => item.resource_code === row.resource_code) ?? null;
                  return (
                    <div>
                      <div className="font-semibold text-slate-900">
                        {resource?.title ?? row.resource_code}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {row.module_code} | {row.resource_code} | {row.action_code}
                      </div>
                    </div>
                  );
                },
              },
              {
                key: "viewer",
                label: "Viewer",
                render: (row) => {
                  const user = workspace.users.find((item) => item.auth_user_id === row.viewer_user_id) ?? null;
                  return user ? buildUserLabel(user) : ERP_ROLE_LABELS[row.viewer_role_code] ?? row.viewer_role_code;
                },
              },
              {
                key: "scope",
                label: "Scope",
                render: (row) => {
                  const scope = workspace.work_contexts.find((item) => item.work_context_id === row.subject_work_context_id) ?? null;
                  const requesterUser = workspace.users.find((item) => item.auth_user_id === row.subject_user_id) ?? null;
                  if (row.scope_type === "USER_EXCEPTION") {
                    return `User | ${buildUserLabel(requesterUser)}`;
                  }
                  if (scope) {
                    return buildWorkContextLabel(scope);
                  }
                  return row.scope_type === "DIRECTOR" ? "Director broad visibility" : "Company-wide broad visibility";
                },
              },
              {
                key: "delete",
                label: "Delete",
                align: "center",
                render: (row) => (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(row);
                    }}
                    className="border border-rose-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-rose-700"
                  >
                    Delete
                  </button>
                ),
              },
            ]}
            rows={filteredRules}
            rowKey={(row) => row.viewer_id}
            getRowProps={(row, index) => ({
              ...getRowProps(index),
              onClick: () => handleRulePick(row),
              className: draft.viewer_id === row.viewer_id ? "bg-sky-50" : "",
            })}
            onRowActivate={(row) => handleRulePick(row)}
            maxHeight="none"
          />
        ),
      }}
      bottomSection={
        <section className="grid gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Viewer Rule Editor</div>
          <div className="text-sm font-semibold text-slate-900">{draft.viewer_id ? "Edit visibility rule" : "Create visibility rule"}</div>
          <div className="grid gap-[var(--erp-form-gap)] md:grid-cols-2 md:gap-x-6">
            <ErpDenseFormRow label="Action">
              <ErpComboboxField
                value={draft.action_code}
                onChange={(val) =>
                  setDraft((current) => ({
                    ...current,
                    action_code: val,
                  }))
                }
                options={actionOptions.map((action) => ({ value: action, label: action }))}
                inputClassName="px-2 py-[3px] text-[12px]"
              />
            </ErpDenseFormRow>

            <ErpDenseFormRow label="Scope Type">
              <ErpComboboxField
                value={draft.scope_type}
                onChange={(val) =>
                  setDraft((current) => ({
                    ...current,
                    scope_type: val,
                    subject_work_context_id:
                      val === "DEPARTMENT" || val === "WORK_CONTEXT"
                        ? current.subject_work_context_id
                        : "",
                    subject_user_id: val === "USER_EXCEPTION" ? current.subject_user_id : "",
                  }))
                }
                options={VISIBILITY_SCOPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                inputClassName="px-2 py-[3px] text-[12px]"
              />
            </ErpDenseFormRow>

            {(draft.scope_type === "DEPARTMENT" || draft.scope_type === "WORK_CONTEXT") ? (
              <ErpDenseFormRow
                label={draft.scope_type === "DEPARTMENT" ? "Requester Department Lane" : "Requester Work Context"}
              >
              <ErpComboboxField
                value={draft.subject_work_context_id}
                onChange={(val) =>
                  setDraft((current) => ({
                    ...current,
                    subject_work_context_id: val,
                  }))
                }
                options={subjectScopeOptions.map((row) => ({ value: row.work_context_id, label: buildWorkContextLabel(row) }))}
                blankLabel={draft.scope_type === "DEPARTMENT" ? "Choose requester department lane" : "Choose requester work context"}
                inputClassName="px-2 py-[3px] text-[12px]"
              />
            </ErpDenseFormRow>
            ) : null}

            {draft.scope_type === "USER_EXCEPTION" ? (
              <ErpDenseFormRow label="Requester User Exception">
                <ErpComboboxField
                  value={draft.subject_user_id}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      subject_user_id: val,
                    }))
                  }
                  options={userOptions.map((row) => ({ value: row.auth_user_id, label: buildUserLabel(row) }))}
                  blankLabel="Choose requester user"
                  inputClassName="px-2 py-[3px] text-[12px]"
                />
              </ErpDenseFormRow>
            ) : null}

            <ErpDenseFormRow label="Target Mode">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, target_mode: "user" }))}
                  className={`border px-2 py-[5px] text-[12px] font-medium ${
                    draft.target_mode === "user" ? "border-sky-400 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  Specific User
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, target_mode: "role" }))}
                  className={`border px-2 py-[5px] text-[12px] font-medium ${
                    draft.target_mode === "role" ? "border-sky-400 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  Role
                </button>
              </div>
            </ErpDenseFormRow>

            {draft.target_mode === "user" ? (
              <ErpDenseFormRow label="Viewer User">
                <ErpComboboxField
                  value={draft.viewer_user_id}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      viewer_user_id: val,
                    }))
                  }
                  options={userOptions.map((row) => ({ value: row.auth_user_id, label: buildUserLabel(row) }))}
                  blankLabel="Choose user"
                  inputClassName="px-2 py-[3px] text-[12px]"
                />
              </ErpDenseFormRow>
            ) : (
              <ErpDenseFormRow label="Viewer Role">
                <ErpComboboxField
                  value={draft.viewer_role_code}
                  onChange={(val) =>
                    setDraft((current) => ({
                      ...current,
                      viewer_role_code: val,
                    }))
                  }
                  options={ERP_ROLE_OPTIONS.map((row) => ({ value: row.code, label: `${row.code} | ${row.label}` }))}
                  inputClassName="px-2 py-[3px] text-[12px]"
                />
              </ErpDenseFormRow>
            )}

            <div className="md:col-span-2 border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              Use company-wide or director viewer rows for broad business visibility. Use department, lane, or user-exception viewer rows when the report must stay tightly scoped.
            </div>
          </div>
        </section>
      }
    />
  );
}
