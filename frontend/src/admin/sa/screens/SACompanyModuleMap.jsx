import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import {
  formatCompanyAddress,
  formatCompanyLabel,
} from "../../../shared/companyDisplay.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchCompanies() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/companies`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.companies)) {
    throw new Error(json?.code ?? "COMPANY_LIST_FAILED");
  }

  return json.data.companies;
}

async function fetchCompanyModules(companyId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/company-modules?company_id=${encodeURIComponent(companyId)}`,
    {
      credentials: "include",
    },
  );
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.modules)) {
    throw new Error(json?.code ?? "COMPANY_MODULE_LIST_FAILED");
  }

  return json.data;
}

async function postJson(path, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "COMPANY_MODULE_TOGGLE_FAILED");
  }

  return json.data;
}

function sortCompanies(rows) {
  return [...rows].sort((left, right) =>
    String(left.company_code ?? "").localeCompare(String(right.company_code ?? ""), "en", {
      sensitivity: "base",
    }),
  );
}

function sortModules(rows) {
  return [...rows].sort((left, right) => {
    const projectCompare = String(left.project_code ?? "").localeCompare(
      String(right.project_code ?? ""),
      "en",
      { sensitivity: "base" },
    );

    if (projectCompare !== 0) {
      return projectCompare;
    }

    return String(left.module_code ?? "").localeCompare(String(right.module_code ?? ""), "en", {
      sensitivity: "base",
    });
  });
}

export default function SACompanyModuleMap() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const companySearchRef = useRef(null);
  const moduleSearchRef = useRef(null);
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [modulePayload, setModulePayload] = useState(null);
  const [selectedModuleCode, setSelectedModuleCode] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [moduleSearch, setModuleSearch] = useState("");
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingModules, setLoadingModules] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCompanies = useCallback(async (preferredCompanyId = selectedCompanyId) => {
    setLoadingCompanies(true);
    setError("");

    try {
      const rows = sortCompanies(await fetchCompanies());
      const nextCompanyId =
        rows.find((row) => row.id === preferredCompanyId)?.id ??
        rows[0]?.id ??
        "";

      setCompanies(rows);
      setSelectedCompanyId(nextCompanyId);
    } catch (err) {
      console.error("COMPANY_MODULE_COMPANY_LOAD_FAILED", {
        company_id: preferredCompanyId || null,
        message: err?.message ?? "COMPANY_LIST_FAILED",
      });
      setCompanies([]);
      setSelectedCompanyId("");
      setModulePayload(null);
      setSelectedModuleCode("");
      setError("Company module workspace could not load company rows right now.");
    } finally {
      setLoadingCompanies(false);
    }
  }, [selectedCompanyId]);

  const loadModules = useCallback(async (companyId = selectedCompanyId, preferredModuleCode = selectedModuleCode) => {
    if (!companyId) {
      setModulePayload(null);
      setSelectedModuleCode("");
      return;
    }

    setLoadingModules(true);
    setError("");

    try {
      const data = await fetchCompanyModules(companyId);
      const nextModules = sortModules(data.modules ?? []);
      const nextModuleCode =
        nextModules.find((row) => row.module_code === preferredModuleCode)?.module_code ??
        nextModules[0]?.module_code ??
        "";

      setModulePayload({
        ...data,
        modules: nextModules,
      });
      setSelectedModuleCode(nextModuleCode);
    } catch (err) {
      console.error("COMPANY_MODULE_LOAD_FAILED", {
        company_id: companyId,
        module_code: preferredModuleCode || null,
        message: err?.message ?? "COMPANY_MODULE_LIST_FAILED",
      });
      setModulePayload(null);
      setSelectedModuleCode("");
      setError("Company module rows could not be loaded right now.");
    } finally {
      setLoadingModules(false);
    }
  }, [selectedCompanyId, selectedModuleCode]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    void loadModules(selectedCompanyId);
  }, [loadModules, selectedCompanyId]);

  const filteredCompanies = useMemo(
    () =>
      applyQuickFilter(companies, companySearch, [
        "company_code",
        "company_name",
        "gst_number",
        "status",
        "group_code",
        "group_name",
      ]),
    [companies, companySearch],
  );

  useEffect(() => {
    if (!filteredCompanies.some((row) => row.id === selectedCompanyId)) {
      setSelectedCompanyId(filteredCompanies[0]?.id ?? "");
    }
  }, [filteredCompanies, selectedCompanyId]);

  const modules = useMemo(() => modulePayload?.modules ?? [], [modulePayload]);

  const filteredModules = useMemo(
    () =>
      applyQuickFilter(modules, moduleSearch, [
        "module_code",
        "module_name",
        "project_code",
        "project_name",
        "approval_type",
        "enabled",
      ]),
    [modules, moduleSearch],
  );

  useEffect(() => {
    if (!filteredModules.some((row) => row.module_code === selectedModuleCode)) {
      setSelectedModuleCode(filteredModules[0]?.module_code ?? "");
    }
  }, [filteredModules, selectedModuleCode]);

  const selectedCompany = companies.find((row) => row.id === selectedCompanyId) ?? null;
  const selectedModule =
    filteredModules.find((row) => row.module_code === selectedModuleCode) ??
    modules.find((row) => row.module_code === selectedModuleCode) ??
    null;

  const { getRowProps: getCompanyRowProps } = useErpListNavigation(filteredCompanies);
  const { getRowProps: getModuleRowProps } = useErpListNavigation(filteredModules);

  const enabledModules = modules.filter((row) => row.enabled);
  const uniqueProjects = new Set(modules.map((row) => row.project_code).filter(Boolean));

  useErpScreenHotkeys({
    refresh: {
      disabled: loadingModules || loadingCompanies,
      perform: () => void loadModules(selectedCompanyId, selectedModuleCode),
    },
    focusSearch: {
      perform: () => moduleSearchRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => companySearchRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-company-module-map-module-master",
      group: "Current Screen",
      label: "Open module master",
      keywords: ["module master", "create module"],
      perform: () => {
        openScreen("SA_MODULE_MASTER", { mode: "replace" });
        navigate("/sa/module-master");
      },
      order: 10,
    },
    {
      id: "sa-company-module-map-project-map",
      group: "Current Screen",
      label: "Open company project map",
      keywords: ["project map", "company project map"],
      perform: () => {
        openScreen("SA_COMPANY_PROJECT_MAP", { mode: "replace" });
        navigate("/sa/projects/map");
      },
      order: 20,
    },
  ]);

  async function handleToggle(row) {
    if (!selectedCompany) {
      return;
    }

    const nextAction = row.enabled ? "disable" : "enable";

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const path =
        nextAction === "enable"
          ? "/api/admin/acl/company-module/enable"
          : "/api/admin/acl/company-module/disable";
      const payload = {
        company_id: selectedCompany.id,
        module_code: row.module_code,
      };

      const result = await postJson(path, payload);
      console.info("COMPANY_MODULE_TOGGLE_RESULT", {
        path,
        requested: payload,
        persisted: result ?? null,
      });

      await loadModules(selectedCompany.id, row.module_code);
      setNotice(
        `Module ${row.module_code} ${nextAction === "enable" ? "enabled for" : "disabled for"} ${selectedCompany.company_code}.`,
      );
    } catch (err) {
      console.error("COMPANY_MODULE_TOGGLE_FAILED", {
        company_id: selectedCompany.id,
        module_code: row.module_code,
        action: nextAction,
        message: err?.message ?? "COMPANY_MODULE_TOGGLE_FAILED",
      });
      setError(
        err instanceof Error
          ? `Company module mapping could not be saved. ${err.message}`
          : "Company module mapping could not be saved right now."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Company Module Rollout"
      title="Company Module Map"
      actions={[
        {
          key: "module-master",
          label: "Module Master",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => {
            openScreen("SA_MODULE_MASTER", { mode: "replace" });
            navigate("/sa/module-master");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "project-map",
          label: "Company Project Map",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[1] = element;
          },
          onClick: () => {
            openScreen("SA_COMPANY_PROJECT_MAP", { mode: "replace" });
            navigate("/sa/projects/map");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "refresh",
          label: loadingModules ? "Refreshing..." : "Refresh",
          tone: "primary",
          buttonRef: (element) => {
            actionRefs.current[2] = element;
          },
          onClick: () => void loadModules(selectedCompanyId, selectedModuleCode),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 2,
              refs: actionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      footerHints={["↑↓ Navigate", "Space Select", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="grid gap-3">
          <ErpSelectionSection label="Choose Business Company" />
          <QuickFilterInput
            label="Find company"
            value={companySearch}
            onChange={setCompanySearch}
            inputRef={companySearchRef}
            placeholder="Filter by company code, company name, or group"
          />

          {loadingCompanies ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading business companies.
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No company matches the current filter.
            </div>
          ) : (
            <ErpDenseGrid
              columns={[
                {
                  key: "company",
                  label: "Company",
                  render: (row) => (
                    <div>
                      <div className="font-semibold text-slate-900">
                        {formatCompanyLabel(row, { separator: " - " })}
                      </div>
                      <div className="text-[10px] text-slate-500">{formatCompanyAddress(row)}</div>
                    </div>
                  ),
                },
                {
                  key: "group",
                  label: "Group",
                  render: (row) =>
                    row.group_code ? `${row.group_code}${row.group_name ? ` | ${row.group_name}` : ""}` : "No group",
                },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => row.status ?? "UNKNOWN",
                },
              ]}
              rows={filteredCompanies}
              rowKey={(row) => row.id}
              getRowProps={(row, index) => ({
                ...getCompanyRowProps(index),
                onClick: () => setSelectedCompanyId(row.id),
                className: row.id === selectedCompanyId ? "bg-sky-50" : "",
              })}
              onRowActivate={(row) => setSelectedCompanyId(row.id)}
              emptyMessage="No company matches the current filter."
              maxHeight="360px"
            />
          )}
        </div>

        <div className="grid gap-6">
          <div className="grid gap-3">
            <ErpSelectionSection
              label={
                selectedCompany
                  ? `${selectedCompany.company_code} | ${selectedCompany.company_name}`
                  : "No Company Selected"
              }
            />
            {selectedCompany ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Company</div>
                  <div className="text-sm font-semibold text-slate-900">{formatCompanyLabel(selectedCompany)}</div>
                  <div className="text-[12px] text-slate-600">{formatCompanyAddress(selectedCompany)}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">State</div>
                  <div className="text-sm text-slate-900">{selectedCompany.status ?? "UNKNOWN"}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Mapped Group</div>
                  <div className="text-sm text-slate-900">{selectedCompany.group_code ?? "Not mapped"}</div>
                  <div className="text-[12px] text-slate-600">{selectedCompany.group_name ?? "Group optional for rollout."}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Coverage</div>
                  <div className="text-sm text-slate-900">{uniqueProjects.size} project lanes | {enabledModules.length} enabled modules</div>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a company to inspect project-backed module rollout.
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <ErpSelectionSection label="Project-Backed Module Rollout" />
            <QuickFilterInput
              label="Find module"
              value={moduleSearch}
              onChange={setModuleSearch}
              inputRef={moduleSearchRef}
              placeholder="Filter by module code, module name, or project"
            />

            {loadingModules ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Loading company module rows.
              </div>
            ) : !selectedCompany ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a company first.
              </div>
            ) : filteredModules.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No module is currently available. First map a project to this company, then modules from that project will appear here.
              </div>
            ) : (
              <ErpDenseGrid
                columns={[
                  {
                    key: "module",
                    label: "Module",
                    render: (row) => (
                      <div>
                        <div className="font-semibold text-slate-900">{row.module_code} - {row.module_name}</div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {row.project_code} | {row.module_active ? "MODULE ACTIVE" : "MODULE INACTIVE"} | {row.enabled ? "ENABLED" : "DISABLED"}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "approval",
                    label: "Approval",
                    render: (row) =>
                      row.approval_required
                        ? `${row.approval_type ?? "UNKNOWN"} | ${row.min_approvers}-${row.max_approvers} approver slot`
                        : "No intrinsic approval required",
                  },
                  {
                    key: "action",
                    label: "Action",
                    render: (row) => (
                      <button
                        type="button"
                        disabled={saving || row.module_active !== true}
                        className={`border px-3 py-1 text-xs font-semibold ${
                          row.enabled
                            ? "border-rose-300 bg-white text-rose-700"
                            : "border-sky-300 bg-white text-sky-700"
                        } disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggle(row);
                        }}
                      >
                        {row.enabled ? "Disable" : "Enable"}
                      </button>
                    ),
                  },
                ]}
                rows={filteredModules}
                rowKey={(row) => row.module_code}
                getRowProps={(row, index) => ({
                  ...getModuleRowProps(index),
                  onClick: () => setSelectedModuleCode(row.module_code),
                  className: row.module_code === selectedModuleCode ? "bg-sky-50" : "",
                })}
                onRowActivate={(row) => setSelectedModuleCode(row.module_code)}
                emptyMessage="No module is currently available."
                maxHeight="380px"
              />
            )}
          </div>

          <div className="grid gap-3">
            <ErpSelectionSection label={selectedModule ? `${selectedModule.module_code} | ${selectedModule.module_name}` : "No Module Selected"} />
            {selectedModule ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Project</div>
                  <div className="text-sm text-slate-900">{selectedModule.project_code} | {selectedModule.project_name}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Operational State</div>
                  <div className="text-sm text-slate-900">{selectedModule.enabled ? "Enabled" : "Disabled"}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Module Lifecycle</div>
                  <div className="text-sm text-slate-900">{selectedModule.module_active ? "ACTIVE" : "INACTIVE"}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Approval Law</div>
                  <div className="text-sm text-slate-900">
                    {selectedModule.approval_required
                      ? `${selectedModule.approval_type ?? "UNKNOWN"} | ${selectedModule.min_approvers}-${selectedModule.max_approvers} approver slot`
                      : "Company cannot override this at rollout layer."}
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a module row to inspect rollout details.
              </div>
            )}
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
