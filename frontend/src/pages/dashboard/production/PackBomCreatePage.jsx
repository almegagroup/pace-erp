/*
 * File-ID: 27.FE-PR05
 * File-Path: frontend/src/pages/dashboard/production/PackBomCreatePage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Procurement creates Pack BOM for an FG SKU.
 *          599/000/001 pack codes → auto-ACTIVE. Others → DRAFT → PR06 approval queue.
 *          Per 83.3 Pack BOM lock (2026-06-30): no Stroke Number, no Dosage%,
 *          absolute Qty, PM lines support Has Alternate + Material Group
 *          (same mechanism as Stroke Master RM lines).
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { createPackBom } from "./prodApi.js";
import { listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember } from "../om/omApi.js";
import { PackBomLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

const ERRORS = {
  PROD_BOM_INVALID:        "FG SKU is required.",
  PROD_BOM_NOT_FG:         "Pack BOM can only be created for FG materials.",
  PROD_BOM_ALREADY_EXISTS: "A DRAFT or ACTIVE Pack BOM already exists for this SKU.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function PackBomCreatePage() {
  const qc = useQueryClient();
  const [skuMaterialId, setSkuMaterialId] = useState("");
  const [pmLines, setPmLines] = useState([]);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const fgMaterialsQ = useQuery({ queryKey: ["om-materials", "FG"], queryFn: () => listMaterials({ material_type: "FG", limit: 500 }), select: (d) => d?.data ?? [] });
  const pmMaterialsQ = useQuery({ queryKey: ["om-materials", "PM"], queryFn: () => listMaterials({ material_type: "PM", limit: 500 }), select: (d) => d?.data ?? [] });
  const groupsQ = useQuery({ queryKey: ["om-material-groups"], queryFn: () => listMaterialCategoryGroups(), select: (d) => d?.data ?? [] });

  const fgMaterials = fgMaterialsQ.data ?? [];
  const pmMaterials = pmMaterialsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const fgOptions = fgMaterials.map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }));

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
    mutationFn: (payload) => createPackBom(payload),
    onSuccess: (result) => {
      if (result?.auto_approved) {
        toast("Pack BOM created and automatically activated (BOM not required for this pack code).");
      } else {
        toast("Pack BOM submitted — awaiting L1 Manager Procurement approval (PR06).");
      }
      setSkuMaterialId("");
      setPmLines([]);
      qc.invalidateQueries({ queryKey: ["pack-boms"] });
    },
    onError: (err) => toast(friendly(err.code) || err.message, "error"),
  });

  function handleSubmit() {
    if (!skuMaterialId) {
      toast("Select the FG SKU.", "error");
      return;
    }
    const validPm = pmLines.filter((l) => l.material_id && Number(l.qty) > 0);
    if (validPm.length === 0) {
      toast("Add at least one PM line with a material and quantity.", "error");
      return;
    }

    const lines = [
      { line_type: "OUTPUT", material_id: skuMaterialId, qty: 1, uom_code: "KG", has_alternate: false },
      ...validPm.map((l) => ({
        line_type: "INPUT",
        material_id: l.material_id,
        qty: Number(l.qty),
        uom_code: l.uom_code || "KG",
        has_alternate: l.has_alternate,
        material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
      })),
    ];

    submitMutation.mutate({ sku_material_id: skuMaterialId, lines });
  }

  return (
    <ErpScreenScaffold
      title="Pack BOM Create — PR05"
      subtitle="Define packing material components for an FG SKU. 599/000/001 packs activate immediately; others go to PR06 approval."
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="FG SKU">
        <div className="max-w-md">
          <label className="text-xs text-slate-500 block mb-1">FG Material</label>
          <ErpComboboxField
            value={skuMaterialId}
            onChange={setSkuMaterialId}
            options={fgOptions}
            placeholder="-- Select FG SKU --"
            emptyStateLabel="No FG materials found"
          />
          <p className="text-xs text-slate-400 mt-1">
            One OUTPUT line (qty=1 KG) is auto-added from this SKU.
          </p>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title="PM Input Lines">
        <p className="text-xs text-slate-500 mb-3">
          Add packing material (PM) lines. Qty = quantity per pack unit.
        </p>
        <PackBomLinesTable
          lines={pmLines}
          setLines={setPmLines}
          materials={pmMaterials}
          groups={groups}
          onCreateGroup={openCreateGroupModal}
          onAddMember={(groupId) => setMemberModal(groupId)}
        />
        <div className="flex justify-end mt-3">
          <button
            className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-5 py-2 rounded disabled:opacity-50"
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? "Submitting…" : "Submit Pack BOM"}
          </button>
        </div>
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
