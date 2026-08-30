import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { amountToWordsIndian } from "../../../../utils/numberToWordsIndian.js";
import { getSalesInvoice } from "../procurementApi.js";

const COPY_LABELS = ["Original for Recipient", "Duplicate for Transporter", "Triplicate for Consignor"];

function number(value, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : (0).toFixed(digits);
}
function date(value) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("en-GB");
}
function taxRows(lines, gstType) {
  const rows = new Map();
  for (const line of lines || []) {
    const rate = Number(line.gst_rate ?? 0);
    const key = `${line.hsn_code || "-"}:${rate}`;
    const row = rows.get(key) || { hsn: line.hsn_code || "-", rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += Number(line.taxable_value ?? 0);
    row.cgst += Number(line.cgst_amount ?? 0);
    row.sgst += Number(line.sgst_amount ?? 0);
    row.igst += Number(line.igst_amount ?? 0);
    rows.set(key, row);
  }
  return [...rows.values()];
}

function InvoiceCopy({ invoice, copyLabel }) {
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const gstType = invoice.gst_type === "IGST" ? "IGST" : "CGST_SGST";
  const hsnRows = taxRows(lines, gstType);
  const invoiceNo = invoice.tally_invoice_number || invoice.invoice_number || "-";
  const invoiceDate = invoice.tally_invoice_date || invoice.invoice_date;
  const delivery = invoice.delivery_challan || {};
  const totalTax = Number(invoice.total_gst_amount ?? 0);
  const totalValue = Number(invoice.total_invoice_value ?? 0);

  return (
    <article className="invoice-copy mx-auto w-[210mm] bg-white p-[8mm] text-[10px] leading-[1.25] text-black print:break-after-page print:p-0">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-black pb-2">
        <h1 className="text-left text-[18px] font-bold">Tax Invoice</h1>
        <div className="px-6 text-center text-[12px] font-semibold italic uppercase">{copyLabel}</div>
        <div />
      </header>

      <section className="mt-2 grid grid-cols-[1.05fr_1fr] border border-black">
        <div className="border-r border-black p-2">
          <div className="text-[14px] font-bold uppercase">{invoice.seller?.company_name || "-"}</div>
          <div>{invoice.seller?.full_address || "-"}</div>
          <div>GSTIN/UIN: {invoice.seller?.gst_number || "-"}</div>
          <div>State Name: {invoice.seller?.state_name || "-"}</div>
          <div className="mt-2 border-t border-black pt-1 font-semibold">Consignee (Ship to)</div>
          <div className="font-bold">{invoice.ship_to_name || "-"}</div>
          <div>{invoice.ship_to_address || "-"}</div>
          <div>State Name: {invoice.ship_to_state || "-"}</div>
          <div>GSTIN/UIN: {invoice.ship_to_gst_number || "-"}</div>
          <div className="mt-2 border-t border-black pt-1 font-semibold">Buyer (Bill to)</div>
          <div className="font-bold">{invoice.bill_to_name || "-"}</div>
          <div>{invoice.bill_to_address || "-"}</div>
          <div>State Name: {invoice.bill_to_state || "-"}</div>
          <div>GSTIN/UIN: {invoice.bill_to_gst_number || "-"}</div>
        </div>
        <div className="grid grid-cols-2 content-start [&>div]:border-b [&>div]:border-black [&>div]:p-1">
          <div>Invoice No.<strong className="block">{invoiceNo}</strong></div><div>Dated<strong className="block">{date(invoiceDate)}</strong></div>
          <div>Delivery Note<strong className="block">{delivery.dc_number || "-"}</strong></div><div>Delivery Note Date<strong className="block">{date(delivery.dc_date)}</strong></div>
          <div>Reference No. &amp; Date<strong className="block">{invoice.fo_number || "-"}</strong></div><div>FO Date<strong className="block">{date(invoice.fo_date)}</strong></div>
          <div>Other References<strong className="block">{invoice.inbound_number || "-"}</strong></div><div>Mode/Terms of Payment<strong className="block">{invoice.payment_term_name || "-"}</strong></div>
          <div>Dispatch Doc No.<strong className="block">{delivery.lr_number || "-"}</strong></div><div>Dispatch Doc Date<strong className="block">{date(delivery.lr_date)}</strong></div>
          <div>Dispatched through<strong className="block">{delivery.transporter_display || "-"}</strong></div><div>Destination<strong className="block">{invoice.ship_to_state || "-"}</strong></div>
          <div>Motor Vehicle No.<strong className="block">{delivery.vehicle_number || "-"}</strong></div><div>GST Type<strong className="block">{gstType === "IGST" ? "IGST" : "CGST + SGST"}</strong></div>
        </div>
      </section>

      <table className="mt-2 w-full border-collapse text-[10px]">
        <thead><tr className="[&>th]:border [&>th]:border-black [&>th]:p-1"><th>Sl. No.</th><th className="text-left">Description of Goods</th><th>HSN/SAC</th><th>Quantity</th><th>Rate</th><th>per</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{lines.map((line, index) => {
          const rate = Number(line.gst_rate ?? 0);
          const lineTaxes = gstType === "IGST"
            ? [{ label: "Output IGST", rate, amount: Number(line.igst_amount ?? 0) }]
            : [{ label: "Output CGST", rate: rate / 2, amount: Number(line.cgst_amount ?? 0) }, { label: "Output SGST", rate: rate / 2, amount: Number(line.sgst_amount ?? 0) }];
          return [
            <tr key={line.id || index} className="[&>td]:border [&>td]:border-black [&>td]:p-1 [&>td]:align-top"><td>{index + 1}</td><td><strong>{line.document_name || line.material_name || "-"}</strong>{line.batch_number ? <div>Batch: {line.batch_number}</div> : null}</td><td>{line.hsn_code || "-"}</td><td className="text-right">{number(line.quantity, 3)}</td><td className="text-right">{number(line.rate, 4)}</td><td>{line.uom_code || "-"}</td><td className="text-right font-semibold">{number(line.taxable_value)}</td></tr>,
            ...lineTaxes.map((tax) => <tr key={`${line.id}-${tax.label}`} className="[&>td]:border-x [&>td]:border-black [&>td]:p-1"><td /><td colSpan="4" className="text-right italic">{tax.label} @ {number(tax.rate, 2)}%</td><td>{tax.label.replace("Output ", "")}</td><td className="text-right font-semibold">{number(tax.amount)}</td></tr>),
          ];
        })}</tbody>
        <tfoot><tr className="font-bold [&>td]:border [&>td]:border-black [&>td]:p-1"><td colSpan="3" className="text-right">Total</td><td className="text-right">{number(lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0), 3)}</td><td colSpan="2" /><td className="text-right">{number(totalValue)}</td></tr></tfoot>
      </table>

      <div className="border-x border-b border-black p-1">Amount Chargeable (in words): <strong>{amountToWordsIndian(totalValue)}</strong></div>
      <table className="mt-2 w-full border-collapse text-[10px]"><thead><tr className="[&>th]:border [&>th]:border-black [&>th]:p-1"><th rowSpan="2">HSN/SAC</th><th rowSpan="2">Taxable Value</th>{gstType === "IGST" ? <th colSpan="2">IGST</th> : <><th colSpan="2">CGST</th><th colSpan="2">SGST</th></>}<th rowSpan="2">Total Tax</th></tr><tr className="[&>th]:border [&>th]:border-black [&>th]:p-1">{gstType === "IGST" ? <><th>Rate</th><th>Amount</th></> : <><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></>}</tr></thead><tbody>{hsnRows.map((row) => <tr key={`${row.hsn}-${row.rate}`} className="[&>td]:border [&>td]:border-black [&>td]:p-1"><td>{row.hsn}</td><td className="text-right">{number(row.taxable)}</td>{gstType === "IGST" ? <><td>{number(row.rate, 2)}%</td><td className="text-right">{number(row.igst)}</td></> : <><td>{number(row.rate / 2, 2)}%</td><td className="text-right">{number(row.cgst)}</td><td>{number(row.rate / 2, 2)}%</td><td className="text-right">{number(row.sgst)}</td></>}<td className="text-right">{number(row.cgst + row.sgst + row.igst)}</td></tr>)}</tbody></table>
      <div className="border-x border-b border-black p-1">Tax Amount (in words): <strong>{amountToWordsIndian(totalTax)}</strong></div>
      <footer className="mt-2 grid grid-cols-2 border border-black"><div className="p-2"><strong>Declaration</strong><p>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p></div><div className="flex min-h-24 flex-col justify-between border-l border-black p-2 text-right"><strong>for {invoice.seller?.company_name || "Supplier"}</strong><span>Authorised Signatory</span></div></footer>
    </article>
  );
}

export default function SalesInvoicePrintPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const invoiceQuery = useQuery({ queryKey: ["procurement", "sales-invoice-print", id], queryFn: async () => { const response = await getSalesInvoice(id); return response?.data ?? response; }, enabled: Boolean(id) });
  const invoice = invoiceQuery.data;
  const copies = useMemo(() => COPY_LABELS, []);

  return <main className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0"><style>{`@media print { body * { visibility: hidden; } #sales-invoice-print, #sales-invoice-print * { visibility: visible; } #sales-invoice-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style><div className="mb-4 flex justify-between print:hidden"><button type="button" onClick={() => navigate(-1)} className="border border-slate-400 bg-white px-4 py-2 text-sm font-semibold">Back</button><button type="button" onClick={() => window.print()} className="border border-slate-800 bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Print 3 Copies</button></div>{invoiceQuery.isLoading ? <p>Loading invoice...</p> : null}{invoiceQuery.error ? <p className="text-rose-700">{invoiceQuery.error.message}</p> : null}{invoice ? <div id="sales-invoice-print">{copies.map((copyLabel) => <InvoiceCopy key={copyLabel} invoice={invoice} copyLabel={copyLabel} />)}</div> : null}</main>;
}
