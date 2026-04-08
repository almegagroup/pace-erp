import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";

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
  const companyRefs = useRef([]);
  const moduleRefs = useRef([]);
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

  async function loadCompanies(preferredCompanyId = selectedCompanyId) {
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
    } catch {
      setCompanies([]);
      setSelectedCompanyId("");
      setModulePayload(null);
      setSelectedModuleCode("");
      setError("Company module workspace could not load company rows right now.");
    } finally {
      setLoadingCompanies(false);
    }
  }

  async function loadModules(companyId = selectedCompanyId, preferredModuleCode = selectedModuleCode) {
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
    } catch {
      setModulePayload(null);
      setSelectedModuleCode("");
      setError("Company module rows could not be loaded right now.");
    } finally {
      setLoadingModules(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
  }, []);

  useEffect(() => {
    void loadModules(selectedCompanyId);
  }, [selectedCompanyId]);

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

  const modules = modulePayload?.modules ?? [];

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
    const approved = await openActionConfirm({
      eyebrow: "Company Module Map",
      title: `${row.enabled ? "Disable" : "Enable"} Module`,
      message: `${row.enabled ? "Disable" : "Enable"} ${row.module_code} for ${selectedCompany.company_code}?`,
      confirmLabel: row.enabled ? "Disable" : "Enable",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson(
        nextAction === "enable"
          ? "/api/admin/acl/company-module/enable"
          : "/api/admin/acl/company-module/disable",
        {
          company_id: selectedCompany.id,
          module_code: row.module_code,
        },
      );

      await loadModules(selectedCompany.id, row.module_code);
      setNotice(
        `Module ${row.module_code} ${nextAction === "enable" ? "enabled for" : "disabled for"} ${selectedCompany.company_code}.`,
      );
    } catch {
      setError("Company module mapping could not be saved right now.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Company Module Rollout"
      title="Company Module Map"
      description="Modules stay under projects. A company only sees modules from projects already mapped to it, and SA decides module rollout one company at a time."
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
          hint: "Alt+R",
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
      metrics={[
        {
          key: "companies",
          label: "Companies",
          value: loadingCompanies ? "..." : String(companies.length),
          tone: "sky",
          caption: "Business companies available for module rollout governance.",
        },
        {
          key: "projects",
          label: "Mapped Projects",
          value: loadingModules ? "..." : String(uniqueProjects.size),
          tone: "emerald",
          caption: selectedCompany
            ? "Projects already attached to the selected company."
            : "Choose a company to inspect project-backed module availability.",
        },
        {
          key: "modules",
          label: "Available Modules",
          value: loadingModules ? "..." : String(modules.length),
          tone: "amber",
          caption: "Modules eligible for the selected company because their project is already mapped.",
        },
        {
          key: "enabled",
          label: "Enabled",
          value: loadingModules ? "..." : String(enabledModules.length),
          tone: "slate",
          caption: "Modules currently operational for the selected company.",
        },
      ]}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ErpSectionCard
          eyebrow="Companies"
          title="Choose business company"
          description="Select one company first. This screen only shows modules from projects already mapped into that company."
        >
          <div className="grid gap-4">
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
              <div className="space-y-0 border border-slate-300">
                {filteredCompanies.map((row, index) => (
                  <button
                    key={row.id}
                    ref={(element) => {
                      companyRefs.current[index] = element;
                    }}
                    type="button"
                    onClick={() => setSelectedCompanyId(row.id)}
                    onKeyDown={(event) =>
                      handleLinearNavigation(event, {
                        index,
                        refs: companyRefs.current,
                        orientation: "vertical",
                      })
                    }
                    className={`w-full border-b border-slate-300 px-4 py-3 text-left text-sm transition last:border-b-0 ${
                      row.id === selectedCompanyId
                        ? "bg-sky-50 text-slate-900"
                        : "bg-white text-slate-700"
                    }`}
                  >
                    <span className="block font-semibold">
                      {row.company_code} - {row.company_name}
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                      {row.status ?? "UNKNOWN"} | {row.group_code ?? "No group"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ErpSectionCard>

        <div className="grid gap-6">
          <ErpSectionCard
            eyebrow="Selected Company"
            title={
              selectedCompany
                ? `${selectedCompany.company_code} | ${selectedCompany.company_name}`
                : "No company selected"
            }
            description="Project mapping is the gate. If a project is removed from a company, its modules disappear from this rollout screen automatically."
          >
            {selectedCompany ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ErpFieldPreview
                  label="Company State"
                  value={selectedCompany.status ?? "UNKNOWN"}
                  caption="Business company lifecycle."
                />
                <ErpFieldPreview
                  label="Mapped Group"
                  value={selectedCompany.group_code ?? "Not mapped"}
                  caption={selectedCompany.group_name ?? "Group optional for module rollout."}
                />
                <ErpFieldPreview
                  label="Available Projects"
                  value={String(uniqueProjects.size)}
                  caption="Project-backed module universes currently visible here."
                />
                <ErpFieldPreview
                  label="Enabled Modules"
                  value={String(enabledModules.length)}
                  caption="Operational modules currently switched on for this company."
                />
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a company to inspect project-backed module rollout.
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Modules"
            title="Project-backed module rollout"
            description="Modules shown here already belong to a mapped project. SA now decides whether each module becomes operational for the selected company."
          >
            <div className="grid gap-4">
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
                <div className="space-y-0 border border-slate-300">
                  {filteredModules.map((row, index) => (
                    <div
                      key={row.module_code}
                      ref={(element) => {
                        moduleRefs.current[index] = element;
                      }}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: moduleRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className={`border-b border-slate-300 px-4 py-3 last:border-b-0 ${
                        row.module_code === selectedModuleCode ? "bg-sky-50" : "bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedModuleCode(row.module_code)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block font-semibold text-slate-900">
                            {row.module_code} - {row.module_name}
                          </span>
                          <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-slate-500">
                            {row.project_code} | {row.module_active ? "MODULE ACTIVE" : "MODULE INACTIVE"} | {row.enabled ? "ENABLED" : "DISABLED"}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {row.approval_required
                              ? `${row.approval_type ?? "UNKNOWN"} | ${row.min_approvers}-${row.max_approvers} approver slot`
                              : "No intrinsic approval required"}
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={saving || row.module_active !== true}
                          className={`border px-3 py-2 text-sm font-semibold ${
                            row.enabled
                              ? "border-rose-300 bg-white text-rose-700"
                              : "border-sky-300 bg-white text-sky-700"
                          } disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400`}
                          onClick={() => void handleToggle(row)}
                        >
                          {row.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Selected Module"
            title={selectedModule ? `${selectedModule.module_code} | ${selectedModule.module_name}` : "No module selected"}
            description="This panel explains the rollout law for the currently selected module."
          >
            {selectedModule ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ErpFieldPreview
                  label="Project"
                  value={`${selectedModule.project_code} | ${selectedModule.project_name}`}
                  caption="Module inherits this project universe."
                />
                <ErpFieldPreview
                  label="Operational State"
                  value={selectedModule.enabled ? "Enabled" : "Disabled"}
                  caption="Company-specific rollout flag."
                />
                <ErpFieldPreview
                  label="Module Lifecycle"
                  value={selectedModule.module_active ? "ACTIVE" : "INACTIVE"}
                  caption="Global module state from Module Master."
                />
                <ErpFieldPreview
                  label="Approval Law"
                  value={selectedModule.approval_required ? "Required" : "Not required"}
                  caption={
                    selectedModule.approval_required
                      ? `${selectedModule.approval_type ?? "UNKNOWN"} | ${selectedModule.min_approvers}-${selectedModule.max_approvers} approver slot`
                      : "Company cannot override this at rollout layer."
                  }
                />
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Select a module row to inspect rollout details.
              </div>
            )}
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
