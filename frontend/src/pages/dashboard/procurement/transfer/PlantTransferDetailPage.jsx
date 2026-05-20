/*
 * File-ID: 23.5
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: View and action plant transfer order detail
 * Authority: Frontend
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  approvePTO,
  cancelPTO,
  getPTO,
  issueTransfer,
  oneStepTransfer,
  receiveTransfer,
} from "../procurementApi.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "APPROVED":
      return "sky";
    case "ISSUED":
    case "IN_TRANSIT":
      return "violet";
    case "CLOSED":
      return "emerald";
    case "CANCELLED":
      return "rose";
    case "DRAFT":
    default:
      return "amber";
  }
}

function transferTypeTone(transferType) {
  return String(transferType || "").toUpperCase() === "TWO_STEP" ? "violet" : "sky";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : "—";
}

export default function PlantTransferDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useMenu();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actualReceiptDate, setActualReceiptDate] = useState(todayIsoDate());

  const loadDetail = useCallback(async () => {
    if (!id) {
      setDetail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getPTO(id);
      setDetail(data);
      setActualReceiptDate(String(data?.actual_receipt_date || todayIsoDate()));
    } catch (loadError) {
      setDetail(null);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PTO_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_PTO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    openScreen(OPERATION_SCREENS.PROC_PLANT_TRANSFER_LIST.screen_code);
    navigate("/dashboard/procurement/transfer");
  }

  async function handleApprove() {
    if (!detail || !window.confirm("Approve this plant transfer order?")) {
      return;
    }
    await runAction(() => approvePTO(detail.id), "Plant transfer order approved.");
  }

  async function handleOneStepTransfer() {
    if (!detail || !window.confirm("Execute this one-step transfer?")) {
      return;
    }
    await runAction(() => oneStepTransfer(detail.id), "One-step transfer posted successfully.");
  }

  async function handleIssue() {
    if (!detail || !window.confirm("Issue stock for this two-step transfer?")) {
      return;
    }
    await runAction(() => issueTransfer(detail.id), "Transfer issued and moved to in-transit.");
  }

  async function handleReceive() {
    if (!detail || !window.confirm("Receive stock for this in-transit transfer?")) {
      return;
    }
    await runAction(
      () => receiveTransfer(detail.id, { actual_receipt_date: actualReceiptDate }),
      "Transfer received successfully.",
    );
  }

  async function handleCancel() {
    if (!detail) {
      return;
    }
    const cancellationReason = window.prompt("Cancellation reason:", "");
    if (cancellationReason === null) {
      return;
    }
    await runAction(
      () => cancelPTO(detail.id, { cancellation_reason: cancellationReason }),
      "Plant transfer order cancelled.",
    );
  }

  const status = String(detail?.status || "").toUpperCase();
  const transferType = String(detail?.transfer_type || "").toUpperCase();
  const canApprove = status === "DRAFT";
  const canOneStepTransfer = status === "APPROVED" && transferType === "ONE_STEP";
  const canIssue = status === "APPROVED" && transferType === "TWO_STEP";
  const canReceive = status === "IN_TRANSIT" && transferType === "TWO_STEP";
  const canCancel = status === "DRAFT" || status === "APPROVED";

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Plant Transfer Detail"
      notices={[
        ...(error ? [{ key: "pto-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "pto-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: goBack },
        ...(canApprove
          ? [{ key: "approve", label: saving ? "Approving..." : "Approve", tone: "primary", onClick: () => void handleApprove(), disabled: saving }]
          : []),
        ...(canOneStepTransfer
          ? [{ key: "one-step", label: saving ? "Executing..." : "Execute Transfer", tone: "primary", onClick: () => void handleOneStepTransfer(), disabled: saving }]
          : []),
        ...(canIssue
          ? [{ key: "issue", label: saving ? "Issuing..." : "Issue Stock", tone: "primary", onClick: () => void handleIssue(), disabled: saving }]
          : []),
        ...(canReceive
          ? [{ key: "receive", label: saving ? "Receiving..." : "Receive Stock", tone: "primary", onClick: () => void handleReceive(), disabled: saving }]
          : []),
        ...(canCancel
          ? [{ key: "cancel", label: "Cancel", tone: "danger", onClick: () => void handleCancel(), disabled: saving }]
          : []),
      ]}
    >
      {loading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading plant transfer detail...
        </div>
      ) : !detail ? (
        <div className="border border-dashed border-rose-300 bg-rose-50 px-4 py-6 text-sm text-rose-700">
          Plant transfer detail is unavailable.
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.pto_number || "Plant Transfer"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
              <ErpFieldPreview label="Transfer Type" value={detail.transfer_type || "—"} tone={transferTypeTone(detail.transfer_type)} />
              <ErpFieldPreview label="Source Plant ID" value={detail.source_plant_id || "—"} />
              <ErpFieldPreview label="Target Plant ID" value={detail.target_plant_id || "—"} />
              <ErpFieldPreview label="Material ID" value={detail.material_id || "—"} />
              <ErpFieldPreview label="Transfer Qty + UOM" value={`${detail.transfer_qty ?? "—"} ${detail.uom_code || ""}`.trim()} />
              <ErpFieldPreview label="Valuation Rate" value={formatNullableNumber(detail.valuation_rate)} />
              <ErpFieldPreview label="Transfer Value" value={formatNullableNumber(detail.transfer_value)} />
              <ErpFieldPreview label="Transfer Price Type" value={detail.transfer_price_type || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Locations" title="Source and target details">
            <div className="grid gap-3 md:grid-cols-2">
              <ErpFieldPreview label="Source Company ID" value={detail.source_company_id || "—"} />
              <ErpFieldPreview label="Target Company ID" value={detail.target_company_id || "—"} />
              <ErpFieldPreview label="Source Plant ID" value={detail.source_plant_id || "—"} />
              <ErpFieldPreview label="Target Plant ID" value={detail.target_plant_id || "—"} />
              <ErpFieldPreview label="Source SLOC ID" value={detail.source_sloc_id || "—"} />
              <ErpFieldPreview label="Target SLOC ID" value={detail.target_sloc_id || "—"} />
              <ErpFieldPreview label="Source GSTIN" value={detail.source_gstin || "—"} />
              <ErpFieldPreview label="Target GSTIN" value={detail.target_gstin || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Transport" title="Transport and logistics">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ErpFieldPreview label="Transport Required" value={detail.transport_required ? "Yes" : "No"} />
              <ErpFieldPreview label="Vehicle Number" value={detail.vehicle_number || "—"} />
              <ErpFieldPreview label="Transporter Name" value={detail.transporter_name || "—"} />
              <ErpFieldPreview label="LR Number" value={detail.lr_number || "—"} />
              <ErpFieldPreview label="Expected Dispatch Date" value={detail.expected_dispatch_date || "—"} />
              <ErpFieldPreview label="Expected Receipt Date" value={detail.expected_receipt_date || "—"} />
              <ErpFieldPreview label="E-way Bill Reference" value={detail.eway_bill_reference || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lifecycle" title="Transfer milestones">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ErpFieldPreview label="Approved At" value={detail.approved_at || "—"} />
              <ErpFieldPreview label="Issued At" value={detail.issued_at || "—"} />
              <ErpFieldPreview label="Received At" value={detail.received_at || "—"} />
              <ErpFieldPreview label="Actual Receipt Date" value={detail.actual_receipt_date || "—"} />
            </div>
            {canReceive ? (
              <div className="mt-4 max-w-xs">
                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Actual Receipt Date
                  <input
                    type="date"
                    value={actualReceiptDate}
                    onChange={(event) => setActualReceiptDate(event.target.value)}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
              </div>
            ) : null}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Remarks" title="Notes">
            <div className="min-h-16 rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              {detail.remarks || "—"}
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
