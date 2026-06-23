/*
 * File-ID: 15.6
 * File-Path: frontend/src/pages/dashboard/om/vendor/VendorCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the vendor creation form. SA-only — Vendor Master is created/managed by SA.
 * Authority: Frontend
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { createVendor, lookupVendorGstProfile } from "../omApi.js";

const VENDOR_DETAIL_PREFIX = window.location.pathname.startsWith("/sa/") ? "/sa" : "/dashboard";

const EMPTY_FORM = {
  vendor_name: "",
  vendor_type: "DOMESTIC",
  gst_number: "",
  bin_number: "",
  tin_number: "",
  trade_license: "",
  gst_category: "",
  iec_code: "",
  import_license: "",
  country_code: "",
  currency_code: "BDT",
  reg_address_line1: "",
  reg_address_city: "",
  reg_address_state: "",
  reg_address_pin: "",
  corr_address_line1: "",
  corr_address_city: "",
  corr_address_state: "",
  corr_address_pin: "",
};

export default function VendorCreatePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleLookup() {
    const gst = form.gst_number.trim().toUpperCase();
    if (!gst) { setError("Enter a GST number first."); return; }
    setLookingUp(true);
    setError("");
    try {
      const profile = await lookupVendorGstProfile(gst);
      updateField("gst_number", gst);
      updateField("vendor_name", profile.legal_name || form.vendor_name);
      updateField("reg_address_line1", profile.full_address || form.reg_address_line1);
      updateField("reg_address_state", profile.state_name || form.reg_address_state);
      updateField("reg_address_pin", profile.pin_code || form.reg_address_pin);
      setNotice(`GST resolved (${profile.source === "CACHE" ? "from cache" : "fetched live"}). Review fields before saving.`);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "PROCUREMENT_GST_LOOKUP_FAILED");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSubmit() {
    if (!form.vendor_name.trim() || !form.vendor_type) {
      setError("OM_INVALID_VENDOR_TYPE");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createVendor({
        vendor_name: form.vendor_name.trim(),
        vendor_type: form.vendor_type,
        gst_number: form.gst_number.trim() || undefined,
        bin_number: form.bin_number.trim() || undefined,
        tin_number: form.tin_number.trim() || undefined,
        trade_license: form.trade_license.trim() || undefined,
        gst_category: form.gst_category.trim() || undefined,
        iec_code: form.iec_code.trim() || undefined,
        import_license: form.import_license.trim() || undefined,
        country_code: form.country_code.trim() || undefined,
        currency_code: form.currency_code.trim() || undefined,
        reg_address_line1: form.reg_address_line1.trim() || undefined,
        reg_address_city: form.reg_address_city.trim() || undefined,
        reg_address_state: form.reg_address_state.trim() || undefined,
        reg_address_pin: form.reg_address_pin.trim() || undefined,
        corr_address_line1: form.corr_address_line1.trim() || undefined,
        corr_address_city: form.corr_address_city.trim() || undefined,
        corr_address_state: form.corr_address_state.trim() || undefined,
        corr_address_pin: form.corr_address_pin.trim() || undefined,
      });
      setNotice("Vendor created.");
      navigate(`${VENDOR_DETAIL_PREFIX}/om/vendor/detail?id=${encodeURIComponent(result?.data?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VENDOR_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const INPUT_CLS = "h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500";
  const SELECT_CLS = "h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500";

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create Vendor"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save Vendor", tone: "primary", onClick: () => void handleSubmit(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="Vendor Setup"
      formTitle="Create a new vendor row"
      formContent={
        <div className="grid gap-3">
          <ErpDenseFormRow label="Vendor Name" required>
            <input value={form.vendor_name} onChange={(e) => updateField("vendor_name", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Vendor Type" required>
            <select value={form.vendor_type} onChange={(e) => updateField("vendor_type", e.target.value)} className={SELECT_CLS}>
              <option value="DOMESTIC">DOMESTIC</option>
              <option value="IMPORT">IMPORT</option>
            </select>
          </ErpDenseFormRow>
          {form.vendor_type === "IMPORT" && (
            <ErpDenseFormRow label="Country Code">
              <input value={form.country_code} onChange={(e) => updateField("country_code", e.target.value.toUpperCase())} className={INPUT_CLS} />
            </ErpDenseFormRow>
          )}

          <ErpDenseFormRow label="GST Number">
            <div className="flex gap-1">
              <input value={form.gst_number} onChange={(e) => updateField("gst_number", e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" className={INPUT_CLS} />
              <button type="button" disabled={lookingUp} onClick={() => void handleLookup()} className="border border-sky-600 bg-sky-50 px-2 text-[11px] font-semibold text-sky-900 disabled:opacity-50">
                {lookingUp ? "Checking..." : "Check GST"}
              </button>
            </div>
          </ErpDenseFormRow>
          <ErpDenseFormRow label="GST Category">
            <input value={form.gst_category} onChange={(e) => updateField("gst_category", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="BIN Number">
            <input value={form.bin_number} onChange={(e) => updateField("bin_number", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="TIN Number">
            <input value={form.tin_number} onChange={(e) => updateField("tin_number", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Trade License">
            <input value={form.trade_license} onChange={(e) => updateField("trade_license", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          {form.vendor_type === "IMPORT" && (
            <>
              <ErpDenseFormRow label="IEC Code">
                <input value={form.iec_code} onChange={(e) => updateField("iec_code", e.target.value)} className={INPUT_CLS} />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Import License">
                <input value={form.import_license} onChange={(e) => updateField("import_license", e.target.value)} className={INPUT_CLS} />
              </ErpDenseFormRow>
            </>
          )}

          <ErpDenseFormRow label="Registered Address — Line 1">
            <input value={form.reg_address_line1} onChange={(e) => updateField("reg_address_line1", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Registered Address — City">
            <input value={form.reg_address_city} onChange={(e) => updateField("reg_address_city", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Registered Address — State">
            <input value={form.reg_address_state} onChange={(e) => updateField("reg_address_state", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Registered Address — PIN">
            <input value={form.reg_address_pin} onChange={(e) => updateField("reg_address_pin", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>

          <ErpDenseFormRow label="Correspondence Address — Line 1">
            <input value={form.corr_address_line1} onChange={(e) => updateField("corr_address_line1", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Correspondence Address — City">
            <input value={form.corr_address_city} onChange={(e) => updateField("corr_address_city", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Correspondence Address — State">
            <input value={form.corr_address_state} onChange={(e) => updateField("corr_address_state", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Correspondence Address — PIN">
            <input value={form.corr_address_pin} onChange={(e) => updateField("corr_address_pin", e.target.value)} className={INPUT_CLS} />
          </ErpDenseFormRow>

          <ErpDenseFormRow label="Currency">
            <select value={form.currency_code} onChange={(e) => updateField("currency_code", e.target.value)} className={SELECT_CLS}>
              {CURRENCY_OPTIONS.map((entry) => (
                <option key={entry.code} value={entry.code}>{entry.code} | {entry.country}</option>
              ))}
            </select>
          </ErpDenseFormRow>
          <p className="text-xs text-slate-400">
            Contacts, emails, bank details and Company Mapping are managed after creation on the Vendor Detail page.
          </p>
        </div>
      }
    />
  );
}
