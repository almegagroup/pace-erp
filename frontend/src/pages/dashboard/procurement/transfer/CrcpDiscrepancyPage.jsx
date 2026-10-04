/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/CrcpDiscrepancyPage.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: PO12 Tab 1 — CRCP Discrepancy List. Design:
 *          docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) — Tab 1 Design".
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { listCrcpDiscrepancy } from "../procurementApi.js";

function formatQty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "0.000";
}

// Locked column order (CRCP Triangle -> Quantity -> Identification ->
// Document Numbers+Dates -> AC01 Relation). filterType: "date" opts a
// column into ErpDenseGrid's Excel-style Year/Month/Day tree filter.
const COLUMNS = [
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

const SEARCH_FIELDS = [
  "bill_to_company_name", "ship_to_company_name", "actual_receiver_company_name",
  "grn_number", "po_number", "sto_number", "vendor_name", "material_name",
  "external_code", "invoice_number", "transporter_name",
];

export default function CrcpDiscrepancyPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const listQuery = useQuery({
    queryKey: ["po12-crcp-discrepancy", effectiveCompanyId],
    queryFn: () => listCrcpDiscrepancy({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
  });

  const rows = useMemo(() => (Array.isArray(listQuery.data?.items) ? listQuery.data.items : []), [listQuery.data]);
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => SEARCH_FIELDS.some((field) => String(row[field] ?? "").toLowerCase().includes(needle)));
  }, [rows, search]);

  async function handleExportExcel() {
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `po12_crcp_discrepancy_${effectiveCompanyId || "company"}.xlsx`,
        sheetName: "CRCP Discrepancy",
        columns: COLUMNS,
        rows: filteredRows,
        getCellValue: (row, column) =>
          typeof column.filterValue === "function" ? column.filterValue(row) : (row?.[column.key] ?? ""),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement · PO12"
      title="PO12 · Tab 1 — CRCP Discrepancy List"
      notices={listQuery.isError ? [{ key: "crcp-error", tone: "error", message: listQuery.error?.message ?? "Unable to load CRCP discrepancies." }] : []}
      actions={[
        {
          key: "settlement",
          label: "Settlement",
          onClick: () => navigate("/dashboard/procurement/transfer/settlement"),
        },
        {
          key: "export",
          label: exporting ? "Exporting..." : "Export Excel",
          onClick: () => void handleExportExcel(),
          disabled: exporting || filteredRows.length === 0,
        },
      ]}
      filterSection={{
        eyebrow: "",
        title: "",
        children: (
          <div className="flex flex-wrap items-end gap-3">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Search
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="GRN, PO/STO, vendor, material, invoice..."
                className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500"
              />
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "",
        title: "",
        children: (
          <>
            <ErpDenseGrid
              columns={COLUMNS}
              rows={filteredRows}
              rowKey={(row) => row.grn_id}
              columnFilter
              emptyMessage={listQuery.isLoading ? "Loading..." : "No CRCP discrepancy rows for this company."}
            />
            <p className="mt-2 text-xs text-slate-500">
              Tab 2 (physical Transfer/Receive) —{" "}
              <Link to="/dashboard/procurement/transfer?tab=transfer" className="text-sky-700 underline underline-offset-2">
                switch to Tab 2
              </Link>
              .
            </p>
          </>
        ),
      }}
    />
  );
}
