import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";
import {
  deleteApproverRule,
  fetchApprovalWorkspace,
  saveApproverRule,
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
    approver_id: null,
    company_id: "",
    project_code: "",
    module_code: "",
    resource_code: "",
    action_code: "APPROVE",
    subject_work_context_id: "",
    approval_stage: "1",
    target_mode: "user",
    approver_user_id: "",
    approver_role_code: ERP_ROLE_OPTIONS[0]?.code ?? "DIRECTOR",
  };
}

export default function SAApprovalRules() {
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
    approver_rules: [],
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
      const data = await fetchApprovalWorkspace();
      setWorkspace({
        companies: data?.companies ?? [],
        projects: data?.projects ?? [],
        modules: data?.modules ?? [],
        resources: data?.resources ?? [],
        work_contexts: data?.work_contexts ?? [],
        users: data?.users ?? [],
        approver_rules: data?.approver_rules ?? [],
      });
      setDraft((current) => ({
        ...current,
        ...preferred,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Approval workspace could not be loaded. ${err.message}`
          : "Approval workspace could not be loaded right now.",
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
    const moduleProjectCodes = new Set(
      workspace.modules
        .filter((row) => !draft.company_id || row.is_active)
        .map((row) => row.project_code)
        .filter(Boolean),
    );

    return sortByLabel(
      workspace.projects.filter((row) => moduleProjectCodes.has(row.project_code)),
      (row) => `${row.project_code ?? ""} ${row.project_name ?? ""}`.trim(),
    );
  }, [workspace.projects, workspace.modules, draft.company_id]);

  const moduleOptions = useMemo(() => {
    return sortByLabel(
      workspace.modules.filter((row) =>
        (!draft.project_code || row.project_code === draft.project_code) &&
        row.is_active === true
      ),
      (row) => `${row.project_code ?? ""} ${row.module_code ?? ""} ${row.module_name ?? ""}`.trim(),
    );
  }, [workspace.modules, draft.project_code]);

  const resourceOptions = useMemo(() => {
    return sortByLabel(
      workspace.resources.filter((row) =>
        (!draft.project_code || row.project_code === draft.project_code) &&
        (!draft.module_code || row.module_code === draft.module_code),
      ),
      (row) => `${row.project_code ?? ""} ${row.module_code ?? ""} ${row.title ?? ""}`.trim(),
    );
  }, [workspace.resources, draft.project_code, draft.module_code]);

  const selectedResource = useMemo(
    () =>
      resourceOptions.find((row) => row.resource_code === draft.resource_code) ?? null,
    [resourceOptions, draft.resource_code],
  );

  const actionOptions = selectedResource?.available_actions?.includes("APPROVE")
    ? selectedResource.available_actions
    : ["APPROVE"];

  useEffect(() => {
    if (draft.resource_code && !resourceOptions.some((row) => row.resource_code === draft.resource_code)) {
      setDraft((current) => ({ ...current, resource_code: "", action_code: "APPROVE" }));
    }
  }, [resourceOptions, draft.resource_code]);

  useEffect(() => {
    if (draft.module_code && !moduleOptions.some((row) => row.module_code === draft.module_code)) {
      setDraft((current) => ({ ...current, module_code: "", resource_code: "", action_code: "APPROVE" }));
    }
  }, [moduleOptions, draft.module_code]);

  useEffect(() => {
    if (draft.project_code && !projectOptions.some((row) => row.project_code === draft.project_code)) {
      setDraft((current) => ({ ...current, project_code: "", module_code: "", resource_code: "", action_code: "APPROVE" }));
    }
  }, [projectOptions, draft.project_code]);

  useEffect(() => {
    if (!actionOptions.includes(draft.action_code)) {
      setDraft((current) => ({ ...current, action_code: actionOptions[0] ?? "APPROVE" }));
    }
  }, [actionOptions, draft.action_code]);

  const subjectScopeOptions = useMemo(() => {
    return sortByLabel(
      workspace.work_contexts.filter((row) => !draft.company_id || row.company_id === draft.company_id),
      (row) =>
        `${row.company_code ?? ""} ${row.work_context_code ?? ""} ${row.department_code ?? ""} ${row.department_name ?? ""}`.trim(),
    );
  }, [workspace.work_contexts, draft.company_id]);

  const userOptions = useMemo(() => {
    return sortByLabel(
      workspace.users.filter((row) => {
        const needle = normalizeText(searchQuery).toLowerCase();
        if (!needle) return true;
        return buildUserLabel(row).toLowerCase().includes(needle);
      }),
      (row) => buildUserLabel(row),
    );
  }, [workspace.users, draft.company_id, searchQuery]);

  const filteredRules = useMemo(() => {
    const needle = normalizeText(searchQuery).toLowerCase();
    return workspace.approver_rules.filter((row) => {
      if (draft.company_id && row.company_id !== draft.company_id) return false;
      if (draft.module_code && row.module_code !== draft.module_code) return false;
      if (draft.resource_code && row.resource_code !== draft.resource_code) return false;
      if (draft.subject_work_context_id && row.subject_work_context_id !== draft.subject_work_context_id) return false;
      if (!needle) return true;

      const targetUser = workspace.users.find((user) => user.auth_user_id === row.approver_user_id);
      const targetScope = workspace.work_contexts.find(
        (scope) => scope.work_context_id === row.subject_work_context_id,
      );
      const haystack = [
        row.company_id,
        row.module_code,
        row.resource_code,
        row.action_code,
        row.approver_role_code,
        targetUser ? buildUserLabel(targetUser) : "",
        targetScope?.work_context_code,
        targetScope?.department_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [
    workspace.approver_rules,
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
      setError("Company, module, and exact approval resource are required.");
      return;
    }

    if (draft.target_mode === "user" && !draft.approver_user_id) {
      setError("Choose an approver user.");
      return;
    }

    if (draft.target_mode === "role" && !draft.approver_role_code) {
      setError("Choose an approver role.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await saveApproverRule({
        approver_id: draft.approver_id ?? undefined,
        company_id: draft.company_id,
        module_code: draft.module_code,
        resource_code: draft.resource_code,
        action_code: draft.action_code,
        subject_work_context_id: draft.subject_work_context_id || undefined,
        approval_stage: Number(draft.approval_stage || "1"),
        approver_user_id: draft.target_mode === "user" ? draft.approver_user_id : undefined,
        approver_role_code: draft.target_mode === "role" ? draft.approver_role_code : undefined,
      });
      await loadWorkspace({ ...draft, approver_id: null });
      setNotice("Scoped approver rule saved.");
      setDraft((current) => ({ ...current, approver_id: null }));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Approver rule could not be saved. ${err.message}`
          : "Approver rule could not be saved right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule) {
    const approved = await openActionConfirm({
      eyebrow: "Approval Governance",
      title: "Delete Approver Rule",
      message: `Delete stage ${rule.approval_stage} approver rule for ${rule.resource_code ?? rule.module_code}?`,
      confirmLabel: "Delete Rule",
      cancelLabel: "Cancel",
    });

    if (!approved) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await deleteApproverRule(rule.approver_id);
      await loadWorkspace(draft);
      setNotice("Approver rule deleted.");
    } catch (err) {
      setError(
        err instanceof Error
          ? `Approver rule could not be deleted. ${err.message}`
          : "Approver rule could not be deleted right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleRulePick(rule) {
    const resource = workspace.resources.find((row) => row.resource_code === rule.resource_code) ?? null;
    const module = workspace.modules.find((row) => row.module_code === rule.module_code) ?? null;
    setDraft({
      approver_id: rule.approver_id,
      company_id: rule.company_id,
      project_code: resource?.project_code ?? module?.project_code ?? "",
      module_code: rule.module_code,
      resource_code: rule.resource_code ?? "",
      action_code: rule.action_code ?? "APPROVE",
      subject_work_context_id: rule.subject_work_context_id ?? "",
      approval_stage: String(rule.approval_stage ?? 1),
      target_mode: rule.approver_user_id ? "user" : "role",
      approver_user_id: rule.approver_user_id ?? "",
      approver_role_code: rule.approver_role_code ?? ERP_ROLE_OPTIONS[0]?.code ?? "DIRECTOR",
    });
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="Approval Governance"
      title="Scoped Approver Rules"
      description="Bind exact approvers to exact company, module, resource, action, and requester subject scope. This prevents Arka-like overreach across unrelated departments."
      actions={[
        {
          key: "policy",
          label: "Approval Policy",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_APPROVAL_POLICY", { mode: "replace" });
            navigate("/sa/approval-policy");
          },
        },
        {
          key: "viewer",
          label: "Report Visibility",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_REPORT_VISIBILITY", { mode: "replace" });
            navigate("/sa/report-visibility");
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
          label: saving ? "Saving..." : draft.approver_id ? "Update Rule" : "Save Rule",
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
          key: "rules",
          label: "Approver Rules",
          value: loading ? "..." : String(workspace.approver_rules.length),
          tone: "sky",
          caption: "All saved scoped approver rows.",
        },
        {
          key: "visible",
          label: "Visible",
          value: loading ? "..." : String(filteredRules.length),
          tone: "emerald",
          caption: "Rules matching the current filters.",
        },
        {
          key: "scope",
          label: "Requester Scope",
          value: draft.subject_work_context_id ? "Scoped" : "Company-wide",
          tone: draft.subject_work_context_id ? "amber" : "slate",
          caption: "Leave blank only if every requester in this company-module should share the same approver pool.",
        },
        {
          key: "target",
          label: "Target",
          value: draft.target_mode === "user" ? "Specific User" : "Role",
          tone: "slate",
          caption: draft.target_mode === "user"
            ? buildUserLabel(workspace.users.find((row) => row.auth_user_id === draft.approver_user_id) ?? null)
            : ERP_ROLE_LABELS[draft.approver_role_code] ?? draft.approver_role_code,
        },
      ]}
      filterSection={{
        eyebrow: "Scope Filters",
        title: "Choose exact approval scope",
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
                  Exact Approval Resource
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
              label="Search rules or users"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search by approver, scope, company, module, or resource"
            />
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Existing Rules",
        title: loading ? "Loading approver rules" : `${filteredRules.length} visible approver rule${filteredRules.length === 1 ? "" : "s"}`,
        description: "Pick a row to edit it, or delete rows that should no longer route approvals.",
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading scoped approver rules.
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No approver rule matches the current filter.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredRules.map((row, index) => {
              const user = workspace.users.find((item) => item.auth_user_id === row.approver_user_id) ?? null;
              const scope = workspace.work_contexts.find((item) => item.work_context_id === row.subject_work_context_id) ?? null;
              const resource = workspace.resources.find((item) => item.resource_code === row.resource_code) ?? null;

              return (
                <button
                  key={row.approver_id}
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
                    draft.approver_id === row.approver_id ? "border-sky-400 bg-sky-50" : "border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {resource?.title ?? row.resource_code ?? row.module_code}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {row.module_code} | {row.resource_code ?? "MODULE_SCOPE"} | {row.action_code ?? "ALL"}
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        Stage {row.approval_stage} | {user ? buildUserLabel(user) : ERP_ROLE_LABELS[row.approver_role_code] ?? row.approver_role_code}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {scope
                          ? `${scope.company_code} | ${scope.work_context_code}${scope.department_name ? ` | ${scope.department_name}` : ""}`
                          : "Requester scope: company-wide"}
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
        eyebrow: "Rule Editor",
        title: draft.approver_id ? "Edit approver rule" : "Create approver rule",
        description: "Use requester subject scope to keep approvers narrow. Example: Accounts requests -> Arka, Engineering requests -> Bikash.",
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

            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Approval Stage
              </span>
              <select
                value={draft.approval_stage}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    approval_stage: event.target.value,
                  }))
                }
                className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                <option value="1">Stage 1</option>
                <option value="2">Stage 2</option>
                <option value="3">Stage 3</option>
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
                  Approver User
                </span>
                <select
                  value={draft.approver_user_id}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      approver_user_id: event.target.value,
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
                  Approver Role
                </span>
                <select
                  value={draft.approver_role_code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      approver_role_code: event.target.value,
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
              Use exact resource `*_APPROVAL_INBOX` with action `APPROVE` for approver routing.
              Keep requester scope empty only when the same approver pool should work for every requester in the company.
            </div>
          </div>
        ),
      }}
    />
  );
}
