import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listCustomers } from "../../om/omApi.js";
import { listSalesOrders } from "../procurementApi.js";

const LIMIT = 50;

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "ISSUED":
      return "bg-sky-100 text-sky-800";
    case "INVOICED":
      return "bg-amber-100 text-amber-800";
    case "CLOSED":
      return "bg-emerald-100 text-emerald-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "CREATED":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function formatMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "-";
}

export default function SOListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [companyId, setCompanyId] = useState(runtimeContext?.selectedCompanyId || "");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setCompanyId(runtimeContext?.selectedCompanyId || "");
  }, [runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [soData, customerData] = await Promise.all([
          listSalesOrders({
            company_id: companyId || undefined,
            customer_id: customerId || undefined,
            status: status || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            limit: LIMIT,
            offset: (page - 1) * LIMIT,
          }),
          listCustomers({ limit: 200, offset: 0, status: "ACTIVE" }),
        ]);
        if (!active) {
          return;
        }
        setRows(Array.isArray(soData?.items) ? soData.items : []);
        setTotal(Number(soData?.total ?? soData?.items?.length ?? 0));
        setCustomers(Array.isArray(customerData?.data) ? customerData.data : []);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setRows([]);
        setCustomers([]);
        setTotal(0);
        setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_SO_LIST_FAILED");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [companyId, customerId, dateFrom, dateTo, page, status]);

  const customerMap = useMemo(
    () => new Map(customers.map((entry) => [entry.id, entry])),
    [customers]
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
      const customer = customerMap.get(row.customer_id);
      const haystack = [
        row.so_number,
        row.customer_po_number,
        customer?.customer_name,
        customer?.customer_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(debouncedSearch);
    });
  }, [customerMap, debouncedSearch, rows]);

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({
      value: entry.id,
      label: entry.company_name || entry.company_code || entry.id,
    })),
    [runtimeContext?.availableCompanies]
  );

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_SO_CREATE.screen_code);
    navigate("/dashboard/procurement/sales-orders/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_SO_DETAIL.screen_code);
    navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Sales Orders"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setPage((current) => current) },
        { key: "create", label: "Create SO", tone: "primary", onClick: openCreate },
      ]}
      notices={error ? [{ key: "so-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Sales order register",
        children: (
          <div className="grid gap-3 xl:grid-cols-[180px_180px_180px_180px_180px_minmax(0,1fr)]">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Company
              <select
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {companyOptions.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Customer
              <select
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {customers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.customer_code || entry.id} | {entry.customer_name || ""}
                  </option>
                ))}
              </select>
            </label>
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
                {["CREATED", "ISSUED", "INVOICED", "CLOSED", "CANCELLED"].map((entry) => (
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
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="SO number, customer PO, customer"
            />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "SO Register",
        title: loading ? "Loading sales orders" : `${total} sales order row${total === 1 ? "" : "s"}`,
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
                { key: "so_number", label: "SO Number", width: "140px" },
                {
                  key: "customer_name",
                  label: "Customer",
                  render: (row) => {
                    const customer = customerMap.get(row.customer_id);
                    return customer?.customer_name || customer?.customer_code || row.customer_id || "-";
                  },
                },
                { key: "customer_po_number", label: "Customer PO", width: "140px" },
                { key: "so_date", label: "SO Date", width: "110px" },
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
                {
                  key: "company_name",
                  label: "Company",
                  render: (row) => companyMap.get(row.company_id)?.company_name || row.company_id || "-",
                },
                {
                  key: "total_value",
                  label: "Total Value",
                  width: "120px",
                  render: (row) => formatMoney(row.total_invoice_value ?? row.total_value),
                },
              ]}
              rows={filteredRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading sales orders..." : "No sales orders matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
