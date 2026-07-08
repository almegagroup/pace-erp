/*
 * File-ID: 26.7
 * File-Path: frontend/src/pages/dashboard/procurement/masters/DomesticLeadTimeMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Domestic lead time master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import {
  listDomesticLeadTimes,
  upsertDomesticLeadTime,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

export default function DomesticLeadTimeMasterPage() {
  const [form, setForm] = useState({
    company_id: "",
    material_category_id: "",
    transit_days: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const companiesQuery = useCompaniesQuery();
  const rowQuery = useQuery({
    queryKey: ["procurement", "domestic-lead-times"],
    queryFn: async () => normalizeRows(await listDomesticLeadTimes()),
  });
  const rows = rowQuery.data ?? [];
  const companies = Array.isArray(companiesQuery.data) ? companiesQuery.data : [];
  const loading = rowQuery.isLoading || companiesQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([rowQuery.refetch(), companiesQuery.refetch()]),
    },
  });

  useEffect(() => {
    setError(rowQuery.error?.message || companiesQuery.error?.message || "");
  }, [companiesQuery.error, rowQuery.error]);

  async function handleSave() {
    if (!form.company_id || !form.material_category_id.trim() || form.transit_days === "") {
      setError("Company, material category ID, and transit days are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await upsertDomesticLeadTime({
        company_id: form.company_id,
        material_category_id: form.material_category_id.trim(),
        transit_days: Number(form.transit_days),
      });
      setNotice("Domestic lead time saved.");
      setForm({
        company_id: "",
        material_category_id: "",
        transit_days: "",
      });
      await Promise.all([rowQuery.refetch(), companiesQuery.refetch()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_DOMESTIC_LEAD_TIME_UPSERT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Domestic Lead Times"
      notices={[
        ...(error ? [{ key: "domestic-lead-time-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "domestic-lead-time-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void Promise.all([rowQuery.refetch(), companiesQuery.refetch()]),
        },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <ErpSectionCard eyebrow="Register" title="Domestic lead time register">
          <ErpSelectionSection label="Existing Domestic Lead Times" />
          <ErpDenseGrid
            columns={[
              { key: "company_id", label: "Company", render: (row) => row.company?.company_code || row.company_id },
              { key: "material_category_id", label: "Material Category ID" },
              { key: "transit_days", label: "Transit Days", width: "110px" },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? `${row.company_id}:${row.material_category_id}`}
            emptyMessage={loading ? "Loading domestic lead times..." : "No domestic lead times found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Upsert" title="Save domestic lead time">
          <ErpSelectionSection label="Domestic Lead Time Form" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Company
              <select
                value={form.company_id}
                onChange={(event) => setForm((current) => ({ ...current, company_id: event.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">Select company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_code} | {company.company_name}
                  </option>
                ))}
              </select>
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
              Transit Days
              <input
                type="number"
                min="0"
                value={form.transit_days}
                onChange={(event) => setForm((current) => ({ ...current, transit_days: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
