/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/SettlementInvoicePrintPage.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order) / AC01
 * Purpose: AC01 "Settlement Invoice" column -> View/Print. Reuses
 *          SalesInvoicePrintPage.jsx's own InvoiceCopy component as-is —
 *          only the fetched data differs. Design:
 *          docs/PROCUREMENT-DESIGN-DOC.md "AC01 'Settlement Invoice' column
 *          + View/Print" section, locked 2026-10-04.
 * Authority: Frontend
 */

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { InvoiceCopy } from "../sales/SalesInvoicePrintPage.jsx";
import { getSettlementPrintData } from "../procurementApi.js";

const COPY_LABELS = ["Original for Recipient", "Duplicate for Transporter", "Triplicate for Consignor"];

export default function SettlementInvoicePrintPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const invoiceQuery = useQuery({
    queryKey: ["procurement", "settlement-invoice-print", id],
    queryFn: () => getSettlementPrintData(id),
    enabled: Boolean(id),
  });
  const invoice = invoiceQuery.data;
  const copies = useMemo(() => COPY_LABELS, []);

  return (
    <main className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <style>{`@media print { body * { visibility: hidden; } #settlement-invoice-print, #settlement-invoice-print * { visibility: visible; } #settlement-invoice-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <div className="mb-4 flex justify-between print:hidden">
        <button type="button" onClick={() => navigate(-1)} className="border border-slate-400 bg-white px-4 py-2 text-sm font-semibold">
          Back
        </button>
        <button type="button" onClick={() => window.print()} className="border border-slate-800 bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
          Print 3 Copies
        </button>
      </div>
      {invoiceQuery.isLoading ? <p>Loading invoice...</p> : null}
      {invoiceQuery.error ? <p className="text-rose-700">{invoiceQuery.error.message}</p> : null}
      {invoice ? (
        <div id="settlement-invoice-print">
          {copies.map((copyLabel) => (
            <InvoiceCopy key={copyLabel} invoice={invoice} copyLabel={copyLabel} />
          ))}
        </div>
      ) : null}
    </main>
  );
}
