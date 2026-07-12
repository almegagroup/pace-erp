/*
 * File-ID: 19.3.3
 * File-Path: frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockListPage.jsx
 * Gate: 19 (ACL migration)
 * Domain: PROCUREMENT
 * Purpose: ACL opening stock migration document list and create screen.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  createOpeningStockDocument,
  listOpeningStockDocuments,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";

const STATUS_OPTIONS = ["", "DRAFT", "SUBMITTED", "APPROVED", "POSTED"];
const CURRENCY_OPTIONS = ["INR", "USD"];
const MATERIAL_TYPE_OPTIONS = ["RM", "PM", "INT", "SFG", "FG"];
const PO_TYPE_OPTIONS = ["MTO", "HPS", "MTS", "MTEST"];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function OpeningStockListPage() {
  const { runtimeContext } = useMenu();
  const runtimeCompanyId = useMemo(
    () => resolveDefaultTransactionCompanyId(runtimeContext),
    [runtimeContext],
  );
  const [filters, setFilters] = useState({ company_id: runtimeCompanyId, status: "" });
  const [form, setForm] = useState({
    company_id: runtimeCompanyId,
    cut_off_date: "",
    currency_code: "INR",
    material_type: "RM",
    po_type: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const companiesQuery = useCompaniesQuery();
  const documentQuery = useQuery({
    queryKey: ["procurement", "opening-stock-documents", filters],
    queryFn: () => listOpeningStockDocuments(filters),
  });
  const companies = useMemo(
    () => (Array.isArray(companiesQuery.data) ? companiesQuery.data : []),
    [companiesQuery.data],
  );
  const rows = Array.isArray(documentQuery.data?.items)
    ? documentQuery.data.items
    : Array.isArray(documentQuery.data)
    ? documentQuery.data
    : [];
  const loading = documentQuery.isLoading || companiesQuery.isLoading;

  useEffect(() => {
    setFilters((current) => (
      current.company_id === runtimeCompanyId
        ? current
        : { ...current, company_id: runtimeCompanyId }
    ));
    setForm((current) => (
      current.company_id === runtimeCompanyId
        ? current
        : { ...current, company_id: runtimeCompanyId }
    ));
  }, [runtimeCompanyId]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([documentQuery.refetch(), companiesQuery.refetch()]),
    },
  });

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
  const queryError =
    documentQuery.error?.message ||
    companiesQuery.error?.message ||
    "";
  const requiresPoType = form.material_type === "SFG" || form.material_type === "FG";

  async function handleCreateDocument() {
    if (!form.company_id || !form.cut_off_date || !form.material_type) {
      setError("Company, cut-off date, and material type are required.");
      return;
    }

    if (requiresPoType && !form.po_type) {
      setError("PO Type is required for SFG/FG opening stock documents.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createOpeningStockDocument({
        company_id: form.company_id,
        cut_off_date: form.cut_off_date,
        currency_code: form.currency_code,
        material_type: form.material_type,
        po_type: requiresPoType ? form.po_type : null,
        notes: form.notes.trim() || null,
      });
      setNotice(`Opening stock document ${created.document_number ?? "created"} is ready in DRAFT.`);
      setForm((current) => ({
        ...current,
        cut_off_date: "",
        currency_code: "INR",
        material_type: "RM",
        po_type: "",
        notes: "",
      }));
      await Promise.all([documentQuery.refetch(), companiesQuery.refetch()]);
      if (created?.id) {
        openScreen("PROC_OPENING_STOCK_DETAIL", { context: { id: created.id } });
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_DOCUMENT_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function applyFilters(nextPatch) {
    const nextFilters = { ...filters, ...nextPatch };
    setFilters(nextFilters);
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
      eyebrow="Inventory"
      title="Opening Stock Migration"
      notices={[
        ...((error || queryError)
          ? [{ key: "opening-stock-list-error", tone: "error", message: error || queryError }]
          : []),
        ...(notice ? [{ key: "opening-stock-list-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void Promise.all([documentQuery.refetch(), companiesQuery.refetch()]),
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
                        onClick={() => {
                          openScreen("PROC_OPENING_STOCK_DETAIL", { context: { id: row.id } });
                        }}
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
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Cut-off Date" required>
                  <input
                    type="date"
                    value={form.cut_off_date}
                    onChange={(event) => setForm((current) => ({ ...current, cut_off_date: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Currency" required>
                  <select
                    value={form.currency_code}
                    onChange={(event) => setForm((current) => ({ ...current, currency_code: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {CURRENCY_OPTIONS.map((currencyCode) => (
                      <option key={currencyCode} value={currencyCode}>
                        {currencyCode}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Material Type" required>
                  <select
                    value={form.material_type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        material_type: event.target.value,
                        po_type: event.target.value === "SFG" || event.target.value === "FG"
                          ? current.po_type
                          : "",
                      }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {MATERIAL_TYPE_OPTIONS.map((materialType) => (
                      <option key={materialType} value={materialType}>
                        {materialType}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                {requiresPoType ? (
                  <ErpDenseFormRow label="PO Type" required>
                    <select
                      value={form.po_type}
                      onChange={(event) => setForm((current) => ({ ...current, po_type: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select PO Type</option>
                      {PO_TYPE_OPTIONS.map((poType) => (
                        <option key={poType} value={poType}>
                          {poType}
                        </option>
                      ))}
                    </select>
                  </ErpDenseFormRow>
                ) : (
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    PO Type is used only for SFG/FG opening stock documents.
                  </div>
                )}
              </div>
              <ErpDenseFormRow label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  className="min-h-[88px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                One document per company + cut-off date + material scope combination. Currency is stored once at document level.
              </div>
            </div>
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
