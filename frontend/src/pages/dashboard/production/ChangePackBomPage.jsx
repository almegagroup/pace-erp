/*
 * File-ID: 27.FE-PR07
 * File-Path: frontend/src/pages/dashboard/production/ChangePackBomPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Procurement proposes changes to an ACTIVE Pack BOM.
 *          Creates a DRAFT change request → PR08 approval queue for L1 Manager.
 *          Per 83.3 Pack BOM lock (2026-06-30): add / remove / edit qty /
 *          substitute item / edit Material Group — same mechanism as Stroke
 *          Master RM lines, but free-form CRUD instead of fixed substitution.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { getPackBom, listPackBoms, createPackBomChangeRequest } from "./prodApi.js";
import { listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember } from "../om/omApi.js";
import { PackBomChangeLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

const ERRORS = {
  PROD_BCR_NO_CHANGES:      "At least one change required.",
  PROD_BCR_BOM_NOT_ACTIVE:  "Change requests can only be created for ACTIVE Pack BOMs.",
  PROD_BCR_ALREADY_PENDING: "A pending change request already exists for this BOM.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function ChangePackBomPage() {
  const qc = useQueryClient();
  const [selectedBomId, setSelectedBomId] = useState("");
  const [bom, setBom] = useState(null);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState([]);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const activeBomsQ = useQuery({
    queryKey: ["pack-boms-active-for-change"],
    queryFn: () => listPackBoms({ status: "ACTIVE" }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  const pmMaterialsQ = useQuery({ queryKey: ["om-materials", "PM"], queryFn: () => listMaterials({ material_type: "PM", limit: 500 }), select: (d) => d?.data ?? [] });
  const groupsQ = useQuery({ queryKey: ["om-material-groups"], queryFn: () => listMaterialCategoryGroups(), select: (d) => d?.data ?? [] });

  const activeBoms = activeBomsQ.data ?? [];
  const pmMaterials = pmMaterialsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const bomOptions = activeBoms.map((b) => ({
    value: b.id,
    label: `${b.sku?.pace_code ?? "—"} — ${b.sku?.material_name ?? ""}${b.sku?.pack_code ? ` (${b.sku.pack_code})` : ""}`,
  }));

  async function handleBomChange(id) {
    setSelectedBomId(id);
    setBom(null);
    setChanges([]);
    if (!id) return;
    setLoading(true);
    try {
      const full = await getPackBom(id);
      setBom(full);
      setChanges(
        (full.lines ?? [])
          .filter((l) => l.line_type === "INPUT")
          .map((l) => ({
            _key: l.id,
            action: "EDIT",
            bom_line_id: l.id,
            old_material_id: l.material_id ?? "",
            old_qty: l.qty,
            old_has_alternate: Boolean(l.material_group_id),
            old_group_id: l.material_group_id ?? "",
            material_id: l.material_id ?? "",
            qty: String(l.qty ?? ""),
            uom_code: l.uom_code ?? "",
            has_alternate: Boolean(l.material_group_id),
            material_group_id: l.material_group_id ?? "",
            marked_remove: false,
          })),
      );
    } catch {
      toast("Failed to load Pack BOM detail.", "error");
    } finally {
      setLoading(false);
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

  const submitMutation = useMutation({
    mutationFn: (payload) => createPackBomChangeRequest(bom.id, payload),
    onSuccess: () => {
      toast("Change request created — awaiting L1 Manager Procurement approval (PR08).");
      setBom(null);
      setChanges([]);
      setSelectedBomId("");
      qc.invalidateQueries({ queryKey: ["pack-bom-change-requests"] });
    },
    onError: (err) => toast(friendly(err.code) || err.message, "error"),
  });

  function handleSubmit() {
    if (!bom) return;
    const payload = [];
    for (const c of changes) {
      if (c.action === "ADD") {
        if (c.material_id && Number(c.qty) > 0) {
          payload.push({
            action: "ADD",
            material_id: c.material_id,
            qty: Number(c.qty),
            uom_code: c.uom_code || "KG",
            has_alternate: c.has_alternate,
            material_group_id: c.has_alternate ? (c.material_group_id || null) : null,
          });
        }
        continue;
      }
      if (c.marked_remove || c.action === "REMOVE") {
        payload.push({ action: "REMOVE", bom_line_id: c.bom_line_id });
        continue;
      }
      const changed =
        c.material_id !== c.old_material_id ||
        Number(c.qty) !== Number(c.old_qty) ||
        Boolean(c.has_alternate) !== Boolean(c.old_has_alternate) ||
        (c.has_alternate && c.material_group_id !== c.old_group_id);
      if (changed) {
        payload.push({
          action: "EDIT",
          bom_line_id: c.bom_line_id,
          material_id: c.material_id,
          qty: Number(c.qty),
          uom_code: c.uom_code || "KG",
          has_alternate: c.has_alternate,
          material_group_id: c.has_alternate ? (c.material_group_id || null) : null,
        });
      }
    }

    if (payload.length === 0) {
      toast("No changes to submit.", "error");
      return;
    }
    submitMutation.mutate({ changes: payload });
  }

  return (
    <ErpScreenScaffold
      title="Change Pack BOM — PR07"
      subtitle="Propose PM line changes to an ACTIVE Pack BOM — creates a change request for L1 Manager approval"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Select Active Pack BOM">
        <div className="max-w-md">
          <label className="text-xs text-slate-500 block mb-1">FG SKU</label>
          <ErpComboboxField
            value={selectedBomId}
            onChange={handleBomChange}
            options={bomOptions}
            placeholder="-- Select ACTIVE Pack BOM --"
            emptyStateLabel="No ACTIVE Pack BOMs found"
          />
          {loading && <p className="text-xs text-slate-400 mt-1">Loading…</p>}
        </div>
      </ErpSectionCard>

      {bom && (
        <>
          <ErpSectionCard title="BOM Header">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">SKU Code</span>
                <p className="font-mono font-semibold">{bom.sku?.pace_code ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Material Name</span>
                <p>{bom.sku?.material_name ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Pack Code</span>
                <p className="font-mono">{bom.sku?.pack_code ?? "—"}</p>
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard title="PM Lines — Propose Changes">
            <p className="text-xs text-slate-500 mb-3">
              Click "Remove" to mark a line for removal, edit qty/material/group inline, or "+ Add PM Line" for new components.
            </p>
            <PackBomChangeLinesTable
              lines={changes}
              setLines={setChanges}
              materials={pmMaterials}
              groups={groups}
              onCreateGroup={openCreateGroupModal}
              onAddMember={(groupId) => setMemberModal(groupId)}
              editable
            />
            <div className="flex justify-end mt-3">
              <button
                className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-5 py-2 rounded disabled:opacity-50"
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Submitting…" : "Submit Change Request"}
              </button>
            </div>
          </ErpSectionCard>
        </>
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
        materialOptions={pmMaterials.map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
