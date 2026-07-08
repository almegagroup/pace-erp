/*
 * File-ID: 26.8
 * File-Path: frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: Transporter Master page for L2_MANAGER+ users. GST-backed autofill (like Vendor/Company),
 *          multi-row Contacts/Emails, and Company Mapping.
 * Authority: Frontend
 */

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import {
  createTransporter,
  deleteTransporter,
  listTransporterCompanyMaps,
  listTransporterContacts,
  listTransporterEmails,
  listTransporters,
  lookupGstProfile,
  mapTransporterToCompany,
  saveTransporterContacts,
  saveTransporterEmails,
  updateTransporter,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";

const DIRECTION_OPTIONS = ["IMPORT", "DOMESTIC", "BOTH"];

const ERROR_MESSAGES = {
  PROCUREMENT_TRANSPORTER_IN_USE:        "Cannot delete — transporter is referenced. Deactivate instead.",
  PROCUREMENT_TRANSPORTER_DELETE_FAILED: "Failed to delete transporter. Please try again.",
  PROCUREMENT_TRANSPORTER_UPDATE_FAILED: "Failed to update transporter. Please try again.",
  PROCUREMENT_TRANSPORTER_SAVE_FAILED:   "Failed to save transporter. Please try again.",
  PROCUREMENT_TRANSPORTER_LIST_FAILED:   "Failed to load transporters. Please refresh.",
  PROCUREMENT_GST_NUMBER_REQUIRED:       "Enter a GST number first.",
  MANAGER_OR_SA_REQUIRED:                "Manager or Super Admin access required.",
};

const EMPTY_CREATE = {
  gstMode: "WITH_GST",
  gst_number: "",
  transporter_name: "",
  usage_direction: "BOTH",
  address: "",
  pan_number: "",
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

export default function TransporterMasterPage() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [form, setForm] = useState({ ...EMPTY_CREATE });
  const [lookingUp, setLookingUp] = useState(false);
  const [manageId, setManageId] = useState(null);
  const noticeTimer = useRef(null);
  const companiesQuery = useCompaniesQuery();
  const transporterQuery = useQuery({
    queryKey: ["procurement", "transporters", "all"],
    queryFn: async () => {
      const result = await listTransporters({ is_active: "all" });
      return Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
    },
  });
  const rows = transporterQuery.data ?? [];
  const companies = Array.isArray(companiesQuery.data) ? companiesQuery.data : [];
  const loading = transporterQuery.isLoading || companiesQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([transporterQuery.refetch(), companiesQuery.refetch()]),
    },
  });

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  useEffect(() => {
    if (transporterQuery.error || companiesQuery.error) {
      flash(
        friendlyError(
          transporterQuery.error?.message ||
          companiesQuery.error?.message ||
          "PROCUREMENT_TRANSPORTER_LIST_FAILED"
        ),
        true
      );
    }
    return () => clearTimeout(noticeTimer.current);
  }, [companiesQuery.error, transporterQuery.error]);

  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({
      transporter_name: row.transporter_name ?? "",
      usage_direction: row.usage_direction ?? "BOTH",
      address: row.address ?? "",
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
        address: editDraft.address.trim() || null,
      });
      cancelEdit();
      flash(`Transporter "${row.transporter_code}" updated.`);
      await Promise.all([transporterQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_UPDATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleToggle(row) {
    setSaving(true);
    try {
      await updateTransporter(row.id, { active: !row.active });
      flash(`Transporter "${row.transporter_code}" ${!row.active ? "activated" : "deactivated"}.`);
      await Promise.all([transporterQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_UPDATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleDelete(row) {
    setSaving(true);
    try {
      await deleteTransporter(row.id);
      flash(`Transporter "${row.transporter_code}" deleted.`);
      await Promise.all([transporterQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_DELETE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleLookup() {
    const gst = form.gst_number.trim().toUpperCase();
    if (!gst) { flash("Enter a GST number first.", true); return; }
    setLookingUp(true);
    setError("");
    try {
      const profile = await lookupGstProfile(gst);
      setForm((f) => ({
        ...f,
        gst_number: gst,
        transporter_name: profile.legal_name || f.transporter_name,
        address: [profile.full_address, profile.state_name, profile.pin_code].filter(Boolean).join(", "),
      }));
      flash(`GST resolved (${profile.source === "CACHE" ? "from cache" : "fetched live"}). Fields overwritten — review before saving.`);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_GST_LOOKUP_FAILED"), true);
    } finally { setLookingUp(false); }
  }

  async function handleCreate() {
    if (!form.transporter_name.trim()) { flash("Transporter name is required.", true); return; }
    if (form.gstMode === "WITH_GST" && !form.gst_number.trim()) { flash("GST number is required. If this transporter has no GST, click 'Without GST' above.", true); return; }
    setSaving(true);
    try {
      const saved = await createTransporter({
        transporter_name: form.transporter_name.trim(),
        usage_direction: form.usage_direction,
        gst_number: form.gstMode === "WITH_GST" ? form.gst_number.trim().toUpperCase() : null,
        pan_number: form.pan_number.trim() || null,
        address: form.address.trim() || null,
      });
      setForm({ ...EMPTY_CREATE });
      flash(`Transporter created: ${saved?.data?.transporter_code ?? saved?.transporter_code ?? "—"}`);
      await Promise.all([transporterQuery.refetch(), companiesQuery.refetch()]);
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
        tone: "neutral",
        onClick: () => void Promise.all([transporterQuery.refetch(), companiesQuery.refetch()]),
        disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success",  message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px]">
        <ErpSectionCard eyebrow="Transporter Register" title="All transporters">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {["Code", "Name", "Direction", "GST", "Status", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No transporters found.</td></tr>}
                {rows.map((row) => {
                  const isEditing = editId === row.id;
                  const isManaging = manageId === row.id;
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
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.gst_number || "— (No GST)"}</td>
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
                            <div className="flex flex-wrap gap-1">
                              <button type="button" onClick={() => setManageId(isManaging ? null : row.id)} className="border border-indigo-400 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-900">
                                {isManaging ? "Hide" : "Manage"}
                              </button>
                              <button type="button" disabled={saving} onClick={() => void handleToggle(row)} className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${row.active ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-400 bg-emerald-50 text-emerald-900"}`}>
                                {row.active ? "Deactivate" : "Activate"}
                              </button>
                              <button type="button" disabled={saving} onClick={() => void handleDelete(row)} className="border border-rose-400 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isManaging && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50 px-3 py-3">
                            <TransporterManagePanel transporter={row} companies={companies} flash={flash} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">Click a row to edit name/direction/address. "Manage" opens Contacts, Emails and Company Mapping.</p>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Transporter" title="New transporter">
          <div className="grid gap-3">
            <div className="flex gap-2 text-xs font-semibold">
              <button type="button" onClick={() => setForm((f) => ({ ...f, gstMode: "WITH_GST" }))} className={`flex-1 border px-2 py-1.5 ${form.gstMode === "WITH_GST" ? "border-sky-600 bg-sky-100 text-sky-900" : "border-slate-300 bg-white text-slate-600"}`}>With GST</button>
              <button type="button" onClick={() => setForm((f) => ({ ...f, gstMode: "WITHOUT_GST", gst_number: "" }))} className={`flex-1 border px-2 py-1.5 ${form.gstMode === "WITHOUT_GST" ? "border-sky-600 bg-sky-100 text-sky-900" : "border-slate-300 bg-white text-slate-600"}`}>Without GST</button>
            </div>

            {form.gstMode === "WITH_GST" && (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                GST Number <span className="text-rose-500">*</span>
                <div className="flex gap-1">
                  <input value={form.gst_number} onChange={(e) => setForm((f) => ({ ...f, gst_number: e.target.value.toUpperCase() }))} placeholder="29ABCDE1234F1Z5" className="h-8 flex-1 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                  <button type="button" disabled={lookingUp} onClick={() => void handleLookup()} className="border border-sky-600 bg-sky-50 px-2 text-[11px] font-semibold text-sky-900 disabled:opacity-50">
                    {lookingUp ? "Checking..." : "Check GST"}
                  </button>
                </div>
                <span className="text-[10px] font-normal text-slate-400">Resolves legal name + address from GST and overwrites the fields below.</span>
              </label>
            )}

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
              Address
              <textarea rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="border border-slate-300 bg-[#fffef7] px-2 py-1 text-sm outline-none focus:border-sky-500" />
            </label>
            {form.gstMode === "WITHOUT_GST" && (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                PAN Number
                <input value={form.pan_number} onChange={(e) => setForm((f) => ({ ...f, pan_number: e.target.value.toUpperCase() }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
            )}
            <button type="button" disabled={saving} onClick={() => void handleCreate()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Creating..." : "Create Transporter"}
            </button>
            <p className="text-xs text-slate-400">After creating, use "Manage" on the row to add Contacts, Emails and Company Mapping.</p>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}

function TransporterManagePanel({ transporter, companies, flash }) {
  const [contacts, setContacts] = useState([]);
  const [emails, setEmails] = useState([]);
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [cRes, eRes, mRes] = await Promise.allSettled([
        listTransporterContacts(transporter.id),
        listTransporterEmails(transporter.id),
        listTransporterCompanyMaps(transporter.id),
      ]);
      setContacts(cRes.status === "fulfilled" ? (Array.isArray(cRes.value) ? cRes.value : cRes.value?.data ?? []) : []);
      setEmails(eRes.status === "fulfilled" ? (Array.isArray(eRes.value) ? eRes.value : eRes.value?.data ?? []) : []);
      setMaps(mRes.status === "fulfilled" ? (Array.isArray(mRes.value) ? mRes.value : mRes.value?.data ?? []) : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [transporter.id]);

  function updateContact(idx, patch) {
    setContacts((list) => list.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addContact() {
    setContacts((list) => [...list, { contact_name: "", phone: "", designation: "", is_primary: list.length === 0 }]);
  }
  function removeContact(idx) {
    setContacts((list) => list.filter((_, i) => i !== idx));
  }
  async function saveContacts() {
    setSaving(true);
    try {
      const saved = await saveTransporterContacts(transporter.id, contacts);
      setContacts(Array.isArray(saved) ? saved : saved?.data ?? []);
      flash(`Contacts saved for ${transporter.transporter_code}.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_CONTACTS_SAVE_FAILED", true);
    } finally { setSaving(false); }
  }

  function updateEmail(idx, patch) {
    setEmails((list) => list.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function addEmail() {
    setEmails((list) => [...list, { email: "", label: "", is_primary: list.length === 0 }]);
  }
  function removeEmail(idx) {
    setEmails((list) => list.filter((_, i) => i !== idx));
  }
  async function saveEmails() {
    setSaving(true);
    try {
      const saved = await saveTransporterEmails(transporter.id, emails);
      setEmails(Array.isArray(saved) ? saved : saved?.data ?? []);
      flash(`Emails saved for ${transporter.transporter_code}.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_EMAILS_SAVE_FAILED", true);
    } finally { setSaving(false); }
  }

  const mappedCompanyIds = new Set(maps.filter((m) => m.active).map((m) => m.company_id));
  const unmappedCompanies = companies.filter((c) => !mappedCompanyIds.has(c.id));

  async function mapCompany() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      await mapTransporterToCompany({ transporter_id: transporter.id, company_id: selectedCompanyId });
      setSelectedCompanyId("");
      await load();
      flash("Company mapped.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_COMPANY_MAP_FAILED", true);
    } finally { setSaving(false); }
  }

  async function unmapCompany(companyId) {
    setSaving(true);
    try {
      await mapTransporterToCompany({ transporter_id: transporter.id, company_id: companyId, active: false });
      await load();
      flash("Company mapping removed.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_TRANSPORTER_COMPANY_MAP_FAILED", true);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-slate-400">Loading manage panel...</div>;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-[0.07em] text-slate-600">Contacts</h4>
          <button type="button" onClick={addContact} className="border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">+ Add</button>
        </div>
        <div className="grid gap-2">
          {contacts.map((c, idx) => (
            <div key={idx} className="grid gap-1 border border-slate-100 p-2">
              <input value={c.contact_name ?? ""} onChange={(e) => updateContact(idx, { contact_name: e.target.value })} placeholder="Name" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500" />
              <input value={c.phone ?? ""} onChange={(e) => updateContact(idx, { phone: e.target.value })} placeholder="Phone" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500" />
              <input value={c.designation ?? ""} onChange={(e) => updateContact(idx, { designation: e.target.value })} placeholder="Designation" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500" />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  <input type="checkbox" checked={Boolean(c.is_primary)} onChange={(e) => updateContact(idx, { is_primary: e.target.checked })} /> Primary
                </label>
                <button type="button" onClick={() => removeContact(idx)} className="text-[11px] font-semibold text-rose-600">Remove</button>
              </div>
            </div>
          ))}
          {contacts.length === 0 && <p className="text-xs text-slate-400">No contacts yet.</p>}
        </div>
        <button type="button" disabled={saving} onClick={() => void saveContacts()} className="mt-2 w-full border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save Contacts</button>
      </div>

      <div className="border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-[0.07em] text-slate-600">Emails</h4>
          <button type="button" onClick={addEmail} className="border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">+ Add</button>
        </div>
        <div className="grid gap-2">
          {emails.map((e, idx) => (
            <div key={idx} className="grid gap-1 border border-slate-100 p-2">
              <input value={e.email ?? ""} onChange={(ev) => updateEmail(idx, { email: ev.target.value })} placeholder="Email" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500" />
              <input value={e.label ?? ""} onChange={(ev) => updateEmail(idx, { label: ev.target.value })} placeholder="Label (e.g. Billing)" className="h-7 border border-slate-300 px-2 text-xs outline-none focus:border-sky-500" />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  <input type="checkbox" checked={Boolean(e.is_primary)} onChange={(ev) => updateEmail(idx, { is_primary: ev.target.checked })} /> Primary
                </label>
                <button type="button" onClick={() => removeEmail(idx)} className="text-[11px] font-semibold text-rose-600">Remove</button>
              </div>
            </div>
          ))}
          {emails.length === 0 && <p className="text-xs text-slate-400">No emails yet.</p>}
        </div>
        <button type="button" disabled={saving} onClick={() => void saveEmails()} className="mt-2 w-full border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save Emails</button>
      </div>

      <div className="border border-slate-200 bg-white p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.07em] text-slate-600">Company Mapping</h4>
        <div className="grid gap-2">
          {maps.filter((m) => m.active).map((m) => {
            const company = companies.find((c) => c.id === m.company_id);
            return (
              <div key={m.id} className="flex items-center justify-between border border-slate-100 px-2 py-1 text-xs">
                <span>{company?.company_code ?? m.company_id} — {company?.company_name ?? "Unknown"}</span>
                <button type="button" disabled={saving} onClick={() => void unmapCompany(m.company_id)} className="text-[11px] font-semibold text-rose-600 disabled:opacity-50">Remove</button>
              </div>
            );
          })}
          {maps.filter((m) => m.active).length === 0 && <p className="text-xs text-slate-400">Not mapped to any company yet.</p>}
        </div>
        <div className="mt-2 flex gap-1">
          <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className="h-7 flex-1 border border-slate-300 px-1 text-xs outline-none">
            <option value="">Select company...</option>
            {unmappedCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>)}
          </select>
          <button type="button" disabled={saving || !selectedCompanyId} onClick={() => void mapCompany()} className="border border-sky-600 bg-sky-50 px-2 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Map</button>
        </div>
      </div>
    </div>
  );
}
