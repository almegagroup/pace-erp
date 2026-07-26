/*
 * File-ID: 15.7
 * File-Path: frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render vendor detail, edit, status, company mapping, and payment terms workflows.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { useMenu } from "../../../../context/useMenu.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  addVendorPaymentTerms,
  changeVendorStatus,
  getVendor,
  getVendorContacts,
  getVendorEmails,
  getVendorPaymentTerms,
  listVendorMaterialInfos,
  listVendorCompanyMaps,
  mapVendorToCompany,
  updateVendor,
  upsertVendorContacts,
  upsertVendorEmails,
} from "../omApi.js";
import {
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

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

// Mirrors backend's assertManagerOrSARole exactly (supabase/functions/api/_core/om/shared.ts).
const MANAGER_OR_SA_ROLES = new Set(["SA", "GA", "DIRECTOR", "L4_MANAGER", "L3_MANAGER", "L2_MANAGER"]);

export default function VendorDetailPage() {
  const { shellProfile, runtimeContext } = useMenu();
  const canEdit = MANAGER_OR_SA_ROLES.has(shellProfile?.roleCode);
  const [searchParams] = useSearchParams();
  const context = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchId = searchParams.get("id");
  const id = searchId || context.id || "";

  const [form, setForm] = useState(null);
  const [termsCompanyId, setTermsCompanyId] = useState("");
  const [termsForm, setTermsForm] = useState({ payment_days: "30", payment_method: "", notes: "" });
  const [mapCompanyId, setMapCompanyId] = useState("");
  const [showApprovedMaterials, setShowApprovedMaterials] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailQuery = useQuery({
    queryKey: ["om", "vendor-detail", id],
    queryFn: async () => {
      const [vendorResult, companyMapResult] = await Promise.all([
        getVendor(id),
        listVendorCompanyMaps(id),
      ]);
      return {
        vendor: vendorResult?.data ?? null,
        companyMaps: Array.isArray(companyMapResult?.data) ? companyMapResult.data : [],
      };
    },
    enabled: Boolean(id),
  });
  const paymentTermsQuery = useQuery({
    queryKey: ["om", "vendor-payment-terms", id, termsCompanyId || null],
    queryFn: async () => {
      const result = await getVendorPaymentTerms(id, termsCompanyId);
      return Array.isArray(result?.data) ? result.data : [];
    },
    enabled: Boolean(id && termsCompanyId),
  });
  const approvedMaterialsQuery = useQuery({
    queryKey: ["om", "vendor-approved-materials", id],
    queryFn: async () => {
      const aslResult = await listVendorMaterialInfos({ vendor_id: id, limit: 200, offset: 0 });
      return Array.isArray(aslResult?.data) ? aslResult.data : [];
    },
    enabled: Boolean(id && showApprovedMaterials),
  });
  const materialOptionsQuery = useMaterialOptionsQuery(
    { limit: 200, offset: 0 },
    { enabled: Boolean(showApprovedMaterials) }
  );
  const vendor = detailQuery.data?.vendor ?? null;
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyMaps = detailQuery.data?.companyMaps ?? [];
  const paymentTerms = paymentTermsQuery.data ?? [];
  const aslRows = approvedMaterialsQuery.data ?? [];
  const materialDirectory = materialOptionsQuery.materials;
  const aslLoading = approvedMaterialsQuery.isLoading || materialOptionsQuery.isLoading;
  const loading = detailQuery.isLoading;

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    if (!vendor) {
      return;
    }
    setForm({
      vendor_name: vendor.vendor_name ?? "",
      gst_number: vendor.gst_number ?? "",
      gst_category: vendor.gst_category ?? "",
      bin_number: vendor.bin_number ?? "",
      tin_number: vendor.tin_number ?? "",
      trade_license: vendor.trade_license ?? "",
      iec_code: vendor.iec_code ?? "",
      import_license: vendor.import_license ?? "",
      country_code: vendor.country_code ?? "",
      reg_address_line1: vendor.reg_address_line1 ?? "",
      reg_address_city: vendor.reg_address_city ?? "",
      reg_address_state: vendor.reg_address_state ?? "",
      reg_address_pin: vendor.reg_address_pin ?? "",
      corr_address_line1: vendor.corr_address_line1 ?? "",
      corr_address_city: vendor.corr_address_city ?? "",
      corr_address_state: vendor.corr_address_state ?? "",
      corr_address_pin: vendor.corr_address_pin ?? "",
      currency_code: vendor.currency_code ?? "BDT",
      msme_registered: vendor.msme_registered ?? null,
      msme_certificate_number: vendor.msme_certificate_number ?? "",
    });
    setTermsCompanyId((current) => current || vendor.latest_payment_terms?.company_id || "");
  }, [vendor]);

  useEffect(() => {
    setError(
      detailQuery.error?.message ||
      paymentTermsQuery.error?.message ||
      approvedMaterialsQuery.error?.message ||
      materialOptionsQuery.error?.message ||
      ""
    );
  }, [approvedMaterialsQuery.error, detailQuery.error, materialOptionsQuery.error, paymentTermsQuery.error]);

  async function handleLoadPaymentTerms(companyId) {
    if (!vendor?.id || !companyId) return;
    setTermsCompanyId(companyId);
  }

  function setField(key, value) { setForm((p) => ({ ...p, [key]: value })); }

  async function handleSave() {
    if (!vendor?.id || !form) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await updateVendor({
        id: vendor.id,
        vendor_name: form.vendor_name,
        gst_number: form.gst_number,
        gst_category: form.gst_category,
        bin_number: form.bin_number,
        tin_number: form.tin_number,
        trade_license: form.trade_license,
        iec_code: form.iec_code,
        import_license: form.import_license,
        country_code: form.country_code,
        reg_address_line1: form.reg_address_line1,
        reg_address_city: form.reg_address_city,
        reg_address_state: form.reg_address_state,
        reg_address_pin: form.reg_address_pin,
        corr_address_line1: form.corr_address_line1,
        corr_address_city: form.corr_address_city,
        corr_address_state: form.corr_address_state,
        corr_address_pin: form.corr_address_pin,
        currency_code: form.currency_code,
        msme_registered: form.msme_registered,
        msme_certificate_number: form.msme_certificate_number,
      });
      if (result?.data) {
        await detailQuery.refetch();
      }
      setEditMode(false); setNotice("Vendor updated.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_VENDOR_UPDATE_FAILED"); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(newStatus) {
    if (!vendor?.id) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await changeVendorStatus({ id: vendor.id, new_status: newStatus });
      await detailQuery.refetch();
      setNotice(`Vendor moved to ${newStatus}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "OM_VENDOR_STATUS_UPDATE_FAILED"); }
    finally { setSaving(false); }
  }

  async function handleCompanyMapSave() {
    if (!vendor?.id || !mapCompanyId) { setError("OM_COMPANY_NOT_FOUND"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await mapVendorToCompany({ vendor_id: vendor.id, company_id: mapCompanyId });
      await detailQuery.refetch();
      setMapCompanyId(""); setNotice("Vendor mapped to company.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_VENDOR_COMPANY_MAP_FAILED"); }
    finally { setSaving(false); }
  }

  async function handleAddPaymentTerms() {
    if (!vendor?.id || !termsCompanyId) { setError("OM_COMPANY_NOT_FOUND"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await addVendorPaymentTerms({ vendor_id: vendor.id, company_id: termsCompanyId, payment_days: Number(termsForm.payment_days), payment_method: termsForm.payment_method || undefined, notes: termsForm.notes || undefined });
      await paymentTermsQuery.refetch();
      setTermsForm({ payment_days: "30", payment_method: "", notes: "" });
      setNotice("Payment terms appended.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_PAYMENT_TERMS_CREATE_FAILED"); }
    finally { setSaving(false); }
  }

  async function loadApprovedMaterials() {
    if (!vendor?.id) return;
    await Promise.all([approvedMaterialsQuery.refetch(), materialOptionsQuery.refetch()]);
  }

  const allowedTargets = getAllowedStatusTargets(vendor?.status);
  const materialMap = useMemo(() => new Map(materialDirectory.map((m) => [m.id, m])), [materialDirectory]);
  const companyOptions = useMemo(() => companies.map((c) => ({ value: c.id, label: `${c.company_code} | ${c.company_name}` })), [companies]);
  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const INPUT_CLS = "h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500";
  const SELECT_CLS = "h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500";

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Vendor Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(canEdit ? [
          { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((v) => !v), disabled: loading || !vendor },
          { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving || !editMode },
        ] : []),
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
          {/* ── Header ── */}
          <ErpSectionCard eyebrow="Header" title={`${vendor.vendor_code || "-"} | ${vendor.vendor_name || "-"}`}>
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Status" value={vendor.status} tone="sky" />
              <ErpFieldPreview label="Vendor Type" value={vendor.vendor_type} />
              <ErpFieldPreview label="Currency" value={vendor.currency_code} />
              <ErpFieldPreview label="GST Number" value={vendor.gst_number} />
            </div>
          </ErpSectionCard>

          {/* ── Edit fields ── */}
          <ErpSectionCard eyebrow="View Or Edit" title="Vendor fields">
            {editMode ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Vendor Name" required>
                  <input value={form.vendor_name} onChange={(e) => setField("vendor_name", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="GST Number">
                  <input value={form.gst_number} onChange={(e) => setField("gst_number", e.target.value.toUpperCase())} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="GST Category">
                  <input value={form.gst_category} onChange={(e) => setField("gst_category", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="BIN Number">
                  <input value={form.bin_number} onChange={(e) => setField("bin_number", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="TIN Number">
                  <input value={form.tin_number} onChange={(e) => setField("tin_number", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Trade License">
                  <input value={form.trade_license} onChange={(e) => setField("trade_license", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                {vendor.vendor_type === "IMPORT" && (
                  <>
                    <ErpDenseFormRow label="Country Code">
                      <input value={form.country_code} onChange={(e) => setField("country_code", e.target.value.toUpperCase())} className={INPUT_CLS} />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="IEC Code">
                      <input value={form.iec_code} onChange={(e) => setField("iec_code", e.target.value)} className={INPUT_CLS} />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Import License">
                      <input value={form.import_license} onChange={(e) => setField("import_license", e.target.value)} className={INPUT_CLS} />
                    </ErpDenseFormRow>
                  </>
                )}
                <ErpDenseFormRow label="Registered Address — Line 1">
                  <input value={form.reg_address_line1} onChange={(e) => setField("reg_address_line1", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Registered Address — City">
                  <input value={form.reg_address_city} onChange={(e) => setField("reg_address_city", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Registered Address — State">
                  <input value={form.reg_address_state} onChange={(e) => setField("reg_address_state", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Registered Address — PIN">
                  <input value={form.reg_address_pin} onChange={(e) => setField("reg_address_pin", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Correspondence Address — Line 1">
                  <input value={form.corr_address_line1} onChange={(e) => setField("corr_address_line1", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Correspondence Address — City">
                  <input value={form.corr_address_city} onChange={(e) => setField("corr_address_city", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Correspondence Address — State">
                  <input value={form.corr_address_state} onChange={(e) => setField("corr_address_state", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Correspondence Address — PIN">
                  <input value={form.corr_address_pin} onChange={(e) => setField("corr_address_pin", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Currency">
                  <select value={form.currency_code} onChange={(e) => setField("currency_code", e.target.value)} className={INPUT_CLS}>
                    {CURRENCY_OPTIONS.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.code} | {entry.country}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                {vendor.vendor_type === "DOMESTIC" && (
                  <>
                    <ErpDenseFormRow label="MSME Registered">
                      <select
                        value={form.msme_registered === null || form.msme_registered === undefined ? "" : (form.msme_registered ? "YES" : "NO")}
                        onChange={(e) => setField("msme_registered", e.target.value === "" ? null : e.target.value === "YES")}
                        className={INPUT_CLS}
                      >
                        <option value="">— Not specified —</option>
                        <option value="YES">Yes</option>
                        <option value="NO">No</option>
                      </select>
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="MSME Certificate Number">
                      <input
                        value={form.msme_certificate_number}
                        onChange={(e) => setField("msme_certificate_number", e.target.value)}
                        disabled={form.msme_registered !== true}
                        placeholder={form.msme_registered === true ? "" : "Set MSME Registered = Yes first"}
                        className={INPUT_CLS}
                      />
                    </ErpDenseFormRow>
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview label="Vendor Name" value={vendor.vendor_name} />
                <ErpFieldPreview label="GST Category" value={vendor.gst_category} />
                <ErpFieldPreview label="BIN Number" value={vendor.bin_number} />
                <ErpFieldPreview label="TIN Number" value={vendor.tin_number} />
                <ErpFieldPreview label="Trade License" value={vendor.trade_license} />
                {vendor.vendor_type === "IMPORT" && (
                  <>
                    <ErpFieldPreview label="Country Code" value={vendor.country_code} />
                    <ErpFieldPreview label="IEC Code" value={vendor.iec_code} />
                    <ErpFieldPreview label="Import License" value={vendor.import_license} />
                  </>
                )}
                <ErpFieldPreview
                  label="Registered Address"
                  value={[vendor.reg_address_line1, vendor.reg_address_city, vendor.reg_address_state, vendor.reg_address_pin].filter(Boolean).join(", ")}
                  multiline
                />
                <ErpFieldPreview
                  label="Correspondence Address"
                  value={[vendor.corr_address_line1, vendor.corr_address_city, vendor.corr_address_state, vendor.corr_address_pin].filter(Boolean).join(", ")}
                  multiline
                />
                {vendor.vendor_type === "DOMESTIC" && (
                  <>
                    <ErpFieldPreview
                      label="MSME Registered"
                      value={vendor.msme_registered === null || vendor.msme_registered === undefined ? "Not specified" : (vendor.msme_registered ? "Yes" : "No")}
                    />
                    {vendor.msme_registered === true && (
                      <ErpFieldPreview label="MSME Certificate Number" value={vendor.msme_certificate_number} />
                    )}
                  </>
                )}
              </div>
            )}
          </ErpSectionCard>

          {/* ── Contacts & Emails ── */}
          <VendorContactsEmailsCard vendorId={vendor.id} canEdit={canEdit} />

          {/* ── Lifecycle ── */}
          <ErpSectionCard eyebrow="Lifecycle" title="Status actions">
            <div className="flex flex-wrap gap-2">
              {!canEdit ? (
                <div className="text-sm text-slate-500">Read-only — status changes require Manager or SA access.</div>
              ) : allowedTargets.length === 0 ? (
                <div className="text-sm text-slate-500">No status change is allowed from the current state.</div>
              ) : allowedTargets.map((t) => (
                <button key={t} type="button" onClick={() => void handleStatusChange(t)} disabled={saving}
                  className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900">
                  Move To {t}
                </button>
              ))}
            </div>
          </ErpSectionCard>

          {/* ── Company Mapping ── */}
          <ErpSectionCard eyebrow="Company Mapping" title="Map vendor to companies">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {canEdit ? (
                <div className="grid gap-3">
                  <ErpDenseFormRow label="Company" required>
                    <select value={mapCompanyId} onChange={(e) => setMapCompanyId(e.target.value)} className={SELECT_CLS}>
                      <option value="">Select company</option>
                      {companyOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </ErpDenseFormRow>
                  <button type="button" onClick={() => void handleCompanyMapSave()} disabled={saving}
                    className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900">
                    {saving ? "Saving..." : "Map to Company"}
                  </button>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Read-only — company mapping requires Manager or SA access.</div>
              )}
              <ErpDenseGrid
                columns={[
                  { key: "company", label: "Company", render: (row) => row.companies ? `${row.companies.company_code} | ${row.companies.company_name}` : companyMap.get(row.company_id)?.company_name ?? row.company_id },
                  { key: "active", label: "Active", render: (row) => (row.active ? "YES" : "NO") },
                ]}
                rows={companyMaps}
                rowKey={(row) => row.id ?? row.company_id}
                emptyMessage="Not mapped to any company yet."
                maxHeight="200px"
              />
            </div>
          </ErpSectionCard>

          {/* ── Payment Terms ── */}
          <ErpSectionCard eyebrow="Payment Terms" title="Append-only terms history">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Company" required>
                  <select
                    value={termsCompanyId}
                    onChange={(e) => {
                      setTermsCompanyId(e.target.value);
                      void handleLoadPaymentTerms(e.target.value);
                    }}
                    className={SELECT_CLS}
                  >
                    <option value="">Select company</option>
                    {companyOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </ErpDenseFormRow>
                {canEdit ? (
                  <>
                    <ErpDenseFormRow label="Payment Days">
                      <input type="number" min="0" value={termsForm.payment_days} onChange={(e) => setTermsForm((p) => ({ ...p, payment_days: e.target.value }))} className={INPUT_CLS} />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Payment Method">
                      <input value={termsForm.payment_method} onChange={(e) => setTermsForm((p) => ({ ...p, payment_method: e.target.value }))} className={INPUT_CLS} />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Notes">
                      <textarea rows={3} value={termsForm.notes} onChange={(e) => setTermsForm((p) => ({ ...p, notes: e.target.value }))} className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </ErpDenseFormRow>
                    <button type="button" onClick={() => void handleAddPaymentTerms()} disabled={saving}
                      className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900">
                      Add Payment Terms
                    </button>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">Read-only — adding payment terms requires Manager or SA access.</div>
                )}
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "company", label: "Company", render: (row) => companyMap.get(row.company_id)?.company_code ?? row.company_id },
                  { key: "payment_days", label: "Days" },
                  { key: "payment_method", label: "Method" },
                  { key: "notes", label: "Notes" },
                  { key: "recorded_at", label: "Recorded At" },
                ]}
                rows={paymentTerms}
                rowKey={(row) => row.id}
                emptyMessage="Select a company to view payment terms."
                maxHeight="320px"
              />
            </div>
          </ErpSectionCard>

          {/* ── Approved Materials (ASL) ── */}
          <ErpSectionCard eyebrow="Approved Materials" title="Approved Materials (ASL)">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  const next = !showApprovedMaterials;
                  setShowApprovedMaterials(next);
                  if (next && aslRows.length === 0 && !aslLoading) void loadApprovedMaterials();
                }}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showApprovedMaterials ? "Hide" : "Show"} Approved Materials
              </button>
              {showApprovedMaterials ? (
                aslLoading ? (
                  <div className="text-sm text-slate-500">Loading approved materials...</div>
                ) : (
                  <ErpDenseGrid
                    columns={[
                      { key: "material_code", label: "Material Code", render: (row) => materialMap.get(row.material_id)?.pace_code || row.material_id },
                      { key: "material_name", label: "Material Name", render: (row) => materialMap.get(row.material_id)?.material_name || "Unknown material" },
                      { key: "default_uom_code", label: "Default UOM" },
                      { key: "default_currency_code", label: "Default Currency" },
                      { key: "status", label: "Status", render: (row) => <span className="inline-flex rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">{row.status || "-"}</span> },
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

function VendorContactsEmailsCard({ vendorId, canEdit }) {
  const [contacts, setContacts] = useState([]);
  const [emails, setEmails] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const contactEmailQuery = useQuery({
    queryKey: ["om", "vendor-contacts-emails", vendorId],
    queryFn: async () => {
      const [contactsResult, emailsResult] = await Promise.allSettled([
        getVendorContacts(vendorId),
        getVendorEmails(vendorId),
      ]);
      return {
        contacts:
          contactsResult.status === "fulfilled"
            ? (Array.isArray(contactsResult.value) ? contactsResult.value : contactsResult.value?.data ?? [])
            : [],
        emails:
          emailsResult.status === "fulfilled"
            ? (Array.isArray(emailsResult.value) ? emailsResult.value : emailsResult.value?.data ?? [])
            : [],
      };
    },
    enabled: Boolean(vendorId),
  });
  const loading = contactEmailQuery.isLoading;

  useEffect(() => {
    setContacts(contactEmailQuery.data?.contacts ?? []);
    setEmails(contactEmailQuery.data?.emails ?? []);
  }, [contactEmailQuery.data]);

  function updateContact(idx, patch) {
    setContacts((list) => list.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addContact() {
    setContacts((list) => [...list, { contact_name: "", phone: "", designation: "", is_primary: list.length === 0 }]);
  }
  function removeContact(idx) {
    setContacts((list) => list.filter((_, i) => i !== idx));
  }
  async function saveContacts() {
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = await upsertVendorContacts({ vendor_id: vendorId, contacts });
      setContacts(Array.isArray(saved) ? saved : saved?.data ?? []);
      await contactEmailQuery.refetch();
      setNotice("Contacts saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "OM_VENDOR_CONTACTS_FAILED");
    } finally { setSaving(false); }
  }

  function updateEmail(idx, patch) {
    setEmails((list) => list.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function addEmail() {
    setEmails((list) => [...list, { email: "", label: "", is_primary: list.length === 0 }]);
  }
  function removeEmail(idx) {
    setEmails((list) => list.filter((_, i) => i !== idx));
  }
  async function saveEmails() {
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = await upsertVendorEmails({ vendor_id: vendorId, emails });
      setEmails(Array.isArray(saved) ? saved : saved?.data ?? []);
      await contactEmailQuery.refetch();
      setNotice("Emails saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "OM_VENDOR_EMAILS_FAILED");
    } finally { setSaving(false); }
  }

  return (
    <ErpSectionCard eyebrow="Contacts & Emails" title="Vendor contacts and email recipients">
      {loading ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-[0.07em] text-slate-600">Contacts</h4>
              {canEdit && <button type="button" onClick={addContact} className="border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">+ Add</button>}
            </div>
            <div className="grid gap-2">
              {contacts.map((c, idx) => (
                <div key={idx} className="grid gap-1 border border-slate-100 p-2">
                  <input disabled={!canEdit} value={c.contact_name ?? ""} onChange={(e) => updateContact(idx, { contact_name: e.target.value })} placeholder="Name" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500 disabled:bg-slate-50" />
                  <input disabled={!canEdit} value={c.phone ?? ""} onChange={(e) => updateContact(idx, { phone: e.target.value })} placeholder="Phone" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500 disabled:bg-slate-50" />
                  <input disabled={!canEdit} value={c.designation ?? ""} onChange={(e) => updateContact(idx, { designation: e.target.value })} placeholder="Designation" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500 disabled:bg-slate-50" />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      <input type="checkbox" disabled={!canEdit} checked={Boolean(c.is_primary)} onChange={(e) => updateContact(idx, { is_primary: e.target.checked })} /> Primary
                    </label>
                    {canEdit && <button type="button" onClick={() => removeContact(idx)} className="text-[11px] font-semibold text-rose-600">Remove</button>}
                  </div>
                </div>
              ))}
              {contacts.length === 0 && <p className="text-xs text-slate-400">No contacts yet.</p>}
            </div>
            {canEdit && <button type="button" disabled={saving} onClick={() => void saveContacts()} className="mt-2 w-full border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save Contacts</button>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-[0.07em] text-slate-600">Emails</h4>
              {canEdit && <button type="button" onClick={addEmail} className="border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">+ Add</button>}
            </div>
            <div className="grid gap-2">
              {emails.map((e, idx) => (
                <div key={idx} className="grid gap-1 border border-slate-100 p-2">
                  <input disabled={!canEdit} value={e.email ?? ""} onChange={(ev) => updateEmail(idx, { email: ev.target.value })} placeholder="Email" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500 disabled:bg-slate-50" />
                  <input disabled={!canEdit} value={e.label ?? ""} onChange={(ev) => updateEmail(idx, { label: ev.target.value })} placeholder="Label (e.g. Billing)" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500 disabled:bg-slate-50" />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      <input type="checkbox" disabled={!canEdit} checked={Boolean(e.is_primary)} onChange={(ev) => updateEmail(idx, { is_primary: ev.target.checked })} /> Primary
                    </label>
                    {canEdit && <button type="button" onClick={() => removeEmail(idx)} className="text-[11px] font-semibold text-rose-600">Remove</button>}
                  </div>
                </div>
              ))}
              {emails.length === 0 && <p className="text-xs text-slate-400">No emails yet.</p>}
            </div>
            {canEdit && <button type="button" disabled={saving} onClick={() => void saveEmails()} className="mt-2 w-full border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save Emails</button>}
          </div>
        </div>
      )}
      {(error || notice || contactEmailQuery.error?.message) && (
        <p className={`mt-2 text-xs font-semibold ${error ? "text-rose-700" : "text-emerald-700"}`}>{error || notice}</p>
      )}
    </ErpSectionCard>
  );
}
