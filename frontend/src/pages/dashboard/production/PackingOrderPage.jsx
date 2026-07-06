/*
 * File-ID: 27.FE-05
 * File-Path: frontend/src/pages/dashboard/production/PackingOrderPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Packing Order management — links FG batches to pack codes + FO dispatch.
 *          Status: STANDARD → FINAL | REVERSED.
 *          PM consumption posted at FINALIZE (P261). Alt+N=New.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import {
  listPackingOrders, getPackingOrder, createPackingOrder,
  updatePackingOrderLines, linkFo, finalizePackingOrder, reversePackingOrder,
} from "./prodApi.js";

const STATUS_COLORS = {
  STANDARD: "bg-slate-100 text-slate-700",
  FINAL:    "bg-emerald-100 text-emerald-700",
  REVERSED: "bg-gray-100 text-gray-500",
};

const ERRORS = {
  PROD_PACKING_ORDER_INVALID:         "Company, process order, and pack code config are required.",
  PROD_PACKING_ORDER_NOT_FOUND:       "Packing order not found.",
  PROD_PACKING_ORDER_WRONG_STATUS:    "Action not valid for current status.",
  PROD_PACKING_ORDER_PROCESS_NOT_VERIFIED: "Process order must be VERIFIED before creating a packing order.",
  PROD_MANAGER_OR_SA_REQUIRED:        "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}

const EMPTY_FORM = { company_id: "", process_order_id: "", pack_code_config_id: "", planned_qty_kg: "", fo_id: "" };

export default function PackingOrderPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [statusFilter, setStatus] = useState("");
  const [saving, setSaving]       = useState(false);
  const [notice, setNotice]       = useState({ msg: "", tone: "success" });

  const [createOpen, setCreateOpen]     = useState(false);
  const [detailId, setDetailId]         = useState(null);
  const [linkFoModal, setLinkFoModal]   = useState(false);
  const [linkFoId, setLinkFoId]         = useState("");
  const [editLinesOpen, setEditLinesOpen] = useState(false);
  const [linesDraft, setLinesDraft]     = useState([]);
  const [finalizeModal, setFinalizeModal] = useState(false);
  const [form, setForm]                 = useState({ ...EMPTY_FORM });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const listQ = useQuery({
    queryKey: ["pack-orders", companyId, statusFilter],
    queryFn: () => listPackingOrders({
      company_id: companyId || undefined,
      status: statusFilter || undefined,
      per_page: 100,
    }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });

  const detailQ = useQuery({
    queryKey: ["pack-order-detail", detailId],
    queryFn: () => getPackingOrder(detailId),
    enabled: !!detailId,
  });

  const order = detailQ.data;
  const orders = listQ.data ?? [];

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await createPackingOrder({
        ...form,
        planned_qty_kg: parseFloat(form.planned_qty_kg),
        fo_id: form.fo_id || null,
        pack_code_config_id: form.pack_code_config_id || null,
      });
      toast("Packing Order created.");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleLinkFo() {
    if (!linkFoId.trim()) return;
    setSaving(true);
    try {
      await linkFo(detailId, { fo_id: linkFoId });
      toast("FO linked.");
      setLinkFoModal(false);
      setLinkFoId("");
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  function openEditLines() {
    if (!order?.lines) return;
    setLinesDraft(order.lines.map(l => ({ ...l })));
    setEditLinesOpen(true);
  }

  async function handleSaveLines(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updatePackingOrderLines(detailId, { lines: linesDraft });
      toast("Lines updated.");
      setEditLinesOpen(false);
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleFinalize() {
    if (!window.confirm("Finalize packing order? PM consumption will be posted (P261).")) return;
    setSaving(true);
    try {
      await finalizePackingOrder(detailId, {});
      toast("Packing Order finalized. PM consumption posted.");
      setFinalizeModal(false);
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleReverse() {
    if (!window.confirm("Reverse packing order? PM consumption reversal will be posted.")) return;
    setSaving(true);
    try {
      await reversePackingOrder(detailId);
      toast("Reversed.");
      qc.invalidateQueries({ queryKey: ["pack-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  const STATUS_OPTIONS = ["", "STANDARD", "FINAL", "REVERSED"];

  return (
    <ErpScreenScaffold
      title="Packing Orders"
      subtitle="FG Packing — links batch to pack code, FO dispatch, and PM consumption"
      actions={[{
        label: "New Packing Order",
        tone: "primary",
        mnemonic: "N",
        onClick: () => { setForm({ ...EMPTY_FORM }); setCreateOpen(true); },
      }]}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      {/* Filters */}
      <ErpSectionCard>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input className="border border-slate-300 rounded px-2 py-1 text-sm w-56" value={companyId} onChange={e => setCompanyId(e.target.value)} placeholder="Filter by company…" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Status</label>
            <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={statusFilter} onChange={e => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </div>
        </div>
      </ErpSectionCard>

      {/* List */}
      <ErpSectionCard title={`Packing Orders${orders.length ? ` (${orders.length})` : ""}`}>
        {listQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No packing orders found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[650px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left py-2 px-3 border-b">Pack PO #</th>
                  <th className="text-left py-2 px-3 border-b">Process Order</th>
                  <th className="text-left py-2 px-3 border-b">FO</th>
                  <th className="text-right py-2 px-3 border-b">Planned KG</th>
                  <th className="text-left py-2 px-3 border-b">Status</th>
                  <th className="text-left py-2 px-3 border-b">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => setDetailId(o.id)}
                    className={`border-b border-slate-100 cursor-pointer hover:bg-sky-50 ${detailId === o.id ? "bg-sky-50 border-l-2 border-l-sky-500" : ""}`}
                  >
                    <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number}</td>
                    <td className="py-2 px-3 font-mono text-slate-500 text-xs">{o.process_order_id?.slice(0, 8)}…</td>
                    <td className="py-2 px-3 text-slate-500 text-xs">{o.fo_id ? o.fo_id.slice(0, 8) + "…" : "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{Number(o.planned_qty_kg).toLocaleString()}</td>
                    <td className="py-2 px-3"><StatusBadge status={o.status} /></td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{o.order_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>

      {/* ── Detail Drawer ── */}
      <DrawerBase
        visible={!!detailId}
        title={order ? `Packing Order: ${order.po_number}` : "Packing Order"}
        onClose={() => setDetailId(null)}
        width="lg"
      >
        {detailQ.isLoading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : !order ? (
          <div className="p-6 text-slate-400 text-sm">Not found.</div>
        ) : (
          <div className="flex flex-col gap-4 p-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-xs text-slate-400">PO Number</span><p className="font-mono font-semibold text-sky-700">{order.po_number}</p></div>
              <div><span className="text-xs text-slate-400">Status</span><p><StatusBadge status={order.status} /></p></div>
              <div><span className="text-xs text-slate-400">Process Order</span><p className="font-mono text-xs">{order.process_order_id?.slice(0, 8)}…</p></div>
              <div>
                <span className="text-xs text-slate-400">FO Link</span>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs">{order.fo_id ? order.fo_id.slice(0, 8) + "…" : "—"}</p>
                  {order.status === "STANDARD" && (
                    <button onClick={() => { setLinkFoId(""); setLinkFoModal(true); }} className="text-xs text-sky-600 hover:underline">
                      {order.fo_id ? "Re-link" : "Link FO"}
                    </button>
                  )}
                </div>
              </div>
              <div><span className="text-xs text-slate-400">Planned KG</span><p className="font-mono">{Number(order.planned_qty_kg).toLocaleString()}</p></div>
              <div><span className="text-xs text-slate-400">Total KG</span><p className="font-mono text-emerald-700">{order.total_qty_kg != null ? Number(order.total_qty_kg).toLocaleString() : "—"}</p></div>
            </div>

            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lines (SFG + PM)</p>
                {order.status === "STANDARD" && (
                  <button onClick={openEditLines} className="text-xs text-sky-600 hover:underline">Edit Lines</button>
                )}
              </div>
              {(order.lines ?? []).length === 0 ? (
                <p className="text-slate-400 text-sm">No lines.</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 uppercase">
                      <th className="text-left py-1.5 px-2 border-b">Material</th>
                      <th className="text-left py-1.5 px-2 border-b">Type</th>
                      <th className="text-right py-1.5 px-2 border-b">Planned KG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map(l => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 font-mono">{l.material?.pace_code ?? l.material_id?.slice(0, 8)}</td>
                        <td className="py-1.5 px-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${l.line_type === "SFG" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>
                            {l.line_type ?? (l.is_rm ? "PM" : "SFG")}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{Number(l.planned_qty_kg ?? l.planned_qty).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-slate-100 pt-4 flex flex-wrap gap-2">
              {order.status === "STANDARD" && (
                <button onClick={handleFinalize} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50">
                  Finalize &amp; Post PM
                </button>
              )}
              {order.status !== "REVERSED" && (
                <button onClick={handleReverse} disabled={saving} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-50 disabled:opacity-50 ml-auto">
                  Reverse
                </button>
              )}
            </div>
          </div>
        )}
      </DrawerBase>

      {/* ── Create Drawer ── */}
      <DrawerBase visible={createOpen} title="New Packing Order" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company ID <span className="text-rose-500">*</span></label>
            <input autoFocus className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Process Order ID <span className="text-rose-500">*</span></label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.process_order_id} onChange={e => setForm(f => ({ ...f, process_order_id: e.target.value }))} required placeholder="UUID of VERIFIED process order" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Pack Code Config ID</label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.pack_code_config_id} onChange={e => setForm(f => ({ ...f, pack_code_config_id: e.target.value }))} placeholder="UUID from prodshade pack config" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Planned Qty (KG) <span className="text-rose-500">*</span></label>
            <input type="number" step="0.01" min="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.planned_qty_kg} onChange={e => setForm(f => ({ ...f, planned_qty_kg: e.target.value }))} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">FO ID (optional)</label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.fo_id} onChange={e => setForm(f => ({ ...f, fo_id: e.target.value }))} placeholder="Link to plan feed FO (optional)" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">Create Order</button>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </DrawerBase>

      {/* ── Link FO Modal ── */}
      <ModalBase visible={linkFoModal} title="Link FO to Packing Order" onClose={() => setLinkFoModal(false)}>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">FO ID (UUID)</label>
            <input autoFocus className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={linkFoId} onChange={e => setLinkFoId(e.target.value)} placeholder="Paste Plan Feed FO UUID…" />
          </div>
          <div className="flex gap-3">
            <button onClick={handleLinkFo} disabled={!linkFoId.trim() || saving} className="px-4 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">Link FO</button>
            <button onClick={() => setLinkFoModal(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </div>
      </ModalBase>

      {/* ── Edit Lines Drawer ── */}
      <DrawerBase visible={editLinesOpen} title="Edit PM Lines" onClose={() => setEditLinesOpen(false)} width="lg">
        <form onSubmit={handleSaveLines} className="flex flex-col gap-3 p-4">
          <p className="text-xs text-slate-500">Adjust PM quantities. SFG lines cannot be edited.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 uppercase">
                  <th className="text-left py-1.5 px-2 border-b">Material</th>
                  <th className="text-left py-1.5 px-2 border-b">Type</th>
                  <th className="text-right py-1.5 px-2 border-b">Planned KG</th>
                </tr>
              </thead>
              <tbody>
                {linesDraft.map((l, i) => (
                  <tr key={l.id ?? i} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 font-mono">{l.material_id?.slice(0, 8)}</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${l.line_type === "SFG" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>
                        {l.line_type ?? "PM"}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {l.line_type === "SFG" ? (
                        <span className="font-mono text-slate-400">{Number(l.planned_qty_kg ?? l.planned_qty).toLocaleString()}</span>
                      ) : (
                        <input
                          type="number" step="0.001" min="0"
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs font-mono w-24 text-right"
                          value={l.planned_qty_kg ?? l.planned_qty}
                          onChange={e => setLinesDraft(d => d.map((x, j) => j === i ? { ...x, planned_qty_kg: e.target.value, planned_qty: e.target.value } : x))}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">Save Lines</button>
            <button type="button" onClick={() => setEditLinesOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </form>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
