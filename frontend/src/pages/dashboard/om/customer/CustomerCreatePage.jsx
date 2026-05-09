/*
 * File-ID: 15.12
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the customer creation form.
 * Authority: Frontend
 */

import { useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createCustomer } from "../omApi.js";

export default function CustomerCreatePage() {
  const [form, setForm] = useState({
    customer_name: "",
    customer_type: "DOMESTIC",
    delivery_address: "",
    billing_address: "",
    gst_number: "",
    primary_contact_person: "",
    phone: "",
    primary_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.customer_name.trim() || !form.delivery_address.trim() || !form.customer_type) {
      setError("OM_INVALID_CUSTOMER_TYPE");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createCustomer({
        customer_name: form.customer_name.trim(),
        customer_type: form.customer_type,
        delivery_address: form.delivery_address.trim(),
        billing_address: form.billing_address.trim() || undefined,
        gst_number: form.gst_number.trim() || undefined,
        primary_contact_person: form.primary_contact_person.trim() || undefined,
        phone: form.phone.trim() || undefined,
        primary_email: form.primary_email.trim() || undefined,
      });
      setNotice("Customer created.");
      openScreen(OPERATION_SCREENS.OM_CUSTOMER_LIST.screen_code, { mode: "replace" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create Customer"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save Customer", tone: "primary", onClick: () => void handleSubmit(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="Customer Setup"
      formTitle="Create a new customer row"
      formContent={
        <div className="grid gap-3">
          <ErpDenseFormRow label="Customer Name" required>
            <input
              value={form.customer_name}
              onChange={(event) => updateField("customer_name", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Customer Type" required>
            <select
              value={form.customer_type}
              onChange={(event) => updateField("customer_type", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="DOMESTIC">DOMESTIC</option>
              <option value="EXPORT">EXPORT</option>
            </select>
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Delivery Address" required>
            <textarea
              rows={3}
              value={form.delivery_address}
              onChange={(event) => updateField("delivery_address", event.target.value)}
              className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="Billing Address">
            <textarea
              rows={3}
              value={form.billing_address}
              onChange={(event) => updateField("billing_address", event.target.value)}
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
        </div>
      }
    />
  );
}
