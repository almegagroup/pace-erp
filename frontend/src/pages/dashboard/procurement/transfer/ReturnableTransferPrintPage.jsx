/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/ReturnableTransferPrintPage.jsx
 * Domain: PROCUREMENT / PO12 Tab 2
 * Purpose: Delivery Challan print view for a Returnable Material Transfer — design lock
 *          2026-10-05 point 5: Delivery Challan only (not a Tax Invoice, no GST) is
 *          sufficient under CGST Rule 55 for a genuinely non-returnable... (returnable,
 *          non-supply) movement between two GST-registered entities.
 * Authority: Frontend
 */

import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getReturnableTransfer } from "../procurementApi.js";

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "0.000";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function ReturnableTransferPrintPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const transferQuery = useQuery({
    queryKey: ["procurement", "returnable-transfer-print", id],
    queryFn: () => getReturnableTransfer(id),
    enabled: Boolean(id),
  });
  const transfer = transferQuery.data;
  const lines = transfer?.lines ?? [];

  return (
    <main className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <style>{`@media print { body * { visibility: hidden; } #rt-dc-print, #rt-dc-print * { visibility: visible; } #rt-dc-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <div className="mb-4 flex justify-between print:hidden">
        <button type="button" onClick={() => navigate(-1)} className="border border-slate-400 bg-white px-4 py-2 text-sm font-semibold">
          Back
        </button>
        <button type="button" onClick={() => window.print()} className="border border-slate-800 bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
          Print Delivery Challan
        </button>
      </div>
      {transferQuery.isLoading ? <p>Loading...</p> : null}
      {transferQuery.error ? <p className="text-rose-700">{transferQuery.error.message}</p> : null}
      {transfer ? (
        <div id="rt-dc-print" className="mx-auto max-w-3xl border border-slate-900 bg-white p-6 text-sm text-slate-900">
          <div className="mb-3 text-center text-lg font-bold uppercase tracking-wide">Delivery Challan</div>
          <div className="mb-3 text-center text-xs font-semibold text-slate-600">
            Returnable Material Transfer — Not a Tax Invoice — No Supply, No GST (CGST Rule 55)
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 border-y border-slate-400 py-2 text-xs">
            <div><span className="font-semibold">Transfer No:</span> {transfer.transfer_number}</div>
            <div><span className="font-semibold">Date:</span> {formatDate(transfer.transfer_date)}</div>
            <div><span className="font-semibold">From:</span> {transfer.from_company_label}</div>
            <div><span className="font-semibold">To:</span> {transfer.to_company_label}</div>
            <div><span className="font-semibold">Nature:</span> {transfer.is_return ? "Return of previously transferred material" : "Returnable material transfer"}</div>
            <div><span className="font-semibold">Status:</span> {transfer.status}</div>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-900">
                <th className="border border-slate-400 p-1 text-left">#</th>
                <th className="border border-slate-400 p-1 text-left">Material</th>
                <th className="border border-slate-400 p-1 text-left">External Code</th>
                <th className="border border-slate-400 p-1 text-right">Quantity</th>
                <th className="border border-slate-400 p-1 text-left">UOM</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id}>
                  <td className="border border-slate-400 p-1">{index + 1}</td>
                  <td className="border border-slate-400 p-1">{line.material_label}</td>
                  <td className="border border-slate-400 p-1">{line.external_code || "—"}</td>
                  <td className="border border-slate-400 p-1 text-right">{formatNumber(line.quantity)}</td>
                  <td className="border border-slate-400 p-1">{line.uom_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {transfer.remarks ? <div className="mt-3 text-xs"><span className="font-semibold">Remarks:</span> {transfer.remarks}</div> : null}
          <div className="mt-10 grid grid-cols-2 gap-6 text-xs">
            <div className="border-t border-slate-600 pt-1 text-center">Sender's Signature</div>
            <div className="border-t border-slate-600 pt-1 text-center">Receiver's Signature</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
