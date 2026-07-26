/*
 * File-ID: 27.FE-PR15
 * File-Path: frontend/src/pages/dashboard/production/ReversalPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: CORS full reversal for Process PO and Packing PO — single PO-number
 *   lookup, auto-detects order type (PO numbers are global per §8, no company
 *   picker or PO dropdown needed), shows the same material-line detail the
 *   Verify/Final pages show, read-only (a full reversal has nothing to edit).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { getPackingOrder, getProcessOrder, listPackingOrders, listProcessOrders, reversePackingOrder, reverseProcessOrder } from "./prodApi.js";

function companyLabel(company) {
  return [company?.company_code, company?.company_name].filter(Boolean).join(" - ");
}

function materialLabel(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}

function slocLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function qtyFmt(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "--";
}

// Same formula the Verify/Final pages use to derive Approved / AP Approved /
// Variance from the stored actual_qty vs planned_qty — reused verbatim here
// so the read-only reversal view shows exactly what was actually posted.
function computeRowValues(row) {
  const planned = Number(row.planned_qty || 0);
  const actual = Number(row.actual_qty || 0);
  const autoYes = Math.abs(actual - planned) < 0.0001;
  const approved = autoYes ? "YES" : (row.approved_status || "YES");
  let apApproved = actual;
  let variance = 0;
  if (!autoYes) {
    if (approved === "NO") {
      apApproved = planned;
      variance = actual - planned;
    } else if (approved === "PARTIAL") {
      apApproved = Number(row.ap_approved_qty || 0);
      variance = actual - apApproved;
    } else {
      apApproved = actual;
    }
  }
  return { planned, actual, autoYes, approved, apApproved, variance };
}

function ProcessLinesReadOnly({ po }) {
  const rows = po.lines ?? [];
  const outputActualQty = rows.reduce((sum, row) => sum + computeRowValues(row).actual, 0);
  const outputApprovedQty = rows.reduce((sum, row) => sum + computeRowValues(row).apApproved, 0);
  const outputVariance = outputActualQty - outputApprovedQty;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Input</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                <th className="border-b px-3 py-2 text-right">Dosage%</th>
                <th className="border-b px-3 py-2 text-left">Actual Material</th>
                <th className="border-b px-3 py-2 text-left">SLoc</th>
                <th className="border-b px-3 py-2 text-right">Std</th>
                <th className="border-b px-3 py-2 text-right">Actual</th>
                <th className="border-b px-3 py-2 text-left">Approved</th>
                <th className="border-b px-3 py-2 text-right">AP Appr</th>
                <th className="border-b px-3 py-2 text-right">Var</th>
                <th className="border-b px-3 py-2 text-left">Mvt</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-400">No lines.</td></tr>
              ) : rows.map((row) => {
                const values = computeRowValues(row);
                return (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{materialLabel(row.material) || "--"}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.dosage_pct == null ? "--" : Number(row.dosage_pct).toFixed(3)}</td>
                    <td className="px-3 py-2">{materialLabel(row.actual_material) || "(same)"}</td>
                    <td className="px-3 py-2">{slocLabel(row.issue_storage_location) || "--"}</td>
                    <td className="px-3 py-2 text-right font-mono">{values.planned.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono">{values.actual.toFixed(3)}</td>
                    <td className="px-3 py-2">{values.approved}</td>
                    <td className="px-3 py-2 text-right font-mono">{values.apApproved.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono">{values.variance.toFixed(3)}</td>
                    <td className="px-3 py-2">P261</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Output</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b px-3 py-2 text-left">Material</th>
                <th className="border-b px-3 py-2 text-right">Std</th>
                <th className="border-b px-3 py-2 text-right">Actual</th>
                <th className="border-b px-3 py-2 text-right">AP Appr</th>
                <th className="border-b px-3 py-2 text-right">Var</th>
                <th className="border-b px-3 py-2 text-left">Mvt</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-slate-100 px-3 py-2">{materialLabel(po.material) || "--"}</td>
                <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{Number(po.planned_qty || 0).toFixed(3)}</td>
                <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{outputActualQty.toFixed(3)}</td>
                <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{outputApprovedQty.toFixed(3)}</td>
                <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{outputVariance.toFixed(3)}</td>
                <td className="border-b border-slate-100 px-3 py-2">P101</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PackingLinesReadOnly({ po }) {
  const lines = po.lines ?? [];
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <th className="border-b px-3 py-2 text-left">Type</th>
            <th className="border-b px-3 py-2 text-left">Material</th>
            <th className="border-b px-3 py-2 text-left">Storage Location</th>
            <th className="border-b px-3 py-2 text-left">Batch</th>
            <th className="border-b px-3 py-2 text-right">Total Qty</th>
            <th className="border-b px-3 py-2 text-right">Actual Qty</th>
            <th className="border-b px-3 py-2 text-left">Movement</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No lines.</td></tr>
          ) : lines.map((line) => (
            <tr key={line.id} className="border-b border-slate-100">
              <td className="px-3 py-2 font-semibold">{line.line_type}</td>
              <td className="px-3 py-2">{materialLabel(line.actual_material) || materialLabel(line.material) || "--"}</td>
              <td className="px-3 py-2">{slocLabel(line.storage_location) || "--"}</td>
              <td className="px-3 py-2 font-mono">{line.batch_number || "--"}</td>
              <td className="px-3 py-2 text-right font-mono">{qtyFmt(line.total_qty)}</td>
              <td className="px-3 py-2 text-right font-mono">{line.actual_qty == null ? "--" : qtyFmt(line.actual_qty)}</td>
              <td className="px-3 py-2 font-mono">{line.movement_type_code || (line.line_type === "FG" ? "P101" : "P261")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReversalPage() {
  const qc = useQueryClient();
  const [poNumberInput, setPoNumberInput] = useState("");
  const [submittedPoNumber, setSubmittedPoNumber] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyMap = useMemo(
    () => new Map(companies.map((company) => [String(company.id), company])),
    [companies],
  );

  // PO numbers are global (§8 — 93xxxxxxxx = Process PO, 94xxxxxxxx = Packing
  // PO), so a single number is enough to find the right one. Both lists are
  // queried; whichever actually contains the number wins — no company picker,
  // no PO dropdown, no assumption about the number's prefix.
  const lookupQ = useQuery({
    queryKey: ["reversal-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const normalized = submittedPoNumber.toUpperCase();
      const [procResult, packResult] = await Promise.all([
        listProcessOrders({ po_number: submittedPoNumber, per_page: 10 }),
        listPackingOrders({ po_number: submittedPoNumber, per_page: 10 }),
      ]);
      const procList = Array.isArray(procResult) ? procResult : procResult?.data ?? [];
      const packList = Array.isArray(packResult) ? packResult : packResult?.data ?? [];
      const procMatch = procList.find((order) => String(order.po_number || "").toUpperCase() === normalized) ?? null;
      const packMatch = packList.find((order) => String(order.po_number || "").toUpperCase() === normalized) ?? null;
      if (procMatch) return { type: "PROCESS", id: procMatch.id };
      if (packMatch) return { type: "PACKING", id: packMatch.id };
      return { type: null, id: null };
    },
  });

  const matchType = lookupQ.data?.type ?? null;
  const matchId = lookupQ.data?.id ?? null;

  const detailQ = useQuery({
    queryKey: ["reversal-detail", matchType, matchId],
    queryFn: () => (matchType === "PROCESS" ? getProcessOrder(matchId) : getPackingOrder(matchId)),
    enabled: Boolean(matchType && matchId),
  });

  const po = detailQ.data ?? null;
  const isProcess = matchType === "PROCESS";

  useEffect(() => {
    setReason("");
    setResult(null);
  }, [po?.id]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    const normalized = String(poNumberInput || "").trim();
    if (!normalized) {
      toast("PO Number is required.", "error");
      return;
    }
    setResult(null);
    if (normalized.toUpperCase() === submittedPoNumber) {
      lookupQ.refetch();
      return;
    }
    setSubmittedPoNumber(normalized.toUpperCase());
  }

  function resetSearch() {
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setReason("");
    setResult(null);
  }

  const lookupMessage = useMemo(() => {
    if (lookupQ.error) return lookupQ.error.message || "Lookup failed.";
    if (!submittedPoNumber || lookupQ.isFetching) return "";
    if (!matchType) return "No Process PO or Packing PO found with this number.";
    return "";
  }, [lookupQ.error, lookupQ.isFetching, matchType, submittedPoNumber]);

  const alreadyReversed = po?.status === "REVERSED";
  const canReverse = Boolean(po && !alreadyReversed && (isProcess ? reason.trim() : true));

  async function handleReverse() {
    if (!po || alreadyReversed) return;
    const confirmed = await openActionConfirm({
      eyebrow: isProcess ? "Process PO" : "Packing PO",
      title: `Reverse this ${isProcess ? "Process" : "Packing"} PO?`,
      message: "This cancels open reservations and reverses any posted stock. This cannot be undone.",
      confirmLabel: "Reverse",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      if (isProcess) {
        const response = await reverseProcessOrder(po.id, { reason: reason.trim() });
        setResult(response);
        toast("Process PO reversed.");
        qc.invalidateQueries({ queryKey: ["process-orders"] });
      } else {
        await reversePackingOrder(po.id);
        toast("Packing PO reversed.");
        qc.invalidateQueries({ queryKey: ["pack-orders"] });
      }
      qc.invalidateQueries({ queryKey: ["reversal-detail", matchType, matchId] });
      detailQ.refetch();
    } catch (error) {
      toast(error.message || "Reversal failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const company = po ? companyMap.get(String(po.company_id)) : null;

  return (
    <ErpScreenScaffold
      title="Reversal - PR15"
      subtitle="CORS full reversal for Process PO and Packing PO"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Find PO to Reverse">
        <form onSubmit={handleSearchSubmit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">PO Number</label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={poNumberInput}
              onChange={(event) => setPoNumberInput(event.target.value)}
              placeholder="Enter a Process PO or Packing PO number, then press Enter"
              autoComplete="off"
            />
          </div>
          <div className="flex items-end justify-end">
            <button
              type="submit"
              disabled={lookupQ.isFetching || !String(poNumberInput || "").trim()}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {lookupQ.isFetching ? "Searching..." : "Search"}
            </button>
          </div>
          {po ? (
            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={resetSearch}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          ) : null}
        </form>

        {lookupMessage ? (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {lookupMessage}
          </div>
        ) : null}
        {detailQ.isFetching ? <p className="mt-3 text-sm text-slate-500">Loading PO details...</p> : null}
      </ErpSectionCard>

      {po ? (
        <ErpSectionCard title={`PR15 Reverse - ${isProcess ? "Process PO" : "Packing PO"}`}>
          {alreadyReversed ? (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This {isProcess ? "Process" : "Packing"} PO is already reversed. No further action is possible here.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4 text-sm">
            <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Status</span><p>{po.status || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Company</span><p>{companyLabel(company) || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Type</span><p>{isProcess ? (po.po_type || "--") : `${po.source_po_type || "--"} / ${po.po_type || "--"}`}</p></div>
            {isProcess ? (
              <>
                <div><span className="block text-xs text-slate-400">Batch #</span><p className="font-mono">{po.batch_number || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Machine</span><p>{po.machine?.machine_name || po.machine?.machine_code || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Stroke #</span><p>{po.stroke?.stroke_number || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Prodshade</span><p>{materialLabel(po.material) || "--"}</p></div>
              </>
            ) : (
              <>
                <div><span className="block text-xs text-slate-400">FG SKU</span><p>{materialLabel(po.material) || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Num Packs</span><p className="font-mono">{qtyFmt(po.num_packs)}</p></div>
                <div><span className="block text-xs text-slate-400">SFG Batch</span><p className="font-mono">{po.batch_number || "--"}</p></div>
              </>
            )}
          </div>

          <div className="mt-4">
            {isProcess ? <ProcessLinesReadOnly po={po} /> : <PackingLinesReadOnly po={po} />}
          </div>

          {!alreadyReversed && isProcess ? (
            <div className="mt-4 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-600">Reason <span className="text-rose-500">*</span></label>
              <textarea
                rows={3}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm resize-none"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason is mandatory before Reverse is enabled"
              />
            </div>
          ) : null}

          {!alreadyReversed ? (
            <div className="mt-4">
              <button
                onClick={handleReverse}
                disabled={!canReverse || saving}
                className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
              >
                {saving ? "Reversing..." : "Reverse"}
              </button>
            </div>
          ) : null}

          {result ? (
            <div className="mt-4 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm">
                <span className="font-medium text-slate-600">Result Status:</span> {result.status || "--"}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Reversed Movements</div>
                {Array.isArray(result.ledger_entries) && result.ledger_entries.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm text-slate-700">
                    {result.ledger_entries.map((entry, index) => (
                      <li key={`${entry.movement}-${index}`}>
                        {entry.movement} {entry.direction ? `(${entry.direction})` : ""} {entry.stock_document_id ? `- ${entry.stock_document_id}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No ledger entries were returned.</p>
                )}
              </div>
            </div>
          ) : null}
        </ErpSectionCard>
      ) : null}
    </ErpScreenScaffold>
  );
}
