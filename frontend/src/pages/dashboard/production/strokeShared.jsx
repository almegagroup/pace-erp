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

// ── RM/INT Lines as a real table (Stroke Master / Stroke Approval — CSN Tracker density) ───
// Same underlying data shape as StrokeLinesEditor (flat ids); ErpComboboxField
// shows the resolved label even when disabled, so read-only rows (APPROVED /
// DEACTIVATED strokes) need no separate server-nested-object rendering path.
export function StrokeLinesTable({ lines, setLines, materialsByType, groups, storageLocationOptions, onCreateGroup, onAddMember, disabled }) {
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

  const th = "text-left py-1.5 px-2 border-b text-[10px] uppercase tracking-wide text-slate-500 font-semibold";
  const td = "py-1.5 px-2 align-top";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">RM / INT Lines</p>
        <span className={`text-xs font-mono px-2 py-0.5 rounded ${Math.abs(sum - 100) < 0.01 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          Σ {sum.toFixed(2)}% / 100%
        </span>
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className={th}>#</th>
            <th className={th}>Type</th>
            <th className={`${th} min-w-[200px]`}>Material</th>
            <th className={`${th} text-right`}>Dosage %</th>
            <th className={`${th} min-w-[160px]`}>Storage Location</th>
            <th className={th}>Alternate?</th>
            <th className={`${th} min-w-[150px]`}>Group</th>
            <th className={`${th} min-w-[180px]`}>Members</th>
            {!disabled && <th className={th}></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const itemOptions = (materialsByType[line.line_material_type] ?? []).map((m) => ({
              value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`,
            }));
            const groupOptions = groups.map((g) => ({ value: g.id, label: `${g.group_code} — ${g.group_name}` }));
            const selectedGroup = groups.find((g) => g.id === line.material_group_id);

            return (
              <tr key={i} className="border-b border-slate-100">
                <td className={`${td} text-slate-400`}>{i + 1}</td>
                <td className={td}>
                  <ErpComboboxField
                    className="w-20"
                    value={line.line_material_type}
                    onChange={(v) => updateLine(i, { line_material_type: v, material_id: "" })}
                    options={[{ value: "RM", label: "RM" }, { value: "INT", label: "INT" }]}
                    hideBlank
                    disabled={disabled}
                  />
                </td>
                <td className={td}>
                  <ErpComboboxField
                    value={line.material_id}
                    onChange={(v) => updateLine(i, { material_id: v })}
                    options={itemOptions}
                    placeholder="-- Select material --"
                    disabled={disabled}
                  />
                </td>
                <td className={`${td} text-right`}>
                  <input
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-20 font-mono text-right"
                    type="number" step="0.01" min="0" max="100"
                    value={line.dosage_pct}
                    onChange={(e) => updateLine(i, { dosage_pct: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td className={td}>
                  <ErpComboboxField
                    value={line.default_storage_location_id}
                    onChange={(v) => updateLine(i, { default_storage_location_id: v })}
                    options={storageLocationOptions}
                    placeholder="-- Select --"
                    emptyStateLabel="No locations mapped"
                    disabled={disabled}
                  />
                </td>
                <td className={td}>
                  <input
                    type="checkbox"
                    checked={line.has_alternate}
                    disabled={disabled}
                    onChange={(e) => updateLine(i, { has_alternate: e.target.checked, material_group_id: e.target.checked ? line.material_group_id : "" })}
                  />
                </td>
                <td className={td}>
                  {line.has_alternate ? (
                    <div className="flex items-center gap-1.5">
                      <ErpComboboxField
                        value={line.material_group_id}
                        onChange={(v) => updateLine(i, { material_group_id: v })}
                        options={groupOptions}
                        placeholder="-- Select --"
                        disabled={disabled}
                      />
                      {!disabled && (
                        <button
                          type="button"
                          className="text-sky-600 hover:text-sky-800 text-[10px] underline whitespace-nowrap"
                          onClick={() => onCreateGroup((newGroupId) => updateLine(i, { material_group_id: newGroupId }))}
                        >
                          + New
                        </button>
                      )}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className={`${td} text-xs text-slate-500`}>
                  {line.has_alternate && selectedGroup ? (
                    <>
                      {(selectedGroup.members ?? []).length === 0
                        ? "none yet"
                        : selectedGroup.members.map((m) => materialLabelById.get(m.material_id) ?? "—").join(", ")}
                      {!disabled && (
                        <button
                          type="button"
                          className="text-sky-600 hover:text-sky-800 underline ml-1"
                          onClick={() => onAddMember(selectedGroup.id)}
                        >
                          + Add
                        </button>
                      )}
                    </>
                  ) : "—"}
                </td>
                {!disabled && (
                  <td className={td}>
                    <button type="button" onClick={() => removeLine(i)} className="text-rose-400 hover:text-rose-600 text-sm px-1">✕</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!disabled && (
        <button type="button" onClick={addLine} className="text-sky-600 hover:text-sky-800 text-xs underline mt-2">+ Add line</button>
      )}
    </div>
  );
}

// ── Change BOM Item (PR03/PR04) — Current vs Proposed comparison table ─────
// Dosage% is never shown/editable here — per 83.3 PR03/PR04 lock, Change BOM
// Item only substitutes Item / Has Alternate / Material Group. `lines` shape:
// { stroke_line_id, line_material_type, current_material_id, current_group_id,
//   dosage_pct, new_material_id, new_has_alternate, new_group_id }
export function ChangeBomLinesTable({ lines, setLines, materialsByType, groups, onCreateGroup, onAddMember, editable }) {
  function updateLine(i, patch) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  const materialLabelById = new Map(
    [...(materialsByType.RM ?? []), ...(materialsByType.INT ?? [])]
      .map((m) => [m.id, `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`]),
  );
  const groupLabelById = new Map(groups.map((g) => [g.id, `${g.group_code} — ${g.group_name}`]));

  const th = "text-left py-1.5 px-2 border-b text-[10px] uppercase tracking-wide text-slate-500 font-semibold";
  const td = "py-1.5 px-2 align-top";

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-slate-50">
          <th className={th}>#</th>
          <th className={th}>Type</th>
          <th className={`${th} min-w-[180px]`}>Current item</th>
          <th className={th}>Current group</th>
          <th className={`${th} text-right`}>Dosage %</th>
          <th className={`${th} min-w-[200px]`}>New item</th>
          <th className={th}>Alternate?</th>
          <th className={`${th} min-w-[150px]`}>New group</th>
          <th className={`${th} min-w-[160px]`}>Members</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => {
          const itemOptions = (materialsByType[line.line_material_type] ?? []).map((m) => ({
            value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`,
          }));
          const groupOptions = groups.map((g) => ({ value: g.id, label: `${g.group_code} — ${g.group_name}` }));
          const selectedGroup = groups.find((g) => g.id === line.new_group_id);
          const changedItem = line.new_material_id && line.new_material_id !== line.current_material_id;
          const changedGroup = Boolean(line.new_has_alternate) !== Boolean(line.current_group_id) || line.new_group_id !== line.current_group_id;

          return (
            <tr key={line.stroke_line_id ?? i} className={`border-b border-slate-100 ${changedItem || changedGroup ? "bg-sky-50/60" : ""}`}>
              <td className={`${td} text-slate-400`}>{i + 1}</td>
              <td className={`${td} text-slate-500`}>{line.line_material_type}</td>
              <td className={td}>{materialLabelById.get(line.current_material_id) ?? "—"}</td>
              <td className={`${td} text-slate-500`}>{line.current_group_id ? (groupLabelById.get(line.current_group_id) ?? "—") : "—"}</td>
              <td className={`${td} text-right font-mono`}>{Number(line.dosage_pct ?? 0).toFixed(2)}%</td>
              <td className={td}>
                {editable ? (
                  <ErpComboboxField
                    value={line.new_material_id}
                    onChange={(v) => updateLine(i, { new_material_id: v })}
                    options={itemOptions}
                    placeholder="-- Keep current --"
                  />
                ) : (
                  <span className={changedItem ? "font-semibold text-sky-700" : "text-slate-400"}>
                    {line.new_material_id ? (materialLabelById.get(line.new_material_id) ?? "—") : "Unchanged"}
                  </span>
                )}
              </td>
              <td className={td}>
                {editable ? (
                  <input
                    type="checkbox"
                    checked={Boolean(line.new_has_alternate)}
                    onChange={(e) => updateLine(i, { new_has_alternate: e.target.checked, new_group_id: e.target.checked ? line.new_group_id : "" })}
                  />
                ) : (
                  <span className={changedGroup ? "font-semibold text-sky-700" : "text-slate-400"}>{line.new_has_alternate ? "Yes" : "No"}</span>
                )}
              </td>
              <td className={td}>
                {line.new_has_alternate ? (
                  editable ? (
                    <div className="flex items-center gap-1.5">
                      <ErpComboboxField
                        value={line.new_group_id}
                        onChange={(v) => updateLine(i, { new_group_id: v })}
                        options={groupOptions}
                        placeholder="-- Select --"
                      />
                      <button
                        type="button"
                        className="text-sky-600 hover:text-sky-800 text-[10px] underline whitespace-nowrap"
                        onClick={() => onCreateGroup((newGroupId) => updateLine(i, { new_group_id: newGroupId }))}
                      >
                        + New
                      </button>
                    </div>
                  ) : (
                    <span>{groupLabelById.get(line.new_group_id) ?? "—"}</span>
                  )
                ) : <span className="text-slate-400">—</span>}
              </td>
              <td className={`${td} text-xs text-slate-500`}>
                {line.new_has_alternate && selectedGroup ? (
                  <>
                    {(selectedGroup.members ?? []).length === 0
                      ? "none yet"
                      : selectedGroup.members.map((m) => materialLabelById.get(m.material_id) ?? "—").join(", ")}
                    {editable && (
                      <button type="button" className="text-sky-600 hover:text-sky-800 underline ml-1" onClick={() => onAddMember(selectedGroup.id)}>
                        + Add
                      </button>
                    )}
                  </>
                ) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Pack BOM (PR05/PR06) — PM Input Lines table ─────────────────────────────
// Same mechanism as Stroke Master RM lines (material_category_group alternates)
// but PM-only, no Dosage%, absolute Qty per outer pack unit, UOM auto-derived
// from the selected PM material's base_uom_code (locked spec: not editable).
export function PackBomLinesTable({ lines, setLines, materials, groups, onCreateGroup, onAddMember, disabled }) {
  function addLine() {
    setLines((l) => [...l, { _key: Math.random().toString(36).slice(2), material_id: "", qty: "", uom_code: "", has_alternate: false, material_group_id: "" }]);
  }
  function removeLine(key) { setLines((l) => l.filter((row) => row._key !== key)); }
  function updateLine(key, patch) {
    setLines((l) => l.map((row) => (row._key === key ? { ...row, ...patch } : row)));
  }
  function updateMaterial(key, materialId) {
    const mat = materials.find((m) => m.id === materialId);
    updateLine(key, { material_id: materialId, uom_code: mat?.base_uom_code ?? "" });
  }

  const materialOptions = materials.map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }));
  const materialLabelById = new Map(materials.map((m) => [m.id, `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`]));
  const groupOptions = groups.map((g) => ({ value: g.id, label: `${g.group_code} — ${g.group_name}` }));

  const th = "text-left py-1.5 px-2 border-b text-[10px] uppercase tracking-wide text-slate-500 font-semibold";
  const td = "py-1.5 px-2 align-top";

  return (
    <div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className={th}>#</th>
            <th className={`${th} min-w-[220px]`}>PM Material</th>
            <th className={`${th} text-right`}>Qty</th>
            <th className={th}>UOM</th>
            <th className={th}>Alternate?</th>
            <th className={`${th} min-w-[150px]`}>Group</th>
            <th className={`${th} min-w-[180px]`}>Members</th>
            {!disabled && <th className={th}></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const selectedGroup = groups.find((g) => g.id === line.material_group_id);
            return (
              <tr key={line._key ?? i} className="border-b border-slate-100">
                <td className={`${td} text-slate-400`}>{i + 1}</td>
                <td className={td}>
                  <ErpComboboxField
                    value={line.material_id}
                    onChange={(v) => updateMaterial(line._key, v)}
                    options={materialOptions}
                    placeholder="-- Select PM material --"
                    disabled={disabled}
                  />
                </td>
                <td className={`${td} text-right`}>
                  <input
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-24 font-mono text-right"
                    type="number" step="0.001" min="0"
                    value={line.qty}
                    onChange={(e) => updateLine(line._key, { qty: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td className={`${td} text-slate-500`}>{line.uom_code || "—"}</td>
                <td className={td}>
                  <input
                    type="checkbox"
                    checked={line.has_alternate}
                    disabled={disabled}
                    onChange={(e) => updateLine(line._key, { has_alternate: e.target.checked, material_group_id: e.target.checked ? line.material_group_id : "" })}
                  />
                </td>
                <td className={td}>
                  {line.has_alternate ? (
                    <div className="flex items-center gap-1.5">
                      <ErpComboboxField
                        value={line.material_group_id}
                        onChange={(v) => updateLine(line._key, { material_group_id: v })}
                        options={groupOptions}
                        placeholder="-- Select --"
                        disabled={disabled}
                      />
                      {!disabled && (
                        <button
                          type="button"
                          className="text-sky-600 hover:text-sky-800 text-[10px] underline whitespace-nowrap"
                          onClick={() => onCreateGroup((newGroupId) => updateLine(line._key, { material_group_id: newGroupId }))}
                        >
                          + New
                        </button>
                      )}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className={`${td} text-xs text-slate-500`}>
                  {line.has_alternate && selectedGroup ? (
                    <>
                      {(selectedGroup.members ?? []).length === 0
                        ? "none yet"
                        : selectedGroup.members.map((m) => materialLabelById.get(m.material_id) ?? "—").join(", ")}
                      {!disabled && (
                        <button type="button" className="text-sky-600 hover:text-sky-800 underline ml-1" onClick={() => onAddMember(selectedGroup.id)}>+ Add</button>
                      )}
                    </>
                  ) : "—"}
                </td>
                {!disabled && (
                  <td className={td}>
                    <button type="button" onClick={() => removeLine(line._key)} className="text-rose-400 hover:text-rose-600 text-sm px-1">✕</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!disabled && (
        <button type="button" onClick={addLine} className="text-sky-600 hover:text-sky-800 text-xs underline mt-2">+ Add PM Line</button>
      )}
    </div>
  );
}

const CHANGE_ACTION_COLORS = { ADD: "bg-emerald-100 text-emerald-800", REMOVE: "bg-rose-100 text-rose-800", EDIT: "bg-sky-100 text-sky-800" };

// ── Change Pack BOM (PR07/PR08) — action-aware ADD/REMOVE/EDIT lines table ──
// Unlike Stroke's fixed 1:1 substitution model, Pack BOM changes are free-form
// CRUD on PM rows (add new / remove existing / edit qty or substitute item).
// `lines` shape: { _key, action, bom_line_id, old_material_id, material_id,
//   qty, uom_code, has_alternate, material_group_id, marked_remove }
export function PackBomChangeLinesTable({ lines, setLines, materials, groups, onCreateGroup, onAddMember, editable }) {
  function updateLine(key, patch) {
    setLines((l) => l.map((row) => (row._key === key ? { ...row, ...patch } : row)));
  }
  function toggleRemove(key) {
    setLines((l) => l.map((row) => {
      if (row._key !== key) return row;
      const nowRemoved = !row.marked_remove;
      return { ...row, marked_remove: nowRemoved, action: nowRemoved ? "REMOVE" : (row.bom_line_id ? "EDIT" : "ADD") };
    }));
  }
  function deleteAddedRow(key) { setLines((l) => l.filter((row) => row._key !== key)); }
  function addLine() {
    setLines((l) => [...l, {
      _key: `new-${Math.random().toString(36).slice(2)}`,
      action: "ADD", bom_line_id: null, old_material_id: "",
      material_id: "", qty: "", uom_code: "", has_alternate: false, material_group_id: "", marked_remove: false,
    }]);
  }
  function updateMaterial(key, materialId) {
    const mat = materials.find((m) => m.id === materialId);
    updateLine(key, { material_id: materialId, uom_code: mat?.base_uom_code ?? "" });
  }

  const materialOptions = materials.map((m) => ({ value: m.id, label: `${m.pace_code ?? "—"} — ${m.material_name ?? ""}` }));
  const materialLabelById = new Map(materials.map((m) => [m.id, `${m.pace_code ?? "—"} — ${m.material_name ?? ""}`]));
  const groupOptions = groups.map((g) => ({ value: g.id, label: `${g.group_code} — ${g.group_name}` }));

  const th = "text-left py-1.5 px-2 border-b text-[10px] uppercase tracking-wide text-slate-500 font-semibold";
  const td = "py-1.5 px-2 align-top";

  return (
    <div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className={th}>#</th>
            <th className={th}>Action</th>
            <th className={`${th} min-w-[180px]`}>Current Material</th>
            <th className={`${th} min-w-[200px]`}>Proposed Material</th>
            <th className={`${th} text-right`}>Qty</th>
            <th className={th}>UOM</th>
            <th className={th}>Alternate?</th>
            <th className={`${th} min-w-[150px]`}>Group</th>
            <th className={`${th} min-w-[160px]`}>Members</th>
            {editable && <th className={th}></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const removed = line.marked_remove || line.action === "REMOVE";
            const isAdd = line.action === "ADD";
            const rowEditable = editable && !removed;
            const selectedGroup = groups.find((g) => g.id === line.material_group_id);

            return (
              <tr key={line._key ?? i} className={`border-b border-slate-100 ${removed ? "opacity-50 bg-rose-50" : isAdd ? "bg-emerald-50/60" : ""}`}>
                <td className={`${td} text-slate-400`}>{i + 1}</td>
                <td className={td}>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHANGE_ACTION_COLORS[line.action] ?? ""}`}>{line.action}</span>
                </td>
                <td className={td}>
                  {isAdd ? <span className="text-slate-400">— (new line)</span> : (materialLabelById.get(line.old_material_id) ?? "—")}
                </td>
                <td className={td}>
                  {rowEditable ? (
                    <ErpComboboxField
                      value={line.material_id}
                      onChange={(v) => updateMaterial(line._key, v)}
                      options={materialOptions}
                      placeholder="-- Select PM material --"
                    />
                  ) : removed ? (
                    <span className="text-slate-400 line-through">{materialLabelById.get(line.material_id) ?? materialLabelById.get(line.old_material_id) ?? "—"}</span>
                  ) : (
                    <span>{materialLabelById.get(line.material_id) ?? "—"}</span>
                  )}
                </td>
                <td className={`${td} text-right`}>
                  <input
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-20 font-mono text-right disabled:bg-slate-50"
                    type="number" step="0.001" min="0"
                    value={line.qty}
                    disabled={!rowEditable}
                    onChange={(e) => updateLine(line._key, { qty: e.target.value })}
                  />
                </td>
                <td className={`${td} text-slate-500`}>{line.uom_code || "—"}</td>
                <td className={td}>
                  <input
                    type="checkbox"
                    checked={line.has_alternate}
                    disabled={!rowEditable}
                    onChange={(e) => updateLine(line._key, { has_alternate: e.target.checked, material_group_id: e.target.checked ? line.material_group_id : "" })}
                  />
                </td>
                <td className={td}>
                  {line.has_alternate ? (
                    rowEditable ? (
                      <div className="flex items-center gap-1.5">
                        <ErpComboboxField value={line.material_group_id} onChange={(v) => updateLine(line._key, { material_group_id: v })} options={groupOptions} placeholder="-- Select --" />
                        <button type="button" className="text-sky-600 hover:text-sky-800 text-[10px] underline whitespace-nowrap" onClick={() => onCreateGroup((newGroupId) => updateLine(line._key, { material_group_id: newGroupId }))}>+ New</button>
                      </div>
                    ) : (
                      <span>{groupOptions.find((g) => g.value === line.material_group_id)?.label ?? "—"}</span>
                    )
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className={`${td} text-xs text-slate-500`}>
                  {line.has_alternate && selectedGroup ? (
                    <>
                      {(selectedGroup.members ?? []).length === 0
                        ? "none yet"
                        : selectedGroup.members.map((m) => materialLabelById.get(m.material_id) ?? "—").join(", ")}
                      {rowEditable && (
                        <button type="button" className="text-sky-600 hover:text-sky-800 underline ml-1" onClick={() => onAddMember(selectedGroup.id)}>+ Add</button>
                      )}
                    </>
                  ) : "—"}
                </td>
                {editable && (
                  <td className={td}>
                    {isAdd ? (
                      <button type="button" className="text-rose-500 hover:text-rose-700 text-xs" onClick={() => deleteAddedRow(line._key)}>Delete</button>
                    ) : (
                      <button type="button" className={`text-xs ${removed ? "text-slate-500 hover:text-slate-700" : "text-rose-500 hover:text-rose-700"}`} onClick={() => toggleRemove(line._key)}>
                        {removed ? "Undo" : "Remove"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {editable && (
        <button type="button" onClick={addLine} className="text-sky-600 hover:text-sky-800 text-xs underline mt-2">+ Add PM Line</button>
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
