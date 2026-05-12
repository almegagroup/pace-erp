import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  listPorts,
  listTransitTimes,
  upsertTransitTime,
} from "../../../pages/dashboard/procurement/procurementApi.js";

export default function SAPortTransitMaster() {
  const [rows, setRows] = useState([]);
  const [ports, setPorts] = useState([]);
  const [form, setForm] = useState({
    port_id: "",
    plant_id: "",
    transit_days: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const portOptions = useMemo(
    () =>
      ports.map((port) => ({
        value: port.id,
        label: `${port.port_name ?? "Port"}${port.port_code ? ` (${port.port_code})` : ""}`,
      })),
    [ports]
  );

  const portMap = useMemo(
    () => Object.fromEntries(ports.map((port) => [port.id, port])),
    [ports]
  );

  async function loadScreenData() {
    setLoading(true);
    setError("");
    try {
      const [transitData, portData] = await Promise.all([
        listTransitTimes(),
        listPorts({ is_active: "" }),
      ]);
      setRows(Array.isArray(transitData) ? transitData : []);
      const nextPorts = Array.isArray(portData) ? portData : [];
      setPorts(nextPorts);
      setForm((current) => ({
        ...current,
        port_id: current.port_id || nextPorts[0]?.id || "",
      }));
    } catch (loadError) {
      setRows([]);
      setPorts([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_TRANSIT_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadScreenData();
  }, []);

  async function handleUpsert() {
    if (!form.port_id || !form.plant_id.trim() || form.transit_days === "") {
      setError("Port, plant, and transit days are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await upsertTransitTime({
        port_id: form.port_id,
        plant_id: form.plant_id.trim(),
        transit_days: Number(form.transit_days),
      });
      setNotice("Transit time saved.");
      setForm((current) => ({
        ...current,
        plant_id: "",
        transit_days: "",
      }));
      await loadScreenData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_TRANSIT_UPSERT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="Port Transit Master"
      notices={[
        ...(error ? [{ key: "port-transit-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "port-transit-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadScreenData() },
        { key: "upsert", label: saving ? "Saving..." : "Save Transit", tone: "primary", onClick: () => void handleUpsert(), disabled: saving },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <ErpSectionCard eyebrow="Register" title="Transit time register">
          <ErpSelectionSection label="Port Transit Rows" />
          <ErpDenseGrid
            columns={[
              {
                key: "port_name",
                label: "Port",
                render: (row) => row.port_name || portMap[row.port_id]?.port_name || row.port_id,
              },
              { key: "plant_id", label: "Plant ID", width: "180px", render: (row) => row.company_id || row.plant_id },
              { key: "transit_days", label: "Transit Days", width: "110px" },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? `${row.port_id}:${row.company_id ?? row.plant_id}`}
            emptyMessage={loading ? "Loading transit times..." : "No transit rows found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Upsert" title="Save port transit time">
          <ErpSelectionSection label="Transit Form" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port ID
              <ErpComboboxField
                value={form.port_id}
                onChange={(value) => setForm((current) => ({ ...current, port_id: value }))}
                options={portOptions}
                blankLabel="Select port"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Plant ID
              <input value={form.plant_id} onChange={(event) => setForm((current) => ({ ...current, plant_id: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Transit Days
              <input type="number" min="0" value={form.transit_days} onChange={(event) => setForm((current) => ({ ...current, transit_days: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
