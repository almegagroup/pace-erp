import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getActiveScreenContext, openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  cancelSalesOrderUnified,
  closeSalesOrderUnified,
  getSalesOrder,
  issueSOStock,
  knockOffSOLine,
  listSalesInvoices,
  updateSalesOrderUnified,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useCustomerOptionsQuery,
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";

const SO_TERMINAL_STATUSES = new Set(["CANCELLED", "CLOSED"]);
const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
  { value: "EX_TRANSPORTER_GODOWN", label: "Ex Transporter Godown" },
];
const FG_TYPE_OPTIONS = ["MTO", "HPS", "MTEST", "MTS"];

function makeNewSoLine(lineMaterialType) {
  return {
    __key: `${lineMaterialType}-${Math.random().toString(36).slice(2)}`,
    line_material_type: lineMaterialType,
    material_id: "",
    fg_type: lineMaterialType === "FG" || lineMaterialType === "SFG" ? "" : null,
    quantity: "",
    base_qty: "",
    pack_qty: "",
    per_pack_qty: "",
    rate_basis: "",
    rate: "",
    gst_rate: "",
    hsn_code: "",
    batch_number: "",
    expiry_date: "",
  };
}

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

function formatMoney(value) {
  return toNumber(value).toFixed(2);
}

export default function SODetailPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const { runtimeContext } = useMenu();
  const resolvedCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [issueLines, setIssueLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // §133.10 — Edit/Cancel/Close (unified redesign). Header/line edit state is
  // only meaningful pre-terminal-status; Bill-To/Ship-To/dispatch_type are
  // never editable here (Cancel + new SO is the only path for those).
  const [headerEdit, setHeaderEdit] = useState({ so_date: "", payment_term_id: "", freight_term: "" });
  const [lineEdits, setLineEdits] = useState({});
  const [removedLineIds, setRemovedLineIds] = useState(() => new Set());
  const [newLines, setNewLines] = useState([]);
  const [savingHeader, setSavingHeader] = useState(false);
  const [savingLines, setSavingLines] = useState(false);
  const customerQuery = useCustomerOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const paymentTermOptions = useMemo(
    () => (paymentTermQuery.paymentTerms ?? []).map((entry) => ({ value: entry.id, label: `${entry.code || entry.name} | ${entry.name}` })),
    [paymentTermQuery.paymentTerms]
  );
  const detailQuery = useQuery({
    queryKey: ["procurement", "so-detail", id],
    queryFn: async () => {
      const soData = await getSalesOrder(id);
      const soDetail = soData?.data ?? soData;
      const invoiceData = await listSalesInvoices({
        company_id: soDetail?.company_id || resolvedCompanyId || undefined,
        customer_id: soDetail?.customer_id || undefined,
      });
      const invoiceRows = Array.isArray(invoiceData?.items) ? invoiceData.items : [];
      return {
        detail: soDetail,
        linkedInvoices: invoiceRows.filter(
          (entry) => String(entry.so_id || "") === String(soDetail?.id || "")
        ),
      };
    },
    enabled: Boolean(id),
  });
  const detail = detailQuery.data?.detail ?? null;
  const commercialTotals = useMemo(() => {
    const lines = Array.isArray(detail?.lines) ? detail.lines : [];
    return lines.reduce((totals, line) => {
      const gstAmount = toNumber(line.gst_amount);
      const lineTotal = toNumber(line.total_value);
      return {
        netAmount: totals.netAmount + (lineTotal - gstAmount),
        cgstAmount: totals.cgstAmount + toNumber(line.cgst_amount),
        sgstAmount: totals.sgstAmount + toNumber(line.sgst_amount),
        igstAmount: totals.igstAmount + toNumber(line.igst_amount),
        totalValue: totals.totalValue + lineTotal,
      };
    }, { netAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalValue: 0 });
  }, [detail?.lines]);
  const customers = customerQuery.customers;
  const materials = materialQuery.materials;
  const linkedInvoices = detailQuery.data?.linkedInvoices ?? [];
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
      (!id ? "PROCUREMENT_SO_NOT_FOUND" : "") ||
      detailQuery.error?.message ||
      customerQuery.error?.message ||
      materialQuery.error?.message ||
      "";
    setError(nextError);
  }, [customerQuery.error, detailQuery.error, id, materialQuery.error]);

  useEffect(() => {
    setIssueLines(
      Array.isArray(detail?.lines)
        ? detail.lines.map((line) => ({
            so_line_id: line.id,
            qty_to_issue: "",
            storage_location_id: line.issue_storage_location_id || "",
          }))
        : []
    );
  }, [detail?.lines]);

  useEffect(() => {
    if (!detail) return;
    setHeaderEdit({
      so_date: detail.so_date || "",
      payment_term_id: detail.payment_term_id || "",
      freight_term: detail.freight_term || "FOR",
    });
    setLineEdits(
      Object.fromEntries(
        (Array.isArray(detail.lines) ? detail.lines : []).map((line) => [
          line.id,
          {
            rate: line.rate ?? "",
            base_qty: line.base_qty ?? line.quantity ?? "",
            gst_rate: line.gst_rate ?? "",
            hsn_code: line.hsn_code || "",
            batch_number: line.batch_number || "",
            expiry_date: line.expiry_date || "",
            remarks: line.remarks || "",
          },
        ])
      )
    );
    setRemovedLineIds(new Set());
    setNewLines([]);
  }, [detail]);

  function updateLineEdit(lineId, patch) {
    setLineEdits((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));
  }

  // §133.10 real gap closed (2026-08-28) — Edit previously could only ever
  // modify an existing line's own fields; there was no way to add a new
  // line or actually remove one (the "Save Line Changes" payload always
  // included every existing line, so nothing was ever omitted).
  const materialOptionsForType = useMemo(() => {
    const byType = new Map();
    for (const entry of materials) {
      const type = String(entry.material_type || "").toUpperCase();
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push({ value: entry.id, label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim() });
    }
    return byType;
  }, [materials]);

  function toggleRemoveExistingLine(lineId) {
    setRemovedLineIds((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      return next;
    });
  }
  function addNewLine(lineMaterialType) {
    setNewLines((current) => [...current, makeNewSoLine(lineMaterialType)]);
  }
  function updateNewLine(key, patch) {
    setNewLines((current) => current.map((line) => (line.__key === key ? { ...line, ...patch } : line)));
  }
  function removeNewLine(key) {
    setNewLines((current) => current.filter((line) => line.__key !== key));
  }
  function handleNewLineMaterialSelect(key, materialId) {
    const material = materialMap.get(materialId);
    updateNewLine(key, {
      material_id: materialId,
      hsn_code: material?.hsn_code || "",
      gst_rate: material?.gst_rate != null ? String(material.gst_rate) : "",
    });
  }

  async function handleSaveHeader() {
    setSavingHeader(true);
    setError("");
    setNotice("");
    try {
      await updateSalesOrderUnified(id, {
        so_date: headerEdit.so_date || undefined,
        payment_term_id: headerEdit.payment_term_id || null,
        freight_term: headerEdit.freight_term || null,
      });
      setNotice("SO header updated.");
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "SO_EDIT_HEADER_FAILED");
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleSaveLines() {
    if (newLines.some((line) => !line.material_id)) {
      setError("Every new line needs an item selected.");
      return;
    }
    setSavingLines(true);
    setError("");
    setNotice("");
    try {
      // Existing lines marked for removal are simply omitted here — the
      // backend deletes any kept line missing from this array (blocking it
      // first if it's already Mapped in SO Map, §133.10).
      const existingLines = Object.entries(lineEdits)
        .filter(([lineId]) => !removedLineIds.has(lineId))
        .map(([lineId, edit]) => ({
          id: lineId,
          rate: edit.rate === "" ? undefined : Number(edit.rate),
          base_qty: edit.base_qty === "" ? undefined : Number(edit.base_qty),
          gst_rate: edit.gst_rate === "" ? undefined : Number(edit.gst_rate),
          hsn_code: edit.hsn_code || null,
          batch_number: edit.batch_number || null,
          expiry_date: edit.expiry_date || null,
          remarks: edit.remarks || null,
        }));
      const addedLines = newLines.map((line) => ({
        line_material_type: line.line_material_type,
        material_id: line.material_id,
        fg_type: line.fg_type || null,
        // Backend only reads quantity (RM/PM/INT/SFG) or base_qty (FG MTEST
        // only — non-MTEST FG derives base_qty from pack_qty*per_pack_qty
        // itself), so sending the same raw value in both is harmless either way.
        quantity: line.quantity === "" ? null : Number(line.quantity),
        base_qty: line.quantity === "" ? null : Number(line.quantity),
        pack_qty: line.pack_qty === "" ? null : Number(line.pack_qty),
        per_pack_qty: line.per_pack_qty === "" ? null : Number(line.per_pack_qty),
        rate_basis: line.rate_basis || null,
        rate: line.rate === "" ? null : Number(line.rate),
        gst_rate: line.gst_rate === "" ? null : Number(line.gst_rate),
        hsn_code: line.hsn_code || null,
        batch_number: line.batch_number || null,
        expiry_date: line.expiry_date || null,
      }));
      await updateSalesOrderUnified(id, { lines: [...existingLines, ...addedLines] });
      setNotice("SO lines updated.");
      setNewLines([]);
      setRemovedLineIds(new Set());
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "SO_EDIT_LINES_FAILED");
    } finally {
      setSavingLines(false);
    }
  }

  async function handleUnifiedCancel() {
    const reason = await openActionPrompt({ eyebrow: "Sales Order", title: "Cancel this SO?", label: "Cancellation reason", required: true });
    if (!reason) return;
    await runAction(() => cancelSalesOrderUnified(id, { reason }), "Sales order cancelled — SO Map allocations released.");
  }

  async function handleClose() {
    const reason = await openActionPrompt({ eyebrow: "Sales Order", title: "Close this SO?", label: "Reason", required: true });
    if (!reason) return;
    await runAction(() => closeSalesOrderUnified(id, { reason }), "Sales order closed.");
  }

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
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
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

    const confirmed = await openActionConfirm({ eyebrow: "Sales Order", title: "Issue stock?", message: "Stock will be issued for the selected lines.", confirmLabel: "Issue Stock" });
    if (!confirmed) return;

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
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_SO_ISSUE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleKnockOff(lineId) {
    const reason = await openActionPrompt({ eyebrow: "Sales Order", title: "Knock off this line?", label: "Reason", required: true });
    if (!reason) return;
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
  const isEditable = Boolean(detail) && !SO_TERMINAL_STATUSES.has(String(detail?.status || "").toUpperCase());

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
        ...(detail && !SO_TERMINAL_STATUSES.has(String(detail.status || "").toUpperCase())
          ? [
              { key: "close", label: "Close SO", tone: "neutral", onClick: () => void handleClose(), disabled: saving },
              { key: "cancel", label: "Cancel SO", tone: "danger", onClick: () => void handleUnifiedCancel(), disabled: saving },
            ]
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

          {isEditable ? (
            <ErpSectionCard eyebrow="Header (Edit)" title="§133.10 — top-level fields editable pre-terminal; Bill-To/Ship-To/Dispatch Type never change here">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  SO Date
                  <input type="date" value={headerEdit.so_date} onChange={(event) => setHeaderEdit((current) => ({ ...current, so_date: event.target.value }))} className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Payment Terms
                  <select value={headerEdit.payment_term_id} onChange={(event) => setHeaderEdit((current) => ({ ...current, payment_term_id: event.target.value }))} className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                    <option value="">Select Payment Terms</option>
                    {paymentTermOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Freight Term
                  <select value={headerEdit.freight_term} onChange={(event) => setHeaderEdit((current) => ({ ...current, freight_term: event.target.value }))} className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500">
                    {FREIGHT_TERM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => void handleSaveHeader()} disabled={savingHeader} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {savingHeader ? "Saving..." : "Save Header"}
                </button>
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Ship-To" title="Place of supply — determines CGST+SGST vs IGST on the invoice (§113.16)">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Same as Customer" value={detail.ship_to_same_as_customer ? "Yes" : "No"} />
              <ErpFieldPreview label="Ship-To Name" value={detail.ship_to_name || "-"} />
              <ErpFieldPreview label="Ship-To State" value={detail.ship_to_state || "-"} />
              <ErpFieldPreview label="Ship-To Type" value={detail.ship_to_type || "-"} />
              <ErpFieldPreview label="Ship-To GST Number" value={detail.ship_to_gst_number || "-"} />
              <ErpFieldPreview label="Ship-To Address" value={detail.ship_to_address || "-"} />
            </div>
          </ErpSectionCard>

          {(detail.status === "CREATED" || detail.status === "ISSUED") && (latestDc?.dc_number || latestGxo?.exit_number) ? (
            <div className="rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Delivery Challan {latestDc?.dc_number || "-"} and Gate Exit {latestGxo?.exit_number || "-"} auto-generated.
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Lines" title="SO lines">
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                {
                  key: "material_name",
                  label: "Material",
                  render: (row) => materialMap.get(row.material_id)?.material_name || materialMap.get(row.material_id)?.pace_code || row.material_id || "-",
                },
                {
                  key: "quantity",
                  label: "Qty",
                  width: "100px",
                  render: (row) =>
                    isEditable ? (
                      <input type="number" step="0.0001" value={lineEdits[row.id]?.base_qty ?? ""} onChange={(event) => updateLineEdit(row.id, { base_qty: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    ) : (
                      row.quantity
                    ),
                },
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
                {
                  key: "rate",
                  label: "Rate",
                  width: "100px",
                  render: (row) =>
                    isEditable ? (
                      <input type="number" step="0.0001" value={lineEdits[row.id]?.rate ?? ""} onChange={(event) => updateLineEdit(row.id, { rate: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    ) : (
                      row.rate
                    ),
                },
                {
                  key: "gst_rate",
                  label: "GST %",
                  width: "80px",
                  render: (row) =>
                    isEditable ? (
                      <input type="number" step="0.01" value={lineEdits[row.id]?.gst_rate ?? ""} onChange={(event) => updateLineEdit(row.id, { gst_rate: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    ) : (
                      row.gst_rate
                    ),
                },
                {
                  key: "hsn_code",
                  label: "HSN Code",
                  width: "100px",
                  render: (row) =>
                    isEditable ? (
                      <input value={lineEdits[row.id]?.hsn_code ?? ""} onChange={(event) => updateLineEdit(row.id, { hsn_code: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    ) : (
                      row.hsn_code || "-"
                    ),
                },
                {
                  key: "batch_number",
                  label: "Batch No.",
                  width: "110px",
                  render: (row) =>
                    isEditable ? (
                      <input value={lineEdits[row.id]?.batch_number ?? ""} onChange={(event) => updateLineEdit(row.id, { batch_number: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    ) : (
                      row.batch_number || "-"
                    ),
                },
                { key: "net_amount", label: "Net Amount", width: "110px", align: "right", render: (row) => formatMoney(toNumber(row.total_value) - toNumber(row.gst_amount)) },
                { key: "cgst_amount", label: "CGST", width: "90px", align: "right", render: (row) => formatMoney(row.cgst_amount) },
                { key: "sgst_amount", label: "SGST", width: "90px", align: "right", render: (row) => formatMoney(row.sgst_amount) },
                { key: "igst_amount", label: "IGST", width: "90px", align: "right", render: (row) => formatMoney(row.igst_amount) },
                { key: "total_value", label: "Total Value", width: "110px", align: "right", render: (row) => formatMoney(row.total_value) },
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
                ...(isEditable ? [{
                  key: "remove_line",
                  label: "",
                  width: "90px",
                  render: (row) => (
                    <button
                      type="button"
                      onClick={() => toggleRemoveExistingLine(row.id)}
                      className={`border px-2 py-1 text-[11px] font-semibold ${removedLineIds.has(row.id) ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-white text-rose-700"}`}
                    >
                      {removedLineIds.has(row.id) ? "Undo" : "Remove"}
                    </button>
                  ),
                }] : []),
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              getRowProps={(row) => (removedLineIds.has(row.id) ? { className: "opacity-40 line-through" } : {})}
              emptyMessage="No sales order lines found."
            />

            {isEditable ? (
              <div className="mt-4 grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Add Line</div>
                <div className="flex flex-wrap gap-2">
                  {(Array.isArray(detail.material_types) ? detail.material_types : []).map((type) => (
                    <button key={type} type="button" onClick={() => addNewLine(type)} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950">
                      + {type}
                    </button>
                  ))}
                </div>
                {newLines.length > 0 ? (
                  <div className="grid gap-2">
                    {newLines.map((line) => {
                      // FG non-MTEST needs Pack Qty + Per Pack (base_qty derives
                      // forward, matching §133.8-E); MTEST + everything else
                      // enters a plain qty directly into base_qty/quantity.
                      const isFgWithPack = line.line_material_type === "FG" && line.fg_type && line.fg_type !== "MTEST";
                      return (
                        <div key={line.__key} className="grid grid-cols-[90px_1fr_90px_90px_90px_80px_90px_100px_80px] items-center gap-2 border border-sky-200 bg-sky-50 px-2 py-1.5">
                          <span className="text-[11px] font-semibold text-slate-600">{line.line_material_type}</span>
                          <select value={line.material_id} onChange={(event) => handleNewLineMaterialSelect(line.__key, event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
                            <option value="">Select item</option>
                            {(materialOptionsForType.get(line.line_material_type) ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          {(line.line_material_type === "FG" || line.line_material_type === "SFG") ? (
                            <select value={line.fg_type || ""} onChange={(event) => updateNewLine(line.__key, { fg_type: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
                              <option value="">Type</option>
                              {FG_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : <span />}
                          {isFgWithPack ? (
                            <>
                              <input type="number" step="0.0001" placeholder="Pack Qty" value={line.pack_qty} onChange={(event) => updateNewLine(line.__key, { pack_qty: event.target.value, rate_basis: line.rate_basis || "BASE_UOM" })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                              <input type="number" step="0.0001" placeholder="Per Pack" value={line.per_pack_qty} onChange={(event) => updateNewLine(line.__key, { per_pack_qty: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                            </>
                          ) : (
                            <input type="number" step="0.0001" placeholder="Qty" value={line.quantity} onChange={(event) => updateNewLine(line.__key, { quantity: event.target.value, base_qty: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500 col-span-2" />
                          )}
                          <input type="number" step="0.0001" placeholder="Rate" value={line.rate} onChange={(event) => updateNewLine(line.__key, { rate: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                          <input type="number" step="0.01" placeholder="GST%" value={line.gst_rate} onChange={(event) => updateNewLine(line.__key, { gst_rate: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                          <input placeholder="HSN" value={line.hsn_code} onChange={(event) => updateNewLine(line.__key, { hsn_code: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                          <input placeholder="Batch" value={line.batch_number} onChange={(event) => updateNewLine(line.__key, { batch_number: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                          <button type="button" onClick={() => removeNewLine(line.__key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isEditable ? (
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => void handleSaveLines()} disabled={savingLines} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {savingLines ? "Saving..." : "Save Line Changes"}
                </button>
              </div>
            ) : null}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Commercial Summary" title="Net amount, GST breakup and total value">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <ErpFieldPreview label="Net Amount" value={formatMoney(commercialTotals.netAmount)} />
              <ErpFieldPreview label="CGST" value={formatMoney(commercialTotals.cgstAmount)} />
              <ErpFieldPreview label="SGST" value={formatMoney(commercialTotals.sgstAmount)} />
              <ErpFieldPreview label="IGST" value={formatMoney(commercialTotals.igstAmount)} />
              <ErpFieldPreview label="Total Value" value={formatMoney(commercialTotals.totalValue)} tone="sky" />
            </div>
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
                cellNavigate
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

          <DocumentFlowSection docType="SO" docId={detail.id} />
        </div>
      )}
    </ErpScreenScaffold>
  );
}
