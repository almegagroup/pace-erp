/*
 * File-ID: 27.FE-PR08
 * File-Path: frontend/src/pages/dashboard/production/ChangePackBomApprovalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L1 Manager reviews DRAFT Pack BOM Change Requests and approves or rejects.
 *          On approval, the live Pack BOM lines are updated atomically.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import {
  listPackBomChangeRequests,
  approvePackBomChangeRequest,
  rejectPackBomChangeRequest,
} from "./prodApi.js";

const STATUS_COLORS = {
  DRAFT:    "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};
const ACTION_COLORS = {
  ADD:    "bg-emerald-100 text-emerald-800",
  REMOVE: "bg-rose-100 text-rose-800",
  EDIT:   "bg-sky-100 text-sky-800",
};

const ERRORS = {
  PROD_BCR_NOT_DRAFT:          "Only DRAFT change requests can be actioned.",
  PROD_BCR_REASON_REQUIRED:    "A rejection reason is required.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function ChangePackBomApprovalPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("DRAFT");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const crQ = useQuery({
    queryKey: ["pack-bom-change-requests", statusFilter],
    queryFn: () => listPackBomChangeRequests({ status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  function openDetail(cr) {
    setSelected(cr);
    setRejectMode(false);
    setRejectReason("");
    setDrawerOpen(true);
  }

  async function handleApprove() {
    if (!selected) return;
    setSaving(true);
    try {
      await approvePackBomChangeRequest(selected.id, {});
      toast("Change request approved — Pack BOM updated.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["pack-bom-change-requests"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!selected || !rejectReason.trim()) {
      toast("Enter a reject reason.", "error");
      return;
    }
    setSaving(true);
    try {
      await rejectPackBomChangeRequest(selected.id, { reason: rejectReason.trim() });
      toast("Change request rejected.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["pack-bom-change-requests"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  const requests = crQ.data ?? [];

  const drawerActions = selected?.status === "DRAFT"
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
      title="Change Pack BOM Approval — PR08"
      subtitle="L1 Manager reviews and approves or rejects Pack BOM change requests"
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
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Change Requests (${requests.length})`}>
        {crQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No Pack BOM change requests found.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">SKU Code</th>
                <th className="text-left py-2 px-3 border-b">SKU Name</th>
                <th className="text-left py-2 px-3 border-b">Pack Code</th>
                <th className="text-left py-2 px-3 border-b">Requested By</th>
                <th className="text-left py-2 px-3 border-b">Date</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                  onClick={() => openDetail(r)}
                >
                  <td className="py-2 px-3 font-mono font-medium">{r.bom?.sku?.pace_code ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-500">{r.bom?.sku?.material_name ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-500">{r.bom?.sku?.pack_code ?? "—"}</td>
                  <td className="py-2 px-3 text-slate-400 text-xs font-mono">{r.created_by?.slice(0, 8)}…</td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{r.created_at?.slice(0, 10)}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status] ?? ""}`}>
                      {r.status}
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
        title={selected ? `BOM Change — ${selected.bom?.sku?.pace_code ?? "?"}` : "Detail"}
        onClose={() => setDrawerOpen(false)}
        width="min(680px, calc(100vw - 24px))"
        actions={drawerActions}
      >
        {selected ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">SKU</span>
                <p className="font-mono font-semibold">{selected.bom?.sku?.pace_code ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selected.status] ?? ""}`}>
                  {selected.status}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Material Name</span>
                <p>{selected.bom?.sku?.material_name ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Pack Code</span>
                <p className="font-mono">{selected.bom?.sku?.pack_code ?? "—"}</p>
              </div>
              {selected.reject_reason && (
                <div className="col-span-2 bg-rose-50 border border-rose-200 rounded p-2 text-rose-700 text-sm">
                  <strong>Reject reason:</strong> {selected.reject_reason}
                </div>
              )}
            </div>

            {rejectMode && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Rejection Reason</label>
                <textarea
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full h-20 resize-none"
                  placeholder="Explain why this change request is being rejected…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Proposed Changes</p>
              <p className="text-xs text-slate-400 mb-2">
                On approval these changes will be applied live to the Pack BOM.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-600">
                <p>Change request ID: <span className="font-mono">{selected.id}</span></p>
                <p className="mt-1">Created: {selected.created_at?.slice(0, 16) ?? "—"}</p>
                <p className="mt-2 text-slate-400">
                  Detailed change lines (ADD/REMOVE/EDIT) are stored in DB. On approval, all changes are applied atomically to the active Pack BOM.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
