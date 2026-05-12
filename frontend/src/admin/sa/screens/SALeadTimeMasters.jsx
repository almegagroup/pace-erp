import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  listDomesticLeadTimes,
  listImportLeadTimes,
  upsertDomesticLeadTime,
  upsertImportLeadTime,
} from "../../../pages/dashboard/procurement/procurementApi.js";

export default function SALeadTimeMasters() {
  const [activeTab, setActiveTab] = useState("Import");
  const [importRows, setImportRows] = useState([]);
  const [domesticRows, setDomesticRows] = useState([]);
  const [importForm, setImportForm] = useState({
    port_id: "",
    material_category_id: "",
    lead_days: "",
  });
  const [domesticForm, setDomesticForm] = useState({
    plant_id: "",
    material_category_id: "",
    transit_days: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const [imports, domestics] = await Promise.all([
        listImportLeadTimes(),
        listDomesticLeadTimes(),
      ]);
      setImportRows(Array.isArray(imports) ? imports : []);
      setDomesticRows(Array.isArray(domestics) ? domestics : []);
    } catch (loadError) {
      setImportRows([]);
      setDomesticRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_LEAD_TIME_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleImportSave() {
    if (!importForm.port_id.trim() || !importForm.material_category_id.trim() || importForm.lead_days === "") {
      setError("Port, material category, and lead days are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await upsertImportLeadTime({
        port_id: importForm.port_id.trim(),
        material_category_id: importForm.material_category_id.trim(),
        lead_days: Number(importForm.lead_days),
      });
      setNotice("Import lead time saved.");
      setImportForm({ port_id: "", material_category_id: "", lead_days: "" });
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_IMPORT_LEAD_TIME_UPSERT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleDomesticSave() {
    if (!domesticForm.plant_id.trim() || !domesticForm.material_category_id.trim() || domesticForm.transit_days === "") {
      setError("Plant, material category, and transit days are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await upsertDomesticLeadTime({
        plant_id: domesticForm.plant_id.trim(),
        material_category_id: domesticForm.material_category_id.trim(),
        transit_days: Number(domesticForm.transit_days),
      });
      setNotice("Domestic lead time saved.");
      setDomesticForm({ plant_id: "", material_category_id: "", transit_days: "" });
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_DOMESTIC_LEAD_TIME_UPSERT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="Lead Time Masters"
      notices={[
        ...(error ? [{ key: "lead-times-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "lead-times-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
      ]}
    >
      <div className="flex gap-2">
        {["Import", "Domestic"].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`border px-3 py-2 text-sm font-semibold ${activeTab === tab ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Import" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <ErpSectionCard eyebrow="Import" title="Import lead times">
            <ErpSelectionSection label="Import Register" />
            <ErpDenseGrid
              columns={[
                { key: "port_id", label: "Port ID", render: (row) => row.port_id ?? row.port_of_discharge_id },
                { key: "material_category_id", label: "Material Category ID" },
                { key: "lead_days", label: "Lead Days", render: (row) => row.lead_days ?? row.sail_time_days ?? "—" },
              ]}
              rows={importRows}
              rowKey={(row) => row.id ?? `${row.port_id ?? row.port_of_discharge_id}:${row.material_category_id}`}
              emptyMessage={loading ? "Loading import lead times..." : "No import lead times found."}
              maxHeight="460px"
            />
          </ErpSectionCard>
          <ErpSectionCard eyebrow="Upsert" title="Import lead time form">
            <ErpSelectionSection label="Import Form" />
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Port ID
                <input value={importForm.port_id} onChange={(event) => setImportForm((current) => ({ ...current, port_id: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Material Category ID
                <input value={importForm.material_category_id} onChange={(event) => setImportForm((current) => ({ ...current, material_category_id: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Lead Days
                <input type="number" min="0" value={importForm.lead_days} onChange={(event) => setImportForm((current) => ({ ...current, lead_days: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <button type="button" disabled={saving} onClick={() => void handleImportSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? "Saving..." : "Save Import Lead Time"}
              </button>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <ErpSectionCard eyebrow="Domestic" title="Domestic lead times">
            <ErpSelectionSection label="Domestic Register" />
            <ErpDenseGrid
              columns={[
                { key: "plant_id", label: "Plant ID", render: (row) => row.plant_id ?? row.company_id },
                { key: "material_category_id", label: "Material Category ID" },
                { key: "transit_days", label: "Transit Days" },
              ]}
              rows={domesticRows}
              rowKey={(row) => row.id ?? `${row.plant_id ?? row.company_id}:${row.material_category_id}`}
              emptyMessage={loading ? "Loading domestic lead times..." : "No domestic lead times found."}
              maxHeight="460px"
            />
          </ErpSectionCard>
          <ErpSectionCard eyebrow="Upsert" title="Domestic lead time form">
            <ErpSelectionSection label="Domestic Form" />
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Plant ID
                <input value={domesticForm.plant_id} onChange={(event) => setDomesticForm((current) => ({ ...current, plant_id: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Material Category ID
                <input value={domesticForm.material_category_id} onChange={(event) => setDomesticForm((current) => ({ ...current, material_category_id: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Transit Days
                <input type="number" min="0" value={domesticForm.transit_days} onChange={(event) => setDomesticForm((current) => ({ ...current, transit_days: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <button type="button" disabled={saving} onClick={() => void handleDomesticSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? "Saving..." : "Save Domestic Lead Time"}
              </button>
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
