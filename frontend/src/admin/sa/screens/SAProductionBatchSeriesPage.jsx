/*
 * File-ID: 27.SA-01
 * File-Path: frontend/src/admin/sa/screens/SAProductionBatchSeriesPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: SA-only — configure batch number series per company (MTO/MTEST=company-level,
 *          HPS/IWC=per-prodshade). Prefix, count, year, active flag.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { listBatchSeries, createBatchSeries, updateBatchSeries } from "../../../pages/dashboard/production/prodApi.js";

const BATCH_TYPES = [
  { value: "MTO",   label: "MTO — Admix (company-level)" },
  { value: "HPS",   label: "HPS — Hypershot (per prodshade)" },
  { value: "IWC",   label: "IWC — (per prodshade)" },
  { value: "MTEST", label: "MTEST — Test batch (company-level)" },
];

const ERRORS = {
  PROD_BATCH_SERIES_INVALID:    "Company, batch type, prefix, and year are required.",
  PROD_BATCH_SERIES_DUPLICATE:  "A series for this company/type/prodshade already exists.",
  PROD_SA_REQUIRED:             "Super Admin access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const EMPTY_FORM = { company_id: "", batch_type: "MTO", prodshade_material_id: "", prefix: "", current_count: "0", financial_year: new Date().getFullYear().toString() };

export default function SAProductionBatchSeriesPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
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

  const listQ = useQuery({
    queryKey: ["batch-series", companyId],
    queryFn: () => listBatchSeries({ company_id: companyId || undefined }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });
  const series = listQ.data ?? [];

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await createBatchSeries({
        ...form,
        current_count: parseInt(form.current_count, 10) || 0,
        financial_year: parseInt(form.financial_year, 10),
        prodshade_material_id: form.prodshade_material_id || null,
      });
      toast("Batch series created.");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["batch-series"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  function openEdit(s) {
    setEditSeries(s);
    setEditDraft({ prefix: s.prefix, current_count: s.current_count, is_active: s.is_active });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateBatchSeries(editSeries.id, {
        prefix: editDraft.prefix,
        current_count: parseInt(editDraft.current_count, 10),
        is_active: editDraft.is_active,
      });
      toast("Series updated.");
      setEditSeries(null);
      qc.invalidateQueries({ queryKey: ["batch-series"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  const requiresProdshade = (t) => ["HPS", "IWC"].includes(t);

  return (
    <ErpScreenScaffold
      title="Production Batch Series"
      subtitle="SA — Configure batch number series per company and batch type"
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input className="border border-slate-300 rounded px-2 py-1 text-sm w-64" value={companyId} onChange={e => setCompanyId(e.target.value)} placeholder="Filter by company…" />
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
                <th className="text-right py-2 px-3 border-b">Year</th>
                <th className="text-left py-2 px-3 border-b">Active</th>
                <th className="py-2 px-3 border-b"></th>
              </tr>
            </thead>
            <tbody>
              {series.map(s => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3 font-mono text-xs text-slate-500">{s.company_id?.slice(0, 8)}…</td>
                  <td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">{s.batch_type}</span></td>
                  <td className="py-2 px-3 font-mono text-xs text-slate-500">{s.prodshade_material_id ? s.prodshade_material_id.slice(0, 8) + "…" : "Company-level"}</td>
                  <td className="py-2 px-3 font-mono font-semibold">{s.prefix}</td>
                  <td className="py-2 px-3 text-right font-mono">{s.current_count}</td>
                  <td className="py-2 px-3 text-right font-mono">{s.financial_year}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button onClick={() => openEdit(s)} className="text-xs text-sky-600 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      {/* Create Drawer */}
      <DrawerBase visible={createOpen} title="New Batch Series" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company ID <span className="text-rose-500">*</span></label>
            <input autoFocus className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Batch Type <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.batch_type} onChange={e => setForm(f => ({ ...f, batch_type: e.target.value }))}>
              {BATCH_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {requiresProdshade(form.batch_type) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prodshade Material ID <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.prodshade_material_id} onChange={e => setForm(f => ({ ...f, prodshade_material_id: e.target.value }))} required placeholder="UUID" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Prefix <span className="text-rose-500">*</span></label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} required placeholder="e.g. ASC-MTO" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Financial Year <span className="text-rose-500">*</span></label>
            <input type="number" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.financial_year} onChange={e => setForm(f => ({ ...f, financial_year: e.target.value }))} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Starting Count</label>
            <input type="number" min="0" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.current_count} onChange={e => setForm(f => ({ ...f, current_count: e.target.value }))} />
            <p className="text-xs text-slate-400">First batch will be {form.prefix}-{String((parseInt(form.current_count) || 0) + 1).padStart(4, "0")}</p>
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
              <p><span className="font-medium">Type:</span> {editSeries.batch_type}</p>
              <p><span className="font-medium">Year:</span> {editSeries.financial_year}</p>
              {editSeries.prodshade_material_id && <p><span className="font-medium">Prodshade:</span> {editSeries.prodshade_material_id.slice(0, 12)}…</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prefix</label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.prefix} onChange={e => setEditDraft(d => ({ ...d, prefix: e.target.value.toUpperCase() }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Current Count</label>
              <input type="number" min="0" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.current_count} onChange={e => setEditDraft(d => ({ ...d, current_count: e.target.value }))} />
              <p className="text-xs text-slate-400">Next batch: {editDraft.prefix}-{String((parseInt(editDraft.current_count) || 0) + 1).padStart(4, "0")}</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={editDraft.is_active} onChange={e => setEditDraft(d => ({ ...d, is_active: e.target.checked }))} className="rounded" />
              <label htmlFor="is_active" className="text-sm text-slate-700">Active</label>
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
