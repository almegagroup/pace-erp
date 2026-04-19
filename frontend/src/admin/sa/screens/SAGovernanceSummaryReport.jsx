import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpStickyDataTable from "../../../components/data/ErpStickyDataTable.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { downloadCsvFile } from "../../../shared/downloadTabularFile.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";

const REPORT_COLUMNS = Object.freeze([
  { key: "company_code", label: "Company Code" },
  { key: "company_name", label: "Company Name" },
  { key: "company_address", label: "Company Address" },
  { key: "company_status", label: "Company Status" },
  { key: "department_codes", label: "Department Codes" },
  { key: "department_names", label: "Department Names" },
  { key: "work_context_codes", label: "Work Context Codes" },
  { key: "work_context_names", label: "Work Context Names" },
  { key: "manual_work_context_codes", label: "Manual Work Context Codes" },
  { key: "capability_bindings", label: "Capability Bindings" },
  { key: "company_project_codes", label: "Company Project Codes" },
  { key: "company_project_names", label: "Company Project Names" },
  { key: "inherited_project_bindings", label: "Inherited Project Bindings" },
  { key: "enabled_module_codes", label: "Enabled Module Codes" },
  { key: "enabled_module_names", label: "Enabled Module Names" },
  { key: "enabled_module_project_codes", label: "Enabled Module Project Codes" },
  { key: "active_acl_version_number", label: "Active ACL Version Number" },
  { key: "active_acl_version_description", label: "Active ACL Version Description" },
  { key: "active_acl_version_created_at", label: "Active ACL Version Created At" },
  { key: "all_acl_versions", label: "All ACL Versions" },
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
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/acl/governance-summary-report${query}`,
    { credentials: "include" }
  );
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.rows)) {
    throw new Error(json?.code ?? "GOVERNANCE_SUMMARY_REPORT_FAILED");
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

export default function SAGovernanceSummaryReport() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() =>
    REPORT_COLUMNS.map((column) => column.key)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const actionRefs = useRef([]);
  const searchRef = useRef(null);

  async function loadAll(nextCompanyId = companyId) {
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
      setError(
        loadError instanceof Error
          ? loadError.message
          : "GOVERNANCE_SUMMARY_REPORT_FAILED"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll("");
  }, []);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      REPORT_COLUMNS.some((column) => {
        const value = row[column.key];
        return value && String(value).toLowerCase().includes(query);
      })
    );
  }, [rows, searchQuery]);

  const visibleColumns = useMemo(
    () => REPORT_COLUMNS.filter((column) => visibleColumnKeys.includes(column.key)),
    [visibleColumnKeys]
  );

  const selectedCompany = companies.find((row) => row.id === companyId) ?? null;
  const selectedCompanyLabel = selectedCompany
    ? `${selectedCompany.company_code} | ${selectedCompany.company_name}`
    : "All companies";

  useErpScreenCommands([
    {
      id: "sa-governance-summary-report-refresh",
      group: "Current Screen",
      label: "Refresh governance summary report",
      keywords: ["governance", "summary", "report", "refresh"],
      onSelect: () => void loadAll(),
    },
    {
      id: "sa-governance-summary-report-export",
      group: "Current Screen",
      label: "Download governance summary report",
      keywords: ["governance", "summary", "report", "export", "excel"],
      onSelect: () =>
        downloadCsvFile({
          fileName: "sa-governance-summary-report.csv",
          columns: visibleColumns,
          rows: filteredRows,
        }),
    },
  ]);

  useErpScreenHotkeys({
    save: {
      label: "Download governance summary report",
      handler: () =>
        downloadCsvFile({
          fileName: "sa-governance-summary-report.csv",
          columns: visibleColumns,
          rows: filteredRows,
        }),
    },
    refresh: {
      label: "Refresh governance summary report",
      handler: () => void loadAll(),
    },
    focusSearch: {
      label: "Focus governance report search",
      handler: () => searchRef.current?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      title="SA Governance Summary Report"
      description="One company per row, combining departments, work contexts, capability bindings, inherited projects, enabled modules, and ACL versions into one circulation-ready export."
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
              fileName: "sa-governance-summary-report.csv",
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
          <ErpFieldPreview label="Selected Company" value={selectedCompanyLabel} />
          <ErpFieldPreview label="Selected Company Address" value={formatCompanyAddress(selectedCompany)} />
          <ErpFieldPreview label="Report Rows" value={String(filteredRows.length)} />
          <ErpFieldPreview label="Visible Columns" value={String(visibleColumns.length)} />
        </div>

        <ErpSectionCard
          title="Report Filters"
          description="Filter by company before download, then search the loaded governance rows in-page."
        >
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
            <QuickFilterInput
              label="Search Loaded Rows"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search company, department, work context, capability, project, module, or ACL version"
            />
          </div>
          {error ? (
            <div className="mt-3 border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </ErpSectionCard>

        <ErpSectionCard
          title="Visible Columns"
          description="Hide columns you do not want on screen or in the downloaded Excel CSV."
        >
          <div className="grid gap-2 md:grid-cols-3">
            {REPORT_COLUMNS.map((column) => {
              const checked = visibleColumnKeys.includes(column.key);
              return (
                <label
                  key={column.key}
                  className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setVisibleColumnKeys((current) =>
                          REPORT_COLUMNS.map((item) => item.key).filter(
                            (key) => key === column.key || current.includes(key)
                          )
                        );
                        return;
                      }
                      setVisibleColumnKeys((current) =>
                        current.filter((key) => key !== column.key)
                      );
                    }}
                  />
                  <span>{column.label}</span>
                </label>
              );
            })}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          title={
            loading
              ? "Loading governance summary report"
              : `${filteredRows.length} company row${filteredRows.length === 1 ? "" : "s"}`
          }
          description="Each business company stays on one row with department, work-context, capability, module, project, and ACL version details aligned side by side."
        >
          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading report.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No report row matches the current filter.
            </div>
          ) : (
            <ErpStickyDataTable
              columns={visibleColumns}
              rows={filteredRows}
              rowKey={(row, index) => `${row.company_code}-${index}`}
              renderCell={(row, column) =>
                column.key === "active_acl_version_created_at"
                  ? formatDateTime(row[column.key])
                  : row[column.key] || "-"
              }
            />
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
