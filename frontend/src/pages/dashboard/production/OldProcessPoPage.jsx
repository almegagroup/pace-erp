/*
 * File-ID: 27.FE-PR22
 * File-Path: frontend/src/pages/dashboard/production/OldProcessPoPage.jsx
 * Gate: 27.104.9 | Domain: PRODUCTION / COSTING
 * Purpose: PR22 "Old Process PO" (Â§104.9.1). Attaches synthetic genealogy to a pre-go-live
 *          MTO/HPS batch whose stock was loaded by IN05 Opening Stock. RM/INT lines are
 *          auto-derived from the Stroke (dosage% Ã— output qty) and then editable, because real
 *          historical deviations must be capturable. Saving writes a VERIFIED process_order +
 *          lines + OPENING reco rows â€” and posts NO stock movement (the RM was consumed outside
 *          this system; only IN05's P561 is a real stock event).
 *          Sequence: this page first -> then Opening Stock (IN05) (-> PR23 for FG).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { listStrokeMasters, getStrokeMaster, createOldProcessPo } from "./prodApi.js";
import { listMachines } from "../om/omApi.js";

const PO_TYPES = ["MTO", "HPS"];
const APPROVED_OPTIONS = ["YES", "NO", "PARTIAL"];

const ERRORS = {
  PROD_OLD_PROCESS_PO_INVALID: "Company, Prodshade, Batch Number and Actual Output are required.",
  PROD_OLD_PROCESS_PO_TYPE_INVALID: "Old Process PO supports MTO/HPS only.",
  PROD_OLD_PROCESS_PO_NO_LINES: "At least one RM/INT line is required.",
  PROD_OLD_PROCESS_PO_BATCH_EXISTS: "A Process PO already exists for this batch.",
  PROD_OLD_OPENING_BATCH_NOT_FOUND: "This batch has no posted Opening Stock (IN05). Load opening stock first.",
  PROD_OLD_OPENING_QTY_MISMATCH: "Actual Output does not match the opening stock quantity for this batch.",
};
function friendly(code, fallback) { return ERRORS[code] ?? fallback ?? code; }

function materialLabel(m) {
  if (!m) return "--";
  return [m.pace_code || m.external_code, m.material_name].filter(Boolean).join(" - ");
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return num(v).toFixed(3); }

export default function OldProcessPoPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState("MTO");
  const [strokeId, setStrokeId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [machineId, setMachineId] = useState("");
  const [outputQty, setOutputQty] = useState("");
  const [lineEdits, setLineEdits] = useState({}); // material_id â†’ {actual_qty, approved_status, ap_approved_qty, variance_qty}
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 5000);
  }

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => {
    if (!companyId && effectiveCompanyId) setCompanyId(effectiveCompanyId);
  }, [companyId, effectiveCompanyId]);

  const strokesQ = useQuery({
    queryKey: ["old-po-strokes", effectiveCompanyId],
    queryFn: () => listStrokeMasters({ company_id: effectiveCompanyId, status: "APPROVED" }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  // Only MTO/HPS strokes are eligible (Â§104.9 scope).
  const strokes = useMemo(
    () => (strokesQ.data ?? []).filter((s) => !s.po_type || String(s.po_type).toUpperCase() === poType),
    [strokesQ.data, poType],
  );
  const strokeOptions = strokes.map((s) => ({
    value: s.id,
    label: `${materialLabel(s.material ?? s.prodshade_material)} Â· Stroke ${s.stroke_number ?? "--"}`,
  }));
  const selectedStroke = strokes.find((s) => s.id === strokeId) ?? null;

  const machinesQ = useQuery({
    queryKey: ["old-po-machines", effectiveCompanyId],
    queryFn: () => listMachines({ company_id: effectiveCompanyId, active: true }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const machineOptions = (machinesQ.data ?? []).map((m) => ({
    value: m.id, label: [m.machine_code, m.machine_name].filter(Boolean).join(" - "),
  }));

  const strokeDetailQ = useQuery({
    queryKey: ["old-po-stroke-detail", strokeId],
    queryFn: () => getStrokeMaster(strokeId),
    enabled: !!strokeId,
  });
  const strokeLines = useMemo(
    () => (Array.isArray(strokeDetailQ.data?.lines) ? strokeDetailQ.data.lines : []),
    [strokeDetailQ.data],
  );

  // Auto-derive RM/INT from the Stroke: qty = dosage% Ã— output qty (Â§104.9 "auto-derive, editable").
  const derivedLines = useMemo(() => strokeLines.map((line, idx) => {
    const standardQty = (num(line.dosage_pct) / 100) * num(outputQty);
    const edit = lineEdits[line.material_id] ?? {};
    const actualQty = edit.actual_qty !== undefined && edit.actual_qty !== "" ? num(edit.actual_qty) : standardQty;
    const approved = edit.approved_status ?? "YES";
    const apQty = edit.ap_approved_qty !== undefined && edit.ap_approved_qty !== ""
      ? num(edit.ap_approved_qty)
      : (approved === "NO" ? 0 : actualQty);
    return {
      key: line.id || line.material_id,
      material_id: line.material_id,
      material_label: materialLabel(line.material),
      line_material_type: String(line.line_material_type || line.material?.material_type || "RM").toUpperCase() === "INT" ? "INT" : "RM",
      dosage_pct: num(line.dosage_pct),
      issue_sloc_id: line.default_storage_location_id || null,
      display_order: idx + 1,
      standard_qty: standardQty,
      actual_qty: actualQty,
      approved_status: approved,
      ap_approved_qty: apQty,
      variance_qty: num(edit.variance_qty ?? (actualQty - standardQty)),
      uom_code: line.material?.base_uom_code || "KG",
    };
  }), [strokeLines, outputQty, lineEdits]);

  function patchLine(materialId, patch) {
    setLineEdits((cur) => ({ ...cur, [materialId]: { ...(cur[materialId] ?? {}), ...patch } }));
  }

  const totalRm = derivedLines.reduce((s, l) => s + l.actual_qty, 0);
  const canSave = !!effectiveCompanyId && !!strokeId && !!batchNumber.trim() && num(outputQty) > 0 && derivedLines.length > 0;

  async function handleSave() {
    if (!canSave) { toast("Fill Company, Stroke, Batch Number and Actual Output.", "error"); return; }
    setSaving(true);
    try {
      const res = await createOldProcessPo({
        company_id: effectiveCompanyId,
        po_type: poType,
        material_id: selectedStroke?.prodshade_material_id ?? selectedStroke?.material_id,
        batch_number: batchNumber.trim(),
        stroke_master_id: strokeId,
        machine_id: machineId || null,
        actual_qty: num(outputQty),
        lines: derivedLines.map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: l.dosage_pct,
          issue_sloc_id: l.issue_sloc_id,
          display_order: l.display_order,
          standard_qty: l.standard_qty,
          actual_qty: l.actual_qty,
          approved_status: l.approved_status,
          ap_approved_qty: l.ap_approved_qty,
          variance_qty: l.variance_qty,
          uom_code: l.uom_code,
        })),
      });
      toast(`Old Process PO ${res?.po_number ?? ""} created for batch ${batchNumber.trim()} â€” no stock moved.`);
      setBatchNumber(""); setOutputQty(""); setLineEdits({});
      qc.invalidateQueries({ queryKey: ["old-process-po-batches"] });
    } catch (err) {
      toast(friendly(err.code, err.message), "error");
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      title="Old Process PO"
      subtitle="PR22 â€” genealogy for a pre-go-live MTO/HPS batch (Â§104.9). RM/INT auto-derived from the Stroke, editable. Saves a VERIFIED paper order; posts NO stock movement. Create this record before loading the related Opening Stock (IN05)."
      actions={[{ label: "Save", tone: "primary", mnemonic: "S", disabled: !canSave || saving, onClick: handleSave }]}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Header">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(v) => { setCompanyId(v); setStrokeId(""); setMachineId(""); }}
              label="Company"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">PO Type <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={poType} onChange={(e) => { setPoType(e.target.value); setStrokeId(""); }}>
              {PO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Prodshade / Stroke <span className="text-rose-500">*</span></label>
            <ErpComboboxField value={strokeId} onChange={(v) => { setStrokeId(v); setLineEdits({}); }} options={strokeOptions} placeholder="-- Select stroke --" emptyStateLabel="No approved strokes for this company/type" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Batch Number <span className="text-rose-500">*</span></label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value.toUpperCase())} placeholder="as loaded in IN05" />
            <p className="text-xs text-slate-400">Use the historical batch number that this old process order should carry into Opening Stock (IN05).</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Machine</label>
            <ErpComboboxField value={machineId} onChange={setMachineId} options={machineOptions} placeholder="-- Optional --" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Actual Output Qty (KG) <span className="text-rose-500">*</span></label>
            <input type="number" min="0" step="0.001" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} />
            <p className="text-xs text-slate-400">Enter the historical SFG output quantity for this batch.</p>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`RM / INT Lines${derivedLines.length ? ` (${derivedLines.length})` : ""}`}>
        {!strokeId ? (
          <p className="text-slate-400 text-sm py-6 text-center">Select a Stroke to auto-derive the RM/INT breakup.</p>
        ) : strokeDetailQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading strokeâ€¦</p>
        ) : derivedLines.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">This stroke has no RM/INT lines.</p>
        ) : (
          <>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
              Auto-derived from the Stroke standard (dosage% Ã— output). Edit any line where the real historical
              consumption differed â€” un-edited figures are the <strong>standard</strong>, not a true actual.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">Material</th>
                    <th className="text-left py-2 px-3 border-b">Type</th>
                    <th className="text-right py-2 px-3 border-b">Dosage %</th>
                    <th className="text-right py-2 px-3 border-b">Standard Qty</th>
                    <th className="text-right py-2 px-3 border-b">Actual Qty</th>
                    <th className="text-left py-2 px-3 border-b">Approved</th>
                    <th className="text-right py-2 px-3 border-b">AP Approved Qty</th>
                    <th className="text-right py-2 px-3 border-b">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {derivedLines.map((l) => (
                    <tr key={l.key} className="border-b border-slate-100">
                      <td className="py-2 px-3 text-slate-700">{l.material_label}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${l.line_material_type === "INT" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}`}>{l.line_material_type}</span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">{l.dosage_pct.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-400">{fmt(l.standard_qty)}</td>
                      <td className="py-2 px-3 text-right">
                        <input type="number" min="0" step="0.001"
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                          value={lineEdits[l.material_id]?.actual_qty ?? ""}
                          placeholder={fmt(l.standard_qty)}
                          onChange={(e) => patchLine(l.material_id, { actual_qty: e.target.value })} />
                      </td>
                      <td className="py-2 px-3">
                        <select className="border border-slate-300 rounded px-2 py-1 text-sm"
                          value={l.approved_status}
                          onChange={(e) => patchLine(l.material_id, { approved_status: e.target.value })}>
                          {APPROVED_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input type="number" min="0" step="0.001"
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                          value={lineEdits[l.material_id]?.ap_approved_qty ?? ""}
                          placeholder={fmt(l.ap_approved_qty)}
                          onChange={(e) => patchLine(l.material_id, { ap_approved_qty: e.target.value })} />
                      </td>
                      <td className={`py-2 px-3 text-right font-mono ${Math.abs(l.variance_qty) > 0.0005 ? "text-amber-700" : "text-slate-400"}`}>{fmt(l.variance_qty)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="py-2 px-3" colSpan={4}>Total RM / INT</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(totalRm)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              â›” Saving posts <strong>no stock movement</strong> â€” this is a genealogy/costing record only. The batch's
              physical balance comes from Opening Stock (IN05).
            </p>
          </>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}

