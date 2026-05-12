import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listCustomers, listMaterials } from "../../om/omApi.js";
import { createSalesOrder, listPaymentTerms } from "../procurementApi.js";

function createEmptyLine() {
  return {
    material_id: "",
    quantity: "",
    uom_code: "",
    rate: "",
    discount_pct: "0",
    gst_rate: "",
    issue_storage_location_id: "",
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

export default function SOCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const customerOptions = useMemo(
    () =>
      customers.map((entry) => ({
        value: entry.id,
        label: `${entry.customer_code || ""} ${entry.customer_name || ""}`.trim(),
      })),
    [customers]
  );
  const materialOptions = useMemo(
    () =>
      materials
        .filter((entry) => ["RM", "PM"].includes(String(entry.material_type || "").toUpperCase()))
        .map((entry) => ({
          value: entry.id,
          label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim(),
        })),
    [materials]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({
      value: entry.id,
      label: entry.company_name || entry.company_code || entry.id,
    })),
    [runtimeContext?.availableCompanies]
  );
  const selectedCustomer = useMemo(
    () => customers.find((entry) => entry.id === form.customer_id) ?? null,
    [customers, form.customer_id]
  );

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [customerData, materialData, paymentData] = await Promise.all([
          listCustomers({ limit: 200, offset: 0, status: "ACTIVE" }),
          listMaterials({ limit: 300, offset: 0, status: "ACTIVE" }),
          listPaymentTerms({ is_active: true }),
        ]);
        if (!active) {
          return;
        }
        const customerRows = Array.isArray(customerData?.data) ? customerData.data : [];
        const materialRows = Array.isArray(materialData?.data) ? materialData.data : [];
        const paymentRows = Array.isArray(paymentData) ? paymentData : [];
        setCustomers(customerRows);
        setMaterials(materialRows);
        setPaymentTerms(paymentRows);
        setForm((current) => ({
          ...current,
          company_id: current.company_id || runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "",
          payment_term_id: current.payment_term_id || paymentRows[0]?.id || "",
        }));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_SO_SETUP_FAILED");
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

  useEffect(() => {
    if (!selectedCustomer) {
      return;
    }
    setForm((current) => ({
      ...current,
      delivery_address: current.delivery_address || selectedCustomer.delivery_address || "",
      payment_term_id: current.payment_term_id || selectedCustomer.payment_term_id || current.payment_term_id,
    }));
  }, [selectedCustomer]);

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index, patch) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        const nextLine = { ...line, ...patch };
        if (patch.material_id) {
          const material = materialMap.get(patch.material_id);
          nextLine.uom_code = nextLine.uom_code || material?.base_uom_code || "";
          nextLine.gst_rate = nextLine.gst_rate || String(material?.gst_rate ?? "");
        }
        return nextLine;
      })
    );
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_entry, lineIndex) => lineIndex !== index)));
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
    const hasOutOfScopeMaterial = lines.some((line) => {
      const material = materialMap.get(line.material_id);
      const materialType = String(material?.material_type || "").toUpperCase();
      return !["RM", "PM"].includes(materialType);
    });
    if (hasOutOfScopeMaterial) {
      setError("FG Sales not in scope. Only RM/PM materials are allowed.");
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
          issue_storage_location_id: line.issue_storage_location_id || null,
        })),
      });
      setNotice("Sales order created.");
      openScreen(OPERATION_SCREENS.PROC_SO_DETAIL.screen_code);
      navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_SO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
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
      formEyebrow="SO Header"
      formTitle="Create RM / PM sales order"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading sales order master data...
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
              <ErpDenseFormRow label="Customer" required>
                <ErpComboboxField
                  value={form.customer_id}
                  onChange={(value) => updateHeaderField("customer_id", value)}
                  options={customerOptions}
                  blankLabel="Select customer"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Customer PO Number" required>
                <input
                  value={form.customer_po_number}
                  onChange={(event) => updateHeaderField("customer_po_number", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Customer PO Date">
                <input
                  type="date"
                  value={form.customer_po_date}
                  onChange={(event) => updateHeaderField("customer_po_date", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Payment Term">
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
              <ErpDenseFormRow label="Delivery Address">
                <textarea
                  rows={3}
                  value={form.delivery_address}
                  onChange={(event) => updateHeaderField("delivery_address", event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
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
                <div className="text-sm font-semibold text-slate-900">SO Lines</div>
                <button
                  type="button"
                  onClick={addLine}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                >
                  Add Line
                </button>
              </div>

              {lines.map((line, index) => {
                const rate = toNumber(line.rate);
                const discountPct = toNumber(line.discount_pct);
                const quantity = toNumber(line.quantity);
                const gstRate = toNumber(line.gst_rate);
                const netRate = rate * (1 - discountPct / 100);
                const lineValue = netRate * quantity;
                const gstAmount = lineValue * gstRate / 100;

                return (
                  <div key={`so-line-${index}`} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
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

                    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                      <ErpDenseFormRow label="Material" required>
                        <ErpComboboxField
                          value={line.material_id}
                          onChange={(value) => updateLine(index, { material_id: value })}
                          options={materialOptions}
                          blankLabel="Select RM / PM material"
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
                      <ErpDenseFormRow label="Issue Storage Location">
                        <input
                          value={line.issue_storage_location_id}
                          onChange={(event) => updateLine(index, { issue_storage_location_id: event.target.value })}
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
                      <ErpDenseFormRow label="Discount %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={line.discount_pct}
                          onChange={(event) => updateLine(index, { discount_pct: event.target.value })}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Net Rate">
                        <input
                          readOnly
                          value={formatFixed(netRate, 4)}
                          className="h-8 w-full border border-slate-200 bg-slate-100 px-2 text-sm text-slate-700 outline-none"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="GST Rate %">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.gst_rate}
                          onChange={(event) => updateLine(index, { gst_rate: event.target.value })}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Line Value">
                        <input
                          readOnly
                          value={formatFixed(lineValue, 2)}
                          className="h-8 w-full border border-slate-200 bg-slate-100 px-2 text-sm text-slate-700 outline-none"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="GST Amount">
                        <input
                          readOnly
                          value={formatFixed(gstAmount, 2)}
                          className="h-8 w-full border border-slate-200 bg-slate-100 px-2 text-sm text-slate-700 outline-none"
                        />
                      </ErpDenseFormRow>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      }
      bottomContent={
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          FG Sales not in scope. Only RM / PM materials can be sold through this flow.
        </div>
      }
    />
  );
}
