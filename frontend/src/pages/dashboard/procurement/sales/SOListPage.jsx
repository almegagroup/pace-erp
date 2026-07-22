import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listCustomers } from "../../om/omApi.js";
import { listSalesOrders, listSTOs } from "../procurementApi.js";

const LIMIT = 50;
const STO_LIMIT = 200;

function soStatusTone(status) {
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

function stoStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED":
      return "bg-sky-100 text-sky-800";
    case "RECEIVED":
      return "bg-emerald-100 text-emerald-800";
    case "CLOSED":
      return "bg-slate-200 text-slate-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "CREATED":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function stoTypeTone(stoType) {
  switch (String(stoType || "").toUpperCase()) {
    case "INTER_PLANT":
      return "bg-violet-100 text-violet-800";
    case "CONSIGNMENT_DISTRIBUTION":
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function formatMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "-";
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export default function SOListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [tab, setTab] = useState("SO");

  // ---- Sales Order tab state ----
  const [soRows, setSoRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [soCompanyId, setSoCompanyId] = useState(runtimeContext?.selectedCompanyId || "");
  const [customerId, setCustomerId] = useState("");
  const [soStatus, setSoStatus] = useState("");
  const [soDateFrom, setSoDateFrom] = useState("");
  const [soDateTo, setSoDateTo] = useState("");
  const [soSearch, setSoSearch] = useState("");
  const [soDebouncedSearch, setSoDebouncedSearch] = useState("");
  const [soPage, setSoPage] = useState(1);
  const [soTotal, setSoTotal] = useState(0);
  const [soLoading, setSoLoading] = useState(true);
  const [soError, setSoError] = useState("");
  const [soReloadTick, setSoReloadTick] = useState(0);

  // ---- Stock Transfer Order tab state (RM/PM scoped) ----
  const [stoRows, setStoRows] = useState([]);
  const [stoViewMode, setStoViewMode] = useState("OUTBOUND");
  const [stoStatus, setStoStatus] = useState("");
  const [stoType, setStoType] = useState("");
  const [stoSearch, setStoSearch] = useState("");
  const [stoPage, setStoPage] = useState(1);
  const [stoLoading, setStoLoading] = useState(true);
  const [stoError, setStoError] = useState("");
  const [stoReloadTick, setStoReloadTick] = useState(0);

  useErpScreenHotkeys({
    refresh: {
      disabled: tab === "SO" ? soLoading : stoLoading,
      perform: () =>
        tab === "SO"
          ? setSoReloadTick((tick) => tick + 1)
          : setStoReloadTick((tick) => tick + 1),
    },
  });

  useEffect(() => {
    setSoCompanyId(runtimeContext?.selectedCompanyId || "");
  }, [runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSoDebouncedSearch(soSearch.trim().toLowerCase());
      setSoPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [soSearch]);

  useEffect(() => {
    let active = true;
    async function load() {
      setSoLoading(true);
      setSoError("");
      try {
        const [soData, customerData] = await Promise.all([
          listSalesOrders({
            company_id: soCompanyId || undefined,
            customer_id: customerId || undefined,
            status: soStatus || undefined,
            date_from: soDateFrom || undefined,
            date_to: soDateTo || undefined,
            limit: LIMIT,
            offset: (soPage - 1) * LIMIT,
          }),
          listCustomers({ limit: 200, offset: 0, status: "ACTIVE" }),
        ]);
        if (!active) {
          return;
        }
        setSoRows(Array.isArray(soData?.items) ? soData.items : []);
        setSoTotal(Number(soData?.total ?? soData?.items?.length ?? 0));
        setCustomers(Array.isArray(customerData?.data) ? customerData.data : []);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setSoRows([]);
        setCustomers([]);
        setSoTotal(0);
        setSoError(loadError instanceof Error ? loadError.message : "PROCUREMENT_SO_LIST_FAILED");
      } finally {
        if (active) {
          setSoLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [soCompanyId, customerId, soDateFrom, soDateTo, soPage, soStatus, soReloadTick]);

  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";

  useEffect(() => {
    let active = true;
    async function load() {
      setStoLoading(true);
      setStoError("");
      try {
        const response = await listSTOs({
          company_id: selectedCompanyId || undefined,
          status: stoStatus || undefined,
          sto_type: stoType || undefined,
          material_scope: "RM_PM",
          limit: STO_LIMIT,
        });
        if (!active) {
          return;
        }
        setStoRows(Array.isArray(response?.items) ? response.items : []);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setStoRows([]);
        setStoError(loadError instanceof Error ? loadError.message : "PROCUREMENT_STO_LIST_FAILED");
      } finally {
        if (active) {
          setStoLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [selectedCompanyId, stoStatus, stoType, stoReloadTick]);

  useEffect(() => {
    setStoPage(1);
  }, [stoSearch, stoStatus, stoType, stoViewMode]);

  const customerMap = useMemo(
    () => new Map(customers.map((entry) => [entry.id, entry])),
    [customers]
  );
  const companyMap = useMemo(
    () => new Map((runtimeContext?.availableCompanies ?? []).map((entry) => [entry.id, entry])),
    [runtimeContext?.availableCompanies]
  );
  const soFilteredRows = useMemo(() => {
    if (!soDebouncedSearch) {
      return soRows;
    }
    return soRows.filter((row) => {
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
      return haystack.includes(soDebouncedSearch);
    });
  }, [customerMap, soDebouncedSearch, soRows]);

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({
      value: entry.id,
      label: entry.company_name || entry.company_code || entry.id,
    })),
    [runtimeContext?.availableCompanies]
  );

  const soTotalPages = useMemo(() => Math.max(1, Math.ceil(soTotal / LIMIT)), [soTotal]);
  const soStartIndex = soTotal === 0 ? 0 : (soPage - 1) * LIMIT + 1;
  const soEndIndex = soTotal === 0 ? 0 : Math.min(soPage * LIMIT, soTotal);

  const stoFilteredRows = useMemo(() => {
    const companyScopedRows = stoRows.filter((row) =>
      stoViewMode === "OUTBOUND"
        ? String(row.sending_company_id || "") === selectedCompanyId
        : String(row.receiving_company_id || "") === selectedCompanyId
    );
    const needle = normalizeSearch(stoSearch);
    if (!needle) {
      return companyScopedRows;
    }
    return companyScopedRows.filter((row) => {
      const sendingCompany = companyMap.get(row.sending_company_id);
      const receivingCompany = companyMap.get(row.receiving_company_id);
      const haystack = [
        row.sto_number,
        row.sto_type,
        row.status,
        sendingCompany?.company_name,
        receivingCompany?.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [companyMap, stoRows, stoSearch, selectedCompanyId, stoViewMode]);

  const stoTotal = stoFilteredRows.length;
  const stoTotalPages = Math.max(1, Math.ceil(stoTotal / LIMIT));
  const stoSafePage = Math.min(stoPage, stoTotalPages);
  const stoPageRows = stoFilteredRows.slice((stoSafePage - 1) * LIMIT, stoSafePage * LIMIT);
  const stoStartIndex = stoTotal === 0 ? 0 : (stoSafePage - 1) * LIMIT + 1;
  const stoEndIndex = stoTotal === 0 ? 0 : Math.min(stoSafePage * LIMIT, stoTotal);

  function openCreateSO() {
    openScreen(OPERATION_SCREENS.PROC_SO_CREATE.screen_code);
    navigate("/dashboard/procurement/sales-orders/create");
  }

  function openSODetail(row) {
    openScreen(OPERATION_SCREENS.PROC_SO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(row.id)}`);
  }

  function openCreateSTO() {
    openScreen(OPERATION_SCREENS.PROC_STO_CREATE.screen_code);
    navigate("/dashboard/procurement/stos/create");
  }

  function openSTODetail(row) {
    openScreen(OPERATION_SCREENS.PROC_STO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/stos/${encodeURIComponent(row.id)}`);
  }

  const tabButtons = (
    <div className="flex flex-wrap gap-2">
      {[
        { key: "SO", label: "Sales Orders" },
        { key: "STO", label: "Stock Transfer Orders" },
      ].map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => setTab(entry.key)}
          className={`border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
            tab === entry.key
              ? "border-sky-700 bg-sky-100 text-sky-950"
              : "border-slate-300 bg-white text-slate-700"
          }`}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  if (tab === "STO") {
    return (
      <ErpMasterListTemplate
        eyebrow="Procurement"
        title="RM/PM Sale"
        actions={[
          { key: "refresh", label: stoLoading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setStoReloadTick((tick) => tick + 1) },
          { key: "create", label: "Create STO", tone: "primary", onClick: openCreateSTO },
        ]}
        notices={stoError ? [{ key: "sto-list-error", tone: "error", message: stoError }] : []}
        filterSection={{
          eyebrow: "Search And Filter",
          title: "Stock transfers involving RM/PM materials only",
          children: (
            <div className="grid gap-3">
              {tabButtons}
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "OUTBOUND", label: "MY OUTBOUND" },
                  { key: "INBOUND", label: "MY INBOUND" },
                ].map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setStoViewMode(entry.key)}
                    className={`border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
                      stoViewMode === entry.key
                        ? "border-sky-700 bg-sky-100 text-sky-950"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_220px]">
                <QuickFilterInput
                  label="Search"
                  value={stoSearch}
                  onChange={setStoSearch}
                  primaryFocus
                  placeholder="Search STO number or company"
                />
                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Status
                  <select
                    value={stoStatus}
                    onChange={(event) => setStoStatus(event.target.value)}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">ALL</option>
                    {["CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"].map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  STO Type
                  <select
                    value={stoType}
                    onChange={(event) => setStoType(event.target.value)}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">ALL</option>
                    {["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"].map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ),
        }}
        listSection={{
          eyebrow: "STO Register (RM/PM)",
          title: stoLoading ? "Loading stock transfers" : `${stoTotal} stock transfer row${stoTotal === 1 ? "" : "s"}`,
          children: (
            <div className="grid gap-3">
              <ErpPaginationStrip
                page={stoSafePage}
                setPage={setStoPage}
                totalPages={stoTotalPages}
                startIndex={stoStartIndex}
                endIndex={stoEndIndex}
                totalItems={stoTotal}
              />
              <ErpDenseGrid
                columns={[
                  { key: "sto_number", label: "STO Number", width: "140px" },
                  {
                    key: "sto_type",
                    label: "Type",
                    width: "180px",
                    render: (row) => (
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${stoTypeTone(row.sto_type)}`}>
                        {row.sto_type}
                      </span>
                    ),
                  },
                  {
                    key: "sending_company",
                    label: "Sending Company",
                    render: (row) =>
                      companyMap.get(row.sending_company_id)?.company_name ||
                      row.sending_company_id ||
                      "—",
                  },
                  {
                    key: "receiving_company",
                    label: "Receiving Company",
                    render: (row) =>
                      companyMap.get(row.receiving_company_id)?.company_name ||
                      row.receiving_company_id ||
                      "—",
                  },
                  {
                    key: "status",
                    label: "Status",
                    width: "130px",
                    render: (row) => (
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${stoStatusTone(row.status)}`}>
                        {row.status}
                      </span>
                    ),
                  },
                  { key: "dispatch_qty", label: "Total Qty", width: "100px", render: (row) => row.total_qty || row.dispatch_qty || "—" },
                  { key: "created_at", label: "Created", width: "140px" },
                ]}
                rows={stoPageRows}
                rowKey={(row) => row.id}
                onRowActivate={openSTODetail}
                getRowProps={(row) => ({
                  onDoubleClick: () => openSTODetail(row),
                  className: "cursor-pointer hover:bg-sky-50",
                })}
                emptyMessage={stoLoading ? "Loading stock transfers..." : "No RM/PM stock transfer matched the current filter."}
              />
            </div>
          ),
        }}
      />
    );
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="RM/PM Sale"
      actions={[
        { key: "refresh", label: soLoading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setSoReloadTick((tick) => tick + 1) },
        { key: "create", label: "Create SO", tone: "primary", onClick: openCreateSO },
      ]}
      notices={soError ? [{ key: "so-list-error", tone: "error", message: soError }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Sales order register",
        children: (
          <div className="grid gap-3">
            {tabButtons}
            <div className="grid gap-3 xl:grid-cols-[180px_180px_180px_180px_180px_minmax(0,1fr)]">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Company
                <select
                  value={soCompanyId}
                  onChange={(event) => {
                    setSoCompanyId(event.target.value);
                    setSoPage(1);
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
                    setSoPage(1);
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
                  value={soStatus}
                  onChange={(event) => {
                    setSoStatus(event.target.value);
                    setSoPage(1);
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
                  value={soDateFrom}
                  onChange={(event) => {
                    setSoDateFrom(event.target.value);
                    setSoPage(1);
                  }}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Date To
                <input
                  type="date"
                  value={soDateTo}
                  onChange={(event) => {
                    setSoDateTo(event.target.value);
                    setSoPage(1);
                  }}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
              <QuickFilterInput
                label="Search"
                value={soSearch}
                onChange={setSoSearch}
                primaryFocus
                placeholder="SO number, customer PO, customer"
              />
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "SO Register",
        title: soLoading ? "Loading sales orders" : `${soTotal} sales order row${soTotal === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={soPage}
              setPage={setSoPage}
              totalPages={soTotalPages}
              startIndex={soStartIndex}
              endIndex={soEndIndex}
              totalItems={soTotal}
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
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${soStatusTone(row.status)}`}>
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
              rows={soFilteredRows}
              rowKey={(row) => row.id}
              onRowActivate={openSODetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openSODetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={soLoading ? "Loading sales orders..." : "No sales orders matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
