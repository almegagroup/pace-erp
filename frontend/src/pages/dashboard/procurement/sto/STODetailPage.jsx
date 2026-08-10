import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import LocationSelect from "../../../../components/inputs/LocationSelect.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useCostCentersQuery,
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import {
  amendSTO,
  approveSTO,
  approveSTOAmendment,
  cancelSTO,
  closeSTO,
  confirmSTO,
  confirmSTOReceipt,
  dispatchSTO,
  getSTO,
  knockOffSTOLine,
  listCSNs,
  rejectSTO,
  updateSTO,
  updateGateExitWeight,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";

const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
];
const GST_TERM_OPTIONS = [
  { value: "INCLUSIVE", label: "GST Inclusive" },
  { value: "EXCLUSIVE", label: "GST Exclusive" },
];
const REBATE_BASIS_OPTIONS = [
  { value: "BASE_UOM", label: "Base UOM" },
  { value: "PO_UOM", label: "PO UOM" },
];

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DRAFT":
      return "slate";
    case "PENDING_APPROVAL":
      return "amber";
    case "DISPATCHED":
      return "sky";
    case "RECEIVED":
      return "emerald";
    case "CLOSED":
      return "slate";
    case "CANCELLED":
      return "rose";
    case "CREATED":
    default:
      return "amber";
  }
}

function isBulkLike(stoType) {
  const value = String(stoType || "").toUpperCase();
  return value === "BULK" || value === "TANKER";
}

function buildEditState(detail) {
  return {
    sending_cost_center_id: detail?.sending_cost_center_id || "",
    receiving_cost_center_id: detail?.receiving_cost_center_id || "",
    remarks: detail?.remarks || "",
    lines: (detail?.lines ?? []).map((line) => ({
      id: line.id,
      material_id: line.material_id,
      quantity: String(line.quantity ?? ""),
      transfer_price: String(line.transfer_price ?? ""),
      payment_term_id: line.payment_term_id ?? "",
      freight_term: line.freight_term ?? "FOR",
      gst_terms: line.gst_terms ?? "",
      gst_rate: line.gst_rate != null ? String(line.gst_rate) : "",
      remarks: line.remarks ?? "",
      has_rebate: Boolean(line.has_rebate),
      rebate_rate: line.rebate_rate ?? "",
      rebate_rate_uom_basis: line.rebate_rate_uom_basis ?? "BASE_UOM",
      rebate_remarks: line.rebate_remarks ?? "",
      expected_delivery_date: line.expected_delivery_date ?? "",
      uom_code: line.uom_code ?? "",
    })),
  };
}

function buildAmendmentState(detail) {
  return {
    remarks: detail?.remarks || "",
    lines: (detail?.lines ?? []).map((line) => ({
      id: line.id,
      material_id: line.material_id,
      quantity: String(line.quantity ?? ""),
      original_quantity: String(line.quantity ?? ""),
      transfer_price: String(line.transfer_price ?? ""),
      original_transfer_price: String(line.transfer_price ?? ""),
      expected_delivery_date: line.expected_delivery_date ?? "",
      original_expected_delivery_date: line.expected_delivery_date ?? "",
    })),
  };
}

export default function STODetailPage() {
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const { runtimeContext } = useMenu();
  const [tareWeight, setTareWeight] = useState("");
  const [locationDrafts, setLocationDrafts] = useState({});
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(buildEditState(null));
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentForm, setAmendmentForm] = useState(buildAmendmentState(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const detailQuery = useQuery({
    queryKey: ["procurement", "sto-detail", id],
    queryFn: () => getSTO(id),
    enabled: Boolean(id),
  });
  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const detail = detailQuery.data ?? null;
  // INTER_PLANT STOs get their own CSN(s) at create time (unlike PO, which
  // only creates CSN at CONFIRMED) -- needed here to warn before knocking
  // off a line whose CSN is already TRN/GED (§113.10 line-knock-off pattern,
  // same as PODetailPage.jsx's fix for the same gap).
  const csnQuery = useQuery({
    queryKey: ["procurement", "sto-csns", id],
    queryFn: () => listCSNs({ sto_id: id, limit: 200, offset: 0 }),
    enabled: Boolean(id),
  });
  const csns = Array.isArray(csnQuery.data?.data) ? csnQuery.data.data : [];
  const materials = materialQuery.materials;
  const paymentTerms = paymentTermQuery.paymentTerms;
  const loading = detailQuery.isLoading || materialQuery.isLoading || paymentTermQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void detailQuery.refetch(),
    },
  });

  const sendingCostCenterQuery = useCostCentersQuery(
    { company_id: detail?.sending_company_id || "", active: true },
    { enabled: Boolean(detail?.sending_company_id) }
  );
  const receivingCostCenterQuery = useCostCentersQuery(
    { company_id: detail?.receiving_company_id || "", active: true },
    { enabled: Boolean(detail?.receiving_company_id) }
  );

  const selectedCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const companyMap = useMemo(
    () => new Map((runtimeContext?.availableCompanies ?? []).map((entry) => [entry.id, entry])),
    [runtimeContext?.availableCompanies]
  );
  const paymentTermOptions = useMemo(
    () =>
      paymentTerms.map((entry) => ({
        value: entry.id,
        label: `${entry.code || entry.name} | ${entry.name}`,
      })),
    [paymentTerms]
  );
  const sendingCostCenterOptions = useMemo(
    () =>
      (sendingCostCenterQuery.data?.data ?? []).map((entry) => ({
        value: entry.id,
        label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
      })),
    [sendingCostCenterQuery.data?.data]
  );
  const receivingCostCenterOptions = useMemo(
    () =>
      (receivingCostCenterQuery.data?.data ?? []).map((entry) => ({
        value: entry.id,
        label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
      })),
    [receivingCostCenterQuery.data?.data]
  );
  const sendingCostCenterMap = useMemo(
    () =>
      new Map(
        sendingCostCenterOptions.map((entry) => [entry.value, entry.label])
      ),
    [sendingCostCenterOptions]
  );
  const receivingCostCenterMap = useMemo(
    () =>
      new Map(
        receivingCostCenterOptions.map((entry) => [entry.value, entry.label])
      ),
    [receivingCostCenterOptions]
  );
  const paymentTermMap = useMemo(
    () => new Map(paymentTermOptions.map((entry) => [entry.value, entry.label])),
    [paymentTermOptions]
  );

  const latestDc = Array.isArray(detail?.delivery_challans) ? detail.delivery_challans[0] : null;
  const latestGateExit = Array.isArray(detail?.gate_exit_outbound) ? detail.gate_exit_outbound[0] : null;
  const hasPendingAmendment = Array.isArray(detail?.amendment_log)
    && detail.amendment_log.some((row) => row.requires_approval === true && String(row.approval_status || "").toUpperCase() === "PENDING");
  const canEdit = String(detail?.status || "").toUpperCase() === "DRAFT";
  const canConfirmForApproval = String(detail?.status || "").toUpperCase() === "DRAFT";
  // §113 Task D fix: backend's amendSTOHandler already allows CREATED *and*
  // PENDING_APPROVAL (qty/rate changes just need their own approval) — the
  // frontend button was only checking CREATED, so there was no way to fix a
  // mistake while an STO sat waiting for approval. Blocked while an earlier
  // amendment is itself still awaiting approval, to avoid stacking two
  // unresolved amendments on the same STO.
  const canAmend = ["CREATED", "PENDING_APPROVAL"].includes(String(detail?.status || "").toUpperCase())
    && !hasPendingAmendment;
  const canApproveAmendment = String(detail?.status || "").toUpperCase() === "PENDING_APPROVAL" && hasPendingAmendment;
  const canConfirmReceipt =
    String(detail?.status || "").toUpperCase() === "DISPATCHED" &&
    String(selectedCompanyId || "") === String(detail?.receiving_company_id || "");
  const canClose = String(detail?.status || "").toUpperCase() === "RECEIVED";
  const canCancel = ["DRAFT", "PENDING_APPROVAL", "CREATED"].includes(String(detail?.status || "").toUpperCase());
  const canDispatch = String(detail?.status || "").toUpperCase() === "CREATED";
  const canReject = String(detail?.status || "").toUpperCase() === "PENDING_APPROVAL" && !hasPendingAmendment;
  const canApproveSto = String(detail?.status || "").toUpperCase() === "PENDING_APPROVAL" && !hasPendingAmendment;
  const showTareForm =
    String(detail?.status || "").toUpperCase() === "DISPATCHED" &&
    isBulkLike(detail?.sto_type) &&
    latestGateExit;
  const linesMissingLocations = useMemo(
    () =>
      (detail?.lines ?? []).filter(
        (line) => line.line_status !== "KNOCKED_OFF" && (!line.sending_storage_location_id || !line.receiving_storage_location_id)
      ),
    [detail?.lines]
  );
  const locationSetupRequired = canDispatch && linesMissingLocations.length > 0;
  const grnSummaryRows = useMemo(
    () =>
      Array.isArray(detail?.lines)
        ? detail.lines.map((line) => ({
            id: line.id,
            material_id: line.material_id,
            ordered_qty: Number(line.quantity ?? 0),
            received_qty: Number(line.received_qty ?? 0),
            open_qty: Number(line.balance_qty ?? 0),
          }))
        : [],
    [detail?.lines]
  );

  useEffect(() => {
    setError(
      detailQuery.error?.message ||
        materialQuery.error?.message ||
        paymentTermQuery.error?.message ||
        sendingCostCenterQuery.error?.message ||
        receivingCostCenterQuery.error?.message ||
        ""
    );
  }, [
    detailQuery.error?.message,
    materialQuery.error?.message,
    paymentTermQuery.error?.message,
    receivingCostCenterQuery.error?.message,
    sendingCostCenterQuery.error?.message,
  ]);

  useEffect(() => {
    setTareWeight(String(detail?.gate_exit_outbound?.[0]?.tare_weight ?? ""));
  }, [detail?.gate_exit_outbound]);

  useEffect(() => {
    setLocationDrafts(
      Object.fromEntries(
        (detail?.lines ?? []).map((line) => [
          line.id,
          {
            sending_storage_location_id: line.sending_storage_location_id || "",
            receiving_storage_location_id: line.receiving_storage_location_id || "",
          },
        ])
      )
    );
  }, [detail?.lines]);

  useEffect(() => {
    if (!detail) return;
    setEditForm(buildEditState(detail));
    setAmendmentForm(buildAmendmentState(detail));
  }, [detail]);

  async function refreshDetailQueries() {
    await Promise.all([
      detailQuery.refetch(),
      materialQuery.refetch(),
      paymentTermQuery.refetch(),
      sendingCostCenterQuery.refetch(),
      receivingCostCenterQuery.refetch(),
      csnQuery.refetch(),
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
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_STO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function saveDispatchLocations() {
    if (!detail) return false;
    const missingDraft = (detail.lines ?? []).some((line) => {
      const draft = locationDrafts[line.id] || {};
      return !draft.sending_storage_location_id || !draft.receiving_storage_location_id;
    });
    if (missingDraft) {
      setError("Set sending and receiving storage locations for every STO line.");
      return false;
    }
    setSaving(true);
    setError("");
    try {
      await updateSTO(detail.id, {
        lines: (detail.lines ?? []).map((line) => ({
          id: line.id,
          sending_storage_location_id: locationDrafts[line.id]?.sending_storage_location_id || null,
          receiving_storage_location_id: locationDrafts[line.id]?.receiving_storage_location_id || null,
        })),
      });
      setNotice("Dispatch locations saved.");
      await refreshDetailQueries();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_STO_ACTION_FAILED");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDispatch() {
    if (!detail) return;
    if (locationSetupRequired) {
      const saved = await saveDispatchLocations();
      if (!saved) return;
    }
    const lineMessages = (detail.lines ?? []).filter((line) => line.line_status !== "KNOCKED_OFF").map((line) => {
      const materialName =
        materialMap.get(line.material_id)?.material_name ||
        materialMap.get(line.material_id)?.material_code ||
        line.material_id;
      const availableQty =
        line.available_qty !== undefined && line.available_qty !== null
          ? line.available_qty
          : "Unknown";
      const warning =
        line.available_qty !== undefined &&
        Number(line.quantity || 0) > Number(line.available_qty || 0)
          ? ` WARNING: Insufficient stock for ${materialName}.`
          : "";
      return `${materialName} | Required: ${line.quantity} | Available: ${availableQty}.${warning}`;
    });
    const confirmed = await openActionConfirm({ eyebrow: "STO", title: "Dispatch this STO?", message: lineMessages.join("\n"), confirmLabel: "Dispatch" });
    if (!confirmed) return;
    await runAction(() => dispatchSTO(detail.id, {}), "STO dispatched successfully.");
  }

  async function handleCancel() {
    if (!detail) return;
    const reason = await openActionPrompt({ eyebrow: "STO", title: "Cancel this STO?", label: "Cancellation reason", required: true });
    if (!reason) return;
    await runAction(() => cancelSTO(detail.id, { cancellation_reason: reason }), "STO cancelled.");
  }

  // Same PO/STO parity fix requested by the business owner: a multi-item STO
  // needed a way to drop one wrong line without touching the rest -- and
  // knocking it off must not silently ignore a CSN already TRN/GED for that
  // material (consignment_note has no sto_line_id, so this matches by
  // material_id, same as the backend's own knockOffSTOLineHandler).
  async function handleKnockOffLine(line) {
    if (!detail) return;
    const inTransitCsns = csns.filter(
      (csn) => csn.material_id === line.material_id && ["TRN", "GED"].includes(String(csn.status || "").toUpperCase())
    );
    if (inTransitCsns.length > 0) {
      const csnList = inTransitCsns.map((csn) => `${csn.csn_number} (${csn.status})`).join(", ");
      const proceed = await openActionConfirm({
        eyebrow: "STO",
        title: "Material already in transit for this line",
        message: `${csnList} — already dispatched, this knock-off will NOT cancel or affect them. Continue?`,
        confirmLabel: "Continue",
      });
      if (!proceed) return;
    }
    const reason = await openActionPrompt({ eyebrow: "STO", title: "Knock off this line?", label: "Knock-off reason", required: true });
    if (!reason) return;
    await runAction(() => knockOffSTOLine(detail.id, line.id, { reason }), "STO line knocked off.");
  }

  async function handleConfirmForApproval() {
    if (!detail) return;
    await runAction(() => confirmSTO(detail.id, { approval_required: true }), "STO moved for approval.");
  }

  async function handleApprove() {
    if (!detail) return;
    const remarks = (await openActionPrompt({
      eyebrow: "STO",
      title: "Approve this STO?",
      label: "Remarks (optional)",
      placeholder: "Optional approval remarks",
    })) ?? "";
    await runAction(() => approveSTO(detail.id, { remarks }), "STO approved.");
  }

  async function handleApproveAmendment() {
    if (!detail) return;
    const remarks = (await openActionPrompt({
      eyebrow: "STO",
      title: "Approve amendment?",
      label: "Remarks (optional)",
      placeholder: "Optional approval remarks",
    })) ?? "";
    await runAction(() => approveSTOAmendment(detail.id, { remarks }), "STO amendment approved.");
  }

  async function handleReject() {
    if (!detail) return;
    const remarks = await openActionPrompt({
      eyebrow: "STO",
      title: "Reject this STO?",
      label: "Reject reason",
      required: true,
    });
    if (!remarks) return;
    await runAction(() => rejectSTO(detail.id, { remarks }), "STO rejected and sent back to draft.");
  }

  async function handleConfirmReceipt() {
    if (!detail) return;
    const confirmed = await openActionConfirm({ eyebrow: "STO", title: "Confirm receipt?", message: "Confirm receipt for this dispatched STO.", confirmLabel: "Confirm Receipt" });
    if (!confirmed) return;
    await runAction(() => confirmSTOReceipt(detail.id), "STO receipt confirmed.");
  }

  async function handleClose() {
    if (!detail) return;
    const confirmed = await openActionConfirm({ eyebrow: "STO", title: "Close this STO?", message: "This STO will be marked as closed.", confirmLabel: "Close STO" });
    if (!confirmed) return;
    await runAction(() => closeSTO(detail.id), "STO closed.");
  }

  async function handleSaveTareWeight() {
    if (!latestGateExit?.id || !tareWeight) {
      setError("Tare weight is required.");
      return;
    }
    await runAction(() => updateGateExitWeight(latestGateExit.id, { tare_weight: Number(tareWeight) }), "Tare weight updated.");
  }

  async function handleSubmitEdit() {
    if (!detail) return;
    if (!editForm.sending_cost_center_id || !editForm.receiving_cost_center_id) {
      setError("Sending and receiving cost centers are required.");
      return;
    }
    if (editForm.lines.some((line) => !line.quantity || !line.transfer_price || !line.payment_term_id || !line.freight_term)) {
      setError("Each STO line requires quantity, rate, payment term, and freight term.");
      return;
    }
    if (editForm.lines.some((line) => line.has_rebate && (line.rebate_rate === "" || !line.rebate_rate_uom_basis))) {
      setError("Rebate rate and basis are required when rebate is enabled.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateSTO(detail.id, {
        sending_cost_center_id: editForm.sending_cost_center_id,
        receiving_cost_center_id: editForm.receiving_cost_center_id,
        remarks: editForm.remarks.trim() || null,
        lines: editForm.lines.map((line) => ({
          id: line.id,
          quantity: Number(line.quantity),
          transfer_price: Number(line.transfer_price),
          payment_term_id: line.payment_term_id,
          freight_term: line.freight_term,
          gst_terms: line.gst_terms || null,
          gst_rate: line.gst_rate !== "" ? Number(line.gst_rate) : null,
          remarks: line.remarks.trim() || null,
          has_rebate: line.has_rebate,
          rebate_rate: line.has_rebate && line.rebate_rate !== "" ? Number(line.rebate_rate) : null,
          rebate_rate_uom_basis: line.has_rebate ? line.rebate_rate_uom_basis || null : null,
          rebate_remarks: line.has_rebate ? line.rebate_remarks.trim() || null : null,
          expected_delivery_date: line.expected_delivery_date || null,
          uom_code: line.uom_code || null,
        })),
      });
      await refreshDetailQueries();
      setEditOpen(false);
      setNotice("STO updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "STO_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitAmendment() {
    if (!detail) return;
    const changedLines = amendmentForm.lines.filter(
      (line) =>
        line.quantity !== line.original_quantity ||
        line.transfer_price !== line.original_transfer_price ||
        line.expected_delivery_date !== line.original_expected_delivery_date
    );
    const headerChanged = amendmentForm.remarks.trim() !== String(detail.remarks ?? "").trim();

    if (!headerChanged && changedLines.length === 0) {
      setError("No amendment changes to submit.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (headerChanged) {
        await amendSTO(detail.id, {
          remarks: amendmentForm.remarks.trim() || null,
        });
      }
      for (const line of changedLines) {
        await amendSTO(detail.id, {
          sto_line_id: line.id,
          quantity: Number(line.quantity),
          transfer_price: Number(line.transfer_price),
          expected_delivery_date: line.expected_delivery_date || null,
          remarks: amendmentForm.remarks.trim() || null,
        });
      }
      setAmendmentOpen(false);
      setNotice("STO amendment submitted.");
      await refreshDetailQueries();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "STO_AMEND_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const dispatchSummary = useMemo(() => {
    if (!latestDc && !latestGateExit) {
      return [];
    }
    return [
      latestDc?.dc_number ? `Delivery Challan ${latestDc.dc_number} auto-generated.` : null,
      latestGateExit?.exit_number ? `Gate Exit ${latestGateExit.exit_number} created.` : null,
    ].filter(Boolean);
  }, [latestDc, latestGateExit]);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Stock Transfer Detail"
      notices={[
        ...(error ? [{ key: "sto-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "sto-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(canEdit ? [{ key: "edit", label: "Edit", tone: "neutral", onClick: () => setEditOpen(true), disabled: saving }] : []),
        ...(canConfirmForApproval ? [{ key: "confirm", label: saving ? "Sending..." : "Confirm STO", tone: "primary", onClick: () => void handleConfirmForApproval(), disabled: saving }] : []),
        ...(canAmend ? [{ key: "amend", label: "Amend", tone: "neutral", onClick: () => setAmendmentOpen(true), disabled: saving }] : []),
        ...(canApproveSto ? [{ key: "approve", label: saving ? "Approving..." : "Approve STO", tone: "primary", onClick: () => void handleApprove(), disabled: saving }] : []),
        ...(canApproveAmendment ? [{ key: "approve-amendment", label: saving ? "Approving..." : "Approve Amendment", tone: "primary", onClick: () => void handleApproveAmendment(), disabled: saving }] : []),
        ...(canReject ? [{ key: "reject", label: "Reject STO", tone: "danger", onClick: () => void handleReject(), disabled: saving }] : []),
        ...(canDispatch ? [{ key: "dispatch", label: saving ? "Dispatching..." : "Dispatch", tone: "primary", onClick: () => void handleDispatch(), disabled: saving }] : []),
        ...(canConfirmReceipt ? [{ key: "confirm-receipt", label: saving ? "Confirming..." : "Confirm Receipt", tone: "primary", onClick: () => void handleConfirmReceipt(), disabled: saving }] : []),
        ...(canClose ? [{ key: "close", label: saving ? "Closing..." : "Close STO", tone: "neutral", onClick: () => void handleClose(), disabled: saving }] : []),
        ...(canCancel ? [{ key: "cancel", label: "Cancel", tone: "danger", onClick: () => void handleCancel(), disabled: saving }] : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading STO detail..." : "STO detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.sto_number || "STO"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
              <ErpFieldPreview label="STO Type" value={detail.sto_type || "—"} />
              <ErpFieldPreview label="STO Date" value={detail.sto_date || "—"} />
              <ErpFieldPreview label="Sending Company" value={companyMap.get(detail.sending_company_id)?.company_name || detail.sending_company_id || "—"} />
              <ErpFieldPreview label="Receiving Company" value={companyMap.get(detail.receiving_company_id)?.company_name || detail.receiving_company_id || "—"} />
              <ErpFieldPreview label="Related CSN" value={detail.related_csn_id || "—"} />
              <ErpFieldPreview
                label="Sending Cost Center"
                value={
                  sendingCostCenterMap.get(detail.sending_cost_center_id) ||
                  detail.sending_cost_center_id ||
                  "—"
                }
              />
              <ErpFieldPreview
                label="Receiving Cost Center"
                value={
                  receivingCostCenterMap.get(detail.receiving_cost_center_id) ||
                  detail.receiving_cost_center_id ||
                  "—"
                }
              />
              <ErpFieldPreview label="Remarks" value={detail.remarks || "—"} />
            </div>
          </ErpSectionCard>

          {dispatchSummary.length > 0 ? (
            <div className="grid gap-2 rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              {dispatchSummary.map((entry) => (
                <div key={entry}>{entry}</div>
              ))}
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Lines" title="Transfer lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                {
                  key: "material_id",
                  label: "Material",
                  render: (row) =>
                    materialMap.get(row.material_id)?.material_name ||
                    materialMap.get(row.material_id)?.material_code ||
                    row.material_id ||
                    "—",
                },
                { key: "quantity", label: "Requested Qty", width: "110px" },
                { key: "uom_code", label: "UOM", width: "90px" },
                { key: "transfer_price", label: "Rate", width: "90px", render: (row) => row.transfer_price ?? "—" },
                {
                  key: "payment_term_id",
                  label: "Payment Term",
                  render: (row) =>
                    paymentTermMap.get(row.payment_term_id) ||
                    row.payment_term_id ||
                    "—",
                },
                { key: "freight_term", label: "Freight Term", width: "120px", render: (row) => row.freight_term || "—" },
                { key: "expected_delivery_date", label: "Expected Delivery", width: "130px", render: (row) => row.expected_delivery_date || "—" },
                { key: "dispatched_qty", label: "Issued Qty", width: "110px", render: (row) => row.dispatched_qty ?? "—" },
                { key: "received_qty", label: "Received Qty", width: "110px", render: (row) => row.received_qty ?? "—" },
                { key: "balance_qty", label: "Balance Qty", width: "110px", render: (row) => row.balance_qty ?? "—" },
                { key: "available_qty", label: "Available Stock", width: "120px", render: (row) => row.available_qty ?? "—" },
                {
                  key: "line_status",
                  label: "Status",
                  width: "120px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${row.line_status === "KNOCKED_OFF" ? "bg-rose-100 text-rose-800" : row.line_status === "RECEIVED" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
                      {row.line_status || "OPEN"}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  label: "Actions",
                  width: "120px",
                  render: (row) =>
                    ["DRAFT", "PENDING_APPROVAL", "CREATED"].includes(String(detail.status || "").toUpperCase())
                    && row.line_status !== "KNOCKED_OFF"
                    && Number(row.dispatched_qty ?? 0) === 0 ? (
                      <button
                        type="button"
                        onClick={() => void handleKnockOffLine(row)}
                        className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        Knock-off
                      </button>
                    ) : "—",
                },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No STO lines found."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Approval Log" title="Approval history">
            <ErpDenseGrid
              columns={[
                { key: "action", label: "Action", width: "120px" },
                { key: "from_status", label: "From", width: "120px" },
                { key: "to_status", label: "To", width: "120px" },
                { key: "remarks", label: "Remarks" },
                { key: "actioned_by_display", label: "By", width: "180px", render: (row) => row.actioned_by_display || row.actioned_by || "—" },
                { key: "actioned_at", label: "At", width: "180px" },
              ]}
              rows={detail.approval_log ?? []}
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
                { key: "amended_by_display", label: "By", width: "180px", render: (row) => row.amended_by_display || row.amended_by || "—" },
                { key: "amended_at", label: "At", width: "180px" },
              ]}
              rows={detail.amendment_log ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No amendment log rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="GRN Summary" title="Ordered vs received">
            <ErpDenseGrid
              columns={[
                { key: "material_id", label: "Material", render: (row) => materialMap.get(row.material_id)?.material_name || row.material_id || "—" },
                { key: "ordered_qty", label: "Ordered Qty", width: "120px" },
                { key: "received_qty", label: "Received Qty", width: "120px" },
                { key: "open_qty", label: "Open Qty", width: "120px" },
              ]}
              rows={grnSummaryRows}
              rowKey={(row) => row.id}
              emptyMessage="No GRN summary rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Audit" title="Audit">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ErpFieldPreview label="Created By" value={detail.created_by_display || detail.created_by || "—"} />
              <ErpFieldPreview label="Last Updated By" value={detail.last_updated_by_display || detail.last_updated_by || "—"} />
              {detail.cancelled_by_display ? (
                <ErpFieldPreview label="Cancelled By" value={detail.cancelled_by_display} />
              ) : null}
              {detail.approved_by_display ? (
                <ErpFieldPreview label="Approved By" value={detail.approved_by_display} />
              ) : null}
            </div>
          </ErpSectionCard>

          {locationSetupRequired ? (
            <ErpSectionCard eyebrow="Dispatch Prep" title="Set storage locations before dispatch">
              <div className="grid gap-3">
                {(detail.lines ?? []).map((line) => {
                  const materialLabel =
                    materialMap.get(line.material_id)?.material_name ||
                    materialMap.get(line.material_id)?.material_code ||
                    line.material_id ||
                    "—";
                  return (
                    <div key={line.id} className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[180px_1fr_1fr]">
                      <div className="text-sm font-semibold text-slate-900">
                        Line {line.line_number}: {materialLabel}
                      </div>
                      <div className="grid gap-1 text-xs font-semibold text-slate-700">
                        <span>Sending Location</span>
                        <LocationSelect
                          companyId={detail.sending_company_id}
                          projectCode="PRJ009"
                          value={locationDrafts[line.id]?.sending_storage_location_id || ""}
                          onChange={(idValue) =>
                            setLocationDrafts((current) => ({
                              ...current,
                              [line.id]: {
                                ...(current[line.id] || {}),
                                sending_storage_location_id: idValue || "",
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-1 text-xs font-semibold text-slate-700">
                        <span>Receiving Location</span>
                        <LocationSelect
                          companyId={detail.receiving_company_id}
                          projectCode="PRJ009"
                          value={locationDrafts[line.id]?.receiving_storage_location_id || ""}
                          onChange={(idValue) =>
                            setLocationDrafts((current) => ({
                              ...current,
                              [line.id]: {
                                ...(current[line.id] || {}),
                                receiving_storage_location_id: idValue || "",
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveDispatchLocations()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
                    Save Locations
                  </button>
                </div>
              </div>
            </ErpSectionCard>
          ) : null}

          {(latestDc || latestGateExit) ? (
            <ErpSectionCard eyebrow="Dispatch Result" title="Dispatch documents">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ErpFieldPreview label="Delivery Challan" value={latestDc?.dc_number || "—"} />
                <ErpFieldPreview label="Gate Exit" value={latestGateExit?.exit_number || "—"} />
                <ErpFieldPreview label="Dispatch Date" value={latestGateExit?.exit_date || latestDc?.dc_date || "—"} />
                <ErpFieldPreview label="Vehicle" value={latestGateExit?.vehicle_number || latestDc?.vehicle_number || "—"} />
              </div>
            </ErpSectionCard>
          ) : null}

          {showTareForm ? (
            <ErpSectionCard eyebrow="BULK / TANKER Weight" title="Add Tare Weight">
              <div className="grid gap-3 lg:grid-cols-[220px_auto]">
                <ErpDenseFormRow label="Tare Weight">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={tareWeight}
                    onChange={(event) => setTareWeight(event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={saving || !tareWeight}
                    onClick={() => void handleSaveTareWeight()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
                    Save Tare Weight
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <ErpFieldPreview label="Gross Weight" value={latestGateExit?.gross_weight ?? "—"} />
                <ErpFieldPreview label="Tare Weight" value={latestGateExit?.tare_weight ?? "—"} />
                <ErpFieldPreview label="Net Weight" value={latestGateExit?.net_weight ?? "—"} />
              </div>
            </ErpSectionCard>
          ) : null}

          <DocumentFlowSection docType="STO" docId={detail.id} />
        </div>
      )}

      {editOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="w-full max-w-6xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Edit Draft Stock Transfer Order</h2>
              <button type="button" onClick={() => setEditOpen(false)} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Sending Cost Center
                  <select
                    value={editForm.sending_cost_center_id}
                    onChange={(event) => setEditForm((current) => ({ ...current, sending_cost_center_id: event.target.value }))}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select cost center</option>
                    {sendingCostCenterOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Receiving Cost Center
                  <select
                    value={editForm.receiving_cost_center_id}
                    onChange={(event) => setEditForm((current) => ({ ...current, receiving_cost_center_id: event.target.value }))}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Select cost center</option>
                    {receivingCostCenterOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2 xl:col-span-3">
                  Remarks
                  <input
                    value={editForm.remarks}
                    onChange={(event) => setEditForm((current) => ({ ...current, remarks: event.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
              </div>

              <div className="grid gap-3">
                {editForm.lines.map((line, index) => (
                  <div key={line.id} className="grid gap-3 border border-slate-200 bg-slate-50 p-3 md:grid-cols-3 xl:grid-cols-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Line {index + 1} | {materialMap.get(line.material_id)?.material_name || line.material_id}
                    </div>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Qty
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.quantity}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, quantity: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Rate
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.transfer_price}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, transfer_price: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Payment Term
                      <select
                        value={line.payment_term_id}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, payment_term_id: event.target.value } : entry),
                          }))
                        }
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
                        value={line.freight_term}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, freight_term: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      >
                        {FREIGHT_TERM_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      GST Terms
                      <select
                        value={line.gst_terms}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, gst_terms: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      >
                        <option value="">Select GST terms</option>
                        {GST_TERM_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      GST Rate (%)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.gst_rate}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, gst_rate: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Expected Delivery
                      <input
                        type="date"
                        value={line.expected_delivery_date}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, expected_delivery_date: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2 xl:col-span-4">
                      Line Remarks
                      <input
                        value={line.remarks}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, remarks: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <div className="grid gap-1 text-xs font-semibold text-slate-700 xl:col-span-4">
                      <span>Has Rebate</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEditForm((current) => ({
                              ...current,
                              lines: current.lines.map((entry) =>
                                entry.id === line.id
                                  ? { ...entry, has_rebate: true, rebate_rate_uom_basis: entry.rebate_rate_uom_basis || "BASE_UOM" }
                                  : entry
                              ),
                            }))
                          }
                          className={`px-3 py-2 text-xs font-semibold ${
                            line.has_rebate
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
                              lines: current.lines.map((entry) =>
                                entry.id === line.id
                                  ? { ...entry, has_rebate: false, rebate_rate: "", rebate_rate_uom_basis: "BASE_UOM", rebate_remarks: "" }
                                  : entry
                              ),
                            }))
                          }
                          className={`px-3 py-2 text-xs font-semibold ${
                            !line.has_rebate
                              ? "border border-slate-700 bg-slate-200 text-slate-950"
                              : "border border-slate-300 bg-white text-slate-700"
                          }`}
                        >
                          No
                        </button>
                      </div>
                    </div>
                    {line.has_rebate ? (
                      <>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700">
                          Rebate Rate
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={line.rebate_rate}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, rebate_rate: event.target.value } : entry),
                              }))
                            }
                            className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700">
                          Basis
                          <select
                            value={line.rebate_rate_uom_basis}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, rebate_rate_uom_basis: event.target.value } : entry),
                              }))
                            }
                            className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                          >
                            {REBATE_BASIS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2 xl:col-span-2">
                          Rebate Remarks
                          <input
                            value={line.rebate_remarks}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, rebate_remarks: event.target.value } : entry),
                              }))
                            }
                            className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
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
              <h2 className="text-sm font-semibold text-slate-900">Amend Stock Transfer Order</h2>
              <button type="button" onClick={() => setAmendmentOpen(false)} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Quantity and rate amendments require approval.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
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
                  <div key={line.id} className="grid gap-3 border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Line {index + 1} | {materialMap.get(line.material_id)?.material_name || line.material_id}
                    </div>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Qty
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.quantity}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, quantity: event.target.value } : entry),
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
                        value={line.transfer_price}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, transfer_price: event.target.value } : entry),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Expected Delivery Date
                      <input
                        type="date"
                        value={line.expected_delivery_date}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, expected_delivery_date: event.target.value } : entry),
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
