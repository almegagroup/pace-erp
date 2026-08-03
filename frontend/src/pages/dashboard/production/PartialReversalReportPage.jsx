/*
 * File-ID: 27.FE-PR20
 * File-Path: frontend/src/pages/dashboard/production/PartialReversalReportPage.jsx
 * Gate: 27.19
 * Domain: PRODUCTION
 * Purpose: PR20 Partial Reversal Report — read-only, CSN-tracker-style
 *          expandable list of every PR19 Partial Batch Reversal transaction.
 * Authority: Frontend
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { listPartialBatchReversals, getPartialBatchReversal } from "./prodApi.js";

const PO_TYPES = ["MTO", "HPS"];

function materialLabel(m) {
  if (!m) return "--";
  return [m.pace_code || m.external_code, m.material_name].filter(Boolean).join(" - ");
}
function fmt(n) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toFixed(3) : "0.000";
}
function fmtDate(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--" : d.toLocaleString();
}

function ReversalDetailRows({ id }) {
  const detailQ = useQuery({
    queryKey: ["pr20-detail", id],
    queryFn: () => getPartialBatchReversal(id),
    enabled: Boolean(id),
  });

  if (detailQ.isLoading) {
    return (
      <tr><td colSpan={8} className="py-3 px-3 text-center text-sm text-slate-400">Loading detail...</td></tr>
    );
  }
  const detail = detailQ.data;
  if (!detail) return null;

  return (
    <tr>
      <td colSpan={8} className="bg-slate-50/70 px-3 py-3">
        <div className="mb-3 grid gap-3 md:grid-cols-4 text-xs">
          <div><span className="block text-slate-400">Source Process PO</span><p className="font-mono">{detail.source_process_order?.po_number || "--"}</p></div>
          <div><span className="block text-slate-400">Selected Packing PO</span><p className="font-mono">{detail.selected_packing_order?.po_number || "--"}</p></div>
          <div><span className="block text-slate-400">Salvage Batch</span><p className="font-mono">{detail.salvage_batch_number || "--"} {detail.salvage_process_order ? `(${detail.salvage_process_order.po_number})` : ""}</p></div>
          <div><span className="block text-slate-400">Created By</span><p>{detail.created_by_display || "--"}</p></div>
        </div>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left py-2 px-3 uppercase text-slate-500">#</th>
                <th className="text-left py-2 px-3 uppercase text-slate-500">Line Type</th>
                <th className="text-left py-2 px-3 uppercase text-slate-500">Material</th>
                <th className="text-left py-2 px-3 uppercase text-slate-500">Included</th>
                <th className="text-right py-2 px-3 uppercase text-slate-500">Qty</th>
                <th className="text-left py-2 px-3 uppercase text-slate-500">Movement</th>
                <th className="text-left py-2 px-3 uppercase text-slate-500">Direction</th>
                <th className="text-left py-2 px-3 uppercase text-slate-500">Storage Location</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines ?? []).map((line) => (
                <tr key={line.id} className="border-t">
                  <td className="py-1.5 px-3">{line.display_order}</td>
                  <td className="py-1.5 px-3">{line.line_type}</td>
                  <td className="py-1.5 px-3">{materialLabel(line.material)}</td>
                  <td className="py-1.5 px-3">{line.included ? "Yes" : "No (excluded)"}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{fmt(line.qty)} {line.uom_code}</td>
                  <td className="py-1.5 px-3 font-mono">{line.movement_type_code || "--"}</td>
                  <td className="py-1.5 px-3">{line.direction || "--"}</td>
                  <td className="py-1.5 px-3">{line.storage_location?.location_code || "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

export default function PartialReversalReportPage() {
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expandedId, setExpandedId] = useState("");

  const { runtimeContext } = useMenu();
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const listQ = useQuery({
    queryKey: ["partial-batch-reversals", effectiveCompanyId, poType, batchNumber],
    queryFn: () => listPartialBatchReversals({
      company_id: effectiveCompanyId, po_type: poType || undefined, batch_number: batchNumber || undefined,
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });

  function toggleExpand(id) {
    setExpandedId((prev) => (prev === id ? "" : id));
  }

  return (
    <ErpScreenScaffold title="Partial Reversal Report - PR20" subtitle="Read-only list of all Partial Batch Reversal transactions">
      <ErpSectionCard title="Filters">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(v) => { setCompanyId(v); setExpandedId(""); }}
              label="Company"
              hint=""
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">PO Type</label>
            <ErpComboboxField
              value={poType}
              onChange={setPoType}
              options={PO_TYPES.map((t) => ({ value: t, label: t }))}
              placeholder="-- All --"
              disabled={!effectiveCompanyId}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Batch Number</label>
            <input
              className="h-9 rounded border border-slate-300 px-2 text-sm"
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="Filter by batch number"
              disabled={!effectiveCompanyId}
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title="Reversal Transactions">
        {!effectiveCompanyId ? (
          <p className="py-4 text-center text-sm text-slate-400">Select a company to view reversals.</p>
        ) : listQ.isLoading ? (
          <p className="py-4 text-center text-sm text-slate-400">Loading...</p>
        ) : (listQ.data ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No partial batch reversals found.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="py-2 px-3"></th>
                  <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Document #</th>
                  <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Batch #</th>
                  <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Row Type</th>
                  <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Material</th>
                  <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Reverse Qty</th>
                  <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Ratio</th>
                  <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Posted</th>
                </tr>
              </thead>
              <tbody>
                {(listQ.data ?? []).map((row) => (
                  <React.Fragment key={row.id}>
                    <tr className="border-t cursor-pointer hover:bg-slate-50" onClick={() => toggleExpand(row.id)}>
                      <td className="py-2 px-3 text-slate-400">{expandedId === row.id ? "▲" : "▼"}</td>
                      <td className="py-2 px-3 font-mono font-semibold text-sky-700">{row.document_number}</td>
                      <td className="py-2 px-3 font-mono">{row.source_batch_number}</td>
                      <td className="py-2 px-3">{row.selected_row_type === "SFG" ? "SFG" : "FG (SKU)"}</td>
                      <td className="py-2 px-3">{materialLabel(row.selected_material)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(row.reverse_qty)}</td>
                      <td className="py-2 px-3 text-right font-mono">{(Number(row.reversal_ratio ?? 0) * 100).toFixed(2)}%</td>
                      <td className="py-2 px-3">{fmtDate(row.created_at)}</td>
                    </tr>
                    {expandedId === row.id ? <ReversalDetailRows id={row.id} /> : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
