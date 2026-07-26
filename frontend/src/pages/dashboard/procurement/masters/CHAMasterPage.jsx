/*
 * File-ID: 26.9
 * File-Path: frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: CHA Master page for L2_MANAGER+ users. GST-backed autofill (every CHA is GST-registered,
 *          unlike Transporter which also allows Without-GST), multi-row Contacts/Emails, Company
 *          Mapping, and Port Assignments.
 * Authority: Frontend
 */

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import {
  createCHA,
  deleteCHA,
  listCHAs,
  listCHAPorts,
  listChaCompanyMaps,
  listChaContacts,
  listChaEmails,
  listPorts,
  lookupGstProfile,
  mapCHAToPort,
  mapChaToCompany,
  saveChaContacts,
  saveChaEmails,
  toggleCHA,
  unmapCHAPort,
  updateCHA,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";

const ERROR_MESSAGES = {
  PROCUREMENT_INVALID_CHA:          "CHA name is required.",
  PROCUREMENT_CHA_GST_REQUIRED:     "GST number is required for a CHA.",
  PROCUREMENT_DUPLICATE_CODE:       "A CHA with this code already exists.",
  PROCUREMENT_CHA_NOT_FOUND:        "CHA not found.",
  PROCUREMENT_CHA_LIST_FAILED:      "Failed to load CHAs. Please refresh.",
  PROCUREMENT_CHA_CREATE_FAILED:    "Failed to create CHA. Please try again.",
  PROCUREMENT_CHA_UPDATE_FAILED:    "Failed to update CHA. Please try again.",
  PROCUREMENT_CHA_DELETE_FAILED:    "Failed to delete CHA. Please try again.",
  PROCUREMENT_CHA_TOGGLE_FAILED:    "Failed to update CHA status. Please try again.",
  PROCUREMENT_CHA_PORT_MAP_FAILED:  "Failed to assign port. Please try again.",
  PROCUREMENT_CHA_PORT_UNMAP_FAILED:"Failed to remove port assignment. Please try again.",
  PROCUREMENT_GST_NUMBER_REQUIRED:  "Enter a GST number first.",
  MANAGER_OR_SA_REQUIRED:           "Manager or Super Admin access required.",
};

const EMPTY_CREATE = { gst_number: "", cha_name: "", cha_license_number: "", pan_number: "", address: "" };

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

const TABS = ["CHA Register", "Port Assignments"];

export default function CHAMasterPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [manageId, setManageId] = useState(null);

  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [lookingUp, setLookingUp] = useState(false);

  const [selectedChaId, setSelectedChaId] = useState("");
  const [addPortId, setAddPortId] = useState("");
  const companiesQuery = useCompaniesQuery();
  const chaQuery = useQuery({
    queryKey: ["procurement", "cha-master", "all"],
    queryFn: async () => {
      const result = await listCHAs({ is_active: "all" });
      return Array.isArray(result) ? result : result?.data ?? [];
    },
  });
  const portQuery = useQuery({
    queryKey: ["procurement", "cha-master-ports", selectedChaId || null],
    queryFn: async () => {
      const [mapped, ports] = await Promise.all([
        listCHAPorts(selectedChaId),
        listPorts({ is_active: "true", port_role: "DISCHARGE" }),
      ]);
      return {
        assignedPorts: Array.isArray(mapped) ? mapped : [],
        allPorts: Array.isArray(ports) ? ports : [],
      };
    },
    enabled: activeTab === 1 && Boolean(selectedChaId),
  });
  const rows = chaQuery.data ?? [];
  const companies = Array.isArray(companiesQuery.data) ? companiesQuery.data : [];
  const assignedPorts = portQuery.data?.assignedPorts ?? [];
  const allPorts = portQuery.data?.allPorts ?? [];
  const loading = chaQuery.isLoading || companiesQuery.isLoading;
  const portsLoading = portQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([chaQuery.refetch(), companiesQuery.refetch(), portQuery.refetch()]),
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
    if (!selectedChaId && rows.length > 0) {
      setSelectedChaId(rows[0].id);
    }
  }, [rows, selectedChaId]);

  useEffect(() => {
    const nextError =
      chaQuery.error?.message ||
      companiesQuery.error?.message ||
      portQuery.error?.message ||
      "";
    if (nextError) {
      flash(friendlyError(nextError), true);
    }
    return () => clearTimeout(noticeTimer.current);
  }, [chaQuery.error, companiesQuery.error, portQuery.error]);

  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({
      cha_name: row.cha_name ?? "",
      cha_license_number: row.cha_license_number ?? "",
      gst_number: row.gst_number ?? "",
      pan_number: row.pan_number ?? "",
      address: row.address ?? "",
    });
    setError(""); setNotice("");
  }

  function cancelEdit() { setEditId(null); setEditDraft({}); }

  async function saveEdit(row) {
    if (!editDraft.cha_name?.trim()) { flash(friendlyError("PROCUREMENT_INVALID_CHA"), true); return; }
    if (!editDraft.gst_number?.trim()) { flash(friendlyError("PROCUREMENT_CHA_GST_REQUIRED"), true); return; }
    setSaving(true);
    try {
      await updateCHA(row.id, {
        cha_name: editDraft.cha_name.trim(),
        cha_license_number: editDraft.cha_license_number?.trim() || "",
        gst_number: editDraft.gst_number.trim().toUpperCase(),
        pan_number: editDraft.pan_number?.trim() || null,
        address: editDraft.address?.trim() || null,
      });
      cancelEdit();
      flash(`CHA "${row.cha_code}" updated.`);
      await Promise.all([chaQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_UPDATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleToggle(row) {
    setSaving(true);
    try {
      await toggleCHA({ id: row.id, active: !row.active });
      if (editId === row.id) cancelEdit();
      flash(`CHA "${row.cha_code}" ${!row.active ? "activated" : "deactivated"}.`);
      await Promise.all([chaQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_TOGGLE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleDelete(row) {
    setSaving(true);
    try {
      await deleteCHA(row.id);
      flash(`CHA "${row.cha_code}" deleted.`);
      if (selectedChaId === row.id) setSelectedChaId("");
      await Promise.all([chaQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_DELETE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleLookup() {
    const gst = createForm.gst_number.trim().toUpperCase();
    if (!gst) { flash("Enter a GST number first.", true); return; }
    setLookingUp(true);
    setError("");
    try {
      const profile = await lookupGstProfile(gst);
      setCreateForm((f) => ({
        ...f,
        gst_number: gst,
        cha_name: profile.legal_name || f.cha_name,
        address: [profile.full_address, profile.state_name, profile.pin_code].filter(Boolean).join(", "),
      }));
      flash(`GST resolved (${profile.source === "CACHE" ? "from cache" : "fetched live"}). Fields overwritten — review before saving.`);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_GST_LOOKUP_FAILED"), true);
    } finally { setLookingUp(false); }
  }

  async function handleCreate() {
    if (!createForm.cha_name.trim()) { flash(friendlyError("PROCUREMENT_INVALID_CHA"), true); return; }
    if (!createForm.gst_number.trim()) { flash(friendlyError("PROCUREMENT_CHA_GST_REQUIRED"), true); return; }
    setSaving(true);
    try {
      const saved = await createCHA({
        cha_name: createForm.cha_name.trim(),
        cha_license_number: createForm.cha_license_number.trim() || "",
        gst_number: createForm.gst_number.trim().toUpperCase(),
        pan_number: createForm.pan_number.trim() || null,
        address: createForm.address.trim() || null,
      });
      setCreateForm({ ...EMPTY_CREATE });
      flash(`CHA created: ${saved?.cha_code ?? "CHA-generated"}`);
      await Promise.all([chaQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_CREATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  const assignedPortIds = new Set(assignedPorts.map((p) => p.port_id));
  const availablePorts = allPorts.filter((p) => !assignedPortIds.has(p.id));

  async function handleAssignPort() {
    if (!selectedChaId || !addPortId) return;
    setSaving(true);
    try {
      await mapCHAToPort(selectedChaId, { port_id: addPortId });
      setAddPortId("");
      flash("Port assigned.");
      await portQuery.refetch();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_PORT_MAP_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleUnmapPort(portId) {
    setSaving(true);
    try {
      await unmapCHAPort(selectedChaId, portId);
      flash("Port removed.");
      await portQuery.refetch();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_PORT_UNMAP_FAILED"), true);
    } finally { setSaving(false); }
  }

  const selectedCha = rows.find((r) => r.id === selectedChaId);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="CHA Master"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral",
        onClick: () => void Promise.all([chaQuery.refetch(), companiesQuery.refetch(), portQuery.refetch()]),
        disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success",  message: notice }] : []),
      ]}
    >
      <div className="mb-4 flex gap-0 border-b border-slate-200">
        {TABS.map((tab, i) => (
          <button
            key={tab} type="button"
            onClick={() => setActiveTab(i)}
            className={`px-5 py-2 text-sm font-semibold transition-colors ${
              activeTab === i
                ? "border-b-2 border-sky-600 text-sky-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px]">
          <ErpSectionCard eyebrow="CHA Register" title="All CHAs">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {["Code","Name","License No.","GST","Status","Actions"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No CHAs found.</td></tr>
                  )}
                  {rows.map((row) => {
                    const isEditing = editId === row.id;
                    const isManaging = manageId === row.id;
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "cursor-pointer hover:bg-slate-50"}`}
                          onClick={() => { if (!isEditing) startEdit(row); }}
                        >
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{row.cha_code}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {isEditing ? (
                              <input autoFocus value={editDraft.cha_name}
                                onChange={(e) => setEditDraft((d) => ({ ...d, cha_name: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                            ) : row.cha_name}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {isEditing ? (
                              <input value={editDraft.cha_license_number}
                                onChange={(e) => setEditDraft((d) => ({ ...d, cha_license_number: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                            ) : (row.cha_license_number || "—")}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-600">
                            {isEditing ? (
                              <input value={editDraft.gst_number}
                                onChange={(e) => setEditDraft((d) => ({ ...d, gst_number: e.target.value.toUpperCase() }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                            ) : row.gst_number}
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
                              <div className="flex flex-wrap gap-1">
                                <button type="button" onClick={() => setManageId(isManaging ? null : row.id)} className="border border-indigo-400 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-900">
                                  {isManaging ? "Hide" : "Manage"}
                                </button>
                                <button type="button" disabled={saving} onClick={() => void handleToggle(row)}
                                  className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                                    row.active ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-400 bg-emerald-50 text-emerald-900"
                                  }`}>
                                  {row.active ? "Deactivate" : "Activate"}
                                </button>
                                <button type="button" disabled={saving} onClick={() => void handleDelete(row)}
                                  className="border border-rose-400 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isEditing && (
                          <tr className="bg-sky-50">
                            <td colSpan={6} className="px-3 pb-2">
                              <label className="grid max-w-xs gap-1 text-[11px] font-semibold text-slate-600">
                                PAN Number
                                <input value={editDraft.pan_number}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, pan_number: e.target.value }))}
                                  className="h-7 border border-sky-400 bg-white px-2 text-sm outline-none" />
                              </label>
                            </td>
                          </tr>
                        )}
                        {isManaging && (
                          <tr>
                            <td colSpan={6} className="bg-slate-50 px-3 py-3">
                              <ChaManagePanel cha={row} companies={companies} flash={flash} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">Click a row to edit name/license/GST/address. "Manage" opens Contacts, Emails and Company Mapping.</p>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Create CHA" title="New CHA">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                GST Number <span className="text-rose-500">*</span>
                <div className="flex gap-1">
                  <input value={createForm.gst_number} onChange={(e) => setCreateForm((f) => ({ ...f, gst_number: e.target.value.toUpperCase() }))} placeholder="29ABCDE1234F1Z5" className="h-8 flex-1 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                  <button type="button" disabled={lookingUp} onClick={() => void handleLookup()} className="border border-sky-600 bg-sky-50 px-2 text-[11px] font-semibold text-sky-900 disabled:opacity-50">
                    {lookingUp ? "Checking..." : "Check GST"}
                  </button>
                </div>
                <span className="text-[10px] font-normal text-slate-400">Every CHA must be GST-registered. Resolves legal name + address and overwrites the fields below.</span>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                CHA Name <span className="text-rose-500">*</span>
                <input value={createForm.cha_name} onChange={(e) => setCreateForm((f) => ({ ...f, cha_name: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                License Number
                <input value={createForm.cha_license_number} onChange={(e) => setCreateForm((f) => ({ ...f, cha_license_number: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                PAN Number
                <input value={createForm.pan_number} onChange={(e) => setCreateForm((f) => ({ ...f, pan_number: e.target.value.toUpperCase() }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Address
                <textarea rows={2} value={createForm.address} onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))} className="border border-slate-300 bg-[#fffef7] px-2 py-1 text-sm outline-none focus:border-sky-500" />
              </label>
              <button type="button" disabled={saving} onClick={() => void handleCreate()}
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                {saving ? "Creating..." : "Create CHA"}
              </button>
              <p className="text-xs text-slate-400">After creating, use "Manage" on the row to add Contacts, Emails and Company Mapping.</p>
            </div>
          </ErpSectionCard>
        </div>
      )}

      {activeTab === 1 && (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="CHA Selection" title="Select CHA">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700">CHA</label>
              <select
                value={selectedChaId}
                onChange={(e) => { setSelectedChaId(e.target.value); setAddPortId(""); }}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">— Select CHA —</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>{r.cha_code} — {r.cha_name}</option>
                ))}
              </select>
            </div>
          </ErpSectionCard>

          {selectedCha && (
            <div className="grid gap-4 xl:grid-cols-2">
              <ErpSectionCard eyebrow="Assigned Ports" title={`${selectedCha.cha_code} port list`}>
                {portsLoading ? (
                  <p className="text-sm text-slate-400">Loading...</p>
                ) : assignedPorts.length === 0 ? (
                  <p className="text-sm text-slate-400">No ports assigned.</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        {["Port Code","Port Name","Type","Country",""].map((h) => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {assignedPorts.map((ap) => {
                        const pm = ap.port_master;
                        return (
                          <tr key={ap.id} className="border-b border-slate-100">
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{pm?.port_code ?? "—"}</td>
                            <td className="px-3 py-2">{pm?.port_name ?? "—"}</td>
                            <td className="px-3 py-2">
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{pm?.port_type ?? "—"}</span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">{pm?.country ?? "—"}</td>
                            <td className="px-3 py-2">
                              <button type="button" disabled={saving} onClick={() => void handleUnmapPort(ap.port_id)}
                                className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 disabled:opacity-50">
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </ErpSectionCard>

              <ErpSectionCard eyebrow="Add Port" title="Assign a port to this CHA">
                <div className="grid gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Available Ports
                    <select
                      value={addPortId}
                      onChange={(e) => setAddPortId(e.target.value)}
                      className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    >
                      <option value="">— Select port —</option>
                      {availablePorts.map((p) => (
                        <option key={p.id} value={p.id}>{p.port_code} — {p.port_name} ({p.port_type})</option>
                      ))}
                    </select>
                  </label>
                  {availablePorts.length === 0 && !portsLoading && (
                    <p className="text-xs text-slate-400">All active ports are already assigned to this CHA.</p>
                  )}
                  <button type="button" disabled={saving || !addPortId} onClick={() => void handleAssignPort()}
                    className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                    {saving ? "Assigning..." : "Assign Port"}
                  </button>
                </div>
              </ErpSectionCard>
            </div>
          )}
        </div>
      )}
    </ErpScreenScaffold>
  );
}

function ChaManagePanel({ cha, companies, flash }) {
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
        listChaContacts(cha.id),
        listChaEmails(cha.id),
        listChaCompanyMaps(cha.id),
      ]);
      setContacts(cRes.status === "fulfilled" ? (Array.isArray(cRes.value) ? cRes.value : cRes.value?.data ?? []) : []);
      setEmails(eRes.status === "fulfilled" ? (Array.isArray(eRes.value) ? eRes.value : eRes.value?.data ?? []) : []);
      setMaps(mRes.status === "fulfilled" ? (Array.isArray(mRes.value) ? mRes.value : mRes.value?.data ?? []) : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [cha.id]);

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
      const saved = await saveChaContacts(cha.id, contacts);
      setContacts(Array.isArray(saved) ? saved : saved?.data ?? []);
      flash(`Contacts saved for ${cha.cha_code}.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_CHA_CONTACTS_SAVE_FAILED", true);
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
      const saved = await saveChaEmails(cha.id, emails);
      setEmails(Array.isArray(saved) ? saved : saved?.data ?? []);
      flash(`Emails saved for ${cha.cha_code}.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_CHA_EMAILS_SAVE_FAILED", true);
    } finally { setSaving(false); }
  }

  const mappedCompanyIds = new Set(maps.filter((m) => m.active).map((m) => m.company_id));
  const unmappedCompanies = companies.filter((c) => !mappedCompanyIds.has(c.id));

  async function mapCompany() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      await mapChaToCompany({ cha_id: cha.id, company_id: selectedCompanyId });
      setSelectedCompanyId("");
      await load();
      flash("Company mapped.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_CHA_COMPANY_MAP_FAILED", true);
    } finally { setSaving(false); }
  }

  async function unmapCompany(companyId) {
    setSaving(true);
    try {
      await mapChaToCompany({ cha_id: cha.id, company_id: companyId, active: false });
      await load();
      flash("Company mapping removed.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_CHA_COMPANY_MAP_FAILED", true);
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
