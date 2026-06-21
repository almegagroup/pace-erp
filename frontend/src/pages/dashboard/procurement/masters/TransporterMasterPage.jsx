/*
 * File-ID: 26.8
 * File-Path: frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: Transporter Master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import React, { useEffect, useRef, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  createTransporter,
  deleteTransporter,
  listTransporters,
  updateTransporter,
} from "../procurementApi.js";

const DIRECTION_OPTIONS = ["IMPORT", "DOMESTIC", "BOTH"];

const ERROR_MESSAGES = {
  PROCUREMENT_TRANSPORTER_IN_USE:        "Cannot delete — transporter is referenced. Deactivate instead.",
  PROCUREMENT_TRANSPORTER_DELETE_FAILED: "Failed to delete transporter. Please try again.",
  PROCUREMENT_TRANSPORTER_UPDATE_FAILED: "Failed to update transporter. Please try again.",
  PROCUREMENT_TRANSPORTER_SAVE_FAILED:   "Failed to save transporter. Please try again.",
  PROCUREMENT_TRANSPORTER_LIST_FAILED:   "Failed to load transporters. Please refresh.",
  MANAGER_OR_SA_REQUIRED:                "Manager or Super Admin access required.",
};

const EMPTY_CREATE = { transporter_name: "", usage_direction: "BOTH", contact_person: "", phone: "", gst_number: "" };

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

export default function TransporterMasterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [form, setForm] = useState({ ...EMPTY_CREATE });
  const noticeTimer = useRef(null);

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const data = await listTransporters({ is_active: "all" });
      setRows(Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_LIST_FAILED"), true);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void loadData();
    return () => clearTimeout(noticeTimer.current);
  }, []);

  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({
      transporter_name: row.transporter_name ?? "",
      usage_direction: row.usage_direction ?? "BOTH",
      contact_person: row.contact_person ?? "",
      phone: row.phone ?? "",
      gst_number: row.gst_number ?? "",
    });
    setError(""); setNotice("");
  }

  function cancelEdit() { setEditId(null); setEditDraft({}); }

  async function saveEdit(row) {
    if (!editDraft.transporter_name?.trim()) { flash("Transporter name is required.", true); return; }
    setSaving(true);
    try {
      await updateTransporter(row.id, {
        transporter_name: editDraft.transporter_name.trim(),
        usage_direction: editDraft.usage_direction,
        contact_person: editDraft.contact_person.trim() || null,
        phone: editDraft.phone.trim() || null,
        gst_number: editDraft.gst_number.trim() || null,
      });
      cancelEdit();
      flash(`Transporter "${row.transporter_code}" updated.`);
      await loadData();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_UPDATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleToggle(row) {
    setSaving(true);
    try {
      await updateTransporter(row.id, { active: !row.active });
      flash(`Transporter "${row.transporter_code}" ${!row.active ? "activated" : "deactivated"}.`);
      await loadData();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_UPDATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleDelete(row) {
    setSaving(true);
    try {
      await deleteTransporter(row.id);
      flash(`Transporter "${row.transporter_code}" deleted.`);
      await loadData();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_DELETE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleCreate() {
    if (!form.transporter_name.trim()) { flash("Transporter name is required.", true); return; }
    setSaving(true);
    try {
      const saved = await createTransporter({
        transporter_name: form.transporter_name.trim(),
        usage_direction: form.usage_direction,
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        gst_number: form.gst_number.trim() || null,
      });
      setForm({ ...EMPTY_CREATE });
      flash(`Transporter created: ${saved?.transporter_code ?? "TRN-generated"}`);
      await loadData();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_SAVE_FAILED"), true);
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Transporter Master"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral", onClick: () => void loadData(), disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success",  message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_300px]">
        <ErpSectionCard eyebrow="Transporter Register" title="All transporters">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {["Code", "Name", "Direction", "Contact Person", "Phone", "GST", "Status", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">No transporters found.</td></tr>}
                {rows.map((row) => {
                  const isEditing = editId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "cursor-pointer hover:bg-slate-50"}`}
                        onClick={() => { if (!isEditing) startEdit(row); }}
                      >
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{row.transporter_code}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {isEditing ? (
                            <input autoFocus value={editDraft.transporter_name} onChange={(e) => setEditDraft((d) => ({ ...d, transporter_name: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                          ) : row.transporter_name}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <select value={editDraft.usage_direction} onChange={(e) => setEditDraft((d) => ({ ...d, usage_direction: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none">
                              {DIRECTION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{row.usage_direction}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {isEditing ? (
                            <input value={editDraft.contact_person} onChange={(e) => setEditDraft((d) => ({ ...d, contact_person: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                          ) : (row.contact_person || "—")}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {isEditing ? (
                            <input value={editDraft.phone} onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                          ) : (row.phone || "—")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {isEditing ? (
                            <input value={editDraft.gst_number} onChange={(e) => setEditDraft((d) => ({ ...d, gst_number: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                          ) : (row.gst_number || "—")}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                            {row.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button type="button" disabled={saving} onClick={() => void saveEdit(row)} className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save</button>
                              <button type="button" onClick={cancelEdit} className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Cancel</button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <button type="button" disabled={saving} onClick={() => void handleToggle(row)} className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${row.active ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-400 bg-emerald-50 text-emerald-900"}`}>
                                {row.active ? "Deactivate" : "Activate"}
                              </button>
                              <button type="button" disabled={saving} onClick={() => void handleDelete(row)} className="border border-rose-400 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">Click a row to edit. Delete is blocked if referenced in a PO.</p>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Transporter" title="New transporter">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Name <span className="text-rose-500">*</span>
              <input value={form.transporter_name} onChange={(e) => setForm((f) => ({ ...f, transporter_name: e.target.value }))} placeholder="e.g. Blue Dart Logistics" className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Direction <span className="text-rose-500">*</span>
              <select value={form.usage_direction} onChange={(e) => setForm((f) => ({ ...f, usage_direction: e.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                {DIRECTION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Contact Person
              <input value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Phone
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              GST Number
              <input value={form.gst_number} onChange={(e) => setForm((f) => ({ ...f, gst_number: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <button type="button" disabled={saving} onClick={() => void handleCreate()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Creating..." : "Create Transporter"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
