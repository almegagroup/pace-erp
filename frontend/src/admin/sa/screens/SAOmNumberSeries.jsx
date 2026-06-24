/*
 * File-ID: 18.3.1
 * File-Path: frontend/src/admin/sa/screens/SAOmNumberSeries.jsx
 * Gate: 18 | Domain: PROCUREMENT
 * Purpose: SA number series management — global counters and company+FY series.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openActionConfirm } from "../../../store/actionConfirm.js";
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
import { useAdminCompaniesQuery } from "../../../hooks/queries/useAdminMasterQueries.js";

async function readJsonSafe(response) {
  try { return await response.clone().json(); } catch { return null; }
}

async function deleteCompanyCounter(counterId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/procurement/number-series/counters/${encodeURIComponent(counterId)}`,
    { method: "DELETE", credentials: "include" }
  );
  const json = await readJsonSafe(response);
  if (!response.ok) throw new Error(json?.code ?? "COUNTER_DELETE_FAILED");
  return json;
}

async function deleteCompanySeries(seriesId) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/procurement/number-series/company/${encodeURIComponent(seriesId)}`,
    { method: "DELETE", credentials: "include" }
  );
  const json = await readJsonSafe(response);
  if (!response.ok) throw new Error(json?.code ?? "SERIES_DELETE_FAILED");
  return json;
}

async function updateCompanySeries(seriesId, data) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/procurement/number-series/company/${encodeURIComponent(seriesId)}`,
    { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }
  );
  const json = await readJsonSafe(response);
  if (!response.ok) throw new Error(json?.code ?? "SERIES_UPDATE_FAILED");
  return json;
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
  const queryClient = useQueryClient();

  // Global
  const [editingGlobal, setEditingGlobal] = useState({ doc_type: "", starting_number: "" });

  // Company
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [editingSeriesId, setEditingSeriesId] = useState(null);
  const [editSeriesForm, setEditSeriesForm] = useState({ prefix: "", number_padding: "" });
  const [seriesForm, setSeriesForm] = useState({ company_id: "", document_type: "PO", prefix: "", number_padding: "5" });
  const [counterForm, setCounterForm] = useState({ financial_year: "", starting_number: "1" });

  // Shared
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const {
    data: companies = [],
    isLoading: companiesLoading,
    refetch: refetchCompanies,
  } = useAdminCompaniesQuery();
  const {
    data: globalRows = [],
    isLoading: globalLoading,
    refetch: refetchGlobalRows,
  } = useQuery({
    queryKey: ["admin", "number-series", "global"],
    queryFn: () => listGlobalNumberSeries(),
    select: (rows) => (Array.isArray(rows) ? rows : []),
  });
  const {
    data: companyRows = [],
    isLoading: companyRowsLoading,
    refetch: refetchCompanyRows,
  } = useQuery({
    queryKey: ["admin", "number-series", "company", companyFilter || ""],
    queryFn: () => listCompanyNumberSeries({ company_id: companyFilter || undefined }),
    select: (rows) => (Array.isArray(rows) ? rows : []),
  });
  const {
    data: companyCounters = [],
    isLoading: countersLoading,
    refetch: refetchCounters,
  } = useQuery({
    queryKey: ["admin", "number-series", "counters", selectedSeries?.company_id || "", selectedSeries?.document_type || ""],
    queryFn: () => listCompanyCounters(selectedSeries.company_id, selectedSeries.document_type),
    enabled: Boolean(selectedSeries?.company_id && selectedSeries?.document_type),
    select: (rows) => (Array.isArray(rows) ? rows : []),
  });
  const loading = globalLoading || companyRowsLoading || companiesLoading || countersLoading;

  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, `${c.company_code} | ${c.company_name}`])),
    [companies]
  );

  async function loadAll() {
    setError("");
    const results = await Promise.all([
      refetchGlobalRows(),
      refetchCompanyRows(),
      refetchCompanies(),
      ...(selectedSeries ? [refetchCounters()] : []),
    ]);
    const nextError = results.find((result) => result.error)?.error;
    if (nextError) {
      setError(nextError instanceof Error ? nextError.message : "NUMBER_SERIES_LOAD_FAILED");
    }
  }

  useEffect(() => {
    if (!selectedSeries) {
      return;
    }
    const refreshed = companyRows.find((entry) => entry.id === selectedSeries.id);
    if (!refreshed) {
      setSelectedSeries(null);
      return;
    }
    if (refreshed !== selectedSeries) {
      setSelectedSeries(refreshed);
    }
  }, [companyRows, selectedSeries]);

  async function handleGlobalSave(docType) {
    const startingNumber = Number(editingGlobal.starting_number);
    if (!docType || !Number.isFinite(startingNumber) || startingNumber <= 0) {
      setError("Enter a valid starting number."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      await updateGlobalStartingNumber(docType, { starting_number: startingNumber });
      setEditingGlobal({ doc_type: "", starting_number: "" });
      setNotice(`Starting number updated for ${docType}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "number-series", "global"] });
      await refetchGlobalRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "GLOBAL_STARTING_NUMBER_UPDATE_FAILED");
    } finally { setSaving(false); }
  }

  async function handleCreateSeries() {
    if (!seriesForm.company_id || !seriesForm.document_type || !seriesForm.prefix.trim()) {
      setError("Company, document type, and prefix are required."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const created = await createCompanyNumberSeries({
        company_id: seriesForm.company_id,
        document_type: seriesForm.document_type,
        prefix: seriesForm.prefix.trim(),
        number_padding: Number(seriesForm.number_padding || 5),
      });
      setSeriesForm({ company_id: "", document_type: "PO", prefix: "", number_padding: "5" });
      setNotice("Series created.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "number-series", "company"] });
      await refetchCompanyRows();
      if (created?.id) {
        setSelectedSeries(created);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "COMPANY_NUMBER_SERIES_CREATE_FAILED");
    } finally { setSaving(false); }
  }

  async function handleEditSeriesSave(seriesId) {
    if (!editSeriesForm.prefix.trim()) { setError("Prefix is required."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await updateCompanySeries(seriesId, {
        prefix: editSeriesForm.prefix.trim(),
        number_padding: Number(editSeriesForm.number_padding || 5),
      });
      setEditingSeriesId(null);
      setNotice("Series updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "number-series", "company"] });
      await refetchCompanyRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "SERIES_UPDATE_FAILED");
    } finally { setSaving(false); }
  }

  async function handleDeleteSeries(series) {
    const label = `${companyMap.get(series.company_id) ?? series.company_id} — ${series.document_type}`;
    const confirmed = await openActionConfirm({
      eyebrow: "Company Series",
      title: `Delete "${label}" series?`,
      message: "This series and its unused counters will be permanently deleted.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await deleteCompanySeries(series.id);
      if (selectedSeries?.id === series.id) { setSelectedSeries(null); }
      setNotice("Series deleted.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "number-series", "company"] });
      await refetchCompanyRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "SERIES_DELETE_FAILED");
    } finally { setSaving(false); }
  }

  async function handleDeleteCounter(counter) {
    const confirmed = await openActionConfirm({
      eyebrow: "FY Counter",
      title: `Delete "${counter.financial_year}" counter?`,
      message: "This counter has not been used. Deleting it cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await deleteCompanyCounter(counter.id);
      setNotice("FY counter deleted.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "number-series", "counters"] });
      await refetchCounters();
    } catch (e) {
      setError(e instanceof Error ? e.message : "COUNTER_DELETE_FAILED");
    } finally { setSaving(false); }
  }

  async function handleCreateCounter() {
    if (!selectedSeries?.company_id || !selectedSeries?.document_type || !counterForm.financial_year.trim()) {
      setError("Select a series and enter a financial year."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      await createCompanyCounter(selectedSeries.company_id, selectedSeries.document_type, {
        financial_year: counterForm.financial_year.trim(),
        starting_number: Number(counterForm.starting_number || 1),
      });
      setCounterForm({ financial_year: "", starting_number: "1" });
      setNotice("FY counter created.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "number-series", "counters"] });
      await refetchCounters();
    } catch (e) {
      setError(e instanceof Error ? e.message : "COMPANY_COUNTER_CREATE_FAILED");
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="Number Series"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral",
        onClick: () => void loadAll(), disabled: loading,
      }]}
      notices={[
        ...(error ? [{ key: "err", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ok", tone: "success", message: notice }] : []),
      ]}
    >
      {/* Tab bar */}
      <div className="flex border-b border-slate-200">
        {TABS.map((tab) => (
          <button key={tab.key} type="button"
            onClick={() => { setActiveTab(tab.key); setError(""); setNotice(""); }}
            className={`px-5 py-2.5 text-sm font-semibold tracking-[0.02em] -mb-px border-b-2 transition-colors ${
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
          <ErpSectionCard eyebrow="Global Document Numbers" title="System-wide counters — no company, no financial year">
            <div className="grid gap-3">
              <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Starting number can only be changed before the first document of that type is generated (Current = NOT USED).
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 w-48">Document Type</th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 w-36">Starting #</th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 w-36">Current #</th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr><td colSpan={4} className="px-3 py-4 text-sm text-slate-400">Loading...</td></tr>
                    )}
                    {!loading && globalRows.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-sm text-slate-400">No global counters found.</td></tr>
                    )}
                    {globalRows.map((row) => {
                      const canEdit = Number(row.last_number ?? 0) === 0;
                      const isEditing = editingGlobal.doc_type === row.doc_type;
                      return (
                        <tr key={row.doc_type} className="border-b border-slate-100">
                          <td className="px-3 py-2 font-mono text-sm font-semibold text-slate-800">{row.doc_type}</td>
                          <td className="px-3 py-2 text-slate-700">{row.starting_number ?? 1}</td>
                          <td className="px-3 py-2">
                            <span className={Number(row.last_number ?? 0) > 0 ? "font-semibold text-slate-900" : "text-slate-400"}>
                              {formatGlobalCurrent(row)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {!canEdit && <span className="text-xs text-slate-400">Already in use</span>}
                            {canEdit && !isEditing && (
                              <button type="button"
                                onClick={() => setEditingGlobal({ doc_type: row.doc_type, starting_number: String(row.starting_number ?? 1) })}
                                className="border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                              >
                                Edit Starting
                              </button>
                            )}
                            {canEdit && isEditing && (
                              <div className="flex items-center gap-2">
                                <input type="number" min="1"
                                  value={editingGlobal.starting_number}
                                  onChange={(e) => setEditingGlobal({ doc_type: row.doc_type, starting_number: e.target.value })}
                                  className="h-7 w-24 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                />
                                <button type="button" disabled={saving}
                                  onClick={() => void handleGlobalSave(row.doc_type)}
                                  className="border border-sky-700 bg-sky-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-950 disabled:opacity-50"
                                >Save</button>
                                <button type="button"
                                  onClick={() => setEditingGlobal({ doc_type: "", starting_number: "" })}
                                  className="border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600"
                                >Cancel</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </ErpSectionCard>
        )}

        {/* ── Tab 2: Company Series ── */}
        {activeTab === "company" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_320px]">

            {/* Left: series list */}
            <ErpSectionCard eyebrow="Company Series" title="PO and STO — per company, restarts each financial year">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Filter by Company">
                  <select value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">All Companies</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
                    ))}
                  </select>
                </ErpDenseFormRow>

                <div className="overflow-auto rounded border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-800">
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300">Company</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300 w-24">Doc Type</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300 w-28">Prefix</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300 w-20">Padding</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300 w-20">Active</th>
                        <th className="px-3 py-2 w-28"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && (
                        <tr><td colSpan={6} className="px-3 py-4 text-sm text-slate-400">Loading...</td></tr>
                      )}
                      {!loading && companyRows.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-4 text-sm text-slate-400">No series found. Create one on the right.</td></tr>
                      )}
                      {companyRows.map((row) => {
                        const isSelected = selectedSeries?.id === row.id;
                        const isEditingThis = editingSeriesId === row.id;
                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              onClick={() => {
                                if (editingSeriesId === row.id) return;
                                setSelectedSeries(isSelected ? null : row);
                              }}
                              className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-sky-50" : "hover:bg-slate-50"}`}
                            >
                              <td className="px-3 py-2 text-slate-800">{companyMap.get(row.company_id) ?? row.company_id}</td>
                              <td className="px-3 py-2 font-mono font-semibold text-slate-800">{row.document_type}</td>
                              <td className="px-3 py-2 font-mono text-slate-700">
                                {isEditingThis ? (
                                  <input value={editSeriesForm.prefix}
                                    onChange={(e) => setEditSeriesForm((f) => ({ ...f, prefix: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-7 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                                  />
                                ) : row.prefix}
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                {isEditingThis ? (
                                  <input type="number" min="1" max="10" value={editSeriesForm.number_padding}
                                    onChange={(e) => setEditSeriesForm((f) => ({ ...f, number_padding: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-7 w-16 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                                  />
                                ) : row.number_padding}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`text-xs font-semibold ${row.active ? "text-emerald-700" : "text-slate-400"}`}>
                                  {row.active ? "YES" : "NO"}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  {isEditingThis ? (
                                    <>
                                      <button type="button" disabled={saving}
                                        onClick={() => void handleEditSeriesSave(row.id)}
                                        className="border border-sky-700 bg-sky-100 px-2 py-1 text-[10px] font-semibold text-sky-900 disabled:opacity-50"
                                      >Save</button>
                                      <button type="button"
                                        onClick={() => setEditingSeriesId(null)}
                                        className="border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
                                      >Cancel</button>
                                    </>
                                  ) : (
                                    <>
                                      <button type="button"
                                        onClick={() => {
                                          setEditingSeriesId(row.id);
                                          setEditSeriesForm({ prefix: row.prefix, number_padding: String(row.number_padding) });
                                        }}
                                        className="border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700"
                                      >Edit</button>
                                      <button type="button" disabled={saving}
                                        onClick={() => void handleDeleteSeries(row)}
                                        className="border border-rose-300 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 disabled:opacity-50"
                                      >Delete</button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {/* Inline FY Counters — expands under selected row */}
                            {isSelected && (
                              <tr>
                                <td colSpan={6} className="bg-sky-50 px-4 py-4">
                                  <div className="grid gap-3">
                                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-sky-700">
                                      FY Counters — {row.prefix} ({row.document_type})
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                                      {/* Counter list */}
                                      <div className="overflow-auto rounded border border-sky-200 bg-white">
                                        <table className="w-full text-sm">
                                          <thead>
                                            <tr className="border-b border-sky-200 bg-sky-100">
                                              <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-700">Financial Year</th>
                                              <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-700 w-32">Starting #</th>
                                              <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-700 w-32">Current #</th>
                                              <th className="px-3 py-1.5 w-24"></th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {companyCounters.length === 0 && (
                                              <tr><td colSpan={3} className="px-3 py-3 text-xs text-slate-400">No FY counters yet. Create one →</td></tr>
                                            )}
                                            {companyCounters.map((counter) => {
                                              const isUsed = Number(counter.last_number ?? 0) > 0;
                                              return (
                                              <tr key={counter.id} className="border-b border-slate-100">
                                                <td className="px-3 py-2 font-mono font-semibold text-slate-800">{counter.financial_year}</td>
                                                <td className="px-3 py-2 text-slate-700">{counter.starting_number}</td>
                                                <td className="px-3 py-2">
                                                  <span className={isUsed ? "font-semibold text-slate-900" : "text-slate-400"}>
                                                    {isUsed ? counter.last_number : "NOT USED"}
                                                  </span>
                                                </td>
                                                <td className="px-3 py-2 w-32">
                                                  {!isUsed && (
                                                    <div className="flex items-center gap-1">
                                                      <button type="button"
                                                        onClick={() => setCounterForm({ financial_year: counter.financial_year, starting_number: String(counter.starting_number) })}
                                                        className="border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                                                      >Edit</button>
                                                      <button type="button" disabled={saving}
                                                        onClick={() => void handleDeleteCounter(counter)}
                                                        className="border border-rose-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-700 disabled:opacity-50"
                                                      >Delete</button>
                                                    </div>
                                                  )}
                                                </td>
                                              </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>

                                      {/* Create counter form */}
                                      <div className="grid gap-2 content-start">
                                        <div className="text-xs font-semibold text-slate-600">Add FY Counter</div>
                                        <ErpDenseFormRow label="Financial Year">
                                          <input value={counterForm.financial_year}
                                            onChange={(e) => setCounterForm((f) => ({ ...f, financial_year: e.target.value }))}
                                            placeholder="e.g. 26-27"
                                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                          />
                                        </ErpDenseFormRow>
                                        <ErpDenseFormRow label="Starting Number">
                                          <input type="number" min="1" value={counterForm.starting_number}
                                            onChange={(e) => setCounterForm((f) => ({ ...f, starting_number: e.target.value }))}
                                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                          />
                                        </ErpDenseFormRow>
                                        <button type="button" disabled={saving}
                                          onClick={() => void handleCreateCounter()}
                                          className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50"
                                        >
                                          {saving ? "Creating..." : "Create FY Counter"}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </ErpSectionCard>

            {/* Right: create series form */}
            <ErpSectionCard eyebrow="Create New Series" title="Add a company series">
              <div className="grid gap-3">
                <ErpDenseFormRow label="Company" required>
                  <select value={seriesForm.company_id}
                    onChange={(e) => setSeriesForm((f) => ({ ...f, company_id: e.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select company</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Document Type" required>
                  <select value={seriesForm.document_type}
                    onChange={(e) => setSeriesForm((f) => ({ ...f, document_type: e.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="PO">PO</option>
                    <option value="STO">STO</option>
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Prefix" required>
                  <input value={seriesForm.prefix}
                    onChange={(e) => setSeriesForm((f) => ({ ...f, prefix: e.target.value }))}
                    placeholder="e.g. ASCPO"
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Number Padding">
                  <input type="number" min="1" max="10" value={seriesForm.number_padding}
                    onChange={(e) => setSeriesForm((f) => ({ ...f, number_padding: e.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                {seriesForm.prefix && (
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Preview: <span className="font-mono font-semibold text-slate-900">
                      {seriesForm.prefix}2627-{"1".padStart(Number(seriesForm.number_padding) || 5, "0")}
                    </span>
                  </div>
                )}
                <button type="button" disabled={saving} onClick={() => void handleCreateSeries()}
                  className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Series"}
                </button>
              </div>
            </ErpSectionCard>

          </div>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
