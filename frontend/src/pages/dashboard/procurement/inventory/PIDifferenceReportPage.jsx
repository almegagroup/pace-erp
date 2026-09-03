/*
 * PIDifferenceReportPage — MI20 (IN07), §119.15. Standalone, own resourceCode
 * (PROC_PI_DIFFERENCES, "everyone" per §119.5) — cross-document report, not a companion of any
 * single PID. Shows both posted AND pending differences (matches SAP MI20's review-before-post use).
 */
import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { listPIDifferences } from "../procurementApi.js";

const DIFF_TYPE_OPTIONS = ["", "GAIN", "LOSS", "ZERO"];
const STATUS_OPTIONS = ["", "OPEN", "COUNTED", "PENDING_APPROVAL", "POSTED", "CANCELLED"];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function toneForDifference(value) {
  if (value < 0) return "text-rose-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-500";
}

const GRID_COLUMNS = [
  { key: "pi_document_number", label: "PID #", width: "130px" },
  { key: "posting_date", label: "Posting Date", width: "110px", render: (row) => formatDate(row.posting_date) },
  { key: "pi_status", label: "PID Status", width: "120px" },
  { key: "company_code", label: "Company", width: "110px", render: (row) => row.company_code ?? "—" },
  { key: "storage_location_name", label: "Location", width: "140px", render: (row) => row.storage_location_code ?? "—", copyValue: (row) => row.storage_location_code },
  { key: "material_name", label: "Material", width: "260px", render: (row) => row.material_name ?? "—" },
  { key: "material_external_code", label: "External Code", width: "150px", render: (row) => row.material_external_code ?? "—" },
  { key: "batch_number", label: "Batch", width: "100px", render: (row) => row.batch_number ?? "—" },
  { key: "stock_type", label: "Stock Type", width: "130px" },
  { key: "book_qty", label: "Book Qty", width: "100px" },
  { key: "physical_qty", label: "Physical Qty", width: "100px", render: (row) => row.physical_qty ?? "—" },
  {
    key: "difference_qty",
    label: "Difference",
    width: "100px",
    render: (row) => <span className={`font-semibold ${toneForDifference(Number(row.difference_qty))}`}>{Number(row.difference_qty).toFixed(4)}</span>,
    copyValue: (row) => Number(row.difference_qty).toFixed(4),
  },
  { key: "difference_pct", label: "Diff %", width: "80px", render: (row) => (row.difference_pct === null ? "—" : `${row.difference_pct}%`) },
  {
    key: "difference_value",
    label: "Difference Value",
    width: "130px",
    align: "right",
    // Matches SAP MI20's own Difference Value column. Posted rows
    // show the rate actually used at posting (a fact); pending
    // rows show today's live WAR as a preview (may still move
    // before this actually posts).
    render: (row) => (
      <span className={`font-semibold ${toneForDifference(Number(row.difference_value))}`}>
        {Number(row.difference_value ?? 0).toFixed(2)}
        {row.status_label !== "POSTED" ? <span className="ml-1 font-normal text-slate-400">(est.)</span> : null}
      </span>
    ),
    copyValue: (row) => Number(row.difference_value ?? 0).toFixed(2),
  },
  { key: "base_uom_code", label: "UoM", width: "70px" },
  { key: "movement_type", label: "Movement", width: "90px", render: (row) => row.movement_type ?? "—" },
  {
    key: "status_label",
    label: "Status",
    width: "90px",
    render: (row) => {
      const tone = row.status_label === "POSTED"
        ? "bg-emerald-100 text-emerald-800"
        : row.status_label === "CANCELLED"
        ? "bg-slate-200 text-slate-600"
        : "bg-amber-100 text-amber-800";
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
          {row.status_label === "POSTED" ? "Posted" : row.status_label === "CANCELLED" ? "Cancelled" : "Pending"}
        </span>
      );
    },
    copyValue: (row) => row.status_label,
  },
];

// Business owner ask (2026-09-03) — reuses copyValue when present so a
// JSX-rendered cell still filters against plain text.
function getColumnFilterText(column, row) {
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
}

export default function PIDifferenceReportPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [filters, setFilters] = useState({ document_number: "", status: "", difference_type: "", date_from: "", date_to: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  async function loadDifferences(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const result = await listPIDifferences({
        company_id: effectiveCompanyId || undefined,
        document_number: nextFilters.document_number || undefined,
        status: nextFilters.status || undefined,
        difference_type: nextFilters.difference_type || undefined,
        date_from: nextFilters.date_from || undefined,
        date_to: nextFilters.date_to || undefined,
      });
      setRows(Array.isArray(result?.items) ? result.items : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PI_DIFF_REPORT_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => void loadDifferences(filters) },
  });

  useEffect(() => {
    void loadDifferences(filters);
  }, [effectiveCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useScreenBackInterceptor(() => {
    if (page !== 2) return false;
    setPage(1);
    return true;
  });

  async function applyFilters(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    await loadDifferences(next);
  }

  async function handleSearch() {
    await loadDifferences(filters);
    setPage(2);
  }

  const gainCount = rows.filter((row) => Number(row.difference_qty) > 0).length;
  const lossCount = rows.filter((row) => Number(row.difference_qty) < 0).length;
  const pendingCount = rows.filter((row) => row.status_label === "PENDING").length;

  const [globalSearch, setGlobalSearch] = useState("");
  const globalSearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of rows) {
      for (const column of GRID_COLUMNS) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
  }, [rows]);
  const hasActiveSearch = globalSearch.trim().length > 0;
  const filteredRows = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => GRID_COLUMNS.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [rows, globalSearch]);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title="Physical Inventory — Difference Report"
      notices={[
        ...(error ? [{ key: "pi-diff-error", tone: "error", message: error }] : []),
        {
          key: "pi-diff-guide",
          tone: "info",
          message: "IN07 is the MI20-style cross-document review page. Use it to analyze pending and posted differences across the selected company.",
        },
      ]}
      actions={
        page === 1
          ? [
              { key: "search", label: loading ? "Searching..." : "Search", tone: "primary", hint: "F8", onClick: () => void handleSearch() },
            ]
          : [
              { key: "back", label: "Back To Filters", tone: "neutral", hint: "Esc", onClick: () => setPage(1) },
              { key: "refresh", label: loading ? "Searching..." : "Search Again", tone: "primary", hint: "F8", onClick: () => void handleSearch() },
            ]
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Step" value="MI20 Difference Report" tone="sky" />
          <ErpFieldPreview label="Page" value={page === 1 ? "Filters" : "Output Grid"} />
          <ErpFieldPreview label="Company Scope" value={effectiveCompanyId ? "Selected" : "Required"} />
          <ErpFieldPreview label="Loaded Rows" value={`${rows.length}`} caption={`Gain ${gainCount} · Loss ${lossCount} · Pending ${pendingCount}`} />
        </div>

        {page === 1 ? (
          <ErpSectionCard eyebrow="Page 1" title="Report Filters">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              IN07 / MI20 review: compare gains, losses, and still-pending post rows without opening each PID individually.
            </div>
            <div className="mt-3 grid gap-3">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
              <div className="grid gap-3 xl:grid-cols-5">
                <ErpDenseFormRow label="PID Document #">
                  <input
                    value={filters.document_number}
                    onChange={(event) => void applyFilters({ document_number: event.target.value })}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    placeholder="Search document #"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Status">
                  <select value={filters.status} onChange={(event) => void applyFilters({ status: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    {STATUS_OPTIONS.map((entry) => (<option key={entry || "ALL"} value={entry}>{entry || "ALL"}</option>))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Difference Type">
                  <select value={filters.difference_type} onChange={(event) => void applyFilters({ difference_type: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    {DIFF_TYPE_OPTIONS.map((entry) => (<option key={entry || "ALL"} value={entry}>{entry || "ALL"}</option>))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Posting Date From">
                  <input type="date" value={filters.date_from} onChange={(event) => void applyFilters({ date_from: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Posting Date To">
                  <input type="date" value={filters.date_to} onChange={(event) => void applyFilters({ date_to: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Gain</div>
                  <div className="mt-1 text-base font-semibold text-emerald-700">{gainCount}</div>
                </div>
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Loss</div>
                  <div className="mt-1 text-base font-semibold text-rose-700">{lossCount}</div>
                </div>
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Pending Post</div>
                  <div className="mt-1 text-base font-semibold text-sky-700">{pendingCount}</div>
                </div>
              </div>
            </div>
          </ErpSectionCard>
        ) : (
          <ErpSectionCard eyebrow="Page 2" title={loading ? "Loading Differences" : `${rows.length} Difference Row${rows.length === 1 ? "" : "s"}`}>
            <div className="mb-2 flex items-center gap-2">
              <input
                list="pi-diff-search-options"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="pi-diff-search-options">
                {globalSearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              {hasActiveSearch ? (
                <>
                  <button type="button" onClick={() => setGlobalSearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                    Clear
                  </button>
                  <span className="text-xs text-slate-500">{filteredRows.length} of {rows.length} rows</span>
                </>
              ) : null}
            </div>
            <ErpDenseGrid
              virtualize
              columns={GRID_COLUMNS}
              rows={filteredRows}
              rowKey={(row, index) => `${row.pi_document_id}-${index}`}
              emptyMessage={loading ? "Loading differences..." : hasActiveSearch ? "No rows match this search." : "No differences found for this filter."}
              maxHeight="620px"
            />
          </ErpSectionCard>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
