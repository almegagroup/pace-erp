/*
 * File-ID: 27.FE-PR02
 * File-Path: frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L3 Manager reviews DRAFT strokes and approves or reverts them.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { listStrokeMasters, getStrokeMaster, approveStrokeMaster, revertStrokeMaster } from "./prodApi.js";

const STATUS_COLORS = {
  DRAFT:        "bg-amber-100 text-amber-800",
  APPROVED:     "bg-emerald-100 text-emerald-800",
  DEACTIVATED:  "bg-slate-100 text-slate-600",
};

const ERRORS = {
  PROD_STROKE_IN_USE:             "Cannot revert — active Process Orders reference this stroke.",
  PROD_STROKE_APPROVED_LOCKED:    "Stroke is already approved.",
  PROD_MANAGER_OR_SA_REQUIRED:    "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function StrokeApprovalPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [statusFilter, setStatusFilter] = useState("DRAFT");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const strokesQ = useQuery({
    queryKey: ["stroke-masters-approval", companyId, statusFilter],
    queryFn: () => listStrokeMasters({
      company_id: companyId || undefined,
      status: statusFilter || undefined,
    }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  async function openDetail(id) {
    setDetail(null);
    setConfirmRevert(false);
    setDetailLoading(true);
    setDrawerOpen(true);
    try {
      const d = await getStrokeMaster(id);
      setDetail(d);
    } catch {
      toast("Failed to load stroke detail.", "error");
      setDrawerOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleApprove() {
    if (!detail) return;
    setSaving(true);
    try {
      await approveStrokeMaster(detail.id);
      toast("Stroke approved successfully.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["stroke-masters-approval"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevert() {
    if (!detail) return;
    setSaving(true);
    try {
      await revertStrokeMaster(detail.id);
      toast("Stroke reverted to DRAFT.");
      setDrawerOpen(false);
      setConfirmRevert(false);
      qc.invalidateQueries({ queryKey: ["stroke-masters-approval"] });
    } catch (err) {
      toast(friendly(err.message), "error");
      setConfirmRevert(false);
    } finally {
      setSaving(false);
    }
  }

  const strokes = strokesQ.data ?? [];

  const drawerActions = detail
    ? [
        ...(detail.status === "DRAFT"
          ? [{ label: "Approve", tone: "primary", onClick: handleApprove, disabled: saving }]
          : []),
        ...(detail.status === "APPROVED"
          ? [
              confirmRevert
                ? { label: "Confirm Revert", tone: "danger", onClick: handleRevert, disabled: saving }
                : { label: "Revert to Draft", tone: "neutral", onClick: () => setConfirmRevert(true) },
            ]
          : []),
        { label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) },
      ]
    : [{ label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) }];

  return (
    <ErpScreenScaffold
      title="Stroke Approval — PR02"
      subtitle="L3 Manager reviews and approves DRAFT stroke formulas"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1 text-sm w-64"
              placeholder="Filter by company…"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Status</label>
            <select
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Strokes (${strokes.length})`}>
        {strokesQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : strokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No strokes found for the selected filters.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-left py-2 px-3 border-b">Description</th>
                <th className="text-left py-2 px-3 border-b">Created By</th>
                <th className="text-left py-2 px-3 border-b">Created At</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {strokes.map((s) => (
                <tr
                  key={s.id}
                  className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                  onClick={() => openDetail(s.id)}
                >
                  <td className="py-2 px-3 font-medium">
                    {s.material?.pace_code ?? s.prodshade_material_id?.slice(0, 8)}
                  </td>
                  <td className="py-2 px-3 font-mono font-semibold">{s.stroke_number}</td>
                  <td className="py-2 px-3 text-slate-500">{s.description ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-500">{s.created_by ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{s.created_at?.slice(0, 10)}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status] ?? ""}`}>
                      {s.status}
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
        title={detail ? `Stroke #${detail.stroke_number}` : "Loading…"}
        onClose={() => setDrawerOpen(false)}
        width="min(600px, calc(100vw - 24px))"
        actions={drawerActions}
      >
        {detailLoading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading…</p>
        ) : detail ? (
          <div className="p-4 flex flex-col gap-4">
            {confirmRevert && (
              <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-700">
                Are you sure you want to revert this approved stroke back to DRAFT? This action can be re-approved.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Material Type</span>
                <p className="font-medium">{detail.material?.material_type ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Prodshade</span>
                <p className="font-medium">{detail.material?.pace_code ?? detail.prodshade_material_id?.slice(0, 8)}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Stroke Number</span>
                <p className="font-mono font-semibold">{detail.stroke_number}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[detail.status] ?? ""}`}>
                  {detail.status}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 text-xs block mb-0.5">Description</span>
                <p>{detail.description ?? "—"}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">RM Lines</p>
              {(detail.lines ?? []).length === 0 ? (
                <p className="text-slate-400 text-sm">No RM lines defined.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs">
                      <th className="text-left py-1.5 px-2 border-b">#</th>
                      <th className="text-left py-1.5 px-2 border-b">Material</th>
                      <th className="text-left py-1.5 px-2 border-b">Material Group</th>
                      <th className="text-left py-1.5 px-2 border-b">UOM</th>
                      <th className="text-left py-1.5 px-2 border-b">Has Alt.</th>
                      <th className="text-right py-1.5 px-2 border-b">Dosage %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l, i) => (
                      <tr key={l.id ?? i} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                        <td className="py-1.5 px-2">{l.material?.pace_code ?? l.material_id?.slice(0, 8)}</td>
                        <td className="py-1.5 px-2 text-slate-500">{l.material?.material_group ?? "—"}</td>
                        <td className="py-1.5 px-2 text-slate-500">{l.material?.base_uom ?? "—"}</td>
                        <td className="py-1.5 px-2">
                          {l.alternate_material_id
                            ? <span className="text-xs px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">Yes</span>
                            : <span className="text-xs text-slate-400">No</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{Number(l.dosage_pct).toFixed(2)}%</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={5} className="py-1.5 px-2 text-right text-slate-500 text-xs">Total</td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {detail.lines.reduce((s, l) => s + Number(l.dosage_pct), 0).toFixed(2)}%
                      </td>
                    </tr>
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
