import { useEffect, useMemo, useRef, useState } from "react";
import {
  openScreen,
  popScreen,
  getActiveScreenContext,
  updateActiveScreenContext,
} from "../../../navigation/screenStackEngine.js";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpReportFilterTemplate from "../../../components/templates/ErpReportFilterTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpSelectionField from "../../../components/forms/ErpSelectionField.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultCriteria() {
  return {
    fromDate: shiftIsoDate(todayIso(), -30),
    toDate: todayIso(),
    companyId: "",
  };
}

function normalizeCriteria(criteria) {
  if (!criteria || typeof criteria !== "object") {
    return defaultCriteria();
  }

  return {
    fromDate: criteria.fromDate || shiftIsoDate(todayIso(), -30),
    toDate: criteria.toDate || todayIso(),
    companyId: criteria.companyId || "",
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

function RegisterCriteriaPage({ kind, title, criteriaScreenCode, resultScreenCode }) {
  const { runtimeContext } = useMenu();
  const [criteria, setCriteria] = useState(() =>
    normalizeCriteria(getActiveScreenContext()?.criteria)
  );
  const [error, setError] = useState("");
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];

  function updateCriteria(key, value) {
    setCriteria((current) => ({ ...current, [key]: value }));
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
    updateActiveScreenContext({ criteria });
    openScreen(resultScreenCode, {
      context: {
        contextKind: "SCREEN_CONTEXT",
        criteria,
        criteriaScreenCode,
        reportKind: kind,
      },
    });
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
      footerHints={[
        "F8 Execute",
        "Ctrl+S Execute",
        "Esc Back",
        "Ctrl+K Command Bar",
      ]}
      actions={[
        {
          key: "run",
          label: "Run Report",
          hint: "F8 / Ctrl+S",
          tone: "primary",
          onClick: handleRunReport,
        },
      ]}
    >
      <div className="grid gap-[var(--erp-section-gap)]">
        <div className="grid gap-2">
          <ErpSelectionSection label="Selection Criteria" />
          <ErpSelectionField
            label="From Date"
            type="date"
            value={criteria.fromDate}
            onChange={(value) => updateCriteria("fromDate", value)}
          />
          <ErpSelectionField
            label="To Date"
            type="date"
            value={criteria.toDate}
            onChange={(value) => updateCriteria("toDate", value)}
          />
          <ErpSelectionField
            label="Company"
            type="select"
            value={criteria.companyId}
            onChange={(value) => updateCriteria("companyId", value)}
            options={[
              { value: "*", label: "* | All Companies In Scope" },
              ...availableCompanies.map((company) => ({
                value: company.id,
                label: `${company.company_code} | ${company.company_name}`,
              })),
            ]}
          />
        </div>
        {error ? (
          <div className="border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </ErpScreenScaffold>
  );
}

function RegisterResultsPage({ kind, title, loader }) {
  const searchRef = useRef(null);
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const criteria = useMemo(
    () => normalizeCriteria(getActiveScreenContext()?.criteria),
    []
  );
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
  const gridColumns = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        render: (row) => normalizeCellValue(column.key, row?.[column.key]),
      })),
    [columns],
  );
  const summaryRow = useMemo(() => ({
    label: `Total Rows: ${filteredRows.length}`,
    values: {
      total_days:
        filteredRows.reduce((sum, row) => sum + Number(row?.total_days ?? 0), 0) || "",
    },
  }), [filteredRows]);
  const { getRowProps } = useErpListNavigation(pagedRows);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, rows]);

  useErpScreenCommands([
    {
      id: `${kind}-register-results-back`,
      group: "Current Screen",
      label: "Back to report criteria",
      keywords: ["register", "criteria", "back", kind],
      onSelect: () => popScreen(),
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
    <ErpReportFilterTemplate
      title={title}
      eyebrow="HR Management"
      footerHints={[
        "↑↓ Navigate",
        "Enter Open",
        "Ctrl+S Export",
        "F8 Refresh",
        "Esc Back",
        "Ctrl+K Command Bar",
      ]}
      actions={[
        {
          key: "back",
          label: "Back To Criteria",
          tone: "neutral",
          onClick: () => popScreen(),
        },
        {
          key: "export",
          label: "Download Excel CSV",
          tone: "primary",
          onClick: () =>
            downloadCsvFile({
              fileName: `${kind}-register-report.csv`,
              columns,
              rows: buildDownloadRows(columns, filteredRows),
            }),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Report Scope",
        title: "Search within the loaded register report",
        children: (
          <div className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5 border border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-700">
              <div><span className="font-semibold text-slate-900">Date Range:</span> {formatIsoDate(criteria.fromDate)} {"->"} {formatIsoDate(criteria.toDate)}</div>
              <div><span className="font-semibold text-slate-900">Company:</span> {resolveCompanyLabel(availableCompanies, criteria.companyId)}</div>
              <div><span className="font-semibold text-slate-900">Address:</span> {resolveCompanyAddress(availableCompanies, criteria.companyId)}</div>
              <div><span className="font-semibold text-slate-900">Visible Rows:</span> {filteredRows.length}</div>
              <div><span className="font-semibold text-slate-900">Current Page:</span> {safePage} / {totalPages}</div>
            </div>
            <QuickFilterInput
              label="Quick Search"
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={searchRef}
              placeholder="Search requester, company, work area, reason, destination, or workflow id"
            />
          </div>
        ),
      }}
      reportSection={{
        eyebrow: "Register Report",
        title: loading ? "Loading report" : `${filteredRows.length} matching row${filteredRows.length === 1 ? "" : "s"}`,
        children: loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Loading report.
          </div>
        ) : (
          <div className="grid gap-3">
            <ErpDenseGrid
              columns={gridColumns}
              rows={pagedRows}
              rowKey={(row) => `${row.workflow_request_id}-${row.requester_auth_user_id}`}
              getRowProps={(_row, index) => getRowProps(index)}
              summaryRow={summaryRow}
              maxHeight="60vh"
              emptyMessage="No row matches the current report criteria."
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
        ),
      }}
    />
  );
}

export function LeaveRegisterCriteriaPage() {
  return (
    <RegisterCriteriaPage
      kind="leave"
      title="Leave Register Report Criteria"
      criteriaScreenCode="HR_LEAVE_REGISTER"
      resultScreenCode="HR_LEAVE_REGISTER_RESULTS"
    />
  );
}

async function loadLeaveRegisterRows(criteria) {
  const data = await listLeaveRegister({
    companyId: criteria.companyId,
    fromDate: criteria.fromDate,
    toDate: criteria.toDate,
  });
  return Array.isArray(data?.requests) ? data.requests : [];
}

async function loadOutWorkRegisterRows(criteria) {
  const data = await listOutWorkRegister({
    companyId: criteria.companyId,
    fromDate: criteria.fromDate,
    toDate: criteria.toDate,
  });
  return Array.isArray(data?.requests) ? data.requests : [];
}

export function LeaveRegisterResultsPage() {
  return (
    <RegisterResultsPage
      kind="leave"
      title="Leave Register Report"
      criteriaScreenCode="HR_LEAVE_REGISTER"
      loader={loadLeaveRegisterRows}
    />
  );
}

export function OutWorkRegisterCriteriaPage() {
  return (
    <RegisterCriteriaPage
      kind="outWork"
      title="Out Work Register Report Criteria"
      criteriaScreenCode="HR_OUT_WORK_REGISTER"
      resultScreenCode="HR_OUT_WORK_REGISTER_RESULTS"
    />
  );
}

export function OutWorkRegisterResultsPage() {
  return (
    <RegisterResultsPage
      kind="outWork"
      title="Out Work Register Report"
      criteriaScreenCode="HR_OUT_WORK_REGISTER"
      loader={loadOutWorkRegisterRows}
    />
  );
}
