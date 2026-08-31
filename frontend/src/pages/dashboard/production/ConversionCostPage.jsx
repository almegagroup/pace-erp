/*
 * File-ID: 27.FE-AC04
 * File-Path: frontend/src/pages/dashboard/production/ConversionCostPage.jsx
 * Gate: 27.104 | Domain: PRODUCTION / COSTING (Accounts ACL)
 * Purpose: AC04 Conversion Cost Config (§104.8). ACCOUNTS-owned (not SA — SA can't know when a
 *          rate changes). Per-KG conversion cost keyed by company + segment + optional Prodshade
 *          override, dated by valid_from. A mistaken scope or rate can be corrected in place with
 *          an audit trail. Prodshade options come from approved strokes for the selected segment,
 *          never from batch-series configuration. Process PO Verify resolves by posting date.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { listConversionRates, createConversionRate, updateConversionRate, listConversionRateProdshades } from "./prodApi.js";

const SEGMENTS = [
  { value: "ADMIX",  label: "ADMIX — Admix" },
  { value: "HPS",    label: "HPS — Hypershot" },
  { value: "IWC",    label: "IWC" },
  { value: "POWDER", label: "POWDER" },
  { value: "INT",    label: "INT — Intermediate" },
];

const ERRORS = {
  PROD_CONV_RATE_INVALID:       "Company, segment, and valid-from date are required.",
  PROD_CONV_RATE_DATE_INVALID:  "Valid-from must be a valid date.",
  PROD_CONV_RATE_VALUE_INVALID: "Rate must be a number ≥ 0.",
  PROD_CONV_RATE_EXISTS:        "A rate for this company/segment/prodshade already has that valid-from date. Pick a different date.",
  PROD_CONV_RATE_PRODSHADE_INVALID: "Select an approved Prodshade for the selected company and segment.",
};
function friendly(code) { return ERRORS[code] ?? code; }

function companyLabel(c) {
  return [c?.company_code, c?.company_name].filter(Boolean).join(" — ");
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ id: "", segment_code: "ADMIX", scope: "DEFAULT", prodshade_material_id: "", valid_from: todayIso(), conversion_rate_per_kg: "" });

export default function ConversionCostPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("");
  const [saving, setSaving]     = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm]         = useState(emptyForm());

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  const { runtimeContext } = useMenu();
  const companies = useMemo(() => runtimeContext?.availableCompanies ?? [], [runtimeContext]);
  const companyOptions = companies.map((c) => ({ value: c.id, label: companyLabel(c) }));
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  // A company-level batch number series is deliberately not a Prodshade source: HPS and
  // MTO use one such series but still have many approved output Prodshades.
  const prodshadeQ = useQuery({
    queryKey: ["conversion-rate-prodshades", effectiveCompanyId, form.segment_code],
    queryFn: () => listConversionRateProdshades({ company_id: effectiveCompanyId, segment_code: form.segment_code }),
    enabled: !!effectiveCompanyId && editorOpen && form.scope === "OVERRIDE",
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const prodshadeOptions = useMemo(() => {
    return (prodshadeQ.data ?? []).map((row) => ({
      value: row.material_id,
      label: [row.material_name, row.shade_code ? `Shade ${row.shade_code}` : ""].filter(Boolean).join(" — "),
    }));
  }, [prodshadeQ.data]);

  const listQ = useQuery({
    queryKey: ["conversion-rates", effectiveCompanyId, segmentFilter],
    queryFn: () => listConversionRates({ company_id: effectiveCompanyId, segment_code: segmentFilter || undefined }),
    enabled: !!effectiveCompanyId,
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });
  const rows = listQ.data ?? [];

  async function handleSave(e) {
    e.preventDefault();
    if (!effectiveCompanyId || !form.segment_code || !form.valid_from) {
      toast("Company, segment, and valid-from date are required.", "error");
      return;
    }
    if (form.scope === "OVERRIDE" && !form.prodshade_material_id) {
      toast("Pick a Prodshade for an override, or switch to Segment default.", "error");
      return;
    }
    const rateNum = Number(form.conversion_rate_per_kg);
    if (form.conversion_rate_per_kg === "" || !Number.isFinite(rateNum) || rateNum < 0) {
      toast("Rate must be a number ≥ 0.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: effectiveCompanyId,
        segment_code: form.segment_code,
        prodshade_material_id: form.scope === "OVERRIDE" ? form.prodshade_material_id : null,
        valid_from: form.valid_from,
        conversion_rate_per_kg: rateNum,
      };
      if (form.id) {
        await updateConversionRate(form.id, payload);
        toast("Conversion rate corrected.");
      } else {
        await createConversionRate(payload);
        toast("Conversion rate added.");
      }
      setEditorOpen(false);
      setForm(emptyForm());
      qc.invalidateQueries({ queryKey: ["conversion-rates"] });
    } catch (err) { toast(friendly(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      title="Conversion Cost Config"
      subtitle="Accounts — per-KG conversion rate (§104.8). Every segment supports a default and Prodshade override. Approved strokes supply the relevant Prodshades; Process PO Verify uses the most specific rate valid on its posting date."
      actions={[{
        label: "New Rate",
        tone: "primary",
        mnemonic: "N",
        disabled: !companyId,
        onClick: () => { setForm(emptyForm()); setEditorOpen(true); },
      }]}
    >
      <ErpSectionCard>
        <div className="flex gap-3 mb-4">
          <div className="flex flex-col gap-1 w-72">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
              hint=""
            />
          </div>
          <div className="flex flex-col gap-1 w-56">
            <label className="text-xs text-slate-500">Segment</label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)}>
              <option value="">-- All segments --</option>
              {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
            </select>
          </div>
        </div>

        {!effectiveCompanyId ? (
          <p className="text-slate-400 text-sm py-6 text-center">Select a company to view its conversion rates.</p>
        ) : listQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No conversion rates for this company. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to add one. <span className="text-rose-500">Verify will hard-block until a rate exists for the segment/date.</span></p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                <th className="text-left py-2 px-3 border-b">Segment</th>
                <th className="text-left py-2 px-3 border-b">Scope</th>
                <th className="text-left py-2 px-3 border-b">Valid From</th>
                <th className="text-left py-2 px-3 border-b">Valid To</th>
                <th className="text-right py-2 px-3 border-b">Rate / KG (₹)</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
                <th className="text-right py-2 px-3 border-b">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">{r.segment_code}</span></td>
                  <td className="py-2 px-3 text-slate-500">
                    {r.prodshade
                      ? <span title="Prodshade override">{r.prodshade.material_name ?? "—"}{r.prodshade.shade_code ? ` — Shade ${r.prodshade.shade_code}` : ""}</span>
                      : <span className="italic text-slate-400">Segment default</span>}
                  </td>
                  <td className="py-2 px-3 font-mono">{r.valid_from}</td>
                  <td className="py-2 px-3 font-mono text-slate-400">{r.valid_to ?? "—"}</td>
                  <td className="py-2 px-3 text-right font-mono font-semibold">{Number(r.conversion_rate_per_kg).toFixed(4)}</td>
                  <td className="py-2 px-3">
                    {r.is_current
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Current</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Superseded</span>}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      type="button"
                      className="text-xs text-sky-700 hover:text-sky-900 font-medium"
                      onClick={() => {
                        setForm({
                          id: r.id,
                          segment_code: r.segment_code,
                          scope: r.prodshade_material_id ? "OVERRIDE" : "DEFAULT",
                          prodshade_material_id: r.prodshade_material_id ?? "",
                          valid_from: r.valid_from,
                          conversion_rate_per_kg: String(r.conversion_rate_per_kg ?? ""),
                        });
                        setEditorOpen(true);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      <DrawerBase visible={editorOpen} title={form.id ? "Edit Conversion Rate" : "New Conversion Rate"} onClose={() => setEditorOpen(false)}>
        <form onSubmit={handleSave} className="flex flex-col gap-4 p-4">
          <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2">
            <span className="font-medium">Company:</span> {companyOptions.find((o) => o.value === effectiveCompanyId)?.label ?? "—"}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Segment <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.segment_code} onChange={(e) => setForm((f) => ({ ...f, segment_code: e.target.value, prodshade_material_id: "" }))}>
              {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Scope <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value, prodshade_material_id: "" }))}>
              <option value="DEFAULT">Segment default (applies to all Prodshades)</option>
              <option value="OVERRIDE">Prodshade override (beats the segment default)</option>
            </select>
          </div>
          {form.scope === "OVERRIDE" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prodshade <span className="text-rose-500">*</span></label>
              <ErpComboboxField value={form.prodshade_material_id} onChange={(v) => setForm((f) => ({ ...f, prodshade_material_id: v }))} options={prodshadeOptions} emptyStateLabel={prodshadeQ.isLoading ? "Loading approved Prodshades..." : "No approved Prodshades for this segment"} />
              <p className="text-xs text-slate-400">Only Prodshades with an approved stroke for this company and segment are shown.</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Valid From <span className="text-rose-500">*</span></label>
            <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} required />
            <p className="text-xs text-slate-400">Applies from this date until a later-dated row supersedes it. Back-dated postings pick the rate valid on their posting date.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Conversion Rate / KG (₹) <span className="text-rose-500">*</span></label>
            <input type="number" min="0" step="0.0001" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.conversion_rate_per_kg} onChange={(e) => setForm((f) => ({ ...f, conversion_rate_per_kg: e.target.value }))} required placeholder="e.g. 1.95" />
          </div>
          {form.id && form.scope === "OVERRIDE" && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
              Changing a segment default into an override means the default no longer covers the other Prodshades. Add a separate default if they still need one.
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">{form.id ? "Save Correction" : "Add Rate"}</button>
            <button type="button" onClick={() => setEditorOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </form>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
