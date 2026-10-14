import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import { cancelAplInvoiceCase, lookupAplInvoiceCase, saveAplInvoiceCase } from "../procurementApi.js";

export default function AplInvoiceCaseDrawer({ companyId, onClose, onSaved }) {
  const [lookup, setLookup] = useState("");
  const [submittedLookup, setSubmittedLookup] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [received, setReceived] = useState("NO");
  const [receivedDate, setReceivedDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const lookupQuery = useQuery({
    queryKey: ["procurement", "apl-invoice-case", companyId, submittedLookup],
    queryFn: () => lookupAplInvoiceCase({ company_id: companyId, lookup: submittedLookup }),
    enabled: Boolean(companyId && submittedLookup),
  });
  const candidates = useMemo(() => {
    const value = lookupQuery.data?.candidates ?? lookupQuery.data?.data?.candidates ?? [];
    return Array.isArray(value) ? value : [];
  }, [lookupQuery.data]);
  const selected = candidates.find((item) => item.dc_id === selectedId) ?? (candidates.length === 1 ? candidates[0] : null);

  function find() {
    if (!lookup.trim()) { setError("Enter an FO Number or Invoice Number first."); return; }
    setError(""); setNotice(""); setSelectedId(""); setSubmittedLookup(lookup.trim());
  }
  async function save(nextReceived = received) {
    if (!selected) return;
    if (nextReceived === "YES" && !receivedDate) { setError("Received Date is mandatory when APL Invoice Received is Yes."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await saveAplInvoiceCase({ dc_id: selected.dc_id, company_id: companyId, status: nextReceived, received_date: nextReceived === "YES" ? receivedDate : null });
      setNotice("APL Invoice Case saved."); onSaved?.();
      await lookupQuery.refetch();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "APL_CASE_SAVE_FAILED"); }
    finally { setSaving(false); }
  }
  async function cancelPosting() {
    if (!selected || !reason.trim()) { setError("Cancellation reason is required."); return; }
    if (!window.confirm(`Cancel invoice posting for DO ${selected.dc_number}? This cannot be undone.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await cancelAplInvoiceCase({ dc_id: selected.dc_id, company_id: companyId, reason: reason.trim() });
      setNotice("Invoice, PGI where applicable, DO, and reservation were cancelled."); onSaved?.();
      await lookupQuery.refetch();
    } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : "APL_CASE_CANCEL_FAILED"); }
    finally { setSaving(false); }
  }

  return <DrawerBase visible title="APL Invoice Case" onEscape={onClose} onClose={onClose} width="min(560px, calc(100vw - 24px))" actions={<button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950">Done</button>}>
    <div className="grid gap-3 text-sm">
      {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div> : null}
      {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</div> : null}
      <label className="grid gap-1 text-xs text-slate-600">Enter FO Number or Invoice Number
        <div className="flex gap-2"><input value={lookup} onChange={(event) => setLookup(event.target.value)} className="h-9 min-w-0 flex-1 border border-slate-300 bg-[#fffef7] px-2" />
          <button type="button" onClick={find} disabled={lookupQuery.isFetching} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">{lookupQuery.isFetching ? "Finding…" : "Find"}</button></div>
      </label>
      {submittedLookup && !lookupQuery.isFetching && candidates.length === 0 ? <p className="text-xs text-slate-600">No active Sales Delivery Order matched that FO or invoice number.</p> : null}
      {candidates.length > 1 ? <label className="grid gap-1 text-xs text-slate-600">Matching Delivery Orders
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-9 border border-slate-300 bg-white px-2"><option value="">Choose a Delivery Order</option>{candidates.map((item) => <option key={item.dc_id} value={item.dc_id}>{item.dc_number} — FO {item.fo_number || "—"} — Invoice {item.invoice_number || "—"} — {item.party || "—"} — {item.status}</option>)}</select>
      </label> : null}
      {selected ? <div className="grid gap-3 border border-slate-300 bg-slate-50 p-3">
        <div className="grid gap-1 text-xs text-slate-700"><p><b>DO:</b> {selected.dc_number}</p><p><b>FO:</b> {selected.fo_number || "—"}</p><p><b>Invoice:</b> {selected.invoice_number || "—"}{selected.invoice_date ? ` (${selected.invoice_date})` : ""}</p><p><b>Party:</b> {selected.party || "—"}</p><p><b>Status:</b> {selected.status}; PGI {selected.pgi_done ? "done" : "not done"}</p><p><b>Current APL state:</b> {selected.apl_invoice_state}</p></div>
        {selected.apl_case_status === "NO" ? <><label className="grid gap-1 text-xs text-slate-600">APL Invoice Received<select value="YES" disabled className="h-8 border border-slate-300 bg-slate-100 px-2"><option value="YES">Yes</option></select></label><label className="grid gap-1 text-xs text-slate-600">Received Date<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" /></label><button type="button" disabled={saving} onClick={() => void save("YES")} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">{saving ? "Saving…" : "Save Received"}</button><label className="grid gap-1 text-xs text-slate-600">Cancellation Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-16 border border-slate-300 bg-white px-2 py-1" /></label><button type="button" disabled={saving} onClick={() => void cancelPosting()} className="border border-rose-700 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-900 disabled:opacity-50">Cancel Posting</button></> : <><label className="grid gap-1 text-xs text-slate-600">APL Invoice Received<select value={received} onChange={(event) => setReceived(event.target.value)} className="h-8 border border-slate-300 bg-white px-2"><option value="NO">No</option><option value="YES">Yes</option></select></label>{received === "YES" ? <label className="grid gap-1 text-xs text-slate-600">Received Date<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" /></label> : null}<button type="button" disabled={saving} onClick={() => void save()} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></>}
      </div> : null}
    </div>
  </DrawerBase>;
}
