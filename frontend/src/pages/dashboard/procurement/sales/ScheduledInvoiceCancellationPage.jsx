import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { listScheduledDdInvoiceCancellation, postScheduledDdInvoiceCancellation } from "../procurementApi.js";

const MAX_SELECTION = 100;

async function exportRows(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Scheduled DD cancellations");
  sheet.addRow(["DO Number", "DO Date", "Tally Invoice Number", "Tally Invoice Date", "IBN", "Truck Number", "Dispatch Date", "Stock Movement", "Invoice Value", "Status"]);
  for (const row of rows) sheet.addRow([
    row.dc_number || "", row.do_date || "", row.tally_invoice_number || "", row.tally_invoice_date || "",
    row.inbound_number || "", row.truck_number || "", row.dispatch_date || "", row.stock_movement || "",
    Number(row.invoice_value ?? 0), row.status || "",
  ]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  const url = window.URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `so02_scheduled_dd_cancellation_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

export default function ScheduledInvoiceCancellationPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState(() => getActiveScreenContext()?.companyId || "");
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const query = useQuery({
    queryKey: ["so02-scheduled-dd-invoice-cancellation", effectiveCompanyId],
    queryFn: () => listScheduledDdInvoiceCancellation(effectiveCompanyId),
    enabled: Boolean(effectiveCompanyId),
  });
  const rows = useMemo(() => Array.isArray(query.data?.items) ? query.data.items : [], [query.data]);
  const cutoffDate = query.data?.cutoff_date || "the current quarter start";
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [row.dc_number, row.tally_invoice_number, row.tally_invoice_date, row.inbound_number, row.truck_number, row.dispatch_date, row.status]
      .some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [rows, search]);
  const selectableIds = [...new Set(visibleRows.map((row) => row.id).filter(Boolean))].slice(0, MAX_SELECTION);
  const formattedValue = (value) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  async function cancelSelected() {
    if (!selected.size || !effectiveCompanyId) return;
    if (!reason.trim()) { setNotice("Enter a cancellation reason before posting cancellation."); return; }
    const confirmed = await openActionConfirm({
      eyebrow: "Scheduled Invoice Cancellation",
      title: `Cancel invoice and DO for ${selected.size} selected DD invoice-only record${selected.size === 1 ? "" : "s"}?`,
      confirmLabel: "Post Cancellation",
      tone: "danger",
    });
    if (!confirmed) return;
    setPosting(true); setNotice("");
    try {
      const result = await postScheduledDdInvoiceCancellation(effectiveCompanyId, [...selected], reason.trim());
      const cancelled = Number(result?.result?.cancelled_count ?? selected.size);
      setNotice(`${cancelled} selected DD invoice-only record${cancelled === 1 ? "" : "s"} cancelled. Their invoices and delivery orders are cancelled; no stock movement was posted.`);
      setSelected(new Set()); setReason("");
      await query.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "SCHEDULED_DD_CANCEL_FAILED");
    } finally {
      setPosting(false);
    }
  }

  return <ErpMasterListTemplate
    eyebrow="Procurement / SO02"
    title="Scheduled Invoice Cancellation"
    actions={[
      { key: "back", label: "Back to SO02", tone: "neutral", onClick: () => popScreen() },
      { key: "refresh", label: "Refresh", tone: "neutral", onClick: () => query.refetch(), disabled: query.isFetching },
      { key: "export", label: "Export Excel", tone: "neutral", onClick: () => void exportRows(visibleRows), disabled: visibleRows.length === 0 },
      { key: "post", label: posting ? "Cancelling..." : `Post Cancellation (${selected.size})`, tone: "danger", onClick: () => void cancelSelected(), disabled: posting || selected.size === 0 || !reason.trim() },
    ]}
    notices={notice ? [{ key: "scheduled-dd-cancellation-notice", tone: /failed|required|not eligible|no longer/i.test(notice) ? "warning" : "success", message: notice }] : []}
    filterSection={{
      eyebrow: "Quarter-close review",
      title: "DD Direct · Invoice only · Stock movement No · Tally Invoice Date in a completed quarter",
      children: <div className="grid gap-3 md:grid-cols-2">
        <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={(value) => { setCompanyId(value); setSelected(new Set()); setNotice(""); }} label="Company" />
        <QuickFilterInput label="Search" value={search} onChange={setSearch} placeholder="DO, Tally Invoice, IBN, truck or dispatch date..." />
      </div>,
    }}
    listSection={{
      eyebrow: "Cancellation queue",
      title: `${rows.length} eligible delivery order${rows.length === 1 ? "" : "s"}${visibleRows.length !== rows.length ? ` · ${visibleRows.length} shown` : ""}`,
      children: <div className="grid gap-3">
        <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-slate-700">
          Cross-check: each row has a DD Direct invoice in DRAFT, no VDC stock document, and Tally Invoice Date before <strong>{cutoffDate}</strong>. From the 11th of Jan/Apr/Jul/Oct, any remaining row is automatically cancelled overnight.
        </div>
        <div className="grid gap-2 border border-sky-300 bg-sky-50 p-3 text-xs">
          <label className="grid gap-1 font-semibold text-slate-800">Cancellation reason (required)
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} placeholder="Why are these quarter-close invoice-only records being cancelled?" className="border border-slate-300 bg-white p-2 font-normal text-slate-900" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700">{selected.size} selected (maximum {MAX_SELECTION})</span>
            <button type="button" onClick={() => setSelected(new Set(selectableIds))} disabled={!selectableIds.length} className="border border-sky-700 bg-white px-2 py-0.5 font-semibold text-sky-950 disabled:opacity-50">
              {visibleRows.length > MAX_SELECTION ? `Select first ${MAX_SELECTION} displayed` : `Select all displayed (${visibleRows.length})`}
            </button>
            <button type="button" onClick={() => setSelected(new Set())} disabled={!selected.size} className="border border-slate-400 bg-white px-2 py-0.5 font-semibold text-slate-700 disabled:opacity-50">Clear selection</button>
          </div>
        </div>
        <ErpDenseGrid
          cellNavigate
          columnFilter
          stickyFirstColumn
          rows={visibleRows}
          rowKey={(row) => row.id}
          emptyMessage={query.isLoading ? "Loading scheduled cancellation queue..." : "No DD invoice-only record has crossed a Tally Invoice Date quarter boundary."}
          columns={[
            { key: "dc_number", label: <label className="flex items-center gap-2 normal-case tracking-normal"><input aria-label="Select displayed delivery orders" type="checkbox" checked={selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))} onChange={(event) => setSelected(event.target.checked ? new Set(selectableIds) : new Set())} /><span>DO Number</span></label>, width: "175px", render: (row) => <label className="flex items-center gap-2 font-medium text-slate-900"><input aria-label={`Select ${row.dc_number}`} type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /><span>{row.dc_number || "—"}</span></label> },
            { key: "do_date", label: "DO Date", width: "110px", render: (row) => row.do_date || "—" },
            { key: "tally_invoice_number", label: "Tally Invoice Number", width: "190px", render: (row) => row.tally_invoice_number || "—" },
            { key: "tally_invoice_date", label: "Tally Invoice Date", width: "150px", render: (row) => row.tally_invoice_date || "—" },
            { key: "inbound_number", label: "IBN", width: "140px", render: (row) => row.inbound_number || "—" },
            { key: "truck_number", label: "Truck Number", width: "140px", render: (row) => row.truck_number || "—" },
            { key: "dispatch_date", label: "Dispatch Date", width: "135px", render: (row) => row.dispatch_date || "—" },
            { key: "stock_movement", label: "Stock Movement", width: "130px", render: (row) => <span className="font-semibold text-amber-800">{row.stock_movement}</span> },
            { key: "invoice_value", label: "Invoice Value", width: "140px", align: "right", render: (row) => formattedValue(row.invoice_value) },
            { key: "status", label: "Review status", width: "250px", render: (row) => <span className="font-semibold text-amber-800">{row.status}</span> },
          ]}
        />
      </div>,
    }}
  />;
}
