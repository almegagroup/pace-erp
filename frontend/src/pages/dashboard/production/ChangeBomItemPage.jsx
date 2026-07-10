/*
 * File-ID: 27.FE-PR03
 * File-Path: frontend/src/pages/dashboard/production/ChangeBomItemPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L1/L2 Manager creates a material-substitution Change Request on an
 *          ACTIVE Stroke. Does NOT modify the live stroke — creates a DRAFT
 *          for L3 Manager approval (PR04). Per 83.3 PR03 (LOCKED 2026-06-30):
 *          only Item / Has Alternate / Material Group can change — Dosage%,
 *          Material Type, PO Type, Prod/Shade and Stroke Number are locked.
 */

import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { listStrokeMasters, getStrokeMaster, createStrokeChangeRequest } from "./prodApi.js";
import { listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember } from "../om/omApi.js";
import { friendlyStrokeErr, ChangeBomLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

function prodshadeLabel(s) {
  if (s.material) return `${s.material.pace_code ?? "—"} — ${s.material.material_name ?? "—"}`;
  return `#${s.stroke_number}`;
}

export default function ChangeBomItemPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [companyInitialized, setCompanyInitialized] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState("");
  const [changeLines, setChangeLines] = useState([]);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [loadingLines, setLoadingLines] = useState(false);

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  useEffect(() => {
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

  const strokesQ = useQuery({
    queryKey: ["stroke-cr-strokes", companyId],
    queryFn: () => listStrokeMasters({ company_id: companyId || undefined, status: "APPROVED" }),
    enabled: Boolean(companyId),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  const strokes = strokesQ.data ?? [];
  const strokeOptions = strokes.map((s) => ({ value: s.id, label: `${prodshadeLabel(s)} — stroke #${s.stroke_number}` }));

  const groupsQ = useQuery({ queryKey: ["om-material-groups"], queryFn: () => listMaterialCategoryGroups(), select: (d) => d?.data ?? [] });
  const rmMaterialsQ = useQuery({ queryKey: ["om-materials", "RM"], queryFn: () => listMaterials({ material_type: "RM", limit: 500 }), select: (d) => d?.data ?? [] });
  const intMaterialsQ = useQuery({ queryKey: ["om-materials", "INT"], queryFn: () => listMaterials({ material_type: "INT", limit: 500 }), select: (d) => d?.data ?? [] });
  const groups = groupsQ.data ?? [];
  const lineMaterialsByType = { RM: rmMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };

  async function handleStrokeChange(id) {
    setSelectedStrokeId(id);
    setChangeLines([]);
    if (!id) return;
    setLoadingLines(true);
    try {
      const detail = await getStrokeMaster(id);
      setChangeLines((detail.lines ?? []).map((l) => ({
        stroke_line_id: l.id,
        line_material_type: l.line_material_type ?? "RM",
        current_material_id: l.material_id,
        current_group_id: l.material_group_id ?? "",
        dosage_pct: l.dosage_pct,
        new_material_id: l.material_id,
        new_has_alternate: Boolean(l.material_group_id),
        new_group_id: l.material_group_id ?? "",
      })));
    } catch {
      toast("Failed to load stroke lines.", "error");
    } finally {
      setLoadingLines(false);
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
    } catch (err) { toast(friendlyStrokeErr(err.code) || err.message, "error"); }
  }

  async function handleAddMember() {
    if (!memberMaterialId) { toast("Select a material first.", "error"); return; }
    try {
      await addMaterialCategoryMember({ group_id: memberModal, material_id: memberMaterialId });
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      toast("Member added.");
      setMemberModal(null);
      setMemberMaterialId("");
    } catch (err) { toast(friendlyStrokeErr(err.code) || err.message, "error"); }
  }

  const submitMutation = useMutation({
    mutationFn: (payload) => createStrokeChangeRequest(payload),
    onSuccess: () => {
      toast("Change request created — awaiting L3 Manager approval.");
      setSelectedStrokeId("");
      setChangeLines([]);
      qc.invalidateQueries({ queryKey: ["stroke-cr-strokes"] });
    },
    onError: (err) => toast(friendlyStrokeErr(err.code) || err.message, "error"),
  });

  function handleSubmit() {
    if (!selectedStrokeId || !companyId) {
      toast("Select a company and stroke first.", "error");
      return;
    }
    const hasChange = changeLines.some((l) =>
      l.new_material_id !== l.current_material_id ||
      Boolean(l.new_has_alternate) !== Boolean(l.current_group_id) ||
      l.new_group_id !== l.current_group_id,
    );
    if (!hasChange) {
      toast("Change at least one line before submitting.", "error");
      return;
    }
    submitMutation.mutate({
      stroke_master_id: selectedStrokeId,
      company_id: companyId,
      lines: changeLines.map((l) => ({
        stroke_line_id: l.stroke_line_id,
        new_material_id: l.new_material_id,
        new_has_alternate: l.new_has_alternate,
        new_group_id: l.new_has_alternate ? (l.new_group_id || null) : null,
      })),
    });
  }

  return (
    <ErpScreenScaffold
      title="Change BOM Item — PR03"
      subtitle="Substitute RM/INT materials on an ACTIVE Stroke. Dosage%, Material Type, Prodshade and Stroke Number are locked."
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Select Stroke">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="w-64">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
          </div>
          <div className="w-96">
            <label className="text-xs text-slate-500 block mb-1">Stroke (APPROVED only)</label>
            <ErpComboboxField
              value={selectedStrokeId}
              onChange={handleStrokeChange}
              options={strokeOptions}
              placeholder="-- Select stroke --"
              emptyStateLabel="No APPROVED strokes for this company"
              disabled={!companyId}
            />
          </div>
          {strokesQ.isLoading && <p className="text-sm text-slate-400">Loading strokes…</p>}
        </div>
      </ErpSectionCard>

      {selectedStrokeId && (
        <ErpSectionCard title="RM / INT Lines — Current vs Proposed">
          {loadingLines ? (
            <p className="text-slate-400 text-sm py-4 text-center">Loading…</p>
          ) : changeLines.length === 0 ? (
            <p className="text-slate-400 text-sm py-4 text-center">This stroke has no RM/INT lines.</p>
          ) : (
            <>
              <ChangeBomLinesTable
                lines={changeLines}
                setLines={setChangeLines}
                materialsByType={lineMaterialsByType}
                groups={groups}
                onCreateGroup={openCreateGroupModal}
                onAddMember={(groupId) => setMemberModal(groupId)}
                editable
              />
              <div className="mt-4 flex justify-end">
                <button
                  className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-5 py-2 rounded disabled:opacity-50"
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? "Submitting…" : "Submit Change Request"}
                </button>
              </div>
            </>
          )}
        </ErpSectionCard>
      )}

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
