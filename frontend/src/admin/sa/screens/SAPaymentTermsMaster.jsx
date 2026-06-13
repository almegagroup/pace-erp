/*
 * File-ID: 26.2
 * File-Path: frontend/src/admin/sa/screens/SAPaymentTermsMaster.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: SA screen — Payment Terms master + Reference Date Types management.
 * Authority: Frontend
 */

import React, { useEffect, useState } from "react";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createPaymentTerm,
  createReferenceDateType,
  deletePaymentTerm,
  listPaymentTerms,
  listReferenceDateTypes,
  togglePaymentTerm,
  toggleReferenceDateType,
  updatePaymentTerm,
} from "../../../pages/dashboard/procurement/procurementApi.js";

const PAYMENT_METHODS = ["CREDIT", "ADVANCE", "LC", "TT", "DA", "DP", "MIXED"];
const LC_TYPES        = ["AT_SIGHT", "USANCE", "N_A"];
const SOURCE_DOCS     = ["CSN", "IV", "MANUAL"];
const TABS = [
  { key: "terms",   label: "Payment Terms" },
  { key: "ref",     label: "Reference Date Types" },
];

const EMPTY_TERM = {
  name: "", payment_method: "CREDIT", reference_date_type_id: "",
  credit_days: "", advance_pct: "", lc_type: "N_A", usance_days: "", description: "",
};
const EMPTY_REF = { code: "", label: "", source_document: "CSN", source_field: "", description: "" };

export default function SAPaymentTermsMaster() {
  const [tab, setTab]               = useState("terms");
  const [terms, setTerms]           = useState([]);
  const [refTypes, setRefTypes]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [notice, setNotice]         = useState("");

  // Payment Terms
  const [editId, setEditId]         = useState(null);
  const [editDraft, setEditDraft]   = useState({});
  const [termForm, setTermForm]     = useState(EMPTY_TERM);

  // Reference Date Types
  const [refForm, setRefForm]       = useState(EMPTY_REF);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [termsResult, refResult] = await Promise.all([
        listPaymentTerms({ is_active: "" }),
        listReferenceDateTypes({ active: "false" }),
      ]);
      setTerms(Array.isArray(termsResult) ? termsResult : (termsResult?.data ?? []));
      setRefTypes(Array.isArray(refResult) ? refResult : (refResult?.data ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  function flash(msg, isError = false) {
    if (isError) setError(msg); else { setError(""); setNotice(msg); }
  }

  // ── Payment Terms inline edit ────────────────────────────────
  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({
      name: row.name,
      payment_method: row.payment_method,
      reference_date_type_id: row.reference_date_type_id,
      credit_days: row.credit_days ?? "",
      advance_pct: row.advance_pct ?? "",
      lc_type: row.lc_type ?? "N_A",
      usance_days: row.usance_days ?? "",
      description: row.description ?? "",
    });
    setError(""); setNotice("");
  }

  function cancelEdit() { setEditId(null); setEditDraft({}); }

  async function saveEdit(row) {
    if (!editDraft.name?.trim() || !editDraft.reference_date_type_id) {
      flash("Name and Reference Date Type are required.", true); return;
    }
    setSaving(true);
    try {
      await updatePaymentTerm(row.id, {
        name: editDraft.name.trim(),
        payment_method: editDraft.payment_method,
        reference_date_type_id: editDraft.reference_date_type_id,
        credit_days: editDraft.credit_days === "" ? null : Number(editDraft.credit_days),
        advance_pct: editDraft.advance_pct === "" ? null : Number(editDraft.advance_pct),
        lc_type: editDraft.lc_type || "N_A",
        usance_days: editDraft.usance_days === "" ? null : Number(editDraft.usance_days),
        description: editDraft.description?.trim() || null,
      });
      setEditId(null); setEditDraft({});
      flash("Payment term updated.");
      await loadAll();
    } catch (e) { flash(e instanceof Error ? e.message : "UPDATE_FAILED", true); }
    finally { setSaving(false); }
  }

  async function handleToggleTerm(row) {
    setSaving(true);
    try {
      await togglePaymentTerm({ id: row.id, active: !row.active });
      flash(`Payment term ${!row.active ? "activated" : "deactivated"}.`);
      await loadAll();
    } catch (e) { flash(e instanceof Error ? e.message : "TOGGLE_FAILED", true); }
    finally { setSaving(false); }
  }

  async function handleDeleteTerm(row) {
    const confirmed = await openActionConfirm({
      eyebrow: "Payment Terms",
      title: `Delete "${row.name}"?`,
      message: "This cannot be undone. Fails if referenced by any open PO.",
      confirmLabel: "Delete", cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await deletePaymentTerm(row.id);
      flash("Payment term deleted.");
      await loadAll();
    } catch (e) { flash(e instanceof Error ? e.message : "DELETE_FAILED", true); }
    finally { setSaving(false); }
  }

  async function handleCreateTerm() {
    if (!termForm.name.trim() || !termForm.reference_date_type_id) {
      flash("Name and Reference Date Type are required.", true); return;
    }
    setSaving(true);
    try {
      await createPaymentTerm({
        name: termForm.name.trim(),
        payment_method: termForm.payment_method,
        reference_date_type_id: termForm.reference_date_type_id,
        credit_days: termForm.credit_days === "" ? null : Number(termForm.credit_days),
        advance_pct: termForm.advance_pct === "" ? null : Number(termForm.advance_pct),
        lc_type: termForm.lc_type || "N_A",
        usance_days: termForm.usance_days === "" ? null : Number(termForm.usance_days),
        description: termForm.description.trim() || null,
      });
      setTermForm(EMPTY_TERM);
      flash("Payment term created.");
      await loadAll();
    } catch (e) { flash(e instanceof Error ? e.message : "CREATE_FAILED", true); }
    finally { setSaving(false); }
  }

  // ── Reference Date Types ─────────────────────────────────────
  async function handleToggleRef(row) {
    setSaving(true);
    try {
      await toggleReferenceDateType({ id: row.id, is_active: !row.is_active });
      flash(`Reference date type ${!row.is_active ? "activated" : "deactivated"}.`);
      await loadAll();
    } catch (e) { flash(e instanceof Error ? e.message : "TOGGLE_FAILED", true); }
    finally { setSaving(false); }
  }

  async function handleCreateRef() {
    if (!refForm.code.trim() || !refForm.label.trim() || !refForm.source_document) {
      flash("Code, label, and source document are required.", true); return;
    }
    setSaving(true);
    try {
      await createReferenceDateType({
        code: refForm.code.trim().toUpperCase(),
        label: refForm.label.trim(),
        source_document: refForm.source_document,
        source_field: refForm.source_field.trim() || null,
        description: refForm.description.trim() || null,
      });
      setRefForm(EMPTY_REF);
      flash("Reference date type created.");
      await loadAll();
    } catch (e) { flash(e instanceof Error ? e.message : "CREATE_FAILED", true); }
    finally { setSaving(false); }
  }

  const activeRefTypes = refTypes.filter((r) => r.is_active !== false);

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin — Operation Management"
      title="Payment Terms"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral", onClick: () => void loadAll(), disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success", message: notice }] : []),
      ]}
    >
      {/* Tab bar */}
      <div className="flex border-b border-slate-200 mb-4">
        {TABS.map((t) => (
          <button key={t.key} type="button"
            onClick={() => { setTab(t.key); setError(""); setNotice(""); }}
            className={`px-5 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              tab === t.key
                ? "border-sky-600 text-sky-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Tab 1: Payment Terms ── */}
      {tab === "terms" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_380px]">
          <ErpSectionCard eyebrow="Payment Terms Register" title="All payment terms">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Method</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Reference Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Credit Days</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
                  {!loading && terms.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No payment terms yet.</td></tr>}
                  {terms.map((row) => {
                    const isEditing = editId === row.id;
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "hover:bg-slate-50 cursor-pointer"}`}
                          onClick={() => { if (!isEditing) startEdit(row); }}
                        >
                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.code}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {isEditing ? (
                              <input autoFocus value={editDraft.name}
                                onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none"
                              />
                            ) : row.name}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <select value={editDraft.payment_method}
                                onChange={(e) => setEditDraft((d) => ({ ...d, payment_method: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none"
                              >
                                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{row.payment_method}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {isEditing ? (
                              <select value={editDraft.reference_date_type_id}
                                onChange={(e) => setEditDraft((d) => ({ ...d, reference_date_type_id: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none"
                              >
                                <option value="">— select —</option>
                                {activeRefTypes.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                              </select>
                            ) : (row.reference_date_type?.label ?? "—")}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {isEditing ? (
                              <input type="number" min="0" value={editDraft.credit_days}
                                onChange={(e) => setEditDraft((d) => ({ ...d, credit_days: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-16 border border-sky-400 bg-white px-1 text-sm outline-none"
                              />
                            ) : (row.credit_days ?? "—")}
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
                                  className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save</button>
                                <button type="button" onClick={cancelEdit}
                                  className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Cancel</button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <button type="button" disabled={saving} onClick={() => void handleToggleTerm(row)}
                                  className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${row.active ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-400 bg-emerald-50 text-emerald-900"}`}>
                                  {row.active ? "Deactivate" : "Activate"}
                                </button>
                                <button type="button" disabled={saving} onClick={() => void handleDeleteTerm(row)}
                                  className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isEditing && (
                          <tr className="bg-sky-50">
                            <td colSpan={7} className="px-3 pb-3">
                              <div className="grid grid-cols-3 gap-3 pt-1">
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
                                  Advance %
                                  <input type="number" min="0" max="100" value={editDraft.advance_pct}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, advance_pct: e.target.value }))}
                                    className="h-7 border border-sky-300 bg-white px-2 text-sm outline-none" />
                                </label>
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
                                  LC Type
                                  <select value={editDraft.lc_type}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, lc_type: e.target.value }))}
                                    className="h-7 border border-sky-300 bg-white px-1 text-sm outline-none">
                                    {LC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </label>
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
                                  Usance Days
                                  <input type="number" min="0" value={editDraft.usance_days}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, usance_days: e.target.value }))}
                                    className="h-7 border border-sky-300 bg-white px-2 text-sm outline-none" />
                                </label>
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600 col-span-3">
                                  Description
                                  <input value={editDraft.description}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                                    className="h-7 border border-sky-300 bg-white px-2 text-sm outline-none" />
                                </label>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ErpSectionCard>

          {/* Right: create form */}
          <ErpSectionCard eyebrow="Create Payment Term" title="New term">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Name <span className="text-rose-500">*</span>
                <input value={termForm.name} onChange={(e) => setTermForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Net 30 from BL"
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Payment Method <span className="text-rose-500">*</span>
                <select value={termForm.payment_method} onChange={(e) => setTermForm((f) => ({ ...f, payment_method: e.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500">
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Reference Date <span className="text-rose-500">*</span>
                <select value={termForm.reference_date_type_id} onChange={(e) => setTermForm((f) => ({ ...f, reference_date_type_id: e.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500">
                  <option value="">— select —</option>
                  {activeRefTypes.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Credit Days
                  <input type="number" min="0" value={termForm.credit_days}
                    onChange={(e) => setTermForm((f) => ({ ...f, credit_days: e.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Advance %
                  <input type="number" min="0" max="100" value={termForm.advance_pct}
                    onChange={(e) => setTermForm((f) => ({ ...f, advance_pct: e.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  LC Type
                  <select value={termForm.lc_type} onChange={(e) => setTermForm((f) => ({ ...f, lc_type: e.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500">
                    {LC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Usance Days
                  <input type="number" min="0" value={termForm.usance_days}
                    onChange={(e) => setTermForm((f) => ({ ...f, usance_days: e.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Description
                <textarea value={termForm.description} onChange={(e) => setTermForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2} className="border border-slate-300 bg-[#fffef7] px-2 py-1.5 text-sm outline-none focus:border-sky-500" />
              </label>
              <button type="button" disabled={saving} onClick={() => void handleCreateTerm()}
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                {saving ? "Creating..." : "Create Payment Term"}
              </button>
            </div>
          </ErpSectionCard>
        </div>
      )}

      {/* ── Tab 2: Reference Date Types ── */}
      {tab === "ref" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
          <ErpSectionCard eyebrow="Reference Date Types" title="All reference date types">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Label</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Source</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Field</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
                  {!loading && refTypes.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No reference date types found.</td></tr>}
                  {refTypes.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{row.code}</td>
                      <td className="px-3 py-2 text-slate-900">{row.label}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{row.source_document}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.source_field ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                          {row.is_active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" disabled={saving} onClick={() => void handleToggleRef(row)}
                          className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${row.is_active ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-400 bg-emerald-50 text-emerald-900"}`}>
                          {row.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ErpSectionCard>

          {/* Right: create form */}
          <ErpSectionCard eyebrow="Add Reference Date Type" title="New type">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Code <span className="text-rose-500">*</span>
                <input value={refForm.code} onChange={(e) => setRefForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. ETD_DATE"
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Label <span className="text-rose-500">*</span>
                <input value={refForm.label} onChange={(e) => setRefForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. ETD Date"
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Source Document <span className="text-rose-500">*</span>
                <select value={refForm.source_document} onChange={(e) => setRefForm((f) => ({ ...f, source_document: e.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500">
                  {SOURCE_DOCS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Source Field
                <input value={refForm.source_field} onChange={(e) => setRefForm((f) => ({ ...f, source_field: e.target.value }))}
                  placeholder="e.g. etd (column name in DB)"
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Description
                <textarea value={refForm.description} onChange={(e) => setRefForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2} className="border border-slate-300 bg-[#fffef7] px-2 py-1.5 text-sm outline-none focus:border-sky-500" />
              </label>
              <button type="button" disabled={saving} onClick={() => void handleCreateRef()}
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                {saving ? "Creating..." : "Add Reference Date Type"}
              </button>
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
