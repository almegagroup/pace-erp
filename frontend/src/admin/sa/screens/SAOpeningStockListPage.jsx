/*
 * File-ID: 19.3.1
 * File-Path: frontend/src/admin/sa/screens/SAOpeningStockListPage.jsx
 * Gate: 19
 * Phase: 19
 * Domain: PROCUREMENT
 * Purpose: SA list and create screen for opening stock migration documents.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createOpeningStockDocument,
  listOpeningStockDocuments,
} from "../../../pages/dashboard/procurement/procurementApi.js";

const STATUS_OPTIONS = ["", "DRAFT", "SUBMITTED", "APPROVED", "POSTED"];
const STATUS_TONE = Object.freeze({
  DRAFT: "slate",
  SUBMITTED: "amber",
  APPROVED: "sky",
  POSTED: "emerald",
});

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
    throw new Error(json?.code ?? "COMPANY_LIST_FAILED");
  }
  return json.data.companies;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function SAOpeningStockListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [filters, setFilters] = useState({
    company_id: "",
    status: "",
  });
  const [form, setForm] = useState({
    company_id: "",
    plant_id: "",
    cut_off_date: "2026-06-30",
    notes: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyOptions = useMemo(
    () =>
      companies.map((company) => ({
        value: company.id,
        label: `${company.company_code ?? "COMP"} | ${company.company_name ?? "Company"}`,
      })),
    [companies],
  );

  const companyMap = useMemo(
    () =>
      new Map(
        companies.map((company) => [
          company.id,
          `${company.company_code ?? "COMP"} | ${company.company_name ?? "Company"}`,
        ]),
      ),
    [companies],
  );

  async function loadScreenData(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const [documentsResult, companyList] = await Promise.all([
        listOpeningStockDocuments(nextFilters),
        listCompanies(),
      ]);
      const documentRows = Array.isArray(documentsResult?.items)
        ? documentsResult.items
        : Array.isArray(documentsResult)
        ? documentsResult
        : [];
      setRows(documentRows);
      setCompanies(companyList);
      setForm((current) => ({
        ...current,
        company_id: current.company_id || companyList[0]?.id || "",
      }));
    } catch (loadError) {
      setRows([]);
      setCompanies([]);
      setError(loadError instanceof Error ? loadError.message : "OPENING_STOCK_DOCUMENT_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadScreenData(filters);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateDocument() {
    if (!form.company_id || !form.plant_id.trim() || !form.cut_off_date) {
      setError("Company, plant, and cut-off date are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createOpeningStockDocument({
        company_id: form.company_id,
        plant_id: form.plant_id.trim(),
        cut_off_date: form.cut_off_date,
        notes: form.notes.trim() || null,
      });
      setNotice(`Opening stock document ${created.document_number ?? "created"} is ready in DRAFT.`);
      setForm((current) => ({
        ...current,
        plant_id: "",
        notes: "",
      }));
      await loadScreenData(filters);
      if (created?.id) {
        openScreen("SA_OPENING_STOCK_DETAIL");
        navigate(`/sa/opening-stock/${created.id}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_DOCUMENT_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function applyFilters(nextPatch) {
    const nextFilters = { ...filters, ...nextPatch };
    setFilters(nextFilters);
    await loadScreenData(nextFilters);
  }

  const metrics = [
    {
      label: "Documents",
      value: rows.length,
      caption: "Opening stock migration documents in the current filter.",
      tone: "sky",
    },
    {
      label: "Posted",
      value: rows.filter((row) => row.status === "POSTED").length,
      caption: "Documents already pushed to stock ledger.",
      tone: "emerald",
    },
  ];

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin"
      title="Opening Stock Migration"
      notices={[
        ...(error ? [{ key: "opening-stock-list-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "opening-stock-list-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadScreenData(filters),
        },
        {
          key: "create-document",
          label: saving ? "Creating..." : "Create Document",
          tone: "primary",
          onClick: () => void handleCreateDocument(),
          disabled: saving,
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
          {metrics.map((metric) => (
            <ErpFieldPreview
              key={metric.label}
              label={metric.label}
              value={String(metric.value)}
              caption={metric.caption}
              tone={metric.tone}
            />
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <ErpSectionCard eyebrow="Register" title="Opening stock documents">
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Company Filter">
                  <select
                    value={filters.company_id}
                    onChange={(event) => void applyFilters({ company_id: event.target.value })}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">All companies</option>
                    {companyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Status Filter">
                  <select
                    value={filters.status}
                    onChange={(event) => void applyFilters({ status: event.target.value })}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status || "all"} value={status}>
                        {status || "All statuses"}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
              </div>

              <ErpDenseGrid
                columns={[
                  { key: "document_number", label: "Document #", width: "150px" },
                  {
                    key: "company",
                    label: "Company",
                    render: (row) => companyMap.get(row.company_id) ?? row.company_id,
                  },
                  { key: "plant_id", label: "Plant", width: "150px" },
                  {
                    key: "cut_off_date",
                    label: "Cut-off Date",
                    width: "120px",
                    render: (row) => formatDate(row.cut_off_date),
                  },
                  { key: "line_count", label: "Lines", width: "70px" },
                  {
                    key: "status",
                    label: "Status",
                    width: "100px",
                    render: (row) => (
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          row.status === "DRAFT"
                            ? "bg-slate-200 text-slate-800"
                            : row.status === "SUBMITTED"
                            ? "bg-amber-100 text-amber-800"
                            : row.status === "APPROVED"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {row.status}
                      </span>
                    ),
                  },
                  {
                    key: "action",
                    label: "Action",
                    width: "90px",
                    render: (row) => (
                      <button
                        type="button"
                        onClick={() => { openScreen("SA_OPENING_STOCK_DETAIL"); navigate(`/sa/opening-stock/${row.id}`); }}
                        className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Open
                      </button>
                    ),
                  },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                emptyMessage={loading ? "Loading opening stock documents..." : "No opening stock documents found."}
                maxHeight="420px"
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Create" title="New opening stock document">
            <div className="grid gap-3">
              <ErpDenseFormRow label="Company" required>
                <select
                  value={form.company_id}
                  onChange={(event) => setForm((current) => ({ ...current, company_id: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company</option>
                  {companyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Plant ID" required>
                <input
                  value={form.plant_id}
                  onChange={(event) => setForm((current) => ({ ...current, plant_id: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Cut-off Date" required>
                <input
                  type="date"
                  value={form.cut_off_date}
                  onChange={(event) => setForm((current) => ({ ...current, cut_off_date: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  className="min-h-[88px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                One document is allowed per company, plant, and cut-off date.
              </div>
            </div>
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
