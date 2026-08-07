/*
 * File-ID: 27.FE-PR23
 * File-Path: frontend/src/pages/dashboard/production/OldPackingPoPage.jsx
 * Gate: 27.104.9 | Domain: PRODUCTION / COSTING
 * Purpose: PR23 "Old Packing PO" (§104.9.1). Genealogy for a pre-go-live FG batch: links to its
 *          parent Old Process PO (PR22) and records the SFG + PM breakup that produced the packed
 *          FG. PM lines auto-derive from the Pack BOM and stay editable. Saving writes a FINAL
 *          packing_order + packing_order_line (FG/SFG/PM) and posts NO stock movement — the FG's
 *          real balance came from IN05's P561 opening posting.
 *          Sequence: this page first -> then Opening Stock (IN05).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  listOldProcessPoBatches, createOldPackingPo, listPackBoms, getPackBom, listPackCodes,
} from "./prodApi.js";
import { listMaterials, listStorageLocations } from "../om/omApi.js";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";

const ERRORS = {
  PROD_OLD_PACKING_PO_INVALID: "Company, parent batch, SKU and Actual Qty are required.",
  PROD_OLD_PACKING_PO_FG_SLOC_REQUIRED: "FG storage location is required.",
  PROD_OLD_PACKING_PO_PARENT_NOT_FOUND: "Parent Old Process PO not found for this company.",
  PROD_OLD_PACKING_PO_PARENT_NOT_OPENING: "The selected Process PO is not an opening-genealogy order.",
  PROD_OLD_PACKING_PO_BATCH_EXISTS: "A Packing PO already exists for this SKU + batch.",
  PROD_OLD_OPENING_BATCH_NOT_FOUND: "This batch has no posted Opening Stock (IN05).",
  PROD_OLD_OPENING_QTY_MISMATCH: "Actual Qty KG does not match the opening FG stock for this batch.",
};
function friendly(code, fallback) { return ERRORS[code] ?? fallback ?? code; }

function materialLabel(m) {
  if (!m) return "--";
  return [m.pace_code || m.external_code, m.material_name].filter(Boolean).join(" - ");
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return num(v).toFixed(3); }

export default function OldPackingPoPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [processOrderId, setProcessOrderId] = useState("");
  const [skuMaterialId, setSkuMaterialId] = useState("");
  const [packCodeId, setPackCodeId] = useState("");
  const [numPacks, setNumPacks] = useState("");
  const [fillQty, setFillQty] = useState("");
  const [actualQtyKg, setActualQtyKg] = useState("");
  const [fgSlocId, setFgSlocId] = useState("");
  const [sfgSlocId, setSfgSlocId] = useState("");
  const [pmEdits, setPmEdits] = useState({});
  const [manualPmLines, setManualPmLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const nextManualPmId = useRef(1);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 5000);
  }

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => {
    if (!companyId && effectiveCompanyId) setCompanyId(effectiveCompanyId);
  }, [companyId, effectiveCompanyId]);

  // Parent batches = opening-origin Process POs (PR22) for this company.
  const parentsQ = useQuery({
    queryKey: ["old-process-po-batches", effectiveCompanyId],
    queryFn: () => listOldProcessPoBatches({ company_id: effectiveCompanyId }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const parents = parentsQ.data ?? [];
  const parentOptions = parents.map((p) => ({
    value: p.id,
    label: `${p.batch_number} · ${materialLabel(p.prodshade)} · ${p.po_type} · ${fmt(p.actual_qty)} KG`,
  }));
  const parent = parents.find((p) => p.id === processOrderId) ?? null;

  const fgMaterialsQ = useQuery({
    queryKey: ["old-pack-fg-materials"],
    queryFn: () => listMaterials({ material_type: "FG", limit: 500 }),
    select: (d) => d?.data ?? [],
  });
  const skuOptions = (fgMaterialsQ.data ?? []).map((m) => ({ value: m.id, label: materialLabel(m) }));
  const selectedSku = (fgMaterialsQ.data ?? []).find((m) => m.id === skuMaterialId) ?? null;

  const pmMaterialsQ = useQuery({
    queryKey: ["old-pack-pm-materials"],
    queryFn: () => listMaterials({ material_type: "PM", limit: 500 }),
    select: (d) => d?.data ?? [],
  });
  const pmMaterialOptions = (pmMaterialsQ.data ?? []).map((m) => ({ value: m.id, label: materialLabel(m) }));
  const pmMaterialById = useMemo(
    () => new Map((pmMaterialsQ.data ?? []).map((m) => [m.id, m])),
    [pmMaterialsQ.data],
  );

  const packCodesQ = useQuery({
    queryKey: ["old-pack-codes"],
    queryFn: () => listPackCodes(),
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const packCodeOptions = (packCodesQ.data ?? []).map((p) => ({
    value: p.id, label: [p.pack_code, p.pack_name ?? p.description].filter(Boolean).join(" - "),
  }));

  const locationsQ = useQuery({
    queryKey: ["old-pack-locations", effectiveCompanyId],
    queryFn: () => listStorageLocations({ company_id: effectiveCompanyId, is_active: true }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const locationOptions = (locationsQ.data ?? []).map((l) => ({
    value: l.id, label: [l.code || l.location_code, l.name || l.location_name].filter(Boolean).join(" - "),
  }));

  // Pack BOM for this SKU → PM lines (auto-derived, editable).
  const packBomListQ = useQuery({
    queryKey: ["old-pack-bom-list", effectiveCompanyId, skuMaterialId],
    queryFn: () => listPackBoms({ company_id: effectiveCompanyId, sku_material_id: skuMaterialId, status: "ACTIVE" }),
    enabled: !!effectiveCompanyId && !!skuMaterialId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const packBomId = (packBomListQ.data ?? [])[0]?.id ?? "";
  const packBomQ = useQuery({
    queryKey: ["old-pack-bom", packBomId],
    queryFn: () => getPackBom(packBomId),
    enabled: !!packBomId,
  });
  const bomPmLines = useMemo(
    () => (packBomQ.data?.lines ?? []).filter((l) => String(l.line_type ?? "").toUpperCase() === "PM"),
    [packBomQ.data],
  );

  const packs = num(numPacks);
  const derivedPmLines = useMemo(() => bomPmLines.map((line, idx) => {
    const key = `bom:${line.id || idx}:${line.material_id}`;
    const perPack = num(line.qty_per_pack ?? line.qty);
    const standardQty = perPack * packs;
    const edit = pmEdits[key] ?? {};
    const qty = edit.actual_qty !== undefined && edit.actual_qty !== "" ? num(edit.actual_qty) : standardQty;
    return {
      key,
      material_id: line.material_id,
      material_label: materialLabel(line.material),
      qty_per_pack: perPack,
      standard_qty: standardQty,
      actual_qty: qty,
      issue_sloc_id: edit.issue_sloc_id ?? (line.storage_location_id || ""),
      uom_code: line.uom_code || line.material?.base_uom_code || "EA",
      display_order: idx + 1,
      is_manual: false,
    };
  }), [bomPmLines, packs, pmEdits]);

  const normalizedManualPmLines = useMemo(() => manualPmLines.map((line, idx) => {
    const material = pmMaterialById.get(line.material_id) ?? null;
    return {
      key: line.id,
      material_id: line.material_id,
      material_label: materialLabel(material),
      qty_per_pack: line.qty_per_pack !== "" ? num(line.qty_per_pack) : 0,
      standard_qty: 0,
      actual_qty: line.actual_qty !== "" ? num(line.actual_qty) : 0,
      issue_sloc_id: line.issue_sloc_id || "",
      uom_code: line.uom_code || material?.base_uom_code || "EA",
      display_order: derivedPmLines.length + idx + 1,
      is_manual: true,
    };
  }), [derivedPmLines.length, manualPmLines, pmMaterialById]);

  function patchPm(lineKey, patch) {
    setPmEdits((cur) => ({ ...cur, [lineKey]: { ...(cur[lineKey] ?? {}), ...patch } }));
  }

  function addManualPmLine() {
    const id = `manual-pm-${nextManualPmId.current++}`;
    setManualPmLines((cur) => [...cur, {
      id,
      material_id: "",
      qty_per_pack: "",
      actual_qty: "",
      issue_sloc_id: "",
      uom_code: "EA",
    }]);
  }

  function patchManualPmLine(lineId, patch) {
    setManualPmLines((cur) => cur.map((line) => {
      if (line.id !== lineId) return line;
      const next = { ...line, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "material_id")) {
        const material = pmMaterialById.get(patch.material_id) ?? null;
        next.uom_code = material?.base_uom_code || "EA";
      }
      return next;
    }));
  }

  function removeManualPmLine(lineId) {
    setManualPmLines((cur) => cur.filter((line) => line.id !== lineId));
  }

  const poType = parent?.po_type ? packingPoTypeForProcessType(parent.po_type) : "";
  const allPmLines = useMemo(() => [...derivedPmLines, ...normalizedManualPmLines], [derivedPmLines, normalizedManualPmLines]);
  const pmLinesToSave = useMemo(
    () => allPmLines.filter((line) => num(line.actual_qty) > 0),
    [allPmLines],
  );
  const hasInvalidPmLine = pmLinesToSave.some((line) => !line.material_id || !line.issue_sloc_id);
  const needsSfgLine = !!parent?.material_id;
  const canSave = !!effectiveCompanyId && !!processOrderId && !!skuMaterialId && num(actualQtyKg) > 0 && !!fgSlocId && (!needsSfgLine || !!sfgSlocId) && !hasInvalidPmLine;

  async function handleSave() {
    if (!canSave) { toast("Fill Company, parent batch, SKU, Actual Qty and FG location.", "error"); return; }
    setSaving(true);
    try {
      const res = await createOldPackingPo({
        company_id: effectiveCompanyId,
        po_type: poType || null,
        process_order_id: processOrderId,
        material_id: skuMaterialId,
        pack_code_id: packCodeId || null,
        num_packs: num(numPacks) || null,
        fill_qty_per_pack: num(fillQty) || null,
        actual_qty_kg: num(actualQtyKg),
        fg_sloc_id: fgSlocId,
        sfg_material_id: parent?.material_id ?? null,
        sfg_sloc_id: sfgSlocId || null,
        lines: pmLinesToSave.map((l) => ({
          material_id: l.material_id,
          qty_per_pack: l.qty_per_pack,
          total_qty: l.actual_qty,
          actual_qty: l.actual_qty,
          issue_sloc_id: l.issue_sloc_id || null,
          uom_code: l.uom_code,
        })),
      });
      toast(`Old Packing PO ${res?.po_number ?? ""} created for batch ${res?.batch_number ?? ""} — no stock moved.`);
      setSkuMaterialId(""); setNumPacks(""); setFillQty(""); setActualQtyKg(""); setPmEdits({}); setManualPmLines([]);
      qc.invalidateQueries({ queryKey: ["old-process-po-batches"] });
    } catch (err) {
      toast(friendly(err.code, err.message), "error");
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      title="Old Packing PO"
      subtitle="PR23 — genealogy for a pre-go-live FG batch (§104.9). Links to its parent Old Process PO; FG, SFG, and PM lines all carry explicit storage locations for later reversal-safe traceability. Saves a FINAL paper order; posts NO stock movement."
      actions={[{ label: "Save", tone: "primary", mnemonic: "S", disabled: !canSave || saving, onClick: handleSave }]}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Header">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(v) => { setCompanyId(v); setProcessOrderId(""); }}
              label="Company"
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs font-medium text-slate-600">Parent Old Process PO (batch) <span className="text-rose-500">*</span></label>
            <ErpComboboxField value={processOrderId} onChange={setProcessOrderId} options={parentOptions} placeholder="-- Select parent batch --" emptyStateLabel="No Old Process PO batches — create PR22 first" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Packing PO Type</label>
            <input className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-sm font-mono text-slate-500" value={poType || "--"} readOnly />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs font-medium text-slate-600">FG SKU <span className="text-rose-500">*</span></label>
            <ErpComboboxField value={skuMaterialId} onChange={(v) => { setSkuMaterialId(v); setPmEdits({}); }} options={skuOptions} placeholder="-- Select SKU --" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Pack Code</label>
            <ErpComboboxField value={packCodeId} onChange={setPackCodeId} options={packCodeOptions} placeholder="-- Optional --" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Num Packs</label>
            <input type="number" min="0" step="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={numPacks} onChange={(e) => setNumPacks(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Fill Qty / Pack</label>
            <input type="number" min="0" step="0.001" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={fillQty} onChange={(e) => setFillQty(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Actual Qty (KG) <span className="text-rose-500">*</span></label>
            <input type="number" min="0" step="0.001" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={actualQtyKg} onChange={(e) => setActualQtyKg(e.target.value)} />
            <p className="text-xs text-slate-400">Enter the historical packed FG quantity for this batch.</p>
          </div>
        </div>
        {parent && (
          <p className="text-xs text-slate-500 mt-3">
            Parent batch <span className="font-mono font-semibold">{parent.batch_number}</span> · SFG{" "}
            {materialLabel(parent.prodshade)} · output {fmt(parent.actual_qty)} KG. The FG line inherits this batch number.
          </p>
        )}
      </ErpSectionCard>

      <ErpSectionCard title="FG / SFG Lines">
        {!locationOptions.length && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-3">
            No active storage locations are mapped to this company yet, so FG/SFG line capture cannot be completed.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                <th className="text-left py-2 px-3 border-b">Line Type</th>
                <th className="text-left py-2 px-3 border-b">Material</th>
                <th className="text-right py-2 px-3 border-b">Qty (KG)</th>
                <th className="text-left py-2 px-3 border-b">Storage Location</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">FG</span></td>
                <td className="py-2 px-3 text-slate-700">{materialLabel(selectedSku)}</td>
                <td className="py-2 px-3 text-right font-mono">{fmt(actualQtyKg)}</td>
                <td className="py-2 px-3 w-80">
                  <ErpComboboxField
                    value={fgSlocId}
                    onChange={setFgSlocId}
                    options={locationOptions}
                    placeholder="-- Select FG storage location --"
                    emptyStateLabel={locationsQ.isLoading ? "Loading storage locations..." : "No storage locations mapped to this company"}
                  />
                </td>
              </tr>
              {needsSfgLine && (
                <tr className="border-b border-slate-100">
                  <td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700">SFG</span></td>
                  <td className="py-2 px-3 text-slate-700">{materialLabel(parent?.prodshade)}</td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(actualQtyKg)}</td>
                  <td className="py-2 px-3 w-80">
                    <ErpComboboxField
                      value={sfgSlocId}
                      onChange={setSfgSlocId}
                      options={locationOptions}
                      placeholder="-- Select SFG storage location --"
                      emptyStateLabel={locationsQ.isLoading ? "Loading storage locations..." : "No storage locations mapped to this company"}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`PM Lines${allPmLines.length ? ` (${allPmLines.length})` : ""}`}>
        {!skuMaterialId ? (
          <p className="text-slate-400 text-sm py-6 text-center">Select an FG SKU to auto-derive PM lines from its Pack BOM.</p>
        ) : packBomListQ.isLoading || packBomQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading Pack BOM…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs text-slate-500">
                PM rows auto-derive from the Pack BOM when present. Add manual PM rows when the historical batch used packaging materials outside the stored BOM pattern.
              </p>
              <button type="button" className="border border-slate-300 rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={addManualPmLine}>
                Add PM Line
              </button>
            </div>
            {!packBomId && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
                No active Pack BOM is linked to this SKU right now. You can still capture manual PM lines for genealogy.
              </p>
            )}
            {packBomId && derivedPmLines.length === 0 && (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2 mb-3">
                This Pack BOM contributes no PM lines automatically for this batch. Add manual PM rows only if the historical batch used them.
              </p>
            )}
            {allPmLines.length === 0 ? (
              <p className="text-slate-400 text-sm py-6 text-center">No PM lines yet. Use Add PM Line if this historical batch consumed packaging materials.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                      <th className="text-left py-2 px-3 border-b">PM Material</th>
                      <th className="text-right py-2 px-3 border-b">Qty / Pack</th>
                      <th className="text-right py-2 px-3 border-b">Standard Qty</th>
                      <th className="text-right py-2 px-3 border-b">Actual Qty</th>
                      <th className="text-left py-2 px-3 border-b">Issue Location</th>
                      <th className="text-right py-2 px-3 border-b">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPmLines.map((l) => (
                      <tr key={l.key} className="border-b border-slate-100">
                        <td className="py-2 px-3 text-slate-700">
                          {l.is_manual ? (
                            <ErpComboboxField
                              value={l.material_id}
                              onChange={(value) => patchManualPmLine(l.key, { material_id: value })}
                              options={pmMaterialOptions}
                              placeholder="-- Select PM --"
                              emptyStateLabel={pmMaterialsQ.isLoading ? "Loading PM materials..." : "No PM materials"}
                            />
                          ) : l.material_label}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {l.is_manual ? (
                            <input type="number" min="0" step="0.001"
                              className="w-24 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                              value={manualPmLines.find((line) => line.id === l.key)?.qty_per_pack ?? ""}
                              placeholder={fmt(l.qty_per_pack)}
                              onChange={(e) => patchManualPmLine(l.key, { qty_per_pack: e.target.value })} />
                          ) : <span className="font-mono text-slate-500">{fmt(l.qty_per_pack)}</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-400">{fmt(l.standard_qty)}</td>
                        <td className="py-2 px-3 text-right">
                          <input type="number" min="0" step="0.001"
                            className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                            value={l.is_manual ? (manualPmLines.find((line) => line.id === l.key)?.actual_qty ?? "") : (pmEdits[l.key]?.actual_qty ?? "")}
                            placeholder={fmt(l.standard_qty)}
                            onChange={(e) => (l.is_manual ? patchManualPmLine(l.key, { actual_qty: e.target.value }) : patchPm(l.key, { actual_qty: e.target.value }))} />
                        </td>
                        <td className="py-2 px-3 w-64">
                          <ErpComboboxField
                            value={l.issue_sloc_id}
                            onChange={(value) => (l.is_manual ? patchManualPmLine(l.key, { issue_sloc_id: value }) : patchPm(l.key, { issue_sloc_id: value }))}
                            options={locationOptions}
                            placeholder="-- Select storage location --"
                            emptyStateLabel={locationsQ.isLoading ? "Loading storage locations..." : "No storage locations mapped to this company"}
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          {l.is_manual ? (
                            <button type="button" className="text-rose-600 hover:text-rose-700 text-sm font-medium" onClick={() => removeManualPmLine(l.key)}>
                              Remove
                            </button>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <p className="text-xs text-slate-500 mt-3">
          ⛔ Saving posts <strong>no stock movement</strong> — genealogy/costing record only. The FG balance comes from
          Opening Stock (IN05).
        </p>
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}

