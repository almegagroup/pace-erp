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

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { INDIAN_STATES } from "../../../../data/indianStates.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createCustomerAddress,
  getCustomer,
  listCustomerAddresses,
  listFgDepotCodes,
  listFgParentCompanies,
  lookupCustomerGstProfile,
  updateCustomer,
  updateCustomerAddress,
} from "../omApi.js";

// §129.6 correction (2026-08-22, business owner) — VDC and DC (Depot Code)
// are two DIFFERENT things, not one "VDC" bucket with a type flag: Direct
// dispatch_type = VDC, Depot dispatch_type = DC. Both live in the same
// fg_depot_code table (no schema change needed -- dispatch_type already
// distinguishes them), but every UI label must say the right one, never a
// blanket "VDC" for a Depot-type row.
function depotLabel(dispatchType) {
  return dispatchType === "DEPOT" ? "DC" : "VDC";
}

// §129.3/§129.6/§129.8 (corrected 2026-08-22) — an Address maps DIRECTLY to
// an already-existing VDC/DC, picked from the master (VdcParentCompanyMasterPage.jsx)
// -- Parent Company is never chosen here, it's implied (a VDC/DC belongs to
// exactly one Parent Company). If the needed one doesn't exist yet, the user
// is sent to the Master page to create it there, not inline here.
function VdcPickerPanel({ addressId, currentDepotId, currentLabel, onDone, onCancel }) {
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const vdcQuery = useQuery({
    queryKey: ["om", "fg-depot-codes", "all"],
    queryFn: () => listFgDepotCodes(),
    select: (data) => data?.data ?? [],
  });
  // Parent Company name per VDC/DC -- Bill-To identity matters while picking,
  // not just after (business owner, 2026-08-22).
  const parentQuery = useQuery({
    queryKey: ["om", "fg-parent-companies", "picker"],
    queryFn: () => listFgParentCompanies(),
    select: (data) => data?.data ?? [],
  });
  const parentNameById = useMemo(() => {
    const map = new Map();
    for (const p of parentQuery.data ?? []) map.set(p.id, p.company_name);
    return map;
  }, [parentQuery.data]);
  const filtered = useMemo(() => {
    const vdcs = vdcQuery.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return vdcs;
    return vdcs.filter((v) => (v.code || "").toLowerCase().includes(term));
  }, [vdcQuery.data, search]);

  async function handlePick(depotId) {
    setSaving(true);
    setError("");
    try {
      await updateCustomerAddress({ id: addressId, depot_code_id: depotId });
      onDone();
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : "OM_ADDRESS_VDC_MAP_FAILED");
      setSaving(false);
    }
  }

  // A wrong mapping isn't a dead end — pick a different VDC/DC (below) to
  // correct it directly, or explicitly clear via "Unmap" first.
  async function handleUnmap() {
    setSaving(true);
    setError("");
    try {
      await updateCustomerAddress({ id: addressId, depot_code_id: null });
      onDone();
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : "OM_ADDRESS_VDC_UNMAP_FAILED");
      setSaving(false);
    }
  }

  return (
    <div className="mt-1 grid gap-2 border border-dashed border-sky-300 bg-sky-50/40 p-3">
      {error ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</div> : null}
      {currentDepotId ? (
        <div className="flex items-center justify-between rounded bg-white border border-slate-200 px-2 py-1 text-xs">
          <span>Currently mapped: <span className="font-semibold text-slate-900">{currentLabel}</span></span>
          <button
            type="button"
            onClick={() => void handleUnmap()}
            disabled={saving}
            className="border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
          >
            Unmap
          </button>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search VDC/DC code..."
          className="h-8 flex-1 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
        <button
          type="button"
          onClick={() => openScreen(OPERATION_SCREENS.OM_VDC_PARENT_COMPANY_MASTER.screen_code)}
          className="ml-2 whitespace-nowrap border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
        >
          + New VDC/DC (Master) →
        </button>
      </div>
      {vdcQuery.isLoading ? (
        <p className="text-xs text-slate-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-slate-500">No VDC/DC found. Create one on the Parent Company / VDC master page.</p>
      ) : (
        <ul className="grid gap-1 max-h-48 overflow-y-auto">
          {filtered.map((v) => (
            <li key={v.id} className="flex items-center justify-between border border-slate-200 bg-white px-2 py-1 text-xs">
              <span>
                <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600">{depotLabel(v.dispatch_type)}</span>
                <span className="font-semibold text-slate-900">{v.code}</span>
                {v.state ? ` — ${v.state}` : ""}
                {" — "}
                <span className="text-slate-500">{parentNameById.get(v.parent_company_id) || "—"}</span>
              </span>
              <button
                type="button"
                onClick={() => void handlePick(v.id)}
                disabled={saving || v.id === currentDepotId}
                className="border border-sky-700 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-950 disabled:opacity-50"
              >
                {v.id === currentDepotId ? "Current" : "Pick"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onCancel} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
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
  // §129.3 (2026-08-22 fix) — editing an EXISTING address's own fields
  // (Site Name especially -- backfilled/old addresses often have it blank)
  // had no UI at all, only "+ Add another address" (create) and VDC mapping
  // existed. This closes that gap.
  const [editingAddressId, setEditingAddressId] = useState("");
  const [editAddressForm, setEditAddressForm] = useState({ site_name: "", address_line: "", town: "" });
  const [savingEditAddress, setSavingEditAddress] = useState(false);
  const [editAddressError, setEditAddressError] = useState("");

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
      currency_code: customer.currency_code ?? "INR",
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
        // State was previously never auto-filled here (real gap, business
        // owner caught it 2026-08-22) -- Parent Company's own Check GST
        // already did this correctly, Customer's own didn't.
        billing_state: profile.state_name || current.billing_state,
      }));
      setGstNotice(`GST found: ${profile.legal_name ?? "—"} — address/state below updated from GST registration.`);
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

  function openEditAddress(address) {
    setEditingAddressId(address.id);
    setEditAddressForm({
      site_name: address.site_name ?? "",
      address_line: address.address_line ?? "",
      town: address.town ?? "",
    });
    setEditAddressError("");
  }

  async function handleSaveEditAddress() {
    if (!editAddressForm.site_name.trim() || !editAddressForm.address_line.trim() || !editAddressForm.town.trim()) {
      setEditAddressError("Site Name, Address, and Town are required.");
      return;
    }
    setSavingEditAddress(true);
    setEditAddressError("");
    try {
      await updateCustomerAddress({
        id: editingAddressId,
        site_name: editAddressForm.site_name.trim(),
        address_line: editAddressForm.address_line.trim(),
        town: editAddressForm.town.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", customerId] });
      setEditingAddressId("");
    } catch (saveError) {
      setEditAddressError(saveError instanceof Error ? saveError.message : "OM_ADDRESS_UPDATE_FAILED");
    } finally {
      setSavingEditAddress(false);
    }
  }

  // Wrongly-created address correction (2026-08-22, business owner) --
  // never "move" to a different customer (risk once SO/Invoice eventually
  // reference a specific address row), always unmap + deactivate together
  // so no dangling VDC/DC reference survives on a retired row, then the
  // user re-creates the correct one via "+ Add another address".
  async function handleRemoveAddress(address) {
    setSavingEditAddress(true);
    setEditAddressError("");
    try {
      await updateCustomerAddress({ id: address.id, depot_code_id: null, status: "INACTIVE" });
      queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", customerId] });
      setEditingAddressId("");
      setMappingAddressId("");
    } catch (removeError) {
      setEditAddressError(removeError instanceof Error ? removeError.message : "OM_ADDRESS_REMOVE_FAILED");
    } finally {
      setSavingEditAddress(false);
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
                    {address.site_name ? (
                      <span className="font-semibold text-slate-900">{address.site_name}</span>
                    ) : (
                      <span className="font-semibold text-amber-700">Site Name not set</span>
                    )}
                    {" — "}
                    {address.address_line}, {address.town}, {address.state}
                    <button
                      type="button"
                      onClick={() => (editingAddressId === address.id ? setEditingAddressId("") : openEditAddress(address))}
                      className="ml-2 text-[10px] font-semibold text-sky-700 underline"
                    >
                      Edit
                    </button>
                  </span>
                  {address.depot_code ? (
                    <button
                      type="button"
                      onClick={() => setMappingAddressId((current) => (current === address.id ? "" : address.id))}
                      className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      {depotLabel(address.depot_dispatch_type)}: {address.depot_code}
                      {address.parent_company_name ? ` — ${address.parent_company_name}` : ""}
                      {" (change →)"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMappingAddressId((current) => (current === address.id ? "" : address.id))}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
                    >
                      Not mapped — Map VDC/DC →
                    </button>
                  )}
                </div>
                {mappingAddressId === address.id ? (
                  <VdcPickerPanel
                    addressId={address.id}
                    currentDepotId={address.depot_code_id}
                    currentLabel={address.depot_code ? `${depotLabel(address.depot_dispatch_type)}: ${address.depot_code}` : ""}
                    onCancel={() => setMappingAddressId("")}
                    onDone={() => {
                      setMappingAddressId("");
                      queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", customerId] });
                    }}
                  />
                ) : null}
                {editingAddressId === address.id ? (
                  <div className="mt-1 grid gap-2 border border-dashed border-sky-300 bg-sky-50/40 p-3">
                    {editAddressError ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{editAddressError}</div> : null}
                    <ErpDenseFormRow label="Site Name" required>
                      <input
                        value={editAddressForm.site_name}
                        onChange={(event) => setEditAddressForm((c) => ({ ...c, site_name: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Address" required>
                      <input
                        value={editAddressForm.address_line}
                        onChange={(event) => setEditAddressForm((c) => ({ ...c, address_line: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Town" required>
                      <input
                        value={editAddressForm.town}
                        onChange={(event) => setEditAddressForm((c) => ({ ...c, town: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <p className="text-[11px] text-slate-500">State ({address.state}) always matches the customer's own state — not editable per-address.</p>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Remove this address? It will be unmapped from any VDC/DC and hidden — this can't be undone from here, you'd need to add a fresh address instead.")) {
                            void handleRemoveAddress(address);
                          }
                        }}
                        disabled={savingEditAddress}
                        className="h-8 border border-rose-300 bg-rose-50 px-3 text-xs font-semibold text-rose-800 disabled:opacity-50"
                      >
                        Remove this address
                      </button>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditingAddressId("")} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
                        <button
                          type="button"
                          onClick={() => void handleSaveEditAddress()}
                          disabled={savingEditAddress}
                          className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50"
                        >
                          {savingEditAddress ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
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
