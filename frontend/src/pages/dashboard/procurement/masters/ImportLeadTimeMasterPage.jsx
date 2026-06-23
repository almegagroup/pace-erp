/*
 * File-ID: 26.6
 * File-Path: frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: Lead Time Masters page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useRef, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  deleteImportLeadTime,
  deleteDomesticLeadTime,
  listCompanies,
  listImportLeadTimes,
  listDomesticLeadTimes,
  listPorts,
  updateImportLeadTime,
  updateDomesticLeadTime,
  upsertImportLeadTime,
  upsertDomesticLeadTime,
} from "../procurementApi.js";
import { listVendors } from "../../om/omApi.js";

const EMPTY_IMPORT = { vendor_id: "", port_of_discharge_id: "", sail_time_days: "", clearance_days: "", effective_from: "", effective_to: "" };
const EMPTY_DOMESTIC = { vendor_id: "", company_id: "", transit_days: "", effective_from: "", effective_to: "" };

export default function ImportLeadTimeMasterPage() {
  const [activeTab, setActiveTab] = useState("Import");
  const noticeTimer = useRef(null);

  const [importVendors, setImportVendors] = useState([]);
  const [domesticVendors, setDomesticVendors] = useState([]);
  const [dischargePorts, setDischargePorts] = useState([]);
  const [companies, setCompanies] = useState([]);

  const [importRows, setImportRows] = useState([]);
  const [importForm, setImportForm] = useState(EMPTY_IMPORT);
  const [editingImportId, setEditingImportId] = useState(null);

  const [domesticRows, setDomesticRows] = useState([]);
  const [domesticForm, setDomesticForm] = useState(EMPTY_DOMESTIC);
  const [editingDomesticId, setEditingDomesticId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  async function loadMasterData() {
    const [ivRes, dvRes, pRes, coRes] = await Promise.allSettled([
      listVendors({ status: "ACTIVE", vendor_type: "IMPORT" }),
      listVendors({ status: "ACTIVE", vendor_type: "DOMESTIC" }),
      listPorts({ is_active: "true", port_role: "DISCHARGE" }),
      listCompanies(),
    ]);
    if (ivRes.status === "fulfilled") {
      const v = ivRes.value;
      setImportVendors(Array.isArray(v) ? v : (v?.data ?? []));
    }
    if (dvRes.status === "fulfilled") {
      const v = dvRes.value;
      setDomesticVendors(Array.isArray(v) ? v : (v?.data ?? []));
    }
    if (pRes.status === "fulfilled") setDischargePorts(Array.isArray(pRes.value) ? pRes.value : []);
    if (coRes.status === "fulfilled") {
      const v = coRes.value;
      setCompanies(Array.isArray(v) ? v : (v?.data ?? []));
    }
  }

  async function loadRows() {
    setLoading(true);
    try {
      const [imports, domestics] = await Promise.all([
        listImportLeadTimes({ is_active: "all" }),
        listDomesticLeadTimes({ is_active: "all" }),
      ]);
      setImportRows(Array.isArray(imports) ? imports : []);
      setDomesticRows(Array.isArray(domestics) ? domestics : []);
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_LEAD_TIME_LIST_FAILED", true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadMasterData(), loadRows()]);
    return () => clearTimeout(noticeTimer.current);
  }, []);

  async function handleImportSave() {
    if (!importForm.vendor_id || !importForm.port_of_discharge_id || importForm.sail_time_days === "" || importForm.clearance_days === "" || !importForm.effective_from) {
      flash("All fields except Effective To are required.", true); return;
    }
    setSaving(true);
    try {
      const payload = {
        vendor_id: importForm.vendor_id,
        port_of_discharge_id: importForm.port_of_discharge_id,
        sail_time_days: Number(importForm.sail_time_days),
        clearance_days: Number(importForm.clearance_days),
        effective_from: importForm.effective_from,
        effective_to: importForm.effective_to || null,
      };
      if (editingImportId) {
        await updateImportLeadTime(editingImportId, payload);
        flash("Import lead time updated.");
      } else {
        await upsertImportLeadTime(payload);
        flash("Import lead time saved.");
      }
      setImportForm(EMPTY_IMPORT);
      setEditingImportId(null);
      await loadRows();
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_IMPORT_LEAD_TIME_UPSERT_FAILED", true);
    } finally { setSaving(false); }
  }

  function handleImportEdit(row) {
    setEditingImportId(row.id);
    setImportForm({
      vendor_id: row.vendor_id ?? "",
      port_of_discharge_id: row.port_of_discharge_id ?? "",
      sail_time_days: String(row.sail_time_days ?? ""),
      clearance_days: String(row.clearance_days ?? ""),
      effective_from: row.effective_from ?? "",
      effective_to: row.effective_to ?? "",
    });
  }

  function handleImportCancelEdit() {
    setEditingImportId(null);
    setImportForm(EMPTY_IMPORT);
  }

  async function handleImportDelete(id) {
    setSaving(true);
    try {
      await deleteImportLeadTime(id);
      flash("Import lead time deleted.");
      if (editingImportId === id) handleImportCancelEdit();
      await loadRows();
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_IMPORT_LEAD_TIME_DELETE_FAILED", true);
    } finally { setSaving(false); }
  }

  async function handleDomesticSave() {
    if (!domesticForm.vendor_id || !domesticForm.company_id || domesticForm.transit_days === "" || !domesticForm.effective_from) {
      flash("All fields except Effective To are required.", true); return;
    }
    setSaving(true);
    try {
      const payload = {
        vendor_id: domesticForm.vendor_id,
        company_id: domesticForm.company_id,
        transit_days: Number(domesticForm.transit_days),
        effective_from: domesticForm.effective_from,
        effective_to: domesticForm.effective_to || null,
      };
      if (editingDomesticId) {
        await updateDomesticLeadTime(editingDomesticId, payload);
        flash("Domestic lead time updated.");
      } else {
        await upsertDomesticLeadTime(payload);
        flash("Domestic lead time saved.");
      }
      setDomesticForm(EMPTY_DOMESTIC);
      setEditingDomesticId(null);
      await loadRows();
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_DOMESTIC_LEAD_TIME_UPSERT_FAILED", true);
    } finally { setSaving(false); }
  }

  function handleDomesticEdit(row) {
    setEditingDomesticId(row.id);
    setDomesticForm({
      vendor_id: row.vendor_id ?? "",
      company_id: row.company_id ?? "",
      transit_days: String(row.transit_days ?? ""),
      effective_from: row.effective_from ?? "",
      effective_to: row.effective_to ?? "",
    });
  }

  function handleDomesticCancelEdit() {
    setEditingDomesticId(null);
    setDomesticForm(EMPTY_DOMESTIC);
  }

  async function handleDomesticDelete(id) {
    setSaving(true);
    try {
      await deleteDomesticLeadTime(id);
      flash("Domestic lead time deleted.");
      if (editingDomesticId === id) handleDomesticCancelEdit();
      await loadRows();
    } catch (err) {
      flash(err instanceof Error ? err.message : "PROCUREMENT_DOMESTIC_LEAD_TIME_DELETE_FAILED", true);
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Lead Time Masters"
      notices={[
        ...(error ? [{ key: "err", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ok", tone: "success", message: notice }] : []),
      ]}
      actions={[{ key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows(), disabled: loading }]}
    >
      <div className="flex gap-2 mb-4">
        {["Import", "Domestic"].map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`border px-3 py-2 text-sm font-semibold ${activeTab === tab ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-300 bg-white text-slate-700"}`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Import" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_340px]">
          <ErpSectionCard eyebrow="Import" title="Import lead times">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Vendor</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Discharge Port</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Sail Days</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Clearance Days</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Eff. From</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Eff. To</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
                  {!loading && importRows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">No import lead times found.</td></tr>}
                  {importRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono font-semibold text-slate-800">{row.vendor?.vendor_code ?? "—"}</span>
                        <span className="ml-1 text-slate-500">{row.vendor?.vendor_name}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono font-semibold text-slate-800">{row.port?.port_code ?? "—"}</span>
                        <span className="ml-1 text-slate-500">{row.port?.port_name}</span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold">{row.sail_time_days}</td>
                      <td className="px-3 py-2 text-center font-semibold">{row.clearance_days}</td>
                      <td className="px-3 py-2 text-xs">{row.effective_from}</td>
                      <td className="px-3 py-2 text-xs">{row.effective_to ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                          {row.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-3 py-2 flex gap-1">
                        <button type="button" disabled={saving} onClick={() => handleImportEdit(row)} className="border border-sky-400 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 disabled:opacity-50">Edit</button>
                        <button type="button" disabled={saving} onClick={() => void handleImportDelete(row.id)} className="border border-rose-400 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow={editingImportId ? "Edit" : "Add"} title={editingImportId ? "Edit import lead time" : "New import lead time"}>
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Vendor <span className="text-rose-500">*</span>
                <select value={importForm.vendor_id} onChange={(e) => setImportForm((f) => ({ ...f, vendor_id: e.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                  <option value="">— Select Vendor —</option>
                  {importVendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_code} — {v.vendor_name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Port of Discharge <span className="text-rose-500">*</span>
                <select value={importForm.port_of_discharge_id} onChange={(e) => setImportForm((f) => ({ ...f, port_of_discharge_id: e.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                  <option value="">— Select Port —</option>
                  {dischargePorts.map((p) => <option key={p.id} value={p.id}>{p.port_code} — {p.port_name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Sail Days <span className="text-rose-500">*</span>
                  <input type="number" min="0" value={importForm.sail_time_days} onChange={(e) => setImportForm((f) => ({ ...f, sail_time_days: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Clearance Days <span className="text-rose-500">*</span>
                  <input type="number" min="0" value={importForm.clearance_days} onChange={(e) => setImportForm((f) => ({ ...f, clearance_days: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Effective From <span className="text-rose-500">*</span>
                  <input type="date" value={importForm.effective_from} onChange={(e) => setImportForm((f) => ({ ...f, effective_from: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Effective To
                  <input type="date" value={importForm.effective_to} onChange={(e) => setImportForm((f) => ({ ...f, effective_to: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void handleImportSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                  {saving ? "Saving..." : editingImportId ? "Update Import Lead Time" : "Save Import Lead Time"}
                </button>
                {editingImportId ? (
                  <button type="button" disabled={saving} onClick={handleImportCancelEdit} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </ErpSectionCard>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_340px]">
          <ErpSectionCard eyebrow="Domestic" title="Domestic lead times">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Vendor</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Company</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Transit Days</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Eff. From</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Eff. To</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>}
                  {!loading && domesticRows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No domestic lead times found.</td></tr>}
                  {domesticRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono font-semibold text-slate-800">{row.vendor?.vendor_code ?? "—"}</span>
                        <span className="ml-1 text-slate-500">{row.vendor?.vendor_name}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono font-semibold text-slate-800">{row.company?.company_code ?? "—"}</span>
                        <span className="ml-1 text-slate-500">{row.company?.company_name}</span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold">{row.transit_days}</td>
                      <td className="px-3 py-2 text-xs">{row.effective_from}</td>
                      <td className="px-3 py-2 text-xs">{row.effective_to ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                          {row.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-3 py-2 flex gap-1">
                        <button type="button" disabled={saving} onClick={() => handleDomesticEdit(row)} className="border border-sky-400 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 disabled:opacity-50">Edit</button>
                        <button type="button" disabled={saving} onClick={() => void handleDomesticDelete(row.id)} className="border border-rose-400 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow={editingDomesticId ? "Edit" : "Add"} title={editingDomesticId ? "Edit domestic lead time" : "New domestic lead time"}>
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Vendor <span className="text-rose-500">*</span>
                <select value={domesticForm.vendor_id} onChange={(e) => setDomesticForm((f) => ({ ...f, vendor_id: e.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                  <option value="">— Select Vendor —</option>
                  {domesticVendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_code} — {v.vendor_name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Company <span className="text-rose-500">*</span>
                <select value={domesticForm.company_id} onChange={(e) => setDomesticForm((f) => ({ ...f, company_id: e.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                  <option value="">— Select Company —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Transit Days <span className="text-rose-500">*</span>
                <input type="number" min="0" value={domesticForm.transit_days} onChange={(e) => setDomesticForm((f) => ({ ...f, transit_days: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Effective From <span className="text-rose-500">*</span>
                  <input type="date" value={domesticForm.effective_from} onChange={(e) => setDomesticForm((f) => ({ ...f, effective_from: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Effective To
                  <input type="date" value={domesticForm.effective_to} onChange={(e) => setDomesticForm((f) => ({ ...f, effective_to: e.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void handleDomesticSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                  {saving ? "Saving..." : editingDomesticId ? "Update Domestic Lead Time" : "Save Domestic Lead Time"}
                </button>
                {editingDomesticId ? (
                  <button type="button" disabled={saving} onClick={handleDomesticCancelEdit} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
