import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function describeApiError(json, fallbackCode) {
  const code = json?.code ?? fallbackCode ?? "REQUEST_FAILED";
  const trace = json?.decision_trace ? ` | Trace ${json.decision_trace}` : "";
  const requestId = json?.request_id ? ` | Req ${json.request_id}` : "";
  return `${code}${trace}${requestId}`;
}

async function fetchWorkspace() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/approval/resource-policy`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(describeApiError(json, "RESOURCE_POLICY_LIST_FAILED"));
  }

  return json.data;
}

async function savePolicy(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/approval/resource-policy`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(describeApiError(json, "RESOURCE_POLICY_UPSERT_FAILED"));
  }

  return json.data;
}

const APPROVAL_TYPE_OPTIONS = ["ANYONE", "SEQUENTIAL", "MUST_ALL"];
const MIN_REQUIRED_APPROVERS = "1";
const MAX_ALLOWED_APPROVERS = "3";

export default function SAApprovalPolicy() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedResourceCode, setSelectedResourceCode] = useState("");
  const [actionCode, setActionCode] = useState("VIEW");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalType, setApprovalType] = useState("ANYONE");
  const [minApprovers, setMinApprovers] = useState(MIN_REQUIRED_APPROVERS);
  const [maxApprovers, setMaxApprovers] = useState(MAX_ALLOWED_APPROVERS);

  const loadWorkspace = useCallback(async (preferredResourceCode = selectedResourceCode) => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchWorkspace();
      const nextResources = data?.resources ?? [];
      setResources(nextResources);

      const nextSelectedResourceCode =
        nextResources.find((row) => row.resource_code === preferredResourceCode)?.resource_code ??
        nextResources[0]?.resource_code ??
        "";
      setSelectedResourceCode(nextSelectedResourceCode);
    } catch (err) {
      console.error("RESOURCE_POLICY_WORKSPACE_LOAD_FAILED", {
        code: err?.code ?? null,
        requestId: err?.requestId ?? null,
        decisionTrace: err?.decisionTrace ?? null,
        message: err?.message ?? "RESOURCE_POLICY_LIST_FAILED",
      });
      setResources([]);
      setSelectedResourceCode("");
      setError(
        err instanceof Error
          ? `Approval policy workspace could not be loaded. ${err.message}`
          : "Approval policy workspace could not be loaded right now.",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedResourceCode]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const filteredResources = useMemo(() => {
    const needle = String(searchQuery ?? "").trim().toLowerCase();
    if (!needle) {
      return resources;
    }

    return resources.filter((row) =>
      [
        row.title,
        row.resource_code,
        row.route_path,
        row.module_code,
        row.module_name,
        row.project_code,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [resources, searchQuery]);

  useEffect(() => {
    if (!filteredResources.some((row) => row.resource_code === selectedResourceCode)) {
      setSelectedResourceCode(filteredResources[0]?.resource_code ?? "");
    }
  }, [filteredResources, selectedResourceCode]);

  const selectedResource =
    filteredResources.find((row) => row.resource_code === selectedResourceCode) ??
    filteredResources[0] ??
    null;

  const { getRowProps } = useErpListNavigation(filteredResources, {
    onActivate: (row) => setSelectedResourceCode(row?.resource_code ?? ""),
  });

  const selectedPolicy =
    selectedResource?.policies?.find((row) => row.action_code === actionCode) ?? null;

  useEffect(() => {
    const nextAction = selectedResource?.available_actions?.[0] ?? "VIEW";
    setActionCode((current) =>
      selectedResource?.available_actions?.includes(current) ? current : nextAction);
  }, [selectedResource]);

  useEffect(() => {
    if (selectedPolicy) {
      setApprovalRequired(selectedPolicy.approval_required === true);
      setApprovalType(selectedPolicy.approval_type ?? "ANYONE");
      setMinApprovers(String(selectedPolicy.min_approvers ?? MIN_REQUIRED_APPROVERS));
      setMaxApprovers(String(selectedPolicy.max_approvers ?? MAX_ALLOWED_APPROVERS));
      return;
    }

    setApprovalRequired(false);
    setApprovalType("ANYONE");
    setMinApprovers(MIN_REQUIRED_APPROVERS);
    setMaxApprovers(MAX_ALLOWED_APPROVERS);
  }, [selectedPolicy]);

  async function handleSave() {
    if (!selectedResource || !actionCode) {
      setError("Choose a business resource and action first.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await savePolicy({
        resource_code: selectedResource.resource_code,
        action_code: actionCode,
        approval_required: approvalRequired,
        approval_type: approvalRequired ? approvalType : null,
        min_approvers: approvalRequired ? Number(minApprovers) : Number(MIN_REQUIRED_APPROVERS),
        max_approvers: approvalRequired ? Number(maxApprovers) : Number(MAX_ALLOWED_APPROVERS),
      });
      await loadWorkspace(selectedResource.resource_code);
      console.info("RESOURCE_POLICY_SAVE_RESULT", {
        resource_code: selectedResource.resource_code,
        action_code: actionCode,
        approval_required: approvalRequired,
        approval_type: approvalRequired ? approvalType : null,
        min_approvers: approvalRequired ? Number(minApprovers) : Number(MIN_REQUIRED_APPROVERS),
        max_approvers: approvalRequired ? Number(maxApprovers) : Number(MAX_ALLOWED_APPROVERS),
      });
      setNotice(`Approval policy saved for ${selectedResource.resource_code} | ${actionCode}.`);
    } catch (err) {
      console.error("RESOURCE_POLICY_SAVE_FAILED", {
        resource_code: selectedResource.resource_code,
        action_code: actionCode,
        code: err?.code ?? null,
        requestId: err?.requestId ?? null,
        decisionTrace: err?.decisionTrace ?? null,
        message: err?.message ?? "RESOURCE_POLICY_UPSERT_FAILED",
      });
      setError(
        err instanceof Error
          ? `Approval policy could not be saved. ${err.message}`
          : "Approval policy could not be saved right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpApprovalReviewTemplate
      eyebrow="Approval Governance"
      title="Exact Resource Approval Policy"
      actions={[
        {
          key: "approver-rules",
          label: "Approver Rules",
          tone: "neutral",
          onClick: () => {
            openScreen("SA_APPROVAL_RULES", { mode: "replace" });
            navigate("/sa/approval-rules");
          },
        },
        {
          key: "report-visibility",
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
          label: saving ? "Saving..." : "Save Policy",
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
      footerHints={["↑↓ Navigate", "Enter Inspect", "Ctrl+S Save", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
      filterSection={{
        eyebrow: "Resource Search",
        title: "Filter business resources",
        children: (
          <QuickFilterInput
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchRef}
            placeholder="Search by page, resource, route, project, or module"
          />
        ),
      }}
      reviewSection={{
        eyebrow: "Mapped Business Resources",
        title: loading
          ? "Loading resources"
          : `${filteredResources.length} visible resource${filteredResources.length === 1 ? "" : "s"}`,
        count: filteredResources.length,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading resource approval workspace.
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No mapped business resource matches the current filter.
          </div>
        ) : (
          <ErpDenseGrid
            columns={[
              {
                key: "resource",
                label: "Resource",
                render: (row) => (
                  <div>
                    <div className="font-semibold text-slate-900">{row.title}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {row.resource_code}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {[row.project_code, row.module_code, row.route_path ?? "No route"]
                        .filter(Boolean)
                        .join(" | ")}
                    </div>
                  </div>
                ),
              },
              {
                key: "policies",
                label: "Policy Rows",
                align: "center",
                render: (row) => row.policies?.length ?? 0,
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) => row.available_actions?.join(", ") ?? "No action",
              },
            ]}
            rows={filteredResources}
            rowKey={(row) => row.resource_code}
            getRowProps={(row, index) => ({
              ...getRowProps(index),
              onClick: () => setSelectedResourceCode(row.resource_code),
              className: row.resource_code === selectedResourceCode ? "bg-sky-50" : "",
            })}
            onRowActivate={(row) => setSelectedResourceCode(row.resource_code)}
            maxHeight="none"
          />
        ),
      }}
      bottomSection={
        <section className="grid gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Selected Resource Policy
          </div>
          <div className="text-sm font-semibold text-slate-900">
            {selectedResource?.title ?? "Choose one business resource"}
          </div>
          {selectedResource ? (
            <div className="grid gap-4 border border-slate-300 bg-white px-4 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="border border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  <div className="font-semibold text-slate-900">{selectedResource.resource_code}</div>
                  <div className="mt-1">
                    {[selectedResource.project_code, selectedResource.module_code, selectedResource.route_path]
                      .filter(Boolean)
                      .join(" | ")}
                  </div>
                </div>
                <div className="border border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  <div className="font-semibold text-slate-900">Saved policy summary</div>
                  <div className="mt-1">
                    {selectedPolicy
                      ? `${selectedPolicy.action_code} | ${selectedPolicy.approval_required ? selectedPolicy.approval_type ?? "ANYONE" : "No approval"}`
                      : "No saved policy for the selected action."}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Action
                  </span>
                  <select
                    value={actionCode}
                    onChange={(event) => setActionCode(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                  >
                    {(selectedResource.available_actions ?? []).map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Approval Required
                  </span>
                  <span className="flex items-center gap-3 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                    <input
                      type="checkbox"
                      checked={approvalRequired}
                      onChange={(event) => setApprovalRequired(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Approval gate active for the selected action
                  </span>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Approval Type
                  </span>
                  <select
                    value={approvalType}
                    disabled={!approvalRequired}
                    onChange={(event) => setApprovalType(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-100"
                  >
                    {APPROVAL_TYPE_OPTIONS.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Min Approvers
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={minApprovers}
                    disabled={!approvalRequired}
                    onChange={(event) => setMinApprovers(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-100"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Max Approvers
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={maxApprovers}
                    disabled={!approvalRequired}
                    onChange={(event) => setMaxApprovers(event.target.value)}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-100"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Select one business resource row first, then configure its exact action policy.
            </div>
          )}
        </section>
      }
    />
  );
}
