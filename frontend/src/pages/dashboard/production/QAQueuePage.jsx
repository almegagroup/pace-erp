/*
 * File-ID: 27.FE-PR16
 * File-Path: frontend/src/pages/dashboard/production/QAQueuePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: QA Approval Queue rebuilt as the locked inline expandable queue for PR16.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import { useMenu } from "../../../context/useMenu.js";
import {
  getProcessOrder,
  listBatchNumbers,
  listProcessOrders,
  managerApproveProcessOrder,
  qaApproveProcessOrder,
  qaRejectProcessOrder,
  startBatch,
} from "./prodApi.js";

const ERROR_MESSAGES = {
  PROD_PO_NOT_FOUND: "Process Order not found.",
  PROD_PO_QA_NOT_ALLOWED: "QA action is only allowed for STANDARD status orders.",
  PROD_QA_REJECT_REASON_MISSING: "Rejection reason is required.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
  PROD_BATCH_SERIES_NOT_FOUND: "Batch number series not configured for this company/type.",
  PROD_BATCH_RELEASED_AVAILABLE: "Released batch numbers are available. Pick one or skip to generate new.",
  PROD_BATCH_NUMBER_RELEASE_NOT_FOUND: "The selected released batch number is no longer available.",
};

function friendlyError(error) {
  return ERROR_MESSAGES[error?.code] ?? ERROR_MESSAGES[error?.message] ?? error?.message ?? "Action failed.";
}

function materialLabel(material) {
  return [material?.pace_code, material?.material_name].filter(Boolean).join(" - ");
}

function machineLabel(machine) {
  return [machine?.machine_code, machine?.machine_name].filter(Boolean).join(" - ");
}

// §131.1/§120: MTS and MTEST skip the QA_APPROVED gate entirely — Start Batch accepts
// them directly from STANDARD, so this page must offer Start Batch there instead of
// Approve/Reject (which the backend now rejects for these two po_types at STANDARD).
function skipsQaApproval(poType) {
  return poType === "MTS" || poType === "MTEST";
}

function statusTone(status) {
  if (status === "STANDARD") return "bg-amber-100 text-amber-800";
  if (status === "QA_APPROVED") return "bg-sky-100 text-sky-700";
  if (status === "BATCH_STARTED") return "bg-emerald-100 text-emerald-700";
  if (status === "CANCELLED") return "bg-slate-100 text-slate-500";
  return "bg-slate-100 text-slate-600";
}

export default function QAQueuePage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejectOrderId, setRejectOrderId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [startBatchOrder, setStartBatchOrder] = useState(null);
  // §136 (2026-09-04) -- Normal/Urgent choice at QA Approve time, per order
  // (only meaningful before that order is actually approved).
  const [priorityByOrderId, setPriorityByOrderId] = useState({});

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const queueQ = useQuery({
    queryKey: ["qa-queue", effectiveCompanyId],
    queryFn: () => listProcessOrders({
      company_id: effectiveCompanyId || undefined,
      po_type_in: "MTO,HPS,MTS,MTEST",
      per_page: 100,
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    refetchInterval: 30000,
  });

  const detailQ = useQuery({
    queryKey: ["qa-queue-detail", expandedOrderId],
    queryFn: () => getProcessOrder(expandedOrderId),
    enabled: Boolean(expandedOrderId),
  });

  const releasedBatchQ = useQuery({
    queryKey: ["qa-queue-released-batches", startBatchOrder?.company_id, startBatchOrder?.po_type],
    queryFn: () => listBatchNumbers({
      company_id: startBatchOrder?.company_id,
      po_type: startBatchOrder?.po_type,
      status: "RELEASED",
    }),
    enabled: Boolean(startBatchOrder?.company_id && startBatchOrder?.po_type),
  });

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  async function handleApprove(orderId) {
    setSaving(true);
    try {
      const priority = priorityByOrderId[orderId] || "NORMAL";
      await qaApproveProcessOrder(orderId, { priority });
      toast(priority === "URGENT" ? "Process Order approved by QA — Urgent, Manager Approval required before Start Batch." : "Process Order approved by QA.");
      qc.invalidateQueries({ queryKey: ["qa-queue"] });
      qc.invalidateQueries({ queryKey: ["qa-queue-detail", orderId] });
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  // §136 (2026-09-04) -- Urgent-only gate between QA_APPROVED and Start Batch.
  // Access is role-level ACL (CAP_QA_PLANTHEAD/CAP_QA_TIER_L3MGR), enforced
  // server-side — this button is always shown for an Urgent QA_APPROVED
  // order and the backend rejects if the caller lacks the capability.
  async function handleManagerApprove(orderId) {
    setSaving(true);
    try {
      await managerApproveProcessOrder(orderId);
      toast("Manager Approval recorded — Start Batch is now available.");
      qc.invalidateQueries({ queryKey: ["qa-queue"] });
      qc.invalidateQueries({ queryKey: ["qa-queue-detail", orderId] });
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!rejectOrderId) return;
    if (!rejectReason.trim()) {
      toast("Rejection reason is required.", "error");
      return;
    }
    setSaving(true);
    try {
      await qaRejectProcessOrder(rejectOrderId, { reason: rejectReason.trim() });
      toast("Process Order rejected.");
      setRejectOrderId("");
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["qa-queue"] });
      qc.invalidateQueries({ queryKey: ["qa-queue-detail", rejectOrderId] });
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartBatch(order, batchNumberInstanceId) {
    setSaving(true);
    try {
      const result = await startBatch(
        order.id,
        batchNumberInstanceId ? { batch_number_instance_id: batchNumberInstanceId } : { skip_released_batch: true },
        order.po_type,
      );
      toast(`Batch ${result?.batch_number ?? "—"} started for ${order.po_number ?? "Process PO"}.`);
      setStartBatchOrder(null);
      qc.invalidateQueries({ queryKey: ["qa-queue"] });
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["qa-queue-detail", order.id] });
      qc.invalidateQueries({ queryKey: ["qa-queue-released-batches", order.company_id, order.po_type] });
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  const queue = useMemo(() => {
    const rows = [...(queueQ.data ?? [])];
    rows.sort((left, right) => {
      const leftRank = left.status === "STANDARD" ? 0 : 1;
      const rightRank = right.status === "STANDARD" ? 0 : 1;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime();
    });
    return rows;
  }, [queueQ.data]);

  const filteredQueue = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter((order) => [
      order.po_number, order.batch_number, materialLabel(order.material),
      order.stroke_number, machineLabel(order.machine), order.planned_qty,
      order.created_by_display, order.status,
    ].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [queue, search]);

  const detailLines = detailQ.data?.lines ?? [];
  const releasedBatches = releasedBatchQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="QA Queue - PR16"
      subtitle="Inline expandable Process PO queue for QA approval and batch start"
    >
      <ErpSectionCard title="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[260px] flex-col gap-1">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => {
                setCompanyId(value);
                setExpandedOrderId("");
              }}
              label="Company"
              hint=""
            />
          </div>
          <div className="min-w-[280px] flex-1">
            <QuickFilterInput
              label="Quick Search"
              value={search}
              onChange={setSearch}
              placeholder="Search PO number, batch, prodshade, stroke, machine, status..."
              hint="Matches any column in the queue below."
            />
          </div>
          <div className="pb-1 text-xs text-slate-400">Auto-refreshes every 30 seconds</div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Queue (${filteredQueue.length}${filteredQueue.length !== queue.length ? ` of ${queue.length}` : ""})`}>
        {!effectiveCompanyId ? (
          <p className="py-8 text-center text-sm text-slate-400">Select a company to view the QA queue.</p>
        ) : queueQ.isLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
        ) : queue.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No MTO/HPS/MTS/MTEST Process Orders found for this queue.</p>
        ) : filteredQueue.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No rows match this search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <th className="border-b px-3 py-2 text-left">PO Number</th>
                  <th className="border-b px-3 py-2 text-left">Batch #</th>
                  <th className="border-b px-3 py-2 text-left">Prodshade</th>
                  <th className="border-b px-3 py-2 text-left">Stroke</th>
                  <th className="border-b px-3 py-2 text-left">Machine</th>
                  <th className="border-b px-3 py-2 text-right">Target Qty</th>
                  <th className="border-b px-3 py-2 text-left">Created By</th>
                  <th className="border-b px-3 py-2 text-left">Status</th>
                  <th className="border-b px-3 py-2 text-left">Priority</th>
                  <th className="border-b px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map((order) => {
                  const expanded = expandedOrderId === order.id;
                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-sky-50"
                        onClick={() => setExpandedOrderId((current) => current === order.id ? "" : order.id)}
                      >
                        <td className="px-3 py-2 font-mono font-semibold text-sky-700">{order.po_number ?? "--"}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{order.batch_number ?? "—"}</td>
                        <td className="px-3 py-2">{materialLabel(order.material) || "--"}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{order.stroke_number ?? "--"}</td>
                        <td className="px-3 py-2">{machineLabel(order.machine) || "--"}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(order.planned_qty ?? 0).toFixed(3)}</td>
                        <td className="px-3 py-2">{order.created_by_display ?? "--"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${statusTone(order.status)}`}>
                            {order.status ?? "--"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {order.status === "STANDARD" && !skipsQaApproval(order.po_type) ? (
                            <select
                              value={priorityByOrderId[order.id] || "NORMAL"}
                              onChange={(event) => {
                                event.stopPropagation();
                                setPriorityByOrderId((current) => ({ ...current, [order.id]: event.target.value }));
                              }}
                              onClick={(event) => event.stopPropagation()}
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="NORMAL">Normal</option>
                              <option value="URGENT">Urgent</option>
                            </select>
                          ) : order.priority === "URGENT" ? (
                            <span className="inline-flex rounded bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">Urgent</span>
                          ) : (
                            <span className="text-xs text-slate-400">Normal</span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex justify-end gap-2">
                            {order.status === "STANDARD" && !skipsQaApproval(order.po_type) && (
                              <>
                                <button
                                  onClick={() => handleApprove(order.id)}
                                  disabled={saving}
                                  className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectOrderId(order.id);
                                    setRejectReason("");
                                  }}
                                  disabled={saving}
                                  className="rounded border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {/* §136 (2026-09-04) -- Urgent-only gate; Start Batch stays hidden
                                for this status+priority combo until Manager Approval clears it. */}
                            {order.status === "QA_APPROVED" && order.priority === "URGENT" && (
                              <button
                                onClick={() => handleManagerApprove(order.id)}
                                disabled={saving}
                                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                              >
                                Manager Approve
                              </button>
                            )}
                            {order.status === "STANDARD" && skipsQaApproval(order.po_type) && (
                              <>
                                <button
                                  onClick={() => setStartBatchOrder(order)}
                                  disabled={saving}
                                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  Start Batch
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectOrderId(order.id);
                                    setRejectReason("");
                                  }}
                                  disabled={saving}
                                  className="rounded border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                            {/* §136 -- Start Batch for QA_APPROVED only when NOT Urgent;
                                an Urgent order must clear MANAGER_APPROVED first. */}
                            {order.status === "QA_APPROVED" && order.priority !== "URGENT" && (
                              <button
                                onClick={() => setStartBatchOrder(order)}
                                disabled={saving}
                                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Start Batch
                              </button>
                            )}
                            {order.status === "MANAGER_APPROVED" && (
                              <button
                                onClick={() => setStartBatchOrder(order)}
                                disabled={saving}
                                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Start Batch
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={10} className="px-4 py-4">
                            {detailQ.isLoading ? (
                              <p className="text-sm text-slate-500">Loading line details...</p>
                            ) : detailQ.data?.id !== order.id ? (
                              <p className="text-sm text-slate-400">Select a row to load its component grid.</p>
                            ) : (
                              <div className="rounded border border-slate-200 bg-white">
                                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                                  Component Grid
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full min-w-[920px] border-collapse text-sm">
                                    <thead>
                                      <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                        <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                                        <th className="border-b px-3 py-2 text-right">Dosage%</th>
                                        <th className="border-b px-3 py-2 text-left">Actual Material</th>
                                        <th className="border-b px-3 py-2 text-right">Dosage%</th>
                                        <th className="border-b px-3 py-2 text-right">Planned Qty</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detailLines.map((line) => (
                                        <tr key={line.id} className="border-b border-slate-100">
                                          <td className="px-3 py-2">{materialLabel(line.material) || "--"}</td>
                                          <td className="px-3 py-2 text-right font-mono">{Number(line.dosage_pct ?? 0).toFixed(3)}</td>
                                          <td className="px-3 py-2">{materialLabel(line.actual_material) || materialLabel(line.material) || "--"}</td>
                                          <td className="px-3 py-2 text-right font-mono">{Number(line.dosage_pct ?? 0).toFixed(3)}</td>
                                          <td className="px-3 py-2 text-right font-mono">{Number(line.planned_qty ?? 0).toFixed(3)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>

      <ModalBase
        visible={Boolean(rejectOrderId)}
        title="Reject Process PO"
        onEscape={() => {
          setRejectOrderId("");
          setRejectReason("");
        }}
        actions={(
          <>
            <button
              onClick={() => {
                setRejectOrderId("");
                setRejectReason("");
              }}
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600"
            >
              Cancel
            </button>
            <button
              onClick={handleReject}
              disabled={saving || !rejectReason.trim()}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Confirm Reject
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-rose-600">
            Reason <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={4}
            className="resize-none rounded border border-rose-300 px-3 py-2 text-sm"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Explain why this Process PO is being rejected..."
          />
        </div>
      </ModalBase>

      <ModalBase
        visible={Boolean(startBatchOrder)}
        title="Start Batch"
        onEscape={() => setStartBatchOrder(null)}
        width="min(560px, calc(100vw - 32px))"
        actions={(
          <button
            onClick={() => setStartBatchOrder(null)}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600"
          >
            Close
          </button>
        )}
      >
        {startBatchOrder && (
          <div className="flex flex-col gap-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {releasedBatchQ.isLoading
                ? "Checking released batch numbers..."
                : releasedBatches.length > 0
                  ? "Released batch numbers are available for this Company + PO Type. Pick one or skip to auto-generate."
                  : "No released batch numbers are available. Generate a new one."}
            </div>

            {releasedBatches.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="border-b px-3 py-2 text-left">Batch Number</th>
                      <th className="border-b px-3 py-2 text-left">PO Type</th>
                      <th className="border-b px-3 py-2 text-left">Voided Date</th>
                      <th className="border-b px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {releasedBatches.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-mono">{row.batch_number ?? "--"}</td>
                        <td className="px-3 py-2">{row.po_type ?? "--"}</td>
                        <td className="px-3 py-2">{row.voided_date ? String(row.voided_date).slice(0, 16).replace("T", " ") : "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleStartBatch(startBatchOrder, row.id)}
                            disabled={saving}
                            className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            Use This Batch
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => handleStartBatch(startBatchOrder, null)}
                disabled={saving}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Skip, Generate New
              </button>
            </div>
          </div>
        )}
      </ModalBase>
    </ErpScreenScaffold>
  );
}
