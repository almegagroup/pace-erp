/*
 * File-ID: 113.B
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerCreateForm.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Reusable RM/PM Sales Customer create form body — embedded both by
 *          the standalone MM04 page (CustomerCreatePage.jsx, company = a
 *          dropdown) and SO01's inline "+New Customer" modal
 *          (company = locked to the SO's own selected company). Only the
 *          Company field's behavior differs between the two call sites —
 *          everything else (GST check/category, vendor-link, parent company)
 *          is identical, per §113.7/§113.10.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { createCustomer, createParentCustomer, getVendor, lookupCustomerGstProfile } from "../omApi.js";
import {
  useParentCustomersQuery,
  useVendorOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

const FO_CUSTOMER_TYPE_OPTIONS = [
  { value: "", label: "-- Not an FO party --" },
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "ZTEST", label: "ZTEST" },
  { value: "MTS", label: "MTS" },
];

const GST_CATEGORY_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "REGISTERED", label: "Registered" },
  { value: "UNREGISTERED", label: "Unregistered" },
  { value: "COMPOSITION", label: "Composition" },
  { value: "EXPORT", label: "Export" },
];

function formatVendorAddress(vendor) {
  if (!vendor) return "";
  const parts = [
    vendor.reg_address_line1,
    vendor.reg_address_city,
    vendor.reg_address_state,
    vendor.reg_address_pin,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * companyMode="LOCKED"  -> lockedCompanyId is used, no dropdown shown
 * companyMode="SELECT"  -> companyOptions rendered as a required dropdown
 */
export default function CustomerCreateForm({
  companyMode = "SELECT",
  lockedCompanyId = "",
  companyOptions = [],
  onSaved,
  onCancel,
  submitLabel = "Save Customer",
}) {
  const [source, setSource] = useState("INDEPENDENT");
  const [loadingVendorProfile, setLoadingVendorProfile] = useState(false);
  const [showNewParent, setShowNewParent] = useState(false);
  const [newParent, setNewParent] = useState({ parent_customer_name: "", gst_number: "", address: "" });
  const [creatingParent, setCreatingParent] = useState(false);
  const [gstLooking, setGstLooking] = useState(false);
  const [gstNotice, setGstNotice] = useState("");

  const [form, setForm] = useState({
    company_id: companyMode === "LOCKED" ? lockedCompanyId : "",
    vendor_id: "",
    parent_customer_id: "",
    customer_name: "",
    customer_type: "DOMESTIC",
    fo_customer_type: "",
    currency_code: "BDT",
    delivery_address: "",
    billing_address: "",
    billing_state: "",
    gst_number: "",
    gst_category: "",
    primary_contact_person: "",
    phone: "",
    primary_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const vendorQuery = useVendorOptionsQuery({ status: "ACTIVE", limit: 500, offset: 0 });
  const parentCustomerQuery = useParentCustomersQuery();
  const vendors = vendorQuery.vendors;
  const parentCustomers = Array.isArray(parentCustomerQuery.data?.data)
    ? parentCustomerQuery.data.data
    : Array.isArray(parentCustomerQuery.data)
    ? parentCustomerQuery.data
    : [];
  const loadingDeps = vendorQuery.isLoading || parentCustomerQuery.isLoading;

  useEffect(() => {
    if (companyMode === "LOCKED") {
      setForm((current) => (current.company_id === lockedCompanyId ? current : { ...current, company_id: lockedCompanyId }));
    }
  }, [companyMode, lockedCompanyId]);

  async function handleVendorSelect(vendorId) {
    updateField("vendor_id", vendorId);
    if (!vendorId) return;
    setLoadingVendorProfile(true);
    try {
      const result = await getVendor(vendorId);
      const vendor = result?.data;
      if (!vendor) return;
      const primaryContact = (vendor.contacts ?? []).find((entry) => entry.is_primary) ?? (vendor.contacts ?? [])[0];
      const primaryEmail = (vendor.emails ?? []).find((entry) => entry.is_primary) ?? (vendor.emails ?? [])[0];
      setForm((current) => ({
        ...current,
        delivery_address: formatVendorAddress(vendor),
        billing_address: current.billing_address || formatVendorAddress(vendor),
        primary_contact_person: primaryContact?.contact_name ?? current.primary_contact_person,
        phone: primaryContact?.phone ?? current.phone,
        primary_email: primaryEmail?.email ?? current.primary_email,
        currency_code: vendor.currency_code || current.currency_code,
      }));
    } catch {
      // Vendor profile fetch failing shouldn't block the rest of the form — fields stay manually editable.
    } finally {
      setLoadingVendorProfile(false);
    }
  }

  useEffect(() => {
    setError(
      error ||
      vendorQuery.error?.message ||
      parentCustomerQuery.error?.message ||
      ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentCustomerQuery.error, vendorQuery.error]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCheckGst() {
    const gst = form.gst_number.trim().toUpperCase();
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
        customer_name: profile.legal_name || current.customer_name,
        delivery_address: profile.full_address || current.delivery_address,
      }));
      setGstNotice(`GST found: ${profile.legal_name ?? "—"}`);
    } catch {
      setError("GST lookup failed. Check the GST number.");
    } finally {
      setGstLooking(false);
    }
  }

  async function handleCreateParent() {
    if (!newParent.parent_customer_name.trim()) {
      setError("OM_INVALID_PARENT_CUSTOMER");
      return;
    }
    setCreatingParent(true);
    setError("");
    try {
      const result = await createParentCustomer({
        parent_customer_name: newParent.parent_customer_name.trim(),
        gst_number: newParent.gst_number.trim() || undefined,
        address: newParent.address.trim() || undefined,
      });
      const created = result?.data;
      if (created) {
        await parentCustomerQuery.refetch();
        updateField("parent_customer_id", created.id);
      }
      setNewParent({ parent_customer_name: "", gst_number: "", address: "" });
      setShowNewParent(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "OM_PARENT_CUSTOMER_CREATE_FAILED");
    } finally {
      setCreatingParent(false);
    }
  }

  async function handleSubmit() {
    const isVendorLinked = source === "VENDOR_LINKED";
    if (!form.company_id) {
      setError("Company is required.");
      return;
    }
    if (isVendorLinked && !form.vendor_id) {
      setError("OM_VENDOR_NOT_FOUND");
      return;
    }
    if (!isVendorLinked && !form.customer_name.trim()) {
      setError("OM_INVALID_CUSTOMER_TYPE");
      return;
    }
    if (!form.delivery_address.trim() || !form.customer_type) {
      setError("OM_INVALID_CUSTOMER_TYPE");
      return;
    }
    if (!form.billing_state.trim()) {
      setError("Billing state is required (needed for CGST/SGST vs IGST on invoices).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await createCustomer({
        company_id: form.company_id,
        vendor_id: isVendorLinked ? form.vendor_id : undefined,
        parent_customer_id: form.parent_customer_id || undefined,
        customer_name: isVendorLinked ? undefined : form.customer_name.trim(),
        customer_type: form.customer_type,
        fo_customer_type: form.fo_customer_type || undefined,
        currency_code: form.currency_code,
        delivery_address: form.delivery_address.trim(),
        billing_address: form.billing_address.trim() || undefined,
        billing_state: form.billing_state.trim(),
        gst_number: isVendorLinked ? undefined : form.gst_number.trim() || undefined,
        gst_category: form.gst_category || undefined,
        primary_contact_person: form.primary_contact_person.trim() || undefined,
        phone: form.phone.trim() || undefined,
        primary_email: form.primary_email.trim() || undefined,
      });
      onSaved?.(result?.data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const selectedVendor = vendors.find((entry) => entry.id === form.vendor_id);

  return (
    <div className="grid gap-5">
      {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}

      {companyMode === "SELECT" ? (
        <ErpDenseFormRow label="Company" required>
          <select
            value={form.company_id}
            onChange={(event) => updateField("company_id", event.target.value)}
            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          >
            <option value="">Select company</option>
            {companyOptions.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </ErpDenseFormRow>
      ) : null}

      <ErpDenseFormRow label="Source" required>
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="INDEPENDENT">Independent — enter customer details</option>
          <option value="VENDOR_LINKED">Link to existing Vendor — reuse vendor's name/GST live</option>
        </select>
      </ErpDenseFormRow>

      {source === "VENDOR_LINKED" ? (
        <ErpDenseFormRow label="Vendor" required>
          <select
            value={form.vendor_id}
            onChange={(event) => void handleVendorSelect(event.target.value)}
            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          >
            <option value="">Select vendor</option>
            {vendors.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.vendor_code} | {entry.vendor_name}
              </option>
            ))}
          </select>
          {selectedVendor ? (
            <p className="mt-1 text-xs text-slate-500">
              Name and GST will always mirror this vendor's record — editing the vendor later updates this customer automatically.
              {loadingVendorProfile ? " Loading vendor address/contact..." : " Address, contact, phone, and email below were copied from the vendor — edit freely, they won't re-sync."}
            </p>
          ) : null}
        </ErpDenseFormRow>
      ) : (
        <>
          <ErpDenseFormRow label="Customer Name" required>
            <input
              value={form.customer_name}
              onChange={(event) => updateField("customer_name", event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>

          {/* §113.7 — Vendor Master's GST pattern: optional gst_number + "Check GST"
              lookup, plus a separate gst_category classification that is the real
              GST-holder signal (not whether gst_number happens to be filled in). */}
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

      <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Parent Company (optional)</p>
          <button
            type="button"
            onClick={() => setShowNewParent((current) => !current)}
            className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          >
            {showNewParent ? "Cancel" : "+ New Parent Company"}
          </button>
        </div>
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
        {showNewParent ? (
          <div className="grid gap-2 border border-dashed border-slate-300 bg-white p-3">
            <ErpDenseFormRow label="Parent Company Name" required>
              <input
                value={newParent.parent_customer_name}
                onChange={(event) => setNewParent((current) => ({ ...current, parent_customer_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="GST Number">
              <input
                value={newParent.gst_number}
                onChange={(event) => setNewParent((current) => ({ ...current, gst_number: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Address">
              <textarea
                rows={2}
                value={newParent.address}
                onChange={(event) => setNewParent((current) => ({ ...current, address: event.target.value }))}
                className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <button
              type="button"
              onClick={() => void handleCreateParent()}
              disabled={creatingParent}
              className="w-fit border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
            >
              {creatingParent ? "Creating..." : "Create Parent Company"}
            </button>
          </div>
        ) : null}
      </div>

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
      <ErpDenseFormRow label="Currency" required>
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
        <input
          value={form.billing_state}
          onChange={(event) => updateField("billing_state", event.target.value)}
          placeholder="e.g. West Bengal"
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
        <p className="mt-1 text-xs text-slate-500">Determines CGST+SGST vs IGST on sales invoices — required for every customer, registered or not.</p>
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
          disabled={saving || loadingDeps}
          className="h-8 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950 disabled:opacity-50"
        >
          {saving ? "Saving..." : submitLabel}
        </button>
      </div>
    </div>
  );
}
