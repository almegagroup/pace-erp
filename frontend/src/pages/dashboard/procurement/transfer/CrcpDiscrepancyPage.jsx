/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/CrcpDiscrepancyPage.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: PO12 Tab 1 — CRCP Discrepancy List. Design:
 *          docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) — Tab 1 Design".
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listCrcpDiscrepancy } from "../procurementApi.js";
import { COLUMNS } from "./crcpDiscrepancyColumns.jsx";

const SEARCH_FIELDS = [
  "bill_to_company_name", "ship_to_company_name", "actual_receiver_company_name",
  "grn_number", "po_number", "sto_number", "vendor_name", "material_name",
  "external_code", "invoice_number", "transporter_name",
];

export default function CrcpDiscrepancyPage() {
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
          onClick: () => openScreen(OPERATION_SCREENS.PROC_PLANT_TRANSFER_SETTLEMENT.screen_code),
        },
        {
          key: "bulk-component-map",
          label: "Bulk Component Map",
          onClick: () => openScreenWithContext(OPERATION_SCREENS.PROC_BULK_COMPONENT_MAP.screen_code, {
            origin: "PO12", companyId: effectiveCompanyId, po12Search: search,
          }),
          disabled: !effectiveCompanyId,
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
