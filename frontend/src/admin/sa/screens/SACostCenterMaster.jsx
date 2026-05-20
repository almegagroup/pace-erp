/*
 * File-ID: 12B.7
 * File-Path: frontend/src/admin/sa/screens/SACostCenterMaster.jsx
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: SA screen - Cost Center master list and create.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createCostCenter, listCostCenters } from "../../../pages/dashboard/om/omApi.js";

export default function SACostCenterMaster() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    company_id: "",
    cost_center_code: "",
    cost_center_name: "",
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
      const result = await listCostCenters();
      setRows(Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "OM_CC_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleCreate() {
    if (!form.company_id.trim() || !form.cost_center_code.trim() || !form.cost_center_name.trim()) {
      setError("OM_CC_CREATE_FAILED");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createCostCenter({
        company_id: form.company_id.trim(),
        cost_center_code: form.cost_center_code.trim().toUpperCase(),
        cost_center_name: form.cost_center_name.trim(),
        description: form.description.trim() || null,
      });
      setForm({
        company_id: "",
        cost_center_code: "",
        cost_center_name: "",
        description: "",
      });
      setNotice("Cost center created.");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_CC_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="Cost Center Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Creating..." : "Create Cost Center", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ErpSectionCard eyebrow="Cost Center Register" title="All cost centers">
          <ErpDenseGrid
            columns={[
              { key: "cost_center_code", label: "Code" },
              { key: "cost_center_name", label: "Name" },
              { key: "description", label: "Description", render: (row) => row.description || "—" },
              {
                key: "active",
                label: "Active",
                render: (row) => (
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                    {row.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                ),
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id || `${row.company_id}:${row.cost_center_code}`}
            emptyMessage={loading ? "Loading cost center rows..." : "No cost center rows are available."}
            maxHeight="420px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Cost Center" title="New cost center">
          <div className="grid gap-3">
            <ErpDenseFormRow label="Company ID" required>
              <input
                value={form.company_id}
                onChange={(event) => setForm((current) => ({ ...current, company_id: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Cost Center Code" required>
              <input
                value={form.cost_center_code}
                onChange={(event) => setForm((current) => ({ ...current, cost_center_code: event.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Cost Center Name" required>
              <input
                value={form.cost_center_name}
                onChange={(event) => setForm((current) => ({ ...current, cost_center_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Description">
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[72px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
