import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import {
  approveSTO,
  cancelSTO,
  closeSTO,
  confirmSTO,
  confirmSTOReceipt,
  dispatchSTO,
  getSTO,
  rejectSTO,
  updateGateExitWeight,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";
import { useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

const STO_APPROVER_ROLES = new Set(["SA", "GA", "DIRECTOR", "L4_MANAGER", "L3_MANAGER", "L2_MANAGER"]);

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

export default function STODetailPage() {
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" ? routeId : (screenContext.id || "");
  const { runtimeContext, shellProfile } = useMenu();
  const [tareWeight, setTareWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailQuery = useQuery({
    queryKey: ["procurement", "sto-detail", id],
    queryFn: () => getSTO(id),
    enabled: Boolean(id),
  });
  const materialQuery = useMaterialOptionsQuery({ limit: 200, offset: 0 });
  const detail = detailQuery.data ?? null;
  const materials = materialQuery.materials;
  const loading = detailQuery.isLoading || materialQuery.isLoading;

  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";
  const canApprove = STO_APPROVER_ROLES.has(shellProfile?.roleCode);
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const companyMap = useMemo(
    () => new Map((runtimeContext?.availableCompanies ?? []).map((entry) => [entry.id, entry])),
    [runtimeContext?.availableCompanies]
  );
  const latestDc = Array.isArray(detail?.delivery_challans) ? detail.delivery_challans[0] : null;
  const latestGateExit = Array.isArray(detail?.gate_exit_outbound) ? detail.gate_exit_outbound[0] : null;
  const canConfirmForApproval = String(detail?.status || "").toUpperCase() === "DRAFT";
  const canConfirmReceipt =
    String(detail?.status || "").toUpperCase() === "DISPATCHED" &&
    String(selectedCompanyId || "") === String(detail?.receiving_company_id || "");
  const canClose = String(detail?.status || "").toUpperCase() === "RECEIVED";
  const canCancel = ["DRAFT", "PENDING_APPROVAL", "CREATED"].includes(String(detail?.status || "").toUpperCase());
  const canDispatch = String(detail?.status || "").toUpperCase() === "CREATED";
  const canReject = String(detail?.status || "").toUpperCase() === "PENDING_APPROVAL" && canApprove;
  const canApproveSto = canReject;
  const showTareForm =
    String(detail?.status || "").toUpperCase() === "DISPATCHED" &&
    isBulkLike(detail?.sto_type) &&
    latestGateExit;

  useEffect(() => {
    setError(detailQuery.error?.message || materialQuery.error?.message || "");
  }, [detailQuery.error, materialQuery.error]);

  useEffect(() => {
    setTareWeight(String(detail?.gate_exit_outbound?.[0]?.tare_weight ?? ""));
  }, [detail?.gate_exit_outbound]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await detailQuery.refetch();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_STO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleDispatch() {
    if (!detail) {
      return;
    }
    const lineMessages = (detail.lines ?? []).map((line) => {
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
    await runAction(
      () => dispatchSTO(detail.id, {}),
      "STO dispatched successfully."
    );
  }

  async function handleCancel() {
    if (!detail) {
      return;
    }
    const reason = await openActionPrompt({ eyebrow: "STO", title: "Cancel this STO?", label: "Cancellation reason", required: true });
    if (!reason) return;
    await runAction(
      () => cancelSTO(detail.id, { cancellation_reason: reason }),
      "STO cancelled."
    );
  }

  async function handleConfirmForApproval() {
    if (!detail) return;
    await runAction(
      () => confirmSTO(detail.id, { approval_required: true }),
      "STO moved for approval."
    );
  }

  async function handleApprove() {
    if (!detail) return;
    const remarks = (await openActionPrompt({
      eyebrow: "STO",
      title: "Approve this STO?",
      label: "Remarks (optional)",
      placeholder: "Optional approval remarks",
    })) ?? "";
    await runAction(
      () => approveSTO(detail.id, { remarks }),
      "STO approved."
    );
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
    await runAction(
      () => rejectSTO(detail.id, { remarks }),
      "STO rejected and sent back to draft."
    );
  }

  async function handleConfirmReceipt() {
    if (!detail) return;
    const confirmed = await openActionConfirm({ eyebrow: "STO", title: "Confirm receipt?", message: "Confirm receipt for this dispatched STO.", confirmLabel: "Confirm Receipt" });
    if (!confirmed) return;
    await runAction(
      () => confirmSTOReceipt(detail.id),
      "STO receipt confirmed."
    );
  }

  async function handleClose() {
    if (!detail) return;
    const confirmed = await openActionConfirm({ eyebrow: "STO", title: "Close this STO?", message: "This STO will be marked as closed.", confirmLabel: "Close STO" });
    if (!confirmed) return;
    await runAction(
      () => closeSTO(detail.id),
      "STO closed."
    );
  }

  async function handleSaveTareWeight() {
    if (!latestGateExit?.id || !tareWeight) {
      setError("Tare weight is required.");
      return;
    }
    await runAction(
      () => updateGateExitWeight(latestGateExit.id, { tare_weight: Number(tareWeight) }),
      "Tare weight updated."
    );
  }

  const dispatchSummary = useMemo(() => {
    if (!latestDc && !latestGateExit) {
      return [];
    }
    return [
      latestDc?.dc_number
        ? `Delivery Challan ${latestDc.dc_number} auto-generated.`
        : null,
      latestGateExit?.exit_number
        ? `Gate Exit ${latestGateExit.exit_number} created.`
        : null,
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
        ...(canConfirmForApproval
          ? [{ key: "confirm", label: saving ? "Sending..." : "Confirm STO", tone: "primary", onClick: () => void handleConfirmForApproval(), disabled: saving }]
          : []),
        ...(canApproveSto
          ? [{ key: "approve", label: saving ? "Approving..." : "Approve STO", tone: "primary", onClick: () => void handleApprove(), disabled: saving }]
          : []),
        ...(canReject
          ? [{ key: "reject", label: "Reject STO", tone: "danger", onClick: () => void handleReject(), disabled: saving }]
          : []),
        ...(canDispatch
          ? [{ key: "dispatch", label: saving ? "Dispatching..." : "Dispatch", tone: "primary", onClick: () => void handleDispatch(), disabled: saving }]
          : []),
        ...(canConfirmReceipt
          ? [{ key: "confirm-receipt", label: saving ? "Confirming..." : "Confirm Receipt", tone: "primary", onClick: () => void handleConfirmReceipt(), disabled: saving }]
          : []),
        ...(canClose
          ? [{ key: "close", label: saving ? "Closing..." : "Close STO", tone: "neutral", onClick: () => void handleClose(), disabled: saving }]
          : []),
        ...(canCancel
          ? [{ key: "cancel", label: "Cancel", tone: "danger", onClick: () => void handleCancel(), disabled: saving }]
          : []),
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
                { key: "dispatched_qty", label: "Issued Qty", width: "110px", render: (row) => row.dispatched_qty ?? "—" },
                { key: "received_qty", label: "Received Qty", width: "110px", render: (row) => row.received_qty ?? "—" },
                { key: "balance_qty", label: "Balance Qty", width: "110px", render: (row) => row.balance_qty ?? "—" },
                { key: "available_qty", label: "Available Stock", width: "120px", render: (row) => row.available_qty ?? "—" },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No STO lines found."
            />
          </ErpSectionCard>

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
    </ErpScreenScaffold>
  );
}
