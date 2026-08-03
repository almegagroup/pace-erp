import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listGateEntries } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "GRN_POSTED":
    case "CLOSED":
      return "bg-emerald-100 text-emerald-800";
    case "OPEN":
      return "bg-sky-100 text-sky-800";
    case "CANCELLED":
    case "PRUNED":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function GateEntryListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const offset = (page - 1) * LIMIT;

  const { data: listResult, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["procurement", "ge-list", effectiveCompanyId, status, dateFrom, dateTo, page],
    enabled: Boolean(effectiveCompanyId),
    queryFn: () => listGateEntries({
      company_id: effectiveCompanyId,
      status: status || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: LIMIT,
      offset,
    }),
  });

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void queryClient.invalidateQueries({ queryKey: ["procurement", "ge-list"] }),
    },
  });

  const serverTotal = listResult?.total ?? 0;
  const error = queryError instanceof Error ? queryError.message : (queryError ? "GE_LIST_FAILED" : "");

  const rows = useMemo(() => {
    const sourceRows = Array.isArray(listResult?.items) ? listResult.items : [];
    if (!debouncedSearch) return sourceRows;
    return sourceRows.filter((row) =>
      [row.ge_number, row.vehicle_number, row.driver_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(debouncedSearch)
    );
  }, [debouncedSearch, listResult]);

  const total = debouncedSearch ? rows.length : serverTotal;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : offset + 1;
  const endIndex = total === 0 ? 0 : Math.min(offset + rows.length, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_CREATE.screen_code);
    navigate("/dashboard/procurement/gate-entries/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/gate-entries/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Gate Entries"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => queryClient.invalidateQueries({ queryKey: ["procurement", "ge-list"] }) },
        { key: "create", label: "Create GE", tone: "primary", onClick: openCreate },
      ]}
      notices={error ? [{ key: "ge-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Inbound gate entry lookup",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_180px_180px_180px_minmax(0,1fr)]">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => { setCompanyId(value); setPage(1); }}
              label="Company"
              hint=""
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["OPEN", "GRN_POSTED", "CANCELLED", "PRUNED"].map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
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
            <QuickFilterInput label="Search" value={search} onChange={setSearch} placeholder="GE number or vehicle" />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "GE Register",
        title: loading ? "Loading gate entries..." : `${total} gate entr${total === 1 ? "y" : "ies"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={total} />
            {!effectiveCompanyId ? (
              <p className="text-slate-400 text-sm py-6 text-center">Select a company to view gate entries.</p>
            ) : (
              <ErpDenseGrid
                columns={[
                  { key: "ge_number", label: "GE Number", width: "130px" },
                  { key: "ge_date", label: "Entry Date", width: "110px" },
                  { key: "vehicle_number", label: "Vehicle", width: "130px" },
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
                  { key: "num_lines", label: "Lines", width: "90px" },
                  { key: "total_qty", label: "Total Qty", width: "110px" },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                onRowActivate={openDetail}
                getRowProps={(row) => ({
                  onClick: () => openDetail(row),
                  className: "cursor-pointer hover:bg-sky-50",
                })}
                emptyMessage={loading ? "Loading gate entries..." : "No gate entry matched the current filter."}
              />
            )}
          </div>
        ),
      }}
    />
  );
}
