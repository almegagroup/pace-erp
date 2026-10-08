/*
 * File-Path: frontend/src/pages/dashboard/procurement/grn/GRNInvoiceMappingPage.jsx
 * Domain: PROCUREMENT / GRN
 * Purpose: §3.9.2 "GRN Invoice Mapping" (feasibility doc, LOCKED 2026-10-02) — lets Store
 *   map a vendor invoice (received after the fact) onto one or more already-posted Bulk
 *   GRNs. Scenario 2 = 1 GRN : 1 Invoice; Scenario 3 = 1 Invoice : many GRNs (same invoice
 *   number stamped on every one). Never a GRN split across invoices.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openConfirmPrompt } from "../../../../store/actionPrompt.js";
import {
  checkExistingGrnInvoice,
  listGrnInvoiceMappingCandidates,
  mapGrnInvoice,
  splitGrn,
  unmapGrnInvoice,
} from "../procurementApi.js";

const PENDING_COLUMNS = [
  { key: "vendor_name", label: "Vendor Name", width: "200px", render: (row) => row.vendor_name || "—" },
  { key: "material_name", label: "Material Name", width: "220px", render: (row) => row.material_name || "—" },
  { key: "received_qty", label: "Quantity", width: "100px", align: "right", render: (row) => Number(row.received_qty ?? 0).toFixed(3) },
  { key: "grn_number", label: "GRN Number", width: "130px", render: (row) => row.grn_number || "—" },
  {
    key: "po_number",
    label: "PO Number",
    width: "130px",
    render: (row) => row.po_number || row.sto_number || "—",
    filterValue: (row) => row.po_number || row.sto_number || "—",
  },
  { key: "vehicle_number", label: "Truck Number", width: "130px", render: (row) => row.vehicle_number || "—" },
  { key: "bulk_container_number", label: "Container Number", width: "150px", render: (row) => row.bulk_container_number || "—" },
  { key: "bulk_challan_number", label: "Delivery Challan Number", width: "180px", render: (row) => row.bulk_challan_number || "—" },
];

const MAPPED_COLUMNS = [
  ...PENDING_COLUMNS,
  { key: "invoice_number", label: "Invoice Number", width: "150px", render: (row) => row.invoice_number || "—" },
  { key: "invoice_date", label: "Invoice Date", width: "110px", filterType: "date", render: (row) => row.invoice_date || "—" },
];

function getColumnFilterText(column, row) {
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
}

export default function GRNInvoiceMappingPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [tab, setTab] = useState("pending");
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceQty, setInvoiceQty] = useState("");
  const [invoiceRate, setInvoiceRate] = useState("");
  const [gstPct, setGstPct] = useState("");
  const [shipToCompanyId, setShipToCompanyId] = useState("");
  const [mapToExisting, setMapToExisting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  // §3.9.5 "GRN Split" (1 GRN : many Invoices) — Bulk-only.
  const [splitTarget, setSplitTarget] = useState(null);
  const [splitSlices, setSplitSlices] = useState([]);
  const [sliceDraft, setSliceDraft] = useState({ invoiceNumber: "", invoiceDate: "", invoiceRate: "", gstPct: "", quantity: "" });
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitError, setSplitError] = useState("");

  const listQuery = useQuery({
    queryKey: ["procurement", "grn-invoice-mapping", effectiveCompanyId, tab],
    queryFn: () => listGrnInvoiceMappingCandidates(effectiveCompanyId, tab),
    enabled: Boolean(effectiveCompanyId),
  });
  const rows = useMemo(() => (Array.isArray(listQuery.data?.items) ? listQuery.data.items : []), [listQuery.data]);
  const loading = listQuery.isLoading;
  const error = actionError || (listQuery.error instanceof Error ? listQuery.error.message : "");

  const columns = tab === "mapped" ? MAPPED_COLUMNS : PENDING_COLUMNS;

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => columns.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [rows, search, columns]);

  // Keep validation bound to every selected GRN, even after the user narrows
  // the search box and a selected CRCP row is no longer visible.
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  const selectedTotalQty = selectedRows.reduce((sum, row) => sum + Number(row.received_qty ?? 0), 0);
  const selectedNeedsShipTo = selectedRows.some((row) => row.requires_ship_to);
  const selectedShipToOptions = useMemo(() => {
    const byId = new Map();
    for (const row of selectedRows) for (const option of (row.ship_to_options ?? [])) byId.set(option.id, option);
    return [...byId.values()];
  }, [selectedRows]);
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedIds.includes(row.id));

  function toggleRow(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredRows.map((row) => row.id));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
    } else {
      setSelectedIds((current) => [...new Set([...current, ...filteredRows.map((row) => row.id)])]);
    }
  }
  function switchTab(nextTab) {
    setTab(nextTab);
    setSelectedIds([]);
    setSearch("");
    setActionError("");
    setActionNotice("");
  }

  async function handleCheckInvoice() {
    if (!invoiceNumber.trim()) { setActionError("Type an invoice number first, then click Check."); return; }
    setChecking(true);
    setActionError("");
    try {
      const existing = await checkExistingGrnInvoice(effectiveCompanyId, invoiceNumber.trim());
      setInvoiceDate(existing.invoice_date ?? "");
      setInvoiceRate(existing.invoice_rate != null ? String(existing.invoice_rate) : "");
      setGstPct(existing.gst_pct != null ? String(existing.gst_pct) : "");
      setShipToCompanyId(existing.ship_to_company_id ?? "");
    } catch (err) {
      const code = err instanceof Error ? err.message : "GRN_MAPPING_CHECK_FAILED";
      setActionError(code === "GRN_MAPPING_INVOICE_NOT_FOUND" ? "No existing GRN carries this invoice number yet." : code);
    } finally {
      setChecking(false);
    }
  }

  async function handleMap() {
    setActionError("");
    setActionNotice("");
    if (selectedIds.length === 0) { setActionError("Select at least one GRN to map."); return; }
    if (!invoiceNumber.trim() || !invoiceDate || !invoiceRate || String(gstPct).trim() === "") { setActionError("Invoice Number, Invoice Date, Rate, and GST % are all required."); return; }
    if (selectedNeedsShipTo && !shipToCompanyId) { setActionError("Ship To company is required for the selected CRCP invoice GRN(s)."); return; }
    setSaving(true);
    try {
      await mapGrnInvoice({
        grn_ids: selectedIds,
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        invoice_rate: Number(invoiceRate),
        gst_pct: Number(gstPct),
        ship_to_company_id: shipToCompanyId || null,
      });
      setSelectedIds([]);
      setInvoiceNumber(""); setInvoiceDate(""); setInvoiceQty(""); setInvoiceRate(""); setGstPct(""); setShipToCompanyId(""); setMapToExisting(false);
      setActionNotice(`${selectedIds.length} GRN${selectedIds.length === 1 ? "" : "s"} mapped to invoice successfully.`);
      await listQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["procurement", "grns"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "GRN_MAPPING_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnmap() {
    setActionError("");
    setActionNotice("");
    if (selectedIds.length === 0) { setActionError("Select at least one GRN to unmap."); return; }
    const confirmed = await openConfirmPrompt({
      eyebrow: "GRN Invoice Mapping",
      title: "Unmap this invoice?",
      message: `Unmap ${selectedIds.length} GRN${selectedIds.length === 1 ? "" : "s"} from its invoice? Valuation reverts to rate 0 until re-mapped.`,
      confirmLabel: "Unmap",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await unmapGrnInvoice({ grn_ids: selectedIds });
      setSelectedIds([]);
      setActionNotice(`${selectedIds.length} GRN${selectedIds.length === 1 ? "" : "s"} unmapped.`);
      await listQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["procurement", "grns"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "GRN_MAPPING_UNMAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const splitSlicesTotal = splitSlices.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
  const splitTargetQty = Number(splitTarget?.received_qty ?? 0);
  const splitQtyMatches = splitSlices.length >= 2 && Math.abs(splitSlicesTotal - splitTargetQty) < 0.0001;

  function openSplit(row) {
    setSplitTarget(row);
    setSplitSlices([]);
    setSliceDraft({ invoiceNumber: "", invoiceDate: "", invoiceRate: "", gstPct: "", quantity: "" });
    setSplitError("");
  }
  function closeSplit() {
    setSplitTarget(null);
    setSplitSlices([]);
    setSplitError("");
  }
  function addSlice() {
    const qty = Number(sliceDraft.quantity);
    if (!sliceDraft.invoiceNumber.trim() || !sliceDraft.invoiceDate || !sliceDraft.invoiceRate || String(sliceDraft.gstPct).trim() === "" || !qty || qty <= 0) {
      setSplitError("Every slice needs an Invoice Number, Date, Rate, GST %, and a positive Quantity.");
      return;
    }
    setSplitSlices((current) => [...current, { ...sliceDraft, invoiceNumber: sliceDraft.invoiceNumber.trim(), quantity: qty }]);
    setSliceDraft({ invoiceNumber: "", invoiceDate: "", invoiceRate: "", gstPct: "", quantity: "" });
    setSplitError("");
  }
  function removeSlice(index) {
    setSplitSlices((current) => current.filter((_, i) => i !== index));
  }

  async function handleSplit() {
    setSplitError("");
    if (!splitQtyMatches) {
      setSplitError("Slice quantities must sum exactly to the GRN's received quantity before splitting.");
      return;
    }
    setSplitSaving(true);
    try {
      await splitGrn({
        grn_id: splitTarget.id,
        slices: splitSlices.map((s) => ({
          invoice_number: s.invoiceNumber,
          invoice_date: s.invoiceDate,
          invoice_rate: Number(s.invoiceRate),
          gst_pct: Number(s.gstPct),
          quantity: Number(s.quantity),
        })),
      });
      setActionNotice(`GRN ${splitTarget.grn_number} split into ${splitSlices.length} new GRNs.`);
      closeSplit();
      await listQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["procurement", "grns"] });
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : "GRN_SPLIT_FAILED");
    } finally {
      setSplitSaving(false);
    }
  }

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => void listQuery.refetch() },
  });

  return (
    <ErpScreenScaffold
      eyebrow="Procurement → GRN"
      title="Invoice Mapping"
      notices={[
        ...(error ? [{ key: "grn-mapping-error", tone: "error", message: error }] : []),
        ...(actionNotice ? [{ key: "grn-mapping-notice", tone: "success", message: actionNotice }] : []),
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Scope" title="Company">
          <div className="max-w-sm">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => { setCompanyId(value); setSelectedIds([]); }}
              label="Company"
            />
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Invoice" title="Invoice details">
          <div className="mb-3 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={mapToExisting}
                onChange={(e) => setMapToExisting(e.target.checked)}
              />
              Map to existing Invoice
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <ErpDenseFormRow label={<>Invoice Number <span className="text-red-500">*</span></>}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                />
                {mapToExisting && (
                  <button
                    onClick={() => void handleCheckInvoice()}
                    disabled={checking}
                    className="h-9 px-3 whitespace-nowrap border border-sky-300 bg-sky-50 text-sky-700 text-sm rounded hover:bg-sky-100 disabled:opacity-50"
                  >
                    {checking ? "…" : "Check"}
                  </button>
                )}
              </div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label={<>Invoice Date <span className="text-red-500">*</span></>}>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                readOnly={mapToExisting}
                className={`h-9 w-full border px-3 text-sm outline-none ${mapToExisting ? "border-slate-200 bg-slate-100 text-slate-600" : "border-slate-300 bg-white focus:border-sky-500"}`}
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Invoice Quantity (for cross-check)">
              <input
                type="number"
                min="0"
                step="0.0001"
                placeholder="Qty as per invoice"
                value={invoiceQty}
                onChange={(e) => setInvoiceQty(e.target.value)}
                className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label={<>Rate <span className="text-red-500">*</span></>}>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={invoiceRate}
                onChange={(e) => setInvoiceRate(e.target.value)}
                readOnly={mapToExisting}
                className={`h-9 w-full border px-3 text-sm outline-none ${mapToExisting ? "border-slate-200 bg-slate-100 text-slate-600" : "border-slate-300 bg-white focus:border-sky-500"}`}
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label={<>GST % <span className="text-red-500">*</span></>}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={gstPct}
                onChange={(e) => setGstPct(e.target.value)}
                readOnly={mapToExisting}
                className={`h-9 w-full border px-3 text-sm outline-none ${mapToExisting ? "border-slate-200 bg-slate-100 text-slate-600" : "border-slate-300 bg-white focus:border-sky-500"}`}
              />
            </ErpDenseFormRow>
            {selectedNeedsShipTo && (
              <ErpDenseFormRow label={<>Ship To company <span className="text-red-500">*</span></>}>
                <select value={shipToCompanyId} onChange={(e) => setShipToCompanyId(e.target.value)} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                  <option value="">— Select —</option>
                  {selectedShipToOptions.map((company) => (
                    <option key={company.id} value={company.id}>{company.company_code} — {company.company_name}</option>
                  ))}
                </select>
              </ErpDenseFormRow>
            )}
          </div>
          {invoiceQty && (
            <p className={`mt-2 text-xs ${Math.abs(Number(invoiceQty) - selectedTotalQty) < 0.0001 ? "text-emerald-700" : "text-amber-700"}`}>
              Selected rows total: <strong>{selectedTotalQty.toFixed(4)}</strong> vs. typed Invoice Quantity: <strong>{Number(invoiceQty).toFixed(4)}</strong>
              {Math.abs(Number(invoiceQty) - selectedTotalQty) < 0.0001 ? " — match." : " — mismatch, double-check selection."}
            </p>
          )}
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="GRNs"
          title={loading ? "Loading…" : `${filteredRows.length} GRN${filteredRows.length === 1 ? "" : "s"}`}
        >
          <div className="mb-3 flex border-b border-slate-200">
            {[["pending", "Pending"], ["mapped", "Mapped"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => switchTab(key)}
                className={`px-4 py-2 text-sm border-b-2 ${tab === key ? "border-sky-500 text-sky-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search across every column…"
              className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
            />
            {search && (
              <button onClick={() => setSearch("")} className="h-9 px-3 border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50">
                Clear
              </button>
            )}
            <span className="text-xs text-slate-500">
              Selected: {selectedIds.length} · Total qty: {selectedTotalQty.toFixed(4)}
            </span>
          </div>

          <ErpDenseGrid
            columns={[
              {
                key: "__select",
                label: <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />,
                width: "40px",
                filterable: false,
                render: (row) => (
                  <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleRow(row.id)} />
                ),
              },
              ...columns,
              ...(tab === "pending" ? [{
                key: "__split",
                label: "",
                width: "80px",
                filterable: false,
                render: (row) => (
                  <button
                    onClick={() => openSplit(row)}
                    className="h-7 px-2 border border-amber-300 bg-amber-50 text-xs font-medium text-amber-800 rounded hover:bg-amber-100"
                  >
                    Split
                  </button>
                ),
              }] : []),
            ]}
            rows={filteredRows}
            rowKey={(row) => row.id}
            columnFilter
            emptyMessage={loading ? "Loading…" : effectiveCompanyId ? `No ${tab} GRNs found.` : "No company resolved for this session."}
          />

          <div className="mt-4 flex justify-end gap-2">
            {tab === "pending" ? (
              <button
                onClick={() => void handleMap()}
                disabled={saving || selectedIds.length === 0}
                className="h-9 px-4 border border-sky-700 bg-sky-100 text-sm font-semibold text-sky-950 disabled:opacity-50"
              >
                {saving ? "Mapping…" : "Map"}
              </button>
            ) : (
              <button
                onClick={() => void handleUnmap()}
                disabled={saving || selectedIds.length === 0}
                className="h-9 px-4 border border-rose-300 bg-white text-sm font-semibold text-rose-700 disabled:opacity-50"
              >
                {saving ? "Unmapping…" : "Unmap"}
              </button>
            )}
          </div>
        </ErpSectionCard>

        {splitTarget && (
          <ErpSectionCard
            eyebrow="GRN Split"
            title={`Split GRN ${splitTarget.grn_number} (${Number(splitTarget.received_qty ?? 0).toFixed(4)}) into multiple invoices`}
          >
            {splitError && (
              <div className="mb-3 border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{splitError}</div>
            )}
            <p className="mb-3 text-xs text-slate-500">
              Vendor split this one truck's material across multiple invoices. Add each invoice's own Number/Date/Rate/GST %/Quantity below — the quantities must sum exactly to this GRN's own received quantity ({Number(splitTarget.received_qty ?? 0).toFixed(4)}) before Split is enabled. Same Truck Number, Delivery Challan Number, and RST Number carry over automatically to every new GRN.
            </p>

            <div className="overflow-x-auto border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Invoice Number</th>
                    <th className="px-3 py-2 text-left">Invoice Date</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">GST %</th>
                    <th className="px-3 py-2 text-right">Quantity</th>
                    <th className="px-3 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {splitSlices.map((s, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="px-3 py-2">{s.invoiceNumber}</td>
                      <td className="px-3 py-2">{s.invoiceDate}</td>
                      <td className="px-3 py-2 text-right">{Number(s.invoiceRate).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right">{Number(s.gstPct).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{Number(s.quantity).toFixed(4)}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeSlice(i)} className="text-xs text-rose-600 hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        placeholder="Invoice Number"
                        value={sliceDraft.invoiceNumber}
                        onChange={(e) => setSliceDraft((d) => ({ ...d, invoiceNumber: e.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="date"
                        value={sliceDraft.invoiceDate}
                        onChange={(e) => setSliceDraft((d) => ({ ...d, invoiceDate: e.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={sliceDraft.invoiceRate}
                        onChange={(e) => setSliceDraft((d) => ({ ...d, invoiceRate: e.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-right outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="GST %"
                        value={sliceDraft.gstPct}
                        onChange={(e) => setSliceDraft((d) => ({ ...d, gstPct: e.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-right outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={sliceDraft.quantity}
                        onChange={(e) => setSliceDraft((d) => ({ ...d, quantity: e.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-right outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={addSlice} className="h-8 px-2 border border-sky-300 bg-sky-50 text-xs font-medium text-sky-700 rounded hover:bg-sky-100">
                        Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className={`mt-3 text-xs ${splitQtyMatches ? "text-emerald-700" : "text-amber-700"}`}>
              Slices total: <strong>{splitSlicesTotal.toFixed(4)}</strong> vs. GRN quantity: <strong>{splitTargetQty.toFixed(4)}</strong>
              {splitSlices.length < 2 ? " — add at least 2 slices." : splitQtyMatches ? " — match, ready to split." : " — mismatch."}
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeSplit} className="h-9 px-4 border border-slate-300 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => void handleSplit()}
                disabled={splitSaving || !splitQtyMatches}
                className="h-9 px-4 border border-amber-700 bg-amber-100 text-sm font-semibold text-amber-950 disabled:opacity-50"
              >
                {splitSaving ? "Splitting…" : "Split"}
              </button>
            </div>
          </ErpSectionCard>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
