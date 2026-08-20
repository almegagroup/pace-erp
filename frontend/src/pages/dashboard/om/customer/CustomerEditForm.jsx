/*
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerEditForm.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Reusable RM/PM Sales Customer edit form body -- embedded both by
 *          the standalone MM04 detail page (CustomerDetailPage.jsx) and by
 *          Plan Feed's "Edit Customer" button (PlanFeedPage.jsx). Both call
 *          sites write the exact same customer_master row through the exact
 *          same updateCustomer() handler, so an edit made from either page
 *          shows up on the other automatically -- no separate sync needed.
 *          Field set mirrors CustomerCreateForm.jsx (incl. GST Category +
 *          "Check GST") so nothing that can be entered at create time is
 *          missing here.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { INDIAN_STATES } from "../../../../data/indianStates.js";
import { getCustomer, lookupCustomerGstProfile, updateCustomer } from "../omApi.js";
import { useParentCustomersQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

const FO_CUSTOMER_TYPE_OPTIONS = [
  { value: "", label: "-- Not an FO party --" },
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "MTEST", label: "MTEST" },
  { value: "MTS", label: "MTS" },
];

const GST_CATEGORY_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "REGISTERED", label: "Registered" },
  { value: "UNREGISTERED", label: "Unregistered" },
  { value: "COMPOSITION", label: "Composition" },
  { value: "EXPORT", label: "Export" },
];

function normalizeFoCustomerType(value) {
  return String(value || "").toUpperCase() === "ZTEST" ? "MTEST" : String(value || "");
}

export default function CustomerEditForm({ customerId, onSaved, onCancel, submitLabel = "Save" }) {
  const [form, setForm] = useState(null);
  const [gstLooking, setGstLooking] = useState(false);
  const [gstNotice, setGstNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parentCustomerQuery = useParentCustomersQuery();
  const parentCustomers = Array.isArray(parentCustomerQuery.data?.data)
    ? parentCustomerQuery.data.data
    : Array.isArray(parentCustomerQuery.data)
    ? parentCustomerQuery.data
    : [];

  const customerQuery = useQuery({
    queryKey: ["om", "customer-edit-form", customerId],
    queryFn: () => getCustomer(customerId),
    enabled: Boolean(customerId),
    select: (data) => data?.data ?? null,
  });
  const customer = customerQuery.data ?? null;
  const isVendorLinked = Boolean(customer?.vendor_id);

  useEffect(() => {
    if (!customer) return;
    setForm({
      customer_name: customer.customer_name ?? "",
      gst_number: customer.gst_number ?? "",
      gst_category: customer.gst_category ?? "",
      currency_code: customer.currency_code ?? "BDT",
      parent_customer_id: customer.parent_customer_id ?? "",
      delivery_address: customer.delivery_address ?? "",
      billing_address: customer.billing_address ?? "",
      billing_state: customer.billing_state ?? "",
      town: customer.town ?? "",
      primary_contact_person: customer.primary_contact_person ?? "",
      phone: customer.phone ?? "",
      primary_email: customer.primary_email ?? "",
      fo_customer_type: normalizeFoCustomerType(customer.fo_customer_type),
    });
  }, [customer]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCheckGst() {
    const gst = (form?.gst_number || "").trim().toUpperCase();
    if (!gst) {
      setError("Enter a GST number first.");
      return;
    }
    setGstLooking(true);
    setError("");
    setGstNotice("");
    try {
      const result = await lookupCustomerGstProfile(gst);
      const profile = result?.data;
      if (!profile) throw new Error("OM_CUSTOMER_GST_LOOKUP_FAILED");
      setForm((current) => ({
        ...current,
        gst_number: gst,
        customer_name: isVendorLinked ? current.customer_name : (profile.legal_name || current.customer_name),
        delivery_address: profile.full_address || current.delivery_address,
      }));
      setGstNotice(`GST found: ${profile.legal_name ?? "—"}`);
    } catch {
      setError("GST lookup failed. Check the GST number.");
    } finally {
      setGstLooking(false);
    }
  }

  async function handleSubmit() {
    if (!customerId || !form) return;
    if (!form.delivery_address.trim()) {
      setError("DELIVERY_ADDRESS_REQUIRED");
      return;
    }
    if (!form.billing_state.trim()) {
      setError("Billing state is required (needed for CGST/SGST vs IGST on invoices).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await updateCustomer({
        id: customerId,
        ...(isVendorLinked ? {} : { customer_name: form.customer_name, gst_number: form.gst_number }),
        gst_category: form.gst_category,
        parent_customer_id: form.parent_customer_id || "",
        currency_code: form.currency_code,
        delivery_address: form.delivery_address,
        billing_address: form.billing_address,
        billing_state: form.billing_state,
        town: form.town,
        primary_contact_person: form.primary_contact_person,
        phone: form.phone,
        primary_email: form.primary_email,
        fo_customer_type: form.fo_customer_type,
      });
      onSaved?.(result?.data ?? customer);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const loading = customerQuery.isLoading || !customer || !form;

  if (loading) {
    return <div className="text-sm text-slate-500">{customerQuery.isLoading ? "Loading customer..." : "Customer not found."}</div>;
  }

  return (
    <div className="grid gap-3">
      {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}

      {isVendorLinked ? (
        <p className="border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Name and GST come live from the linked vendor ({customer.vendor_code}) — edit the vendor record to change them.
        </p>
      ) : (
        <>
          <ErpDenseFormRow label="Customer Name" required>
            <input
              value={form.customer_name}
              onChange={(event) => updateField("customer_name", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="GST Number">
            <div className="flex gap-2">
              <input
                value={form.gst_number}
                onChange={(event) => { updateField("gst_number", event.target.value.toUpperCase()); setGstNotice(""); }}
                className="h-8 flex-1 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                placeholder="e.g. 19AAAAA0000A1Z5"
              />
              <button
                type="button"
                onClick={() => void handleCheckGst()}
                disabled={gstLooking}
                className="h-8 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50 whitespace-nowrap"
              >
                {gstLooking ? "Checking..." : "Check GST"}
              </button>
            </div>
            {gstNotice ? <p className="mt-1 text-xs text-emerald-600">{gstNotice}</p> : null}
          </ErpDenseFormRow>
          <ErpDenseFormRow label="GST Category">
            <select
              value={form.gst_category}
              onChange={(event) => updateField("gst_category", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              {GST_CATEGORY_OPTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </ErpDenseFormRow>
        </>
      )}

      <ErpDenseFormRow label="Parent Company">
        <select
          value={form.parent_customer_id}
          onChange={(event) => updateField("parent_customer_id", event.target.value)}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="">No parent company</option>
          {parentCustomers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.parent_customer_code} | {entry.parent_customer_name}
            </option>
          ))}
        </select>
      </ErpDenseFormRow>

      <ErpDenseFormRow label="Currency">
        <select
          value={form.currency_code}
          onChange={(event) => updateField("currency_code", event.target.value)}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          {CURRENCY_OPTIONS.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.code} | {entry.country}
            </option>
          ))}
        </select>
      </ErpDenseFormRow>

      <ErpDenseFormRow label="FO Type (Plan Feed party filter)">
        <select
          value={form.fo_customer_type}
          onChange={(event) => updateField("fo_customer_type", event.target.value)}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          {FO_CUSTOMER_TYPE_OPTIONS.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
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
      <ErpDenseFormRow label="Billing State" required>
        {customer.customer_type === "DOMESTIC" ? (
          <select
            value={form.billing_state}
            onChange={(event) => updateField("billing_state", event.target.value)}
            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          >
            <option value="">Select state</option>
            {INDIAN_STATES.map((state) => (
              <option key={state.code} value={state.name}>{state.name}</option>
            ))}
          </select>
        ) : (
          <input
            value={form.billing_state}
            onChange={(event) => updateField("billing_state", event.target.value)}
            placeholder="State / province (foreign customer)"
            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        )}
        <p className="mt-1 text-xs text-slate-500">Determines CGST+SGST vs IGST on sales invoices.</p>
      </ErpDenseFormRow>
      <ErpDenseFormRow label="Town">
        <input
          value={form.town}
          onChange={(event) => updateField("town", event.target.value)}
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

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        {onCancel ? (
          <button type="button" onClick={onCancel} className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving}
          className="h-8 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950 disabled:opacity-50"
        >
          {saving ? "Saving..." : submitLabel}
        </button>
      </div>
    </div>
  );
}
