import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpStickyDataTable from "../../../components/data/ErpStickyDataTable.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { downloadCsvFile } from "../../../shared/downloadTabularFile.js";
import { formatDateTime, formatIsoDate, listLeaveRegister, listOutWorkRegister, shiftIsoDate } from "./hrApi.js";

const PAGE_SIZE = 25;

const REPORT_COLUMNS_BY_KIND = Object.freeze({
  leave: [
    { key: "requester_display", label: "Requester" },
    { key: "requester_auth_user_id", label: "Requester User ID" },
    { key: "parent_company_code", label: "Company Code" },
    { key: "parent_company_name", label: "Company Name" },
    { key: "requester_work_context_code", label: "Work Area Code" },
    { key: "requester_work_context_name", label: "Work Area Name" },
    { key: "from_date", label: "From Date" },
    { key: "to_date", label: "To Date" },
    { key: "total_days", label: "Total Days" },
    { key: "reason", label: "Reason" },
    { key: "current_state", label: "Status" },
    { key: "approval_type", label: "Approval Type" },
    { key: "workflow_request_id", label: "Workflow ID" },
    { key: "created_at", label: "Created At" },
  ],
  outWork: [
    { key: "requester_display", label: "Requester" },
    { key: "requester_auth_user_id", label: "Requester User ID" },
    { key: "parent_company_code", label: "Company Code" },
    { key: "parent_company_name", label: "Company Name" },
    { key: "requester_work_context_code", label: "Work Area Code" },
    { key: "requester_work_context_name", label: "Work Area Name" },
    { key: "destination_name", label: "Destination" },
    { key: "destination_address", label: "Destination Address" },
    { key: "from_date", label: "From Date" },
    { key: "to_date", label: "To Date" },
    { key: "total_days", label: "Total Days" },
    { key: "reason", label: "Reason" },
    { key: "current_state", label: "Status" },
    { key: "approval_type", label: "Approval Type" },
    { key: "workflow_request_id", label: "Workflow ID" },
    { key: "created_at", label: "Created At" },
  ],
});

const STORAGE_KEYS = Object.freeze({
  leave: "erp.hr.leave.register.criteria",
  outWork: "erp.hr.outwork.register.criteria",
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function readCriteria(kind) {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS[kind]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCriteria(kind, criteria) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(criteria));
}

function defaultCriteria(kind) {
  const saved = readCriteria(kind);
  return {
    fromDate: saved?.fromDate ?? shiftIsoDate(todayIso(), -30),
    toDate: saved?.toDate ?? todayIso(),
    companyId: saved?.companyId ?? "",
  };
}

function calculateInclusiveDays(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const diffMs = to.getTime() - from.getTime();
  if (Number.isNaN(diffMs)) return 0;
  return Math.floor(diffMs / 86400000) + 1;
}

function buildSearchParams(criteria) {
  const params = new URLSearchParams();
  params.set("from_date", criteria.fromDate);
  params.set("to_date", criteria.toDate);
  params.set("company_id", criteria.companyId);
  return params.toString();
}

function parseCriteria(locationSearch) {
  const params = new URLSearchParams(locationSearch);
  return {
    fromDate: params.get("from_date")?.trim() || "",
    toDate: params.get("to_date")?.trim() || "",
    companyId: params.get("company_id")?.trim() || "",
  };
}

function resolveCompanyLabel(companies, companyId) {
  if (companyId === "*") {
    return "* | All Companies In Scope";
  }
  const company = (companies ?? []).find((row) => row.id === companyId);
  return company ? `${company.company_code} | ${company.company_name}` : "Company not selected";
}

function resolveCompanyAddress(companies, companyId) {
  if (companyId === "*") {
    return "All companies currently in scope";
  }
  const company = (companies ?? []).find((row) => row.id === companyId);
  if (!company) return "Address not captured";
  return (
    [company.full_address, company.state_name, company.pin_code]
      .filter(Boolean)
      .join(", ") || "Address not captured"
  );
}

function normalizeCellValue(columnKey, value) {
  if (columnKey === "created_at") return formatDateTime(value);
  if (columnKey === "from_date" || columnKey === "to_date") return formatIsoDate(value);
  return value ?? "-";
}

function buildDownloadRows(columns, rows) {
  return rows.map((row) => {
    const nextRow = {};
    for (const column of columns) {
      nextRow[column.key] = normalizeCellValue(column.key, row?.[column.key]);
    }
    return nextRow;
  });
}

function RegisterCriteriaPage({ kind, title, description, resultPath }) {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const actionRefs = useRef([]);
  const [criteria, setCriteria] = useState(() => defaultCriteria(kind));
  const [error, setError] = useState("");
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];

  function updateCriteria(key, value) {
    setCriteria((current) => {
      const next = { ...current, [key]: value };
      writeCriteria(kind, next);
      return next;
    });
  }

  function handleRunReport() {
    const totalDays = calculateInclusiveDays(criteria.fromDate, criteria.toDate);
    if (!criteria.fromDate || !criteria.toDate) {
      setError("From date and to date are required.");
      return;
    }
    if (totalDays <= 0 || totalDays > 366) {
      setError("Date range must stay within one year.");
      return;
    }
    if (!criteria.companyId) {
      setError("Choose one company or * for all companies in scope.");
      return;
    }
    setError("");
    writeCriteria(kind, criteria);
    navigate(`${resultPath}?${buildSearchParams(criteria)}`);
  }

  useErpScreenCommands([
    {
      id: `${kind}-register-run`,
      group: "Current Screen",
      label: "Run register report",
      keywords: ["register", "report", "run", kind],
      onSelect: handleRunReport,
    },
  ]);

  useErpScreenHotkeys({
    save: {
      label: "Run register report",
      handler: handleRunReport,
    },
  });

  return (
    <ErpScreenScaffold
      title={title}
      description={description}
      actions={[
        {
          key: "run",
          label: "Run Report",
          tone: "primary",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: handleRunReport,
          onKeyDown: (event) =>
            handleLinearNavigation(event, { index: 0, refs: actionRefs.current }),
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <ErpFieldPreview label="Date Limit" value="Max 1 Year" />
          <ErpFieldPreview
            label="Company Scope"
            value={criteria.companyId ? resolveCompanyLabel(availableCompanies, criteria.companyId) : "Choose company or *"}
          />
          <ErpFieldPreview
            label="Company Address"
            value={criteria.companyId ? resolveCompanyAddress(availableCompanies, criteria.companyId) : "Choose company first"}
          />
          <ErpFieldPreview label="Output" value="Separate results page + Excel CSV" />
        </div>

        <ErpSectionCard
          title="Report Criteria"
          description="Choose date range first, then one company or * for all scoped companies. The report opens on a separate results page."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">From Date</span>
              <input
                type="date"
                value={criteria.fromDate}
                onChange={(event) => updateCriteria("fromDate", event.target.value)}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">To Date</span>
              <input
                type="date"
                value={criteria.toDate}
                onChange={(event) => updateCriteria("toDate", event.target.value)}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Company</span>
              <select
                value={criteria.companyId}
                onChange={(event) => updateCriteria("companyId", event.target.value)}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"
              >
                <option value="">Choose company or *</option>
                <option value="*">* | All Companies In Scope</option>
                {availableCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_code} | {company.company_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <div className="mt-3 border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}

function RegisterResultsPage({ kind, title, loader, criteriaPath }) {
  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef(null);
  const actionRefs = useRef([]);
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const criteria = useMemo(() => parseCriteria(location.search), [location.search]);
  const columns = REPORT_COLUMNS_BY_KIND[kind];
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];

  useEffect(() => {
    let alive = true;
    async function loadRows() {
      setLoading(true);
      setError("");
      try {
        if (!criteria.fromDate || !criteria.toDate || !criteria.companyId) {
          throw new Error("REPORT_CRITERIA_REQUIRED");
        }
        const reportRows = await loader(criteria);
        if (!alive) return;
        setRows(reportRows);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : "REGISTER_REPORT_FAILED");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void loadRows();
    return () => {
      alive = false;
    };
  }, [criteria, loader]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      columns.some((column) =>
        String(row?.[column.key] ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [columns, rows, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, rows]);

  useErpScreenCommands([
    {
      id: `${kind}-register-results-back`,
      group: "Current Screen",
      label: "Back to report criteria",
      keywords: ["register", "criteria", "back", kind],
      onSelect: () => navigate(criteriaPath),
    },
    {
      id: `${kind}-register-results-export`,
      group: "Current Screen",
      label: "Download filtered report",
      keywords: ["register", "export", "excel", kind],
      onSelect: () =>
        downloadCsvFile({
          fileName: `${kind}-register-report.csv`,
          columns,
          rows: buildDownloadRows(columns, filteredRows),
        }),
    },
  ]);

  useErpScreenHotkeys({
    save: {
      label: "Download filtered report",
      handler: () =>
        downloadCsvFile({
          fileName: `${kind}-register-report.csv`,
          columns,
          rows: buildDownloadRows(columns, filteredRows),
        }),
    },
    focusSearch: {
      label: "Focus report search",
      handler: () => searchRef.current?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      title={title}
      description="Filtered report opens separately so search, review, and download do not overwrite the original criteria page."
      actions={[
        {
          key: "back",
          label: "Back To Criteria",
          tone: "neutral",
          buttonRef: (element) => {
            actionRefs.current[0] = element;
          },
          onClick: () => navigate(criteriaPath),
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
              fileName: `${kind}-register-report.csv`,
              columns,
              rows: buildDownloadRows(columns, filteredRows),
            }),
          onKeyDown: (event) =>
            handleLinearNavigation(event, { index: 1, refs: actionRefs.current }),
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-5">
          <ErpFieldPreview label="Date Range" value={`${formatIsoDate(criteria.fromDate)} -> ${formatIsoDate(criteria.toDate)}`} />
          <ErpFieldPreview label="Company" value={resolveCompanyLabel(availableCompanies, criteria.companyId)} />
          <ErpFieldPreview label="Company Address" value={resolveCompanyAddress(availableCompanies, criteria.companyId)} />
          <ErpFieldPreview label="Visible Rows" value={String(filteredRows.length)} />
          <ErpFieldPreview label="Current Page" value={`${safePage} / ${totalPages}`} />
        </div>

        <ErpSectionCard title="Search Report" description="Search inside the loaded report before pagination or download.">
          <QuickFilterInput
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchRef}
            placeholder="Search requester, company, work area, reason, destination, or workflow id"
          />
          {error ? (
            <div className="mt-3 border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </ErpSectionCard>

        <ErpSectionCard
          title={loading ? "Loading report" : `${filteredRows.length} matching row${filteredRows.length === 1 ? "" : "s"}`}
          description="Filtered data stays on this page. Browser back returns to the original criteria screen."
        >
          {loading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading report.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No row matches the current report criteria.
            </div>
          ) : (
            <div className="grid gap-3">
              <ErpStickyDataTable
                columns={columns}
                rows={pagedRows}
                rowKey={(row) => `${row.workflow_request_id}-${row.requester_auth_user_id}`}
                renderCell={(row, column) => normalizeCellValue(column.key, row?.[column.key])}
                maxBodyHeightClass="max-h-[60vh]"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                <span>
                  Showing {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    className="border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}

export function LeaveRegisterCriteriaPage() {
  return (
    <RegisterCriteriaPage
      kind="leave"
      title="Leave Register Report Criteria"
      description="Choose the leave report criteria first. The filtered output opens in a separate report page."
      resultPath="/dashboard/hr/leave/register/results"
    />
  );
}

function loadLeaveRegisterRows(criteria) {
  return listLeaveRegister({
    companyId: criteria.companyId,
    fromDate: criteria.fromDate,
    toDate: criteria.toDate,
  });
}

function loadOutWorkRegisterRows(criteria) {
  return listOutWorkRegister({
    companyId: criteria.companyId,
    fromDate: criteria.fromDate,
    toDate: criteria.toDate,
  });
}

export function LeaveRegisterResultsPage() {
  return (
    <RegisterResultsPage
      kind="leave"
      title="Leave Register Report"
      criteriaPath="/dashboard/hr/leave/register"
      loader={loadLeaveRegisterRows}
    />
  );
}

export function OutWorkRegisterCriteriaPage() {
  return (
    <RegisterCriteriaPage
      kind="outWork"
      title="Out Work Register Report Criteria"
      description="Choose the out work report criteria first. The filtered output opens in a separate report page."
      resultPath="/dashboard/hr/out-work/register/results"
    />
  );
}

export function OutWorkRegisterResultsPage() {
  return (
    <RegisterResultsPage
      kind="outWork"
      title="Out Work Register Report"
      criteriaPath="/dashboard/hr/out-work/register"
      loader={loadOutWorkRegisterRows}
    />
  );
}
