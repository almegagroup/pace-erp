/*
 * File-ID: 21.1
 * File-Path: frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx
 * Gate: 21
 * Phase: 21
 * Domain: PROCUREMENT
 * Purpose: List debit notes raised from RTV settlements
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listDebitNotes } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "SENT":
      return "bg-sky-100 text-sky-800";
    case "ACKNOWLEDGED":
      return "bg-violet-100 text-violet-800";
    case "SETTLED":
      return "bg-emerald-100 text-emerald-800";
    case "DRAFT":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.0000";
  }
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default function DebitNoteListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [page, setPage] = useState(1);
  const companyId = runtimeContext?.selectedCompanyId || "";
  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const debitNoteParams = useMemo(
    () => ({
      company_id: companyId || undefined,
      vendor_id: vendorId || undefined,
      status: status || undefined,
      limit: 200,
    }),
    [companyId, status, vendorId]
  );
  const debitNoteQuery = useQuery({
    queryKey: ["procurement", "debit-notes", debitNoteParams],
    queryFn: () => listDebitNotes(debitNoteParams),
  });

  useEffect(() => {
    setPage(1);
  }, [search, status, vendorId]);

  const rows = Array.isArray(debitNoteQuery.data?.items) ? debitNoteQuery.data.items : [];
  const vendors = vendorQuery.vendors;
  const loading = debitNoteQuery.isLoading || vendorQuery.isLoading;
  const error =
    debitNoteQuery.error?.message ||
    vendorQuery.error?.message ||
    "";
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
        row.dn_number,
        row.rtv_id,
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
  const pageRows = filteredRows.slice(
    (safePage - 1) * LIMIT,
    safePage * LIMIT
  );
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_DEBIT_NOTE_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/debit-notes/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Debit Notes"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => {
            void debitNoteQuery.refetch();
            void vendorQuery.refetch();
          },
        },
      ]}
      notices={
        error
          ? [{ key: "dn-list-error", tone: "error", message: error }]
          : []
      }
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Debit note register",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_220px_220px]">
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search DN number, vendor or RTV"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["DRAFT", "SENT", "ACKNOWLEDGED", "SETTLED"].map((entry) => (
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
                onChange={(event) => setVendorId(event.target.value)}
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
        eyebrow: "Debit Note Register",
        title: loading
          ? "Loading debit notes"
          : `${total} debit note row${total === 1 ? "" : "s"}`,
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
                { key: "dn_number", label: "DN Number", width: "150px" },
                { key: "dn_date", label: "Date", width: "120px" },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                { key: "rtv_id", label: "RTV", width: "170px" },
                {
                  key: "total_value",
                  label: "Total Value",
                  width: "140px",
                  align: "right",
                  render: (row) => formatNumber(row.total_value),
                },
                {
                  key: "status",
                  label: "Status",
                  width: "150px",
                  render: (row) => (
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone(
                        row.status
                      )}`}
                    >
                      {row.status || "—"}
                    </span>
                  ),
                },
                { key: "created_at", label: "Created", width: "180px" },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowClick={openDetail}
              emptyMessage={loading ? "Loading debit notes..." : "No debit notes found."}
            />
          </div>
        ),
      }}
    />
  );
}
