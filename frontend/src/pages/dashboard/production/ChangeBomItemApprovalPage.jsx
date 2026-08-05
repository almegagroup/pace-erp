/*
 * File-ID: 27.FE-PR04
 * File-Path: frontend/src/pages/dashboard/production/ChangeBomItemApprovalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L3 Manager reviews DRAFT Stroke Change Requests, edits the
 *          Proposed column if needed, and approves or rejects them. Approve
 *          applies live to stroke_line immediately (per 83.3 PR04, LOCKED
 *          2026-06-30). Expandable inline row (same pattern as PR02 Stroke
 *          Approval) — DrawerBase's descriptor-array `actions` prop crashes
 *          with React error #31, so this page avoids DrawerBase entirely.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  listStrokeChangeRequests,
  getStrokeChangeRequest,
  approveStrokeChangeRequest,
  rejectStrokeChangeRequest,
} from "./prodApi.js";
import { listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember } from "../om/omApi.js";
import { ChangeBomLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

const STATUS_COLORS = {
  DRAFT:    "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

const ERRORS = {
  PROD_SCR_NOT_DRAFT:          "Only DRAFT change requests can be actioned.",
  PROD_SCR_REASON_REQUIRED:    "A rejection reason is required.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function ChangeBomItemApprovalPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const availableCompanies = buildTransactionCompanyList(runtimeContext);
  const companyLabelById = new Map(availableCompanies.map((c) => [c.id, `${c.company_code} — ${c.company_name}`]));
  const [companyId, setCompanyId] = useState("");
  const [companyInitialized, setCompanyInitialized] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [editLines, setEditLines] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  React.useEffect(() => {
    if (companyInitialized) return;
    const defaultId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (!defaultId) return;
    setCompanyId(defaultId);
    setCompanyInitialized(true);
  }, [companyInitialized, runtimeContext]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const crQ = useQuery({
    queryKey: ["stroke-change-requests", companyId, statusFilter],
    queryFn: () =>
      listStrokeChangeRequests({
        company_id: companyId || undefined,
        status: statusFilter || undefined,
      }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  const groupsQ = useQuery({
    queryKey: ["om-material-groups", companyId],
    queryFn: () => listMaterialCategoryGroups(companyId),
    select: (d) => d?.data ?? [],
    enabled: Boolean(companyId),
  });
  const rmMaterialsQ = useQuery({ queryKey: ["om-materials", "RM"], queryFn: () => listMaterials({ material_type: "RM", limit: 500 }), select: (d) => d?.data ?? [] });
  const intMaterialsQ = useQuery({ queryKey: ["om-materials", "INT"], queryFn: () => listMaterials({ material_type: "INT", limit: 500 }), select: (d) => d?.data ?? [] });
  const groups = groupsQ.data ?? [];
  const lineMaterialsByType = { RM: rmMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };

  const requests = crQ.data ?? [];

  async function toggleExpand(row) {
    if (expandedId === row.id) {
      setExpandedId("");
      setDetail(null);
      setEditLines(null);
      return;
    }
    setExpandedId(row.id);
    setDetail(null);
    setEditLines(null);
    setRejectMode(false);
    setRejectReason("");
    setDetailLoading(true);
    try {
      const d = await getStrokeChangeRequest(row.id);
      setDetail(d);
      const strokeLineMap = new Map((d.stroke?.lines ?? []).map((l) => [l.id, l]));
      setEditLines((d.change_lines ?? []).map((cl) => {
        const sl = strokeLineMap.get(cl.stroke_line_id) ?? {};
        return {
          stroke_line_id: cl.stroke_line_id,
          line_material_type: sl.line_material_type ?? "RM",
          current_material_id: cl.old_material_id,
          current_group_id: cl.old_group_id ?? "",
          dosage_pct: sl.dosage_pct ?? 0,
          new_material_id: cl.new_material_id,
          new_has_alternate: Boolean(cl.new_has_alternate),
          new_group_id: cl.new_group_id ?? "",
        };
      }));
    } catch {
      toast("Failed to load change request detail.", "error");
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
    if (!companyId) { toast("Select a company first.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup({ ...groupForm, company_id: companyId });
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
    await qc.invalidateQueries({ queryKey: ["stroke-change-requests"] });
  }

  async function handleApprove(row) {
    if (!editLines) return;
    setSaving(true);
    try {
      await approveStrokeChangeRequest(row.id, {
        lines: editLines.map((l) => ({
          stroke_line_id: l.stroke_line_id,
          new_material_id: l.new_material_id,
          new_has_alternate: l.new_has_alternate,
          new_group_id: l.new_has_alternate ? (l.new_group_id || null) : null,
        })),
      });
      toast("Change request approved — stroke updated.");
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
      await rejectStrokeChangeRequest(row.id, { reason: rejectReason.trim() });
      toast("Change request rejected.");
      setExpandedId("");
      await invalidate();
    } catch (err) {
      toast(friendly(err.code) || err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Change BOM Item Approval — PR04"
      subtitle="L3 Manager reviews DRAFT change requests, may edit the Proposed column, then approves or rejects."
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="w-64">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
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
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Change Requests (${requests.length})`}>
        {crQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No change requests found.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b w-8"></th>
                <th className="text-left py-2 px-3 border-b">Company</th>
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-left py-2 px-3 border-b">Description</th>
                <th className="text-left py-2 px-3 border-b">Requested By</th>
                <th className="text-left py-2 px-3 border-b">Date</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <React.Fragment key={r.id}>
                  <tr
                    className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                    onClick={() => toggleExpand(r)}
                  >
                    <td className="py-2 px-3 text-slate-400">{expandedId === r.id ? "▲" : "▼"}</td>
                    <td className="py-2 px-3 text-slate-500">{companyLabelById.get(r.company_id) ?? "—"}</td>
                    <td className="py-2 px-3 font-mono font-semibold">#{r.stroke?.stroke_number ?? "?"}</td>
                    <td className="py-2 px-3 text-slate-500">{r.stroke?.description ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500">{r.created_by_display ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{r.created_at?.slice(0, 10)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      <td colSpan={7} className="p-4">
                        {detailLoading ? (
                          <p className="text-slate-400 text-sm py-4 text-center">Loading…</p>
                        ) : detail && editLines ? (
                          <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">Stroke</span>
                                <p className="font-mono font-semibold">#{detail.stroke?.stroke_number ?? "?"}</p>
                              </div>
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">Description</span>
                                <p className="font-medium">{detail.stroke?.description ?? "—"}</p>
                              </div>
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">Requested By</span>
                                <p className="font-medium">{detail.created_by_display ?? "—"} · {detail.created_at?.slice(0, 10)}</p>
                              </div>
                              {detail.approved_by_display && (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Approved By</span>
                                  <p className="font-medium">{detail.approved_by_display} · {detail.approved_at?.slice(0, 10)}</p>
                                </div>
                              )}
                              {detail.reject_reason && (
                                <div className="col-span-3 bg-rose-50 border border-rose-200 rounded p-2 text-rose-700 text-sm">
                                  <strong>Reject reason:</strong> {detail.reject_reason}
                                </div>
                              )}
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                                RM / INT Lines — Current vs Proposed
                              </p>
                              <ChangeBomLinesTable
                                lines={editLines}
                                setLines={setEditLines}
                                materialsByType={lineMaterialsByType}
                                groups={groups}
                                onCreateGroup={openCreateGroupModal}
                                onAddMember={(groupId) => setMemberModal(groupId)}
                                editable={r.status === "DRAFT"}
                              />
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

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                              <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setExpandedId("")}>
                                Close
                              </button>
                              {r.status === "DRAFT" && (
                                rejectMode ? (
                                  <>
                                    <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setRejectMode(false)}>
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={saving}
                                      className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                      onClick={() => handleReject(r)}
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
                                      onClick={() => handleApprove(r)}
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
        materialOptions={[...(lineMaterialsByType.RM ?? []), ...(lineMaterialsByType.INT ?? [])].map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
