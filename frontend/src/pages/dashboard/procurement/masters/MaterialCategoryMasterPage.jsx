/*
 * File-ID: 26.5
 * File-Path: frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Material category master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  createMaterialCategory,
  listMaterialCategories,
} from "../procurementApi.js";

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

export default function MaterialCategoryMasterPage() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    category_name: "",
    description: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listMaterialCategories();
      setRows(normalizeRows(result));
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_MATERIAL_CATEGORY_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleCreate() {
    if (!form.category_name.trim()) {
      setError("Category name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createMaterialCategory({
        category_name: form.category_name.trim(),
        description: form.description.trim() || null,
      });
      setNotice("Material category created.");
      setForm({
        category_name: "",
        description: "",
      });
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_MATERIAL_CATEGORY_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Material Categories"
      notices={[
        ...(error ? [{ key: "material-category-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "material-category-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Saving..." : "Create", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <ErpSectionCard eyebrow="Register" title="Material category register">
          <ErpSelectionSection label="Existing Categories" />
          <ErpDenseGrid
            columns={[
              { key: "category_code", label: "Code", width: "120px" },
              { key: "category_name", label: "Category Name" },
              { key: "description", label: "Description" },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? row.category_code}
            emptyMessage={loading ? "Loading material categories..." : "No material categories found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create" title="Create material category">
          <ErpSelectionSection label="Create Form" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Category Name
              <input
                value={form.category_name}
                onChange={(event) => setForm((current) => ({ ...current, category_name: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Description
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[88px] border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
