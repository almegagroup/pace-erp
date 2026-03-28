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

async function fetchRolePermissions(roleCode) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/role-permissions?role_code=${encodeURIComponent(roleCode)}`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.permissions)) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_LIST_FAILED");
  }

  return json.data.permissions;
}

async function saveRolePermission(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/acl/role-permissions`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_UPSERT_FAILED");
  }

  return json.data;
}

async function disableRolePermission(payload) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/role-permissions/disable`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "ROLE_PERMISSION_DISABLE_FAILED");
  }

  return json.data;
}

function countEnabledFlags(row) {
  return [
    row.can_view,
    row.can_write,
    row.can_edit,
    row.can_delete,
    row.can_approve,
    row.can_export,
  ].filter(Boolean).length;
}

function createEmptyDraft(roleCode) {
  return {
    role_code: roleCode,
    resource_code: "",
    can_view: true,
    can_write: false,
    can_edit: false,
    can_delete: false,
    can_approve: false,
    can_export: false,
  };
}

export default function SARolePermissions() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const resourceInputRef = useRef(null);
  const rowActionRefs = useRef([]);
  const [selectedRoleCode, setSelectedRoleCode] = useState(ERP_ROLE_OPTIONS[0]?.code ?? "SA");
  const [permissions, setPermissions] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState(() => createEmptyDraft(ERP_ROLE_OPTIONS[0]?.code ?? "SA"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadPermissions(roleCode = selectedRoleCode) {
    setLoading(true);
    setError("");

    try {
      const data = await fetchRolePermissions(roleCode);
      setPermissions(data);
    } catch {
      setPermissions([]);
      setError("Unable to load role permissions right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDraft(createEmptyDraft(selectedRoleCode));
    void loadPermissions(selectedRoleCode);
  }, [selectedRoleCode]);

  const filteredPermissions = useMemo(
    () =>
      applyQuickFilter(permissions, searchQuery, [
        "resource_code",
      ]),
    [permissions, searchQuery]
  );

  useErpDenseFormNavigation(formContainerRef, {
    disabled: saving,
    submitOnFinalField: true,
    onSubmit: () => handleSave(),
  });

  async function handleSave() {
    if (!draft.resource_code.trim()) {
      setError("Resource code is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await saveRolePermission({
        ...draft,
        role_code: selectedRoleCode,
        resource_code: draft.resource_code.trim(),
      });
      await loadPermissions(selectedRoleCode);
      setNotice(`Permission updated for ${selectedRoleCode} on ${draft.resource_code.trim()}.`);
    } catch {
      setError("Role permission could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable(row) {
    const approved = await openActionConfirm({
      eyebrow: "ACL Governance",
      title: "Disable Role Permission",
      message: `Clear all permission flags for ${row.resource_code} on ${selectedRoleCode}?`,
      confirmLabel: "Disable",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await disableRolePermission({
        role_code: selectedRoleCode,
        resource_code: row.resource_code,
      });
      await loadPermissions(selectedRoleCode);
      setNotice(`Permission cleared for ${row.resource_code}.`);
    } catch {
      setError("Role permission could not be disabled.");
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
      perform: () => void loadPermissions(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => resourceInputRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-role-permissions-control-panel",
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
      id: "sa-role-permissions-focus-search",
      group: "Current Screen",
      label: "Focus permission search",
      keywords: ["search", "permission", "resource"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-role-permissions-focus-editor",
      group: "Current Screen",
      label: "Focus permission editor",
      keywords: ["editor", "resource code", "permission flags"],
      perform: () => resourceInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-role-permissions-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing permissions..." : "Refresh permissions",
      keywords: ["refresh", "acl", "role permissions"],
      disabled: loading,
      perform: () => void loadPermissions(),
      order: 40,
    },
    {
      id: "sa-role-permissions-save",
      group: "Current Screen",
      label: saving ? "Saving permission..." : "Save role permission",
      hint: "Ctrl+S",
      keywords: ["save", "upsert", "permission"],
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
      onClick: () => void loadPermissions(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save",
      label: saving ? "Saving..." : "Save Permission",
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
      eyebrow="ACL Governance"
      title="Role Permissions"
      description="Review and maintain role-resource VWED permission rows without leaving a keyboard-native ACL surface."
      actions={topActions}
      notices={[
        ...(error
          ? [{ key: "error", tone: "error", message: error }]
          : []),
        ...(notice
          ? [{ key: "notice", tone: "success", message: notice }]
          : []),
      ]}
      metrics={[
        {
          key: "role",
          label: "Role",
          value: selectedRoleCode,
          tone: "sky",
          caption: ERP_ROLE_LABELS[selectedRoleCode] ?? "Selected role under ACL review.",
        },
        {
          key: "resources",
          label: "Resources",
          value: loading ? "..." : String(permissions.length),
          tone: "emerald",
          caption: "Current resource rows returned by the backend for this role.",
        },
        {
          key: "active",
          label: "Active Rows",
          value: loading ? "..." : String(permissions.filter((row) => countEnabledFlags(row) > 0).length),
          tone: "amber",
          caption: "Rows with at least one enabled VWED permission flag.",
        },
        {
          key: "visible",
          label: "Visible",
          value: loading ? "..." : String(filteredPermissions.length),
          tone: "slate",
          caption: "Rows matching the current resource search.",
        },
      ]}
      summarySection={{
        eyebrow: "ACL Rule Contract",
        title: "Role-resource permissions remain backend-owned",
        description:
          "This screen consumes the role permission APIs directly. Edit keeps the row idempotent, and disable clears flags without deleting the governance record.",
      }}
      filterSection={{
        eyebrow: "Role Filter",
        title: "Select role and filter resources",
        children: (
          <div className="space-y-5">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Role Code
              </span>
              <select
                value={selectedRoleCode}
                onChange={(event) => setSelectedRoleCode(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
              >
                {ERP_ROLE_OPTIONS.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.code} - {role.label}
                  </option>
                ))}
              </select>
            </label>

            <QuickFilterInput
              label="Resource Search"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchInputRef}
              placeholder="Filter by resource code"
              hint="Alt+Shift+F focuses this resource filter."
            />
          </div>
        ),
      }}
      reviewSection={{
        eyebrow: "Permission Rows",
        title: loading
          ? "Loading permission rows"
          : `${filteredPermissions.length} visible resource row${filteredPermissions.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading role permissions from ACL governance APIs.
          </div>
        ) : filteredPermissions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No resource row matches the current role filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPermissions.map((row, index) => (
              <div
                key={`${row.resource_code}-${index}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {row.resource_code}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                      {[
                        row.can_view ? "V" : null,
                        row.can_write ? "W" : null,
                        row.can_edit ? "E" : null,
                        row.can_delete ? "D" : null,
                        row.can_approve ? "A" : null,
                        row.can_export ? "X" : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || "NO FLAGS"}
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
                          role_code: selectedRoleCode,
                          resource_code: row.resource_code,
                          can_view: Boolean(row.can_view),
                          can_write: Boolean(row.can_write),
                          can_edit: Boolean(row.can_edit),
                          can_delete: Boolean(row.can_delete),
                          can_approve: Boolean(row.can_approve),
                          can_export: Boolean(row.can_export),
                        })
                      }
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 0,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][1] = element;
                      }}
                      type="button"
                      onClick={() => void handleDisable(row)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 1,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ),
      }}
      sideSection={{
        eyebrow: "Editor",
        title: "Role permission editor",
        description: "Select a row to edit, or type a new resource code to create a new permission row.",
        children: (
          <div ref={formContainerRef} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Resource Code
              </span>
              <input
                ref={resourceInputRef}
                data-workspace-primary-focus="true"
                data-erp-form-field="true"
                type="text"
                value={draft.resource_code}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    resource_code: event.target.value,
                  }))
                }
                placeholder="RESOURCE_CODE"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
              />
            </label>

            {[
              ["can_view", "Can View"],
              ["can_write", "Can Write"],
              ["can_edit", "Can Edit"],
              ["can_delete", "Can Delete"],
              ["can_approve", "Can Approve"],
              ["can_export", "Can Export"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                <span>{label}</span>
                <input
                  data-erp-form-field="true"
                  type="checkbox"
                  checked={Boolean(draft[key])}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                />
              </label>
            ))}
          </div>
        ),
      }}
    />
  );
}
