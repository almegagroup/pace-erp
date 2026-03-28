import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { ERP_ROLE_OPTIONS, ERP_ROLE_LABELS } from "../../../shared/erpRoles.js";
import { applyQuickFilter } from "../../../shared/erpCollections.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchApproverRules() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/approval/approvers`, {
    credentials: "include",
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data)) {
    throw new Error(json?.code ?? "APPROVER_RULE_LIST_FAILED");
  }

  return json.data;
}

async function saveApproverRule(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/approval/approvers`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "APPROVER_RULE_UPSERT_FAILED");
  }

  return json.data;
}

async function deleteApproverRule(approverId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/approval/approvers/delete`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approver_id: approverId,
      }),
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "APPROVER_RULE_DELETE_FAILED");
  }

  return json.data;
}

function createEmptyDraft() {
  return {
    company_id: "",
    module_code: "",
    resource_code: "",
    action_code: "",
    approval_stage: "1",
    target_mode: "role",
    approver_role_code: ERP_ROLE_OPTIONS[0]?.code ?? "SA",
    approver_user_id: "",
  };
}

export default function SAApprovalRules() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const companyInputRef = useRef(null);
  const rowActionRefs = useRef([]);
  const [rules, setRules] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState(createEmptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRules() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchApproverRules();
      setRules(data);
    } catch {
      setRules([]);
      setError("Unable to load approval routing rules right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRules();
  }, []);

  const filteredRules = useMemo(
    () =>
      applyQuickFilter(rules, searchQuery, [
        "company_id",
        "module_code",
        "resource_code",
        "action_code",
        "approver_role_code",
        "approver_user_id",
      ]),
    [rules, searchQuery]
  );

  useErpDenseFormNavigation(formContainerRef, {
    disabled: saving,
    submitOnFinalField: true,
    onSubmit: () => handleSave(),
  });

  async function handleSave() {
    if (!draft.company_id.trim() || !draft.module_code.trim()) {
      setError("Company ID and module code are required.");
      return;
    }

    if (draft.target_mode === "role" && !draft.approver_role_code) {
      setError("Select an approver role.");
      return;
    }

    if (draft.target_mode === "user" && !draft.approver_user_id.trim()) {
      setError("Approver user ID is required when target mode is user.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await saveApproverRule({
        company_id: draft.company_id.trim(),
        module_code: draft.module_code.trim().toUpperCase(),
        resource_code: draft.resource_code.trim() || undefined,
        action_code: draft.action_code.trim() || undefined,
        approval_stage: Number(draft.approval_stage),
        approver_role_code:
          draft.target_mode === "role" ? draft.approver_role_code : undefined,
        approver_user_id:
          draft.target_mode === "user" ? draft.approver_user_id.trim() : undefined,
      });
      await loadRules();
      setNotice("Approval routing rule saved.");
    } catch {
      setError("Approval routing rule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row) {
    const approved = await openActionConfirm({
      eyebrow: "Approval Governance",
      title: "Delete Approval Rule",
      message: `Delete stage ${row.approval_stage} rule for ${row.module_code}${row.resource_code ? ` | ${row.resource_code}` : ""}?`,
      confirmLabel: "Delete Rule",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await deleteApproverRule(row.approver_id);
      await loadRules();
      setNotice("Approval rule deleted.");
    } catch {
      setError("Approval rule could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleSave(),
    },
    refresh: {
      disabled: loading,
      perform: () => void loadRules(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => companyInputRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-approval-rules-control-panel",
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
      id: "sa-approval-rules-focus-search",
      group: "Current Screen",
      label: "Focus approval rule search",
      keywords: ["approval", "search", "rules"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-approval-rules-focus-editor",
      group: "Current Screen",
      label: "Focus approval rule editor",
      keywords: ["editor", "company id", "module code"],
      perform: () => companyInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-approval-rules-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing approval rules..." : "Refresh approval rules",
      keywords: ["refresh", "approver rules"],
      disabled: loading,
      perform: () => void loadRules(),
      order: 40,
    },
    {
      id: "sa-approval-rules-save",
      group: "Current Screen",
      label: saving ? "Saving approval rule..." : "Save approval rule",
      hint: "Ctrl+S",
      keywords: ["save", "approver", "rule"],
      disabled: saving,
      perform: () => void handleSave(),
      order: 50,
    },
  ]);

  const topActions = [
    {
      key: "control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => {
        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh",
      label: loading ? "Refreshing..." : "Refresh",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => void loadRules(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save",
      label: saving ? "Saving..." : "Save Rule",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving,
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

  return (
    <ErpApprovalReviewTemplate
      eyebrow="Approval Governance"
      title="Approval Rules And Approver Scope"
      description="Manage stage-based approver routing in a keyboard-native review surface that keeps exact scope visible while editing."
      actions={topActions}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      metrics={[
        {
          key: "rules",
          label: "Rules",
          value: loading ? "..." : String(rules.length),
          tone: "sky",
          caption: "Total approval routing rows returned by the backend.",
        },
        {
          key: "visible",
          label: "Visible",
          value: loading ? "..." : String(filteredRules.length),
          tone: "emerald",
          caption: "Rules matching the current filter.",
        },
        {
          key: "module-rows",
          label: "Scoped Rules",
          value: loading ? "..." : String(rules.filter((row) => row.resource_code || row.action_code).length),
          tone: "amber",
          caption: "Rules narrowed below blanket module level.",
        },
        {
          key: "target-mode",
          label: "Editor Target",
          value: draft.target_mode === "role" ? "ROLE" : "USER",
          tone: "slate",
          caption: "The current target type in the editor pane.",
        },
      ]}
      summarySection={{
        eyebrow: "Routing Contract",
        title: "Approver rules stay exact and backend-owned",
        description:
          "Blanket module rules and exact resource-action scope are both handled here. Resource code and action code must move together when narrowing below module level.",
      }}
      filterSection={{
        eyebrow: "Rule Search",
        title: "Filter approval routing rows",
        children: (
          <QuickFilterInput
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchInputRef}
            placeholder="Search by company, module, resource, action, stage, role, or user"
            hint="Alt+Shift+F focuses this filter."
          />
        ),
      }}
      reviewSection={{
        eyebrow: "Current Rules",
        title: loading
          ? "Loading approval rules"
          : `${filteredRules.length} visible approval rule${filteredRules.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
            Loading approval routing rules.
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
            No approval rule matches the current filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRules.map((row, index) => (
              <div
                key={row.approver_id}
                className="rounded-[22px] border border-white/8 bg-black/10 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {row.module_code} | Stage {row.approval_stage}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Company {row.company_id}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Scope {row.resource_code && row.action_code ? `${row.resource_code} | ${row.action_code}` : "Blanket module scope"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Target {row.approver_role_code ? ERP_ROLE_LABELS[row.approver_role_code] ?? row.approver_role_code : row.approver_user_id}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][0] = element;
                      }}
                      type="button"
                      onClick={() =>
                        setDraft({
                          company_id: row.company_id ?? "",
                          module_code: row.module_code ?? "",
                          resource_code: row.resource_code ?? "",
                          action_code: row.action_code ?? "",
                          approval_stage: String(row.approval_stage ?? 1),
                          target_mode: row.approver_role_code ? "role" : "user",
                          approver_role_code: row.approver_role_code ?? (ERP_ROLE_OPTIONS[0]?.code ?? "SA"),
                          approver_user_id: row.approver_user_id ?? "",
                        })
                      }
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 0,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="rounded-2xl border border-cyan-400/25 bg-cyan-400/12 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-50"
                    >
                      Edit
                    </button>
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][1] = element;
                      }}
                      type="button"
                      onClick={() => void handleDelete(row)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 1,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="rounded-2xl border border-rose-400/25 bg-rose-400/12 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ),
      }}
      sideSection={{
        eyebrow: "Rule Editor",
        title: "Create or update approval routing",
        description: "Use exact scope fields only when workflow routing should narrow below blanket module level.",
        children: (
          <div ref={formContainerRef} className="space-y-4">
            {[
              ["Company ID", "company_id", companyInputRef, "Company UUID"],
              ["Module Code", "module_code", null, "MODULE_CODE"],
              ["Resource Code", "resource_code", null, "Optional exact resource"],
              ["Action Code", "action_code", null, "Optional exact action"],
              ["Approval Stage", "approval_stage", null, "1"],
            ].map(([label, key, ref, placeholder]) => (
              <label key={key} className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {label}
                </span>
                <input
                  ref={ref}
                  data-workspace-primary-focus={key === "company_id" ? "true" : undefined}
                  data-erp-form-field="true"
                  type="text"
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  placeholder={placeholder}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:bg-black/30"
                />
              </label>
            ))}

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Target Mode
              </span>
              <select
                data-erp-form-field="true"
                value={draft.target_mode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    target_mode: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/50 focus:bg-black/30"
              >
                <option value="role">Approver Role</option>
                <option value="user">Approver User</option>
              </select>
            </label>

            {draft.target_mode === "role" ? (
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Approver Role
                </span>
                <select
                  data-erp-form-field="true"
                  value={draft.approver_role_code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      approver_role_code: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/50 focus:bg-black/30"
                >
                  {ERP_ROLE_OPTIONS.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.code} - {role.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Approver User ID
                </span>
                <input
                  data-erp-form-field="true"
                  type="text"
                  value={draft.approver_user_id}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      approver_user_id: event.target.value,
                    }))
                  }
                  placeholder="Auth user ID"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:bg-black/30"
                />
              </label>
            )}
          </div>
        ),
      }}
    />
  );
}
