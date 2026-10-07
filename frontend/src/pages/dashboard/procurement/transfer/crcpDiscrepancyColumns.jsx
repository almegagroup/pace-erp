/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/crcpDiscrepancyColumns.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: PO12 Tab 1's own full column set, split out of CrcpDiscrepancyPage.jsx so it
 *          can be imported by BulkComponentMapPage.jsx (2026-10-06) without violating the
 *          react-refresh/only-export-components rule (a page's default export must be its
 *          only component export; a shared non-component value needs its own file).
 * Authority: Frontend
 */

function formatQty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "0.000";
}

// Locked column order (CRCP Triangle -> Quantity -> Identification ->
// Document Numbers+Dates -> AC01 Relation). filterType: "date" opts a
// column into ErpDenseGrid's Excel-style Year/Month/Day tree filter.
export const COLUMNS = [
  { key: "bill_to_company_name", label: "Bill-To Company", width: "170px" },
  { key: "ship_to_company_name", label: "Ship-To Company", width: "170px" },
  { key: "actual_receiver_company_name", label: "Actual Receiver", width: "170px" },
  { key: "grn_qty", label: "GRN Qty", width: "100px", align: "right", render: (row) => formatQty(row.grn_qty) },
  { key: "base_uom_code", label: "UOM", width: "70px" },
  { key: "grn_number", label: "GRN No.", width: "120px" },
  { key: "grn_date", label: "GRN Date", width: "110px", filterType: "date" },
  { key: "po_number", label: "PO No.", width: "120px" },
  { key: "sto_number", label: "STO No.", width: "120px" },
  { key: "vendor_name", label: "Vendor", width: "160px" },
  { key: "material_name", label: "Material", width: "160px" },
  { key: "external_code", label: "External Code", width: "120px" },
  { key: "invoice_number", label: "Invoice No.", width: "120px" },
  { key: "invoice_date", label: "Invoice Date", width: "110px", filterType: "date" },
  { key: "bulk_challan_number", label: "Challan No.", width: "120px" },
  { key: "bulk_challan_date", label: "Challan Date", width: "110px", filterType: "date" },
  { key: "container_number", label: "Container No.", width: "130px" },
  { key: "ewaybill_number", label: "E-way Bill No.", width: "130px" },
  { key: "rst_number", label: "RST No.", width: "110px" },
  { key: "lr_number", label: "LR No.", width: "110px" },
  { key: "lr_date", label: "LR Date", width: "110px", filterType: "date" },
  { key: "transporter_name", label: "Transporter", width: "160px" },
  { key: "landed_cost_total", label: "Landed Cost Total", width: "140px", align: "right", render: (row) => formatQty(row.landed_cost_total) },
  {
    key: "rate_confirmed",
    label: "Rate Confirmed",
    width: "120px",
    render: (row) => (row.rate_confirmed ? "Yes" : "No"),
    filterValue: (row) => (row.rate_confirmed ? "Yes" : "No"),
  },
  {
    key: "settlement_status",
    label: "Settlement Status",
    width: "130px",
    render: (row) => (
      <span
        className={
          row.settlement_status === "SETTLED"
            ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
            : "rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
        }
      >
        {row.settlement_status === "SETTLED" ? "Settled" : "Pending"}
      </span>
    ),
  },
];
