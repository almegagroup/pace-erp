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
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";

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

export default function SACompanyManage() {
  const navigate = useNavigate();
  const actionRefs = useRef([]);
  const rowRefs = useRef([]);
  const searchRef = useRef(null);
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingCompanyId, setSavingCompanyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  const metrics = useMemo(() => {
    const activeCount = companies.filter((row) => row.status === "ACTIVE").length;
    const inactiveCount = companies.filter((row) => row.status === "INACTIVE").length;

    return {
      total: companies.length,
      active: activeCount,
      inactive: inactiveCount,
      mapped: companies.filter((row) => row.group_id).length,
    };
  }, [companies]);

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
      key: "refresh",
      label: loading ? "Refreshing..." : "Refresh",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionRefs.current[0] = element;
      },
      onClick: () => void loadCompanies(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create",
      label: "Create Company",
      tone: "neutral",
      buttonRef: (element) => {
        actionRefs.current[1] = element;
      },
      onClick: () => openRoute("/sa/company/create"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "groups",
      label: "Group Governance",
      tone: "neutral",
      buttonRef: (element) => {
        actionRefs.current[2] = element;
      },
      onClick: () => openRoute("/sa/groups"),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  return (
    <ErpScreenScaffold
      eyebrow="Company Governance"
      title="Manage Business Companies"
      description="Review business companies, search the current registry, and enable or disable a company without touching database rows directly."
      topActions={topActions}
      error={error}
      notice={notice}
    >
      <section className="grid gap-3 md:grid-cols-4">
        <ErpFieldPreview
          label="Total Companies"
          value={String(metrics.total)}
          caption="Business companies visible in company master."
          tone="sky"
          badge="Live"
        />
        <ErpFieldPreview
          label="Active"
          value={String(metrics.active)}
          caption="Currently enabled companies."
          tone="emerald"
          badge="Ready"
        />
        <ErpFieldPreview
          label="Inactive"
          value={String(metrics.inactive)}
          caption="Companies currently disabled."
          tone="amber"
          badge="Paused"
        />
        <ErpFieldPreview
          label="Mapped To Group"
          value={String(metrics.mapped)}
          caption="Companies already linked to a group."
          tone="sky"
          badge="Map"
        />
      </section>

      <ErpSectionCard
        eyebrow="Registry Filter"
        title="Search Company Inventory"
        description="Filter by company code, company name, GST, group, or lifecycle state."
      >
        <label className="grid gap-2 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Search</span>
          <input
            ref={searchRef}
            data-workspace-primary-focus="true"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company code, name, GST, group, status"
            className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </label>
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="Lifecycle"
        title="Company Manage Workspace"
        description="Enable or disable a company from the current registry. No hard delete path is exposed here."
      >
        {loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading company inventory...
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No company matched the current search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr>
                  {["Company", "GST", "Group", "Status", "Action"].map((label) => (
                    <th
                      key={label}
                      className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((row, index) => {
                  const isSaving = savingCompanyId === row.id;
                  const isActive = normalize(row.status).toUpperCase() === "ACTIVE";

                  return (
                    <tr
                      key={row.id}
                      ref={(element) => {
                        rowRefs.current[index] = element;
                      }}
                      tabIndex={0}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: rowRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className="border-b border-slate-200 bg-white"
                    >
                      <td className="px-3 py-2 text-sm text-slate-700">
                        <div className="font-semibold text-slate-900">{row.company_code}</div>
                        <div className="text-xs text-slate-500">{row.company_name}</div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {row.gst_number || "Not linked"}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {row.group_code
                          ? `${row.group_code}${row.group_name ? ` | ${row.group_name}` : ""}`
                          : "Not mapped"}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        <span
                          className={`inline-flex min-w-[84px] justify-center border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isActive
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-amber-300 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {row.status || "Unknown"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            void handleStateChange(row, isActive ? "INACTIVE" : "ACTIVE")
                          }
                          className={`border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                            isActive
                              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {isSaving
                            ? "Saving..."
                            : isActive
                              ? "Disable"
                              : "Enable"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
