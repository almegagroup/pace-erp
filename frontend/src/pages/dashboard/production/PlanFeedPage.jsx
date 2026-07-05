/*
 * File-ID: 27.FE-00
 * File-Path: frontend/src/pages/dashboard/production/PlanFeedPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Plan Feed (FO) management. 3 tabs: Create | Edit | Total Table.
 *          Manager+ can create/edit/cancel. Keyboard-first (Alt+N=New, Alt+S=Save, Alt+X=Cancel).
 */

import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import {
  listPlanFeed, getPlanFeed, createPlanFeed, updatePlanFeed,
  cancelPlanFeed, getPlanFeedSummary,
} from "./prodApi.js";

const TABS = [
  { key: "create", label: "Create FO" },
  { key: "edit",   label: "Edit FO" },
  { key: "total",  label: "Total Table" },
];

const EMPTY_FO = {
  company_id: "", fo_number: "", party_name: "", sku: "", description: "",
  ordered_qty_kg: "", pack_qty: "", order_date: "", scheduled_delivery_date: "",
};

const ERRORS = {
  PROD_PLAN_FEED_INVALID: "Company, FO number, party name, SKU, ordered qty, and order date are required.",
  PROD_PLAN_FEED_FO_EXISTS: "FO number already exists for this company.",
  PROD_PLAN_FEED_LOCKED: "FO is edit-locked — Packing Orders exist.",
  PROD_PLAN_FEED_HAS_PACKING_ORDERS: "Delink all Packing Orders before cancelling.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendlyErr(code) { return ERRORS[code] ?? code; }

export default function PlanFeedPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("create");
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  // Create tab state
  const [form, setForm] = useState({ ...EMPTY_FO });
  const firstCreateRef = useRef(null);

  // Edit tab state
  const [editFoId, setEditFoId] = useState("");
  const [editData, setEditData] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editLoading, setEditLoading] = useState(false);

  // Total Table state
  const [foDetailModal, setFoDetailModal] = useState(null);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const listQ = useQuery({
    queryKey: ["prod-plan-feed-list", companyId],
    queryFn: () => listPlanFeed({ company_id: companyId || undefined, per_page: 50 }),
    select: d => (typeof d === "object" && "data" in d) ? d.data : (Array.isArray(d) ? d : []),
    enabled: tab !== "create",
  });

  const summaryQ = useQuery({
    queryKey: ["prod-plan-feed-summary", companyId],
    queryFn: () => getPlanFeedSummary({ company_id: companyId || undefined }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
    enabled: tab === "total",
  });

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await createPlanFeed({
        ...form,
        ordered_qty_kg: parseFloat(form.ordered_qty_kg),
        pack_qty: form.pack_qty ? parseInt(form.pack_qty, 10) : null,
      });
      toast("FO created successfully.");
      setForm({ ...EMPTY_FO });
      qc.invalidateQueries({ queryKey: ["prod-plan-feed"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function loadEditFo() {
    if (!editFoId) return;
    setEditLoading(true);
    setEditData(null);
    try {
      const d = await getPlanFeed(editFoId);
      setEditData(d);
      setEditDraft({
        party_name: d.party_name ?? "",
        sku: d.sku ?? "",
        description: d.description ?? "",
        ordered_qty_kg: d.ordered_qty_kg ?? "",
        pack_qty: d.pack_qty ?? "",
        order_date: d.order_date ?? "",
        scheduled_delivery_date: d.scheduled_delivery_date ?? "",
      });
    } catch { toast("FO not found.", "error"); }
    finally { setEditLoading(false); }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editData) return;
    setSaving(true);
    try {
      await updatePlanFeed(editData.id, {
        ...editDraft,
        ordered_qty_kg: parseFloat(editDraft.ordered_qty_kg),
        pack_qty: editDraft.pack_qty ? parseInt(editDraft.pack_qty, 10) : null,
      });
      toast("FO updated.");
      setEditData(d => ({ ...d, ...editDraft }));
      qc.invalidateQueries({ queryKey: ["prod-plan-feed"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleCancel() {
    if (!editData) return;
    if (!window.confirm(`Cancel FO ${editData.fo_number}? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await cancelPlanFeed(editData.id);
      toast("FO cancelled.");
      setEditData(null);
      setEditFoId("");
      qc.invalidateQueries({ queryKey: ["prod-plan-feed"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  const foList = listQ.data ?? [];
  const summary = summaryQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="Plan Feed"
      subtitle="Firm Order management — Create, Edit, Total Table"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      {/* Company filter */}
      <ErpSectionCard>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input className="border border-slate-300 rounded px-2 py-1 text-sm w-64" value={companyId} onChange={e => setCompanyId(e.target.value)} placeholder="Filter by company…" />
          </div>
          {/* Tab switcher */}
          <div className="flex gap-1 border border-slate-300 rounded overflow-hidden ml-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </ErpSectionCard>

      {/* ── Tab: Create ── */}
      {tab === "create" && (
        <ErpSectionCard title="New Firm Order">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4 max-w-2xl">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Company ID <span className="text-rose-500">*</span></label>
              <input ref={firstCreateRef} className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">FO Number <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.fo_number} onChange={e => setForm(f => ({ ...f, fo_number: e.target.value }))} required placeholder="e.g. FO-2026-001" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Party Name <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">SKU <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} required placeholder="Product SKU code" />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-xs text-slate-600 font-medium">Description</label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Ordered Qty (KG) <span className="text-rose-500">*</span></label>
              <input type="number" step="0.01" min="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.ordered_qty_kg} onChange={e => setForm(f => ({ ...f, ordered_qty_kg: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Pack Qty</label>
              <input type="number" step="1" min="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.pack_qty} onChange={e => setForm(f => ({ ...f, pack_qty: e.target.value }))} placeholder="# of packs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Order Date <span className="text-rose-500">*</span></label>
              <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Scheduled Delivery</label>
              <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.scheduled_delivery_date} onChange={e => setForm(f => ({ ...f, scheduled_delivery_date: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">
                <u>S</u>ave FO
              </button>
              <button type="button" onClick={() => setForm({ ...EMPTY_FO })} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50">
                Clear
              </button>
            </div>
          </form>
        </ErpSectionCard>
      )}

      {/* ── Tab: Edit ── */}
      {tab === "edit" && (
        <>
          <ErpSectionCard title="Find FO to Edit">
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">FO ID (UUID)</label>
                <input className="border border-slate-300 rounded px-2 py-1 text-sm w-80 font-mono" value={editFoId} onChange={e => setEditFoId(e.target.value)} placeholder="Paste FO ID or select from list below…" onKeyDown={e => e.key === "Enter" && loadEditFo()} />
              </div>
              <button onClick={loadEditFo} disabled={!editFoId || editLoading} className="px-4 py-1.5 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
                Load FO
              </button>
            </div>

            {/* Quick-select list */}
            {foList.length > 0 && !editData && (
              <div className="mt-3">
                <p className="text-xs text-slate-500 mb-2">Recent FOs — click to load:</p>
                <div className="flex flex-col divide-y divide-slate-100 max-h-48 overflow-y-auto border border-slate-200 rounded">
                  {foList.map(fo => (
                    <button key={fo.id} onClick={() => { setEditFoId(fo.id); loadEditFo(); }}
                      className="flex items-center justify-between px-3 py-2 text-sm hover:bg-sky-50 text-left">
                      <span className="font-mono font-medium text-sky-700">{fo.fo_number}</span>
                      <span className="text-slate-500">{fo.party_name}</span>
                      <span className="text-slate-400 text-xs">{fo.order_date}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </ErpSectionCard>

          {editData && (
            <ErpSectionCard title={`Editing: ${editData.fo_number}`} tone={editData.status === "CANCELLED" ? "warning" : "default"}>
              {editData.status === "CANCELLED" && (
                <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                  This FO is cancelled and cannot be edited.
                </div>
              )}
              <form onSubmit={handleSaveEdit} className="grid grid-cols-2 gap-4 max-w-2xl">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-600 font-medium">Party Name</label>
                  <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.party_name} onChange={e => setEditDraft(d => ({ ...d, party_name: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-600 font-medium">SKU</label>
                  <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.sku} onChange={e => setEditDraft(d => ({ ...d, sku: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-xs text-slate-600 font-medium">Description</label>
                  <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.description} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-600 font-medium">Ordered Qty (KG)</label>
                  <input type="number" step="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.ordered_qty_kg} onChange={e => setEditDraft(d => ({ ...d, ordered_qty_kg: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-600 font-medium">Pack Qty</label>
                  <input type="number" step="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.pack_qty} onChange={e => setEditDraft(d => ({ ...d, pack_qty: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-600 font-medium">Order Date</label>
                  <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.order_date} onChange={e => setEditDraft(d => ({ ...d, order_date: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-600 font-medium">Scheduled Delivery</label>
                  <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.scheduled_delivery_date} onChange={e => setEditDraft(d => ({ ...d, scheduled_delivery_date: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                </div>
                {editData.status !== "CANCELLED" && (
                  <div className="col-span-2 flex gap-3 pt-2">
                    <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">Save Changes</button>
                    <button type="button" onClick={handleCancel} disabled={saving} className="px-4 py-2 border border-rose-300 text-rose-700 text-sm rounded hover:bg-rose-50 disabled:opacity-50">Cancel FO</button>
                  </div>
                )}
              </form>
            </ErpSectionCard>
          )}
        </>
      )}

      {/* ── Tab: Total Table ── */}
      {tab === "total" && (
        <ErpSectionCard title="Total Table — Order Summary">
          {summaryQ.isLoading ? (
            <p className="text-slate-400 text-sm py-6 text-center">Loading summary…</p>
          ) : summary.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No active FOs found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">FO #</th>
                    <th className="text-left py-2 px-3 border-b">Party</th>
                    <th className="text-left py-2 px-3 border-b">SKU</th>
                    <th className="text-right py-2 px-3 border-b">Ordered KG</th>
                    <th className="text-right py-2 px-3 border-b">Pack Qty</th>
                    <th className="text-right py-2 px-3 border-b">KG Linked</th>
                    <th className="text-right py-2 px-3 border-b">Pack PO Count</th>
                    <th className="text-right py-2 px-3 border-b">Dispatched KG</th>
                    <th className="text-right py-2 px-3 border-b">Pending KG</th>
                    <th className="text-left py-2 px-3 border-b">Del Date</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(row => (
                    <tr key={row.fo_number} className="border-b border-slate-100 hover:bg-sky-50 cursor-pointer" onClick={() => setFoDetailModal(row)}>
                      <td className="py-2 px-3 font-mono font-semibold text-sky-700">{row.fo_number}</td>
                      <td className="py-2 px-3">{row.party_name}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{row.sku}</td>
                      <td className="py-2 px-3 text-right font-mono">{Number(row.ordered_qty_kg).toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.pack_qty ?? "—"}</td>
                      <td className="py-2 px-3 text-right font-mono">{Number(row.kg_linked_to_packing_pos).toLocaleString()}</td>
                      <td className="py-2 px-3 text-right">
                        <button className="text-sky-600 underline font-mono">{row.packing_po_count}</button>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-700">{Number(row.dispatched_qty_kg).toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono text-amber-700">{Number(row.pending_dispatch_kg).toLocaleString()}</td>
                      <td className="py-2 px-3 text-slate-400 text-xs">{row.scheduled_delivery_date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      )}

      {/* FO Detail Modal (Packing Orders list) */}
      {foDetailModal && (
        <ModalBase
          visible={!!foDetailModal}
          title={`FO ${foDetailModal.fo_number} — Packing Orders`}
          onClose={() => setFoDetailModal(null)}
        >
          <div className="p-4">
            {(foDetailModal.packing_orders ?? []).length === 0 ? (
              <p className="text-slate-400 text-sm">No packing orders linked.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">Pack PO #</th>
                    <th className="text-left py-2 px-3 border-b">Process Order</th>
                    <th className="text-left py-2 px-3 border-b">Status</th>
                    <th className="text-right py-2 px-3 border-b">Planned KG</th>
                  </tr>
                </thead>
                <tbody>
                  {foDetailModal.packing_orders.map(po => (
                    <tr key={po.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-mono">{po.po_number}</td>
                      <td className="py-2 px-3 text-slate-500">{po.process_order_id?.slice(0, 8)}</td>
                      <td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{po.status}</span></td>
                      <td className="py-2 px-3 text-right font-mono">{Number(po.planned_qty_kg).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </ModalBase>
      )}
    </ErpScreenScaffold>
  );
}
