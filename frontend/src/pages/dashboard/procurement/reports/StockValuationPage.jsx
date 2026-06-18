/*
 * File-ID: 24.4
 * File-Path: frontend/src/pages/dashboard/procurement/reports/StockValuationPage.jsx
 * Gate: 24
 * Phase: 24
 * Domain: PROCUREMENT
 * Purpose: Aggregated stock valuation by material and plant.
 * Authority: Frontend
 */

import { useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { getStockValuation } from "../procurementApi.js";

function formatNumber(value, decimals) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return decimals === 2 ? "0.00" : "0.000000";
  }
  return amount.toFixed(decimals);
}

export default function StockValuationPage() {
  useMenu();
  const [companyId, setCompanyId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [rows, setRows] = useState([]);
  const [grandTotalValue, setGrandTotalValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function handleRun() {
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const response = await getStockValuation({
        company_id: companyId.trim() || undefined,
        material_id: materialId.trim() || undefined,
      });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setGrandTotalValue(Number(response?.grand_total_value ?? 0));
    } catch (runError) {
      setRows([]);
      setGrandTotalValue(0);
      setError(runError instanceof Error ? runError.message : "STOCK_VALUATION_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory Reports"
      title="Stock Valuation"
      notices={error ? [{ key: "stock-valuation-error", tone: "error", message: error }] : []}
      actions={[
        {
          key: "run",
          label: loading ? "Running..." : "Run",
          tone: "primary",
          onClick: () => void handleRun(),
          disabled: loading,
        },
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Filters" title="Valuation filters">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Valuation" title="Material and plant valuation">
          {!searched ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Set filters and click Run to compute stock valuation.
            </div>
          ) : (
            <div className="grid gap-3">
              <ErpDenseGrid
                columns={[
                  { key: "material_id", label: "Material ID", width: "220px" },
                  { key: "company_id", label: "Company ID", width: "200px" },
                  {
                    key: "total_qty",
                    label: "Total Qty",
                    width: "120px",
                    align: "right",
                    render: (row) => formatNumber(row.total_qty, 6),
                  },
                  { key: "base_uom_code", label: "UOM", width: "90px" },
                  {
                    key: "weighted_avg_rate",
                    label: "Wtd Avg Rate",
                    width: "130px",
                    align: "right",
                    render: (row) => formatNumber(row.weighted_avg_rate, 6),
                  },
                  {
                    key: "total_value",
                    label: "Total Value",
                    width: "120px",
                    align: "right",
                    render: (row) => formatNumber(row.total_value, 2),
                  },
                ]}
                rows={rows}
                rowKey={(row) => `${row.material_id}-${row.company_id}`}
                emptyMessage={loading ? "Running stock valuation..." : "No valuation rows matched the selected filters."}
              />
              {rows.length > 0 ? (
                <div className="flex justify-end rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                  Grand Total Value: {grandTotalValue.toFixed(2)}
                </div>
              ) : null}
            </div>
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
