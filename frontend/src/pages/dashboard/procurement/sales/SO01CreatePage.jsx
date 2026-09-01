/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SO01CreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: SO01 unified RM/PM/INT/SFG/FG Sales Order — Page 1 (Criteria) +
 *          Page 2 (Bill-To/Ship-To resolution, Payment Terms, Freight Term,
 *          Item Line). Feasibility doc §133.7-§133.11 (2026-08-27/28).
 *          Reuses SOCreatePage.jsx's architecture (ErpComboboxField/
 *          ErpDenseGrid table-row line entry) — not its single-material-type
 *          shape, since this page mixes RM/PM/INT/SFG/FG in one order.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useCustomerOptionsQuery,
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { listFgParentCompanies, listFgDepotCodes } from "../../om/omApi.js";
import { listAc06ApprovedMonths } from "../../production/prodApi.js";
import { amountToWordsIndian } from "../../../../utils/numberToWordsIndian.js";
import { getManualDocumentDateBounds, isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../../../utils/manualDocumentDateWindow.js";
import { createSalesOrderUnified, listSalesOrderAddressOptions, listSalesOrderFgSkuOptions } from "../procurementApi.js";

// §133.7 — 5 fixed dispatch types.
const DISPATCH_TYPE_OPTIONS = [
  { value: "DEPENDENT_DIRECT", label: "Dependent (Direct)" },
  { value: "DEPENDENT_DEPOT", label: "Dependent (Depot)" },
  { value: "INDEPENDENT_PARTY", label: "Independent Party" },
  { value: "INDEPENDENT_PARTY_ASIAN_BILLED", label: "Independent Party (Asian-billed)" },
  { value: "DEPENDENT_NO_INBOUND", label: "Dependent (No Inbound)" },
];
// Hardcoded per dispatch_type, except INDEPENDENT_PARTY_ASIAN_BILLED (user picks).
const IBN_REQUIRED_MAP = {
  DEPENDENT_DIRECT: true,
  DEPENDENT_DEPOT: true,
  INDEPENDENT_PARTY: false,
  DEPENDENT_NO_INBOUND: false,
};
const MATERIAL_TYPE_OPTIONS = [
  { value: "RM", label: "RM" },
  { value: "PM", label: "PM" },
  { value: "INT", label: "INT" },
  { value: "SFG", label: "SFG" },
  { value: "FG", label: "FG" },
];
const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
  { value: "EX_TRANSPORTER_GODOWN", label: "Ex Transporter Godown" },
];
const FG_TYPE_OPTIONS = [
  { value: "MTO", label: "MTO" },
  { value: "HPS", label: "HPS" },
  { value: "MTEST", label: "MTEST" },
  { value: "MTS", label: "MTS" },
];
const MANUAL_DATE_BOUNDS = getManualDocumentDateBounds();
const RATE_BASIS_OPTIONS = [
  { value: "PACK_UOM", label: "Pack UoM" },
  { value: "BASE_UOM", label: "Base UoM" },
];
const MTEST_RATE_TYPE_OPTIONS = [
  { value: "FIXED", label: "Fixed" },
  { value: "PACK_UOM", label: "Pack UoM" },
  { value: "BASE_UOM", label: "Base UoM" },
];

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

// §133.8-E — SO Date's own month/year, used as the MTEST auto-value (no dropdown, no manual entry).
function monthStartFromDate(dateStr) {
  const value = String(dateStr || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : "";
}
function formatMonthLabel(rateMonth) {
  const value = String(rateMonth || "");
  if (!/^\d{4}-\d{2}/.test(value)) return value || "-";
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function makeLine(lineMaterialType) {
  return {
    __key: `${lineMaterialType}-${Math.random().toString(36).slice(2)}`,
    __manualSku: false,
    line_material_type: lineMaterialType,
    material_id: "",
    manual_sku_name: "",
    fg_type: lineMaterialType === "FG" || lineMaterialType === "SFG" ? "" : null,
    quantity: "",
    base_qty: "",
    pack_uom_code: "",
    pack_qty: "",
    per_pack_qty: "",
    rate_basis: "",
    uom_code: "",
    rate: "",
    currency_code: "INR",
    gst_treatment: "EXCLUSIVE",
    gst_rate: "",
    hsn_code: "",
    batch_number: "",
    expiry_date: "",
    costing_rate_month: "",
    round_off_amount: "",
    remarks: "",
  };
}

// §133.8-H — mirrors deriveSalesInvoiceGstType() exactly (trim+lowercase
// state-name equality) so the Page 2 preview matches what the backend will
// actually compute at save time. Returns null (rather than guessing) when
// either state isn't resolvable yet — callers show "—" for the split then,
// never a wrong guess.
function deriveGstTypeClientPreview(companyStateName, shipToStateName) {
  const company = String(companyStateName || "").trim().toLowerCase();
  const shipTo = String(shipToStateName || "").trim().toLowerCase();
  if (!company || !shipTo) return null;
  return company === shipTo ? "CGST_SGST" : "IGST";
}

// MTO/HPS/MTS base quantity is derived in the UI from the pack inputs. Keep
// that derivation in one place so the displayed value, preview, and payload
// can never disagree.
function getLineBaseQty(line) {
  if (line.line_material_type === "FG" && line.fg_type !== "MTEST") {
    return toNumber(line.pack_qty) * toNumber(line.per_pack_qty);
  }
  return toNumber(line.base_qty || line.quantity);
}

// MTEST's own Pack Qty is derived the OPPOSITE way from every other FG type
// (base_qty / per_pack_qty) and is never written back into line.pack_qty
// state — the Pack Qty grid cell is a read-only computed display. Mirrors
// the backend's own MTEST derivation (sales_order.handlers.ts,
// prepareUnifiedSoLine's MTEST branch) so a Pack-UoM-rate MTEST line's
// preview and the actual saved total never disagree. Used by both the grid
// cell display and computeLinePreview so they can never drift apart.
function getMtestPackQty(line) {
  const perPackQty = toNumber(line.per_pack_qty);
  if (!perPackQty) return 0;
  return toNumber(line.base_qty) / perPackQty;
}

// Mirrors the backend's per-line taxable/GST computation closely enough for
// a live preview (final numbers are always computed server-side). gstType
// (from deriveGstTypeClientPreview) drives the CGST+SGST-vs-IGST split;
// null means "not resolvable yet" — cgst/sgst/igst all come back null so
// the UI shows "—" instead of a wrong 0.
function computeLinePreview(line, gstType) {
  const rate = toNumber(line.rate);
  const gstRate = toNumber(line.gst_rate);
  let qtyForAmount = getLineBaseQty(line);
  let taxableValue;
  let gstAmount;
  if (line.line_material_type === "FG") {
    qtyForAmount = line.rate_basis === "PACK_UOM"
      ? (line.fg_type === "MTEST" ? getMtestPackQty(line) : toNumber(line.pack_qty))
      : getLineBaseQty(line);
    if (line.fg_type === "MTEST" && line.rate_basis === "FIXED") {
      taxableValue = line.gst_treatment === "INCLUSIVE" ? rate / (1 + gstRate / 100) : rate;
      gstAmount = (taxableValue * gstRate) / 100;
    }
  }
  if (taxableValue === undefined) {
    const grossOrNetValue = rate * qtyForAmount;
    taxableValue = line.gst_treatment === "INCLUSIVE" ? grossOrNetValue / (1 + gstRate / 100) : grossOrNetValue;
    gstAmount = (taxableValue * gstRate) / 100;
  }
  const cgstAmount = gstType === "CGST_SGST" ? gstAmount / 2 : gstType === "IGST" ? 0 : null;
  const sgstAmount = gstType === "CGST_SGST" ? gstAmount / 2 : gstType === "IGST" ? 0 : null;
  const igstAmount = gstType === "IGST" ? gstAmount : gstType === "CGST_SGST" ? 0 : null;
  const roundOff = toNumber(line.round_off_amount);
  return { taxableValue, gstAmount, roundOff, totalValue: taxableValue + gstAmount + roundOff, cgstAmount, sgstAmount, igstAmount };
}

// §133.8-H — 3 read-only columns shared by every material type's item line
// grid. Not user-editable anywhere — always derived from rate/qty/gst_rate
// + the page-level GST-type preview (passed in explicitly since this is a
// module-level function, not a closure over component state).
function gstSplitColumns(gstTypePreview) {
  return [
    { key: "cgst", label: "CGST", width: "80px", align: "right", render: (line) => { const v = computeLinePreview(line, gstTypePreview).cgstAmount; return v != null ? v.toFixed(2) : "—"; } },
    { key: "sgst", label: "SGST", width: "80px", align: "right", render: (line) => { const v = computeLinePreview(line, gstTypePreview).sgstAmount; return v != null ? v.toFixed(2) : "—"; } },
    { key: "igst", label: "IGST", width: "80px", align: "right", render: (line) => { const v = computeLinePreview(line, gstTypePreview).igstAmount; return v != null ? v.toFixed(2) : "—"; } },
  ];
}

function numberInput(value, onChange, extra = {}) {
  return (
    <input
      type="number"
      step="0.0001"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
      {...extra}
    />
  );
}

function textInput(value, onChange, extra = {}) {
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
      {...extra}
    />
  );
}

export default function SO01CreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const availableCompanies = runtimeContext?.availableCompanies ?? [];
  const isMultiCompany = String(runtimeContext?.workspaceMode ?? "").toUpperCase() === "MULTI" && availableCompanies.length > 1;
  const defaultCompanyId = availableCompanies[0]?.id ?? "";

  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  // Page 1
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [soDate, setSoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [materialTypes, setMaterialTypes] = useState([]);
  const [dispatchType, setDispatchType] = useState("");
  const [ibnRequiredManual, setIbnRequiredManual] = useState(false);

  const ibnRequired = dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED"
    ? ibnRequiredManual
    : Boolean(IBN_REQUIRED_MAP[dispatchType]);

  // Page 2 — Bill-To/Ship-To resolution state (only the fields relevant to
  // the selected dispatch_type get sent; §133.8-B).
  const [parentCompanyId, setParentCompanyId] = useState("");
  const [vdcId, setVdcId] = useState("");
  const [depotCodeId, setDepotCodeId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [shipToCustomerAddressId, setShipToCustomerAddressId] = useState("");
  const [billToCustomerAddressId, setBillToCustomerAddressId] = useState("");
  const [noInboundSubType, setNoInboundSubType] = useState("DIRECT");
  const [paymentTermId, setPaymentTermId] = useState("");
  const [externalSoNumber, setExternalSoNumber] = useState("");
  const [externalSoDate, setExternalSoDate] = useState("");
  const [freightTerm, setFreightTerm] = useState("FOR");
  const [parentCompanies, setParentCompanies] = useState([]);
  const [depotCodes, setDepotCodes] = useState([]);
  const [ac06Months, setAc06Months] = useState([]);

  const [lines, setLines] = useState([]);

  const effectiveNoInboundType = dispatchType === "DEPENDENT_NO_INBOUND"
    ? (noInboundSubType === "DIRECT" ? "DEPENDENT_DIRECT" : "DEPENDENT_DEPOT")
    : dispatchType;

  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0, status: "ACTIVE" });
  const materials = useMemo(() => materialQuery.materials ?? [], [materialQuery.materials]);
  const materialMap = useMemo(() => new Map(materials.map((entry) => [entry.id, entry])), [materials]);
  const fgSkuQuery = useQuery({
    queryKey: ["so01-fg-sku-options", companyId],
    queryFn: () => listSalesOrderFgSkuOptions({ company_id: companyId }),
    enabled: Boolean(companyId && materialTypes.includes("FG")),
    staleTime: 60_000,
  });
  const fgSkusByType = useMemo(() => Object.fromEntries(
    FG_TYPE_OPTIONS.map(({ value: fgType }) => [fgType, (fgSkuQuery.data ?? []).filter((entry) => entry.fg_type === fgType)]),
  ), [fgSkuQuery.data]);
  const fgSkuMap = useMemo(() => new Map(
    Object.values(fgSkusByType).flat().map((entry) => [entry.id, entry]),
  ), [fgSkusByType]);
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const paymentTermOptions = useMemo(
    () => (paymentTermQuery.paymentTerms ?? []).map((entry) => ({ value: entry.id, label: `${entry.code || entry.name} | ${entry.name}` })),
    [paymentTermQuery.paymentTerms]
  );

  const customerQuery = useCustomerOptionsQuery(
    { company_id: companyId, limit: MASTER_PICKER_FETCH_LIMIT, offset: 0, status: "ACTIVE" },
    { enabled: Boolean(companyId) && (dispatchType === "INDEPENDENT_PARTY" || dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED") }
  );
  const customerOptions = useMemo(
    () => (customerQuery.customers ?? []).map((entry) => ({ value: entry.id, label: `${entry.customer_code || ""} — ${entry.customer_name || ""}`.trim() })),
    [customerQuery.customers]
  );
  const customerAddressQuery = useQuery({
    queryKey: ["so01-address-options", companyId, "customer", customerId],
    queryFn: () => listSalesOrderAddressOptions({ company_id: companyId, customer_id: customerId }),
    enabled: Boolean(companyId && customerId && (dispatchType === "INDEPENDENT_PARTY" || dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED")),
  });
  const parentAddressQuery = useQuery({
    queryKey: ["so01-address-options", companyId, "parent", parentCompanyId],
    queryFn: () => listSalesOrderAddressOptions({ company_id: companyId, parent_company_id: parentCompanyId }),
    enabled: Boolean(companyId && parentCompanyId && dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED"),
  });
  const customerAddresses = Array.isArray(customerAddressQuery.data) ? customerAddressQuery.data : [];
  const parentAddresses = Array.isArray(parentAddressQuery.data) ? parentAddressQuery.data : [];
  const addressLabel = (address) => [address?.customer?.customer_name, address?.site_name, address?.town, address?.address_line].filter(Boolean).join(" | ");
  const addressOptions = (addresses) => addresses.map((address) => ({ value: address.id, label: addressLabel(address) }));

  // §133.8-H — live GST-type preview for Page 2's per-row CGST/SGST/IGST
  // columns + footer breakup. Mirrors deriveSalesInvoiceGstType's own
  // resolution per dispatch_type exactly enough for a preview; the real
  // save always recomputes this server-side from the actually-resolved
  // Bill-To/Ship-To (§133.8-B), this never overrides that.
  const companyStateName = availableCompanies.find((entry) => entry.id === companyId)?.state_name || null;
  const resolvedShipToStateName = (() => {
    // Direct's final Ship-To resolves in SO Map. VDC and every MM04 address
    // mapped to it share the Parent Company's state, enough for GST preview.
    if (effectiveNoInboundType === "DEPENDENT_DIRECT") return parentCompanies.find((entry) => entry.id === parentCompanyId)?.state || null;
    if (effectiveNoInboundType === "DEPENDENT_DEPOT") return depotCodes.find((entry) => entry.id === depotCodeId)?.state || null;
    if (dispatchType === "INDEPENDENT_PARTY") return customerAddresses.find((entry) => entry.id === shipToCustomerAddressId)?.state || null;
    // Asian-billed changes Bill-To only; its Ship-To is always the selected
    // independent customer, so GST follows the customer's state.
    if (dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED") return customerAddresses.find((entry) => entry.id === shipToCustomerAddressId)?.state || null;
    return null;
  })();
  const gstTypePreview = deriveGstTypeClientPreview(companyStateName, resolvedShipToStateName);

  useEffect(() => {
    if (effectiveNoInboundType !== "DEPENDENT_DIRECT" && effectiveNoInboundType !== "DEPENDENT_DEPOT" && dispatchType !== "INDEPENDENT_PARTY_ASIAN_BILLED") return;
    listFgParentCompanies({}).then((result) => setParentCompanies(Array.isArray(result?.data) ? result.data : [])).catch(() => setParentCompanies([]));
  }, [dispatchType, effectiveNoInboundType]);
  // §133.8-E — Costing Rate Month dropdown source for FG/SFG MTO/HPS lines.
  // fetchProd's shape-dependent unwrap (bug pattern #15) — this handler's
  // okResponse({ data: [...] }) carries no `pagination` key, so fetchProd
  // unwraps one level further and resolves to the bare array directly.
  useEffect(() => {
    if (!companyId) { setAc06Months([]); return; }
    listAc06ApprovedMonths({ company_id: companyId })
      .then((result) => setAc06Months(Array.isArray(result) ? result : []))
      .catch(() => setAc06Months([]));
  }, [companyId]);
  useEffect(() => {
    if (!parentCompanyId) { setDepotCodes([]); return; }
    const wantType = effectiveNoInboundType === "DEPENDENT_DEPOT" ? "DEPOT" : "DIRECT";
    listFgDepotCodes({ parent_company_id: parentCompanyId, dispatch_type: wantType })
      .then((result) => setDepotCodes(Array.isArray(result?.data) ? result.data : []))
      .catch(() => setDepotCodes([]));
  }, [parentCompanyId, effectiveNoInboundType]);

  function toggleMaterialType(value) {
    setMaterialTypes((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  }

  function goToPage2() {
    if (!companyId) { setError("Select a company."); return; }
    if (materialTypes.length === 0) { setError("Select at least one Material Type."); return; }
    if (!dispatchType) { setError("Select a Dispatch Type."); return; }
    setError("");
    setLines(materialTypes.map((materialType) => makeLine(materialType)));
    setPage(2);
  }

  function addLine(materialType) {
    setLines((current) => [...current, makeLine(materialType)]);
  }
  function updateLine(key, patch) {
    setLines((current) => current.map((line) => (line.__key === key ? { ...line, ...patch } : line)));
  }
  function removeLine(key) {
    setLines((current) => current.filter((line) => line.__key !== key));
  }

  // §133.8-E — Costing Rate Month cell, shared by SFG and FG rows. MTEST = SO
  // Date's own month/year (read-only, no selection). MTS = deferred/spec-only,
  // PACE isn't dispatching MTS yet — placeholder only, never sent as a real
  // value. MTO/HPS = dropdown of AC06 months where every item is approved,
  // plus a fixed "Manual" entry.
  function costingMonthCell(line, key) {
    if (line.fg_type === "MTEST") {
      return (
        <input
          value={soDate ? formatMonthLabel(monthStartFromDate(soDate)) : "—"}
          readOnly
          className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none"
          title="Auto = SO Date's month/year"
        />
      );
    }
    if (line.fg_type === "MTS") {
      return (
        <input
          value="Deferred (MTS)"
          readOnly
          className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-400 outline-none"
          title="MTS Costing Rate Month is deferred/spec-only — PACE isn't dispatching MTS yet (§133.8-E)"
        />
      );
    }
    return (
      <select
        value={line.costing_rate_month || ""}
        onChange={(event) => updateLine(key, { costing_rate_month: event.target.value })}
        className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
      >
        <option value="">Select month</option>
        {ac06Months.map((entry) => (
          <option key={entry.rate_month} value={entry.rate_month}>{formatMonthLabel(entry.rate_month)}</option>
        ))}
        <option value="MANUAL">Manual</option>
      </select>
    );
  }

  function materialOptionsFor(materialType, fgType = "") {
    if (materialType === "FG") {
      return (fgSkusByType[fgType] ?? []).map((entry) => ({
        value: entry.id,
        label: [entry.pace_code, entry.external_code, entry.document_name || entry.material_name]
          .filter(Boolean)
          .join(" | "),
      }));
    }
    return materials
      .filter((entry) => String(entry.material_type || "").toUpperCase() === materialType)
      .map((entry) => ({
        value: entry.id,
        label: [entry.pace_code, entry.external_code, entry.document_name || entry.material_name]
          .filter(Boolean)
          .join(" | "),
      }));
  }

  function handleMaterialSelect(key, materialId) {
    const material = fgSkuMap.get(materialId) ?? materialMap.get(materialId);
    updateLine(key, {
      material_id: materialId,
      uom_code: material?.base_uom_code || "",
      gst_rate: material?.gst_rate != null ? String(material.gst_rate) : "",
      hsn_code: material?.hsn_code || "",
      pack_uom_code: material?.pack_uom_code || "",
      per_pack_qty: material?.per_pack_qty != null ? String(material.per_pack_qty) : "",
      __perPackVariable: Boolean(material?.variable_conversion),
    });
  }

  function hsnInputForLine(line) {
    const material = fgSkuMap.get(line.material_id) ?? materialMap.get(line.material_id);
    const masterHsn = String(material?.hsn_code || "").trim();
    const isMasterHsn = Boolean(masterHsn);
    return textInput(
      line.hsn_code,
      (value) => updateLine(line.__key, { hsn_code: value }),
      {
        readOnly: isMasterHsn,
        placeholder: isMasterHsn ? undefined : "Enter HSN",
        title: isMasterHsn ? "From Material Master" : "Required: this will be saved to Material Master",
        className: `h-8 w-full border px-2 text-xs outline-none ${isMasterHsn ? "border-slate-300 bg-slate-100 text-slate-500" : "border-amber-400 bg-[#fffef7] text-slate-900 focus:border-sky-500"}`,
      },
    );
  }

  function columnsFor(materialType) {
    if (materialType === "RM" || materialType === "PM" || materialType === "INT") {
      return [
        { key: "material", label: "Item", width: "220px", render: (line) => (
          <ErpComboboxField value={line.material_id} onChange={(value) => handleMaterialSelect(line.__key, value)} options={materialOptionsFor(materialType)} blankLabel={`Select ${materialType}`} />
        ) },
        { key: "hsn", label: "HSN Code", width: "100px", render: hsnInputForLine },
        { key: "batch", label: "Batch No.", width: "110px", render: (line) => textInput(line.batch_number, (value) => updateLine(line.__key, { batch_number: value })) },
        { key: "expiry", label: "Expiry", width: "120px", render: (line) => (
          <input type="date" value={line.expiry_date || ""} onChange={(event) => updateLine(line.__key, { expiry_date: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
        ) },
        { key: "qty", label: "Order Qty", width: "90px", render: (line) => numberInput(line.base_qty, (value) => updateLine(line.__key, { base_qty: value, quantity: value })) },
        { key: "uom", label: "UOM", width: "70px", render: (line) => textInput(line.uom_code, (value) => updateLine(line.__key, { uom_code: value })) },
        { key: "rate", label: "Rate", width: "90px", render: (line) => numberInput(line.rate, (value) => updateLine(line.__key, { rate: value })) },
        { key: "gst_treatment", label: "GST", width: "100px", render: (line) => (
          <select value={line.gst_treatment} onChange={(event) => updateLine(line.__key, { gst_treatment: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
            <option value="EXCLUSIVE">Exclusive</option>
            <option value="INCLUSIVE">Inclusive</option>
          </select>
        ) },
        { key: "gst_rate", label: "GST %", width: "70px", render: (line) => numberInput(line.gst_rate, (value) => updateLine(line.__key, { gst_rate: value })) },
        { key: "amount", label: "Amount", width: "100px", align: "right", render: (line) => computeLinePreview(line, gstTypePreview).taxableValue.toFixed(2) },
        ...gstSplitColumns(gstTypePreview),
        { key: "round_off", label: "Round Off", width: "90px", render: (line) => numberInput(line.round_off_amount, (value) => updateLine(line.__key, { round_off_amount: value })) },
        { key: "total", label: "Total Value", width: "100px", align: "right", render: (line) => computeLinePreview(line, gstTypePreview).totalValue.toFixed(2) },
        { key: "actions", label: "", width: "70px", render: (line) => (
          <button type="button" onClick={() => removeLine(line.__key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
        ) },
      ];
    }
    if (materialType === "SFG") {
      return [
        { key: "fg_type", label: "Type", width: "90px", render: (line) => (
          <select value={line.fg_type || ""} onChange={(event) => updateLine(line.__key, { fg_type: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
            <option value="">Select</option>
            {FG_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) },
        { key: "material", label: "Item", width: "200px", render: (line) => (
          <ErpComboboxField value={line.material_id} onChange={(value) => handleMaterialSelect(line.__key, value)} options={materialOptionsFor("SFG")} blankLabel="Select SFG" />
        ) },
        { key: "hsn", label: "HSN Code", width: "100px", render: hsnInputForLine },
        { key: "batch", label: "Batch No.", width: "110px", render: (line) => textInput(line.batch_number, (value) => updateLine(line.__key, { batch_number: value })) },
        { key: "costing_month", label: "Costing Rate Month", width: "150px", render: (line) => costingMonthCell(line, line.__key) },
        { key: "qty", label: "Order Qty", width: "90px", render: (line) => numberInput(line.base_qty, (value) => updateLine(line.__key, { base_qty: value, quantity: value })) },
        { key: "uom", label: "UOM", width: "70px", render: (line) => textInput(line.uom_code, (value) => updateLine(line.__key, { uom_code: value })) },
        { key: "rate", label: "Rate", width: "90px", render: (line) => numberInput(line.rate, (value) => updateLine(line.__key, { rate: value })) },
        { key: "gst_treatment", label: "GST", width: "100px", render: (line) => (
          <select value={line.gst_treatment} onChange={(event) => updateLine(line.__key, { gst_treatment: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
            <option value="EXCLUSIVE">Exclusive</option>
            <option value="INCLUSIVE">Inclusive</option>
          </select>
        ) },
        { key: "gst_rate", label: "GST %", width: "70px", render: (line) => numberInput(line.gst_rate, (value) => updateLine(line.__key, { gst_rate: value })) },
        { key: "amount", label: "Amount", width: "100px", align: "right", render: (line) => computeLinePreview(line, gstTypePreview).taxableValue.toFixed(2) },
        ...gstSplitColumns(gstTypePreview),
        { key: "round_off", label: "Round Off", width: "90px", render: (line) => numberInput(line.round_off_amount, (value) => updateLine(line.__key, { round_off_amount: value })) },
        { key: "total", label: "Total Value", width: "100px", align: "right", render: (line) => computeLinePreview(line, gstTypePreview).totalValue.toFixed(2) },
        { key: "actions", label: "", width: "70px", render: (line) => (
          <button type="button" onClick={() => removeLine(line.__key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
        ) },
      ];
    }
    // FG — mode depends on fg_type (MTEST vs MTO/HPS/MTS), §133.8-E.
    return [
      { key: "fg_type", label: "FG Type", width: "90px", render: (line) => (
        <select value={line.fg_type || ""} onChange={(event) => updateLine(line.__key, { fg_type: event.target.value, material_id: "", pack_uom_code: "", per_pack_qty: "", __perPackVariable: false, rate_basis: event.target.value === "MTEST" ? "FIXED" : "BASE_UOM" })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
          <option value="">Select</option>
          {FG_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) },
      { key: "material", label: "SKU", width: "220px", render: (line) => (
        <div className="grid gap-1">
          {line.__manualSku ? (
            textInput(line.manual_sku_name, (value) => updateLine(line.__key, { manual_sku_name: value }), { placeholder: "Type SKU name" })
          ) : (
            <ErpComboboxField value={line.material_id} onChange={(value) => handleMaterialSelect(line.__key, value)} options={materialOptionsFor("FG", line.fg_type)} blankLabel={line.fg_type ? "Select SKU" : "Select FG Type first"} />
          )}
          <button
            type="button"
            onClick={() => updateLine(line.__key, { __manualSku: !line.__manualSku, material_id: "", manual_sku_name: "" })}
            className="text-left text-[10px] font-semibold text-sky-700 underline"
          >
            {line.__manualSku ? "Select from Master instead" : "Not in list? Enter manually"}
          </button>
          {/* §133.9-G — LOCKED: manual FG SKU (not in Material Master/Stroke Master) shows a red warning right below the row; clears once the SKU exists in Master and a real material_id is selected instead. */}
          {line.__manualSku && line.manual_sku_name.trim() ? (
            <div className="text-[10px] font-semibold text-rose-700">This SKU is not found in PACE (Material Master/Stroke Master).</div>
          ) : null}
        </div>
      ) },
      // §133.8-D — Document Name is distinct from External Code. A manual SKU line shows the
      // typed name here too, since that IS the document name until the SKU
      // gets added to Material Master.
      { key: "document_name", label: "Document Name", width: "200px", render: (line) => (
        line.__manualSku
          ? (line.manual_sku_name.trim() || "—")
          : ((fgSkuMap.get(line.material_id) ?? materialMap.get(line.material_id))?.document_name || (fgSkuMap.get(line.material_id) ?? materialMap.get(line.material_id))?.material_name || "—")
      ) },
      { key: "hsn", label: "HSN Code", width: "100px", render: hsnInputForLine },
      { key: "pack_uom", label: "Pack UoM", width: "80px", render: (line) => (
        <input value={line.pack_uom_code || (line.fg_type === "MTEST" ? "BBL" : "")} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none" />
      ) },
      { key: "pack_qty", label: "Pack Qty", width: "80px", render: (line) => (
        line.fg_type === "MTEST"
          ? <input value={line.per_pack_qty ? getMtestPackQty(line).toFixed(4) : ""} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none" />
          : numberInput(line.pack_qty, (value) => updateLine(line.__key, { pack_qty: value }))
      ) },
      { key: "per_pack", label: "Per Pack (KG)", width: "100px", render: (line) => numberInput(line.per_pack_qty, (value) => updateLine(line.__key, { per_pack_qty: value }), { readOnly: line.fg_type === "MTEST" || !line.__perPackVariable }) },
      { key: "base_qty", label: "Base Qty", width: "100px", render: (line) => (
        line.fg_type === "MTEST"
          ? numberInput(line.base_qty, (value) => updateLine(line.__key, { base_qty: value }))
          : <input value={getLineBaseQty(line).toFixed(4)} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none" />
      ) },
      { key: "base_uom", label: "Base UoM", width: "80px", render: (line) => (
        <input value={line.uom_code || "KG"} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none" />
      ) },
      { key: "rate", label: "Rate", width: "90px", render: (line) => numberInput(line.rate, (value) => updateLine(line.__key, { rate: value })) },
      { key: "rate_basis", label: "Rate Basis / Type", width: "100px", render: (line) => (
        <select value={line.rate_basis || ""} onChange={(event) => updateLine(line.__key, { rate_basis: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
          {(line.fg_type === "MTEST" ? MTEST_RATE_TYPE_OPTIONS : RATE_BASIS_OPTIONS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) },
      { key: "gst_treatment", label: "GST", width: "100px", render: (line) => (
        <select value={line.gst_treatment} onChange={(event) => updateLine(line.__key, { gst_treatment: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
          <option value="EXCLUSIVE">Exclusive</option>
          <option value="INCLUSIVE">Inclusive</option>
        </select>
      ) },
      { key: "gst_rate", label: "GST %", width: "70px", render: (line) => numberInput(line.gst_rate, (value) => updateLine(line.__key, { gst_rate: value })) },
      { key: "amount", label: "Amount", width: "100px", align: "right", render: (line) => computeLinePreview(line, gstTypePreview).taxableValue.toFixed(2) },
      ...gstSplitColumns(gstTypePreview),
      { key: "costing_month", label: "Costing Rate Month", width: "150px", render: (line) => costingMonthCell(line, line.__key) },
      { key: "round_off", label: "Round Off", width: "90px", render: (line) => numberInput(line.round_off_amount, (value) => updateLine(line.__key, { round_off_amount: value })) },
      { key: "total", label: "Total Value", width: "100px", align: "right", render: (line) => computeLinePreview(line, gstTypePreview).totalValue.toFixed(2) },
      { key: "actions", label: "", width: "70px", render: (line) => (
        <button type="button" onClick={() => removeLine(line.__key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
      ) },
    ];
  }

  // §133.8-I — Page 2 footer totals: Total Nett Value, GST Breakup (only
  // non-zero components shown, matches intra-state vs inter-state), Round
  // Off, Sales Order Value (headline), Amount in Words (display-only, never
  // stored — §133.8-J's persistence principle).
  // Round Off is entered per item line (each row's own "Round Off" column,
  // business owner's explicit correction 2026-09-01 — not a single header
  // field) — the header total below is the SUM of those line values, shown
  // read-only, matching what the backend actually stores per line.
  const linePreviews = useMemo(() => lines.map((line) => computeLinePreview(line, gstTypePreview)), [lines, gstTypePreview]);
  const netTotal = linePreviews.reduce((sum, preview) => sum + preview.taxableValue, 0);
  const totalCgst = linePreviews.reduce((sum, preview) => sum + (preview.cgstAmount || 0), 0);
  const totalSgst = linePreviews.reduce((sum, preview) => sum + (preview.sgstAmount || 0), 0);
  const totalIgst = linePreviews.reduce((sum, preview) => sum + (preview.igstAmount || 0), 0);
  const totalGst = totalCgst + totalSgst + totalIgst;
  const roundOff = linePreviews.reduce((sum, preview) => sum + (preview.roundOff || 0), 0);
  const soValue = netTotal + totalGst + roundOff;

  function buildBillToShipToPayload() {
    const payload = {};
    if (effectiveNoInboundType === "DEPENDENT_DIRECT") {
      payload.parent_company_id = parentCompanyId;
      payload.vdc_id = vdcId;
    } else if (effectiveNoInboundType === "DEPENDENT_DEPOT") {
      payload.parent_company_id = parentCompanyId;
      payload.depot_code_id = depotCodeId;
    } else if (dispatchType === "INDEPENDENT_PARTY") {
      payload.customer_id = customerId;
      payload.ship_to_customer_address_id = shipToCustomerAddressId;
    } else if (dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED") {
      payload.customer_id = customerId;
      payload.parent_company_id = parentCompanyId;
      payload.ship_to_customer_address_id = shipToCustomerAddressId;
      payload.bill_to_customer_address_id = billToCustomerAddressId;
    }
    if (dispatchType === "DEPENDENT_NO_INBOUND") payload.no_inbound_sub_type = noInboundSubType;
    return payload;
  }

  async function handleSubmit() {
    if (lines.length === 0) { setError("At least one item line is required."); return; }
    if (!externalSoNumber.trim()) { setError("External SO Number is required."); return; }
    if (!isManualDocumentDateWithinWindow(soDate) || (externalSoDate && !isManualDocumentDateWithinWindow(externalSoDate))) {
      setError(MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
      return;
    }
    // §133.9-G — a manual-SKU FG line has no material_id by design; it must
    // carry a manual_sku_name instead. Every other line always needs a real item.
    if (lines.some((line) => !line.material_id && !(line.__manualSku && line.manual_sku_name.trim()))) {
      setError("Every line needs an item selected (or a manual SKU name entered).");
      return;
    }
    const missingHsnLine = lines.find((line) => {
      if (!line.material_id) return false;
      const material = fgSkuMap.get(line.material_id) ?? materialMap.get(line.material_id);
      return !String(material?.hsn_code || "").trim() && !line.hsn_code.trim();
    });
    if (missingHsnLine) {
      setError("HSN Code is required for an item that has no HSN in Material Master.");
      return;
    }
    const missingMonthLine = lines.find((line) => line.line_material_type === "FG" && ["MTO", "HPS"].includes(line.fg_type) && !line.costing_rate_month);
    if (missingMonthLine) {
      setError(`Costing Rate Month is required for FG ${missingMonthLine.fg_type}. Select a month before creating the SO.`);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createSalesOrderUnified({
        company_id: companyId,
        so_date: soDate,
        material_types: materialTypes,
        dispatch_type: dispatchType,
        customer_po_number: externalSoNumber.trim(),
        customer_po_date: externalSoDate || null,
        ibn_required: dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED" ? ibnRequiredManual : undefined,
        payment_term_id: paymentTermId || null,
        freight_term: freightTerm || null,
        round_off_amount: roundOff,
        ...buildBillToShipToPayload(),
        lines: lines.map((line) => ({
          line_material_type: line.line_material_type,
          material_id: line.__manualSku ? null : (line.material_id || null),
          manual_sku_name: line.__manualSku ? line.manual_sku_name.trim() : null,
          fg_type: line.fg_type || null,
          quantity: line.quantity === "" ? null : Number(line.quantity),
          base_qty: line.line_material_type === "FG" && line.fg_type !== "MTEST"
            ? getLineBaseQty(line)
            : (line.base_qty === "" ? null : Number(line.base_qty)),
          pack_uom_code: line.pack_uom_code || null,
          pack_qty: line.pack_qty === "" ? null : Number(line.pack_qty),
          per_pack_qty: line.per_pack_qty === "" ? null : Number(line.per_pack_qty),
          rate_basis: line.rate_basis || null,
          uom_code: line.uom_code || null,
          rate: line.rate === "" ? null : Number(line.rate),
          currency_code: line.currency_code || "INR",
          gst_treatment: line.gst_treatment,
          gst_rate: line.gst_rate === "" ? null : Number(line.gst_rate),
          hsn_code: line.hsn_code || null,
          batch_number: line.batch_number || null,
          expiry_date: line.expiry_date || null,
          round_off_amount: line.round_off_amount === "" ? 0 : Number(line.round_off_amount),
          // §133.8-E: MTEST always auto-derives from SO Date (no dropdown to
          // read from); MTS is deferred/spec-only and must never carry a real
          // value yet; MTO/HPS send whatever the dropdown/Manual holds.
          costing_rate_month: line.fg_type === "MTEST"
            ? monthStartFromDate(soDate)
            : line.fg_type === "MTS" ? null : (line.costing_rate_month || null),
          remarks: line.remarks || null,
        })),
      });
      setNotice("Sales order created.");
      navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "SO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const companyOptions = availableCompanies.map((entry) => ({ value: entry.id, label: entry.company_name || entry.company_code || entry.id }));
  const parentCompanyOptions = parentCompanies.map((entry) => ({ value: entry.id, label: entry.company_name }));
  const depotCodeOptions = depotCodes.map((entry) => ({ value: entry.id, label: `${entry.code || ""} — ${entry.description || ""}`.trim() }));
  const missingFgCostingRateMonth = lines.some((line) => line.line_material_type === "FG" && ["MTO", "HPS"].includes(line.fg_type) && !line.costing_rate_month);

  return (
    <ErpScreenScaffold
      eyebrow="Sales (SO01)"
      title={page === 1 ? "Create SO — Page 1: Criteria" : "Create SO — Page 2: Details & Items"}
      actions={[
        { key: "back", label: page === 1 ? "Back" : "Previous", tone: "neutral", onClick: () => (page === 1 ? popScreen() : setPage(1)) },
        page === 2
          ? { key: "save", label: saving ? "Saving..." : "Create SO", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || missingFgCostingRateMonth }
          : { key: "next", label: "Next", tone: "primary", onClick: goToPage2 },
      ]}
      notices={[
        ...(error ? [{ key: "so01-error", tone: "error", message: error }] : []),
        ...(missingFgCostingRateMonth ? [{ key: "so01-fg-month-required", tone: "warning", message: "Create SO is unavailable: select Costing Rate Month for every FG MTO/HPS line." }] : []),
        ...(notice ? [{ key: "so01-notice", tone: "success", message: notice }] : []),
      ]}
    >
      {page === 1 ? (
        <ErpSectionCard eyebrow="Page 1" title="Criteria">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ErpDenseFormRow label="Company" required>
              <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={!isMultiCompany} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100">
                {companyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="SO Date" required>
              <input type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} value={soDate} onChange={(event) => setSoDate(event.target.value)} className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Dispatch Type" required>
              <select value={dispatchType} onChange={(event) => setDispatchType(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                <option value="">Select dispatch type</option>
                {DISPATCH_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="IBN Required">
              {dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED" ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIbnRequiredManual(true)} className={`flex-1 px-3 py-2 text-xs font-semibold ${ibnRequiredManual ? "border border-emerald-700 bg-emerald-100 text-emerald-900" : "border border-slate-300 bg-white text-slate-700"}`}>Yes</button>
                  <button type="button" onClick={() => setIbnRequiredManual(false)} className={`flex-1 px-3 py-2 text-xs font-semibold ${!ibnRequiredManual ? "border border-slate-700 bg-slate-200 text-slate-950" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
                </div>
              ) : (
                <input readOnly value={dispatchType ? (ibnRequired ? "Yes" : "No") : "—"} className="h-9 w-full border border-slate-300 bg-slate-100 px-3 text-sm text-slate-600 outline-none" />
              )}
            </ErpDenseFormRow>
          </div>
          <div className="mt-4 grid gap-1 text-xs font-semibold text-slate-700">
            <span>Material Type <span className="text-rose-500">*</span></span>
            <div className="flex flex-wrap gap-3">
              {MATERIAL_TYPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800">
                  <input type="checkbox" checked={materialTypes.includes(option.value)} onChange={() => toggleMaterialType(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </ErpSectionCard>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 2" title="Bill-To / Ship-To">
            {effectiveNoInboundType === "DEPENDENT_DIRECT" && dispatchType !== "DEPENDENT_NO_INBOUND" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Parent Company" required>
                  <ErpComboboxField value={parentCompanyId} onChange={(value) => { setParentCompanyId(value); setVdcId(""); }} options={parentCompanyOptions} blankLabel="Select Parent Company" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="VDC" required>
                  <ErpComboboxField value={vdcId} onChange={setVdcId} options={depotCodeOptions} blankLabel={parentCompanyId ? "Select VDC" : "Select Parent Company first"} />
                </ErpDenseFormRow>
                <p className="col-span-2 text-xs text-slate-500">Bill-To resolves now. Final MM04 Ship-To address resolves in SO Map; its state is the selected Parent Company&apos;s state.</p>
              </div>
            ) : null}
            {effectiveNoInboundType === "DEPENDENT_DEPOT" && dispatchType !== "DEPENDENT_NO_INBOUND" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Parent Company" required>
                  <ErpComboboxField value={parentCompanyId} onChange={(value) => { setParentCompanyId(value); setDepotCodeId(""); }} options={parentCompanyOptions} blankLabel="Select Parent Company" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Depot Code" required>
                  <ErpComboboxField value={depotCodeId} onChange={setDepotCodeId} options={depotCodeOptions} blankLabel={parentCompanyId ? "Select Depot" : "Select Parent Company first"} />
                </ErpDenseFormRow>
              </div>
            ) : null}
            {dispatchType === "INDEPENDENT_PARTY" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Customer" required>
                  <ErpComboboxField value={customerId} onChange={(value) => { setCustomerId(value); setShipToCustomerAddressId(""); }} options={customerOptions} blankLabel="Select Customer" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Bill-To / Ship-To Address (MM04)" required>
                  <ErpComboboxField value={shipToCustomerAddressId} onChange={setShipToCustomerAddressId} options={addressOptions(customerAddresses)} blankLabel={customerId ? "Select customer address" : "Select Customer first"} />
                </ErpDenseFormRow>
              </div>
            ) : null}
            {dispatchType === "INDEPENDENT_PARTY_ASIAN_BILLED" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Customer" required>
                  <ErpComboboxField value={customerId} onChange={(value) => { setCustomerId(value); setShipToCustomerAddressId(""); }} options={customerOptions} blankLabel="Select Customer" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Ship-To Address (MM04)" required>
                  <ErpComboboxField value={shipToCustomerAddressId} onChange={setShipToCustomerAddressId} options={addressOptions(customerAddresses)} blankLabel={customerId ? "Select customer address" : "Select Customer first"} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Asian Parent Company" required>
                  <ErpComboboxField value={parentCompanyId} onChange={(value) => { setParentCompanyId(value); setBillToCustomerAddressId(""); }} options={parentCompanyOptions} blankLabel="Select Parent Company" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Bill-To Address (MM04)" required>
                  <ErpComboboxField value={billToCustomerAddressId} onChange={setBillToCustomerAddressId} options={addressOptions(parentAddresses)} blankLabel={parentCompanyId ? "Select Parent-side address" : "Select Parent Company first"} />
                </ErpDenseFormRow>
              </div>
            ) : null}
            {dispatchType === "DEPENDENT_NO_INBOUND" ? (
              <div className="grid gap-3">
                <div className="grid gap-1 text-xs font-semibold text-slate-700">
                  <span>Direct or Depot?</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setNoInboundSubType("DIRECT")} className={`flex-1 px-3 py-2 text-xs font-semibold ${noInboundSubType === "DIRECT" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Direct</button>
                    <button type="button" onClick={() => setNoInboundSubType("DEPOT")} className={`flex-1 px-3 py-2 text-xs font-semibold ${noInboundSubType === "DEPOT" ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}>Depot</button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <ErpDenseFormRow label="Parent Company" required>
                    <ErpComboboxField value={parentCompanyId} onChange={(value) => { setParentCompanyId(value); setVdcId(""); setDepotCodeId(""); }} options={parentCompanyOptions} blankLabel="Select Parent Company" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label={noInboundSubType === "DIRECT" ? "VDC" : "Depot Code"} required>
                    <ErpComboboxField value={noInboundSubType === "DIRECT" ? vdcId : depotCodeId} onChange={noInboundSubType === "DIRECT" ? setVdcId : setDepotCodeId} options={depotCodeOptions} blankLabel={parentCompanyId ? "Select" : "Select Parent Company first"} />
                  </ErpDenseFormRow>
                </div>
              </div>
            ) : null}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Page 2" title="Payment Terms & Freight">
            <div className="grid gap-3 md:grid-cols-4">
              <ErpDenseFormRow label="External SO Number" required>
                {textInput(externalSoNumber, setExternalSoNumber, { placeholder: "Enter customer/external SO number" })}
              </ErpDenseFormRow>
              <ErpDenseFormRow label="External SO Date">
                <input type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} value={externalSoDate} onChange={(event) => setExternalSoDate(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Payment Terms">
                <ErpComboboxField value={paymentTermId} onChange={setPaymentTermId} options={paymentTermOptions} blankLabel="Select Payment Terms" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Freight Term">
                <select value={freightTerm} onChange={(event) => setFreightTerm(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                  {FREIGHT_TERM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </ErpDenseFormRow>
            </div>
          </ErpSectionCard>

          {materialTypes.map((materialType) => (
            <ErpSectionCard key={materialType} eyebrow="Item Line" title={materialType}>
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={() => addLine(materialType)} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-sky-950">
                  Add {materialType} Row
                </button>
              </div>
              <ErpDenseGrid
                columns={columnsFor(materialType)}
                rows={lines.filter((line) => line.line_material_type === materialType)}
                rowKey={(line) => line.__key}
                cellNavigate
                fitColumnWidths
                emptyMessage={`No ${materialType} lines yet.`}
              />
            </ErpSectionCard>
          ))}

          <ErpSectionCard eyebrow="Totals" title="Order Summary (§133.8-I) — GST split is a live preview only, the actual save always recomputes it server-side from the resolved Ship-To">
            <div className="grid gap-1 text-sm text-slate-800 md:max-w-sm md:justify-self-end">
              <div className="flex justify-between"><span className="text-slate-500">Total Nett Value</span><span className="font-mono">{netTotal.toFixed(2)}</span></div>
              {totalCgst > 0 ? <div className="flex justify-between"><span className="text-slate-500">CGST</span><span className="font-mono">{totalCgst.toFixed(2)}</span></div> : null}
              {totalSgst > 0 ? <div className="flex justify-between"><span className="text-slate-500">SGST</span><span className="font-mono">{totalSgst.toFixed(2)}</span></div> : null}
              {totalIgst > 0 ? <div className="flex justify-between"><span className="text-slate-500">IGST</span><span className="font-mono">{totalIgst.toFixed(2)}</span></div> : null}
              {gstTypePreview === null && lines.length > 0 ? <div className="text-xs text-amber-700">GST split unavailable — the selected dispatch destination has no resolvable state.</div> : null}
              <div className="flex justify-between"><span className="text-slate-500" title="Entered per item line — see each line's own Round Off column above">Round Off (sum of lines)</span><span className="font-mono">{roundOff.toFixed(2)}</span></div>
              <div className="mt-1 flex justify-between border-t border-slate-300 pt-1 text-base font-bold"><span>Sales Order Value</span><span className="font-mono">{soValue.toFixed(2)}</span></div>
              <div className="mt-1 text-xs italic text-slate-500">{amountToWordsIndian(soValue)}</div>
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
