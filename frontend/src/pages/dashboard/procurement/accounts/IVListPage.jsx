import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listBlockedIVs, listIVs } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "MATCHED":
      return "bg-emerald-100 text-emerald-800";
    case "BLOCKED":
      return "bg-rose-100 text-rose-800";
    case "POSTED":
      return "bg-sky-100 text-sky-800";
    case "DRAFT":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export default function IVListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const invoiceQueryParams = useMemo(
    () => ({
      company_id: effectiveCompanyId || undefined,
      status: status || undefined,
      vendor_id: vendorId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: 200,
    }),
    [effectiveCompanyId, dateFrom, dateTo, status, vendorId]
  );
  const ivQuery = useQuery({
    queryKey: ["procurement", "ivs", invoiceQueryParams],
    queryFn: async () => {
      const [ivData, blockedData] = await Promise.all([
        listIVs(invoiceQueryParams),
        listBlockedIVs({
          company_id: effectiveCompanyId || undefined,
          limit: 200,
        }),
      ]);
      return {
        rows: Array.isArray(ivData?.items) ? ivData.items : [],
        blockedRows: Array.isArray(blockedData?.items) ? blockedData.items : [],
      };
    },
  });

  const rows = useMemo(
    () => (Array.isArray(ivQuery.data?.rows) ? ivQuery.data.rows : []),
    [ivQuery.data],
  );
  const blockedRows = Array.isArray(ivQuery.data?.blockedRows) ? ivQuery.data.blockedRows : [];
  const vendors = vendorQuery.vendors;
  const loading = ivQuery.isLoading || vendorQuery.isLoading;
  const error =
    ivQuery.error?.message ||
    vendorQuery.error?.message ||
    "";

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => {
        void ivQuery.refetch();
        void vendorQuery.refetch();
      },
    },
  });

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const filteredRows = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) {
      return rows;
    }
    return rows.filter((row) => {
      const vendor = vendorMap.get(row.vendor_id);
      const haystack = [
        row.iv_number,
        row.vendor_invoice_number,
        vendor?.vendor_name,
        vendor?.vendor_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search, vendorMap]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * LIMIT, safePage * LIMIT);
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_IV_CREATE.screen_code);
    navigate("/dashboard/procurement/accounts/invoice-verifications/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_IV_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/accounts/invoice-verifications/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement Accounts"
      title="Invoice Verification"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => {
            void ivQuery.refetch();
            void vendorQuery.refetch();
          },
        },
        ...(blockedRows.length > 0
          ? [
              {
                key: "view-blocked",
                label: `View ${blockedRows.length} Blocked IV${blockedRows.length === 1 ? "" : "s"}`,
                tone: "warning",
                onClick: () => {
                  openScreen(OPERATION_SCREENS.PROC_BLOCKED_IV_LIST.screen_code);
                  navigate("/dashboard/procurement/accounts/blocked-ivs");
                },
              },
            ]
          : []),
        {
          key: "create",
          label: "Create IV",
          tone: "primary",
          onClick: openCreate,
        },
      ]}
      notices={[
        ...(error ? [{ key: "iv-list-error", tone: "error", message: error }] : []),
        ...(blockedRows.length > 0
          ? [{
              key: "iv-blocked-warning",
              tone: "warning",
              message: `${blockedRows.length} blocked invoice verification row${blockedRows.length === 1 ? "" : "s"} need attention.`,
            }]
          : []),
      ]}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Invoice verification register",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1.1fr)_200px_180px_180px_180px]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(nextValue) => {
                setCompanyId(nextValue);
                setPage(1);
              }}
              label="Company"
            />
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              primaryFocus
              placeholder="Search IV number, vendor or invoice"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Vendor
              <select
                value={vendorId}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {vendors.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.vendor_code || entry.id} | {entry.vendor_name || ""}
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
                {["DRAFT", "MATCHED", "BLOCKED", "POSTED"].map((entry) => (
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
        eyebrow: "IV Register",
        title: loading ? "Loading invoice verifications" : `${total} invoice verification row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "iv_number", label: "IV Number", width: "140px" },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                { key: "vendor_invoice_number", label: "Vendor Invoice", width: "160px" },
                { key: "vendor_invoice_date", label: "Invoice Date", width: "120px" },
                { key: "total_invoice_value", label: "Total Value", width: "120px", render: (row) => row.total_invoice_value ?? "—" },
                {
                  key: "status",
                  label: "Status",
                  width: "120px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.status)}`}>
                      {row.status}
                    </span>
                  ),
                },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className:
                  String(row.status || "").toUpperCase() === "BLOCKED"
                    ? "cursor-pointer bg-rose-50 hover:bg-rose-100"
                    : "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading invoice verifications..." : effectiveCompanyId ? "No invoice verification matched the current filter." : "No company resolved for this session."}
            />
          </div>
        ),
      }}
    />
  );
}
