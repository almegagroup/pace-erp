/*
 * File-ID: 15.4
 * File-Path: frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render material detail, edit, status, UOM conversion, company/plant extension workflows.
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
  listMaterialCompanyExtensions,
  listMaterialPlantExtensions,
  listMaterialUomConversions,
  listVendorMaterialInfos,
  listVendors,
  listUoms,
  updateMaterial,
  listCompaniesForOm,
  listProjectsByCompany,
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
  const [companies, setCompanies] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [companyExtensions, setCompanyExtensions] = useState([]);
  const [plantExtensions, setPlantExtensions] = useState([]);

  const [conversionForm, setConversionForm] = useState({ from_uom_code: "", to_uom_code: "", conversion_factor: "1" });
  const [companyExtForm, setCompanyExtForm] = useState({ company_id: "", procurement_allowed: true, hsn_override: "" });
  const [plantExtCompanyId, setPlantExtCompanyId] = useState("");
  const [plantOptions, setPlantOptions] = useState([]);
  const [plantExtForm, setPlantExtForm] = useState({
    company_id: "", plant_id: "", safety_stock: "", reorder_point: "", min_order_qty: "", lead_time_days: "",
  });

  const [approvedVendors, setApprovedVendors] = useState([]);
  const [vendorDirectory, setVendorDirectory] = useState([]);
  const [approvedVendorsLoading, setApprovedVendorsLoading] = useState(false);
  const [showApprovedVendors, setShowApprovedVendors] = useState(false);

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
      if (!id) { setError("OM_MATERIAL_NOT_FOUND"); setLoading(false); return; }
      setLoading(true);
      setError("");
      try {
        const [materialResult, uomResult, conversionResult, companyList, companyExtResult, plantExtResult] = await Promise.all([
          getMaterial(id),
          listUoms({ is_active: true }),
          listMaterialUomConversions(id),
          listCompaniesForOm(),
          listMaterialCompanyExtensions(id),
          listMaterialPlantExtensions(id),
        ]);
        if (!active) return;
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
        setCompanies(Array.isArray(companyList) ? companyList : []);
        setCompanyExtensions(Array.isArray(companyExtResult?.data) ? companyExtResult.data : []);
        setPlantExtensions(Array.isArray(plantExtResult?.data) ? plantExtResult.data : []);
        setConversionForm((prev) => ({ ...prev, from_uom_code: materialRow?.base_uom_code ?? prev.from_uom_code }));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "OM_MATERIAL_LOOKUP_FAILED");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!plantExtCompanyId) { setPlantOptions([]); return; }
    let active = true;
    listProjectsByCompany(plantExtCompanyId)
      .then((projects) => { if (active) setPlantOptions(Array.isArray(projects) ? projects : []); })
      .catch(() => { if (active) setPlantOptions([]); });
    return () => { active = false; };
  }, [plantExtCompanyId]);

  function setField(key, value) { setForm((prev) => ({ ...prev, [key]: value })); }

  async function handleSave() {
    if (!form || !material?.id) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await updateMaterial({ id: material.id, material_name: form.material_name, description: form.description, hsn_code: form.hsn_code, base_uom_code: form.base_uom_code });
      const next = result?.data ?? material;
      setMaterial(next);
      setForm({ material_name: next.material_name ?? "", description: next.description ?? "", hsn_code: next.hsn_code ?? "", base_uom_code: next.base_uom_code ?? "" });
      setEditMode(false); setNotice("Material updated.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_MATERIAL_UPDATE_FAILED"); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(newStatus) {
    if (!material?.id) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await changeMaterialStatus({ id: material.id, new_status: newStatus });
      setMaterial(result?.data ?? material);
      setNotice(`Material moved to ${newStatus}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "OM_MATERIAL_STATUS_UPDATE_FAILED"); }
    finally { setSaving(false); }
  }

  async function handleAddConversion() {
    if (!material?.id) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await createMaterialUomConversion({ material_id: material.id, from_uom_code: conversionForm.from_uom_code, to_uom_code: conversionForm.to_uom_code, conversion_factor: Number(conversionForm.conversion_factor) });
      setConversions((prev) => [result?.data, ...prev].filter(Boolean));
      setConversionForm({ from_uom_code: material.base_uom_code || "", to_uom_code: "", conversion_factor: "1" });
      setNotice("UOM conversion added.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_UOM_CONVERSION_CREATE_FAILED"); }
    finally { setSaving(false); }
  }

  async function handleCompanyExtSave() {
    if (!material?.id || !companyExtForm.company_id) { setError("OM_COMPANY_NOT_FOUND"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await extendMaterialToCompany({ material_id: material.id, company_id: companyExtForm.company_id, procurement_allowed: companyExtForm.procurement_allowed, hsn_override: companyExtForm.hsn_override.trim() || null });
      const updated = await listMaterialCompanyExtensions(id);
      setCompanyExtensions(Array.isArray(updated?.data) ? updated.data : []);
      setCompanyExtForm({ company_id: "", procurement_allowed: true, hsn_override: "" });
      setNotice("Company extension saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_MATERIAL_EXTEND_COMPANY_FAILED"); }
    finally { setSaving(false); }
  }

  async function handlePlantExtSave() {
    if (!material?.id || !plantExtForm.company_id || !plantExtForm.plant_id) { setError("OM_PLANT_NOT_FOUND"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await extendMaterialToPlant({
        material_id: material.id,
        company_id: plantExtForm.company_id,
        plant_id: plantExtForm.plant_id,
        safety_stock: plantExtForm.safety_stock === "" ? null : Number(plantExtForm.safety_stock),
        reorder_point: plantExtForm.reorder_point === "" ? null : Number(plantExtForm.reorder_point),
        min_order_qty: plantExtForm.min_order_qty === "" ? null : Number(plantExtForm.min_order_qty),
        lead_time_days: plantExtForm.lead_time_days === "" ? null : Number(plantExtForm.lead_time_days),
      });
      const updated = await listMaterialPlantExtensions(id);
      setPlantExtensions(Array.isArray(updated?.data) ? updated.data : []);
      setPlantExtForm({ company_id: "", plant_id: "", safety_stock: "", reorder_point: "", min_order_qty: "", lead_time_days: "" });
      setPlantExtCompanyId("");
      setNotice("Plant extension saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "OM_MATERIAL_EXTEND_PLANT_FAILED"); }
    finally { setSaving(false); }
  }

  async function loadApprovedVendors() {
    if (!material?.id) return;
    setApprovedVendorsLoading(true); setError("");
    try {
      const [vmiResult, vendorResult] = await Promise.all([
        listVendorMaterialInfos({ material_id: material.id, limit: 200, offset: 0 }),
        listVendors({ limit: 200, offset: 0 }),
      ]);
      setApprovedVendors(Array.isArray(vmiResult?.data) ? vmiResult.data : []);
      setVendorDirectory(Array.isArray(vendorResult?.data) ? vendorResult.data : []);
    } catch (err) {
      setApprovedVendors([]); setVendorDirectory([]);
      setError(err instanceof Error ? err.message : "OM_VMI_LIST_FAILED");
    } finally { setApprovedVendorsLoading(false); }
  }

  const vendorMap = useMemo(() => new Map(vendorDirectory.map((v) => [v.id, v])), [vendorDirectory]);
  const allowedTargets = getAllowedStatusTargets(material?.status);
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: `${c.company_code} | ${c.company_name}` })),
    [companies]
  );
  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const INPUT_CLS = "h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500";
  const SELECT_CLS = "h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500";

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Material Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((v) => !v), disabled: loading || !material },
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
          {/* ── Header ── */}
          <ErpSectionCard eyebrow="Header" title={`${material.pace_code || "-"} | ${material.material_name || "-"}`}>
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Status" value={material.status} tone="sky" />
              <ErpFieldPreview label="Type" value={material.material_type} />
              <ErpFieldPreview label="Base UOM" value={material.base_uom_code} />
              <ErpFieldPreview label="Batch Managed" value={material.batch_tracking_required ? "YES" : "NO"} />
            </div>
          </ErpSectionCard>

          {/* ── Edit fields ── */}
          <ErpSectionCard eyebrow="View Or Edit" title="Material fields">
            {editMode ? (
              <div className="grid gap-3">
                <ErpDenseFormRow label="Material Name" required>
                  <input value={form.material_name} onChange={(e) => setField("material_name", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Base UOM">
                  <select value={form.base_uom_code} onChange={(e) => setField("base_uom_code", e.target.value)} className={SELECT_CLS}>
                    {uoms.map((u) => <option key={u.id || u.code} value={u.code}>{u.code} | {u.name}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="HSN Code">
                  <input value={form.hsn_code} onChange={(e) => setField("hsn_code", e.target.value)} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Description">
                  <textarea rows={4} value={form.description} onChange={(e) => setField("description", e.target.value)} className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
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

          {/* ── Lifecycle ── */}
          <ErpSectionCard eyebrow="Lifecycle" title="Status actions">
            <div className="flex flex-wrap gap-2">
              {allowedTargets.length === 0 ? (
                <div className="text-sm text-slate-500">No status change is allowed from the current state.</div>
              ) : allowedTargets.map((t) => (
                <button key={t} type="button" onClick={() => void handleStatusChange(t)} disabled={saving}
                  className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900">
                  Move To {t}
                </button>
              ))}
            </div>
          </ErpSectionCard>

          {/* ── UOM Conversions ── */}
          <ErpSectionCard eyebrow="UOM Conversions" title="Add and review conversion rows">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="From UOM">
                  <select value={conversionForm.from_uom_code} onChange={(e) => setConversionForm((p) => ({ ...p, from_uom_code: e.target.value }))} className={SELECT_CLS}>
                    <option value="">Select UOM</option>
                    {uoms.map((u) => <option key={`from-${u.id || u.code}`} value={u.code}>{u.code} | {u.name}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="To UOM">
                  <select value={conversionForm.to_uom_code} onChange={(e) => setConversionForm((p) => ({ ...p, to_uom_code: e.target.value }))} className={SELECT_CLS}>
                    <option value="">Select UOM</option>
                    {uoms.map((u) => <option key={`to-${u.id || u.code}`} value={u.code}>{u.code} | {u.name}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Conversion Factor">
                  <input type="number" min="0.0001" step="0.0001" value={conversionForm.conversion_factor} onChange={(e) => setConversionForm((p) => ({ ...p, conversion_factor: e.target.value }))} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <button type="button" onClick={() => void handleAddConversion()} disabled={saving}
                  className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900">
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

          {/* ── Company Extensions ── */}
          <ErpSectionCard eyebrow="Company Extensions" title="Extend material to companies">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Company" required>
                  <select value={companyExtForm.company_id} onChange={(e) => setCompanyExtForm((p) => ({ ...p, company_id: e.target.value }))} className={SELECT_CLS}>
                    <option value="">Select company</option>
                    {companyOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Procurement Allowed">
                  <label className="flex h-8 items-center gap-2 text-sm text-slate-900">
                    <input type="checkbox" checked={companyExtForm.procurement_allowed} onChange={(e) => setCompanyExtForm((p) => ({ ...p, procurement_allowed: e.target.checked }))} />
                    Procurement allowed
                  </label>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="HSN Override">
                  <input value={companyExtForm.hsn_override} onChange={(e) => setCompanyExtForm((p) => ({ ...p, hsn_override: e.target.value }))} className={INPUT_CLS} />
                </ErpDenseFormRow>
                <button type="button" onClick={() => void handleCompanyExtSave()} disabled={saving}
                  className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900">
                  {saving ? "Saving..." : "Extend to Company"}
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "company", label: "Company", render: (row) => row.companies ? `${row.companies.company_code} | ${row.companies.company_name}` : companyMap.get(row.company_id)?.company_name ?? row.company_id },
                  { key: "procurement_allowed", label: "Procurement", render: (row) => (row.procurement_allowed ? "YES" : "NO") },
                  { key: "hsn_code_override", label: "HSN Override" },
                  { key: "status", label: "Status" },
                ]}
                rows={companyExtensions}
                rowKey={(row) => row.id ?? row.company_id}
                emptyMessage="Not extended to any company yet."
                maxHeight="280px"
              />
            </div>
          </ErpSectionCard>

          {/* ── Plant Extensions ── */}
          <ErpSectionCard eyebrow="Plant Extensions" title="Extend material to plants">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Company" required>
                  <select
                    value={plantExtCompanyId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      setPlantExtCompanyId(cid);
                      setPlantExtForm((p) => ({ ...p, company_id: cid, plant_id: "" }));
                    }}
                    className={SELECT_CLS}
                  >
                    <option value="">Select company</option>
                    {companyOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Plant" required>
                  <select value={plantExtForm.plant_id} onChange={(e) => setPlantExtForm((p) => ({ ...p, plant_id: e.target.value }))} className={SELECT_CLS} disabled={!plantExtCompanyId}>
                    <option value="">{plantExtCompanyId ? "Select plant" : "Select company first"}</option>
                    {plantOptions.map((pl) => <option key={pl.id} value={pl.id}>{pl.project_code} | {pl.project_name}</option>)}
                  </select>
                </ErpDenseFormRow>
                <div className="grid gap-3 md:grid-cols-2">
                  <ErpDenseFormRow label="Safety Stock">
                    <input type="number" min="0" step="any" value={plantExtForm.safety_stock} onChange={(e) => setPlantExtForm((p) => ({ ...p, safety_stock: e.target.value }))} className={INPUT_CLS} />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Reorder Point">
                    <input type="number" min="0" step="any" value={plantExtForm.reorder_point} onChange={(e) => setPlantExtForm((p) => ({ ...p, reorder_point: e.target.value }))} className={INPUT_CLS} />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Min Order Qty">
                    <input type="number" min="0" step="any" value={plantExtForm.min_order_qty} onChange={(e) => setPlantExtForm((p) => ({ ...p, min_order_qty: e.target.value }))} className={INPUT_CLS} />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Lead Time Days">
                    <input type="number" min="0" step="1" value={plantExtForm.lead_time_days} onChange={(e) => setPlantExtForm((p) => ({ ...p, lead_time_days: e.target.value }))} className={INPUT_CLS} />
                  </ErpDenseFormRow>
                </div>
                <button type="button" onClick={() => void handlePlantExtSave()} disabled={saving}
                  className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900">
                  {saving ? "Saving..." : "Extend to Plant"}
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "company", label: "Company", render: (row) => row.companies ? `${row.companies.company_code}` : companyMap.get(row.company_id)?.company_code ?? row.company_id },
                  { key: "plant", label: "Plant", render: (row) => row.projects ? `${row.projects.project_code} | ${row.projects.project_name}` : row.plant_id },
                  { key: "lead_time_days", label: "Lead Time" },
                  { key: "safety_stock_qty", label: "Safety Stock" },
                  { key: "status", label: "Status" },
                ]}
                rows={plantExtensions}
                rowKey={(row) => row.id ?? `${row.company_id}-${row.plant_id}`}
                emptyMessage="Not extended to any plant yet."
                maxHeight="280px"
              />
            </div>
          </ErpSectionCard>

          {/* ── Approved Vendors ── */}
          <ErpSectionCard eyebrow="Approved Vendors" title="Approved Vendors (ASL)">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  const next = !showApprovedVendors;
                  setShowApprovedVendors(next);
                  if (next && approvedVendors.length === 0 && !approvedVendorsLoading) void loadApprovedVendors();
                }}
                className="justify-self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
              >
                {showApprovedVendors ? "Hide" : "Show"} Approved Vendors
              </button>
              {showApprovedVendors ? (
                approvedVendorsLoading ? (
                  <div className="text-sm text-slate-500">Loading approved vendors...</div>
                ) : (
                  <ErpDenseGrid
                    columns={[
                      { key: "vendor_code", label: "Vendor Code", render: (row) => vendorMap.get(row.vendor_id)?.vendor_code || row.vendor_id },
                      { key: "vendor_name", label: "Vendor Name", render: (row) => vendorMap.get(row.vendor_id)?.vendor_name || "Unknown vendor" },
                      { key: "po_uom_code", label: "PO UOM" },
                      { key: "conversion_factor", label: "Factor" },
                      { key: "lead_time_days", label: "Lead Time" },
                      { key: "status", label: "Status", render: (row) => <span className="inline-flex rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">{row.status || "-"}</span> },
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
