import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getGRN, listLandedCosts } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "POSTED":
      return "bg-emerald-100 text-emerald-800";
    case "DRAFT":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function LandedCostListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const landedCostParams = useMemo(
    () => ({
      company_id: effectiveCompanyId || undefined,
      status: status || undefined,
      limit: 200,
    }),
    [effectiveCompanyId, status]
  );
  const landedCostQuery = useQuery({
    queryKey: ["procurement", "landed-costs", landedCostParams],
    queryFn: async () => {
      const lcData = await listLandedCosts(landedCostParams);
      const items = Array.isArray(lcData?.items) ? lcData.items : [];
      const uniqueGrnIds = Array.from(new Set(items.map((row) => row.grn_id).filter(Boolean)));
      const grnEntries = await Promise.all(
        uniqueGrnIds.map(async (grnId) => {
          try {
            return [grnId, await getGRN(grnId)];
          } catch {
            return [grnId, null];
          }
        })
      );
      return { items, grnEntries };
    },
  });

  const vendors = vendorQuery.vendors;
  const loading = landedCostQuery.isLoading || vendorQuery.isLoading;
  const error = landedCostQuery.error?.message || vendorQuery.error?.message || "";

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => {
        void landedCostQuery.refetch();
        void vendorQuery.refetch();
      },
    },
  });

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const grnMap = useMemo(
    () => new Map(landedCostQuery.data?.grnEntries ?? []),
    [landedCostQuery.data?.grnEntries]
  );
  const rows = useMemo(
    () =>
      (landedCostQuery.data?.items ?? []).filter((row) => {
        if (dateFrom && String(row.lc_date || "") < dateFrom) return false;
        if (dateTo && String(row.lc_date || "") > dateTo) return false;
        return true;
      }),
    [dateFrom, dateTo, landedCostQuery.data?.items]
  );
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * LIMIT, safePage * LIMIT);
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_LC_DETAIL.screen_code);
    navigate("/dashboard/procurement/accounts/landed-costs/new");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_LC_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/accounts/landed-costs/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement Accounts"
      title="Landed Costs"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => {
            void landedCostQuery.refetch();
            void vendorQuery.refetch();
          },
        },
        {
          key: "create",
          label: "Create Landed Cost",
          tone: "primary",
          onClick: openCreate,
        },
      ]}
      notices={error ? [{ key: "lc-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Landed cost register",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_180px_180px_180px]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(nextValue) => {
                setCompanyId(nextValue);
                setPage(1);
              }}
              label="Company"
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
                {["DRAFT", "POSTED"].map((entry) => (
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
        eyebrow: "Landed Cost Register",
        title: loading ? "Loading landed costs" : `${total} landed cost row${total === 1 ? "" : "s"}`,
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
                { key: "lc_number", label: "LC Number", width: "140px" },
                { key: "lc_date", label: "LC Date", width: "120px" },
                {
                  key: "grn_number",
                  label: "GRN Number",
                  width: "140px",
                  render: (row) => grnMap.get(row.grn_id)?.grn_number || row.grn_id || "—",
                },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                { key: "total_cost", label: "Total Cost", width: "120px", render: (row) => row.total_cost ?? "—" },
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
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading landed costs..." : effectiveCompanyId ? "No landed cost matched the current filter." : "No company resolved for this session."}
            />
          </div>
        ),
      }}
    />
  );
}
