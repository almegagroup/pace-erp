import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { downloadCsvFile } from "../../../shared/downloadTabularFile.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpRegisterHeader from "../../../components/data/ErpRegisterHeader.jsx";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

const REPORT_COLUMNS = Object.freeze([
  { key: "user_code", label: "User Code" },
  { key: "user_name", label: "Name" },
  { key: "auth_user_id", label: "Auth User ID" },
  { key: "user_state", label: "State" },
  { key: "role_code", label: "Role Code" },
  { key: "role_rank", label: "Role Rank" },
  { key: "designation_hint", label: "Designation" },
  { key: "phone_number", label: "Phone Number" },
  { key: "parent_company_code", label: "Parent Company Code" },
  { key: "parent_company_name", label: "Parent Company Name" },
  { key: "parent_company_address", label: "Parent Company Address" },
  { key: "identity_department_code", label: "Identity Department Code" },
  { key: "identity_department_name", label: "Identity Department Name" },
  { key: "work_company_codes", label: "Work Company Codes" },
  { key: "work_company_names", label: "Work Company Names" },
  { key: "work_company_addresses", label: "Work Company Addresses" },
  { key: "direct_project_override_codes", label: "Direct Project Override Codes" },
  { key: "direct_project_override_names", label: "Direct Project Override Names" },
  { key: "inherited_project_codes", label: "Inherited Project Codes" },
  { key: "inherited_project_names", label: "Inherited Project Names" },
  { key: "effective_project_codes", label: "Effective Project Codes" },
  { key: "effective_project_names", label: "Effective Project Names" },
  { key: "work_area_codes", label: "Work Area Codes" },
  { key: "work_area_names", label: "Work Area Names" },
  { key: "work_area_department_codes", label: "Work Area Department Codes" },
  { key: "work_area_department_names", label: "Work Area Department Names" },
  { key: "primary_work_area_code", label: "Primary Work Area Code" },
  { key: "primary_work_area_name", label: "Primary Work Area Name" },
  { key: "primary_work_area_department_code", label: "Primary Work Area Department Code" },
  { key: "primary_work_area_department_name", label: "Primary Work Area Department Name" },
  { key: "created_at", label: "Created At" },
]);

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

async function fetchReport(companyId = "") {
  const query = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/users/report${query}`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.rows)) {
    throw new Error(json?.code ?? "USER_SCOPE_REPORT_FAILED");
  }
  return json.data.rows;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompanyAddress(company) {
  if (!company) return "All companies in scope";
  return (
    [company.full_address, company.state_name, company.pin_code]
      .filter(Boolean)
      .join(", ") || "Address not captured"
  );
}

export default function SAUserScopeReport() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => REPORT_COLUMNS.map((column) => column.key));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const actionRefs = useRef([]);
  const searchRef = useRef(null);

  const loadAll = useCallback(async (nextCompanyId = companyId) => {
    setLoading(true);
    setError("");
    try {
      const [companyRows, reportRows] = await Promise.all([
        fetchCompanies(),
        fetchReport(nextCompanyId),
      ]);
      setCompanies(companyRows);
      setRows(reportRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "USER_SCOPE_REPORT_FAILED");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadAll("");
  }, [loadAll]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [
        row.user_code,
        row.user_name,
        row.role_code,
        row.parent_company_code,
        row.parent_company_name,
        row.identity_department_code,
        row.identity_department_name,
        row.work_company_codes,
        row.work_company_names,
        row.direct_project_override_codes,
        row.direct_project_override_names,
        row.inherited_project_codes,
        row.inherited_project_names,
        row.effective_project_codes,
        row.effective_project_names,
        row.work_area_codes,
        row.work_area_names,
        row.primary_work_area_code,
        row.primary_work_area_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [rows, searchQuery]);

  const visibleColumns = useMemo(
    () => REPORT_COLUMNS.filter((column) => visibleColumnKeys.includes(column.key)),
    [visibleColumnKeys],
  );
  const denseColumns = useMemo(
    () =>
      visibleColumns.map((column) => ({
        key: column.key,
        label: column.label,
        render: (row) =>
          column.key === "created_at"
            ? formatDateTime(row[column.key])
            : row[column.key] || "-",
      })),
    [visibleColumns]
  );
  const { getRowProps } = useErpListNavigation(filteredRows);

  const selectedCompanyLabel = companies.find((row) => row.id === companyId)
    ? `${companies.find((row) => row.id === companyId).company_code} | ${companies.find((row) => row.id === companyId).company_name}`
    : "All companies";

  useErpScreenCommands([
    {
      id: "sa-user-scope-report-refresh",
      group: "Current Screen",
      label: "Refresh user scope report",
      keywords: ["user", "scope", "report", "refresh"],
      onSelect: () => void loadAll(),
    },
    {
      id: "sa-user-scope-report-export",
      group: "Current Screen",
      label: "Download user scope report",
      keywords: ["user", "scope", "report", "export", "excel"],
      onSelect: () =>
        downloadCsvFile({
          fileName: "sa-user-scope-report.csv",
          columns: visibleColumns,
          rows: filteredRows,
        }),
    },
  ]);

  useErpScreenHotkeys({
    save: {
      label: "Download user scope report",
      handler: () =>
        downloadCsvFile({
          fileName: "sa-user-scope-report.csv",
          columns: visibleColumns,
          rows: filteredRows,
        }),
    },
    refresh: {
      label: "Refresh user scope report",
      handler: () => void loadAll(),
    },
    focusSearch: {
      label: "Focus report search",
      handler: () => searchRef.current?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      title="SA User Scope Report"
      footerHints={["ALT+R REFRESH", "CTRL+S DOWNLOAD", "ALT+SHIFT+F SEARCH", "CTRL+K COMMAND BAR"]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => void loadAll(),
          onKeyDown: (event) =>
            handleLinearNavigation(event, { index: 0, refs: actionRefs.current }),
        },
        {
          key: "export",
          label: "Download Excel CSV",
          tone: "primary",
          buttonRef: (element) => {
            actionRefs.current[1] = element;
          },
          onClick: () =>
            downloadCsvFile({
              fileName: "sa-user-scope-report.csv",
              columns: visibleColumns,
              rows: filteredRows,
            }),
          onKeyDown: (event) =>
            handleLinearNavigation(event, { index: 1, refs: actionRefs.current }),
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Selected Company", selectedCompanyLabel],
            ["Selected Company Address", formatCompanyAddress(companies.find((row) => row.id === companyId) ?? null)],
            ["Report Rows", String(filteredRows.length)],
            ["Visible Columns", String(visibleColumns.length)],
          ].map(([label, value]) => (
            <div key={label} className="border border-slate-300 bg-white px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3">
          <ErpSelectionSection label="Report Filters" />
          <div className="grid gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Company
              </span>
              <select
                value={companyId}
                onChange={(event) => {
                  const nextCompanyId = event.target.value;
                  setCompanyId(nextCompanyId);
                  void loadAll(nextCompanyId);
                }}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                <option value="">All companies</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_code} | {company.company_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="border border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">
              Inline search now lives in the register header so the report stays in one working surface.
            </div>
          </div>
          {error ? (
            <div className="mt-3 border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <ErpSelectionSection label="Visible Columns" />
          <div className="grid gap-2 md:grid-cols-3">
            {REPORT_COLUMNS.map((column) => {
              const checked = visibleColumnKeys.includes(column.key);
              return (
                <label key={column.key} className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setVisibleColumnKeys((current) =>
                          REPORT_COLUMNS.map((item) => item.key).filter((key) => key === column.key || current.includes(key)),
                        );
                        return;
                      }
                      setVisibleColumnKeys((current) => current.filter((key) => key !== column.key));
                    }}
                  />
                  <span>{column.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3">
          <ErpRegisterHeader
            title={loading ? "Loading user scope report" : "User scope register"}
            count={filteredRows.length}
            filterValue={searchQuery}
            onFilterChange={setSearchQuery}
            filterRef={searchRef}
            filterPlaceholder="Search user, role, company, department, inherited project, override project, or work area"
          />
          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading report.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No report row matches the current filter.
            </div>
          ) : (
            <ErpDenseGrid
              columns={denseColumns}
              rows={filteredRows}
              rowKey={(row, index) => `${row.auth_user_id}-${index}`}
              getRowProps={(_row, index) => getRowProps(index)}
              summaryRow={{
                label: "Summary",
                values: {
                  user_name: `${filteredRows.length} user rows`,
                  work_area_codes: `${visibleColumns.length} visible columns`,
                },
              }}
            />
          )}
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
