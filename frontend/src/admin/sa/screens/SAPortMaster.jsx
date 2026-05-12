import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createPort, listPorts, updatePort } from "../../../pages/dashboard/procurement/procurementApi.js";

const PORT_TYPE_OPTIONS = ["SEA", "AIR", "ROAD", "RAIL"];

function buildFormState(row) {
  return {
    port_code: row?.port_code ?? "",
    port_name: row?.port_name ?? "",
    country: row?.country ?? "",
    port_type: row?.port_type ?? "SEA",
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

export default function SAPortMaster() {
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
      const data = await listPorts({ is_active: "" });
      const nextRows = Array.isArray(data) ? data : [];
      setRows(nextRows);
      setSelectedId((current) => current || nextRows[0]?.id || "");
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PORT_LIST_FAILED");
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
      setError("Select a port before editing.");
      return;
    }
    setModalMode("edit");
    setForm(buildFormState(selectedRow));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.port_name.trim() || !form.country.trim()) {
      setError("Port name and country are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      let saved;
      const payload = {
        port_code: form.port_code.trim() || undefined,
        port_name: form.port_name.trim(),
        country: form.country.trim(),
        port_type: form.port_type,
        active: form.is_active,
      };
      if (modalMode === "edit" && selectedRow) {
        saved = await updatePort(selectedRow.id, payload);
        setNotice(`Port updated: ${saved?.port_code ?? selectedRow.port_code}`);
      } else {
        saved = await createPort(payload);
        setNotice(`Port created: ${saved?.port_code ?? "PORT-generated"}`);
      }
      setModalOpen(false);
      await loadRows();
      if (saved?.id) {
        setSelectedId(saved.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PORT_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="Port Master"
      notices={[
        ...(error ? [{ key: "ports-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ports-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: "Create", tone: "primary", onClick: openCreateModal },
        { key: "edit", label: "Edit", tone: "neutral", onClick: openEditModal, disabled: !selectedRow },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <ErpSectionCard eyebrow="Register" title="Port register">
          <ErpSelectionSection label="All Ports" />
          <ErpDenseGrid
            columns={[
              { key: "port_code", label: "Port Code", width: "120px" },
              { key: "port_name", label: "Port Name" },
              { key: "country", label: "Country", width: "120px" },
              { key: "is_active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? row.port_code}
            getRowProps={(row) => ({
              onClick: () => setSelectedId(row.id),
              className: row.id === selectedId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
            })}
            emptyMessage={loading ? "Loading ports..." : "No ports found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Selection" title={selectedRow ? `${selectedRow.port_code} | ${selectedRow.port_name}` : "Choose port"}>
          {selectedRow ? (
            <div className="grid gap-2 text-[12px] text-slate-700">
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Country</span>
                <strong>{selectedRow.country || "—"}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Port Type</span>
                <strong>{selectedRow.port_type || "—"}</strong>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Active</span>
                <strong>{selectedRow.active ? "YES" : "NO"}</strong>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a port from the register to inspect it.</p>
          )}
        </ErpSectionCard>
      </div>

      {modalOpen ? (
        <ModalShell title={modalMode === "edit" ? "Edit Port" : "Create Port"} onClose={() => setModalOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port Code
              <input value={form.port_code} onChange={(event) => setForm((current) => ({ ...current, port_code: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port Name
              <input value={form.port_name} onChange={(event) => setForm((current) => ({ ...current, port_name: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Country
              <input value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port Type
              <select value={form.port_type} onChange={(event) => setForm((current) => ({ ...current, port_type: event.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                {PORT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
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
              {saving ? "Saving..." : modalMode === "edit" ? "Save Changes" : "Create Port"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </ErpScreenScaffold>
  );
}
