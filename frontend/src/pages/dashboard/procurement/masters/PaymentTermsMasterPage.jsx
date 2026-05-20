/*
 * File-ID: 26.2
 * File-Path: frontend/src/pages/dashboard/procurement/masters/PaymentTermsMasterPage.jsx
 * Gate: 26
 * Phase: 26
 * Domain: PROCUREMENT
 * Purpose: Payment Terms master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  createPaymentTerm,
  listPaymentTerms,
  updatePaymentTerm,
} from "../procurementApi.js";

const PAYMENT_METHOD_OPTIONS = ["CREDIT", "ADVANCE", "LC", "TT", "DA", "DP", "MIXED"];
const REFERENCE_DATE_OPTIONS = ["INVOICE_DATE", "DELIVERY_DATE"];

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function buildFormState(row) {
  return {
    name: row?.name ?? "",
    payment_method: row?.payment_method ?? "CREDIT",
    reference_date: row?.reference_date ?? "INVOICE_DATE",
    credit_days: row?.credit_days ?? 0,
    advance_pct: row?.advance_pct ?? 0,
    lc_type: row?.lc_type ?? "",
    usance_days: row?.usance_days ?? 0,
    description: row?.description ?? "",
    active: row?.active ?? true,
  };
}

export default function PaymentTermsMasterPage() {
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(buildFormState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listPaymentTerms({ is_active: "" });
      const nextRows = normalizeRows(result);
      setRows(nextRows);
      if (!selectedId && nextRows[0]?.id) {
        setSelectedId(nextRows[0].id);
        setForm(buildFormState(nextRows[0]));
      }
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PAYMENT_TERMS_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  function handleSelect(row) {
    setSelectedId(row.id);
    setForm(buildFormState(row));
    setError("");
    setNotice("");
  }

  function handleNew() {
    setSelectedId("");
    setForm(buildFormState());
    setError("");
    setNotice("");
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Payment term name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const payload = {
      name: form.name.trim(),
      payment_method: form.payment_method,
      reference_date: form.reference_date,
      credit_days: Number(form.credit_days ?? 0),
      advance_pct: Number(form.advance_pct ?? 0),
      lc_type: form.lc_type.trim() || null,
      usance_days: Number(form.usance_days ?? 0),
      description: form.description.trim() || null,
      active: form.active,
    };

    try {
      const saved = selectedId
        ? await updatePaymentTerm(selectedId, payload)
        : await createPaymentTerm(payload);
      setNotice(selectedId ? "Payment term updated." : "Payment term created.");
      await loadRows();
      if (saved?.id) {
        setSelectedId(saved.id);
        setForm(buildFormState(saved));
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PAYMENT_TERMS_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Payment Terms"
      notices={[
        ...(error ? [{ key: "payment-terms-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "payment-terms-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "new", label: "New", tone: "neutral", onClick: handleNew },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <ErpSectionCard eyebrow="Register" title="Payment terms register">
          <ErpSelectionSection label="All Terms" />
          <ErpDenseGrid
            columns={[
              { key: "code", label: "Code", width: "120px" },
              { key: "name", label: "Name" },
              { key: "payment_method", label: "Method", width: "110px" },
              { key: "credit_days", label: "Credit Days", width: "110px", render: (row) => row.credit_days ?? 0 },
              { key: "active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            getRowProps={(row) => ({
              onClick: () => handleSelect(row),
              className: row.id === selectedId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
            })}
            emptyMessage={loading ? "Loading payment terms..." : "No payment terms found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Form" title={selectedRow ? `Edit | ${selectedRow.name}` : "Create payment term"}>
          <ErpSelectionSection label="Payment Terms Form" />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
              Name
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Payment Method
              <select
                value={form.payment_method}
                onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Reference Date
              <select
                value={form.reference_date}
                onChange={(event) => setForm((current) => ({ ...current, reference_date: event.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                {REFERENCE_DATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Credit Days
              <input
                type="number"
                min="0"
                value={form.credit_days}
                onChange={(event) => setForm((current) => ({ ...current, credit_days: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Advance %
              <input
                type="number"
                min="0"
                value={form.advance_pct}
                onChange={(event) => setForm((current) => ({ ...current, advance_pct: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              LC Type
              <input
                value={form.lc_type}
                onChange={(event) => setForm((current) => ({ ...current, lc_type: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Usance Days
              <input
                type="number"
                min="0"
                value={form.usance_days}
                onChange={(event) => setForm((current) => ({ ...current, usance_days: event.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              />
              Active
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
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
