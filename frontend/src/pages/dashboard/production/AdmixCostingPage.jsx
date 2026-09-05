/*
 * File-ID: 27.FE-AC07
 * File-Path: frontend/src/pages/dashboard/production/AdmixCostingPage.jsx
 * Gate: 27.132 | Domain: PRODUCTION / COSTING (Accounts ACL)
 * Purpose: AC07 Admixture Costing -- read-only report. Pick a Company + FG
 *          SKU, choose one or more Strokes (Prodshade auto-derived), pick a
 *          Costing Month (or Manual), and see the dosage-weighted RM/INT
 *          cost + PM cost reconciled into an FG cost per pack, side by side
 *          per stroke. No pace codes shown (§35.18/§114.23 convention).
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { pushToast } from "../../../store/uiToast.js";
import { useMenu } from "../../../context/useMenu.js";
import { listAc07Skus, listAc07Strokes, listAc07Months, getAc07Costing } from "./prodApi.js";

const ERRORS = {
  AC07_COSTING_INVALID: "Company, SKU, and at least one Stroke are required.",
  AC07_SKU_NOT_FOUND: "SKU not found.",
  AC07_SKU_INVALID: "The selected material is not an active FG SKU.",
  AC07_SKU_COMPANY_INVALID: "The selected SKU is not active for this company.",
  AC07_STROKE_NOT_FOUND: "None of the selected strokes belong to this company.",
  AC07_MONTH_NOT_FOUND: "Costing month not found for this company.",
};
function friendly(code, message) { return ERRORS[code] ?? message ?? code; }

function fmt(n, d = 6) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  return Number.isFinite(num) ? num.toFixed(d) : "—";
}

export default function AdmixCostingPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [skuId, setSkuId] = useState("");
  const [selectedStrokeIds, setSelectedStrokeIds] = useState([]);
  const [monthId, setMonthId] = useState(""); // "" => Manual
  const [perPackQty, setPerPackQty] = useState("");
  const [perPackQtySkuId, setPerPackQtySkuId] = useState("");
  const [manualRates, setManualRates] = useState({}); // material_id -> string, only used when monthId === ""
  const [exporting, setExporting] = useState(false);

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  function toast(msg, tone = "success") { pushToast({ message: msg, tone }); }

  const skusQ = useQuery({
    queryKey: ["ac07-skus", effectiveCompanyId],
    queryFn: () => listAc07Skus({ company_id: effectiveCompanyId }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const skus = skusQ.data ?? [];
  const selectedSku = skus.find((s) => s.id === skuId) ?? null;

  const strokesQ = useQuery({
    queryKey: ["ac07-strokes", effectiveCompanyId, selectedSku?.prodshade_material_id],
    queryFn: () => listAc07Strokes({ company_id: effectiveCompanyId, prodshade_material_id: selectedSku.prodshade_material_id }),
    enabled: !!effectiveCompanyId && !!selectedSku?.prodshade_material_id,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const strokes = strokesQ.data ?? [];

  const monthsQ = useQuery({
    queryKey: ["ac07-months", effectiveCompanyId],
    queryFn: () => listAc07Months({ company_id: effectiveCompanyId }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const months = monthsQ.data ?? [];

  useEffect(() => {
    setSkuId("");
    setSelectedStrokeIds([]);
    setMonthId("");
    setPerPackQty("");
    setPerPackQtySkuId("");
    setManualRates({});
  }, [effectiveCompanyId]);

  // Reset downstream selections whenever the SKU changes -- a stroke/month
  // picked for a different SKU has no meaning here.
  useEffect(() => { setSelectedStrokeIds([]); setManualRates({}); }, [skuId]);

  const costingQ = useQuery({
    queryKey: ["ac07-costing", effectiveCompanyId, skuId, selectedStrokeIds.slice().sort().join(","), monthId],
    queryFn: () => getAc07Costing({
      company_id: effectiveCompanyId, sku_material_id: skuId,
      stroke_ids: selectedStrokeIds.join(","), ac06_month_id: monthId || undefined,
    }),
    enabled: !!effectiveCompanyId && !!skuId && selectedStrokeIds.length > 0,
  });
  const costing = costingQ.data ?? null;

  // Per Pack Qty follows the server's suggested/fixed default the moment new
  // costing data lands, but only resets when the SKU itself changes -- the
  // user's own edit (for an editable/599-style pack code) must survive a
  // stroke add/remove or a month switch, which both refetch this query.
  useEffect(() => {
    if (!costing) return;
    if (perPackQtySkuId !== skuId) {
      setPerPackQty(costing.per_pack_qty_default != null ? String(costing.per_pack_qty_default) : "");
      setPerPackQtySkuId(skuId);
    }
  }, [costing, skuId, perPackQtySkuId]);

  useEffect(() => {
    if (!costing || monthId) return; // only seed manual inputs in Manual mode
    setManualRates((current) => {
      const next = { ...current };
      costing.rm_int_rows.forEach((row) => { if (!(row.material_id in next)) next[row.material_id] = ""; });
      return next;
    });
  }, [costing, monthId]);

  const rateFor = (row) => {
    if (monthId) return row.rate;
    const raw = manualRates[row.material_id];
    if (raw === "" || raw === undefined || raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  // Formula always applies Wastage/OTHR on top of Rate, for RM/INT and PM
  // alike (FLAT_OTHER = flat currency add, PERCENT = % add) -- business
  // owner directive 2026-09-05: the formula itself is correct and uniform;
  // any material whose AC06 Rate already has wastage baked in historically
  // must have its own AC06 Wastage/OTHR value zeroed at the DATA level
  // (done for CMP003/CMP006's existing PM lines), not special-cased here.
  const pmPackCost = useMemo(() => {
    if (!costing) return null;
    return costing.pm_rows.reduce((sum, row) => {
      const rate = rateFor(row);
      if (rate == null) return sum;
      const adjustment = Number(row.wastage_other_pct ?? 0);
      const adjustedUnitRate = row.wastage_other_mode === "FLAT_OTHER"
        ? rate + adjustment
        : rate * (1 + adjustment / 100);
      return sum + adjustedUnitRate * Number(row.qty_per_pack ?? 0);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costing, manualRates, monthId]);

  const ppq = Number(perPackQty) || 0;
  const pmc = pmPackCost != null && ppq > 0 ? pmPackCost / ppq : null;
  const strokeCostings = useMemo(() => {
    if (!costing) return [];
    return selectedStrokeIds.map((strokeId) => {
      const stroke = costing.strokes.find((item) => item.id === strokeId);
      const rmc = costing.rm_int_rows.reduce((sum, row) => {
        const rate = rateFor(row);
        const dosage = Number(row.dosage_by_stroke?.[strokeId] ?? 0);
        return rate == null ? sum : sum + (dosage / 100) * rate * (1 + Number(row.wastage_other_pct ?? 0) / 100);
      }, 0);
      const conversionRate = stroke?.conversion_rate ?? null;
      const sfgCost = conversionRate == null ? null : rmc + conversionRate;
      const fgCostPerKg = sfgCost != null && pmc != null ? sfgCost + pmc : null;
      return {
        strokeId,
        strokeNumber: stroke?.stroke_number ?? strokes.find((item) => item.id === strokeId)?.stroke_number ?? "",
        poType: stroke?.po_type ?? "",
        segmentCode: stroke?.segment_code ?? null,
        rmc,
        conversionRate,
        sfgCost,
        fgCostPerKg,
        fgCostPerPack: fgCostPerKg != null ? fgCostPerKg * ppq : null,
      };
    });
    // rateFor reads the manual-rate state that is already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costing, manualRates, monthId, selectedStrokeIds, pmc, ppq, strokes]);

  async function handleExport() {
    if (!costing) return;
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `ac07_admix_costing_${selectedSku?.material_name ?? "sku"}.xlsx`,
        sheetName: "Admix Costing",
        columns: [
          { key: "section", label: "Section", width: "100px" },
          { key: "costing_group_name", label: "Costing Group", width: "140px" },
          { key: "material_type", label: "Type", width: "70px" },
          { key: "material_name", label: "Item", width: "220px" },
          { key: "external_code", label: "External Code", width: "110px" },
          { key: "rate", label: "Rate", width: "110px", align: "right", numFmt: "0.##########" },
          { key: "wastage_other_pct", label: "Wastage / OTHR", width: "120px", align: "right", numFmt: "0.##########" },
          { key: "wastage_other_mode", label: "Basis", width: "95px" },
          { key: "qty_per_pack", label: "Qty / Pack", width: "100px", align: "right", numFmt: "0.##########" },
          { key: "pm_line_cost", label: "PM Line Cost / Pack", width: "140px", align: "right", numFmt: "0.##########" },
          ...strokeCostings.flatMap((item) => [
            { key: `dosage_${item.strokeId}`, label: `Stroke ${item.strokeNumber} Dosage%`, width: "120px", align: "right", numFmt: "0.####" },
            { key: `cost_${item.strokeId}`, label: `Stroke ${item.strokeNumber} Cost`, width: "140px", align: "right", numFmt: "0.##########" },
          ]),
        ],
        rows: [
          ...costing.rm_int_rows.map((row) => ({
            section: "RM / INT",
            costing_group_name: row.costing_group_name || "Standalone",
            material_type: row.material_type,
            material_name: row.material_name,
            external_code: row.external_code,
            rate: rateFor(row),
            wastage_other_pct: row.wastage_other_pct,
            wastage_other_mode: "%",
            ...Object.fromEntries(strokeCostings.flatMap((item) => {
              const dosage = row.dosage_by_stroke?.[item.strokeId] ?? null;
              const rate = rateFor(row);
              const lineCost = rate == null ? null : (Number(dosage ?? 0) / 100) * rate * (1 + Number(row.wastage_other_pct ?? 0) / 100);
              return [[`dosage_${item.strokeId}`, dosage], [`cost_${item.strokeId}`, lineCost]];
            })),
          })),
          ...costing.pm_rows.map((row) => ({
            section: "PM",
            costing_group_name: row.costing_group_name || "Standalone",
            material_type: "PM",
            material_name: row.material_name,
            external_code: row.external_code,
            rate: rateFor(row),
            wastage_other_pct: row.wastage_other_pct,
            wastage_other_mode: row.wastage_other_mode === "FLAT_OTHER" ? "₹ flat/unit" : "%",
            qty_per_pack: row.qty_per_pack,
            pm_line_cost: rateFor(row) == null ? null : (
              row.wastage_other_mode === "FLAT_OTHER"
                ? rateFor(row) + Number(row.wastage_other_pct ?? 0)
                : rateFor(row) * (1 + Number(row.wastage_other_pct ?? 0) / 100)
            ) * Number(row.qty_per_pack ?? 0),
          })),
          ...[
            ["RMC / kg", "rmc"], ["Conversion / kg", "conversionRate"], ["SFG Cost / kg", "sfgCost"],
            ["PMC / kg", "pmc"], ["FG Cost / kg", "fgCostPerKg"], ["FG Cost / Pack", "fgCostPerPack"],
          ].map(([label, key]) => ({
            section: "SUMMARY",
            material_name: label,
            ...Object.fromEntries(strokeCostings.map((item) => [`cost_${item.strokeId}`, key === "pmc" ? pmc : item[key]])),
          })),
        ],
      });
    } catch (err) { toast(err.message ?? "Export failed.", "error"); }
    finally { setExporting(false); }
  }

  const skuOptions = skus.map((s) => ({ value: s.id, label: [s.material_name, s.document_name].filter(Boolean).join(" — ") }));

  return (
    <ErpScreenScaffold
      title="Admixture Costing"
      subtitle="Accounts — dosage-weighted RM/INT + PM cost for an Admix FG SKU, reconciled per pack. Read-only; nothing here is saved."
    >
      <ErpSectionCard>
        <div className="grid grid-cols-5 gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" hint="" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">SKU</label>
            <ErpComboboxField value={skuId} onChange={setSkuId} options={skuOptions}
              placeholder={skusQ.isFetching ? "Loading SKUs..." : "-- Select FG SKU --"} emptyStateLabel="No SKU mapped to this company" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Description <span className="text-slate-400">(auto)</span></label>
            <div className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-slate-50 text-slate-500 italic truncate">{selectedSku?.document_name || "—"}</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Prodshade <span className="text-slate-400">(auto)</span></label>
            <div className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-slate-50 text-slate-500 italic truncate">{selectedSku?.prodshade_material_name || "—"}</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Costing Month</label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={monthId} onChange={(e) => setMonthId(e.target.value)}>
              <option value="">Manual</option>
              {months.map((m) => (
                <option key={m.id} value={m.id}>{m.rate_month} {m.status === "CLOSED" ? "(Closed)" : "(Open)"}</option>
              ))}
            </select>
          </div>
        </div>

        {!selectedSku ? (
          <p className="text-slate-400 text-sm py-6 text-center">Select a Company and FG SKU to begin.</p>
        ) : (
          <>
            <div className="border border-slate-200 rounded p-3 mb-4 flex flex-wrap items-center gap-5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stroke (multi-select)</span>
              {strokesQ.isFetching ? (
                <span className="text-xs text-slate-400 italic">Loading strokes…</span>
              ) : strokes.length === 0 ? (
                <span className="text-xs text-slate-400 italic">No strokes found for this Prodshade in this company.</span>
              ) : strokes.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedStrokeIds.includes(s.id)}
                    onChange={() => setSelectedStrokeIds((prev) => prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id])}
                  />
                  <b>Stroke {s.stroke_number}</b>
                  <span className="text-xs text-slate-400">({s.status} · {s.po_type})</span>
                </label>
              ))}
              <span className="text-xs text-slate-400 italic">selecting more strokes adds columns to the table below, live</span>
            </div>

            {costing && (
              <div className="border border-slate-200 rounded p-3 mb-4 flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Per Pack UOM Qty</span>
                  <input
                    type="number" step="any" min="0.01"
                    className={`w-28 border rounded px-2 py-1 text-sm font-mono ${costing.per_pack_qty_editable ? "border-sky-400 bg-sky-50 text-sky-800 font-semibold" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                    value={perPackQty}
                    disabled={!costing.per_pack_qty_editable}
                    onChange={(e) => setPerPackQty(e.target.value)}
                  />
                  <span className="text-xs text-slate-400">{costing.pack_code_info?.outer_uom_code ?? ""} per {costing.pack_code_info?.pack_name ?? "pack"}</span>
                </label>
                <span className="text-xs text-slate-400">
                  {costing.per_pack_qty_editable
                    ? "Variable-fill pack code — editable, changes recalculate everything below live."
                    : costing.pack_code_info?.bom_required
                      ? "Fixed-BOM pack code — read-only, from Pack BOM's OUTPUT row."
                      : "Tanker (000) — fixed at 1 KG, read-only."}
                </span>
              </div>
            )}

            {costingQ.isFetching ? (
              <p className="text-slate-400 text-sm py-6 text-center">Loading costing…</p>
            ) : costingQ.isError ? (
              <p className="text-rose-500 text-sm py-6 text-center">{friendly(costingQ.error?.code, costingQ.error?.message)}</p>
            ) : !costing ? (
              <p className="text-slate-400 text-sm py-6 text-center">Pick at least one Stroke to load the costing table.</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">RM / INT — dosage-weighted (Stroke Master), per KG of SFG</h3>
                  <button type="button" onClick={handleExport} disabled={exporting} className="border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50">
                    ⇩ Export to Excel
                  </button>
                </div>
                <ErpDenseGrid
                  rowKey={(row) => row.material_id}
                  rows={costing.rm_int_rows}
                  maxHeight="280px"
                  columns={[
                    { key: "costing_group_name", label: "Group", width: "100px", render: (row) => row.costing_group_name || <span className="italic text-slate-400">Standalone</span> },
                    { key: "material_type", label: "Type", width: "50px" },
                    { key: "material_name", label: "Item", width: "220px" },
                    { key: "external_code", label: "Ext. Code", width: "90px", render: (row) => row.external_code || "—" },
                    {
                      key: "rate", label: "Rate", width: "100px", align: "right",
                      render: (row) => monthId
                        ? fmt(row.rate, 6)
                        : (
                          <input type="number" step="any" className="w-24 border border-sky-400 bg-sky-50 rounded px-1.5 py-0.5 text-right font-mono text-sky-800 font-semibold"
                            placeholder="0.00" value={manualRates[row.material_id] ?? ""}
                            onChange={(e) => setManualRates((c) => ({ ...c, [row.material_id]: e.target.value }))} />
                        ),
                    },
                    { key: "wastage_other_pct", label: "Wastage %", width: "90px", align: "right", render: (row) => row.wastage_other_pct == null ? "—" : `${fmt(row.wastage_other_pct, 2)}%` },
                    ...strokeCostings.flatMap((item) => [
                      {
                        key: `dosage_${item.strokeId}`, label: `Stroke ${item.strokeNumber} Dosage%`, width: "110px", align: "right",
                        render: (row) => fmt(row.dosage_by_stroke?.[item.strokeId], 4),
                      },
                      {
                        key: `line_cost_${item.strokeId}`, label: `Stroke ${item.strokeNumber} Cost/KG`, width: "130px", align: "right",
                        render: (row) => {
                          const rate = rateFor(row);
                          const dosage = Number(row.dosage_by_stroke?.[item.strokeId] ?? 0);
                          return rate == null ? "—" : fmt((dosage / 100) * rate * (1 + Number(row.wastage_other_pct ?? 0) / 100), 6);
                        },
                      },
                    ]),
                  ]}
                  emptyMessage="No RM/INT lines for the selected strokes."
                />

                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-4 mb-2">
                  PM — {costing.pack_code_info?.pack_name ?? costing.sku.pack_code}
                  {costing.pm_source === "category_fallback" && (
                    <span className="ml-2 font-normal normal-case text-amber-700">(no packing history for this SKU — using {costing.pm_source_sku_pace_code}'s composition, same category + pack code)</span>
                  )}
                  {costing.pm_source === "none" && <span className="ml-2 font-normal normal-case text-rose-600">(no PM composition found anywhere for this pack code/category)</span>}
                </h3>
                <ErpDenseGrid
                  rowKey={(row) => row.material_id}
                  rows={costing.pm_rows}
                  maxHeight="none"
                  columns={[
                    { key: "costing_group_name", label: "Group", width: "100px", render: (row) => row.costing_group_name || <span className="italic text-slate-400">Standalone</span> },
                    { key: "material_name", label: "Item", width: "220px" },
                    { key: "external_code", label: "Ext. Code", width: "90px", render: (row) => row.external_code || "—" },
                    {
                      key: "rate", label: "Rate", width: "100px", align: "right",
                      render: (row) => monthId
                        ? fmt(row.rate, 6)
                        : (
                          <input type="number" step="any" className="w-24 border border-sky-400 bg-sky-50 rounded px-1.5 py-0.5 text-right font-mono text-sky-800 font-semibold"
                            placeholder="0.00" value={manualRates[row.material_id] ?? ""}
                            onChange={(e) => setManualRates((c) => ({ ...c, [row.material_id]: e.target.value }))} />
                        ),
                    },
                    {
                      key: "wastage_other_pct", label: "Wastage / OTHR", width: "110px", align: "right",
                      render: (row) => row.wastage_other_pct == null ? "—" : row.wastage_other_mode === "FLAT_OTHER"
                        ? <span title="Flat amount per unit">₹ {fmt(row.wastage_other_pct, 2)}</span>
                        : <span>{fmt(row.wastage_other_pct, 2)}%</span>,
                    },
                    { key: "qty_per_pack", label: "Qty / Pack", width: "90px", align: "right", render: (row) => fmt(row.qty_per_pack, 4) },
                    {
                      key: "line_cost", label: "Line Cost / Pack", width: "120px", align: "right",
                      render: (row) => {
                        const rate = rateFor(row);
                        if (rate == null) return "—";
                        const adjustment = Number(row.wastage_other_pct ?? 0);
                        const adjustedUnitRate = row.wastage_other_mode === "FLAT_OTHER" ? rate + adjustment : rate * (1 + adjustment / 100);
                        return fmt(adjustedUnitRate * Number(row.qty_per_pack ?? 0), 6);
                      },
                    },
                  ]}
                  emptyMessage="No PM composition available."
                />
                <p className="text-xs text-slate-400 mt-1">PM's Wastage/OTHR (₹ flat for Barrel, % for everything else) is added on top of Rate, same as RM/INT. Materials whose Rate already includes it historically have their Wastage/OTHR set to 0 in AC06.</p>

                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-5 mb-2">Stroke-wise Costing — side by side</h3>
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(strokeCostings.length, 3)}, minmax(300px, 1fr))` }}>
                  {strokeCostings.map((item) => (
                    <div key={item.strokeId} className="border border-slate-200 rounded overflow-hidden text-sm">
                      <div className="bg-sky-50 border-b border-sky-200 px-4 py-2 flex items-center justify-between">
                        <b className="text-sky-800">Stroke {item.strokeNumber}</b>
                        <span className="text-xs text-slate-500">{item.poType}{item.segmentCode ? ` · ${item.segmentCode}` : ""}</span>
                      </div>
                      <div className="p-4">
                        <div className="flex justify-between py-1 border-b border-dashed"><span>RMC</span><b className="font-mono">₹ {fmt(item.rmc)} /kg</b></div>
                        <div className="flex justify-between py-1 border-b border-dashed"><span>Conversion Cost <span className="text-xs text-slate-400">(AC04)</span></span><b className="font-mono">{item.conversionRate == null ? "not configured" : `₹ ${fmt(item.conversionRate)} /kg`}</b></div>
                        <div className="flex justify-between py-1.5 border-t border-slate-300 font-bold"><span>SFG Cost</span><span className="font-mono">{item.sfgCost == null ? "—" : `₹ ${fmt(item.sfgCost)} /kg`}</span></div>
                        <div className="flex justify-between py-1 border-b border-dashed mt-1"><span>PMC</span><b className="font-mono">{pmc == null ? "—" : `₹ ${fmt(pmc)} /kg`}</b></div>
                        <div className="flex justify-between py-1.5 border-t border-slate-300 font-bold"><span>FG Cost</span><span className="font-mono">{item.fgCostPerKg == null ? "—" : `₹ ${fmt(item.fgCostPerKg)} /kg`}</span></div>
                        <div className="flex justify-between py-2 border-t-2 border-sky-600 font-bold text-base mt-1"><span>FG Cost / Pack</span><span className="font-mono text-emerald-700">{item.fgCostPerPack == null ? "—" : `₹ ${fmt(item.fgCostPerPack, 2)}`}</span></div>
                        <div className="text-xs text-slate-400 text-right mt-1">1 pack = {fmt(ppq, 2)} {costing.pack_code_info?.outer_uom_code ?? "unit"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
