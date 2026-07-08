import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listGRNs } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "POSTED": return "bg-emerald-100 text-emerald-800";
    case "REVERSED": return "bg-rose-100 text-rose-800";
    case "DRAFT": default: return "bg-sky-100 text-sky-800";
  }
}

export default function GRNListPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((entry) => ({
        value: entry.id,
        label: entry.company_name || entry.company_code || entry.id,
      })),
    [runtimeContext?.availableCompanies]
  );

  useEffect(() => {
    if (!companyId) {
      setCompanyId(runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "");
    }
  }, [companyId, companyOptions, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const offset = (page - 1) * LIMIT;
  const grnParams = useMemo(
    () => ({
      company_id: companyId,
      status: status || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: debouncedSearch || undefined,
      limit: LIMIT,
      offset,
    }),
    [companyId, dateFrom, dateTo, status, debouncedSearch, offset]
  );

  const grnQuery = useQuery({
    queryKey: ["procurement", "grns", grnParams],
    enabled: Boolean(companyId),
    queryFn: () => listGRNs(grnParams),
  });

  const rows = Array.isArray(grnQuery.data?.items) ? grnQuery.data.items : [];
  const total = grnQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : offset + 1;
  const endIndex = total === 0 ? 0 : Math.min(offset + LIMIT, total);
  const loading = grnQuery.isLoading;
  const error = grnQuery.error?.message ?? "";

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_GRN_DETAIL.screen_code, { context: { id: row.id } });
  }

  function openPostFlow() {
    openScreen(OPERATION_SCREENS.PROC_GRN_POST_FLOW.screen_code, {});
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Goods Receipts"
      actions={[
        {
          key: "post-grn",
          label: "Post GRN (F6)",
          tone: "primary",
          onClick: openPostFlow,
        },
        {
          key: "refresh",
          label: loading ? "Refreshing…" : "Refresh",
          tone: "neutral",
          onClick: () => queryClient.invalidateQueries({ queryKey: ["procurement", "grns"] }),
        },
      ]}
      notices={error ? [{ key: "grn-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search and filter",
        title: "GRN register lookup",
        children: (
          <div className="grid gap-3 lg:grid-cols-[220px_180px_180px_180px_minmax(0,1fr)]">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Company
              <select
                value={companyId}
                onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select company</option>
                {companyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["DRAFT", "POSTED", "REVERSED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date from
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Date to
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <QuickFilterInput label="Search" value={search} onChange={setSearch} placeholder="GRN number, GE, vendor, material…" />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "GRN Register",
        title: loading ? "Loading goods receipts…" : `${total} GRN${total === 1 ? "" : "s"}`,
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
                { key: "grn_number", label: "GRN Number", width: "120px" },
                { key: "material_code", label: "Material Code", width: "130px", render: (row) => row.material_code || "—" },
                { key: "material_name", label: "Material Name", render: (row) => row.material_name || "—" },
                {
                  key: "vendor",
                  label: "Vendor",
                  width: "180px",
                  render: (row) =>
                    row.vendor_name
                      ? `${row.vendor_code || ""} — ${row.vendor_name}`.replace(/^( — )/, "")
                      : "—",
                },
                {
                  key: "received_qty",
                  label: "Received Qty",
                  width: "110px",
                  render: (row) =>
                    row.received_qty != null
                      ? `${Number(row.received_qty).toFixed(3)} ${row.uom_code || ""}`.trim()
                      : "—",
                },
                { key: "invoice_number", label: "Invoice No.", width: "120px", render: (row) => row.invoice_number || "—" },
                { key: "grn_date", label: "GRN Date", width: "100px" },
                { key: "invoice_date", label: "Invoice Date", width: "100px", render: (row) => row.invoice_date || "—" },
                {
                  key: "transporter",
                  label: "Transporter",
                  width: "160px",
                  render: (row) =>
                    row.transporter_name
                      ? `${row.transporter_code || ""} — ${row.transporter_name}`.replace(/^( — )/, "")
                      : "—",
                },
                { key: "lr_number", label: "LR Number", width: "110px", render: (row) => row.lr_number || "—" },
                { key: "lr_date", label: "LR Date", width: "100px", render: (row) => row.lr_date || "—" },
                {
                  key: "status",
                  label: "Status",
                  width: "90px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(row.status)}`}>
                      {row.status}
                    </span>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={() => ({ className: "cursor-pointer hover:bg-sky-50" })}
              emptyMessage={loading ? "Loading…" : "No GRNs matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
