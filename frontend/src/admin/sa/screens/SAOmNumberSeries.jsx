/*
 * File-ID: 18.3.1
 * File-Path: frontend/src/admin/sa/screens/SAOmNumberSeries.jsx
 * Gate: 18
 * Phase: 18
 * Domain: PROCUREMENT
 * Purpose: SA number series management — global counters and company+FY series.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createCompanyCounter,
  createCompanyNumberSeries,
  listCompanyCounters,
  listCompanyNumberSeries,
  listGlobalNumberSeries,
  updateGlobalStartingNumber,
} from "../../../pages/dashboard/procurement/procurementApi.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function listCompanies() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/companies`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.companies)) {
    const error = new Error(json?.code ?? "COMPANY_LIST_FAILED");
    error.status = response.status;
    throw error;
  }
  return json.data.companies;
}

function formatGlobalCurrent(row) {
  const current = Number(row.last_number ?? 0);
  const width = Number(row.pad_width ?? 6);
  return current > 0 ? String(current).padStart(width, "0") : "NOT USED";
}

const TABS = [
  { key: "global", label: "Global Counters" },
  { key: "company", label: "Company Series" },
];

export default function SAOmNumberSeries() {
  const [activeTab, setActiveTab] = useState("global");

  // Global tab state
  const [globalRows, setGlobalRows] = useState([]);
  const [editingGlobal, setEditingGlobal] = useState({ doc_type: "", starting_number: "" });

  // Company tab state
  const [companyRows, setCompanyRows] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [companyCounters, setCompanyCounters] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [seriesForm, setSeriesForm] = useState({
    company_id: "",
    document_type: "PO",
    prefix: "",
    number_padding: "5",
  });
  const [counterForm, setCounterForm] = useState({
    financial_year: "",
    starting_number: "1",
  });

  // Shared
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyMap = useMemo(
    () => new Map(companies.map((entry) => [entry.id, `${entry.company_code} | ${entry.company_name}`])),
    [companies]
  );

  async function loadGlobalRows() {
    const rows = await listGlobalNumberSeries();
    setGlobalRows(Array.isArray(rows) ? rows : []);
  }

  async function loadCompanyRows() {
    const rows = await listCompanyNumberSeries({ company_id: companyFilter || undefined });
    setCompanyRows(Array.isArray(rows) ? rows : []);
  }

  async function loadCounters(series) {
    if (!series?.company_id || !series?.document_type) {
      setCompanyCounters([]);
      return;
    }
    const rows = await listCompanyCounters(series.company_id, series.document_type);
    setCompanyCounters(Array.isArray(rows) ? rows : []);
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [globalData, companyData, companyList] = await Promise.all([
        listGlobalNumberSeries(),
        listCompanyNumberSeries({ company_id: companyFilter || undefined }),
        listCompanies(),
      ]);
      setGlobalRows(Array.isArray(globalData) ? globalData : []);
      setCompanyRows(Array.isArray(companyData) ? companyData : []);
      setCompanies(companyList);
      if (selectedSeries) {
        const refreshed = (Array.isArray(companyData) ? companyData : []).find(
          (entry) => entry.id === selectedSeries.id
        );
        setSelectedSeries(refreshed || null);
        if (refreshed) {
          const counterData = await listCompanyCounters(refreshed.company_id, refreshed.document_type);
          setCompanyCounters(Array.isArray(counterData) ? counterData : []);
        } else {
          setCompanyCounters([]);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_NUMBER_SERIES_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [companyFilter]);

  async function handleGlobalSave(docType) {
    const startingNumber = Number(editingGlobal.starting_number);
    if (!docType || !Number.isFinite(startingNumber) || startingNumber <= 0) {
      setError("Enter a valid starting number.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateGlobalStartingNumber(docType, { starting_number: startingNumber });
      setEditingGlobal({ doc_type: "", starting_number: "" });
      setNotice(`Starting number updated for ${docType}.`);
      await loadGlobalRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GLOBAL_STARTING_NUMBER_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSeries() {
    if (!seriesForm.company_id || !seriesForm.document_type || !seriesForm.prefix.trim()) {
      setError("Company, document type, and prefix are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createCompanyNumberSeries({
        company_id: seriesForm.company_id,
        document_type: seriesForm.document_type,
        prefix: seriesForm.prefix.trim(),
        number_padding: Number(seriesForm.number_padding || 5),
      });
      setSeriesForm({ company_id: "", document_type: "PO", prefix: "", number_padding: "5" });
      setNotice("Series created.");
      await loadCompanyRows();
      if (created?.id) {
        setSelectedSeries(created);
        await loadCounters(created);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "COMPANY_NUMBER_SERIES_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCounter() {
    if (!selectedSeries?.company_id || !selectedSeries?.document_type || !counterForm.financial_year.trim()) {
      setError("Select a series and enter a financial year.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createCompanyCounter(selectedSeries.company_id, selectedSeries.document_type, {
        financial_year: counterForm.financial_year.trim(),
        starting_number: Number(counterForm.starting_number || 1),
      });
      setCounterForm({ financial_year: "", starting_number: "1" });
      setNotice("FY counter created.");
      await loadCounters(selectedSeries);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "COMPANY_COUNTER_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="Number Series"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadAll(),
          disabled: loading,
        },
      ]}
      notices={[
        ...(error ? [{ key: "number-series-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "number-series-notice", tone: "success", message: notice }] : []),
      ]}
    >
      {/* Tab bar */}
      <div className="flex border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setActiveTab(tab.key); setError(""); setNotice(""); }}
            className={`px-5 py-2.5 text-sm font-semibold tracking-[0.02em] transition-colors -mb-px border-b-2 ${
              activeTab === tab.key
                ? "border-sky-600 text-sky-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4">

        {/* ── Tab 1: Global Counters ── */}
        {activeTab === "global" && (
          <ErpSectionCard
            eyebrow="Global Document Numbers"
            title="System-wide counters — no company, no financial year"
          >
            <div className="grid gap-3">
              <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Starting number can only be changed before the first document of that type is generated (Current = NOT USED).
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "doc_type", label: "Document Type", width: "180px" },
                  { key: "starting_number", label: "Starting #", width: "130px" },
                  {
                    key: "current_number",
                    label: "Current #",
                    width: "160px",
                    render: (row) => formatGlobalCurrent(row),
                  },
                  {
                    key: "action",
                    label: "Edit Starting",
                    width: "280px",
                    render: (row) => {
                      const canEdit = Number(row.last_number ?? 0) === 0;
                      if (!canEdit) return <span className="text-slate-400 text-xs">Already in use</span>;
                      if (editingGlobal.doc_type === row.doc_type) {
                        return (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={editingGlobal.starting_number}
                              onChange={(event) =>
                                setEditingGlobal({ doc_type: row.doc_type, starting_number: event.target.value })
                              }
                              className="h-7 w-28 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                            />
                            <button
                              type="button"
                              onClick={() => void handleGlobalSave(row.doc_type)}
                              disabled={saving}
                              className="border border-sky-700 bg-sky-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-950 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGlobal({ doc_type: "", starting_number: "" })}
                              className="border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingGlobal({ doc_type: row.doc_type, starting_number: String(row.starting_number ?? 1) })
                          }
                          className="border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                        >
                          Edit Starting
                        </button>
                      );
                    },
                  },
                ]}
                rows={globalRows}
                rowKey={(row) => row.doc_type}
                emptyMessage={loading ? "Loading..." : "No global counters found."}
                maxHeight="400px"
              />
            </div>
          </ErpSectionCard>
        )}

        {/* ── Tab 2: Company Series ── */}
        {activeTab === "company" && (
          <>
            {/* Top row: series list + create form */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_340px]">
              <ErpSectionCard eyebrow="Company Series" title="PO and STO — per company, restarts each financial year">
                <div className="grid gap-3">
                  <ErpDenseFormRow label="Filter by Company">
                    <select
                      value={companyFilter}
                      onChange={(event) => setCompanyFilter(event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">All Companies</option>
                      {companies.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.company_code} | {entry.company_name}
                        </option>
                      ))}
                    </select>
                  </ErpDenseFormRow>
                  <p className="text-xs text-slate-500">Click a row to view and manage its FY counters below.</p>
                  <ErpDenseGrid
                    columns={[
                      {
                        key: "company_id",
                        label: "Company",
                        render: (row) => companyMap.get(row.company_id) ?? row.company_id,
                      },
                      { key: "document_type", label: "Doc Type", width: "110px" },
                      { key: "prefix", label: "Prefix", width: "120px" },
                      { key: "number_padding", label: "Padding", width: "90px" },
                      {
                        key: "active",
                        label: "Active",
                        width: "80px",
                        render: (row) => (
                          <span className={`text-xs font-semibold ${row.active ? "text-emerald-700" : "text-slate-400"}`}>
                            {row.active ? "YES" : "NO"}
                          </span>
                        ),
                      },
                    ]}
                    rows={companyRows}
                    rowKey={(row) => row.id}
                    onRowActivate={(row) => { setSelectedSeries(row); void loadCounters(row); }}
                    getRowProps={(row) => ({
                      onClick: () => { setSelectedSeries(row); void loadCounters(row); },
                      className: `cursor-pointer hover:bg-sky-50 ${selectedSeries?.id === row.id ? "bg-sky-100 ring-1 ring-inset ring-sky-300" : ""}`,
                    })}
                    emptyMessage={loading ? "Loading..." : "No company series found. Create one on the right."}
                    maxHeight="340px"
                  />
                </div>
              </ErpSectionCard>

              <ErpSectionCard eyebrow="Create New Series" title="Add a company series">
                <div className="grid gap-3">
                  <ErpDenseFormRow label="Company" required>
                    <select
                      value={seriesForm.company_id}
                      onChange={(event) => setSeriesForm((current) => ({ ...current, company_id: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select company</option>
                      {companies.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.company_code} | {entry.company_name}
                        </option>
                      ))}
                    </select>
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Document Type" required>
                    <select
                      value={seriesForm.document_type}
                      onChange={(event) => setSeriesForm((current) => ({ ...current, document_type: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="PO">PO</option>
                      <option value="STO">STO</option>
                    </select>
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Prefix" required>
                    <input
                      value={seriesForm.prefix}
                      onChange={(event) => setSeriesForm((current) => ({ ...current, prefix: event.target.value }))}
                      placeholder="e.g. PO-CMP001-"
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Number Padding">
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={seriesForm.number_padding}
                      onChange={(event) => setSeriesForm((current) => ({ ...current, number_padding: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <button
                    type="button"
                    onClick={() => void handleCreateSeries()}
                    disabled={saving}
                    className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Creating..." : "Create Series"}
                  </button>
                </div>
              </ErpSectionCard>
            </div>

            {/* Bottom: FY Counters for selected series */}
            <ErpSectionCard
              eyebrow="FY Counters"
              title={
                selectedSeries
                  ? `${companyMap.get(selectedSeries.company_id) ?? selectedSeries.company_id} — ${selectedSeries.document_type} (Prefix: ${selectedSeries.prefix})`
                  : "Select a series above to manage FY counters"
              }
            >
              {!selectedSeries ? (
                <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Click any row in the Company Series list above to view and create FY counters.
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <ErpDenseGrid
                    columns={[
                      { key: "financial_year", label: "Financial Year", width: "160px" },
                      { key: "starting_number", label: "Starting #", width: "130px" },
                      {
                        key: "last_number",
                        label: "Current #",
                        width: "130px",
                        render: (row) => (
                          <span className={Number(row.last_number ?? 0) > 0 ? "font-semibold text-slate-900" : "text-slate-400"}>
                            {Number(row.last_number ?? 0) > 0 ? row.last_number : "NOT USED"}
                          </span>
                        ),
                      },
                    ]}
                    rows={companyCounters}
                    rowKey={(row) => row.id}
                    emptyMessage="No FY counters yet. Create one on the right."
                    maxHeight="260px"
                  />

                  <div className="grid gap-3 content-start">
                    <p className="text-xs text-slate-500">
                      Create a new counter for a financial year. Once a document is generated, the counter cannot be reset.
                    </p>
                    <ErpDenseFormRow label="Financial Year" required>
                      <input
                        value={counterForm.financial_year}
                        onChange={(event) => setCounterForm((current) => ({ ...current, financial_year: event.target.value }))}
                        placeholder="e.g. 25-26"
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Starting Number">
                      <input
                        type="number"
                        min="1"
                        value={counterForm.starting_number}
                        onChange={(event) => setCounterForm((current) => ({ ...current, starting_number: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <button
                      type="button"
                      onClick={() => void handleCreateCounter()}
                      disabled={saving}
                      className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? "Creating..." : "Create FY Counter"}
                    </button>
                  </div>
                </div>
              )}
            </ErpSectionCard>
          </>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
