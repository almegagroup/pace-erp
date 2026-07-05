/*
 * File-ID: 27.SA-02
 * File-Path: frontend/src/admin/sa/screens/SAProductionSegmentLocationPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: SA/Manager — configure production segment location mapping per company.
 *          Segment (ADMIX/HPS/IWC/POWDER/INT) → rm_sloc, pm_sloc, shopfloor_sloc, fg_sloc.
 *          Used at Verify to determine where P261/P101 stock movements post.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { listSegmentLocations, upsertSegmentLocation } from "../../../pages/dashboard/production/prodApi.js";

const SEGMENTS = ["ADMIX", "HPS", "IWC", "POWDER", "INT"];

const ERRORS = {
  PROD_SEGMENT_LOCATION_INVALID: "Company, segment, and at least one storage location are required.",
  PROD_MANAGER_OR_SA_REQUIRED:   "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const EMPTY_FORM = { company_id: "", segment_code: "ADMIX", rm_sloc_id: "", pm_sloc_id: "", shopfloor_sloc_id: "", fg_sloc_id: "" };

export default function SAProductionSegmentLocationPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving]       = useState(false);
  const [notice, setNotice]       = useState({ msg: "", tone: "success" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editEntry, setEditEntry]  = useState(null);
  const [form, setForm]            = useState({ ...EMPTY_FORM });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const listQ = useQuery({
    queryKey: ["segment-locs", companyId],
    queryFn: () => listSegmentLocations({ company_id: companyId || undefined }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });
  const entries = listQ.data ?? [];

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertSegmentLocation({
        company_id: form.company_id,
        segment_code: form.segment_code,
        rm_sloc_id: form.rm_sloc_id || null,
        pm_sloc_id: form.pm_sloc_id || null,
        shopfloor_sloc_id: form.shopfloor_sloc_id || null,
        fg_sloc_id: form.fg_sloc_id || null,
      });
      toast(editEntry ? "Config updated." : "Config created.");
      setDrawerOpen(false);
      setEditEntry(null);
      qc.invalidateQueries({ queryKey: ["segment-locs"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  function openCreate() {
    setEditEntry(null);
    setForm({ ...EMPTY_FORM });
    setDrawerOpen(true);
  }

  function openEdit(entry) {
    setEditEntry(entry);
    setForm({
      company_id: entry.company_id,
      segment_code: entry.segment_code,
      rm_sloc_id: entry.rm_sloc_id ?? "",
      pm_sloc_id: entry.pm_sloc_id ?? "",
      shopfloor_sloc_id: entry.shopfloor_sloc_id ?? "",
      fg_sloc_id: entry.fg_sloc_id ?? "",
    });
    setDrawerOpen(true);
  }

  return (
    <ErpScreenScaffold
      title="Segment Location Config"
      subtitle="Map production segments to storage locations per company"
      actions={[{
        label: "New Config",
        tone: "primary",
        mnemonic: "N",
        onClick: openCreate,
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

        {/* Explanation */}
        <div className="mb-4 px-3 py-2 bg-sky-50 border border-sky-200 rounded text-xs text-sky-700">
          <strong>How this is used:</strong> At Process Order VERIFY, P261 (RM consumption) posts from <code>rm_sloc</code>,
          PM consumption from <code>pm_sloc</code>, and P101 (FG receipt) posts to <code>shopfloor_sloc</code>.
        </div>

        {listQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No configs found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left py-2 px-3 border-b">Company</th>
                  <th className="text-left py-2 px-3 border-b">Segment</th>
                  <th className="text-left py-2 px-3 border-b">RM Sloc</th>
                  <th className="text-left py-2 px-3 border-b">PM Sloc</th>
                  <th className="text-left py-2 px-3 border-b">Shopfloor Sloc</th>
                  <th className="text-left py-2 px-3 border-b">FG Sloc</th>
                  <th className="py-2 px-3 border-b"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id ?? `${e.company_id}-${e.segment_code}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono text-xs text-slate-500">{e.company_id?.slice(0, 8)}…</td>
                    <td className="py-2 px-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">{e.segment_code}</span>
                    </td>
                    <SlocCell id={e.rm_sloc_id} name={e.rm_sloc?.location_code} />
                    <SlocCell id={e.pm_sloc_id} name={e.pm_sloc?.location_code} />
                    <SlocCell id={e.shopfloor_sloc_id} name={e.shopfloor_sloc?.location_code} />
                    <SlocCell id={e.fg_sloc_id} name={e.fg_sloc?.location_code} />
                    <td className="py-2 px-3 text-right">
                      <button onClick={() => openEdit(e)} className="text-xs text-sky-600 hover:underline">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>

      {/* Create / Edit Drawer */}
      <DrawerBase
        visible={drawerOpen}
        title={editEntry ? `Edit: ${editEntry.segment_code}` : "New Segment Location Config"}
        onClose={() => { setDrawerOpen(false); setEditEntry(null); }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company ID <span className="text-rose-500">*</span></label>
            <input
              autoFocus
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              value={form.company_id}
              onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
              required
              disabled={!!editEntry}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Segment <span className="text-rose-500">*</span></label>
            <select
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              value={form.segment_code}
              onChange={e => setForm(f => ({ ...f, segment_code: e.target.value }))}
              disabled={!!editEntry}
            >
              {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {editEntry && <p className="text-xs text-slate-400">Company and segment cannot be changed. Create a new config to change.</p>}
          </div>
          {[
            { key: "rm_sloc_id", label: "RM Storage Location ID", hint: "Source for raw material P261" },
            { key: "pm_sloc_id", label: "PM Storage Location ID", hint: "Source for packaging material P261" },
            { key: "shopfloor_sloc_id", label: "Shopfloor Sloc ID", hint: "FG destination for P101 (production GR)" },
            { key: "fg_sloc_id", label: "FG Storage Location ID", hint: "Final FG sloc (optional)" },
          ].map(({ key, label, hint }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">{label}</label>
              <input
                className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder="UUID"
              />
              <p className="text-xs text-slate-400">{hint}</p>
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
              {editEntry ? "Update Config" : "Create Config"}
            </button>
            <button type="button" onClick={() => { setDrawerOpen(false); setEditEntry(null); }} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </form>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}

function SlocCell({ id, name }) {
  if (!id) return <td className="py-2 px-3 text-slate-300 text-xs">—</td>;
  return <td className="py-2 px-3 font-mono text-xs">{name ?? id.slice(0, 8) + "…"}</td>;
}
