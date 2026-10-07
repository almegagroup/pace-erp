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

import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { getPackBom, listPackBoms, createPackBomChangeRequest } from "./prodApi.js";
import { listPackBomEligibleSkus } from "./prodApi.js";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";
import { listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember } from "../om/omApi.js";
import { PackBomChangeLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

const ERRORS = {
  PROD_BCR_NO_CHANGES:      "At least one change required.",
  PROD_BCR_BOM_NOT_ACTIVE:  "Change requests can only be created for ACTIVE Pack BOMs.",
  PROD_BCR_ALREADY_PENDING: "A pending change request already exists for this BOM.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const PO_TYPES = ["MTO", "HPS", "MTS", "MTEST"];
const COMPANY_STORAGE_KEY = "pace.production.changePackBom.companyId";
const TYPE_STORAGE_KEY = "pace.production.changePackBom.poType";

function readStoredCompanyId() {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(COMPANY_STORAGE_KEY) ?? "").trim();
}
function readStoredPoType() {
  if (typeof window === "undefined") return "MTO";
  const value = String(window.localStorage.getItem(TYPE_STORAGE_KEY) ?? "").trim();
  return PO_TYPES.includes(value) ? value : "MTO";
}
function skuDocumentLabel(sku) {
  return [sku?.pace_code || sku?.external_code, sku?.document_name || sku?.material_name]
    .filter(Boolean)
    .join(" — ");
}

export default function ChangePackBomPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState(readStoredCompanyId);
  const [poType, setPoType] = useState(readStoredPoType);
  const [selectedBomId, setSelectedBomId] = useState("");
  const [bom, setBom] = useState(null);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState([]);

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  function resetSelectedBom() {
    setSelectedBomId("");
    setBom(null);
    setChanges([]);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (companyId) {
      window.localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
      return;
    }
    const fallbackCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (fallbackCompanyId) setCompanyId(fallbackCompanyId);
  }, [companyId, runtimeContext]);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(TYPE_STORAGE_KEY, poType);
  }, [poType]);

  const activeBomsQ = useQuery({
    queryKey: ["pack-boms-active-for-change", effectiveCompanyId],
    queryFn: () => listPackBoms({ status: "ACTIVE", company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  const eligibleSkusQ = useQuery({
    queryKey: ["pack-bom-eligible-skus-for-change", effectiveCompanyId, poType],
    queryFn: () => listPackBomEligibleSkus({ company_id: effectiveCompanyId, po_type: poType, include_existing: true }),
    enabled: Boolean(effectiveCompanyId && poType),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  // business owner, 2026-09-30: same cross-company material leak found across
  // the SO create pages -- this never passed company_id, so a substitution
  // candidate from another company showed up in this Pack BOM's line too.
  const pmMaterialsQ = useQuery({ queryKey: ["om-materials", "PM", bom?.company_id], queryFn: () => listMaterials({ material_type: "PM", limit: 500, company_id: bom?.company_id || undefined }), enabled: Boolean(bom?.company_id), select: (d) => d?.data ?? [] });
  const groupsQ = useQuery({
    queryKey: ["om-material-groups", bom?.company_id],
    queryFn: () => listMaterialCategoryGroups(bom?.company_id),
    select: (d) => d?.data ?? [],
    enabled: Boolean(bom?.company_id),
  });

  const eligibleSkuIds = new Set((eligibleSkusQ.data ?? []).map((sku) => sku.id));
  const activeBoms = (activeBomsQ.data ?? []).filter((item) => eligibleSkuIds.has(item.sku_material_id));
  const pmMaterials = pmMaterialsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const bomOptions = activeBoms.map((b) => ({
    value: b.id,
    label: `${skuDocumentLabel(b.sku)}${b.sku?.pack_code ? ` (${b.sku.pack_code})` : ""}`,
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
            old_is_primary_container: Boolean(l.is_primary_container),
            is_primary_container: Boolean(l.is_primary_container),
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
    if (!bom?.company_id) { toast("Select a Pack BOM first.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup({ ...groupForm, company_id: bom.company_id });
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
            is_primary_container: Boolean(c.is_primary_container),
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
        Boolean(c.is_primary_container) !== Boolean(c.old_is_primary_container) ||
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
          is_primary_container: Boolean(c.is_primary_container),
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
    >
      <ErpSectionCard title="Select Active Pack BOM">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={effectiveCompanyId}
              onChange={(value) => { setCompanyId(value); resetSelectedBom(); }}
              label="Company"
            />
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            PO Type
            <select
              className="h-9 w-full border border-slate-300 rounded px-2 text-sm"
              value={poType}
              onChange={(event) => { setPoType(event.target.value); resetSelectedBom(); }}
            >
              {PO_TYPES.map((type) => <option key={type} value={type}>{type} / {packingPoTypeForProcessType(type)}</option>)}
            </select>
          </label>
          <div>
            <label className="text-xs text-slate-500 block mb-1">FG SKU</label>
            <ErpComboboxField
              value={selectedBomId}
              onChange={handleBomChange}
              options={bomOptions}
              placeholder={eligibleSkusQ.isFetching ? "Loading eligible SKUs..." : "-- Select ACTIVE Pack BOM --"}
              emptyStateLabel="No ACTIVE Pack BOM found for this Company and PO Type"
            />
          </div>
        </div>
        {loading && <p className="text-xs text-slate-400 mt-1">Loading…</p>}
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
            {bom.pack_code_row?.inner_uom_code && (
              <p className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                This pack code has 2 alternate layers. The Inner-layer material must be in{" "}
                <span className="font-mono font-semibold">{bom.pack_code_row.inner_uom_code}</span> with its{" "}
                <span className="font-semibold">Inner Layer?</span> checkbox ticked — the outer layer (
                <span className="font-mono font-semibold">{bom.pack_code_row.outer_uom_code}</span>) needs no flag.
              </p>
            )}
            <PackBomChangeLinesTable
              lines={changes}
              setLines={setChanges}
              materials={pmMaterials}
              groups={groups}
              onCreateGroup={openCreateGroupModal}
              onAddMember={(groupId) => setMemberModal(groupId)}
              editable
              innerUomCode={bom.pack_code_row?.inner_uom_code || ""}
              sfgQtyPerInner={(() => {
                // Read-only reference here (SFG recipe isn't part of this change-request
                // flow) -- derived from the saved Outer total ÷ whichever proposed line is
                // currently flagged as the Inner layer.
                const sfgTotal = Number((bom.lines ?? []).find((line) => line.line_type === "SFG")?.qty);
                const innerLine = changes.find((line) => line.is_primary_container);
                const innerQty = Number(innerLine?.qty);
                return sfgTotal > 0 && innerQty > 0 ? sfgTotal / innerQty : "";
              })()}
              baseUomCode={bom.sku?.base_uom_code || "KG"}
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
        materialOptions={pmMaterials.map((m) => ({ value: m.id, label: [m.material_name, m.document_name].filter(Boolean).join(" — ") }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
