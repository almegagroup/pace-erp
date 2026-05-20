/*
 * File-ID: 15.6
 * File-Path: frontend/src/pages/dashboard/om/vendor/VendorCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the vendor creation form.
 * Authority: Frontend
 */

import { useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createVendor } from "../omApi.js";

export default function VendorCreatePage() {
  const [form, setForm] = useState({
    vendor_name: "",
    vendor_type: "DOMESTIC",
    registered_address: "",
    gst_number: "",
    primary_contact_person: "",
    phone: "",
    primary_email: "",
    currency_code: "BDT",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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
      await createVendor({
        vendor_name: form.vendor_name.trim(),
        vendor_type: form.vendor_type,
        registered_address: form.registered_address.trim() || undefined,
        gst_number: form.gst_number.trim() || undefined,
        primary_contact_person: form.primary_contact_person.trim() || undefined,
        phone: form.phone.trim() || undefined,
        primary_email: form.primary_email.trim() || undefined,
        currency_code: form.currency_code.trim() || undefined,
      });
      setNotice("Vendor created.");
      openScreen(OPERATION_SCREENS.OM_VENDOR_LIST.screen_code, { mode: "replace" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VENDOR_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

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
            <input
              value={form.vendor_name}
              onChange={(event) => updateField("vendor_name", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Vendor Type" required>
            <select
              value={form.vendor_type}
              onChange={(event) => updateField("vendor_type", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="DOMESTIC">DOMESTIC</option>
              <option value="IMPORT">IMPORT</option>
            </select>
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Registered Address">
            <textarea
              rows={3}
              value={form.registered_address}
              onChange={(event) => updateField("registered_address", event.target.value)}
              className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="GST Number">
            <input
              value={form.gst_number}
              onChange={(event) => updateField("gst_number", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Primary Contact">
            <input
              value={form.primary_contact_person}
              onChange={(event) => updateField("primary_contact_person", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Phone">
            <input
              value={form.phone}
              onChange={(event) => updateField("phone", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Primary Email">
            <input
              value={form.primary_email}
              onChange={(event) => updateField("primary_email", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Currency Code">
            <input
              value={form.currency_code}
              onChange={(event) => updateField("currency_code", event.target.value.toUpperCase())}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
        </div>
      }
    />
  );
}
