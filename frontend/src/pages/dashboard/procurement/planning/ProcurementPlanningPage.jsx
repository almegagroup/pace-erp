/*
 * File-ID: 22.2
 * File-Path: frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx
 * Gate: 22
 * Phase: 22
 * Domain: PROCUREMENT
 * Purpose: Cross-plant procurement planning view - shortage identification
 * Authority: Frontend
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { getProcurementPlanning } from "../procurementApi.js";

function formatQty(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.000";
  }
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function netCellTone(value) {
  if (value < 0) {
    return "text-rose-700 font-bold";
  }
  if (value === 0) {
    return "text-amber-700 font-semibold";
  }
  return "text-emerald-700 font-semibold";
}

function rowTone(value) {
  if (value < 0) {
    return "bg-rose-50";
  }
  if (value === 0) {
    return "bg-amber-50";
  }
  return "";
}

export default function ProcurementPlanningPage() {
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPlantId, setSelectedPlantId] = useState("");
  const [shortageOnly, setShortageOnly] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const companyId = runtimeContext?.selectedCompanyId || "";

  const loadPlanning = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getProcurementPlanning({
        company_id: companyId || undefined,
        shortage_only: shortageOnly ? "true" : undefined,
        limit: 200,
      });
      setRows(Array.isArray(data?.items) ? data.items : []);
    } catch (loadError) {
      setRows([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "PROCUREMENT_PLANNING_FETCH_FAILED"
      );
    } finally {
      setLoading(false);
    }
  }, [companyId, shortageOnly]);

  useEffect(() => {
    void loadPlanning();
  }, [loadPlanning, refreshToken]);

  const plantOptions = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => String(row.plant_id || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [rows]
  );

  useEffect(() => {
    if (selectedPlantId && !plantOptions.includes(selectedPlantId)) {
      setSelectedPlantId("");
    }
  }, [plantOptions, selectedPlantId]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (selectedPlantId && row.plant_id !== selectedPlantId) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [
        row.material_code,
        row.material_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, rows, selectedPlantId]);

  const shortageCount = useMemo(
    () => visibleRows.filter((row) => Number(row.net_available ?? 0) < 0).length,
    [visibleRows]
  );
  const borderlineCount = useMemo(
    () => visibleRows.filter((row) => Number(row.net_available ?? 0) === 0).length,
    [visibleRows]
  );

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Procurement Planning"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => setRefreshToken((value) => value + 1),
        },
      ]}
      notices={error ? [{ key: "planning-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Filters",
        title: "Cross-plant shortage planning",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_220px_220px]">
            <QuickFilterInput
              label="Material Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search material code or material name"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Plant
              <select
                value={selectedPlantId}
                onChange={(event) => setSelectedPlantId(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {plantOptions.map((plantId) => (
                  <option key={plantId} value={plantId}>
                    {plantId}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-3 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
              <input
                type="checkbox"
                checked={shortageOnly}
                onChange={(event) => setShortageOnly(event.target.checked)}
                className="h-4 w-4"
              />
              <span className="font-medium">Shortage Only</span>
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Planning Grid",
        title: loading
          ? "Loading procurement planning rows"
          : `${visibleRows.length} material row${visibleRows.length === 1 ? "" : "s"} shown`,
        children: (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                Total Rows: {visibleRows.length}
              </span>
              <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                Shortage Count: {shortageCount}
              </span>
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                Borderline Count: {borderlineCount}
              </span>
            </div>
            <ErpDenseGrid
              columns={[
                {
                  key: "material",
                  label: "Material",
                  width: "240px",
                  render: (row) => (
                    <div className="grid gap-[2px]">
                      <span className="font-semibold text-slate-900">
                        {row.material_code || "—"}
                      </span>
                      <span className="text-[11px] text-slate-600">
                        {row.material_name || "Unnamed material"}
                      </span>
                    </div>
                  ),
                },
                { key: "base_uom_code", label: "UOM", width: "80px" },
                {
                  key: "unrestricted_qty",
                  label: "Unrestricted",
                  width: "120px",
                  align: "right",
                  render: (row) => formatQty(row.unrestricted_qty),
                },
                {
                  key: "qa_qty",
                  label: "QA",
                  width: "100px",
                  align: "right",
                  render: (row) => formatQty(row.qa_qty),
                },
                {
                  key: "open_po_qty",
                  label: "Open PO",
                  width: "110px",
                  align: "right",
                  render: (row) => formatQty(row.open_po_qty),
                },
                {
                  key: "in_transit_qty",
                  label: "In-Transit",
                  width: "120px",
                  align: "right",
                  render: (row) => formatQty(row.in_transit_qty),
                },
                {
                  key: "safety_stock_qty",
                  label: "Safety Stock",
                  width: "120px",
                  align: "right",
                  render: (row) => formatQty(row.safety_stock_qty),
                },
                {
                  key: "net_available",
                  label: "Net Available",
                  width: "130px",
                  align: "right",
                  render: (row) => (
                    <span className={netCellTone(Number(row.net_available ?? 0))}>
                      {formatQty(row.net_available)}
                    </span>
                  ),
                },
                {
                  key: "suggested_pr_qty",
                  label: "Suggested PR",
                  width: "120px",
                  align: "right",
                  render: (row) =>
                    Number(row.suggested_pr_qty ?? 0) > 0
                      ? formatQty(row.suggested_pr_qty)
                      : "—",
                },
                {
                  key: "last_gr_date",
                  label: "Last GR Date",
                  width: "120px",
                  render: (row) => row.last_gr_date || "—",
                },
              ]}
              rows={visibleRows}
              rowKey={(row) => `${row.company_id}-${row.plant_id}-${row.material_id}`}
              getRowProps={(row) => ({
                className: rowTone(Number(row.net_available ?? 0)),
              })}
              emptyMessage={
                loading
                  ? "Loading procurement planning rows..."
                  : "No procurement planning rows matched the current filters."
              }
            />
          </div>
        ),
      }}
    />
  );
}
