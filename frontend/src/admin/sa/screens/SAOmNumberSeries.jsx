/*
 * File-ID: 15.16
 * File-Path: frontend/src/admin/sa/screens/SAOmNumberSeries.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the SA-only number series list and create form.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createNumberSeries, listNumberSeries } from "../../../pages/dashboard/om/omApi.js";

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

export default function SAOmNumberSeries() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [documentTypeFilter, setDocumentTypeFilter] = useState("");
  const [form, setForm] = useState({
    company_id: "",
    document_type: "",
    prefix: "",
    padding: "5",
    financial_year_reset: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const [seriesResult, companyRows] = await Promise.all([
        listNumberSeries({
          company_id: companyFilter || undefined,
          document_type: documentTypeFilter || undefined,
        }),
        listCompanies(),
      ]);
      setRows(Array.isArray(seriesResult?.data) ? seriesResult.data : []);
      setCompanies(companyRows);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "OM_NUMBER_SERIES_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [companyFilter, documentTypeFilter]);

  async function handleCreate() {
    if (!form.company_id || !form.document_type.trim() || !form.prefix.trim()) {
      setError("OM_NUMBER_SERIES_CREATE_FAILED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createNumberSeries({
        company_id: form.company_id,
        document_type: form.document_type.trim().toUpperCase(),
        prefix: form.prefix.trim(),
        padding: Number(form.padding),
        financial_year_reset: form.financial_year_reset,
      });
      setForm({
        company_id: "",
        document_type: "",
        prefix: "",
        padding: "5",
        financial_year_reset: true,
      });
      setNotice("Number series created.");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_NUMBER_SERIES_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const companyMap = useMemo(
    () => new Map(companies.map((entry) => [entry.id, `${entry.company_code} | ${entry.company_name}`])),
    [companies]
  );

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="Number Series"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Creating..." : "Create Series", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ErpSectionCard eyebrow="Series Register" title="All number series">
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
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
              <ErpDenseFormRow label="Filter Document Type">
                <input
                  value={documentTypeFilter}
                  onChange={(event) => setDocumentTypeFilter(event.target.value.toUpperCase())}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
            </div>
            <ErpDenseGrid
              columns={[
                {
                  key: "company_id",
                  label: "Company",
                  render: (row) => companyMap.get(row.company_id) ?? row.company_id,
                },
                { key: "document_type", label: "Document Type" },
                { key: "prefix", label: "Prefix" },
                { key: "number_padding", label: "Padding" },
                { key: "active", label: "Active", render: (row) => (row.active ? "YES" : "NO") },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              emptyMessage={loading ? "Loading number series rows..." : "No number series matched the current filter."}
              maxHeight="420px"
            />
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Series" title="New number series">
          <div className="grid gap-3">
            <ErpDenseFormRow label="Company" required>
              <select
                value={form.company_id}
                onChange={(event) => setForm((current) => ({ ...current, company_id: event.target.value }))}
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
              <input
                value={form.document_type}
                onChange={(event) => setForm((current) => ({ ...current, document_type: event.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Prefix" required>
              <input
                value={form.prefix}
                onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Padding">
              <input
                type="number"
                min="1"
                value={form.padding}
                onChange={(event) => setForm((current) => ({ ...current, padding: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Financial Year Reset">
              <label className="flex h-8 items-center gap-2 text-sm text-slate-900">
                <input
                  type="checkbox"
                  checked={form.financial_year_reset}
                  onChange={(event) => setForm((current) => ({ ...current, financial_year_reset: event.target.checked }))}
                />
                Reset on financial year
              </label>
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
