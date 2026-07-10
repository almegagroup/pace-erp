/*
 * File-ID: 27.SA-01
 * File-Path: frontend/src/admin/sa/screens/SAProductionBatchSeriesPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: SA-only — configure batch number series per company. MTO/HPS/MTEST
 *          are company-level (one series each, no Prodshade). MTS (IWC+Powder
 *          unified) is per-Prodshade — one series per Prodshade. No financial
 *          year reset — count wraps 99999 -> 1 (83.7, corrected 2026-07-11).
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { listBatchSeries, createBatchSeries, updateBatchSeries } from "../../../pages/dashboard/production/prodApi.js";
import { listCompaniesForOm, listMaterials } from "../../../pages/dashboard/om/omApi.js";

const BATCH_TYPES = [
  { value: "MTO",   label: "MTO — Admix (company-level)" },
  { value: "HPS",   label: "HPS — Hypershot (company-level)" },
  { value: "MTS",   label: "MTS — IWC + Powder (per Prodshade)" },
  { value: "MTEST", label: "MTEST — Test batch (company-level)" },
];

const ERRORS = {
  PROD_BATCH_SERIES_INVALID:            "Company, batch type, and prefix are required.",
  PROD_BATCH_SERIES_PRODSHADE_REQUIRED: "Prodshade is required for MTS.",
  PROD_BATCH_SERIES_EXISTS:             "A series for this company/type/prodshade already exists.",
  PROD_SA_REQUIRED:                     "Super Admin access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const EMPTY_FORM = { company_id: "", batch_type: "MTO", prodshade_material_id: "", prefix: "", current_count: "0" };

function requiresProdshade(t) { return t === "MTS"; }

export default function SAProductionBatchSeriesPage() {
  const qc = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState("");
  const [saving, setSaving]       = useState(false);
  const [notice, setNotice]       = useState({ msg: "", tone: "success" });
  const [createOpen, setCreateOpen] = useState(false);
  const [editSeries, setEditSeries] = useState(null);
  const [form, setForm]           = useState({ ...EMPTY_FORM });
  const [editDraft, setEditDraft] = useState({});

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const companiesQ = useQuery({ queryKey: ["om-companies"], queryFn: () => listCompaniesForOm() });
  const sfgMaterialsQ = useQuery({ queryKey: ["om-materials", "SFG"], queryFn: () => listMaterials({ material_type: "SFG", limit: 500 }), select: (d) => d?.data ?? [] });
  const intMaterialsQ = useQuery({ queryKey: ["om-materials", "INT"], queryFn: () => listMaterials({ material_type: "INT", limit: 500 }), select: (d) => d?.data ?? [] });

  const companies = companiesQ.data ?? [];
  const prodshadeMaterials = [...(sfgMaterialsQ.data ?? []), ...(intMaterialsQ.data ?? [])];
  const companyOptions = companies.map((c) => ({ value: c.id, label: `${c.company_code} — ${c.company_name}` }));
  const companyLabelById = new Map(companies.map((c) => [c.id, `${c.company_code} — ${c.company_name}`]));
  const prodshadeOptions = prodshadeMaterials.map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }));

  const listQ = useQuery({
    queryKey: ["batch-series", companyFilter],
    queryFn: () => listBatchSeries({ company_id: companyFilter || undefined }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });
  const series = listQ.data ?? [];

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.company_id || !form.prefix.trim()) {
      toast("Company and prefix are required.", "error");
      return;
    }
    if (requiresProdshade(form.batch_type) && !form.prodshade_material_id) {
      toast("Prodshade is required for MTS.", "error");
      return;
    }
    setSaving(true);
    try {
      await createBatchSeries({
        company_id: form.company_id,
        batch_type: form.batch_type,
        prefix: form.prefix,
        current_count: parseInt(form.current_count, 10) || 0,
        prodshade_material_id: requiresProdshade(form.batch_type) ? form.prodshade_material_id : null,
      });
      toast("Batch series created.");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["batch-series"] });
    } catch (err) { toast(friendly(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  function openEdit(s) {
    setEditSeries(s);
    setEditDraft({ prefix: s.prefix, current_count: String(s.current_count ?? 0), active: s.active });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateBatchSeries(editSeries.id, {
        prefix: editDraft.prefix,
        current_count: parseInt(editDraft.current_count, 10),
        active: editDraft.active,
      });
      toast("Series updated.");
      setEditSeries(null);
      qc.invalidateQueries({ queryKey: ["batch-series"] });
    } catch (err) { toast(friendly(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      title="Production Batch Series"
      subtitle="SA — configure batch number series per company. MTO/HPS/MTEST = company-level. MTS = per Prodshade. No FY reset — wraps 99999 → 1."
      actions={[{
        label: "New Series",
        tone: "primary",
        mnemonic: "N",
        onClick: () => { setForm({ ...EMPTY_FORM }); setCreateOpen(true); },
      }]}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard>
        <div className="flex gap-3 mb-4">
          <div className="flex flex-col gap-1 w-64">
            <label className="text-xs text-slate-500">Company</label>
            <ErpComboboxField value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="-- All companies --" />
          </div>
        </div>

        {listQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading…</p>
        ) : series.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No batch series configured. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                <th className="text-left py-2 px-3 border-b">Company</th>
                <th className="text-left py-2 px-3 border-b">Type</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Prefix</th>
                <th className="text-right py-2 px-3 border-b">Current Count</th>
                <th className="text-left py-2 px-3 border-b">Next Batch</th>
                <th className="text-left py-2 px-3 border-b">Active</th>
                <th className="py-2 px-3 border-b"></th>
              </tr>
            </thead>
            <tbody>
              {series.map(s => {
                const nextCount = (Number(s.current_count) >= 99999 ? 1 : Number(s.current_count) + 1);
                return (
                  <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-600">{companyLabelById.get(s.company_id) ?? "—"}</td>
                    <td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">{s.batch_type}</span></td>
                    <td className="py-2 px-3 text-slate-500">{s.material ? `${s.material.pace_code ?? "—"} — ${s.material.material_name ?? ""}` : "Company-level"}</td>
                    <td className="py-2 px-3 font-mono font-semibold">{s.prefix}</td>
                    <td className="py-2 px-3 text-right font-mono">{s.current_count}</td>
                    <td className="py-2 px-3 font-mono text-slate-400">{s.prefix}{String(nextCount).padStart(5, "0")}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {s.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button onClick={() => openEdit(s)} className="text-xs text-sky-600 hover:underline">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      {/* Create Drawer */}
      <DrawerBase visible={createOpen} title="New Batch Series" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company <span className="text-rose-500">*</span></label>
            <ErpComboboxField value={form.company_id} onChange={(v) => setForm(f => ({ ...f, company_id: v }))} options={companyOptions} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Batch Type <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.batch_type} onChange={e => setForm(f => ({ ...f, batch_type: e.target.value, prodshade_material_id: "" }))}>
              {BATCH_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {requiresProdshade(form.batch_type) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prodshade <span className="text-rose-500">*</span></label>
              <ErpComboboxField value={form.prodshade_material_id} onChange={(v) => setForm(f => ({ ...f, prodshade_material_id: v }))} options={prodshadeOptions} emptyStateLabel="No SFG/INT prodshades found" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Prefix <span className="text-rose-500">*</span></label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} required placeholder="e.g. BM" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Starting Count</label>
            <input type="number" min="0" max="99999" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.current_count} onChange={e => setForm(f => ({ ...f, current_count: e.target.value }))} />
            <p className="text-xs text-slate-400">First batch will be {form.prefix}{String(((parseInt(form.current_count) || 0) % 99999) + 1).padStart(5, "0")}. Wraps to 1 after 99999 — no financial-year reset.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">Create Series</button>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </form>
      </DrawerBase>

      {/* Edit Drawer */}
      <DrawerBase visible={!!editSeries} title={editSeries ? `Edit: ${editSeries.prefix}` : ""} onClose={() => setEditSeries(null)}>
        {editSeries && (
          <form onSubmit={handleSaveEdit} className="flex flex-col gap-4 p-4">
            <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2 space-y-1">
              <p><span className="font-medium">Company:</span> {companyLabelById.get(editSeries.company_id) ?? "—"}</p>
              <p><span className="font-medium">Type:</span> {editSeries.batch_type}</p>
              {editSeries.material && <p><span className="font-medium">Prodshade:</span> {editSeries.material.pace_code ?? "—"} — {editSeries.material.material_name ?? ""}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prefix</label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.prefix} onChange={e => setEditDraft(d => ({ ...d, prefix: e.target.value.toUpperCase() }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Current Count</label>
              <input type="number" min="0" max="99999" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.current_count} onChange={e => setEditDraft(d => ({ ...d, current_count: e.target.value }))} />
              <p className="text-xs text-slate-400">Next batch: {editDraft.prefix}{String((((parseInt(editDraft.current_count) || 0)) % 99999) + 1).padStart(5, "0")}</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="active" checked={editDraft.active} onChange={e => setEditDraft(d => ({ ...d, active: e.target.checked }))} className="rounded" />
              <label htmlFor="active" className="text-sm text-slate-700">Active</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">Save Changes</button>
              <button type="button" onClick={() => setEditSeries(null)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
            </div>
          </form>
        )}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
