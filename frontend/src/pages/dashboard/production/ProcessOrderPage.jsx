/*
 * File-ID: 27.FE-04
 * File-Path: frontend/src/pages/dashboard/production/ProcessOrderPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Process Order (L3 Production) full lifecycle management.
 *          Status: STANDARD → QA_APPROVED → BATCH_STARTED → FINAL → VERIFIED | QA_REJECTED | REVERSED
 *          Stock movement posts at VERIFY (P261 RM/PM + P231 FG).
 *          Keyboard-first: Alt+N=New, row-click=open drawer.
 */

import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import {
  listProcessOrders, getProcessOrder, createProcessOrder,
  updateProcessOrderLines, qaApproveProcessOrder, qaRejectProcessOrder,
  startBatch, finalizeProcessOrder, verifyProcessOrder, reverseProcessOrder,
} from "./prodApi.js";

const PROD_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];

const STATUS_COLORS = {
  STANDARD:      "bg-slate-100 text-slate-700",
  QA_APPROVED:   "bg-sky-100 text-sky-700",
  QA_REJECTED:   "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-700",
  FINAL:         "bg-purple-100 text-purple-700",
  VERIFIED:      "bg-emerald-100 text-emerald-700",
  REVERSED:      "bg-gray-100 text-gray-500",
};

const ERRORS = {
  PROD_PROCESS_ORDER_INVALID:            "Company, FG material, type, and planned qty are required.",
  PROD_PROCESS_ORDER_NOT_FOUND:          "Process order not found.",
  PROD_PROCESS_ORDER_WRONG_STATUS:       "Action not valid for current status.",
  PROD_PROCESS_ORDER_STROKE_REQUIRED:    "Stroke master required for this production type.",
  PROD_PROCESS_ORDER_PACK_CONFIG_MISSING:"Pack code config missing for this prodshade.",
  PROD_MANAGER_OR_SA_REQUIRED:           "Manager or SA access required.",
  PROD_PROD_READ_REQUIRED:               "Production read access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}

const EMPTY_FORM = { company_id: "", material_id: "", production_type: "MTO", stroke_master_id: "", planned_qty: "", notes: "" };

export default function ProcessOrderPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId]   = useState("");
  const [statusFilter, setStatus]   = useState("");
  const [saving, setSaving]         = useState(false);
  const [notice, setNotice]         = useState({ msg: "", tone: "success" });

  // Drawers/modals
  const [createOpen, setCreateOpen]         = useState(false);
  const [detailId, setDetailId]             = useState(null);
  const [qaRejectModal, setQaRejectModal]   = useState(false);
  const [qaReason, setQaReason]             = useState("");
  const [editLinesOpen, setEditLinesOpen]   = useState(false);
  const [finalizeModal, setFinalizeModal]   = useState(false);
  const [verifyModal, setVerifyModal]       = useState(false);

  // Create form
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Edit lines draft
  const [linesDraft, setLinesDraft] = useState([]);

  // Actual qty draft for finalize/verify
  const [actualDraft, setActualDraft] = useState([]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const listQ = useQuery({
    queryKey: ["proc-orders", companyId, statusFilter],
    queryFn: () => listProcessOrders({
      company_id: companyId || undefined,
      status: statusFilter || undefined,
      per_page: 100,
    }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });

  const detailQ = useQuery({
    queryKey: ["proc-order-detail", detailId],
    queryFn: () => getProcessOrder(detailId),
    enabled: !!detailId,
  });

  const order = detailQ.data;
  const orders = listQ.data ?? [];

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await createProcessOrder({
        ...form,
        planned_qty: parseFloat(form.planned_qty),
        stroke_master_id: form.stroke_master_id || null,
      });
      toast("Process Order created.");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleSaveLines(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProcessOrderLines(detailId, { lines: linesDraft });
      toast("Lines updated.");
      setEditLinesOpen(false);
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleQaApprove() {
    setSaving(true);
    try {
      await qaApproveProcessOrder(detailId);
      toast("QA Approved.");
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleQaReject() {
    if (!qaReason.trim()) return;
    setSaving(true);
    try {
      await qaRejectProcessOrder(detailId, { rejection_reason: qaReason });
      toast("QA Rejected.");
      setQaRejectModal(false);
      setQaReason("");
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleStartBatch() {
    if (!window.confirm("Start batch? This will generate a batch number.")) return;
    setSaving(true);
    try {
      await startBatch(detailId);
      toast("Batch started.");
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleFinalize(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await finalizeProcessOrder(detailId, { lines: actualDraft, actual_qty: actualDraft.find(l => !l.is_rm)?.actual_qty });
      toast("Process Order finalized.");
      setFinalizeModal(false);
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await verifyProcessOrder(detailId, { lines: actualDraft });
      toast("Process Order verified. Stock movements posted.");
      setVerifyModal(false);
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleReverse() {
    if (!window.confirm("Reverse this order? Stock movements will be undone.")) return;
    setSaving(true);
    try {
      await reverseProcessOrder(detailId);
      toast("Reversed.");
      qc.invalidateQueries({ queryKey: ["proc-order-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["proc-orders"] });
    } catch (err) { toast(friendly(err.message), "error"); }
    finally { setSaving(false); }
  }

  function openDetail(id) {
    setDetailId(id);
  }

  function openEditLines() {
    if (!order?.lines) return;
    setLinesDraft(order.lines.map(l => ({ ...l })));
    setEditLinesOpen(true);
  }

  function openFinalizeModal() {
    if (!order?.lines) return;
    setActualDraft(order.lines.map(l => ({ id: l.id, material_id: l.material_id, is_rm: l.is_rm, planned_qty: l.planned_qty, actual_qty: l.actual_qty ?? l.planned_qty, uom_code: l.uom_code })));
    setFinalizeModal(true);
  }

  function openVerifyModal() {
    if (!order?.lines) return;
    setActualDraft(order.lines.map(l => ({ id: l.id, material_id: l.material_id, is_rm: l.is_rm, planned_qty: l.planned_qty, actual_qty: l.actual_qty ?? l.planned_qty, uom_code: l.uom_code })));
    setVerifyModal(true);
  }

  const STATUS_OPTIONS = ["", "STANDARD", "QA_APPROVED", "QA_REJECTED", "BATCH_STARTED", "FINAL", "VERIFIED", "REVERSED"];

  return (
    <ErpScreenScaffold
      title="Process Orders"
      subtitle="L3 Production — BOM-based batch processing with QA approval"
      actions={[{
        label: "New Process Order",
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
      <ErpSectionCard title={`Process Orders${orders.length ? ` (${orders.length})` : ""}`}>
        {listQ.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">No orders found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left py-2 px-3 border-b">PO #</th>
                  <th className="text-left py-2 px-3 border-b">Type</th>
                  <th className="text-left py-2 px-3 border-b">Batch #</th>
                  <th className="text-right py-2 px-3 border-b">Planned KG</th>
                  <th className="text-right py-2 px-3 border-b">Actual KG</th>
                  <th className="text-left py-2 px-3 border-b">Status</th>
                  <th className="text-left py-2 px-3 border-b">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => openDetail(o.id)}
                    className={`border-b border-slate-100 cursor-pointer hover:bg-sky-50 ${detailId === o.id ? "bg-sky-50 border-l-2 border-l-sky-500" : ""}`}
                  >
                    <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number}</td>
                    <td className="py-2 px-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">{o.production_type}</span>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-500">{o.batch_number ?? "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{Number(o.planned_qty).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-700">{o.actual_qty != null ? Number(o.actual_qty).toLocaleString() : "—"}</td>
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
        title={order ? `Process Order: ${order.po_number}` : "Process Order"}
        onClose={() => { setDetailId(null); setCreateOpen(false); }}
        width="lg"
      >
        {detailQ.isLoading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : !order ? (
          <div className="p-6 text-slate-400 text-sm">Not found.</div>
        ) : (
          <div className="flex flex-col gap-4 p-4 overflow-y-auto">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-xs text-slate-400">PO Number</span><p className="font-mono font-semibold text-sky-700">{order.po_number}</p></div>
              <div><span className="text-xs text-slate-400">Status</span><p><StatusBadge status={order.status} /></p></div>
              <div><span className="text-xs text-slate-400">Production Type</span><p>{order.production_type}</p></div>
              <div><span className="text-xs text-slate-400">Batch Number</span><p className="font-mono">{order.batch_number ?? "—"}</p></div>
              <div><span className="text-xs text-slate-400">Planned Qty</span><p className="font-mono">{Number(order.planned_qty).toLocaleString()} KG</p></div>
              <div><span className="text-xs text-slate-400">Actual Qty</span><p className="font-mono text-emerald-700">{order.actual_qty != null ? `${Number(order.actual_qty).toLocaleString()} KG` : "—"}</p></div>
              {order.stroke_master_id && <div><span className="text-xs text-slate-400">Stroke Master</span><p className="font-mono text-xs">{order.stroke_master_id.slice(0, 8)}…</p></div>}
              {order.qa_rejection_reason && (
                <div className="col-span-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded">
                  <span className="text-xs text-rose-500 font-medium">QA Rejection Reason:</span>
                  <p className="text-rose-800 text-sm">{order.qa_rejection_reason}</p>
                </div>
              )}
            </div>

            {/* BOM Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">RM / PM Lines</p>
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
                      <th className="text-right py-1.5 px-2 border-b">Planned</th>
                      <th className="text-right py-1.5 px-2 border-b">Actual</th>
                      <th className="text-left py-1.5 px-2 border-b">UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map(l => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 font-mono">{l.material?.pace_code ?? l.material_id?.slice(0, 8)}</td>
                        <td className="py-1.5 px-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${l.is_rm ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>
                            {l.is_rm ? "RM" : "PM"}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{Number(l.planned_qty).toLocaleString()}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-emerald-700">{l.actual_qty != null ? Number(l.actual_qty).toLocaleString() : "—"}</td>
                        <td className="py-1.5 px-2 text-slate-500">{l.uom_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Action buttons by status */}
            <div className="border-t border-slate-100 pt-4 flex flex-wrap gap-2">
              {order.status === "STANDARD" && (
                <>
                  <button onClick={handleQaApprove} disabled={saving} className="px-4 py-2 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
                    QA Approve
                  </button>
                  <button onClick={() => setQaRejectModal(true)} disabled={saving} className="px-4 py-2 border border-rose-400 text-rose-600 text-sm rounded hover:bg-rose-50 disabled:opacity-50">
                    QA Reject
                  </button>
                </>
              )}
              {order.status === "QA_APPROVED" && (
                <button onClick={handleStartBatch} disabled={saving} className="px-4 py-2 bg-amber-500 text-white text-sm rounded hover:bg-amber-600 disabled:opacity-50">
                  Start Batch
                </button>
              )}
              {order.status === "BATCH_STARTED" && (
                <button onClick={openFinalizeModal} disabled={saving} className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50">
                  Finalize (Enter Actuals)
                </button>
              )}
              {order.status === "FINAL" && (
                <button onClick={openVerifyModal} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50">
                  Verify &amp; Post Stock
                </button>
              )}
              {!["VERIFIED", "REVERSED"].includes(order.status) && (
                <button onClick={handleReverse} disabled={saving} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-50 disabled:opacity-50 ml-auto">
                  Reverse
                </button>
              )}
            </div>
          </div>
        )}
      </DrawerBase>

      {/* ── Create Drawer ── */}
      <DrawerBase
        visible={createOpen}
        title="New Process Order"
        onClose={() => setCreateOpen(false)}
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company ID <span className="text-rose-500">*</span></label>
            <input autoFocus className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">FG Material ID <span className="text-rose-500">*</span></label>
            <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.material_id} onChange={e => setForm(f => ({ ...f, material_id: e.target.value }))} required placeholder="Prodshade material UUID" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Production Type <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.production_type} onChange={e => setForm(f => ({ ...f, production_type: e.target.value }))}>
              {PROD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {form.production_type !== "MTEST" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Stroke Master ID</label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.stroke_master_id} onChange={e => setForm(f => ({ ...f, stroke_master_id: e.target.value }))} placeholder="UUID (required for MTO/HPS/MTS)" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Planned Qty (KG) <span className="text-rose-500">*</span></label>
            <input type="number" step="0.01" min="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.planned_qty} onChange={e => setForm(f => ({ ...f, planned_qty: e.target.value }))} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Notes</label>
            <textarea rows={2} className="border border-slate-300 rounded px-2 py-1.5 text-sm resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">
              Create Order
            </button>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </form>
      </DrawerBase>

      {/* ── Edit Lines Drawer ── */}
      <DrawerBase
        visible={editLinesOpen}
        title="Edit BOM Lines"
        onClose={() => setEditLinesOpen(false)}
        width="lg"
      >
        <form onSubmit={handleSaveLines} className="flex flex-col gap-3 p-4">
          <p className="text-xs text-slate-500">Adjust planned quantities or issue locations. You cannot remove lines — set qty to 0 to exclude.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 uppercase">
                  <th className="text-left py-1.5 px-2 border-b">Material</th>
                  <th className="text-left py-1.5 px-2 border-b">Type</th>
                  <th className="text-right py-1.5 px-2 border-b">Planned Qty</th>
                  <th className="text-left py-1.5 px-2 border-b">UOM</th>
                </tr>
              </thead>
              <tbody>
                {linesDraft.map((l, i) => (
                  <tr key={l.id ?? i} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 font-mono">{l.material_id?.slice(0, 8)}</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${l.is_rm ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>
                        {l.is_rm ? "RM" : "PM"}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <input
                        type="number" step="0.001" min="0"
                        className="border border-slate-200 rounded px-1.5 py-0.5 text-xs font-mono w-24 text-right"
                        value={l.planned_qty}
                        onChange={e => setLinesDraft(d => d.map((x, j) => j === i ? { ...x, planned_qty: e.target.value } : x))}
                      />
                    </td>
                    <td className="py-1.5 px-2 text-slate-500">{l.uom_code}</td>
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

      {/* ── QA Reject Modal ── */}
      <ModalBase visible={qaRejectModal} title="QA Reject — Enter Reason" onClose={() => { setQaRejectModal(false); setQaReason(""); }}>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-sm text-slate-600">This process order will be locked. A new order will need to be created.</p>
          <textarea
            autoFocus
            rows={3}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm resize-none"
            value={qaReason}
            onChange={e => setQaReason(e.target.value)}
            placeholder="Enter rejection reason…"
          />
          <div className="flex gap-3">
            <button onClick={handleQaReject} disabled={!qaReason.trim() || saving} className="px-4 py-2 bg-rose-600 text-white text-sm rounded hover:bg-rose-700 disabled:opacity-50">
              Confirm Reject
            </button>
            <button onClick={() => { setQaRejectModal(false); setQaReason(""); }} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </div>
      </ModalBase>

      {/* ── Finalize Modal (enter actuals) ── */}
      <ModalBase visible={finalizeModal} title="Finalize — Enter Actual Quantities" onClose={() => setFinalizeModal(false)}>
        <form onSubmit={handleFinalize} className="p-4 flex flex-col gap-3">
          <p className="text-xs text-slate-500">Enter what was actually consumed. No stock movement yet — that happens at Verify.</p>
          <ActualQtyTable draft={actualDraft} setDraft={setActualDraft} />
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50">Save Actuals</button>
            <button type="button" onClick={() => setFinalizeModal(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </form>
      </ModalBase>

      {/* ── Verify Modal (confirm + post stock) ── */}
      <ModalBase visible={verifyModal} title="Verify — Confirm and Post Stock" onClose={() => setVerifyModal(false)}>
        <form onSubmit={handleVerify} className="p-4 flex flex-col gap-3">
          <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-sm">
            Verifying will post stock movements: P261 (RM/PM out) + P231 (FG in). This cannot be undone easily.
          </div>
          <ActualQtyTable draft={actualDraft} setDraft={setActualDraft} />
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50">Verify &amp; Post</button>
            <button type="button" onClick={() => setVerifyModal(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded">Cancel</button>
          </div>
        </form>
      </ModalBase>
    </ErpScreenScaffold>
  );
}

function ActualQtyTable({ draft, setDraft }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50 text-slate-400 uppercase">
            <th className="text-left py-1.5 px-2 border-b">Material</th>
            <th className="text-left py-1.5 px-2 border-b">Type</th>
            <th className="text-right py-1.5 px-2 border-b">Planned</th>
            <th className="text-right py-1.5 px-2 border-b">Actual</th>
            <th className="text-left py-1.5 px-2 border-b">UOM</th>
          </tr>
        </thead>
        <tbody>
          {draft.map((l, i) => (
            <tr key={l.id ?? i} className="border-b border-slate-100">
              <td className="py-1.5 px-2 font-mono">{l.material_id?.slice(0, 8)}</td>
              <td className="py-1.5 px-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${l.is_rm ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>
                  {l.is_rm ? "RM" : "PM"}
                </span>
              </td>
              <td className="py-1.5 px-2 text-right font-mono text-slate-400">{Number(l.planned_qty).toLocaleString()}</td>
              <td className="py-1.5 px-2 text-right">
                <input
                  type="number" step="0.001" min="0"
                  className="border border-slate-200 rounded px-1.5 py-0.5 text-xs font-mono w-24 text-right"
                  value={l.actual_qty}
                  onChange={e => setDraft(d => d.map((x, j) => j === i ? { ...x, actual_qty: parseFloat(e.target.value) || 0 } : x))}
                />
              </td>
              <td className="py-1.5 px-2 text-slate-500">{l.uom_code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
