/*
 * File-ID: 15.10
 * File-Path: frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render approved source list detail, edit, and status workflows, including
 *          the per-pair UOM, currency, and payment term lists.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { CURRENCY_OPTIONS } from "../../../../data/currencyOptions.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useUomsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import {
  changeVendorMaterialInfoStatus,
  getVendorMaterialInfo,
  unmapVendorMaterialInfo,
  updateVendorMaterialInfo,
} from "../omApi.js";

const ASL_TRANSITIONS = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT"],
  ACTIVE: ["INACTIVE", "BLOCKED"],
  INACTIVE: ["ACTIVE"],
  BLOCKED: ["ACTIVE"],
};

function makeUomRow(source) {
  return {
    key: crypto.randomUUID(),
    uom_code: source?.uom_code ?? "",
    conversion_factor: String(source?.conversion_factor ?? "1"),
    is_default: source?.is_default ?? false,
  };
}

function makeCurrencyRow(source) {
  return {
    key: crypto.randomUUID(),
    currency_code: source?.currency_code ?? "",
    is_default: source?.is_default ?? false,
  };
}

function makePaymentTermRow(source) {
  return {
    key: crypto.randomUUID(),
    payment_term_id: source?.payment_term_id ?? "",
    is_default: source?.is_default ?? false,
  };
}

function withSingleDefault(rows, key) {
  return rows.map((row) => (row.key === key ? { ...row, is_default: true } : { ...row, is_default: false }));
}

export default function AslDetailPage() {
  const [searchParams] = useSearchParams();
  const context = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchId = searchParams.get("id");
  const id = searchId || context.id || "";
  const [form, setForm] = useState(null);
  const [uomRows, setUomRows] = useState([]);
  const [currencyRows, setCurrencyRows] = useState([]);
  const [paymentTermRows, setPaymentTermRows] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [confirmUnmap, setConfirmUnmap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailQuery = useQuery({
    queryKey: ["om", "asl-detail", id],
    queryFn: async () => {
      const result = await getVendorMaterialInfo({ id });
      return result?.data ?? null;
    },
    enabled: Boolean(id),
  });
  const uomQuery = useUomsQuery({ is_active: true });
  const paymentTermQuery = usePaymentTermOptionsQuery();
  const record = detailQuery.data ?? null;
  const uoms = Array.isArray(uomQuery.data?.data) ? uomQuery.data.data : [];
  const paymentTerms = paymentTermQuery.paymentTerms;
  const loading = detailQuery.isLoading || uomQuery.isLoading || paymentTermQuery.isLoading;

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    if (!record) {
      return;
    }
    setForm({
      vendor_material_code: record.vendor_material_code ?? "",
      pack_size_description: record.pack_size_description ?? "",
    });
    setUomRows((record.uoms ?? []).map((entry) => makeUomRow(entry)));
    setCurrencyRows((record.currencies ?? []).map((entry) => makeCurrencyRow(entry)));
    setPaymentTermRows((record.payment_terms ?? []).map((entry) => makePaymentTermRow(entry)));
  }, [record]);

  useEffect(() => {
    setError(
      (!id ? "OM_VMI_NOT_FOUND" : "") ||
      detailQuery.error?.message ||
      uomQuery.error?.message ||
      paymentTermQuery.error?.message ||
      ""
    );
  }, [detailQuery.error, id, paymentTermQuery.error, uomQuery.error]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateUomRow(key, field, value) {
    setUomRows((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function updateCurrencyRow(key, field, value) {
    setCurrencyRows((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function updatePaymentTermRow(key, field, value) {
    setPaymentTermRows((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  async function handleSave() {
    if (!record?.id || !form) {
      return;
    }
    const validUoms = uomRows.filter((row) => row.uom_code && Number(row.conversion_factor) > 0);
    if (validUoms.length === 0) {
      setError("OM_INVALID_UOM");
      return;
    }
    const validCurrencies = currencyRows.filter((row) => row.currency_code);
    if (validCurrencies.length === 0) {
      setError("OM_INVALID_CURRENCY");
      return;
    }
    const validPaymentTerms = paymentTermRows.filter((row) => row.payment_term_id);

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateVendorMaterialInfo({
        id: record.id,
        vendor_material_code: form.vendor_material_code,
        pack_size_description: form.pack_size_description,
        uoms: validUoms.map((row) => ({
          uom_code: row.uom_code,
          conversion_factor: Number(row.conversion_factor),
          is_default: row.is_default,
        })),
        currencies: validCurrencies.map((row) => ({
          currency_code: row.currency_code,
          is_default: row.is_default,
        })),
        payment_terms: validPaymentTerms.map((row) => ({
          payment_term_id: row.payment_term_id,
          is_default: row.is_default,
        })),
      });
      if (result?.data) {
        await detailQuery.refetch();
      }
      setEditMode(false);
      setNotice("ASL row updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VMI_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const allowedTargets = ASL_TRANSITIONS[String(record?.status || "").toUpperCase()] ?? [];

  async function handleUnmap() {
    if (!record?.id) {
      return;
    }
    if (!confirmUnmap) {
      setConfirmUnmap(true);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await unmapVendorMaterialInfo(record.id);
      openScreen(OPERATION_SCREENS.OM_ASL_LIST.screen_code, { mode: "replace" });
    } catch (unmapError) {
      setError(unmapError instanceof Error ? unmapError.message : "OM_VMI_UNMAP_FAILED");
      setConfirmUnmap(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus) {
    if (!record?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await changeVendorMaterialInfoStatus({
        id: record.id,
        new_status: newStatus,
      });
      if (result?.data) {
        await detailQuery.refetch();
      }
      setNotice(`ASL row moved to ${newStatus}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OM_VMI_STATUS_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Approved Source Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((current) => !current), disabled: loading || !record },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving || !editMode },
        {
          key: "unmap",
          label: saving ? "Working..." : confirmUnmap ? "Confirm Unmap" : "Unmap",
          tone: "danger",
          onClick: () => void handleUnmap(),
          disabled: saving || !record,
        },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
        ...(confirmUnmap
          ? [{ key: "confirm-unmap", tone: "info", message: "Click \"Confirm Unmap\" again to permanently remove this vendor-material link and its UOM/currency/payment-term lists." }]
          : []),
      ]}
    >
      {loading || !record || !form ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading approved source detail..." : "Approved source detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard
            eyebrow="Header"
            title={`${record.vendor_code ?? record.vendor_id} | ${record.pace_code ?? record.material_id}`}
          >
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <ErpFieldPreview label="Vendor" value={record.vendor_name ?? record.vendor_code ?? "-"} />
              <ErpFieldPreview label="Material" value={record.material_name ?? record.pace_code ?? "-"} />
              <ErpFieldPreview label="Status" value={record.status} tone="sky" />
              <ErpFieldPreview label="Base UOM (Material Master)" value={record.base_uom_code ?? "-"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="View Or Edit" title="Vendor reference">
            {editMode ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Vendor Material Code">
                  <input
                    value={form.vendor_material_code}
                    onChange={(event) => setField("vendor_material_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Pack Size Description">
                  <input
                    value={form.pack_size_description}
                    onChange={(event) => setField("pack_size_description", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview label="Vendor Material Code" value={record.vendor_material_code} />
                <ErpFieldPreview label="Pack Description" value={record.pack_size_description} />
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Procurement" title="Valid delivery UOMs (vendor-specific)">
            {editMode ? (
              <div className="grid gap-2">
                {uomRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <select
                      value={row.uom_code}
                      onChange={(event) => updateUomRow(row.key, "uom_code", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select UOM</option>
                      {uoms.map((entry) => (
                        <option key={entry.id || entry.code} value={entry.code}>
                          {entry.code} | {entry.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={row.conversion_factor}
                      onChange={(event) => updateUomRow(row.key, "conversion_factor", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="radio"
                        name="detail-uom-default"
                        checked={row.is_default}
                        onChange={() => setUomRows((rows) => withSingleDefault(rows, row.key))}
                      />
                      Default
                    </label>
                    <button
                      type="button"
                      onClick={() => setUomRows((rows) => rows.filter((entry) => entry.key !== row.key))}
                      disabled={uomRows.length === 1}
                      className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setUomRows((rows) => [...rows, makeUomRow()])}
                  className="w-fit border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  + Add UOM
                </button>
              </div>
            ) : (
              <div className="grid gap-1">
                {(record.uoms ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">No UOM linked.</p>
                ) : (
                  (record.uoms ?? []).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 text-sm">
                      <span className="font-semibold text-slate-900">{entry.uom_code}</span>
                      <span className="text-slate-600">1 {entry.uom_code} = {entry.conversion_factor} {record.base_uom_code}</span>
                      {entry.is_default ? <span className="text-xs font-semibold uppercase text-sky-700">Default</span> : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Procurement" title="Valid currencies">
            {editMode ? (
              <div className="grid gap-2">
                {currencyRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                    <select
                      value={row.currency_code}
                      onChange={(event) => updateCurrencyRow(row.key, "currency_code", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select currency</option>
                      {CURRENCY_OPTIONS.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {entry.code} | {entry.country}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="radio"
                        name="detail-currency-default"
                        checked={row.is_default}
                        onChange={() => setCurrencyRows((rows) => withSingleDefault(rows, row.key))}
                      />
                      Default
                    </label>
                    <button
                      type="button"
                      onClick={() => setCurrencyRows((rows) => rows.filter((entry) => entry.key !== row.key))}
                      disabled={currencyRows.length === 1}
                      className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCurrencyRows((rows) => [...rows, makeCurrencyRow()])}
                  className="w-fit border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  + Add Currency
                </button>
              </div>
            ) : (
              <div className="grid gap-1">
                {(record.currencies ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">No currency linked.</p>
                ) : (
                  (record.currencies ?? []).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 text-sm">
                      <span className="font-semibold text-slate-900">{entry.currency_code}</span>
                      {entry.is_default ? <span className="text-xs font-semibold uppercase text-sky-700">Default</span> : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Procurement" title="Payment terms (optional)">
            {editMode ? (
              <div className="grid gap-2">
                {paymentTermRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                    <select
                      value={row.payment_term_id}
                      onChange={(event) => updatePaymentTermRow(row.key, "payment_term_id", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select payment term</option>
                      {paymentTerms.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.code} | {entry.name}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="radio"
                        name="detail-payment-term-default"
                        checked={row.is_default}
                        onChange={() => setPaymentTermRows((rows) => withSingleDefault(rows, row.key))}
                      />
                      Default
                    </label>
                    <button
                      type="button"
                      onClick={() => setPaymentTermRows((rows) => rows.filter((entry) => entry.key !== row.key))}
                      className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPaymentTermRows((rows) => [...rows, makePaymentTermRow()])}
                  className="w-fit border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  + Add Payment Term
                </button>
              </div>
            ) : (
              <div className="grid gap-1">
                {(record.payment_terms ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">No payment term linked — PO will use this vendor's last-used term.</p>
                ) : (
                  (record.payment_terms ?? []).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 text-sm">
                      <span className="font-semibold text-slate-900">{entry.payment_term_code} | {entry.payment_term_name}</span>
                      {entry.is_default ? <span className="text-xs font-semibold uppercase text-sky-700">Default</span> : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lifecycle" title="Status actions">
            <div className="flex flex-wrap gap-2">
              {allowedTargets.length === 0 ? (
                <div className="text-sm text-slate-500">No status change is allowed from the current state.</div>
              ) : (
                allowedTargets.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => void handleStatusChange(entry)}
                    disabled={saving}
                    className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
                  >
                    Move To {entry}
                  </button>
                ))
              )}
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
