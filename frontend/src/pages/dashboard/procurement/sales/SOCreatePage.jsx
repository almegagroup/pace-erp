/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113.8 — Sales Order (RM/PM/INT) Stage-1 Create. Reuses
 *          POCreatePage.jsx's architecture (backend-driven options,
 *          ErpComboboxField/ErpDenseGrid table-row line entry, per-line
 *          "More" drawer) — not its PO-only quirks (one-doc-per-material
 *          split, ASL/VMI hard-block, Incoterm). No Approval step (§113.4);
 *          no Storage Location/Cost Center (§113.8 — those move to the DO
 *          stage). Packaging Cost formula per §113.9.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreenWithContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import CustomerCreateForm from "../../om/customer/CustomerCreateForm.jsx";
import {
  useCustomerOptionsQuery,
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { createSalesOrder, listMaterialUomConversionsForProcurement } from "../procurementApi.js";

const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
];
const REBATE_BASIS_OPTIONS = [
  { value: "BASE_UOM", label: "Base UOM" },
  { value: "PO_UOM", label: "PO UOM" },
];
const PACKAGING_GST_OPTIONS = [
  { value: "NO_GST", label: "No GST (separate, like Freight)" },
  { value: "SAME_AS_MATERIAL", label: "Same as Material GST" },
  { value: "CUSTOM", label: "Custom GST Rate" },
];
const SALES_MATERIAL_TYPES = new Set(["RM", "PM", "INT"]);

function createEmptyLine() {
  return {
    material_id: "",
    quantity: "",
    uom_code: "",
    uomOptions: [],
    rate: "",
    discount_pct: "0",
    gst_rate: "",
    freight_term: "FOR",
    remarks: "",
    has_rebate: false,
    rebate_rate: "",
    rebate_rate_uom_basis: "BASE_UOM",
    rebate_remarks: "",
    has_packaging_cost: false,
    packaging_cost_basis: "FLAT",
    packaging_cost_rate: "",
    packaging_gst_treatment: "NO_GST",
    packaging_gst_rate: "",
  };
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatFixed(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "0.00";
}

// Mirrors the backend's computeLineValues (sales_order.handlers.ts) so the
// grid shows a live preview before save.
function computeLinePreview(line) {
  const rate = toNumber(line.rate);
  const discountPct = toNumber(line.discount_pct);
  const quantity = toNumber(line.quantity);
  const gstRate = toNumber(line.gst_rate);
  const netRate = rate * (1 - discountPct / 100);
  const baseValue = netRate * quantity;

  let packagingCostAmount = 0;
  if (line.has_packaging_cost && line.packaging_cost_rate !== "") {
    const packagingRate = toNumber(line.packaging_cost_rate);
    packagingCostAmount = line.packaging_cost_basis === "PER_KG" ? packagingRate * quantity : packagingRate;
  }

  const treatment = line.has_packaging_cost ? line.packaging_gst_treatment : "NO_GST";
  if (packagingCostAmount <= 0 || treatment === "NO_GST") {
    const taxableValue = baseValue;
    const gstAmount = taxableValue * gstRate / 100;
    return { netRate, packagingCostAmount, taxableValue, gstAmount, totalValue: taxableValue + gstAmount + packagingCostAmount };
  }
  if (treatment === "SAME_AS_MATERIAL") {
    const taxableValue = baseValue + packagingCostAmount;
    const gstAmount = taxableValue * gstRate / 100;
    return { netRate, packagingCostAmount, taxableValue, gstAmount, totalValue: taxableValue + gstAmount };
  }
  // CUSTOM
  const packagingGstRate = toNumber(line.packaging_gst_rate);
  const baseGstAmount = baseValue * gstRate / 100;
  const packagingGstAmount = packagingCostAmount * packagingGstRate / 100;
  const taxableValue = baseValue + packagingCostAmount;
  return {
    netRate,
    packagingCostAmount,
    taxableValue,
    gstAmount: baseGstAmount + packagingGstAmount,
    totalValue: baseValue + packagingCostAmount + baseGstAmount + packagingGstAmount,
  };
}

function LineMoreDrawer({ line, visible, onClose, onChange }) {
  if (!line) return null;
  return (
    <DrawerBase
      visible={visible}
      title="Line Details — Freight, Rebate, Packaging"
      onEscape={onClose}
      onClose={onClose}
      width="min(480px, calc(100vw - 24px))"
      actions={
        <button
          type="button"
          onClick={onClose}
          className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950"
        >
          Done
        </button>
      }
    >
      <div className="grid gap-4">
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Freight Term
          <select
            value={line.freight_term}
            onChange={(event) => onChange({ freight_term: event.target.value })}
            className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
          >
            <option value="">Select freight term</option>
            {FREIGHT_TERM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Remarks
          <textarea
            rows={3}
            value={line.remarks}
            onChange={(event) => onChange({ remarks: event.target.value })}
            className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </label>

        <div className="grid gap-1 text-xs font-semibold text-slate-700">
          <span>Has Rebate</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onChange({ has_rebate: true })} className={`px-3 py-2 text-xs font-semibold ${line.has_rebate ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>Yes</button>
            <button type="button" onClick={() => onChange({ has_rebate: false, rebate_rate: "", rebate_remarks: "" })} className={`px-3 py-2 text-xs font-semibold ${!line.has_rebate ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
          </div>
        </div>
        {line.has_rebate ? (
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Rebate Rate
              <input type="number" min="0" step="0.0001" value={line.rebate_rate} onChange={(event) => onChange({ rebate_rate: event.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Basis
              <select value={line.rebate_rate_uom_basis} onChange={(event) => onChange({ rebate_rate_uom_basis: event.target.value })} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                {REBATE_BASIS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Rebate Remarks
              <textarea rows={2} value={line.rebate_remarks} onChange={(event) => onChange({ rebate_remarks: event.target.value })} className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
          </div>
        ) : null}

        <div className="grid gap-1 text-xs font-semibold text-slate-700">
          <span>Has Packaging Cost</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onChange({ has_packaging_cost: true })} className={`px-3 py-2 text-xs font-semibold ${line.has_packaging_cost ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>Yes</button>
            <button type="button" onClick={() => onChange({ has_packaging_cost: false, packaging_cost_rate: "" })} className={`px-3 py-2 text-xs font-semibold ${!line.has_packaging_cost ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
          </div>
        </div>
        {line.has_packaging_cost ? (
          <div className="grid gap-3">
            <div className="grid gap-1 text-xs font-semibold text-slate-700">
              <span>Basis</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onChange({ packaging_cost_basis: "FLAT" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${line.packaging_cost_basis === "FLAT" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Flat (whole line)</button>
                <button type="button" onClick={() => onChange({ packaging_cost_basis: "PER_KG" })} className={`flex-1 px-3 py-2 text-xs font-semibold ${line.packaging_cost_basis === "PER_KG" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Per KG (× qty)</button>
              </div>
            </div>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Packaging Cost Rate
              <input type="number" min="0" step="0.0001" value={line.packaging_cost_rate} onChange={(event) => onChange({ packaging_cost_rate: event.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              GST Treatment
              <select value={line.packaging_gst_treatment} onChange={(event) => onChange({ packaging_gst_treatment: event.target.value })} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                {PACKAGING_GST_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {line.packaging_gst_treatment === "CUSTOM" ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Packaging GST Rate %
                <input type="number" min="0" step="0.01" value={line.packaging_gst_rate} onChange={(event) => onChange({ packaging_gst_rate: event.target.value })} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </DrawerBase>
  );
}

export default function SOCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [form, setForm] = useState({
    company_id: runtimeContext?.selectedCompanyId || "",
    customer_id: "",
    customer_po_number: "",
    customer_po_date: "",
    delivery_address: "",
    payment_term_id: "",
    remarks: "",
  });
  const [lines, setLines] = useState([createEmptyLine()]);
  const [lineMoreIndex, setLineMoreIndex] = useState(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({
      value: entry.id,
      label: entry.company_name || entry.company_code || entry.id,
    })),
    [runtimeContext?.availableCompanies]
  );

  // §113.6 — Customer dropdown is scoped to the selected company via
  // customer_company_map (listCustomersHandler now honors company_id).
  const customerQuery = useCustomerOptionsQuery(
    { company_id: form.company_id, limit: 200, offset: 0, status: "ACTIVE" },
    { enabled: Boolean(form.company_id) }
  );
  const materialQuery = useMaterialOptionsQuery({ limit: 300, offset: 0, status: "ACTIVE" });
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const customers = customerQuery.customers;
  const materials = materialQuery.materials;
  const paymentTerms = paymentTermQuery.paymentTerms;
  const loading = materialQuery.isLoading || paymentTermQuery.isLoading;

  const customerOptions = useMemo(
    () => customers.map((entry) => ({
      value: entry.id,
      label: `${entry.customer_code || ""} — ${entry.customer_name || ""}`.trim(),
    })),
    [customers]
  );
  const materialOptions = useMemo(
    () => materials
      .filter((entry) => SALES_MATERIAL_TYPES.has(String(entry.material_type || "").toUpperCase()))
      .map((entry) => ({ value: entry.id, label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim() })),
    [materials]
  );
  const materialMap = useMemo(() => new Map(materials.map((entry) => [entry.id, entry])), [materials]);
  const paymentTermOptions = useMemo(
    () => paymentTerms.map((entry) => ({ value: entry.id, label: `${entry.code || entry.name} | ${entry.name}` })),
    [paymentTerms]
  );

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  async function handleMaterialSelect(index, materialId) {
    const material = materialMap.get(materialId);
    updateLine(index, { material_id: materialId, uom_code: material?.base_uom_code || "", uomOptions: [], gst_rate: lines[index].gst_rate || String(material?.gst_rate ?? "") });
    if (!materialId) return;
    try {
      const result = await listMaterialUomConversionsForProcurement(materialId);
      const conversions = Array.isArray(result?.data) ? result.data : [];
      const baseUom = material?.base_uom_code || "";
      const codes = new Set([baseUom]);
      for (const row of conversions) {
        if (row.to_uom_code === baseUom && row.from_uom_code) codes.add(row.from_uom_code);
        if (row.from_uom_code === baseUom && row.to_uom_code) codes.add(row.to_uom_code);
      }
      updateLine(index, { uomOptions: Array.from(codes).filter(Boolean) });
    } catch {
      // No conversions defined for this material — fall back to base UOM only.
    }
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_entry, lineIndex) => lineIndex !== index)));
    setLineMoreIndex((current) => (current === index ? null : current != null && current > index ? current - 1 : current));
  }

  function handleCustomerCreated(customer) {
    if (customer?.id) {
      updateHeaderField("customer_id", customer.id);
      customerQuery.refetch?.();
    }
    setShowCustomerModal(false);
  }

  async function handleSubmit() {
    if (!form.company_id || !form.customer_id || !form.customer_po_number.trim()) {
      setError("Company, customer, and customer PO number are required.");
      return;
    }
    if (lines.some((line) => !line.material_id || !line.quantity || !line.rate)) {
      setError("Each SO line requires material, quantity, and rate.");
      return;
    }
    if (lines.some((line) => line.has_packaging_cost && line.packaging_gst_treatment === "CUSTOM" && line.packaging_gst_rate === "")) {
      setError("Custom packaging GST rate is required where selected.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createSalesOrder({
        company_id: form.company_id,
        customer_id: form.customer_id,
        customer_po_number: form.customer_po_number.trim(),
        customer_po_date: form.customer_po_date || null,
        delivery_address: form.delivery_address.trim() || null,
        payment_term_id: form.payment_term_id || null,
        remarks: form.remarks.trim() || null,
        lines: lines.map((line) => ({
          material_id: line.material_id,
          quantity: Number(line.quantity),
          uom_code: line.uom_code || null,
          rate: Number(line.rate),
          discount_pct: Number(line.discount_pct || 0),
          gst_rate: line.gst_rate === "" ? null : Number(line.gst_rate),
          freight_term: line.freight_term || null,
          remarks: line.remarks || null,
          has_rebate: line.has_rebate,
          rebate_rate: line.has_rebate && line.rebate_rate !== "" ? Number(line.rebate_rate) : null,
          rebate_rate_uom_basis: line.has_rebate ? line.rebate_rate_uom_basis : null,
          rebate_remarks: line.has_rebate ? line.rebate_remarks || null : null,
          packaging_cost_basis: line.has_packaging_cost ? line.packaging_cost_basis : null,
          packaging_cost_rate: line.has_packaging_cost && line.packaging_cost_rate !== "" ? Number(line.packaging_cost_rate) : null,
          packaging_gst_treatment: line.has_packaging_cost ? line.packaging_gst_treatment : null,
          packaging_gst_rate: line.has_packaging_cost && line.packaging_gst_treatment === "CUSTOM" && line.packaging_gst_rate !== "" ? Number(line.packaging_gst_rate) : null,
        })),
      });
      setNotice("Sales order created.");
      openScreenWithContext(OPERATION_SCREENS.PROC_SO_DETAIL.screen_code, { id: created?.id, refreshOnReturn: true });
      navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_SO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const netTotal = lines.reduce((sum, line) => sum + computeLinePreview(line).totalValue, 0);
  const activeLineForDrawer = lineMoreIndex != null ? lines[lineMoreIndex] : null;

  const lineColumns = [
    {
      key: "material_id",
      label: "Material",
      width: "240px",
      render: (_row, index) => (
        <ErpComboboxField
          value={lines[index].material_id}
          onChange={(value) => void handleMaterialSelect(index, value)}
          options={materialOptions}
          blankLabel="Select RM / PM / INT material"
        />
      ),
    },
    {
      key: "quantity",
      label: "Qty",
      width: "90px",
      render: (_row, index) => (
        <input type="number" min="0" step="0.0001" value={lines[index].quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
      ),
    },
    {
      key: "uom_code",
      label: "UOM",
      width: "90px",
      render: (_row, index) => {
        const options = lines[index].uomOptions || [];
        if (options.length === 0) {
          return <input value={lines[index].uom_code} readOnly placeholder="Select material" className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none" />;
        }
        return (
          <select value={lines[index].uom_code} onChange={(event) => updateLine(index, { uom_code: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
            {options.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        );
      },
    },
    {
      key: "rate",
      label: "Rate",
      width: "90px",
      render: (_row, index) => (
        <input type="number" min="0" step="0.0001" value={lines[index].rate} onChange={(event) => updateLine(index, { rate: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
      ),
    },
    {
      key: "discount_pct",
      label: "Disc %",
      width: "80px",
      render: (_row, index) => (
        <input type="number" min="0" max="100" step="0.01" value={lines[index].discount_pct} onChange={(event) => updateLine(index, { discount_pct: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
      ),
    },
    {
      key: "gst_rate",
      label: "GST %",
      width: "80px",
      render: (_row, index) => (
        <input type="number" min="0" step="0.01" value={lines[index].gst_rate} onChange={(event) => updateLine(index, { gst_rate: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
      ),
    },
    {
      key: "net_rate",
      label: "Net Rate",
      width: "90px",
      render: (_row, index) => formatFixed(computeLinePreview(lines[index]).netRate, 4),
    },
    {
      key: "line_value",
      label: "Line Value",
      width: "100px",
      align: "right",
      render: (_row, index) => formatFixed(computeLinePreview(lines[index]).taxableValue),
    },
    {
      key: "gst_amount",
      label: "GST Amt",
      width: "90px",
      align: "right",
      render: (_row, index) => formatFixed(computeLinePreview(lines[index]).gstAmount),
    },
    {
      key: "actions",
      label: "",
      width: "150px",
      render: (_row, index) => (
        <div className="flex gap-2">
          <button type="button" onClick={() => setLineMoreIndex(index)} className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">More</button>
          <button type="button" onClick={() => removeLine(index)} disabled={lines.length === 1} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50">Remove</button>
        </div>
      ),
    },
  ];

  const lineRows = lines.map((line, index) => ({ ...line, __index: index }));

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Procurement"
        title="Create Sales Order"
        actions={[
          { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
          { key: "save", label: saving ? "Saving..." : "Create SO", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
        ]}
        notices={[
          ...(error ? [{ key: "so-create-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "so-create-notice", tone: "success", message: notice }] : []),
        ]}
      >
        {loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading sales order master data...</div>
        ) : (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="SO Header" title="Customer and order basics — no approval required (§113.4)">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Company <span className="text-rose-500">*</span>
                  <select value={form.company_id} onChange={(event) => { updateHeaderField("company_id", event.target.value); updateHeaderField("customer_id", ""); }} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    <option value="">Select company</option>
                    {companyOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                </label>
                <ErpDenseFormRow label="Customer" required>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <ErpComboboxField
                        value={form.customer_id}
                        onChange={(value) => updateHeaderField("customer_id", value)}
                        options={customerOptions}
                        blankLabel={form.company_id ? "Select customer" : "Select company first"}
                      />
                    </div>
                    <button type="button" onClick={() => setShowCustomerModal(true)} disabled={!form.company_id} className="h-8 whitespace-nowrap border border-sky-300 bg-sky-50 px-2 text-xs font-semibold text-sky-900 disabled:opacity-50">+ New</button>
                  </div>
                </ErpDenseFormRow>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Customer PO Number <span className="text-rose-500">*</span>
                  <input value={form.customer_po_number} onChange={(event) => updateHeaderField("customer_po_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Customer PO Date
                  <input type="date" value={form.customer_po_date} onChange={(event) => updateHeaderField("customer_po_date", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Payment Term
                  <select value={form.payment_term_id} onChange={(event) => updateHeaderField("payment_term_id", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    <option value="">Select payment term</option>
                    {paymentTermOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
                  Delivery Address
                  <textarea rows={2} value={form.delivery_address} onChange={(event) => updateHeaderField("delivery_address", event.target.value)} className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
                  Remarks
                  <textarea rows={2} value={form.remarks} onChange={(event) => updateHeaderField("remarks", event.target.value)} className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
              </div>
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Materials"
              title="RM / PM / INT only — Storage Location and Cost Center are set later at Delivery Order stage (§113.8)"
              actions={[{ key: "add-line", label: "+ Add Material", tone: "primary", onClick: addLine }]}
            >
              <ErpDenseGrid
                columns={lineColumns}
                rows={lineRows}
                rowKey={(row) => row.__index}
                maxHeight="420px"
                emptyMessage="No materials yet — click Add Material."
                summaryRow={{ label: "Total", values: { gst_amount: formatFixed(netTotal) } }}
              />
            </ErpSectionCard>
          </div>
        )}
      </ErpScreenScaffold>

      <LineMoreDrawer
        line={activeLineForDrawer}
        visible={lineMoreIndex != null}
        onClose={() => setLineMoreIndex(null)}
        onChange={(patch) => { if (lineMoreIndex != null) updateLine(lineMoreIndex, patch); }}
      />

      <DrawerBase
        visible={showCustomerModal}
        title="New RM/PM Sales Customer"
        onEscape={() => setShowCustomerModal(false)}
        onClose={() => setShowCustomerModal(false)}
        width="min(560px, calc(100vw - 24px))"
      >
        <CustomerCreateForm
          companyMode="LOCKED"
          lockedCompanyId={form.company_id}
          onSaved={handleCustomerCreated}
          onCancel={() => setShowCustomerModal(false)}
          submitLabel="Create Customer"
        />
      </DrawerBase>
    </>
  );
}
