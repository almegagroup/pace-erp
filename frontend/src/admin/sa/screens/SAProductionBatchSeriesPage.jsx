/*
 * File-ID: 27.SA-01
 * File-Path: frontend/src/admin/sa/screens/SAProductionBatchSeriesPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: SA-only batch series setup aligned with backend numbering methods.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { listBatchSeries, createBatchSeries, updateBatchSeries } from "../../../pages/dashboard/production/prodApi.js";
import { listCompaniesForOm, listMaterials } from "../../../pages/dashboard/om/omApi.js";

const BATCH_TYPES = [
  { value: "MTO", label: "MTO - Admix (company-level)" },
  { value: "HPS", label: "HPS - Hypershot (company-level)" },
  { value: "MTS", label: "MTS - IWC + Powder (per Prodshade)" },
  { value: "MTEST", label: "MTEST - Test batch (company-level)" },
];

const NUMBERING_METHOD_OPTIONS = [
  { value: "PLAIN", label: "Plain" },
  { value: "CONTINUOUS_DATE", label: "Continuous + Date" },
  { value: "MONTHLY_RESET_MONYY", label: "Monthly Reset" },
];

const ERRORS = {
  PROD_BATCH_SERIES_INVALID: "Company, batch type, and prefix are required.",
  PROD_BATCH_SERIES_PRODSHADE_REQUIRED: "Prodshade is required for MTS.",
  PROD_BATCH_SERIES_EXISTS: "A series for this company/type/prodshade already exists.",
  PROD_SA_REQUIRED: "Super Admin access required.",
};

const EMPTY_FORM = {
  company_id: "",
  batch_type: "MTO",
  prodshade_material_id: "",
  prefix: "",
  current_count: "0",
  numbering_method: "PLAIN",
  serial_pad_width: "5",
};

function friendly(code) {
  return ERRORS[code] ?? code;
}

function requiresProdshade(batchType) {
  return batchType === "MTS";
}

export default function SAProductionBatchSeriesPage() {
  const qc = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editSeries, setEditSeries] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editDraft, setEditDraft] = useState({});

  function toast(message, tone = "success") {
    pushToast({ message, tone });
  }

  const companiesQ = useQuery({
    queryKey: ["om-companies"],
    queryFn: () => listCompaniesForOm(),
  });
  const sfgMaterialsQ = useQuery({
    queryKey: ["om-materials", "SFG"],
    queryFn: () => listMaterials({ material_type: "SFG", limit: 500 }),
    select: (data) => data?.data ?? [],
  });
  const intMaterialsQ = useQuery({
    queryKey: ["om-materials", "INT"],
    queryFn: () => listMaterials({ material_type: "INT", limit: 500 }),
    select: (data) => data?.data ?? [],
  });

  const companies = companiesQ.data ?? [];
  const prodshadeMaterials = [...(sfgMaterialsQ.data ?? []), ...(intMaterialsQ.data ?? [])];
  const companyOptions = companies.map((company) => ({
    value: company.id,
    label: `${company.company_code} - ${company.company_name}`,
  }));
  const companyLabelById = new Map(companies.map((company) => [company.id, `${company.company_code} - ${company.company_name}`]));
  const prodshadeOptions = prodshadeMaterials.map((material) => ({
    value: material.id,
    label: `${material.pace_code ?? "-"} - ${material.material_name ?? ""}`,
  }));

  const listQ = useQuery({
    queryKey: ["batch-series", companyFilter],
    queryFn: () => listBatchSeries({ company_id: companyFilter || undefined }),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const series = listQ.data ?? [];

  async function handleCreate(event) {
    event.preventDefault();
    if (!form.company_id || !form.prefix.trim()) {
      toast("Company and prefix are required.", "error");
      return;
    }
    if (requiresProdshade(form.batch_type) && !form.prodshade_material_id) {
      toast("Prodshade is required for MTS.", "error");
      return;
    }

    setSaving(true);
    try {
      await createBatchSeries({
        company_id: form.company_id,
        batch_type: form.batch_type,
        prefix: form.prefix,
        current_count: parseInt(form.current_count, 10) || 0,
        numbering_method: form.numbering_method,
        serial_pad_width: parseInt(form.serial_pad_width, 10) || 5,
        prodshade_material_id: requiresProdshade(form.batch_type) ? form.prodshade_material_id : null,
      });
      toast("Batch series created.");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["batch-series"] });
    } catch (error) {
      toast(friendly(error.code) || error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(seriesRow) {
    setEditSeries(seriesRow);
    setEditDraft({
      prefix: seriesRow.prefix,
      current_count: String(seriesRow.current_count ?? 0),
      active: seriesRow.active,
      numbering_method: seriesRow.numbering_method || "PLAIN",
      serial_pad_width: String(seriesRow.serial_pad_width ?? 5),
    });
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateBatchSeries(editSeries.id, {
        prefix: editDraft.prefix,
        current_count: parseInt(editDraft.current_count, 10),
        active: editDraft.active,
        numbering_method: editDraft.numbering_method,
        serial_pad_width: parseInt(editDraft.serial_pad_width, 10) || 5,
      });
      toast("Series updated.");
      setEditSeries(null);
      qc.invalidateQueries({ queryKey: ["batch-series"] });
    } catch (error) {
      toast(friendly(error.code) || error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Production Batch Series"
      subtitle="SA - configure company-wise batch series, numbering method, and digit width."
      actions={[{
        label: "New Series",
        tone: "primary",
        mnemonic: "N",
        onClick: () => {
          setForm({ ...EMPTY_FORM });
          setCreateOpen(true);
        },
      }]}
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-3">
          <div className="flex w-64 flex-col gap-1">
            <label className="text-xs text-slate-500">Company</label>
            <ErpComboboxField
              value={companyFilter}
              onChange={setCompanyFilter}
              options={companyOptions}
              placeholder="-- All companies --"
            />
          </div>
        </div>

        {listQ.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading...</p>
        ) : series.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No batch series configured. Press <kbd className="rounded border bg-slate-100 px-1 text-xs">Alt+N</kbd> to create.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="border-b px-3 py-2 text-left">Company</th>
                <th className="border-b px-3 py-2 text-left">Type</th>
                <th className="border-b px-3 py-2 text-left">Prodshade</th>
                <th className="border-b px-3 py-2 text-left">Prefix</th>
                <th className="border-b px-3 py-2 text-left">Method</th>
                <th className="border-b px-3 py-2 text-right">Digits</th>
                <th className="border-b px-3 py-2 text-right">Current Count</th>
                <th className="border-b px-3 py-2 text-left">Next Batch</th>
                <th className="border-b px-3 py-2 text-left">Active</th>
                <th className="border-b px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {series.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-600">{companyLabelById.get(row.company_id) ?? "-"}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{row.batch_type}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {row.material ? `${row.material.pace_code ?? "-"} - ${row.material.material_name ?? ""}` : "Company-level"}
                  </td>
                  <td className="px-3 py-2 font-mono font-semibold">{row.prefix}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {NUMBERING_METHOD_OPTIONS.find((option) => option.value === row.numbering_method)?.label ?? (row.numbering_method || "PLAIN")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{row.serial_pad_width ?? 5}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.current_count}</td>
                  <td className="px-3 py-2 font-mono text-slate-400">{row.next_batch_preview || "-"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {row.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => openEdit(row)} className="text-xs text-sky-600 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      <DrawerBase visible={createOpen} title="New Batch Series" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company <span className="text-rose-500">*</span></label>
            <ErpComboboxField value={form.company_id} onChange={(value) => setForm((current) => ({ ...current, company_id: value }))} options={companyOptions} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Batch Type <span className="text-rose-500">*</span></label>
            <select
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={form.batch_type}
              onChange={(event) => setForm((current) => ({ ...current, batch_type: event.target.value, prodshade_material_id: "" }))}
            >
              {BATCH_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          {requiresProdshade(form.batch_type) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prodshade <span className="text-rose-500">*</span></label>
              <ErpComboboxField
                value={form.prodshade_material_id}
                onChange={(value) => setForm((current) => ({ ...current, prodshade_material_id: value }))}
                options={prodshadeOptions}
                emptyStateLabel="No SFG/INT prodshades found"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Prefix <span className="text-rose-500">*</span></label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
              value={form.prefix}
              onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value.toUpperCase() }))}
              required
              placeholder="e.g. BM"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Numbering Method <span className="text-rose-500">*</span></label>
              <select
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={form.numbering_method}
                onChange={(event) => setForm((current) => ({ ...current, numbering_method: event.target.value }))}
              >
                {NUMBERING_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Serial Digits <span className="text-rose-500">*</span></label>
              <input
                type="number"
                min="1"
                max="10"
                className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                value={form.serial_pad_width}
                onChange={(event) => setForm((current) => ({ ...current, serial_pad_width: event.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Starting Count</label>
            <input
              type="number"
              min="0"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
              value={form.current_count}
              onChange={(event) => setForm((current) => ({ ...current, current_count: event.target.value }))}
            />
            <p className="text-xs text-slate-400">Backend will generate the next preview using these rules.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="rounded bg-sky-600 px-5 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">Create Series</button>
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600">Cancel</button>
          </div>
        </form>
      </DrawerBase>

      <DrawerBase visible={!!editSeries} title={editSeries ? `Edit: ${editSeries.prefix}` : ""} onClose={() => setEditSeries(null)}>
        {editSeries && (
          <form onSubmit={handleSaveEdit} className="flex flex-col gap-4 p-4">
            <div className="space-y-1 rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <p><span className="font-medium">Company:</span> {companyLabelById.get(editSeries.company_id) ?? "-"}</p>
              <p><span className="font-medium">Type:</span> {editSeries.batch_type}</p>
              {editSeries.material && <p><span className="font-medium">Prodshade:</span> {editSeries.material.pace_code ?? "-"} - {editSeries.material.material_name ?? ""}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Prefix</label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                value={editDraft.prefix}
                onChange={(event) => setEditDraft((current) => ({ ...current, prefix: event.target.value.toUpperCase() }))}
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Numbering Method</label>
                <select
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={editDraft.numbering_method}
                  onChange={(event) => setEditDraft((current) => ({ ...current, numbering_method: event.target.value }))}
                >
                  {NUMBERING_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Serial Digits</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  value={editDraft.serial_pad_width}
                  onChange={(event) => setEditDraft((current) => ({ ...current, serial_pad_width: event.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Current Count</label>
              <input
                type="number"
                min="0"
                className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                value={editDraft.current_count}
                onChange={(event) => setEditDraft((current) => ({ ...current, current_count: event.target.value }))}
              />
              <p className="text-xs text-slate-400">Save to refresh backend-calculated next batch preview.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="active"
                type="checkbox"
                checked={editDraft.active}
                onChange={(event) => setEditDraft((current) => ({ ...current, active: event.target.checked }))}
                className="rounded"
              />
              <label htmlFor="active" className="text-sm text-slate-700">Active</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="rounded bg-sky-600 px-5 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">Save Changes</button>
              <button type="button" onClick={() => setEditSeries(null)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600">Cancel</button>
            </div>
          </form>
        )}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
