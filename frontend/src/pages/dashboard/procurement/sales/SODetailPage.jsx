import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listCustomers, listMaterials } from "../../om/omApi.js";
import {
  cancelSalesOrder,
  getSalesOrder,
  issueSOStock,
  knockOffSOLine,
  listSalesInvoices,
} from "../procurementApi.js";

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "ISSUED":
      return "sky";
    case "INVOICED":
      return "amber";
    case "CLOSED":
      return "emerald";
    case "CANCELLED":
      return "rose";
    case "CREATED":
    default:
      return "slate";
  }
}

function getLineStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "FULLY_ISSUED":
      return "bg-emerald-100 text-emerald-800";
    case "PARTIALLY_ISSUED":
      return "bg-amber-100 text-amber-800";
    case "KNOCKED_OFF":
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default function SODetailPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { runtimeContext } = useMenu();
  const [detail, setDetail] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [linkedInvoices, setLinkedInvoices] = useState([]);
  const [issueLines, setIssueLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const customerMap = useMemo(
    () => new Map(customers.map((entry) => [entry.id, entry])),
    [customers]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );

  async function loadDetail() {
    if (!id) {
      setError("PROCUREMENT_SO_NOT_FOUND");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const soData = await getSalesOrder(id);
      const soDetail = soData?.data ?? soData;
      const [customerData, materialData, invoiceData] = await Promise.all([
        listCustomers({ limit: 200, offset: 0 }),
        listMaterials({ limit: 300, offset: 0 }),
        listSalesInvoices({
          company_id: soDetail?.company_id || runtimeContext?.selectedCompanyId || undefined,
          customer_id: soDetail?.customer_id || undefined,
        }),
      ]);
      const invoiceRows = Array.isArray(invoiceData?.items) ? invoiceData.items : [];
      setDetail(soDetail);
      setCustomers(Array.isArray(customerData?.data) ? customerData.data : []);
      setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
      setLinkedInvoices(invoiceRows.filter((entry) => String(entry.so_id || "") === String(soDetail?.id || "")));
      setIssueLines(
        Array.isArray(soDetail?.lines)
          ? soDetail.lines.map((line) => ({
              so_line_id: line.id,
              qty_to_issue: "",
              storage_location_id: line.issue_storage_location_id || "",
            }))
          : []
      );
    } catch (loadError) {
      setDetail(null);
      setLinkedInvoices([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_SO_DETAIL_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, runtimeContext?.selectedCompanyId]);

  function updateIssueLine(lineId, patch) {
    setIssueLines((current) =>
      current.map((entry) => (entry.so_line_id === lineId ? { ...entry, ...patch } : entry))
    );
  }

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    const reason = window.prompt("Cancellation reason", "");
    if (!reason) {
      return;
    }
    await runAction(
      () => cancelSalesOrder(id, { reason }),
      "Sales order cancelled."
    );
  }

  async function handleIssueStock() {
    const payloadLines = issueLines
      .map((entry) => ({
        so_line_id: entry.so_line_id,
        qty: toNumber(entry.qty_to_issue),
        issue_storage_location_id: entry.storage_location_id || null,
      }))
      .filter((entry) => entry.qty > 0);

    if (payloadLines.length === 0) {
      setError("Enter at least one issue quantity.");
      return;
    }

    if (!window.confirm("Issue stock for the selected lines?")) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await issueSOStock(id, { lines: payloadLines });
      const responseDetail = response?.data ?? response;
      const latestDc = Array.isArray(responseDetail?.delivery_challans) ? responseDetail.delivery_challans[0] : null;
      const latestGxo = Array.isArray(responseDetail?.gate_exit_outbound) ? responseDetail.gate_exit_outbound[0] : null;
      setNotice(
        latestDc?.dc_number || latestGxo?.exit_number
          ? `Delivery Challan ${latestDc?.dc_number || "-"} and Gate Exit ${latestGxo?.exit_number || "-"} auto-generated.`
          : "Stock issued successfully."
      );
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SO_ISSUE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleKnockOff(lineId) {
    const reason = window.prompt("Reason", "");
    if (!reason) {
      return;
    }
    await runAction(
      () => knockOffSOLine(id, lineId, { reason }),
      "SO line knocked off."
    );
  }

  function openInvoiceCreate() {
    openScreen(OPERATION_SCREENS.PROC_INV_DETAIL.screen_code);
    navigate(`/dashboard/procurement/sales-invoices/new?so_id=${encodeURIComponent(id)}`);
  }

  const latestDc = Array.isArray(detail?.delivery_challans) ? detail.delivery_challans[0] : null;
  const latestGxo = Array.isArray(detail?.gate_exit_outbound) ? detail.gate_exit_outbound[0] : null;

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Sales Order Detail"
      notices={[
        ...(error ? [{ key: "so-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "so-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(detail?.status === "CREATED"
          ? [{ key: "cancel", label: "Cancel SO", tone: "danger", onClick: () => void handleCancel(), disabled: saving }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading sales order detail..." : "Sales order detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${detail.so_number || "-"} | ${customerMap.get(detail.customer_id)?.customer_name || detail.customer_id || "-"}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={detail.status} tone={getStatusTone(detail.status)} />
              <ErpFieldPreview label="SO Date" value={detail.so_date} />
              <ErpFieldPreview label="Customer PO" value={detail.customer_po_number} />
              <ErpFieldPreview label="Customer PO Date" value={detail.customer_po_date || "-"} />
              <ErpFieldPreview label="Company" value={detail.company_id} />
              <ErpFieldPreview label="Delivery Address" value={detail.delivery_address || "-"} />
            </div>
          </ErpSectionCard>

          {(detail.status === "CREATED" || detail.status === "ISSUED") && (latestDc?.dc_number || latestGxo?.exit_number) ? (
            <div className="rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Delivery Challan {latestDc?.dc_number || "-"} and Gate Exit {latestGxo?.exit_number || "-"} auto-generated.
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Lines" title="SO lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                {
                  key: "material_name",
                  label: "Material",
                  render: (row) => materialMap.get(row.material_id)?.material_name || materialMap.get(row.material_id)?.pace_code || row.material_id || "-",
                },
                { key: "quantity", label: "Qty", width: "90px" },
                { key: "issued_qty", label: "Issued", width: "90px" },
                {
                  key: "balance_qty",
                  label: "Balance",
                  width: "100px",
                  render: (row) => (
                    <span className={toNumber(row.balance_qty) > 0 ? "font-semibold text-amber-700" : "text-slate-700"}>
                      {row.balance_qty}
                    </span>
                  ),
                },
                {
                  key: "line_status",
                  label: "Status",
                  width: "150px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getLineStatusTone(row.line_status)}`}>
                      {row.line_status}
                    </span>
                  ),
                },
                { key: "rate", label: "Rate", width: "90px" },
                { key: "net_rate", label: "Net Rate", width: "100px" },
                { key: "total_value", label: "Total", width: "110px" },
                {
                  key: "knock_off",
                  label: "Knock Off",
                  width: "110px",
                  render: (row) =>
                    toNumber(row.balance_qty) > 0 ? (
                      <button
                        type="button"
                        onClick={() => void handleKnockOff(row.id)}
                        className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        Knock Off
                      </button>
                    ) : (
                      "—"
                    ),
                },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No sales order lines found."
            />
          </ErpSectionCard>

          {detail.status === "CREATED" || detail.status === "ISSUED" ? (
            <ErpSectionCard eyebrow="Issue Stock" title="Dispatch sales order lines">
              <div className="grid gap-3">
                {Array.isArray(detail.lines) &&
                  detail.lines.map((line) => {
                    const issueState = issueLines.find((entry) => entry.so_line_id === line.id) ?? {
                      qty_to_issue: "",
                      storage_location_id: line.issue_storage_location_id || "",
                    };
                    const material = materialMap.get(line.material_id);
                    return (
                      <div key={line.id} className="grid gap-3 border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
                        <div className="grid gap-1">
                          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Material</div>
                          <div className="text-sm text-slate-900">{material?.material_name || material?.pace_code || line.material_id}</div>
                        </div>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700">
                          Qty To Issue
                          <input
                            type="number"
                            min="0"
                            max={String(line.balance_qty ?? "")}
                            placeholder={String(line.balance_qty ?? "")}
                            step="0.0001"
                            value={issueState.qty_to_issue}
                            onChange={(event) => updateIssueLine(line.id, { qty_to_issue: event.target.value })}
                            className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700">
                          Storage Location
                          <input
                            value={issueState.storage_location_id}
                            onChange={(event) => updateIssueLine(line.id, { storage_location_id: event.target.value })}
                            className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                          />
                        </label>
                        <div className="grid gap-1 text-xs text-slate-600">
                          <div>Balance Qty: <span className="font-semibold text-slate-900">{line.balance_qty}</span></div>
                          <div>Default Location: <span className="font-semibold text-slate-900">{line.issue_storage_location_id || "-"}</span></div>
                        </div>
                      </div>
                    );
                  })}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleIssueStock()}
                    disabled={saving}
                    className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Issuing..." : "Issue Stock"}
                  </button>
                </div>
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Linked Invoices" title="Sales invoice references">
            <div className="grid gap-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={openInvoiceCreate}
                  className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950"
                >
                  Create Invoice
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "invoice_number", label: "Invoice Number", width: "150px" },
                  { key: "invoice_date", label: "Invoice Date", width: "120px" },
                  { key: "status", label: "Status", width: "100px" },
                  { key: "gst_type", label: "GST Type", width: "120px" },
                  { key: "total_invoice_value", label: "Total", width: "120px" },
                ]}
                rows={linkedInvoices}
                rowKey={(row) => row.id}
                emptyMessage="No sales invoices linked yet."
              />
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
