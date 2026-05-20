/*
 * File-ID: 26.8
 * File-Path: frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Transporter master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  createTransporter,
  listTransporters,
  updateTransporter,
} from "../procurementApi.js";

const USAGE_DIRECTION_OPTIONS = ["IMPORT", "DOMESTIC", "BOTH"];

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function buildFormState(row) {
  return {
    transporter_name: row?.transporter_name ?? "",
    usage_direction: row?.usage_direction ?? "BOTH",
    contact_person: row?.contact_person ?? "",
    phone: row?.phone ?? "",
    gst_number: row?.gst_number ?? "",
    active: row?.active ?? true,
  };
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
      <div className="w-full max-w-xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default function TransporterMasterPage() {
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [form, setForm] = useState(buildFormState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listTransporters({ is_active: "" });
      const nextRows = normalizeRows(result);
      setRows(nextRows);
      setSelectedId((current) => current || nextRows[0]?.id || "");
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_TRANSPORTER_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  function openCreateModal() {
    setModalMode("create");
    setForm(buildFormState());
    setModalOpen(true);
  }

  function openEditModal() {
    if (!selectedRow) {
      setError("Select a transporter before editing.");
      return;
    }
    setModalMode("edit");
    setForm(buildFormState(selectedRow));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.transporter_name.trim()) {
      setError("Transporter name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const payload = {
      transporter_name: form.transporter_name.trim(),
      usage_direction: form.usage_direction,
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      gst_number: form.gst_number.trim() || null,
      active: form.active,
    };

    try {
      const saved = modalMode === "edit" && selectedRow
        ? await updateTransporter(selectedRow.id, payload)
        : await createTransporter(payload);
      setNotice(modalMode === "edit" ? "Transporter updated." : "Transporter created.");
      setModalOpen(false);
      await loadRows();
      if (saved?.id) {
        setSelectedId(saved.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_TRANSPORTER_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Transporters"
      notices={[
        ...(error ? [{ key: "transporters-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "transporters-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: "Create", tone: "primary", onClick: openCreateModal },
        { key: "edit", label: "Edit", tone: "neutral", onClick: openEditModal, disabled: !selectedRow },
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Register" title="Transporter register">
          <ErpSelectionSection label="Available Transporters" />
          <ErpDenseGrid
            columns={[
              { key: "transporter_code", label: "Code", width: "120px" },
              { key: "transporter_name", label: "Transporter Name" },
              { key: "usage_direction", label: "Usage Direction", width: "140px" },
              { key: "contact_person", label: "Contact Person", width: "160px" },
              { key: "phone", label: "Phone", width: "140px", render: (row) => row.phone || "—" },
              { key: "active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            getRowProps={(row) => ({
              onClick: () => setSelectedId(row.id),
              className: row.id === selectedId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
            })}
            emptyMessage={loading ? "Loading transporters..." : "No transporters found."}
            maxHeight="520px"
          />
        </ErpSectionCard>
      </div>

      {modalOpen ? (
        <ModalShell title={modalMode === "edit" ? "Edit Transporter" : "Create Transporter"} onClose={() => setModalOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
              Transporter Name
              <input
                value={form.transporter_name}
                onChange={(event) => setForm((current) => ({ ...current, transporter_name: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Usage Direction
              <select
                value={form.usage_direction}
                onChange={(event) => setForm((current) => ({ ...current, usage_direction: event.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                {USAGE_DIRECTION_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Contact Person
              <input
                value={form.contact_person}
                onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Phone
              <input
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              GST Number
              <input
                value={form.gst_number}
                onChange={(event) => setForm((current) => ({ ...current, gst_number: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              />
              Active
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={() => void handleSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Saving..." : modalMode === "edit" ? "Save Changes" : "Create Transporter"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </ErpScreenScaffold>
  );
}
