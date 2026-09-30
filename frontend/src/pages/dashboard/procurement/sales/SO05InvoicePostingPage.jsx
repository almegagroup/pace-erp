import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { pushToast } from "../../../../store/uiToast.js";
import { listPendingSalesReturnInvoices, saveSalesReturnInvoiceDetail } from "../procurementApi.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";

const input = "border border-slate-300 rounded px-2 py-1.5 text-sm w-full";
const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);
export default function SO05InvoicePostingPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => { if (!companyId && effectiveCompanyId) setCompanyId(effectiveCompanyId); }, [companyId, effectiveCompanyId]);
  const query = useQuery({ queryKey: ["so05-pending-invoices", effectiveCompanyId, showAll], queryFn: () => listPendingSalesReturnInvoices({ company_id: effectiveCompanyId, show_all: showAll }), enabled: !!effectiveCompanyId, select: (data) => Array.isArray(data) ? data : data?.data ?? [] });
  const saveM = useMutation({ mutationFn: saveSalesReturnInvoiceDetail, onSuccess: () => { qc.invalidateQueries({ queryKey: ["so05-pending-invoices"] }); qc.invalidateQueries({ queryKey: ["so05-list"] }); setEdit(null); pushToast({ tone: "success", message: "Return invoice detail saved." }); }, onError: (error) => pushToast({ tone: "error", message: error.message }) });
  // All-column search, matching the same pattern as SO05ListPage.jsx / SalesReturnPendingButton.jsx.
  const filtered = (query.data ?? []).filter((row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [row.invoice_number, row.reference_document_number, row.detail_status, row.receipt?.receipt_number, row.receipt?.sending_name]
      .some((value) => String(value ?? "").toLowerCase().includes(q));
  });
  function openEdit(row) {
    setEdit({
      invoice_id: row.id,
      invoice_number: row.invoice_number || "",
      invoice_date: row.invoice_date || "",
      amount: row.amount || "",
      gst_treatment: row.gst_treatment || "EXCLUSIVE",
      gst_rate: row.gst_rate || "",
      gst_amount: row.gst_amount || "",
      state: row.state || "",
      freight_term: row.freight_term || "FOR",
    });
  }
  const columns = [
    { key: "receipt_number", label: "Receipt", render: (row) => dash(row.receipt?.receipt_number) },
    { key: "invoice_number", label: "Invoice", render: (row) => dash(row.invoice_number) },
    { key: "sending_name", label: "Sender", render: (row) => dash(row.receipt?.sending_name) },
    { key: "reference_document_number", label: "Reference", render: (row) => dash(row.reference_document_number) },
    { key: "detail_status", label: "Status" },
    { key: "actions", label: "", render: (row) => <button type="button" className="text-indigo-700 font-semibold" onClick={() => openEdit(row)}>Open</button> },
  ];
  return <ErpScreenScaffold title="Sales Return Invoice Posting" eyebrow="SO05 · Accounts" subtitle="Complete deferred invoice details. This does not create a payable document." actions={[{ label: "Back to receipts", tone: "neutral", onClick: () => popScreen() }]}>
    <ErpSectionCard title="Invoice queue">
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <TransactionCompanySelector runtimeContext={runtimeContext} value={effectiveCompanyId} onChange={setCompanyId} />
        <QuickFilterInput value={search} onChange={setSearch} placeholder="Search any column…" />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all invoices</label>
      </div>
      {/* maxHeight="none": this queue is a handful of rows with a form
          rendered right below it, not a big scrolling report -- ErpDenseGrid's
          default calc(100vh-200px) fixed height reserves almost the whole
          viewport regardless of row count, pushing the "Invoice details"
          panel below the fold once a row is opened. Found live 2026-09-26
          (business owner): clicking "Open" looked like it did nothing --
          it actually rendered, just off-screen past a wall of empty space. */}
      <ErpDenseGrid columns={columns} rows={filtered} rowKey={(row) => row.id} emptyMessage={query.isLoading ? "Loading invoices…" : "No matching invoices."} maxHeight="none" />
    </ErpSectionCard>
    {edit && <ErpSectionCard title="Invoice details">
      <div className="grid md:grid-cols-4 gap-3">
        <label className="text-xs">
          Invoice No.
          <input className={input} value={edit.invoice_number} onChange={(e) => setEdit({ ...edit, invoice_number: e.target.value })} />
        </label>
        {[["invoice_date", "Invoice Date", "date"], ["amount", "Amount", "number"], ["gst_rate", "GST Rate", "number"], ["gst_amount", "GST Amount", "number"], ["state", "State", "text"]].map(([key, label, type]) => (
          <label key={key} className="text-xs">
            {label}
            <input type={type} className={input} value={edit[key]} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} />
          </label>
        ))}
        <label className="text-xs">
          GST Treatment
          <ErpComboboxField
            inputClassName="rounded px-2 py-1.5 text-sm"
            hideBlank
            value={edit.gst_treatment}
            options={[{ value: "EXCLUSIVE", label: "EXCLUSIVE" }, { value: "INCLUSIVE", label: "INCLUSIVE" }]}
            onChange={(value) => setEdit({ ...edit, gst_treatment: value })}
          />
        </label>
        <label className="text-xs">
          Freight
          <ErpComboboxField
            inputClassName="rounded px-2 py-1.5 text-sm"
            hideBlank
            value={edit.freight_term}
            options={[{ value: "FOR", label: "FOR" }, { value: "TO_PAY", label: "TO_PAY" }]}
            onChange={(value) => setEdit({ ...edit, freight_term: value })}
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="border rounded px-3 py-2" onClick={() => setEdit(null)}>Cancel</button>
        <button className="bg-indigo-600 text-white rounded px-3 py-2" disabled={saveM.isPending || !edit.invoice_number.trim()} onClick={() => saveM.mutate(edit)}>Save</button>
      </div>
    </ErpSectionCard>}
  </ErpScreenScaffold>;
}
