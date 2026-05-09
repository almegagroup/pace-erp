/*
 * File-ID: 15.7
 * File-Path: frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render vendor detail, edit, status, and payment terms workflows.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  addVendorPaymentTerms,
  changeVendorStatus,
  getVendor,
  getVendorPaymentTerms,
  listMaterials,
  listVendorMaterialInfos,
  mapVendorToCompany,
  updateVendor,
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

export default function VendorDetailPage() {
  const [searchParams] = useSearchParams();
  const context = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchId = searchParams.get("id");
  const id = searchId || context.id || "";
  const [vendor, setVendor] = useState(null);
  const [form, setForm] = useState(null);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [termsForm, setTermsForm] = useState({
    company_id: "",
    payment_days: "30",
    payment_method: "",
    notes: "",
  });
  const [companyMapForm, setCompanyMapForm] = useState({ company_id: "" });
  const [aslRows, setAslRows] = useState([]);
  const [materialDirectory, setMaterialDirectory] = useState([]);
  const [showCompanyMapping, setShowCompanyMapping] = useState(false);
  const [showApprovedMaterials, setShowApprovedMaterials] = useState(false);
  const [aslLoading, setAslLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) {
        setError("OM_VENDOR_NOT_FOUND");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const vendorResult = await getVendor(id);
        if (!active) {
          return;
        }
        const vendorRow = vendorResult?.data ?? null;
        setVendor(vendorRow);
        setForm({
          vendor_name: vendorRow?.vendor_name ?? "",
          registered_address: vendorRow?.registered_address ?? "",
          primary_contact_person: vendorRow?.primary_contact_person ?? "",
          phone: vendorRow?.phone ?? "",
          primary_email: vendorRow?.primary_email ?? "",
          currency_code: vendorRow?.currency_code ?? "BDT",
        });

        const companyId = vendorRow?.latest_payment_terms?.company_id ?? "";
        if (companyId) {
          const termsResult = await getVendorPaymentTerms(id, companyId);
          if (active) {
            setPaymentTerms(Array.isArray(termsResult?.data) ? termsResult.data : []);
            setTermsForm((current) => ({ ...current, company_id: companyId }));
          }
        } else if (active) {
          setPaymentTerms([]);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_VENDOR_LOOKUP_FAILED");
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
    if (!vendor?.id || !form) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateVendor({
        id: vendor.id,
        vendor_name: form.vendor_name,
        registered_address: form.registered_address,
        primary_contact_person: form.primary_contact_person,
        phone: form.phone,
        primary_email: form.primary_email,
        currency_code: form.currency_code,
      });
      const nextVendor = result?.data ?? vendor;
      setVendor(nextVendor);
      setEditMode(false);
      setNotice("Vendor updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VENDOR_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus) {
    if (!vendor?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await changeVendorStatus({ id: vendor.id, new_status: newStatus });
      setVendor(result?.data ?? vendor);
      setNotice(`Vendor moved to ${newStatus}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OM_VENDOR_STATUS_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPaymentTerms() {
    if (!vendor?.id || !termsForm.company_id) {
      setError("OM_COMPANY_NOT_FOUND");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await addVendorPaymentTerms({
        vendor_id: vendor.id,
        company_id: termsForm.company_id,
        payment_days: Number(termsForm.payment_days),
        payment_method: termsForm.payment_method || undefined,
        notes: termsForm.notes || undefined,
      });
      setPaymentTerms((current) => [result?.data, ...current].filter(Boolean).slice(0, 10));
      setTermsForm((current) => ({ ...current, payment_days: "30", payment_method: "", notes: "" }));
      setNotice("Payment terms appended.");
    } catch (termsError) {
      setError(termsError instanceof Error ? termsError.message : "OM_PAYMENT_TERMS_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompanyMapSave() {
    if (!vendor?.id || !companyMapForm.company_id.trim()) {
      setError("OM_COMPANY_NOT_FOUND");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await mapVendorToCompany({
        vendor_id: vendor.id,
        company_id: companyMapForm.company_id.trim(),
      });
      setNotice("Vendor mapped to company");
      setCompanyMapForm({ company_id: "" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VENDOR_COMPANY_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function loadApprovedMaterials() {
    if (!vendor?.id) {
      return;
    }
    setAslLoading(true);
    setError("");
    try {
      const [aslResult, materialResult] = await Promise.all([
        listVendorMaterialInfos({ vendor_id: vendor.id, limit: 200, offset: 0 }),
        listMaterials({ limit: 200, offset: 0 }),
      ]);
      setAslRows(Array.isArray(aslResult?.data) ? aslResult.data : []);
      setMaterialDirectory(Array.isArray(materialResult?.data) ? materialResult.data : []);
    } catch (loadError) {
      setAslRows([]);
      setMaterialDirectory([]);
      setError(loadError instanceof Error ? loadError.message : "OM_VMI_LIST_FAILED");
    } finally {
      setAslLoading(false);
    }
  }

  const allowedTargets = getAllowedStatusTargets(vendor?.status);
  const materialMap = useMemo(
    () => new Map(materialDirectory.map((entry) => [entry.id, entry])),
    [materialDirectory]
  );

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Vendor Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((current) => !current), disabled: loading || !vendor },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving || !editMode },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      {loading || !vendor || !form ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading vendor detail..." : "Vendor detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${vendor.vendor_code || "-"} | ${vendor.vendor_name || "-"}`}>
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Status" value={vendor.status} tone="sky" />
              <ErpFieldPreview label="Vendor Type" value={vendor.vendor_type} />
              <ErpFieldPreview label="Currency" value={vendor.currency_code} />
              <ErpFieldPreview label="GST Number" value={vendor.gst_number} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="View Or Edit" title="Vendor fields">
            {editMode ? (
              <div className="grid gap-3">
                <ErpDenseFormRow label="Vendor Name" required>
                  <input
                    value={form.vendor_name}
                    onChange={(event) => setField("vendor_name", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Registered Address">
                  <textarea
                    rows={3}
                    value={form.registered_address}
                    onChange={(event) => setField("registered_address", event.target.value)}
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
                <ErpDenseFormRow label="Currency Code">
                  <input
                    value={form.currency_code}
                    onChange={(event) => setField("currency_code", event.target.value.toUpperCase())}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview label="Vendor Name" value={vendor.vendor_name} />
                <ErpFieldPreview label="Primary Contact" value={vendor.primary_contact_person} />
                <ErpFieldPreview label="Phone" value={vendor.phone} />
                <ErpFieldPreview label="Primary Email" value={vendor.primary_email} />
                <ErpFieldPreview label="Registered Address" value={vendor.registered_address} multiline />
                <ErpFieldPreview label="Correspondence Address" value={vendor.correspondence_address} multiline />
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

          <ErpSectionCard eyebrow="Payment Terms" title="Append-only terms history">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Company ID" required>
                  <input
                    value={termsForm.company_id}
                    onChange={(event) => setTermsForm((current) => ({ ...current, company_id: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Payment Days">
                  <input
                    type="number"
                    min="0"
                    value={termsForm.payment_days}
                    onChange={(event) => setTermsForm((current) => ({ ...current, payment_days: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Payment Method">
                  <input
                    value={termsForm.payment_method}
                    onChange={(event) => setTermsForm((current) => ({ ...current, payment_method: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Notes">
                  <textarea
                    rows={3}
                    value={termsForm.notes}
                    onChange={(event) => setTermsForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <button
                  type="button"
                  onClick={() => void handleAddPaymentTerms()}
                  disabled={saving}
                  className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                >
                  Add Payment Terms
                </button>
              </div>

              <ErpDenseGrid
                columns={[
                  { key: "company_id", label: "Company" },
                  { key: "payment_days", label: "Days" },
                  { key: "payment_method", label: "Method" },
                  { key: "notes", label: "Notes" },
                  { key: "recorded_at", label: "Recorded At" },
                  { key: "recorded_by", label: "Recorded By" },
                ]}
                rows={paymentTerms}
                rowKey={(row) => row.id}
                emptyMessage="No payment terms were recorded for this vendor/company pair."
                maxHeight="320px"
              />
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

          <ErpSectionCard eyebrow="Approved Materials" title="Approved Materials (ASL)">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  const next = !showApprovedMaterials;
                  setShowApprovedMaterials(next);
                  if (next && aslRows.length === 0 && !aslLoading) {
                    void loadApprovedMaterials();
                  }
                }}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showApprovedMaterials ? "Hide" : "Show"} Approved Materials
              </button>
              {showApprovedMaterials ? (
                aslLoading ? (
                  <div className="text-sm text-slate-500">Loading approved materials...</div>
                ) : aslRows.length === 0 ? (
                  <div className="text-sm text-slate-500">No approved materials for this vendor</div>
                ) : (
                  <ErpDenseGrid
                    columns={[
                      {
                        key: "material_code",
                        label: "Material Code",
                        render: (row) => materialMap.get(row.material_id)?.pace_code || row.material_id,
                      },
                      {
                        key: "material_name",
                        label: "Material Name",
                        render: (row) => materialMap.get(row.material_id)?.material_name || "Unknown material",
                      },
                      { key: "po_uom_code", label: "PO UOM" },
                      { key: "conversion_factor", label: "Factor" },
                      { key: "lead_time_days", label: "Lead Time" },
                      {
                        key: "status",
                        label: "Status",
                        render: (row) => (
                          <span className="inline-flex rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">
                            {row.status || "-"}
                          </span>
                        ),
                      },
                    ]}
                    rows={aslRows}
                    rowKey={(row) => row.id}
                    emptyMessage="No approved materials for this vendor"
                    maxHeight="320px"
                  />
                )
              ) : null}
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
