/*
 * File-ID: 27.FE-PR10
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOEditPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Edit STANDARD MTO/HPS Process POs before QA approval for PR10.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import {
  availabilityPreviewProcessOrder,
  editProcessOrder,
  getPackingOrder,
  getProcessOrder,
  listPackingOrders,
  listProcessOrders,
  editPackingOrder,
  cancelPackingOrder,
} from "./prodApi.js";
import { listMachines } from "../om/omApi.js";

const EDIT_TABS = ["Process PO", "Packing PO"];

function prodshadeLabel(item) {
  const prodCode = item?.pace_code || item?.material?.pace_code || null;
  const shadeCode = item?.external_code || item?.shade_code || item?.material?.external_code || item?.material?.shade_code || null;
  const materialName = item?.material_name || item?.material?.material_name || null;
  return [prodCode, shadeCode, materialName]
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
    .join(" - ");
}

function materialLabel(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}

function buildActualMaterialOptions(line) {
  const options = [{ value: "", label: "(same)" }];
  const seen = new Set([""]);
  for (const material of line.allowed_alternate_materials ?? []) {
    if (!material?.id || seen.has(material.id)) continue;
    seen.add(material.id);
    options.push({
      value: material.id,
      label: materialLabel(material) || "Registered alternate",
    });
  }
  if (line.registered_alternate_material_id && !seen.has(line.registered_alternate_material_id)) {
    seen.add(line.registered_alternate_material_id);
    options.push({
      value: line.registered_alternate_material_id,
      label: materialLabel(line.registered_alternate_material) || "Registered alternate",
    });
  }
  if (line.actual_material_id && !seen.has(line.actual_material_id)) {
    options.push({
      value: line.actual_material_id,
      label: materialLabel(line.actual_material) || "Selected alternate",
    });
  }
  return options;
}

function machineLabel(machine) {
  return [machine.machine_code, machine.machine_name].filter(Boolean).join(" - ");
}

function storageLocationLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function validateEditablePo(po) {
  if (!po) return "";
  const poType = String(po.po_type || "").toUpperCase();
  if (!["MTO", "HPS"].includes(poType)) {
    return "PR10 edit is available only for MTO or HPS Process POs.";
  }
  if (String(po.status || "").toUpperCase() !== "STANDARD") {
    return "PR10 edit is available only at STANDARD status.";
  }
  return "";
}

function computeStandardQty(dosagePct, batchQty, fallbackQty) {
  const dosageValue = Number(dosagePct ?? 0);
  const batchQtyValue = Number(batchQty || 0);
  if (dosageValue > 0 && batchQtyValue > 0) {
    return (dosageValue / 100) * batchQtyValue;
  }
  return Number(fallbackQty ?? 0);
}

function makeDraftRow(line) {
  return {
    key: line.id,
    id: line.id,
    material_id: line.material_id,
    material_type: String(line.material?.material_type || "RM").toUpperCase() === "INT" ? "INT" : "RM",
    material_label: materialLabel(line.material) || "--",
    dosage_pct: Number(line.dosage_pct ?? 0),
    original_planned_qty: Number(line.planned_qty ?? 0),
    registered_alternate_material_id: line.registered_alternate_material_id || "",
    registered_alternate_material_label: materialLabel(line.registered_alternate_material) || "Registered alternate",
    allowed_alternate_material_options: buildActualMaterialOptions(line),
    actual_material_id: line.actual_material_id || "",
    issue_sloc_id: line.issue_sloc_id || line.issue_storage_location?.id || "",
  };
}

function materialLabelSimple(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}

function slocLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function packingBlockMessage(po) {
  if (!po) return "";
  if (String(po.status || "").toUpperCase() !== "STANDARD") {
    return "Packing PO PM lines are editable only at STANDARD status.";
  }
  return "";
}

function PackingPoEditTab() {
  const qc = useQueryClient();
  const [poNumberInput, setPoNumberInput] = useState("");
  const [submittedPoNumber, setSubmittedPoNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [pmOverrides, setPmOverrides] = useState({});
  const [pmMatOverrides, setPmMatOverrides] = useState({});
  const [numPacks, setNumPacks] = useState("");
  const [fillQty, setFillQty] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  const detailQ = useQuery({
    queryKey: ["packing-edit-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const result = await listPackingOrders({ po_number: submittedPoNumber, per_page: 10 });
      const options = Array.isArray(result) ? result : result?.data ?? [];
      const match = options.find((order) => String(order.po_number || "").toUpperCase() === submittedPoNumber.toUpperCase()) ?? null;
      if (!match?.id) return null;
      return await getPackingOrder(match.id);
    },
  });

  const po = detailQ.data ?? null;
  const blockMessage = useMemo(() => packingBlockMessage(po), [po]);
  const pmLinesRaw = (po?.lines ?? []).filter((line) => line.line_type === "PM");

  // Live preview: PM total = qty_per_pack (fixed ratio, unaffected by this
  // edit) × the Num Packs value currently in the input — mirrors the backend
  // formula in editPackingOrderHandler exactly, so the table reflects the save
  // result before the user even clicks Save, instead of only after refetch.
  const previewNumPacks = Number(numPacks) || 0;
  const pmLines = useMemo(
    () => pmLinesRaw.map((line) => ({
      ...line,
      preview_total_qty: Number(line.qty_per_pack ?? 0) * previewNumPacks,
    })),
    [pmLinesRaw, previewNumPacks],
  );

  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: po?.company_id || undefined },
    { enabled: Boolean(po?.company_id && !blockMessage) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: slocLabel(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );

  useEffect(() => {
    setPmOverrides({});
    setPmMatOverrides({});
    setNumPacks(po?.num_packs != null ? String(po.num_packs) : "");
    setFillQty(po?.fill_qty_per_pack != null ? String(po.fill_qty_per_pack) : "");
    setCancelReason("");
    setShowCancel(false);
  }, [po?.id, po?.num_packs, po?.fill_qty_per_pack]);

  // fill is a user lever only for bomRequired=false pack codes (§83.4.1); for
  // fixed Pack BOM the SFG per-pack is BOM-driven. bom_required comes from the
  // embedded pack_code. Default to hiding fill (safer) if the flag is absent.
  const fillEditable = po?.pack_code?.bom_required === false;

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  function resetLookup() {
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setPmOverrides({});
    setPmMatOverrides({});
  }

  function handleLookupSubmit(event) {
    event.preventDefault();
    const normalized = String(poNumberInput || "").trim();
    if (!normalized) {
      toast("PO Number is required.", "error");
      return;
    }
    setSubmittedPoNumber(normalized);
  }

  const lookupMessage = useMemo(() => {
    if (detailQ.error) return detailQ.error.message || "Packing PO lookup failed.";
    if (!submittedPoNumber || detailQ.isFetching) return "";
    if (!po) return "Packing PO not found.";
    return blockMessage;
  }, [blockMessage, detailQ.error, detailQ.isFetching, po, submittedPoNumber]);

  async function handleSave() {
    if (!po || blockMessage) return;
    if (pmLines.some((line) => !(pmOverrides[line.id] ?? line.issue_sloc_id))) {
      toast("Select a storage location for every PM line.", "error");
      return;
    }
    const packs = parseInt(numPacks, 10);
    if (!Number.isFinite(packs) || packs <= 0) {
      toast("Num Packs must be a positive whole number.", "error");
      return;
    }
    if (fillEditable) {
      const fill = Number(fillQty);
      if (!Number.isFinite(fill) || fill <= 0) {
        toast("Fill Qty per pack must be a positive number.", "error");
        return;
      }
    }
    setSaving(true);
    try {
      // Single call: the edit handler recomputes every line + keeps the SFG/PM
      // reservations in sync, then re-checks PM availability. num_packs / fill
      // and PM sloc all go together (§83.4.1).
      const body = {
        num_packs: packs,
        pm_lines: pmLines.map((line) => {
          const pl = {
            id: line.id,
            issue_sloc_id: pmOverrides[line.id] ?? line.issue_sloc_id,
          };
          // Only send actual_material_id when the user touched this line's picker —
          // "" means "(same as formulation)" and clears any prior substitute.
          if (Object.prototype.hasOwnProperty.call(pmMatOverrides, line.id)) {
            pl.actual_material_id = pmMatOverrides[line.id] || null;
          }
          return pl;
        }),
      };
      if (fillEditable) body.fill_qty_per_pack = Number(fillQty);
      await editPackingOrder(po.id, body);
      toast("Packing PO updated. Quantities and reservations recalculated.");
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
      qc.invalidateQueries({ queryKey: ["packing-edit-lookup", submittedPoNumber] });
      detailQ.refetch();
    } catch (error) {
      toast(error.message || "Update failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!po || blockMessage) return;
    if (!cancelReason.trim()) {
      toast("A reason is required to cancel this Packing PO.", "error");
      return;
    }
    setSaving(true);
    try {
      await cancelPackingOrder(po.id, { reason: cancelReason.trim() });
      toast("Packing PO cancelled. Reservations released.");
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
      setShowCancel(false);
      resetLookup();
    } catch (error) {
      toast(error.message || "Cancel failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const showEditPage = Boolean(po && !blockMessage);

  return (
    <div className="flex flex-col gap-4">

      {!showEditPage ? (
        <ErpSectionCard title="Page 1 - Identify Packing PO">
          <form onSubmit={handleLookupSubmit} className="flex max-w-xl flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">PO Number <span className="text-rose-500">*</span></label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={poNumberInput}
                onChange={(event) => setPoNumberInput(event.target.value)}
                placeholder="Enter Packing PO number"
                autoComplete="off"
              />
            </div>

            {lookupMessage ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {lookupMessage}
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={detailQ.isFetching}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {detailQ.isFetching ? "Loading..." : "Next"}
              </button>
            </div>
          </form>
        </ErpSectionCard>
      ) : (
        <ErpSectionCard title="Page 2 - Edit Packing PO">
          <div className="flex flex-col gap-4">
            <div className="flex justify-between gap-4">
              <div className="grid flex-1 gap-3 md:grid-cols-4 text-sm">
                <div>
                  <span className="block text-xs text-slate-400">PO Number</span>
                  <p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">Type</span>
                  <p>{po.source_po_type || "--"} / {po.po_type || "--"}</p>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">FG SKU</span>
                  <p>{materialLabelSimple(po.material) || "--"}</p>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">Num Packs</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={numPacks}
                    onChange={(event) => setNumPacks(event.target.value)}
                    className="h-8 w-28 border border-slate-300 bg-[#fffef7] px-2 font-mono text-sm outline-none focus:border-sky-500"
                  />
                </div>
                {fillEditable ? (
                  <div>
                    <span className="block text-xs text-slate-400">Fill Qty / Pack (KG)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={fillQty}
                      onChange={(event) => setFillQty(event.target.value)}
                      className="h-8 w-32 border border-slate-300 bg-[#fffef7] px-2 font-mono text-sm outline-none focus:border-sky-500"
                    />
                  </div>
                ) : (
                  <div>
                    <span className="block text-xs text-slate-400">Fill Qty / Pack</span>
                    <p className="font-mono">{po.fill_qty_per_pack ?? "--"} <span className="text-xs text-slate-400">(BOM-driven)</span></p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={resetLookup}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Back
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h4 className="text-sm font-semibold text-slate-800">PM Lines - Storage Location</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="border-b px-3 py-2 text-left">Material</th>
                      <th className="border-b px-3 py-2 text-left">Actual Material</th>
                      <th className="border-b px-3 py-2 text-right">Total Qty</th>
                      <th className="border-b px-3 py-2 text-left">Storage Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pmLines.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">
                          No PM lines on this Packing PO.
                        </td>
                      </tr>
                    ) : pmLines.map((line) => {
                      // "(same)" = use the formulation material; otherwise a registered
                      // group alternate. Only shown when the line has alternates (§83.4.1).
                      const altOptions = [
                        { value: "", label: "(same as formulation)" },
                        ...(line.allowed_alternate_materials ?? []).map((mat) => ({
                          value: mat.id,
                          label: materialLabelSimple(mat) || "Registered alternate",
                        })),
                      ];
                      const hasAlternates = (line.allowed_alternate_materials ?? []).length > 0;
                      return (
                      <tr key={line.id} className="border-b border-slate-100">
                        <td className="px-3 py-2">{materialLabelSimple(line.material) || "--"}</td>
                        <td className="px-3 py-2 min-w-[220px]">
                          {hasAlternates ? (
                            <ErpComboboxField
                              value={pmMatOverrides[line.id] ?? line.actual_material_id ?? ""}
                              onChange={(value) => setPmMatOverrides((current) => ({ ...current, [line.id]: value }))}
                              options={altOptions}
                              placeholder="(same as formulation)"
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{line.preview_total_qty.toFixed(3)}</td>
                        <td className="px-3 py-2 min-w-[220px]">
                          <ErpComboboxField
                            value={pmOverrides[line.id] ?? line.issue_sloc_id ?? ""}
                            onChange={(value) => setPmOverrides((current) => ({ ...current, [line.id]: value }))}
                            options={storageLocationOptions}
                            placeholder="-- Select storage location --"
                            emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                          />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowCancel((current) => !current)}
                disabled={saving}
                className="rounded border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
              >
                Cancel Packing PO
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save PR10 Edit"}
              </button>
            </div>

            {showCancel ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-rose-800">Cancel this Packing PO</h4>
                <p className="mb-3 text-xs text-rose-700">
                  This releases the SFG and PM reservations and marks the PO CANCELLED. It cannot be undone.
                </p>
                <label className="mb-1 block text-xs font-medium text-rose-700">Reason (required)</label>
                <textarea
                  rows={2}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Why is this Packing PO being cancelled?"
                  className="mb-3 w-full border border-rose-300 bg-white px-2 py-1 text-sm outline-none focus:border-rose-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowCancel(false); setCancelReason(""); }}
                    disabled={saving}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Keep PO
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={saving || !cancelReason.trim()}
                    className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    {saving ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </ErpSectionCard>
      )}
    </div>
  );
}

function ProcessPoEditTab() {
  const qc = useQueryClient();
  const [poNumberInput, setPoNumberInput] = useState("");
  const [submittedPoNumber, setSubmittedPoNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [batchQty, setBatchQty] = useState("");
  const [rows, setRows] = useState([]);
  const [debouncedPreviewRows, setDebouncedPreviewRows] = useState([]);

  const detailQ = useQuery({
    queryKey: ["production-edit-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const result = await listProcessOrders({ po_number: submittedPoNumber, per_page: 10 });
      const options = Array.isArray(result) ? result : result?.data ?? [];
      const match = options.find((order) => String(order.po_number || "").toUpperCase() === submittedPoNumber.toUpperCase()) ?? null;
      if (!match?.id) return null;
      return await getProcessOrder(match.id);
    },
  });

  const po = detailQ.data ?? null;
  const blockMessage = useMemo(() => validateEditablePo(po), [po]);

  const machinesQ = useQuery({
    queryKey: ["production-edit-machines", po?.company_id],
    queryFn: () => listMachines({ company_id: po.company_id, active: true }),
    enabled: Boolean(po?.company_id && !blockMessage),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const machineOptions = useMemo(
    () => (machinesQ.data ?? []).map((machine) => ({ value: machine.id, label: machineLabel(machine) || "Machine" })),
    [machinesQ.data],
  );

  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: po?.company_id || undefined },
    { enabled: Boolean(po?.company_id && !blockMessage) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: storageLocationLabel(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );

  useEffect(() => {
    if (!po || blockMessage) {
      setMachineId("");
      setBatchQty("");
      setRows([]);
      return;
    }
    setMachineId(po.machine_id || "");
    setBatchQty(String(po.planned_qty ?? ""));
    setRows((po.lines ?? []).map(makeDraftRow));
  }, [po, blockMessage]);

  const previewRows = useMemo(
    () => rows.map((row, index) => ({
      ...row,
      line_no: index + 1,
      standard_qty: computeStandardQty(row.dosage_pct, batchQty, row.original_planned_qty),
    })),
    [batchQty, rows],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedPreviewRows(previewRows.map((row) => ({
        line_id: row.id,
        material_id: row.actual_material_id || row.material_id,
        storage_location_id: row.issue_sloc_id || undefined,
        qty: row.standard_qty,
      })));
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [previewRows]);

  const availabilityPreviewQ = useQuery({
    queryKey: ["production-edit-availability-preview", po?.company_id, po?.id, debouncedPreviewRows],
    queryFn: () => availabilityPreviewProcessOrder({
      company_id: po.company_id,
      process_order_id: po.id,
      overrides: debouncedPreviewRows,
    }),
    enabled: Boolean(
      po?.company_id
      && po?.id
      && !blockMessage
      && Number(batchQty || 0) > 0,
    ),
  });

  const availabilityByKey = useMemo(
    () => new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [availabilityPreviewQ.data],
  );

  const rowsWithAvailability = useMemo(
    () => previewRows.map((row) => {
      const previewMaterialId = row.actual_material_id || row.material_id;
      const availability = row.issue_sloc_id
        ? availabilityByKey.get(`${previewMaterialId}::${row.issue_sloc_id}`) ?? null
        : null;
      const availableQty = availability ? Number(availability.available_qty ?? 0) : null;
      return {
        ...row,
        available_qty: availableQty,
        is_short: Boolean(availability && availableQty < row.standard_qty),
      };
    }),
    [availabilityByKey, previewRows],
  );

  const shortLineNumbers = useMemo(
    () => rowsWithAvailability.filter((row) => row.is_short).map((row) => row.line_no),
    [rowsWithAvailability],
  );

  const lookupMessage = useMemo(() => {
    if (detailQ.error) return detailQ.error.message || "Process order lookup failed.";
    if (!submittedPoNumber || detailQ.isFetching) return "";
    if (!po) return "Process order not found.";
    return blockMessage;
  }, [blockMessage, detailQ.error, detailQ.isFetching, po, submittedPoNumber]);

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  function resetLookup() {
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setMachineId("");
    setBatchQty("");
    setRows([]);
  }

  function updateRow(key, patch) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleLookupSubmit(event) {
    event.preventDefault();
    const normalized = String(poNumberInput || "").trim();
    if (!normalized) {
      toast("PO Number is required.", "error");
      return;
    }
    setSubmittedPoNumber(normalized);
  }

  async function handleSave() {
    if (!po || blockMessage) return;
    if (!machineId) {
      toast("Machine is required.", "error");
      return;
    }
    if (Number(batchQty || 0) <= 0) {
      toast("Batch Qty must be greater than zero.", "error");
      return;
    }
    if (shortLineNumbers.length > 0) {
      toast(`Save is blocked. Short stock on line(s): ${shortLineNumbers.join(", ")}.`, "error");
      return;
    }

    setSaving(true);
    try {
      await editProcessOrder(po.id, {
        machine_id: machineId,
        planned_qty: Number(batchQty),
        lines: rows.map((row) => ({
          id: row.id,
          storage_location_id: row.issue_sloc_id || null,
          actual_material_id: row.actual_material_id || null,
        })),
      });
      toast("Process PO updated.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-edit-lookup", submittedPoNumber] });
    } catch (error) {
      toast(error.message || "Edit failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const showEditPage = Boolean(po && !blockMessage);

  return (
    <div className="flex flex-col gap-4">
      {!showEditPage ? (
        <ErpSectionCard title="Page 1 - Identify Process PO">
          <form onSubmit={handleLookupSubmit} className="flex max-w-xl flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">PO Number <span className="text-rose-500">*</span></label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={poNumberInput}
                onChange={(event) => setPoNumberInput(event.target.value)}
                placeholder="Enter Process PO number"
                autoComplete="off"
              />
            </div>

            {lookupMessage ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {lookupMessage}
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={detailQ.isFetching}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {detailQ.isFetching ? "Loading..." : "Next"}
              </button>
            </div>
          </form>
        </ErpSectionCard>
      ) : (
        <ErpSectionCard title="Page 2 - Edit Process PO">
          <div className="flex flex-col gap-4">
            <div className="flex justify-between gap-4">
              <div className="grid flex-1 gap-3 md:grid-cols-3 text-sm">
                <div>
                  <span className="block text-xs text-slate-400">PO Number</span>
                  <p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">PO Type</span>
                  <p>{po.po_type || "--"}</p>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">Prodshade / Material</span>
                  <p>{prodshadeLabel(po.material) || materialLabel(po.material) || "--"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetLookup}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Back
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Machine <span className="text-rose-500">*</span></label>
                <ErpComboboxField
                  value={machineId}
                  onChange={setMachineId}
                  options={machineOptions}
                  placeholder="-- Select machine --"
                  emptyStateLabel={machinesQ.isLoading ? "Loading machines..." : "No active machines for this company"}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Batch Qty <span className="text-rose-500">*</span></label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={batchQty}
                  onChange={(event) => setBatchQty(event.target.value)}
                />
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
                    {rowsWithAvailability.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">
                          No editable formulation lines found.
                        </td>
                      </tr>
                    ) : rowsWithAvailability.map((row) => {
                      const actualMaterialOptions = row.allowed_alternate_material_options?.length
                        ? row.allowed_alternate_material_options
                        : [{ value: "", label: "(same)" }];
                      return (
                        <tr key={row.key} className={row.is_short ? "bg-rose-50" : "border-b border-slate-100"}>
                          <td className="border-b border-slate-100 px-3 py-2">{row.line_no}</td>
                          <td className="border-b border-slate-100 px-3 py-2">{row.material_type}</td>
                          <td className="border-b border-slate-100 px-3 py-2">{row.material_label}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.dosage_pct.toFixed(3)}</td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <ErpComboboxField
                              value={row.actual_material_id}
                              onChange={(value) => updateRow(row.key, { actual_material_id: value })}
                              options={actualMaterialOptions}
                              placeholder="(same)"
                              disabled={actualMaterialOptions.length <= 1}
                            />
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <ErpComboboxField
                              value={row.issue_sloc_id}
                              onChange={(value) => updateRow(row.key, { issue_sloc_id: value })}
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

            {shortLineNumbers.length > 0 ? (
              <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                Save is blocked because Available is below Standard Qty on line(s): {shortLineNumbers.join(", ")}.
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || availabilityPreviewQ.isFetching}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save PR10 Edit"}
              </button>
            </div>
          </div>
        </ErpSectionCard>
      )}
    </div>
  );
}

export default function ProductionPOEditPage() {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <ErpScreenScaffold
      title="Production PO Edit - PR10"
      subtitle="Pre-QA edit window for STANDARD MTO/HPS Process POs and Packing POs"
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {EDIT_TABS.map((tab, index) => (
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
        {activeTab === 0 ? <ProcessPoEditTab /> : <PackingPoEditTab />}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
