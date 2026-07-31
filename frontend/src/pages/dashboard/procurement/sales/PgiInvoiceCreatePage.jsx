/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/PgiInvoiceCreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113.15 Stage 3 — the "PGI & INVOICE" flow, entered from the DO
 *          queue (SalesInvoiceListPage.jsx, SO02) with a DO already picked
 *          (screen context dcId). Auto-resolved fields come straight off
 *          the DO's own commercial snapshot (§113.13) -- only the Tally
 *          reference and (conditionally) freight amount are entered here.
 *          Submit goes to a read-only review step first; the actual
 *          createPgiInvoice() call (PGI + Invoice, one transaction) only
 *          fires from that review screen.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, openScreenWithContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createPgiInvoice, getDeliveryOrder } from "../procurementApi.js";

const EXCLUSIVE_FREIGHT_TERMS = new Set(["FREIGHT_SEPARATE", "FREIGHT_AT_ACTUALS"]);

function formatFixed(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "—";
}

export default function PgiInvoiceCreatePage() {
  const navigate = useNavigate();
  const dcId = getActiveScreenContext()?.dcId || "";
  const [step, setStep] = useState("form");
  const [form, setForm] = useState({ tally_invoice_number: "", tally_invoice_date: "", freight_included: false, freight_amount: "", remarks: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const doQuery = useQuery({
    queryKey: ["procurement", "delivery-order", dcId],
    queryFn: () => getDeliveryOrder(dcId),
    enabled: Boolean(dcId),
  });

  const data = doQuery.data ?? {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const freightTerm = String(data.freight_term || "").toUpperCase();
  const freightEligible = EXCLUSIVE_FREIGHT_TERMS.has(freightTerm);

  useEffect(() => {
    if (!freightEligible) {
      setForm((current) => (current.freight_included ? { ...current, freight_included: false, freight_amount: "" } : current));
    }
  }, [freightEligible]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const previewTotals = useMemo(() => {
    const taxable = lines.reduce((sum, line) => sum + Number(line.quantity ?? 0) * Number(line.unit_value ?? 0), 0);
    const gst = lines.reduce((sum, line) => sum + Number(line.gst_amount ?? 0), 0);
    const freight = form.freight_included && form.freight_amount ? Number(form.freight_amount) : 0;
    return { taxable, gst, freight, grandTotal: taxable + gst + freight };
  }, [lines, form.freight_included, form.freight_amount]);

  function handleContinueToReview() {
    setError("");
    if (!form.tally_invoice_number.trim() || !form.tally_invoice_date) {
      setError("Tally Invoice Number and Date are required.");
      return;
    }
    if (form.freight_included && !form.freight_amount) {
      setError("Freight amount is required when freight is included.");
      return;
    }
    setStep("review");
  }

  async function handleFinalSubmit() {
    setSaving(true);
    setError("");
    try {
      const created = await createPgiInvoice({
        dc_id: dcId,
        tally_invoice_number: form.tally_invoice_number.trim(),
        tally_invoice_date: form.tally_invoice_date,
        freight_included: form.freight_included,
        freight_amount: form.freight_included ? Number(form.freight_amount) : null,
        remarks: form.remarks.trim() || null,
      });
      openScreenWithContext(OPERATION_SCREENS.PROC_INV_DETAIL.screen_code, { id: created?.id, refreshOnReturn: true });
      navigate(`/dashboard/procurement/sales-invoices/${encodeURIComponent(created?.id)}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "PROCUREMENT_PGI_INVOICE_FAILED");
      setStep("form");
    } finally {
      setSaving(false);
    }
  }

  if (!dcId) {
    return (
      <ErpScreenScaffold eyebrow="Procurement" title="PGI & Invoice" actions={[{ key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() }]}>
        <div className="border border-dashed border-rose-300 bg-rose-50 px-4 py-6 text-sm text-rose-700">No delivery order selected. Go back to the DO queue and pick one.</div>
      </ErpScreenScaffold>
    );
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title={data.dc_number ? `PGI & Invoice — ${data.dc_number}` : "PGI & Invoice"}
      actions={[
        { key: "back", label: step === "review" ? "Edit" : "Back", tone: "neutral", onClick: () => (step === "review" ? setStep("form") : popScreen()), disabled: saving },
        step === "form"
          ? { key: "continue", label: "Review", tone: "primary", onClick: handleContinueToReview, disabled: doQuery.isLoading }
          : { key: "submit", label: saving ? "Posting..." : "Confirm — Post PGI & Invoice", tone: "primary", onClick: () => void handleFinalSubmit(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "pgi-error", tone: "error", message: error }] : []),
        ...(doQuery.error ? [{ key: "pgi-do-error", tone: "error", message: doQuery.error instanceof Error ? doQuery.error.message : "PROCUREMENT_DO_FETCH_FAILED" }] : []),
      ]}
    >
      {doQuery.isLoading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading delivery order...</div>
      ) : (
        <div className="grid gap-4">
          {step === "review" ? (
            <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Review before posting — this cannot be undone from here (a reversal is a separate action afterward). Check everything, then Confirm.
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Source" title="Auto-resolved from the Delivery Order">
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <ErpFieldPreview label={data.dc_type === "SALES" ? "Sales Order" : "Stock Transfer Order"} value={data.source_document_number || "—"} />
              <ErpFieldPreview label="Transporter" value={data.transporter_display || "—"} />
              <ErpFieldPreview label="Vehicle Number" value={data.vehicle_number || "—"} />
              <ErpFieldPreview label="LR Number" value={data.lr_number || "—"} />
              <ErpFieldPreview label="Payment Term" value={data.payment_term_display || "—"} />
              <ErpFieldPreview label="Freight Term" value={data.freight_term || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Bill-To / Ship-To" title="Both are printed on the invoice — Ship-To's state decides CGST+SGST vs IGST (§113.16)">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Bill To</div>
                <ErpFieldPreview label="Name" value={data.bill_to_name || "—"} />
                <ErpFieldPreview label="Address" value={data.bill_to_address || "—"} />
                <ErpFieldPreview label="State" value={data.bill_to_state || "—"} />
                <ErpFieldPreview label="GST Number" value={data.bill_to_gst_number || "—"} />
              </div>
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Ship To</div>
                <ErpFieldPreview label="Name" value={data.ship_to_name || "—"} />
                <ErpFieldPreview label="Address" value={data.ship_to_address || "—"} />
                <ErpFieldPreview label="State" value={data.ship_to_state || data.counterparty_state_name || "—"} />
                <ErpFieldPreview label="GST Number" value={data.ship_to_gst_number || "—"} />
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Tally Reference" title="Entered manually — required (this ERP invoice is tracking-only, no IRN link)">
            {step === "form" ? (
              <div className="grid gap-3 md:grid-cols-3">
                <ErpDenseFormRow label="Tally Invoice Number" required>
                  <input
                    value={form.tally_invoice_number}
                    onChange={(event) => updateField("tally_invoice_number", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Tally Invoice Date" required>
                  <input
                    type="date"
                    value={form.tally_invoice_date}
                    onChange={(event) => updateField("tally_invoice_date", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Remarks">
                  <input
                    value={form.remarks}
                    onChange={(event) => updateField("remarks", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3 text-sm">
                <ErpFieldPreview label="Tally Invoice Number" value={form.tally_invoice_number} />
                <ErpFieldPreview label="Tally Invoice Date" value={form.tally_invoice_date} />
                <ErpFieldPreview label="Remarks" value={form.remarks || "—"} />
              </div>
            )}
          </ErpSectionCard>

          {freightEligible ? (
            <ErpSectionCard eyebrow="Freight" title="This DO's freight term is exclusive — include a freight amount on this invoice?">
              {step === "form" ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>Include Freight</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateField("freight_included", true)}
                        className={`px-3 py-2 text-xs font-semibold ${form.freight_included ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => { updateField("freight_included", false); updateField("freight_amount", ""); }}
                        className={`px-3 py-2 text-xs font-semibold ${!form.freight_included ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}
                      >
                        No
                      </button>
                    </div>
                  </div>
                  {form.freight_included ? (
                    <ErpDenseFormRow label="Freight Amount" required>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.freight_amount}
                        onChange={(event) => updateField("freight_amount", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3 text-sm">
                  <ErpFieldPreview label="Freight Included" value={form.freight_included ? "Yes" : "No"} />
                  {form.freight_included ? <ErpFieldPreview label="Freight Amount" value={formatFixed(form.freight_amount)} /> : null}
                </div>
              )}
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Lines" title={`${lines.length} line${lines.length === 1 ? "" : "s"} — GST breakup`}>
            <ErpDenseGrid
              columns={[
                { key: "material_id", label: "Material", render: (row) => row.material_display || row.material_id },
                { key: "quantity", label: "Qty", width: "90px", render: (row) => `${row.quantity} ${row.uom_code || ""}` },
                { key: "unit_value", label: "Rate", width: "90px", align: "right", render: (row) => formatFixed(row.unit_value) },
                { key: "gst_rate", label: "GST %", width: "80px", align: "right", render: (row) => (row.gst_rate != null ? formatFixed(row.gst_rate, 1) : "—") },
                { key: "gst_amount", label: "GST Amount", width: "110px", align: "right", render: (row) => formatFixed(row.gst_amount) },
                { key: "packaging_cost_amount", label: "Packaging Cost", width: "120px", align: "right", render: (row) => formatFixed(row.packaging_cost_amount) },
                { key: "line_total", label: "Line Total", width: "110px", align: "right", render: (row) => formatFixed(row.line_total) },
              ]}
              rows={lines}
              rowKey={(row) => row.id}
              emptyMessage="No lines."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Totals" title="Preview — actual invoice totals compute fresh on submit">
            <div className="grid gap-3 md:grid-cols-4 text-sm">
              <ErpFieldPreview label="Taxable Value" value={formatFixed(previewTotals.taxable)} />
              <ErpFieldPreview label="GST" value={formatFixed(previewTotals.gst)} />
              <ErpFieldPreview label="Freight" value={formatFixed(previewTotals.freight)} />
              <ErpFieldPreview label="Grand Total" value={formatFixed(previewTotals.grandTotal)} />
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
