/*
 * File-ID: 27.FE-PR06
 * File-Path: frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L1 Manager Procurement approves Pack BOMs with BOM Required = Yes.
 *          Can edit PM lines before approving. Reject returns BOM to DRAFT
 *          for revision. Expandable inline row (same pattern as Stroke
 *          Approval) — DrawerBase's descriptor-array `actions` prop crashes
 *          with React error #31.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { listPackBoms, getPackBom, approvePackBom, rejectPackBom } from "./prodApi.js";
import { listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember } from "../om/omApi.js";
import { PackBomLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

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
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [editedLines, setEditedLines] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const bomsQ = useQuery({
    queryKey: ["pack-boms-approval", statusFilter],
    queryFn: () => listPackBoms({ status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  const pmMaterialsQ = useQuery({ queryKey: ["om-materials", "PM"], queryFn: () => listMaterials({ material_type: "PM", limit: 500 }), select: (d) => d?.data ?? [] });
  const groupsQ = useQuery({ queryKey: ["om-material-groups"], queryFn: () => listMaterialCategoryGroups(), select: (d) => d?.data ?? [] });
  const pmMaterials = pmMaterialsQ.data ?? [];
  const groups = groupsQ.data ?? [];

  async function toggleExpand(row) {
    if (expandedId === row.id) {
      setExpandedId("");
      setDetail(null);
      setEditedLines([]);
      return;
    }
    setExpandedId(row.id);
    setDetail(null);
    setEditedLines([]);
    setRejectMode(false);
    setRejectReason("");
    setDetailLoading(true);
    try {
      const d = await getPackBom(row.id);
      setDetail(d);
      setEditedLines(
        (d.lines ?? [])
          .filter((l) => l.line_type === "INPUT")
          .map((l) => ({
            _key: l.id,
            material_id: l.material_id ?? "",
            qty: String(l.qty ?? ""),
            uom_code: l.uom_code ?? "",
            has_alternate: Boolean(l.material_group_id),
            material_group_id: l.material_group_id ?? "",
          })),
      );
    } catch {
      toast("Failed to load Pack BOM detail.", "error");
      setExpandedId("");
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreateGroupModal(onCreated) {
    setGroupForm({ group_name: "", description: "" });
    setGroupModal({ onCreated });
  }

  async function handleCreateGroup() {
    if (!groupForm.group_name.trim()) { toast("Group name required.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup(groupForm);
      const newGroup = res?.data ?? res;
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      toast("Material group created.");
      groupModal?.onCreated?.(newGroup.id);
      setGroupModal(null);
    } catch (err) { toast(friendly(err.code) || err.message, "error"); }
  }

  async function handleAddMember() {
    if (!memberMaterialId) { toast("Select a material first.", "error"); return; }
    try {
      await addMaterialCategoryMember({ group_id: memberModal, material_id: memberMaterialId });
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      toast("Member added.");
      setMemberModal(null);
      setMemberMaterialId("");
    } catch (err) { toast(friendly(err.code) || err.message, "error"); }
  }

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: ["pack-boms-approval"] });
  }

  async function handleApprove(row) {
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
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
        })),
      ];
      await approvePackBom(row.id, { lines: linesToSend });
      toast("Pack BOM approved and activated.");
      setExpandedId("");
      await invalidate();
    } catch (err) {
      toast(friendly(err.code) || err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject(row) {
    if (!rejectReason.trim()) { toast("Enter a reject reason.", "error"); return; }
    setSaving(true);
    try {
      await rejectPackBom(row.id, { reason: rejectReason.trim() });
      toast("Pack BOM rejected — returned to Procurement for revision.");
      setExpandedId("");
      await invalidate();
    } catch (err) {
      toast(friendly(err.code) || err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const boms = bomsQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="Pack BOM Approval — PR06"
      subtitle="L1 Manager Procurement reviews and approves Pack BOM submissions"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex flex-col gap-1 w-40">
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
                <th className="text-left py-2 px-3 border-b w-8"></th>
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
                <React.Fragment key={b.id}>
                  <tr
                    className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                    onClick={() => toggleExpand(b)}
                  >
                    <td className="py-2 px-3 text-slate-400">{expandedId === b.id ? "▲" : "▼"}</td>
                    <td className="py-2 px-3 font-mono font-medium">{b.sku?.pace_code ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500">{b.sku?.material_name ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500">{b.sku?.pack_code ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500">{b.created_by_display ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{b.created_at?.slice(0, 10)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {b.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === b.id && (
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      <td colSpan={7} className="p-4">
                        {detailLoading ? (
                          <p className="text-slate-400 text-sm py-4 text-center">Loading…</p>
                        ) : detail ? (
                          <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">SKU</span>
                                <p className="font-mono font-semibold">{detail.sku?.pace_code ?? "—"}</p>
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
                                <div className="col-span-3 bg-amber-50 border border-amber-200 rounded p-2 text-amber-700 text-xs">
                                  <strong>Previous rejection:</strong> {detail.reject_reason}
                                </div>
                              )}
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">PM Input Lines (editable)</p>
                              <PackBomLinesTable
                                lines={editedLines}
                                setLines={setEditedLines}
                                materials={pmMaterials}
                                groups={groups}
                                onCreateGroup={openCreateGroupModal}
                                onAddMember={(groupId) => setMemberModal(groupId)}
                                disabled={b.status !== "DRAFT"}
                              />
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

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                              <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setExpandedId("")}>
                                Close
                              </button>
                              {b.status === "DRAFT" && (
                                rejectMode ? (
                                  <>
                                    <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setRejectMode(false)}>
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={saving}
                                      className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                      onClick={() => handleReject(b)}
                                    >
                                      Confirm Reject
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={saving}
                                      className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                      onClick={() => setRejectMode(true)}
                                    >
                                      Reject…
                                    </button>
                                    <button
                                      type="button"
                                      disabled={saving}
                                      className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                                      onClick={() => handleApprove(b)}
                                    >
                                      Approve
                                    </button>
                                  </>
                                )
                              )}
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      <GroupCreateModal
        open={Boolean(groupModal)}
        groupForm={groupForm}
        setGroupForm={setGroupForm}
        onCancel={() => setGroupModal(null)}
        onCreate={handleCreateGroup}
      />

      <MemberAddModal
        open={Boolean(memberModal)}
        memberMaterialId={memberMaterialId}
        setMemberMaterialId={setMemberMaterialId}
        materialOptions={pmMaterials.map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
