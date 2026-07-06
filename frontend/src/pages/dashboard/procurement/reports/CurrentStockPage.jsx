/*
 * File-ID: 24.3
 * File-Path: frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Current stock snapshot grid with plant, material, and stock-type filters.
 * Authority: Frontend
 */

import { useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { getCurrentStock } from "../procurementApi.js";

function formatNumber(value, decimals) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return decimals === 2 ? "0.00" : "0.000000";
  }
  return amount.toFixed(decimals);
}

function stockTypeTone(stockTypeCode) {
  switch (String(stockTypeCode || "").toUpperCase()) {
    case "UNRESTRICTED":
      return "bg-emerald-100 text-emerald-800";
    case "QA":
    case "QUALITY_INSPECTION":
      return "bg-amber-100 text-amber-800";
    case "BLOCKED":
      return "bg-rose-100 text-rose-800";
    case "IN_TRANSIT":
      return "bg-violet-100 text-violet-800";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export default function CurrentStockPage() {
  useMenu();
  const [companyId, setCompanyId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [stockTypeCode, setStockTypeCode] = useState("");
  const [showZero, setShowZero] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch() {
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const response = await getCurrentStock({
        company_id: companyId.trim() || undefined,
        material_id: materialId.trim() || undefined,
        stock_type_code: stockTypeCode || undefined,
        show_zero: showZero ? "true" : "false",
      });
      setRows(Array.isArray(response?.data) ? response.data : []);
    } catch (searchError) {
      setRows([]);
      setError(searchError instanceof Error ? searchError.message : "CURRENT_STOCK_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Current Stock"
      notices={error ? [{ key: "current-stock-error", tone: "error", message: error }] : []}
      actions={[
        {
          key: "search",
          label: loading ? "Searching..." : "Search",
          tone: "primary",
          onClick: () => void handleSearch(),
          disabled: loading,
        },
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Filters" title="Snapshot filters">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ErpDenseFormRow label="Company ID">
              <input
                type="text"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Material ID">
              <input
                type="text"
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Stock Type">
              <select
                value={stockTypeCode}
                onChange={(event) => setStockTypeCode(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">All</option>
                {["UNRESTRICTED", "QA", "BLOCKED", "IN_TRANSIT"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showZero}
              onChange={(event) => setShowZero(event.target.checked)}
            />
            Show Zero Stock
          </label>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Snapshot" title="Current stock by material and location">
          {!searched ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Set filters and click Search to view current stock.
            </div>
          ) : (
            <ErpDenseGrid
              columns={[
                { key: "material_id", label: "Material ID", width: "220px" },
                { key: "storage_location_id", label: "SLOC ID", width: "220px" },
                {
                  key: "stock_type_code",
                  label: "Stock Type",
                  width: "130px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${stockTypeTone(row.stock_type_code)}`}>
                      {row.stock_type_code || "—"}
                    </span>
                  ),
                },
                {
                  key: "batch_id",
                  label: "Batch ID",
                  width: "220px",
                  render: (row) => row.batch_id ?? "—",
                },
                {
                  key: "quantity",
                  label: "Quantity",
                  width: "120px",
                  align: "right",
                  render: (row) => formatNumber(row.quantity, 6),
                },
                { key: "base_uom_code", label: "UOM", width: "90px" },
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
              ]}
              rows={rows}
              rowKey={(row) => row.id ?? `${row.material_id}-${row.company_id}-${row.storage_location_id}-${row.stock_type_code}`}
              emptyMessage={loading ? "Searching current stock..." : "No current stock matched the selected filters."}
            />
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
