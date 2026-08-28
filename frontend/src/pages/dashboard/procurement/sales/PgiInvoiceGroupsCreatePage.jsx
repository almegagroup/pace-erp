/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/PgiInvoiceGroupsCreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §133.13 -- IBN-driven multi-invoice PGI/Invoice generation.
 *          Supersedes PgiInvoiceCreatePage.jsx (1-DO=1-Invoice, §113.15) for
 *          any DO created via the §133.12 multi-source engine -- that older
 *          page still exists untouched (additive pattern) for historical
 *          single-source DOs reachable via the legacy route.
 *          Reached from SalesInvoiceListPage.jsx's per-row "PGI & Invoice"
 *          action -- dcId arrives via screen-stack context. That queue page
 *          already fulfills the design's "SO02 -> Generate Invoice -> DO
 *          Number দিলে" entry step, so Page 1 here is DO review (not a
 *          second number-entry step); direct/refreshed access with no
 *          context shows a short notice pointing back to the queue instead
 *          of duplicating a DO search box.
 *          Page 1: DO review (header + lines, read-only, matches the
 *          design's "সেই DO-র সব details ... table আকারে").
 *          Page 2: Invoice-group table (one row per IBN/FO/SO/STO group,
 *          per feasibility §133.13's locked IBN grouping rule) + per-row
 *          drawer -- Invoice preview mapping, Freight, Additional Cost,
 *          Round Off, live total. "Post Goods & Create Invoice" posts every
 *          group in one DO-level action.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { getActiveScreenContext, openScreenWithContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createAdditionalCostCategory,
  getDeliveryOrderUnified,
  listAdditionalCostCategories,
  listDeliveryOrders,
  postPgiInvoiceGroups,
  previewInvoiceGroups,
} from "../procurementApi.js";

const EXCLUSIVE_FREIGHT_TERMS = new Set(["FREIGHT_SEPARATE", "FREIGHT_AT_ACTUALS", "EX_TRANSPORTER_GODOWN"]);

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
function formatFixed(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : (0).toFixed(digits);
}
function makeKey() {
  return Math.random().toString(36).slice(2);
}

function defaultGroupInput(group) {
  return {
    tally_invoice_number: "",
    tally_invoice_date: "",
    inbound_number: "",
    e_way_bill_applicable: false,
    e_way_bill_number: "",
    freight: { included: false, mode: "AD_HOC", amount: "", rate: "", gst_included: false, gst_treatment: "EXCLUSIVE", gst_rate: "" },
    additional_costs: [],
    remarks: "",
    __groupSnapshot: group,
  };
}

// Live client-side preview only -- the server always recomputes this
// authoritatively at post time (§133.13's own locked note: "live-
// recalculated Total Value" is a UI convenience, never trusted for the
// actual posting).
function computeGroupPreviewTotal(group, input) {
  const freightEligible = Boolean(group.freight_term && EXCLUSIVE_FREIGHT_TERMS.has(group.freight_term));
  const freight = input.freight || {};
  let freightContribution = 0;
  if (freightEligible && freight.included) {
    const amount = freight.mode === "RATE" ? toNumber(freight.rate) * group.net_weight : toNumber(freight.amount);
    let gstAmt = 0;
    if (freight.gst_included) {
      const rate = toNumber(freight.gst_rate);
      gstAmt = freight.gst_treatment === "INCLUSIVE" ? amount - amount / (1 + rate / 100) : amount * (rate / 100);
    }
    freightContribution = amount + (freight.gst_included && freight.gst_treatment === "EXCLUSIVE" ? gstAmt : 0);
  }
  const additionalTotal = (input.additional_costs || []).reduce((sum, ac) => {
    const amount = toNumber(ac.amount);
    if (!ac.gst_included) return sum + amount;
    const rate = toNumber(ac.gst_rate);
    const gstAmt = ac.gst_treatment === "INCLUSIVE" ? amount - amount / (1 + rate / 100) : amount * (rate / 100);
    return sum + (ac.gst_treatment === "EXCLUSIVE" ? amount + gstAmt : amount);
  }, 0);
  const preRound = group.total_taxable_value + group.total_gst_amount + freightContribution + additionalTotal;
  const total = Math.round(preRound * 100) / 100;
  return { preRound, total, roundOff: Number((total - preRound).toFixed(4)), freightContribution, additionalTotal };
}

// §133.13's per-row field mapping is validated the same way both here and
// at final submit (allGroupsReady) -- kept as one function so "Save & Next"
// can never advance a row that would later fail server-side validation.
function groupInputIsValid(group, input) {
  if (!input) return false;
  if (!input.tally_invoice_number.trim() || !input.tally_invoice_date) return false;
  if (group.ibn_required && !input.inbound_number.trim()) return false;
  return true;
}

function InvoiceGroupDrawer({ group, input, dc, paymentTermLabel, onChange, onFreightChange, onAddAdditionalCost, onUpdateAdditionalCost, onRemoveAdditionalCost, categories, onCategoryCreated, onClose, onSaveNext, hasNext }) {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [validationError, setValidationError] = useState("");
  const freightEligible = Boolean(group.freight_term && EXCLUSIVE_FREIGHT_TERMS.has(group.freight_term));
  const totals = computeGroupPreviewTotal(group, input);
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.category_name }));

  function handleSaveNext() {
    if (!groupInputIsValid(group, input)) {
      setValidationError(group.ibn_required && !input.inbound_number.trim()
        ? "Tally Invoice Number/Date and Inbound Number (IBN) are required before moving on."
        : "Tally Invoice Number and Date are required before moving on.");
      return;
    }
    setValidationError("");
    onSaveNext();
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    try {
      const created = await createAdditionalCostCategory({ category_name: name });
      onCategoryCreated(created);
      setNewCategoryName("");
    } catch {
      // silently ignored -- category list refetch on next open will show any
      // real server-side duplicate anyway, no need for a second error surface here
    } finally {
      setCreatingCategory(false);
    }
  }

  return (
    <DrawerBase visible title={`${group.document_number || "Invoice group"} — Preview, Freight & Additional Cost`} onEscape={onClose} onClose={onClose} width="min(760px, calc(100vw - 24px))">
      <div className="grid gap-4">
        <div className="grid gap-2 border border-slate-200 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Invoice Preview (sample tax-invoice field mapping, §133.13 — print template design deferred to its own session)</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-slate-500">Invoice No. / Dated</span><div>{input.tally_invoice_number || "—"} / {input.tally_invoice_date || "—"}</div></div>
            <div><span className="text-slate-500">PACE Invoice Number</span><div className="italic text-slate-400">Auto-generated on Post</div></div>
            <div><span className="text-slate-500">Delivery Note / Date</span><div>{input.tally_invoice_number || "—"} / {input.tally_invoice_date || "—"}</div></div>
            <div><span className="text-slate-500">Dispatch Doc No / Dispatched Through</span><div>{dc?.transporter_display || "—"}</div></div>
            <div><span className="text-slate-500">Bill of Lading / LR-RR No + Dated</span><div>{dc?.lr_number ? `${dc.lr_number} / ${dc.lr_date || "—"}` : "—"}</div></div>
            <div><span className="text-slate-500">Reference No. &amp; Date / Buyer's Order No (FO)</span><div>{group.fo_number ? `${group.fo_number} / ${group.fo_date || "—"}` : "—"}</div></div>
            {group.ibn_required ? <div><span className="text-slate-500">Other References (IBN)</span><div>{input.inbound_number || "—"}</div></div> : null}
            <div><span className="text-slate-500">e-Way Bill No.</span><div>{input.e_way_bill_applicable ? (input.e_way_bill_number || "(pending entry)") : "—"}</div></div>
            <div><span className="text-slate-500">Mode/Terms of Payment</span><div>{paymentTermLabel || "—"}</div></div>
            <div><span className="text-slate-500">Motor Vehicle No.</span><div>{dc?.vehicle_number || "—"}</div></div>
            <div><span className="text-slate-500">Destination</span><div>{group.ship_to?.address || group.ship_to?.name || "—"}</div></div>
            <div><span className="text-slate-500">GST Type</span><div>{group.gst_type === "CGST_SGST" ? "CGST + SGST" : "IGST"}</div></div>
            <div><span className="text-slate-500">Bill-To</span><div>{group.bill_to?.name || "—"}<br />{group.bill_to?.address || ""}<br />{group.bill_to?.state || ""} {group.bill_to?.gst_number ? `(GST ${group.bill_to.gst_number})` : ""}</div></div>
            <div><span className="text-slate-500">Ship-To</span><div>{group.ship_to?.name || "—"}<br />{group.ship_to?.address || ""}<br />{group.ship_to?.state || ""} {group.ship_to?.gst_number ? `(GST ${group.ship_to.gst_number})` : ""}</div></div>
          </div>
          <div className="text-[10px] text-slate-400">IRN / Ack No. / Ack Date — out of scope (future GST e-invoice/Tally integration).</div>
          <ErpDenseGrid
            cellNavigate
            columns={[
              { key: "material_display", label: "Item", render: (l) => l.material_display || l.material_id },
              { key: "quantity", label: "Qty", width: "90px", align: "right", render: (l) => `${formatFixed(l.quantity, 3)} ${l.uom_code || ""}` },
              { key: "unit_value", label: "Rate", width: "90px", align: "right", render: (l) => formatFixed(l.unit_value, 4) },
              { key: "line_total", label: "Line Total", width: "100px", align: "right", render: (l) => formatFixed(l.line_total) },
            ]}
            rows={group.lines}
            rowKey={(l) => l.dc_line_id}
            emptyMessage="No lines."
          />
        </div>

        <div className="grid gap-2 border border-slate-200 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Tally / e-Way Bill</div>
          <div className="grid gap-3 md:grid-cols-2">
            <ErpDenseFormRow label="Tally Invoice Number" required>
              <input value={input.tally_invoice_number} onChange={(e) => onChange({ tally_invoice_number: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Tally Invoice Date" required>
              <input type="date" value={input.tally_invoice_date} onChange={(e) => onChange({ tally_invoice_date: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </ErpDenseFormRow>
            {group.ibn_required ? (
              <ErpDenseFormRow label="Inbound Number (IBN)" required>
                <input value={input.inbound_number} onChange={(e) => onChange({ inbound_number: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
            ) : null}
            <div className="grid gap-1 text-xs font-semibold text-slate-700">
              <span>e-Way Bill?</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onChange({ e_way_bill_applicable: true })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.e_way_bill_applicable ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>Yes</button>
                <button type="button" onClick={() => onChange({ e_way_bill_applicable: false, e_way_bill_number: "" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${!input.e_way_bill_applicable ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
              </div>
            </div>
            {input.e_way_bill_applicable ? (
              <ErpDenseFormRow label="e-Way Bill Number">
                <input value={input.e_way_bill_number} onChange={(e) => onChange({ e_way_bill_number: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
            ) : null}
          </div>
        </div>

        {freightEligible ? (
          <div className="grid gap-2 border border-slate-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Freight (Other than Order Rate?)</div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onFreightChange({ included: true })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.freight.included ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>Yes</button>
              <button type="button" onClick={() => onFreightChange({ included: false })} className={`flex-1 px-3 py-2 text-xs font-semibold ${!input.freight.included ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
            </div>
            {input.freight.included ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1 text-xs font-semibold text-slate-700">
                  <span>Mode</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onFreightChange({ mode: "AD_HOC" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.freight.mode === "AD_HOC" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Ad Hoc</button>
                    <button type="button" onClick={() => onFreightChange({ mode: "RATE" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.freight.mode === "RATE" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Rate</button>
                  </div>
                </div>
                {input.freight.mode === "RATE" ? (
                  <ErpDenseFormRow label={`Rate (x Net Weight ${formatFixed(group.net_weight, 3)})`}>
                    <input type="number" step="0.0001" value={input.freight.rate} onChange={(e) => onFreightChange({ rate: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                ) : (
                  <ErpDenseFormRow label="Amount">
                    <input type="number" step="0.01" value={input.freight.amount} onChange={(e) => onFreightChange({ amount: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                )}
                <div className="grid gap-1 text-xs font-semibold text-slate-700">
                  <span>GST on Freight?</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onFreightChange({ gst_included: true })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.freight.gst_included ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>Yes</button>
                    <button type="button" onClick={() => onFreightChange({ gst_included: false })} className={`flex-1 px-3 py-2 text-xs font-semibold ${!input.freight.gst_included ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
                  </div>
                </div>
                {input.freight.gst_included ? (
                  <>
                    <div className="grid gap-1 text-xs font-semibold text-slate-700">
                      <span>Treatment</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => onFreightChange({ gst_treatment: "INCLUSIVE" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.freight.gst_treatment === "INCLUSIVE" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Inclusive</button>
                        <button type="button" onClick={() => onFreightChange({ gst_treatment: "EXCLUSIVE" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${input.freight.gst_treatment === "EXCLUSIVE" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Exclusive</button>
                      </div>
                    </div>
                    <ErpDenseFormRow label="GST Rate %">
                      <input type="number" step="0.01" value={input.freight.gst_rate} onChange={(e) => onFreightChange({ gst_rate: e.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </ErpDenseFormRow>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2 border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Additional Cost</div>
            <button type="button" onClick={onAddAdditionalCost} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950">+ Add Line</button>
          </div>
          {(input.additional_costs || []).map((line) => (
            <div key={line.__key} className="grid grid-cols-[1fr_100px_70px_90px_70px_36px] items-center gap-2 border border-slate-200 bg-white px-2 py-1.5">
              <ErpComboboxField value={line.category_id} onChange={(v) => onUpdateAdditionalCost(line.__key, { category_id: v })} options={categoryOptions} blankLabel="Select category" />
              <input type="number" step="0.01" placeholder="Amount" value={line.amount} onChange={(e) => onUpdateAdditionalCost(line.__key, { amount: e.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
              <button type="button" onClick={() => onUpdateAdditionalCost(line.__key, { gst_included: !line.gst_included })} className={`h-8 text-[11px] font-semibold ${line.gst_included ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>GST {line.gst_included ? "Y" : "N"}</button>
              {line.gst_included ? (
                <>
                  <select value={line.gst_treatment} onChange={(e) => onUpdateAdditionalCost(line.__key, { gst_treatment: e.target.value })} className="h-8 w-full border border-slate-300 bg-white px-1 text-[11px] text-slate-900 outline-none">
                    <option value="EXCLUSIVE">Exclusive</option>
                    <option value="INCLUSIVE">Inclusive</option>
                  </select>
                  <input type="number" step="0.01" placeholder="%" value={line.gst_rate} onChange={(e) => onUpdateAdditionalCost(line.__key, { gst_rate: e.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none" />
                </>
              ) : <div className="col-span-2" />}
              <button type="button" onClick={() => onRemoveAdditionalCost(line.__key)} className="h-8 border border-rose-300 bg-white text-[11px] font-semibold text-rose-700">✕</button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="+ New category name" className="h-8 flex-1 border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
            <button type="button" disabled={!newCategoryName.trim() || creatingCategory} onClick={() => void handleCreateCategory()} className="h-8 border border-sky-700 bg-sky-100 px-3 text-[11px] font-semibold text-sky-950 disabled:opacity-50">Add</button>
          </div>
        </div>

        <div className="grid gap-1 text-sm text-slate-800 md:max-w-sm md:justify-self-end">
          <div className="flex justify-between"><span className="text-slate-500">Taxable Value</span><span className="font-mono">{formatFixed(group.total_taxable_value)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">GST (Items)</span><span className="font-mono">{formatFixed(group.total_gst_amount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Freight</span><span className="font-mono">{formatFixed(totals.freightContribution)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Additional Cost</span><span className="font-mono">{formatFixed(totals.additionalTotal)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Round Off</span><span className="font-mono">{totals.roundOff >= 0 ? "+" : "-"}{formatFixed(Math.abs(totals.roundOff), 4)}</span></div>
          <div className="mt-1 flex justify-between border-t border-slate-300 pt-1 text-base font-bold"><span>Total (preview)</span><span className="font-mono">{formatFixed(totals.total)}</span></div>
        </div>

        {validationError ? <div className="text-xs font-semibold text-rose-700">{validationError}</div> : null}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">Close (without validating)</button>
          <button type="button" onClick={handleSaveNext} className="flex-1 border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white">
            {hasNext ? "Save & Next Row →" : "Save & Close"}
          </button>
        </div>
      </div>
    </DrawerBase>
  );
}

export default function PgiInvoiceGroupsCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const contextDcId = getActiveScreenContext()?.dcId || "";
  // §133.13 Page 1 -- "SO02-তে ঢুকে Generate Invoice → DO Number দিলে". The
  // normal path is via SalesInvoiceListPage's own row action (context
  // already resolves dcId, page starts at 1/DO-review). This state also
  // supports the design's literal manual-entry path (page 0) for a direct/
  // bookmarked/refreshed open with no context.
  const [dcId, setDcId] = useState(contextDcId);
  const [page, setPage] = useState(contextDcId ? 1 : 0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [groupInputs, setGroupInputs] = useState({});
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  const [doPickerCompanyId, setDoPickerCompanyId] = useState("");
  const [doPickerSearch, setDoPickerSearch] = useState("");

  const doQuery = useQuery({
    queryKey: ["procurement", "pgi-groups-do", dcId],
    queryFn: () => getDeliveryOrderUnified(dcId),
    enabled: Boolean(dcId),
  });
  const groupsQuery = useQuery({
    queryKey: ["procurement", "pgi-groups-preview", dcId],
    queryFn: () => previewInvoiceGroups(dcId),
    enabled: Boolean(dcId) && page >= 2,
  });
  const categoriesQuery = useQuery({
    queryKey: ["procurement", "additional-cost-categories"],
    queryFn: () => listAdditionalCostCategories(),
  });
  const categories = Array.isArray(categoriesQuery.data) ? categoriesQuery.data : [];
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const paymentTermMap = useMemo(
    () => new Map((paymentTermQuery.paymentTerms ?? []).map((entry) => [entry.id, `${entry.code || entry.name} | ${entry.name}`])),
    [paymentTermQuery.paymentTerms]
  );

  const effectiveDoPickerCompanyId = doPickerCompanyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const doPickerQuery = useQuery({
    queryKey: ["procurement", "pgi-groups-do-picker", effectiveDoPickerCompanyId],
    queryFn: () => listDeliveryOrders({ company_id: effectiveDoPickerCompanyId, status: "CREATED", limit: 200, offset: 0 }),
    enabled: page === 0 && Boolean(effectiveDoPickerCompanyId),
  });
  const doPickerRows = Array.isArray(doPickerQuery.data?.items) ? doPickerQuery.data.items : [];
  const filteredDoPickerRows = doPickerSearch.trim()
    ? doPickerRows.filter((row) => String(row.dc_number || "").toLowerCase().includes(doPickerSearch.trim().toLowerCase()))
    : doPickerRows;

  const dc = doQuery.data ?? null;
  const groups = Array.isArray(groupsQuery.data?.groups) ? groupsQuery.data.groups : [];

  useEffect(() => {
    if (groups.length === 0) return;
    setGroupInputs((current) => {
      const next = { ...current };
      for (const group of groups) {
        if (!next[group.group_key]) next[group.group_key] = defaultGroupInput(group);
      }
      return next;
    });
  }, [groups]);

  function updateGroupInput(groupKey, patch) {
    setGroupInputs((current) => ({ ...current, [groupKey]: { ...current[groupKey], ...patch } }));
  }
  function updateGroupFreight(groupKey, patch) {
    setGroupInputs((current) => ({ ...current, [groupKey]: { ...current[groupKey], freight: { ...current[groupKey].freight, ...patch } } }));
  }
  function addAdditionalCostLine(groupKey) {
    setGroupInputs((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], additional_costs: [...current[groupKey].additional_costs, { __key: makeKey(), category_id: "", amount: "", gst_included: false, gst_treatment: "EXCLUSIVE", gst_rate: "" }] },
    }));
  }
  function updateAdditionalCostLine(groupKey, lineKey, patch) {
    setGroupInputs((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], additional_costs: current[groupKey].additional_costs.map((line) => (line.__key === lineKey ? { ...line, ...patch } : line)) },
    }));
  }
  function removeAdditionalCostLine(groupKey, lineKey) {
    setGroupInputs((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], additional_costs: current[groupKey].additional_costs.filter((line) => line.__key !== lineKey) },
    }));
  }
  function handleCategoryCreated(created) {
    queryClient.setQueryData(["procurement", "additional-cost-categories"], (current) => (Array.isArray(current) ? [...current, created] : [created]));
  }

  async function handlePostAll() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payloadGroups = groups.map((group) => {
        const input = groupInputs[group.group_key] || defaultGroupInput(group);
        const freightEligible = Boolean(group.freight_term && EXCLUSIVE_FREIGHT_TERMS.has(group.freight_term));
        return {
          group_key: group.group_key,
          tally_invoice_number: input.tally_invoice_number,
          tally_invoice_date: input.tally_invoice_date,
          inbound_number: input.inbound_number || undefined,
          e_way_bill_applicable: input.e_way_bill_applicable,
          e_way_bill_number: input.e_way_bill_number || undefined,
          freight: (freightEligible && input.freight.included) ? {
            included: true,
            mode: input.freight.mode,
            amount: input.freight.mode === "AD_HOC" ? Number(input.freight.amount) : undefined,
            rate: input.freight.mode === "RATE" ? Number(input.freight.rate) : undefined,
            gst_included: input.freight.gst_included,
            gst_treatment: input.freight.gst_treatment,
            gst_rate: input.freight.gst_included ? Number(input.freight.gst_rate) : undefined,
          } : { included: false },
          additional_costs: (input.additional_costs || []).map((ac) => ({
            category_id: ac.category_id,
            amount: Number(ac.amount),
            gst_included: ac.gst_included,
            gst_treatment: ac.gst_treatment,
            gst_rate: ac.gst_included ? Number(ac.gst_rate) : undefined,
          })),
          remarks: input.remarks || undefined,
        };
      });
      const result = await postPgiInvoiceGroups(dcId, { groups: payloadGroups });
      const invoices = Array.isArray(result?.invoices) ? result.invoices : [];
      setNotice(`Posted ${invoices.length} invoice(s).`);
      const firstInvoiceId = invoices[0]?.invoice_id;
      if (firstInvoiceId) {
        openScreenWithContext(OPERATION_SCREENS.PROC_INV_DETAIL.screen_code, { id: firstInvoiceId, refreshOnReturn: true });
        navigate(`/dashboard/procurement/sales-invoices/${encodeURIComponent(firstInvoiceId)}`);
      } else {
        navigate("/dashboard/procurement/sales-invoices");
      }
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "PGI_INVOICE_GROUPS_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const activeGroup = groups.find((g) => g.group_key === activeGroupKey) || null;
  const allGroupsReady = groups.length > 0 && groups.every((g) => groupInputIsValid(g, groupInputs[g.group_key]));
  const activeGroupIndex = activeGroup ? groups.findIndex((g) => g.group_key === activeGroup.group_key) : -1;
  const nextGroup = activeGroupIndex >= 0 ? groups[activeGroupIndex + 1] : null;

  function handleSaveNextFromDrawer() {
    setActiveGroupKey(nextGroup ? nextGroup.group_key : null);
  }

  function openDo(id) {
    setDcId(id);
    setPage(1);
  }

  // §133.13 Page 1 — literal "DO Number দিলে" manual entry, for a direct/
  // bookmarked open with no screen-stack context (the normal path is via
  // SalesInvoiceListPage's row action, which skips straight past this).
  if (!dcId) {
    return (
      <ErpScreenScaffold
        eyebrow="Sales (SO02)"
        title="PGI &amp; Invoice — Select Delivery Order"
        actions={[{ key: "back", label: "Back to Queue", tone: "neutral", onClick: () => navigate("/dashboard/procurement/sales-invoices") }]}
      >
        <ErpSectionCard eyebrow="Page 1" title="Generate Invoice — pick a DO not yet PGI'd">
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={doPickerCompanyId} onChange={setDoPickerCompanyId} label="Company" />
              <QuickFilterInput label="DO Number" value={doPickerSearch} onChange={setDoPickerSearch} primaryFocus placeholder="Type DO number to filter" />
            </div>
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "dc_number", label: "DO Number", width: "140px" },
                { key: "source_display", label: "Source", width: "100px", render: (row) => (row.source_display === "SALES_ORDER" ? "Sales Order" : row.source_display === "STO" ? "STO" : "—") },
                { key: "source_document_number", label: "SO / STO Number", width: "140px", render: (row) => row.source_document_number || "—" },
                { key: "customer_display", label: "Customer / Counterparty", render: (row) => row.customer_display || "—" },
                { key: "dc_date", label: "DO Date", width: "110px" },
                { key: "actions", label: "", width: "90px", render: (row) => <button type="button" onClick={() => openDo(row.id)} className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-950">Open</button> },
              ]}
              rows={filteredDoPickerRows}
              rowKey={(row) => row.id}
              onRowActivate={(row) => openDo(row.id)}
              emptyMessage={doPickerQuery.isLoading ? "Loading..." : "No DO pending PGI for this company."}
            />
          </div>
        </ErpSectionCard>
      </ErpScreenScaffold>
    );
  }

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Sales (SO02)"
        title={page === 1 ? `PGI & Invoice — DO Review (${dc?.dc_number || "…"})` : `PGI & Invoice — Invoice Groups (${dc?.dc_number || "…"})`}
        actions={[
          {
            key: "back",
            label: page === 1 ? "Back" : "Previous",
            tone: "neutral",
            onClick: () => {
              if (page === 2) { setPage(1); return; }
              if (contextDcId) { popScreen(); return; }
              setDcId(""); setPage(0);
            },
          },
          page === 2
            ? { key: "post", label: saving ? "Posting..." : "Post Goods & Create Invoice", tone: "primary", onClick: () => void handlePostAll(), disabled: saving || !allGroupsReady }
            : { key: "next", label: "Next — Invoice Groups", tone: "primary", onClick: () => setPage(2), disabled: doQuery.isLoading || !dc },
        ]}
        notices={[
          ...(doQuery.error ? [{ key: "do-error", tone: "error", message: doQuery.error instanceof Error ? doQuery.error.message : "DO_FETCH_FAILED" }] : []),
          ...(groupsQuery.error ? [{ key: "groups-error", tone: "error", message: groupsQuery.error instanceof Error ? groupsQuery.error.message : "PGI_INVOICE_GROUPS_PREVIEW_FAILED" }] : []),
          ...(error ? [{ key: "post-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "post-notice", tone: "success", message: notice }] : []),
        ]}
      >
        {page === 1 ? (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Page 1" title="DO Review — details, rate/amount/GST breakup, storage location (per SO's own qty at this DO)">
              {doQuery.isLoading || !dc ? (
                <div className="px-2 py-6 text-sm text-slate-500">Loading delivery order...</div>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-4 text-sm">
                    <div><span className="text-xs text-slate-500">DO Number</span><div className="font-mono font-semibold">{dc.dc_number}</div></div>
                    <div><span className="text-xs text-slate-500">DO Date</span><div>{dc.dc_date}</div></div>
                    <div><span className="text-xs text-slate-500">Vehicle</span><div>{dc.vehicle_number || "—"}</div></div>
                    <div><span className="text-xs text-slate-500">Transporter</span><div>{dc.transporter_display || "—"}</div></div>
                  </div>
                  <ErpDenseGrid
                    cellNavigate
                    columns={[
                      { key: "source_type", label: "Type", width: "110px", render: (row) => (row.source_type === "SALES_ORDER" ? "Sales Order" : "STO") },
                      { key: "document_number", label: "Document Number", width: "150px" },
                      { key: "document_date", label: "Date", width: "110px" },
                      { key: "party_display", label: "Party", render: (row) => row.party_display || "—" },
                    ]}
                    rows={Array.isArray(dc.sources) ? dc.sources : []}
                    rowKey={(row) => `${row.source_type}:${row.source_id}`}
                    emptyMessage="No source documents."
                  />
                  <ErpDenseGrid
                    cellNavigate
                    columns={[
                      { key: "material_display", label: "Item", render: (row) => row.material_display || row.material_id },
                      { key: "quantity", label: "Qty", width: "100px", align: "right", render: (row) => `${row.quantity} ${row.uom_code || ""}` },
                      { key: "storage_location_display", label: "Storage Location", render: (row) => row.storage_location_display || "—" },
                      { key: "unit_value", label: "Rate", width: "100px", align: "right", render: (row) => formatFixed(row.unit_value, 4) },
                      { key: "gst_rate", label: "GST %", width: "80px", align: "right", render: (row) => (row.gst_rate != null ? formatFixed(row.gst_rate) : "—") },
                      { key: "line_total", label: "Line Total", width: "110px", align: "right", render: (row) => formatFixed(row.line_total) },
                    ]}
                    rows={Array.isArray(dc.lines) ? dc.lines : []}
                    rowKey={(row) => row.id}
                    emptyMessage="No lines."
                  />
                </div>
              )}
            </ErpSectionCard>
          </div>
        ) : (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Page 2" title="Invoice groups — one row per resulting Invoice (§133.13 IBN grouping)">
              {groupsQuery.isLoading ? (
                <div className="px-2 py-6 text-sm text-slate-500">Computing invoice groups...</div>
              ) : (
                <ErpDenseGrid
                  cellNavigate
                  columns={[
                    { key: "source_type", label: "Type", width: "80px", render: (row) => (row.source_type === "SALES_ORDER" ? "SO" : "STO") },
                    { key: "document_number", label: "SO/STO Number", width: "120px" },
                    { key: "document_date", label: "Date", width: "95px" },
                    { key: "dc_number", label: "DO Number", width: "110px", render: () => dc?.dc_number || "—" },
                    { key: "bill_to", label: "Billing Address", render: (row) => (row.bill_to?.name || row.bill_to?.address) ? <span>{row.bill_to?.name}{row.bill_to?.address ? ` — ${row.bill_to.address}` : ""}</span> : "—" },
                    { key: "ship_to", label: "Ship-To Address", render: (row) => (row.ship_to?.name || row.ship_to?.address) ? <span>{row.ship_to?.name}{row.ship_to?.address ? ` — ${row.ship_to.address}` : ""}</span> : "—" },
                    { key: "fo_number", label: "FO / IBN", width: "110px", render: (row) => row.fo_number || (row.ibn_required ? "(non-FO)" : "—") },
                    { key: "inbound_number", label: "Inbound Number", width: "120px", render: (row) => {
                      const input = groupInputs[row.group_key];
                      if (!row.ibn_required) return "—";
                      return input?.inbound_number ? input.inbound_number : <span className="text-rose-600">Required</span>;
                    } },
                    { key: "tally_invoice_number", label: "Tally Invoice Number", width: "140px", render: (row) => {
                      const input = groupInputs[row.group_key];
                      return input?.tally_invoice_number || <span className="text-rose-600">Required</span>;
                    } },
                    { key: "tally_invoice_date", label: "Tally Invoice Date", width: "120px", render: (row) => {
                      const input = groupInputs[row.group_key];
                      return input?.tally_invoice_date || <span className="text-rose-600">Required</span>;
                    } },
                    { key: "total", label: "Total (preview)", width: "120px", align: "right", render: (row) => {
                      const input = groupInputs[row.group_key] || defaultGroupInput(row);
                      return formatFixed(computeGroupPreviewTotal(row, input).total);
                    } },
                    { key: "actions", label: "", width: "90px", render: (row) => (
                      <button type="button" onClick={() => setActiveGroupKey(row.group_key)} className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-950">Open</button>
                    ) },
                  ]}
                  rows={groups}
                  rowKey={(row) => row.group_key}
                  onRowActivate={(row) => setActiveGroupKey(row.group_key)}
                  emptyMessage="No invoice groups -- this DO may have no lines."
                />
              )}
              {!allGroupsReady && groups.length > 0 ? (
                <div className="mt-2 text-xs text-amber-700">Open every row and fill in Tally Invoice Number/Date (and Inbound Number where required) before posting.</div>
              ) : null}
            </ErpSectionCard>
          </div>
        )}
      </ErpScreenScaffold>

      {activeGroup ? (
        <InvoiceGroupDrawer
          group={activeGroup}
          input={groupInputs[activeGroup.group_key] || defaultGroupInput(activeGroup)}
          dc={dc}
          paymentTermLabel={activeGroup.payment_term_id ? (paymentTermMap.get(activeGroup.payment_term_id) || "As per SO Payment Term") : null}
          onChange={(patch) => updateGroupInput(activeGroup.group_key, patch)}
          onFreightChange={(patch) => updateGroupFreight(activeGroup.group_key, patch)}
          onAddAdditionalCost={() => addAdditionalCostLine(activeGroup.group_key)}
          onUpdateAdditionalCost={(lineKey, patch) => updateAdditionalCostLine(activeGroup.group_key, lineKey, patch)}
          onRemoveAdditionalCost={(lineKey) => removeAdditionalCostLine(activeGroup.group_key, lineKey)}
          categories={categories}
          onCategoryCreated={handleCategoryCreated}
          onClose={() => setActiveGroupKey(null)}
          onSaveNext={handleSaveNextFromDrawer}
          hasNext={Boolean(nextGroup)}
        />
      ) : null}
    </>
  );
}
