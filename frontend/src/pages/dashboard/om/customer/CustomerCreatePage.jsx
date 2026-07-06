/*
 * File-ID: 15.12
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the RM/PM Sales Customer creation form — independent or
 *          vendor-linked, with optional Parent Customer grouping.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createCustomer, createParentCustomer, getVendor } from "../omApi.js";
import {
  useParentCustomersQuery,
  useVendorOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

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

export default function CustomerCreatePage() {
  const [source, setSource] = useState("INDEPENDENT");
  const [loadingVendorProfile, setLoadingVendorProfile] = useState(false);
  const [showNewParent, setShowNewParent] = useState(false);
  const [newParent, setNewParent] = useState({ parent_customer_name: "", gst_number: "", address: "" });
  const [creatingParent, setCreatingParent] = useState(false);

  const [form, setForm] = useState({
    vendor_id: "",
    parent_customer_id: "",
    customer_name: "",
    customer_type: "DOMESTIC",
    currency_code: "BDT",
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
  const vendorQuery = useVendorOptionsQuery({ status: "ACTIVE", limit: 500, offset: 0 });
  const parentCustomerQuery = useParentCustomersQuery();
  const vendors = vendorQuery.vendors;
  const parentCustomers = Array.isArray(parentCustomerQuery.data?.data)
    ? parentCustomerQuery.data.data
    : Array.isArray(parentCustomerQuery.data)
    ? parentCustomerQuery.data
    : [];
  const loadingDeps = vendorQuery.isLoading || parentCustomerQuery.isLoading;

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
  }, [error, parentCustomerQuery.error, vendorQuery.error]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createCustomer({
        vendor_id: isVendorLinked ? form.vendor_id : undefined,
        parent_customer_id: form.parent_customer_id || undefined,
        customer_name: isVendorLinked ? undefined : form.customer_name.trim(),
        customer_type: form.customer_type,
        currency_code: form.currency_code,
        delivery_address: form.delivery_address.trim(),
        billing_address: form.billing_address.trim() || undefined,
        gst_number: isVendorLinked ? undefined : form.gst_number.trim() || undefined,
        primary_contact_person: form.primary_contact_person.trim() || undefined,
        phone: form.phone.trim() || undefined,
        primary_email: form.primary_email.trim() || undefined,
      });
      setNotice("Customer created.");
      openScreen(OPERATION_SCREENS.OM_CUSTOMER_DETAIL.screen_code, { mode: "replace", context: { id: result?.data?.id } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const selectedVendor = vendors.find((entry) => entry.id === form.vendor_id);

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create RM/PM Sales Customer"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save Customer", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loadingDeps },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="Customer Setup"
      formTitle="Create a new RM/PM sales customer row"
      formContent={
        <div className="grid gap-5">
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
              <ErpDenseFormRow label="GST Number">
                <input
                  value={form.gst_number}
                  onChange={(event) => updateField("gst_number", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
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
