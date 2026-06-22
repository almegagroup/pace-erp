/*
 * File-ID: 15.13
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render RM/PM Sales Customer detail, edit, status, and company
 *          mapping workflows, including Parent Company and Vendor link.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  changeCustomerStatus,
  getCustomer,
  listParentCustomers,
  mapCustomerToCompany,
  updateCustomer,
} from "../omApi.js";

function getAllowedStatusTargets(status) {
  const transitions = {
    DRAFT: ["PENDING_APPROVAL"],
    PENDING_APPROVAL: ["ACTIVE", "DRAFT"],
    ACTIVE: ["INACTIVE", "BLOCKED"],
    INACTIVE: ["ACTIVE"],
    BLOCKED: ["ACTIVE"],
  };
  return transitions[String(status || "").toUpperCase()] ?? [];
}

export default function CustomerDetailPage() {
  const [searchParams] = useSearchParams();
  const context = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchId = searchParams.get("id");
  const id = searchId || context.id || "";
  const [customer, setCustomer] = useState(null);
  const [parentCustomers, setParentCustomers] = useState([]);
  const [form, setForm] = useState(null);
  const [companyMapForm, setCompanyMapForm] = useState({ company_id: "" });
  const [showCompanyMapping, setShowCompanyMapping] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isVendorLinked = Boolean(customer?.vendor_id);

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) {
        setError("OM_CUSTOMER_NOT_FOUND");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [result, parentResult] = await Promise.all([
          getCustomer(id),
          listParentCustomers(),
        ]);
        if (!active) {
          return;
        }
        const row = result?.data ?? null;
        setCustomer(row);
        setParentCustomers(Array.isArray(parentResult?.data) ? parentResult.data : []);
        setForm({
          customer_name: row?.customer_name ?? "",
          gst_number: row?.gst_number ?? "",
          currency_code: row?.currency_code ?? "BDT",
          parent_customer_id: row?.parent_customer_id ?? "",
          delivery_address: row?.delivery_address ?? "",
          billing_address: row?.billing_address ?? "",
          primary_contact_person: row?.primary_contact_person ?? "",
          phone: row?.phone ?? "",
          primary_email: row?.primary_email ?? "",
        });
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_CUSTOMER_LOOKUP_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!customer?.id || !form) {
      return;
    }
    if (!form.delivery_address || !form.delivery_address.trim()) {
      setError("DELIVERY_ADDRESS_REQUIRED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateCustomer({
        id: customer.id,
        ...(isVendorLinked ? {} : { customer_name: form.customer_name, gst_number: form.gst_number }),
        parent_customer_id: form.parent_customer_id || "",
        currency_code: form.currency_code,
        delivery_address: form.delivery_address,
        billing_address: form.billing_address,
        primary_contact_person: form.primary_contact_person,
        phone: form.phone,
        primary_email: form.primary_email,
      });
      setCustomer(result?.data ?? customer);
      setEditMode(false);
      setNotice("Customer updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompanyMapSave() {
    if (!customer?.id || !companyMapForm.company_id.trim()) {
      setError("OM_COMPANY_NOT_FOUND");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await mapCustomerToCompany({
        customer_id: customer.id,
        company_id: companyMapForm.company_id.trim(),
      });
      setCompanyMapForm({ company_id: "" });
      setNotice("Customer mapped to company");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_COMPANY_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus) {
    if (!customer?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await changeCustomerStatus({ id: customer.id, new_status: newStatus });
      setCustomer(result?.data ?? customer);
      setNotice(`Customer moved to ${newStatus}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OM_CUSTOMER_STATUS_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const allowedTargets = getAllowedStatusTargets(customer?.status);

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="RM/PM Sales Customer Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((current) => !current), disabled: loading || !customer },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving || !editMode },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      {loading || !customer || !form ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading customer detail..." : "Customer detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${customer.customer_code || "-"} | ${customer.customer_name || "-"}`}>
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Status" value={customer.status} tone="sky" />
              <ErpFieldPreview label="Type" value={customer.customer_type} />
              <ErpFieldPreview label="Currency" value={customer.currency_code} />
              <ErpFieldPreview label="GST Number" value={customer.gst_number} />
              <ErpFieldPreview
                label="Linked Vendor"
                value={isVendorLinked ? `${customer.vendor_code} (name/GST mirror this vendor)` : "Independent customer"}
              />
              <ErpFieldPreview
                label="Parent Company"
                value={customer.parent_customer_code ? `${customer.parent_customer_code} | ${customer.parent_customer_name}` : "-"}
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="View Or Edit" title="Customer fields">
            {editMode ? (
              <div className="grid gap-3">
                {isVendorLinked ? (
                  <p className="border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Name and GST come live from the linked vendor ({customer.vendor_code}) — edit the vendor record to change them.
                  </p>
                ) : (
                  <>
                    <ErpDenseFormRow label="Customer Name" required>
                      <input
                        value={form.customer_name}
                        onChange={(event) => setField("customer_name", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="GST Number">
                      <input
                        value={form.gst_number}
                        onChange={(event) => setField("gst_number", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                  </>
                )}
                <ErpDenseFormRow label="Parent Company">
                  <select
                    value={form.parent_customer_id}
                    onChange={(event) => setField("parent_customer_id", event.target.value)}
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
                    onChange={(event) => setField("currency_code", event.target.value)}
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
                    onChange={(event) => setField("delivery_address", event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Billing Address">
                  <textarea
                    rows={3}
                    value={form.billing_address}
                    onChange={(event) => setField("billing_address", event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Primary Contact">
                  <input
                    value={form.primary_contact_person}
                    onChange={(event) => setField("primary_contact_person", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Phone">
                  <input
                    value={form.phone}
                    onChange={(event) => setField("phone", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Primary Email">
                  <input
                    value={form.primary_email}
                    onChange={(event) => setField("primary_email", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview label="Customer Name" value={customer.customer_name} />
                <ErpFieldPreview label="Primary Contact" value={customer.primary_contact_person} />
                <ErpFieldPreview label="Phone" value={customer.phone} />
                <ErpFieldPreview label="Primary Email" value={customer.primary_email} />
                <ErpFieldPreview label="Delivery Address" value={customer.delivery_address} multiline />
                <ErpFieldPreview label="Billing Address" value={customer.billing_address} multiline />
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lifecycle" title="Status actions">
            <div className="flex flex-wrap gap-2">
              {allowedTargets.length === 0 ? (
                <div className="text-sm text-slate-500">No status change is allowed from the current state.</div>
              ) : (
                allowedTargets.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => void handleStatusChange(entry)}
                    disabled={saving}
                    className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
                  >
                    Move To {entry}
                  </button>
                ))
              )}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Company Mapping" title="Company Mapping">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setShowCompanyMapping((current) => !current)}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showCompanyMapping ? "Hide" : "Show"} Company Mapping
              </button>
              {showCompanyMapping ? (
                <div className="grid gap-3 border border-dashed border-slate-300 bg-slate-50 p-3">
                  <ErpDenseFormRow label="Company ID" required>
                    <input
                      value={companyMapForm.company_id}
                      onChange={(event) => setCompanyMapForm({ company_id: event.target.value })}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <button
                    type="button"
                    onClick={() => void handleCompanyMapSave()}
                    disabled={saving}
                    className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                  >
                    Map to Company
                  </button>
                </div>
              ) : null}
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
