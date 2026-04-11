import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";

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

export default function SAApprovalPolicy() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const rowRefs = useRef([]);
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
  const [minApprovers, setMinApprovers] = useState("1");
  const [maxApprovers, setMaxApprovers] = useState("3");

  async function loadWorkspace(preferredResourceCode = selectedResourceCode) {
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
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

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
      setMinApprovers(String(selectedPolicy.min_approvers ?? 1));
      setMaxApprovers(String(selectedPolicy.max_approvers ?? 3));
      return;
    }

    setApprovalRequired(false);
    setApprovalType("ANYONE");
    setMinApprovers("1");
    setMaxApprovers("3");
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
        min_approvers: approvalRequired ? Number(minApprovers) : 1,
        max_approvers: approvalRequired ? Number(maxApprovers) : 3,
      });
      await loadWorkspace(selectedResource.resource_code);
      console.info("RESOURCE_POLICY_SAVE_RESULT", {
        resource_code: selectedResource.resource_code,
        action_code: actionCode,
        approval_required: approvalRequired,
        approval_type: approvalRequired ? approvalType : null,
        min_approvers: approvalRequired ? Number(minApprovers) : 1,
        max_approvers: approvalRequired ? Number(maxApprovers) : 3,
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
      description="Decide which exact business page and action require approval. This is the lawbook below broad module defaults."
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
      metrics={[
        {
          key: "resources",
          label: "Mapped Resources",
          value: loading ? "..." : String(resources.length),
          tone: "sky",
          caption: "Only mapped business resources are governed here.",
        },
        {
          key: "filtered",
          label: "Visible",
          value: loading ? "..." : String(filteredResources.length),
          tone: "emerald",
          caption: "Resources matching the current filter.",
        },
        {
          key: "requires",
          label: "Approval Required",
          value: approvalRequired ? "YES" : "NO",
          tone: approvalRequired ? "amber" : "slate",
          caption: selectedResource ? `${selectedResource.resource_code} | ${actionCode}` : "Select a row to edit policy.",
        },
        {
          key: "selected",
          label: "Selected Module",
          value: selectedResource?.module_code ?? "-",
          tone: "slate",
          caption: selectedResource?.project_code ?? "No resource selected",
        },
      ]}
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
        description: "Leave and Out Work exact approval law should be controlled from here, not guessed from module-level defaults alone.",
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading resource approval workspace.
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No mapped business resource matches the current filter.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredResources.map((row, index) => (
              <button
                key={row.resource_code}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                type="button"
                onClick={() => setSelectedResourceCode(row.resource_code)}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index,
                    refs: rowRefs.current,
                    orientation: "vertical",
                  })}
                className={`border px-4 py-4 text-left ${
                  row.resource_code === selectedResourceCode
                    ? "border-sky-400 bg-sky-50"
                    : "border-slate-300 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{row.title}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {row.resource_code}
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      {row.project_code} | {row.module_code} | {row.route_path ?? "No route"}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{row.policies?.length ?? 0} policy row(s)</div>
                    <div>{row.available_actions?.join(", ")}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ),
      }}
      sideSection={{
        eyebrow: "Policy Editor",
        title: selectedResource?.title ?? "Select a business resource",
        description: selectedResource
          ? `${selectedResource.resource_code} | ${selectedResource.module_code}`
          : "Pick a resource from the left to edit approval law.",
        children: selectedResource ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Action
              </span>
              <select
                value={actionCode}
                onChange={(event) => setActionCode(event.target.value)}
                className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                {(selectedResource.available_actions ?? []).map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-3 border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(event) => setApprovalRequired(event.target.checked)}
              />
              This exact resource-action requires workflow approval
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Approval Type
              </span>
              <select
                value={approvalType}
                disabled={!approvalRequired}
                onChange={(event) => setApprovalType(event.target.value)}
                className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-100"
              >
                {APPROVAL_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Min Approvers
                </span>
                <select
                  value={minApprovers}
                  disabled={!approvalRequired}
                  onChange={(event) => setMinApprovers(event.target.value)}
                  className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-100"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Max Approvers
                </span>
                <select
                  value={maxApprovers}
                  disabled={!approvalRequired}
                  onChange={(event) => setMaxApprovers(event.target.value)}
                  className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-100"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
            </div>

            <div className="border border-slate-300 bg-slate-50 px-4 py-4 text-xs text-slate-600">
              <p>Current page should usually look like this:</p>
              <p>1. Apply page `WRITE` = approval required</p>
              <p>2. My Requests `VIEW` = no approval</p>
              <p>3. Approval Inbox `APPROVE` = no approval policy; approver rules decide who can act</p>
              <p>4. Register/History `VIEW` = no approval</p>
            </div>
          </div>
        ) : null,
      }}
    />
  );
}
