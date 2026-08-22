/*
 * File-ID: 15.13
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render FG Sales Customer detail, edit, status, and company
 *          mapping workflows, including Parent Company and Vendor link.
 *          Edit mode delegates its field body to the shared CustomerEditForm
 *          (also embedded by Plan Feed's "Edit Customer" button) so both
 *          entry points write the same customer_master row through the same
 *          handler.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { useMenu } from "../../../../context/useMenu.js";
import {
  changeCustomerStatus,
  getCustomer,
  listCustomerCompanyMaps,
  mapCustomerToCompany,
} from "../omApi.js";
import CustomerEditForm from "./CustomerEditForm.jsx";

function normalizeFoCustomerType(value) {
  return String(value || "").toUpperCase() === "ZTEST" ? "MTEST" : String(value || "");
}

const FIELD_VALUE_COLUMNS = [
  { key: "label", label: "Field", width: "220px" },
  {
    key: "value",
    label: "Value",
    wrap: true,
    render: (row) => row.value || <span className="text-slate-400">Not available yet</span>,
  },
];

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
  const [mapCompanyId, setMapCompanyId] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { runtimeContext } = useMenu();
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
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyMaps = detailQuery.data?.companyMaps ?? [];
  const loading = detailQuery.isLoading;

  const isVendorLinked = Boolean(customer?.vendor_id);

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    setError((!id ? "OM_CUSTOMER_NOT_FOUND" : "") || detailQuery.error?.message || "");
  }, [detailQuery.error, id]);

  async function handleEditSaved() {
    await detailQuery.refetch();
    setEditMode(false);
    setNotice("Customer updated.");
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
      title="FG Sales Customer Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((current) => !current), disabled: loading || !customer },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      {loading || !customer ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading customer detail..." : "Customer detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${customer.customer_code || "-"} | ${customer.customer_name || "-"}`}>
            <ErpDenseGrid
              columns={FIELD_VALUE_COLUMNS}
              rows={[
                { label: "Status", value: customer.status },
                { label: "Type", value: customer.customer_type },
                { label: "FO Type", value: normalizeFoCustomerType(customer.fo_customer_type) || "Not an FO party" },
                { label: "Currency", value: customer.currency_code },
                { label: "GST Number", value: customer.gst_number },
                { label: "GST Category", value: customer.gst_category },
                {
                  label: "Linked Vendor",
                  value: isVendorLinked ? `${customer.vendor_code} (name/GST mirror this vendor)` : "Independent customer",
                },
                {
                  label: "Parent Company",
                  value: customer.parent_customer_code ? `${customer.parent_customer_code} | ${customer.parent_customer_name}` : "",
                },
              ]}
              rowKey={(row) => row.label}
              maxHeight="none"
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="View Or Edit" title="Customer fields">
            {editMode ? (
              <CustomerEditForm
                customerId={customer.id}
                submitLabel="Save"
                onCancel={() => setEditMode(false)}
                onSaved={() => void handleEditSaved()}
              />
            ) : (
              <ErpDenseGrid
                columns={FIELD_VALUE_COLUMNS}
                rows={[
                  { label: "Customer Name", value: customer.customer_name },
                  { label: "Primary Contact", value: customer.primary_contact_person },
                  { label: "Phone", value: customer.phone },
                  { label: "Primary Email", value: customer.primary_email },
                  { label: "Delivery Address", value: customer.delivery_address },
                  { label: "Billing Address", value: customer.billing_address },
                  { label: "Billing State", value: customer.billing_state },
                  { label: "Town", value: customer.town },
                ]}
                rowKey={(row) => row.label}
                maxHeight="none"
              />
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
