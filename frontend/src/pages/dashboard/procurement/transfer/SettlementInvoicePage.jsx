/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/SettlementInvoicePage.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: Settlement (CRCP Leg 2 Invoice) — Pending (create) + Settled
 *          (view/reverse) tabs. Design: docs/PROCUREMENT-DESIGN-DOC.md
 *          "Settlement (Leg 2 Invoice)" section, locked 2026-10-04.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useCostCentersQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import {
  listSettlementPending,
  createSettlementInvoice,
  getSettlementByTallyInvoice,
  reverseSettlementInvoice,
} from "../procurementApi.js";

// Same codes as POCreatePage.jsx/SOCreatePage.jsx -- no new options invented.
const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
  { value: "EX_TRANSPORTER_GODOWN", label: "Ex Transporter Godown" },
];
const GST_TREATMENT_OPTIONS = [
  { value: "INCLUSIVE", label: "GST Inclusive" },
  { value: "EXCLUSIVE", label: "GST Exclusive" },
];
const GST_TYPE_OPTIONS = [
  { value: "CGST_SGST", label: "CGST + SGST" },
  { value: "IGST", label: "IGST" },
];

function formatQty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "0.000";
}

function resolveInitialTab(rawValue) {
  return rawValue === "settled" ? "settled" : "pending";
}

function initialHeader() {
  return {
    tally_invoice_number: "",
    tally_invoice_date: "",
    posting_date: "",
    invoice_quantity: "",
    rate_per_uom: "",
    currency_code: "INR",
    freight_term: "",
    payment_term_id: "",
    gst_rate: "",
    gst_treatment: "EXCLUSIVE",
    gst_type: "CGST_SGST",
    sending_cost_center_id: "",
    receiving_cost_center_id: "",
    has_rebate: false,
    rebate_rate: "",
    rebate_rate_uom_basis: "",
    rebate_remarks: "",
    remarks: "",
  };
}

export default function SettlementInvoicePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveInitialTab(searchParams.get("tab"));
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const [checkedGrnIds, setCheckedGrnIds] = useState(() => new Set());
  const [header, setHeader] = useState(initialHeader);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [lookupNumber, setLookupNumber] = useState("");
  const [lookupDate, setLookupDate] = useState("");
  const [reversing, setReversing] = useState(false);

  function switchTab(tab) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", tab);
      return next;
    });
  }

  const pendingQuery = useQuery({
    queryKey: ["po12-settlement-pending", effectiveCompanyId],
    queryFn: () => listSettlementPending({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId) && activeTab === "pending",
  });
  const pendingRows = useMemo(() => (Array.isArray(pendingQuery.data?.items) ? pendingQuery.data.items : []), [pendingQuery.data]);

  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const sendingCostCenterQuery = useCostCentersQuery(
    { company_id: effectiveCompanyId, active: true },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const receivingCostCenterOptions = sendingCostCenterQuery; // Receiver's own CC list resolved once a row is checked -- see note below.

  const runningTotal = useMemo(
    () => pendingRows.filter((row) => checkedGrnIds.has(row.grn_id)).reduce((sum, row) => sum + Number(row.grn_qty || 0), 0),
    [pendingRows, checkedGrnIds],
  );
  const invoiceQtyNumber = Number(header.invoice_quantity);
  const quantityMatches = checkedGrnIds.size > 0
    && Number.isFinite(invoiceQtyNumber)
    && Math.round(runningTotal * 1e6) === Math.round(invoiceQtyNumber * 1e6);
  const canCreate = quantityMatches
    && header.tally_invoice_number.trim()
    && header.tally_invoice_date
    && Number(header.rate_per_uom) > 0;

  function toggleRow(grnId) {
    setCheckedGrnIds((current) => {
      const next = new Set(current);
      if (next.has(grnId)) next.delete(grnId);
      else next.add(grnId);
      return next;
    });
  }

  async function handleCreate() {
    if (!canCreate) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createSettlementInvoice({
        grn_ids: [...checkedGrnIds],
        tally_invoice_number: header.tally_invoice_number,
        tally_invoice_date: header.tally_invoice_date,
        posting_date: header.posting_date || header.tally_invoice_date,
        invoice_quantity: invoiceQtyNumber,
        rate_per_uom: Number(header.rate_per_uom),
        currency_code: header.currency_code,
        freight_term: header.freight_term || null,
        payment_term_id: header.payment_term_id || null,
        gst_rate: header.gst_rate === "" ? null : Number(header.gst_rate),
        gst_treatment: header.gst_treatment,
        gst_type: header.gst_type,
        sending_cost_center_id: header.sending_cost_center_id || null,
        receiving_cost_center_id: header.receiving_cost_center_id || null,
        has_rebate: header.has_rebate,
        rebate_rate: header.rebate_rate === "" ? null : Number(header.rebate_rate),
        rebate_rate_uom_basis: header.rebate_rate_uom_basis || null,
        rebate_remarks: header.rebate_remarks || null,
        remarks: header.remarks || null,
      });
      setNotice(`Settlement Invoice created — Tally Invoice ${result.tally_invoice_number}.`);
      setCheckedGrnIds(new Set());
      setHeader(initialHeader());
      await queryClient.invalidateQueries({ queryKey: ["po12-settlement-pending", effectiveCompanyId] });
      await queryClient.invalidateQueries({ queryKey: ["po12-crcp-discrepancy", effectiveCompanyId] });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create Settlement Invoice.");
    } finally {
      setSaving(false);
    }
  }

  const settledLookupQuery = useQuery({
    queryKey: ["po12-settlement-lookup", lookupNumber, lookupDate],
    queryFn: () => getSettlementByTallyInvoice({ tally_invoice_number: lookupNumber, tally_invoice_date: lookupDate }),
    enabled: false,
  });

  async function handleLookup() {
    setError("");
    await settledLookupQuery.refetch();
  }

  async function handleReverse() {
    const invoice = settledLookupQuery.data?.invoice;
    if (!invoice?.id) return;
    setReversing(true);
    setError("");
    setNotice("");
    try {
      await reverseSettlementInvoice({ settlement_invoice_id: invoice.id, reason: "Reversed via PO12 Settlement page" });
      setNotice(`Settlement Invoice ${invoice.tally_invoice_number} reversed.`);
      await settledLookupQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["po12-settlement-pending", effectiveCompanyId] });
      await queryClient.invalidateQueries({ queryKey: ["po12-crcp-discrepancy", effectiveCompanyId] });
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "Unable to reverse Settlement Invoice.");
    } finally {
      setReversing(false);
    }
  }

  const pendingColumns = [
    {
      key: "__check",
      label: "",
      width: "36px",
      filterable: false,
      render: (row) => (
        <input
          type="checkbox"
          checked={checkedGrnIds.has(row.grn_id)}
          onChange={() => toggleRow(row.grn_id)}
        />
      ),
    },
    { key: "bill_to_company_name", label: "Bill-To", width: "150px" },
    { key: "actual_receiver_company_name", label: "Actual Receiver", width: "150px" },
    { key: "grn_number", label: "GRN No.", width: "110px" },
    { key: "grn_date", label: "GRN Date", width: "100px", filterType: "date" },
    { key: "material_name", label: "Material", width: "160px" },
    { key: "grn_qty", label: "Qty", width: "90px", align: "right", render: (row) => formatQty(row.grn_qty) },
    { key: "base_uom_code", label: "UOM", width: "60px" },
  ];

  const settledColumns = [
    { key: "grn_number", label: "GRN No.", width: "110px" },
    { key: "grn_date", label: "GRN Date", width: "100px" },
    { key: "received_qty", label: "Qty", width: "90px", align: "right", render: (row) => formatQty(row.received_qty) },
    { key: "invoice_number", label: "Invoice No.", width: "120px" },
    { key: "invoice_date", label: "Invoice Date", width: "110px" },
  ];

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement · PO12"
      title="Settlement (CRCP Leg 2 Invoice)"
      notices={[
        ...(error ? [{ key: "settlement-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "settlement-notice", tone: "success", message: notice }] : []),
      ]}
      filterSection={{
        eyebrow: "",
        title: "",
        children: (
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={() => switchTab("pending")}
              className={`border px-3 py-2 text-sm font-semibold ${activeTab === "pending" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => switchTab("settled")}
              className={`border px-3 py-2 text-sm font-semibold ${activeTab === "settled" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
            >
              Settled
            </button>
            {activeTab === "pending" ? (
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Bill-To Company" />
            ) : null}
          </div>
        ),
      }}
      listSection={{
        eyebrow: "",
        title: "",
        children: activeTab === "pending" ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 border border-slate-200 p-3 md:grid-cols-4">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Tally Invoice Number
                <input value={header.tally_invoice_number} onChange={(event) => setHeader((current) => ({ ...current, tally_invoice_number: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Tally Invoice Date
                <input type="date" value={header.tally_invoice_date} onChange={(event) => setHeader((current) => ({ ...current, tally_invoice_date: event.target.value, posting_date: current.posting_date || event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Posting Date
                <input type="date" value={header.posting_date} onChange={(event) => setHeader((current) => ({ ...current, posting_date: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Invoice Quantity
                <input type="number" value={header.invoice_quantity} onChange={(event) => setHeader((current) => ({ ...current, invoice_quantity: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Running Total (checked rows)
                <input readOnly value={formatQty(runningTotal)} className={`h-[26px] border px-2 text-[11px] ${quantityMatches ? "border-emerald-400 bg-emerald-50" : "border-rose-300 bg-rose-50"}`} />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Rate per UOM
                <input type="number" value={header.rate_per_uom} onChange={(event) => setHeader((current) => ({ ...current, rate_per_uom: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Currency
                <input value={header.currency_code} onChange={(event) => setHeader((current) => ({ ...current, currency_code: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Freight Term
                <select value={header.freight_term} onChange={(event) => setHeader((current) => ({ ...current, freight_term: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]">
                  <option value="">—</option>
                  {FREIGHT_TERM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Payment Terms
                <select value={header.payment_term_id} onChange={(event) => setHeader((current) => ({ ...current, payment_term_id: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]">
                  <option value="">—</option>
                  {(paymentTermQuery.paymentTerms ?? []).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GST Rate
                <input type="number" value={header.gst_rate} onChange={(event) => setHeader((current) => ({ ...current, gst_rate: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GST Treatment
                <select value={header.gst_treatment} onChange={(event) => setHeader((current) => ({ ...current, gst_treatment: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]">
                  {GST_TREATMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                GST Type
                <select value={header.gst_type} onChange={(event) => setHeader((current) => ({ ...current, gst_type: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]">
                  {GST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Bill-To Cost Center
                <select value={header.sending_cost_center_id} onChange={(event) => setHeader((current) => ({ ...current, sending_cost_center_id: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]">
                  <option value="">—</option>
                  {(sendingCostCenterQuery.data?.data ?? []).map((cc) => <option key={cc.id} value={cc.id}>{cc.cost_center_code || cc.id} — {cc.cost_center_name || cc.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Actual Receiver Cost Center
                <select value={header.receiving_cost_center_id} onChange={(event) => setHeader((current) => ({ ...current, receiving_cost_center_id: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]">
                  <option value="">—</option>
                  {(receivingCostCenterOptions.data?.data ?? []).map((cc) => <option key={cc.id} value={cc.id}>{cc.cost_center_code || cc.id} — {cc.cost_center_name || cc.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                <input type="checkbox" checked={header.has_rebate} onChange={(event) => setHeader((current) => ({ ...current, has_rebate: event.target.checked }))} />
                Has Rebate
              </label>
              {header.has_rebate ? (
                <>
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    Rebate Rate
                    <input type="number" value={header.rebate_rate} onChange={(event) => setHeader((current) => ({ ...current, rebate_rate: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
                  </label>
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    Rebate Rate Basis
                    <input value={header.rebate_rate_uom_basis} onChange={(event) => setHeader((current) => ({ ...current, rebate_rate_uom_basis: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
                  </label>
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    Rebate Remarks
                    <input value={header.rebate_remarks} onChange={(event) => setHeader((current) => ({ ...current, rebate_remarks: event.target.value }))} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
                  </label>
                </>
              ) : null}
              <div className="col-span-full flex items-center justify-end">
                <button
                  type="button"
                  disabled={!canCreate || saving}
                  onClick={() => void handleCreate()}
                  className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Create Settlement Invoice"}
                </button>
              </div>
            </div>
            <ErpDenseGrid
              columns={pendingColumns}
              rows={pendingRows}
              rowKey={(row) => row.grn_id}
              columnFilter
              emptyMessage={pendingQuery.isLoading ? "Loading..." : "No pending CRCP discrepancy rows for this company."}
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3 border border-slate-200 p-3">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Tally Invoice Number
                <input value={lookupNumber} onChange={(event) => setLookupNumber(event.target.value)} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Tally Invoice Date
                <input type="date" value={lookupDate} onChange={(event) => setLookupDate(event.target.value)} className="h-[26px] border border-slate-300 px-2 text-[11px]" />
              </label>
              <button
                type="button"
                onClick={() => void handleLookup()}
                className="h-8 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Check
              </button>
            </div>
            {settledLookupQuery.data?.invoice ? (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-2 border border-slate-200 p-3 text-sm md:grid-cols-4">
                  <div>Settlement No.<strong className="block">{settledLookupQuery.data.invoice.settlement_number}</strong></div>
                  <div>Status<strong className="block">{settledLookupQuery.data.invoice.status}</strong></div>
                  <div>Invoice Qty<strong className="block">{formatQty(settledLookupQuery.data.invoice.invoice_quantity)}</strong></div>
                  <div>Rate per UOM<strong className="block">{settledLookupQuery.data.invoice.rate_per_uom}</strong></div>
                </div>
                <ErpDenseGrid
                  columns={settledColumns}
                  rows={settledLookupQuery.data.covered_grns ?? []}
                  rowKey={(row) => row.id}
                  emptyMessage="No GRNs found."
                />
                {settledLookupQuery.data.invoice.status === "POSTED" ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={reversing}
                      onClick={() => void handleReverse()}
                      className="h-8 border border-rose-600 bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {reversing ? "Reversing..." : "Reverse"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ),
      }}
    />
  );
}
