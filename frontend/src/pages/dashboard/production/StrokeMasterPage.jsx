/*
 * File-ID: 27.FE-01
 * File-Path: frontend/src/pages/dashboard/production/StrokeMasterPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Stroke Master list + create/edit/approve in right drawer.
 *          DRAFT = QA edits, APPROVED = Manager saves (= ACTIVE). Manager can
 *          Deactivate an APPROVED stroke (terminal) or Revert to DRAFT.
 *          See feasibility doc Section 83.3 (revised 2026-06-30).
 *
 * Prodshade can be an existing SFG/INT material or a brand-new Prod+Shade
 * (Material Master is created on Approve, not on Save Draft — 83.3 rule).
 *
 * Known deviation from the 83.3 lock (deferred, not built in this pass):
 *  - OUTPUT line is shown as a computed header summary, not a literal
 *    stroke_line row.
 */

import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import {
  listStrokeMasters, getStrokeMaster, createStrokeMaster,
  updateStrokeMaster, approveStrokeMaster, revertStrokeMaster,
  rejectStrokeMaster, deactivateStrokeMaster,
} from "./prodApi.js";
import { listCompaniesForOm, listMaterials, listUoms, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember, listStorageLocations } from "../om/omApi.js";
import {
  MATERIAL_TYPE_OPTIONS, PO_TYPE_OPTIONS_BY_MATERIAL_TYPE, EMPTY_LINE,
  friendlyStrokeErr, dosageSumOf, renderDrawerActions, Field,
  StrokeLinesTable, GroupCreateModal, MemberAddModal,
} from "./strokeShared.jsx";

const STATUS_BADGE = {
  DRAFT:       "bg-amber-100 text-amber-800",
  APPROVED:    "bg-emerald-100 text-emerald-800",
  DEACTIVATED: "bg-slate-200 text-slate-500",
};

const friendlyErr = friendlyStrokeErr;

export default function StrokeMasterPage() {
  const qc = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create"); // create | detail
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEditLines, setDetailEditLines] = useState(null);

  const [form, setForm] = useState({
    company_id: "", material_type: "SFG", po_type: "", prodshade_mode: "existing",
    prodshade_material_id: "", prod_code: "", shade_code: "",
    stroke_number: "", description: "", base_uom_code: "", conversion_uom_code: "", conversion_factor: "",
    default_storage_location_id: "",
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  // Inline "create group" mini-form state
  const [groupModal, setGroupModal] = useState(null); // { onCreated } | null
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null); // groupId | null
  const [memberMaterialId, setMemberMaterialId] = useState("");

  const firstInputRef = useRef(null);

  const strokesQ = useQuery({
    queryKey: ["prod-stroke-masters", companyFilter, statusFilter],
    queryFn: () => listStrokeMasters({ company_id: companyFilter || undefined, status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  const createCompanyStrokesQ = useQuery({
    queryKey: ["prod-stroke-masters-create-check", form.company_id],
    queryFn: () => listStrokeMasters({ company_id: form.company_id || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: Boolean(form.company_id),
  });

  const companiesQ = useQuery({ queryKey: ["om-companies"], queryFn: () => listCompaniesForOm() });
  const uomsQ = useQuery({ queryKey: ["om-uoms"], queryFn: () => listUoms({ is_active: true, limit: 500 }), select: (d) => d?.data ?? [] });
  const groupsQ = useQuery({ queryKey: ["om-material-groups"], queryFn: () => listMaterialCategoryGroups(), select: (d) => d?.data ?? [] });
  const sfgMaterialsQ = useQuery({ queryKey: ["om-materials", "SFG"], queryFn: () => listMaterials({ material_type: "SFG", limit: 500 }), select: (d) => d?.data ?? [] });
  const intMaterialsQ = useQuery({ queryKey: ["om-materials", "INT"], queryFn: () => listMaterials({ material_type: "INT", limit: 500 }), select: (d) => d?.data ?? [] });
  const rmMaterialsQ = useQuery({ queryKey: ["om-materials", "RM"], queryFn: () => listMaterials({ material_type: "RM", limit: 500 }), select: (d) => d?.data ?? [] });

  // Storage locations are scoped to whichever company is in play: the create
  // form's company while creating, or the stroke's own (immutable) company
  // while viewing/editing an existing DRAFT.
  const activeCompanyId = drawerMode === "create" ? form.company_id : (detail?.company_id ?? "");
  const storageLocationsQ = useQuery({
    queryKey: ["om-storage-locations", activeCompanyId],
    queryFn: () => listStorageLocations({ company_id: activeCompanyId, is_active: true }),
    select: (d) => d?.data ?? [],
    enabled: Boolean(activeCompanyId),
  });

  const companies = companiesQ.data ?? [];
  const uoms = uomsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const storageLocations = storageLocationsQ.data ?? [];
  const prodshadeMaterialsByType = { SFG: sfgMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };
  const lineMaterialsByType = { RM: rmMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };

  const companyOptions = companies.map((c) => ({ value: c.id, label: `${c.company_code} — ${c.company_name}` }));
  const uomOptions = uoms.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }));
  const storageLocationOptions = storageLocations.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
  const prodshadeOptions = (prodshadeMaterialsByType[form.material_type] ?? []).map((m) => ({
    value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`,
  }));

  const createCheckStrokes = createCompanyStrokesQ.data ?? [];
  const normalizedStrokeNumber = String(form.stroke_number ?? "").trim();
  const normalizedProdCode = String(form.prod_code ?? "").trim().toUpperCase();
  const normalizedShadeCode = String(form.shade_code ?? "").trim().toUpperCase();
  const duplicateStroke = !form.company_id || !normalizedStrokeNumber
    ? null
    : createCheckStrokes.find((stroke) => {
        if (String(stroke.stroke_number ?? "").trim() !== normalizedStrokeNumber) return false;
        if (form.prodshade_mode === "existing") {
          return String(stroke.prodshade_material_id ?? "") === String(form.prodshade_material_id ?? "");
        }
        return String(stroke.prod_code ?? "").trim().toUpperCase() === normalizedProdCode
          && String(stroke.shade_code ?? "").trim().toUpperCase() === normalizedShadeCode;
      }) ?? null;
  const isDuplicateBlocked = Boolean(duplicateStroke);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function openCreate() {
    setDrawerMode("create");
    setForm({
      company_id: "", material_type: "SFG", po_type: "", prodshade_mode: "existing",
      prodshade_material_id: "", prod_code: "", shade_code: "",
      stroke_number: "", description: "", base_uom_code: "", conversion_uom_code: "", conversion_factor: "",
      default_storage_location_id: "",
    });
    setLines([{ ...EMPTY_LINE }]);
    setDrawerOpen(true);
  }

  async function openDetail(id) {
    setDrawerMode("detail");
    setDetail(null);
    setDetailEditLines(null);
    setDetailLoading(true);
    setDrawerOpen(true);
    try {
      const d = await getStrokeMaster(id);
      setDetail(d);
      if (d.status === "DRAFT") {
        setDetailEditLines((d.lines ?? []).map((l) => ({
          line_material_type: l.line_material_type ?? "RM",
          material_id: l.material_id,
          dosage_pct: String(l.dosage_pct),
          has_alternate: Boolean(l.material_group_id),
          material_group_id: l.material_group_id ?? "",
          default_storage_location_id: l.default_storage_location_id ?? "",
        })));
      }
    } catch { toast("Failed to load stroke detail.", "error"); setDrawerOpen(false); }
    finally { setDetailLoading(false); }
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
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
  }

  async function handleAddMember() {
    if (!memberMaterialId) { toast("Select a material first.", "error"); return; }
    try {
      await addMaterialCategoryMember({ group_id: memberModal, material_id: memberMaterialId });
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      toast("Member added.");
      setMemberModal(null);
      setMemberMaterialId("");
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
  }

  function validateHeader(f) {
    if (!f.company_id || !f.stroke_number || !f.po_type || !f.base_uom_code) {
      toast("Company, Material Type, PO Type, Stroke number, and Base UOM are required.", "error");
      return false;
    }
    if (f.prodshade_mode === "existing" && !f.prodshade_material_id) {
      toast("Select an existing Prodshade, or switch to \"Create new Prodshade\".", "error");
      return false;
    }
    if (f.prodshade_mode === "new" && (!f.prod_code.trim() || !f.shade_code.trim())) {
      toast("Prod Code and Shade Code are required for a new Prodshade.", "error");
      return false;
    }
    return true;
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (isDuplicateBlocked) {
      toast("Duplicate blocked: this Prodshade + Stroke Number combination already exists.", "error");
      return;
    }
    if (!validateHeader(form)) return;
    const sum = dosageSumOf(lines);
    if (lines.some((l) => l.material_id) && Math.abs(sum - 100) > 0.01) {
      toast(`Dosage must sum to 100. Current: ${sum.toFixed(2)}%`, "error"); return;
    }
    setSaving(true);
    try {
      const isNewProdshade = form.prodshade_mode === "new";
      await createStrokeMaster({
        ...form,
        prodshade_material_id: isNewProdshade ? "" : form.prodshade_material_id,
        prod_code: isNewProdshade ? form.prod_code.trim().toUpperCase() : "",
        shade_code: isNewProdshade ? form.shade_code.trim().toUpperCase() : "",
        lines: lines.filter((l) => l.material_id).map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: parseFloat(l.dosage_pct),
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
          default_storage_location_id: l.default_storage_location_id || null,
        })),
      });
      toast("Stroke master created (DRAFT).");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleSaveDraft() {
    const sum = dosageSumOf(detailEditLines);
    if (Math.abs(sum - 100) > 0.01) { toast(`Dosage must sum to 100. Current: ${sum.toFixed(2)}%`, "error"); return; }
    setSaving(true);
    try {
      await updateStrokeMaster(detail.id, {
        description: detail.description,
        base_uom_code: detail.base_uom_code,
        conversion_uom_code: detail.conversion_uom_code,
        conversion_factor: detail.conversion_factor,
        default_storage_location_id: detail.default_storage_location_id,
        lines: detailEditLines.map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: parseFloat(l.dosage_pct),
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
          default_storage_location_id: l.default_storage_location_id || null,
        })),
      });
      toast("Draft saved.");
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
      openDetail(detail.id);
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function runAction(fn, id, successMsg) {
    setSaving(true);
    try {
      await fn(id);
      toast(successMsg);
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  const strokes = strokesQ.data ?? [];
  const actions = [{ label: "New Stroke", tone: "primary", mnemonic: "N", onClick: openCreate }];

  return (
    <ErpScreenScaffold
      title="Stroke Master"
      subtitle="Define RM/INT dosage formulas per Prodshade (SFG/INT, PO Type-scoped)"
      actions={actions}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company</label>
            <ErpComboboxField className="w-64" value={companyFilter} onChange={setCompanyFilter} options={companyOptions} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Status</label>
            <select className="border border-slate-300 rounded px-2 py-1 text-sm h-7" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved (Active)</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Strokes (${strokes.length})`}>
        {strokesQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : strokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No strokes found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Material Type</th>
                <th className="text-left py-2 px-3 border-b">PO Type</th>
                <th className="text-left py-2 px-3 border-b">Description</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
                <th className="text-left py-2 px-3 border-b">Created</th>
              </tr>
            </thead>
            <tbody>
              {strokes.map((s) => (
                <tr key={s.id} className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors" onClick={() => openDetail(s.id)}>
                  <td className="py-2 px-3 font-mono font-semibold">{s.stroke_number}</td>
                  <td className="py-2 px-3 text-slate-600">
                    {s.material ? `${s.material.pace_code ?? "—"} — ${s.material.material_name ?? "—"}` : `${s.prod_code ?? "—"}${s.shade_code ?? ""} (new, pending Approve)`}
                  </td>
                  <td className="py-2 px-3 text-slate-500">{s.material_type}</td>
                  <td className="py-2 px-3 text-slate-500">{s.po_type}</td>
                  <td className="py-2 px-3 text-slate-500">{s.description ?? "—"}</td>
                  <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[s.status] ?? ""}`}>{s.status}</span></td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{s.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      {/* Create Drawer */}
      <DrawerBase
        visible={drawerOpen && drawerMode === "create"}
        title="New Stroke Master"
        onClose={() => setDrawerOpen(false)}
        initialFocusRef={firstInputRef}
        side="center"
        width="min(1480px, calc(100vw - 24px))"
        actions={renderDrawerActions([
          { label: "Save Draft", tone: "primary", onClick: handleCreate, disabled: saving || isDuplicateBlocked },
          { label: "Cancel", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ])}
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company" required>
              <ErpComboboxField value={form.company_id} onChange={(v) => setForm((f) => ({ ...f, company_id: v }))} options={companyOptions} />
            </Field>
            <Field label="Material Type" required hint={MATERIAL_TYPE_OPTIONS.find((o) => o.value === form.material_type)?.desc}>
              <ErpComboboxField
                value={form.material_type}
                onChange={(v) => setForm((f) => ({ ...f, material_type: v, po_type: "", prodshade_material_id: "" }))}
                options={MATERIAL_TYPE_OPTIONS}
                hideBlank
              />
            </Field>
            <Field label="PO Type" required hint={PO_TYPE_OPTIONS_BY_MATERIAL_TYPE[form.material_type]?.find((o) => o.value === form.po_type)?.desc}>
              <ErpComboboxField value={form.po_type} onChange={(v) => setForm((f) => ({ ...f, po_type: v }))} options={PO_TYPE_OPTIONS_BY_MATERIAL_TYPE[form.material_type] ?? []} />
            </Field>
            <Field label="Prodshade" required>
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-3 text-xs text-slate-600">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="prodshade_mode" checked={form.prodshade_mode === "existing"} onChange={() => setForm((f) => ({ ...f, prodshade_mode: "existing", prod_code: "", shade_code: "" }))} />
                    Existing
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="prodshade_mode" checked={form.prodshade_mode === "new"} onChange={() => setForm((f) => ({ ...f, prodshade_mode: "new", prodshade_material_id: "" }))} />
                    Create new
                  </label>
                </div>
                {form.prodshade_mode === "existing" ? (
                  <ErpComboboxField value={form.prodshade_material_id} onChange={(v) => setForm((f) => ({ ...f, prodshade_material_id: v }))} options={prodshadeOptions} emptyStateLabel="No materials of this type yet" />
                ) : (
                  <div className="flex gap-2">
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-1/2 font-mono uppercase" value={form.prod_code} onChange={(e) => setForm((f) => ({ ...f, prod_code: e.target.value }))} placeholder="Prod code" />
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-1/2 font-mono uppercase" value={form.shade_code} onChange={(e) => setForm((f) => ({ ...f, shade_code: e.target.value }))} placeholder="Shade code" />
                  </div>
                )}
                {form.prodshade_mode === "new" && (
                  <p className="text-[11px] text-slate-400">Material Master ({form.material_type}) will be created automatically when this stroke is Approved — not on Save Draft.</p>
                )}
                {isDuplicateBlocked && (
                  <p className="text-[11px] font-medium text-rose-600">
                    Duplicate blocked: this Prodshade + Stroke Number combination already exists.
                  </p>
                )}
              </div>
            </Field>
            <Field label="Stroke Number" required>
              <input
                ref={firstInputRef}
                className={`border rounded px-2 py-1.5 text-sm font-mono h-7 w-full ${
                  isDuplicateBlocked ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-300"
                }`}
                value={form.stroke_number}
                onChange={(e) => setForm((f) => ({ ...f, stroke_number: e.target.value }))}
                placeholder="Numeric only"
                required
              />
            </Field>
            <Field label="Description">
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Base UOM" required>
              <ErpComboboxField value={form.base_uom_code} onChange={(v) => setForm((f) => ({ ...f, base_uom_code: v }))} options={uomOptions} />
            </Field>
            <Field label="Conversion UOM" hint="Only needed if formulation input UOM differs from output UOM (e.g. KG in, LTR out).">
              <ErpComboboxField value={form.conversion_uom_code} onChange={(v) => setForm((f) => ({ ...f, conversion_uom_code: v }))} options={uomOptions} />
            </Field>
            <Field label="Conversion Factor" hint="e.g. KG per Litre (density-based).">
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" type="number" step="0.0001" min="0" value={form.conversion_factor} onChange={(e) => setForm((f) => ({ ...f, conversion_factor: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Default Storage Location (Output)" hint="Company-mapped locations only. Process PO Verify posts SFG/INT output here.">
              <ErpComboboxField
                value={form.default_storage_location_id}
                onChange={(v) => setForm((f) => ({ ...f, default_storage_location_id: v }))}
                options={storageLocationOptions}
                placeholder={form.company_id ? "-- Select --" : "-- Select Company first --"}
                emptyStateLabel="No storage locations mapped to this company"
                disabled={!form.company_id}
              />
            </Field>
          </div>

          <StrokeLinesTable
            lines={lines}
            setLines={setLines}
            materialsByType={lineMaterialsByType}
            groups={groups}
            storageLocationOptions={storageLocationOptions}
            onCreateGroup={openCreateGroupModal}
            onAddMember={(groupId) => setMemberModal(groupId)}
          />
        </form>
      </DrawerBase>

      {/* Detail Drawer */}
      <DrawerBase
        visible={drawerOpen && drawerMode === "detail"}
        title={detail ? `Stroke #${detail.stroke_number}` : "Loading…"}
        onClose={() => setDrawerOpen(false)}
        side="center"
        width="min(1480px, calc(100vw - 24px))"
        actions={renderDrawerActions(detail ? [
          ...(detail.status === "DRAFT" ? [
            { label: "Save", tone: "neutral", onClick: handleSaveDraft, disabled: saving },
            { label: "Approve", tone: "primary", onClick: () => runAction(approveStrokeMaster, detail.id, "Stroke approved (ACTIVE)."), disabled: saving },
            { label: "Reject", tone: "danger", onClick: () => runAction(rejectStrokeMaster, detail.id, "Stroke rejected and deleted."), disabled: saving },
          ] : []),
          ...(detail.status === "APPROVED" ? [
            { label: "Deactivate", tone: "danger", onClick: () => runAction(deactivateStrokeMaster, detail.id, "Stroke deactivated."), disabled: saving },
            { label: "Revert to Draft", tone: "neutral", onClick: () => runAction(revertStrokeMaster, detail.id, "Reverted to DRAFT."), disabled: saving },
          ] : []),
          { label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ] : [{ label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) }])}
      >
        {detailLoading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading…</p>
        ) : detail ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs">Prodshade</span>
                <p className="font-medium">
                  {detail.material
                    ? `${detail.material.pace_code ?? "—"} — ${detail.material.material_name ?? "—"}`
                    : `${detail.prod_code ?? "—"}${detail.shade_code ?? ""} (new — created on Approve)`}
                </p>
              </div>
              <div><span className="text-slate-400 text-xs">Status</span><p><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[detail.status]}`}>{detail.status}</span></p></div>
              <div><span className="text-slate-400 text-xs">Material Type</span><p>{detail.material_type}</p></div>
              <div><span className="text-slate-400 text-xs">PO Type</span><p>{detail.po_type}</p></div>
              <div><span className="text-slate-400 text-xs">Base UOM / Conversion</span><p>{detail.base_uom_code ?? "—"}{detail.conversion_uom_code ? ` → ${detail.conversion_uom_code} (× ${detail.conversion_factor})` : ""}</p></div>
              <div><span className="text-slate-400 text-xs">Default Storage Location (Output)</span><p>{detail.default_storage_location ? `${detail.default_storage_location.code} — ${detail.default_storage_location.name}` : "—"}</p></div>
              <div><span className="text-slate-400 text-xs">Description</span><p>{detail.description ?? "—"}</p></div>
              {detail.approved_by && <div><span className="text-slate-400 text-xs">Approved</span><p>{detail.approved_at?.slice(0, 10)}</p></div>}
              {detail.deactivated_by && <div><span className="text-slate-400 text-xs">Deactivated</span><p>{detail.deactivated_at?.slice(0, 10)}</p></div>}
            </div>

            {detail.status === "DRAFT" && detailEditLines ? (
              <StrokeLinesTable
                lines={detailEditLines}
                setLines={setDetailEditLines}
                materialsByType={lineMaterialsByType}
                groups={groups}
                storageLocationOptions={storageLocationOptions}
                onCreateGroup={openCreateGroupModal}
                onAddMember={(groupId) => setMemberModal(groupId)}
              />
            ) : (
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">RM / INT Lines</p>
                {(detail.lines ?? []).length === 0 ? (
                  <p className="text-slate-400 text-sm">No lines.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs">
                        <th className="text-left py-1.5 px-2 border-b">#</th>
                        <th className="text-left py-1.5 px-2 border-b">Type</th>
                        <th className="text-left py-1.5 px-2 border-b">Material</th>
                        <th className="text-left py-1.5 px-2 border-b">Group</th>
                        <th className="text-left py-1.5 px-2 border-b">Storage Loc.</th>
                        <th className="text-right py-1.5 px-2 border-b">Dosage %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l, i) => (
                        <tr key={l.id} className="border-b border-slate-100">
                          <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                          <td className="py-1.5 px-2 text-slate-500">{l.line_material_type}</td>
                          <td className="py-1.5 px-2">{l.material?.pace_code ?? "—"} — {l.material?.material_name ?? ""}</td>
                          <td className="py-1.5 px-2 text-slate-500">{l.material_group?.group_name ?? "—"}</td>
                          <td className="py-1.5 px-2 text-slate-500">{l.default_storage_location ? l.default_storage_location.code : "—"}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{Number(l.dosage_pct).toFixed(2)}%</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td colSpan={5} className="py-1.5 px-2 text-right text-slate-500 text-xs">Total</td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          {detail.lines.reduce((s, l) => s + Number(l.dosage_pct), 0).toFixed(2)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DrawerBase>

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
