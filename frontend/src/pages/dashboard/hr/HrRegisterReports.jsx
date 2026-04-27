import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  openScreen,
  openScreenWithContext,
  popScreen,
  getActiveScreenContext,
  updateActiveScreenContext,
  registerScreenRefreshCallback,
} from "../../../navigation/screenStackEngine.js";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpReportFilterTemplate from "../../../components/templates/ErpReportFilterTemplate.jsx";
import ErpColumnVisibilityDrawer from "../../../components/ErpColumnVisibilityDrawer.jsx";
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

// ─── Column definitions ──────────────────────────────────────────────────────
// "computed" keys (requester_name, requester_code) are derived from
// requester_display at render/export time via resolveColumnValue().

const LEAVE_COLUMN_DEFS = Object.freeze([
  { key: "requester_name",             label: "Requester Name",    width: "minmax(160px,1.1fr)" },
  { key: "requester_code",             label: "Requester ID",      width: "minmax(110px,0.7fr)" },
  { key: "parent_company_name",        label: "Company",           width: "minmax(180px,1fr)"   },
  { key: "parent_company_code",        label: "Company Code",      width: "minmax(120px,0.7fr)" },
  { key: "department_name",            label: "Department",        width: "minmax(160px,0.9fr)" },
  { key: "department_code",            label: "Dept Code",         width: "minmax(120px,0.7fr)" },
  { key: "requester_work_context_name",label: "Work Area",         width: "minmax(160px,0.9fr)" },
  { key: "requester_work_context_code",label: "Work Area Code",    width: "minmax(120px,0.7fr)" },
  { key: "from_date",                  label: "From Date",         width: "minmax(120px,0.7fr)" },
  { key: "to_date",                    label: "To Date",           width: "minmax(120px,0.7fr)" },
  { key: "total_days",                 label: "Days",              width: "minmax(80px,0.45fr)" },
  { key: "reason",                     label: "Reason",            width: "minmax(220px,1.4fr)" },
  { key: "current_state",              label: "Status",            width: "minmax(120px,0.7fr)" },
  { key: "approval_type",              label: "Approval Type",     width: "minmax(120px,0.7fr)" },
  { key: "workflow_request_id",        label: "Workflow ID",       width: "minmax(220px,1fr)"   },
  { key: "created_at",                 label: "Created At",        width: "minmax(170px,0.9fr)" },
]);

const OUT_WORK_COLUMN_DEFS = Object.freeze([
  { key: "requester_name",             label: "Requester Name",    width: "minmax(160px,1.1fr)" },
  { key: "requester_code",             label: "Requester ID",      width: "minmax(110px,0.7fr)" },
  { key: "parent_company_name",        label: "Company",           width: "minmax(180px,1fr)"   },
  { key: "parent_company_code",        label: "Company Code",      width: "minmax(120px,0.7fr)" },
  { key: "department_name",            label: "Department",        width: "minmax(160px,0.9fr)" },
  { key: "department_code",            label: "Dept Code",         width: "minmax(120px,0.7fr)" },
  { key: "requester_work_context_name",label: "Work Area",         width: "minmax(160px,0.9fr)" },
  { key: "requester_work_context_code",label: "Work Area Code",    width: "minmax(120px,0.7fr)" },
  { key: "destination_name",           label: "Destination",       width: "minmax(180px,1fr)"   },
  { key: "destination_address",        label: "Dest. Address",     width: "minmax(220px,1.2fr)" },
  { key: "from_date",                  label: "From Date",         width: "minmax(120px,0.7fr)" },
  { key: "to_date",                    label: "To Date",           width: "minmax(120px,0.7fr)" },
  { key: "total_days",                 label: "Days",              width: "minmax(80px,0.45fr)"  },
  { key: "reason",                     label: "Reason",            width: "minmax(220px,1.4fr)" },
  { key: "current_state",              label: "Status",            width: "minmax(120px,0.7fr)" },
  { key: "approval_type",              label: "Approval Type",     width: "minmax(120px,0.7fr)" },
  { key: "workflow_request_id",        label: "Workflow ID",       width: "minmax(220px,1fr)"   },
  { key: "created_at",                 label: "Created At",        width: "minmax(170px,0.9fr)" },
]);

const COLUMN_DEFS_BY_KIND = Object.freeze({ leave: LEAVE_COLUMN_DEFS, outWork: OUT_WORK_COLUMN_DEFS });

const LEAVE_DEFAULT_VISIBLE = Object.freeze([
  "requester_name", "requester_code",
  "parent_company_name", "parent_company_code",
  "department_name",
  "from_date", "to_date", "total_days",
  "reason", "current_state", "created_at",
]);

const OUT_WORK_DEFAULT_VISIBLE = Object.freeze([
  "requester_name", "requester_code",
  "parent_company_name", "parent_company_code",
  "department_name",
  "destination_name",
  "from_date", "to_date", "total_days",
  "reason", "current_state", "created_at",
]);

const DEFAULT_VISIBLE_BY_KIND = Object.freeze({ leave: LEAVE_DEFAULT_VISIBLE, outWork: OUT_WORK_DEFAULT_VISIBLE });

const STORAGE_KEY_BY_KIND = Object.freeze({
  leave:   "hr_leave_register_visible_columns",
  outWork: "hr_outwork_register_visible_columns",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const to   = new Date(`${toDate}T00:00:00.000Z`);
  const diffMs = to.getTime() - from.getTime();
  if (Number.isNaN(diffMs)) return 0;
  return Math.floor(diffMs / 86400000) + 1;
}

function resolveCompanyLabel(companies, companyId) {
  if (companyId === "*") return "* | All Companies In Scope";
  const company = (companies ?? []).find((row) => row.id === companyId);
  return company ? `${company.company_code} | ${company.company_name}` : "Company not selected";
}

function resolveCompanyAddress(companies, companyId) {
  if (companyId === "*") return "All companies currently in scope";
  const company = (companies ?? []).find((row) => row.id === companyId);
  if (!company) return "Address not captured";
  return (
    [company.full_address, company.state_name, company.pin_code]
      .filter(Boolean)
      .join(", ") || "Address not captured"
  );
}

/** Split "Name | Code" → { name, code } */
function splitDisplay(displayValue) {
  const normalized = String(displayValue ?? "").trim();
  const parts = normalized.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { name: parts[0], code: parts[1] };
  return { name: normalized || "-", code: "-" };
}

/**
 * Resolve the display/export value for a column.
 * Computed columns (requester_name, requester_code) read from requester_display.
 */
function resolveColumnValue(columnKey, row) {
  if (columnKey === "requester_name")  return splitDisplay(row?.requester_display).name;
  if (columnKey === "requester_code")  return splitDisplay(row?.requester_display).code;
  if (columnKey === "created_at")      return formatDateTime(row?.[columnKey]);
  if (columnKey === "from_date" || columnKey === "to_date") return formatIsoDate(row?.[columnKey]);
  return row?.[columnKey] ?? "-";
}

function getHrDetailScreenCode(kind) {
  return kind === "leave" ? "HR_LEAVE_REQUEST_DETAIL" : "HR_OUT_WORK_REQUEST_DETAIL";
}

function getHrDetailRoute(kind) {
  return kind === "leave"
    ? "/dashboard/hr/leave/request-detail"
    : "/dashboard/hr/out-work/request-detail";
}

function getHrRequestKey(row) {
  return row?.workflow_request_id ?? row?.leave_request_id ?? row?.out_work_request_id ?? "";
}

function buildDownloadRows(visibleColumns, rows) {
  return rows.map((row) => {
    const nextRow = {};
    for (const column of visibleColumns) {
      nextRow[column.label] = resolveColumnValue(column.key, row);
    }
    return nextRow;
  });
}

// ─── Column visibility hook ───────────────────────────────────────────────────

function loadVisibleKeys(storageKey, defaults) {
  if (typeof window === "undefined") return [...defaults];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaults];
    return parsed;
  } catch {
    return [...defaults];
  }
}

function saveVisibleKeys(storageKey, keys) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch { /* ignore */ }
}

function useRegisterColumnVisibility(kind) {
  const allColumns    = COLUMN_DEFS_BY_KIND[kind];
  const defaults      = DEFAULT_VISIBLE_BY_KIND[kind];
  const storageKey    = STORAGE_KEY_BY_KIND[kind];

  const [visibleKeys, setVisibleKeys] = useState(() => loadVisibleKeys(storageKey, defaults));

  useEffect(() => {
    saveVisibleKeys(storageKey, visibleKeys);
  }, [storageKey, visibleKeys]);

  const visibleColumns = useMemo(
    () => allColumns.filter((col) => visibleKeys.includes(col.key)),
    [allColumns, visibleKeys],
  );

  const toggleColumn = useCallback((key) => {
    setVisibleKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const resetColumns = useCallback(() => {
    setVisibleKeys([...defaults]);
  }, [defaults]);

  return { allColumns, visibleColumns, visibleKeys, toggleColumn, resetColumns };
}

// ─── RegisterCriteriaPage ─────────────────────────────────────────────────────

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
      perform: handleRunReport,
    },
  ]);

  useErpScreenHotkeys({
    refresh: { perform: handleRunReport },
  });

  return (
    <ErpScreenScaffold
      title={title}
      footerHints={["F8 Execute", "Esc Back", "Ctrl+K Command Bar"]}
      actions={[
        {
          key: "run",
          label: "Run Report",
          hint: "F8",
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

// ─── RegisterResultsPage ──────────────────────────────────────────────────────

function RegisterResultsPage({ kind, title, loader }) {
  const navigate = useNavigate();
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchRef = useRef(null);
  const [focusKey, setFocusKey] = useState(initialContext.parentState?.focusKey ?? "");
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(initialContext.parentState?.page ?? 1);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const criteria = useMemo(() => normalizeCriteria(getActiveScreenContext()?.criteria), []);
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];

  const { allColumns, visibleColumns, visibleKeys, toggleColumn, resetColumns } =
    useRegisterColumnVisibility(kind);

  // ── load data ─────────────────────────────────────────────────────────────
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
    return () => { alive = false; };
  }, [criteria, loader]);

  // ── filter ────────────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      allColumns.some((column) =>
        String(resolveColumnValue(column.key, row))
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [allColumns, rows, searchQuery]);

  // ── pagination ────────────────────────────────────────────────────────────
  const totalPages  = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const pagedRows   = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const summaryRow = useMemo(() => ({
    label: `Total Rows: ${filteredRows.length}`,
    values: {
      total_days: filteredRows.reduce((sum, row) => sum + Number(row?.total_days ?? 0), 0) || "",
    },
  }), [filteredRows]);

  // ── grid columns ──────────────────────────────────────────────────────────
  const gridColumns = useMemo(
    () =>
      visibleColumns.map((column) => ({
        key:    column.key,
        label:  column.label,
        width:  column.width,
        align:  column.key === "total_days" ? "right" : "left",
        render: (row) => (
          <div className="text-sm text-slate-700">
            {resolveColumnValue(column.key, row)}
          </div>
        ),
      })),
    [visibleColumns],
  );

  // ── navigation ────────────────────────────────────────────────────────────
  function openDetail(row) {
    const nextFocusKey = getHrRequestKey(row);
    const parentState = { searchQuery, page: safePage, focusKey: nextFocusKey };
    setFocusKey(nextFocusKey);
    updateActiveScreenContext({ parentState, criteria });
    openScreenWithContext(getHrDetailScreenCode(kind), {
      request: row,
      kind,
      mode: "register",
      parentState,
      refreshOnReturn: true,
    });
    navigate(getHrDetailRoute(kind));
  }

  const { getRowProps, focusRow } = useErpListNavigation(pagedRows, {
    onActivate: (row) => openDetail(row),
  });

  // ── side effects ──────────────────────────────────────────────────────────
  useEffect(() => { setPage(1); }, [searchQuery, rows]);

  useEffect(
    () =>
      registerScreenRefreshCallback(() => {
        void (async () => {
          setLoading(true);
          try {
            const reportRows = await loader(criteria);
            setRows(reportRows);
          } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "REGISTER_REPORT_FAILED");
          } finally {
            setLoading(false);
          }
        })();
      }),
    [criteria, loader],
  );

  useEffect(() => {
    updateActiveScreenContext({ criteria, parentState: { searchQuery, page: safePage, focusKey } });
  }, [criteria, searchQuery, safePage, focusKey]);

  useEffect(() => {
    if (!focusKey || filteredRows.length === 0) return;
    const globalIndex = filteredRows.findIndex((row) => getHrRequestKey(row) === focusKey);
    if (globalIndex < 0) return;
    const desiredPage = Math.floor(globalIndex / PAGE_SIZE) + 1;
    if (safePage !== desiredPage) { setPage(desiredPage); return; }
    const pageIndex = globalIndex - (safePage - 1) * PAGE_SIZE;
    queueMicrotask(() => focusRow(pageIndex));
  }, [filteredRows, focusKey, safePage, focusRow]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useErpScreenCommands([
    {
      id: `${kind}-register-results-back`,
      group: "Current Screen",
      label: "Back to report criteria",
      keywords: ["register", "criteria", "back", kind],
      perform: () => popScreen(),
    },
    {
      id: `${kind}-register-results-export`,
      group: "Current Screen",
      label: "Download filtered report",
      keywords: ["register", "export", "excel", kind],
      perform: () =>
        downloadCsvFile({
          fileName: `${kind}-register-report.csv`,
          columns: visibleColumns.map((c) => ({ key: c.label })),
          rows: buildDownloadRows(visibleColumns, filteredRows),
        }),
    },
    {
      id: `${kind}-register-results-columns`,
      group: "Current Screen",
      label: "Choose visible columns",
      keywords: ["columns", "picker", "visibility", kind],
      perform: () => setShowColumnPicker(true),
    },
  ]);

  useErpScreenHotkeys({
    save: {
      perform: () =>
        downloadCsvFile({
          fileName: `${kind}-register-report.csv`,
          columns: visibleColumns.map((c) => ({ key: c.label })),
          rows: buildDownloadRows(visibleColumns, filteredRows),
        }),
    },
    refresh: {
      disabled: loading,
      perform: () =>
        void (async () => {
          setLoading(true);
          try {
            const reportRows = await loader(criteria);
            setRows(reportRows);
          } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "REGISTER_REPORT_FAILED");
          } finally {
            setLoading(false);
          }
        })(),
    },
    focusSearch: { perform: () => searchRef.current?.focus?.() },
  });

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      <ErpReportFilterTemplate
        title={title}
        eyebrow="HR Management"
        footerHints={[
          "↑↓ Navigate",
          "Enter Open",
          "Ctrl+S Export",
          "F8 Refresh",
          "Alt+Shift+F Search",
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
            key: "columns",
            label: "Columns",
            tone: "neutral",
            onClick: () => setShowColumnPicker(true),
          },
          {
            key: "export",
            label: "Download CSV",
            tone: "primary",
            onClick: () =>
              downloadCsvFile({
                fileName: `${kind}-register-report.csv`,
                columns: visibleColumns.map((c) => ({ key: c.label })),
                rows: buildDownloadRows(visibleColumns, filteredRows),
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
                <div>
                  <span className="font-semibold text-slate-900">Date Range: </span>
                  {formatIsoDate(criteria.fromDate)} {"→"} {formatIsoDate(criteria.toDate)}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Company: </span>
                  {resolveCompanyLabel(availableCompanies, criteria.companyId)}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Address: </span>
                  {resolveCompanyAddress(availableCompanies, criteria.companyId)}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Visible Rows: </span>
                  {filteredRows.length}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Page: </span>
                  {safePage} / {totalPages}
                </div>
              </div>
              <QuickFilterInput
                label="Quick Search"
                value={searchQuery}
                onChange={setSearchQuery}
                inputRef={searchRef}
                placeholder="Search requester, company, department, reason, destination, or workflow id"
              />
            </div>
          ),
        }}
        reportSection={{
          eyebrow: "Register Report",
          title: loading
            ? "Loading report"
            : `${filteredRows.length} matching row${filteredRows.length === 1 ? "" : "s"}`,
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
                onRowActivate={(row) => openDetail(row)}
                summaryRow={summaryRow}
                maxHeight="60vh"
                emptyMessage="No row matches the current report criteria."
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                <span>
                  Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
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

      <ErpColumnVisibilityDrawer
        visible={showColumnPicker}
        title="Choose Visible Columns"
        columns={allColumns}
        visibleColumnKeys={visibleKeys}
        onToggleColumn={toggleColumn}
        onResetColumns={resetColumns}
        onClose={() => setShowColumnPicker(false)}
      />
    </>
  );
}

// ─── Exported page components ─────────────────────────────────────────────────

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
