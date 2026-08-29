/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113.4/§113.10 — SO01 list. The old STO tab is removed here on
 *          purpose: it was a pure duplicate of the already-separate STO
 *          module (STOListPage.jsx, TX code PO07, under GRP_ACL_PROCUREMENT)
 *          — SO01 is Sales Order only now. Also fixes: R-02 (useEffect+
 *          setState → useQuery), R-01 (raw-UUID fallback), server-side
 *          search+pagination (old page silently searched only the current
 *          50-row page and ACL registry never read `offset`).
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { listSalesOrders } from "../procurementApi.js";

const LIMIT = 50;

// §133.16-A UI standard — Export Excel, same shape as the current grid
// columns. Server-side paginated (§113.10), so this exports the currently
// loaded page only — same limitation as every other paginated list report
// in the codebase (e.g. ReservationListPage), not a new one.
const SO_EXPORT_COLUMNS = [
  { key: "so_number", label: "SO Number" },
  { key: "customer_display", label: "Customer" },
  { key: "ship_to_display", label: "Ship-To Address" },
  { key: "customer_po_number", label: "Customer PO" },
  { key: "dispatch_type", label: "Dispatch Type" },
  { key: "parent_company_display", label: "Parent Company" },
  { key: "depot_code_display", label: "VDC / DC" },
  { key: "so_date", label: "SO Date" },
  { key: "status", label: "Status" },
  { key: "company_display", label: "Company" },
  { key: "total_value", label: "Total Value" },
];

function soStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "ISSUED": return "bg-sky-100 text-sky-800";
    case "INVOICED": return "bg-amber-100 text-amber-800";
    case "CLOSED": return "bg-emerald-100 text-emerald-800";
    case "CANCELLED": return "bg-rose-100 text-rose-800";
    case "CREATED":
    default: return "bg-slate-100 text-slate-700";
  }
}

function formatMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "-";
}

export default function SOListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();

  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  useErpScreenHotkeys({});

  const params = useMemo(
    () => ({
      company_id: effectiveCompanyId || undefined,
      status: status || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: search || undefined,
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    }),
    [effectiveCompanyId, status, dateFrom, dateTo, search, page]
  );

  const soQuery = useQuery({
    queryKey: ["procurement", "sales-orders", params],
    queryFn: () => listSalesOrders(params),
    enabled: Boolean(effectiveCompanyId),
  });

  const rows = Array.isArray(soQuery.data?.items) ? soQuery.data.items : [];
  const total = Number(soQuery.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);
  const loading = soQuery.isLoading;

  function openCreateSO() {
    openScreen(OPERATION_SCREENS.PROC_SO_CREATE.screen_code);
    navigate("/dashboard/procurement/sales-orders/create");
  }

  function openSoMap() {
    openScreen(OPERATION_SCREENS.PROC_SO_MAP.screen_code);
    navigate("/dashboard/procurement/sales-orders/map");
  }

  function openSODetail(row) {
    openScreen(OPERATION_SCREENS.PROC_SO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(row.id)}`);
  }

  function handleExport() {
    if (rows.length === 0) return;
    downloadCsvFile({
      fileName: `sales_orders_${effectiveCompanyId || "all"}_page${page}.csv`,
      columns: SO_EXPORT_COLUMNS,
      rows: rows.map((row) => ({ ...row, total_value: formatMoney(row.total_invoice_value ?? row.total_value) })),
    });
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Sales Order"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => soQuery.refetch() },
        { key: "create", label: "Create SO", tone: "primary", onClick: openCreateSO },
        { key: "so-map", label: "SO Map", tone: "neutral", onClick: openSoMap },
        { key: "export", label: "Export Excel", tone: "neutral", onClick: handleExport, disabled: rows.length === 0 },
      ]}
      notices={soQuery.error ? [{ key: "so-list-error", tone: "error", message: soQuery.error instanceof Error ? soQuery.error.message : "PROCUREMENT_SO_LIST_FAILED" }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Sales order register — RM / PM / INT (§113.1, FG Dispatch is a separate module)",
        children: (
          <div className="grid gap-3 xl:grid-cols-[180px_180px_180px_180px_minmax(0,1fr)]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => { setCompanyId(value); setPage(1); }}
              label="Company"
              hint=""
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                <option value="">ALL</option>
                {["CREATED", "ISSUED", "INVOICED", "CLOSED", "CANCELLED"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date From
              <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date To
              <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={(value) => { setSearch(value); setPage(1); }}
              primaryFocus
              placeholder="SO number, customer PO number"
            />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "SO Register",
        title: loading ? "Loading sales orders" : `${total} sales order row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={total} />
            {!effectiveCompanyId ? (
              <p className="text-slate-400 text-sm py-6 text-center">Select a company to view sales orders.</p>
            ) : (
              <ErpDenseGrid
                columns={[
                  { key: "so_number", label: "SO Number", width: "140px" },
                  { key: "customer_display", label: "Customer", render: (row) => row.customer_display || "—" },
                  { key: "ship_to_display", label: "Ship-To Address", width: "280px", render: (row) => row.ship_to_display || "—" },
                  { key: "customer_po_number", label: "Customer PO", width: "140px" },
                  { key: "dispatch_type", label: "Dispatch Type", width: "180px", render: (row) => row.dispatch_type || "—" },
                  { key: "parent_company_display", label: "Parent Company", width: "220px", render: (row) => row.parent_company_display || "—" },
                  { key: "depot_code_display", label: "VDC / DC", width: "180px", render: (row) => row.depot_code_display || "—" },
                  { key: "so_date", label: "SO Date", width: "110px" },
                  {
                    key: "status",
                    label: "Status",
                    width: "140px",
                    render: (row) => (
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${soStatusTone(row.status)}`}>
                        {row.status}
                      </span>
                    ),
                  },
                  { key: "company_display", label: "Company", render: (row) => row.company_display || "—" },
                  { key: "total_value", label: "Total Value", width: "120px", render: (row) => formatMoney(row.total_invoice_value ?? row.total_value) },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                onRowActivate={openSODetail}
                getRowProps={(row) => ({ onDoubleClick: () => openSODetail(row), className: "cursor-pointer hover:bg-sky-50" })}
                emptyMessage={loading ? "Loading sales orders..." : "No sales orders matched the current filter."}
              />
            )}
          </div>
        ),
      }}
    />
  );
}
