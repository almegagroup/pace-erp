/*
 * File-Path: frontend/src/pages/dashboard/procurement/sto/STOListPage.jsx
 * Domain: PROCUREMENT
 * Purpose: §113 Task D — STO list bug-audit fix. Was useEffect+setState
 *          (R-02), raw-UUID company fallback (R-01), and a fetch-200-then-
 *          filter-client-side pattern that silently truncated any company
 *          with more STOs than that (search/pagination only worked within
 *          the fetched window). Now server-side search+pagination+direction
 *          filter, backend bulk-resolved company display names.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listSTOs } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED": return "bg-sky-100 text-sky-800";
    case "RECEIVED": return "bg-emerald-100 text-emerald-800";
    case "CLOSED": return "bg-slate-200 text-slate-800";
    case "CANCELLED": return "bg-rose-100 text-rose-800";
    case "CREATED":
    default: return "bg-amber-100 text-amber-800";
  }
}

function typeTone(stoType) {
  switch (String(stoType || "").toUpperCase()) {
    case "INTER_PLANT": return "bg-violet-100 text-violet-800";
    case "CONSIGNMENT_DISTRIBUTION":
    default: return "bg-sky-100 text-sky-800";
  }
}

export default function STOListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";

  const [viewMode, setViewMode] = useState("OUTBOUND");
  const [status, setStatus] = useState("");
  const [stoType, setStoType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const params = useMemo(
    () => ({
      company_id: selectedCompanyId || undefined,
      direction: viewMode,
      status: status || undefined,
      sto_type: stoType || undefined,
      search: search || undefined,
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    }),
    [selectedCompanyId, viewMode, status, stoType, search, page]
  );

  const stoQuery = useQuery({
    queryKey: ["procurement", "stos", params],
    queryFn: () => listSTOs(params),
  });

  const rows = Array.isArray(stoQuery.data?.items) ? stoQuery.data.items : [];
  const total = Number(stoQuery.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);
  const loading = stoQuery.isLoading;

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_STO_CREATE.screen_code);
    navigate("/dashboard/procurement/stos/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_STO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/stos/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Stock Transfers"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => stoQuery.refetch() },
        { key: "create", label: "New STO", tone: "primary", onClick: openCreate },
      ]}
      notices={stoQuery.error ? [{ key: "sto-list-error", tone: "error", message: stoQuery.error instanceof Error ? stoQuery.error.message : "PROCUREMENT_STO_LIST_FAILED" }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Outbound and inbound company transfers",
        children: (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {[{ key: "OUTBOUND", label: "MY OUTBOUND" }, { key: "INBOUND", label: "MY INBOUND" }].map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => { setViewMode(entry.key); setPage(1); }}
                  className={`border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${viewMode === entry.key ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_220px]">
              <QuickFilterInput
                label="Search"
                value={search}
                onChange={(value) => { setSearch(value); setPage(1); }}
                primaryFocus
                placeholder="Search STO number"
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Status
                <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                  <option value="">ALL</option>
                  {["CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                STO Type
                <select value={stoType} onChange={(event) => { setStoType(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                  <option value="">ALL</option>
                  {["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "STO Register",
        title: loading ? "Loading stock transfers" : `${total} stock transfer row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={total} />
            <ErpDenseGrid
              columns={[
                { key: "sto_number", label: "STO Number", width: "140px" },
                {
                  key: "sto_type",
                  label: "Type",
                  width: "180px",
                  render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${typeTone(row.sto_type)}`}>{row.sto_type}</span>,
                },
                { key: "sending_company", label: "Sending Company", render: (row) => row.sending_company_display || "—" },
                { key: "receiving_company", label: "Receiving Company", render: (row) => row.receiving_company_display || "—" },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.status)}`}>{row.status}</span>,
                },
                { key: "dispatch_qty", label: "Total Qty", width: "100px", render: (row) => row.total_qty || row.dispatch_qty || "—" },
                { key: "created_at", label: "Created", width: "140px" },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({ onDoubleClick: () => openDetail(row), className: "cursor-pointer hover:bg-sky-50" })}
              emptyMessage={loading ? "Loading stock transfers..." : "No stock transfer matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
