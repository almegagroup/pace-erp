/*
 * File-ID: 15.15
 * File-Path: frontend/src/admin/sa/screens/SAOmStorageLocations.jsx
 * Gate: 15 (revised)
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Storage Locations — Tab 1: list + inline edit/toggle. Tab 2: plant assignments.
 * Authority: Frontend
 */

import { useEffect, useRef, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createStorageLocation,
  listStorageLocations,
  mapStorageLocationToPlant,
  listPlantAssignments,
  unmapStorageLocationsFromPlant,
  updateStorageLocation,
  toggleStorageLocation,
} from "../../../pages/dashboard/om/omApi.js";

const BASE = import.meta.env.VITE_API_BASE;

/* ─── friendly errors ───────────────────────────────────────────────── */
const ERROR_MESSAGES = {
  OM_LOCATION_CREATE_FAILED: "Failed to create storage location. Please try again.",
  OM_LOCATION_UPDATE_FAILED: "Failed to update storage location. Please try again.",
  OM_LOCATION_TOGGLE_FAILED: "Failed to change location status. Please try again.",
  OM_LOCATION_LIST_FAILED:   "Failed to load storage locations. Please refresh.",
  OM_LOCATION_UNMAP_FAILED:  "Failed to remove location(s) from plant. Please try again.",
  OM_SLOC_PLANT_MAP_FAILED:  "Failed to assign location to project. Please try again.",
  OM_LOCATION_EXISTS:        "A storage location with this code already exists.",
  OM_SA_REQUIRED:            "Super Admin access required.",
  OM_ADMIN_REQUIRED:         "Admin access required.",
  COMPANY_LIST_FAILED:       "Failed to load company list.",
  PLANT_LIST_FAILED:         "Failed to load project list.",
};
function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

/* ─── shared fetch helpers ──────────────────────────────────────────── */
async function readJsonSafe(res) {
  try { return await res.clone().json(); } catch { return null; }
}
async function fetchAdminList(path, dataKey, fallback) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  const json = await readJsonSafe(res);
  if (!res.ok || !json?.ok || !Array.isArray(json?.data?.[dataKey])) {
    throw new Error(json?.code ?? fallback);
  }
  return json.data[dataKey];
}

/* ─── tabs ──────────────────────────────────────────────────────────── */
const TABS = [
  { key: "locations",    label: "Locations" },
  { key: "assignments",  label: "Project Assignments" },
];

const LOCATION_TYPES = ["WAREHOUSE", "SHOP_FLOOR", "TRANSIT", "SCRAP", "EXTERNAL", "LOGICAL"];
const EMPTY_CREATE = { location_code: "", location_name: "", location_type: "WAREHOUSE" };

export default function SAOmStorageLocations() {
  const [activeTab, setActiveTab] = useState("locations");

  /* ── Tab 1 state ── */
  const [rows, setRows]         = useState([]);
  const [form, setForm]         = useState(EMPTY_CREATE);
  const [editRow, setEditRow]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toggling, setToggling] = useState(null);

  /* ── Tab 2 state ── */
  const [companies, setCompanies]           = useState([]);
  const [selCompany, setSelCompany]         = useState("");
  const [assignedRows, setAssignedRows]     = useState([]);
  const [selectedUnmap, setSelectedUnmap]   = useState(new Set());
  const [assignSelections, setAssignSelections] = useState(new Set());
  const [loadingAssign, setLoadingAssign]   = useState(false);
  const [savingAssign, setSavingAssign]     = useState(false);

  /* ── shared ── */
  const [error, setError]   = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer         = useRef(null);

  function showNotice(msg) {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }

  /* ── load storage locations ── */
  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listStorageLocations({});
      setRows(Array.isArray(result?.data) ? result.data : []);
    } catch (err) {
      setRows([]);
      setError(friendlyError(err instanceof Error ? err.message : "OM_LOCATION_LIST_FAILED"));
    } finally {
      setLoading(false);
    }
  }

  /* ── load companies (Tab 2) ── */
  async function loadMeta() {
    try {
      const cList = await fetchAdminList("/api/admin/companies", "companies", "COMPANY_LIST_FAILED");
      setCompanies(cList);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "COMPANY_LIST_FAILED"));
    }
  }

  useEffect(() => {
    void loadRows();
    void loadMeta();
    return () => clearTimeout(noticeTimer.current);
  }, []);

  /* ── Tab 1: row click ── */
  function handleRowClick(row) {
    setEditRow(row);
    const normalizedType = LOCATION_TYPES.includes(row.location_type) ? row.location_type : "WAREHOUSE";
    setForm({ location_code: row.code, location_name: row.name, location_type: normalizedType });
    setError("");
  }
  function handleCancelEdit() {
    setEditRow(null);
    setForm(EMPTY_CREATE);
    setError("");
  }

  /* ── Tab 1: create ── */
  async function handleCreate() {
    if (!form.location_code.trim() || !form.location_name.trim()) {
      setError(friendlyError("OM_LOCATION_CREATE_FAILED"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createStorageLocation({
        location_code: form.location_code.trim().toUpperCase(),
        location_name: form.location_name.trim(),
        location_type: form.location_type,
      });
      setForm(EMPTY_CREATE);
      showNotice("Storage location created.");
      await loadRows();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "OM_LOCATION_CREATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  /* ── Tab 1: update ── */
  async function handleUpdate() {
    if (!form.location_name.trim()) {
      setError("Location name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateStorageLocation({
        id: editRow.id,
        location_name: form.location_name.trim(),
        location_type: form.location_type,
      });
      showNotice(`"${editRow.code}" updated successfully.`);
      setEditRow(null);
      setForm(EMPTY_CREATE);
      await loadRows();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "OM_LOCATION_UPDATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  /* ── Tab 1: toggle ── */
  async function handleToggle(row) {
    setToggling(row.id);
    setError("");
    try {
      await toggleStorageLocation({ id: row.id, active: !row.active });
      showNotice(`"${row.code}" ${!row.active ? "activated" : "deactivated"}.`);
      if (editRow?.id === row.id) handleCancelEdit();
      await loadRows();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "OM_LOCATION_TOGGLE_FAILED"));
    } finally {
      setToggling(null);
    }
  }

  /* ── Tab 2: load assigned locations for company ── */
  async function loadAssigned(companyId) {
    if (!companyId) { setAssignedRows([]); return; }
    setLoadingAssign(true);
    setSelectedUnmap(new Set());
    setAssignSelections(new Set());
    try {
      const result = await listPlantAssignments({ company_id: companyId });
      setAssignedRows(Array.isArray(result?.data) ? result.data : []);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "OM_LOCATION_LIST_FAILED"));
      setAssignedRows([]);
    } finally {
      setLoadingAssign(false);
    }
  }

  function handleCompanyChange(companyId) {
    setSelCompany(companyId);
    setAssignedRows([]);
    setSelectedUnmap(new Set());
    setAssignSelections(new Set());
    setError("");
    if (companyId) void loadAssigned(companyId);
  }

  /* ── Tab 2: toggle unmap selection ── */
  function toggleUnmapSel(id) {
    setSelectedUnmap((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAssignSel(id) {
    setAssignSelections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /* ── Tab 2: remove selected from company ── */
  async function handleUnmap() {
    if (selectedUnmap.size === 0 || !selCompany) return;
    setSavingAssign(true);
    setError("");
    try {
      await unmapStorageLocationsFromPlant({
        storage_location_ids: [...selectedUnmap],
        company_id: selCompany,
      });
      showNotice(`${selectedUnmap.size} location(s) removed from company.`);
      await loadAssigned(selCompany);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "OM_LOCATION_UNMAP_FAILED"));
    } finally {
      setSavingAssign(false);
    }
  }

  /* ── Tab 2: assign selected locations to company ── */
  async function handleAssign() {
    if (assignSelections.size === 0 || !selCompany) return;
    setSavingAssign(true);
    setError("");
    try {
      await Promise.all(
        [...assignSelections].map((locId) =>
          mapStorageLocationToPlant({
            storage_location_id: locId,
            company_id: selCompany,
          })
        )
      );
      showNotice(`${assignSelections.size} location(s) assigned to company.`);
      setAssignSelections(new Set());
      await loadAssigned(selCompany);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "OM_SLOC_PLANT_MAP_FAILED"));
    } finally {
      setSavingAssign(false);
    }
  }

  /* ── derived ── */
  const isEditMode = editRow !== null;
  const assignedIds = new Set(assignedRows.map((r) => r.id));
  const unassignedRows = rows.filter((r) => !assignedIds.has(r.id) && r.active);

  /* ── Tab button class ── */
  const tabCls = (key) =>
    `-mb-px border-b-2 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
      activeTab === key
        ? "border-sky-600 text-sky-700"
        : "border-transparent text-slate-400 hover:text-slate-600"
    }`;

  /* ── actions ── */
  const tab1Actions = [
    { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
    ...(isEditMode
      ? [
          { key: "cancel", label: "Cancel Edit",                   tone: "neutral", onClick: handleCancelEdit },
          { key: "save",   label: saving ? "Saving..." : "Save Changes", tone: "primary", onClick: () => void handleUpdate(), disabled: saving },
        ]
      : [
          { key: "create", label: saving ? "Creating..." : "Create Location", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
        ]
    ),
  ];

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="Storage Locations"
      actions={activeTab === "locations" ? tab1Actions : [
        { key: "refresh", label: "Refresh", tone: "neutral", onClick: () => { void loadRows(); void loadMeta(); } },
      ]}
      notices={[
        ...(error  ? [{ key: "error",  tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      {/* ── Tabs ── */}
      <div className="flex border-b border-slate-200 mb-4">
        {TABS.map((tab) => (
          <button key={tab.key} type="button" className={tabCls(tab.key)} onClick={() => { setActiveTab(tab.key); setError(""); }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════ TAB 1 — LOCATIONS ══════════════════ */}
      {activeTab === "locations" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          {/* List */}
          <ErpSectionCard eyebrow="Location Register" title="All storage locations">
            <ErpDenseGrid
              columns={[
                { key: "code", label: "Code" },
                { key: "name", label: "Name" },
                { key: "location_type", label: "Type" },
                {
                  key: "active",
                  label: "Active",
                  render: (row) => (
                    <span className={`text-xs font-medium ${row.active ? "text-emerald-700" : "text-slate-400"}`}>
                      {row.active ? "YES" : "NO"}
                    </span>
                  ),
                },
                {
                  key: "_toggle",
                  label: "",
                  render: (row) => (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleToggle(row); }}
                      disabled={toggling === row.id}
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        row.active
                          ? "bg-red-50 text-red-600 hover:bg-red-100"
                          : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      } disabled:opacity-50`}
                    >
                      {toggling === row.id ? "..." : row.active ? "Deactivate" : "Activate"}
                    </button>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id || row.code}
              onRowActivate={(row) => handleRowClick(row)}
              getRowProps={(row) => ({
                onClick: () => handleRowClick(row),
                className: editRow?.id === row.id
                  ? "cursor-pointer bg-sky-50 border-l-2 border-l-sky-500"
                  : "cursor-pointer hover:bg-slate-50",
              })}
              emptyMessage={loading ? "Loading locations..." : "No storage locations found."}
              maxHeight="460px"
            />
            {!isEditMode && (
              <p className="mt-2 text-xs text-slate-400">Click a row to edit.</p>
            )}
          </ErpSectionCard>

          {/* Create / Edit form */}
          <ErpSectionCard
            eyebrow={isEditMode ? `Editing — ${editRow.code}` : "Create Location"}
            title={isEditMode ? "Edit storage location" : "New storage location"}
          >
            <div className="grid gap-3">
              <ErpDenseFormRow label="Location Code" required>
                <input
                  value={form.location_code}
                  onChange={(e) => !isEditMode && setForm((f) => ({ ...f, location_code: e.target.value.toUpperCase() }))}
                  readOnly={isEditMode}
                  className={`h-8 w-full border px-2 text-sm text-slate-900 outline-none focus:border-sky-500 ${
                    isEditMode
                      ? "border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed"
                      : "border-slate-300 bg-[#fffef7]"
                  }`}
                  placeholder="e.g. S001"
                />
                {isEditMode && (
                  <p className="mt-1 text-xs text-slate-400">Code cannot be changed.</p>
                )}
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Location Name" required>
                <input
                  value={form.location_name}
                  onChange={(e) => setForm((f) => ({ ...f, location_name: e.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  placeholder="e.g. Main Warehouse"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Location Type" required>
                <select
                  value={form.location_type}
                  onChange={(e) => setForm((f) => ({ ...f, location_type: e.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {LOCATION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </ErpDenseFormRow>
            </div>
          </ErpSectionCard>
        </div>
      )}

      {/* ══════════════════ TAB 2 — PLANT ASSIGNMENTS ══════════════════ */}
      {activeTab === "assignments" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Left — filter + assigned */}
          <ErpSectionCard eyebrow="Select Scope" title="Company">
            <div className="grid gap-3">
              <ErpDenseFormRow label="Company" required>
                <select
                  value={selCompany}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">— select company —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_code} | {c.company_name}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
            </div>

            {selCompany && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Assigned Locations
                  </span>
                  {selectedUnmap.size > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleUnmap()}
                      disabled={savingAssign}
                      className="border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {savingAssign ? "Removing..." : `Remove ${selectedUnmap.size} selected`}
                    </button>
                  )}
                </div>
                {loadingAssign ? (
                  <p className="text-xs text-slate-400 py-2">Loading...</p>
                ) : assignedRows.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">No locations assigned to this company yet.</p>
                ) : (
                  <div className="border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {assignedRows.map((row) => (
                      <label
                        key={row.id}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUnmap.has(row.id)}
                          onChange={() => toggleUnmapSel(row.id)}
                          className="accent-red-500"
                        />
                        <span className="text-xs font-mono text-slate-700">{row.code}</span>
                        <span className="text-xs text-slate-500 truncate">{row.name}</span>
                        <span className={`ml-auto text-[10px] font-medium px-1 rounded ${
                          row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"
                        }`}>
                          {row.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {assignedRows.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">Check rows to remove, then click Remove.</p>
                )}
              </div>
            )}
          </ErpSectionCard>

          {/* Right — assign new locations */}
          <ErpSectionCard eyebrow="Assign Locations" title="Add to company">
            {!selCompany ? (
              <p className="text-xs text-slate-400">Select a company first.</p>
            ) : unassignedRows.length === 0 ? (
              <p className="text-xs text-slate-400">All active locations are already assigned to this company.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-slate-500">
                  Select one or more locations to assign to this company.
                </p>
                <div className="border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto mb-3">
                  {unassignedRows.map((row) => (
                    <label
                      key={row.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={assignSelections.has(row.id)}
                        onChange={() => toggleAssignSel(row.id)}
                        className="accent-sky-600"
                      />
                      <span className="text-xs font-mono text-slate-700">{row.code}</span>
                      <span className="text-xs text-slate-500 truncate">{row.name}</span>
                      <span className="ml-auto text-[10px] text-slate-400">{row.location_type}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void handleAssign()}
                  disabled={savingAssign || assignSelections.size === 0}
                  className="border border-sky-300 bg-sky-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                >
                  {savingAssign ? "Assigning..." : `Assign ${assignSelections.size > 0 ? `(${assignSelections.size})` : ""}`}
                </button>
              </>
            )}
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
