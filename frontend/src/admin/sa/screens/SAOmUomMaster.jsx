/*
 * File-ID: 15.14
 * File-Path: frontend/src/admin/sa/screens/SAOmUomMaster.jsx
 * Gate: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: SA-only UOM master — inline row edit, per-row toggle, right-panel create.
 * Authority: Frontend
 */

import React, { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createUom, toggleUom, updateUom } from "../../../pages/dashboard/om/omApi.js";
import { useUomsQuery } from "../../../hooks/queries/useOmMasterQueries.js";

const ERROR_MESSAGES = {
  OM_INVALID_UOM_CODE:  "UOM code is required (1–10 alphanumeric characters).",
  OM_INVALID_UOM_NAME:  "UOM name is required.",
  OM_INVALID_UOM_TYPE:  "UOM type is invalid.",
  OM_UOM_EXISTS:        "A UOM with this code already exists.",
  OM_UOM_NOT_FOUND:     "UOM not found.",
  OM_SA_REQUIRED:       "Super Admin access required.",
  OM_ADMIN_REQUIRED:    "Admin access required.",
  OM_UOM_CREATE_FAILED: "Failed to create UOM. Please try again.",
  OM_UOM_UPDATE_FAILED: "Failed to update UOM. Please try again.",
  OM_UOM_TOGGLE_FAILED: "Failed to update UOM status. Please try again.",
  OM_UOM_LIST_FAILED:   "Failed to load UOM list. Please refresh.",
};

const UOM_TYPES = ["COUNT", "WEIGHT", "VOLUME", "LENGTH", "PACKING"];
const EMPTY_CREATE = { uom_code: "", uom_name: "", uom_type: "COUNT" };

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

export default function SAOmUomMaster() {
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState("");
  const noticeTimer             = useRef(null);
  const queryClient = useQueryClient();
  const {
    data: rows = [],
    isLoading: loading,
    refetch,
  } = useUomsQuery({}, {
    select: (result) => (Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : []),
  });

  // Inline edit state
  const [editId, setEditId]     = useState(null);
  const [editDraft, setEditDraft] = useState({ uom_name: "", uom_type: "COUNT" });

  // Create form state
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  async function refreshRows() {
    setError("");
    const result = await refetch();
    if (result.error) {
      flash(friendlyError(result.error instanceof Error ? result.error.message : "OM_UOM_LIST_FAILED"), true);
    }
  }

  // ── Inline edit ──────────────────────────────────────────────
  function startEdit(row) {
    setEditId(row.id ?? row.code);
    setEditDraft({ uom_name: row.name, uom_type: row.uom_type });
    setError(""); setNotice("");
  }

  function cancelEdit() { setEditId(null); setEditDraft({ uom_name: "", uom_type: "COUNT" }); }

  async function saveEdit(row) {
    if (!editDraft.uom_name.trim()) { flash(friendlyError("OM_INVALID_UOM_NAME"), true); return; }
    setSaving(true);
    try {
      await updateUom({ code: row.code, name: editDraft.uom_name.trim(), uom_type: editDraft.uom_type });
      cancelEdit();
      flash(`UOM "${row.code}" updated.`);
      await queryClient.invalidateQueries({ queryKey: ["om", "uoms"] });
      await refreshRows();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "OM_UOM_UPDATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleToggle(row) {
    setSaving(true);
    try {
      await toggleUom({ code: row.code, active: !row.active });
      if (editId === (row.id ?? row.code)) cancelEdit();
      flash(`UOM "${row.code}" ${!row.active ? "activated" : "deactivated"}.`);
      await queryClient.invalidateQueries({ queryKey: ["om", "uoms"] });
      await refreshRows();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "OM_UOM_TOGGLE_FAILED"), true);
    } finally { setSaving(false); }
  }

  // ── Create ───────────────────────────────────────────────────
  async function handleCreate() {
    if (!createForm.uom_code.trim() || !createForm.uom_name.trim()) {
      flash(friendlyError("OM_INVALID_UOM_CODE"), true); return;
    }
    setSaving(true);
    try {
      await createUom({
        uom_code: createForm.uom_code.trim().toUpperCase(),
        uom_name: createForm.uom_name.trim(),
        uom_type: createForm.uom_type,
      });
      setCreateForm(EMPTY_CREATE);
      flash("UOM created successfully.");
      await queryClient.invalidateQueries({ queryKey: ["om", "uoms"] });
      await refreshRows();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "OM_UOM_CREATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin — Operation Management"
      title="UOM Master"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral", onClick: () => void refreshRows(), disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_320px]">
        {/* Left — list */}
        <ErpSectionCard eyebrow="UOM Register" title="All units of measure">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">No UOMs found.</td></tr>
                )}
                {rows.map((row) => {
                  const rowKey = row.id ?? row.code;
                  const isEditing = editId === rowKey;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "cursor-pointer hover:bg-slate-50"}`}
                        onClick={() => { if (!isEditing) startEdit(row); }}
                      >
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{row.code}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editDraft.uom_name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, uom_name: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none"
                            />
                          ) : row.name}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <select
                              value={editDraft.uom_type}
                              onChange={(e) => setEditDraft((d) => ({ ...d, uom_type: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none"
                            >
                              {UOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{row.uom_type}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                            {row.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button type="button" disabled={saving} onClick={() => void saveEdit(row)}
                                className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">
                                Save
                              </button>
                              <button type="button" onClick={cancelEdit}
                                className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button type="button" disabled={saving} onClick={() => void handleToggle(row)}
                              className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                                row.active
                                  ? "border-rose-300 bg-rose-50 text-rose-800"
                                  : "border-emerald-400 bg-emerald-50 text-emerald-900"
                              }`}>
                              {row.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">Click a row to edit name or type.</p>
        </ErpSectionCard>

        {/* Right — create */}
        <ErpSectionCard eyebrow="Create UOM" title="New unit of measure">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              UOM Code <span className="text-rose-500">*</span>
              <input
                value={createForm.uom_code}
                onChange={(e) => setCreateForm((f) => ({ ...f, uom_code: e.target.value.toUpperCase() }))}
                placeholder="e.g. KG"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              UOM Name <span className="text-rose-500">*</span>
              <input
                value={createForm.uom_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, uom_name: e.target.value }))}
                placeholder="e.g. Kilogram"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              UOM Type <span className="text-rose-500">*</span>
              <select
                value={createForm.uom_type}
                onChange={(e) => setCreateForm((f) => ({ ...f, uom_type: e.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                {UOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create UOM"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
