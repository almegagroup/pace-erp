import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { pushToast } from "../../../../store/uiToast.js";
import { listPendingSalesReturnInvoices, saveSalesReturnInvoiceDetail } from "../procurementApi.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";

const input = "border border-slate-300 rounded px-2 py-1.5 text-sm w-full";
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
  const saveM = useMutation({ mutationFn: saveSalesReturnInvoiceDetail, onSuccess: () => { qc.invalidateQueries({ queryKey: ["so05-pending-invoices"] }); setEdit(null); pushToast({ tone: "success", message: "Return invoice detail saved." }); }, onError: (error) => pushToast({ tone: "error", message: error.message }) });
  const filtered = (query.data ?? []).filter((row) => [row.invoice_number, row.reference_document_number, row.receipt?.receipt_number, row.receipt?.sending_name].some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase())));
  return <ErpScreenScaffold title="Sales Return Invoice Posting" eyebrow="SO05 · Accounts" subtitle="Complete deferred invoice details. This does not create a payable document." actions={[{ label: "Back to receipts", tone: "neutral", onClick: () => popScreen() }]}>
    <ErpSectionCard title="Invoice queue"><div className="grid md:grid-cols-3 gap-3 mb-3"><TransactionCompanySelector runtimeContext={runtimeContext} value={effectiveCompanyId} onChange={setCompanyId} /><QuickFilterInput value={search} onChange={setSearch} placeholder="Search invoice, receipt or sender" /><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all invoices</label></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Receipt</th><th>Invoice</th><th>Sender</th><th>Reference</th><th>Status</th><th /></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className="border-b"><td className="p-2">{row.receipt?.receipt_number}</td><td>{row.invoice_number}</td><td>{row.receipt?.sending_name}</td><td>{row.reference_document_number || "—"}</td><td>{row.detail_status}</td><td><button className="text-indigo-700" onClick={() => setEdit({ invoice_id: row.id, invoice_date: row.invoice_date || "", amount: row.amount || "", gst_treatment: row.gst_treatment || "EXCLUSIVE", gst_rate: row.gst_rate || "", gst_amount: row.gst_amount || "", state: row.state || "", freight_term: row.freight_term || "FOR" })}>Open</button></td></tr>)}{!filtered.length && <tr><td colSpan="6" className="p-6 text-center text-slate-400">No matching invoices.</td></tr>}</tbody></table></div>
    </ErpSectionCard>
    {edit && <ErpSectionCard title="Invoice details"><div className="grid md:grid-cols-4 gap-3">{[["invoice_date", "Invoice Date", "date"], ["amount", "Amount", "number"], ["gst_rate", "GST Rate", "number"], ["gst_amount", "GST Amount", "number"], ["state", "State", "text"]].map(([key, label, type]) => <label key={key} className="text-xs">{label}<input type={type} className={input} value={edit[key]} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} /></label>)}<label className="text-xs">GST Treatment<select className={input} value={edit.gst_treatment} onChange={(e) => setEdit({ ...edit, gst_treatment: e.target.value })}><option>EXCLUSIVE</option><option>INCLUSIVE</option></select></label><label className="text-xs">Freight<select className={input} value={edit.freight_term} onChange={(e) => setEdit({ ...edit, freight_term: e.target.value })}><option>FOR</option><option>TO_PAY</option></select></label></div><div className="mt-3 flex justify-end gap-2"><button className="border rounded px-3 py-2" onClick={() => setEdit(null)}>Cancel</button><button className="bg-indigo-600 text-white rounded px-3 py-2" disabled={saveM.isPending} onClick={() => saveM.mutate(edit)}>Save</button></div></ErpSectionCard>}
  </ErpScreenScaffold>;
}
