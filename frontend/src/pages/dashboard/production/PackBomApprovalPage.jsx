/*
 * File-ID: 27.FE-PR06
 * File-Path: frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L1 Manager Procurement approves Pack BOMs with BOM Required = Yes.
 *          Can edit PM lines before approving. Reject returns BOM to DRAFT for revision.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { listPackBoms, getPackBom, approvePackBom, rejectPackBom } from "./prodApi.js";

const STATUS_COLORS = {
  DRAFT:  "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
};

const ERRORS = {
  PROD_BOM_NOT_DRAFT:          "Only DRAFT Pack BOMs can be approved.",
  PROD_BOM_REASON_REQUIRED:    "A rejection reason is required.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function PackBomApprovalPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("DRAFT");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editedLines, setEditedLines] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const bomsQ = useQuery({
    queryKey: ["pack-boms-approval", statusFilter],
    queryFn: () => listPackBoms({ status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  async function openDetail(id) {
    setDetail(null);
    setEditedLines([]);
    setRejectMode(false);
    setRejectReason("");
    setDetailLoading(true);
    setDrawerOpen(true);
    try {
      const d = await getPackBom(id);
      setDetail(d);
      setEditedLines(
        (d.lines ?? [])
          .filter((l) => l.line_type === "INPUT")
          .map((l) => ({
            id: l.id,
            line_type: "INPUT",
            material_id: l.material_id ?? "",
            material_pace: l.material?.pace_code ?? "",
            qty: String(l.qty ?? ""),
            uom_code: l.uom_code ?? "KG",
            has_alternate: Boolean(l.has_alternate),
          }))
      );
    } catch {
      toast("Failed to load Pack BOM detail.", "error");
      setDrawerOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  function updateEditedLine(idx, field, value) {
    setEditedLines((prev) =>
      prev.map((l, i) => i === idx ? { ...l, [field]: value } : l)
    );
  }

  async function handleApprove() {
    if (!detail) return;
    setSaving(true);
    try {
      const linesToSend = [
        { line_type: "OUTPUT", material_id: detail.sku_material_id, qty: 1, uom_code: "KG", has_alternate: false },
        ...editedLines.map((l) => ({
          line_type: "INPUT",
          material_id: l.material_id,
          qty: Number(l.qty),
          uom_code: l.uom_code,
          has_alternate: l.has_alternate,
        })),
      ];
      await approvePackBom(detail.id, { lines: linesToSend });
      toast("Pack BOM approved and activated.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["pack-boms-approval"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!detail || !rejectReason.trim()) {
      toast("Enter a reject reason.", "error");
      return;
    }
    setSaving(true);
    try {
      await rejectPackBom(detail.id, { reason: rejectReason.trim() });
      toast("Pack BOM rejected — returned to Procurement for revision.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["pack-boms-approval"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  const boms = bomsQ.data ?? [];

  const drawerActions = detail?.status === "DRAFT"
    ? rejectMode
      ? [
          { label: "Confirm Reject", tone: "danger", onClick: handleReject, disabled: saving },
          { label: "Cancel", tone: "neutral", onClick: () => setRejectMode(false) },
        ]
      : [
          { label: "Approve", tone: "primary", onClick: handleApprove, disabled: saving },
          { label: "Reject…", tone: "neutral", onClick: () => setRejectMode(true) },
          { label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ]
    : [{ label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) }];

  return (
    <ErpScreenScaffold
      title="Pack BOM Approval — PR06"
      subtitle="L1 Manager Procurement reviews and approves Pack BOM submissions"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Status</label>
            <select
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
            </select>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Pack BOMs (${boms.length})`}>
        {bomsQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : boms.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No Pack BOMs found.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">SKU Code</th>
                <th className="text-left py-2 px-3 border-b">SKU Name</th>
                <th className="text-left py-2 px-3 border-b">Pack Code</th>
                <th className="text-left py-2 px-3 border-b">Created By</th>
                <th className="text-left py-2 px-3 border-b">Date</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {boms.map((b) => (
                <tr
                  key={b.id}
                  className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                  onClick={() => openDetail(b.id)}
                >
                  <td className="py-2 px-3 font-mono font-medium">{b.sku?.pace_code ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-500">{b.sku?.material_name ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-500">{b.sku?.pack_code ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-400 text-xs font-mono">{b.created_by?.slice(0, 8)}…</td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{b.created_at?.slice(0, 10)}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      <DrawerBase
        visible={drawerOpen}
        title={detail ? `Pack BOM — ${detail.sku?.pace_code ?? "?"}` : "Loading…"}
        onClose={() => setDrawerOpen(false)}
        width="min(700px, calc(100vw - 24px))"
        actions={drawerActions}
      >
        {detailLoading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading…</p>
        ) : detail ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">SKU</span>
                <p className="font-mono font-semibold">{detail.sku?.pace_code ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[detail.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {detail.status}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Material Name</span>
                <p>{detail.sku?.material_name ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Pack Code</span>
                <p className="font-mono">{detail.sku?.pack_code ?? "—"}</p>
              </div>
              {detail.reject_reason && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded p-2 text-amber-700 text-xs">
                  <strong>Previous rejection:</strong> {detail.reject_reason}
                </div>
              )}
            </div>

            {rejectMode && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Rejection Reason</label>
                <textarea
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full h-20 resize-none"
                  placeholder="Explain why this Pack BOM is being rejected…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">PM Input Lines (editable)</p>
              {editedLines.length === 0 ? (
                <p className="text-slate-400 text-sm">No PM lines.</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                      <th className="text-left py-1.5 px-2 border-b">#</th>
                      <th className="text-left py-1.5 px-2 border-b">Material</th>
                      <th className="text-right py-1.5 px-2 border-b">Qty</th>
                      <th className="text-left py-1.5 px-2 border-b">UOM</th>
                      <th className="text-left py-1.5 px-2 border-b">Has Alt.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editedLines.map((l, i) => (
                      <tr key={l.id ?? i} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                        <td className="py-1.5 px-2">
                          <input
                            className="border border-slate-300 rounded px-1.5 py-0.5 text-xs font-mono w-52"
                            value={l.material_id}
                            onChange={(e) => updateEditedLine(i, "material_id", e.target.value)}
                          />
                          {l.material_pace && <span className="text-slate-400 ml-1">{l.material_pace}</span>}
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="border border-slate-300 rounded px-1.5 py-0.5 text-xs text-right w-20"
                            value={l.qty}
                            onChange={(e) => updateEditedLine(i, "qty", e.target.value)}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            className="border border-slate-300 rounded px-1.5 py-0.5 text-xs w-14 uppercase"
                            value={l.uom_code}
                            onChange={(e) => updateEditedLine(i, "uom_code", e.target.value.toUpperCase())}
                          />
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={l.has_alternate}
                            onChange={(e) => updateEditedLine(i, "has_alternate", e.target.checked)}
                            className="accent-sky-600"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
