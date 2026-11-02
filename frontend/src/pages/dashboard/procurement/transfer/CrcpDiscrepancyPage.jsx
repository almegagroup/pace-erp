/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/CrcpDiscrepancyPage.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: PO12 Tab 1 — CRCP Discrepancy List. Design:
 *          docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) — Tab 1 Design".
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { pushToast } from "../../../../store/uiToast.js";
import { openScreen, openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createCrcpCostComponent, listCrcpDiscrepancy } from "../procurementApi.js";
import { COLUMNS } from "./crcpDiscrepancyColumns.jsx";

const SEARCH_FIELDS = [
  "bill_to_company_name", "ship_to_company_name", "actual_receiver_company_name",
  "grn_number", "po_number", "sto_number", "vendor_name", "material_name",
  "external_code", "invoice_number", "transporter_name",
];

// Same component vocabulary as AC01 / Bulk Component Map (the backend takes any cost_type).
const COST_TYPE_OPTIONS = [
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
const EMPTY_FORM = { cost_type: "FREIGHT", amount: "", bill_reference: "", bill_date: "", description: "" };
const FIELD_CLASS = "h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500";

// One GRN, one cost line, entered by the Bill-To company (CRCP Cost Component Entry, locked 2026-10-04).
// The line is appended to the GRN's own landed cost record, so the unloading company sees it in its AC01.
function AddComponentDrawer({ row, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const mutation = useMutation({
    mutationFn: () => createCrcpCostComponent({
      grn_id: row.grn_id,
      cost_type: form.cost_type,
      amount: Number(form.amount),
      bill_reference: form.bill_reference.trim() || null,
      bill_date: form.bill_date || null,
      description: form.description.trim() || null,
    }),
    onSuccess: () => onSaved(row, form),
    onError: (error) => pushToast({ message: error?.message ?? "Unable to add the cost component.", tone: "error" }),
  });
  const amountValid = Number.isFinite(Number(form.amount)) && Number(form.amount) > 0;
  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <DrawerBase
      visible
      title={`Add Component — GRN ${row.grn_number ?? ""}`}
      onClose={onClose}
      width="min(460px, calc(100vw - 24px))"
      actions={
        <>
          <button type="button" onClick={onClose} className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">Cancel</button>
          <button
            type="button"
            disabled={!amountValid || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="h-8 border border-emerald-600 bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {mutation.isPending ? "Saving..." : "Add Component"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 text-sm text-slate-700">
        <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div><strong>PO/STO:</strong> {row.po_number || row.sto_number || "—"}</div>
          <div><strong>Vendor:</strong> {row.vendor_name || "—"}</div>
          <div><strong>Material:</strong> {row.material_name || "—"}</div>
          <div><strong>Received at:</strong> {row.actual_receiver_company_name || "—"}</div>
        </div>
        <label className="grid gap-1 text-xs font-semibold">
          Component
          <select value={form.cost_type} onChange={setField("cost_type")} className={FIELD_CLASS}>
            {COST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Amount
          <input type="number" min="0" step="0.01" value={form.amount} onChange={setField("amount")} className={FIELD_CLASS} placeholder="Amount for this GRN" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Bill reference
          <input type="text" value={form.bill_reference} onChange={setField("bill_reference")} className={FIELD_CLASS} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Bill date
          <input type="date" value={form.bill_date} onChange={setField("bill_date")} className={FIELD_CLASS} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Description
          <input type="text" value={form.description} onChange={setField("description")} className={FIELD_CLASS} />
        </label>
        <p className="text-xs text-slate-500">
          The line is added to this GRN&apos;s landed cost; the company that received the goods sees it in its own AC01.
          Use Bulk Component Map to spread one bill over many GRNs.
        </p>
      </div>
    </DrawerBase>
  );
}

export default function CrcpDiscrepancyPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const queryClient = useQueryClient();
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

  // "Add Component" only on rows where the selected company is the Bill-To (the backend enforces it too).
  const gridColumns = useMemo(() => [
    ...COLUMNS,
    {
      key: "add_component",
      label: "Component",
      width: "130px",
      render: (row) => (row.bill_to_company_id && row.bill_to_company_id === effectiveCompanyId ? (
        <button
          type="button"
          onClick={() => setAddTarget(row)}
          className="h-6 border border-sky-600 bg-white px-2 text-[11px] font-semibold text-sky-700 hover:bg-sky-50"
        >
          Add Component
        </button>
      ) : <span className="text-slate-400">—</span>),
      filterValue: () => "",
    },
  ], [effectiveCompanyId]);

  function handleComponentSaved(row, form) {
    setAddTarget(null);
    pushToast({ message: `Component added to GRN ${row.grn_number}: ${form.cost_type} ${Number(form.amount).toFixed(2)}.`, tone: "success" });
    void queryClient.invalidateQueries({ queryKey: ["po12-crcp-discrepancy"] });
  }

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
              columns={gridColumns}
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
            {addTarget ? <AddComponentDrawer row={addTarget} onClose={() => setAddTarget(null)} onSaved={handleComponentSaved} /> : null}
          </>
        ),
      }}
    />
  );
}
