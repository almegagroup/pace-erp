import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { listSalesReturns } from "../procurementApi.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";

export default function SO05ListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => { if (!companyId && effectiveCompanyId) setCompanyId(effectiveCompanyId); }, [companyId, effectiveCompanyId]);
  const query = useQuery({ queryKey: ["so05-list", effectiveCompanyId], queryFn: () => listSalesReturns({ company_id: effectiveCompanyId }), enabled: !!effectiveCompanyId, select: (data) => Array.isArray(data) ? data : data?.data ?? [] });
  // business owner, 2026-09-26: one row per ITEM (not per receipt), with
  // company code, item detail, invoice detail, every sending-location field
  // and the sender type -- all-column search, same shape asked for
  // SalesReturnPendingButton.jsx's modal.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return query.data ?? [];
    return (query.data ?? []).filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [query.data, search]);
  const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);
  const col = (key, label, extra = {}) => ({ key, label, render: (row) => dash(row[key]), ...extra });
  const columns = [
    col("receipt_number", "Receipt No."),
    col("status", "Status"),
    col("company_code", "Company Code"),
    col("line_material_type", "Item Type"),
    col("material_name", "Item Name"),
    col("document_name", "Document Name"),
    col("batch_number", "Batch Number"),
    col("expiry_date", "Expiry"),
    {
      key: "quantity",
      label: "Qty (Base UOM)",
      align: "right",
      render: (row) => dash([row.quantity, row.uom_code].filter((v) => v !== null && v !== undefined && v !== "").join(" ") || null),
    },
    col("num_packs", "Num Packs", { align: "right" }),
    col("invoice_number", "Invoice No."),
    col("invoice_date", "Invoice Date"),
    col("return_type_label", "Sender Type"),
    col("sending_parent_company_name", "Parent Company"),
    col("sending_vdc_code", "VDC"),
    col("sending_depot_code", "Depot"),
    col("sending_customer_name", "Customer"),
    col("sending_customer_address", "Customer Address"),
    col("sending_company_name", "Sending Company"),
    col("sending_name", "Sending Name"),
    col("sending_address", "Sending Address"),
    col("sending_state", "Sending State"),
    col("sending_gst_number", "Sending GST No."),
    col("vehicle_number", "Vehicle"),
  ];
  // Must push a real stack entry before navigating -- see
  // PROC_SALES_RETURN_CREATE/PROC_SALES_RETURN_INVOICE_POSTING's own
  // registration comment in operationScreens.js for why a bare navigate()
  // here caused a flicker back to this same list page.
  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_SALES_RETURN_CREATE.screen_code);
    navigate("/dashboard/procurement/sales/sales-return/create");
  }
  function openInvoicePosting() {
    openScreen(OPERATION_SCREENS.PROC_SALES_RETURN_INVOICE_POSTING.screen_code);
    navigate("/dashboard/procurement/sales/sales-return/invoices");
  }
  return <ErpScreenScaffold title="Sales Return" eyebrow="SO05" subtitle="Return receipts posted into Blocked stock." actions={[{ label: "Invoice Posting", tone: "neutral", onClick: openInvoicePosting }, { label: "Create Return", tone: "primary", onClick: openCreate }]}>
    <ErpSectionCard title="Return receipts">
      <div className="grid md:grid-cols-2 gap-3 mb-3"><TransactionCompanySelector runtimeContext={runtimeContext} value={effectiveCompanyId} onChange={setCompanyId} /><QuickFilterInput value={search} onChange={setSearch} placeholder="Search any column…" /></div>
      <ErpDenseGrid columns={columns} rows={filtered} emptyMessage={query.isLoading ? "Loading Sales Returns…" : "No Sales Return receipts found."} rowKey={(row) => row.item_id} />
    </ErpSectionCard>
  </ErpScreenScaffold>;
}
