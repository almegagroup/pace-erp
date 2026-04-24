/*
 * File-ID: 9.2E-FRONT
 * File-Path: frontend/src/admin/sa/screens/SACompanyManage.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin company management surface with lifecycle control
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openRoute, openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpColumnVisibilityDrawer from "../../../components/ErpColumnVisibilityDrawer.jsx";
import { useErpVisibleColumns } from "../../../hooks/useErpVisibleColumns.js";

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

async function updateCompanyState(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/company/state`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "COMPANY_STATE_UPDATE_FAILED");
  }

  return json.data;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function companySearchValue(row) {
  return [
    row.company_code,
    row.company_name,
    row.gst_number,
    row.group_code,
    row.group_name,
    row.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const COMPANY_COLUMN_DEFS = Object.freeze([
  { key: "company", label: "Company" },
  { key: "gst", label: "GST" },
  { key: "group", label: "Group" },
  { key: "status", label: "Status" },
]);

const DEFAULT_VISIBLE_COMPANY_COLUMNS = Object.freeze([
  "company",
  "gst",
  "group",
  "status",
]);

export default function SACompanyManage() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const searchRef = useRef(null);
  const rowActionRefs = useRef([]);
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingCompanyId, setSavingCompanyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showColumnDrawer, setShowColumnDrawer] = useState(false);
  const { visibleColumns, visibleColumnKeys, toggleColumn, resetColumns } =
    useErpVisibleColumns({
      storageKey: "erp.sa.companyManage.columns",
      columnDefs: COMPANY_COLUMN_DEFS,
      defaultColumnKeys: DEFAULT_VISIBLE_COMPANY_COLUMNS,
    });

  async function loadCompanies() {
    setLoading(true);
    setError("");

    try {
      const rows = await fetchCompanies();
      setCompanies(rows);
    } catch {
      setError("Company inventory could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
  }, []);

  const filteredCompanies = useMemo(() => {
    const needle = normalize(search).toLowerCase();

    if (!needle) {
      return companies;
    }

    return companies.filter((row) => companySearchValue(row).includes(needle));
  }, [companies, search]);

  const { getRowProps } = useErpListNavigation(filteredCompanies, {
    onActivate: (_row, index) => {
      rowActionRefs.current[index]?.focus();
    },
  });

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadCompanies(),
    },
    focusSearch: {
      perform: () => searchRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => searchRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-company-manage-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing company inventory..." : "Refresh company inventory",
      keywords: ["refresh", "company", "manage"],
      disabled: loading,
      perform: () => void loadCompanies(),
      order: 10,
    },
    {
      id: "sa-company-manage-focus-search",
      group: "Current Screen",
      label: "Focus company search",
      keywords: ["search", "company"],
      perform: () => searchRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-company-manage-create",
      group: "Current Screen",
      label: "Open company create",
      keywords: ["company create", "new company"],
      perform: () => {
        openScreen("SA_COMPANY_CREATE", { mode: "replace" });
        navigate("/sa/company/create");
      },
      order: 30,
    },
    {
      id: "sa-company-manage-groups",
      group: "Current Screen",
      label: "Open group governance",
      keywords: ["group governance", "company mapping", "groups"],
      perform: () => {
        openScreen("SA_GROUP_GOVERNANCE", { mode: "replace" });
        navigate("/sa/groups");
      },
      order: 40,
    },
    {
      id: "sa-company-manage-columns",
      group: "Current Screen",
      label: "Choose visible columns",
      keywords: ["columns", "show hide", "table"],
      perform: () => setShowColumnDrawer(true),
      order: 50,
    },
  ]);

  async function handleStateChange(company, nextStatus) {
    const currentStatus = normalize(company?.status).toUpperCase();

    if (!company?.id || !nextStatus || currentStatus === nextStatus) {
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "Company Lifecycle",
      title: `${nextStatus === "ACTIVE" ? "Enable" : "Disable"} Company`,
      message: `${nextStatus === "ACTIVE" ? "Enable" : "Disable"} ${company.company_code} ${company.company_name}?`,
      confirmLabel: nextStatus === "ACTIVE" ? "Enable" : "Disable",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSavingCompanyId(company.id);
    setError("");
    setNotice("");

    try {
      await updateCompanyState({
        company_id: company.id,
        next_status: nextStatus,
      });

      setNotice(
        `${company.company_code} is now ${nextStatus === "ACTIVE" ? "enabled" : "disabled"}.`
      );
      await loadCompanies();
    } catch {
      setError("Company lifecycle change could not be saved.");
    } finally {
      setSavingCompanyId("");
    }
  }

  const topActions = [
    {
      key: "columns",
      label: "Columns",
      tone: "neutral",
      buttonRef: (element) => {
        actionRefs.current[0] = element;
      },
      onClick: () => setShowColumnDrawer(true),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh",
      label: loading ? "Refreshing..." : "Refresh",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionRefs.current[1] = element;
      },
      onClick: () => void loadCompanies(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create",
      label: "Create Company",
      tone: "neutral",
      buttonRef: (element) => {
        actionRefs.current[2] = element;
      },
      onClick: () => openRoute("/sa/company/create"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "groups",
      label: "Group Governance",
      tone: "neutral",
      buttonRef: (element) => {
        actionRefs.current[3] = element;
      },
      onClick: () => openRoute("/sa/groups"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 3,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  return (
    <>
      <ErpMasterListTemplate
        eyebrow="Company Governance"
        title="Manage Business Companies"
        actions={topActions}
        notices={[
          ...(error ? [{ key: "error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
        ]}
        footerHints={["↑↓ Navigate", "Enter Inspect", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
        filterSection={{
          eyebrow: "Registry Filter",
          title: "Search company inventory",
          aside: (
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {visibleColumnKeys.length}/{COMPANY_COLUMN_DEFS.length} visible columns
            </div>
          ),
          children: (
            <QuickFilterInput
              inputRef={searchRef}
              primaryFocus
              label="Quick Search"
              value={search}
              onChange={setSearch}
              placeholder="Search company code, name, GST, group, status"
              hint="Alt+Shift+F jumps here. Use Columns to hide noise and keep only the fields needed."
            />
          ),
        }}
        listSection={{
          eyebrow: "Lifecycle",
          title: loading
            ? "Refreshing company register"
            : `${filteredCompanies.length} visible compan${filteredCompanies.length === 1 ? "y" : "ies"}`,
          children: loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Loading company inventory...
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No company matched the current search.
            </div>
          ) : (
            <ErpDenseGrid
              columns={[
                ...visibleColumns.map((column) => ({
                  key: column.key,
                  label: column.label,
                  render: (row) => {
                    const isActive = normalize(row.status).toUpperCase() === "ACTIVE";
                    if (column.key === "company") {
                      return (
                        <div>
                          <p className="font-medium leading-tight">{row.company_code}</p>
                          <p className="text-[10px] text-slate-500">{row.company_name}</p>
                        </div>
                      );
                    }
                    if (column.key === "gst") return row.gst_number || "Not linked";
                    if (column.key === "group") {
                      return row.group_code
                        ? `${row.group_code}${row.group_name ? ` | ${row.group_name}` : ""}`
                        : "Not mapped";
                    }
                    if (column.key === "status") {
                      return (
                        <span className={`inline-flex border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.12em] ${isActive ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                          {row.status || "Unknown"}
                        </span>
                      );
                    }
                    return null;
                  },
                })),
                {
                  key: "action",
                  label: "Action",
                  render: (row, index) => {
                    const isSaving = savingCompanyId === row.id;
                    const isActive = normalize(row.status).toUpperCase() === "ACTIVE";
                    return (
                      <button
                        ref={(element) => {
                          rowActionRefs.current[index] = element;
                        }}
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleStateChange(row, isActive ? "INACTIVE" : "ACTIVE")}
                        onKeyDown={(event) =>
                          handleLinearNavigation(event, {
                            index,
                            refs: rowActionRefs.current,
                            orientation: "vertical",
                          })
                        }
                        className={`border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] ${isActive ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"} disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {isSaving ? "Saving..." : isActive ? "Disable" : "Enable"}
                      </button>
                    );
                  },
                },
              ]}
              rows={filteredCompanies}
              rowKey={(row) => row.id}
              getRowProps={(_row, index) => getRowProps(index)}
              emptyMessage="No company matched the current search."
            />
          ),
        }}
      />

      <ErpColumnVisibilityDrawer
        visible={showColumnDrawer}
        title="Company Register Columns"
        columns={COMPANY_COLUMN_DEFS}
        visibleColumnKeys={visibleColumnKeys}
        onToggleColumn={toggleColumn}
        onResetColumns={resetColumns}
        onClose={() => setShowColumnDrawer(false)}
      />
    </>
  );
}


