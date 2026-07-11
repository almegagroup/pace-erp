/*
 * File-ID: 27.FE-PR16
 * File-Path: frontend/src/pages/dashboard/production/QAQueuePage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: QA Approval Queue — Process POs waiting for QA approval (status=STANDARD).
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { listProcessOrders, getProcessOrder, qaApproveProcessOrder, qaRejectProcessOrder } from "./prodApi.js";

const ERRORS = {
  PROD_PO_NOT_FOUND:            "Process Order not found.",
  PROD_PO_QA_NOT_ALLOWED:       "QA action is only allowed for STANDARD status orders.",
  PROD_QA_REJECT_REASON_MISSING:"Rejection reason is required.",
  PROD_MANAGER_OR_SA_REQUIRED:  "QA Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function QAQueuePage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const queueQ = useQuery({
    queryKey: ["qa-queue", companyId],
    queryFn: () => listProcessOrders({
      company_id: companyId || undefined,
      status: "STANDARD",
      po_type_in: "MTO,HPS",
    }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  async function openDetail(id) {
    setDetail(null);
    setRejectMode(false);
    setRejectReason("");
    setDetailLoading(true);
    setDrawerOpen(true);
    try {
      const d = await getProcessOrder(id);
      setDetail(d);
    } catch {
      toast("Failed to load order detail.", "error");
      setDrawerOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleApprove() {
    if (!detail) return;
    setSaving(true);
    try {
      await qaApproveProcessOrder(detail.id);
      toast("Process Order approved by QA.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["qa-queue"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!detail) return;
    if (!rejectReason.trim()) { toast("Rejection reason is required.", "error"); return; }
    setSaving(true);
    try {
      await qaRejectProcessOrder(detail.id, { reason: rejectReason.trim() });
      toast("Process Order rejected.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["qa-queue"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  const queue = queueQ.data ?? [];

  const drawerActions = detail
    ? [
        ...(detail.status === "STANDARD"
          ? [
              { label: "Approve", tone: "primary", onClick: handleApprove, disabled: saving },
              rejectMode
                ? { label: "Confirm Reject", tone: "danger", onClick: handleReject, disabled: saving || !rejectReason.trim() }
                : { label: "Reject…", tone: "neutral", onClick: () => setRejectMode(true) },
            ]
          : []),
        { label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) },
      ]
    : [{ label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) }];

  return (
    <ErpScreenScaffold
      title="QA Queue — PR16"
      subtitle="Process Orders awaiting QA approval (status = STANDARD)"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1 text-sm w-64"
              placeholder="Filter by company…"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-400 pb-1">
            Auto-refreshes every 30 seconds
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Pending QA Approval (${queue.length})`}>
        {queueQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : queue.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-slate-500 text-sm">No orders pending QA approval.</p>
            <p className="text-slate-400 text-xs mt-1">All STANDARD orders have been processed.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">PO Number</th>
                <th className="text-left py-2 px-3 border-b">Type</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-right py-2 px-3 border-b">Planned Qty (KG)</th>
                <th className="text-left py-2 px-3 border-b">Created By</th>
                <th className="text-left py-2 px-3 border-b">Created At</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((o) => (
                <tr
                  key={o.id}
                  className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                  onClick={() => openDetail(o.id)}
                >
                  <td className="py-2 px-3 font-mono font-semibold text-sky-700">{o.po_number ?? "--"}</td>
                  <td className="py-2 px-3">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{o.po_type ?? "--"}</span>
                  </td>
                  <td className="py-2 px-3">{o.material?.pace_code ?? "--"}</td>
                  <td className="py-2 px-3 font-mono text-slate-500">{o.stroke_number ?? "--"}</td>
                  <td className="py-2 px-3 text-right font-mono">{Number(o.planned_qty ?? 0).toLocaleString()}</td>
                  <td className="py-2 px-3 text-slate-500">{o.created_by_display ?? "--"}</td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{o.created_at?.slice(0, 16)?.replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      <DrawerBase
        visible={drawerOpen}
        title={detail ? `QA Review — ${detail.po_number ?? "--"}` : "Loading…"}
        onClose={() => setDrawerOpen(false)}
        width="min(600px, calc(100vw - 24px))"
        actions={drawerActions}
      >
        {detailLoading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading…</p>
        ) : detail ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">PO Number</span>
                <p className="font-mono font-semibold">{detail.po_number ?? "--"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Production Type</span>
                <p>{detail.po_type ?? "--"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Prodshade</span>
                <p>{detail.material?.pace_code ?? "--"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Stroke Number</span>
                <p className="font-mono">{detail.stroke?.stroke_number ?? "--"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Planned Qty (KG)</span>
                <p className="font-mono">{Number(detail.planned_qty ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Planned Start</span>
                <p>{detail.planned_start_date ?? "—"}</p>
              </div>
              {detail.notes && (
                <div className="col-span-2">
                  <span className="text-slate-400 text-xs block mb-0.5">Notes</span>
                  <p className="text-slate-600">{detail.notes}</p>
                </div>
              )}
            </div>

            {/* RM Lines */}
            {(detail.lines ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">RM Lines (from Stroke)</p>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs">
                      <th className="text-left py-1.5 px-2 border-b">#</th>
                      <th className="text-left py-1.5 px-2 border-b">Material</th>
                      <th className="text-right py-1.5 px-2 border-b">Dosage %</th>
                      <th className="text-right py-1.5 px-2 border-b">Planned Qty (KG)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l, i) => (
                      <tr key={l.id ?? i} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                        <td className="py-1.5 px-2">{l.material?.pace_code ?? "--"}</td>
                        <td className="py-1.5 px-2 text-right font-mono">--</td>
                        <td className="py-1.5 px-2 text-right font-mono">{Number(l.planned_qty ?? 0).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Reject input */}
            {rejectMode && detail.status === "STANDARD" && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-rose-600 font-medium">Rejection Reason <span className="text-rose-500">*</span></label>
                <textarea
                  className="border border-rose-300 rounded px-2 py-1.5 text-sm resize-none"
                  rows={3}
                  placeholder="Explain why this order is being rejected…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  autoFocus
                />
                <button
                  onClick={() => { setRejectMode(false); setRejectReason(""); }}
                  className="text-xs text-slate-400 hover:text-slate-600 w-fit"
                >
                  Cancel rejection
                </button>
              </div>
            )}
          </div>
        ) : null}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
