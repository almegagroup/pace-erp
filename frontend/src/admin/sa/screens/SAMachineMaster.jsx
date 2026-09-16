/*
 * File-ID: 12B.8
 * File-Path: frontend/src/admin/sa/screens/SAMachineMaster.jsx
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: SA screen - Machine master list, inline edit, active toggle, create.
 * Authority: Frontend
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createMachine,
  listMachines,
  updateMachine,
  toggleMachine,
  listPlantAssignments,
} from "../../../pages/dashboard/om/omApi.js";
import { useAdminCompaniesQuery } from "../../../hooks/queries/useAdminMasterQueries.js";
import { useCostCentersQuery, useUomsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
const MACHINE_TYPES = ["MIXER", "FILLING", "PACKAGING", "REACTOR", "OTHER"];
// Only the Process PO types that actually require a machine assignment
// (process_order.handlers.ts's own REQUIRED_MACHINE_TYPES) -- MTEST never
// shows a Machine field on Process PO Create at all, so it's excluded here.
const MACHINE_PO_TYPES = ["MTO", "HPS", "MTS", "INT"];

const ERROR_LABELS = {
  OM_MACHINE_LIST_FAILED:   "Failed to load machines.",
  OM_MACHINE_CREATE_FAILED: "Could not create machine. Check required fields.",
  OM_MACHINE_UPDATE_FAILED: "Could not save changes.",
  OM_MACHINE_TOGGLE_FAILED: "Could not change active status.",
  OM_MACHINE_EXISTS:        "A machine with this code already exists in this company.",
  OM_MACHINE_PO_TYPE_SAVE_FAILED: "Could not save PO Types for this machine.",
  OM_MACHINE_STORAGE_LOCATION_INVALID: "Storage location does not belong to this company.",
  OM_LOCATION_LIST_FAILED:  "Failed to load storage locations.",
  COMPANY_LIST_FAILED:      "Failed to load company list.",
  CC_LIST_FAILED:           "Failed to load cost centers.",
};

function label(code) {
  return ERROR_LABELS[code] || code;
}

export default function SAMachineMaster() {
  const [activeTab, setActiveTab] = useState("register");
  const [filterCompany, setFilterCompany] = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [notice, setNotice]       = useState("");
  const queryClient = useQueryClient();
  const {
    data: rows = [],
    isLoading: machinesLoading,
    refetch: refetchMachines,
  } = useQuery({
    queryKey: ["admin", "machines"],
    queryFn: () => listMachines(),
    select: (result) => (Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : []),
  });
  const {
    data: companies = [],
    isLoading: companiesLoading,
    refetch: refetchCompanies,
  } = useAdminCompaniesQuery();
  const {
    data: costCenters = [],
    isLoading: costCentersLoading,
    refetch: refetchCostCenters,
  } = useCostCentersQuery({}, {
    select: (result) => (Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : []),
  });
  const {
    data: uoms = [],
    isLoading: uomsLoading,
    refetch: refetchUoms,
  } = useUomsQuery({ is_active: "true" }, {
    select: (result) => (Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : []),
  });
  const loading = machinesLoading || companiesLoading || costCentersLoading || uomsLoading;

  // ── Sloc Mapping tab ───────────────────────────────────────────
  const [slocCompany, setSlocCompany] = useState("");
  const [slocDrafts, setSlocDrafts]   = useState({}); // machine_id -> pending storage_location_id
  const [slocSavingId, setSlocSavingId] = useState(null);
  const {
    data: slocLocations = [],
    isLoading: slocLocationsLoading,
  } = useQuery({
    queryKey: ["om", "plant-assignments", slocCompany],
    queryFn: () => listPlantAssignments({ company_id: slocCompany }),
    enabled: Boolean(slocCompany),
    select: (result) => (Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : []),
  });
  const slocMachines = slocCompany ? rows.filter((r) => r.company_id === slocCompany) : [];

  function slocDraftFor(machine) {
    return Object.prototype.hasOwnProperty.call(slocDrafts, machine.id)
      ? slocDrafts[machine.id]
      : (machine.storage_location_id ?? "");
  }

  async function saveSlocMapping(machine) {
    const nextLocationId = slocDraftFor(machine) || null;
    setSlocSavingId(machine.id);
    setError("");
    setNotice("");
    try {
      await updateMachine({
        id: machine.id,
        machine_name: machine.machine_name,
        machine_type: machine.machine_type,
        capacity_per_batch: machine.capacity_per_batch ?? null,
        capacity_uom_code: machine.capacity_uom_code ?? null,
        cost_center_id: machine.cost_center_id ?? null,
        description: machine.description ?? null,
        storage_location_id: nextLocationId,
      });
      setNotice(`${machine.machine_code} storage location updated.`);
      setSlocDrafts((d) => {
        const next = { ...d };
        delete next[machine.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "machines"] });
      await refetchMachines();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MACHINE_UPDATE_FAILED"));
    } finally {
      setSlocSavingId(null);
    }
  }

  // inline edit
  const [editId, setEditId]       = useState(null);
  const [editDraft, setEditDraft] = useState({});

  // create form
  const [form, setForm] = useState({
    company_id: "",
    machine_code: "",
    machine_name: "",
    machine_type: "MIXER",
    capacity_per_batch: "",
    capacity_uom_code: "",
    cost_center_id: "",
    description: "",
    po_types: [],
  });

  function togglePoType(list, poType) {
    return list.includes(poType) ? list.filter((t) => t !== poType) : [...list, poType];
  }

  async function refreshData() {
    setError("");
    const results = await Promise.all([
      refetchMachines(),
      refetchCompanies(),
      refetchCostCenters(),
      refetchUoms(),
    ]);
    const nextError = results.find((result) => result.error)?.error;
    if (nextError) {
      setError(label(nextError instanceof Error ? nextError.message : "OM_MACHINE_LIST_FAILED"));
    }
  }

  // ── inline edit ────────────────────────────────────────────────
  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({
      machine_name: row.machine_name,
      machine_type: row.machine_type,
      capacity_per_batch: row.capacity_per_batch ?? "",
      capacity_uom_code: row.capacity_uom_code ?? "",
      cost_center_id: row.cost_center_id ?? "",
      description: row.description ?? "",
      po_types: row.po_types ?? [],
    });
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditId(null);
    setEditDraft({});
  }

  async function saveEdit(row) {
    if (!editDraft.machine_name?.trim() || !editDraft.machine_type) {
      setError("Machine name and type are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateMachine({
        id: row.id,
        machine_name: editDraft.machine_name.trim(),
        machine_type: editDraft.machine_type,
        capacity_per_batch: editDraft.capacity_per_batch === "" ? null : Number(editDraft.capacity_per_batch),
        capacity_uom_code: editDraft.capacity_uom_code?.trim().toUpperCase() || null,
        cost_center_id: editDraft.cost_center_id || null,
        description: editDraft.description?.trim() || null,
        po_types: editDraft.po_types ?? [],
      });
      setNotice("Machine updated.");
      setEditId(null);
      setEditDraft({});
      await queryClient.invalidateQueries({ queryKey: ["admin", "machines"] });
      await refreshData();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MACHINE_UPDATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  // ── toggle ─────────────────────────────────────────────────────
  async function handleToggle(row) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await toggleMachine({ id: row.id, active: !row.active });
      setNotice(`Machine ${!row.active ? "activated" : "deactivated"}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "machines"] });
      await refreshData();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MACHINE_TOGGLE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  // ── create ─────────────────────────────────────────────────────
  async function handleCreate() {
    if (!form.company_id || !form.machine_code.trim() || !form.machine_name.trim() || !form.machine_type) {
      setError("Company, code, name, and type are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createMachine({
        company_id: form.company_id,
        machine_code: form.machine_code.trim().toUpperCase(),
        machine_name: form.machine_name.trim(),
        machine_type: form.machine_type,
        capacity_per_batch: form.capacity_per_batch === "" ? null : Number(form.capacity_per_batch),
        capacity_uom_code: form.capacity_uom_code.trim().toUpperCase() || null,
        cost_center_id: form.cost_center_id || null,
        description: form.description.trim() || null,
        po_types: form.po_types,
      });
      setForm((f) => ({ ...f, machine_code: "", machine_name: "", capacity_per_batch: "", capacity_uom_code: "", cost_center_id: "", description: "", po_types: [] }));
      setNotice("Machine created.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "machines"] });
      await refreshData();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MACHINE_CREATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const displayRows = filterCompany
    ? rows.filter((r) => r.company_id === filterCompany)
    : rows;

  // cost centers filtered by selected company (for edit draft or create form)
  const ccsForCompany = (companyId) =>
    costCenters.filter((cc) => cc.company_id === companyId && cc.active !== false);

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin — Operation Management"
      title="Machine Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void refreshData(), disabled: loading },
      ]}
      notices={[
        ...(error  ? [{ key: "error",  tone: "error",   message: label(error)  }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {[
          { key: "register", label: "Machine Register" },
          { key: "sloc", label: "Storage Location Mapping" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-sky-600 text-sky-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "sloc" && (
        <ErpSectionCard eyebrow="§138.1 — MTS machine-respect stock foundation" title="Machine ↔ Storage Location mapping">
          <p className="mb-3 text-xs text-slate-500">
            প্রতিটা Machine ঠিক একটাই Storage Location-এ mapped থাকতে পারে (পরে re-map করা যায়)।
            এই mapping MTS Process PO Create-এর Machine dropdown filter করতে ব্যবহৃত হবে।
          </p>
          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Company</label>
            <select
              value={slocCompany}
              onChange={(e) => setSlocCompany(e.target.value)}
              className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">— select company —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
              ))}
            </select>
          </div>

          {!slocCompany && (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Company বেছে নিন machine list দেখতে।</p>
          )}

          {slocCompany && (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Storage Location</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(machinesLoading || slocLocationsLoading) && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                  )}
                  {!machinesLoading && !slocLocationsLoading && slocMachines.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">এই company-তে কোনো machine নেই।</td></tr>
                  )}
                  {slocMachines.map((machine) => {
                    const draftValue = slocDraftFor(machine);
                    const isDirty = draftValue !== (machine.storage_location_id ?? "");
                    return (
                      <tr key={machine.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-mono text-slate-900 whitespace-nowrap">{machine.machine_code}</td>
                        <td className="px-3 py-2 text-slate-900">{machine.machine_name}</td>
                        <td className="px-3 py-2">
                          <select
                            value={draftValue}
                            onChange={(e) => setSlocDrafts((d) => ({ ...d, [machine.id]: e.target.value }))}
                            className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                          >
                            <option value="">— not mapped —</option>
                            {slocLocations.map((loc) => (
                              <option key={loc.id} value={loc.id}>{loc.code} — {loc.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={!isDirty || slocSavingId === machine.id}
                            onClick={() => void saveSlocMapping(machine)}
                            className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {slocSavingId === machine.id ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      )}

      {activeTab === "register" && (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_380px]">
        {/* ── Left: list ── */}
        <ErpSectionCard eyebrow="Machine Register" title="All machines">
          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Filter by Company</label>
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">— All Companies —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Company</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">PO Types</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Storage Location</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Capacity</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Cost Center</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                )}
                {!loading && displayRows.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-400">No machines found.</td></tr>
                )}
                {displayRows.map((row) => {
                  const isEditing = editId === row.id;
                  const comp = companyMap.get(row.company_id);
                  const editCcs = isEditing ? ccsForCompany(row.company_id) : [];
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "hover:bg-slate-50 cursor-pointer"}`}
                        onClick={() => { if (!isEditing) startEdit(row); }}
                      >
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {comp ? comp.company_code : row.company_id?.slice(0, 8) || "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-900 whitespace-nowrap">{row.machine_code}</td>
                        <td className="px-3 py-2 text-slate-900">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editDraft.machine_name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, machine_name: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none"
                            />
                          ) : row.machine_name}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <select
                              value={editDraft.machine_type}
                              onChange={(e) => setEditDraft((d) => ({ ...d, machine_type: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none"
                            >
                              {MACHINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          ) : (
                            <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                              {row.machine_type}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2" onClick={(e) => isEditing && e.stopPropagation()}>
                          {isEditing ? (
                            <div className="flex flex-wrap gap-2">
                              {MACHINE_PO_TYPES.map((t) => (
                                <label key={t} className="flex items-center gap-1 text-[11px] font-medium text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={editDraft.po_types.includes(t)}
                                    onChange={() => setEditDraft((d) => ({ ...d, po_types: togglePoType(d.po_types, t) }))}
                                  />
                                  {t}
                                </label>
                              ))}
                            </div>
                          ) : (row.po_types ?? []).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.po_types.map((t) => (
                                <span key={t} className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{t}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400" title="Not configured yet -- shows for every PO type until set">All (unconfigured)</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {row.storage_location
                            ? `${row.storage_location.code} — ${row.storage_location.name}`
                            : <span className="text-xs text-slate-400" title="Map from the Storage Location Mapping tab">— not mapped —</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {isEditing ? (
                            <div className="flex gap-1">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editDraft.capacity_per_batch}
                                onChange={(e) => setEditDraft((d) => ({ ...d, capacity_per_batch: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="qty"
                                className="h-7 w-20 border border-sky-400 bg-white px-1 text-sm outline-none"
                              />
                              <select
                                value={editDraft.capacity_uom_code}
                                onChange={(e) => setEditDraft((d) => ({ ...d, capacity_uom_code: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none"
                              >
                                <option value="">—</option>
                                {uoms.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                              </select>
                            </div>
                          ) : (
                            row.capacity_per_batch
                              ? `${row.capacity_per_batch} ${row.capacity_uom_code || ""}`.trim()
                              : "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {isEditing ? (
                            <select
                              value={editDraft.cost_center_id}
                              onChange={(e) => setEditDraft((d) => ({ ...d, cost_center_id: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 border border-sky-400 bg-white px-1 text-sm outline-none"
                            >
                              <option value="">— none —</option>
                              {editCcs.map((cc) => (
                                <option key={cc.id} value={cc.id}>{cc.cost_center_code}</option>
                              ))}
                            </select>
                          ) : (
                            row.cost_center?.cost_center_code || "—"
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
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void saveEdit(row)}
                                className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleToggle(row)}
                              className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                                row.active
                                  ? "border-rose-300 bg-rose-50 text-rose-800"
                                  : "border-emerald-400 bg-emerald-50 text-emerald-900"
                              }`}
                            >
                              {row.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-sky-50">
                          <td colSpan={10} className="px-3 pb-2">
                            <label className="text-[11px] font-semibold text-slate-600">Description</label>
                            <input
                              value={editDraft.description}
                              onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                              className="mt-0.5 h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none"
                            />
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

        {/* ── Right: create form ── */}
        <ErpSectionCard eyebrow="Create Machine" title="New machine">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Company <span className="text-rose-500">*</span>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value, cost_center_id: "" }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">— select company —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Machine Code <span className="text-rose-500">*</span>
              <input
                value={form.machine_code}
                onChange={(e) => setForm((f) => ({ ...f, machine_code: e.target.value.toUpperCase() }))}
                placeholder="e.g. MXR-001"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Machine Name <span className="text-rose-500">*</span>
              <input
                value={form.machine_name}
                onChange={(e) => setForm((f) => ({ ...f, machine_name: e.target.value }))}
                placeholder="e.g. Mixer 500L"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Machine Type <span className="text-rose-500">*</span>
              <select
                value={form.machine_type}
                onChange={(e) => setForm((f) => ({ ...f, machine_type: e.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              >
                {MACHINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <div className="grid gap-1 text-xs font-semibold text-slate-700">
              PO Types
              <div className="flex flex-wrap gap-3 rounded border border-slate-300 bg-[#fffef7] px-2 py-1.5">
                {MACHINE_PO_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1 text-xs font-normal text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.po_types.includes(t)}
                      onChange={() => setForm((f) => ({ ...f, po_types: togglePoType(f.po_types, t) }))}
                    />
                    {t}
                  </label>
                ))}
              </div>
              <p className="text-[11px] font-normal text-slate-400">Which Process PO type(s) this machine may be used for. Leave unchecked to allow every type until you decide (Process PO Create won't filter it out).</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Capacity
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.capacity_per_batch}
                  onChange={(e) => setForm((f) => ({ ...f, capacity_per_batch: e.target.value }))}
                  placeholder="e.g. 500"
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                UOM
                <select
                  value={form.capacity_uom_code}
                  onChange={(e) => setForm((f) => ({ ...f, capacity_uom_code: e.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                >
                  <option value="">— none —</option>
                  {uoms.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Cost Center
              <select
                value={form.cost_center_id}
                onChange={(e) => setForm((f) => ({ ...f, cost_center_id: e.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                disabled={!form.company_id}
              >
                <option value="">— none —</option>
                {ccsForCompany(form.company_id).map((cc) => (
                  <option key={cc.id} value={cc.id}>{cc.cost_center_code} — {cc.cost_center_name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Description
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="border border-slate-300 bg-[#fffef7] px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="mt-1 border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Machine"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
      )}
    </ErpScreenScaffold>
  );
}
