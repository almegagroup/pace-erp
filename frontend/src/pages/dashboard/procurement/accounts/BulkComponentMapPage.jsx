/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/BulkComponentMapPage.jsx
 * Domain: PROCUREMENT / ACCOUNTS + PO12
 * Purpose: "Bulk Component Map" — one shared page reached from a button on
 *          both AC01 (Invoice Verifications) and PO12 Tab 1 (CRCP
 *          Discrepancy List). Reuses AC01's own Section 5 (Landed cost) /
 *          Section 6 (Deductions) row editors verbatim for the component
 *          builder, adds a Value-Application Mode (Same-to-Many /
 *          Distributed) + the same "I Verify" acknowledgement AC01's own
 *          drawer requires, then a GRN grid — context-aware: whichever
 *          page the button was clicked from decides which rows/columns
 *          show (AC01's own listAC01GRNs, or PO12's own listCrcpDiscrepancy,
 *          with that page's current filters carried over via navigation
 *          state). Design: docs/PROCUREMENT-DESIGN-DOC.md Point 3.5.8's
 *          2026-10-06 Page/UI Design addendum.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  listAC01GRNs,
  listCrcpDiscrepancy,
  listDeductionTypes,
  listBulkComponentMapChaOptions,
  previewBulkComponentMap,
  applyBulkComponentMap,
} from "../procurementApi.js";
// Reuse the real column sets rather than an independently-trimmed copy
// (2026-10-06, business owner) -- AC01's own full "smart" grid (dynamic
// per-component columns included) for the AC01 origin, PO12 Tab 1's own
// full column set + the same dynamic per-component columns for the PO12
// origin.
import { buildColumns, buildComponentColumns } from "./ac01GridColumns.jsx";
import { COLUMNS as PO12_FULL_COLUMNS } from "../transfer/crcpDiscrepancyColumns.jsx";

// Same vocabulary as AC01Page.jsx's own Section 5/6 editors -- deliberately
// duplicated rather than imported, since page components here are
// default-export-only (no shared internal module), but every value below
// must stay byte-identical to AC01Page.jsx's own constants.
const DUTY_COST_TYPES = new Set([
  "IMPORT_DUTY", "EXCISE_DUTY", "CST", "CUSTOMS_EDN_CESS", "ADDITIONAL_DUTY_IGST", "DUTY_SETOFF",
  "ENTRY_TAX", "CUSTOMS_DUTY",
]);
const CHARGE_COST_TYPES = [
  { value: "FREIGHT", label: "Freight" },
  { value: "CLEARING_CHARGES_CHA", label: "Clearing charges (C&F)" },
  { value: "CHA_CHARGES", label: "CHA charges" },
  { value: "LOADING", label: "Loading" },
  { value: "UNLOADING", label: "Unloading" },
  { value: "LAST_MILE_TRANSPORT", label: "Last mile transport" },
  { value: "TRANSPORTER_CHARGE_OTHER_THAN_BASIC", label: "Invoice: transporter charge other than basic" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "PORT_CHARGES", label: "Port charges" },
  { value: "OTHER", label: "Other" },
];
const DUTY_LINE_TYPES = [
  { value: "IMPORT_DUTY", label: "Import duty" },
  { value: "EXCISE_DUTY", label: "Excise duty" },
  { value: "CST", label: "CST" },
  { value: "CUSTOMS_EDN_CESS", label: "Customs education cess" },
  { value: "ADDITIONAL_DUTY_IGST", label: "Additional duty / IGST" },
  { value: "DUTY_SETOFF", label: "Duty set-off" },
  { value: "ENTRY_TAX", label: "Entry tax (import-only)" },
  { value: "CUSTOMS_DUTY", label: "Customs duty" },
];
const FINANCE_LINE_TYPES = [
  { value: "LC_CHARGES", label: "LC charges" },
  { value: "BANK_CHARGES", label: "Bank charges" },
];
const CHA_COST_TYPES = new Set(["CLEARING_CHARGES_CHA", "CHA_CHARGES"]);
const PARTY_TYPE_OPTIONS = [
  { value: "VENDOR", label: "Vendor" },
  { value: "TRANSPORTER", label: "Transporter" },
  { value: "LAST_MILE_TRANSPORTER", label: "Last mile transporter" },
  { value: "CHA", label: "CHA" },
  { value: "NONE", label: "NA (paid directly, no party)" },
];

function nextEmptyCostLine() {
  return {
    key: `new-${Date.now()}-${Math.random()}`,
    cost_type: "FREIGHT", amount: "", entry_mode: "AD_HOC", has_gst: false, gst_treatment: "EXCLUSIVE", gst_rate: "",
    bill_reference: "", bill_date: "", description: "", party_type: "VENDOR", cha_id: "",
  };
}
function nextEmptyDeductionLine() {
  return { key: `new-${Date.now()}-${Math.random()}`, deduction_type_id: "", amount: "", percentage: "", round_off: "", in_landed: false, party_type: "VENDOR" };
}
function deriveDefaultsForCostType(costType, currentPartyType, defaultChaId) {
  if (DUTY_COST_TYPES.has(costType)) return { party_type: "NONE", cha_id: "" };
  if (CHA_COST_TYPES.has(costType)) return { party_type: "CHA", cha_id: defaultChaId || "" };
  return { party_type: currentPartyType, cha_id: "" };
}

function DrawerField({ label, children }) {
  return (
    <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}
function DrawerSection({ eyebrow, title, children }) {
  return (
    <section className="grid gap-2 border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div className="grid gap-0.5">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div>
        <div className="text-[12px] font-semibold text-slate-900">{title}</div>
      </div>
      {children}
    </section>
  );
}
const inputCls = "h-[26px] w-full border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-500";


export default function BulkComponentMapPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const origin = location.state?.origin === "PO12" ? "PO12" : "AC01";
  const companyId = location.state?.companyId || "";
  const ac01Filters = location.state?.ac01Filters || {};
  const po12Search = location.state?.po12Search || "";

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [costLines, setCostLines] = useState([]);
  const [deductionLines, setDeductionLines] = useState([]);
  const [mode, setMode] = useState("SAME_TO_MANY");
  const [splitMethod, setSplitMethod] = useState("EQUALLY");
  const [invoiceVerified, setInvoiceVerified] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const listQuery = useQuery({
    queryKey: ["bulk-component-map", "grns", origin, companyId, ac01Filters, po12Search],
    queryFn: () =>
      origin === "PO12"
        ? listCrcpDiscrepancy({ company_id: companyId })
        : listAC01GRNs({ company_id: companyId || undefined, ...ac01Filters, limit: 500 }),
    enabled: Boolean(companyId),
  });
  // "Smart" per-component columns (same mechanism as AC01's own list) ride
  // on top of whichever origin's own full column set applies -- AC01's
  // buildColumns already includes them; PO12's own static COLUMNS doesn't,
  // so they're appended explicitly here.
  const columns = useMemo(() => {
    const components = Array.isArray(listQuery.data?.components) ? listQuery.data.components : [];
    return origin === "PO12" ? [...PO12_FULL_COLUMNS, ...buildComponentColumns(components)] : buildColumns(components);
  }, [origin, listQuery.data]);
  const rowKeyField = "grn_id";
  const rows = useMemo(() => (Array.isArray(listQuery.data?.items) ? listQuery.data.items : []), [listQuery.data]);
  const filteredRows = useMemo(() => {
    if (origin !== "PO12" || !po12Search.trim()) return rows;
    const needle = po12Search.trim().toLowerCase();
    return rows.filter((row) => columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(needle)));
  }, [rows, origin, po12Search, columns]);
  const searchedRows = useMemo(() => {
    if (!search.trim()) return filteredRows;
    const needle = search.trim().toLowerCase();
    return filteredRows.filter((row) => columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(needle)));
  }, [filteredRows, search, columns]);

  const deductionTypesQuery = useQuery({
    queryKey: ["bulk-component-map", "deduction-types", companyId],
    queryFn: () => listDeductionTypes({ company_id: companyId }),
    enabled: Boolean(companyId),
  });
  const deductionTypeOptions = Array.isArray(deductionTypesQuery.data?.items) ? deductionTypesQuery.data.items : [];

  const chaOptionsQuery = useQuery({
    queryKey: ["bulk-component-map", "cha-options", companyId],
    queryFn: () => listBulkComponentMapChaOptions(companyId),
    enabled: Boolean(companyId),
  });
  const chaOptions = Array.isArray(chaOptionsQuery.data?.items) ? chaOptionsQuery.data.items : [];

  const allVisibleSelected = searchedRows.length > 0 && searchedRows.every((row) => selectedIds.includes(row[rowKeyField]));
  function toggleRow(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(searchedRows.map((row) => row[rowKeyField]));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
    } else {
      setSelectedIds((current) => [...new Set([...current, ...searchedRows.map((row) => row[rowKeyField])])]);
    }
  }

  // The acknowledgement applies to the exact lines/mode on screen -- any
  // change after ticking I Verify requires a fresh tick, same rule AC01's
  // own drawer now enforces.
  function invalidateVerification() {
    setInvoiceVerified(false);
    setPreviewData(null);
  }

  function buildRequestBody() {
    return {
      grn_ids: selectedIds,
      cost_lines: costLines
        .filter((line) => line.amount !== "")
        .map((line) => ({
          cost_type: line.cost_type,
          amount: Number(line.amount),
          entry_mode: line.entry_mode,
          has_gst: line.has_gst,
          gst_treatment: line.has_gst ? line.gst_treatment : null,
          gst_rate: line.has_gst && line.gst_rate !== "" ? Number(line.gst_rate) : null,
          bill_reference: line.bill_reference || null,
          bill_date: line.bill_date || null,
          description: line.description || null,
          party_type: line.party_type || "VENDOR",
          cha_id: line.party_type === "CHA" && line.cha_id ? line.cha_id : null,
        })),
      deduction_lines: deductionLines
        .filter((line) => line.deduction_type_id && line.amount !== "")
        .map((line) => ({
          deduction_type_id: line.deduction_type_id,
          amount: Number(line.amount),
          percentage: line.percentage === "" ? null : Number(line.percentage),
          round_off: line.round_off === "" ? null : Number(line.round_off),
          party_type: line.party_type || "VENDOR",
          in_landed: line.in_landed,
        })),
      mode,
      split_method: splitMethod,
    };
  }

  async function handlePreview() {
    setError(""); setNotice("");
    if (selectedIds.length === 0) { setError("Select at least one GRN first."); return; }
    if (costLines.length === 0 && deductionLines.length === 0) { setError("Add at least one cost or deduction line first."); return; }
    setPreviewing(true);
    try {
      const result = await previewBulkComponentMap(buildRequestBody());
      setPreviewData(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "BULK_MAP_PREVIEW_FAILED");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    setError(""); setNotice("");
    if (!invoiceVerified) { setError('Check "I Verify" before applying.'); return; }
    if (selectedIds.length === 0) { setError("Select at least one GRN first."); return; }
    setApplying(true);
    try {
      const result = await applyBulkComponentMap({ ...buildRequestBody(), invoice_verified: true });
      setNotice(`${result.applied_count} GRN${result.applied_count === 1 ? "" : "s"} mapped${result.forbidden_count ? `, ${result.forbidden_count} skipped (no write access)` : ""}.`);
      setSelectedIds([]);
      setCostLines([]);
      setDeductionLines([]);
      setInvoiceVerified(false);
      setPreviewData(null);
      await listQuery.refetch();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "BULK_MAP_APPLY_FAILED");
    } finally {
      setApplying(false);
    }
  }

  const duplicateWarnings = previewData?.duplicate_warnings ?? [];
  const duplicateGrnIds = new Set(duplicateWarnings.map((w) => w.grn_id));

  return (
    <ErpScreenScaffold
      eyebrow={`Procurement · ${origin === "PO12" ? "PO12 Tab 1" : "AC01"}`}
      title="Bulk Component Map"
      notices={[
        ...(error ? [{ key: "bulk-map-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "bulk-map-notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="" title="">
          <button type="button" onClick={() => navigate(-1)} className="text-[11px] font-semibold text-sky-700 underline">
            ← Back
          </button>
        </ErpSectionCard>

        <DrawerSection eyebrow="Landed cost" title="Duty stack + ad-hoc/per-UoM charges — add one or more lines, exactly like AC01">
          <div className="grid gap-1">
            {costLines.map((line, index) => {
              const isDuty = DUTY_COST_TYPES.has(line.cost_type);
              return (
                <div key={line.key} className="grid gap-1.5 items-end" style={{ gridTemplateColumns: "1.3fr 0.6fr 0.55fr 0.55fr 0.55fr 0.45fr 0.8fr 0.9fr 0.5fr" }}>
                  <select
                    value={line.cost_type}
                    onChange={(event) => {
                      const nextCostType = event.target.value;
                      const defaults = deriveDefaultsForCostType(nextCostType, line.party_type, "");
                      setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, cost_type: nextCostType, ...defaults } : entry)));
                      invalidateVerification();
                    }}
                    className={inputCls}
                  >
                    <optgroup label="Duty (amount in, % derived)">
                      {DUTY_LINE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </optgroup>
                    <optgroup label="Charges">
                      {CHARGE_COST_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </optgroup>
                    <optgroup label="Finance">
                      {FINANCE_LINE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </optgroup>
                  </select>
                  <input
                    value={line.amount}
                    onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, amount: event.target.value } : entry))); invalidateVerification(); }}
                    placeholder={mode === "DISTRIBUTED" ? "Total to split" : (line.entry_mode === "PER_UOM" ? "Rate / unit" : "Amount")}
                    className={inputCls}
                  />
                  {!isDuty ? (
                    <select
                      value={line.entry_mode}
                      disabled={mode === "DISTRIBUTED"}
                      onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, entry_mode: event.target.value } : entry))); invalidateVerification(); }}
                      className={inputCls}
                      title={mode === "DISTRIBUTED" ? "Distributed mode always splits as a flat amount" : undefined}
                    >
                      <option value="AD_HOC">Ad hoc</option>
                      <option value="PER_UOM">Per UoM</option>
                    </select>
                  ) : <div />}
                  {!isDuty ? (
                    <select
                      value={line.has_gst ? "YES" : "NO"}
                      onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, has_gst: event.target.value === "YES" } : entry))); invalidateVerification(); }}
                      className={inputCls}
                    >
                      <option value="NO">Has GST? No</option>
                      <option value="YES">Has GST? Yes</option>
                    </select>
                  ) : <div />}
                  {!isDuty && line.has_gst ? (
                    <select
                      value={line.gst_treatment}
                      onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, gst_treatment: event.target.value } : entry))); invalidateVerification(); }}
                      className={inputCls}
                    >
                      <option value="EXCLUSIVE">Exclusive</option>
                      <option value="INCLUSIVE">Inclusive</option>
                    </select>
                  ) : <div />}
                  {!isDuty && line.has_gst ? (
                    <input
                      value={line.gst_rate}
                      onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, gst_rate: event.target.value } : entry))); invalidateVerification(); }}
                      placeholder="GST %"
                      className={inputCls}
                    />
                  ) : <div />}
                  <select
                    value={line.party_type}
                    onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, party_type: event.target.value } : entry))); invalidateVerification(); }}
                    className={inputCls}
                    title="Which party this charge is owed to"
                  >
                    {PARTY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  {line.party_type === "CHA" ? (
                    <select
                      value={line.cha_id}
                      onChange={(event) => { setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, cha_id: event.target.value } : entry))); invalidateVerification(); }}
                      className={inputCls}
                      title="Which CHA this charge is owed to"
                    >
                      <option value="">Select CHA</option>
                      {chaOptions.map((cha) => <option key={cha.id} value={cha.id}>{cha.cha_code} — {cha.cha_name}</option>)}
                    </select>
                  ) : <div />}
                  <button
                    type="button"
                    onClick={() => { setCostLines((current) => current.filter((_, entryIndex) => entryIndex !== index)); invalidateVerification(); }}
                    className="h-[26px] border border-rose-300 bg-rose-50 text-[10px] font-semibold text-rose-800"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <button type="button" onClick={() => setCostLines((current) => [...current, nextEmptyCostLine()])} className="mt-1 justify-self-start text-[11px] font-semibold text-sky-700">
              + Add cost line
            </button>
          </div>
        </DrawerSection>

        <DrawerSection eyebrow="Deductions" title='Reusable deduction types — tick "In landed?" to affect landed cost'>
          <div className="grid gap-1">
            {deductionLines.map((line, index) => (
              <div key={line.key} className="grid gap-1.5 items-end" style={{ gridTemplateColumns: "1.2fr 0.6fr 0.5fr 0.6fr 0.9fr 0.5fr 0.5fr" }}>
                <select
                  value={line.deduction_type_id}
                  onChange={(event) => { setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, deduction_type_id: event.target.value } : entry))); invalidateVerification(); }}
                  className={inputCls}
                >
                  <option value="">Select type</option>
                  {deductionTypeOptions.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
                <input value={line.amount} onChange={(event) => { setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, amount: event.target.value } : entry))); invalidateVerification(); }} placeholder={mode === "DISTRIBUTED" ? "Total to split" : "Amount"} className={inputCls} />
                <input value={line.percentage} onChange={(event) => { setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, percentage: event.target.value } : entry))); invalidateVerification(); }} placeholder="%" className={inputCls} />
                <input value={line.round_off} onChange={(event) => { setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, round_off: event.target.value } : entry))); invalidateVerification(); }} placeholder="Round off" className={inputCls} />
                <select
                  value={line.party_type}
                  onChange={(event) => { setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, party_type: event.target.value } : entry))); invalidateVerification(); }}
                  className={inputCls}
                  title="Which party this deduction is against"
                >
                  {PARTY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <label className="flex h-[26px] items-center gap-1 text-[10px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={line.in_landed}
                    onChange={(event) => { setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, in_landed: event.target.checked } : entry))); invalidateVerification(); }}
                  />
                  In landed
                </label>
                <button type="button" onClick={() => { setDeductionLines((current) => current.filter((_, entryIndex) => entryIndex !== index)); invalidateVerification(); }} className="h-[26px] border border-rose-300 bg-rose-50 text-[10px] font-semibold text-rose-800">
                  Remove
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setDeductionLines((current) => [...current, nextEmptyDeductionLine()])} className="justify-self-start text-[11px] font-semibold text-sky-700">
              + Add deduction
            </button>
          </div>
        </DrawerSection>

        <DrawerSection eyebrow="Value-Application Mode" title="How each line's Amount applies across the selected GRNs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
              <input type="radio" checked={mode === "SAME_TO_MANY"} onChange={() => { setMode("SAME_TO_MANY"); invalidateVerification(); }} />
              Same-to-Many — same rate/amount on every selected GRN
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
              <input type="radio" checked={mode === "DISTRIBUTED"} onChange={() => { setMode("DISTRIBUTED"); invalidateVerification(); }} />
              Distributed — one lump-sum total split across the selected GRNs
            </label>
            {mode === "DISTRIBUTED" ? (
              <select value={splitMethod} onChange={(event) => { setSplitMethod(event.target.value); invalidateVerification(); }} className={`${inputCls} w-auto`}>
                <option value="EQUALLY">Equally</option>
                <option value="AS_PER_QTY">As-per-GRN-qty</option>
              </select>
            ) : null}
          </div>
        </DrawerSection>

        <DrawerSection eyebrow="Invoice Verification" title="Confirm before applying">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={invoiceVerified} onChange={(event) => setInvoiceVerified(event.target.checked)} className="h-4 w-4" />
            I Verify
          </label>
          <p className="mt-1 text-[11px] text-slate-500">
            Applying with this checked records your user ID as Invoice Verified By on every mapped GRN. Changing any line or mode above clears the tick.
          </p>
        </DrawerSection>

        <ErpSectionCard
          eyebrow="GRNs"
          title={listQuery.isLoading ? "Loading…" : `${searchedRows.length} GRN${searchedRows.length === 1 ? "" : "s"} (from ${origin === "PO12" ? "PO12 Tab 1" : "AC01"})`}
        >
          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search across every column…"
              className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
            />
            <span className="text-xs text-slate-500">Selected: {selectedIds.length}</span>
          </div>

          <ErpDenseGrid
            columns={[
              {
                key: "__select",
                label: <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />,
                width: "40px",
                render: (row) => <input type="checkbox" checked={selectedIds.includes(row[rowKeyField])} onChange={() => toggleRow(row[rowKeyField])} />,
              },
              ...columns,
              {
                key: "__duplicate",
                label: "",
                width: "120px",
                render: (row) => (duplicateGrnIds.has(row[rowKeyField])
                  ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800" title="This exact component+value already exists on this GRN">⚠ duplicate?</span>
                  : null),
              },
            ]}
            rows={searchedRows}
            rowKey={(row) => row[rowKeyField]}
            columnFilter
            rangeSelect
            virtualize
            emptyMessage={listQuery.isLoading ? "Loading…" : companyId ? "No GRNs found." : "No company resolved — open this page via the Bulk Component Map button on AC01 or PO12."}
          />

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => void handlePreview()} disabled={previewing || selectedIds.length === 0} className="h-9 px-4 border border-slate-300 bg-white text-sm font-medium text-slate-700 disabled:opacity-50">
              {previewing ? "Checking…" : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={applying || !invoiceVerified || selectedIds.length === 0}
              title={!invoiceVerified ? 'Check "I Verify" before applying.' : undefined}
              className="h-9 px-4 border border-sky-600 bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {applying ? "Mapping…" : "Component Map"}
            </button>
          </div>

          {previewData ? (
            <div className="mt-3 border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
              {previewData.forbidden?.length ? (
                <p className="text-rose-700">
                  {previewData.forbidden.length} GRN{previewData.forbidden.length === 1 ? "" : "s"} have no write access (neither AC01 nor PO12) and will be skipped.
                </p>
              ) : null}
              {duplicateWarnings.length ? (
                <p className="text-amber-700">
                  {duplicateWarnings.length} duplicate component+value match{duplicateWarnings.length === 1 ? "" : "es"} found — see the ⚠ marker in the grid above. Not blocked, just flagged.
                </p>
              ) : null}
              {!previewData.forbidden?.length && !duplicateWarnings.length ? <p>No issues found — ready to Component Map.</p> : null}
            </div>
          ) : null}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
