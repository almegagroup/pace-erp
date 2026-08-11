/*
 * File-ID: 27.FE-PR05
 * File-Path: frontend/src/pages/dashboard/production/PackBomCreatePage.jsx
 * Gate: 27.22 | Domain: PRODUCTION
 * Purpose: Company-scoped Pack BOM create flow with server-synthesized OUTPUT/SFG rows.
 */

import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { createPackBom, listPackBomEligibleSkus } from "./prodApi.js";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";
import {
  addMaterialCategoryMember,
  createMaterialCategoryGroup,
  listMaterialCategoryGroups,
  listMaterials,
  listStorageLocations,
} from "../om/omApi.js";
import { PackBomLinesTable, GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

const PO_TYPES = ["MTO", "HPS", "MTS", "MTEST"];
const COMPANY_STORAGE_KEY = "pace.production.packBomCreate.companyId";
const TYPE_STORAGE_KEY = "pace.production.packBomCreate.poType";

const ERRORS = {
  PROD_BOM_INVALID: "Company, PO type and FG SKU are required.",
  PROD_BOM_OUTPUT_SLOC_INVALID: "Select a valid F-location for this company.",
  PROD_BOM_SFG_QTY_REQUIRED: "SFG input qty is required for this pack code.",
  PROD_BOM_ALREADY_EXISTS: "A DRAFT or ACTIVE Pack BOM already exists for this company and SKU.",
  PROD_BOM_SCOPE_VIOLATION: "You do not have access to create a Pack BOM for this company.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }
function companyLabel(company) { return [company?.company_code, company?.company_name].filter(Boolean).join(" - "); }
function materialLabel(material) { return [material?.pace_code || material?.external_code, material?.material_name || material?.document_name].filter(Boolean).join(" - "); }
function skuLabel(sku) {
  const prod = sku?.prodshade ?? {};
  return [
    sku?.pace_code || sku?.external_code,
    sku?.external_code,
    prod?.pace_code || prod?.external_code,
    prod?.material_name || prod?.document_name,
  ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index).join(" - ");
}
function slocLabel(location) { return [location?.code, location?.name].filter(Boolean).join(" - "); }
function readStoredCompanyId() {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(COMPANY_STORAGE_KEY) ?? "").trim();
}
function readStoredPoType() {
  if (typeof window === "undefined") return "MTO";
  const storedType = String(window.localStorage.getItem(TYPE_STORAGE_KEY) ?? "").trim();
  return PO_TYPES.includes(storedType) ? storedType : "MTO";
}

export default function PackBomCreatePage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();

  const [step, setStep] = useState(1);
  const [companyId, setCompanyId] = useState(readStoredCompanyId);
  const [poType, setPoType] = useState(readStoredPoType);
  const [skuMaterialId, setSkuMaterialId] = useState("");
  const [outputStorageLocationId, setOutputStorageLocationId] = useState("");
  const [sfgQty, setSfgQty] = useState("");
  const [pmLines, setPmLines] = useState([]);

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const selectedCompany = (runtimeContext?.availableCompanies ?? [])
    .find((company) => company.id === effectiveCompanyId || company.company_id === effectiveCompanyId)
    ?? runtimeContext?.currentCompany
    ?? null;

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }
  function resetDownstream() {
    setSkuMaterialId("");
    setOutputStorageLocationId("");
    setSfgQty("");
    setPmLines([]);
    setStep(1);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (companyId) {
      window.localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
      return;
    }
    const fallbackCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (fallbackCompanyId) {
      window.localStorage.setItem(COMPANY_STORAGE_KEY, fallbackCompanyId);
      setCompanyId(fallbackCompanyId);
    }
  }, [companyId, runtimeContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TYPE_STORAGE_KEY, poType);
  }, [poType]);

  const eligibleQ = useQuery({
    queryKey: ["pack-bom-eligible-skus", effectiveCompanyId, poType],
    queryFn: () => listPackBomEligibleSkus({ company_id: effectiveCompanyId, po_type: poType }),
    enabled: Boolean(effectiveCompanyId && poType),
  });
  const pmMaterialsQ = useQuery({
    queryKey: ["om-materials", "PM"],
    queryFn: () => listMaterials({ material_type: "PM", limit: 500 }),
    select: (d) => d?.data ?? [],
  });
  const groupsQ = useQuery({
    queryKey: ["om-material-groups", effectiveCompanyId],
    queryFn: () => listMaterialCategoryGroups(effectiveCompanyId),
    select: (d) => d?.data ?? [],
    enabled: Boolean(effectiveCompanyId),
  });
  const storageLocationsQ = useQuery({
    queryKey: ["om-storage-locations", effectiveCompanyId, "active"],
    queryFn: () => listStorageLocations({ company_id: effectiveCompanyId, is_active: true }),
    enabled: Boolean(effectiveCompanyId),
  });

  const eligibleSkus = eligibleQ.data ?? [];
  const selectedSku = eligibleSkus.find((sku) => sku.id === skuMaterialId) ?? null;
  const packCode = selectedSku?.pack_code_row ?? {};
  const bomRequired = packCode?.bom_required !== false;
  const outputLocations = (storageLocationsQ.data?.data ?? storageLocationsQ.data ?? [])
    .filter((location) => String(location?.code ?? "").startsWith("F"));
  const outputLocationOptions = outputLocations.map((location) => ({ value: location.id, label: slocLabel(location) }));
  const autoOutputStorageLocationId = outputStorageLocationId || (outputLocationOptions.length === 1 ? outputLocationOptions[0].value : "");
  const sfgLineLocation = selectedSku?.stroke_master?.default_storage_location ?? null;

  function openCreateGroupModal(onCreated) {
    setGroupForm({ group_name: "", description: "" });
    setGroupModal({ onCreated });
  }

  async function handleCreateGroup() {
    if (!groupForm.group_name.trim()) { toast("Group name required.", "error"); return; }
    if (!effectiveCompanyId) { toast("Select a company first.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup({ ...groupForm, company_id: effectiveCompanyId });
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
    onSuccess: async (result, variables) => {
      qc.setQueriesData(
        { queryKey: ["pack-bom-eligible-skus"] },
        (current) => Array.isArray(current)
          ? current.filter((sku) => sku?.id !== variables?.sku_material_id)
          : current,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pack-boms"] }),
        qc.invalidateQueries({ queryKey: ["pack-bom-eligible-skus"] }),
      ]);
      toast(result?.auto_approved ? "Pack BOM created and activated." : "Pack BOM submitted for PR06 approval.");
      setStep(1);
      resetDownstream();
    },
    onError: (err) => toast(friendly(err.code) || err.message, "error"),
  });

  function handleNext() {
    if (!effectiveCompanyId || !poType || !skuMaterialId) {
      toast("Select Company, PO Type and FG SKU.", "error");
      return;
    }
    setStep(2);
  }

  function handleSubmit() {
    if (!autoOutputStorageLocationId) { toast("Select OUTPUT F-location.", "error"); return; }
    if (bomRequired && !Number(sfgQty)) { toast("Enter SFG input qty.", "error"); return; }
    const validPm = pmLines.filter((line) => line.material_id && (!bomRequired || Number(line.qty) > 0));
    submitMutation.mutate({
      company_id: effectiveCompanyId,
      po_type: poType,
      sku_material_id: skuMaterialId,
      output_storage_location_id: autoOutputStorageLocationId,
      sfg_qty: bomRequired ? Number(sfgQty) : null,
      pm_lines: validPm.map((line) => ({
        material_id: line.material_id,
        qty: bomRequired ? Number(line.qty) : null,
        uom_code: line.uom_code || "KG",
        has_alternate: Boolean(line.has_alternate),
        material_group_id: line.has_alternate ? (line.material_group_id || null) : null,
        is_primary_container: Boolean(line.is_primary_container),
      })),
    });
  }

  return (
    <ErpScreenScaffold
      title="Pack BOM Create - PR05"
      subtitle="Company-scoped Pack BOM. OUTPUT and SFG rows are generated by the backend."
    >
      <ErpSectionCard title={step === 1 ? "Page 1 - Company / Type / FG SKU" : "Page 2 - BOM Lines"}>
        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="text-xs text-slate-500">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={effectiveCompanyId}
                  onChange={(value) => { setCompanyId(value); resetDownstream(); }}
                  label="Company"
                />
              </div>
              <label className="text-xs text-slate-500">
                Type *
                <select
                  className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm"
                  value={poType}
                  onChange={(event) => { setPoType(event.target.value); resetDownstream(); }}
                >
                  {PO_TYPES.map((type) => <option key={type} value={type}>{type} / {packingPoTypeForProcessType(type)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500 md:col-span-1">
                FG SKU *
                <ErpComboboxField
                  value={skuMaterialId}
                  onChange={(value) => { setSkuMaterialId(value); setOutputStorageLocationId(""); }}
                  options={eligibleSkus.map((sku) => ({ value: sku.id, label: skuLabel(sku) }))}
                  placeholder={eligibleQ.isFetching ? "Loading eligible SKUs..." : "-- Select FG SKU --"}
                  emptyStateLabel="No eligible SKU found"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="button" className="px-4 py-2 bg-sky-600 text-white rounded text-sm disabled:opacity-50" onClick={handleNext} disabled={eligibleQ.isFetching}>
                Next
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">Company</p><p className="font-semibold">{companyLabel(selectedCompany)}</p></div>
              <div><p className="text-xs text-slate-400">Type</p><p className="font-semibold">{poType} / {packingPoTypeForProcessType(poType)}</p></div>
              <div><p className="text-xs text-slate-400">FG SKU</p><p className="font-semibold">{skuLabel(selectedSku)}</p></div>
              <div><p className="text-xs text-slate-400">Base UOM / BOM</p><p className="font-semibold">KG / {bomRequired ? "Required" : "Not Required"}</p></div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Line</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Material</th>
                    <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Qty</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">UOM</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Storage Location</th>
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Movement</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="py-2 px-3 font-semibold">OUTPUT</td>
                    <td className="py-2 px-3">{skuLabel(selectedSku)}</td>
                    <td className="py-2 px-3 text-right font-mono">{bomRequired ? "1" : "Calculated"}</td>
                    <td className="py-2 px-3">{packCode.outer_uom_code || "KG"}</td>
                    <td className="py-2 px-3 min-w-[240px]">
                      {outputLocationOptions.length === 1 ? (
                        <span>{outputLocationOptions[0].label}</span>
                      ) : (
                        <ErpComboboxField
                          value={autoOutputStorageLocationId}
                          onChange={setOutputStorageLocationId}
                          options={outputLocationOptions}
                          placeholder="-- Select F-location --"
                        />
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono">P101</td>
                  </tr>
                  <tr className="border-t">
                    <td className="py-2 px-3 font-semibold">INPUT / SFG</td>
                    <td className="py-2 px-3">{materialLabel(selectedSku?.prodshade)}</td>
                    <td className="py-2 px-3 text-right">
                      {bomRequired ? (
                        <input className="h-8 w-28 border border-slate-300 rounded px-2 text-right font-mono" type="number" min="0" step="0.001" value={sfgQty} onChange={(event) => setSfgQty(event.target.value)} />
                      ) : "Calculated"}
                    </td>
                    <td className="py-2 px-3">KG</td>
                    <td className="py-2 px-3">{slocLabel(sfgLineLocation)}</td>
                    <td className="py-2 px-3 font-mono">P261</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ErpSectionCard title="PM Lines">
              <PackBomLinesTable
                lines={pmLines}
                setLines={setPmLines}
                materials={pmMaterialsQ.data ?? []}
                groups={groupsQ.data ?? []}
                onCreateGroup={openCreateGroupModal}
                onAddMember={(groupId) => setMemberModal(groupId)}
                disabled={!bomRequired}
              />
            </ErpSectionCard>
            <div className="flex justify-between">
              <button type="button" className="px-4 py-2 border rounded text-sm" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="px-5 py-2 bg-sky-600 text-white rounded text-sm disabled:opacity-50" onClick={handleSubmit} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? "Submitting..." : "Submit Pack BOM"}
              </button>
            </div>
          </div>
        )}
      </ErpSectionCard>

      <GroupCreateModal open={Boolean(groupModal)} groupForm={groupForm} setGroupForm={setGroupForm} onCancel={() => setGroupModal(null)} onCreate={handleCreateGroup} />
      <MemberAddModal
        open={Boolean(memberModal)}
        memberMaterialId={memberMaterialId}
        setMemberMaterialId={setMemberMaterialId}
        materialOptions={(pmMaterialsQ.data ?? []).map((m) => ({ value: m.id, label: materialLabel(m) }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />
    </ErpScreenScaffold>
  );
}
