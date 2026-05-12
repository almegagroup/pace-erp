import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listCustomers, listMaterials } from "../../om/omApi.js";
import {
  createSalesInvoice,
  getSalesInvoice,
  getSalesOrder,
  postSalesInvoice,
} from "../procurementApi.js";

function formatMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

function getStatusTone(status) {
  return String(status || "").toUpperCase() === "POSTED" ? "emerald" : "slate";
}

export default function SalesInvoiceDetailPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { runtimeContext } = useMenu();
  const [detail, setDetail] = useState(null);
  const [salesOrder, setSalesOrder] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [selectedDcId, setSelectedDcId] = useState("");
  const [draftLines, setDraftLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const soId = searchParams.get("so_id") || "";
  const customerMap = useMemo(
    () => new Map(customers.map((entry) => [entry.id, entry])),
    [customers]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const isCreateMode = id === "new";

  async function loadDetail() {
    setLoading(true);
    setError("");
    try {
      const [customerData, materialData] = await Promise.all([
        listCustomers({ limit: 200, offset: 0 }),
        listMaterials({ limit: 300, offset: 0 }),
      ]);
      setCustomers(Array.isArray(customerData?.data) ? customerData.data : []);
      setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);

      if (isCreateMode) {
        if (!soId) {
          throw new Error("PROCUREMENT_SO_ID_REQUIRED");
        }
        const soData = await getSalesOrder(soId);
        const soDetail = soData?.data ?? soData;
        setSalesOrder(soDetail);
        setSelectedDcId(soDetail?.delivery_challans?.[0]?.id || "");
        setDetail(null);
      } else {
        const invoiceData = await getSalesInvoice(id);
        const invoiceDetail = invoiceData?.data ?? invoiceData;
        setDetail(invoiceDetail);
        setSalesOrder(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_SALES_INVOICE_DETAIL_FAILED");
      setDetail(null);
      setSalesOrder(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, soId, runtimeContext?.selectedCompanyId]);

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
  const invoiceLines = isCreateMode ? draftLines : detail?.lines ?? [];
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
    if (!window.confirm("Post this sales invoice?")) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await postSalesInvoice(id);
      setNotice("Sales invoice posted.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SALES_INVOICE_POST_FAILED");
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
        ...(isCreateMode
          ? [{ key: "create-post", label: saving ? "Posting..." : "Post Invoice", tone: "primary", onClick: () => void handleCreateAndPost(), disabled: saving || !selectedDcId }]
          : detail?.status === "DRAFT"
          ? [{ key: "post", label: saving ? "Posting..." : "Post Invoice", tone: "primary", onClick: () => void handlePostExisting(), disabled: saving }]
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
          <ErpSectionCard eyebrow="Header" title={`${detail.invoice_number || "-"} | ${customerMap.get(detail.customer_id)?.customer_name || detail.customer_id || "-"}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={detail.status} tone={getStatusTone(detail.status)} />
              <ErpFieldPreview label="Invoice Date" value={detail.invoice_date} />
              <ErpFieldPreview label="DC Ref" value={detail.dc_id} />
              <ErpFieldPreview label="GST Type" value={detail.gst_type} />
              <ErpFieldPreview label="Total Taxable" value={formatMoney(detail.total_taxable_value)} />
              <ErpFieldPreview label="Total Invoice" value={formatMoney(detail.total_invoice_value)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="Invoice lines">
            <ErpDenseGrid
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
                { key: "line_total", label: "Line Total", width: "110px" },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No invoice lines found."
            />
          </ErpSectionCard>

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
        </div>
      )}
    </ErpScreenScaffold>
  );
}
