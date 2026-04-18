import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { downloadCsvFile } from "../../../shared/downloadTabularFile.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";

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
  { key: "identity_department_code", label: "Identity Department Code" },
  { key: "identity_department_name", label: "Identity Department Name" },
  { key: "assignment_type", label: "Assignment Type" },
  { key: "assignment_company_code", label: "Assignment Company Code" },
  { key: "assignment_company_name", label: "Assignment Company Name" },
  { key: "project_code", label: "Project Code" },
  { key: "project_name", label: "Project Name" },
  { key: "work_context_code", label: "Work Area Code" },
  { key: "work_context_name", label: "Work Area Name" },
  { key: "work_context_department_code", label: "Work Area Department Code" },
  { key: "work_context_department_name", label: "Work Area Department Name" },
  { key: "is_primary_work_context", label: "Primary Work Area" },
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

export default function SAUserScopeReport() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
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
      setError(loadError instanceof Error ? loadError.message : "USER_SCOPE_REPORT_FAILED");
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
      [
        row.user_code,
        row.user_name,
        row.role_code,
        row.parent_company_code,
        row.parent_company_name,
        row.identity_department_code,
        row.identity_department_name,
        row.assignment_type,
        row.assignment_company_code,
        row.assignment_company_name,
        row.project_code,
        row.project_name,
        row.work_context_code,
        row.work_context_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [rows, searchQuery]);

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
          columns: REPORT_COLUMNS,
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
          columns: REPORT_COLUMNS,
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
      description="Flat export-ready user inventory with one row per assignment so company, role, rank, identity, and work area stay in separate columns."
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
              columns: REPORT_COLUMNS,
              rows: filteredRows,
            }),
          onKeyDown: (event) =>
            handleLinearNavigation(event, { index: 1, refs: actionRefs.current }),
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ErpFieldPreview label="Selected Company" value={selectedCompanyLabel} />
          <ErpFieldPreview label="Report Rows" value={String(filteredRows.length)} />
          <ErpFieldPreview label="Download Format" value="Excel-ready CSV" />
        </div>

        <ErpSectionCard title="Report Filters" description="Filter by company before download, then search the loaded rows in-page.">
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
              placeholder="Search user, role, company, department, project, or work area"
            />
          </div>
          {error ? (
            <div className="mt-3 border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </ErpSectionCard>

        <ErpSectionCard
          title={loading ? "Loading user scope report" : `${filteredRows.length} report row${filteredRows.length === 1 ? "" : "s"}`}
          description="Each assignment stays on its own row so nothing is mixed before circulation."
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
            <div className="overflow-auto border border-slate-200">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    {REPORT_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className="border border-slate-200 px-2 py-2 text-left font-semibold uppercase tracking-[0.12em] text-slate-500"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr key={`${row.auth_user_id}-${row.assignment_type}-${row.assignment_company_code ?? row.work_context_code ?? row.project_code ?? "base"}-${index}`}>
                      {REPORT_COLUMNS.map((column) => (
                        <td key={column.key} className="border border-slate-200 px-2 py-2 text-slate-700">
                          {column.key === "created_at" ? formatDateTime(row[column.key]) : row[column.key] || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
