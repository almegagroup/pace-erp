/*
 * File-ID: 27.FE-PR02
 * File-Path: frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L3 Manager reviews DRAFT strokes and approves them. Expandable
 *          inline row (CSN Tracker pattern) instead of a side drawer — the
 *          old DrawerBase actions-as-descriptor-array bug crashed this page
 *          on open (React error #31).
 *
 *          Edit rule (per business owner, 2026-07-10): Material Type,
 *          Prodshade and Stroke Number are locked once a Stroke exists —
 *          everything else (PO Type, Description, UOM, Default Storage
 *          Location, RM/INT lines) is editable here. Save = Approve.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  listStrokeMasters, getStrokeMaster, updateStrokeMaster,
  approveStrokeMaster, revertStrokeMaster, rejectStrokeMaster, deactivateStrokeMaster, reactivateStrokeMaster,
} from "./prodApi.js";
import { listUoms, listMaterials, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember, listStorageLocations } from "../om/omApi.js";
import {
  PO_TYPE_OPTIONS_BY_MATERIAL_TYPE, friendlyStrokeErr, dosageSumOf, Field,
  StrokeLinesTable, GroupCreateModal, MemberAddModal,
} from "./strokeShared.jsx";
import { formatSum } from "./productionPrecision.js";

const EMPTY_ARRAY = [];

const STATUS_COLORS = {
  DRAFT:        "bg-amber-100 text-amber-800",
  APPROVED:     "bg-emerald-100 text-emerald-800",
  DEACTIVATED:  "bg-slate-100 text-slate-600",
};

function prodshadeLabel(s) {
  if (s.material) return `${s.material.pace_code ?? "—"} — ${s.material.material_name ?? "—"}`;
  if (s.prod_code || s.shade_code) return `${s.prod_code ?? "—"}${s.shade_code ?? ""} (new, pending Approve)`;
  return "—";
}

export default function StrokeApprovalPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const availableCompanies = buildTransactionCompanyList(runtimeContext);
  const companyLabelById = new Map(availableCompanies.map((c) => [c.id, `${c.company_code} — ${c.company_name}`]));
  const [companyId, setCompanyId] = useState("");
  const [companyInitialized, setCompanyInitialized] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (companyInitialized) return;
    const defaultId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (!defaultId) return;
    setCompanyId(defaultId);
    setCompanyInitialized(true);
  }, [companyInitialized, runtimeContext]);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [editLines, setEditLines] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const [groupModal, setGroupModal] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null);
  const [memberMaterialId, setMemberMaterialId] = useState("");

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  const strokesQ = useQuery({
    queryKey: ["stroke-masters-approval", companyId, statusFilter],
    queryFn: () => listStrokeMasters({ company_id: companyId || undefined, status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  const strokes = strokesQ.data ?? EMPTY_ARRAY;
  const filteredStrokes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return strokes;
    return strokes.filter((s) => [
      companyLabelById.get(s.company_id), prodshadeLabel(s), s.stroke_number, s.po_type,
      s.description, s.created_by_display, s.created_at?.slice(0, 10), s.status,
    ].filter(Boolean).join(" ").toLowerCase().includes(needle));
    // companyLabelById is a new Map every render (derived from runtimeContext, not memoized);
    // including it here would defeat this memo entirely, and the company list itself changes
    // rarely if ever post-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, search]);
  const expandedRow = strokes.find((s) => s.id === expandedId) ?? null;
  const expandedCompanyId = expandedRow?.company_id ?? "";

  const uomsQ = useQuery({ queryKey: ["om-uoms"], queryFn: () => listUoms({ is_active: true, limit: 500 }), select: (d) => d?.data ?? [] });
  const groupsQ = useQuery({
    queryKey: ["om-material-groups", expandedCompanyId],
    queryFn: () => listMaterialCategoryGroups(expandedCompanyId),
    select: (d) => d?.data ?? [],
    enabled: Boolean(expandedCompanyId),
  });
  const rmMaterialsQ = useQuery({ queryKey: ["om-materials", "RM"], queryFn: () => listMaterials({ material_type: "RM", limit: 500 }), select: (d) => d?.data ?? [] });
  const intMaterialsQ = useQuery({ queryKey: ["om-materials", "INT"], queryFn: () => listMaterials({ material_type: "INT", limit: 500 }), select: (d) => d?.data ?? [] });
  const storageLocationsQ = useQuery({
    queryKey: ["om-storage-locations", expandedCompanyId],
    queryFn: () => listStorageLocations({ company_id: expandedCompanyId, is_active: true }),
    select: (d) => d?.data ?? [],
    enabled: Boolean(expandedCompanyId),
  });

  const uoms = uomsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const lineMaterialsByType = { RM: rmMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };
  const uomOptions = uoms.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }));
  const storageLocationOptions = (storageLocationsQ.data ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
  // §131.3 (2026-08-26): same L003-only rule as PR01 (StrokeMasterPage.jsx) — MTEST's
  // SFG output location is always L003, backend-enforced. PO Type is itself editable
  // on this review page, so this keys off editForm.po_type (the live value), not the
  // original row's.
  const l003Location = (storageLocationsQ.data ?? []).find((s) => String(s.code ?? "").toUpperCase() === "L003") ?? null;
  const isMtestEditForm = editForm.po_type === "MTEST";
  const approvalStorageLocationOptions = isMtestEditForm && l003Location
    ? [{ value: l003Location.id, label: `${l003Location.code} — ${l003Location.name}` }]
    : storageLocationOptions;

  async function toggleExpand(row) {
    if (expandedId === row.id) {
      setExpandedId("");
      setEditForm(null);
      setEditLines(null);
      return;
    }
    setExpandedId(row.id);
    setEditForm(null);
    setEditLines(null);
    setAttemptedSave(false);
    setEditLoading(true);
    try {
      const detail = await getStrokeMaster(row.id);
      // If this stroke predates the mandatory-storage-location rule, prefill
      // from any prior stroke on the same Prodshade — user can still override.
      let defaultStorageLocationId = detail.default_storage_location_id ?? "";
      if (!defaultStorageLocationId && detail.prodshade_material_id) {
        try {
          const priorRaw = await listStrokeMasters({ company_id: row.company_id, material_id: detail.prodshade_material_id });
          const prior = (Array.isArray(priorRaw) ? priorRaw : priorRaw?.data ?? []).find((s) => s.id !== row.id && s.default_storage_location_id);
          if (prior) defaultStorageLocationId = prior.default_storage_location_id;
        } catch { /* prefill is best-effort only */ }
      }
      setEditForm({
        po_type: detail.po_type ?? "",
        description: detail.description ?? "",
        base_uom_code: detail.base_uom_code ?? "",
        conversion_uom_code: detail.conversion_uom_code ?? "",
        conversion_factor: detail.conversion_factor ?? "",
        default_storage_location_id: defaultStorageLocationId,
      });
      setEditLines((detail.lines ?? []).map((l) => ({
        line_material_type: l.line_material_type ?? "RM",
        material_id: l.material_id,
        dosage_pct: String(l.dosage_pct),
        has_alternate: Boolean(l.material_group_id),
        material_group_id: l.material_group_id ?? "",
        default_storage_location_id: l.default_storage_location_id ?? "",
      })));
    } catch {
      toast("Failed to load stroke detail.", "error");
      setExpandedId("");
    } finally {
      setEditLoading(false);
    }
  }

  function openCreateGroupModal(onCreated) {
    setGroupForm({ group_name: "", description: "" });
    setGroupModal({ onCreated });
  }

  async function handleCreateGroup() {
    if (!groupForm.group_name.trim()) { toast("Group name required.", "error"); return; }
    if (!expandedCompanyId) { toast("Select a stroke first.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup({ ...groupForm, company_id: expandedCompanyId });
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

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: ["stroke-masters-approval"] });
  }

  // Save = Approve: PATCH the edited header+lines, then Approve in one action.
  async function handleSaveApprove(row) {
    if (!editForm || !editLines) return;
    setAttemptedSave(true);
    if (!editForm.default_storage_location_id) {
      toast("Default Storage Location is required.", "error");
      return;
    }
    const sum = dosageSumOf(editLines);
    if (Math.abs(sum - 100) > 0.01) { toast(`Dosage must sum to 100. Current: ${formatSum(sum, "0")}%`, "error"); return; }
    setSaving(true);
    try {
      await updateStrokeMaster(row.id, {
        po_type: editForm.po_type,
        description: editForm.description,
        base_uom_code: editForm.base_uom_code,
        conversion_uom_code: editForm.conversion_uom_code,
        conversion_factor: editForm.conversion_factor,
        default_storage_location_id: editForm.default_storage_location_id,
        lines: editLines.map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: parseFloat(l.dosage_pct),
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
          default_storage_location_id: l.default_storage_location_id || null,
        })),
      });
      await approveStrokeMaster(row.id);
      toast("Stroke saved and approved.");
      setExpandedId("");
      await invalidate();
    } catch (err) {
      toast(friendlyStrokeErr(err.code) || err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject(row) {
    setSaving(true);
    try {
      await rejectStrokeMaster(row.id);
      toast("Stroke rejected and deleted.");
      setExpandedId("");
      await invalidate();
    } catch (err) { toast(friendlyStrokeErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleDeactivate(row) {
    setSaving(true);
    try {
      await deactivateStrokeMaster(row.id);
      toast("Stroke deactivated.");
      setExpandedId("");
      await invalidate();
    } catch (err) { toast(friendlyStrokeErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleRevert(row) {
    setSaving(true);
    try {
      await revertStrokeMaster(row.id);
      toast("Reverted to DRAFT.");
      setExpandedId("");
      await invalidate();
    } catch (err) { toast(friendlyStrokeErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleReactivate(row) {
    setSaving(true);
    try {
      await reactivateStrokeMaster(row.id);
      toast("Stroke moved back to DRAFT for edit and approval.");
      setExpandedId("");
      await invalidate();
    } catch (err) { toast(friendlyStrokeErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      title="Stroke Approval — PR02"
      subtitle="L3 Manager reviews DRAFT strokes; Save = Approve. Material Type / Prodshade / Stroke Number are locked."
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="w-64">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
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
          <div className="min-w-[280px] flex-1">
            <QuickFilterInput
              label="Quick Search"
              value={search}
              onChange={setSearch}
              placeholder="Search company, prodshade, stroke #, PO type, description, status..."
              hint="Matches any column below."
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Strokes (${filteredStrokes.length}${filteredStrokes.length !== strokes.length ? ` of ${strokes.length}` : ""})`} className="overflow-x-visible">
        {strokesQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : strokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No strokes found for the selected filters.</p>
        ) : filteredStrokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No rows match this search.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b w-8"></th>
                <th className="text-left py-2 px-3 border-b">Company</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-left py-2 px-3 border-b">PO Type</th>
                <th className="text-left py-2 px-3 border-b">Description</th>
                <th className="text-left py-2 px-3 border-b">Created By</th>
                <th className="text-left py-2 px-3 border-b">Created At</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredStrokes.map((s) => (
                <React.Fragment key={s.id}>
                  <tr
                    className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                    onClick={() => toggleExpand(s)}
                  >
                    <td className="py-2 px-3 text-slate-400">{expandedId === s.id ? "▲" : "▼"}</td>
                    <td className="py-2 px-3 text-slate-500">{companyLabelById.get(s.company_id) ?? "—"}</td>
                    <td className="py-2 px-3 font-medium">{prodshadeLabel(s)}</td>
                    <td className="py-2 px-3 font-mono font-semibold">{s.stroke_number}</td>
                    <td className="py-2 px-3 text-slate-500">{s.po_type ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500">{s.description ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500">{s.created_by_display ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{s.created_at?.slice(0, 10)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status] ?? ""}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      <td colSpan={9} className="p-4">
                        {editLoading ? (
                          <p className="text-slate-400 text-sm py-4 text-center">Loading…</p>
                        ) : editForm && editLines ? (
                          <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">Material Type (locked)</span>
                                <p className="font-medium">{s.material_type}</p>
                              </div>
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">Prodshade (locked)</span>
                                <p className="font-medium">{prodshadeLabel(s)}</p>
                              </div>
                              <div>
                                <span className="text-slate-400 text-xs block mb-0.5">Stroke Number (locked)</span>
                                <p className="font-mono font-semibold">{s.stroke_number}</p>
                              </div>

                              {s.status === "DRAFT" ? (
                                <Field label="PO Type" required>
                                  <ErpComboboxField
                                    value={editForm.po_type}
                                    onChange={(v) => setEditForm((f) => ({
                                      ...f,
                                      po_type: v,
                                      // §131.3: same auto-lock as PR01 when switching to/from MTEST.
                                      default_storage_location_id: v === "MTEST"
                                        ? (l003Location?.id ?? "")
                                        : (f.po_type === "MTEST" ? "" : f.default_storage_location_id),
                                    }))}
                                    options={PO_TYPE_OPTIONS_BY_MATERIAL_TYPE[s.material_type] ?? []}
                                  />
                                </Field>
                              ) : (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">PO Type</span>
                                  <p className="font-medium">{s.po_type}</p>
                                </div>
                              )}

                              {s.status === "DRAFT" ? (
                                <Field label="Base UOM" required>
                                  <ErpComboboxField value={editForm.base_uom_code} onChange={(v) => setEditForm((f) => ({ ...f, base_uom_code: v }))} options={uomOptions} />
                                </Field>
                              ) : (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Base UOM</span>
                                  <p className="font-medium">{s.base_uom_code}</p>
                                </div>
                              )}

                              {s.status === "DRAFT" ? (
                                <Field label="Conversion UOM">
                                  <ErpComboboxField value={editForm.conversion_uom_code} onChange={(v) => setEditForm((f) => ({ ...f, conversion_uom_code: v }))} options={uomOptions} />
                                </Field>
                              ) : (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Conversion</span>
                                  <p className="font-medium">{s.conversion_uom_code ? `${s.conversion_uom_code} (× ${s.conversion_factor})` : "—"}</p>
                                </div>
                              )}

                              {s.status === "DRAFT" ? (
                                <Field label="Conversion Factor">
                                  <input
                                    className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full"
                                    type="number" step="0.0001" min="0"
                                    value={editForm.conversion_factor}
                                    onChange={(e) => setEditForm((f) => ({ ...f, conversion_factor: e.target.value }))}
                                  />
                                </Field>
                              ) : null}

                              {s.status === "DRAFT" ? (
                                <Field
                                  label="Default Storage Location (Output)"
                                  required
                                  hint={isMtestEditForm ? "MTEST always uses L003 (ADMIX LAB) — locked." : undefined}
                                >
                                  <ErpComboboxField
                                    value={editForm.default_storage_location_id}
                                    onChange={(v) => setEditForm((f) => ({ ...f, default_storage_location_id: v }))}
                                    options={approvalStorageLocationOptions}
                                    emptyStateLabel={isMtestEditForm ? "L003 is not mapped to this company yet" : "No storage locations mapped to this company"}
                                    disabled={isMtestEditForm}
                                    className={attemptedSave && !editForm.default_storage_location_id ? "ring-2 ring-rose-400 rounded" : ""}
                                  />
                                  {attemptedSave && !editForm.default_storage_location_id && (
                                    <p className="text-[11px] font-medium text-rose-600 mt-1">Required.</p>
                                  )}
                                </Field>
                              ) : (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Default Storage Location</span>
                                  <p className="font-medium">{s.default_storage_location ? `${s.default_storage_location.code} — ${s.default_storage_location.name}` : "—"}</p>
                                </div>
                              )}

                              {s.status === "DRAFT" ? (
                                <Field label="Description" >
                                  <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                                </Field>
                              ) : (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Description</span>
                                  <p className="font-medium">{s.description ?? "—"}</p>
                                </div>
                              )}

                              {s.approved_by_display && (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Approved By</span>
                                  <p className="font-medium">{s.approved_by_display} · {s.approved_at?.slice(0, 10)}</p>
                                </div>
                              )}
                              {s.deactivated_by_display && (
                                <div>
                                  <span className="text-slate-400 text-xs block mb-0.5">Deactivated By</span>
                                  <p className="font-medium">{s.deactivated_by_display} · {s.deactivated_at?.slice(0, 10)}</p>
                                </div>
                              )}
                            </div>

                              <StrokeLinesTable
                                lines={editLines}
                                setLines={setEditLines}
                                materialsByType={lineMaterialsByType}
                                groups={groups}
                                storageLocationOptions={storageLocationOptions}
                                onCreateGroup={openCreateGroupModal}
                                onAddMember={(groupId) => setMemberModal(groupId)}
                                disabled={s.status !== "DRAFT"}
                              />

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                              <button type="button" className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setExpandedId("")}>
                                Close
                              </button>
                              {s.status === "DRAFT" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                    onClick={() => handleReject(s)}
                                  >
                                    Reject
                                  </button>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                                    onClick={() => handleSaveApprove(s)}
                                  >
                                    Save (Approve)
                                  </button>
                                </>
                              )}
                              {s.status === "APPROVED" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    className="h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                    onClick={() => handleDeactivate(s)}
                                  >
                                    Deactivate
                                  </button>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    onClick={() => handleRevert(s)}
                                  >
                                    Revert to Draft
                                  </button>
                                </>
                              )}
                              {s.status === "DEACTIVATED" && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                                  onClick={() => handleReactivate(s)}
                                >
                                  Reactivate to Draft
                                </button>
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
