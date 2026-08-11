/*
 * File-ID: 27.FE-PR17
 * File-Path: frontend/src/pages/dashboard/production/BatchNumberReleasePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Real PR17 Batch Number Release page for VOIDED -> RELEASED lifecycle.
 * Authority: Frontend
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { listBatchNumbers, releaseBatchNumber } from "./prodApi.js";

function materialLabel(material) {
  return [material?.pace_code, material?.material_name].filter(Boolean).join(" - ");
}

function machineLabel(machine) {
  return [machine?.machine_code, machine?.machine_name].filter(Boolean).join(" - ");
}

export default function BatchNumberReleasePage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [selectedRowId, setSelectedRowId] = useState("");
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [releasing, setReleasing] = useState(false);

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const batchNumbersQ = useQuery({
    queryKey: ["batch-number-release", effectiveCompanyId],
    queryFn: () => listBatchNumbers({ company_id: effectiveCompanyId || undefined }),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    enabled: Boolean(effectiveCompanyId),
    refetchInterval: 30000,
  });

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  async function handleRelease() {
    if (!selectedRowId || !releaseReason.trim()) return;
    setReleasing(true);
    try {
      await releaseBatchNumber(selectedRowId, { reason: releaseReason.trim() });
      toast("Batch number released.");
      setReleaseModalOpen(false);
      setSelectedRowId("");
      setReleaseReason("");
      qc.invalidateQueries({ queryKey: ["batch-number-release"] });
    } catch (error) {
      toast(error.message || "Batch number release failed.", "error");
    } finally {
      setReleasing(false);
    }
  }

  const rows = (batchNumbersQ.data ?? []).filter((row) => row.status === "VOIDED" || row.status === "RELEASED");

  return (
    <ErpScreenScaffold
      title="Batch Number Release - PR17"
      subtitle="Release VOIDED batch numbers so they can be reused at Start Batch"
    >
      <ErpSectionCard title="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[260px] flex-col gap-1">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(value) => {
                setCompanyId(value);
                setSelectedRowId("");
                setReleaseModalOpen(false);
              }}
              label="Company"
              hint=""
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Batch Numbers (${rows.length})`}>
        {!effectiveCompanyId ? (
          <p className="py-8 text-center text-sm text-slate-400">Select a company to view batch numbers.</p>
        ) : batchNumbersQ.isLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No VOIDED or RELEASED batch numbers found for this company.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">Batch Number</th>
                    <th className="border-b px-3 py-2 text-left">PO Type</th>
                    <th className="border-b px-3 py-2 text-left">Voided Date</th>
                    <th className="border-b px-3 py-2 text-left">Previous Prodshade</th>
                    <th className="border-b px-3 py-2 text-left">Previous Stroke</th>
                    <th className="border-b px-3 py-2 text-left">Machine Name</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                    <th className="border-b px-3 py-2 text-left">Released By</th>
                    <th className="border-b px-3 py-2 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const selectable = row.status === "VOIDED";
                    const selected = selectedRowId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`${selectable ? "cursor-pointer hover:bg-sky-50" : ""} ${selected ? "bg-sky-50" : "border-b border-slate-100"}`}
                        onClick={() => {
                          if (selectable) setSelectedRowId(row.id);
                        }}
                      >
                        <td className="px-3 py-2 font-mono">{row.batch_number ?? "--"}</td>
                        <td className="px-3 py-2">{row.po_type ?? "--"}</td>
                        <td className="px-3 py-2">{row.voided_date ? String(row.voided_date).slice(0, 16).replace("T", " ") : "--"}</td>
                        <td className="px-3 py-2">{materialLabel(row.previous_prodshade) || "--"}</td>
                        <td className="px-3 py-2 font-mono">{row.previous_stroke_number ?? "--"}</td>
                        <td className="px-3 py-2">{machineLabel(row.machine) || "--"}</td>
                        <td className="px-3 py-2">{row.status ?? "--"}</td>
                        <td className="px-3 py-2">{row.released_by_display ?? "--"}</td>
                        <td className="px-3 py-2">{row.reason ?? "--"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setReleaseModalOpen(true)}
                disabled={!selectedRowId}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                Release
              </button>
            </div>
          </div>
        )}
      </ErpSectionCard>

      <ModalBase
        visible={releaseModalOpen && Boolean(selectedRowId)}
        title="Release Batch Number"
        onEscape={() => {
          setReleaseModalOpen(false);
          setReleaseReason("");
        }}
        actions={(
          <>
            <button
              onClick={() => {
                setReleaseModalOpen(false);
                setReleaseReason("");
              }}
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600"
            >
              Cancel
            </button>
            <button
              onClick={handleRelease}
              disabled={releasing || !releaseReason.trim()}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Confirm Release
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-600">
            Reason <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={4}
            className="resize-none rounded border border-slate-300 px-3 py-2 text-sm"
            value={releaseReason}
            onChange={(event) => setReleaseReason(event.target.value)}
            placeholder="Enter the reason for releasing this batch number..."
          />
        </div>
      </ModalBase>
    </ErpScreenScaffold>
  );
}
