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
  const filtered = useMemo(() => (query.data ?? []).filter((row) => [row.receipt_number, row.return_type, row.sending_name, row.vehicle_number, row.status].some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase()))), [query.data, search]);
  const columns = [
    { key: "receipt_number", label: "Receipt No." }, { key: "receipt_date", label: "Date" },
    { key: "return_type", label: "Return Type" }, { key: "sending_name", label: "Sending Party" },
    { key: "vehicle_number", label: "Vehicle" }, { key: "status", label: "Status" },
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
      <div className="grid md:grid-cols-2 gap-3 mb-3"><TransactionCompanySelector runtimeContext={runtimeContext} value={effectiveCompanyId} onChange={setCompanyId} /><QuickFilterInput value={search} onChange={setSearch} placeholder="Search receipt, sender, type or vehicle" /></div>
      <ErpDenseGrid columns={columns} rows={filtered} emptyMessage={query.isLoading ? "Loading Sales Returns…" : "No Sales Return receipts found."} rowKey={(row) => row.id} />
    </ErpSectionCard>
  </ErpScreenScaffold>;
}
