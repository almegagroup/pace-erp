import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useCostCentersQuery,
  useVendorOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  amendPurchaseOrder,
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  getPurchaseOrder,
  knockOffPOLine,
  knockOffPO,
  updatePurchaseOrder,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function listPoCsns(companyId, poId) {
  const params = new URLSearchParams();
  if (companyId) {
    params.set("company_id", companyId);
  }
  params.set("po_id", poId);
  params.set("limit", "200");
  params.set("offset", "0");
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/procurement/csns?${params.toString()}`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "PROCUREMENT_CSN_LIST_FAILED");
  }
  return json.data?.data ?? json.data ?? [];
}

function getHeaderStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return "amber";
    case "CONFIRMED":
      return "sky";
    case "CLOSED":
      return "emerald";
    case "CANCELLED":
      return "rose";
    default:
      return "slate";
  }
}

function getLineStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "FULLY_RECEIVED":
      return "bg-emerald-100 text-emerald-800";
    case "PARTIALLY_RECEIVED":
      return "bg-amber-100 text-amber-800";
    case "KNOCKED_OFF":
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function buildAmendmentState(lines, po) {
  return {
    delivery_date: po?.expected_delivery_date ?? "",
    payment_term_id: po?.payment_term_id ?? lines?.[0]?.payment_term_id ?? "",
    delivery_type: po?.delivery_type ?? "STANDARD",
    remarks: "",
    lines: (lines ?? []).map((line) => ({
      id: line.id,
      material_id: line.material_id,
      ordered_qty: String(line.ordered_qty ?? ""),
      unit_rate: String(line.unit_rate ?? ""),
      original_qty: String(line.ordered_qty ?? ""),
      original_rate: String(line.unit_rate ?? ""),
    })),
  };
}

function buildEditState(po, vendorType) {
  const line = po?.lines?.[0] ?? {};
  return {
    vendor_id: po?.vendor_id ?? "",
    vendor_type: String(vendorType || po?.vendor_type || "DOMESTIC").toUpperCase(),
    delivery_type: po?.delivery_type ?? "STANDARD",
    incoterm: po?.incoterm ?? "",
    payment_term_id: line.payment_term_id ?? po?.payment_term_id ?? "",
    freight_term: po?.freight_term ?? line.freight_term ?? "FOR",
    gst_terms: po?.gst_terms ?? line.gst_terms ?? "",
    cost_center_id: line.cost_center_id ?? po?.cost_center_id ?? "",
    expected_delivery_date: po?.expected_delivery_date ?? "",
    remarks: po?.remarks ?? "",
    has_rebate: Boolean(po?.has_rebate),
    rebate_rate: po?.rebate_rate ?? "",
    rebate_rate_uom_basis: po?.rebate_rate_uom_basis ?? "BASE_UOM",
    rebate_remarks: po?.rebate_remarks ?? "",
    line_material_id: line.material_id ?? "",
    line_material_display: line.material_display || line.material_id || "",
    ordered_qty: String(line.ordered_qty ?? ""),
    unit_rate: String(line.unit_rate ?? ""),
    po_uom_code: line.po_uom_code ?? "",
    line_remarks: line.remarks ?? "",
  };
}

function getRebateBasisLabel(value) {
  switch (String(value || "").toUpperCase()) {
    case "BASE_UOM":
      return "Base UOM";
    case "PO_UOM":
      return "PO UOM";
    default:
      return "—";
  }
}

export default function PODetailPage() {
  // NavigationStackBridge replays the screen-stack entry's literal route
  // ("/.../purchase-orders/:id") whenever it's pushed without a `context.id`
  // — the param ends up as the literal string ":id" instead of the real
  // UUID. Fall back to the screen-stack context (the same pattern Material/
  // Customer detail pages already use) whenever the path param looks wrong.
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const { runtimeContext } = useMenu();
  const resolvedCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(buildEditState(null, ""));
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentForm, setAmendmentForm] = useState({ delivery_date: "", payment_term_id: "", delivery_type: "STANDARD", remarks: "", lines: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const vendorQuery = useVendorOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const poDetailQuery = useQuery({
    queryKey: ["procurement", "purchase-order-detail", id],
    enabled: Boolean(id),
    queryFn: () => getPurchaseOrder(id),
  });
  const po = poDetailQuery.data?.data ?? poDetailQuery.data ?? null;
  const companyId = po?.company_id || resolvedCompanyId || "";
  const csnQuery = useQuery({
    queryKey: ["procurement", "po-csns", { companyId, id }],
    enabled: Boolean(id && companyId),
    queryFn: () => listPoCsns(companyId, id),
  });
  const costCenterQuery = useCostCentersQuery(
    { company_id: companyId, active: true },
    { enabled: Boolean(companyId) }
  );
  const vendors = vendorQuery.vendors;
  const paymentTerms = paymentTermQuery.paymentTerms;
  const costCenters = useMemo(
    () => (Array.isArray(costCenterQuery.data?.data) ? costCenterQuery.data.data : []),
    [costCenterQuery.data?.data]
  );
  const csns = Array.isArray(csnQuery.data) ? csnQuery.data : [];
  const loading =
    poDetailQuery.isLoading ||
    vendorQuery.isLoading ||
    paymentTermQuery.isLoading ||
    csnQuery.isLoading ||
    costCenterQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void refreshDetailQueries(),
    },
  });

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const selectedVendor = useMemo(
    () => vendorMap.get(po?.vendor_id) ?? null,
    [po?.vendor_id, vendorMap]
  );
  const editVendor = useMemo(
    () => vendorMap.get(editForm.vendor_id) ?? null,
    [editForm.vendor_id, vendorMap]
  );
  const paymentTermOptions = useMemo(
    () =>
      paymentTerms.map((entry) => ({
        value: entry.id,
        label: `${entry.code || entry.name} | ${entry.name}`,
      })),
    [paymentTerms]
  );
  const costCenterOptions = useMemo(
    () =>
      costCenters.map((entry) => ({
        value: entry.id,
        label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
      })),
    [costCenters]
  );
  const paymentTermMap = useMemo(
    () => new Map(paymentTermOptions.map((entry) => [entry.value, entry.label])),
    [paymentTermOptions]
  );
  const costCenterMap = useMemo(
    () => new Map(costCenterOptions.map((entry) => [entry.value, entry.label])),
    [costCenterOptions]
  );
  const isImportPo = useMemo(
    () =>
      String(selectedVendor?.vendor_type || "").toUpperCase() === "IMPORT" ||
      String(po?.delivery_type || "").toUpperCase() === "IMPORT",
    [po?.delivery_type, selectedVendor]
  );
  const isImportEditPo = useMemo(
    () => String(editVendor?.vendor_type || editForm.vendor_type || "").toUpperCase() === "IMPORT",
    [editForm.vendor_type, editVendor]
  );
  const deliveryDateLabel = isImportPo ? "ETA to Port" : "ETD";
  const editDeliveryDateLabel = isImportEditPo ? "ETA to Port" : "ETD";

  // Detail/vendors/payment-terms don't depend on each other — fetch them in
  // parallel instead of three sequential round trips. CSNs and cost centers
  // need the PO's company_id (known only once detail resolves), so they
  // form a second parallel batch right after.
  useEffect(() => {
    if (!id) {
      setError("PROCUREMENT_PO_NOT_FOUND");
      return;
    }
    const nextError =
      poDetailQuery.error?.message ||
      vendorQuery.error?.message ||
      paymentTermQuery.error?.message ||
      csnQuery.error?.message ||
      costCenterQuery.error?.message ||
      "";
    setError(nextError);
  }, [
    costCenterQuery.error?.message,
    csnQuery.error?.message,
    id,
    paymentTermQuery.error?.message,
    poDetailQuery.error?.message,
    vendorQuery.error?.message,
  ]);

  useEffect(() => {
    if (!po) {
      return;
    }
    setAmendmentForm(buildAmendmentState(po?.lines, po));
  }, [po]);

  async function refreshDetailQueries() {
    await Promise.all([
      poDetailQuery.refetch(),
      vendorQuery.refetch(),
      paymentTermQuery.refetch(),
      csnQuery.refetch(),
      costCenterQuery.refetch(),
    ]);
  }

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await refreshDetailQueries();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_PO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    await runAction(
      () => confirmPurchaseOrder(id, { approval_required: true }),
      "Purchase order moved for approval."
    );
  }

  async function handleCancelPo() {
    const isDraft = po?.status === "DRAFT";
    const reason = await openActionPrompt({
      eyebrow: "Purchase Order",
      title: isDraft ? "Remove this item from the order?" : "Cancel this PO?",
      label: isDraft ? "Removal reason" : "Cancellation reason",
      required: true,
    });
    if (!reason) return;
    await runAction(
      () => cancelPurchaseOrder(id, { reason }),
      isDraft ? "Item removed from the order." : "Purchase order cancelled."
    );
  }

  async function handleKnockOffPo() {
    const reason = await openActionPrompt({ eyebrow: "Purchase Order", title: "Knock off this PO?", label: "Knock-off reason", required: true });
    if (!reason) return;
    await runAction(
      () => knockOffPO(id, { reason }),
      "Purchase order knocked off."
    );
  }

  async function handleKnockOffLine(lineId) {
    // Line knock-off only auto-cancels CSNs still at ORD (server-side,
    // deliberately -- an in-transit shipment shouldn't be silently
    // cancelled). Anything already TRN/GED for this line will be left
    // untouched by the knock-off, so surface that before the user commits.
    const inTransitCsns = csns.filter(
      (csn) => csn.po_line_id === lineId && ["TRN", "GED"].includes(String(csn.status || "").toUpperCase())
    );
    if (inTransitCsns.length > 0) {
      const csnList = inTransitCsns.map((csn) => `${csn.csn_number} (${csn.status})`).join(", ");
      const proceed = await openActionConfirm({
        eyebrow: "Purchase Order",
        title: "Material already in transit for this line",
        message: `${csnList} — already dispatched, this knock-off will NOT cancel or affect them. Only the remaining un-dispatched balance will be closed. Continue?`,
        confirmLabel: "Continue",
      });
      if (!proceed) return;
    }

    const reason = await openActionPrompt({ eyebrow: "Purchase Order", title: "Knock off this line?", label: "Knock-off reason", required: true });
    if (!reason) return;
    await runAction(
      () => knockOffPOLine(id, lineId, { reason }),
      "PO line knocked off."
    );
  }

  async function handleSubmitAmendment() {
    const changedLines = amendmentForm.lines.filter(
      (line) => line.ordered_qty !== line.original_qty || line.unit_rate !== line.original_rate
    );
    const headerChanged =
      amendmentForm.delivery_date !== String(po?.expected_delivery_date ?? "") ||
      amendmentForm.payment_term_id !== String(po?.payment_term_id ?? po?.lines?.[0]?.payment_term_id ?? "") ||
      amendmentForm.delivery_type !== String(po?.delivery_type ?? "STANDARD") ||
      amendmentForm.remarks.trim() !== "";

    if (!headerChanged && changedLines.length === 0) {
      setError("No amendment changes to submit.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (headerChanged) {
        await amendPurchaseOrder(id, {
          po_line_id: po?.lines?.[0]?.id,
          delivery_date: amendmentForm.delivery_date || null,
          payment_term_id: amendmentForm.payment_term_id || null,
          delivery_type: amendmentForm.delivery_type || null,
          remarks: amendmentForm.remarks.trim() || null,
        });
      }
      for (const line of changedLines) {
        await amendPurchaseOrder(id, {
          po_line_id: line.id,
          ordered_qty: Number(line.ordered_qty),
          unit_rate: Number(line.unit_rate),
          remarks: amendmentForm.remarks.trim() || null,
        });
      }
      setAmendmentOpen(false);
      setNotice("Purchase order amendment submitted.");
      await refreshDetailQueries();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PO_AMEND_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function openEditModal() {
    const vendorType = vendorMap.get(po?.vendor_id)?.vendor_type || po?.vendor_type || "";
    setEditForm(buildEditState(po, vendorType));
    setEditOpen(true);
    setError("");
    setNotice("");
  }

  function closeEditModal() {
    setEditOpen(false);
  }

  function updateEditField(key, value) {
    setEditForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmitEdit() {
    if (!po?.company_id || !editForm.vendor_id) {
      setError("Company and vendor are required.");
      return;
    }
    if (!editForm.payment_term_id) {
      setError("Payment term is required.");
      return;
    }
    if (!editForm.cost_center_id) {
      setError("Cost center is required.");
      return;
    }
    if (!editForm.ordered_qty || !editForm.unit_rate) {
      setError("Qty and rate are required.");
      return;
    }
    if (isImportEditPo && !editForm.incoterm.trim()) {
      setError("Incoterm is required for import purchase orders.");
      return;
    }
    if (editForm.has_rebate && (editForm.rebate_rate === "" || !editForm.rebate_rate_uom_basis)) {
      setError("Rebate rate and basis are required when rebate is enabled.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const resolvedVendorType = String(editVendor?.vendor_type || editForm.vendor_type || "DOMESTIC").toUpperCase();
      await updatePurchaseOrder(id, {
        company_id: po.company_id,
        vendor_id: editForm.vendor_id,
        payment_term_id: editForm.payment_term_id,
        vendor_type: resolvedVendorType,
        delivery_type: editForm.delivery_type,
        freight_term: editForm.freight_term,
        incoterm: resolvedVendorType === "IMPORT" ? editForm.incoterm.trim() || null : null,
        gst_terms: editForm.gst_terms || null,
        has_rebate: editForm.has_rebate,
        rebate_remarks: editForm.has_rebate ? editForm.rebate_remarks.trim() || null : null,
        rebate_rate: editForm.has_rebate && editForm.rebate_rate !== "" ? Number(editForm.rebate_rate) : null,
        rebate_rate_uom_basis: editForm.has_rebate ? editForm.rebate_rate_uom_basis || null : null,
        cost_center_id: editForm.cost_center_id,
        expected_delivery_date: editForm.expected_delivery_date || null,
        remarks: editForm.remarks.trim() || null,
        lines: [
          {
            material_id: editForm.line_material_id,
            ordered_qty: Number(editForm.ordered_qty),
            unit_rate: Number(editForm.unit_rate),
            po_uom_code: editForm.po_uom_code.trim() || null,
            remarks: editForm.line_remarks.trim() || null,
            cost_center_id: editForm.cost_center_id,
          },
        ],
      });
      await refreshDetailQueries();
      setEditOpen(false);
      setNotice("Purchase order updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PO_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  // §113.10-style bug: PO line grid showed Ordered vs Received (open_qty,
  // which only moves on GRN) but nothing about what's already dispatched --
  // a knock-off decision needs to know whether the balance is truly free or
  // already committed to a CSN that's TRN/GED (in transit / at the gate).
  // CSN rows are already fetched on this page (csnQuery, below) with
  // po_line_id + status, so this is a pure client-side join, no new call.
  const grnSummaryRows = useMemo(
    () =>
      Array.isArray(po?.lines)
        ? po.lines.map((line) => {
            const lineCsns = csns.filter((csn) => csn.po_line_id === line.id);
            const sumByStatuses = (statuses) =>
              lineCsns
                .filter((csn) => statuses.includes(String(csn.status || "").toUpperCase()))
                .reduce((sum, csn) => sum + Number(csn.po_qty ?? 0), 0);
            return {
              id: line.id,
              material_id: line.material_id,
              material_display: line.material_display,
              ordered_qty: Number(line.ordered_qty ?? 0),
              received_qty: Number((Number(line.ordered_qty ?? 0) - Number(line.open_qty ?? 0)).toFixed(6)),
              open_qty: Number(line.open_qty ?? 0),
              csn_not_dispatched_qty: sumByStatuses(["ORD"]),
              csn_in_transit_qty: sumByStatuses(["TRN", "GED"]),
            };
          })
        : [],
    [po?.lines, csns]
  );

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Purchase Order Detail"
      notices={[
        ...(error ? [{ key: "po-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "po-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(po?.status === "DRAFT" ? [{ key: "edit", label: "Edit", tone: "neutral", onClick: openEditModal, disabled: saving }] : []),
        ...(po?.status === "DRAFT" ? [{ key: "confirm", label: saving ? "Confirming..." : "Confirm", tone: "primary", onClick: () => void handleConfirm(), disabled: saving }] : []),
        // Multi-item PO create is actually one purchase_order row per
        // material, bundled under one po_order_group -- but before this,
        // the only way to drop a single wrong item pre-confirm was to
        // confirm/reject the WHOLE group (all-or-nothing). cancelPOHandler
        // already scopes to one PO row and has no status gate of its own
        // (only blocks post-GRN), so this reuses it as-is at DRAFT;
        // syncOrderGroupStatus + confirmPOOrderGroupHandler's own
        // draft-only filter already handle a group with one item removed
        // correctly -- confirmed by reading both, no backend change needed.
        ...(po?.status === "DRAFT" ? [{ key: "remove", label: "Remove Item", tone: "danger", onClick: () => void handleCancelPo(), disabled: saving }] : []),
        // Approve/Reject/Approve-Amendment are deliberately NOT exposed here —
        // approval authority lives only on the dedicated "Pending PO
        // Approvals" page (PROC_PO_ORDER_APPROVALS, gated to the Procurement
        // Head/Buyer capability), per 87.12A batch-approval design. Anyone
        // who can open a PO's detail page should not also be able to
        // approve it from here, even if they happen to hold an approver role.
        ...(po?.status === "CONFIRMED"
          ? [
              { key: "amend", label: "Amend", tone: "neutral", onClick: () => setAmendmentOpen(true), disabled: saving },
              { key: "cancel", label: "Cancel PO", tone: "danger", onClick: () => void handleCancelPo(), disabled: saving },
              { key: "knockoff", label: "Knock-Off PO", tone: "neutral", onClick: () => void handleKnockOffPo(), disabled: saving },
            ]
          : []),
      ]}
    >
      {loading || !po ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading purchase order detail..." : "Purchase order detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${po.po_number || "-"} | ${vendorMap.get(po.vendor_id)?.vendor_name || po.vendor_id || "-"}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={po.status} tone={getHeaderStatusTone(po.status)} />
              <ErpFieldPreview label="PO Date" value={po.po_date} />
              <ErpFieldPreview label="Company" value={po.company_name || po.company_id} />
              <ErpFieldPreview label="Delivery Type" value={po.delivery_type} />
              <ErpFieldPreview label="GST Terms" value={po.gst_terms || "Not specified"} />
              <ErpFieldPreview label={deliveryDateLabel} value={po.expected_delivery_date || "—"} />
              {po.delivery_type === "IMPORT" ? (
                <ErpFieldPreview label="Incoterm" value={po.incoterm || "—"} />
              ) : null}
              <ErpFieldPreview label="Freight Term" value={po.freight_term || "—"} />
              <ErpFieldPreview label="Remarks" value={po.remarks || "—"} />
            </div>
          </ErpSectionCard>

          {po.has_rebate ? (
            <ErpSectionCard eyebrow="Commercials" title="Rebate">
              <div className="grid gap-3 md:grid-cols-3">
                <ErpFieldPreview label="Rebate Rate" value={po.rebate_rate ?? "—"} />
                <ErpFieldPreview label="Basis" value={getRebateBasisLabel(po.rebate_rate_uom_basis)} />
                <ErpFieldPreview label="Rebate Remarks" value={po.rebate_remarks || "—"} />
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Lines" title="PO lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                {
                  key: "material_id",
                  label: "Material",
                  render: (row) => row.material_display || row.material_id || "—",
                },
                { key: "ordered_qty", label: "Qty", width: "90px" },
                { key: "po_uom_code", label: "UOM", width: "90px" },
                { key: "unit_rate", label: "Rate", width: "90px" },
                {
                  key: "cost_center_id",
                  label: "Cost Center",
                  render: (row) =>
                    row.cost_center_display ||
                    costCenterMap.get(row.cost_center_id) ||
                    row.cost_center_id ||
                    "—",
                },
                {
                  key: "payment_term_id",
                  label: "Payment Term",
                  render: (row) =>
                    row.payment_term_display ||
                    paymentTermMap.get(row.payment_term_id) ||
                    row.payment_term_id ||
                    "—",
                },
                {
                  key: "line_status",
                  label: "Status",
                  width: "140px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getLineStatusTone(row.line_status)}`}>
                      {row.line_status}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  label: "Actions",
                  width: "120px",
                  render: (row) =>
                    po.status === "CONFIRMED" ? (
                      <button
                        type="button"
                        onClick={() => void handleKnockOffLine(row.id)}
                        className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        Knock-off
                      </button>
                    ) : "—",
                },
              ]}
              rows={po.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No PO lines found."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="CSNs" title="CSN links">
            <div className="grid gap-2">
              {csns.length === 0 ? (
                <div className="text-sm text-slate-500">No CSNs are linked to this purchase order yet.</div>
              ) : (
                csns.map((row) => (
                  <Link
                    key={row.id}
                    to={`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`}
                    className="text-sm font-semibold text-sky-700 underline underline-offset-2"
                  >
                    {row.csn_number || row.id}
                  </Link>
                ))
              )}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Approval Log" title="Approval history">
            <ErpDenseGrid
              columns={[
                { key: "action", label: "Action", width: "120px" },
                { key: "from_status", label: "From", width: "120px" },
                { key: "to_status", label: "To", width: "120px" },
                { key: "remarks", label: "Remarks" },
                { key: "actioned_at", label: "At", width: "180px" },
              ]}
              rows={po.approval_log ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No approval log rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Amendment Log" title="Amendment history">
            <ErpDenseGrid
              columns={[
                { key: "amendment_number", label: "Amendment #", width: "120px" },
                { key: "field_changed", label: "Field", width: "160px" },
                { key: "old_value", label: "Old Value" },
                { key: "new_value", label: "New Value" },
                { key: "approval_status", label: "Approval", width: "120px" },
                { key: "amended_at", label: "At", width: "180px" },
              ]}
              rows={po.amendment_log ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No amendment log rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Dispatch & Receipt Summary" title="Ordered vs dispatched vs received — before knocking off a balance, check it isn't already in transit">
            <ErpDenseGrid
              columns={[
                { key: "material_id", label: "Material", render: (row) => row.material_display || row.material_id || "—" },
                { key: "ordered_qty", label: "Ordered Qty", width: "110px", align: "right" },
                { key: "csn_not_dispatched_qty", label: "Not Yet Dispatched", width: "130px", align: "right" },
                { key: "csn_in_transit_qty", label: "In Transit / At Gate", width: "130px", align: "right" },
                { key: "received_qty", label: "Received (GRN)", width: "120px", align: "right" },
                { key: "open_qty", label: "Open Qty (Balance)", width: "130px", align: "right" },
              ]}
              rows={grnSummaryRows}
              rowKey={(row) => row.id}
              emptyMessage="No dispatch/receipt summary rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Audit" title="Audit">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ErpFieldPreview label="Created By" value={po.created_by_display || po.created_by || "—"} />
              <ErpFieldPreview label="Last Updated By" value={po.last_updated_by_display || "—"} />
              {po.cancelled_by_display ? (
                <ErpFieldPreview label="Cancelled By" value={po.cancelled_by_display} />
              ) : null}
              {po.knocked_off_by_display ? (
                <ErpFieldPreview label="Knocked Off By" value={po.knocked_off_by_display} />
              ) : null}
            </div>
          </ErpSectionCard>

          <DocumentFlowSection docType="PO" docId={po.id} />
        </div>
      )}

      {editOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="w-full max-w-5xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Edit Draft Purchase Order</h2>
              <button type="button" onClick={closeEditModal} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Vendor
                  <select
                    value={editForm.vendor_id}
                    onChange={(event) => {
                      const nextVendor = vendorMap.get(event.target.value);
                      setEditForm((current) => ({
                        ...current,
                        vendor_id: event.target.value,
                        vendor_type: String(nextVendor?.vendor_type || "DOMESTIC").toUpperCase(),
                        incoterm:
                          String(nextVendor?.vendor_type || "DOMESTIC").toUpperCase() === "IMPORT"
                            ? current.incoterm
                            : "",
                      }));
                    }}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {`${entry.vendor_code || ""} ${entry.vendor_name || entry.id}`.trim()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Delivery Type
                  <select
                    value={editForm.delivery_type}
                    onChange={(event) => updateEditField("delivery_type", event.target.value)}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    {["STANDARD", "BULK", "TANKER"].map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                {isImportEditPo ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Incoterm
                    <input
                      value={editForm.incoterm}
                      onChange={(event) => updateEditField("incoterm", event.target.value.toUpperCase())}
                      className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </label>
                ) : null}
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Payment Term
                  <select
                    value={editForm.payment_term_id}
                    onChange={(event) => updateEditField("payment_term_id", event.target.value)}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select payment term</option>
                    {paymentTermOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Freight Term
                  <select
                    value={editForm.freight_term}
                    onChange={(event) => updateEditField("freight_term", event.target.value)}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="FOR">FOR</option>
                    <option value="FREIGHT_SEPARATE">Freight Separate</option>
                    <option value="FREIGHT_AT_ACTUALS">Freight at Actuals</option>
                    <option value="EX_TRANSPORTER_GODOWN">Ex Transporter Godown</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  GST Terms
                  <select
                    value={editForm.gst_terms}
                    onChange={(event) => updateEditField("gst_terms", event.target.value)}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select GST terms</option>
                    <option value="INCLUSIVE">GST Inclusive</option>
                    <option value="EXCLUSIVE">GST Exclusive</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Cost Center
                  <select
                    value={editForm.cost_center_id}
                    onChange={(event) => updateEditField("cost_center_id", event.target.value)}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select cost center</option>
                    {costCenterOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Material
                  <input
                    value={editForm.line_material_display}
                    readOnly
                    className="h-8 border border-slate-300 bg-slate-100 px-2 text-sm text-slate-500 outline-none"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Qty
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={editForm.ordered_qty}
                    onChange={(event) => updateEditField("ordered_qty", event.target.value)}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Rate
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={editForm.unit_rate}
                    onChange={(event) => updateEditField("unit_rate", event.target.value)}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  UOM
                  <input
                    value={editForm.po_uom_code}
                    onChange={(event) => updateEditField("po_uom_code", event.target.value.toUpperCase())}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  {editDeliveryDateLabel}
                  <input
                    type="date"
                    value={editForm.expected_delivery_date}
                    onChange={(event) => updateEditField("expected_delivery_date", event.target.value)}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2 xl:col-span-3">
                  Remarks
                  <input
                    value={editForm.remarks}
                    onChange={(event) => updateEditField("remarks", event.target.value)}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
              </div>

              <div className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>Has Rebate</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditForm((current) => ({
                        ...current,
                        has_rebate: true,
                        rebate_rate_uom_basis: current.rebate_rate_uom_basis || "BASE_UOM",
                      }))
                    }
                    className={`px-3 py-2 text-xs font-semibold ${
                      editForm.has_rebate
                        ? "border border-emerald-700 bg-emerald-100 text-emerald-900"
                        : "border border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditForm((current) => ({
                        ...current,
                        has_rebate: false,
                        rebate_rate: "",
                        rebate_rate_uom_basis: "BASE_UOM",
                        rebate_remarks: "",
                      }))
                    }
                    className={`px-3 py-2 text-xs font-semibold ${
                      !editForm.has_rebate
                        ? "border border-slate-700 bg-slate-200 text-slate-950"
                        : "border border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>

              {editForm.has_rebate ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Rebate Rate
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={editForm.rebate_rate}
                      onChange={(event) => updateEditField("rebate_rate", event.target.value)}
                      className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Basis
                    <select
                      value={editForm.rebate_rate_uom_basis}
                      onChange={(event) => updateEditField("rebate_rate_uom_basis", event.target.value)}
                      className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    >
                      <option value="BASE_UOM">Base UOM</option>
                      <option value="PO_UOM">PO UOM</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-3">
                    Rebate Remarks
                    <input
                      value={editForm.rebate_remarks}
                      onChange={(event) => updateEditField("rebate_remarks", event.target.value)}
                      className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </label>
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeEditModal} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  Cancel
                </button>
                <button type="button" disabled={saving} onClick={() => void handleSubmitEdit()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {amendmentOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="w-full max-w-5xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Amend Purchase Order</h2>
              <button type="button" onClick={() => setAmendmentOpen(false)} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Requires Procurement Head approval.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Delivery Date
                  <input
                    type="date"
                    value={amendmentForm.delivery_date}
                    onChange={(event) => setAmendmentForm((current) => ({ ...current, delivery_date: event.target.value }))}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Payment Term
                  <select
                    value={amendmentForm.payment_term_id}
                    onChange={(event) => setAmendmentForm((current) => ({ ...current, payment_term_id: event.target.value }))}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select payment term</option>
                    {paymentTermOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Delivery Type
                  <select
                    value={amendmentForm.delivery_type}
                    onChange={(event) => setAmendmentForm((current) => ({ ...current, delivery_type: event.target.value }))}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    {["STANDARD", "BULK", "TANKER"].map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Remarks
                  <input
                    value={amendmentForm.remarks}
                    onChange={(event) => setAmendmentForm((current) => ({ ...current, remarks: event.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
              </div>
              <div className="grid gap-3">
                {amendmentForm.lines.map((line, index) => (
                  <div key={line.id} className="grid gap-3 border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Line {index + 1} | {line.material_id}
                    </div>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Qty
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.ordered_qty}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id ? { ...entry, ordered_qty: event.target.value } : entry
                            ),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Rate
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.unit_rate}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id ? { ...entry, unit_rate: event.target.value } : entry
                            ),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAmendmentOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  Cancel
                </button>
                <button type="button" disabled={saving} onClick={() => void handleSubmitAmendment()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? "Submitting..." : "Submit Amendment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
