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
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { useMenu } from "../../../../context/useMenu.js";
import {
  changeCustomerStatus,
  getCustomer,
  listCustomerCompanyMaps,
  mapCustomerToCompany,
  updateCustomer,
} from "../omApi.js";
import {
  useParentCustomersQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

const FO_CUSTOMER_TYPE_OPTIONS = [
  { value: "", label: "-- Not an FO party --" },
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "MTEST", label: "MTEST" },
  { value: "MTS", label: "MTS" },
];

function normalizeFoCustomerType(value) {
  return String(value || "").toUpperCase() === "ZTEST" ? "MTEST" : String(value || "");
}

function getAllowedStatusTargets(status) {
  const transitions = {
    DRAFT: ["ACTIVE", "INACTIVE", "PENDING_APPROVAL"],
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
  const [form, setForm] = useState(null);
  const [mapCompanyId, setMapCompanyId] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { runtimeContext } = useMenu();
  const parentCustomerQuery = useParentCustomersQuery();
  const detailQuery = useQuery({
    queryKey: ["om", "customer-detail", id],
    queryFn: async () => {
      const [result, companyMapResult] = await Promise.all([
        getCustomer(id),
        listCustomerCompanyMaps(id),
      ]);
      return {
        customer: result?.data ?? null,
        companyMaps: Array.isArray(companyMapResult?.data) ? companyMapResult.data : [],
      };
    },
    enabled: Boolean(id),
  });
  const customer = detailQuery.data?.customer ?? null;
  const parentCustomers = Array.isArray(parentCustomerQuery.data?.data)
    ? parentCustomerQuery.data.data
    : Array.isArray(parentCustomerQuery.data)
    ? parentCustomerQuery.data
    : [];
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyMaps = detailQuery.data?.companyMaps ?? [];
  const loading =
    detailQuery.isLoading ||
    parentCustomerQuery.isLoading;

  const isVendorLinked = Boolean(customer?.vendor_id);

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    if (!customer) {
      return;
    }
    setForm({
      customer_name: customer.customer_name ?? "",
      gst_number: customer.gst_number ?? "",
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

  useEffect(() => {
    setError(
      (!id ? "OM_CUSTOMER_NOT_FOUND" : "") ||
      detailQuery.error?.message ||
      parentCustomerQuery.error?.message ||
      ""
    );
  }, [detailQuery.error, id, parentCustomerQuery.error]);

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
    if (!form.billing_state || !form.billing_state.trim()) {
      setError("Billing state is required (needed for CGST/SGST vs IGST on invoices).");
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
        billing_state: form.billing_state,
        town: form.town,
        primary_contact_person: form.primary_contact_person,
        phone: form.phone,
        primary_email: form.primary_email,
        fo_customer_type: form.fo_customer_type,
      });
      if (result?.data) {
        await detailQuery.refetch();
      }
      setEditMode(false);
      setNotice("Customer updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CUSTOMER_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompanyMapSave() {
    if (!customer?.id || !mapCompanyId) {
      setError("OM_COMPANY_NOT_FOUND");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await mapCustomerToCompany({
        customer_id: customer.id,
        company_id: mapCompanyId,
      });
      await detailQuery.refetch();
      setMapCompanyId("");
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
      if (result?.data) {
        await detailQuery.refetch();
      }
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
              <ErpFieldPreview label="FO Type" value={normalizeFoCustomerType(customer.fo_customer_type) || "Not an FO party"} />
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
                <ErpDenseFormRow label="FO Type (Plan Feed party filter)">
                  <select
                    value={form.fo_customer_type}
                    onChange={(event) => setField("fo_customer_type", event.target.value)}
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
                <ErpDenseFormRow label="Billing State" required>
                  <input
                    value={form.billing_state}
                    onChange={(event) => setField("billing_state", event.target.value)}
                    placeholder="e.g. West Bengal"
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">Determines CGST+SGST vs IGST on sales invoices.</p>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Town">
                  <input
                    value={form.town}
                    onChange={(event) => setField("town", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
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
                <ErpFieldPreview label="Billing State" value={customer.billing_state} />
                <ErpFieldPreview label="Town" value={customer.town} />
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

          <ErpSectionCard eyebrow="Company Mapping" title="Map customer to companies">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Company" required>
                  <select
                    value={mapCompanyId}
                    onChange={(event) => setMapCompanyId(event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select company</option>
                    {companies.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.company_code} | {entry.company_name}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <button
                  type="button"
                  onClick={() => void handleCompanyMapSave()}
                  disabled={saving}
                  className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                >
                  {saving ? "Saving..." : "Map to Company"}
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  {
                    key: "company",
                    label: "Company",
                    render: (row) =>
                      row.companies
                        ? `${row.companies.company_code} | ${row.companies.company_name}`
                        : companies.find((c) => c.id === row.company_id)?.company_name ?? row.company_id,
                  },
                  { key: "active", label: "Active", render: (row) => (row.active ? "YES" : "NO") },
                ]}
                rows={companyMaps}
                rowKey={(row) => row.id ?? row.company_id}
                emptyMessage="Not mapped to any company yet."
                maxHeight="200px"
              />
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
