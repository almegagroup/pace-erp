import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createCHA,
  listCHAs,
  listCHAPorts,
  mapCHAToPort,
} from "../../../pages/dashboard/procurement/procurementApi.js";

function buildFormState(row) {
  return {
    name: row?.name ?? row?.cha_name ?? "",
    contact_person: row?.contact_person ?? "",
    contact_phone: row?.contact_phone ?? row?.phone ?? "",
    gst_number: row?.gst_number ?? "",
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

export default function SACHAMaster() {
  const [rows, setRows] = useState([]);
  const [selectedChaId, setSelectedChaId] = useState("");
  const [assignedPorts, setAssignedPorts] = useState([]);
  const [portId, setPortId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(buildFormState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedCha = useMemo(
    () => rows.find((row) => row.id === selectedChaId) ?? null,
    [rows, selectedChaId]
  );

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const data = await listCHAs({ is_active: "" });
      const nextRows = Array.isArray(data) ? data : [];
      setRows(nextRows);
      setSelectedChaId((current) => current || nextRows[0]?.id || "");
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CHA_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  async function loadPortAssignments(chaId) {
    if (!chaId) {
      setAssignedPorts([]);
      return;
    }
    try {
      const data = await listCHAPorts(chaId);
      setAssignedPorts(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setAssignedPorts([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CHA_PORT_LIST_FAILED");
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  useEffect(() => {
    void loadPortAssignments(selectedChaId);
  }, [selectedChaId]);

  async function handleCreate() {
    if (!form.name.trim()) {
      setError("CHA name is required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await createCHA({
        cha_name: form.name.trim(),
        cha_license_number: `AUTO-${Date.now()}`,
        contact_person: form.contact_person.trim() || null,
        phone: form.contact_phone.trim() || null,
        gst_number: form.gst_number.trim() || null,
      });
      setModalOpen(false);
      setForm(buildFormState());
      setNotice(`CHA created: ${saved?.cha_code ?? "CHA-generated"}`);
      await loadRows();
      if (saved?.id) {
        setSelectedChaId(saved.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CHA_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignPort() {
    if (!selectedChaId || !portId.trim()) {
      setError("Select a CHA and provide a port ID before assigning.");
      return;
    }
    setMapping(true);
    setError("");
    setNotice("");
    try {
      await mapCHAToPort(selectedChaId, { port_id: portId.trim() });
      setPortId("");
      setNotice("CHA port assignment saved.");
      await loadPortAssignments(selectedChaId);
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : "PROCUREMENT_CHA_PORT_MAP_FAILED");
    } finally {
      setMapping(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="CHA Master"
      notices={[
        ...(error ? [{ key: "cha-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "cha-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: "Create", tone: "primary", onClick: () => setModalOpen(true) },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Register" title="CHA register">
            <ErpSelectionSection label="Available CHAs" />
            <ErpDenseGrid
              columns={[
                { key: "cha_code", label: "CHA Code", width: "120px" },
                { key: "name", label: "Name", render: (row) => row.name || row.cha_name },
                { key: "contact_person", label: "Contact Person", width: "140px" },
                { key: "contact_phone", label: "Contact Phone", width: "130px", render: (row) => row.contact_phone || row.phone || "—" },
                { key: "is_active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
              ]}
              rows={rows}
              rowKey={(row) => row.id ?? row.cha_code}
              getRowProps={(row) => ({
                onClick: () => setSelectedChaId(row.id),
                className: row.id === selectedChaId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
              })}
              emptyMessage={loading ? "Loading CHAs..." : "No CHAs found."}
              maxHeight="360px"
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Port Assignments" title={selectedCha ? `${selectedCha.cha_code} | ${selectedCha.name || selectedCha.cha_name}` : "Select a CHA"}>
            <ErpSelectionSection label="Port Assignments" />
            {selectedCha ? (
              <div className="grid gap-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Port ID
                    <input value={portId} onChange={(event) => setPortId(event.target.value)} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                  </label>
                  <div className="self-end">
                    <button type="button" disabled={mapping} onClick={() => void handleAssignPort()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                      {mapping ? "Assigning..." : "Assign Port"}
                    </button>
                  </div>
                </div>
                <ErpDenseGrid
                  columns={[
                    { key: "port_id", label: "Port ID" },
                    { key: "created_at", label: "Mapped At", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : "—" },
                  ]}
                  rows={assignedPorts}
                  rowKey={(row) => row.id ?? `${row.cha_id}:${row.port_id}`}
                  emptyMessage="No ports assigned yet."
                  maxHeight="220px"
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a CHA to view and manage Port Assignments.</p>
            )}
          </ErpSectionCard>
        </div>

        <ErpSectionCard eyebrow="Selection" title={selectedCha ? `${selectedCha.cha_code} | ${selectedCha.name || selectedCha.cha_name}` : "Choose CHA"}>
          {selectedCha ? (
            <div className="grid gap-2 text-[12px] text-slate-700">
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Contact Person</span>
                <strong>{selectedCha.contact_person || "—"}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Contact Phone</span>
                <strong>{selectedCha.contact_phone || selectedCha.phone || "—"}</strong>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>GST Number</span>
                <strong>{selectedCha.gst_number || "—"}</strong>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a CHA from the register to inspect it.</p>
          )}
        </ErpSectionCard>
      </div>

      {modalOpen ? (
        <ModalShell title="Create CHA" onClose={() => setModalOpen(false)}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Name
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Contact Person
              <input value={form.contact_person} onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Contact Phone
              <input value={form.contact_phone} onChange={(event) => setForm((current) => ({ ...current, contact_phone: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              GST Number
              <input value={form.gst_number} onChange={(event) => setForm((current) => ({ ...current, gst_number: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={() => void handleCreate()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving..." : "Create CHA"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </ErpScreenScaffold>
  );
}
