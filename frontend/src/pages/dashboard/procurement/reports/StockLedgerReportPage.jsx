/*
 * File-ID: 24.2
 * File-Path: frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Stock ledger report with signed movements and running balance.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { getStockLedgerReport } from "../procurementApi.js";

function formatQuantity(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.000000";
  }
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${amount.toFixed(6)}`;
}

function formatNumber(value, decimals) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return decimals === 2 ? "0.00" : "0.000000";
  }
  return amount.toFixed(decimals);
}

function directionTone(direction) {
  return String(direction || "").toUpperCase() === "IN"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-rose-100 text-rose-800";
}

export default function StockLedgerReportPage() {
  useMenu();
  const [materialId, setMaterialId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState("200");
  const [offset] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const rowsWithRunningBalance = useMemo(() => {
    let runningBalance = 0;
    return rows.map((row) => {
      runningBalance += Number(row.signed_qty ?? 0);
      return {
        ...row,
        runningBalance,
      };
    });
  }, [rows]);

  async function handleRun() {
    if (!materialId.trim()) {
      setError("Material ID is required");
      setRows([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getStockLedgerReport({
        material_id: materialId.trim(),
        company_id: companyId.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit,
        offset,
      });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setTotal(Number(response?.total ?? 0));
    } catch (runError) {
      setRows([]);
      setTotal(0);
      setError(runError instanceof Error ? runError.message : "STOCK_LEDGER_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Stock Ledger"
      notices={error ? [{ key: "stock-ledger-error", tone: "error", message: error }] : []}
      actions={[
        {
          key: "run",
          label: loading ? "Running..." : "Run Report",
          tone: "primary",
          onClick: () => void handleRun(),
          disabled: loading,
        },
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Filters" title="Movement filters">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <ErpDenseFormRow label="Material ID" required>
              <input
                type="text"
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
                placeholder="Material UUID"
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Company ID">
              <input
                type="text"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Date From">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Date To">
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Rows">
              <select
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {["100", "200", "500"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Report" title="Movement history">
          <div className="mb-3 text-sm text-slate-600">
            Showing {rows.length} of {total} movements
          </div>
          <ErpDenseGrid
            columns={[
              { key: "ledger_seq", label: "Seq", width: "90px" },
              { key: "posting_date", label: "Posting Date", width: "110px" },
              { key: "movement_type_code", label: "Movement Type", width: "110px" },
              {
                key: "direction",
                label: "Direction",
                width: "100px",
                render: (row) => (
                  <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${directionTone(row.direction)}`}>
                    {row.direction || "—"}
                  </span>
                ),
              },
              { key: "stock_type_code", label: "Stock Type", width: "130px" },
              {
                key: "signed_qty",
                label: "Qty",
                width: "120px",
                align: "right",
                render: (row) => formatQuantity(row.signed_qty),
              },
              { key: "base_uom_code", label: "UOM", width: "80px" },
              {
                key: "value",
                label: "Value",
                width: "110px",
                align: "right",
                render: (row) => formatNumber(row.value, 2),
              },
              {
                key: "valuation_rate",
                label: "Val. Rate",
                width: "120px",
                align: "right",
                render: (row) => formatNumber(row.valuation_rate, 6),
              },
              {
                key: "runningBalance",
                label: "Running Bal",
                width: "130px",
                align: "right",
                render: (row) => formatNumber(row.runningBalance, 6),
              },
            ]}
            rows={rowsWithRunningBalance}
            rowKey={(row) => row.id ?? `${row.ledger_seq}-${row.posting_date}`}
            emptyMessage={loading ? "Running stock ledger report..." : "Run the report to view stock movements."}
          />
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
