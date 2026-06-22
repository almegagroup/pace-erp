/*
 * File-ID: 15.9
 * File-Path: frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the approved source list creation form with vendor/material lookups
 *          and per-pair UOM, currency, and payment term lists.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listPaymentTerms } from "../../procurement/procurementApi.js";
import { createVendorMaterialInfo, listMaterials, listUoms, listVendors } from "../omApi.js";

const CURRENCY_OPTIONS = ["BDT", "USD", "EUR", "INR", "CNY"];

function makeUomRow() {
  return { key: crypto.randomUUID(), uom_code: "", conversion_factor: "1", is_default: false };
}

function makeCurrencyRow() {
  return { key: crypto.randomUUID(), currency_code: "", is_default: false };
}

function makePaymentTermRow() {
  return { key: crypto.randomUUID(), payment_term_id: "", is_default: false };
}

function withSingleDefault(rows, key) {
  return rows.map((row) => (row.key === key ? { ...row, is_default: true } : { ...row, is_default: false }));
}

export default function AslCreatePage() {
  const [vendors, setVendors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [form, setForm] = useState({
    vendor_id: "",
    material_id: "",
    vendor_material_code: "",
  });
  const [uomRows, setUomRows] = useState([makeUomRow()]);
  const [currencyRows, setCurrencyRows] = useState([makeCurrencyRow()]);
  const [paymentTermRows, setPaymentTermRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function loadDependencies() {
      setLoading(true);
      setError("");
      try {
        const [vendorResult, materialResult, uomResult, paymentTermResult] = await Promise.all([
          listVendors({ status: "ACTIVE", limit: 500, offset: 0 }),
          listMaterials({ status: "ACTIVE", limit: 500, offset: 0 }),
          listUoms({ is_active: true }),
          listPaymentTerms(),
        ]);
        if (!active) {
          return;
        }
        setVendors(Array.isArray(vendorResult?.data) ? vendorResult.data : []);
        setMaterials(Array.isArray(materialResult?.data) ? materialResult.data : []);
        setUoms(Array.isArray(uomResult?.data) ? uomResult.data : []);
        setPaymentTerms(Array.isArray(paymentTermResult?.data) ? paymentTermResult.data : []);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_VMI_CREATE_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void loadDependencies();
    return () => {
      active = false;
    };
  }, []);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateUomRow(key, field, value) {
    setUomRows((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function updateCurrencyRow(key, field, value) {
    setCurrencyRows((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function updatePaymentTermRow(key, field, value) {
    setPaymentTermRows((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  async function handleSubmit() {
    if (!form.vendor_id || !form.material_id) {
      setError("OM_VMI_CREATE_FAILED");
      return;
    }
    const validUoms = uomRows.filter((row) => row.uom_code && Number(row.conversion_factor) > 0);
    if (validUoms.length === 0) {
      setError("OM_INVALID_UOM");
      return;
    }
    const validCurrencies = currencyRows.filter((row) => row.currency_code);
    if (validCurrencies.length === 0) {
      setError("OM_INVALID_CURRENCY");
      return;
    }
    const validPaymentTerms = paymentTermRows.filter((row) => row.payment_term_id);

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createVendorMaterialInfo({
        vendor_id: form.vendor_id,
        material_id: form.material_id,
        vendor_material_code: form.vendor_material_code || undefined,
        uoms: validUoms.map((row) => ({
          uom_code: row.uom_code,
          conversion_factor: Number(row.conversion_factor),
          is_default: row.is_default,
        })),
        currencies: validCurrencies.map((row) => ({
          currency_code: row.currency_code,
          is_default: row.is_default,
        })),
        payment_terms: validPaymentTerms.map((row) => ({
          payment_term_id: row.payment_term_id,
          is_default: row.is_default,
        })),
      });
      setNotice("Approved source row created.");
      openScreen(OPERATION_SCREENS.OM_ASL_LIST.screen_code, { mode: "replace" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VMI_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const selectedMaterial = materials.find((entry) => entry.id === form.material_id);

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create Approved Source"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save ASL", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="Vendor-Material Setup"
      formTitle="Create a new approved source list row"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading vendor, material, UOM, and payment term options...
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-3">
              <ErpDenseFormRow label="Vendor" required>
                <select
                  value={form.vendor_id}
                  onChange={(event) => updateField("vendor_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select vendor</option>
                  {vendors.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.vendor_code} | {entry.vendor_name}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Material" required>
                <select
                  value={form.material_id}
                  onChange={(event) => updateField("material_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select material</option>
                  {materials.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.pace_code} | {entry.material_name}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              {selectedMaterial ? (
                <p className="text-xs text-slate-500">
                  Base UOM (Material Master): <span className="font-semibold text-slate-700">{selectedMaterial.base_uom_code}</span>
                  {" "}— internal stock counting unit, independent of vendor packaging below.
                </p>
              ) : null}
              <ErpDenseFormRow label="Vendor Material Code">
                <input
                  value={form.vendor_material_code}
                  onChange={(event) => updateField("vendor_material_code", event.target.value)}
                  placeholder="Vendor's own catalog/part code for this material"
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
            </div>

            <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                  Valid Delivery UOMs (this vendor's packaging — independent of Material Master)
                </p>
                <button
                  type="button"
                  onClick={() => setUomRows((rows) => [...rows, makeUomRow()])}
                  className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  + Add UOM
                </button>
              </div>
              {uomRows.map((row) => (
                <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
                  <select
                    value={row.uom_code}
                    onChange={(event) => updateUomRow(row.key, "uom_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select UOM</option>
                    {uoms.map((entry) => (
                      <option key={entry.id || entry.code} value={entry.code}>
                        {entry.code} | {entry.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    placeholder={selectedMaterial ? `1 ${row.uom_code || "UOM"} = ___ ${selectedMaterial.base_uom_code}` : "Conversion to Base UOM"}
                    value={row.conversion_factor}
                    onChange={(event) => updateUomRow(row.key, "conversion_factor", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="radio"
                      name="uom-default"
                      checked={row.is_default}
                      onChange={() => setUomRows((rows) => withSingleDefault(rows, row.key))}
                    />
                    Default
                  </label>
                  <button
                    type="button"
                    onClick={() => setUomRows((rows) => rows.filter((entry) => entry.key !== row.key))}
                    disabled={uomRows.length === 1}
                    className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Valid Currencies</p>
                <button
                  type="button"
                  onClick={() => setCurrencyRows((rows) => [...rows, makeCurrencyRow()])}
                  className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  + Add Currency
                </button>
              </div>
              {currencyRows.map((row) => (
                <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                  <select
                    value={row.currency_code}
                    onChange={(event) => updateCurrencyRow(row.key, "currency_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select currency</option>
                    {CURRENCY_OPTIONS.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="radio"
                      name="currency-default"
                      checked={row.is_default}
                      onChange={() => setCurrencyRows((rows) => withSingleDefault(rows, row.key))}
                    />
                    Default
                  </label>
                  <button
                    type="button"
                    onClick={() => setCurrencyRows((rows) => rows.filter((entry) => entry.key !== row.key))}
                    disabled={currencyRows.length === 1}
                    className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                  Payment Terms (optional — from Payment Terms Master)
                </p>
                <button
                  type="button"
                  onClick={() => setPaymentTermRows((rows) => [...rows, makePaymentTermRow()])}
                  className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  + Add Payment Term
                </button>
              </div>
              {paymentTermRows.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No payment term linked. PO creation will fall back to this vendor's last-used payment term.
                </p>
              ) : null}
              {paymentTermRows.map((row) => (
                <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                  <select
                    value={row.payment_term_id}
                    onChange={(event) => updatePaymentTermRow(row.key, "payment_term_id", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select payment term</option>
                    {paymentTerms.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.code} | {entry.name}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="radio"
                      name="payment-term-default"
                      checked={row.is_default}
                      onChange={() => setPaymentTermRows((rows) => withSingleDefault(rows, row.key))}
                    />
                    Default
                  </label>
                  <button
                    type="button"
                    onClick={() => setPaymentTermRows((rows) => rows.filter((entry) => entry.key !== row.key))}
                    className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      }
    />
  );
}
