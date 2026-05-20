/*
 * File-ID: 26.6
 * File-Path: frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Import lead time master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  listImportLeadTimes,
  upsertImportLeadTime,
} from "../procurementApi.js";

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

export default function ImportLeadTimeMasterPage() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    port_id: "",
    material_category_id: "",
    lead_days: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listImportLeadTimes();
      setRows(normalizeRows(result));
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_IMPORT_LEAD_TIME_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleSave() {
    if (!form.port_id.trim() || !form.material_category_id.trim() || form.lead_days === "") {
      setError("Port ID, material category ID, and lead days are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await upsertImportLeadTime({
        port_id: form.port_id.trim(),
        material_category_id: form.material_category_id.trim(),
        lead_days: Number(form.lead_days),
      });
      setNotice("Import lead time saved.");
      setForm({
        port_id: "",
        material_category_id: "",
        lead_days: "",
      });
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_IMPORT_LEAD_TIME_UPSERT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Import Lead Times"
      notices={[
        ...(error ? [{ key: "import-lead-time-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "import-lead-time-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <ErpSectionCard eyebrow="Register" title="Import lead time register">
          <ErpSelectionSection label="Existing Import Lead Times" />
          <ErpDenseGrid
            columns={[
              { key: "port_id", label: "Port ID", render: (row) => row.port_id ?? row.port_of_discharge_id },
              { key: "material_category_id", label: "Material Category ID" },
              { key: "lead_days", label: "Lead Days", width: "110px", render: (row) => row.lead_days ?? row.sail_time_days ?? "—" },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? `${row.port_id ?? row.port_of_discharge_id}:${row.material_category_id}`}
            emptyMessage={loading ? "Loading import lead times..." : "No import lead times found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Upsert" title="Save import lead time">
          <ErpSelectionSection label="Import Lead Time Form" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port ID
              <input
                value={form.port_id}
                onChange={(event) => setForm((current) => ({ ...current, port_id: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Material Category ID
              <input
                value={form.material_category_id}
                onChange={(event) => setForm((current) => ({ ...current, material_category_id: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Lead Days
              <input
                type="number"
                min="0"
                value={form.lead_days}
                onChange={(event) => setForm((current) => ({ ...current, lead_days: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
