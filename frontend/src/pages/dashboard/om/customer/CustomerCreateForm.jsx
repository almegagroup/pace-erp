/*
 * File-ID: 113.B
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerCreateForm.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Reusable FG Sales Customer create form body — embedded both by
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
import { INDIAN_STATES } from "../../../../data/indianStates.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import {
  createCustomer,
  findCustomerByGst,
  getVendor,
  lookupCustomerGstProfile,
  mapCustomerToCompany,
} from "../omApi.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useVendorOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

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
 * fieldMode="FULL"      -> every field shown (MM04's own Create page, SO01)
 * fieldMode="MINIMAL"   -> Section 129.7 Stage 1: only Customer Name, Address,
 *                          State, Town, Site Name. Used by Plan Feed's
 *                          "+ New Party" so Production isn't shown GST/
 *                          Currency/Contact/etc. -- those stay Stage 2, added
 *                          later by anyone with MM04 access via the Customer
 *                          Detail drawer, not asked here.
 */
export default function CustomerCreateForm({
  companyMode = "SELECT",
  lockedCompanyId = "",
  companyOptions = [],
  initialFoCustomerType = "",
  fieldMode = "FULL",
  onSaved,
  onCancel,
  submitLabel = "Save Customer",
}) {
  const isMinimal = fieldMode === "MINIMAL";
  const [source, setSource] = useState("INDEPENDENT");
  const [loadingVendorProfile, setLoadingVendorProfile] = useState(false);
  const [gstLooking, setGstLooking] = useState(false);
  const [gstNotice, setGstNotice] = useState("");

  const [form, setForm] = useState({
    company_id: companyMode === "LOCKED" ? lockedCompanyId : "",
    vendor_id: "",
    customer_name: "",
    customer_type: "DOMESTIC",
    fo_customer_type: initialFoCustomerType,
    currency_code: "INR",
    delivery_address: "",
    billing_address: "",
    billing_state: "",
    town: "",
    site_name: "",
    gst_number: "",
    gst_category: "",
    primary_contact_person: "",
    phone: "",
    primary_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // §132.8 -- GST-based duplicate-detect + reuse. Only ever checked when a
  // GST number is present (§132.5/132.8: Unregistered parties skip this
  // entirely). A match found means this exact party already exists
  // somewhere -- offer to map the existing row to this company instead of
  // creating a duplicate customer_master row for the same real-world party.
  const [existingMatches, setExistingMatches] = useState([]);
  const [mappingExistingId, setMappingExistingId] = useState("");
  const [mapExistingError, setMapExistingError] = useState("");

  const vendorQuery = useVendorOptionsQuery({ status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const vendors = vendorQuery.vendors;
  const loadingDeps = vendorQuery.isLoading;

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
    setError(error || vendorQuery.error?.message || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorQuery.error]);

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
    setExistingMatches([]);
    setMapExistingError("");
    try {
      // §132.8 -- check OUR OWN customer_master for this GST first, across
      // every company (not just the one being created for). A match here
      // means don't create at all -- offer to reuse instead.
      const matchResult = await findCustomerByGst(gst);
      const matches = Array.isArray(matchResult?.data) ? matchResult.data : [];
      if (matches.length > 0) {
        setExistingMatches(matches);
        setGstNotice("");
        return;
      }

      const result = await lookupCustomerGstProfile(gst);
      const profile = result?.data;
      if (!profile) throw new Error("OM_CUSTOMER_GST_LOOKUP_FAILED");
      setForm((current) => ({
        ...current,
        gst_number: gst,
        customer_name: profile.legal_name || current.customer_name,
        delivery_address: profile.full_address || current.delivery_address,
        billing_state: profile.state_name || current.billing_state,
      }));
      setGstNotice(`GST found: ${profile.legal_name ?? "—"} — address/state below updated from GST registration.`);
    } catch {
      setError("GST lookup failed. Check the GST number.");
    } finally {
      setGstLooking(false);
    }
  }

  async function handleMapExisting(customerId) {
    if (!form.company_id) {
      setMapExistingError("Company is required before mapping.");
      return;
    }
    setMappingExistingId(customerId);
    setMapExistingError("");
    try {
      await mapCustomerToCompany({ customer_id: customerId, company_id: form.company_id });
      onSaved?.({ id: customerId });
    } catch (mapError) {
      setMapExistingError(mapError instanceof Error ? mapError.message : "OM_CUSTOMER_COMPANY_MAP_FAILED");
    } finally {
      setMappingExistingId("");
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
    if (!form.site_name.trim()) {
      setError("Site Name is required (§129.3 -- every customer needs at least one named address/site).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await createCustomer({
        company_id: form.company_id,
        vendor_id: isVendorLinked ? form.vendor_id : undefined,
        customer_name: isVendorLinked ? undefined : form.customer_name.trim(),
        customer_type: form.customer_type,
        fo_customer_type: form.fo_customer_type || undefined,
        currency_code: form.currency_code,
        delivery_address: form.delivery_address.trim(),
        billing_address: form.billing_address.trim() || undefined,
        billing_state: form.billing_state.trim(),
        town: form.town.trim() || undefined,
        site_name: form.site_name.trim(),
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

  useErpScreenHotkeys({
    save: { disabled: saving || existingMatches.length > 0, perform: () => void handleSubmit() },
  });

  return (
    <div className="grid gap-5">
      {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}

      {existingMatches.length > 0 ? (
        <div className="grid gap-2 border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-800">
            This GST already belongs to an existing customer — map it to your company instead of creating a duplicate.
          </p>
          {mapExistingError ? <p className="text-xs text-rose-700">{mapExistingError}</p> : null}
          {existingMatches.map((match) => {
            const alreadyMapped = (match.mapped_companies ?? []).some((c) => c?.id === form.company_id);
            return (
              <div key={match.id} className="flex items-center justify-between gap-2 border border-amber-200 bg-white px-2 py-1">
                <span className="text-xs text-slate-800">
                  {match.customer_code} — {match.customer_name || "(unnamed)"}
                  {(match.mapped_companies ?? []).length ? ` (already in: ${match.mapped_companies.map((c) => c?.company_code).filter(Boolean).join(", ")})` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void handleMapExisting(match.id)}
                  disabled={alreadyMapped || mappingExistingId === match.id}
                  className="h-7 border border-sky-600 bg-sky-600 px-2 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap"
                >
                  {alreadyMapped ? "Already in this company" : mappingExistingId === match.id ? "Mapping..." : "Map to my Company"}
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setExistingMatches([])}
            className="w-fit text-xs font-semibold text-slate-600 underline"
          >
            Not the same party — create new anyway
          </button>
        </div>
      ) : null}

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

      {!isMinimal ? (
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
      ) : null}

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
              GST-holder signal (not whether gst_number happens to be filled in).
              §129.7 — GST is Stage 2, not shown to Production's minimal create. */}
          {!isMinimal ? (
            <>
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
          ) : null}
        </>
      )}

      {!isMinimal ? (
        <>
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
        </>
      ) : null}
      <ErpDenseFormRow label={isMinimal ? "Address" : "Delivery Address"} required>
        <textarea
          rows={3}
          value={form.delivery_address}
          onChange={(event) => updateField("delivery_address", event.target.value)}
          className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </ErpDenseFormRow>
      {!isMinimal ? (
        <ErpDenseFormRow label="Billing Address">
          <textarea
            rows={3}
            value={form.billing_address}
            onChange={(event) => updateField("billing_address", event.target.value)}
            className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </ErpDenseFormRow>
      ) : null}
      <ErpDenseFormRow label={isMinimal ? "State" : "Billing State"} required>
        {form.customer_type === "DOMESTIC" ? (
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
        <p className="mt-1 text-xs text-slate-500">Determines CGST+SGST vs IGST on sales invoices — required for every customer, registered or not.</p>
      </ErpDenseFormRow>
      <ErpDenseFormRow label="Town">
        <input
          value={form.town}
          onChange={(event) => updateField("town", event.target.value)}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </ErpDenseFormRow>
      {/* §129.3 — Stage 1 mandatory, both modes: seeds this customer's first
          customer_address row (site_name/address/town/state), created
          alongside the customer itself in createCustomerHandler. */}
      <ErpDenseFormRow label="Site Name" required>
        <input
          value={form.site_name}
          onChange={(event) => updateField("site_name", event.target.value)}
          placeholder="e.g. Kolhapur Batching Plant"
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </ErpDenseFormRow>
      {!isMinimal ? (
        <>
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
        </>
      ) : null}

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
