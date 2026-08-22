/*
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerEditForm.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Reusable FG Sales Customer edit form body -- embedded both by
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { INDIAN_STATES } from "../../../../data/indianStates.js";
import {
  createCustomerAddress,
  createFgParentCompany,
  createOrGetFgDepotCode,
  getCustomer,
  listCustomerAddresses,
  listFgParentCompanies,
  lookupCustomerGstProfile,
  updateCustomer,
  updateCustomerAddress,
} from "../omApi.js";

// §129.3/§129.8 Step 5 — "Map this address to a VDC": pick an existing
// Parent Company or create one, then create-or-reuse a VDC under it
// (createOrGetFgDepotCode is idempotent on (parent_company_id, code)), then
// point the address's depot_code_id at it.
function MapVdcPanel({ addressId, onDone, onCancel }) {
  const [parentCompanies, setParentCompanies] = useState([]);
  const [loadingParents, setLoadingParents] = useState(true);
  const [parentCompanyId, setParentCompanyId] = useState("");
  const [newParentName, setNewParentName] = useState("");
  const [newParentState, setNewParentState] = useState("");
  const [newParentGst, setNewParentGst] = useState("");
  const [vdcCode, setVdcCode] = useState("");
  const [dispatchType, setDispatchType] = useState("DIRECT");
  const [vdcGst, setVdcGst] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listFgParentCompanies();
        if (!cancelled) setParentCompanies(Array.isArray(result?.data) ? result.data : []);
      } catch {
        if (!cancelled) setParentCompanies([]);
      } finally {
        if (!cancelled) setLoadingParents(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleMap() {
    if (!vdcCode.trim()) {
      setError("VDC Code is required.");
      return;
    }
    let resolvedParentId = parentCompanyId;
    setSaving(true);
    setError("");
    try {
      if (!resolvedParentId) {
        if (!newParentName.trim() || !newParentState) {
          setError("Pick an existing Parent Company, or enter a name + state to create one.");
          setSaving(false);
          return;
        }
        const parentResult = await createFgParentCompany({
          company_name: newParentName.trim(),
          state: newParentState,
          gst_number: newParentGst.trim() || undefined,
        });
        resolvedParentId = parentResult?.data?.id;
      }
      const depotResult = await createOrGetFgDepotCode({
        parent_company_id: resolvedParentId,
        dispatch_type: dispatchType,
        code: vdcCode.trim(),
        gst_number: vdcGst.trim() || undefined,
      });
      const depotId = depotResult?.data?.id;
      await updateCustomerAddress({ id: addressId, depot_code_id: depotId });
      onDone();
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : "OM_ADDRESS_VDC_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1 grid gap-2 border border-dashed border-sky-300 bg-sky-50/40 p-3">
      {error ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</div> : null}
      <ErpDenseFormRow label="Parent Company">
        <select
          value={parentCompanyId}
          onChange={(event) => setParentCompanyId(event.target.value)}
          disabled={loadingParents}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="">— select or create new below —</option>
          {parentCompanies.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.company_name} ({entry.state})</option>
          ))}
        </select>
      </ErpDenseFormRow>
      {!parentCompanyId ? (
        <div className="grid gap-2 border border-dashed border-slate-300 bg-white p-2">
          <ErpDenseFormRow label="New Parent Company Name">
            <input
              value={newParentName}
              onChange={(event) => setNewParentName(event.target.value)}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
          <ErpDenseFormRow label="State">
            <select
              value={newParentState}
              onChange={(event) => setNewParentState(event.target.value)}
              className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="">Select state</option>
              {INDIAN_STATES.map((state) => (
                <option key={state.code} value={state.name}>{state.name}</option>
              ))}
            </select>
          </ErpDenseFormRow>
          <ErpDenseFormRow label="GST (optional)">
            <input
              value={newParentGst}
              onChange={(event) => setNewParentGst(event.target.value.toUpperCase())}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </ErpDenseFormRow>
        </div>
      ) : null}
      <ErpDenseFormRow label="External VDC Code" required>
        <input
          value={vdcCode}
          onChange={(event) => setVdcCode(event.target.value)}
          placeholder="e.g. VDC-KOLH-002"
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
        <p className="mt-1 text-xs text-slate-500">If this code already exists under the selected Parent Company, it's reused — no duplicate created.</p>
      </ErpDenseFormRow>
      <ErpDenseFormRow label="Dispatch Type">
        <select
          value={dispatchType}
          onChange={(event) => setDispatchType(event.target.value)}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="DIRECT">Direct</option>
          <option value="DEPOT">Depot</option>
        </select>
      </ErpDenseFormRow>
      <ErpDenseFormRow label="VDC GST (optional)">
        <input
          value={vdcGst}
          onChange={(event) => setVdcGst(event.target.value.toUpperCase())}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </ErpDenseFormRow>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
        <button
          type="button"
          onClick={() => void handleMap()}
          disabled={saving}
          className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50"
        >
          {saving ? "Mapping..." : "Map to VDC"}
        </button>
      </div>
    </div>
  );
}

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

  // §129.3/§129.7 — the third Plan-Feed flow: add a NEW address to this
  // EXISTING customer, distinct from editing the customer's own fields above.
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ site_name: "", address_line: "", town: "", state: "" });
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [mappingAddressId, setMappingAddressId] = useState("");

  const queryClient = useQueryClient();

  const customerQuery = useQuery({
    queryKey: ["om", "customer-edit-form", customerId],
    queryFn: () => getCustomer(customerId),
    enabled: Boolean(customerId),
    select: (data) => data?.data ?? null,
  });
  const customer = customerQuery.data ?? null;
  const isVendorLinked = Boolean(customer?.vendor_id);

  const addressesQuery = useQuery({
    queryKey: ["om", "customer-addresses", customerId],
    queryFn: () => listCustomerAddresses(customerId),
    enabled: Boolean(customerId),
    select: (data) => data?.data ?? [],
  });
  const addresses = addressesQuery.data ?? [];

  useEffect(() => {
    if (!customer) return;
    setForm({
      customer_name: customer.customer_name ?? "",
      gst_number: customer.gst_number ?? "",
      gst_category: customer.gst_category ?? "",
      currency_code: customer.currency_code ?? "BDT",
      delivery_address: customer.delivery_address ?? "",
      billing_address: customer.billing_address ?? "",
      billing_state: customer.billing_state ?? "",
      town: customer.town ?? "",
      primary_contact_person: customer.primary_contact_person ?? "",
      phone: customer.phone ?? "",
      primary_email: customer.primary_email ?? "",
      fo_customer_type: normalizeFoCustomerType(customer.fo_customer_type),
    });
    setNewAddress((current) => (current.state ? current : { ...current, state: customer.billing_state ?? "" }));
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

  async function handleAddAddress() {
    if (!newAddress.site_name.trim() || !newAddress.address_line.trim() || !newAddress.town.trim()) {
      setAddressError("Site Name, Address, and Town are required.");
      return;
    }
    setSavingAddress(true);
    setAddressError("");
    try {
      await createCustomerAddress({
        customer_id: customerId,
        site_name: newAddress.site_name.trim(),
        address_line: newAddress.address_line.trim(),
        town: newAddress.town.trim(),
        state: newAddress.state || customer?.billing_state || "",
      });
      queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", customerId] });
      setNewAddress({ site_name: "", address_line: "", town: "", state: customer?.billing_state ?? "" });
      setAddingAddress(false);
    } catch (createError) {
      setAddressError(createError instanceof Error ? createError.message : "OM_ADDRESS_CREATE_FAILED");
    } finally {
      setSavingAddress(false);
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

      {/* §129.3/§129.7 — Addresses (Stage 1: Site/Address/Town/State here;
          Stage 2 VDC mapping happens in MM04's own Customer Detail page). */}
      <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Addresses</p>
          <button
            type="button"
            onClick={() => setAddingAddress((current) => !current)}
            className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          >
            {addingAddress ? "Cancel" : "+ Add another address"}
          </button>
        </div>

        {addressesQuery.isLoading ? (
          <p className="text-xs text-slate-500">Loading addresses...</p>
        ) : addresses.length === 0 ? (
          <p className="text-xs text-slate-500">No addresses yet.</p>
        ) : (
          <ul className="grid gap-1">
            {addresses.map((address) => (
              <li key={address.id} className="border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span>
                    <span className="font-semibold text-slate-900">{address.site_name || "—"}</span>
                    {" — "}
                    {address.address_line}, {address.town}, {address.state}
                  </span>
                  {address.depot_code ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {address.depot_code}
                      {address.parent_company_name ? ` — ${address.parent_company_name}` : ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMappingAddressId((current) => (current === address.id ? "" : address.id))}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
                    >
                      Not mapped — Map VDC →
                    </button>
                  )}
                </div>
                {mappingAddressId === address.id ? (
                  <MapVdcPanel
                    addressId={address.id}
                    onCancel={() => setMappingAddressId("")}
                    onDone={() => {
                      setMappingAddressId("");
                      queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", customerId] });
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {addingAddress ? (
          <div className="grid gap-2 border border-dashed border-slate-300 bg-white p-3">
            {addressError ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{addressError}</div> : null}
            <ErpDenseFormRow label="Site Name" required>
              <input
                value={newAddress.site_name}
                onChange={(event) => setNewAddress((current) => ({ ...current, site_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Address" required>
              <input
                value={newAddress.address_line}
                onChange={(event) => setNewAddress((current) => ({ ...current, address_line: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Town" required>
              <input
                value={newAddress.town}
                onChange={(event) => setNewAddress((current) => ({ ...current, town: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="State">
              <select
                value={newAddress.state}
                onChange={(event) => setNewAddress((current) => ({ ...current, state: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state.code} value={state.name}>{state.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Always matches this customer's own state — GST/state is a customer-level fact, not per-address.</p>
            </ErpDenseFormRow>
            <button
              type="button"
              onClick={() => void handleAddAddress()}
              disabled={savingAddress}
              className="w-fit border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
            >
              {savingAddress ? "Saving..." : "Save Address"}
            </button>
          </div>
        ) : null}
      </div>

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
