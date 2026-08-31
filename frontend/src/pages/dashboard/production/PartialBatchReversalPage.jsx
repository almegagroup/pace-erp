/*
 * File-ID: 27.FE-PR19
 * File-Path: frontend/src/pages/dashboard/production/PartialBatchReversalPage.jsx
 * Gate: 27.19
 * Domain: PRODUCTION
 * Purpose: PR19 Partial Batch Reversal (§83.7, LOCKED 2026-07-12, MTO/HPS only).
 *          3-page flow: identify batch -> pick a stock line (SFG or SKU/Packing
 *          PO) -> enter reverse qty + review RM/PM breakdown + submit.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import {
  listPartialReversalProdshades,
  resolvePartialReversalBatch,
  listPartialReversalStockLines,
  listSalvageBatchOptions,
  getPartialReversalDetail,
  createPartialBatchReversal,
} from "./prodApi.js";

const PO_TYPES = ["MTO", "HPS"];

function materialLabel(m) {
  if (!m) return "--";
  return [m.pace_code || m.external_code, m.material_name].filter(Boolean).join(" - ");
}
function storageLocationLabel(loc) {
  if (!loc) return "--";
  return loc.code || loc.name || "--";
}
function fmt(n) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toFixed(3) : "0.000";
}

function rowKey(row) {
  return `${row.row_type}:${row.packing_order_id ?? "sfg"}`;
}

export default function PartialBatchReversalPage() {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);

  // Page 1
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState("");
  const [prodshadeMaterialId, setProdshadeMaterialId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [resolvedPo, setResolvedPo] = useState(null);

  // Page 2
  const [selectedRow, setSelectedRow] = useState(null);

  // Page 3
  const [reverseQty, setReverseQty] = useState("");
  const [numPacksToReverse, setNumPacksToReverse] = useState("");
  const [salvageBatchNumber, setSalvageBatchNumber] = useState("");
  const [pmExclusions, setPmExclusions] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const prodshadesQ = useQuery({
    queryKey: ["pr19-prodshades", effectiveCompanyId, poType],
    queryFn: () => listPartialReversalProdshades({ company_id: effectiveCompanyId, po_type: poType }),
    enabled: Boolean(effectiveCompanyId && poType),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const prodshadeOptions = useMemo(
    () => (prodshadesQ.data ?? []).map((m) => ({ value: m.id, label: materialLabel(m) })),
    [prodshadesQ.data],
  );

  async function handleResolveBatch() {
    if (!effectiveCompanyId || !poType || !prodshadeMaterialId || !batchNumber.trim()) return;
    try {
      const po = await resolvePartialReversalBatch({
        company_id: effectiveCompanyId,
        po_type: poType,
        prodshade_material_id: prodshadeMaterialId,
        batch_number: batchNumber.trim(),
      });
      setResolvedPo(po);
      setSelectedRow(null);
      setStep(2);
    } catch (error) {
      toast(error.message || "Batch lookup failed.", "error");
    }
  }

  const stockLinesQ = useQuery({
    queryKey: ["pr19-stock-lines", resolvedPo?.id],
    queryFn: () => listPartialReversalStockLines({ process_order_id: resolvedPo.id }),
    enabled: Boolean(resolvedPo?.id && step === 2),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });

  function handlePickRow(row) {
    setSelectedRow(row);
    setReverseQty("");
    setNumPacksToReverse("");
    setSalvageBatchNumber("");
    setPmExclusions(new Set());
  }

  function handleNumPacksChange(value) {
    setNumPacksToReverse(value);
    const packs = Number(value);
    const fillQty = Number(selectedRow?.fill_qty_per_pack ?? 0);
    if (Number.isFinite(packs) && packs > 0 && fillQty > 0) {
      setReverseQty(String(packs * fillQty));
    }
  }

  function proceedToPage3() {
    if (!selectedRow) return;
    setStep(3);
  }

  const salvageBatchesQ = useQuery({
    queryKey: ["pr19-salvage-batches", effectiveCompanyId, poType, prodshadeMaterialId, resolvedPo?.id],
    queryFn: () => listSalvageBatchOptions({
      company_id: effectiveCompanyId, po_type: poType, prodshade_material_id: prodshadeMaterialId,
      exclude_process_order_id: resolvedPo?.id,
    }),
    enabled: Boolean(effectiveCompanyId && poType && prodshadeMaterialId && step === 3),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });

  const parsedReverseQty = Number(reverseQty);
  const validQty = Boolean(parsedReverseQty > 0 && selectedRow && parsedReverseQty <= Number(selectedRow.available_qty ?? 0) + 1e-6);

  const detailQ = useQuery({
    queryKey: ["pr19-detail", resolvedPo?.id, selectedRow?.row_type, selectedRow?.packing_order_id, parsedReverseQty],
    queryFn: () => getPartialReversalDetail({
      process_order_id: resolvedPo.id,
      row_type: selectedRow.row_type,
      packing_order_id: selectedRow.packing_order_id ?? undefined,
      reverse_qty: parsedReverseQty,
    }),
    enabled: Boolean(resolvedPo?.id && selectedRow && validQty),
  });

  function togglePmExclusion(lineId) {
    setPmExclusions((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      return next;
    });
  }

  async function handleSubmit() {
    if (!resolvedPo || !selectedRow || !validQty) return;
    const confirmed = await openActionConfirm({
      eyebrow: "Partial Batch Reversal",
      title: `Reverse ${fmt(parsedReverseQty)} KG from batch ${resolvedPo.batch_number}?`,
      message: "This posts proportional RM/PM/INT reversal movements. This action cannot be undone from this screen.",
      confirmLabel: "Reverse",
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await createPartialBatchReversal({
        process_order_id: resolvedPo.id,
        row_type: selectedRow.row_type,
        packing_order_id: selectedRow.packing_order_id ?? undefined,
        reverse_qty: parsedReverseQty,
        salvage_batch_number: salvageBatchNumber || undefined,
        pm_line_exclusions: [...pmExclusions],
      });
      toast("Partial batch reversal posted.");
      qc.invalidateQueries({ queryKey: ["pr19-stock-lines"] });
      qc.invalidateQueries({ queryKey: ["partial-batch-reversals"] });
      // reset for next transaction
      setStep(1);
      setResolvedPo(null);
      setSelectedRow(null);
      setBatchNumber("");
      setReverseQty("");
      setSalvageBatchNumber("");
      setPmExclusions(new Set());
    } catch (error) {
      toast(error.message || "Reversal failed.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ErpScreenScaffold title="Partial Batch Reversal - PR19" subtitle="Reverse a partial qty of a VERIFIED batch (SFG or SKU row)">

      <div className="mb-4 flex gap-2 text-xs font-medium text-slate-500">
        {["1. Identify Batch", "2. Select Stock Line", "3. Reverse Qty + Post"].map((label, idx) => (
          <span key={label} className={`rounded px-2 py-1 ${step === idx + 1 ? "bg-sky-100 text-sky-800" : ""}`}>{label}</span>
        ))}
      </div>

      {step === 1 && (
        <ErpSectionCard title="Identify Batch">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={(v) => { setCompanyId(v); setPoType(""); setProdshadeMaterialId(""); }}
                label="Company"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">PO Type</label>
              <ErpComboboxField
                value={poType}
                onChange={(v) => { setPoType(v); setProdshadeMaterialId(""); }}
                options={PO_TYPES.map((t) => ({ value: t, label: t }))}
                placeholder="-- Select type (MTO/HPS) --"
                disabled={!effectiveCompanyId}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prodshade</label>
              <ErpComboboxField
                value={prodshadeMaterialId}
                onChange={setProdshadeMaterialId}
                options={prodshadeOptions}
                placeholder="-- Select prodshade --"
                emptyStateLabel={prodshadesQ.isLoading ? "Loading..." : "No VERIFIED batches for this type"}
                disabled={!poType}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Batch Number</label>
              <input
                className="h-9 rounded border border-slate-300 px-2 text-sm"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="Enter batch number"
                disabled={!prodshadeMaterialId}
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={handleResolveBatch}
              disabled={!effectiveCompanyId || !poType || !prodshadeMaterialId || !batchNumber.trim()}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              Enter
            </button>
          </div>
        </ErpSectionCard>
      )}

      {step === 2 && resolvedPo && (
        <ErpSectionCard title={`Select Stock Line — Batch ${resolvedPo.batch_number}`}>
          <div className="mb-3 grid gap-3 md:grid-cols-4 text-sm">
            <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{resolvedPo.po_number}</p></div>
            <div><span className="block text-xs text-slate-400">Prodshade</span><p>{materialLabel(resolvedPo.material)}</p></div>
            <div><span className="block text-xs text-slate-400">Machine</span><p>{resolvedPo.machine?.machine_name || resolvedPo.machine?.name || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Actual Output</span><p className="font-mono">{fmt(resolvedPo.actual_qty)} KG</p></div>
          </div>

          {stockLinesQ.isLoading ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading stock lines...</p>
          ) : (stockLinesQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No reversible Unrestricted stock found for this batch.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="py-2 px-3"></th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Storage Location</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Material Type</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Material</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Packing PO</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Batch #</th>
                    <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Fill Qty/Pack</th>
                    <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Num Packs</th>
                    <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Available (KG)</th>
                  </tr>
                </thead>
                <tbody>
                  {(stockLinesQ.data ?? []).map((row) => (
                    <tr
                      key={rowKey(row)}
                      className={`border-t cursor-pointer ${selectedRow && rowKey(selectedRow) === rowKey(row) ? "bg-sky-50" : "hover:bg-slate-50"}`}
                      onClick={() => handlePickRow(row)}
                    >
                      <td className="py-2 px-3">
                        <input type="radio" readOnly checked={Boolean(selectedRow && rowKey(selectedRow) === rowKey(row))} />
                      </td>
                      <td className="py-2 px-3">{storageLocationLabel(row.storage_location)}</td>
                      <td className="py-2 px-3">{row.row_type === "SFG" ? "SFG" : "FG (SKU)"}</td>
                      <td className="py-2 px-3">{materialLabel(row.material)}</td>
                      <td className="py-2 px-3 font-mono">{row.po_number || "--"}</td>
                      <td className="py-2 px-3 font-mono">{row.batch_number}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.fill_qty_per_pack != null ? fmt(row.fill_qty_per_pack) : "—"}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.num_packs ?? "—"}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(row.available_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep(1)} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Back</button>
            <button
              onClick={proceedToPage3}
              disabled={!selectedRow}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </ErpSectionCard>
      )}

      {step === 3 && resolvedPo && selectedRow && (
        <ErpSectionCard title="Reverse Qty + Review">
          <div className="mb-4 grid gap-3 md:grid-cols-4 text-sm">
            <div><span className="block text-xs text-slate-400">Row</span><p>{selectedRow.row_type === "SFG" ? "SFG" : "FG (SKU)"} — {materialLabel(selectedRow.material)}</p></div>
            <div><span className="block text-xs text-slate-400">Packing PO</span><p className="font-mono">{selectedRow.po_number || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Fill Qty/Pack</span><p className="font-mono">{selectedRow.fill_qty_per_pack != null ? `${fmt(selectedRow.fill_qty_per_pack)} KG` : "—"}</p></div>
            <div><span className="block text-xs text-slate-400">Available</span><p className="font-mono">{fmt(selectedRow.available_qty)} KG{selectedRow.num_packs != null ? ` (${selectedRow.num_packs} packs)` : ""}</p></div>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-4 text-sm">
            {selectedRow.fill_qty_per_pack ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Num Packs to Reverse</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="h-9 rounded border border-slate-300 px-2 text-sm"
                  value={numPacksToReverse}
                  onChange={(e) => handleNumPacksChange(e.target.value)}
                  max={selectedRow.num_packs ?? undefined}
                />
                <span className="text-[11px] text-slate-400">= {fmt(Number(numPacksToReverse || 0) * Number(selectedRow.fill_qty_per_pack))} KG</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Reverse Qty (KG)</label>
              <input
                type="number"
                step="0.001"
                className="h-9 rounded border border-slate-300 px-2 text-sm"
                value={reverseQty}
                onChange={(e) => { setReverseQty(e.target.value); setNumPacksToReverse(""); }}
                max={selectedRow.available_qty}
              />
              {reverseQty && !validQty ? <span className="text-[11px] text-rose-600">Exceeds available quantity.</span> : null}
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-1 md:w-1/2">
            <label className="text-xs font-medium text-slate-600">Salvage Batch Number (optional, traceability only)</label>
            <ErpComboboxField
              value={salvageBatchNumber}
              onChange={setSalvageBatchNumber}
              options={(salvageBatchesQ.data ?? []).map((po) => ({
                value: po.batch_number,
                label: `${po.batch_number} (${po.po_number}, ${po.status})`,
              }))}
              placeholder="-- None --"
              emptyStateLabel={salvageBatchesQ.isLoading ? "Loading..." : "No other batches for this prodshade yet"}
            />
          </div>

          {validQty && detailQ.isFetching ? (
            <p className="py-4 text-center text-sm text-slate-400">Computing breakdown...</p>
          ) : null}

          {validQty && detailQ.data ? (
            <>
              <div className="mb-3 text-sm">
                <span className="font-medium text-slate-600">Reversal Ratio:</span>{" "}
                {(Number(detailQ.data.reversal_ratio ?? 0) * 100).toFixed(2)}%
                {detailQ.data.reversal_ratio_rm ? (
                  <span className="ml-3 text-slate-500">(RM/INT batch-wide ratio: {(Number(detailQ.data.reversal_ratio_rm) * 100).toFixed(2)}%)</span>
                ) : null}
              </div>

              <div className="mb-4 overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Line</th>
                      <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Material</th>
                      <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Returns To</th>
                      <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Actual Qty</th>
                      <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Actual Reversal</th>
                      <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">AP Approved Qty</th>
                      <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">AP Approved Reversal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailQ.data.rm_int_lines ?? []).map((line) => (
                      <tr key={line.process_order_line_id} className="border-t">
                        <td className="py-2 px-3">{line.line_material_type}</td>
                        <td className="py-2 px-3">{materialLabel(line.material)}</td>
                        <td className="py-2 px-3 font-mono">{storageLocationLabel(line.storage_location)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt(line.actual_qty)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt(line.proportional_actual_qty)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt(line.ap_approved_qty)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt(line.proportional_ap_approved_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[11px] text-slate-500">
                  Both columns post on Reverse: Actual Reversal physically returns stock at that
                  qty; AP Approved Reversal credits the Reco/Costing layer (what APL gets billed
                  for) by the same proportion — matching how the original Verify posting split
                  the two.
                </p>
              </div>

              {selectedRow.row_type === "SKU" && (detailQ.data.pm_lines ?? []).length > 0 ? (
                <div className="mb-4 overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="py-2 px-3"></th>
                        <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">PM Material</th>
                        <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Returns To</th>
                        <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Qty</th>
                        <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Proportional Reversal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailQ.data.pm_lines ?? []).map((line) => (
                        <tr key={line.packing_order_line_id} className="border-t">
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              checked={!pmExclusions.has(line.packing_order_line_id)}
                              onChange={() => togglePmExclusion(line.packing_order_line_id)}
                            />
                          </td>
                          <td className="py-2 px-3">{materialLabel(line.material)}</td>
                          <td className="py-2 px-3 font-mono">{storageLocationLabel(line.storage_location)}</td>
                          <td className="py-2 px-3 text-right font-mono">{fmt(line.qty)}</td>
                          <td className="py-2 px-3 text-right font-mono">{fmt(line.proportional_qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 py-2 text-[11px] text-slate-500">Uncheck a PM line if that packaging is single-use / already consumed and should not be returned to stock.</p>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep(2)} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Back</button>
            <button
              onClick={handleSubmit}
              disabled={!validQty || submitting}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting ? "Posting..." : "Post Reversal"}
            </button>
          </div>
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
