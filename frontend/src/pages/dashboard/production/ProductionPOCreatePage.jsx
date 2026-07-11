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
import { useCompaniesForOmQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import {
  availabilityPreviewProcessOrder,
  createProcessOrder,
  createPackingOrder,
  getStrokeMaster,
  listApprovedProdshades,
  listStrokeMasters,
} from "./prodApi.js";
import { listMachines } from "../om/omApi.js";

const PROCESS_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const PROCESS_SEGMENTS = ["ADMIX", "HPS", "IWC", "POWDER", "INT"];
const TABS = ["Process PO", "Packing PO"];

const EMPTY_PROCESS = {
  company_id: "",
  po_type: "MTO",
  segment_code: "",
  prodshade_material_id: "",
  stroke_master_id: "",
  machine_id: "",
  planned_qty_kg: "",
  planned_start_date: "",
  notes: "",
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
  return [item.external_code, item.shade_code, item.material_name].filter(Boolean).join(" - ");
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

export default function ProductionPOCreatePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [processForm, setProcessForm] = useState({ ...EMPTY_PROCESS });
  const [packingForm, setPackingForm] = useState({ ...EMPTY_PACKING });
  const [lineLocationOverrides, setLineLocationOverrides] = useState({});
  const [debouncedCreatePreview, setDebouncedCreatePreview] = useState([]);

  const companiesQ = useCompaniesForOmQuery();
  const companies = companiesQ.data ?? [];
  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: company.id, label: companyLabel(company) || "Unnamed company" })),
    [companies],
  );

  const prodshadesQ = useQuery({
    queryKey: ["production-create-prodshades"],
    queryFn: () => listApprovedProdshades({}),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const prodshadeOptions = useMemo(
    () => (prodshadesQ.data ?? []).map((item) => ({ value: item.material_id, label: prodshadeLabel(item) || "Prodshade" })),
    [prodshadesQ.data],
  );

  const strokesQ = useQuery({
    queryKey: ["production-create-strokes", processForm.company_id, processForm.prodshade_material_id],
    queryFn: () => listStrokeMasters({
      company_id: processForm.company_id || undefined,
      material_id: processForm.prodshade_material_id || undefined,
      status: "APPROVED",
    }),
    enabled: Boolean(processForm.company_id && processForm.prodshade_material_id && processForm.po_type !== "MTEST"),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const strokeOptions = useMemo(
    () => (strokesQ.data ?? []).map((stroke) => ({ value: stroke.id, label: strokeLabel(stroke) })),
    [strokesQ.data],
  );
  const strokeDetailQ = useQuery({
    queryKey: ["production-create-stroke-detail", processForm.stroke_master_id],
    queryFn: () => getStrokeMaster(processForm.stroke_master_id),
    enabled: Boolean(processForm.stroke_master_id && processForm.po_type !== "MTEST"),
  });

  const machinesQ = useQuery({
    queryKey: ["production-create-machines", processForm.company_id],
    queryFn: () => listMachines({ company_id: processForm.company_id, active: true }),
    enabled: Boolean(processForm.company_id),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const machineOptions = useMemo(
    () => (machinesQ.data ?? []).map((machine) => ({ value: machine.id, label: machineLabel(machine) || "Machine" })),
    [machinesQ.data],
  );
  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: processForm.company_id || undefined },
    { enabled: Boolean(processForm.company_id) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: storageLocationLabel(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );

  const machineRequired = ["MTO", "HPS", "MTS", "INT"].includes(processForm.po_type);
  const strokeLines = Array.isArray(strokeDetailQ.data?.lines) ? strokeDetailQ.data.lines : [];
  const strokePreviewRows = useMemo(
    () => strokeLines.map((line) => {
      const selectedStorageLocationId = lineLocationOverrides[line.material_id]
        || line.default_storage_location_id
        || "";
      const plannedQty = (Number(line.dosage_pct ?? 0) / 100) * Number(processForm.planned_qty_kg || 0);
      return {
        material_id: line.material_id,
        material_label: prodshadeLabel(line.material || {}) || line.material?.material_name || "--",
        dosage_pct: Number(line.dosage_pct ?? 0),
        planned_qty: plannedQty,
        default_storage_location_id: line.default_storage_location_id || "",
        storage_location_id: selectedStorageLocationId,
      };
    }),
    [lineLocationOverrides, processForm.planned_qty_kg, strokeLines],
  );

  useEffect(() => {
    setLineLocationOverrides({});
  }, [processForm.company_id, processForm.po_type, processForm.stroke_master_id]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedCreatePreview(
        strokePreviewRows
          .filter((row) => row.storage_location_id && row.storage_location_id !== row.default_storage_location_id)
          .map((row) => ({
            material_id: row.material_id,
            storage_location_id: row.storage_location_id,
          })),
      );
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [strokePreviewRows]);

  const availabilityPreviewQ = useQuery({
    queryKey: [
      "production-create-availability-preview",
      processForm.company_id,
      processForm.stroke_master_id,
      processForm.planned_qty_kg,
      debouncedCreatePreview,
    ],
    queryFn: () => availabilityPreviewProcessOrder({
      company_id: processForm.company_id,
      stroke_master_id: processForm.stroke_master_id,
      planned_qty: processForm.planned_qty_kg,
      overrides: debouncedCreatePreview,
    }),
    enabled: Boolean(
      processForm.company_id
      && processForm.po_type !== "MTEST"
      && processForm.stroke_master_id
      && Number(processForm.planned_qty_kg || 0) > 0,
    ),
  });
  const availabilityByKey = useMemo(
    () => new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [availabilityPreviewQ.data],
  );

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function updateProcess(field, value) {
    setProcessForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "company_id") {
        next.stroke_master_id = "";
        next.machine_id = "";
      }
      if (field === "prodshade_material_id") {
        next.stroke_master_id = "";
      }
      return next;
    });
  }

  function updatePacking(field, value) {
    setPackingForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreateProcess(event) {
    event.preventDefault();
    if (!processForm.company_id || !processForm.prodshade_material_id || !processForm.planned_qty_kg || !processForm.segment_code) {
      toast("Company, segment, prodshade, and planned qty are required.", "error");
      return;
    }
    if (machineRequired && !processForm.machine_id) {
      toast("Machine is required for this Process PO type.", "error");
      return;
    }
    if (processForm.po_type !== "MTEST" && !processForm.stroke_master_id) {
      toast("Stroke is required for non-MTEST Process POs.", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        company_id: processForm.company_id,
        po_type: processForm.po_type,
        segment_code: processForm.segment_code,
        prodshade_material_id: processForm.prodshade_material_id,
        machine_id: processForm.machine_id || undefined,
        stroke_master_id: processForm.po_type === "MTEST" ? undefined : processForm.stroke_master_id,
        planned_qty_kg: Number(processForm.planned_qty_kg),
        planned_start_date: processForm.planned_start_date || undefined,
        notes: processForm.notes || undefined,
        line_location_overrides: strokePreviewRows
          .filter((row) => row.storage_location_id && row.storage_location_id !== row.default_storage_location_id)
          .map((row) => ({
            material_id: row.material_id,
            storage_location_id: row.storage_location_id,
          })),
      };
      const result = await createProcessOrder(payload);
      toast(`Process PO created${result?.po_number ? `: ${result.po_number}` : "."}`);
      setProcessForm({ ...EMPTY_PROCESS });
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
          <form onSubmit={handleCreateProcess} className="flex max-w-4xl flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Company <span className="text-rose-500">*</span></label>
                <ErpComboboxField
                  value={processForm.company_id}
                  onChange={(value) => updateProcess("company_id", value)}
                  options={companyOptions}
                  placeholder="-- Select company --"
                  emptyStateLabel={companiesQ.isLoading ? "Loading companies..." : "No companies available"}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Production Type <span className="text-rose-500">*</span></label>
                <ErpComboboxField
                  value={processForm.po_type}
                  onChange={(value) => updateProcess("po_type", value)}
                  options={PROCESS_TYPES.map((type) => ({ value: type, label: type }))}
                  hideBlank
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Segment <span className="text-rose-500">*</span></label>
                <ErpComboboxField
                  value={processForm.segment_code}
                  onChange={(value) => updateProcess("segment_code", value)}
                  options={PROCESS_SEGMENTS.map((segment) => ({ value: segment, label: segment }))}
                  placeholder="-- Select segment --"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Prodshade Material <span className="text-rose-500">*</span></label>
                <ErpComboboxField
                  value={processForm.prodshade_material_id}
                  onChange={(value) => updateProcess("prodshade_material_id", value)}
                  options={prodshadeOptions}
                  placeholder="-- Select prodshade --"
                  emptyStateLabel={prodshadesQ.isLoading ? "Loading prodshades..." : "No approved prodshades yet"}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Stroke
                  {processForm.po_type !== "MTEST" ? <span className="text-rose-500"> *</span> : <span className="text-slate-400"> (hidden for MTEST in doc; existing manual-line UI is not present in this repo)</span>}
                </label>
                <ErpComboboxField
                  value={processForm.stroke_master_id}
                  onChange={(value) => updateProcess("stroke_master_id", value)}
                  options={strokeOptions}
                  placeholder={processForm.po_type === "MTEST" ? "-- Not required --" : "-- Select stroke --"}
                  emptyStateLabel={strokesQ.isLoading ? "Loading strokes..." : "No approved strokes for this company + prodshade"}
                  disabled={processForm.po_type === "MTEST"}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Machine
                  {machineRequired ? <span className="text-rose-500"> *</span> : <span className="text-slate-400"> (not required for MTEST)</span>}
                </label>
                <ErpComboboxField
                  value={processForm.machine_id}
                  onChange={(value) => updateProcess("machine_id", value)}
                  options={machineOptions}
                  placeholder={machineRequired ? "-- Select machine --" : "-- Optional --"}
                  emptyStateLabel={machinesQ.isLoading ? "Loading machines..." : "No active machines for this company"}
                  disabled={!processForm.company_id || !machineRequired}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Planned Qty (KG) <span className="text-rose-500">*</span></label>
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

              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-600">Notes</label>
                <textarea
                  rows={3}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm resize-none"
                  value={processForm.notes}
                  onChange={(event) => updateProcess("notes", event.target.value)}
                />
              </div>
            </div>

            {processForm.po_type !== "MTEST" && processForm.company_id && processForm.prodshade_material_id && processForm.stroke_master_id && Number(processForm.planned_qty_kg || 0) > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-800">RM Location Preview</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                        <th className="border-b px-3 py-2 text-right">Dosage%</th>
                        <th className="border-b px-3 py-2 text-right">Planned Qty</th>
                        <th className="border-b px-3 py-2 text-left">Storage Location</th>
                        <th className="border-b px-3 py-2 text-right">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strokePreviewRows.map((row) => {
                        const availability = row.storage_location_id
                          ? availabilityByKey.get(`${row.material_id}::${row.storage_location_id}`) ?? null
                          : null;
                        const isShort = Boolean(availability?.short);
                        return (
                          <tr key={row.material_id} className={isShort ? "bg-rose-50" : "border-b border-slate-100"}>
                            <td className="border-b border-slate-100 px-3 py-2">{row.material_label || "--"}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.dosage_pct.toFixed(3)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.planned_qty.toFixed(3)}</td>
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
                            <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                              {availability ? availability.available_qty.toFixed(3) : "--"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Process PO"}
              </button>
              <button
                type="button"
                onClick={() => setProcessForm({ ...EMPTY_PROCESS })}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
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
