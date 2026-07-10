/*
 * File-ID: 27.FE-SHARED
 * File-Path: frontend/src/pages/dashboard/production/strokeShared.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: RM/INT line editor + Material Group create/add-member modals,
 *          shared between StrokeMasterPage (create/edit) and
 *          StrokeApprovalPage (approve — Manager edits everything except
 *          Material Type / Prodshade / Stroke Number, per 83.3).
 */

import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import BlockingLayer from "../../../components/layer/BlockingLayer.jsx";

export const MATERIAL_TYPE_OPTIONS = [
  { value: "SFG", label: "SFG — Semi-Finished Goods", desc: "Process PO bulk output (Prodshade + Batch), pre-packing." },
  { value: "INT", label: "INT — Intermediate", desc: "Internally-produced RM used as an ingredient in other formulations." },
];

export const PO_TYPE_OPTIONS_BY_MATERIAL_TYPE = {
  SFG: [
    { value: "MTO", label: "MTO — Make to Order", desc: "Admix — stroke picked per order." },
    { value: "HPS", label: "HPS — Hypershot", desc: "Fixed formulation, batch-specific dispatch." },
    { value: "MTS", label: "MTS — Make to Stock", desc: "IWC / Powder — fixed formulation." },
    { value: "MTEST", label: "MTEST — AP Test Batch", desc: "Manual test batch, no fixed stroke required." },
  ],
  INT: [
    { value: "INT", label: "INT — Intermediate", desc: "e.g. Caustic Flakes + Water → Caustic Liquid." },
  ],
};

export const EMPTY_LINE = { line_material_type: "RM", material_id: "", dosage_pct: "", has_alternate: false, material_group_id: "", default_storage_location_id: "" };

export const STROKE_ERRORS = {
  PROD_STROKE_DOSAGE_SUM: "Dosage total must equal 100%.",
  PROD_STROKE_NUMBER_NUMERIC: "Stroke number must be numeric.",
  PROD_STROKE_EXISTS: "Stroke number already exists for this prodshade.",
  PROD_STROKE_APPROVED_LOCKED: "Only DRAFT strokes can be edited.",
  PROD_STROKE_IN_USE: "Cannot revert — active Process Orders reference this stroke.",
  PROD_STROKE_NOT_DRAFT: "Only DRAFT strokes can be rejected.",
  PROD_STROKE_ALREADY_APPROVED: "Only DRAFT strokes can be approved.",
  PROD_STROKE_NOT_APPROVED: "Only APPROVED strokes can be deactivated/reverted.",
  PROD_STROKE_MATERIAL_TYPE_INVALID: "Material Type must be SFG or INT.",
  PROD_STROKE_PO_TYPE_INVALID: "PO Type is not valid for the selected Material Type.",
  PROD_STROKE_BASE_UOM_REQUIRED: "Base UOM is required.",
  PROD_STROKE_NO_LINES: "Cannot approve a stroke with no RM/INT lines.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required for this action.",
};

export function friendlyStrokeErr(code) { return STROKE_ERRORS[code] ?? code; }

export function dosageSumOf(lines) {
  return lines.reduce((s, l) => s + (parseFloat(l.dosage_pct) || 0), 0);
}

// DrawerBase renders `actions` as a raw node, not a descriptor array — turn
// our {label, tone, onClick, disabled} list into real <button> elements.
export function renderDrawerActions(items) {
  return (
    <>
      {items.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          className={
            a.tone === "primary"
              ? "h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              : a.tone === "danger"
              ? "h-8 border border-rose-600 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              : "h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          }
        >
          {a.label}
        </button>
      ))}
    </>
  );
}

export function Field({ label, required, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-slate-600 font-medium">{label} {required && <span className="text-rose-500">*</span>}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ── Shared RM/INT Lines editor ──────────────────────────────────────────────
function getGroupAlternateLabels(selectedGroup, currentMaterialId, materialLabelById) {
  const members = Array.isArray(selectedGroup?.members) ? selectedGroup.members : [];
  return members
    .filter((m) => m?.material_id && m.material_id !== currentMaterialId)
    .map((m) => {
      if (m?.material?.pace_code || m?.material?.material_name) {
        return `${m.material?.pace_code ?? "—"} — ${m.material?.material_name ?? ""}`;
      }
      return materialLabelById.get(m.material_id) ?? "Unknown material";
    });
}

export function StrokeLinesEditor({ lines, setLines, materialsByType, groups, storageLocationOptions, onCreateGroup, onAddMember, disabled }) {
  function addLine() { setLines((l) => [...l, { ...EMPTY_LINE }]); }
  function removeLine(i) { setLines((l) => l.filter((_, idx) => idx !== i)); }
  function updateLine(i, patch) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  const sum = dosageSumOf(lines);
  const materialLabelById = new Map(
    [...(materialsByType.RM ?? []), ...(materialsByType.INT ?? [])]
      .map((m) => [m.id, `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`]),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">RM / INT Lines</p>
        <span className={`text-xs font-mono px-2 py-0.5 rounded ${Math.abs(sum - 100) < 0.01 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          Σ {sum.toFixed(2)}% / 100%
        </span>
      </div>

      {lines.map((line, i) => {
        const itemOptions = (materialsByType[line.line_material_type] ?? []).map((m) => ({
          value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`,
        }));
        const groupOptions = groups.map((g) => ({ value: g.id, label: `${g.group_code} — ${g.group_name}` }));
        const selectedGroup = groups.find((g) => g.id === line.material_group_id);
        const alternateLabels = getGroupAlternateLabels(selectedGroup, line.material_id, materialLabelById);

        return (
          <div key={i} className="border border-slate-200 rounded p-2 mb-2 bg-slate-50/40">
            <div className="flex gap-2 items-center mb-1.5">
              <ErpComboboxField
                className="w-28"
                value={line.line_material_type}
                onChange={(v) => updateLine(i, { line_material_type: v, material_id: "" })}
                options={[{ value: "RM", label: "RM" }, { value: "INT", label: "INT" }]}
                hideBlank
                disabled={disabled}
              />
              <div className="flex-1">
                <ErpComboboxField
                  value={line.material_id}
                  onChange={(v) => updateLine(i, { material_id: v })}
                  options={itemOptions}
                  placeholder="-- Select material --"
                  disabled={disabled}
                />
              </div>
              <input
                className="border border-slate-300 rounded px-2 py-1 text-sm w-24 font-mono text-right"
                placeholder="Dosage %"
                type="number" step="0.01" min="0" max="100"
                value={line.dosage_pct}
                onChange={(e) => updateLine(i, { dosage_pct: e.target.value })}
                disabled={disabled}
              />
              {!disabled && (
                <button type="button" onClick={() => removeLine(i)} className="text-rose-400 hover:text-rose-600 text-sm px-1">✕</button>
              )}
            </div>

            <div className="flex items-center gap-2 mb-1.5 pl-1">
              <span className="text-xs text-slate-500 whitespace-nowrap">Default Storage Location</span>
              <div className="flex-1 max-w-xs">
                <ErpComboboxField
                  value={line.default_storage_location_id}
                  onChange={(v) => updateLine(i, { default_storage_location_id: v })}
                  options={storageLocationOptions}
                  placeholder="-- Select company first --"
                  emptyStateLabel="No storage locations mapped to this company"
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pl-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={line.has_alternate}
                  disabled={disabled}
                  onChange={(e) => updateLine(i, { has_alternate: e.target.checked, material_group_id: e.target.checked ? line.material_group_id : "" })}
                />
                Has Alternate?
              </label>
              {line.has_alternate && (
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1">
                    <ErpComboboxField
                      value={line.material_group_id}
                      onChange={(v) => updateLine(i, { material_group_id: v })}
                      options={groupOptions}
                      placeholder="-- Select group --"
                      disabled={disabled}
                    />
                  </div>
                  {!disabled && (
                    <button
                      type="button"
                      className="text-sky-600 hover:text-sky-800 text-xs underline whitespace-nowrap"
                      onClick={() => onCreateGroup((newGroupId) => updateLine(i, { material_group_id: newGroupId }))}
                    >
                      + New Group
                    </button>
                  )}
                </div>
              )}
            </div>

            {line.has_alternate && selectedGroup && (
              <div className="mt-1.5 pl-1 text-xs text-slate-500">
                Alternates: {alternateLabels.length === 0 ? "No alternate members configured in PM04 yet." : alternateLabels.join(", ")}
                {!disabled && (
                  <button
                    type="button"
                    className="text-sky-600 hover:text-sky-800 underline ml-2"
                    onClick={() => onAddMember(selectedGroup.id)}
                  >
                    + Add member
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!disabled && (
        <button type="button" onClick={addLine} className="text-sky-600 hover:text-sky-800 text-xs underline">+ Add line</button>
      )}
    </div>
  );
}

// ── Shared "Create Group" / "Add Member" modals ─────────────────────────────
// Each is its own BlockingLayer so it registers as the top layer — otherwise
// a parent DrawerBase's global focusin handler keeps yanking focus back to
// itself since a plain fixed div isn't part of its layer stack.
export function GroupCreateModal({ open, groupForm, setGroupForm, onCancel, onCreate }) {
  return (
    <BlockingLayer
      visible={open}
      onEscape={onCancel}
      overlayStyle={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 1000100, display: "flex", alignItems: "center", justifyContent: "center" }}
      dialogStyle={{ background: "white", borderRadius: 4, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 16, width: 320, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <p className="text-sm font-semibold text-slate-700">New Material Group</p>
      <Field label="Group Name" required>
        <input className="border border-slate-300 rounded px-2 py-1 text-sm h-7 w-full" value={groupForm.group_name} onChange={(e) => setGroupForm((f) => ({ ...f, group_name: e.target.value }))} />
      </Field>
      <Field label="Description">
        <input className="border border-slate-300 rounded px-2 py-1 text-sm h-7 w-full" value={groupForm.description} onChange={(e) => setGroupForm((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <div className="flex justify-end gap-2 mt-1">
        <button type="button" className="text-xs text-slate-500 px-3 py-1" onClick={onCancel}>Cancel</button>
        <button type="button" className="text-xs bg-sky-600 text-white rounded px-3 py-1" onClick={onCreate}>Create</button>
      </div>
    </BlockingLayer>
  );
}

export function MemberAddModal({ open, memberMaterialId, setMemberMaterialId, materialOptions, onCancel, onAdd }) {
  return (
    <BlockingLayer
      visible={open}
      onEscape={onCancel}
      overlayStyle={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 1000100, display: "flex", alignItems: "center", justifyContent: "center" }}
      dialogStyle={{ background: "white", borderRadius: 4, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 16, width: 320, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <p className="text-sm font-semibold text-slate-700">Add Alternate Member</p>
      <Field label="Material">
        <ErpComboboxField
          value={memberMaterialId}
          onChange={setMemberMaterialId}
          options={materialOptions}
          placeholder="Type to search..."
        />
      </Field>
      <div className="flex justify-end gap-2 mt-1">
        <button type="button" className="text-xs text-slate-500 px-3 py-1" onClick={onCancel}>Cancel</button>
        <button type="button" className="text-xs bg-sky-600 text-white rounded px-3 py-1" onClick={onAdd}>Add</button>
      </div>
    </BlockingLayer>
  );
}
