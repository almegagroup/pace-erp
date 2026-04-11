import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";
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

function createEmptyDraft() {
  return {
    viewer_id: null,
    company_id: "",
    project_code: "",
    module_code: "",
    resource_code: "",
    action_code: "VIEW",
    subject_work_context_id: "",
    target_mode: "user",
    viewer_user_id: "",
    viewer_role_code: ERP_ROLE_OPTIONS[0]?.code ?? "DIRECTOR",
  };
}

export default function SAReportVisibility() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const rowRefs = useRef([]);
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

  async function loadWorkspace(preferred = draft) {
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
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const companyOptions = useMemo(
    () =>
      sortByLabel(
        workspace.companies,
        (row) => `${row.company_code ?? ""} ${row.company_name ?? ""}`.trim(),
      ),
    [workspace.companies],
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
        workspace.work_contexts.filter((row) => !draft.company_id || row.company_id === draft.company_id),
        (row) =>
          `${row.company_code ?? ""} ${row.work_context_code ?? ""} ${row.department_code ?? ""} ${row.department_name ?? ""}`.trim(),
      ),
    [workspace.work_contexts, draft.company_id],
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
      const haystack = [
        row.company_id,
        row.module_code,
        row.resource_code,
        row.action_code,
        row.viewer_role_code,
        targetUser ? buildUserLabel(targetUser) : "",
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

  async function handleSave() {
    if (!draft.company_id || !draft.module_code || !draft.resource_code) {
      setError("Company, module, and exact report resource are required.");
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
        subject_work_context_id: draft.subject_work_context_id || undefined,
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
          subject_work_context_id: draft.subject_work_context_id || null,
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
      subject_work_context_id: rule.subject_work_context_id ?? "",
      target_mode: rule.viewer_user_id ? "user" : "role",
      viewer_user_id: rule.viewer_user_id ?? "",
      viewer_role_code: rule.viewer_role_code ?? ERP_ROLE_OPTIONS[0]?.code ?? "DIRECTOR",
    });
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="Approval Governance"
      title="Who Can See Reports"
      description="Separate report visibility from approver authority. A reviewer can see registers and details without becoming an approver."
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
      metrics={[
        {
          key: "viewerRules",
          label: "Viewer Rules",
          value: loading ? "..." : String(workspace.viewer_rules.length),
          tone: "sky",
          caption: "All saved report visibility rows.",
        },
        {
          key: "visible",
          label: "Visible",
          value: loading ? "..." : String(filteredRules.length),
          tone: "emerald",
          caption: "Rules matching the current filter.",
        },
        {
          key: "scope",
          label: "Visibility Scope",
          value: draft.subject_work_context_id ? "Scoped" : "Company-wide",
          tone: draft.subject_work_context_id ? "amber" : "slate",
          caption: "Leave blank to allow full company-level reporting access for the selected report resource.",
        },
        {
          key: "action",
          label: "Action",
          value: draft.action_code,
          tone: "slate",
          caption: draft.resource_code || "Choose a report resource",
        },
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
                    }))
                  }
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose company</option>
                  {companyOptions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.company_code} | {row.company_name}
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
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Existing Viewer Rules",
        title: loading ? "Loading visibility rules" : `${filteredRules.length} visible viewer rule${filteredRules.length === 1 ? "" : "s"}`,
        description: "Use these rows to control who can see company-wide or department-scoped register and report pages.",
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

              return (
                <button
                  key={row.viewer_id}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={() => handleRulePick(row)}
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: rowRefs.current,
                      orientation: "vertical",
                    })
                  }
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
                        {scope
                          ? `${scope.company_code} | ${scope.work_context_code}${scope.department_name ? ` | ${scope.department_name}` : ""}`
                          : "Viewer scope: company-wide"}
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
      sideSection={{
        eyebrow: "Viewer Rule Editor",
        title: draft.viewer_id ? "Edit visibility rule" : "Create visibility rule",
        description: "Use company-wide rows for Meeta/Pradeep-style reporting access. Use scoped rows when only one requester context should be visible.",
        children: (
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
                Requester Subject Scope
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
                <option value="">All requester scopes in this company</option>
                {subjectScopeOptions.map((row) => (
                  <option key={row.work_context_id} value={row.work_context_id}>
                    {row.company_code} | {row.work_context_code}
                    {row.department_name ? ` | ${row.department_name}` : ""}
                  </option>
                ))}
              </select>
            </label>

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
              Use company-wide viewer rows for HR-wide salary/report visibility. Use subject-scoped viewer rows when only one department or requester context should be visible.
            </div>
          </div>
        ),
      }}
    />
  );
}
