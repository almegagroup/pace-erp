/*
 * File-ID: 27.FE-PR24-MTS-REGISTER-COLUMNS
 * File-Path: frontend/src/pages/dashboard/production/mtsProductionRegisterColumns.jsx
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: PR24 "MTS Production Register" sub-report grid columns -- kept out of
 *          OrderInformationSystemPage.jsx so that page does not grow another 100 lines.
 *          See feasibility doc §143.
 * Authority: Frontend
 */

// Same coloured-export palette PR24's own Posted Qty column uses (IN14 precedent).
const POSITIVE_FONT_ARGB = "FF047857";
const NEGATIVE_FONT_ARGB = "FFBE123C";

function isNum(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function formatQty(value, digits = 3) {
  if (!isNum(value)) return "";
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function qtyColumn(key, label, width, digits = 3) {
  return {
    key, label, width, align: "right",
    render: (row) => formatQty(row[key], digits) || "--",
    copyValue: (row) => formatQty(row[key], digits),
    excelValue: (row) => (isNum(row[key]) ? Number(row[key]) : ""),
    numFmt: digits === 0 ? "#,##0" : "#,##0.000",
  };
}

// Loss (negative) red, gain (positive) green -- on screen and in the Excel export.
function signedColumn(key, label, width, suffix = "") {
  const text = (row) => (isNum(row[key]) ? `${formatQty(row[key], 3)}${suffix}` : "");
  const tone = (row) => {
    const n = Number(row[key]);
    if (!isNum(row[key]) || Math.abs(n) < 0.000001) return null;
    return n > 0 ? "text-emerald-700 font-medium" : "text-rose-700 font-medium";
  };
  return {
    key, label, width, align: "right",
    render: (row) => <span className={tone(row) ?? "text-slate-500"}>{text(row) || "--"}</span>,
    copyValue: text,
    excelValue: (row) => (isNum(row[key]) ? Number(row[key]) : ""),
    excelColor: (row) => {
      const t = tone(row);
      return t ? { fontArgb: t.includes("emerald") ? POSITIVE_FONT_ARGB : NEGATIVE_FONT_ARGB } : null;
    },
    numFmt: "#,##0.000;-#,##0.000",
  };
}

export const MTS_REGISTER_COLUMNS = [
  { key: "production_date", label: "Date", width: "96px", filterType: "date" },
  { key: "shift_name", label: "Shift", width: "70px", render: (r) => r.shift_name || "--" },
  { key: "prodshade_code", label: "Prodshade Code", width: "120px", render: (r) => r.prodshade_code || "--" },
  { key: "prodshade_document_name", label: "Prodshade Document Name", width: "230px", render: (r) => r.prodshade_document_name || "--" },
  { key: "stroke_number", label: "Stroke", width: "70px", render: (r) => (r.stroke_number == null ? "--" : String(r.stroke_number)), copyValue: (r) => (r.stroke_number == null ? "" : String(r.stroke_number)) },
  { key: "process_po_number", label: "Process PO", width: "110px" },
  { key: "sku_code", label: "SKU Code", width: "120px", render: (r) => r.sku_code || "--" },
  { key: "sku_document_name", label: "SKU Document Name", width: "250px", render: (r) => r.sku_document_name || "--" },
  { key: "start_batch", label: "Start Batch", width: "100px", render: (r) => r.start_batch || "--" },
  { key: "to_batch", label: "To Batch", width: "100px", render: (r) => r.to_batch || "--" },
  qtyColumn("number_of_batches", "Number of Batches", "130px", 0),
  qtyColumn("batch_size", "Batch Size", "100px"),
  { key: "prodshade_uom", label: "Prodshade UOM", width: "110px", align: "center", render: (r) => r.prodshade_uom || "--" },
  qtyColumn("total_input_base_uom", "Total Input (Base UOM)", "150px"),
  qtyColumn("total_output_base_uom", "Total Output (Base UOM)", "160px"),
  qtyColumn("pack_size", "Pack Size", "90px"),
  qtyColumn("number_of_bags", "Number of Bags", "120px", 0),
  signedColumn("loss_gain", "Loss/Gain", "110px"),
  signedColumn("loss_gain_pct", "Loss/Gain %", "110px", "%"),
  { key: "posting_date", label: "Posting Date", width: "100px", filterType: "date", render: (r) => r.posting_date || "--" },
  { key: "standard_by", label: "Standard By", width: "190px", render: (r) => r.standard_by || "--" },
  { key: "verified_by", label: "Verify Done By", width: "190px", render: (r) => r.verified_by || "--" },
];
