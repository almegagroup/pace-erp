import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";

const ACTION_MATRIX = [
  ["VIEW", "can_view", "View"],
  ["WRITE", "can_write", "Write"],
  ["EDIT", "can_edit", "Edit"],
  ["DELETE", "can_delete", "Delete"],
  ["APPROVE", "can_approve", "Approve"],
  ["EXPORT", "can_export", "Export"],
];

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
    throw new Error(`${code}${trace}${requestId}`);
  }

  return json.data ?? {};
}

function createDraft(capabilityCode = "") {
  return {
    capability_code: capabilityCode,
    resource_code: "",
    can_view: true,
    can_write: false,
    can_edit: false,
    can_delete: false,
    can_approve: false,
    can_export: false,
    denied_actions: [],
  };
}

function createCapabilityDraft() {
  return {
    capability_code: "",
    capability_name: "",
    description: "",
  };
}

export default function SACapabilityGovernance() {
  const navigate = useNavigate();
  const topActionRefs = useRef([]);
  const resourceInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const [companies, setCompanies] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [workContexts, setWorkContexts] = useState([]);
  const [versions, setVersions] = useState([]);
  const [capabilityRows, setCapabilityRows] = useState([]);
  const [workContextCapabilities, setWorkContextCapabilities] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedCapabilityCode, setSelectedCapabilityCode] = useState("");
  const [selectedWorkContextId, setSelectedWorkContextId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState(() => createDraft());
  const [capabilityDraft, setCapabilityDraft] = useState(() => createCapabilityDraft());
  const [workContextDraft, setWorkContextDraft] = useState({
    work_context_code: "",
    work_context_name: "",
    description: "",
  });
  const [versionDescription, setVersionDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadBootstrap() {
    setLoading(true);
    setError("");

    try {
      const [companyData, capabilityData] = await Promise.all([
        fetchApi("/api/admin/companies"),
        fetchApi("/api/admin/acl/capabilities"),
      ]);
      const nextCompanies = companyData.companies ?? [];
      const nextCapabilities = capabilityData.capabilities ?? [];
      setCompanies(nextCompanies);
      setCapabilities(nextCapabilities);

      if (!selectedCompanyId) {
        setSelectedCompanyId(nextCompanies[0]?.id ?? "");
      }

      if (!selectedCapabilityCode) {
        const capabilityCode = nextCapabilities[0]?.capability_code ?? "";
        setSelectedCapabilityCode(capabilityCode);
        setDraft(createDraft(capabilityCode));
      }
    } catch (err) {
      setError(`Capability governance bootstrap could not be loaded. ${(err).message ?? "REQUEST_FAILED"}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadCapabilityRows(capabilityCode = selectedCapabilityCode) {
    if (!capabilityCode) {
      setCapabilityRows([]);
      return;
    }

    try {
      const data = await fetchApi(
        `/api/admin/acl/capability-actions?capability_code=${encodeURIComponent(capabilityCode)}`
      );
      setCapabilityRows(data.permissions ?? []);
    } catch (err) {
      setCapabilityRows([]);
      setError(`Capability action rows could not be loaded. ${(err).message ?? "REQUEST_FAILED"}`);
    }
  }

  async function loadCompanyState(companyId = selectedCompanyId) {
    if (!companyId) {
      setWorkContexts([]);
      setVersions([]);
      return;
    }

    try {
      const [workContextData, versionData] = await Promise.all([
        fetchApi(`/api/admin/acl/work-contexts?company_id=${encodeURIComponent(companyId)}`),
        fetchApi(`/api/admin/acl/versions?company_id=${encodeURIComponent(companyId)}`),
      ]);
      const nextWorkContexts = workContextData.work_contexts ?? [];
      setWorkContexts(nextWorkContexts);
      setVersions(versionData.versions ?? []);
      setSelectedWorkContextId((current) =>
        nextWorkContexts.some((row) => row.work_context_id === current)
          ? current
          : nextWorkContexts[0]?.work_context_id ?? ""
      );
    } catch (err) {
      setWorkContexts([]);
      setVersions([]);
      setError(`Company capability state could not be loaded. ${(err).message ?? "REQUEST_FAILED"}`);
    }
  }

  async function loadWorkContextCapabilities(workContextId = selectedWorkContextId) {
    if (!workContextId) {
      setWorkContextCapabilities([]);
      return;
    }

    try {
      const data = await fetchApi(
        `/api/admin/acl/work-context-capabilities?work_context_id=${encodeURIComponent(workContextId)}`
      );
      setWorkContextCapabilities(data.capabilities ?? []);
    } catch (err) {
      setWorkContextCapabilities([]);
      setError(`Work-context capability bindings could not be loaded. ${(err).message ?? "REQUEST_FAILED"}`);
    }
  }

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (selectedCapabilityCode) {
      setDraft((current) => ({ ...createDraft(selectedCapabilityCode), resource_code: current.resource_code }));
    }
    void loadCapabilityRows(selectedCapabilityCode);
  }, [selectedCapabilityCode]);

  useEffect(() => {
    void loadCompanyState(selectedCompanyId);
  }, [selectedCompanyId]);

  useEffect(() => {
    void loadWorkContextCapabilities(selectedWorkContextId);
  }, [selectedWorkContextId]);

  const filteredCapabilityRows = useMemo(
    () => applyQuickFilter(capabilityRows, searchQuery, ["resource_code"]),
    [capabilityRows, searchQuery]
  );

  async function postAndRefresh(path, payload, refreshFn, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await fetchApi(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refreshFn();
      setNotice(successMessage);
    } catch (err) {
      setError(`Governance request could not be completed. ${(err).message ?? "REQUEST_FAILED"}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveCapabilityPack() {
    const capabilityCode = capabilityDraft.capability_code.trim().toUpperCase();
    const capabilityName = capabilityDraft.capability_name.trim();

    if (!capabilityCode || !capabilityName) {
      setError("Capability code and capability name are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await fetchApi("/api/admin/acl/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability_code: capabilityCode,
          capability_name: capabilityName,
          description: capabilityDraft.description.trim(),
        }),
      });

      await loadBootstrap();
      setSelectedCapabilityCode(capabilityCode);
      setDraft(createDraft(capabilityCode));
      setCapabilityDraft(createCapabilityDraft());
      setNotice(`Capability ${capabilityCode} saved successfully.`);
    } catch (err) {
      setError(`Capability pack could not be saved. ${(err).message ?? "REQUEST_FAILED"}`);
    } finally {
      setSaving(false);
    }
  }

  useErpScreenCommands([
    {
      id: "sa-capability-governance-control-panel",
      group: "Current Screen",
      label: "Go to SA control panel",
      keywords: ["control panel", "sa"],
      perform: () => {
        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      order: 10,
    },
  ]);

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => void loadBootstrap() },
    focusSearch: { perform: () => searchInputRef.current?.focus() },
    focusPrimary: { perform: () => resourceInputRef.current?.focus() },
  });

  return (
    <ErpScreenScaffold
      eyebrow="SA Capability Governance"
      title="Capability, Work Context, and ACL Version Control"
      description="Govern capability actions, bind capability packs to work contexts, create work contexts, and freeze immutable ACL versions from one SA surface."
      actions={[
        {
          key: "control-panel",
          label: "Control Panel",
          tone: "neutral",
          buttonRef: (element) => {
            topActionRefs.current[0] = element;
          },
          onClick: () => {
            openScreen("SA_CONTROL_PANEL", { mode: "replace" });
            navigate("/sa/control-panel");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: topActionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      metrics={[
        { key: "caps", label: "Capabilities", value: loading ? "..." : String(capabilities.length), tone: "sky", caption: "Available capability packs." },
        { key: "contexts", label: "Work Contexts", value: loading ? "..." : String(workContexts.length), tone: "emerald", caption: "Contexts in selected company." },
        { key: "rows", label: "Capability Rows", value: loading ? "..." : String(capabilityRows.length), tone: "amber", caption: "Rows for selected capability." },
        { key: "versions", label: "ACL Versions", value: loading ? "..." : String(versions.length), tone: "slate", caption: "Frozen versions for selected company." },
      ]}
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <ErpSectionCard eyebrow="Capability Actions" title="Resource matrix" description="Select a capability pack, then govern its exact resource-action rows.">
          <div className="mb-6 grid gap-3 border border-slate-300 bg-slate-50 px-4 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Create Capability Pack</p>
              <p className="mt-1 text-xs text-slate-600">Start by creating packs like `CAP_HR_REQUESTER`, `CAP_HR_APPROVER`, or `CAP_HR_REPORT_VIEWER`.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={capabilityDraft.capability_code}
                onChange={(event) =>
                  setCapabilityDraft((current) => ({
                    ...current,
                    capability_code: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="CAPABILITY_CODE"
                className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
              />
              <input
                type="text"
                value={capabilityDraft.capability_name}
                onChange={(event) =>
                  setCapabilityDraft((current) => ({
                    ...current,
                    capability_name: event.target.value,
                  }))
                }
                placeholder="Capability Name"
                className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </div>
            <textarea
              value={capabilityDraft.description}
              onChange={(event) =>
                setCapabilityDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={2}
              placeholder="Description"
              className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveCapabilityPack()}
                className="border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900"
              >
                Save Capability Pack
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  setCapabilityDraft({
                    capability_code: "CAP_HR_REQUESTER",
                    capability_name: "HR Requester",
                    description: "Requester access for leave and out work apply/my-request pages.",
                  })
                }
                className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Use Requester Template
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  setCapabilityDraft({
                    capability_code: "CAP_HR_APPROVER",
                    capability_name: "HR Approver",
                    description: "Approver inbox and approval-history access for HR workflows.",
                  })
                }
                className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Use Approver Template
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  setCapabilityDraft({
                    capability_code: "CAP_HR_REPORT_VIEWER",
                    capability_name: "HR Report Viewer",
                    description: "Register and reporting visibility without approval authority.",
                  })
                }
                className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Use Report Template
              </button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Capability</span>
              <select value={selectedCapabilityCode} onChange={(event) => setSelectedCapabilityCode(event.target.value)} className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none">
                {capabilities.length === 0 ? <option value="">No capability pack yet</option> : null}
                {capabilities.map((capability) => (
                  <option key={capability.capability_code} value={capability.capability_code}>
                    {capability.capability_code} | {capability.capability_name}
                  </option>
                ))}
              </select>
            </label>
            <QuickFilterInput label="Find Resource Row" value={searchQuery} onChange={setSearchQuery} inputRef={searchInputRef} placeholder="Filter by resource code" hint="Alt+Shift+F focuses this filter." />
          </div>
          <label className="mt-4 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Resource Code</span>
            <input ref={resourceInputRef} data-workspace-primary-focus="true" type="text" value={draft.resource_code} onChange={(event) => setDraft((current) => ({ ...current, resource_code: event.target.value.toUpperCase() }))} placeholder="RESOURCE_CODE" className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none" />
          </label>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {ACTION_MATRIX.map(([actionCode, key, label]) => (
              <button key={actionCode} type="button" onClick={() => setDraft((current) => ({ ...current, [key]: !current[key], denied_actions: current.denied_actions.includes(actionCode) ? current.denied_actions.filter((item) => item !== actionCode) : current.denied_actions }))} className={`border px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] ${draft[key] ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600"}`}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" disabled={saving} onClick={() => void postAndRefresh("/api/admin/acl/capability-actions", { ...draft, capability_code: selectedCapabilityCode, resource_code: draft.resource_code.trim() }, () => loadCapabilityRows(selectedCapabilityCode), "Capability row saved successfully.")} className="mt-4 border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
            Save Capability Row
          </button>
          <div className="mt-6 border border-slate-300">
            {filteredCapabilityRows.length === 0 ? (
              <div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">No capability row matches the current filter.</div>
            ) : (
              filteredCapabilityRows.map((row) => (
                <div key={row.resource_code} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 bg-white px-4 py-3 last:border-b-0">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{row.resource_code}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{ACTION_MATRIX.filter(([, key]) => row[key]).length} allow flag(s)</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setDraft({ capability_code: selectedCapabilityCode, resource_code: row.resource_code, can_view: row.can_view, can_write: row.can_write, can_edit: row.can_edit, can_delete: row.can_delete, can_approve: row.can_approve, can_export: row.can_export, denied_actions: row.denied_actions ?? [] })} className="border border-cyan-300 bg-cyan-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">Edit</button>
                    <button type="button" onClick={() => void postAndRefresh("/api/admin/acl/capability-actions/disable", { capability_code: selectedCapabilityCode, resource_code: row.resource_code }, () => loadCapabilityRows(selectedCapabilityCode), `Capability row disabled for ${row.resource_code}.`)} className="border border-rose-300 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">Disable</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ErpSectionCard>

        <div className="grid gap-6">
          <ErpSectionCard eyebrow="Work Contexts" title="Functional responsibility binding" description="Create contexts in the selected company and bind capability packs that should drive runtime menu changes.">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Company</span>
              <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)} className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none">
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.company_code} | {company.company_name}</option>
                ))}
              </select>
            </label>
            <div className="mt-4 grid gap-3">
              <input type="text" value={workContextDraft.work_context_code} onChange={(event) => setWorkContextDraft((current) => ({ ...current, work_context_code: event.target.value.toUpperCase() }))} placeholder="WORK_CONTEXT_CODE" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              <input type="text" value={workContextDraft.work_context_name} onChange={(event) => setWorkContextDraft((current) => ({ ...current, work_context_name: event.target.value }))} placeholder="Work Context Name" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              <textarea value={workContextDraft.description} onChange={(event) => setWorkContextDraft((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Description" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              <button type="button" disabled={saving} onClick={() => void postAndRefresh("/api/admin/acl/work-contexts", { company_id: selectedCompanyId, ...workContextDraft }, () => loadCompanyState(selectedCompanyId), "Work context saved successfully.")} className="border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">Save Work Context</button>
            </div>
            <div className="mt-6 border border-slate-300">
              {workContexts.length === 0 ? (
                <div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">No work context is currently defined for this company.</div>
              ) : (
                workContexts.map((row) => (
                  <button key={row.work_context_id} type="button" onClick={() => setSelectedWorkContextId(row.work_context_id)} className={`grid w-full border-b px-4 py-3 text-left last:border-b-0 ${row.work_context_id === selectedWorkContextId ? "border-violet-300 bg-violet-50 text-violet-900" : "border-slate-300 bg-white text-slate-700"}`}>
                    <span className="text-sm font-semibold">{row.work_context_code} | {row.work_context_name}</span>
                    <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{row.department_code ? `${row.department_code} | ${row.department_name}` : "Company-wide context"}</span>
                  </button>
                ))
              )}
            </div>
            <button type="button" disabled={!selectedWorkContextId || !selectedCapabilityCode || saving} onClick={() => void postAndRefresh("/api/admin/acl/work-context-capabilities/assign", { work_context_id: selectedWorkContextId, capability_code: selectedCapabilityCode }, () => loadWorkContextCapabilities(selectedWorkContextId), `Capability ${selectedCapabilityCode} attached to the selected work context.`)} className="mt-4 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Attach Selected Capability</button>
            <div className="mt-4 border border-slate-300">
              {workContextCapabilities.length === 0 ? (
                <div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">No capability pack is currently attached to the selected work context.</div>
              ) : (
                workContextCapabilities.map((capability) => (
                  <div key={capability.capability_code} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3 last:border-b-0">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{capability.capability_code}</p>
                      <p className="mt-1 text-xs text-slate-500">{capability.capability_name || "Capability name not captured"}</p>
                    </div>
                    <button type="button" onClick={() => void postAndRefresh("/api/admin/acl/work-context-capabilities/unassign", { work_context_id: selectedWorkContextId, capability_code: capability.capability_code }, () => loadWorkContextCapabilities(selectedWorkContextId), `Capability ${capability.capability_code} removed from the selected work context.`)} className="border border-rose-300 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">Remove</button>
                  </div>
                ))
              )}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="ACL Versions" title="Immutable company ledger" description="Freeze current governance rows into a new ACL version, then activate only the version runtime should use.">
            <input type="text" value={versionDescription} onChange={(event) => setVersionDescription(event.target.value)} placeholder="Version description" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
            <button type="button" disabled={!selectedCompanyId || saving} onClick={() => void postAndRefresh("/api/admin/acl/versions", { company_id: selectedCompanyId, description: versionDescription.trim() }, () => loadCompanyState(selectedCompanyId), "Immutable ACL version captured successfully.")} className="mt-4 border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">Capture Immutable Version</button>
            <div className="mt-6 border border-slate-300">
              {versions.length === 0 ? (
                <div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">No ACL version is currently available for this company.</div>
              ) : (
                versions.map((version) => (
                  <div key={version.acl_version_id} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 bg-white px-4 py-3 last:border-b-0">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">V{version.version_number} | {version.description}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{version.is_active ? "Active" : "Inactive"}{version.source_captured_at ? " | Source frozen" : ""}</p>
                    </div>
                    <button type="button" disabled={version.is_active || saving} onClick={() => void postAndRefresh("/api/admin/acl/versions/activate", { company_id: selectedCompanyId, acl_version_id: version.acl_version_id }, () => loadCompanyState(selectedCompanyId), "ACL version activated successfully.")} className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${version.is_active ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-700"}`}>{version.is_active ? "Active" : "Activate"}</button>
                  </div>
                ))
              )}
            </div>
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
