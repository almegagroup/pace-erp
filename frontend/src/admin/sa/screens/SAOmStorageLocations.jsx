/*
 * File-ID: 15.15
 * File-Path: frontend/src/admin/sa/screens/SAOmStorageLocations.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the SA-only storage location list and create form.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createStorageLocation, listStorageLocations, mapStorageLocationToPlant } from "../../../pages/dashboard/om/omApi.js";

export default function SAOmStorageLocations() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    location_code: "",
    location_name: "",
    location_type: "PHYSICAL",
  });
  const [assignmentForm, setAssignmentForm] = useState({
    storage_location_id: "",
    company_id: "",
    plant_id: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listStorageLocations({});
      setRows(Array.isArray(result?.data) ? result.data : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "OM_LOCATION_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleCreate() {
    if (!form.location_code.trim() || !form.location_name.trim() || !form.location_type) {
      setError("OM_LOCATION_CREATE_FAILED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createStorageLocation({
        location_code: form.location_code.trim().toUpperCase(),
        location_name: form.location_name.trim(),
        location_type: form.location_type,
      });
      setForm({ location_code: "", location_name: "", location_type: "PHYSICAL" });
      setNotice("Storage location created.");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_LOCATION_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignToPlant() {
    if (!assignmentForm.storage_location_id || !assignmentForm.company_id.trim() || !assignmentForm.plant_id.trim()) {
      setError("OM_LOCATION_MAP_FAILED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await mapStorageLocationToPlant({
        storage_location_id: assignmentForm.storage_location_id,
        company_id: assignmentForm.company_id.trim(),
        plant_id: assignmentForm.plant_id.trim(),
      });
      setAssignmentForm((current) => ({
        ...current,
        company_id: "",
        plant_id: "",
      }));
      setNotice("Storage location assigned to plant");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_SLOC_PLANT_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return rows;
    }
    return rows.filter((row) =>
      [row.code, row.name, row.location_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, search]);

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="Storage Locations"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Creating..." : "Create Location", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ErpSectionCard eyebrow="Location Register" title="All storage locations">
          <div className="grid gap-3">
            <QuickFilterInput
              label="Search Locations"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search code, name, or type"
            />
            <ErpDenseGrid
              columns={[
                { key: "code", label: "Code" },
                { key: "name", label: "Name" },
                { key: "location_type", label: "Type" },
                { key: "active", label: "Active", render: (row) => (row.active ? "YES" : "NO") },
              ]}
              rows={filteredRows}
              rowKey={(row) => row.id || row.code}
              emptyMessage={loading ? "Loading location rows..." : "No storage locations matched the current filter."}
              maxHeight="420px"
            />
            <div className="grid gap-3 border border-dashed border-slate-300 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Assign Location to Plant</div>
              <ErpDenseFormRow label="Storage Location" required>
                <select
                  value={assignmentForm.storage_location_id}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, storage_location_id: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select storage location</option>
                  {rows.map((entry) => (
                    <option key={entry.id || entry.code} value={entry.id}>
                      {entry.code} | {entry.name}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Company ID" required>
                <input
                  value={assignmentForm.company_id}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, company_id: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Plant ID" required>
                <input
                  value={assignmentForm.plant_id}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, plant_id: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <button
                type="button"
                onClick={() => void handleAssignToPlant()}
                disabled={saving}
                className="justify-self-start border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
              >
                Assign to Plant
              </button>
            </div>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Location" title="New storage location">
          <div className="grid gap-3">
            <ErpDenseFormRow label="Location Code" required>
              <input
                value={form.location_code}
                onChange={(event) => setForm((current) => ({ ...current, location_code: event.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Location Name" required>
              <input
                value={form.location_name}
                onChange={(event) => setForm((current) => ({ ...current, location_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Location Type" required>
              <select
                value={form.location_type}
                onChange={(event) => setForm((current) => ({ ...current, location_type: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="PHYSICAL">PHYSICAL</option>
                <option value="LOGICAL">LOGICAL</option>
                <option value="TRANSIT">TRANSIT</option>
              </select>
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
