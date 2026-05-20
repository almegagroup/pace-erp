/*
 * File-ID: 26.9
 * File-Path: frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: CHA master and port assignment page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  createCHA,
  listCHAs,
  listCHAPorts,
  listPorts,
  mapCHAToPort,
} from "../procurementApi.js";

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

export default function CHAMasterPage() {
  const [rows, setRows] = useState([]);
  const [ports, setPorts] = useState([]);
  const [assignedPorts, setAssignedPorts] = useState([]);
  const [selectedChaId, setSelectedChaId] = useState("");
  const [chaForm, setChaForm] = useState({
    cha_name: "",
    contact_person: "",
    contact_phone: "",
    gst_number: "",
  });
  const [portId, setPortId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedCha = useMemo(
    () => rows.find((row) => row.id === selectedChaId) ?? null,
    [rows, selectedChaId],
  );
  const portMap = useMemo(
    () => Object.fromEntries(ports.map((port) => [port.id, port])),
    [ports],
  );
  const portOptions = useMemo(
    () =>
      ports.map((port) => ({
        value: port.id,
        label: `${port.port_name ?? "Port"}${port.port_code ? ` (${port.port_code})` : ""}`,
      })),
    [ports],
  );

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const [chaResult, portResult] = await Promise.all([
        listCHAs(),
        listPorts({ is_active: "" }),
      ]);
      const nextRows = normalizeRows(chaResult);
      const nextPorts = normalizeRows(portResult);
      setRows(nextRows);
      setPorts(nextPorts);
      setSelectedChaId((current) => current || nextRows[0]?.id || "");
      setPortId((current) => current || nextPorts[0]?.id || "");
    } catch (loadError) {
      setRows([]);
      setPorts([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CHA_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  async function loadAssignments(chaId) {
    if (!chaId) {
      setAssignedPorts([]);
      return;
    }
    try {
      const result = await listCHAPorts(chaId);
      setAssignedPorts(normalizeRows(result));
    } catch (loadError) {
      setAssignedPorts([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CHA_PORT_LIST_FAILED");
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  useEffect(() => {
    void loadAssignments(selectedChaId);
  }, [selectedChaId]);

  async function handleCreateCha() {
    if (!chaForm.cha_name.trim()) {
      setError("CHA name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await createCHA({
        cha_name: chaForm.cha_name.trim(),
        contact_person: chaForm.contact_person.trim() || null,
        contact_phone: chaForm.contact_phone.trim() || null,
        gst_number: chaForm.gst_number.trim() || null,
        cha_license_number: `AUTO-${Date.now()}`,
        phone: chaForm.contact_phone.trim() || null,
      });
      setNotice("CHA created.");
      setChaForm({
        cha_name: "",
        contact_person: "",
        contact_phone: "",
        gst_number: "",
      });
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
    if (!selectedChaId || !portId) {
      setError("Select a CHA and a port before assigning.");
      return;
    }

    setMapping(true);
    setError("");
    setNotice("");
    try {
      await mapCHAToPort(selectedChaId, { port_id: portId });
      setNotice("CHA port assignment saved.");
      await loadAssignments(selectedChaId);
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : "PROCUREMENT_CHA_PORT_MAP_FAILED");
    } finally {
      setMapping(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="CHA"
      notices={[
        ...(error ? [{ key: "cha-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "cha-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Register" title="CHA register">
            <ErpSelectionSection label="Available CHAs" />
            <ErpDenseGrid
              columns={[
                { key: "cha_code", label: "CHA Code", width: "120px" },
                { key: "cha_name", label: "CHA Name" },
                { key: "contact_person", label: "Contact Person", width: "150px" },
                { key: "phone", label: "Phone", width: "140px", render: (row) => row.phone || row.contact_phone || "—" },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              getRowProps={(row) => ({
                onClick: () => setSelectedChaId(row.id),
                className: row.id === selectedChaId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
              })}
              emptyMessage={loading ? "Loading CHAs..." : "No CHAs found."}
              maxHeight="320px"
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Create" title="Create CHA">
            <ErpSelectionSection label="CHA Form" />
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                CHA Name
                <input
                  value={chaForm.cha_name}
                  onChange={(event) => setChaForm((current) => ({ ...current, cha_name: event.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Contact Person
                <input
                  value={chaForm.contact_person}
                  onChange={(event) => setChaForm((current) => ({ ...current, contact_person: event.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Contact Phone
                <input
                  value={chaForm.contact_phone}
                  onChange={(event) => setChaForm((current) => ({ ...current, contact_phone: event.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                GST Number
                <input
                  value={chaForm.gst_number}
                  onChange={(event) => setChaForm((current) => ({ ...current, gst_number: event.target.value }))}
                  className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCreateCha()}
                className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Create CHA"}
              </button>
            </div>
          </ErpSectionCard>
        </div>

        <ErpSectionCard eyebrow="Port Assignment" title={selectedCha ? `${selectedCha.cha_code || "CHA"} | ${selectedCha.cha_name}` : "Select a CHA"}>
          <ErpSelectionSection label="Assigned Ports" />
          {selectedCha ? (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Port
                  <ErpComboboxField
                    value={portId}
                    onChange={setPortId}
                    options={portOptions}
                    blankLabel="Select port"
                    inputClassName="h-8 px-2 text-sm"
                  />
                </label>
                <div className="self-end">
                  <button
                    type="button"
                    disabled={mapping}
                    onClick={() => void handleAssignPort()}
                    className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50"
                  >
                    {mapping ? "Assigning..." : "Assign Port"}
                  </button>
                </div>
              </div>

              <ErpDenseGrid
                columns={[
                  {
                    key: "port_id",
                    label: "Port",
                    render: (row) => portMap[row.port_id]?.port_name || row.port_id,
                  },
                  { key: "port_code", label: "Port Code", width: "120px", render: (row) => portMap[row.port_id]?.port_code || "—" },
                  { key: "created_at", label: "Mapped At", width: "180px", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : "—" },
                ]}
                rows={assignedPorts}
                rowKey={(row) => row.id ?? `${row.cha_id}:${row.port_id}`}
                emptyMessage="No ports assigned yet."
                maxHeight="320px"
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a CHA to manage its port assignments.</p>
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
