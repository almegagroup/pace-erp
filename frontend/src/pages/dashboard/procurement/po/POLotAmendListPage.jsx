/*
 * Section 145 (feasibility doc) -- Bulk "Order in LOT": Lot Amend list.
 * Every Order in LOT purchase order of the company that is live (confirmed, or waiting for
 * approval) and not knocked off / cancelled. "PO" and "Legacy PO" are the same table split by
 * is_opening_po. Opening a row goes to the ordinary PO page in Lot Amend mode.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listPoLotOrders } from "../procurementApi.js";

const KIND_OPTIONS = [
  { value: "po", label: "Purchase Orders" },
  { value: "legacy", label: "Legacy Purchase Orders" },
];

function formatQty(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "—";
}

export default function POLotAmendListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [kind, setKind] = useState(searchParams.get("kind") === "legacy" ? "legacy" : "po");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const lotOrdersQuery = useQuery({
    queryKey: ["procurement", "po-lot-orders", effectiveCompanyId, kind],
    enabled: Boolean(effectiveCompanyId),
    queryFn: () => listPoLotOrders({ company_id: effectiveCompanyId, is_opening: kind === "legacy" ? "true" : "false" }),
    // The handler returns no `pagination`/`total`, so fetchProcurement already unwraps to the bare array.
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const rows = lotOrdersQuery.data ?? [];
  const loading = lotOrdersQuery.isLoading;
  const error = lotOrdersQuery.error?.message || "";

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => void lotOrdersQuery.refetch() },
  });

  function openLotAmend(row) {
    openScreen(OPERATION_SCREENS.PROC_PO_DETAIL.screen_code, { context: { id: row.id, lotAmend: true } });
    navigate(`/dashboard/procurement/purchase-orders/${encodeURIComponent(row.id)}?lotAmend=1`);
  }

  const columns = useMemo(() => [
    { key: "po_number", label: "PO Number", width: "150px" },
    { key: "vendor_display", label: "Vendor", width: "220px", render: (row) => row.vendor_display || "—" },
    { key: "material_display", label: "Material", width: "240px", render: (row) => row.material_display || "—" },
    { key: "po_uom_code", label: "UOM", width: "70px" },
    { key: "po_date", label: "PO Date", width: "110px" },
    { key: "ordered_qty", label: "Ordered", width: "110px", align: "right", render: (row) => formatQty(row.ordered_qty), copyValue: (row) => String(row.ordered_qty ?? "") },
    { key: "received_qty", label: "Received", width: "110px", align: "right", render: (row) => formatQty(row.received_qty), copyValue: (row) => String(row.received_qty ?? "") },
    { key: "balance_qty", label: "Balance", width: "110px", align: "right", render: (row) => formatQty(row.balance_qty), copyValue: (row) => String(row.balance_qty ?? "") },
    { key: "lot_count", label: "Lots", width: "70px", align: "right" },
    { key: "last_lot_number", label: "Last Lot", width: "90px", render: (row) => row.last_lot_number || "—" },
    {
      key: "status",
      label: "Status",
      width: "190px",
      render: (row) => (row.has_pending_lot
        ? <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">Lot awaiting approval</span>
        : <span className="inline-flex rounded-full bg-sky-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-800">{row.status}</span>),
      copyValue: (row) => (row.has_pending_lot ? "LOT_AWAITING_APPROVAL" : String(row.status ?? "")),
    },
  ], []);

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Lot Amend"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void lotOrdersQuery.refetch(),
        },
      ]}
      notices={error ? [{ key: "po-lot-amend-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Scope",
        title: "Order in LOT purchase orders",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_260px]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Document
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Lot Register",
        title: loading ? "Loading Order in LOT purchase orders" : `${rows.length} Order in LOT purchase order${rows.length === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-2">
            <p className="text-xs text-slate-500">
              Open a purchase order to add the next lot. Knocked-off and cancelled orders are not listed. Click and drag to select cells; use the funnel in a column header to filter.
            </p>
            <ErpDenseGrid
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              virtualize
              rangeSelect
              columnFilter
              maxHeight="calc(100vh - 340px)"
              onRowActivate={openLotAmend}
              getRowProps={(row) => ({
                onDoubleClick: () => openLotAmend(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading..." : "No Order in LOT purchase order is open for a new lot."}
            />
          </div>
        ),
      }}
    />
  );
}
