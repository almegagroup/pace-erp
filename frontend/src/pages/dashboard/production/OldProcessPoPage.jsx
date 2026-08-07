/*
 * File-ID: 27.FE-PR22
 * File-Path: frontend/src/pages/dashboard/production/OldProcessPoPage.jsx
 * Gate: 27.104.9 | Domain: PRODUCTION / COSTING
 * Purpose: PR22 "Old Process PO" (§104.9.1). Attaches synthetic genealogy to a pre-go-live
 *          MTO/HPS batch whose stock was loaded by IN05 Opening Stock. RM/INT lines are
 *          auto-derived from the Stroke (dosage% × output qty) and then editable, because real
 *          historical deviations must be capturable. Saving writes a VERIFIED process_order +
 *          lines + OPENING reco rows — and posts NO stock movement (the RM was consumed outside
 *          this system; only IN05's P561 is a real stock event).
 *          Sequence: this page first -> then Opening Stock (IN05) (-> PR23 for FG).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { listStrokeMasters, getStrokeMaster, createOldProcessPo } from "./prodApi.js";
import { listMachines, listMaterials, listStorageLocations } from "../om/omApi.js";

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
function lineTypeFromMaterial(material) {
  return String(material?.material_type ?? "").toUpperCase() === "INT" ? "INT" : "RM";
}

export default function OldProcessPoPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState("MTO");
  const [strokeId, setStrokeId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [machineId, setMachineId] = useState("");
  const [outputQty, setOutputQty] = useState("");
  const [lineEdits, setLineEdits] = useState({});
  const [manualLines, setManualLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const nextManualId = useRef(1);

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
  // Only MTO/HPS strokes are eligible (§104.9 scope).
  const strokes = useMemo(
    () => (strokesQ.data ?? []).filter((s) => !s.po_type || String(s.po_type).toUpperCase() === poType),
    [strokesQ.data, poType],
  );
  const strokeOptions = strokes.map((s) => ({
    value: s.id,
    label: `${materialLabel(s.material ?? s.prodshade_material)} · Stroke ${s.stroke_number ?? "--"}`,
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

  const materialsQ = useQuery({
    queryKey: ["old-po-materials"],
    queryFn: () => listMaterials({ limit: 1000 }),
    select: (d) => d?.data ?? [],
  });
  const locationQ = useQuery({
    queryKey: ["old-po-locations", effectiveCompanyId],
    queryFn: () => listStorageLocations({ company_id: effectiveCompanyId, is_active: true }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const rmIntMaterials = useMemo(
    () => (materialsQ.data ?? []).filter((m) => ["RM", "INT"].includes(String(m.material_type ?? "").toUpperCase())),
    [materialsQ.data],
  );
  const materialOptions = useMemo(
    () => rmIntMaterials.map((m) => ({ value: m.id, label: materialLabel(m) })),
    [rmIntMaterials],
  );
  const materialById = useMemo(
    () => new Map(rmIntMaterials.map((m) => [m.id, m])),
    [rmIntMaterials],
  );
  const locationOptions = useMemo(
    () => (locationQ.data ?? []).map((l) => ({ value: l.id, label: [l.code || l.location_code, l.name || l.location_name].filter(Boolean).join(" - ") })),
    [locationQ.data],
  );

  const strokeDetailQ = useQuery({
    queryKey: ["old-po-stroke-detail", strokeId],
    queryFn: () => getStrokeMaster(strokeId),
    enabled: !!strokeId,
  });
  const strokeLines = useMemo(
    () => (Array.isArray(strokeDetailQ.data?.lines) ? strokeDetailQ.data.lines : []),
    [strokeDetailQ.data],
  );

  // Auto-derive RM/INT from the Stroke: qty = dosage% × output qty (§104.9 "auto-derive, editable").
  const derivedLines = useMemo(() => strokeLines.map((line, idx) => {
    const key = `stroke:${line.id || idx}:${line.material_id}`;
    const standardQty = (num(line.dosage_pct) / 100) * num(outputQty);
    const edit = lineEdits[key] ?? {};
    const actualQty = edit.actual_qty !== undefined && edit.actual_qty !== "" ? num(edit.actual_qty) : standardQty;
    const approved = edit.approved_status ?? "YES";
    const apQty = edit.ap_approved_qty !== undefined && edit.ap_approved_qty !== ""
      ? num(edit.ap_approved_qty)
      : (approved === "NO" ? 0 : actualQty);
    return {
      key,
      material_id: line.material_id,
      material_label: materialLabel(line.material),
      line_material_type: String(line.line_material_type || line.material?.material_type || "RM").toUpperCase() === "INT" ? "INT" : "RM",
      dosage_pct: num(line.dosage_pct),
      issue_sloc_id: edit.issue_sloc_id ?? line.default_storage_location_id ?? "",
      display_order: idx + 1,
      standard_qty: standardQty,
      actual_qty: actualQty,
      approved_status: approved,
      ap_approved_qty: apQty,
      variance_qty: edit.variance_qty !== undefined && edit.variance_qty !== "" ? num(edit.variance_qty) : (actualQty - standardQty),
      uom_code: line.material?.base_uom_code || "KG",
      is_formulation_line: true,
    };
  }), [strokeLines, outputQty, lineEdits]);

  const normalizedManualLines = useMemo(() => manualLines.map((line, idx) => {
    const material = materialById.get(line.material_id) ?? null;
    const actualQty = line.actual_qty !== "" ? num(line.actual_qty) : 0;
    const approved = line.approved_status || "YES";
    const apQty = line.ap_approved_qty !== "" ? num(line.ap_approved_qty) : (approved === "NO" ? 0 : actualQty);
    const varianceQty = line.variance_qty !== "" ? num(line.variance_qty) : actualQty;
    return {
      key: line.id,
      material_id: line.material_id,
      material_label: materialLabel(material),
      line_material_type: line.line_material_type || lineTypeFromMaterial(material),
      dosage_pct: 0,
      issue_sloc_id: line.issue_sloc_id || "",
      display_order: derivedLines.length + idx + 1,
      standard_qty: 0,
      actual_qty: actualQty,
      approved_status: approved,
      ap_approved_qty: apQty,
      variance_qty: varianceQty,
      uom_code: line.uom_code || material?.base_uom_code || "KG",
      is_formulation_line: false,
      is_manual: true,
    };
  }), [derivedLines.length, manualLines, materialById]);

  function patchLine(lineKey, patch) {
    setLineEdits((cur) => ({ ...cur, [lineKey]: { ...(cur[lineKey] ?? {}), ...patch } }));
  }

  function addManualLine() {
    const id = `manual-${nextManualId.current++}`;
    setManualLines((cur) => [...cur, {
      id,
      material_id: "",
      line_material_type: "RM",
      issue_sloc_id: "",
      actual_qty: "",
      approved_status: "YES",
      ap_approved_qty: "",
      variance_qty: "",
      uom_code: "KG",
    }]);
  }

  function patchManualLine(lineId, patch) {
    setManualLines((cur) => cur.map((line) => {
      if (line.id !== lineId) return line;
      const next = { ...line, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "material_id")) {
        const material = materialById.get(patch.material_id) ?? null;
        next.line_material_type = lineTypeFromMaterial(material);
        next.uom_code = material?.base_uom_code || "KG";
      }
      return next;
    }));
  }

  function removeManualLine(lineId) {
    setManualLines((cur) => cur.filter((line) => line.id !== lineId));
  }

  const allLines = useMemo(() => [...derivedLines, ...normalizedManualLines], [derivedLines, normalizedManualLines]);
  const totalRm = allLines.reduce((s, l) => s + l.actual_qty, 0);
  const hasInvalidLine = allLines.some((line) => !line.material_id || num(line.actual_qty) <= 0 || !line.issue_sloc_id);
  const canSave = !!effectiveCompanyId && !!strokeId && !!batchNumber.trim() && num(outputQty) > 0 && allLines.length > 0 && !hasInvalidLine;

  async function handleSave() {
    if (!canSave) { toast("Fill Company, Stroke, Batch Number, Actual Output, and every line's storage location.", "error"); return; }
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
        lines: allLines.map((l) => ({
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
          is_formulation_line: l.is_formulation_line,
        })),
      });
      toast(`Old Process PO ${res?.po_number ?? ""} created for batch ${batchNumber.trim()} — no stock moved.`);
      setBatchNumber(""); setOutputQty(""); setLineEdits({}); setManualLines([]);
      qc.invalidateQueries({ queryKey: ["old-process-po-batches"] });
    } catch (err) {
      toast(friendly(err.code, err.message), "error");
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      title="Old Process PO"
      subtitle="PR22 — genealogy for a pre-go-live MTO/HPS batch (§104.9). RM/INT auto-derived from the Stroke, editable, and expandable with manual extra lines. Saves a VERIFIED paper order; posts NO stock movement. Create this record before loading the related Opening Stock (IN05)."
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
            <p className="text-xs text-slate-400">This historical batch number is what Opening Stock (IN05) will reference later.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Machine</label>
            <ErpComboboxField value={machineId} onChange={setMachineId} options={machineOptions} placeholder="-- Optional --" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Actual Output Qty (KG) <span className="text-rose-500">*</span></label>
            <input type="number" min="0" step="0.001" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} />
            <p className="text-xs text-slate-400">Enter the historical SFG output quantity for this batch so later opening and reversal flows use the same genealogy basis.</p>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`RM / INT Lines${allLines.length ? ` (${allLines.length})` : ""}`}>
        {!strokeId ? (
          <p className="text-slate-400 text-sm py-6 text-center">Select a Stroke to auto-derive the RM/INT breakup.</p>
        ) : strokeDetailQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading stroke…</p>
        ) : allLines.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">This stroke has no RM/INT lines.</p>
        ) : (
          <>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
              Auto-derived from the Stroke standard (dosage% × output). Edit any line where the real historical
              consumption differed — un-edited figures are the <strong>standard</strong>, not a true actual.
            </p>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs text-slate-500">
                Add manual RM/INT rows when the historical batch used extra materials beyond the Stroke standard. Every line must carry its own storage location for future reversal safety.
              </p>
              <button type="button" className="border border-slate-300 rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={addManualLine}>
                Add Item Line
              </button>
            </div>
            {!locationOptions.length && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-3">
                No active storage locations are mapped to this company yet, so reversal-safe line capture cannot be completed.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">Material</th>
                    <th className="text-left py-2 px-3 border-b">Type</th>
                    <th className="text-right py-2 px-3 border-b">Dosage %</th>
                    <th className="text-right py-2 px-3 border-b">Standard Qty</th>
                    <th className="text-right py-2 px-3 border-b">Actual Qty</th>
                    <th className="text-left py-2 px-3 border-b">Storage Location</th>
                    <th className="text-left py-2 px-3 border-b">Approved</th>
                    <th className="text-right py-2 px-3 border-b">AP Approved Qty</th>
                    <th className="text-right py-2 px-3 border-b">Variance</th>
                    <th className="text-right py-2 px-3 border-b">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {allLines.map((l) => (
                    <tr key={l.key} className="border-b border-slate-100">
                      <td className="py-2 px-3 text-slate-700">
                        {l.is_manual ? (
                          <ErpComboboxField
                            value={l.material_id}
                            onChange={(value) => patchManualLine(l.key, { material_id: value })}
                            options={materialOptions}
                            placeholder="-- Select material --"
                            emptyStateLabel={materialsQ.isLoading ? "Loading materials..." : "No RM/INT materials"}
                          />
                        ) : l.material_label}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${l.line_material_type === "INT" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}`}>{l.line_material_type}</span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">{l.is_manual ? "--" : l.dosage_pct.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-400">{fmt(l.standard_qty)}</td>
                      <td className="py-2 px-3 text-right">
                        <input type="number" min="0" step="0.001"
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                          value={l.is_manual ? (manualLines.find((line) => line.id === l.key)?.actual_qty ?? "") : (lineEdits[l.key]?.actual_qty ?? "")}
                          placeholder={fmt(l.standard_qty)}
                          onChange={(e) => (l.is_manual ? patchManualLine(l.key, { actual_qty: e.target.value }) : patchLine(l.key, { actual_qty: e.target.value }))} />
                      </td>
                      <td className="py-2 px-3 w-64">
                        <ErpComboboxField
                          value={l.issue_sloc_id}
                          onChange={(value) => (l.is_manual ? patchManualLine(l.key, { issue_sloc_id: value }) : patchLine(l.key, { issue_sloc_id: value }))}
                          options={locationOptions}
                          placeholder="-- Select storage location --"
                          emptyStateLabel={locationQ.isLoading ? "Loading storage locations..." : "No storage locations mapped to this company"}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select className="border border-slate-300 rounded px-2 py-1 text-sm"
                          value={l.approved_status}
                          onChange={(e) => (l.is_manual ? patchManualLine(l.key, { approved_status: e.target.value }) : patchLine(l.key, { approved_status: e.target.value }))}>
                          {APPROVED_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input type="number" min="0" step="0.001"
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                          value={l.is_manual ? (manualLines.find((line) => line.id === l.key)?.ap_approved_qty ?? "") : (lineEdits[l.key]?.ap_approved_qty ?? "")}
                          placeholder={fmt(l.ap_approved_qty)}
                          onChange={(e) => (l.is_manual ? patchManualLine(l.key, { ap_approved_qty: e.target.value }) : patchLine(l.key, { ap_approved_qty: e.target.value }))} />
                      </td>
                      <td className={`py-2 px-3 text-right font-mono ${Math.abs(l.variance_qty) > 0.0005 ? "text-amber-700" : "text-slate-400"}`}>
                        {l.is_manual ? (
                          <input type="number" min="0" step="0.001"
                            className="w-24 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                            value={manualLines.find((line) => line.id === l.key)?.variance_qty ?? ""}
                            placeholder={fmt(l.variance_qty)}
                            onChange={(e) => patchManualLine(l.key, { variance_qty: e.target.value })} />
                        ) : fmt(l.variance_qty)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {l.is_manual ? (
                          <button type="button" className="text-rose-600 hover:text-rose-700 text-sm font-medium" onClick={() => removeManualLine(l.key)}>
                            Remove
                          </button>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="py-2 px-3" colSpan={4}>Total RM / INT</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(totalRm)}</td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              ⛔ Saving posts <strong>no stock movement</strong> — this is a genealogy/costing record only. The batch's
              physical balance comes from Opening Stock (IN05).
            </p>
          </>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}

