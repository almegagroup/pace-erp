/*
 * File-ID: 27.FE-PR06
 * File-Path: frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx
 * Gate: 27.22 | Domain: PRODUCTION
 * Purpose: Review company-scoped Pack BOMs and approve DRAFT BOMs.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { approvePackBom, getPackBom, listPackBoms, rejectPackBom } from "./prodApi.js";
import { addMaterialCategoryMember, createMaterialCategoryGroup, listMaterialCategoryGroups, listMaterials } from "../om/omApi.js";
import { GroupCreateModal, MemberAddModal, PackBomLinesTable } from "./strokeShared.jsx";

const STATUS_COLORS = {
  DRAFT: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
};

const ERRORS = {
  PROD_BOM_NOT_DRAFT: "Only DRAFT Pack BOMs can be approved.",
  PROD_BOM_REASON_REQUIRED: "A rejection reason is required.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }
function materialLabel(material) { return [material?.pace_code, material?.material_name].filter(Boolean).join(" - "); }
function companyLabel(company) { return [company?.company_code, company?.company_name].filter(Boolean).join(" - "); }
function slocLabel(location) { return [location?.code, location?.name].filter(Boolean).join(" - "); }

export default function PackBomApprovalPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const effectiveCompanyFilter = companyFilter || resolveDefaultTransactionCompanyId(runtimeContext);
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
    queryKey: ["pack-boms-approval", statusFilter, effectiveCompanyFilter],
    queryFn: () => listPackBoms({ status: statusFilter || undefined, company_id: effectiveCompanyFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  const pmMaterialsQ = useQuery({
    queryKey: ["om-materials", "PM"],
    queryFn: () => listMaterials({ material_type: "PM", limit: 500 }),
    select: (d) => d?.data ?? [],
  });
  const groupsQ = useQuery({
    queryKey: ["om-material-groups"],
    queryFn: () => listMaterialCategoryGroups(),
    select: (d) => d?.data ?? [],
  });

  const boms = bomsQ.data ?? [];
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
      setEditedLines((d.lines ?? []).filter((line) => line.line_type === "INPUT").map((line) => ({
        _key: line.id,
        material_id: line.material_id ?? "",
        qty: String(line.qty ?? ""),
        uom_code: line.uom_code ?? "",
        has_alternate: Boolean(line.material_group_id),
        material_group_id: line.material_group_id ?? "",
        is_primary_container: Boolean(line.is_primary_container),
      })));
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
      const mandatoryLines = (detail.lines ?? []).filter((line) => line.line_type !== "INPUT").map((line) => ({
        line_type: line.line_type,
        material_id: line.material_id,
        qty: line.qty,
        uom_code: line.uom_code,
        storage_location_id: line.storage_location_id,
        movement_type_code: line.movement_type_code,
        has_alternate: false,
        material_group_id: null,
        is_primary_container: false,
      }));
      const pmLines = editedLines.map((line) => ({
        line_type: "INPUT",
        material_id: line.material_id,
        qty: Number(line.qty),
        uom_code: line.uom_code,
        movement_type_code: "P261",
        has_alternate: line.has_alternate,
        material_group_id: line.has_alternate ? (line.material_group_id || null) : null,
        is_primary_container: Boolean(line.is_primary_container),
      }));
      await approvePackBom(row.id, { lines: [...mandatoryLines, ...pmLines] });
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
      toast("Pack BOM rejected.");
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
      title="Pack BOM Approval - PR06"
      subtitle="Review company-scoped Pack BOM submissions"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex flex-wrap gap-3">
          <div className="w-64">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyFilter}
              onChange={setCompanyFilter}
              label="Company"
            />
          </div>
          <label className="flex flex-col gap-1 w-40 text-xs text-slate-500">
            Status
            <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
            </select>
          </label>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Pack BOMs (${boms.length})`}>
        {bomsQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading...</p>
        ) : boms.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No Pack BOMs found.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b w-8"></th>
                <th className="text-left py-2 px-3 border-b">Company</th>
                <th className="text-left py-2 px-3 border-b">SKU Code</th>
                <th className="text-left py-2 px-3 border-b">SKU Name</th>
                <th className="text-left py-2 px-3 border-b">Pack Code</th>
                <th className="text-left py-2 px-3 border-b">Created By</th>
                <th className="text-left py-2 px-3 border-b">Date</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {boms.map((bom) => (
                <React.Fragment key={bom.id}>
                  <tr className="hover:bg-sky-50 cursor-pointer border-b border-slate-100" onClick={() => toggleExpand(bom)}>
                    <td className="py-2 px-3 text-slate-400">{expandedId === bom.id ? "UP" : "DOWN"}</td>
                    <td className="py-2 px-3 text-slate-500">{companyLabel(bom.company) || "-"}</td>
                    <td className="py-2 px-3 font-mono font-medium">{bom.sku?.pace_code ?? "-"}</td>
                    <td className="py-2 px-3 text-slate-500">{bom.sku?.material_name ?? "-"}</td>
                    <td className="py-2 px-3 text-slate-500">{bom.sku?.pack_code ?? "-"}</td>
                    <td className="py-2 px-3 text-slate-500">{bom.created_by_display ?? "-"}</td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{bom.created_at?.slice(0, 10)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[bom.status] ?? "bg-slate-100 text-slate-600"}`}>{bom.status}</span>
                    </td>
                  </tr>
                  {expandedId === bom.id && (
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      <td colSpan={8} className="p-4">
                        {detailLoading ? (
                          <p className="text-slate-400 text-sm py-4 text-center">Loading...</p>
                        ) : detail ? (
                          <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                              <div><span className="text-slate-400 text-xs block">Company</span><p>{companyLabel(detail.company)}</p></div>
                              <div><span className="text-slate-400 text-xs block">SKU</span><p className="font-mono font-semibold">{detail.sku?.pace_code ?? "-"}</p></div>
                              <div><span className="text-slate-400 text-xs block">Material Name</span><p>{detail.sku?.material_name ?? "-"}</p></div>
                              <div><span className="text-slate-400 text-xs block">Pack Code</span><p className="font-mono">{detail.sku?.pack_code ?? "-"}</p></div>
                            </div>

                            <div className="rounded border border-slate-200 bg-white overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50">
                                  <tr>
                                    <th className="text-left p-2">Type</th>
                                    <th className="text-left p-2">Material</th>
                                    <th className="text-right p-2">Qty</th>
                                    <th className="text-left p-2">UOM</th>
                                    <th className="text-left p-2">Storage Location</th>
                                    <th className="text-left p-2">Movement</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(detail.lines ?? []).filter((line) => line.line_type !== "INPUT").map((line) => (
                                    <tr key={line.id} className="border-t">
                                      <td className="p-2 font-semibold">{line.line_type}</td>
                                      <td className="p-2">{materialLabel(line.material)}</td>
                                      <td className="p-2 text-right font-mono">{line.qty ?? "Calculated"}</td>
                                      <td className="p-2">{line.uom_code ?? "-"}</td>
                                      <td className="p-2">{slocLabel(line.storage_location) || "-"}</td>
                                      <td className="p-2 font-mono">{line.movement_type_code ?? "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">PM Input Lines</p>
                              <PackBomLinesTable
                                lines={editedLines}
                                setLines={setEditedLines}
                                materials={pmMaterials}
                                groups={groups}
                                onCreateGroup={openCreateGroupModal}
                                onAddMember={(groupId) => setMemberModal(groupId)}
                                disabled={bom.status !== "DRAFT"}
                              />
                            </div>

                            {rejectMode && (
                              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                                Rejection Reason
                                <textarea className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full h-20 resize-none" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                              </label>
                            )}

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                              <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm" onClick={() => setExpandedId("")}>Close</button>
                              {bom.status === "DRAFT" && (
                                rejectMode ? (
                                  <>
                                    <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm" onClick={() => setRejectMode(false)}>Cancel</button>
                                    <button type="button" disabled={saving} className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 disabled:opacity-50" onClick={() => handleReject(bom)}>Confirm Reject</button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" disabled={saving} className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 disabled:opacity-50" onClick={() => setRejectMode(true)}>Reject</button>
                                    <button type="button" disabled={saving} className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => handleApprove(bom)}>Approve</button>
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

      <GroupCreateModal open={Boolean(groupModal)} groupForm={groupForm} setGroupForm={setGroupForm} onCancel={() => setGroupModal(null)} onCreate={handleCreateGroup} />
      <MemberAddModal
        open={Boolean(memberModal)}
        memberMaterialId={memberMaterialId}
        setMemberMaterialId={setMemberMaterialId}
        materialOptions={pmMaterials.map((material) => ({ value: material.id, label: materialLabel(material) }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
