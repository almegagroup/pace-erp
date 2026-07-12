/*
 * File-ID: 27.FE-PR09
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: FRONT
 * Purpose: Create new Process PO or Packing PO (Standard Create - both PO types).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useCompaniesForOmQuery, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import {
  availabilityPreviewProcessOrder,
  createPackingOrder,
  createProcessOrder,
  getStrokeMaster,
  listSegmentLocations,
  listStrokeMasters,
} from "./prodApi.js";
import { listMachines } from "../om/omApi.js";

const PROCESS_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const MTS_SEGMENTS = ["IWC", "POWDER"];
const TABS = ["Process PO", "Packing PO"];

const EMPTY_PROCESS = {
  company_id: "",
  po_type: "MTO",
  prodshade_material_id: "",
  stroke_master_id: "",
  machine_id: "",
  planned_qty_kg: "",
  planned_start_date: "",
  mts_segment_code: "",
};

const EMPTY_PACKING = {
  company_id: "",
  process_order_id: "",
  pack_code_config_id: "",
  planned_qty_kg: "",
  fo_id: "",
};

function companyLabel(company) {
  return [company.company_code, company.company_name].filter(Boolean).join(" - ");
}

function prodshadeLabel(item) {
  const prodCode = item.material?.pace_code || item.pace_code || null;
  const shadeCode = item.material?.external_code || item.external_code || item.material?.shade_code || item.shade_code || null;
  const materialName = item.material?.material_name || item.material_name || null;
  return [prodCode, shadeCode, materialName]
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
    .join(" - ");
}

function materialLabel(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}

function strokeLabel(stroke) {
  const prodshade = stroke.material?.external_code || stroke.material?.shade_code || "Prodshade";
  return `${prodshade} - stroke #${stroke.stroke_number}${stroke.description ? ` - ${stroke.description}` : ""}`;
}

function machineLabel(machine) {
  return [machine.machine_code, machine.machine_name].filter(Boolean).join(" - ");
}

function storageLocationLabel(location) {
  return [location.code || location.location_code, location.name || location.location_name].filter(Boolean).join(" - ");
}

function deriveSegmentCode(poType, mtsSegmentCode) {
  if (poType === "MTO") return "ADMIX";
  if (poType === "HPS") return "HPS";
  if (poType === "INT") return "INT";
  if (poType === "MTS") return mtsSegmentCode || "";
  return "";
}

function buildOutputReferenceValue(value) {
  return value || "--";
}

export default function ProductionPOCreatePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [processStep, setProcessStep] = useState(1);
  const [processForm, setProcessForm] = useState({ ...EMPTY_PROCESS });
  const [packingForm, setPackingForm] = useState({ ...EMPTY_PACKING });
  const [lineActualMaterialOverrides, setLineActualMaterialOverrides] = useState({});
  const [lineLocationOverrides, setLineLocationOverrides] = useState({});
  const [debouncedCreatePreview, setDebouncedCreatePreview] = useState([]);

  const companiesQ = useCompaniesForOmQuery();
  const companies = companiesQ.data ?? [];
  const effectiveCompanyId = processForm.company_id || (companies.length === 1 ? companies[0].id : "");
  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: company.id, label: companyLabel(company) || "Unnamed company" })),
    [companies],
  );

  useEffect(() => {
    if (companies.length === 1 && !processForm.company_id) {
      setProcessForm((current) => ({ ...current, company_id: companies[0].id }));
    }
  }, [companies, processForm.company_id]);

  const materialsQ = useMaterialOptionsQuery({ status: "ACTIVE", limit: 500 });
  const materialRows = materialsQ.materials ?? [];
  const materialById = useMemo(
    () => new Map(materialRows.map((material) => [material.id, material])),
    [materialRows],
  );

  const approvedStrokesQ = useQuery({
    queryKey: ["production-create-approved-strokes", effectiveCompanyId],
    queryFn: () => listStrokeMasters({
      company_id: effectiveCompanyId || undefined,
      status: "APPROVED",
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  const approvedStrokes = useMemo(
    () => (approvedStrokesQ.data ?? []).map((stroke) => ({
      ...stroke,
      material_id: stroke.prodshade_material_id,
      material: materialById.get(stroke.prodshade_material_id) ?? stroke.material ?? null,
    })),
    [approvedStrokesQ.data, materialById],
  );

  const fgMaterialOptions = useMemo(
    () => materialRows
      .filter((material) => String(material.material_type || "").toUpperCase() === "FG")
      .map((material) => ({
        value: material.id,
        label: materialLabel(material) || "SKU",
      })),
    [materialRows],
  );

  const prodshadeOptions = useMemo(() => {
    const approvedRows = approvedStrokes.filter((stroke) => {
      const strokePoType = String(stroke.po_type || "").toUpperCase();
      const materialType = String(stroke.material?.material_type || "").toUpperCase();

      if (processForm.po_type === "MTEST") {
        return materialType === "SFG" || strokePoType === "INT";
      }

      return strokePoType === String(processForm.po_type || "").toUpperCase();
    });

    const seenApproved = new Set();
    const approvedOptions = [];
    approvedRows.forEach((item) => {
      const materialId = String(item.material_id || "");
      if (!materialId || seenApproved.has(materialId)) return;
      seenApproved.add(materialId);
      approvedOptions.push({ value: materialId, label: prodshadeLabel(item) || "Material" });
    });

    if (processForm.po_type !== "MTEST") return approvedOptions;

    const seen = new Set(approvedOptions.map((option) => option.value));
    const merged = [...approvedOptions];
    for (const option of fgMaterialOptions) {
      if (!seen.has(option.value)) merged.push(option);
    }
    return merged;
  }, [approvedStrokes, fgMaterialOptions, processForm.po_type]);

  const selectedMaterial = materialById.get(processForm.prodshade_material_id) ?? null;
  const selectedMaterialType = String(selectedMaterial?.material_type || "").toUpperCase();
  const derivedSegmentCode = deriveSegmentCode(processForm.po_type, processForm.mts_segment_code);
  const machineRequired = ["MTO", "HPS", "MTS", "INT"].includes(processForm.po_type);
  const mtestSkuPath = processForm.po_type === "MTEST" && selectedMaterialType === "FG";

  const strokesQ = useQuery({
    queryKey: ["production-create-strokes", effectiveCompanyId, processForm.prodshade_material_id],
    queryFn: () => listStrokeMasters({
      company_id: effectiveCompanyId || undefined,
      material_id: processForm.prodshade_material_id || undefined,
      status: "APPROVED",
    }),
    enabled: Boolean(effectiveCompanyId && processForm.prodshade_material_id && !mtestSkuPath),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const strokeOptions = useMemo(
    () => (strokesQ.data ?? [])
      .filter((stroke) => {
        if (processForm.po_type === "MTEST") {
          const strokePoType = String(stroke.po_type || "").toUpperCase();
          return strokePoType === "MTEST" || strokePoType === "INT";
        }
        return String(stroke.po_type || "").toUpperCase() === String(processForm.po_type || "").toUpperCase();
      })
      .map((stroke) => ({ value: stroke.id, label: strokeLabel(stroke) })),
    [processForm.po_type, strokesQ.data],
  );

  const strokeDetailQ = useQuery({
    queryKey: ["production-create-stroke-detail", processForm.stroke_master_id],
    queryFn: () => getStrokeMaster(processForm.stroke_master_id),
    enabled: Boolean(processForm.stroke_master_id),
  });

  const machinesQ = useQuery({
    queryKey: ["production-create-machines", effectiveCompanyId],
    queryFn: () => listMachines({ company_id: effectiveCompanyId, active: true }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const machineOptions = useMemo(
    () => (machinesQ.data ?? []).map((machine) => ({ value: machine.id, label: machineLabel(machine) || "Machine" })),
    [machinesQ.data],
  );

  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: effectiveCompanyId || undefined },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: storageLocationLabel(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );

  const segmentLocationsQ = useQuery({
    queryKey: ["production-create-segment-locations", effectiveCompanyId],
    queryFn: () => listSegmentLocations({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  const activeSegmentLocation = useMemo(
    () => (segmentLocationsQ.data ?? []).find((row) => row.segment_code === derivedSegmentCode && row.active !== false) ?? null,
    [derivedSegmentCode, segmentLocationsQ.data],
  );

  const strokeLines = Array.isArray(strokeDetailQ.data?.lines) ? strokeDetailQ.data.lines : [];
  const strokePreviewRows = useMemo(
    () => strokeLines.map((line) => {
      const selectedStorageLocationId = lineLocationOverrides[line.material_id] || line.default_storage_location_id || "";
      const plannedQty = (Number(line.dosage_pct ?? 0) / 100) * Number(processForm.planned_qty_kg || 0);
      const alternateOptions = [];
      const seenAlternateIds = new Set();

      if (line.alternate_material_id) {
        const alternateId = String(line.alternate_material_id);
        seenAlternateIds.add(alternateId);
        alternateOptions.push({
          value: alternateId,
          label: materialLabel(line.alternate_material) || "Registered alternate",
        });
      }

      for (const member of line.material_group?.members ?? []) {
        const memberId = String(member.material_id ?? "");
        if (!memberId || memberId === String(line.material_id) || seenAlternateIds.has(memberId)) continue;
        seenAlternateIds.add(memberId);
        alternateOptions.push({
          value: memberId,
          label: materialLabel(member.material) || memberId,
        });
      }

      return {
        key: line.id || line.material_id,
        material_id: line.material_id,
        material_type: String(line.line_material_type || line.material?.material_type || "RM").toUpperCase() === "INT" ? "INT" : "RM",
        material_label: materialLabel(line.material) || "--",
        dosage_pct: Number(line.dosage_pct ?? 0),
        actual_material_id: lineActualMaterialOverrides[line.material_id] || "",
        registered_alternate_material_options: alternateOptions,
        material_group_label: line.material_group?.group_name || "",
        default_storage_location_id: line.default_storage_location_id || "",
        storage_location_id: selectedStorageLocationId,
        standard_qty: plannedQty,
      };
    }),
    [lineActualMaterialOverrides, lineLocationOverrides, processForm.planned_qty_kg, strokeLines],
  );

  useEffect(() => {
    setLineActualMaterialOverrides({});
    setLineLocationOverrides({});
  }, [processForm.company_id, processForm.po_type, processForm.prodshade_material_id, processForm.stroke_master_id]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedCreatePreview(
        strokePreviewRows
          .filter((row) => row.storage_location_id || row.actual_material_id)
          .map((row) => ({
            material_id: row.material_id,
            actual_material_id: row.actual_material_id || undefined,
            storage_location_id: row.storage_location_id,
          })),
      );
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [strokePreviewRows]);

  const availabilityPreviewQ = useQuery({
    queryKey: [
      "production-create-availability-preview",
      effectiveCompanyId,
      processForm.stroke_master_id,
      processForm.planned_qty_kg,
      debouncedCreatePreview,
    ],
    queryFn: () => availabilityPreviewProcessOrder({
      company_id: effectiveCompanyId,
      stroke_master_id: processForm.stroke_master_id,
      planned_qty: processForm.planned_qty_kg,
      overrides: debouncedCreatePreview,
    }),
    enabled: Boolean(
      effectiveCompanyId
      && processForm.stroke_master_id
      && Number(processForm.planned_qty_kg || 0) > 0,
    ),
  });

  const availabilityByKey = useMemo(
    () => new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [availabilityPreviewQ.data],
  );

  const previewRowsWithAvailability = useMemo(
    () => strokePreviewRows.map((row, index) => {
      const previewMaterialId = row.actual_material_id || row.material_id;
      const availability = row.storage_location_id
        ? availabilityByKey.get(`${previewMaterialId}::${row.storage_location_id}`) ?? null
        : null;
      const availableQty = availability ? Number(availability.available_qty ?? 0) : null;
      const isShort = availability ? availableQty < row.standard_qty : false;
      return {
        ...row,
        line_no: index + 1,
        available_qty: availableQty,
        is_short: isShort,
      };
    }),
    [availabilityByKey, strokePreviewRows],
  );

  const shortLineNumbers = useMemo(
    () => previewRowsWithAvailability.filter((row) => row.is_short).map((row) => row.line_no),
    [previewRowsWithAvailability],
  );

  const outputStorageLocation = strokeDetailQ.data?.default_storage_location
    || activeSegmentLocation?.shopfloor_sloc
    || null;

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function resetProcess(next = {}) {
    setProcessForm({ ...EMPTY_PROCESS, ...next });
    setProcessStep(1);
    setLineActualMaterialOverrides({});
    setLineLocationOverrides({});
  }

  function updateProcess(field, value) {
    setProcessForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "company_id") {
        next.prodshade_material_id = "";
        next.stroke_master_id = "";
        next.machine_id = "";
        next.planned_qty_kg = "";
        next.planned_start_date = "";
        next.mts_segment_code = "";
      }
      if (field === "po_type") {
        next.prodshade_material_id = "";
        next.stroke_master_id = "";
        next.machine_id = "";
        next.mts_segment_code = "";
      }
      if (field === "prodshade_material_id") {
        next.stroke_master_id = "";
      }
      return next;
    });
    if (field === "company_id" || field === "po_type" || field === "prodshade_material_id") {
      setProcessStep(1);
    }
  }

  function updatePacking(field, value) {
    setPackingForm((current) => ({ ...current, [field]: value }));
  }

  function handleStepOneNext() {
    if (!effectiveCompanyId || !processForm.po_type || !processForm.prodshade_material_id) {
      toast("Company, PO Type, and Material are required.", "error");
      return;
    }
    if (mtestSkuPath) {
      setProcessStep(3);
      return;
    }
    setProcessStep(2);
  }

  function handleStepTwoNext() {
    if (processForm.po_type !== "MTEST" && !processForm.stroke_master_id) {
      toast("Stroke is required for this Process PO type.", "error");
      return;
    }
    setProcessStep(3);
  }

  async function handleCreateProcess(event) {
    event.preventDefault();

    if (processForm.po_type === "MTEST") {
      toast("MTEST create remains blocked here because the locked brief/frontend contract does not define the full create payload for this repo.", "error");
      return;
    }
    if (!effectiveCompanyId || !processForm.prodshade_material_id || !processForm.planned_qty_kg || !derivedSegmentCode) {
      toast("Company, Material, Segment, and Batch Size are required.", "error");
      return;
    }
    if (machineRequired && !processForm.machine_id) {
      toast("Machine is required for this Process PO type.", "error");
      return;
    }
    if (!processForm.stroke_master_id) {
      toast("Stroke is required for this Process PO type.", "error");
      return;
    }
    if (shortLineNumbers.length > 0) {
      toast(`Create is blocked. Short stock on line(s): ${shortLineNumbers.join(", ")}.`, "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        company_id: effectiveCompanyId,
        po_type: processForm.po_type,
        segment_code: derivedSegmentCode,
        prodshade_material_id: processForm.prodshade_material_id,
        machine_id: processForm.machine_id || undefined,
        stroke_master_id: processForm.stroke_master_id,
        planned_qty_kg: Number(processForm.planned_qty_kg),
        planned_start_date: processForm.planned_start_date || undefined,
        line_location_overrides: previewRowsWithAvailability
          .filter((row) => (row.storage_location_id && row.storage_location_id !== row.default_storage_location_id) || row.actual_material_id)
          .map((row) => ({
            material_id: row.material_id,
            actual_material_id: row.actual_material_id || undefined,
            storage_location_id: row.storage_location_id,
          })),
      };
      const result = await createProcessOrder(payload);
      toast(`Process PO created${result?.po_number ? `: ${result.po_number}` : "."}`);
      resetProcess({ company_id: companies.length === 1 ? companies[0].id : "" });
      qc.invalidateQueries({ queryKey: ["process-orders"] });
    } catch (error) {
      toast(error.message || "Process PO create failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePacking(event) {
    event.preventDefault();
    if (!packingForm.company_id || !packingForm.process_order_id || !packingForm.pack_code_config_id || !packingForm.planned_qty_kg) {
      toast("Packing PO fields are still ID-based here and all required values must be filled.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: packingForm.company_id,
        process_order_id: packingForm.process_order_id,
        pack_code_config_id: packingForm.pack_code_config_id,
        planned_qty_kg: Number(packingForm.planned_qty_kg),
        fo_id: packingForm.fo_id || undefined,
      };
      const result = await createPackingOrder(payload);
      toast(`Packing PO created${result?.po_number ? `: ${result.po_number}` : "."}`);
      setPackingForm({ ...EMPTY_PACKING });
      qc.invalidateQueries({ queryKey: ["packing-orders"] });
    } catch (error) {
      toast(error.message || "Packing PO create failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Production PO Create - PR09"
      subtitle="Create Process or Packing production orders"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => setActiveTab(index)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && (
          <form onSubmit={handleCreateProcess} className="flex max-w-6xl flex-col gap-4">
            {processStep === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 1</p>
                  <h3 className="text-lg font-semibold text-slate-900">Company / PO Type / Material</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Company <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={effectiveCompanyId}
                      onChange={(value) => updateProcess("company_id", value)}
                      options={companyOptions}
                      placeholder="-- Select company --"
                      emptyStateLabel={companiesQ.isLoading ? "Loading companies..." : "No companies available"}
                      disabled={companies.length === 1}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">PO Type <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={processForm.po_type}
                      onChange={(value) => updateProcess("po_type", value)}
                      options={PROCESS_TYPES.map((type) => ({ value: type, label: type }))}
                      hideBlank
                    />
                  </div>

                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-600">Material <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={processForm.prodshade_material_id}
                      onChange={(value) => updateProcess("prodshade_material_id", value)}
                      options={prodshadeOptions}
                      placeholder="-- Select material --"
                      emptyStateLabel={approvedStrokesQ.isLoading || materialsQ.isLoading ? "Loading materials..." : "No eligible materials"}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleStepOneNext}
                    className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {processStep === 2 && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 2</p>
                  <h3 className="text-lg font-semibold text-slate-900">Stroke Gate</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-600">
                      Stroke
                      {processForm.po_type === "MTEST" ? <span className="text-slate-400"> (optional)</span> : <span className="text-rose-500"> *</span>}
                    </label>
                    <ErpComboboxField
                      value={processForm.stroke_master_id}
                      onChange={(value) => updateProcess("stroke_master_id", value)}
                      options={strokeOptions}
                      placeholder={processForm.po_type === "MTEST" ? "-- Optional stroke --" : "-- Select stroke --"}
                      emptyStateLabel={strokesQ.isLoading ? "Loading strokes..." : "No approved strokes for this company + material"}
                    />
                  </div>
                </div>

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setProcessStep(1)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleStepTwoNext}
                    className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {processStep === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 3</p>
                    <h3 className="text-lg font-semibold text-slate-900">Header + Material Table</h3>
                  </div>
                  <span className="inline-flex rounded bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">STANDARD</span>
                </div>

                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">PO Number</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">-- (generated on save)</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Company</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{companyOptions.find((option) => option.value === effectiveCompanyId)?.label || "--"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">PO Type</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{processForm.po_type || "--"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Batch Number</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">--</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Stroke</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{strokeOptions.find((option) => option.value === processForm.stroke_master_id)?.label || "--"}</div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Prodshade</label>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      {buildOutputReferenceValue(selectedMaterial?.material_name)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Description</label>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      {buildOutputReferenceValue(selectedMaterial?.document_name)}
                    </div>
                  </div>

                  {processForm.po_type === "MTS" ? (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Segment <span className="text-rose-500">*</span></label>
                      <ErpComboboxField
                        value={processForm.mts_segment_code}
                        onChange={(value) => updateProcess("mts_segment_code", value)}
                        options={MTS_SEGMENTS.map((segment) => ({ value: segment, label: segment }))}
                        placeholder="-- Select segment --"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Segment</label>
                      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                        {derivedSegmentCode || "--"}
                      </div>
                    </div>
                  )}

                  {machineRequired && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Machine <span className="text-rose-500">*</span></label>
                      <ErpComboboxField
                        value={processForm.machine_id}
                        onChange={(value) => updateProcess("machine_id", value)}
                        options={machineOptions}
                        placeholder="-- Select machine --"
                        emptyStateLabel={machinesQ.isLoading ? "Loading machines..." : "No active machines for this company"}
                        disabled={!effectiveCompanyId}
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Batch Size (Planned Qty KG) <span className="text-rose-500">*</span></label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                      value={processForm.planned_qty_kg}
                      onChange={(event) => updateProcess("planned_qty_kg", event.target.value)}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Planned Start Date</label>
                    <input
                      type="date"
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={processForm.planned_start_date}
                      onChange={(event) => updateProcess("planned_start_date", event.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <h4 className="text-sm font-semibold text-slate-800">Output Reference</h4>
                  </div>
                  <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Material Code</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.pace_code)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Name</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.material_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Description</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.document_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">External Code</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.external_code)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Storage Location</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(storageLocationLabel(outputStorageLocation))}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Movement Type</div>
                      <div className="mt-1 text-sm text-slate-900">P101</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <h4 className="text-sm font-semibold text-slate-800">Material Table</h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1180px] border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <th className="border-b px-3 py-2 text-left">#</th>
                          <th className="border-b px-3 py-2 text-left">Material Type</th>
                          <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                          <th className="border-b px-3 py-2 text-right">Dosage %</th>
                          <th className="border-b px-3 py-2 text-left">Actual Material</th>
                          <th className="border-b px-3 py-2 text-left">Storage Location</th>
                          <th className="border-b px-3 py-2 text-right">Standard Qty</th>
                          <th className="border-b px-3 py-2 text-left">Movement Type</th>
                          <th className="border-b px-3 py-2 text-right">Available</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRowsWithAvailability.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">
                              No stroke-derived material lines.
                            </td>
                          </tr>
                        ) : previewRowsWithAvailability.map((row) => {
                          const actualMaterialOptions = [
                            { value: "", label: "(same)" },
                            ...row.registered_alternate_material_options,
                          ];
                          return (
                            <tr key={row.key} className={row.is_short ? "bg-rose-50" : "border-b border-slate-100"}>
                              <td className="border-b border-slate-100 px-3 py-2">{row.line_no}</td>
                              <td className="border-b border-slate-100 px-3 py-2">{row.material_type}</td>
                              <td className="border-b border-slate-100 px-3 py-2">{row.material_label || "--"}</td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.dosage_pct.toFixed(3)}</td>
                              <td className="border-b border-slate-100 px-3 py-2">
                                <ErpComboboxField
                                  value={row.actual_material_id}
                                  onChange={(value) => {
                                    setLineActualMaterialOverrides((current) => ({ ...current, [row.material_id]: value }));
                                  }}
                                  options={actualMaterialOptions}
                                  placeholder="(same)"
                                  disabled={row.registered_alternate_material_options.length === 0}
                                />
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2">
                                <ErpComboboxField
                                  value={row.storage_location_id}
                                  onChange={(value) => {
                                    setLineLocationOverrides((current) => ({ ...current, [row.material_id]: value }));
                                  }}
                                  options={storageLocationOptions}
                                  placeholder="-- Select storage location --"
                                  emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                                />
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.standard_qty.toFixed(3)}</td>
                              <td className="border-b border-slate-100 px-3 py-2">P261</td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                                {row.available_qty == null ? "--" : row.available_qty.toFixed(3)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {shortLineNumbers.length > 0 && (
                  <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    Create is blocked because Available is below Standard Qty on line(s): {shortLineNumbers.join(", ")}.
                  </div>
                )}

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setProcessStep(processForm.po_type === "MTEST" && mtestSkuPath ? 1 : 2)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => resetProcess({ company_id: companies.length === 1 ? companies[0].id : "" })}
                      className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Clear
                    </button>
                    <button
                      type="submit"
                      disabled={saving || shortLineNumbers.length > 0}
                      className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                    >
                      {saving ? "Creating..." : "Create Process PO"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        )}

        {activeTab === 1 && (
          <form onSubmit={handleCreatePacking} className="flex max-w-2xl flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Company ID <span className="text-rose-500">*</span></label>
                <input
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={packingForm.company_id}
                  onChange={(event) => updatePacking("company_id", event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Process Order ID <span className="text-rose-500">*</span></label>
                <input
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={packingForm.process_order_id}
                  onChange={(event) => updatePacking("process_order_id", event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Pack Code Config ID <span className="text-rose-500">*</span></label>
                <input
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={packingForm.pack_code_config_id}
                  onChange={(event) => updatePacking("pack_code_config_id", event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Planned Qty (KG) <span className="text-rose-500">*</span></label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  value={packingForm.planned_qty_kg}
                  onChange={(event) => updatePacking("planned_qty_kg", event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-600">FO ID</label>
                <input
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={packingForm.fo_id}
                  onChange={(event) => updatePacking("fo_id", event.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Packing PO"}
              </button>
              <button
                type="button"
                onClick={() => setPackingForm({ ...EMPTY_PACKING })}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </form>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
