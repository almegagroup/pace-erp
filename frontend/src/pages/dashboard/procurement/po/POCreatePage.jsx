import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listCostCenters, listMaterials, listVendorMaterialInfos, listVendors } from "../../om/omApi.js";
import {
  createPurchaseOrder,
  listPaymentTerms,
} from "../procurementApi.js";

const DELIVERY_TYPE_OPTIONS = ["STANDARD", "BULK", "TANKER"];
const FREIGHT_TERM_OPTIONS = ["FOR", "FREIGHT_SEPARATE"];

function createEmptyLine() {
  return {
    material_id: "",
    quantity: "",
    uom_code: "",
    rate: "",
    cost_center_id: "",
    delivery_date: "",
    indent_reference: "",
    aslWarning: "",
  };
}

export default function POCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [vendors, setVendors] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [form, setForm] = useState({
    company_id: "",
    vendor_id: "",
    delivery_type: "STANDARD",
    incoterm: "",
    payment_term_id: "",
    freight_term: "FOR",
    remarks: "",
  });
  const [lines, setLines] = useState([createEmptyLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({ value: entry.id, label: entry.company_name || entry.company_code || entry.id })),
    [runtimeContext?.availableCompanies]
  );
  const vendorOptions = useMemo(
    () =>
      vendors.map((entry) => ({
        value: entry.id,
        label: `${entry.vendor_code || ""} ${entry.vendor_name || ""}`.trim(),
      })),
    [vendors]
  );
  const materialOptions = useMemo(
    () =>
      materials.map((entry) => ({
        value: entry.id,
        label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim(),
      })),
    [materials]
  );

  const selectedVendor = useMemo(
    () => vendors.find((entry) => entry.id === form.vendor_id) ?? null,
    [form.vendor_id, vendors]
  );
  const showIncoterm = useMemo(
    () => String(selectedVendor?.vendor_type || "").toUpperCase() === "IMPORT",
    [selectedVendor]
  );
  const indentRequired = selectedVendor?.indent_number_required === true;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [vendorData, paymentData, materialData, costCenterData] = await Promise.all([
          listVendors({ limit: 200, offset: 0, status: "ACTIVE" }),
          listPaymentTerms({ is_active: true }),
          listMaterials({ limit: 200, offset: 0, material_type: "RM" }),
          listCostCenters(),
        ]);
        if (!active) {
          return;
        }
        const vendorRows = Array.isArray(vendorData?.data) ? vendorData.data : [];
        const termRows = Array.isArray(paymentData) ? paymentData : [];
        const materialRows = Array.isArray(materialData?.data) ? materialData.data : [];
        const costCenterRows = Array.isArray(costCenterData?.data) ? costCenterData.data : [];
        setVendors(vendorRows);
        setPaymentTerms(termRows);
        setMaterials(materialRows.filter((entry) => ["RM", "PM"].includes(String(entry.material_type || "").toUpperCase())));
        setCostCenters(costCenterRows);
        setForm((current) => ({
          ...current,
          company_id: current.company_id || runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "",
          payment_term_id: current.payment_term_id || termRows[0]?.id || "",
        }));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PO_SETUP_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [companyOptions, runtimeContext?.selectedCompanyId]);

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
  }

  async function checkApprovedAsl(index) {
    const line = lines[index];
    if (!form.vendor_id || !line?.material_id) {
      return;
    }
    try {
      const result = await listVendorMaterialInfos({
        vendor_id: form.vendor_id,
        material_id: line.material_id,
        status: "ACTIVE",
        limit: 10,
        offset: 0,
      });
      const hasApproved = Array.isArray(result?.data) && result.data.length > 0;
      updateLine(index, {
        aslWarning: hasApproved ? "" : "No approved VMI record exists for this vendor-material pair.",
      });
    } catch {
      updateLine(index, {
        aslWarning: "Unable to verify approved VMI right now.",
      });
    }
  }

  async function handleSubmit() {
    if (!form.company_id || !form.vendor_id || !form.payment_term_id || !form.freight_term) {
      setError("Company, vendor, payment term, and freight term are required.");
      return;
    }
    if (showIncoterm && !form.incoterm.trim()) {
      setError("Incoterm is required for import purchase orders.");
      return;
    }
    if (lines.some((line) => !line.material_id || !line.quantity || !line.rate || !line.cost_center_id)) {
      setError("Each PO line requires material, quantity, rate, and cost center.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        company_id: form.company_id,
        vendor_id: form.vendor_id,
        vendor_type: String(selectedVendor?.vendor_type || "DOMESTIC").toUpperCase(),
        delivery_type: form.delivery_type,
        incoterm: showIncoterm ? form.incoterm.trim() : null,
        payment_term_id: form.payment_term_id,
        freight_term: form.freight_term,
        remarks: form.remarks.trim() || null,
        lines: lines.map((line) => ({
          material_id: line.material_id,
          ordered_qty: Number(line.quantity),
          uom_code: line.uom_code || null,
          unit_rate: Number(line.rate),
          cost_center_id: line.cost_center_id,
          delivery_date: line.delivery_date || null,
          indent_reference: indentRequired ? line.indent_reference || null : null,
        })),
      };
      const created = await createPurchaseOrder(payload);
      setNotice("Purchase order created.");
      navigate(`/dashboard/procurement/purchase-orders/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Procurement"
      title="Create Purchase Order"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Create PO", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={[
        ...(error ? [{ key: "po-create-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "po-create-notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="PO Header"
      formTitle="Create a new purchase order"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading procurement master data...
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="Company" required>
                <select
                  value={form.company_id}
                  onChange={(event) => updateHeaderField("company_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company</option>
                  {companyOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Vendor" required>
                <ErpComboboxField
                  value={form.vendor_id}
                  onChange={(value) => updateHeaderField("vendor_id", value)}
                  options={vendorOptions}
                  blankLabel="Select vendor"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Delivery Type" required>
                <select
                  value={form.delivery_type}
                  onChange={(event) => updateHeaderField("delivery_type", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {DELIVERY_TYPE_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              {showIncoterm ? (
                <ErpDenseFormRow label="Incoterm" required>
                  <input
                    value={form.incoterm}
                    onChange={(event) => updateHeaderField("incoterm", event.target.value.toUpperCase())}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              ) : null}
              <ErpDenseFormRow label="Payment Term" required>
                <select
                  value={form.payment_term_id}
                  onChange={(event) => updateHeaderField("payment_term_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select payment term</option>
                  {paymentTerms.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.code || entry.name} | {entry.name}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Freight Term" required>
                <select
                  value={form.freight_term}
                  onChange={(event) => updateHeaderField("freight_term", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {FREIGHT_TERM_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Remarks">
                <textarea
                  rows={3}
                  value={form.remarks}
                  onChange={(event) => updateHeaderField("remarks", event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
            </div>

            <div className="grid gap-3 border-t border-slate-300 pt-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">PO Lines</div>
                <button
                  type="button"
                  onClick={addLine}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                >
                  Add Line
                </button>
              </div>

              {lines.map((line, index) => (
                <div key={`po-line-${index}`} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Line {index + 1}</div>
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      disabled={lines.length === 1}
                      className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    <ErpDenseFormRow label="Material" required>
                      <ErpComboboxField
                        value={line.material_id}
                        onChange={(value) => updateLine(index, { material_id: value })}
                        options={materialOptions}
                        blankLabel="Select material"
                        inputProps={{ onBlur: () => void checkApprovedAsl(index) }}
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Quantity" required>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.quantity}
                        onChange={(event) => updateLine(index, { quantity: event.target.value })}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="UOM Code">
                      <input
                        value={line.uom_code}
                        onChange={(event) => updateLine(index, { uom_code: event.target.value.toUpperCase() })}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Rate" required>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.rate}
                        onChange={(event) => updateLine(index, { rate: event.target.value })}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Cost Center" required>
                      <select
                        value={line.cost_center_id}
                        onChange={(event) => updateLine(index, { cost_center_id: event.target.value })}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      >
                        <option value="">Select cost center</option>
                        {costCenters.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.cost_center_code || entry.id} | {entry.cost_center_name || entry.name || ""}
                          </option>
                        ))}
                      </select>
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Delivery Date">
                      <input
                        type="date"
                        value={line.delivery_date}
                        onChange={(event) => updateLine(index, { delivery_date: event.target.value })}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    {indentRequired ? (
                      <ErpDenseFormRow label="Indent Reference">
                        <input
                          value={line.indent_reference}
                          onChange={(event) => updateLine(index, { indent_reference: event.target.value })}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                    ) : null}
                  </div>
                  <div className="grid gap-1 text-xs text-slate-600">
                    <div>
                      Net Value: <span className="font-semibold text-slate-900">{((Number(line.quantity || 0) || 0) * (Number(line.rate || 0) || 0)).toFixed(2)}</span>
                    </div>
                    {line.aslWarning ? <div className="font-semibold text-amber-700">{line.aslWarning}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }
      bottomContent={
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          RM/PM materials only. Approved VMI should exist for every vendor-material pair before submission.
        </div>
      }
    />
  );
}
