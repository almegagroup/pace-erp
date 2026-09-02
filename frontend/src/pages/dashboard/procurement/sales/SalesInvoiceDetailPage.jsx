import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getActiveScreenContext, openScreen, openScreenWithContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createSalesInvoice,
  getSalesInvoice,
  getSalesOrder,
  postSalesInvoice,
  reverseSalesInvoice,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useCustomerOptionsQuery,
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

function formatMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

function getStatusTone(status) {
  const upper = String(status || "").toUpperCase();
  return upper === "POSTED" ? "emerald" : upper === "CANCELLED" ? "rose" : "slate";
}

export default function SalesInvoiceDetailPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const isCreateMode = id === "new";
  const [searchParams] = useSearchParams();
  const [selectedDcId, setSelectedDcId] = useState("");
  const [draftLines, setDraftLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const soId = searchParams.get("so_id") || "";
  const customerQuery = useCustomerOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const detailQuery = useQuery({
    queryKey: ["procurement", "sales-invoice-detail", isCreateMode ? `new:${soId}` : id],
    queryFn: async () => {
      if (isCreateMode) {
        if (!soId) {
          throw new Error("PROCUREMENT_SO_ID_REQUIRED");
        }
        const soData = await getSalesOrder(soId);
        return {
          detail: null,
          salesOrder: soData?.data ?? soData,
        };
      }
      const invoiceData = await getSalesInvoice(id);
      return {
        detail: invoiceData?.data ?? invoiceData,
        salesOrder: null,
      };
    },
    enabled: Boolean(isCreateMode ? soId : id),
  });
  const detail = detailQuery.data?.detail ?? null;
  const salesOrder = detailQuery.data?.salesOrder ?? null;
  const customers = customerQuery.customers;
  const materials = materialQuery.materials;
  const loading =
    detailQuery.isLoading ||
    customerQuery.isLoading ||
    materialQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void detailQuery.refetch(),
    },
  });

  const customerMap = useMemo(
    () => new Map(customers.map((entry) => [entry.id, entry])),
    [customers]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  useEffect(() => {
    const nextError =
      detailQuery.error?.message ||
      customerQuery.error?.message ||
      materialQuery.error?.message ||
      "";
    setError(nextError);
  }, [customerQuery.error, detailQuery.error, materialQuery.error]);

  useEffect(() => {
    if (isCreateMode && salesOrder) {
      setSelectedDcId((current) => current || salesOrder?.delivery_challans?.[0]?.id || "");
    }
  }, [isCreateMode, salesOrder]);

  useEffect(() => {
    if (!isCreateMode || !salesOrder) {
      return;
    }
    const nextLines = (salesOrder.lines ?? [])
      .filter((line) => Number(line.issued_qty ?? 0) > 0)
      .map((line, index) => ({
        id: `preview-${index + 1}`,
        line_number: index + 1,
        material_id: line.material_id,
        quantity: Number(line.issued_qty ?? 0),
        uom_code: line.uom_code,
        rate: Number(line.net_rate ?? 0),
        taxable_value: Number((Number(line.issued_qty ?? 0) * Number(line.net_rate ?? 0)).toFixed(4)),
        gst_rate: Number(line.gst_rate ?? 0),
      }));
    setDraftLines(nextLines);
  }, [isCreateMode, salesOrder, selectedDcId]);

  const gstType = detail?.gst_type || "CGST_SGST";
  const invoiceLines = useMemo(
    () => (isCreateMode ? draftLines : detail?.lines ?? []),
    [detail?.lines, draftLines, isCreateMode]
  );
  const totalTaxable = useMemo(
    () =>
      invoiceLines.reduce((sum, line) => {
        const taxableValue = Number(line.taxable_value ?? Number(line.quantity ?? 0) * Number(line.rate ?? 0));
        return sum + (Number.isFinite(taxableValue) ? taxableValue : 0);
      }, 0),
    [invoiceLines]
  );
  const totalGst = useMemo(() => {
    if (!isCreateMode) {
      return Number(detail?.total_gst_amount ?? 0);
    }
    return invoiceLines.reduce((sum, line) => {
      const taxableValue = Number(line.taxable_value ?? 0);
      const gstRate = Number(line.gst_rate ?? 0);
      return sum + (taxableValue * gstRate) / 100;
    }, 0);
  }, [detail?.total_gst_amount, invoiceLines, isCreateMode]);

  async function handleCreateAndPost() {
    if (!soId || !selectedDcId) {
      setError("Select a delivery challan first.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createSalesInvoice({ so_id: soId, dc_id: selectedDcId });
      const createdId = created?.id || created?.data?.id;
      if (!createdId) {
        throw new Error("PROCUREMENT_SALES_INVOICE_CREATE_FAILED");
      }
      await postSalesInvoice(createdId);
      setNotice("Sales invoice created and posted.");
      openScreen(OPERATION_SCREENS.PROC_INV_DETAIL.screen_code);
      navigate(`/dashboard/procurement/sales-invoices/${encodeURIComponent(createdId)}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SALES_INVOICE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePostExisting() {
    const confirmed = await openActionConfirm({ eyebrow: "Sales Invoice", title: "Post this invoice?", confirmLabel: "Post" });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await postSalesInvoice(id);
      setNotice("Sales invoice posted.");
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SALES_INVOICE_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  // §113.15 -- separate action from create/post, distinct ACL EDIT action
  // (route-acl-registry.ts). Only valid for a POSTED (§113.15-created)
  // invoice, i.e. reversal handler blocks anything else server-side too.
  async function handleReverse() {
    const reason = await openActionPrompt({ eyebrow: "Sales Invoice", title: "Reverse this invoice?", label: "Reversal reason", required: true });
    if (!reason) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await reverseSalesInvoice(id, { reason });
      setNotice("Invoice reversed — stock restored, delivery order released back to the PGI queue.");
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SALES_INVOICE_REVERSE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function openSoDetail() {
    const targetSoId = detail?.so_id || salesOrder?.id;
    if (!targetSoId) {
      return;
    }
    openScreen(OPERATION_SCREENS.PROC_SO_DETAIL.screen_code);
    navigate(`/dashboard/procurement/sales-orders/${encodeURIComponent(targetSoId)}`);
  }

  function openInvoicePrint() {
    openScreenWithContext(OPERATION_SCREENS.PROC_INV_PRINT.screen_code, { id });
    navigate(`/dashboard/procurement/sales-invoices/${encodeURIComponent(id)}/print`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title={isCreateMode ? "Create Sales Invoice" : "Sales Invoice Detail"}
      notices={[
        ...(error ? [{ key: "sales-invoice-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "sales-invoice-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(detail?.so_id || salesOrder?.id ? [{ key: "so", label: "Open SO", tone: "neutral", onClick: openSoDetail }] : []),
        ...(detail?.status === "POSTED" ? [{ key: "print", label: "Print Invoice", tone: "neutral", onClick: openInvoicePrint }] : []),
        ...(isCreateMode
          ? [{ key: "create-post", label: saving ? "Posting..." : "Post Invoice", tone: "primary", onClick: () => void handleCreateAndPost(), disabled: saving || !selectedDcId }]
          : detail?.status === "DRAFT"
          ? [{ key: "post", label: saving ? "Posting..." : "Post Invoice", tone: "primary", onClick: () => void handlePostExisting(), disabled: saving }]
          : detail?.status === "POSTED"
          ? [{ key: "reverse", label: saving ? "Reversing..." : "Reverse Invoice", tone: "danger", onClick: () => void handleReverse(), disabled: saving }]
          : []),
      ]}
    >
      {loading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading sales invoice...
        </div>
      ) : isCreateMode ? (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Create Flow" title="Select delivery challan">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Delivery Challan
                <select
                  value={selectedDcId}
                  onChange={(event) => setSelectedDcId(event.target.value)}
                  className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                >
                  <option value="">Select DC</option>
                  {(salesOrder?.delivery_challans ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.dc_number || entry.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                GST Type: <span className="font-semibold text-slate-900">{gstType}</span>
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Preview Lines" title="DC-driven invoice lines">
            <ErpDenseGrid
              cellNavigate
              columns={[
                {
                  key: "material_name",
                  label: "Material",
                  render: (row) => materialMap.get(row.material_id)?.material_name || row.material_id || "-",
                },
                { key: "quantity", label: "Qty", width: "90px" },
                { key: "uom_code", label: "UOM", width: "90px" },
                { key: "rate", label: "Rate", width: "90px" },
                { key: "taxable_value", label: "Taxable", width: "110px" },
                { key: "gst_rate", label: "GST %", width: "90px" },
              ]}
              rows={invoiceLines}
              rowKey={(row) => row.id}
              emptyMessage="Select a delivery challan to preview invoice lines."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Summary" title="Invoice summary">
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Total Taxable" value={formatMoney(totalTaxable)} />
              <ErpFieldPreview label="GST Type" value={gstType} />
              {String(gstType).toUpperCase() === "CGST_SGST" ? (
                <>
                  <ErpFieldPreview label="CGST" value={formatMoney(totalGst / 2)} />
                  <ErpFieldPreview label="SGST" value={formatMoney(totalGst / 2)} />
                </>
              ) : (
                <ErpFieldPreview label="IGST" value={formatMoney(totalGst)} />
              )}
              <ErpFieldPreview label="Total Invoice Value" value={formatMoney(totalTaxable + totalGst)} />
            </div>
          </ErpSectionCard>
        </div>
      ) : !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Sales invoice detail is unavailable.
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${detail.invoice_number || "-"} | ${detail.sto_id ? "STO Dispatch" : (customerMap.get(detail.customer_id)?.customer_name || detail.customer_id || "-")}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={detail.status} tone={getStatusTone(detail.status)} />
              <ErpFieldPreview label="Invoice Date" value={detail.invoice_date} />
              <ErpFieldPreview label="Tally Invoice Number" value={detail.tally_invoice_number || "—"} />
              <ErpFieldPreview label="Tally Invoice Date" value={detail.tally_invoice_date || "—"} />
              <ErpFieldPreview label="GST Type" value={detail.gst_type} />
              <ErpFieldPreview label="Total Taxable" value={formatMoney(detail.total_taxable_value)} />
              <ErpFieldPreview label="Freight" value={detail.freight_to_pay ? "TO PAY (Customer)" : (detail.freight_included ? formatMoney(detail.freight_amount) : "—")} />
              <ErpFieldPreview label="Round Off" value={formatMoney(detail.round_off_amount ?? 0)} />
              <ErpFieldPreview label="Total Invoice" value={formatMoney(detail.total_invoice_value)} />
              {detail.status === "CANCELLED" ? (
                <ErpFieldPreview label="Cancellation Reason" value={detail.cancellation_reason || "—"} />
              ) : null}
            </div>
          </ErpSectionCard>

          {/* §133.13 -- IBN/FO/e-Way Bill/Freight-detail/Additional-Cost only ever populated
              for invoices created via the new IBN-driven multi-invoice engine
              (PgiInvoiceGroupsCreatePage). A legacy §113.15 single-invoice-per-DO
              invoice simply shows "—" for all of these, which is correct (they
              never applied to it). */}
          {(detail.inbound_number || detail.fo_number || detail.e_way_bill_applicable || detail.freight_to_pay || detail.freight_mode || (detail.additional_cost_lines ?? []).length > 0) ? (
            <ErpSectionCard eyebrow="§133.13" title="IBN / FO / e-Way Bill / Invoice Adjustments">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <ErpFieldPreview label="Inbound Number (IBN)" value={detail.inbound_number || "—"} />
                <ErpFieldPreview label="FO Number" value={detail.fo_number ? `${detail.fo_number} / ${detail.fo_date || "—"}` : "—"} />
                <ErpFieldPreview label="e-Way Bill" value={detail.e_way_bill_applicable ? (detail.e_way_bill_number || "(number pending)") : "No"} />
                {detail.freight_to_pay ? <ErpFieldPreview label="Freight Settlement" value="TO PAY — customer pays freight" /> : null}
                {detail.freight_mode ? (
                  <>
                    <ErpFieldPreview label="Freight Mode" value={detail.freight_mode === "RATE" ? `Rate (${formatMoney(detail.freight_rate)} × ${formatMoney(detail.freight_net_weight)})` : "Ad Hoc"} />
                    <ErpFieldPreview label="Freight GST" value={detail.freight_gst_included ? `${detail.freight_gst_treatment} @ ${detail.freight_gst_rate}% = ${formatMoney(detail.freight_gst_amount)}` : "No GST"} />
                  </>
                ) : null}
                <ErpFieldPreview label="Other Invoice Adjustment" value={formatMoney(detail.additional_cost_total ?? 0)} />
              </div>
              {(detail.additional_cost_lines ?? []).length > 0 ? (
                <ErpDenseGrid
                  cellNavigate
                  columns={[
                    { key: "category_name", label: "Category", render: (row) => row.category_name || "—" },
                    { key: "amount", label: "Amount", width: "100px", align: "right", render: (row) => formatMoney(row.amount) },
                    { key: "gst_included", label: "GST", width: "160px", render: (row) => (row.gst_included ? `${row.gst_treatment} @ ${row.gst_rate}% = ${formatMoney(row.gst_amount)}` : "No") },
                    { key: "line_total", label: "Line Total", width: "110px", align: "right", render: (row) => formatMoney(row.line_total) },
                  ]}
                  rows={detail.additional_cost_lines}
                  rowKey={(row) => row.id}
                  emptyMessage="No additional cost lines."
                />
              ) : null}
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Bill-To / Ship-To" title="Frozen at PGI time (§113.16-addendum)">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Bill To</div>
                <ErpFieldPreview label="Name" value={detail.bill_to_name || "—"} />
                <ErpFieldPreview label="Address" value={detail.bill_to_address || "—"} />
                <ErpFieldPreview label="State" value={detail.bill_to_state || "—"} />
                <ErpFieldPreview label="GST Number" value={detail.bill_to_gst_number || "—"} />
              </div>
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Ship To</div>
                <ErpFieldPreview label="Name" value={detail.ship_to_name || "—"} />
                <ErpFieldPreview label="Address" value={detail.ship_to_address || "—"} />
                <ErpFieldPreview label="State" value={detail.ship_to_state || "—"} />
                <ErpFieldPreview label="GST Number" value={detail.ship_to_gst_number || "—"} />
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="Invoice lines">
            <ErpDenseGrid
              cellNavigate
              columns={[
                {
                  key: "material_name",
                  label: "Material",
                  render: (row) => materialMap.get(row.material_id)?.material_name || row.material_id || "-",
                },
                { key: "quantity", label: "Qty", width: "90px" },
                {
                  key: "pack_qty",
                  label: "Pack Qty",
                  width: "110px",
                  render: (row) => (row.pack_qty != null ? `${row.pack_qty} ${row.pack_uom_code || ""}`.trim() : "-"),
                },
                {
                  key: "uom_code",
                  label: "Per",
                  width: "90px",
                  // §133.21 -- show the SO-time UOM choice (Pack UoM/Base
                  // UoM/Fixed), not the per-base-UOM figure used for Amount.
                  render: (row) =>
                    row.display_rate_basis === "FIXED"
                      ? "Fixed"
                      : row.display_rate_basis && row.display_uom_code
                        ? row.display_uom_code
                        : row.uom_code || "-",
                },
                {
                  key: "rate",
                  label: "Rate",
                  width: "90px",
                  render: (row) =>
                    row.display_rate_basis ? row.display_rate : row.rate,
                },
                { key: "taxable_value", label: "Taxable", width: "110px" },
                { key: "gst_rate", label: "GST %", width: "90px" },
                { key: "line_total", label: "Line Total", width: "110px" },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No invoice lines found."
            />
          </ErpSectionCard>

          {detail.status === "POSTED" || detail.status === "CANCELLED" ? (
            <ErpSectionCard eyebrow="§133.14" title="Dispatch Reconciliation">
              <p className="mb-3 text-sm text-slate-600">
                Generated with PGI and retained as an audit record. Reverse the invoice to void these rows; they cannot be edited here.
              </p>
              <ErpDenseGrid
                cellNavigate
                columns={[
                  { key: "so_number", label: "SO", width: "120px", render: (row) => row.so_number || "—" },
                  { key: "fo_number", label: "FO", width: "120px", render: (row) => row.fo_number || "—" },
                  { key: "dispatch_category", label: "Category", width: "100px" },
                  { key: "process_order_number", label: "Process PO", width: "130px", render: (row) => row.process_order_number || "—" },
                  { key: "packing_order_number", label: "Packing PO", width: "130px", render: (row) => row.packing_order_number || "—" },
                  { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number || "—" },
                  { key: "material_name", label: "Material", width: "160px", render: (row) => materialMap.get(row.material_id)?.material_name || row.material_id || "—" },
                  { key: "line_material_type", label: "Type", width: "80px" },
                  { key: "dispatch_qty_kg", label: "Dispatch KG", width: "110px", align: "right", render: (row) => formatMoney(row.dispatch_qty_kg) },
                  { key: "standard_qty", label: "Standard", width: "110px", align: "right", render: (row) => row.standard_qty == null ? "—" : formatMoney(row.standard_qty) },
                  { key: "actual_qty", label: "Actual", width: "110px", align: "right", render: (row) => row.actual_qty == null ? "—" : formatMoney(row.actual_qty) },
                  { key: "ap_approved_qty", label: "AP Approved", width: "120px", align: "right", render: (row) => row.ap_approved_qty == null ? "—" : formatMoney(row.ap_approved_qty) },
                  { key: "is_voided", label: "Status", width: "100px", render: (row) => row.is_voided ? "VOIDED" : "ACTIVE" },
                ]}
                rows={detail.dispatch_reco_lines ?? []}
                rowKey={(row) => row.id}
                emptyMessage="No Dispatch Reco applies to this invoice (for example, STO, MTS, or a non-Asian RPS dispatch)."
              />
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="GST Breakdown" title="Derived GST summary">
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="GST Type" value={detail.gst_type} />
              {String(detail.gst_type).toUpperCase() === "CGST_SGST" ? (
                <>
                  <ErpFieldPreview label="CGST" value={formatMoney(Number(detail.total_gst_amount ?? 0) / 2)} />
                  <ErpFieldPreview label="SGST" value={formatMoney(Number(detail.total_gst_amount ?? 0) / 2)} />
                </>
              ) : (
                <ErpFieldPreview label="IGST" value={formatMoney(detail.total_gst_amount)} />
              )}
              <ErpFieldPreview label="Total Invoice Value" value={formatMoney(detail.total_invoice_value)} />
            </div>
          </ErpSectionCard>

          <DocumentFlowSection docType="SALES_INVOICE" docId={detail.id} />
        </div>
      )}
    </ErpScreenScaffold>
  );
}
