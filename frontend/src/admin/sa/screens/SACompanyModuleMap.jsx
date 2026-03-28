import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpApprovalReviewTemplate from "../../../components/templates/ErpApprovalReviewTemplate.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchCompanyModules(companyId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/company-modules?company_id=${encodeURIComponent(companyId)}`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.modules)) {
    throw new Error(json?.code ?? "COMPANY_MODULE_LIST_FAILED");
  }

  return json.data.modules;
}

async function toggleCompanyModule(endpoint, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${endpoint}`, {
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

export default function SACompanyModuleMap() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const companyIdRef = useRef(null);
  const rowActionRefs = useRef([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [moduleCode, setModuleCode] = useState("");
  const [moduleRows, setModuleRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadModules(companyId = selectedCompanyId) {
    const normalizedCompanyId = companyId.trim();

    if (!normalizedCompanyId) {
      setError("Enter a company ID before loading module governance.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await fetchCompanyModules(normalizedCompanyId);
      setSelectedCompanyId(normalizedCompanyId);
      setModuleRows(data);
    } catch {
      setModuleRows([]);
      setError("Unable to load company module governance rows.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable() {
    const normalizedCompanyId = selectedCompanyId.trim();
    const normalizedModuleCode = moduleCode.trim().toUpperCase();

    if (!normalizedCompanyId || !normalizedModuleCode) {
      setError("Company ID and module code are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await toggleCompanyModule("/api/admin/acl/company-module/enable", {
        company_id: normalizedCompanyId,
        module_code: normalizedModuleCode,
      });
      await loadModules(normalizedCompanyId);
      setModuleCode("");
      setNotice(`Module ${normalizedModuleCode} enabled for the selected company.`);
    } catch {
      setError("Company module could not be enabled.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable(row) {
    const approved = await openActionConfirm({
      eyebrow: "ACL Company Modules",
      title: "Disable Company Module",
      message: `Disable ${row.module_code} for company ${selectedCompanyId}?`,
      confirmLabel: "Disable Module",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await toggleCompanyModule("/api/admin/acl/company-module/disable", {
        company_id: selectedCompanyId,
        module_code: row.module_code,
      });
      await loadModules(selectedCompanyId);
      setNotice(`Module ${row.module_code} disabled for the selected company.`);
    } catch {
      setError("Company module could not be disabled.");
    } finally {
      setSaving(false);
    }
  }

  const filteredRows = useMemo(
    () =>
      applyQuickFilter(moduleRows, searchQuery, [
        "module_code",
        "enabled",
        "created_at",
      ]),
    [moduleRows, searchQuery]
  );

  useErpDenseFormNavigation(formContainerRef, {
    disabled: saving,
    submitOnFinalField: true,
    onSubmit: () => handleEnable(),
  });

  useErpScreenHotkeys({
    save: {
      disabled: saving,
      perform: () => void handleEnable(),
    },
    refresh: {
      disabled: loading,
      perform: () => void loadModules(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => companyIdRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-company-modules-control-panel",
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
      id: "sa-company-modules-load",
      group: "Current Screen",
      label: loading ? "Loading company modules..." : "Load company modules",
      keywords: ["load", "company modules", "acl"],
      disabled: loading,
      perform: () => void loadModules(),
      order: 20,
    },
    {
      id: "sa-company-modules-save",
      group: "Current Screen",
      label: saving ? "Enabling module..." : "Enable module",
      hint: "Ctrl+S",
      keywords: ["enable", "module", "company"],
      disabled: saving,
      perform: () => void handleEnable(),
      order: 30,
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
      key: "load",
      label: loading ? "Loading..." : "Load Modules",
      hint: "Alt+R",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => void loadModules(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "enable",
      label: saving ? "Applying..." : "Enable Module",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: saving,
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void handleEnable(),
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
      eyebrow="ACL Company Modules"
      title="Company Module Map"
      description="Load a governed company by ID, then enable or disable module exposure from a keyboard-native ACL surface."
      actions={topActions}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      metrics={[
        {
          key: "company",
          label: "Company",
          value: selectedCompanyId || "Unset",
          tone: "sky",
          caption: "The currently loaded company governance target.",
        },
        {
          key: "modules",
          label: "Rows",
          value: loading ? "..." : String(moduleRows.length),
          tone: "emerald",
          caption: "Module rows returned by the ACL company-module endpoint.",
        },
        {
          key: "enabled",
          label: "Enabled",
          value: loading ? "..." : String(moduleRows.filter((row) => row.enabled).length),
          tone: "amber",
          caption: "Modules currently enabled for the selected company.",
        },
        {
          key: "visible",
          label: "Visible",
          value: loading ? "..." : String(filteredRows.length),
          tone: "slate",
          caption: "Module rows matching the current filter.",
        },
      ]}
      summarySection={{
        eyebrow: "Governance Note",
        title: "Company module truth is backend-owned",
        description:
          "This screen works against the sealed enable, disable, and list handlers. Until company master list UI lands, the company target is entered directly by company ID.",
      }}
      filterSection={{
        eyebrow: "Filter",
        title: "Find module rows",
        children: (
          <QuickFilterInput
            label="Module Search"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchInputRef}
            placeholder="Filter by module code or state"
            hint="Alt+Shift+F focuses this filter."
          />
        ),
      }}
      reviewSection={{
        eyebrow: "Current Module Rows",
        title: loading
          ? "Loading module rows"
          : `${filteredRows.length} visible module row${filteredRows.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
            Loading company module rows.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
            No module row matches the current state.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRows.map((row, index) => (
              <div
                key={`${row.module_code}-${index}`}
                className="rounded-[22px] border border-white/8 bg-black/10 px-4 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {row.module_code}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {row.enabled ? "ENABLED" : "DISABLED"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][0] = element;
                      }}
                      type="button"
                      onClick={() => setModuleCode(row.module_code)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 0,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className="rounded-2xl border border-cyan-400/25 bg-cyan-400/12 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-50"
                    >
                      Reuse Code
                    </button>
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] ??= [];
                        rowActionRefs.current[index][1] = element;
                      }}
                      type="button"
                      disabled={!row.enabled}
                      onClick={() => void handleDisable(row)}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index: 1,
                          refs: rowActionRefs.current[index] ?? [],
                          orientation: "horizontal",
                        })
                      }
                      className={`rounded-2xl border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        row.enabled
                          ? "border-rose-400/25 bg-rose-400/12 text-rose-50"
                          : "border-white/8 bg-white/[0.04] text-slate-500"
                      }`}
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
        eyebrow: "Module Editor",
        title: "Load company and enable module",
        description: "Load a company once, then reuse the same context to toggle module codes.",
        children: (
          <div ref={formContainerRef} className="space-y-4">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Company ID
              </span>
              <input
                ref={companyIdRef}
                data-workspace-primary-focus="true"
                data-erp-form-field="true"
                type="text"
                value={selectedCompanyId}
                onChange={(event) => setSelectedCompanyId(event.target.value)}
                placeholder="Company UUID"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:bg-black/30"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Module Code
              </span>
              <input
                data-erp-form-field="true"
                type="text"
                value={moduleCode}
                onChange={(event) => setModuleCode(event.target.value)}
                placeholder="MODULE_CODE"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:bg-black/30"
              />
            </label>

            <div className="rounded-[22px] border border-white/8 bg-black/10 px-4 py-4 text-sm text-slate-300">
              Load uses the current company ID. Save enables the typed module for that same company.
            </div>
          </div>
        ),
      }}
    />
  );
}
