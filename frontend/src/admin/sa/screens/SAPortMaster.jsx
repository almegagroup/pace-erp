import React, { useEffect, useRef, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createPort,
  deletePort,
  listPorts,
  togglePort,
  updatePort,
} from "../../../pages/dashboard/procurement/procurementApi.js";

const ERROR_MESSAGES = {
  PROCUREMENT_INVALID_PORT:        "Port name, type, and role are required.",
  PROCUREMENT_DUPLICATE_CODE:      "A port with this code already exists.",
  PROCUREMENT_PORT_IN_USE:         "Cannot remove — port is referenced. Deactivate instead.",
  PROCUREMENT_CHA_NOT_FOUND:       "Selected CHA not found.",
  MANAGER_OR_SA_REQUIRED:          "Manager or Super Admin access required.",
  PROCUREMENT_PORT_LIST_FAILED:    "Failed to load ports. Please refresh.",
  PROCUREMENT_PORT_CREATE_FAILED:  "Failed to create port. Please try again.",
  PROCUREMENT_PORT_UPDATE_FAILED:  "Failed to update port. Please try again.",
  PROCUREMENT_PORT_DELETE_FAILED:  "Failed to delete port. Please try again.",
  PROCUREMENT_PORT_TOGGLE_FAILED:  "Failed to update port status. Please try again.",
};

const PORT_TYPE_OPTIONS = ["SEA", "AIR", "LAND"];
const PORT_ROLE_LABELS = { DISCHARGE: "Discharge (Destination)", LOADING: "Loading (Origin)", BOTH: "Both" };

const EMPTY_CREATE = { port_name: "", country: "India", state: "", port_type: "SEA" };

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

function PortTab({ portRole, allRows, loading, saving, onRefresh }) {
  const rows = allRows.filter((r) => r.port_role === portRole || r.port_role === "BOTH");
  const noticeTimer = useRef(null);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ port_name: "", country: "", state: "", port_type: "SEA" });
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({ port_name: row.port_name ?? "", country: row.country ?? "", state: row.state ?? "", port_type: row.port_type ?? "SEA" });
    setError(""); setNotice("");
  }

  function cancelEdit() {
    setEditId(null);
    setEditDraft({ port_name: "", country: "", state: "", port_type: "SEA" });
  }

  async function saveEdit(row) {
    if (!editDraft.port_name.trim() || !editDraft.country.trim()) {
      flash(friendlyError("PROCUREMENT_INVALID_PORT"), true); return;
    }
    try {
      await updatePort(row.id, { port_name: editDraft.port_name.trim(), country: editDraft.country.trim(), state: editDraft.state.trim() || null, port_type: editDraft.port_type });
      cancelEdit();
      flash(`Port "${row.port_code}" updated.`);
      onRefresh();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_PORT_UPDATE_FAILED"), true);
    }
  }

  async function handleToggle(row) {
    try {
      await togglePort({ id: row.id, active: !row.active });
      if (editId === row.id) cancelEdit();
      flash(`Port "${row.port_code}" ${!row.active ? "activated" : "deactivated"}.`);
      onRefresh();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_PORT_TOGGLE_FAILED"), true);
    }
  }

  async function handleDelete(row) {
    try {
      await deletePort(row.id);
      flash(`Port "${row.port_code}" deleted.`);
      onRefresh();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_PORT_DELETE_FAILED"), true);
    }
  }

  async function handleCreate() {
    if (!createForm.port_name.trim() || !createForm.country.trim()) {
      flash(friendlyError("PROCUREMENT_INVALID_PORT"), true); return;
    }
    try {
      const saved = await createPort({ port_name: createForm.port_name.trim(), country: createForm.country.trim(), state: createForm.state.trim() || undefined, port_type: createForm.port_type, port_role: portRole === "BOTH" ? "BOTH" : portRole });
      setCreateForm({ ...EMPTY_CREATE });
      flash(`Port created: ${saved?.port_code ?? "PORT-generated"}`);
      onRefresh();
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_PORT_CREATE_FAILED"), true);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_320px]">
      {(error || notice) && (
        <div className={`col-span-full px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
          {error || notice}
        </div>
      )}
      <ErpSectionCard eyebrow={PORT_ROLE_LABELS[portRole]} title={portRole === "DISCHARGE" ? "Discharge ports (India)" : "Loading ports (Origin)"}>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Port Name</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Country</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">State</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No ports found.</td></tr>}
              {rows.map((row) => {
                const isEditing = editId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "cursor-pointer hover:bg-slate-50"}`}
                      onClick={() => { if (!isEditing) startEdit(row); }}
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{row.port_code}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900">
                        {isEditing ? (
                          <input autoFocus value={editDraft.port_name} onChange={(e) => setEditDraft((d) => ({ ...d, port_name: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                        ) : row.port_name}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <input value={editDraft.country} onChange={(e) => setEditDraft((d) => ({ ...d, country: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                        ) : (row.country || "—")}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <input value={editDraft.state} onChange={(e) => setEditDraft((d) => ({ ...d, state: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none" />
                        ) : (row.state || "—")}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select value={editDraft.port_type} onChange={(e) => setEditDraft((d) => ({ ...d, port_type: e.target.value }))} onClick={(e) => e.stopPropagation()} className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none">
                            {PORT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{row.port_type}</span>
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
        <p className="mt-2 text-xs text-slate-400">Click a row to edit. Delete is blocked if the port is referenced elsewhere.</p>
      </ErpSectionCard>

      <ErpSectionCard eyebrow="Create Port" title="New port">
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Port Code
            <input value="Auto-generated on save" disabled className="h-8 border border-slate-300 bg-slate-100 px-2 text-sm text-slate-500 outline-none" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Port Name <span className="text-rose-500">*</span>
            <input value={createForm.port_name} onChange={(e) => setCreateForm((f) => ({ ...f, port_name: e.target.value }))} placeholder={portRole === "DISCHARGE" ? "e.g. Nhava Sheva" : "e.g. Shanghai Port"} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Country <span className="text-rose-500">*</span>
            <input value={createForm.country} onChange={(e) => setCreateForm((f) => ({ ...f, country: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            State
            <input value={createForm.state} onChange={(e) => setCreateForm((f) => ({ ...f, state: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Port Type <span className="text-rose-500">*</span>
            <select value={createForm.port_type} onChange={(e) => setCreateForm((f) => ({ ...f, port_type: e.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
              {PORT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <button type="button" disabled={saving} onClick={() => void handleCreate()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
            {saving ? "Creating..." : "Create Port"}
          </button>
        </div>
      </ErpSectionCard>
    </div>
  );
}

export default function SAPortMaster() {
  const [activeTab, setActiveTab] = useState("DISCHARGE");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving] = useState(false);

  async function loadRows() {
    setLoading(true);
    try {
      const data = await listPorts({ is_active: "all" });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRows(); }, []);

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin — Procurement"
      title="Port Master"
      actions={[{ key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows(), disabled: loading }]}
    >
      <div className="flex gap-2 mb-4">
        {["DISCHARGE", "LOADING"].map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`border px-3 py-2 text-sm font-semibold ${activeTab === tab ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-300 bg-white text-slate-700"}`}>
            {tab === "DISCHARGE" ? "Discharge Ports" : "Loading Ports"}
          </button>
        ))}
      </div>
      <PortTab portRole={activeTab} allRows={rows} loading={loading} saving={saving} onRefresh={() => void loadRows()} />
    </ErpScreenScaffold>
  );
}
