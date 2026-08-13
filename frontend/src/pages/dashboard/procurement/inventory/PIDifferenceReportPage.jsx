/*
 * PIDifferenceReportPage — MI20 (IN07), §119.15. Standalone, own resourceCode
 * (PROC_PI_DIFFERENCES, "everyone" per §119.5) — cross-document report, not a companion of any
 * single PID. Shows both posted AND pending differences (matches SAP MI20's review-before-post use).
 */
import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
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

export default function PIDifferenceReportPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [filters, setFilters] = useState({ document_number: "", status: "", difference_type: "", date_from: "", date_to: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  async function applyFilters(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    await loadDifferences(next);
  }

  const gainCount = rows.filter((r) => Number(r.difference_qty) > 0).length;
  const lossCount = rows.filter((r) => Number(r.difference_qty) < 0).length;
  const pendingCount = rows.filter((r) => !r.posted).length;

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement Inventory"
      title="Physical Inventory — Difference Report"
      notices={error ? [{ key: "pi-diff-error", tone: "error", message: error }] : []}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadDifferences(filters) },
      ]}
      filterSection={{
        eyebrow: "Filters",
        title: "Company, document, status",
        children: (
          <div className="grid gap-3 xl:grid-cols-4">
            <div className="xl:col-span-4">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
            </div>
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
            <div className="grid grid-cols-3 gap-2 xl:col-span-2">
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Gain</div>
                <div className="text-lg font-semibold text-emerald-700">{gainCount}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Loss</div>
                <div className="text-lg font-semibold text-rose-700">{lossCount}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Pending Post</div>
                <div className="text-lg font-semibold text-sky-700">{pendingCount}</div>
              </div>
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Differences",
        title: loading ? "Loading differences" : `${rows.length} row${rows.length === 1 ? "" : "s"}`,
        children: (
          <ErpDenseGrid
            virtualize
            columns={[
              { key: "pi_document_number", label: "PID #", width: "130px" },
              { key: "posting_date", label: "Posting Date", width: "110px", render: (row) => formatDate(row.posting_date) },
              { key: "pi_status", label: "PID Status", width: "120px" },
              { key: "company_name", label: "Company", width: "140px", render: (row) => row.company_name ?? row.company_code ?? "—" },
              { key: "storage_location_name", label: "Location", width: "140px", render: (row) => row.storage_location_code ?? "—" },
              { key: "material_name", label: "Material", render: (row) => (row.material_name ? `${row.material_name} (${row.material_pace_code ?? "—"})` : "—") },
              { key: "batch_number", label: "Batch", width: "100px", render: (row) => row.batch_number ?? "—" },
              { key: "stock_type", label: "Stock Type", width: "130px" },
              { key: "book_qty", label: "Book Qty", width: "100px" },
              { key: "physical_qty", label: "Physical Qty", width: "100px", render: (row) => row.physical_qty ?? "—" },
              {
                key: "difference_qty",
                label: "Difference",
                width: "100px",
                render: (row) => <span className={`font-semibold ${toneForDifference(Number(row.difference_qty))}`}>{Number(row.difference_qty).toFixed(4)}</span>,
              },
              { key: "difference_pct", label: "Diff %", width: "80px", render: (row) => (row.difference_pct === null ? "—" : `${row.difference_pct}%`) },
              { key: "base_uom_code", label: "UoM", width: "70px" },
              { key: "movement_type", label: "Movement", width: "90px", render: (row) => row.movement_type ?? "—" },
              {
                key: "posted",
                label: "Posted",
                width: "80px",
                render: (row) => (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.posted ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {row.posted ? "Posted" : "Pending"}
                  </span>
                ),
              },
            ]}
            rows={rows}
            rowKey={(row, index) => `${row.pi_document_id}-${index}`}
            emptyMessage={loading ? "Loading differences..." : "No differences found for this filter."}
            maxHeight="620px"
          />
        ),
      }}
    />
  );
}
