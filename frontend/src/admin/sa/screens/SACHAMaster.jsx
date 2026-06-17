import React, { useEffect, useRef, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createCHA,
  deleteCHA,
  listCHAs,
  listCHAPorts,
  listPorts,
  mapCHAToPort,
  toggleCHA,
  unmapCHAPort,
  updateCHA,
} from "../../../pages/dashboard/procurement/procurementApi.js";

const ERROR_MESSAGES = {
  PROCUREMENT_INVALID_CHA:          "CHA name is required.",
  PROCUREMENT_DUPLICATE_CODE:       "A CHA with this code already exists.",
  PROCUREMENT_CHA_NOT_FOUND:        "CHA not found.",
  PROCUREMENT_CHA_LIST_FAILED:      "Failed to load CHAs. Please refresh.",
  PROCUREMENT_CHA_CREATE_FAILED:    "Failed to create CHA. Please try again.",
  PROCUREMENT_CHA_UPDATE_FAILED:    "Failed to update CHA. Please try again.",
  PROCUREMENT_CHA_DELETE_FAILED:    "Failed to delete CHA. Please try again.",
  PROCUREMENT_CHA_TOGGLE_FAILED:    "Failed to update CHA status. Please try again.",
  PROCUREMENT_CHA_PORT_MAP_FAILED:  "Failed to assign port. Please try again.",
  PROCUREMENT_CHA_PORT_UNMAP_FAILED:"Failed to remove port assignment. Please try again.",
  MANAGER_OR_SA_REQUIRED:           "Manager or Super Admin access required.",
};

const EMPTY_CREATE = { cha_name: "", cha_license_number: "", contact_person: "", phone: "", email: "", gst_number: "", pan_number: "", address: "" };

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

const TABS = ["CHA Register", "Port Assignments"];

export default function SACHAMaster() {
  const [activeTab, setActiveTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  // Inline edit state
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  // Create form
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);

  // Port assignments tab state
  const [selectedChaId, setSelectedChaId] = useState("");
  const [assignedPorts, setAssignedPorts] = useState([]);
  const [allPorts, setAllPorts] = useState([]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [addPortId, setAddPortId] = useState("");

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const data = await listCHAs({ is_active: "all" });
      const next = Array.isArray(data) ? data : [];
      setRows(next);
      if (!selectedChaId && next.length > 0) setSelectedChaId(next[0].id);
    } catch (err) {
      setRows([]);
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_LIST_FAILED"), true);
    } finally { setLoading(false); }
  }

  async function loadPortData(chaId) {
    if (!chaId) return;
    setPortsLoading(true);
    try {
      const [mapped, ports] = await Promise.all([
        listCHAPorts(chaId),
        listPorts({ is_active: "true" }),
      ]);
      setAssignedPorts(Array.isArray(mapped) ? mapped : []);
      setAllPorts(Array.isArray(ports) ? ports : []);
    } catch {
      setAssignedPorts([]);
    } finally { setPortsLoading(false); }
  }

  useEffect(() => {
    void loadRows();
    return () => clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (activeTab === 1 && selectedChaId) {
      void loadPortData(selectedChaId);
    }
  }, [activeTab, selectedChaId]);

  // ── Tab 1: Inline edit ─────────────────────────────────────────
  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({
      cha_name: row.cha_name ?? "",
      cha_license_number: row.cha_license_number ?? "",
      contact_person: row.contact_person ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      gst_number: row.gst_number ?? "",
      pan_number: row.pan_number ?? "",
    });
    setError(""); setNotice("");
  }

  function cancelEdit() { setEditId(null); setEditDraft({}); }

  async function saveEdit(row) {
    if (!editDraft.cha_name?.trim()) { flash(friendlyError("PROCUREMENT_INVALID_CHA"), true); return; }
    setSaving(true);
    try {
      await updateCHA(row.id, {
        cha_name: editDraft.cha_name.trim(),
        cha_license_number: editDraft.cha_license_number?.trim() || "",
        contact_person: editDraft.contact_person?.trim() || null,
        phone: editDraft.phone?.trim() || null,
        email: editDraft.email?.trim() || null,
        gst_number: editDraft.gst_number?.trim() || null,
        pan_number: editDraft.pan_number?.trim() || null,
      });
      cancelEdit();
      flash(`CHA "${row.cha_code}" updated.`);
      await loadRows();
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
      await loadRows();
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
      await loadRows();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_DELETE_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleCreate() {
    if (!createForm.cha_name.trim()) { flash(friendlyError("PROCUREMENT_INVALID_CHA"), true); return; }
    setSaving(true);
    try {
      const saved = await createCHA({
        cha_name: createForm.cha_name.trim(),
        cha_license_number: createForm.cha_license_number.trim() || "",
        contact_person: createForm.contact_person.trim() || null,
        phone: createForm.phone.trim() || null,
        email: createForm.email.trim() || null,
        gst_number: createForm.gst_number.trim() || null,
        pan_number: createForm.pan_number.trim() || null,
        address: createForm.address.trim() || null,
      });
      setCreateForm(EMPTY_CREATE);
      flash(`CHA created: ${saved?.cha_code ?? "CHA-generated"}`);
      await loadRows();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_CREATE_FAILED"), true);
    } finally { setSaving(false); }
  }

  // ── Tab 2: Port assignments ────────────────────────────────────
  const assignedPortIds = new Set(assignedPorts.map((p) => p.port_id));
  const availablePorts = allPorts.filter((p) => !assignedPortIds.has(p.id));

  async function handleAssignPort() {
    if (!selectedChaId || !addPortId) return;
    setSaving(true);
    try {
      await mapCHAToPort(selectedChaId, { port_id: addPortId });
      setAddPortId("");
      flash("Port assigned.");
      await loadPortData(selectedChaId);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_PORT_MAP_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleUnmapPort(portId) {
    setSaving(true);
    try {
      await unmapCHAPort(selectedChaId, portId);
      flash("Port removed.");
      await loadPortData(selectedChaId);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_CHA_PORT_UNMAP_FAILED"), true);
    } finally { setSaving(false); }
  }

  const selectedCha = rows.find((r) => r.id === selectedChaId);

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin — Procurement"
      title="CHA Master"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral", onClick: () => void loadRows(), disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success",  message: notice }] : []),
      ]}
    >
      {/* Tabs */}
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

      {/* ── Tab 1: CHA Register ───────────────────────────────── */}
      {activeTab === 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_300px]">
          <ErpSectionCard eyebrow="CHA Register" title="All CHAs">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {["Code","Name","License No.","Contact Person","Phone","Status","Actions"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No CHAs found.</td></tr>
                  )}
                  {rows.map((row) => {
                    const isEditing = editId === row.id;
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
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input value={editDraft.contact_person}
                                onChange={(e) => setEditDraft((d) => ({ ...d, contact_person: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                            ) : (row.contact_person || "—")}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input value={editDraft.phone}
                                onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                            ) : (row.phone || "—")}
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
                            <td colSpan={7} className="px-3 pb-2">
                              <div className="grid grid-cols-3 gap-2">
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
                                  Email
                                  <input value={editDraft.email}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))}
                                    className="h-7 border border-sky-400 bg-white px-2 text-sm outline-none" />
                                </label>
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
                                  GST Number
                                  <input value={editDraft.gst_number}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, gst_number: e.target.value }))}
                                    className="h-7 border border-sky-400 bg-white px-2 text-sm outline-none" />
                                </label>
                                <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
                                  PAN Number
                                  <input value={editDraft.pan_number}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, pan_number: e.target.value }))}
                                    className="h-7 border border-sky-400 bg-white px-2 text-sm outline-none" />
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
            <p className="mt-2 text-xs text-slate-400">Click a row to edit. Extra fields (Email, GST, PAN) appear below the row when editing.</p>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Create CHA" title="New CHA">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                CHA Code
                <input value="Auto-generated on save" disabled className="h-8 border border-slate-300 bg-slate-100 px-2 text-sm text-slate-500 outline-none" />
              </label>
              {[
                { key: "cha_name",           label: "CHA Name",        required: true  },
                { key: "cha_license_number", label: "License Number",  required: false },
                { key: "contact_person",     label: "Contact Person",  required: false },
                { key: "phone",              label: "Phone",           required: false },
                { key: "email",              label: "Email",           required: false },
                { key: "gst_number",         label: "GST Number",      required: false },
                { key: "pan_number",         label: "PAN Number",      required: false },
              ].map(({ key, label, required }) => (
                <label key={key} className="grid gap-1 text-xs font-semibold text-slate-700">
                  {label} {required && <span className="text-rose-500">*</span>}
                  <input
                    value={createForm[key]}
                    onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
              ))}
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Address
                <textarea
                  value={createForm.address}
                  onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  rows={2}
                  className="border border-slate-300 bg-[#fffef7] px-2 py-1 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <button type="button" disabled={saving} onClick={() => void handleCreate()}
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                {saving ? "Creating..." : "Create CHA"}
              </button>
            </div>
          </ErpSectionCard>
        </div>
      )}

      {/* ── Tab 2: Port Assignments ───────────────────────────── */}
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
