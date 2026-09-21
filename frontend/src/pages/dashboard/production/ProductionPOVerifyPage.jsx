/*
 * File-ID: 27.FE-PR12
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Process PO verify screen for PR12.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import { useMenu } from "../../../context/useMenu.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { availabilityPreviewProcessOrder, correctProcessOrder, getProcessOrder, listProcessOrders, verifyProcessOrder } from "./prodApi.js";
import { formatPreciseNumber, formatSum, PRODUCTION_DECIMAL_STEP } from "./productionPrecision.js";

const APPROVED_OPTIONS = ["YES", "NO", "PARTIAL"].map((value) => ({ value, label: value }));
const RM_CORRECTION_MOVEMENT_OPTIONS = [
  { value: "P261", label: "P261 (increase)" },
  { value: "P262", label: "P262 (decrease)" },
];
const OUTPUT_CORRECTION_MOVEMENT_OPTIONS = [
  { value: "P101", label: "P101 (increase)" },
  { value: "P102", label: "P102 (decrease)" },
];

function orderLabel(order) {
  return [order.po_number, order.material?.material_name, order.po_type].filter(Boolean).join(" - ");
}

function materialLabel(material) {
  return [material?.pace_code, material?.material_name].filter(Boolean).join(" - ");
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

function storageLocationLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function validateVerifyPoStatus(status) {
  const upper = String(status || "").toUpperCase();
  return upper === "FINAL" || upper === "VERIFIED"
    ? ""
    : "This Process PO is not applicable here. Only `FINAL` (to verify) or `VERIFIED` (to correct) is allowed.";
}

function computeRowValues(row) {
  const planned = Number(row.planned_qty || 0);
  const actual = Number(row.actual_qty || 0);
  const autoYes = Math.abs(actual - planned) < 0.0001;
  const approved = autoYes ? "YES" : (row.approved_status || "YES");
  let apApproved = actual;
  let variance = 0;
  if (!autoYes) {
    if (approved === "NO") {
      apApproved = planned;
      variance = actual - planned;
    } else if (approved === "PARTIAL") {
      apApproved = Number(row.ap_approved_qty || 0);
      variance = actual - apApproved;
    } else {
      apApproved = actual;
    }
  }
  return { planned, actual, autoYes, approved, apApproved, variance };
}

function makeDraftRow(line) {
  return {
    key: line.id,
    id: line.id,
    material_id: line.material_id,
    material_label: materialLabel(line.material),
    dosage_pct: line.dosage_pct ?? "",
    registered_alternate_material_id: line.registered_alternate_material_id || "",
    registered_alternate_material_label: materialLabel(line.registered_alternate_material),
    allowed_alternate_material_options: buildActualMaterialOptions(line),
    actual_material_id: line.actual_material_id || "",
    issue_sloc_id: line.issue_sloc_id || line.issue_storage_location?.id || "",
    planned_qty: String(line.planned_qty ?? 0),
    actual_qty: String(line.actual_qty ?? line.planned_qty ?? 0),
    approved_status: line.approved_status || "YES",
    ap_approved_qty: String(line.ap_approved_qty ?? line.actual_qty ?? line.planned_qty ?? 0),
    variance_qty: String(line.variance_qty ?? 0),
    is_formulation_line: line.is_formulation_line !== false,
  };
}

const MTS_CHECKLIST = [
  ["PRODSHADE_DESCRIPTION", "Prodshade and Description"],
  ["STROKE", "Stroke"],
  ["MACHINE", "Machine"],
  ["DATE_SHIFT", "Date and Shift"],
  ["BATCH_SIZE_COUNT", "Batch Size and Number of Batches"],
  ["BATCH_RANGE", "From Batch to To Batch"],
  ["PLANNED_OUTPUT", "Total Planned Output"],
  ["STORAGE_LOCATION", "Storage Location"],
  ["PACKING_DECLARATION", "Packing Declaration"],
  ["GAIN_LOSS", "Gain / Loss Confirmation"],
];

function mtsBatchSort(left, right) {
  const leftMatch = String(left || "").match(/^(.*?)(\d+)$/);
  const rightMatch = String(right || "").match(/^(.*?)(\d+)$/);
  if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) return Number(leftMatch[2]) - Number(rightMatch[2]);
  return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true });
}

function MtsVerifyWorkspace({ po, saving, onApprove, onReject }) {
  const [step, setStep] = useState(2);
  const [checks, setChecks] = useState({});
  const [expandedPacking, setExpandedPacking] = useState(false);
  const [holdRows, setHoldRows] = useState([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const packingOrders = useMemo(() => po.packing_orders ?? [], [po.packing_orders]);
  const yields = useMemo(
    () => [...(po.mts_review?.batch_yield_variances ?? [])].sort((left, right) => mtsBatchSort(left.batch_number, right.batch_number)),
    [po.mts_review?.batch_yield_variances],
  );
  const batchOptions = useMemo(
    () => yields.map((row) => ({ value: row.batch_number, label: row.batch_number })),
    [yields],
  );
  const yieldsByPackingOrder = useMemo(() => {
    const map = new Map();
    for (const row of yields) map.set(row.packing_order_id, [...(map.get(row.packing_order_id) ?? []), row]);
    return map;
  }, [yields]);
  const packingById = useMemo(() => new Map(packingOrders.map((row) => [row.id, row])), [packingOrders]);
  const totalDeclaredOutput = yields.reduce((sum, row) => sum + Number(row.declared_actual_qty || 0), 0);
  const totalExpectedOutput = yields.reduce((sum, row) => sum + Number(row.expected_qty || 0), 0);
  const totalGainLoss = yields.reduce((sum, row) => sum + Number(row.variance_qty || 0), 0);
  const allChecksDone = MTS_CHECKLIST.every(([code]) => checks[code]);

  const summaryForHold = (hold) => {
    const fromIndex = yields.findIndex((item) => item.batch_number === hold.batch_number_from);
    const toIndex = yields.findIndex((item) => item.batch_number === hold.batch_number_to);
    if (fromIndex < 0 || toIndex < fromIndex) return [];
    const rows = yields.slice(fromIndex, toIndex + 1);
    const grouped = new Map();
    for (const row of rows) {
      const packing = packingById.get(row.packing_order_id);
      const fillQty = Number(packing?.fill_qty_per_pack || 0);
      if (!packing || fillQty <= 0) continue;
      const current = grouped.get(row.packing_order_id) ?? {
        packing_order_id: row.packing_order_id,
        label: `${packing.po_number || "Packing PO"} — ${materialLabel(row.sku_material) || materialLabel(packing.material) || "SKU"}`,
        declaredPacks: 0,
        declaredKg: 0,
      };
      current.declaredPacks += Number(row.declared_actual_qty || 0) / fillQty;
      current.declaredKg += Number(row.declared_actual_qty || 0);
      grouped.set(row.packing_order_id, current);
    }
    return [...grouped.values()];
  };

  const updateHold = (key, patch) => setHoldRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  const addHold = () => {
    const firstBatch = yields[0]?.batch_number || "";
    setHoldRows((current) => [...current, {
      key: `hold-${Date.now()}-${current.length}`,
      batch_number_from: firstBatch,
      batch_number_to: firstBatch,
      target_stock_type: "QUALITY_INSPECTION",
      selections: {},
    }]);
  };
  const toggleHoldLine = (holdKey, packingOrderId, full) => {
    setHoldRows((current) => current.map((row) => {
      if (row.key !== holdKey) return row;
      return {
        ...row,
        selections: {
          ...row.selections,
          [packingOrderId]: { ...(row.selections?.[packingOrderId] ?? {}), full, qty_packs: full ? "" : (row.selections?.[packingOrderId]?.qty_packs ?? "") },
        },
      };
    }));
  };
  const changeHoldQty = (holdKey, packingOrderId, qtyPacks) => setHoldRows((current) => current.map((row) => {
    if (row.key !== holdKey) return row;
    return { ...row, selections: { ...row.selections, [packingOrderId]: { ...(row.selections?.[packingOrderId] ?? {}), full: false, qty_packs: qtyPacks } } };
  }));
  const holdPayload = () => holdRows.flatMap((hold) => summaryForHold(hold).flatMap((summary) => {
    const selection = hold.selections?.[summary.packing_order_id] ?? { full: true };
    const qtyPacks = selection.full !== false ? summary.declaredPacks : Number(selection.qty_packs || 0);
    if (!Number.isFinite(qtyPacks) || qtyPacks <= 0) return [];
    return [{
      packing_order_id: summary.packing_order_id,
      batch_number_from: hold.batch_number_from,
      batch_number_to: hold.batch_number_to,
      target_stock_type: hold.target_stock_type,
      qty_packs: qtyPacks,
    }];
  }));
  const beginReject = () => setRejectOpen(true);
  const submitReject = () => {
    if (!rejectReason.trim()) return;
    onReject(rejectReason.trim());
  };

  if (po.status !== "FINAL") {
    return <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This MTS Process PO is not pending Verify. MTS documents cannot be edited or corrected from this page.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MTS QA Verify</p>
          <p className="mt-1 text-sm text-slate-600">Verify the MTS parent Process PO only. Linked Packing POs are displayed here and cannot be verified separately.</p>
        </div>
        <div className="flex gap-2 text-xs font-semibold uppercase tracking-wide">
          {[2, 3, 4].map((number) => <span key={number} className={`rounded px-2.5 py-1 ${step === number ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-500"}`}>Page {number}</span>)}
        </div>
      </div>

      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="border-b px-3 py-2 text-left">Process PO Number</th><th className="border-b px-3 py-2 text-left">Company</th><th className="border-b px-3 py-2 text-left">PO Type</th><th className="border-b px-3 py-2 text-left">Segment</th></tr></thead>
              <tbody><tr className="border-b border-slate-100"><td className="px-3 py-2 font-mono font-semibold text-sky-700">{po.po_number}</td><td className="px-3 py-2">{po.company?.company_name || po.company_name || "Selected company"}</td><td className="px-3 py-2">{po.po_type}</td><td className="px-3 py-2">{po.segment_code || "--"}</td></tr></tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="w-12 border-b px-3 py-2 text-center">Check</th><th className="border-b px-3 py-2 text-left">QA Checklist</th><th className="border-b px-3 py-2 text-left">Declared value</th></tr></thead>
              <tbody>
                {MTS_CHECKLIST.map(([code, label]) => {
                  let value = "";
                  if (code === "PRODSHADE_DESCRIPTION") value = `${materialLabel(po.material) || "--"} — ${po.material?.material_name || ""}`;
                  if (code === "STROKE") value = po.stroke?.stroke_number ? `Stroke ${po.stroke.stroke_number}` : "--";
                  if (code === "MACHINE") value = po.machine?.machine_name || po.machine?.machine_code || "--";
                  if (code === "DATE_SHIFT") value = `${po.production_date || "--"} / ${po.shift?.shift_name || "--"}`;
                  if (code === "BATCH_SIZE_COUNT") value = `${formatSum(po.planned_qty, "0")} KG / ${po.number_of_batches || 0} batches`;
                  if (code === "BATCH_RANGE") value = `${po.batch_number_from || "--"} to ${po.batch_number_to || "--"}`;
                  if (code === "PLANNED_OUTPUT") value = `${formatSum(totalExpectedOutput, "0")} KG planned; ${formatSum(totalDeclaredOutput, "0")} KG declared`;
                  if (code === "STORAGE_LOCATION") value = [...new Set(packingOrders.flatMap((order) => (order.lines ?? []).filter((line) => line.line_type === "FG").map((line) => storageLocationLabel(line.issue_storage_location) || "Configured output location")))].join("; ") || "Configured output location";
                  if (code === "PACKING_DECLARATION") value = `${packingOrders.length} linked Packing PO row(s) — expand below to inspect`;
                  if (code === "GAIN_LOSS") value = `${totalGainLoss > 0 ? "Gain" : totalGainLoss < 0 ? "Loss" : "No variance"}: ${formatSum(totalGainLoss, "0")} KG`;
                  return <tr key={code} className="border-b border-slate-100"><td className="px-3 py-2 text-center"><input type="checkbox" checked={Boolean(checks[code])} onChange={(event) => setChecks((current) => ({ ...current, [code]: event.target.checked }))} aria-label={`Confirm ${label}`} /></td><td className="px-3 py-2 font-medium">{label}</td><td className="px-3 py-2">{value}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-slate-200">
            <button type="button" onClick={() => setExpandedPacking((current) => !current)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"><span>Packing Declaration — Page 5 data</span><span>{expandedPacking ? "Collapse" : "Expand"}</span></button>
            {expandedPacking ? <div className="overflow-x-auto border-t border-slate-200"><table className="w-full min-w-[760px] border-collapse text-sm"><thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="border-b px-3 py-2 text-left">Packing PO</th><th className="border-b px-3 py-2 text-left">Batch Range</th><th className="border-b px-3 py-2 text-left">SKU</th><th className="border-b px-3 py-2 text-right">Fill / Bag</th><th className="border-b px-3 py-2 text-right">Declared Bags</th><th className="border-b px-3 py-2 text-right">Declared KG</th><th className="border-b px-3 py-2 text-right">Gain / Loss</th></tr></thead><tbody>{packingOrders.map((order) => { const orderYields = yieldsByPackingOrder.get(order.id) ?? []; const totalPacks = orderYields.reduce((sum, row) => sum + Number(row.declared_actual_qty || 0) / Number(order.fill_qty_per_pack || 1), 0); const totalKg = orderYields.reduce((sum, row) => sum + Number(row.declared_actual_qty || 0), 0); const variance = orderYields.reduce((sum, row) => sum + Number(row.variance_qty || 0), 0); return <tr key={order.id} className="border-b border-slate-100"><td className="px-3 py-2 font-mono">{order.po_number}</td><td className="px-3 py-2">{order.batch_number_from} to {order.batch_number_to}</td><td className="px-3 py-2">{materialLabel((order.lines ?? []).find((line) => line.line_type === "FG")?.material) || materialLabel(order.material) || "--"}</td><td className="px-3 py-2 text-right font-mono">{formatSum(order.fill_qty_per_pack, "0")}</td><td className="px-3 py-2 text-right font-mono">{formatSum(totalPacks, "0")}</td><td className="px-3 py-2 text-right font-mono">{formatSum(totalKg, "0")}</td><td className="px-3 py-2 text-right font-mono">{formatSum(variance, "0")}</td></tr>; })}</tbody></table></div> : null}
          </div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-3"><button type="button" onClick={beginReject} className="rounded border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">Reject & Release</button><button type="button" disabled={!allChecksDone} onClick={() => setStep(3)} className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">Next: QA Stock Hold</button></div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-800">Optional QA stock hold</h3><p className="mt-1 text-sm text-slate-600">Leave this section empty to post every declared SKU quantity as unrestricted. A hold never creates batch-wise stock; it records the selected batch allocation for QA audit only.</p></div><button type="button" onClick={addHold} className="rounded border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50">+ Add hold range</button></div>
          {holdRows.length === 0 ? <div className="rounded border border-dashed border-slate-300 px-3 py-5 text-sm text-slate-500">No QA stock hold selected. All SKU output will remain unrestricted.</div> : null}
          {holdRows.map((hold, index) => { const summary = summaryForHold(hold); return <div key={hold.key} className="rounded border border-slate-200"><div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-3 md:grid-cols-4"><div className="flex flex-col gap-1"><label className="text-xs font-medium text-slate-600">From Batch</label><ErpComboboxField value={hold.batch_number_from} onChange={(value) => updateHold(hold.key, { batch_number_from: value, batch_number_to: value })} options={batchOptions} hideBlank /></div><div className="flex flex-col gap-1"><label className="text-xs font-medium text-slate-600">To Batch</label><ErpComboboxField value={hold.batch_number_to} onChange={(value) => updateHold(hold.key, { batch_number_to: value })} options={batchOptions} hideBlank /></div><div className="flex flex-col gap-1"><label className="text-xs font-medium text-slate-600">Target stock status</label><ErpComboboxField value={hold.target_stock_type} onChange={(value) => updateHold(hold.key, { target_stock_type: value })} options={[{ value: "QUALITY_INSPECTION", label: "Quality Inspection" }, { value: "BLOCKED", label: "Blocked" }]} hideBlank /></div><div className="flex items-end justify-end"><button type="button" onClick={() => setHoldRows((current) => current.filter((row) => row.key !== hold.key))} className="px-2 py-1.5 text-sm font-medium text-rose-600 hover:underline">Remove</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] border-collapse text-sm"><thead><tr className="bg-white text-xs uppercase tracking-wide text-slate-500"><th className="border-b px-3 py-2 text-left">{`SKU / Packing PO (row ${index + 1})`}</th><th className="border-b px-3 py-2 text-right">Declared Bags</th><th className="border-b px-3 py-2 text-right">Declared KG</th><th className="border-b px-3 py-2 text-center">Full qty</th><th className="border-b px-3 py-2 text-right">Hold bags</th></tr></thead><tbody>{summary.map((line) => { const selected = hold.selections?.[line.packing_order_id] ?? { full: true }; return <tr key={line.packing_order_id} className="border-b border-slate-100"><td className="px-3 py-2">{line.label}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.declaredPacks, "0")}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.declaredKg, "0")}</td><td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.full !== false} onChange={(event) => toggleHoldLine(hold.key, line.packing_order_id, event.target.checked)} aria-label={`Hold full declared quantity for ${line.label}`} /></td><td className="px-3 py-2 text-right">{selected.full !== false ? <span className="font-mono text-slate-500">{formatSum(line.declaredPacks, "0")}</span> : <input type="number" min="0" max={line.declaredPacks} step="0.0001" value={selected.qty_packs ?? ""} onChange={(event) => changeHoldQty(hold.key, line.packing_order_id, event.target.value)} className="w-28 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm" />}</td></tr>; })}{summary.length === 0 ? <tr><td colSpan="5" className="px-3 py-3 text-slate-500">Select a valid batch range.</td></tr> : null}</tbody></table></div></div>; })}
          <div className="flex justify-between border-t border-slate-200 pt-3"><button type="button" onClick={() => setStep(2)} className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</button><button type="button" onClick={() => setStep(4)} className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800">Next: Final Review</button></div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-5">
          <div><h3 className="mb-2 text-sm font-semibold text-slate-800">RM Material Table — Page 4</h3><div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="border-b px-3 py-2 text-left">Material</th><th className="border-b px-3 py-2 text-right">Dosage %</th><th className="border-b px-3 py-2 text-left">Actual material</th><th className="border-b px-3 py-2 text-left">Issue location</th><th className="border-b px-3 py-2 text-right">Standard KG</th><th className="border-b px-3 py-2 text-right">Actual KG</th><th className="border-b px-3 py-2 text-left">Movement</th></tr></thead><tbody>{(po.lines ?? []).map((line) => <tr key={line.id} className="border-b border-slate-100"><td className="px-3 py-2">{materialLabel(line.material) || "--"}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.dosage_pct, "0")}</td><td className="px-3 py-2">{materialLabel(line.actual_material) || materialLabel(line.material) || "--"}</td><td className="px-3 py-2">{storageLocationLabel(line.issue_storage_location) || "--"}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.planned_qty, "0")}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.actual_qty, "0")}</td><td className="px-3 py-2 font-mono">P261</td></tr>)}</tbody></table></div></div>
          <div><h3 className="mb-2 text-sm font-semibold text-slate-800">PM Material Table — Page 6</h3><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-sm"><thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="border-b px-3 py-2 text-left">Packing PO</th><th className="border-b px-3 py-2 text-left">SKU</th><th className="border-b px-3 py-2 text-left">PM Material</th><th className="border-b px-3 py-2 text-left">Issue location</th><th className="border-b px-3 py-2 text-right">Qty / Bag</th><th className="border-b px-3 py-2 text-right">Planned KG</th><th className="border-b px-3 py-2 text-left">Movement</th></tr></thead><tbody>{packingOrders.flatMap((order) => (order.lines ?? []).filter((line) => line.line_type === "PM").map((line) => <tr key={line.id} className="border-b border-slate-100"><td className="px-3 py-2 font-mono">{order.po_number}</td><td className="px-3 py-2">{materialLabel((order.lines ?? []).find((entry) => entry.line_type === "FG")?.material) || "--"}</td><td className="px-3 py-2">{materialLabel(line.actual_material) || materialLabel(line.material) || "--"}</td><td className="px-3 py-2">{storageLocationLabel(line.issue_storage_location) || "--"}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.qty_per_pack, "0")}</td><td className="px-3 py-2 text-right font-mono">{formatSum(line.total_qty, "0")}</td><td className="px-3 py-2 font-mono">P261</td></tr>))}</tbody></table></div></div>
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Declared SKU output: <span className="font-mono font-semibold">{formatSum(totalDeclaredOutput, "0")} KG</span>. Gain / Loss: <span className="font-mono font-semibold">{formatSum(totalGainLoss, "0")} KG</span>. {holdPayload().length > 0 ? `${holdPayload().length} QA stock allocation line(s) will be posted.` : "No QA stock hold: all SKU output remains unrestricted."}</div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-3"><div className="flex gap-2"><button type="button" onClick={() => setStep(3)} className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</button><button type="button" onClick={beginReject} disabled={saving} className="rounded border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject & Release</button></div><button type="button" onClick={() => onApprove(MTS_CHECKLIST.map(([code]) => code), holdPayload())} disabled={saving} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "Posting..." : "Approve & Post"}</button></div>
        </div>
      ) : null}

      {rejectOpen ? <div className="rounded border border-rose-300 bg-rose-50 p-3"><label className="block text-sm font-semibold text-rose-800">Rejection reason</label><textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows="3" className="mt-2 w-full rounded border border-rose-200 bg-white px-2 py-1.5 text-sm" placeholder="Explain why this MTS Process PO is being rejected." /><div className="mt-3 flex gap-2"><button type="button" onClick={() => setRejectOpen(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700">Cancel</button><button type="button" onClick={submitReject} disabled={!rejectReason.trim() || saving} className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Releasing..." : "Confirm Reject & Release"}</button></div></div> : null}
    </div>
  );
}

export default function ProductionPOVerifyPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [activeOrderId, setActiveOrderId] = useState("");
  const [poNumberInput, setPoNumberInput] = useState("");
  const [submittedPoNumber, setSubmittedPoNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [debouncedPreviewRows, setDebouncedPreviewRows] = useState([]);

  // COR6-style post-Verify correction (Locked 2026-08-12, corrected same day — business
  // owner overrode the original sign-decides-direction design) — triggered when the
  // loaded Process PO is already VERIFIED. Separate from `rows`/makeDraftRow (which
  // drive the one-time Verify posting itself): the caller enters a positive QUANTITY
  // per line plus picks the movement type (P261/P262, or P101/P102 for the output)
  // from a dropdown themselves — the backend never infers direction from a sign.
  const [correctionQty, setCorrectionQty] = useState({});
  const [correctionMovementType, setCorrectionMovementType] = useState({});
  const [correctionApproved, setCorrectionApproved] = useState({});
  const [correctionApApproved, setCorrectionApApproved] = useState({});
  const [correctionNewRows, setCorrectionNewRows] = useState([]);
  const [outputDeltaQty, setOutputDeltaQty] = useState("");
  const [outputMovementType, setOutputMovementType] = useState("P101");

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const ordersQ = useQuery({
    queryKey: ["production-verify-orders", effectiveCompanyId],
    queryFn: () => listProcessOrders({ company_id: effectiveCompanyId || undefined, status: "FINAL", per_page: 100 }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: orderLabel(order) || order.po_number || "Process PO" })),
    [ordersQ.data],
  );

  const lookupQ = useQuery({
    queryKey: ["production-verify-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const result = await listProcessOrders({ po_number: submittedPoNumber, per_page: 10 });
      const options = Array.isArray(result) ? result : result?.data ?? [];
      const match = options.find((order) => String(order.po_number || "").toUpperCase() === submittedPoNumber.toUpperCase()) ?? null;
      if (!match?.id) return { match: null, blockedMessage: "Process PO not found." };
      const blockedMessage = validateVerifyPoStatus(match.status);
      return { match, blockedMessage };
    },
  });

  const detailQ = useQuery({
    queryKey: ["production-verify-detail", activeOrderId],
    queryFn: () => getProcessOrder(activeOrderId),
    enabled: Boolean(activeOrderId),
  });

  const materialQ = useMaterialOptionsQuery({ status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT });
  const materialOptions = useMemo(
    () => (materialQ.materials ?? []).map((material) => ({ value: material.id, label: materialLabel(material) || "Material" })),
    [materialQ.materials],
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

  const po = detailQ.data ?? null;
  const lookupMessage = useMemo(() => {
    if (lookupQ.error) return lookupQ.error.message || "Process PO lookup failed.";
    if (!submittedPoNumber || lookupQ.isFetching) return "";
    return lookupQ.data?.blockedMessage || "";
  }, [lookupQ.data?.blockedMessage, lookupQ.error, lookupQ.isFetching, submittedPoNumber]);

  useEffect(() => {
    const match = lookupQ.data?.match ?? null;
    if (!match?.id) return;
    setCompanyId(String(match.company_id || ""));
    setSelectedOrderId(lookupQ.data?.blockedMessage ? "" : match.id);
    setActiveOrderId(lookupQ.data?.blockedMessage ? "" : match.id);
  }, [lookupQ.data]);

  useEffect(() => {
    setRows((po?.lines ?? []).map(makeDraftRow));
  }, [po]);
  useEffect(() => {
    setCorrectionQty({});
    setCorrectionMovementType({});
    setCorrectionApproved({});
    setCorrectionApApproved({});
    setCorrectionNewRows([]);
    setOutputDeltaQty("");
    setOutputMovementType("P101");
  }, [po?.id, po?.status]);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedPreviewRows(rows.map((row) => ({
        line_id: row.id || undefined,
        material_id: row.actual_material_id || row.material_id,
        storage_location_id: row.issue_sloc_id || undefined,
        qty: Number(row.actual_qty || 0),
      })));
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [rows]);

  const availabilityPreviewQ = useQuery({
    queryKey: ["production-verify-availability-preview", effectiveCompanyId, activeOrderId, debouncedPreviewRows],
    queryFn: () => availabilityPreviewProcessOrder({
      company_id: effectiveCompanyId,
      process_order_id: activeOrderId,
      overrides: debouncedPreviewRows,
    }),
    enabled: Boolean(effectiveCompanyId && activeOrderId),
  });
  const availabilityByKey = useMemo(
    () => new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [availabilityPreviewQ.data],
  );

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  function resetSelection(nextCompanyId = "") {
    setCompanyId(nextCompanyId);
    setSelectedOrderId("");
    setActiveOrderId("");
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setRows([]);
  }

  function handleLookupSubmit(event) {
    event.preventDefault();
    const nextPoNumber = String(poNumberInput || "").trim().toUpperCase();
    setSelectedOrderId("");
    setActiveOrderId("");
    setRows([]);
    if (nextPoNumber && nextPoNumber === submittedPoNumber) {
      lookupQ.refetch();
      return;
    }
    setSubmittedPoNumber(nextPoNumber);
  }

  function handleLoadSelected() {
    if (!selectedOrderId) return;
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setActiveOrderId(selectedOrderId);
  }

  function updateRow(key, patch) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows((current) => [...current, {
      key: `new-${Date.now()}`,
      id: "",
      material_id: "",
      material_label: "",
      dosage_pct: "",
      registered_alternate_material_id: "",
      registered_alternate_material_label: "",
      actual_material_id: "",
      issue_sloc_id: "",
      planned_qty: "0",
      actual_qty: "0",
      approved_status: "YES",
      ap_approved_qty: "0",
      variance_qty: "0",
      is_formulation_line: false,
    }]);
  }

  async function handleSave() {
    if (!po || po.status !== "FINAL") return;
    setSaving(true);
    try {
      const payloadLines = rows.map((row) => {
        const values = computeRowValues(row);
        return {
          id: row.id || undefined,
          material_id: row.id ? undefined : row.material_id || undefined,
          dosage_pct: row.dosage_pct === "" ? undefined : Number(row.dosage_pct),
          actual_material_id: row.actual_material_id || undefined,
          storage_location_id: row.issue_sloc_id || undefined,
          actual_qty: values.actual,
          approved_status: values.autoYes ? undefined : row.approved_status,
          ap_approved_qty: values.autoYes ? undefined : (row.approved_status === "PARTIAL" ? Number(row.ap_approved_qty || 0) : undefined),
          is_rm: true,
        };
      });
      // A plain JS .reduce() sum carries its own IEEE-754 residue even when every
      // addend is clean (2070 becomes 2069.9999999999995) -- this is the actual
      // posted value, not just a display number, so round it here (6dp, same
      // ceiling PRODUCTION_DECIMAL_STEP/formatSum already use) rather than relying
      // on formatSum, which only ever touches what's rendered, never what's sent.
      const verifiedQty = Number(rows.reduce((sum, row) => sum + computeRowValues(row).actual, 0).toFixed(6));
      await verifyProcessOrder(po.id, {
        verified_qty: verifiedQty,
        lines: payloadLines,
      });
      toast("Process PO verified and stock posted.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-detail", po.id] });
    } catch (error) {
      toast(error.message || "Verify failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleMtsApprove(checklist, holds) {
    if (!po || po.po_type !== "MTS" || po.status !== "FINAL") return;
    const confirmed = await openActionConfirm({
      eyebrow: "MTS QA Verify",
      title: "Approve and post MTS stock?",
      message: "RM and PM will be issued, declared SKU output will be posted, and selected QA holds will be transferred in one atomic transaction.",
      confirmLabel: "Approve & Post",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await verifyProcessOrder(po.id, { mts_action: "APPROVE", checklist, holds });
      toast("MTS Process PO verified and stock posted.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-detail", po.id] });
      detailQ.refetch();
    } catch (error) {
      toast(error.message || "MTS Verify failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleMtsReject(reason) {
    if (!po || po.po_type !== "MTS" || po.status !== "FINAL") return;
    const confirmed = await openActionConfirm({
      eyebrow: "MTS QA Verify",
      title: "Reject and release this MTS Process PO?",
      message: "The MTS Process PO and linked Packing POs will be cancelled. Open reservations and the claimed batch series will be released for reuse.",
      confirmLabel: "Reject & Release",
      tone: "danger",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await verifyProcessOrder(po.id, { mts_action: "REJECT", reason });
      toast("MTS Process PO rejected. Linked documents, reservations, and batch claims were released.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-detail", po.id] });
      detailQ.refetch();
    } catch (error) {
      toast(error.message || "MTS rejection failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  function addCorrectionRow() {
    setCorrectionNewRows((current) => [...current, {
      key: `cor-new-${Date.now()}-${current.length}`,
      material_id: "", issue_sloc_id: "", delta_qty: "",
    }]);
  }

  function updateCorrectionRow(key, patch) {
    setCorrectionNewRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeCorrectionRow(key) {
    setCorrectionNewRows((current) => current.filter((row) => row.key !== key));
  }

  async function handleCorrect() {
    if (!po || po.status !== "VERIFIED") return;
    // Locked 2026-08-12, corrected same day (business owner override): caller enters a
    // positive QUANTITY and picks the movement type themselves — the backend never
    // infers direction from a sign. Mirrors correctPackingOrderHandler's PR11 UI.
    const existingLines = (po.lines ?? [])
      .filter((line) => correctionQty[line.id] !== undefined && correctionQty[line.id] !== "" && Number(correctionQty[line.id]) > 0)
      .map((line) => {
        const approvedStatus = correctionApproved[line.id] || "YES";
        const payload = {
          id: line.id,
          delta_qty: Number(correctionQty[line.id]),
          movement_type: correctionMovementType[line.id] || "P261",
          approved_status: approvedStatus,
        };
        if (approvedStatus === "PARTIAL") payload.ap_approved_qty = Number(correctionApApproved[line.id] || 0);
        return payload;
      });
    const newLines = correctionNewRows
      .filter((row) => row.material_id && row.issue_sloc_id && Number(row.delta_qty) > 0)
      .map((row) => ({
        material_id: row.material_id,
        storage_location_id: row.issue_sloc_id,
        delta_qty: Number(row.delta_qty),
        movement_type: "P261",
      }));
    const lines = [...existingLines, ...newLines];
    const outputQty = outputDeltaQty === "" ? 0 : Number(outputDeltaQty);
    const hasOutputDelta = Number.isFinite(outputQty) && outputQty > 0;
    if (lines.length === 0 && !hasOutputDelta) {
      toast("Enter a qty + movement type for at least one line, add a missed item, or enter an output correction.", "error");
      return;
    }
    const confirmed = await openActionConfirm({
      eyebrow: "Process PO",
      title: "Post correction?",
      message: "This will post a stock movement for each changed/added line and/or the output, using the movement type you selected.",
      confirmLabel: "Post Correction",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const body = { lines };
      if (hasOutputDelta) {
        body.output_delta_qty = outputQty;
        body.output_movement_type = outputMovementType;
      }
      await correctProcessOrder(po.id, body);
      toast("Correction posted.");
      setCorrectionQty({});
      setCorrectionMovementType({});
      setCorrectionApproved({});
      setCorrectionApApproved({});
      setCorrectionNewRows([]);
      setOutputDeltaQty("");
      setOutputMovementType("P101");
      qc.invalidateQueries({ queryKey: ["production-verify-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-detail", po.id] });
      detailQ.refetch();
    } catch (error) {
      toast(error.message || "Correction failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const isCorrectionMode = po?.status === "VERIFIED";
  const outputApprovedQty = rows.reduce((sum, row) => sum + computeRowValues(row).apApproved, 0);
  const outputActualQty = rows.reduce((sum, row) => sum + computeRowValues(row).actual, 0);
  const outputVariance = outputActualQty - outputApprovedQty;

  return (
    <ErpScreenScaffold
      title="Production PO Verify - PR12"
      subtitle="QA verification and stock posting"
    >
      <ErpSectionCard title="Select Process PO">
        <div className="flex flex-col gap-4">
          <form onSubmit={handleLookupSubmit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">PO Number</label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={poNumberInput}
                onChange={(event) => setPoNumberInput(event.target.value)}
                placeholder="Paste or enter Process PO number, then press Enter"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="submit"
                disabled={lookupQ.isFetching || !String(poNumberInput || "").trim()}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {lookupQ.isFetching ? "Loading..." : "Search"}
              </button>
            </div>
          </form>

          {lookupMessage ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {lookupMessage}
            </div>
          ) : null}

          {detailQ.isFetching && activeOrderId ? (
            <p className="text-sm text-slate-500">Loading Process PO details...</p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={(value) => resetSelection(value)}
                label="Company"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Process PO</label>
              <ErpComboboxField
                value={selectedOrderId}
                onChange={setSelectedOrderId}
                options={orderOptions}
                placeholder="-- Select process PO --"
                emptyStateLabel={ordersQ.isLoading ? "Loading process orders..." : "No FINAL process POs"}
                disabled={!effectiveCompanyId}
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={handleLoadSelected}
                disabled={!selectedOrderId || detailQ.isFetching}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {detailQ.isFetching && activeOrderId === selectedOrderId ? "Loading..." : "Load"}
              </button>
            </div>
          </div>
        </div>
      </ErpSectionCard>

      {po && (
        <ErpSectionCard title={po.po_type === "MTS" ? "MTS QA Verify" : (isCorrectionMode ? "PR12 Correction Mode" : "PR12 Verify")}>
          {po.po_type === "MTS" ? (
            <MtsVerifyWorkspace key={po.id} po={po} saving={saving} onApprove={handleMtsApprove} onReject={handleMtsReject} />
          ) : po.status !== "FINAL" && po.status !== "VERIFIED" ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This Process PO is blocked here. Only `FINAL` (to verify) or `VERIFIED` (to correct) is allowed.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="grid flex-1 gap-3 md:grid-cols-3 text-sm">
                  <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Batch #</span><p className="font-mono">{po.batch_number || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Status</span><p>{po.status || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Machine</span><p>{po.machine?.machine_name || po.machine?.machine_code || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Stroke #</span><p>{po.stroke?.stroke_number || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Prodshade</span><p>{materialLabel(po.material) || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Description</span><p>{po.stroke?.description || po.material?.material_name || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Type</span><p>{po.po_type || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Std Size</span><p className="font-mono">{Number(po.planned_qty || 0).toLocaleString()}</p></div>
                </div>
                <button
                  onClick={isCorrectionMode ? handleCorrect : handleSave}
                  disabled={saving}
                  className={isCorrectionMode
                    ? "rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                    : "rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"}
                >
                  {saving ? "Posting..." : (isCorrectionMode ? "Post Correction" : "Save & Post Stock")}
                </button>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Input</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                        <th className="border-b px-3 py-2 text-right">Dosage%</th>
                        <th className="border-b px-3 py-2 text-left">Actual Material</th>
                        <th className="border-b px-3 py-2 text-left">SLoc</th>
                        <th className="border-b px-3 py-2 text-right">Std</th>
                        <th className="border-b px-3 py-2 text-right">Actual</th>
                        <th className="border-b px-3 py-2 text-left">Approved</th>
                        <th className="border-b px-3 py-2 text-right">AP Appr</th>
                        <th className="border-b px-3 py-2 text-right">Var</th>
                        {isCorrectionMode ? <th className="border-b px-3 py-2 text-right">Qty</th> : null}
                        <th className="border-b px-3 py-2 text-left">Mvt</th>
                        <th className="border-b px-3 py-2 text-center">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const values = computeRowValues(row);
                        const previewMaterialId = row.actual_material_id || row.material_id;
                        const availability = row.issue_sloc_id
                          ? availabilityByKey.get(`${previewMaterialId}::${row.issue_sloc_id}`) ?? null
                          : null;
                        const isShort = Boolean(availability && values.actual > Number(availability.available_qty ?? 0));
                        const actualMaterialOptions = row.allowed_alternate_material_options?.length
                          ? row.allowed_alternate_material_options
                          : [{ value: "", label: "(same)" }];

                        // COR6 correction preview — backend re-reads material/SLoc from
                        // the existing DB line itself (ignores any override sent here), so
                        // those two fields render read-only in correction mode below. Qty is
                        // always a positive magnitude; the user picks the movement type
                        // (P261/P262) from a dropdown themselves — never inferred from sign.
                        const correctionInput = correctionQty[row.id];
                        const hasCorrectionQty = isCorrectionMode && correctionInput !== undefined && correctionInput !== "" && Number(correctionInput) > 0;
                        const selectedMovementType = correctionMovementType[row.id] || "P261";
                        const correctionMagnitude = hasCorrectionQty ? Number(correctionInput) : 0;
                        const correctionSignedDelta = selectedMovementType === "P261" ? correctionMagnitude : -correctionMagnitude;
                        const correctionValues = hasCorrectionQty
                          ? computeRowValues({ planned_qty: 0, actual_qty: correctionSignedDelta, approved_status: correctionApproved[row.id], ap_approved_qty: correctionApApproved[row.id] })
                          : null;
                        const actualMaterialLabel = actualMaterialOptions.find((option) => option.value === row.actual_material_id)?.label || "(same)";
                        const slocLabelValue = storageLocationOptions.find((option) => option.value === row.issue_sloc_id)?.label || "--";

                        return (
                          <tr key={row.key} className={isShort ? "bg-rose-50" : "border-b border-slate-100"}>
                            <td className="px-3 py-2">
                              {row.id ? (
                                row.material_label || "--"
                              ) : (
                                <ErpComboboxField
                                  value={row.material_id}
                                  onChange={(value) => {
                                    const selected = (materialQ.materials ?? []).find((material) => material.id === value);
                                    const isDuplicate = value && rows.some((other) => other.key !== row.key && other.material_id === value);
                                    if (isDuplicate) {
                                      const proceed = window.confirm(
                                        `${materialLabel(selected) || "This material"} is already added as another line on this order. Add it again as a separate line?`
                                      );
                                      if (!proceed) return;
                                    }
                                    updateRow(row.key, {
                                      material_id: value,
                                      material_label: materialLabel(selected),
                                    });
                                  }}
                                  options={materialOptions}
                                  placeholder="-- Select material --"
                                  emptyStateLabel={materialQ.isLoading ? "Loading materials..." : "No materials"}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{formatPreciseNumber(row.dosage_pct, "--")}</td>
                            <td className="px-3 py-2">
                              {isCorrectionMode ? (
                                <span className="text-slate-500">{actualMaterialLabel}</span>
                              ) : (
                                <ErpComboboxField
                                  value={row.actual_material_id}
                                  onChange={(value) => updateRow(row.key, { actual_material_id: value })}
                                  options={actualMaterialOptions}
                                  placeholder="(same)"
                                  disabled={actualMaterialOptions.length <= 1}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isCorrectionMode ? (
                                <span className="text-slate-500">{slocLabelValue}</span>
                              ) : (
                                <ErpComboboxField
                                  value={row.issue_sloc_id}
                                  onChange={(value) => updateRow(row.key, { issue_sloc_id: value })}
                                  options={storageLocationOptions}
                                  placeholder="-- Select storage location --"
                                  emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{formatSum(values.planned, "0")}</td>
                            <td className="px-3 py-2 text-right">
                              {isCorrectionMode ? (
                                <span className="font-mono">{formatSum(values.actual, "0")}</span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step={PRODUCTION_DECIMAL_STEP}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                  value={row.actual_qty}
                                  onChange={(event) => updateRow(row.key, { actual_qty: event.target.value })}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isCorrectionMode ? (
                                hasCorrectionQty && !correctionValues.autoYes ? (
                                  <ErpComboboxField
                                    value={correctionApproved[row.id] || "YES"}
                                    onChange={(value) => setCorrectionApproved((current) => ({ ...current, [row.id]: value }))}
                                    options={APPROVED_OPTIONS}
                                    hideBlank
                                  />
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )
                              ) : values.autoYes && row.id && row.is_formulation_line ? (
                                <span className="inline-flex rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">* YES</span>
                              ) : (
                                <ErpComboboxField
                                  value={row.approved_status}
                                  onChange={(value) => updateRow(row.key, { approved_status: value })}
                                  options={APPROVED_OPTIONS}
                                  hideBlank
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {isCorrectionMode ? (
                                hasCorrectionQty && correctionValues.approved === "PARTIAL" ? (
                                  <input
                                    type="number"
                                    step={PRODUCTION_DECIMAL_STEP}
                                    className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                    value={correctionApApproved[row.id] ?? ""}
                                    onChange={(event) => setCorrectionApApproved((current) => ({ ...current, [row.id]: event.target.value }))}
                                  />
                                ) : hasCorrectionQty ? (
                                  <span className="font-mono">{formatSum(correctionValues.apApproved, "0")}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )
                              ) : row.approved_status === "PARTIAL" && !values.autoYes ? (
                                <input
                                  type="number"
                                  min="0"
                                  step={PRODUCTION_DECIMAL_STEP}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                  value={row.ap_approved_qty}
                                  onChange={(event) => updateRow(row.key, { ap_approved_qty: event.target.value })}
                                />
                              ) : (
                                <span className="font-mono">{formatSum(values.apApproved, "0")}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {isCorrectionMode ? (hasCorrectionQty ? formatSum(correctionValues.variance, "0") : "—") : formatSum(values.variance, "0")}
                            </td>
                            {isCorrectionMode ? (
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step={PRODUCTION_DECIMAL_STEP}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                  value={correctionQty[row.id] ?? ""}
                                  placeholder="qty"
                                  onChange={(event) => setCorrectionQty((current) => ({ ...current, [row.id]: event.target.value }))}
                                />
                              </td>
                            ) : null}
                            <td className="px-3 py-2 font-mono">
                              {isCorrectionMode ? (
                                <ErpComboboxField
                                  value={selectedMovementType}
                                  onChange={(value) => setCorrectionMovementType((current) => ({ ...current, [row.id]: value }))}
                                  options={RM_CORRECTION_MOVEMENT_OPTIONS}
                                  hideBlank
                                />
                              ) : "P261"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {!isCorrectionMode && !row.is_formulation_line && (
                                <button
                                  onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
                                  className="text-sm font-medium text-rose-600 hover:underline"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      {isCorrectionMode ? correctionNewRows.map((row) => (
                        <tr key={row.key} className="border-b border-slate-100 bg-amber-50/40">
                          <td className="px-3 py-2 min-w-[220px]">
                            <ErpComboboxField
                              value={row.material_id}
                              onChange={(value) => updateCorrectionRow(row.key, { material_id: value })}
                              options={materialOptions}
                              placeholder="-- Select material (missed item) --"
                              emptyStateLabel={materialQ.isLoading ? "Loading materials..." : "No materials"}
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                          <td className="px-3 py-2 text-slate-400">—</td>
                          <td className="px-3 py-2 min-w-[200px]">
                            <ErpComboboxField
                              value={row.issue_sloc_id}
                              onChange={(value) => updateCorrectionRow(row.key, { issue_sloc_id: value })}
                              options={storageLocationOptions}
                              placeholder="-- Select storage location --"
                              emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                          <td className="px-3 py-2 text-slate-400">—</td>
                          <td className="px-3 py-2 text-right text-slate-400">—</td>
                          <td className="px-3 py-2 text-right text-slate-400">—</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              step={PRODUCTION_DECIMAL_STEP}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                              value={row.delta_qty}
                              placeholder="qty"
                              onChange={(event) => updateCorrectionRow(row.key, { delta_qty: event.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-purple-700">P261</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeCorrectionRow(row.key)}
                              className="text-sm font-medium text-rose-600 hover:underline"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )) : null}
                    </tbody>
                  </table>
                </div>
                {isCorrectionMode ? (
                  <button type="button" onClick={addCorrectionRow} className="mt-2 text-sm font-medium text-sky-700 hover:underline">
                    + Add Missing Item
                  </button>
                ) : (
                  <button onClick={addRow} className="mt-2 text-sm font-medium text-sky-700 hover:underline">+ Add Row</button>
                )}
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Output</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="border-b px-3 py-2 text-left">Material</th>
                        <th className="border-b px-3 py-2 text-right">Std</th>
                        <th className="border-b px-3 py-2 text-right">Actual</th>
                        <th className="border-b px-3 py-2 text-right">AP Appr</th>
                        <th className="border-b px-3 py-2 text-right">Var</th>
                        <th className="border-b px-3 py-2 text-left">Mvt</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border-b border-slate-100 px-3 py-2">{materialLabel(po.material) || "--"}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(po.planned_qty, "0")}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatSum(outputActualQty, "0")}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatSum(outputApprovedQty, "0")}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatSum(outputVariance, "0")}</td>
                        <td className="border-b border-slate-100 px-3 py-2">P101</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {isCorrectionMode ? (
                  <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Output Qty</label>
                      <input
                        type="number"
                        min="0"
                        step={PRODUCTION_DECIMAL_STEP}
                        className="w-32 rounded border border-slate-300 px-2 py-1.5 text-right font-mono text-sm"
                        value={outputDeltaQty}
                        placeholder="qty"
                        onChange={(event) => setOutputDeltaQty(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Movement</label>
                      <ErpComboboxField
                        value={outputMovementType}
                        onChange={setOutputMovementType}
                        options={OUTPUT_CORRECTION_MOVEMENT_OPTIONS}
                        hideBlank
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
