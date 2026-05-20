/*
 * File-ID: 15.4
 * File-Path: frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render material detail, edit, status, and UOM conversion workflows.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  changeMaterialStatus,
  createMaterialUomConversion,
  extendMaterialToCompany,
  extendMaterialToPlant,
  getMaterial,
  listMaterialUomConversions,
  listVendorMaterialInfos,
  listVendors,
  listUoms,
  updateMaterial,
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

export default function MaterialDetailPage() {
  const [searchParams] = useSearchParams();
  const context = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchId = searchParams.get("id");
  const id = searchId || context.id || "";
  const [material, setMaterial] = useState(null);
  const [form, setForm] = useState(null);
  const [uoms, setUoms] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [conversionForm, setConversionForm] = useState({
    from_uom_code: "",
    to_uom_code: "",
    conversion_factor: "1",
  });
  const [companyExtensionForm, setCompanyExtensionForm] = useState({
    company_id: "",
    procurement_allowed: true,
    hsn_override: "",
  });
  const [plantExtensionForm, setPlantExtensionForm] = useState({
    company_id: "",
    plant_id: "",
    safety_stock: "",
    reorder_point: "",
    min_order_qty: "",
    lead_time_days: "",
  });
  const [approvedVendors, setApprovedVendors] = useState([]);
  const [vendorDirectory, setVendorDirectory] = useState([]);
  const [showCompanyExtension, setShowCompanyExtension] = useState(false);
  const [showPlantExtension, setShowPlantExtension] = useState(false);
  const [showApprovedVendors, setShowApprovedVendors] = useState(false);
  const [approvedVendorsLoading, setApprovedVendorsLoading] = useState(false);
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
        setError("OM_MATERIAL_NOT_FOUND");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [materialResult, uomResult, conversionResult] = await Promise.all([
          getMaterial(id),
          listUoms({ is_active: true }),
          listMaterialUomConversions(id),
        ]);
        if (!active) {
          return;
        }
        const materialRow = materialResult?.data ?? null;
        setMaterial(materialRow);
        setForm({
          material_name: materialRow?.material_name ?? "",
          description: materialRow?.description ?? "",
          hsn_code: materialRow?.hsn_code ?? "",
          base_uom_code: materialRow?.base_uom_code ?? "",
        });
        setUoms(Array.isArray(uomResult?.data) ? uomResult.data : []);
        setConversions(Array.isArray(conversionResult?.data) ? conversionResult.data : []);
        setConversionForm((current) => ({
          ...current,
          from_uom_code: materialRow?.base_uom_code ?? current.from_uom_code,
        }));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_MATERIAL_LOOKUP_FAILED");
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
    if (!form || !material?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateMaterial({
        id: material.id,
        material_name: form.material_name,
        description: form.description,
        hsn_code: form.hsn_code,
        base_uom_code: form.base_uom_code,
      });
      const nextMaterial = result?.data ?? material;
      setMaterial(nextMaterial);
      setForm({
        material_name: nextMaterial.material_name ?? "",
        description: nextMaterial.description ?? "",
        hsn_code: nextMaterial.hsn_code ?? "",
        base_uom_code: nextMaterial.base_uom_code ?? "",
      });
      setEditMode(false);
      setNotice("Material updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MATERIAL_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus) {
    if (!material?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await changeMaterialStatus({ id: material.id, new_status: newStatus });
      setMaterial(result?.data ?? material);
      setNotice(`Material moved to ${newStatus}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OM_MATERIAL_STATUS_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddConversion() {
    if (!material?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createMaterialUomConversion({
        material_id: material.id,
        from_uom_code: conversionForm.from_uom_code,
        to_uom_code: conversionForm.to_uom_code,
        conversion_factor: Number(conversionForm.conversion_factor),
      });
      setConversions((current) => [result?.data, ...current].filter(Boolean));
      setConversionForm({
        from_uom_code: material.base_uom_code || "",
        to_uom_code: "",
        conversion_factor: "1",
      });
      setNotice("UOM conversion added.");
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : "OM_UOM_CONVERSION_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompanyExtensionSave() {
    if (!material?.id || !companyExtensionForm.company_id.trim()) {
      setError("OM_COMPANY_NOT_FOUND");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await extendMaterialToCompany({
        material_id: material.id,
        company_id: companyExtensionForm.company_id.trim(),
        procurement_allowed: companyExtensionForm.procurement_allowed,
        hsn_override: companyExtensionForm.hsn_override.trim() || null,
      });
      setNotice("Extension saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MATERIAL_EXTEND_COMPANY_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePlantExtensionSave() {
    if (!material?.id || !plantExtensionForm.company_id.trim() || !plantExtensionForm.plant_id.trim()) {
      setError("OM_PLANT_NOT_FOUND");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await extendMaterialToPlant({
        material_id: material.id,
        company_id: plantExtensionForm.company_id.trim(),
        plant_id: plantExtensionForm.plant_id.trim(),
        safety_stock: plantExtensionForm.safety_stock === "" ? null : Number(plantExtensionForm.safety_stock),
        reorder_point: plantExtensionForm.reorder_point === "" ? null : Number(plantExtensionForm.reorder_point),
        min_order_qty: plantExtensionForm.min_order_qty === "" ? null : Number(plantExtensionForm.min_order_qty),
        lead_time_days: plantExtensionForm.lead_time_days === "" ? null : Number(plantExtensionForm.lead_time_days),
      });
      setNotice("Plant extension saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MATERIAL_EXTEND_PLANT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function loadApprovedVendors() {
    if (!material?.id) {
      return;
    }
    setApprovedVendorsLoading(true);
    setError("");
    try {
      const [vmiResult, vendorResult] = await Promise.all([
        listVendorMaterialInfos({ material_id: material.id, limit: 200, offset: 0 }),
        listVendors({ limit: 200, offset: 0 }),
      ]);
      setApprovedVendors(Array.isArray(vmiResult?.data) ? vmiResult.data : []);
      setVendorDirectory(Array.isArray(vendorResult?.data) ? vendorResult.data : []);
    } catch (loadError) {
      setApprovedVendors([]);
      setVendorDirectory([]);
      setError(loadError instanceof Error ? loadError.message : "OM_VMI_LIST_FAILED");
    } finally {
      setApprovedVendorsLoading(false);
    }
  }

  const vendorMap = useMemo(
    () => new Map(vendorDirectory.map((entry) => [entry.id, entry])),
    [vendorDirectory]
  );

  const allowedTargets = getAllowedStatusTargets(material?.status);

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Material Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((current) => !current), disabled: loading || !material },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving || !editMode },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      {loading || !material || !form ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading material detail..." : "Material detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${material.pace_code || "-"} | ${material.material_name || "-"}`}>
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Status" value={material.status} tone="sky" />
              <ErpFieldPreview label="Type" value={material.material_type} />
              <ErpFieldPreview label="Base UOM" value={material.base_uom_code} />
              <ErpFieldPreview label="Batch Managed" value={material.batch_tracking_required ? "YES" : "NO"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="View Or Edit" title="Material fields">
            {editMode ? (
              <div className="grid gap-3">
                <ErpDenseFormRow label="Material Name" required>
                  <input
                    value={form.material_name}
                    onChange={(event) => setField("material_name", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Base UOM">
                  <select
                    value={form.base_uom_code}
                    onChange={(event) => setField("base_uom_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {uoms.map((entry) => (
                      <option key={entry.id || entry.code} value={entry.code}>
                        {entry.code} | {entry.name}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="HSN Code">
                  <input
                    value={form.hsn_code}
                    onChange={(event) => setField("hsn_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Description">
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(event) => setField("description", event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview label="Material Name" value={material.material_name} />
                <ErpFieldPreview label="HSN Code" value={material.hsn_code} />
                <ErpFieldPreview label="Description" value={material.description} multiline />
                <ErpFieldPreview label="Procurement Type" value={material.procurement_type} />
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

          <ErpSectionCard eyebrow="UOM Conversions" title="Add and review conversion rows">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="From UOM">
                  <select
                    value={conversionForm.from_uom_code}
                    onChange={(event) => setConversionForm((current) => ({ ...current, from_uom_code: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select UOM</option>
                    {uoms.map((entry) => (
                      <option key={`from-${entry.id || entry.code}`} value={entry.code}>
                        {entry.code} | {entry.name}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="To UOM">
                  <select
                    value={conversionForm.to_uom_code}
                    onChange={(event) => setConversionForm((current) => ({ ...current, to_uom_code: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select UOM</option>
                    {uoms.map((entry) => (
                      <option key={`to-${entry.id || entry.code}`} value={entry.code}>
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
                    value={conversionForm.conversion_factor}
                    onChange={(event) => setConversionForm((current) => ({ ...current, conversion_factor: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <button
                  type="button"
                  onClick={() => void handleAddConversion()}
                  disabled={saving}
                  className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                >
                  Add Conversion
                </button>
              </div>

              <ErpDenseGrid
                columns={[
                  { key: "from_uom_code", label: "From" },
                  { key: "to_uom_code", label: "To" },
                  { key: "conversion_factor", label: "Factor" },
                  { key: "variable_conversion", label: "Variable", render: (row) => (row.variable_conversion ? "YES" : "NO") },
                ]}
                rows={conversions}
                rowKey={(row) => row.id}
                emptyMessage="No conversion rows created yet."
                maxHeight="300px"
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Company Extensions" title="Extend to Company">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setShowCompanyExtension((current) => !current)}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showCompanyExtension ? "Hide" : "Show"} Company Extensions
              </button>
              {showCompanyExtension ? (
                <div className="grid gap-3 border border-dashed border-slate-300 bg-slate-50 p-3">
                  <ErpDenseFormRow label="Company ID" required>
                    <input
                      value={companyExtensionForm.company_id}
                      onChange={(event) => setCompanyExtensionForm((current) => ({ ...current, company_id: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Procurement Allowed">
                    <label className="flex h-8 items-center gap-2 text-sm text-slate-900">
                      <input
                        type="checkbox"
                        checked={companyExtensionForm.procurement_allowed}
                        onChange={(event) => setCompanyExtensionForm((current) => ({ ...current, procurement_allowed: event.target.checked }))}
                      />
                      Procurement allowed
                    </label>
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="HSN Override">
                    <input
                      value={companyExtensionForm.hsn_override}
                      onChange={(event) => setCompanyExtensionForm((current) => ({ ...current, hsn_override: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <button
                    type="button"
                    onClick={() => void handleCompanyExtensionSave()}
                    disabled={saving}
                    className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                  >
                    Extend to Company
                  </button>
                </div>
              ) : null}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Plant Extensions" title="Extend to Plant">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setShowPlantExtension((current) => !current)}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showPlantExtension ? "Hide" : "Show"} Plant Extensions
              </button>
              {showPlantExtension ? (
                <div className="grid gap-3 border border-dashed border-slate-300 bg-slate-50 p-3 md:grid-cols-2">
                  <ErpDenseFormRow label="Company ID" required>
                    <input
                      value={plantExtensionForm.company_id}
                      onChange={(event) => setPlantExtensionForm((current) => ({ ...current, company_id: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Plant ID" required>
                    <input
                      value={plantExtensionForm.plant_id}
                      onChange={(event) => setPlantExtensionForm((current) => ({ ...current, plant_id: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Safety Stock">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={plantExtensionForm.safety_stock}
                      onChange={(event) => setPlantExtensionForm((current) => ({ ...current, safety_stock: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Reorder Point">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={plantExtensionForm.reorder_point}
                      onChange={(event) => setPlantExtensionForm((current) => ({ ...current, reorder_point: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Min Order Qty">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={plantExtensionForm.min_order_qty}
                      onChange={(event) => setPlantExtensionForm((current) => ({ ...current, min_order_qty: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Lead Time Days">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={plantExtensionForm.lead_time_days}
                      onChange={(event) => setPlantExtensionForm((current) => ({ ...current, lead_time_days: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <button
                    type="button"
                    onClick={() => void handlePlantExtensionSave()}
                    disabled={saving}
                    className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                  >
                    Extend to Plant
                  </button>
                </div>
              ) : null}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Approved Vendors" title="Approved Vendors (ASL)">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  const next = !showApprovedVendors;
                  setShowApprovedVendors(next);
                  if (next && approvedVendors.length === 0 && !approvedVendorsLoading) {
                    void loadApprovedVendors();
                  }
                }}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showApprovedVendors ? "Hide" : "Show"} Approved Vendors
              </button>
              {showApprovedVendors ? (
                approvedVendorsLoading ? (
                  <div className="text-sm text-slate-500">Loading approved vendors...</div>
                ) : approvedVendors.length === 0 ? (
                  <div className="text-sm text-slate-500">No approved vendors for this material</div>
                ) : (
                  <ErpDenseGrid
                    columns={[
                      {
                        key: "vendor_code",
                        label: "Vendor Code",
                        render: (row) => vendorMap.get(row.vendor_id)?.vendor_code || row.vendor_id,
                      },
                      {
                        key: "vendor_name",
                        label: "Vendor Name",
                        render: (row) => vendorMap.get(row.vendor_id)?.vendor_name || "Unknown vendor",
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
                    rows={approvedVendors}
                    rowKey={(row) => row.id}
                    emptyMessage="No approved vendors for this material"
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
