import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createTransporter,
  listTransporters,
  updateTransporter,
} from "../../../pages/dashboard/procurement/procurementApi.js";

const DIRECTION_OPTIONS = ["IMPORT", "DOMESTIC", "BOTH"];

function buildFormState(row) {
  return {
    name: row?.name ?? row?.transporter_name ?? "",
    direction: row?.direction ?? row?.usage_direction ?? "BOTH",
    contact_person: row?.contact_person ?? "",
    contact_phone: row?.contact_phone ?? row?.phone ?? "",
    gst_number: row?.gst_number ?? "",
    is_active: row?.active ?? true,
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

export default function SATransporterMaster() {
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
    [rows, selectedId]
  );

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const data = await listTransporters({ is_active: "" });
      const nextRows = Array.isArray(data) ? data : [];
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
    if (!form.name.trim()) {
      setError("Transporter name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      let saved;
      const payload = {
        transporter_name: form.name.trim(),
        usage_direction: form.direction,
        contact_person: form.contact_person.trim() || null,
        phone: form.contact_phone.trim() || null,
        gst_number: form.gst_number.trim() || null,
        active: form.is_active,
      };
      if (modalMode === "edit" && selectedRow) {
        saved = await updateTransporter(selectedRow.id, payload);
        setNotice(`Transporter updated: ${saved?.transporter_code ?? selectedRow.transporter_code}`);
      } else {
        saved = await createTransporter(payload);
        setNotice(`Transporter created: ${saved?.transporter_code ?? "TRN-generated"}`);
      }
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
      eyebrow="Super Admin Procurement"
      title="Transporter Master"
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <ErpSectionCard eyebrow="Register" title="Transporter register">
          <ErpSelectionSection label="Available Transporters" />
          <ErpDenseGrid
            columns={[
              { key: "transporter_code", label: "Code", width: "120px" },
              { key: "name", label: "Name", render: (row) => row.name || row.transporter_name },
              { key: "direction", label: "Direction", width: "100px", render: (row) => row.direction || row.usage_direction },
              { key: "contact_person", label: "Contact Person", width: "140px" },
              { key: "contact_phone", label: "Contact Phone", width: "130px", render: (row) => row.contact_phone || row.phone || "—" },
              { key: "is_active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? row.transporter_code}
            getRowProps={(row) => ({
              onClick: () => setSelectedId(row.id),
              className: row.id === selectedId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
            })}
            emptyMessage={loading ? "Loading transporters..." : "No transporters found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Selection" title={selectedRow ? `${selectedRow.transporter_code} | ${selectedRow.name || selectedRow.transporter_name}` : "Choose transporter"}>
          {selectedRow ? (
            <div className="grid gap-2 text-[12px] text-slate-700">
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Direction</span>
                <strong>{selectedRow.direction || selectedRow.usage_direction || "—"}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Contact Person</span>
                <strong>{selectedRow.contact_person || "—"}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Contact Phone</span>
                <strong>{selectedRow.contact_phone || selectedRow.phone || "—"}</strong>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>GST Number</span>
                <strong>{selectedRow.gst_number || "—"}</strong>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a transporter from the register to inspect it.</p>
          )}
        </ErpSectionCard>
      </div>

      {modalOpen ? (
        <ModalShell title={modalMode === "edit" ? "Edit Transporter" : "Create Transporter"} onClose={() => setModalOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Name
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Direction
              <select value={form.direction} onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                {DIRECTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Contact Person
              <input value={form.contact_person} onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Contact Phone
              <input value={form.contact_phone} onChange={(event) => setForm((current) => ({ ...current, contact_phone: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
              GST Number
              <input value={form.gst_number} onChange={(event) => setForm((current) => ({ ...current, gst_number: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
              Active
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={() => void handleSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving..." : modalMode === "edit" ? "Save Changes" : "Create Transporter"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </ErpScreenScaffold>
  );
}
