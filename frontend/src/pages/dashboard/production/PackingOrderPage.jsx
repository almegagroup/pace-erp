/*
 * File-ID: 27.FE-PACKING-ORDERS
 * File-Path: frontend/src/pages/dashboard/production/PackingOrderPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Direct Packing PO create/final workspace. No Packing QA/Verify step.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { useMenu } from "../../../context/useMenu.js";
import {
  availabilityPreviewPackingOrder,
  createPackingOrder,
  finalizePackingOrder,
  getPackBom,
  getPackingOrder,
  listPackingSfgBatches,
  listPackBoms,
  listPackingOrders,
  reversePackingOrder,
} from "./prodApi.js";
import {
  addMaterialCategoryMember,
  createMaterialCategoryGroup,
  listMaterialCategoryGroups,
  listMaterials,
  listStorageLocations,
} from "../om/omApi.js";
import { GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";

const STATUS_OPTIONS = ["", "STANDARD", "FINAL", "REVERSED"];
const SOURCE_PO_TYPES = ["MTO", "HPS", "MTS", "ZTEST"];
const EMPTY_PM_LINE = { material_id: "", dosage_per_sku: "", storage_location_id: "", has_alternate: false, material_group_id: "" };

const ERRORS = {
  PROD_PACK_INVALID: "Company, type and FG SKU are required.",
  PROD_PACK_NO_ACTIVE_BOM: "Active Pack BOM is required before creating a Packing PO.",
  PROD_PACK_QTY_CONVERSION_REQUIRED: "PO Qty, conversion and storage locations are required.",
  PROD_PACK_PM_LINE_INVALID: "Every PM line needs material, dosage and storage location.",
  PROD_PACK_PM_ONLY: "Only PM materials are allowed in PM lines.",
  PROD_PACK_STOCK_SHORTAGE: "Stock is short for one or more SFG/PM lines.",
  PROD_PACK_SFG_BATCH_REQUIRED: "Select an available SFG batch before creating/final posting.",
  PROD_PACK_SFG_BATCH_SHORTAGE: "Selected SFG batch does not have enough available stock.",
  PROD_PACK_STATUS_INVALID: "Action not valid for current status.",
  PROD_PACKING_PO_FINAL: "Packing PO final permission is missing.",
};

function friendly(error) {
  const code = error?.code || error?.message || "";
  return ERRORS[code] ?? code ?? "Request failed";
}

function materialLabel(material) {
  return [material?.pace_code || material?.external_code, material?.material_name || material?.document_name]
    .filter(Boolean)
    .join(" - ");
}

function companyLabel(company) {
  return [company?.company_code, company?.company_name].filter(Boolean).join(" - ");
}

function slocLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name]
    .filter(Boolean)
    .join(" - ");
}

function machineLabel(machine) {
  return [machine?.machine_code, machine?.machine_name].filter(Boolean).join(" - ");
}

function qty(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "-";
}

function asNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function StatusBadge({ status }) {
  const tone = status === "FINAL"
    ? "bg-emerald-100 text-emerald-700"
    : status === "REVERSED"
      ? "bg-gray-100 text-gray-500"
      : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{status || "-"}</span>;
}

function lineMaterialFromBom(line) {
  return line?.material ?? null;
}

export default function PackingOrderPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);

  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [detailId, setDetailId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_id: "",
    source_po_type: "MTO",
    sku_material_id: "",
    sku_qty: "",
    fg_conversion_qty: "1",
    sfg_conversion_qty: "",
    sfg_batch_number: "",
    fg_storage_location_id: "",
    sfg_material_id: "",
    sfg_storage_location_id: "",
    pm_lines: [],
  });
  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  const effectiveCompanyId = form.company_id || defaultCompanyId;
  const packingPoType = packingPoTypeForProcessType(form.source_po_type);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function resetCreate() {
    setCreateStep(1);
    setForm({
      company_id: "",
      source_po_type: "MTO",
      sku_material_id: "",
      sku_qty: "",
      fg_conversion_qty: "1",
      sfg_conversion_qty: "",
      sfg_batch_number: "",
      fg_storage_location_id: "",
      sfg_material_id: "",
      sfg_storage_location_id: "",
      pm_lines: [],
    });
  }

  const listQ = useQuery({
    queryKey: ["pack-orders", defaultCompanyId, statusFilter],
    queryFn: () => listPackingOrders({
      company_id: defaultCompanyId || undefined,
      status: statusFilter || undefined,
      per_page: 100,
    }),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  const activeBomsQ = useQuery({
    queryKey: ["packing-active-pack-boms", effectiveCompanyId],
    queryFn: () => listPackBoms({ company_id: effectiveCompanyId, status: "ACTIVE" }),
    enabled: Boolean(effectiveCompanyId),
  });

  const selectedBomRow = (activeBomsQ.data ?? []).find((bom) => bom.sku_material_id === form.sku_material_id) ?? null;
  const activeBomQ = useQuery({
    queryKey: ["packing-active-pack-bom-detail", selectedBomRow?.id],
    queryFn: () => getPackBom(selectedBomRow.id),
    enabled: Boolean(selectedBomRow?.id),
  });

  const storageQ = useQuery({
    queryKey: ["om-storage-locations", effectiveCompanyId, "active", "packing"],
    queryFn: () => listStorageLocations({ company_id: effectiveCompanyId, is_active: true }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => data?.data ?? data ?? [],
  });
  const pmMaterialsQ = useQuery({
    queryKey: ["om-materials", "PM", "packing"],
    queryFn: () => listMaterials({ material_type: "PM", limit: 500 }),
    select: (data) => data?.data ?? [],
  });
  const groupsQ = useQuery({
    queryKey: ["om-material-groups", "packing"],
    queryFn: () => listMaterialCategoryGroups(),
    select: (data) => data?.data ?? [],
  });
  const detailQ = useQuery({
    queryKey: ["pack-order-detail", detailId],
    queryFn: () => getPackingOrder(detailId),
    enabled: Boolean(detailId),
  });

  const orders = listQ.data ?? [];
  const order = detailQ.data;
  const activeBom = activeBomQ.data ?? null;
  const selectedSku = activeBom?.sku ?? selectedBomRow?.sku ?? null;
  const fgLine = (activeBom?.lines ?? []).find((line) => line.line_type === "OUTPUT");
  const sfgLine = (activeBom?.lines ?? []).find((line) => line.line_type === "SFG");
  const fgLocationOptions = (storageQ.data ?? [])
    .filter((location) => String(location.code ?? "").startsWith("F"))
    .map((location) => ({ value: location.id, label: slocLabel(location) }));
  const storageOptions = (storageQ.data ?? []).map((location) => ({ value: location.id, label: slocLabel(location) }));
  const pmMaterialOptions = (pmMaterialsQ.data ?? []).map((material) => ({ value: material.id, label: materialLabel(material) }));
  const groupOptions = (groupsQ.data ?? []).map((group) => ({ value: group.id, label: `${group.group_code} - ${group.group_name}` }));

  const skuQty = asNumber(form.sku_qty);
  const fgConversionQty = asNumber(form.fg_conversion_qty) || 1;
  const sfgConversionQty = asNumber(form.sfg_conversion_qty);
  const sfgStandardQty = fgConversionQty > 0 ? (skuQty / fgConversionQty) * sfgConversionQty : 0;
  const pmPreviewLines = form.pm_lines.map((line) => ({
    ...line,
    standard_qty: skuQty * asNumber(line.dosage_per_sku),
  }));
  const availabilityNeeds = [
    ...pmPreviewLines
      .filter((line) => line.material_id && line.storage_location_id && line.standard_qty > 0)
      .map((line) => ({ material_id: line.material_id, storage_location_id: line.storage_location_id, qty: line.standard_qty })),
  ];
  const availabilityPreviewQ = useQuery({
    queryKey: ["packing-create-availability-preview", effectiveCompanyId, availabilityNeeds],
    queryFn: () => availabilityPreviewPackingOrder({
      company_id: effectiveCompanyId,
      needs: JSON.stringify(availabilityNeeds),
    }),
    enabled: createOpen && createStep === 2 && Boolean(effectiveCompanyId) && availabilityNeeds.length > 0,
    select: (data) => data?.data ?? data ?? [],
  });
  const availabilityByKey = new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row]));
  const sfgBatchesQ = useQuery({
    queryKey: ["packing-sfg-batches", effectiveCompanyId, form.sfg_material_id, form.sfg_storage_location_id],
    queryFn: () => listPackingSfgBatches({
      company_id: effectiveCompanyId,
      material_id: form.sfg_material_id,
      storage_location_id: form.sfg_storage_location_id,
    }),
    enabled: createOpen && createStep === 2 && Boolean(effectiveCompanyId && form.sfg_material_id && form.sfg_storage_location_id),
    select: (data) => data?.data ?? data ?? [],
  });
  const selectedSfgBatch = (sfgBatchesQ.data ?? []).find((batch) => batch.batch_number === form.sfg_batch_number) ?? null;
  const sfgShortage = selectedSfgBatch ? Math.max(0, sfgStandardQty - Number(selectedSfgBatch.available_qty ?? 0)) : 0;
  const pmShortLines = pmPreviewLines.filter((line) => {
    const row = line.material_id && line.storage_location_id
      ? availabilityByKey.get(`${line.material_id}::${line.storage_location_id}`)
      : null;
    return row && Number(row.short ?? 0) > 0;
  });
  const hasShortage = Boolean(sfgShortage > 0 || pmShortLines.length > 0);

  function applyBomDefaults() {
    const packCode = String(selectedSku?.pack_code ?? "");
    const defaultSfgConversion = sfgLine?.qty ? String(sfgLine.qty) : packCode === "000" ? "1" : "";
    setForm((current) => ({
      ...current,
      fg_storage_location_id: current.fg_storage_location_id || fgLine?.storage_location_id || "",
      sfg_material_id: current.sfg_material_id || sfgLine?.material_id || "",
      sfg_storage_location_id: current.sfg_storage_location_id || sfgLine?.storage_location_id || "",
      sfg_conversion_qty: current.sfg_conversion_qty || defaultSfgConversion,
      pm_lines: current.pm_lines.length
        ? current.pm_lines
        : (activeBom?.lines ?? [])
          .filter((line) => line.line_type === "INPUT")
          .map((line) => ({
            material_id: line.material_id || "",
            dosage_per_sku: line.qty ? String(line.qty) : "",
            storage_location_id: line.storage_location_id || "",
            has_alternate: Boolean(line.has_alternate),
            material_group_id: line.material_group_id || "",
          })),
    }));
  }

  function nextCreateStep() {
    if (!effectiveCompanyId || !form.source_po_type || !packingPoType || !form.sku_material_id) {
      toast("Select Company, PO Type and FG SKU.", "error");
      return;
    }
    if (!activeBom) {
      toast("Active Pack BOM not loaded for this SKU.", "error");
      return;
    }
    applyBomDefaults();
    setCreateStep(2);
  }

  function updatePmLine(index, patch) {
    setForm((current) => ({
      ...current,
      pm_lines: current.pm_lines.map((line, idx) => idx === index ? { ...line, ...patch } : line),
    }));
  }

  function addPmLine() {
    setForm((current) => ({ ...current, pm_lines: [...current.pm_lines, { ...EMPTY_PM_LINE }] }));
  }

  function removePmLine(index) {
    setForm((current) => ({ ...current, pm_lines: current.pm_lines.filter((_, idx) => idx !== index) }));
  }

  function openCreateGroupModal(onCreated) {
    setGroupForm({ group_name: "", description: "" });
    setGroupModal({ onCreated });
  }

  async function handleCreateGroup() {
    if (!groupForm.group_name.trim()) { toast("Group name required.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup(groupForm);
      const newGroup = res?.data ?? res;
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      groupModal?.onCreated?.(newGroup.id);
      setGroupModal(null);
      toast("Material group created.");
    } catch (error) {
      toast(friendly(error), "error");
    }
  }

  async function handleAddMember() {
    if (!memberMaterialId) { toast("Select a material first.", "error"); return; }
    try {
      await addMaterialCategoryMember({ group_id: memberModal, material_id: memberMaterialId });
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      setMemberModal(null);
      setMemberMaterialId("");
      toast("Member added.");
    } catch (error) {
      toast(friendly(error), "error");
    }
  }

  async function handleCreate() {
    if (!skuQty || !sfgConversionQty || !form.fg_storage_location_id || !form.sfg_material_id || !form.sfg_storage_location_id) {
      toast("Enter PO Qty, conversion and FG/SFG storage locations.", "error");
      return;
    }
    if (!form.sfg_batch_number) {
      toast("Select SFG batch number before creating Packing PO.", "error");
      return;
    }
    if (availabilityPreviewQ.isFetching || sfgBatchesQ.isFetching) {
      toast("Stock check is still loading. Try again in a moment.", "error");
      return;
    }
    if (hasShortage) {
      toast("Stock shortage exists. Fix storage location or stock before create.", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await createPackingOrder({
        company_id: effectiveCompanyId,
        source_po_type: form.source_po_type,
        po_type: packingPoType,
        material_id: form.sku_material_id,
        sku_qty: skuQty,
        fg_conversion_qty: fgConversionQty,
        sfg_conversion_qty: sfgConversionQty,
        sfg_batch_number: form.sfg_batch_number,
        process_order_id: selectedSfgBatch?.process_order_id || null,
        fg_storage_location_id: form.fg_storage_location_id,
        sfg_material_id: form.sfg_material_id,
        sfg_storage_location_id: form.sfg_storage_location_id,
        pm_lines: form.pm_lines
          .filter((line) => line.material_id)
          .map((line) => ({
            material_id: line.material_id,
            dosage_per_sku: Number(line.dosage_per_sku || 0),
            storage_location_id: line.storage_location_id,
            has_alternate: Boolean(line.has_alternate),
            material_group_id: line.has_alternate ? (line.material_group_id || null) : null,
          })),
      });
      toast(`Packing PO created: ${result?.po_number ?? ""}`);
      setDetailId(result?.id ?? null);
      setCreateOpen(false);
      setStatusFilter("");
      resetCreate();
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (error) {
      toast(friendly(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!window.confirm("Finalize Packing PO? This posts SFG/PM issue and FG receipt.")) return;
    setSaving(true);
    try {
      await finalizePackingOrder(detailId, {});
      toast("Packing PO finalized.");
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (error) {
      toast(friendly(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReverse() {
    if (!window.confirm("Reverse Packing PO?")) return;
    setSaving(true);
    try {
      await reversePackingOrder(detailId);
      toast("Packing PO reversed.");
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (error) {
      toast(friendly(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Packing Orders"
      subtitle="Direct Packing PO create and final. No Packing QA/Verify."
      actions={[{ label: "New Packing PO", tone: "primary", mnemonic: "N", onClick: () => { resetCreate(); setCreateOpen(true); } }]}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs text-slate-500">
            Status
            <select className="mt-1 h-9 border border-slate-300 rounded px-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status || "All"}</option>)}
            </select>
          </label>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Packing PO List${orders.length ? ` (${orders.length})` : ""}`}>
        {listQ.isFetching ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading...</p>
        ) : orders.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No packing orders found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[900px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left py-2 px-3 border-b">Packing PO</th>
                  <th className="text-left py-2 px-3 border-b">Type</th>
                  <th className="text-left py-2 px-3 border-b">FG SKU</th>
                  <th className="text-right py-2 px-3 border-b">SKU Qty</th>
                  <th className="text-right py-2 px-3 border-b">SFG Qty</th>
                  <th className="text-left py-2 px-3 border-b">Status</th>
                  <th className="text-right py-2 px-3 border-b">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-sky-50">
                    <td className="py-2 px-3 font-mono font-semibold text-sky-700 cursor-pointer" onClick={() => setDetailId(row.id)}>{row.po_number}</td>
                    <td className="py-2 px-3">{row.source_po_type || "-"} / {row.po_type}</td>
                    <td className="py-2 px-3">{materialLabel(row.material)}</td>
                    <td className="py-2 px-3 text-right font-mono">{qty(row.sku_qty ?? row.num_packs)}</td>
                    <td className="py-2 px-3 text-right font-mono">{qty(row.planned_qty_kg)}</td>
                    <td className="py-2 px-3"><StatusBadge status={row.status} /></td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        className={`px-3 py-1 rounded text-xs font-semibold ${
                          row.status === "STANDARD"
                            ? "bg-emerald-600 text-white"
                            : "border border-slate-300 text-slate-600"
                        }`}
                        onClick={() => setDetailId(row.id)}
                      >
                        {row.status === "STANDARD" ? "Open / Final" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>

      <DrawerBase visible={createOpen} title="New Packing PO" onClose={() => setCreateOpen(false)} width="xl">
        <div className="p-4 space-y-4">
          {createStep === 1 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={effectiveCompanyId}
                  onChange={(value) => setForm((current) => ({
                    ...current,
                    company_id: value,
                    sku_material_id: "",
                    sfg_batch_number: "",
                    sfg_material_id: "",
                    sfg_storage_location_id: "",
                    pm_lines: [],
                  }))}
                  label="Company"
                />
                <label className="text-xs text-slate-500">
                  PO Type *
                  <select
                    className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm"
                    value={form.source_po_type}
                    onChange={(event) => setForm((current) => ({ ...current, source_po_type: event.target.value }))}
                  >
                    {SOURCE_PO_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <div className="text-sm">
                  <p className="text-xs text-slate-400">Packing PO Type</p>
                  <p className="font-semibold">{packingPoType || "-"}</p>
                </div>
                <label className="text-xs text-slate-500 md:col-span-3">
                  FG SKU *
                  <ErpComboboxField
                    value={form.sku_material_id}
                    onChange={(value) => setForm((current) => ({
                      ...current,
                      sku_material_id: value,
                      sku_qty: "",
                      sfg_conversion_qty: "",
                      sfg_batch_number: "",
                      sfg_material_id: "",
                      sfg_storage_location_id: "",
                      pm_lines: [],
                    }))}
                    options={(activeBomsQ.data ?? []).map((bom) => ({ value: bom.sku_material_id, label: materialLabel(bom.sku) }))}
                    placeholder={activeBomsQ.isFetching ? "Loading ACTIVE Pack BOM SKUs..." : "-- Select FG SKU --"}
                    emptyStateLabel="No ACTIVE Pack BOM SKU found"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <button type="button" className="px-4 py-2 bg-sky-600 text-white rounded text-sm" onClick={nextCreateStep}>Next</button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
                <div><p className="text-xs text-slate-400">Company</p><p className="font-semibold">{companyLabel(activeBom?.company)}</p></div>
                <div><p className="text-xs text-slate-400">SKU</p><p className="font-semibold">{materialLabel(selectedSku)}</p></div>
                <div><p className="text-xs text-slate-400">Description</p><p>{selectedSku?.document_name || selectedSku?.material_name || "-"}</p></div>
                <div><p className="text-xs text-slate-400">Machine</p><p>{machineLabel(selectedSfgBatch?.machine) || "--"}</p></div>
                <div><p className="text-xs text-slate-400">Type</p><p>{form.source_po_type} / {packingPoType}</p></div>
              </div>

              <ErpSectionCard title="PO Qty / FG-SFG Conversion">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="text-xs text-slate-500">
                    PO Qty (SKU) *
                    <input className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm font-mono text-right" type="number" min="0.001" step="0.001" value={form.sku_qty} onChange={(event) => setForm((current) => ({ ...current, sku_qty: event.target.value }))} />
                  </label>
                  <label className="text-xs text-slate-500">
                    FG Conversion *
                    <input className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm font-mono text-right" type="number" min="0.001" step="0.001" value={form.fg_conversion_qty} onChange={(event) => setForm((current) => ({ ...current, fg_conversion_qty: event.target.value }))} />
                  </label>
                  <label className="text-xs text-slate-500">
                    SFG Conversion *
                    <input className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm font-mono text-right" type="number" min="0.001" step="0.001" value={form.sfg_conversion_qty} onChange={(event) => setForm((current) => ({ ...current, sfg_conversion_qty: event.target.value }))} />
                  </label>
                  <div>
                    <p className="text-xs text-slate-400">SFG Standard Qty</p>
                    <p className="font-mono font-semibold">{qty(sfgStandardQty)} KG</p>
                  </div>
                </div>
              </ErpSectionCard>

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[1100px]">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2 px-3 border-b">Line</th>
                      <th className="text-left py-2 px-3 border-b">Material</th>
                      <th className="text-left py-2 px-3 border-b">Storage Location</th>
                      <th className="text-left py-2 px-3 border-b">Batch / Source PO</th>
                      <th className="text-right py-2 px-3 border-b">Standard Qty</th>
                      <th className="text-right py-2 px-3 border-b">Available</th>
                      <th className="text-right py-2 px-3 border-b">Shortage</th>
                      <th className="text-left py-2 px-3 border-b">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 px-3 font-semibold">FG</td>
                      <td className="py-2 px-3">{materialLabel(selectedSku)}</td>
                      <td className="py-2 px-3 min-w-[240px]">
                        <ErpComboboxField value={form.fg_storage_location_id} onChange={(value) => setForm((current) => ({ ...current, fg_storage_location_id: value }))} options={fgLocationOptions} placeholder="-- Select F-location --" />
                      </td>
                      <td className="py-2 px-3 text-slate-400">--</td>
                      <td className="py-2 px-3 text-right font-mono">{qty(skuQty)}</td>
                      <td className="py-2 px-3 text-right text-slate-400">--</td>
                      <td className="py-2 px-3 text-right text-slate-400">--</td>
                      <td className="py-2 px-3 font-mono">P101</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 px-3 font-semibold">SFG</td>
                      <td className="py-2 px-3">{materialLabel(lineMaterialFromBom(sfgLine))}</td>
                      <td className="py-2 px-3 min-w-[240px]">
                        <ErpComboboxField
                          value={form.sfg_storage_location_id}
                          onChange={(value) => setForm((current) => ({ ...current, sfg_storage_location_id: value, sfg_batch_number: "" }))}
                          options={storageOptions}
                          placeholder="-- Select SFG location --"
                        />
                      </td>
                      <td className="py-2 px-3 min-w-[260px]">
                        <ErpComboboxField
                          value={form.sfg_batch_number}
                          onChange={(value) => setForm((current) => ({ ...current, sfg_batch_number: value }))}
                          options={(sfgBatchesQ.data ?? []).map((batch) => ({
                            value: batch.batch_number,
                            label: `${batch.batch_number} | ${batch.source_po_number || "--"} | ${machineLabel(batch.machine) || "--"} | Avl ${qty(batch.available_qty)}`,
                          }))}
                          placeholder={sfgBatchesQ.isFetching ? "Loading SFG batches..." : "-- Select SFG batch --"}
                          emptyStateLabel="No available SFG batch found"
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{qty(sfgStandardQty)} KG</td>
                      <td className="py-2 px-3 text-right font-mono">{selectedSfgBatch ? qty(selectedSfgBatch.available_qty) : sfgBatchesQ.isFetching ? "..." : "--"}</td>
                      <td className={`py-2 px-3 text-right font-mono ${sfgShortage > 0 ? "text-rose-600 font-semibold" : ""}`}>
                        {selectedSfgBatch ? qty(sfgShortage) : sfgBatchesQ.isFetching ? "..." : "--"}
                      </td>
                      <td className="py-2 px-3 font-mono">P261</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <ErpSectionCard title="PM Lines">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse min-w-[1050px]">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                      <tr>
                        <th className="text-left py-2 px-3 border-b">Type</th>
                        <th className="text-left py-2 px-3 border-b">Material</th>
                        <th className="text-right py-2 px-3 border-b">Dosage / SKU</th>
                        <th className="text-right py-2 px-3 border-b">Standard Qty</th>
                        <th className="text-left py-2 px-3 border-b">Storage Location</th>
                        <th className="text-right py-2 px-3 border-b">Available</th>
                        <th className="text-right py-2 px-3 border-b">Shortage</th>
                        <th className="text-left py-2 px-3 border-b">Alternate?</th>
                        <th className="text-left py-2 px-3 border-b">Group</th>
                        <th className="text-left py-2 px-3 border-b">Members</th>
                        <th className="text-left py-2 px-3 border-b"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pmPreviewLines.map((line, index) => {
                        const selectedGroup = (groupsQ.data ?? []).find((group) => group.id === line.material_group_id);
                        const availability = line.material_id && line.storage_location_id
                          ? availabilityByKey.get(`${line.material_id}::${line.storage_location_id}`) ?? null
                          : null;
                        const isShort = availability && Number(availability.short ?? 0) > 0;
                        return (
                          <tr key={index} className="border-b border-slate-100">
                            <td className="py-2 px-3 font-semibold">PM</td>
                            <td className="py-2 px-3 min-w-[220px]">
                              <ErpComboboxField value={line.material_id} onChange={(value) => updatePmLine(index, { material_id: value })} options={pmMaterialOptions} placeholder="-- Select PM --" />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input className="h-8 w-24 border border-slate-300 rounded px-2 text-right font-mono" type="number" min="0.001" step="0.001" value={line.dosage_per_sku} onChange={(event) => updatePmLine(index, { dosage_per_sku: event.target.value })} />
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{qty(line.standard_qty)}</td>
                            <td className="py-2 px-3 min-w-[220px]">
                              <ErpComboboxField value={line.storage_location_id} onChange={(value) => updatePmLine(index, { storage_location_id: value })} options={storageOptions} placeholder="-- Select --" />
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{availability ? qty(availability.available_qty) : availabilityPreviewQ.isFetching ? "..." : "--"}</td>
                            <td className={`py-2 px-3 text-right font-mono ${isShort ? "text-rose-600 font-semibold" : ""}`}>
                              {availability ? qty(availability.short) : availabilityPreviewQ.isFetching ? "..." : "--"}
                            </td>
                            <td className="py-2 px-3">
                              <input type="checkbox" checked={Boolean(line.has_alternate)} onChange={(event) => updatePmLine(index, { has_alternate: event.target.checked, material_group_id: event.target.checked ? line.material_group_id : "" })} />
                            </td>
                            <td className="py-2 px-3 min-w-[180px]">
                              {line.has_alternate ? (
                                <div className="flex gap-1">
                                  <ErpComboboxField value={line.material_group_id} onChange={(value) => updatePmLine(index, { material_group_id: value })} options={groupOptions} placeholder="-- Group --" />
                                  <button type="button" className="text-sky-600 text-xs underline" onClick={() => openCreateGroupModal((id) => updatePmLine(index, { material_group_id: id }))}>+ New</button>
                                </div>
                              ) : <span className="text-slate-400">--</span>}
                            </td>
                            <td className="py-2 px-3 text-xs text-slate-500 min-w-[180px]">
                              {line.has_alternate && selectedGroup ? (
                                <>
                                  {(selectedGroup.members ?? []).length ? `${selectedGroup.members.length} members` : "none"}
                                  <button type="button" className="text-sky-600 underline ml-1" onClick={() => setMemberModal(selectedGroup.id)}>+ Add</button>
                                </>
                              ) : "--"}
                            </td>
                            <td className="py-2 px-3">
                              <button type="button" className="text-rose-500 text-xs underline" onClick={() => removePmLine(index)}>Remove</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="text-sky-600 text-xs underline mt-2" onClick={addPmLine}>+ Add PM line</button>
              </ErpSectionCard>

              {hasShortage ? (
                <div className="border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 rounded text-sm">
                  Stock shortage exists for the selected SFG batch or PM storage location. Change batch/SLoc or receive stock before creating this Packing PO.
                </div>
              ) : null}

              <div className="flex justify-between">
                <button type="button" className="px-4 py-2 border rounded text-sm" onClick={() => setCreateStep(1)}>Back</button>
                <button type="button" className="px-5 py-2 bg-sky-600 text-white rounded text-sm disabled:opacity-50" disabled={saving || availabilityPreviewQ.isFetching || sfgBatchesQ.isFetching || hasShortage} onClick={handleCreate}>
                  {saving ? "Creating..." : (availabilityPreviewQ.isFetching || sfgBatchesQ.isFetching) ? "Checking Stock..." : "Create Packing PO"}
                </button>
              </div>
            </>
          )}
        </div>
      </DrawerBase>

      <DrawerBase visible={Boolean(detailId)} title={order ? `Packing PO ${order.po_number}` : "Packing PO"} onClose={() => setDetailId(null)} width="xl">
        {detailQ.isFetching ? (
          <div className="p-4 text-sm text-slate-400">Loading...</div>
        ) : order ? (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">PO Number</p><p className="font-mono font-semibold text-sky-700">{order.po_number}</p></div>
              <div><p className="text-xs text-slate-400">Status</p><StatusBadge status={order.status} /></div>
              <div><p className="text-xs text-slate-400">Type</p><p>{order.source_po_type || "-"} / {order.po_type}</p></div>
              <div><p className="text-xs text-slate-400">SKU</p><p>{materialLabel(order.material)}</p></div>
              <div><p className="text-xs text-slate-400">Machine</p><p>{machineLabel(order.machine) || "--"}</p></div>
              <div><p className="text-xs text-slate-400">SFG Batch</p><p className="font-mono">{order.batch_number || "-"}</p></div>
              <div><p className="text-xs text-slate-400">SKU Qty</p><p className="font-mono">{qty(order.sku_qty ?? order.num_packs)}</p></div>
              <div><p className="text-xs text-slate-400">FG/SFG Conv</p><p className="font-mono">{qty(order.fg_conversion_qty)} / {qty(order.sfg_conversion_qty)}</p></div>
              <div><p className="text-xs text-slate-400">SFG Qty</p><p className="font-mono">{qty(order.planned_qty_kg)}</p></div>
              <div><p className="text-xs text-slate-400">Actual KG</p><p className="font-mono">{order.actual_qty_kg == null ? "-" : qty(order.actual_qty_kg)}</p></div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[900px]">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left py-2 px-3 border-b">Type</th>
                    <th className="text-left py-2 px-3 border-b">Material</th>
                    <th className="text-left py-2 px-3 border-b">Storage Location</th>
                    <th className="text-left py-2 px-3 border-b">Batch</th>
                    <th className="text-right py-2 px-3 border-b">Qty / SKU</th>
                    <th className="text-right py-2 px-3 border-b">Total Qty</th>
                    <th className="text-left py-2 px-3 border-b">Movement</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.lines ?? []).map((line) => (
                    <tr key={line.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-semibold">{line.line_type}</td>
                      <td className="py-2 px-3">{materialLabel(line.material)}</td>
                      <td className="py-2 px-3">{slocLabel(line.storage_location)}</td>
                      <td className="py-2 px-3 font-mono">{line.batch_number || "--"}</td>
                      <td className="py-2 px-3 text-right font-mono">{qty(line.qty_per_pack)}</td>
                      <td className="py-2 px-3 text-right font-mono">{qty(line.total_qty)}</td>
                      <td className="py-2 px-3 font-mono">{line.movement_type_code || (line.line_type === "FG" ? "P101" : "P261")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {order.status === "STANDARD" ? (
                <button type="button" className="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50" disabled={saving} onClick={handleFinalize}>
                  Final & Post Stock
                </button>
              ) : null}
              {order.status !== "REVERSED" ? (
                <button type="button" className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-600 disabled:opacity-50 ml-auto" disabled={saving} onClick={handleReverse}>
                  Reverse
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-400">Not found.</div>
        )}
      </DrawerBase>

      <GroupCreateModal open={Boolean(groupModal)} groupForm={groupForm} setGroupForm={setGroupForm} onCancel={() => setGroupModal(null)} onCreate={handleCreateGroup} />
      <MemberAddModal
        open={Boolean(memberModal)}
        memberMaterialId={memberMaterialId}
        setMemberMaterialId={setMemberMaterialId}
        materialOptions={(pmMaterialsQ.data ?? []).map((material) => ({ value: material.id, label: materialLabel(material) }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
