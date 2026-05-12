/*
 * File-ID: 18.3.1
 * File-Path: frontend/src/admin/sa/screens/SAOmNumberSeries.jsx
 * Gate: 18
 * Phase: 18
 * Domain: PROCUREMENT
 * Purpose: Rebuild SA number series screen for global and company+FY procurement document numbering.
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

export default function SAOmNumberSeries() {
  const [globalRows, setGlobalRows] = useState([]);
  const [companyRows, setCompanyRows] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [companyCounters, setCompanyCounters] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [editingGlobal, setEditingGlobal] = useState({ doc_type: "", starting_number: "" });
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
    const rows = await listCompanyNumberSeries({
      company_id: companyFilter || undefined,
    });
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
        const nextSelected = (Array.isArray(companyData) ? companyData : []).find(
          (entry) => entry.id === selectedSeries.id
        );
        setSelectedSeries(nextSelected || null);
        if (nextSelected) {
          const counterData = await listCompanyCounters(nextSelected.company_id, nextSelected.document_type);
          setCompanyCounters(Array.isArray(counterData) ? counterData : []);
        } else {
          setCompanyCounters([]);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_NUMBER_SERIES_LOAD_FAILED");
      setGlobalRows([]);
      setCompanyRows([]);
      setCompanyCounters([]);
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
      setError("GLOBAL_STARTING_NUMBER_INVALID");
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
      setError("COMPANY_NUMBER_SERIES_CREATE_INVALID");
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
      setSeriesForm({
        company_id: "",
        document_type: "PO",
        prefix: "",
        number_padding: "5",
      });
      setNotice("Company number series created.");
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
      setError("COMPANY_COUNTER_CREATE_INVALID");
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
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadAll() },
      ]}
      notices={[
        ...(error ? [{ key: "number-series-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "number-series-notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard
          eyebrow="Global Document Numbers"
          title="System-wide counters (no company, no FY)"
        >
          <div className="grid gap-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Starting number can only be changed before first document is generated.
            </div>
            <ErpDenseGrid
              columns={[
                { key: "doc_type", label: "Doc Type", width: "140px" },
                { key: "starting_number", label: "Starting #", width: "120px" },
                {
                  key: "current_number",
                  label: "Current #",
                  width: "140px",
                  render: (row) => formatGlobalCurrent(row),
                },
                {
                  key: "action",
                  label: "Action",
                  width: "260px",
                  render: (row) => {
                    const canEdit = Number(row.last_number ?? 0) === 0;
                    if (!canEdit) {
                      return "—";
                    }
                    if (editingGlobal.doc_type === row.doc_type) {
                      return (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={editingGlobal.starting_number}
                            onChange={(event) =>
                              setEditingGlobal({
                                doc_type: row.doc_type,
                                starting_number: event.target.value,
                              })
                            }
                            className="h-8 w-28 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                          <button
                            type="button"
                            onClick={() => void handleGlobalSave(row.doc_type)}
                            className="border border-sky-700 bg-sky-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-950"
                          >
                            Save
                          </button>
                        </div>
                      );
                    }
                    return (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingGlobal({
                            doc_type: row.doc_type,
                            starting_number: String(row.starting_number ?? 1),
                          })
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
              emptyMessage={loading ? "Loading global number series..." : "No global number series found."}
              maxHeight="360px"
            />
          </div>
        </ErpSectionCard>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <ErpSectionCard
            eyebrow="Company + FY Document Numbers"
            title="PO and STO - per company, resets each FY"
          >
            <div className="grid gap-3">
              <ErpDenseFormRow label="Filter Company">
                <select
                  value={companyFilter}
                  onChange={(event) => setCompanyFilter(event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {companies.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.company_code} | {entry.company_name}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseGrid
                columns={[
                  {
                    key: "company_id",
                    label: "Company",
                    render: (row) => companyMap.get(row.company_id) ?? row.company_id,
                  },
                  { key: "document_type", label: "Doc Type", width: "110px" },
                  { key: "prefix", label: "Prefix" },
                  { key: "number_padding", label: "Padding", width: "90px" },
                  { key: "active", label: "Active", width: "90px", render: (row) => (row.active ? "YES" : "NO") },
                ]}
                rows={companyRows}
                rowKey={(row) => row.id}
                onRowActivate={(row) => {
                  setSelectedSeries(row);
                  void loadCounters(row);
                }}
                getRowProps={(row) => ({
                  onDoubleClick: () => {
                    setSelectedSeries(row);
                    void loadCounters(row);
                  },
                  className: `cursor-pointer hover:bg-sky-50 ${selectedSeries?.id === row.id ? "bg-sky-50" : ""}`,
                })}
                emptyMessage={loading ? "Loading company number series..." : "No company number series found."}
                maxHeight="320px"
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Create Series" title="New company number series">
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
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Padding">
                <input
                  type="number"
                  min="1"
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

        <ErpSectionCard
          eyebrow="FY Counters"
          title={selectedSeries ? `${companyMap.get(selectedSeries.company_id) ?? selectedSeries.company_id} | ${selectedSeries.document_type}` : "Select a company series"}
        >
          {!selectedSeries ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Select a company series row to view or create FY counters.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <ErpDenseGrid
                columns={[
                  { key: "financial_year", label: "FY", width: "120px" },
                  { key: "starting_number", label: "Starting #", width: "120px" },
                  { key: "last_number", label: "Current #", width: "120px" },
                ]}
                rows={companyCounters}
                rowKey={(row) => row.id}
                emptyMessage="No FY counters created yet."
                maxHeight="260px"
              />

              <div className="grid gap-3">
                <ErpDenseFormRow label="Financial Year" required>
                  <input
                    value={counterForm.financial_year}
                    onChange={(event) => setCounterForm((current) => ({ ...current, financial_year: event.target.value }))}
                    placeholder="26-27"
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
                  {saving ? "Creating..." : "Create Counter"}
                </button>
              </div>
            </div>
          )}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
