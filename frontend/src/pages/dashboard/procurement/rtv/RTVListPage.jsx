import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { MASTER_PICKER_FETCH_LIMIT, useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getGRN, listRTVs } from "../procurementApi.js";

const LIMIT = 50;

function settlementTone(mode) {
  switch (String(mode || "").toUpperCase()) {
    case "DEBIT_NOTE":
      return "bg-sky-100 text-sky-800";
    case "EXCHANGE":
      return "bg-violet-100 text-violet-800";
    case "NEXT_INVOICE_ADJUST":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED":
      return "bg-sky-100 text-sky-800";
    case "SETTLED":
      return "bg-emerald-100 text-emerald-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "CREATED":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export default function RTVListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [settlementMode, setSettlementMode] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const vendorQuery = useVendorOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const rtvParams = useMemo(
    () => ({
      company_id: effectiveCompanyId || undefined,
      status: status || undefined,
      settlement_mode: settlementMode || undefined,
      vendor_id: vendorId || undefined,
      limit: 200,
    }),
    [effectiveCompanyId, settlementMode, status, vendorId]
  );
  const rtvQuery = useQuery({
    queryKey: ["procurement", "rtvs", rtvParams],
    queryFn: async () => {
      const rtvData = await listRTVs(rtvParams);
      const items = Array.isArray(rtvData?.items) ? rtvData.items : [];
      const uniqueGrnIds = Array.from(new Set(items.map((row) => row.grn_id).filter(Boolean)));
      const grnEntries = await Promise.all(
        uniqueGrnIds.map(async (grnId) => {
          try {
            const detail = await getGRN(grnId);
            return [grnId, detail];
          } catch {
            return [grnId, null];
          }
        })
      );
      return {
        items,
        grnMapEntries: grnEntries,
      };
    },
  });
  const rows = useMemo(
    () => (Array.isArray(rtvQuery.data?.items) ? rtvQuery.data.items : []),
    [rtvQuery.data],
  );
  const vendors = vendorQuery.vendors;
  const grnMap = useMemo(() => new Map(rtvQuery.data?.grnMapEntries ?? []), [rtvQuery.data?.grnMapEntries]);
  const loading = rtvQuery.isLoading || vendorQuery.isLoading;
  const error =
    rtvQuery.error?.message ||
    vendorQuery.error?.message ||
    "";

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => {
        void rtvQuery.refetch();
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
      const grn = grnMap.get(row.grn_id);
      const haystack = [
        row.rtv_number,
        vendor?.vendor_name,
        vendor?.vendor_code,
        grn?.grn_number,
        row.reason_category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [grnMap, rows, search, vendorMap]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * LIMIT, safePage * LIMIT);
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_RTV_CREATE.screen_code);
    navigate("/dashboard/procurement/rtvs/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_RTV_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/rtvs/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Return To Vendor"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => {
            void rtvQuery.refetch();
            void vendorQuery.refetch();
          },
        },
        {
          key: "debit-notes",
          label: "Debit Notes",
          tone: "neutral",
          onClick: () => {
            openScreen(OPERATION_SCREENS.PROC_DEBIT_NOTE_LIST.screen_code);
            navigate("/dashboard/procurement/debit-notes");
          },
        },
        {
          key: "exchange-refs",
          label: "Exchange Refs",
          tone: "neutral",
          onClick: () => {
            openScreen(OPERATION_SCREENS.PROC_EXCHANGE_REF_LIST.screen_code);
            navigate("/dashboard/procurement/exchange-refs");
          },
        },
        {
          key: "create",
          label: "Create RTV",
          tone: "primary",
          onClick: openCreate,
        },
      ]}
      notices={error ? [{ key: "rtv-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Vendor return register",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1.2fr)_170px_220px_220px]">
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
              placeholder="Search RTV number, vendor or GRN"
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
                {["CREATED", "DISPATCHED", "SETTLED", "CANCELLED"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Settlement Mode
              <select
                value={settlementMode}
                onChange={(event) => {
                  setSettlementMode(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["DEBIT_NOTE", "NEXT_INVOICE_ADJUST", "EXCHANGE"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
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
          </div>
        ),
      }}
      listSection={{
        eyebrow: "RTV Register",
        title: loading ? "Loading RTVs" : `${total} RTV row${total === 1 ? "" : "s"}`,
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
                { key: "rtv_number", label: "RTV Number", width: "140px" },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                {
                  key: "grn_number",
                  label: "GRN Number",
                  width: "140px",
                  render: (row) => grnMap.get(row.grn_id)?.grn_number || row.grn_id || "—",
                },
                { key: "reason_category", label: "Reason", width: "160px" },
                {
                  key: "settlement_mode",
                  label: "Settlement",
                  width: "150px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${settlementTone(row.settlement_mode)}`}>
                      {row.settlement_mode}
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.status)}`}>
                      {row.status}
                    </span>
                  ),
                },
                { key: "created_at", label: "Created", width: "140px" },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading RTV register..." : effectiveCompanyId ? "No RTV matched the current filter." : "No company resolved for this session."}
            />
          </div>
        ),
      }}
    />
  );
}
