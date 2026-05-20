/*
 * File-ID: 15.9
 * File-Path: frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the approved source list creation form with vendor/material/UOM lookups.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createVendorMaterialInfo, listMaterials, listUoms, listVendors } from "../omApi.js";

export default function AslCreatePage() {
  const [vendors, setVendors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [form, setForm] = useState({
    vendor_id: "",
    material_id: "",
    po_uom_code: "",
    conversion_factor: "1",
    vendor_material_code: "",
    lead_time_days: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function loadDependencies() {
      setLoading(true);
      setError("");
      try {
        const [vendorResult, materialResult, uomResult] = await Promise.all([
          listVendors({ status: "ACTIVE", limit: 50, offset: 0 }),
          listMaterials({ status: "ACTIVE", limit: 50, offset: 0 }),
          listUoms({ is_active: true }),
        ]);
        if (!active) {
          return;
        }
        setVendors(Array.isArray(vendorResult?.data) ? vendorResult.data : []);
        setMaterials(Array.isArray(materialResult?.data) ? materialResult.data : []);
        setUoms(Array.isArray(uomResult?.data) ? uomResult.data : []);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_VMI_CREATE_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void loadDependencies();
    return () => {
      active = false;
    };
  }, []);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.vendor_id || !form.material_id || !form.po_uom_code) {
      setError("OM_VMI_CREATE_FAILED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createVendorMaterialInfo({
        vendor_id: form.vendor_id,
        material_id: form.material_id,
        po_uom_code: form.po_uom_code,
        conversion_factor: Number(form.conversion_factor),
        vendor_material_code: form.vendor_material_code || undefined,
        lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : undefined,
      });
      setNotice("Approved source row created.");
      openScreen(OPERATION_SCREENS.OM_ASL_LIST.screen_code, { mode: "replace" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VMI_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create Approved Source"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save ASL", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="Vendor-Material Setup"
      formTitle="Create a new approved source list row"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading vendor, material, and UOM options...
          </div>
        ) : (
          <div className="grid gap-3">
            <ErpDenseFormRow label="Vendor" required>
              <select
                value={form.vendor_id}
                onChange={(event) => updateField("vendor_id", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select vendor</option>
                {vendors.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.vendor_code} | {entry.vendor_name}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Material" required>
              <select
                value={form.material_id}
                onChange={(event) => updateField("material_id", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select material</option>
                {materials.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.pace_code} | {entry.material_name}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="PO UOM" required>
              <select
                value={form.po_uom_code}
                onChange={(event) => updateField("po_uom_code", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select UOM</option>
                {uoms.map((entry) => (
                  <option key={entry.id || entry.code} value={entry.code}>
                    {entry.code} | {entry.name}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Conversion Factor">
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={form.conversion_factor}
                onChange={(event) => updateField("conversion_factor", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Vendor Material Code">
              <input
                value={form.vendor_material_code}
                onChange={(event) => updateField("vendor_material_code", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Lead Time Days">
              <input
                type="number"
                min="0"
                value={form.lead_time_days}
                onChange={(event) => updateField("lead_time_days", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
          </div>
        )
      }
    />
  );
}
