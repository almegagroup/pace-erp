/*
 * File-ID: 15.14
 * File-Path: frontend/src/admin/sa/screens/SAOmUomMaster.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the SA-only UOM master list and inline create form.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createUom, listUoms } from "../../../pages/dashboard/om/omApi.js";

export default function SAOmUomMaster() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    uom_code: "",
    uom_name: "",
    uom_type: "COUNT",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listUoms({});
      setRows(Array.isArray(result?.data) ? result.data : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "OM_UOM_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  async function handleCreate() {
    if (!form.uom_code.trim() || !form.uom_name.trim() || !form.uom_type) {
      setError("OM_INVALID_UOM_CODE");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createUom({
        uom_code: form.uom_code.trim().toUpperCase(),
        uom_name: form.uom_name.trim(),
        uom_type: form.uom_type,
      });
      setForm({ uom_code: "", uom_name: "", uom_type: "COUNT" });
      setNotice("UOM created.");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_UOM_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="UOM Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Creating..." : "Create UOM", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ErpSectionCard eyebrow="UOM Register" title="All units of measure">
          <ErpDenseGrid
            columns={[
              { key: "code", label: "Code" },
              { key: "name", label: "Name" },
              { key: "uom_type", label: "Type" },
              { key: "active", label: "Active", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id || row.code}
            emptyMessage={loading ? "Loading UOM rows..." : "No UOM rows are available."}
            maxHeight="420px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create UOM" title="New unit of measure">
          <div className="grid gap-3">
            <ErpDenseFormRow label="UOM Code" required>
              <input
                value={form.uom_code}
                onChange={(event) => setForm((current) => ({ ...current, uom_code: event.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="UOM Name" required>
              <input
                value={form.uom_name}
                onChange={(event) => setForm((current) => ({ ...current, uom_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="UOM Type" required>
              <select
                value={form.uom_type}
                onChange={(event) => setForm((current) => ({ ...current, uom_type: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="COUNT">COUNT</option>
                <option value="WEIGHT">WEIGHT</option>
                <option value="VOLUME">VOLUME</option>
                <option value="LENGTH">LENGTH</option>
                <option value="PACKING">PACKING</option>
              </select>
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
