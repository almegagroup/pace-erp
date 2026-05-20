import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  createPaymentTerm,
  listPaymentTerms,
  updatePaymentTerm,
} from "../../../pages/dashboard/procurement/procurementApi.js";

const PAYMENT_METHOD_OPTIONS = ["CREDIT", "ADVANCE", "LC", "TT", "DA", "DP", "MIXED"];
const REFERENCE_DATE_OPTIONS = ["INVOICE_DATE", "DELIVERY_DATE"];

function buildFormState(row) {
  return {
    name: row?.name ?? "",
    payment_method: row?.payment_method ?? "CREDIT",
    reference_date: row?.reference_date ?? "INVOICE_DATE",
    credit_days: row?.credit_days ?? "",
    advance_pct: row?.advance_pct ?? "",
    lc_type: row?.lc_type ?? "",
    usance_days: row?.usance_days ?? "",
    description: row?.description ?? "",
    is_active: row?.active ?? true,
  };
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
      <div className="w-full max-w-2xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default function SAPaymentTermsMaster() {
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [form, setForm] = useState(buildFormState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId]
  );

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const data = await listPaymentTerms({ is_active: "" });
      const nextRows = Array.isArray(data) ? data : [];
      setRows(nextRows);
      setSelectedId((current) => current || nextRows[0]?.id || "");
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

  function openCreateModal() {
    setModalMode("create");
    setForm(buildFormState());
    setModalOpen(true);
  }

  function openEditModal() {
    if (!selectedRow) {
      setError("Select a payment term before editing.");
      return;
    }
    setModalMode("edit");
    setForm(buildFormState(selectedRow));
    setModalOpen(true);
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
      credit_days: form.credit_days === "" ? null : Number(form.credit_days),
      advance_pct: form.advance_pct === "" ? null : Number(form.advance_pct),
      lc_type: form.lc_type.trim() || null,
      usance_days: form.usance_days === "" ? null : Number(form.usance_days),
      description: form.description.trim() || null,
      active: form.is_active,
    };

    try {
      let saved;
      if (modalMode === "edit" && selectedRow) {
        saved = await updatePaymentTerm(selectedRow.id, payload);
        setNotice(`Payment terms updated: ${saved?.code ?? selectedRow.code ?? "updated"}`);
      } else {
        saved = await createPaymentTerm(payload);
        setNotice(`Payment terms created: ${saved?.code ?? "PT-generated"}`);
      }
      setModalOpen(false);
      await loadRows();
      if (saved?.id) {
        setSelectedId(saved.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PAYMENT_TERMS_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Procurement"
      title="Payment Terms Master"
      notices={[
        ...(error ? [{ key: "payment-terms-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "payment-terms-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: "Create", tone: "primary", onClick: openCreateModal },
        { key: "edit", label: "Edit", tone: "neutral", onClick: openEditModal, disabled: !selectedRow },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <ErpSectionCard eyebrow="Register" title="Payment terms register">
          <ErpSelectionSection label="Available Terms" />
          <ErpDenseGrid
            columns={[
              { key: "code", label: "Code", width: "120px" },
              { key: "name", label: "Name" },
              { key: "payment_method", label: "Payment Method", width: "110px" },
              { key: "credit_days", label: "Credit Days", width: "96px", render: (row) => row.credit_days ?? "—" },
              { key: "is_active", label: "Active", width: "80px", render: (row) => (row.active ? "YES" : "NO") },
            ]}
            rows={rows}
            rowKey={(row) => row.id ?? row.code}
            getRowProps={(row) => ({
              onClick: () => setSelectedId(row.id),
              className: row.id === selectedId ? "!bg-sky-50 !border-l-[3px] !border-l-sky-600" : undefined,
            })}
            emptyMessage={loading ? "Loading payment terms..." : "No payment terms found."}
            maxHeight="460px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Selection" title={selectedRow ? `${selectedRow.code} | ${selectedRow.name}` : "Choose payment terms"}>
          {selectedRow ? (
            <div className="grid gap-2 text-[12px] text-slate-700">
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Payment Method</span>
                <strong>{selectedRow.payment_method}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Reference Date</span>
                <strong>{selectedRow.reference_date ?? "INVOICE_DATE"}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Advance %</span>
                <strong>{selectedRow.advance_pct ?? "—"}</strong>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 py-1">
                <span>Usance Days</span>
                <strong>{selectedRow.usance_days ?? "—"}</strong>
              </div>
              <div className="flex items-start justify-between gap-4 py-1">
                <span>Description</span>
                <strong className="text-right">{selectedRow.description || "—"}</strong>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a row to inspect or edit a payment term.</p>
          )}
        </ErpSectionCard>
      </div>

      {modalOpen ? (
        <ModalShell title={modalMode === "edit" ? "Edit Payment Terms" : "Create Payment Terms"} onClose={() => setModalOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Name
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Payment Method
              <select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                {PAYMENT_METHOD_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Reference Date
              <select value={form.reference_date} onChange={(event) => setForm((current) => ({ ...current, reference_date: event.target.value }))} className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                {REFERENCE_DATE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Credit Days
              <input type="number" min="0" value={form.credit_days} onChange={(event) => setForm((current) => ({ ...current, credit_days: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Advance %
              <input type="number" min="0" max="100" step="0.01" value={form.advance_pct} onChange={(event) => setForm((current) => ({ ...current, advance_pct: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              LC Type
              <input value={form.lc_type} onChange={(event) => setForm((current) => ({ ...current, lc_type: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Usance Days
              <input type="number" min="0" value={form.usance_days} onChange={(event) => setForm((current) => ({ ...current, usance_days: event.target.value }))} className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="flex items-center gap-2 self-end text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
              Active
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
              Description
              <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[88px] border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm outline-none focus:border-sky-500" />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={() => void handleSave()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving..." : modalMode === "edit" ? "Save Changes" : "Create Payment Terms"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </ErpScreenScaffold>
  );
}
