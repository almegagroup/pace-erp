import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listPOOrderGroups } from "../procurementApi.js";

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-800";
    case "CONFIRMED":
      return "bg-emerald-100 text-emerald-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "DRAFT":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function POOrderGroupListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const groupParams = useMemo(
    () => ({ company_id: effectiveCompanyId || undefined, status: status || undefined, limit: 100, offset: 0 }),
    [effectiveCompanyId, status]
  );
  const groupQuery = useQuery({
    queryKey: ["procurement", "po-order-groups", groupParams],
    queryFn: () => listPOOrderGroups(groupParams),
  });
  const rows = Array.isArray(groupQuery.data?.data) ? groupQuery.data.data : [];
  const vendors = vendorQuery.vendors;
  const loading = groupQuery.isLoading || vendorQuery.isLoading;
  const error =
    groupQuery.error?.message ||
    vendorQuery.error?.message ||
    "";

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => {
        void groupQuery.refetch();
        void vendorQuery.refetch();
      },
    },
  });

  const vendorMap = useMemo(() => new Map(vendors.map((entry) => [entry.id, entry])), [vendors]);
  const companyMap = useMemo(
    () => new Map((runtimeContext?.availableCompanies ?? []).map((entry) => [entry.id, entry])),
    [runtimeContext?.availableCompanies]
  );

  function openDetail(row) {
    if (String(row?.doc_type || "").toUpperCase() === "STO") {
      openScreenWithContext(
        OPERATION_SCREENS.PROC_STO_DETAIL.screen_code,
        { id: row.id, refreshOnReturn: true }
      );
      navigate(`/dashboard/procurement/stos/${encodeURIComponent(row.id)}`);
      return;
    }
    openScreenWithContext(
      OPERATION_SCREENS.PROC_PO_ORDER_DETAIL.screen_code,
      { id: row.id, refreshOnReturn: true }
    );
    navigate(`/dashboard/procurement/po-order-groups/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Order Approvals (PO / STO)"
      notices={error ? [{ key: "err", tone: "error", message: error }] : []}
      actions={[{
        key: "refresh",
        label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral",
        onClick: () => {
          void groupQuery.refetch();
          void vendorQuery.refetch();
        },
      }]}
    >
      <ErpSectionCard eyebrow="Filter" title="Order status">
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
          />
          <div className="flex gap-2">
            {["PENDING_APPROVAL", "DRAFT", "CONFIRMED", ""].map((s) => (
              <button
                key={s || "ALL"}
                type="button"
                onClick={() => setStatus(s)}
                className={`border px-3 py-1.5 text-xs font-semibold ${status === s ? "border-sky-600 bg-sky-100 text-sky-900" : "border-slate-300 bg-white text-slate-600"}`}
              >
                {s || "ALL"}
              </button>
            ))}
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard eyebrow="Orders" title={loading ? "Loading..." : `${rows.length} order(s)`}>
        <ErpDenseGrid
          columns={[
            { key: "created_at", label: "Created", width: "140px", render: (row) => (row.created_at || "").slice(0, 10) },
            { key: "vendor_name", label: "Vendor", render: (row) => vendorMap.get(row.vendor_id)?.vendor_name || row.vendor_id || "-" },
            { key: "company_name", label: "Company", render: (row) => companyMap.get(row.company_id)?.company_name || row.company_id || "-" },
            { key: "po_count", label: "POs", width: "80px", render: (row) => (Array.isArray(row.purchase_orders) ? row.purchase_orders.length : 0) },
            {
              key: "po_numbers",
              label: "PO Numbers",
              render: (row) => (Array.isArray(row.purchase_orders) ? row.purchase_orders.map((p) => p.po_number).join(", ") : "-"),
            },
            {
              key: "status",
              label: "Status",
              width: "150px",
              render: (row) => (
                <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusTone(row.status)}`}>
                  {row.status}
                </span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          onRowActivate={openDetail}
          getRowProps={(row) => ({ onDoubleClick: () => openDetail(row), className: "cursor-pointer hover:bg-sky-50" })}
          emptyMessage={loading ? "Loading..." : "No order groups found for this status."}
        />
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
