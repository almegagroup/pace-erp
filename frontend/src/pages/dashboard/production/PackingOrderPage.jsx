/*
 * File-ID: 27.FE-PACKING-ORDERS
 * File-Path: frontend/src/pages/dashboard/production/PackingOrderPage.jsx
 * Gate: 27.23 | Domain: PRODUCTION
 * Purpose: Pack-BOM-driven Packing PO create/detail/final/correction workspace.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { useMenu } from "../../../context/useMenu.js";
import {
  correctPackingOrder,
  createPackingOrder,
  finalizePackingOrder,
  getPackBom,
  getPackingOrder,
  listPackBomEligibleSkus,
  listPackBoms,
  listPackingOrders,
  listProcessOrders,
  reversePackingOrder,
} from "./prodApi.js";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";

const STATUS_OPTIONS = ["", "STANDARD", "FINAL", "REVERSED"];
const PROCESS_READY_STATUSES = new Set(["VERIFIED", "FINAL"]);

const ERRORS = {
  PROD_PACK_INVALID: "Company, Process PO, FG SKU and Pack Code are required.",
  PROD_PACK_NO_ACTIVE_BOM: "Active Pack BOM is required before creating a Packing PO.",
  PROD_PACK_PROC_ORDER_NOT_READY: "Process PO must be VERIFIED or later before Packing PO create.",
  PROD_PACKING_ORDER_WRONG_STATUS: "Action not valid for current status.",
  PROD_PACK_CORRECTION_INVALID: "Correction lines are required.",
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

function processOrderLabel(order) {
  return [order?.po_number, order?.batch_number, materialLabel(order?.material), order?.status]
    .filter(Boolean)
    .join(" - ");
}

function slocLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name]
    .filter(Boolean)
    .join(" - ");
}

function qty(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "-";
}

function StatusBadge({ status }) {
  const tone = status === "FINAL"
    ? "bg-emerald-100 text-emerald-700"
    : status === "REVERSED"
      ? "bg-gray-100 text-gray-500"
      : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{status || "-"}</span>;
}

function buildPreviewLines({ bom, selectedSku, numPacks, fillQtyPerPack }) {
  const lines = bom?.lines ?? [];
  const outputLine = lines.find((line) => line.line_type === "OUTPUT");
  const sfgLine = lines.find((line) => line.line_type === "SFG");
  const pmLines = lines.filter((line) => line.line_type === "INPUT");
  const packs = Number(numPacks || 0);
  const fill = Number(fillQtyPerPack || 0);
  const bomRequired = selectedSku?.pack_code_row?.bom_required !== false;
  const plannedKg = bomRequired
    ? Number(sfgLine?.qty ?? 0) * packs
    : packs * fill;

  const preview = [];
  if (sfgLine) {
    preview.push({
      ...sfgLine,
      line_type: "SFG",
      preview_qty: bomRequired ? Number(sfgLine.qty ?? 0) * packs : plannedKg,
    });
  }
  for (const line of pmLines) {
    preview.push({
      ...line,
      line_type: "PM",
      preview_qty: bomRequired ? Number(line.qty ?? 0) * packs : 0,
    });
  }
  if (outputLine) {
    preview.push({
      ...outputLine,
      line_type: "FG",
      material: selectedSku,
      preview_qty: plannedKg,
    });
  }
  return { preview, plannedKg, bomRequired };
}

export default function PackingOrderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);

  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [detailId, setDetailId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState([]);
  const [form, setForm] = useState({
    company_id: "",
    process_order_id: "",
    material_id: "",
    num_packs: "",
    fill_qty_per_pack: "",
  });

  const effectiveCompanyId = form.company_id || defaultCompanyId;

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function resetCreate() {
    setCreateStep(1);
    setForm({ company_id: "", process_order_id: "", material_id: "", num_packs: "", fill_qty_per_pack: "" });
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

  const processOrdersQ = useQuery({
    queryKey: ["packing-create-process-orders", effectiveCompanyId],
    queryFn: () => listProcessOrders({ company_id: effectiveCompanyId, per_page: 100 }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => (data?.data ?? data ?? []).filter((order) => PROCESS_READY_STATUSES.has(String(order.status ?? "").toUpperCase())),
  });

  const selectedProcessOrder = (processOrdersQ.data ?? []).find((order) => order.id === form.process_order_id) ?? null;
  const processPoType = String(selectedProcessOrder?.po_type ?? "").toUpperCase();
  const packingPoType = packingPoTypeForProcessType(processPoType);

  const eligibleSkuQ = useQuery({
    queryKey: ["packing-create-eligible-skus", effectiveCompanyId, processPoType],
    queryFn: () => listPackBomEligibleSkus({ company_id: effectiveCompanyId, po_type: processPoType }),
    enabled: Boolean(effectiveCompanyId && processPoType),
  });

  const selectedSku = (eligibleSkuQ.data ?? []).find((sku) => sku.id === form.material_id) ?? null;

  const activeBomListQ = useQuery({
    queryKey: ["packing-create-active-pack-bom", effectiveCompanyId, form.material_id],
    queryFn: () => listPackBoms({ company_id: effectiveCompanyId, sku_material_id: form.material_id, status: "ACTIVE" }),
    enabled: Boolean(effectiveCompanyId && form.material_id),
  });
  const activeBomId = (activeBomListQ.data ?? [])[0]?.id ?? "";
  const activeBomQ = useQuery({
    queryKey: ["packing-create-pack-bom-detail", activeBomId],
    queryFn: () => getPackBom(activeBomId),
    enabled: Boolean(activeBomId),
  });

  const detailQ = useQuery({
    queryKey: ["pack-order-detail", detailId],
    queryFn: () => getPackingOrder(detailId),
    enabled: Boolean(detailId),
  });

  const preview = buildPreviewLines({
    bom: activeBomQ.data,
    selectedSku,
    numPacks: form.num_packs,
    fillQtyPerPack: form.fill_qty_per_pack,
  });
  const createReady = Boolean(
    effectiveCompanyId &&
    selectedProcessOrder &&
    selectedSku &&
    packingPoType &&
    Number(form.num_packs) > 0 &&
    (preview.bomRequired || Number(form.fill_qty_per_pack) > 0) &&
    preview.plannedKg > 0 &&
    activeBomQ.data,
  );
  const orders = listQ.data ?? [];
  const order = detailQ.data;

  function nextCreateStep() {
    if (!effectiveCompanyId || !selectedProcessOrder || !selectedSku) {
      toast("Select Company, Process PO and FG SKU.", "error");
      return;
    }
    if (!activeBomQ.data) {
      toast("Active Pack BOM not found for this FG SKU.", "error");
      return;
    }
    if (!createReady) {
      toast(preview.bomRequired ? "Enter number of packs." : "Enter number of packs and fill qty.", "error");
      return;
    }
    setCreateStep(2);
  }

  async function handleCreate() {
    if (!createReady) return;
    setSaving(true);
    try {
      await createPackingOrder({
        company_id: effectiveCompanyId,
        process_order_id: selectedProcessOrder.id,
        po_type: packingPoType,
        material_id: selectedSku.id,
        pack_code_id: selectedSku.pack_code_row?.id,
        num_packs: Number(form.num_packs),
        fill_qty_per_pack: preview.bomRequired ? null : Number(form.fill_qty_per_pack),
        planned_qty_kg: preview.plannedKg,
      });
      toast("Packing PO created from ACTIVE Pack BOM.");
      setCreateOpen(false);
      resetCreate();
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (error) {
      toast(friendly(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!window.confirm("Finalize Packing PO? This posts SFG issue (P261), PM issue (P261), and FG receipt (P101).")) return;
    setSaving(true);
    try {
      await finalizePackingOrder(detailId, {});
      toast("Packing PO finalized: SFG/PM issues and FG receipt posted.");
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (error) {
      toast(friendly(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReverse() {
    if (!window.confirm("Reverse Packing PO? This posts reversals for SFG, PM and FG movements.")) return;
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

  function openCorrection() {
    setCorrectionDraft((order?.lines ?? []).map((line) => ({
      id: line.id,
      label: `${line.line_type} - ${materialLabel(line.material)}`,
      current_qty: line.actual_qty ?? line.total_qty ?? 0,
      actual_qty: String(line.actual_qty ?? line.total_qty ?? ""),
    })));
    setCorrectOpen(true);
  }

  async function handleCorrection() {
    setSaving(true);
    try {
      await correctPackingOrder(detailId, {
        lines: correctionDraft.map((line) => ({ id: line.id, actual_qty: Number(line.actual_qty) })),
      });
      toast("Packing PO correction posted.");
      setCorrectOpen(false);
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
      title="Packing Orders - PR19"
      subtitle="Pack-BOM-driven Packing PO create, final posting, correction and reversal"
      actions={[{ label: "New Packing Order", tone: "primary", mnemonic: "N", onClick: () => { resetCreate(); setCreateOpen(true); } }]}
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

      <ErpSectionCard title={`Packing Orders${orders.length ? ` (${orders.length})` : ""}`}>
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
                  <th className="text-left py-2 px-3 border-b">Process PO</th>
                  <th className="text-left py-2 px-3 border-b">FG SKU</th>
                  <th className="text-right py-2 px-3 border-b">Planned KG</th>
                  <th className="text-left py-2 px-3 border-b">Status</th>
                  <th className="text-left py-2 px-3 border-b">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-sky-50">
                    <td className="py-2 px-3 font-mono font-semibold text-sky-700 cursor-pointer" onClick={() => setDetailId(row.id)}>{row.po_number}</td>
                    <td className="py-2 px-3">{row.process_order?.po_number ?? "-"}</td>
                    <td className="py-2 px-3">{materialLabel(row.material)}</td>
                    <td className="py-2 px-3 text-right font-mono">{qty(row.planned_qty_kg)}</td>
                    <td className="py-2 px-3"><StatusBadge status={row.status} /></td>
                    <td className="py-2 px-3">
                      <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => navigate("/dashboard/production/fg-stock-breakdown")}>
                        View Stock Breakdown
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>

      <DrawerBase visible={createOpen} title="New Packing Order" onClose={() => setCreateOpen(false)} width="xl">
        <div className="p-4 space-y-4">
          {createStep === 1 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={effectiveCompanyId}
                  onChange={(value) => setForm((current) => ({ ...current, company_id: value, process_order_id: "", material_id: "" }))}
                  label="Company"
                />
                <label className="text-xs text-slate-500">
                  Process PO *
                  <ErpComboboxField
                    value={form.process_order_id}
                    onChange={(value) => setForm((current) => ({ ...current, process_order_id: value, material_id: "" }))}
                    options={(processOrdersQ.data ?? []).map((po) => ({ value: po.id, label: processOrderLabel(po) }))}
                    placeholder={processOrdersQ.isFetching ? "Loading Process POs..." : "-- Select VERIFIED Process PO --"}
                  />
                </label>
                <div className="text-sm">
                  <p className="text-xs text-slate-400">Packing PO Type</p>
                  <p className="font-semibold">{processPoType ? `${processPoType} -> ${packingPoType}` : "-"}</p>
                </div>
                <label className="text-xs text-slate-500">
                  FG SKU *
                  <ErpComboboxField
                    value={form.material_id}
                    onChange={(value) => setForm((current) => ({ ...current, material_id: value }))}
                    options={(eligibleSkuQ.data ?? []).map((sku) => ({ value: sku.id, label: materialLabel(sku) }))}
                    placeholder={eligibleSkuQ.isFetching ? "Loading eligible FG SKUs..." : "-- Select FG SKU --"}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Number of Packs *
                  <input className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm font-mono" type="number" min="1" step="1" value={form.num_packs} onChange={(event) => setForm((current) => ({ ...current, num_packs: event.target.value }))} />
                </label>
                {!preview.bomRequired ? (
                  <label className="text-xs text-slate-500">
                    Fill Qty Per Pack *
                    <input className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm font-mono" type="number" min="0.001" step="0.001" value={form.fill_qty_per_pack} onChange={(event) => setForm((current) => ({ ...current, fill_qty_per_pack: event.target.value }))} />
                  </label>
                ) : (
                  <div className="text-sm">
                    <p className="text-xs text-slate-400">Fill Qty</p>
                    <p className="font-semibold">From ACTIVE Pack BOM</p>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <button type="button" className="px-4 py-2 bg-sky-600 text-white rounded text-sm" onClick={nextCreateStep}>Next</button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                <div><p className="text-xs text-slate-400">Company</p><p className="font-semibold">{companyLabel(activeBomQ.data?.company)}</p></div>
                <div><p className="text-xs text-slate-400">Process PO</p><p className="font-semibold">{selectedProcessOrder?.po_number}</p></div>
                <div><p className="text-xs text-slate-400">FG SKU</p><p className="font-semibold">{materialLabel(selectedSku)}</p></div>
                <div><p className="text-xs text-slate-400">Planned KG</p><p className="font-mono font-semibold">{qty(preview.plannedKg)}</p></div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[800px]">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2 px-3 border-b">Type</th>
                      <th className="text-left py-2 px-3 border-b">Material</th>
                      <th className="text-left py-2 px-3 border-b">Storage Location</th>
                      <th className="text-right py-2 px-3 border-b">Qty KG</th>
                      <th className="text-left py-2 px-3 border-b">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((line, index) => (
                      <tr key={`${line.id}-${index}`} className="border-b border-slate-100">
                        <td className="py-2 px-3 font-semibold">{line.line_type}</td>
                        <td className="py-2 px-3">{materialLabel(line.material)}</td>
                        <td className="py-2 px-3">{slocLabel(line.storage_location)}</td>
                        <td className="py-2 px-3 text-right font-mono">{qty(line.preview_qty)}</td>
                        <td className="py-2 px-3 font-mono">{line.line_type === "FG" ? "P101" : "P261"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between">
                <button type="button" className="px-4 py-2 border rounded text-sm" onClick={() => setCreateStep(1)}>Back</button>
                <button type="button" className="px-5 py-2 bg-sky-600 text-white rounded text-sm disabled:opacity-50" disabled={saving || !createReady} onClick={handleCreate}>
                  {saving ? "Creating..." : "Create Packing PO"}
                </button>
              </div>
            </>
          )}
        </div>
      </DrawerBase>

      <DrawerBase visible={Boolean(detailId)} title={order ? `Packing Order ${order.po_number}` : "Packing Order"} onClose={() => setDetailId(null)} width="xl">
        {detailQ.isFetching ? (
          <div className="p-4 text-sm text-slate-400">Loading...</div>
        ) : order ? (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">PO Number</p><p className="font-mono font-semibold text-sky-700">{order.po_number}</p></div>
              <div><p className="text-xs text-slate-400">Status</p><StatusBadge status={order.status} /></div>
              <div><p className="text-xs text-slate-400">Process PO</p><p>{order.process_order?.po_number ?? "-"}</p></div>
              <div><p className="text-xs text-slate-400">Batch</p><p className="font-mono">{order.process_order?.batch_number ?? "-"}</p></div>
              <div><p className="text-xs text-slate-400">FG SKU</p><p>{materialLabel(order.material)}</p></div>
              <div><p className="text-xs text-slate-400">Packs / Fill</p><p className="font-mono">{order.num_packs ?? "-"} / {order.fill_qty_per_pack ?? "-"}</p></div>
              <div><p className="text-xs text-slate-400">Planned KG</p><p className="font-mono">{qty(order.planned_qty_kg)}</p></div>
              <div><p className="text-xs text-slate-400">Actual KG</p><p className="font-mono">{order.actual_qty_kg == null ? "-" : qty(order.actual_qty_kg)}</p></div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[850px]">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left py-2 px-3 border-b">Type</th>
                    <th className="text-left py-2 px-3 border-b">Material</th>
                    <th className="text-left py-2 px-3 border-b">Storage Location</th>
                    <th className="text-left py-2 px-3 border-b">Batch</th>
                    <th className="text-right py-2 px-3 border-b">Total Qty</th>
                    <th className="text-right py-2 px-3 border-b">Actual Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.lines ?? []).map((line) => (
                    <tr key={line.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-semibold">{line.line_type}</td>
                      <td className="py-2 px-3">{materialLabel(line.material)}</td>
                      <td className="py-2 px-3">{slocLabel(line.storage_location)}</td>
                      <td className="py-2 px-3 font-mono">{line.batch_number ?? "-"}</td>
                      <td className="py-2 px-3 text-right font-mono">{qty(line.total_qty)}</td>
                      <td className="py-2 px-3 text-right font-mono">{line.actual_qty == null ? "-" : qty(line.actual_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {order.status === "STANDARD" ? (
                <button type="button" className="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50" disabled={saving} onClick={handleFinalize}>
                  Finalize & Post 3 Movements
                </button>
              ) : null}
              {order.status === "FINAL" ? (
                <button type="button" className="px-4 py-2 bg-sky-600 text-white rounded text-sm disabled:opacity-50" disabled={saving} onClick={openCorrection}>
                  Correct After Final
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

      <DrawerBase visible={correctOpen} title="COR6-style Packing PO Correction" onClose={() => setCorrectOpen(false)} width="lg">
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">Enter corrected final quantity per line. The backend posts only the delta as append-only stock movement.</p>
          {correctionDraft.map((line, index) => (
            <label key={line.id} className="grid grid-cols-[1fr_140px] gap-3 items-center text-sm">
              <span>
                <span className="block font-semibold">{line.label}</span>
                <span className="text-xs text-slate-400">Current: {qty(line.current_qty)}</span>
              </span>
              <input
                className="h-9 border border-slate-300 rounded px-2 text-right font-mono"
                type="number"
                min="0"
                step="0.001"
                value={line.actual_qty}
                onChange={(event) => setCorrectionDraft((draft) => draft.map((item, idx) => idx === index ? { ...item, actual_qty: event.target.value } : item))}
              />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" className="px-4 py-2 border rounded text-sm" onClick={() => setCorrectOpen(false)}>Cancel</button>
            <button type="button" className="px-4 py-2 bg-sky-600 text-white rounded text-sm disabled:opacity-50" disabled={saving} onClick={handleCorrection}>
              Save Correction
            </button>
          </div>
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
