import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import {
  clearNavigationLeaveGuard,
  setNavigationLeaveGuard,
} from "../../../store/navigationLeaveGuard.js";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import {
  formatCompanyAddress,
  formatCompanyLabel,
  formatCompanyOptionLabel,
} from "../../../shared/companyDisplay.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchApi(path, options) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    const code = json?.code ?? "REQUEST_FAILED";
    const requestId = json?.request_id ? ` | Req ${json.request_id}` : "";
    const trace = json?.decision_trace ? ` | ${json.decision_trace}` : "";
    const publicMessage =
      typeof json?.message === "string" && json.message.trim().length > 0
        ? ` | ${json.message.trim()}`
        : "";
    const error = new Error(`${code}${trace}${publicMessage}${requestId}`);
    error.code = code;
    error.requestId = json?.request_id ?? null;
    error.decisionTrace = json?.decision_trace ?? null;
    throw error;
  }

  return json.data ?? {};
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status) {
  if (status === "CLEAN") return "emerald";
  if (status === "NO_ACTIVE_VERSION") return "amber";
  return "rose";
}

function statusLabel(status) {
  if (status === "CLEAN") return "Clean";
  if (status === "NO_ACTIVE_VERSION") return "No Active Version";
  return "Publish Required";
}

function statusPriority(status) {
  if (status === "NO_ACTIVE_VERSION") return 0;
  if (status === "PUBLISH_REQUIRED") return 1;
  return 2;
}

function buildVersionDescription(company) {
  const stamp = new Date().toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${company.company_code} ACL publish ${stamp}`;
}

function companySearchText(company) {
  return [
    company.company_code,
    company.company_name,
    company.company_status,
    company.status,
    company.recommendation,
    company.recommended_action?.title,
    company.recommended_action?.detail,
    ...(company.pending_reasons ?? []).flatMap((reason) => [
      reason.reason_code,
      reason.summary,
      reason.source_table,
      reason.change_kind,
    ]),
    ...(company.versions ?? []).flatMap((version) => [
      String(version.version_number),
      version.description,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function versionActionLabel(company) {
  const actionCode = company?.recommended_action?.action_code ?? "";
  if (actionCode === "CAPTURE_FIRST_ACTIVE_VERSION") {
    return "Capture First Active Version";
  }
  if (actionCode === "NO_PUBLISH_REQUIRED") {
    return "Capture Fresh Checkpoint";
  }
  return "Capture And Activate Now";
}

function orderedVersions(versions) {
  return [...(versions ?? [])].sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }
    return (right.version_number ?? 0) - (left.version_number ?? 0);
  });
}

export default function SAAclVersionCenter() {
  const navigate = useNavigate();
  const topRefs = useRef([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [versionDescription, setVersionDescription] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  async function loadCenter() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchApi("/api/admin/acl/version-center");
      const nextCompanies = data.companies ?? [];
      setCompanies(nextCompanies);
      setSelectedCompanyId((current) => {
        if (nextCompanies.some((company) => company.company_id === current)) {
          return current;
        }

        return (
          nextCompanies.find((company) => company.status === "NO_ACTIVE_VERSION")?.company_id ??
          nextCompanies.find((company) => company.publish_required)?.company_id ??
          nextCompanies[0]?.company_id ??
          ""
        );
      });
    } catch (caughtError) {
      console.error("ACL_VERSION_CENTER_LOAD_FAILED", {
        code: caughtError?.code ?? null,
        requestId: caughtError?.requestId ?? null,
        decisionTrace: caughtError?.decisionTrace ?? null,
        message: caughtError?.message ?? "REQUEST_FAILED",
      });
      setError(
        `ACL Version Center could not be loaded. ${caughtError.message ?? "REQUEST_FAILED"}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCenter();
  }, []);

  const publishRequiredCompanies = useMemo(
    () => companies.filter((company) => company.publish_required),
    [companies],
  );

  const filteredCompanies = useMemo(() => {
    const normalizedSearch = companySearch.trim().toLowerCase();

    return [...companies]
      .filter((company) => {
        if (statusFilter !== "ALL" && company.status !== statusFilter) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        return companySearchText(company).includes(normalizedSearch);
      })
      .sort((left, right) => {
        const statusGap = statusPriority(left.status) - statusPriority(right.status);
        if (statusGap !== 0) return statusGap;
        return `${left.company_code} ${left.company_name}`.localeCompare(
          `${right.company_code} ${right.company_name}`,
          "en",
          { sensitivity: "base" },
        );
      });
  }, [companies, companySearch, statusFilter]);

  const { getRowProps: getCompanyRowProps } = useErpListNavigation(filteredCompanies);

  useEffect(() => {
    if (filteredCompanies.length === 0) {
      return;
    }

    if (!filteredCompanies.some((company) => company.company_id === selectedCompanyId)) {
      setSelectedCompanyId(filteredCompanies[0].company_id);
    }
  }, [filteredCompanies, selectedCompanyId]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.company_id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const selectedVersions = useMemo(
    () => orderedVersions(selectedCompany?.versions ?? []),
    [selectedCompany],
  );

  useEffect(() => {
    if (!selectedCompany) {
      setVersionDescription("");
      return;
    }

    setVersionDescription(buildVersionDescription(selectedCompany));
  }, [selectedCompanyId, selectedCompany]);

  const publishRequiredCount = publishRequiredCompanies.length;

  useEffect(() => {
    if (publishRequiredCount > 0) {
      setNavigationLeaveGuard({
        active: true,
        scope: "ACL_VERSION_CENTER",
        title: "Leave Without Publishing Access Changes?",
        message:
          publishRequiredCount === 1
            ? "One company still needs a fresh ACL version before runtime users receive the latest access changes. Leave this page anyway?"
            : `${publishRequiredCount} companies still need fresh ACL versions before runtime users receive the latest access changes. Leave this page anyway?`,
        confirmLabel: "Leave Anyway",
        cancelLabel: "Stay Here",
      });
      return () => {
        clearNavigationLeaveGuard("ACL_VERSION_CENTER");
      };
    }

    clearNavigationLeaveGuard("ACL_VERSION_CENTER");

    return () => {
      clearNavigationLeaveGuard("ACL_VERSION_CENTER");
    };
  }, [publishRequiredCount]);

  useEffect(() => {
    if (publishRequiredCount === 0) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [publishRequiredCount]);

  async function confirmLeaveIfNeeded() {
    if (publishRequiredCount === 0) {
      return true;
    }

    return await openActionConfirm({
      eyebrow: "ACL Version Center",
      title: "Leave Without Publishing Access Changes?",
      message:
        publishRequiredCount === 1
          ? "One company still needs a fresh ACL version before runtime users receive the latest access changes. Leave this page anyway?"
          : `${publishRequiredCount} companies still need fresh ACL versions before runtime users receive the latest access changes. Leave this page anyway?`,
      confirmLabel: "Leave Anyway",
      cancelLabel: "Stay Here",
    });
  }

  async function handlePublishNow() {
    if (!selectedCompany) {
      setError("Choose one company first.");
      return;
    }

    const description = versionDescription.trim() || buildVersionDescription(selectedCompany);

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await fetchApi("/api/admin/acl/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: selectedCompany.company_id,
          description,
          activate_now: true,
        }),
      });
      await loadCenter();
      setNotice(`${selectedCompany.company_code} published into a fresh active ACL version.`);
      setVersionDescription(buildVersionDescription(selectedCompany));
    } catch (caughtError) {
      console.error("ACL_VERSION_CENTER_PUBLISH_FAILED", {
        company_id: selectedCompany.company_id,
        code: caughtError?.code ?? null,
        requestId: caughtError?.requestId ?? null,
        decisionTrace: caughtError?.decisionTrace ?? null,
        message: caughtError?.message ?? "REQUEST_FAILED",
      });
      setError(`ACL publish could not be completed. ${caughtError.message ?? "REQUEST_FAILED"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleActivateVersion(aclVersionId) {
    if (!selectedCompany) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await fetchApi("/api/admin/acl/versions/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: selectedCompany.company_id,
          acl_version_id: aclVersionId,
        }),
      });
      await loadCenter();
      setNotice(`${selectedCompany.company_code} now uses the selected ACL version.`);
    } catch (caughtError) {
      console.error("ACL_VERSION_CENTER_ACTIVATE_FAILED", {
        company_id: selectedCompany.company_id,
        acl_version_id: aclVersionId,
        code: caughtError?.code ?? null,
        requestId: caughtError?.requestId ?? null,
        decisionTrace: caughtError?.decisionTrace ?? null,
        message: caughtError?.message ?? "REQUEST_FAILED",
      });
      setError(`ACL version activate failed. ${caughtError.message ?? "REQUEST_FAILED"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveVersion(aclVersionId) {
    if (!selectedCompany) return;

    const approved = await openActionConfirm({
      eyebrow: "ACL Version Center",
      title: "Remove Inactive ACL Version",
      message: "This inactive company ACL version will be removed permanently. Continue?",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
    });

    if (!approved) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await fetchApi("/api/admin/acl/versions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: selectedCompany.company_id,
          acl_version_id: aclVersionId,
        }),
      });
      await loadCenter();
      setNotice("Inactive ACL version removed.");
    } catch (caughtError) {
      console.error("ACL_VERSION_CENTER_DELETE_FAILED", {
        company_id: selectedCompany.company_id,
        acl_version_id: aclVersionId,
        code: caughtError?.code ?? null,
        requestId: caughtError?.requestId ?? null,
        decisionTrace: caughtError?.decisionTrace ?? null,
        message: caughtError?.message ?? "REQUEST_FAILED",
      });
      setError(`ACL version remove failed. ${caughtError.message ?? "REQUEST_FAILED"}`);
    } finally {
      setSaving(false);
    }
  }

  useErpScreenCommands([
    {
      id: "sa-acl-version-center-refresh",
      group: "Current Screen",
      label: "Refresh ACL version center",
      keywords: ["acl", "version", "publish", "refresh"],
      disabled: loading || saving,
      perform: () => void loadCenter(),
      order: 10,
    },
    {
      id: "sa-acl-version-center-capability-governance",
      group: "Current Screen",
      label: "Go to capability governance",
      keywords: ["capability", "packs", "work scopes"],
      perform: async () => {
        const approved = await confirmLeaveIfNeeded();
        if (!approved) return;
        openScreen("SA_CAPABILITY_GOVERNANCE", { mode: "replace" });
        navigate("/sa/acl/capabilities");
      },
      order: 20,
    },
    {
      id: "sa-acl-version-center-control-panel",
      group: "Current Screen",
      label: "Go to control panel",
      keywords: ["control panel", "diagnostics"],
      perform: async () => {
        const approved = await confirmLeaveIfNeeded();
        if (!approved) return;
        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading || saving,
      perform: () => void loadCenter(),
    },
  });

  return (
    <ErpScreenScaffold
      eyebrow="SA ACL Version Center"
      title="Company Publish Control"
      actions={[
        {
          key: "refresh",
          label: loading || saving ? "Refreshing..." : "Refresh Center",
          tone: "primary",
          buttonRef: (element) => {
            topRefs.current[0] = element;
          },
          onClick: () => void loadCenter(),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: topRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "capability-governance",
          label: "Capability Governance",
          tone: "neutral",
          buttonRef: (element) => {
            topRefs.current[1] = element;
          },
          onClick: async () => {
            const approved = await confirmLeaveIfNeeded();
            if (!approved) return;
            openScreen("SA_CAPABILITY_GOVERNANCE", { mode: "replace" });
            navigate("/sa/acl/capabilities");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: topRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "control-panel",
          label: "Control Panel",
          tone: "neutral",
          buttonRef: (element) => {
            topRefs.current[2] = element;
          },
          onClick: async () => {
            const approved = await confirmLeaveIfNeeded();
            if (!approved) return;
            openScreen("SA_CONTROL_PANEL", { mode: "replace" });
            navigate("/sa/control-panel");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 2,
              refs: topRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      footerHints={["↑↓ Navigate", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
        ...(publishRequiredCount > 0
          ? [{
              key: "publish-needed",
              tone: "warning",
              message:
                publishRequiredCount === 1
                  ? "One company still needs a fresh ACL publish before runtime users receive the latest access changes."
                  : `${publishRequiredCount} companies still need a fresh ACL publish before runtime users receive the latest access changes.`,
            }]
          : []),
      ]}
    >
      <div className="grid gap-[var(--erp-section-gap)] xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-1">
          <ErpSelectionSection label="Publish Recommendation By Company" />
          <div className="grid gap-[var(--erp-form-gap)] border border-slate-300 bg-white p-3">
            <QuickFilterInput
              label="Search Company Or Reason"
              value={companySearch}
              onChange={setCompanySearch}
              placeholder="Type company code, company name, reason, or version"
              hint={`Showing ${filteredCompanies.length} of ${companies.length} companies.`}
              inputProps={{ list: "acl-version-center-company-suggestions" }}
            />
            <datalist id="acl-version-center-company-suggestions">
              {companies.map((company) => (
                <option
                  key={company.company_id}
                  value={company.company_code}
                >
                  {formatCompanyOptionLabel(company)}
                </option>
              ))}
              {companies.map((company) => (
                <option
                  key={`${company.company_id}-name`}
                  value={company.company_name}
                >
                  {formatCompanyOptionLabel(company)}
                </option>
              ))}
            </datalist>
            <ErpDenseFormRow label="Status Filter">
              <ErpComboboxField
                value={statusFilter}
                onChange={(val) => { if (val) setStatusFilter(val); }}
                options={[
                  { value: "ALL", label: "All Companies" },
                  { value: "NO_ACTIVE_VERSION", label: "No Active Version" },
                  { value: "PUBLISH_REQUIRED", label: "Publish Required" },
                  { value: "CLEAN", label: "Clean" },
                ]}
                blankLabel="-- Filter --"
                inputClassName="px-3 py-2 text-sm"
              />
            </ErpDenseFormRow>
            <p className="text-xs text-slate-500">
              Showing {filteredCompanies.length} of {companies.length} companies.
            </p>
          </div>

          <div className="mt-4 border border-slate-300 bg-white">
            {filteredCompanies.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500">
                {loading
                  ? "Loading company publish status."
                  : "No company matches the current search or status filter."}
              </div>
            ) : (
              filteredCompanies.map((company, index) => {
                const selected = company.company_id === selectedCompanyId;
                const tone = statusTone(company.status);
                return (
                  <button
                    key={company.company_id}
                    {...getCompanyRowProps(index)}
                    type="button"
                    onClick={() => setSelectedCompanyId(company.company_id)}
                    className={`grid w-full gap-1 border-b px-2 py-[6px] text-left last:border-b-0 ${
                      selected ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {formatCompanyLabel(company)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{formatCompanyAddress(company)}</p>
                        <p className="mt-1 text-xs text-slate-500">{company.recommendation}</p>
                      </div>
                      <span
                        className={`border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          tone === "emerald"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : tone === "amber"
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-rose-300 bg-rose-50 text-rose-800"
                        }`}
                      >
                        {statusLabel(company.status)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      <span>
                        {company.active_version
                          ? `Active V${company.active_version.version_number}`
                          : "No active version"}
                      </span>
                      <span>{company.versions.length} published version{company.versions.length === 1 ? "" : "s"}</span>
                      <span>
                        {company.pending_change_count} pending reason{company.pending_change_count === 1 ? "" : "s"}
                      </span>
                      <span>Latest change {formatDateTime(company.latest_pending_change_at)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="grid gap-6">
          <div className="grid gap-1">
            <ErpSelectionSection label={selectedCompany ? `${selectedCompany.company_code} Publish Desk` : "Choose One Company"} />
            {!selectedCompany ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Choose one company from the left list.
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="border border-slate-300 bg-white">
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Company</span><span className="text-[11px] font-semibold text-slate-900">{formatCompanyLabel(selectedCompany)}</span></div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Status</span><span className="text-[11px] font-semibold text-slate-900">{statusLabel(selectedCompany.status)}</span></div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Recommended</span><span className="text-[11px] font-semibold text-slate-900">{selectedCompany.recommended_action?.title ?? "Review versions"}</span></div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Active Version</span><span className="text-[11px] font-semibold text-slate-900">{selectedCompany.active_version ? `V${selectedCompany.active_version.version_number}` : "None"}</span></div>
                  <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Published History</span><span className="text-[11px] font-semibold text-slate-900">{selectedCompany.active_version_count} active | {selectedCompany.inactive_version_count} inactive</span></div>
                </div>

                <div className="grid gap-[var(--erp-form-gap)] border border-slate-300 bg-white p-3">
                  <ErpDenseFormRow label="Next Version Description">
                    <input
                      type="text"
                      value={versionDescription}
                      onChange={(event) => setVersionDescription(event.target.value)}
                      placeholder="Company publish version description"
                      className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                    />
                  </ErpDenseFormRow>

                  <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handlePublishNow()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-900"
                  >
                    {saving ? "Publishing..." : versionActionLabel(selectedCompany)}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setVersionDescription(buildVersionDescription(selectedCompany))}
                    className="border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                  >
                    Reset Description
                  </button>
                </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Why Publish Is Recommended" />
            {!selectedCompany ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Choose one company first.
              </div>
            ) : selectedCompany.pending_reasons.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No unpublished tracked access-governance change is waiting for this company.
              </div>
            ) : (
              <div className="border border-slate-300 bg-white">
                {selectedCompany.pending_reasons.map((reason) => (
                  <div
                    key={`${reason.reason_code}-${reason.created_at}`}
                    className="border-b border-slate-200 px-4 py-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{reason.summary}</p>
                      <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                        {reason.reason_code}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {reason.source_table} | {reason.is_global ? "Global source" : "Company source"} |{" "}
                      {reason.change_kind} | {formatDateTime(reason.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Existing Versions" />
            {!selectedCompany ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Choose one company first.
              </div>
            ) : selectedVersions.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No ACL version exists for this company yet.
              </div>
            ) : (
              <div className="border border-slate-300 bg-white">
                {selectedVersions.map((version) => (
                  <div
                    key={version.acl_version_id}
                    className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 last:border-b-0"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          V{version.version_number} | {version.description}
                        </p>
                        {version.is_active ? (
                          <span className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                            Active Runtime Version
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {version.is_active ? "Active" : "Inactive"} | Created {formatDateTime(version.created_at)} | Source frozen{" "}
                        {formatDateTime(version.source_captured_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={saving || version.is_active}
                        onClick={() => void handleActivateVersion(version.acl_version_id)}
                        className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          version.is_active
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        {version.is_active ? "Active" : "Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={saving || version.is_active}
                        onClick={() => void handleRemoveVersion(version.acl_version_id)}
                        className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          version.is_active
                            ? "border-slate-200 bg-slate-100 text-slate-400"
                            : "border-rose-300 bg-rose-50 text-rose-700"
                        }`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
