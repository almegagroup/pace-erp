/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/ac01GridColumns.jsx
 * Domain: PROCUREMENT / ACCOUNTS
 * Purpose: AC01's own full list column set (including the "smart" per-component columns),
 *          split out of AC01Page.jsx so it can be imported by BulkComponentMapPage.jsx
 *          (2026-10-06) without violating the react-refresh/only-export-components rule
 *          (a page's default export must be its only component export; shared
 *          non-component values need their own file). AC01Page.jsx itself imports these
 *          back for its own drawer dropdowns/grid -- single source of truth, no drift.
 * Authority: Frontend
 */

import { Link } from "react-router-dom";

export const CHARGE_COST_TYPES = [
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
export const DUTY_LINE_TYPES = [
  { value: "IMPORT_DUTY", label: "Import duty" },
  { value: "EXCISE_DUTY", label: "Excise duty" },
  { value: "CST", label: "CST" },
  { value: "CUSTOMS_EDN_CESS", label: "Customs education cess" },
  { value: "ADDITIONAL_DUTY_IGST", label: "Additional duty / IGST" },
  { value: "DUTY_SETOFF", label: "Duty set-off" },
  { value: "ENTRY_TAX", label: "Entry tax (import-only)" },
  { value: "CUSTOMS_DUTY", label: "Customs duty" },
];
export const FINANCE_LINE_TYPES = [
  { value: "LC_CHARGES", label: "LC charges" },
  { value: "BANK_CHARGES", label: "Bank charges" },
];

export function toDDMMYYYY(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function formatNumberOrBlank(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "";
}

// Excel export counterpart to formatNumberOrBlank -- same blank-on-missing
// behavior, but returns the raw number (ExcelJS writes a string-valued cell
// as text, which breaks SUM()/AutoSum in the exported file).
export function excelNumberOrBlank(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  return Number.isFinite(num) ? num : "";
}

export function udDotClass(status) {
  if (status === "GREEN") return "bg-emerald-500";
  if (status === "YELLOW") return "bg-amber-500";
  if (status === "RED") return "bg-rose-500";
  return "bg-slate-300";
}

// Same status->color mapping as udDotClass, as an Excel font ARGB instead of
// a Tailwind class — used by the Status column's richText export so the
// exported cell carries the same two colored dots shown on screen instead
// of a plain-text label.
export function dotFontArgb(status) {
  if (status === "GREEN") return "FF10B981";
  if (status === "YELLOW") return "FFF59E0B";
  if (status === "RED") return "FFF43F5E";
  return "FFCBD5E1";
}

export function paymentDotStatus(row) {
  if (row.payment_status) return row.payment_status;
  // Payment status genuinely depends on AC02's Vendor Ledger, not yet built —
  // this deliberately falls back to a neutral dot rather than guessing.
  return null;
}

// Backend only returns a stable code (e.g. "FREIGHT") for cost-type
// components -- it has no reason to duplicate these display labels, which
// are frontend-only strings anyway (see ac01.handlers.ts's
// COST_TYPE_CANONICAL_ORDER comment). Deduction components carry their own
// label straight from the backend instead, since deduction type names are
// per-company free text (deduction_type_master), not a fixed enum.
const COST_TYPE_LABELS = new Map(
  [...DUTY_LINE_TYPES, ...CHARGE_COST_TYPES, ...FINANCE_LINE_TYPES].map((option) => [option.value, option.label]),
);

// Business owner, 2026-09-03: one column per landed-cost component actually
// used in the current (filtered) result set -- "smart" because the column
// SET itself comes from the backend's `components` metadata (recomputed per
// request from the current filters), not a fixed list. Sits right before
// Landed Cost Total so a row's total is visibly the sum of its own shown
// components. Reused as-is for the Bulk Component Mapper's PO12-origin grid
// (2026-10-06), appended after that page's own full column set.
export function buildComponentColumns(components) {
  return (components ?? []).map((component) => {
    const label = component.kind === "deduction" ? component.label : (COST_TYPE_LABELS.get(component.key) || component.key);
    return {
      key: `component:${component.key}`,
      label,
      width: "110px",
      align: "right",
      render: (row) => formatNumberOrBlank(row.component_breakdown?.[component.key]),
      copyValue: (row) => formatNumberOrBlank(row.component_breakdown?.[component.key]),
      excelValue: (row) => excelNumberOrBlank(row.component_breakdown?.[component.key]),
      numFmt: "#,##0.00",
    };
  });
}

// AC01's real, full list column set (including the "smart" per-component
// columns above). Reused as-is for the Bulk Component Mapper's AC01-origin
// grid (2026-10-06) -- same table the real AC01 page shows, not a trimmed copy.
export function buildColumns(components) {
  return [
    {
      key: "status", label: "Status", width: "88px",
      render: (row) => (
        row.is_reversed ? (
          <span
            className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700"
            title={
              row.split_into_grn_numbers?.length
                ? `REVERSED — split into: ${row.split_into_grn_numbers.join(", ")}`
                : "REVERSED — this GRN has been reversed and is no longer payment-relevant."
            }
          >
            REVERSED{row.split_into_grn_numbers?.length ? " (split)" : ""}
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${udDotClass(row.ud_status)}`} title={row.ud_status ? `UD: ${row.ud_status}` : "No QA required"} />
            <span
              className={`inline-block h-2 w-2 rounded-full ${paymentDotStatus(row) === "GREEN" ? "bg-emerald-500" : paymentDotStatus(row) === "YELLOW" ? "bg-amber-500" : paymentDotStatus(row) === "RED" ? "bg-rose-500" : "bg-slate-300"}`}
              title="Payment status (pending AC02 Vendor Ledger)"
            />
            {row.invoice_verified_by ? (
              <span className="text-sm font-bold leading-none text-emerald-600" title={`Invoice verified by ${row.invoice_verified_by_display || row.invoice_verified_by}`}>✓</span>
            ) : null}
          </div>
        )
      ),
      // Two dots, not one raw value. Ctrl+C copy is plain clipboard text, so
      // it gets a text summary; the Excel export can carry real formatting,
      // so it gets the same two colored dots shown on screen instead (see
      // excelRichText below). A REVERSED row (§3.9.5 "GRN Split" included)
      // copies/exports as a plain text marker instead.
      copyValue: (row) => (
        row.is_reversed
          ? `REVERSED${row.split_into_grn_numbers?.length ? ` (split into: ${row.split_into_grn_numbers.join(", ")})` : ""}`
          : `UD:${row.ud_status || "—"} Payment:${paymentDotStatus(row) || "—"} Invoice verified:${row.invoice_verified_by ? "Yes" : "No"}`
      ),
      excelRichText: (row) => (
        row.is_reversed
          ? [{ text: `REVERSED${row.split_into_grn_numbers?.length ? ` (split: ${row.split_into_grn_numbers.join(", ")})` : ""}`, fontArgb: "FFBE123C", bold: true }]
          : [
            { text: "●", fontArgb: dotFontArgb(row.ud_status) },
            { text: " ● ", fontArgb: dotFontArgb(paymentDotStatus(row)) },
            ...(row.invoice_verified_by ? [{ text: " ✓", fontArgb: "FF16A34A", bold: true }] : []),
          ]
      ),
    },
    { key: "csn_number", label: "CSN Number", width: "120px" },
    { key: "grn_number", label: "GRN Number", width: "120px" },
    { key: "grn_date", label: "GRN Date", width: "100px", render: (row) => toDDMMYYYY(row.grn_date), copyValue: (row) => toDDMMYYYY(row.grn_date) },
    { key: "company_code", label: "Company", width: "90px" },
    {
      // AC01 "ITC To" column (locked 2026-10-04) — who actually claims this
      // GRN's ITC. Blank for the ordinary (non-CRCP) case. Shown to every
      // viewer (unlike Settlement Invoice below, which is viewer-gated).
      key: "itc_owner_company_code", label: "ITC To", width: "80px",
      render: (row) => row.itc_owner_company_code || "—",
    },
    { key: "supplier_name", label: "Supplier", width: "160px" },
    { key: "invoice_number", label: "Invoice No.", width: "120px" },
    { key: "invoice_date", label: "Invoice Date", width: "100px", render: (row) => toDDMMYYYY(row.invoice_date), copyValue: (row) => toDDMMYYYY(row.invoice_date) },
    { key: "item_name", label: "Item Name", width: "160px" },
    { key: "external_code", label: "External Code", width: "110px" },
    { key: "grn_qty", label: "GRN Qty", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.grn_qty) },
    { key: "invoice_qty", label: "Invoice Qty", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.invoice_qty) },
    { key: "base_uom_code", label: "Base UoM", width: "80px" },
    { key: "pack_uom_code", label: "Pack UoM", width: "80px" },
    { key: "purchase_rate", label: "Purchase Rate", width: "100px", align: "right", render: (row) => formatNumberOrBlank(row.purchase_rate) },
    {
      key: "invoice_rate", label: "Invoice Rate", width: "110px", align: "right",
      render: (row) => (
        <span>
          {formatNumberOrBlank(row.invoice_rate)}
          {row.rate_mismatch ? <span className="ml-1 text-[9px] font-semibold text-rose-600">mismatch</span> : null}
        </span>
      ),
      copyValue: (row) => `${formatNumberOrBlank(row.invoice_rate)}${row.rate_mismatch ? " (mismatch)" : ""}`,
      excelColor: (row) => (row.rate_mismatch ? { fontArgb: "FFBE123C", bold: true } : null),
      excelValue: (row) => excelNumberOrBlank(row.invoice_rate),
      numFmt: "#,##0.0000",
    },
    { key: "confirmed_rate", label: "Confirmed Rate", width: "100px", align: "right", render: (row) => formatNumberOrBlank(row.confirmed_rate) },
    { key: "currency", label: "Currency", width: "70px" },
    { key: "gst_pct", label: "GST %", width: "70px", align: "right", render: (row) => formatNumberOrBlank(row.gst_pct) },
    { key: "taxable_value", label: "Taxable Value", width: "110px", align: "right", render: (row) => formatNumberOrBlank(row.taxable_value) },
    { key: "material_gst_type", label: "GST Type", width: "100px" },
    { key: "material_gst_amount", label: "Material GST", width: "110px", align: "right", render: (row) => formatNumberOrBlank(row.material_gst_amount) },
    { key: "material_cgst_amount", label: "CGST", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.material_cgst_amount) },
    { key: "material_sgst_amount", label: "SGST", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.material_sgst_amount) },
    { key: "material_igst_amount", label: "IGST", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.material_igst_amount) },
    { key: "invoice_total_value", label: "Invoice Total", width: "110px", align: "right", render: (row) => formatNumberOrBlank(row.invoice_total_value) },
    ...buildComponentColumns(components),
    { key: "landed_cost_total", label: "Landed Cost", width: "110px", align: "right", render: (row) => formatNumberOrBlank(row.landed_cost_total) },
    { key: "cost_per_unit", label: "Cost / Unit", width: "100px", align: "right", render: (row) => formatNumberOrBlank(row.cost_per_unit) },
    {
      // PO12 "AC01 Settlement Invoice" column (locked 2026-10-04) — shown
      // only for the CRCP ITC-To rows this company's own AC01 now mirrors
      // (§5 "AC01 ITC To"); the backend (buildListRow) only ever populates
      // these fields when the viewer company is this GRN's own
      // itc_owner_company_id, so the Actual Receiver's unrelated view of its
      // own GRN never shows a value here. Displays the Tally Invoice Number
      // (never the internal SETTLEMENT series number — see
      // settlement_document_number, used only by the print template's own
      // "Delivery Note" slot).
      key: "settlement_invoice_tally_number", label: "Settlement Invoice", width: "130px",
      render: (row) => row.settlement_invoice_tally_number || "—",
      copyValue: (row) => row.settlement_invoice_tally_number || "",
    },
    {
      // Separate "Preview" column (business owner, 2026-10-05) — View/Print
      // link kept apart from the plain-text invoice number above (the locked
      // design phrased "clicking the number OR a separate action" as an
      // explicit either/or; this is the "separate action" choice).
      key: "settlement_invoice_preview", label: "Preview", width: "70px",
      render: (row) => (
        row.settlement_invoice_id ? (
          <Link
            to={`/dashboard/procurement/settlements/${encodeURIComponent(row.settlement_invoice_id)}/print`}
            target="_blank"
            rel="noreferrer"
            className="text-sky-700 underline underline-offset-2"
          >
            View/Print
          </Link>
        ) : "—"
      ),
      copyValue: () => "",
    },
    { key: "vendor_payable", label: "Vendor Payable (material)", width: "150px", align: "right", render: (row) => formatNumberOrBlank(row.vendor_payable) },
    {
      key: "vendor_suggested_payable", label: "Vendor Payable (total)", width: "140px", align: "right",
      render: (row) => formatNumberOrBlank(row.vendor_payable_override ?? row.vendor_suggested_payable),
      // The raw row[key] fallback would always copy the un-overridden
      // suggested value, silently ignoring a manager's override — same
      // override-aware value the cell itself renders.
      copyValue: (row) => formatNumberOrBlank(row.vendor_payable_override ?? row.vendor_suggested_payable),
      excelValue: (row) => excelNumberOrBlank(row.vendor_payable_override ?? row.vendor_suggested_payable),
      numFmt: "#,##0.00",
    },
    {
      key: "transporter_suggested_payable", label: "Transporter Payable", width: "140px", align: "right",
      render: (row) => formatNumberOrBlank(row.transporter_payable_override ?? row.transporter_suggested_payable),
      copyValue: (row) => formatNumberOrBlank(row.transporter_payable_override ?? row.transporter_suggested_payable),
      excelValue: (row) => excelNumberOrBlank(row.transporter_payable_override ?? row.transporter_suggested_payable),
      numFmt: "#,##0.00",
    },
    {
      key: "last_mile_suggested_payable", label: "Last Mile Payable", width: "140px", align: "right",
      render: (row) => formatNumberOrBlank(row.last_mile_payable_override ?? row.last_mile_suggested_payable),
      copyValue: (row) => formatNumberOrBlank(row.last_mile_payable_override ?? row.last_mile_suggested_payable),
      excelValue: (row) => excelNumberOrBlank(row.last_mile_payable_override ?? row.last_mile_suggested_payable),
      numFmt: "#,##0.00",
    },
    {
      key: "cha_suggested_payable", label: "CHA Payable", width: "120px", align: "right",
      render: (row) => formatNumberOrBlank(row.cha_payable_override ?? row.cha_suggested_payable),
      copyValue: (row) => formatNumberOrBlank(row.cha_payable_override ?? row.cha_suggested_payable),
      excelValue: (row) => excelNumberOrBlank(row.cha_payable_override ?? row.cha_suggested_payable),
      numFmt: "#,##0.00",
    },
    { key: "payment_days", label: "Payment Days", width: "90px", align: "right" },
    { key: "payment_type", label: "Payment Type", width: "140px" },
    { key: "actual_payment_date", label: "Actual Payment Date", width: "120px", render: (row) => toDDMMYYYY(row.actual_payment_date), copyValue: (row) => toDDMMYYYY(row.actual_payment_date) },
    { key: "revised_payment_date", label: "Revised Payment Date", width: "130px", render: (row) => toDDMMYYYY(row.revised_payment_date), copyValue: (row) => toDDMMYYYY(row.revised_payment_date) },
    { key: "freight_type", label: "Freight Type", width: "100px" },
    {
      key: "transporter_id", label: "Transporter", width: "160px", render: (row) => row.transporter_name || "—",
      // §8A — key is the raw FK id; without copyValue the default fallback
      // would copy that UUID instead of the resolved name shown on screen.
      copyValue: (row) => row.transporter_name || "",
    },
    {
      key: "last_mile_transporter_id", label: "Last Mile Transporter", width: "170px", render: (row) => row.last_mile_transporter_name || "—",
      copyValue: (row) => row.last_mile_transporter_name || "",
    },
    { key: "lr_number", label: "LR Number", width: "100px" },
    { key: "lr_date", label: "LR Date", width: "90px", render: (row) => toDDMMYYYY(row.lr_date), copyValue: (row) => toDDMMYYYY(row.lr_date) },
    { key: "bl_number", label: "BL Number", width: "100px" },
    { key: "bl_date", label: "BL Date", width: "90px", render: (row) => toDDMMYYYY(row.bl_date), copyValue: (row) => toDDMMYYYY(row.bl_date) },
    { key: "lc_number", label: "LC Number", width: "100px" },
    { key: "lc_date", label: "LC Date", width: "90px", render: (row) => toDDMMYYYY(row.lc_date), copyValue: (row) => toDDMMYYYY(row.lc_date) },
    { key: "boe_number", label: "BOE Number", width: "100px" },
    { key: "boe_date", label: "BOE Date", width: "90px", render: (row) => toDDMMYYYY(row.boe_date), copyValue: (row) => toDDMMYYYY(row.boe_date) },
    { key: "invoice_verified_by_display", label: "Invoice Verified By", width: "160px", copyValue: (row) => row.invoice_verified_by_display || "" },
  ];
}
