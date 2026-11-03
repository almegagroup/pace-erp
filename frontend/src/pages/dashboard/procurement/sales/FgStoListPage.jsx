/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/FgStoListPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: FG STO register for Stores / Accounts / Logistics. FG STO is created through the
 *          SO01/SO02 ACL group (PROC_SO_CREATE / PROC_SO_LIST), so those users have no access
 *          to the procurement STO pages (PROC_STO_LIST). This is the SO-side list of INTER_PLANT
 *          STOs whose every line is an FG material.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listFgStos } from "../procurementApi.js";

const LIMIT = 50;

function fgStoStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED": return "bg-sky-100 text-sky-800";
    case "RECEIVED": return "bg-emerald-100 text-emerald-800";
    case "CLOSED": return "bg-slate-200 text-slate-800";
    case "CANCELLED": return "bg-rose-100 text-rose-800";
    default: return "bg-amber-100 text-amber-800";
  }
}

export default function FgStoListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [viewMode, setViewMode] = useState("OUTBOUND");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const params = useMemo(
    () => ({
      company_id: effectiveCompanyId || undefined,
      direction: viewMode,
      status: status || undefined,
      search: search || undefined,
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    }),
    [effectiveCompanyId, viewMode, status, search, page],
  );

  const fgStoQuery = useQuery({
    queryKey: ["procurement", "fg-stos", params],
    queryFn: () => listFgStos(params),
    enabled: Boolean(effectiveCompanyId),
    placeholderData: keepPreviousData,
  });

  const rows = Array.isArray(fgStoQuery.data?.items) ? fgStoQuery.data.items : [];
  const total = Number(fgStoQuery.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);
  const loading = fgStoQuery.isLoading;

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_SO_CREATE.screen_code);
    navigate("/dashboard/procurement/sales-orders/fg-sto-create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_FG_STO_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/sales-orders/fg-sto/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement / Sales"
      title="FG STO Register"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => fgStoQuery.refetch() },
        { key: "create", label: "Create FG STO", tone: "primary", onClick: openCreate },
      ]}
      notices={fgStoQuery.error ? [{ key: "fg-sto-list-error", tone: "error", message: fgStoQuery.error instanceof Error ? fgStoQuery.error.message : "FG_STO_LIST_FAILED" }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Finished-goods stock transfers between companies",
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
            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1.2fr)_180px]">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={(nextValue) => { setCompanyId(nextValue); setPage(1); }}
                label="Company"
              />
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
                  {["DRAFT", "CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "FG STO Register",
        title: loading ? "Loading FG STOs" : `${total} FG STO${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip page={page} setPage={setPage} totalPages={totalPages} startIndex={startIndex} endIndex={endIndex} totalItems={total} />
            <ErpDenseGrid
              columns={[
                { key: "sto_number", label: "STO Number", width: "140px" },
                { key: "sto_date", label: "STO Date", width: "110px" },
                { key: "sending_company", label: "Sending Company", render: (row) => row.sending_company_display || "—" },
                { key: "receiving_company", label: "Receiving Company", render: (row) => row.receiving_company_display || "—" },
                { key: "materials_display", label: "SKU", render: (row) => row.materials_display || "—" },
                { key: "line_count", label: "Lines", width: "70px", align: "right" },
                { key: "total_quantity", label: "Total Qty", width: "110px", align: "right", render: (row) => `${row.total_quantity ?? 0} ${row.uom_code || ""}`.trim() },
                {
                  key: "status",
                  label: "Status",
                  width: "120px",
                  render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${fgStoStatusTone(row.status)}`}>{row.status}</span>,
                },
                { key: "created_at", label: "Created", width: "150px" },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({ onDoubleClick: () => openDetail(row), className: "cursor-pointer hover:bg-sky-50" })}
              emptyMessage={loading ? "Loading FG STOs..." : effectiveCompanyId ? "No FG STO matched the current filter." : "No company resolved for this session."}
            />
          </div>
        ),
      }}
    />
  );
}
