import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listPurchaseOrders } from "../procurementApi.js";

const LIMIT = 50;

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-800";
    case "CONFIRMED":
      return "bg-sky-100 text-sky-800";
    case "CLOSED":
      return "bg-emerald-100 text-emerald-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "DRAFT":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function POListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const purchaseOrderParams = useMemo(
    () => ({
      status: status || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    }),
    [dateFrom, dateTo, page, status]
  );
  const purchaseOrderQuery = useQuery({
    queryKey: ["procurement", "purchase-orders", purchaseOrderParams],
    queryFn: () => listPurchaseOrders(purchaseOrderParams),
  });

  const rows = Array.isArray(purchaseOrderQuery.data?.data) ? purchaseOrderQuery.data.data : [];
  const vendors = vendorQuery.vendors;
  const total = Number(purchaseOrderQuery.data?.total ?? 0);
  const loading = purchaseOrderQuery.isLoading || vendorQuery.isLoading;
  const error =
    purchaseOrderQuery.error?.message ||
    vendorQuery.error?.message ||
    "";

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => {
        void purchaseOrderQuery.refetch();
        void vendorQuery.refetch();
      },
    },
  });

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const companyMap = useMemo(
    () => new Map((runtimeContext?.availableCompanies ?? []).map((entry) => [entry.id, entry])),
    [runtimeContext?.availableCompanies]
  );
  const filteredRows = useMemo(() => {
    if (!debouncedSearch) {
      return rows;
    }
    return rows.filter((row) => {
      const vendor = vendorMap.get(row.vendor_id);
      const company = companyMap.get(row.company_id);
      const haystack = [
        row.po_number,
        vendor?.vendor_name,
        vendor?.vendor_code,
        company?.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(debouncedSearch);
    });
  }, [companyMap, debouncedSearch, rows, vendorMap]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_PO_CREATE.screen_code);
    navigate("/dashboard/procurement/purchase-orders/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_PO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/purchase-orders/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Purchase Orders"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => {
            void purchaseOrderQuery.refetch();
            void vendorQuery.refetch();
          },
        },
        { key: "create", label: "Create PO", tone: "primary", onClick: openCreate },
      ]}
      notices={error ? [{ key: "po-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Purchase order lookup",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_180px_180px]">
            <QuickFilterInput
              label="Vendor Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search PO number or vendor"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "CLOSED", "CANCELLED"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date From
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date To
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "PO Register",
        title: loading ? "Loading purchase orders" : `${total} purchase order row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={page}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "po_number", label: "PO Number", width: "140px" },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) => {
                    const vendor = vendorMap.get(row.vendor_id);
                    return vendor?.vendor_name || vendor?.vendor_code || row.vendor_id || "-";
                  },
                },
                {
                  key: "company_name",
                  label: "Company",
                  render: (row) => companyMap.get(row.company_id)?.company_name || row.company_id || "-",
                },
                { key: "po_date", label: "PO Date", width: "110px" },
                {
                  key: "status",
                  label: "Status",
                  width: "140px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusTone(row.status)}`}>
                      {row.status}
                    </span>
                  ),
                },
                { key: "total_value", label: "Total Value", width: "120px" },
                {
                  key: "created_by_display",
                  label: "Created By",
                  width: "160px",
                  render: (row) => row.created_by_display || row.created_by || "-",
                },
              ]}
              rows={filteredRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading purchase orders..." : "No purchase order matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
