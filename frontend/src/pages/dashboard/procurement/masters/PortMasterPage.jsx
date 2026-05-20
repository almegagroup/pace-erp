/*
 * File-ID: 26.3
 * File-Path: frontend/src/pages/dashboard/procurement/masters/PortMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Port master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { createPort, listPorts, updatePort } from "../procurementApi.js";

const PORT_TYPE_OPTIONS = ["SEA", "AIR", "ROAD", "RAIL"];

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function buildFormState(row) {
  return {
    port_code: row?.port_code ?? "",
    port_name: row?.port_name ?? "",
    country: row?.country ?? "",
    port_type: row?.port_type ?? "SEA",
    active: row?.active ?? true,
  };
}

export default function PortMasterPage() {
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
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
      const result = await listPorts({ is_active: "" });
      const nextRows = normalizeRows(result);
      setRows(nextRows);
      if (!selectedId && nextRows[0]?.id) {
        setSelectedId(nextRows[0].id);
        setForm(buildFormState(nextRows[0]));
      }
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

  function handleSelect(row) {
    setSelectedId(row.id);
    setForm(buildFormState(row));
    setError("");
    setNotice("");
  }

  function handleNew() {
    setSelectedId("");
    setForm(buildFormState());
    setError("");
    setNotice("");
  }

  async function handleSave() {
    if (!form.port_code.trim() || !form.port_name.trim() || !form.country.trim()) {
      setError("Port code, port name, and country are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const payload = {
      port_code: form.port_code.trim(),
      port_name: form.port_name.trim(),
      country: form.country.trim(),
      port_type: form.port_type,
      active: form.active,
    };

    try {
      const saved = selectedId
        ? await updatePort(selectedId, payload)
        : await createPort(payload);
      setNotice(selectedId ? "Port updated." : "Port created.");
      await loadRows();
      if (saved?.id) {
        setSelectedId(saved.id);
        setForm(buildFormState(saved));
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PORT_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Ports"
      notices={[
        ...(error ? [{ key: "ports-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ports-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "new", label: "New", tone: "neutral", onClick: handleNew },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <ErpSectionCard eyebrow="Register" title="Port register">
          <ErpSelectionSection label="All Ports" />
          <ErpDenseGrid
            columns={[
              { key: "port_code", label: "Port Code", width: "120px" },
              { key: "port_name", label: "Port Name" },
              { key: "country", label: "Country", width: "140px" },
              { key: "port_type", label: "Type", width: "100px" },
              { key: "active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            getRowProps={(row) => ({
              onClick: () => handleSelect(row),
              className: row.id === selectedId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
            })}
            emptyMessage={loading ? "Loading ports..." : "No ports found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Form" title={selectedRow ? `Edit | ${selectedRow.port_name}` : "Create port"}>
          <ErpSelectionSection label="Port Form" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port Code
              <input
                value={form.port_code}
                onChange={(event) => setForm((current) => ({ ...current, port_code: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port Name
              <input
                value={form.port_name}
                onChange={(event) => setForm((current) => ({ ...current, port_name: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Country
              <input
                value={form.country}
                onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port Type
              <select
                value={form.port_type}
                onChange={(event) => setForm((current) => ({ ...current, port_type: event.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                {PORT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              />
              Active
            </label>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
