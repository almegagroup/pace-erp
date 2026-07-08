import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import LocationSelect from "../../../../components/inputs/LocationSelect.jsx";
import { popScreen, openScreen } from "../../../../navigation/screenStackEngine.js";
import { isRouteAllowed } from "../../../../router/routeIndex.js";
import { useMenu } from "../../../../context/useMenu.js";
import { getGELinesForGRN, createAndPostGRNFromLine, getMaterialVendorDocNames, listTransporters } from "../procurementApi.js";

const TABS = ["Receipt", "Vendor", "Documents", "Material", "Accounts", "Transporter", "Pack & shelf life"];

function statusBadge(status) {
  if (status === "DONE") return <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800">DONE</span>;
  if (status === "DRAFT") return <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sky-100 text-sky-800">DRAFT</span>;
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">PENDING</span>;
}

// ── Screen 1: GE number entry ────────────────────────────────────────────────
function GENumberEntryScreen({ onLoad }) {
  const [geNumber, setGeNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLoad() {
    const trimmed = geNumber.trim().toUpperCase();
    if (!trimmed) { setError("GE number is required."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await getGELinesForGRN(trimmed);
      onLoad(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gate entry not found.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === "F8") { e.preventDefault(); void handleLoad(); }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement → Post GRN"
      title="Select gate entry"
      notices={error ? [{ key: "ge-entry-err", tone: "error", message: error }] : []}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
      ]}
    >
      <div className="mx-auto max-w-md">
        <ErpSectionCard eyebrow="Criteria" title="Enter GE number">
          <ErpDenseFormRow label="GE number">
            <div className="flex gap-2">
              <input
                type="text"
                value={geNumber}
                onChange={(e) => setGeNumber(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. GE-100051"
                autoFocus
                className="h-9 flex-1 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 uppercase outline-none focus:border-sky-500"
              />
              <button
                onClick={() => void handleLoad()}
                disabled={loading}
                className="h-9 px-4 min-w-[90px] whitespace-nowrap bg-sky-50 text-sky-700 border border-sky-300 text-sm font-medium rounded hover:bg-sky-100 disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load (F8)"}
              </button>
            </div>
          </ErpDenseFormRow>
          <p className="mt-3 text-xs text-slate-500">Only open gate entries with pending lines are accepted.</p>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}

// ── Screen 2: GE lines list ──────────────────────────────────────────────────
function GELinesScreen({ geData, onSelectLine, onBack, successNotice, onDismissNotice }) {
  const { gate_entry: ge, lines } = geData;
  const pendingCount = lines.filter((l) => l.line_grn_status === "PENDING").length;

  return (
    <ErpScreenScaffold
      eyebrow="Post GRN"
      title={`${ge.ge_number} — select a line`}
      notices={[
        ...(successNotice ? [{ key: "grn-success", tone: "success", message: successNotice }] : []),
        ...(pendingCount === 0 ? [{ key: "all-done", tone: "info", message: "All lines have been GRN'd. GE status is now GRN_POSTED." }] : []),
      ]}
      actions={[
        { key: "back", label: "Back to GE number", tone: "neutral", onClick: onBack },
      ]}
    >
      <div className="grid gap-3">
        <ErpSectionCard eyebrow="Gate entry header" title="">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["GE number", ge.ge_number],
              ["GE date", ge.ge_date],
              ["Status", ge.status],
              ["GE type", ge.ge_type],
              ["Vehicle", ge.vehicle_number],
              ["Driver", ge.driver_name],
              ["Vendor", ge.vendor_name ? `${ge.vendor_code} — ${ge.vendor_name}` : "—"],
              ["Entry type", ge.vendor_type],
              ...(ge.remarks ? [["Remarks", ge.remarks]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{value || "—"}</p>
              </div>
            ))}
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Lines" title={`${pendingCount} pending`}>
          <p className="mb-3 text-sm text-slate-500">
            Click a <span className="font-medium text-amber-700">PENDING</span> line to post GRN.
          </p>
          <ErpDenseGrid
            columns={[
              { key: "line_number", label: "#", width: "40px" },
              {
                key: "material",
                label: "Material",
                render: (row) => (
                  <span>
                    {row.external_sku && <span className="font-medium text-slate-900">{row.external_sku} — </span>}
                    <span className={row.external_sku ? "text-slate-700" : "font-medium text-slate-900"}>{row.material_name || "—"}</span>
                  </span>
                ),
              },
              { key: "po_number", label: "PO", width: "120px", render: (row) => row.po_number || "—" },
              { key: "ge_qty", label: "Invoice qty", width: "110px", render: (row) => `${row.ge_qty} ${row.uom_code || ""}` },
              {
                key: "line_grn_status",
                label: "GRN status",
                width: "100px",
                render: (row) => statusBadge(row.line_grn_status),
              },
              { key: "grn_number", label: "GRN number", width: "130px", render: (row) => row.existing_grn_number || "—" },
            ]}
            rows={lines}
            rowKey={(row) => row.id}
            onRowActivate={(row) => {
              if (row.line_grn_status !== "PENDING") return;
              onSelectLine(row);
            }}
            getRowProps={(row) => ({
              className: row.line_grn_status !== "PENDING"
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer hover:bg-sky-50",
            })}
            emptyMessage="No lines found."
          />
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}

// ── Screen 3: 7-tab GRN entry form ──────────────────────────────────────────
function GRNEntryForm({ geLine, geHeader, onPosted, onCancel }) {
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { allowedRoutes } = useMenu();
  const canManageTransporters = isRouteAllowed(allowedRoutes ?? new Set(), "/dashboard/procurement/masters/transporters");
  const tabCount = TABS.length;
  useEffect(() => {
    function handleKey(e) {
      if (e.altKey && e.key === "]") { e.preventDefault(); setActiveTab((t) => (t + 1) % tabCount); }
      if (e.altKey && e.key === "[") { e.preventDefault(); setActiveTab((t) => (t - 1 + tabCount) % tabCount); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tabCount]);

  const vendorType = geLine.vendor_type ?? "DOMESTIC";
  const isImport = vendorType === "IMPORT";

  // Form state
  const [receivedQty, setReceivedQty] = useState(String(geLine.ge_qty ?? ""));
  const [discrepancyRemarks, setDiscrepancyRemarks] = useState("");
  const [storageLocationId, setStorageLocationId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(geLine.csn_invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(geLine.csn_invoice_date ?? "");
  const [blNumber, setBlNumber] = useState(geLine.csn_bl_number ?? "");
  const [blDate, setBlDate] = useState("");
  const [boeNumber, setBoeNumber] = useState("");
  const [boeDate, setBoeDate] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [rateConfirmed, setRateConfirmed] = useState(true);
  const [invoiceRate, setInvoiceRate] = useState("");
  const [gstPct, setGstPct] = useState("");
  const [transporterId, setTransporterId] = useState(geLine.csn_transporter_id ?? "");
  const [transporterSearch, setTransporterSearch] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [lrNumber, setLrNumber] = useState(geLine.csn_lr_number ?? "");
  const [lrDate, setLrDate] = useState(geLine.csn_lr_date ?? "");
  const [batchLotNumber, setBatchLotNumber] = useState("");
  const conversionFactor = geLine.uom_conversion_factor ?? null;
  const variableConversion = geLine.uom_variable_conversion ?? null;
  const [perPackQty, setPerPackQty] = useState(conversionFactor != null ? String(conversionFactor) : "");
  const [expiryType, setExpiryType] = useState("N_A");
  const [expiryDate, setExpiryDate] = useState("");
  const [shelfLifeMonths, setShelfLifeMonths] = useState("");

  const geQty = Number(geLine.ge_qty ?? 0);
  const receivedQtyNum = Number(receivedQty) || 0;
  const discrepancy = Number((geQty - receivedQtyNum).toFixed(6));
  const uomMismatch = geLine.base_uom_code && geLine.uom_code && geLine.base_uom_code !== geLine.uom_code;
  const perPackQtyNum = Number(perPackQty) || 0;
  const stockQtyPreview = uomMismatch && perPackQtyNum > 0 ? Number((receivedQtyNum * perPackQtyNum).toFixed(6)) : null;

  // Doc name suggestions
  const docNamesQuery = useQuery({
    queryKey: ["grn-doc-names", geLine.material_id, geLine.vendor_id],
    enabled: Boolean(geLine.material_id && geLine.vendor_id),
    queryFn: () => getMaterialVendorDocNames(geLine.material_id, geLine.vendor_id),
  });
  const docNameSuggestions = docNamesQuery.data?.items ?? [];

  const transporterSearchTrimmed = transporterSearch.trim();
  const transporterQuery = useQuery({
    queryKey: ["transporters-search", transporterSearchTrimmed, geHeader.company_id],
    enabled: transporterSearchTrimmed.length >= 2,
    queryFn: () => listTransporters({ search: transporterSearchTrimmed, company_id: geHeader.company_id, limit: 20 }),
  });
  const transporterResults = transporterQuery.data?.data ?? [];

  // Expiry calculation preview
  const expiryCalculated = (() => {
    if (expiryType !== "SPAN" || !shelfLifeMonths || !geHeader.ge_date) return null;
    const d = new Date(geHeader.ge_date);
    d.setMonth(d.getMonth() + Number(shelfLifeMonths));
    return d.toISOString().slice(0, 10);
  })();

  async function handleSave() {
    setError("");
    if (!storageLocationId) { setError("Storage location is required. (Tab: Receipt)"); setActiveTab(0); return; }
    if (discrepancy !== 0 && !discrepancyRemarks.trim()) { setError("Remarks are required when received qty differs from invoice qty. (Tab: Receipt)"); setActiveTab(0); return; }
    if (geLine.batch_tracking_required && !batchLotNumber.trim()) { setError("Batch/lot number is required for this material. (Tab: Pack & shelf life)"); setActiveTab(6); return; }

    setSaving(true);
    try {
      const payload = {
        gate_entry_line_id: geLine.id,
        received_qty: receivedQtyNum,
        discrepancy_remarks: discrepancyRemarks || null,
        storage_location_id: storageLocationId,
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        bl_number: blNumber || null,
        bl_date: blDate || null,
        boe_number: boeNumber || null,
        boe_date: boeDate || null,
        invoice_name: invoiceName || null,
        po_rate: geLine.po_rate ?? null,
        rate_confirmed: rateConfirmed,
        invoice_rate: invoiceRate ? Number(invoiceRate) : null,
        gst_pct: gstPct ? Number(gstPct) : null,
        transporter_id: transporterId || null,
        lr_number: lrNumber || null,
        lr_date: lrDate || null,
        batch_lot_number: batchLotNumber || null,
        per_pack_qty: perPackQty ? Number(perPackQty) : null,
        expiry_type: expiryType,
        expiry_date: expiryType === "DATE" ? (expiryDate || null) : null,
        shelf_life_months: expiryType === "SPAN" ? (shelfLifeMonths ? Number(shelfLifeMonths) : null) : null,
      };
      const result = await createAndPostGRNFromLine(payload);
      onPosted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post GRN.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow={`Post GRN → ${geHeader.ge_number} → Line ${geLine.line_number}`}
      title={geLine.material_name || `Line ${geLine.line_number}`}
      notices={error ? [{ key: "grn-form-err", tone: "error", message: error }] : []}
      actions={[
        { key: "cancel", label: "Cancel", tone: "neutral", onClick: onCancel },
        { key: "save", label: saving ? "Posting…" : "Save & post GRN", tone: "primary", onClick: () => void handleSave(), disabled: saving },
      ]}
    >
      {/* Tab bar */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-0 mb-4" title="Alt+[ / Alt+] to switch tabs">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === i
                ? "border-sky-500 text-sky-700 font-medium bg-white"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {/* Tab 0 — Receipt */}
        {activeTab === 0 && (
          <ErpSectionCard eyebrow="Receipt" title="Quantity & location">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">Invoice qty (GE)</p>
                <p className="mt-1 text-base font-medium text-slate-900">{geQty} {geLine.uom_code}</p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">PO UOM / Base UOM</p>
                <p className="mt-1 text-base font-medium text-slate-900">
                  {geLine.uom_code || "—"}
                  {geLine.base_uom_code && geLine.base_uom_code !== geLine.uom_code && (
                    <span className="ml-1 text-sm text-slate-500">/ {geLine.base_uom_code}</span>
                  )}
                </p>
              </div>
              <div className={`rounded border p-3 ${discrepancy !== 0 ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                <p className="text-[11px] text-slate-500">Discrepancy</p>
                <p className={`mt-1 text-base font-medium ${discrepancy !== 0 ? "text-amber-700" : "text-slate-900"}`}>
                  {discrepancy >= 0 ? "" : "+"}{(discrepancy * -1).toFixed(6) !== "0.000000" ? discrepancy : "0"}
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ErpDenseFormRow label={<>Received qty <span className="text-red-500">*</span></>}>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={receivedQty}
                  onChange={(e) => setReceivedQty(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label={<>Storage location <span className="text-red-500">*</span></>}>
                <LocationSelect
                  companyId={geHeader.company_id}
                  value={storageLocationId}
                  onChange={setStorageLocationId}
                />
              </ErpDenseFormRow>
              {uomMismatch && (
                <ErpDenseFormRow label={
                  <span className="flex items-center gap-1">
                    Per-pack qty
                    <span className="text-[10px] text-slate-400">({geLine.uom_code} → {geLine.base_uom_code})</span>
                    {conversionFactor != null && !variableConversion && (
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Material master</span>
                    )}
                    {conversionFactor != null && variableConversion && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Suggested</span>
                    )}
                  </span>
                }>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder={`How many ${geLine.base_uom_code} per ${geLine.uom_code}?`}
                    value={perPackQty}
                    onChange={(e) => setPerPackQty(e.target.value)}
                    readOnly={conversionFactor != null && !variableConversion}
                    className={`h-9 w-full border px-3 text-sm outline-none ${
                      conversionFactor != null && !variableConversion
                        ? "border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed"
                        : "border-slate-300 bg-white focus:border-sky-500"
                    }`}
                  />
                </ErpDenseFormRow>
              )}
            </div>
            {uomMismatch && stockQtyPreview != null && (
              <div className="mt-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                Stock qty: <strong>{receivedQtyNum} {geLine.uom_code} × {perPackQtyNum} = {stockQtyPreview} {geLine.base_uom_code}</strong>
              </div>
            )}
            {discrepancy !== 0 && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-800 mb-1">Discrepancy detected — remarks required</p>
                <input
                  type="text"
                  placeholder="Reason for shortage / excess…"
                  value={discrepancyRemarks}
                  onChange={(e) => setDiscrepancyRemarks(e.target.value)}
                  className="h-9 w-full border border-amber-300 bg-white px-3 text-sm outline-none focus:border-amber-500"
                />
              </div>
            )}
          </ErpSectionCard>
        )}

        {/* Tab 1 — Vendor */}
        {activeTab === 1 && (
          <ErpSectionCard eyebrow="Vendor" title="Vendor details (read-only)">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[
                ["Vendor", geHeader.vendor_name ? `${geHeader.vendor_code} — ${geHeader.vendor_name}` : "—"],
                ["Type", geHeader.vendor_type ?? "—"],
                ["GST number", geHeader.vendor_gst ?? "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
                </div>
              ))}
              {geHeader.vendor_address && (
                <div className="col-span-full">
                  <p className="text-[11px] text-slate-500">Registered address</p>
                  <p className="mt-0.5 text-sm text-slate-900">{geHeader.vendor_address}</p>
                </div>
              )}
            </div>
          </ErpSectionCard>
        )}

        {/* Tab 2 — Documents */}
        {activeTab === 2 && (
          <ErpSectionCard eyebrow="Documents" title={isImport ? "Invoice + BL + BoE" : "Invoice"}>
            {!isImport && (
              <p className="mb-3 text-xs text-slate-500">Entry type: DOMESTIC — BL/BoE fields hidden.</p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <ErpDenseFormRow label="Invoice number">
                <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Invoice date">
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              {isImport && (
                <>
                  <ErpDenseFormRow label="BL number">
                    <input type="text" value={blNumber} onChange={(e) => setBlNumber(e.target.value)}
                      className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="BL date">
                    <input type="date" value={blDate} onChange={(e) => setBlDate(e.target.value)}
                      className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="BoE number">
                    <input type="text" value={boeNumber} onChange={(e) => setBoeNumber(e.target.value)}
                      className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="BoE date">
                    <input type="date" value={boeDate} onChange={(e) => setBoeDate(e.target.value)}
                      className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                </>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">Pre-filled from CSN. Changes here sync back to CSN.</p>
          </ErpSectionCard>
        )}

        {/* Tab 3 — Material */}
        {activeTab === 3 && (
          <ErpSectionCard eyebrow="Material" title="Material identity">
            <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-3">
              {[
                ["PACE code", geLine.pace_code ?? "—"],
                ["Material name", geLine.material_name ?? "—"],
                ["External code", geLine.external_sku ?? "—"],
                ["Base UOM", geLine.base_uom_code ?? "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
                </div>
              ))}
            </div>
            <ErpDenseFormRow label="Invoice name (as on vendor's document)">
              <input
                type="text"
                list="doc-name-suggestions"
                placeholder="Type or select known name…"
                value={invoiceName}
                onChange={(e) => setInvoiceName(e.target.value)}
                className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
              />
              <datalist id="doc-name-suggestions">
                {docNameSuggestions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </ErpDenseFormRow>
            <p className="mt-2 text-xs text-slate-500">Saved to material–vendor name mapping. Shown as suggestion next time.</p>
          </ErpSectionCard>
        )}

        {/* Tab 4 — Accounts */}
        {activeTab === 4 && (
          <ErpSectionCard eyebrow="Accounts" title="Rate & GST">
            <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 inline-block">
              <p className="text-[11px] text-slate-500">PO rate</p>
              <p className="mt-1 text-base font-medium text-slate-900">
                {geLine.po_rate != null ? `₹ ${Number(geLine.po_rate).toFixed(4)} / ${geLine.uom_code}` : "—"}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded border border-slate-200 bg-slate-50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rateConfirmed}
                  onChange={(e) => setRateConfirmed(e.target.checked)}
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Rate confirmed</p>
                  <p className="text-xs text-slate-500">Post GRN at PO rate</p>
                </div>
              </label>
              <ErpDenseFormRow label="Invoice rate (if different)">
                <input
                  type="number"
                  placeholder="Enter invoice rate"
                  value={invoiceRate}
                  onChange={(e) => setInvoiceRate(e.target.value)}
                  disabled={rateConfirmed}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </ErpDenseFormRow>
            </div>
            {!rateConfirmed && (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                GRN will post at rate = 0. Accounts team confirms rate later.
              </p>
            )}
            <div className="mt-3 max-w-xs">
              <ErpDenseFormRow label="GST % (from invoice)">
                <input type="number" min="0" max="100" step="0.01" value={gstPct} onChange={(e) => setGstPct(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
            </div>
          </ErpSectionCard>
        )}

        {/* Tab 5 — Transporter */}
        {activeTab === 5 && (
          <ErpSectionCard eyebrow="Transporter" title="Logistics">
            <p className="mb-3 text-xs text-slate-500">Pre-filled from CSN. Changes here sync back to CSN on post.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-3">
                <ErpDenseFormRow label="Transporter">
                  {transporterId && transporterName ? (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 h-9 flex items-center px-3 border border-emerald-300 bg-emerald-50 text-sm text-emerald-900 rounded">
                        {transporterName}
                      </span>
                      <button
                        onClick={() => { setTransporterId(""); setTransporterName(""); setTransporterSearch(""); }}
                        className="h-9 px-3 text-sm border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 rounded"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Type 2+ characters to search transporter master…"
                        value={transporterSearch}
                        onChange={(e) => setTransporterSearch(e.target.value)}
                        className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      />
                      {transporterSearchTrimmed.length >= 2 && (
                        <div className="absolute z-20 left-0 right-0 top-full mt-0.5 border border-slate-200 bg-white shadow-md max-h-52 overflow-y-auto">
                          {transporterQuery.isLoading && (
                            <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>
                          )}
                          {!transporterQuery.isLoading && transporterResults.length === 0 && (
                            <div className="px-3 py-2 text-sm text-slate-500">
                              No match found.
                              {canManageTransporters ? (
                                <button
                                  onClick={() => openScreen("PROC_TRANSPORTER_MASTER")}
                                  className="ml-2 text-sky-600 underline text-sm"
                                >
                                  Add to Transporter Master →
                                </button>
                              ) : (
                                <span className="ml-2 text-slate-400 text-xs">(Contact manager to add)</span>
                              )}
                            </div>
                          )}
                          {transporterResults.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => { setTransporterId(t.id); setTransporterName(t.transporter_name); setTransporterSearch(""); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 border-b border-slate-100 last:border-0"
                            >
                              <span className="font-medium">{t.transporter_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </ErpDenseFormRow>
              </div>
              <ErpDenseFormRow label="LR number">
                <input type="text" value={lrNumber} onChange={(e) => setLrNumber(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="LR date">
                <input type="date" value={lrDate} onChange={(e) => setLrDate(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
            </div>
          </ErpSectionCard>
        )}

        {/* Tab 6 — Pack & shelf life */}
        {activeTab === 6 && (
          <ErpSectionCard eyebrow="Pack & shelf life" title="Packaging & expiry">
            <div className="grid gap-3 md:grid-cols-3">
              <ErpDenseFormRow label={geLine.batch_tracking_required ? <>Batch / lot number <span className="text-red-500">*</span></> : "Batch / lot number"}>
                <input type="text" value={batchLotNumber} onChange={(e) => setBatchLotNumber(e.target.value)}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Expiry type">
                <select value={expiryType} onChange={(e) => { setExpiryType(e.target.value); setExpiryDate(""); setShelfLifeMonths(""); }}
                  className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                  <option value="N_A">N/A</option>
                  <option value="DATE">Date</option>
                  <option value="SPAN">Span (months)</option>
                </select>
              </ErpDenseFormRow>
              {expiryType === "DATE" && (
                <ErpDenseFormRow label="Expiry date">
                  <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                    className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              )}
              {expiryType === "SPAN" && (
                <ErpDenseFormRow label="Shelf life (months)">
                  <input type="number" min="1" value={shelfLifeMonths} onChange={(e) => setShelfLifeMonths(e.target.value)}
                    className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              )}
            </div>
            {expiryCalculated && (
              <p className="mt-3 text-sm text-sky-700 bg-sky-50 border border-sky-200 rounded px-3 py-2">
                Calculated expiry date: <strong>{expiryCalculated}</strong> (GE date {geHeader.ge_date} + {shelfLifeMonths} months)
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500">GE date (for span calculation): {geHeader.ge_date}</p>
          </ErpSectionCard>
        )}
      </div>
    </ErpScreenScaffold>
  );
}

// ── Main flow controller ──────────────────────────────────────────────────────
export default function GRNPostFlow() {
  const [screen, setScreen] = useState("ge-entry"); // ge-entry | ge-lines | grn-form
  const [geData, setGeData] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [successNotice, setSuccessNotice] = useState("");
  const queryClient = useQueryClient();

  function handleGELoaded(data) {
    setGeData(data);
    setSuccessNotice("");
    setScreen("ge-lines");
    window.scrollTo(0, 0);
  }

  function handleLineSelected(line) {
    setSelectedLine(line);
    setSuccessNotice("");
    setScreen("grn-form");
    window.scrollTo(0, 0);
  }

  function handlePosted(postedGrn) {
    queryClient.invalidateQueries({ queryKey: ["procurement", "grns"] });
    // Refresh GE lines by re-fetching
    const geNumber = geData?.gate_entry?.ge_number;
    if (geNumber) {
      getGELinesForGRN(geNumber).then((freshData) => {
        setGeData(freshData);
        setSuccessNotice(`${postedGrn.grn_number} posted successfully.`);
        setScreen("ge-lines");
        window.scrollTo(0, 0);
      }).catch(() => {
        setSuccessNotice(`${postedGrn.grn_number} posted successfully.`);
        setScreen("ge-lines");
        window.scrollTo(0, 0);
      });
    } else {
      setSuccessNotice("GRN posted successfully.");
      setScreen("ge-lines");
      window.scrollTo(0, 0);
    }
  }

  if (screen === "ge-entry") {
    return <GENumberEntryScreen onLoad={handleGELoaded} />;
  }

  if (screen === "ge-lines" && geData) {
    return (
      <GELinesScreen
        geData={geData}
        onSelectLine={handleLineSelected}
        onBack={() => { setScreen("ge-entry"); window.scrollTo(0, 0); }}
        successNotice={successNotice}
        onDismissNotice={() => setSuccessNotice("")}
      />
    );
  }

  if (screen === "grn-form" && selectedLine && geData) {
    return (
      <GRNEntryForm
        geLine={selectedLine}
        geHeader={geData.gate_entry}
        onPosted={handlePosted}
        onCancel={() => { setScreen("ge-lines"); window.scrollTo(0, 0); }}
      />
    );
  }

  return <GENumberEntryScreen onLoad={handleGELoaded} />;
}
