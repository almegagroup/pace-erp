import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import { bulkPostDeliveryOrders, listBulkPostingQueue } from "../procurementApi.js";

export default function SO02BulkPostingPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const query = useQuery({ queryKey: ["so02-bulk-posting", effectiveCompanyId], queryFn: () => listBulkPostingQueue(effectiveCompanyId), enabled: Boolean(effectiveCompanyId) });
  const rows = useMemo(() => Array.isArray(query.data?.items) ? query.data.items : [], [query.data]);
  const allIds = [...new Set(rows.filter((row) => row.postable !== false).map((row) => row.id).filter(Boolean))];
  const displayNumber = (value) => (value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
  function toggle(id) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  async function post() {
    if (!selected.size) return;
    setPosting(true); setNotice("");
    try {
      const result = await bulkPostDeliveryOrders([...selected]);
      const outcomes = Array.isArray(result?.results) ? result.results : [];
      const failed = outcomes.filter((row) => row.ok === false);
      setNotice(failed.length
        ? `${outcomes.length - failed.length} posted; ${failed.length} remain in the queue.`
        : `Posted ${outcomes.length || selected.size} delivery order(s).`);
      setSelected(new Set()); await query.refetch();
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "BULK_POST_FAILED"); }
    finally { setPosting(false); }
  }
  return <ErpMasterListTemplate
    eyebrow="Procurement / SO02"
    title="Bulk Posting — PGI & Invoice"
    actions={[
      { key: "back", label: "SO02 Queue", tone: "neutral", onClick: () => navigate("/dashboard/procurement/sales-invoices") },
      { key: "refresh", label: "Refresh", tone: "neutral", onClick: () => query.refetch(), disabled: query.isFetching },
      { key: "post", label: posting ? "Posting..." : `Bulk Post (${selected.size})`, tone: "primary", onClick: post, disabled: posting || selected.size === 0 },
    ]}
    notices={notice ? [{ key: "bulk-posting-notice", tone: notice.includes("FAILED") || notice.includes("remain in the queue") ? "warning" : "success", message: notice }] : []}
    filterSection={{ eyebrow: "Company", title: "Bulk-DO Upload records only", children: <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={(value) => { setCompanyId(value); setSelected(new Set()); }} label="Company" /> }}
    listSection={{ eyebrow: "Bulk PGI queue", title: `${allIds.length} delivery order${allIds.length === 1 ? "" : "s"}`, children: <ErpDenseGrid cellNavigate rows={rows} rowKey={(row) => `${row.id}-${row.line_number}`} emptyMessage={query.isLoading ? "Loading Bulk Posting queue..." : "No Bulk DO Upload records are pending."}
      columns={[
        { key: "select", label: <input aria-label="Select all" type="checkbox" checked={allIds.length > 0 && allIds.every((id) => selected.has(id))} onChange={(event) => setSelected(event.target.checked ? new Set(allIds) : new Set())} />, width: "52px", render: (row) => <input aria-label={`Select ${row.dc_number}`} type="checkbox" disabled={row.postable === false} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /> },
        { key: "dd_flag", label: "DD Flag", width: "84px", render: (row) => row.dd_flag ? "YES" : "NO" },
        { key: "posting_action", label: "SO02 Action", width: "180px", render: (row) => row.posting_action || "—" },
        { key: "so_number", label: "SO Number", width: "135px", render: (row) => row.so_number || "—" },
        { key: "fo_number", label: "FO Number", width: "135px", render: (row) => row.fo_number || "—" },
        { key: "external_so_number", label: "External SO Number", width: "165px", render: (row) => row.external_so_number || "—" },
        { key: "company_code", label: "Company Code", width: "120px", render: (row) => row.company_code || "—" },
        { key: "vendor_code", label: "Vendor Code", width: "160px", render: (row) => row.vendor_code || "—" },
        { key: "sku", label: "SKU", width: "180px", render: (row) => row.sku || row.material_id || "—" },
        { key: "pack_qty", label: "Pack Qty", width: "100px", align: "right", render: (row) => displayNumber(row.pack_qty) },
        { key: "base_qty", label: "Base Qty", width: "100px", align: "right", render: (row) => displayNumber(row.base_qty) },
        { key: "pre_invoice_tally_invoice_number", label: "Tally Invoice Number", width: "170px", render: (row) => row.pre_invoice_tally_invoice_number || "—" },
        { key: "pre_invoice_tally_invoice_date", label: "Tally Invoice Date", width: "150px", render: (row) => row.pre_invoice_tally_invoice_date || "—" },
        { key: "pre_invoice_inbound_number", label: "Inbound Number", width: "145px", render: (row) => row.pre_invoice_inbound_number || "—" },
        { key: "rate", label: "Rate", width: "110px", align: "right", render: (row) => displayNumber(row.rate) },
        { key: "gst_split", label: "GST Split", width: "110px", render: (row) => row.gst_split ? `${row.gst_split}${row.gst_rate ? ` (${row.gst_rate}%)` : ""}` : "—" },
        { key: "value", label: "Value", width: "120px", align: "right", render: (row) => displayNumber(row.value) },
        { key: "round_off", label: "Round Off", width: "105px", align: "right", render: (row) => displayNumber(row.round_off) },
        { key: "parent_company", label: "Parent Company", width: "170px", render: (row) => row.parent_company || "—" },
        { key: "bill_to", label: "Bill To", width: "180px", render: (row) => row.bill_to || "—" },
        { key: "ship_to", label: "Ship To", width: "180px", render: (row) => row.ship_to || "—" },
        { key: "transporter", label: "Transporter", width: "170px", render: (row) => row.transporter || "—" },
        { key: "lr_number", label: "LR Number", width: "125px", render: (row) => row.lr_number || "—" },
        { key: "lr_date", label: "LR Date", width: "120px", render: (row) => row.lr_date || "—" },
        { key: "vehicle_number", label: "Truck Number", width: "135px", render: (row) => row.vehicle_number || "—" },
        { key: "dispatch_date", label: "Dispatch Date", width: "130px", render: (row) => row.dispatch_date || "—" },
      ]} /> }}
  />;
}
