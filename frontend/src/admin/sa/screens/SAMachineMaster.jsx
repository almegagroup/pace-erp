/*
 * File-ID: 12B.8
 * File-Path: frontend/src/admin/sa/screens/SAMachineMaster.jsx
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: SA screen - Machine/Mixer master list and create.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createMachine, listMachines } from "../../../pages/dashboard/om/omApi.js";

const MACHINE_TYPES = ["MIXER", "FILLING", "PACKAGING", "REACTOR", "OTHER"];

export default function SAMachineMaster() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    plant_id: "",
    machine_code: "",
    machine_name: "",
    machine_type: "MIXER",
    capacity_per_batch: "",
    capacity_uom_code: "",
    description: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listMachines();
      setRows(Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "OM_MACHINE_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleCreate() {
    if (!form.plant_id.trim() || !form.machine_code.trim() || !form.machine_name.trim() || !form.machine_type) {
      setError("OM_MACHINE_CREATE_FAILED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createMachine({
        plant_id: form.plant_id.trim(),
        machine_code: form.machine_code.trim().toUpperCase(),
        machine_name: form.machine_name.trim(),
        machine_type: form.machine_type,
        capacity_per_batch: form.capacity_per_batch === "" ? null : Number(form.capacity_per_batch),
        capacity_uom_code: form.capacity_uom_code.trim().toUpperCase() || null,
        description: form.description.trim() || null,
      });
      setForm({
        plant_id: "",
        machine_code: "",
        machine_name: "",
        machine_type: "MIXER",
        capacity_per_batch: "",
        capacity_uom_code: "",
        description: "",
      });
      setNotice("Machine created.");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MACHINE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="Machine Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Creating..." : "Create Machine", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ErpSectionCard eyebrow="Machine Register" title="All machines and mixers">
          <ErpDenseGrid
            columns={[
              { key: "machine_code", label: "Code" },
              { key: "machine_name", label: "Name" },
              {
                key: "machine_type",
                label: "Type",
                render: (row) => (
                  <span className="inline-flex rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">
                    {row.machine_type}
                  </span>
                ),
              },
              {
                key: "capacity",
                label: "Capacity",
                render: (row) => row.capacity_per_batch ? `${row.capacity_per_batch} ${row.capacity_uom_code || ""}`.trim() : "—",
              },
              {
                key: "active",
                label: "Active",
                render: (row) => (
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                    {row.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                ),
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id || `${row.plant_id}:${row.machine_code}`}
            emptyMessage={loading ? "Loading machine rows..." : "No machine rows are available."}
            maxHeight="420px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Machine" title="New machine or mixer">
          <div className="grid gap-3">
            <ErpDenseFormRow label="Plant ID" required>
              <input
                value={form.plant_id}
                onChange={(event) => setForm((current) => ({ ...current, plant_id: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Machine Code" required>
              <input
                value={form.machine_code}
                onChange={(event) => setForm((current) => ({ ...current, machine_code: event.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Machine Name" required>
              <input
                value={form.machine_name}
                onChange={(event) => setForm((current) => ({ ...current, machine_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Machine Type" required>
              <select
                value={form.machine_type}
                onChange={(event) => setForm((current) => ({ ...current, machine_type: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {MACHINE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Capacity Per Batch">
              <input
                type="number"
                min="0"
                step="any"
                value={form.capacity_per_batch}
                onChange={(event) => setForm((current) => ({ ...current, capacity_per_batch: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Capacity UOM Code">
              <input
                value={form.capacity_uom_code}
                onChange={(event) => setForm((current) => ({ ...current, capacity_uom_code: event.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Description">
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[72px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
