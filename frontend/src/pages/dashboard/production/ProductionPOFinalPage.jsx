/*
 * File-ID: 27.FE-PR11
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Process PO final data-entry screen for PR11.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import { useMenu } from "../../../context/useMenu.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { availabilityPreviewProcessOrder, finalizeProcessOrder, getProcessOrder, listProcessOrders } from "./prodApi.js";
import {
  correctPackingOrder,
  finalizePackingOrder,
  getPackingOrder,
  listPackingOrders,
  listPackingSfgBatches,
} from "./prodApi.js";

const FINAL_TABS = ["Process PO", "Packing PO"];
const APPROVED_OPTIONS = ["YES", "NO", "PARTIAL"].map((value) => ({ value, label: value }));

function materialLabelSimple(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}

function machineLabelSimple(machine) {
  return [machine?.machine_code, machine?.machine_name].filter(Boolean).join(" - ");
}

function slocLabelSimple(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function qtyFmt(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "-";
}

function PACKING_ERR(error) {
  const map = {
    PROD_PACK_SFG_BATCH_REQUIRED: "Select an available SFG batch before final posting.",
    PROD_PACK_SFG_BATCH_SHORTAGE: "Selected SFG batch does not have enough unrestricted stock.",
    PROD_PACK_STATUS_INVALID: "Action not valid for current status.",
    PROD_PACK_CORRECTION_STATUS_INVALID: "Packing PO must be FINAL to correct.",
    PROD_PACK_SUBSTITUTE_NOT_REGISTERED: "Actual Material must be a registered alternate for that line.",
  };
  const code = error?.code || error?.message || "";
  return map[code] ?? error?.message ?? "Request failed.";
}

// §83.4.1 addendum (2026-07-21): PM-line Approved/AP-Approved/Variance rule —
// mirrors computeRowValues() in ProductionPOVerifyPage.jsx / the Process PO
// tab below, exactly (the live code, not the older stale doc table). Output
// (FG) never deviates in a way requiring approval, so this only applies to PM.
function computePmValues(standardQty, actualQty, approvedStatus, apApprovedQtyInput) {
  const autoYes = Math.abs(actualQty - standardQty) < 0.0001;
  const approved = autoYes ? "YES" : (approvedStatus || "YES");
  let apApproved = actualQty;
  let variance = 0;
  if (!autoYes) {
    if (approved === "NO") {
      apApproved = standardQty;
      variance = actualQty - standardQty;
    } else if (approved === "PARTIAL") {
      apApproved = Number(apApprovedQtyInput || 0);
      variance = actualQty - apApproved;
    } else {
      apApproved = actualQty;
    }
  }
  return { autoYes, approved, apApproved, variance };
}

function buildPmAlternateOptions(line) {
  const options = [{ value: "", label: "(same as formulation)" }];
  for (const material of line.allowed_alternate_materials ?? []) {
    if (!material?.id) continue;
    options.push({ value: material.id, label: materialLabelSimple(material) || "Registered alternate" });
  }
  return options;
}

function PackingPoFinalTab() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [activeOrderId, setActiveOrderId] = useState("");
  const [poNumberInput, setPoNumberInput] = useState("");
  const [submittedPoNumber, setSubmittedPoNumber] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [sfgBatchNumber, setSfgBatchNumber] = useState("");
  const [correctionQty, setCorrectionQty] = useState({});
  // §83.4.1 addendum: PM-line Actual Qty / Actual Material / Approved / AP
  // Approved overrides, keyed by line id — used both at STANDARD (Final) and
  // at FINAL (COR6 correction); the correction delta reuses the same maps.
  const [pmActualQty, setPmActualQty] = useState({});
  const [pmMatOverrides, setPmMatOverrides] = useState({});
  const [pmApproved, setPmApproved] = useState({});
  const [pmApApproved, setPmApApproved] = useState({});
  const [newPmRows, setNewPmRows] = useState([]);

  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: company.id, label: [company.company_code, company.company_name].filter(Boolean).join(" - ") || "Company" })),
    [companies],
  );

  const ordersQ = useQuery({
    queryKey: ["packing-final-orders", companyId],
    queryFn: () => listPackingOrders({ company_id: companyId || undefined, status: "STANDARD", per_page: 100 }),
    enabled: Boolean(companyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: [order.po_number, materialLabelSimple(order.material), order.po_type].filter(Boolean).join(" - ") || order.po_number })),
    [ordersQ.data],
  );

  const lookupQ = useQuery({
    queryKey: ["packing-final-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const result = await listPackingOrders({ po_number: submittedPoNumber, per_page: 10 });
      const options = Array.isArray(result) ? result : result?.data ?? [];
      const match = options.find((order) => String(order.po_number || "").toUpperCase() === submittedPoNumber.toUpperCase()) ?? null;
      if (!match?.id) return { match: null, blockedMessage: "Packing PO not found." };
      const blockedMessage = match.status === "REVERSED" ? "This Packing PO is reversed." : "";
      return { match, blockedMessage };
    },
  });

  const detailQ = useQuery({
    queryKey: ["packing-final-detail", activeOrderId],
    queryFn: () => getPackingOrder(activeOrderId),
    enabled: Boolean(activeOrderId),
  });

  const po = detailQ.data ?? null;
  const lookupMessage = useMemo(() => {
    if (lookupQ.error) return lookupQ.error.message || "Packing PO lookup failed.";
    if (!submittedPoNumber || lookupQ.isFetching) return "";
    return lookupQ.data?.blockedMessage || "";
  }, [lookupQ.data?.blockedMessage, lookupQ.error, lookupQ.isFetching, submittedPoNumber]);

  useEffect(() => {
    const match = lookupQ.data?.match ?? null;
    if (!match?.id) return;
    setCompanyId(String(match.company_id || ""));
    setSelectedOrderId(lookupQ.data?.blockedMessage ? "" : match.id);
    setActiveOrderId(lookupQ.data?.blockedMessage ? "" : match.id);
  }, [lookupQ.data]);

  useEffect(() => {
    setSfgBatchNumber("");
    setCorrectionQty({});
    setPmActualQty({});
    setPmMatOverrides({});
    setPmApproved({});
    setPmApApproved({});
    setNewPmRows([]);
  }, [po?.id, po?.status]);

  // §108.2 item 8 (2026-07-24, business owner correction): PMTS reversed back to
  // batch-selection like PMTO/PHPS — "Fixed BOM/pack size" and "batch choice" are
  // independent decisions; only PTEST (MTEST) stays generically batch-blind.
  const isBatchBlind = po?.po_type === "PTEST";
  // §108.2 item 7 — PMTS has no Approved/AP-Approved reco workflow (§108.4); the
  // backend already skips the reco insert entirely for PMTS at Final/COR6.
  const hidePmApproval = po?.po_type === "PMTS";
  const sfgLine = (po?.lines ?? []).find((line) => line.line_type === "SFG") ?? null;
  const pmLines = (po?.lines ?? []).filter((line) => line.line_type === "PM");
  const effectiveSfgBatchNumber = sfgBatchNumber || po?.batch_number || sfgLine?.batch_number || "";
  const sfgBatchesQ = useQuery({
    queryKey: ["packing-final-sfg-batches", po?.id, po?.company_id, sfgLine?.material_id, sfgLine?.storage_location?.id],
    queryFn: () => listPackingSfgBatches({
      company_id: po.company_id,
      material_id: sfgLine.material_id,
      storage_location_id: sfgLine.storage_location?.id,
      exclude_source_id: po.id,
    }),
    enabled: Boolean(!isBatchBlind && po?.status === "STANDARD" && po?.company_id && sfgLine?.material_id && sfgLine?.storage_location?.id),
    select: (data) => data?.data ?? data ?? [],
  });
  const selectedSfgBatch = (sfgBatchesQ.data ?? []).find((batch) => batch.batch_number === effectiveSfgBatchNumber) ?? null;
  const sfgRequiredQty = Number(sfgLine?.total_qty ?? 0);
  const sfgShortage = selectedSfgBatch ? Math.max(0, sfgRequiredQty - Number(selectedSfgBatch.available_qty ?? 0)) : 0;

  // "+ Add PM Row" material/storage-location pickers — only queried once a PO
  // is loaded and still STANDARD (an ad-hoc extra consumable can only be
  // added at Final, not at COR6 correction time).
  const pmMaterialQ = useMaterialOptionsQuery(
    { status: "ACTIVE", material_type: "PM", limit: 500 },
    { enabled: Boolean(po?.status === "STANDARD") },
  );
  const pmMaterialOptions = useMemo(
    () => (pmMaterialQ.materials ?? []).map((material) => ({ value: material.id, label: materialLabelSimple(material) || "Material" })),
    [pmMaterialQ.materials],
  );
  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: po?.company_id || undefined },
    { enabled: Boolean(po?.company_id) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: slocLabelSimple(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function resetSelection(nextCompanyId = "") {
    setCompanyId(nextCompanyId);
    setSelectedOrderId("");
    setActiveOrderId("");
    setSubmittedPoNumber("");
    setPoNumberInput("");
  }

  function handleLookupSubmit(event) {
    event.preventDefault();
    const nextPoNumber = String(poNumberInput || "").trim().toUpperCase();
    setSelectedOrderId("");
    setActiveOrderId("");
    if (nextPoNumber && nextPoNumber === submittedPoNumber) {
      lookupQ.refetch();
      return;
    }
    setSubmittedPoNumber(nextPoNumber);
  }

  function handleLoadSelected() {
    if (!selectedOrderId) return;
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setActiveOrderId(selectedOrderId);
  }

  function addPmRow() {
    setNewPmRows((current) => [...current, {
      key: `new-${Date.now()}-${current.length}`,
      material_id: "", issue_sloc_id: "", actual_qty: "", approved_status: "YES", ap_approved_qty: "",
    }]);
  }

  function updateNewPmRow(key, patch) {
    setNewPmRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleFinalize() {
    if (!isBatchBlind) {
      if (!effectiveSfgBatchNumber) {
        toast("Select SFG batch before final posting.", "error");
        return;
      }
      if (sfgBatchesQ.isFetching) {
        toast("SFG batch stock is still loading. Try again in a moment.", "error");
        return;
      }
      if (!selectedSfgBatch || sfgShortage > 0) {
        toast("Selected SFG batch does not have enough unrestricted stock.", "error");
        return;
      }
    }
    const confirmed = await openActionConfirm({
      eyebrow: "Packing PO",
      title: "Finalize Packing PO?",
      message: "This posts SFG/PM issue and FG receipt.",
      confirmLabel: "Finalize",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      // Only PM lines ever need to be sent — SFG/FG output is never edited
      // here (§83.4.1: output is always accepted as actual).
      const pmLinePayload = pmLines.map((line) => {
        const standardQty = Number(line.total_qty ?? 0);
        const actualQty = pmActualQty[line.id] !== undefined && pmActualQty[line.id] !== ""
          ? Number(pmActualQty[line.id]) : standardQty;
        const values = computePmValues(standardQty, actualQty, pmApproved[line.id], pmApApproved[line.id]);
        const payload = { id: line.id, actual_qty: actualQty };
        if (!values.autoYes) {
          payload.approved_status = values.approved;
          if (values.approved === "PARTIAL") payload.ap_approved_qty = values.apApproved;
        }
        if (Object.prototype.hasOwnProperty.call(pmMatOverrides, line.id)) {
          payload.actual_material_id = pmMatOverrides[line.id] || null;
        }
        return payload;
      });
      const newLinePayload = newPmRows
        .filter((row) => row.material_id && Number(row.actual_qty) > 0)
        .map((row) => {
          const actualQty = Number(row.actual_qty);
          const values = computePmValues(0, actualQty, row.approved_status, row.ap_approved_qty);
          const payload = {
            material_id: row.material_id, issue_sloc_id: row.issue_sloc_id || undefined,
            actual_qty: actualQty, approved_status: values.approved,
          };
          if (values.approved === "PARTIAL") payload.ap_approved_qty = values.apApproved;
          return payload;
        });
      await finalizePackingOrder(po.id, {
        ...(isBatchBlind ? {} : { sfg_batch_number: effectiveSfgBatchNumber }),
        lines: [...pmLinePayload, ...newLinePayload],
      });
      toast("Packing PO finalized.");
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
      qc.invalidateQueries({ queryKey: ["packing-final-detail", po.id] });
      detailQ.refetch();
    } catch (error) {
      toast(PACKING_ERR(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCorrect() {
    const lines = (po.lines ?? [])
      .filter((line) => correctionQty[line.id] !== undefined && correctionQty[line.id] !== "")
      .map((line) => {
        const payload = { id: line.id, actual_qty: Number(correctionQty[line.id]) };
        if (line.line_type === "PM") {
          if (Object.prototype.hasOwnProperty.call(pmMatOverrides, line.id)) {
            payload.actual_material_id = pmMatOverrides[line.id] || null;
          }
          const approvedStatus = pmApproved[line.id] || "YES";
          payload.approved_status = approvedStatus;
          if (approvedStatus === "PARTIAL") payload.ap_approved_qty = Number(pmApApproved[line.id] || 0);
        }
        return payload;
      })
      .filter((line) => Number.isFinite(line.actual_qty) && line.actual_qty > 0);
    if (lines.length === 0) {
      toast("Enter a new actual qty for at least one line.", "error");
      return;
    }
    const confirmed = await openActionConfirm({
      eyebrow: "Packing PO",
      title: "Post correction?",
      message: "This will post a delta stock movement for each changed line.",
      confirmLabel: "Post Correction",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await correctPackingOrder(po.id, { lines });
      toast("Correction posted.");
      setCorrectionQty({});
      setPmMatOverrides({});
      setPmApproved({});
      setPmApApproved({});
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
      qc.invalidateQueries({ queryKey: ["packing-final-detail", po.id] });
      detailQ.refetch();
    } catch (error) {
      toast(PACKING_ERR(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice.msg ? (
        <div className={`rounded px-3 py-2 text-sm ${notice.tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {notice.msg}
        </div>
      ) : null}

      <ErpSectionCard title="Select Packing PO">
        <div className="flex flex-col gap-4">
          <form onSubmit={handleLookupSubmit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">PO Number</label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={poNumberInput}
                onChange={(event) => setPoNumberInput(event.target.value)}
                placeholder="Paste or enter Packing PO number, then press Enter"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="submit"
                disabled={lookupQ.isFetching || !String(poNumberInput || "").trim()}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {lookupQ.isFetching ? "Loading..." : "Search"}
              </button>
            </div>
          </form>

          {lookupMessage ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{lookupMessage}</div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Company</label>
              <ErpComboboxField value={companyId} onChange={(value) => resetSelection(value)} options={companyOptions} placeholder="-- Select company --" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Packing PO (STANDARD)</label>
              <ErpComboboxField
                value={selectedOrderId}
                onChange={setSelectedOrderId}
                options={orderOptions}
                placeholder="-- Select packing PO --"
                emptyStateLabel={ordersQ.isLoading ? "Loading packing orders..." : "No STANDARD packing POs"}
                disabled={!companyId}
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={handleLoadSelected}
                disabled={!selectedOrderId || detailQ.isFetching}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {detailQ.isFetching && activeOrderId === selectedOrderId ? "Loading..." : "Load"}
              </button>
            </div>
          </div>
        </div>
      </ErpSectionCard>

      {po && (
        <ErpSectionCard title={po.status === "FINAL" ? "PR11 Correction Mode" : "PR11 Final"}>
          {po.status === "REVERSED" ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This Packing PO is reversed. No further action is possible here.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-4 text-sm">
                <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Status</span><p>{po.status || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Type</span><p>{po.source_po_type || "--"} / {po.po_type || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">FG SKU</span><p>{materialLabelSimple(po.material) || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Num Packs</span><p className="font-mono">{qtyFmt(po.num_packs)}</p></div>
                <div><span className="block text-xs text-slate-400">SFG Batch</span><p className="font-mono">{po.batch_number || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Machine</span><p>{machineLabelSimple(po.machine) || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Actual Qty (KG)</span><p className="font-mono">{po.actual_qty_kg == null ? "--" : qtyFmt(po.actual_qty_kg)}</p></div>
              </div>

              {po.status === "STANDARD" && sfgLine && isBatchBlind ? (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  This Packing PO type ({po.po_type}) is not batch-managed — Final will draw SFG generically from Unrestricted stock at this storage location, no batch selection needed.
                </div>
              ) : null}
              {po.status === "STANDARD" && sfgLine && !isBatchBlind ? (
                <ErpSectionCard title="SFG Batch Selection For Final">
                  <div className="mb-2 text-xs text-slate-500">
                    Choose one unrestricted SFG batch for this Packing PO. Final will consume the required SFG qty, not the available qty.
                  </div>
                  {sfgBatchesQ.isFetching ? (
                    <p className="py-4 text-sm text-slate-400">Loading available SFG batches...</p>
                  ) : (sfgBatchesQ.data ?? []).length === 0 ? (
                    <p className="py-4 text-sm text-rose-600">No unrestricted SFG batch is available for this SKU/prodshade at the selected storage location.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1100px] border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <th className="border-b px-3 py-2 text-left">Select</th>
                            <th className="border-b px-3 py-2 text-left">Prodshade / SFG</th>
                            <th className="border-b px-3 py-2 text-left">Stroke</th>
                            <th className="border-b px-3 py-2 text-left">Batch #</th>
                            <th className="border-b px-3 py-2 text-left">Source Process PO</th>
                            <th className="border-b px-3 py-2 text-left">Machine</th>
                            <th className="border-b px-3 py-2 text-right">Available Qty</th>
                            <th className="border-b px-3 py-2 text-right">Required Qty</th>
                            <th className="border-b px-3 py-2 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(sfgBatchesQ.data ?? []).map((batch) => {
                            const rowShort = Math.max(0, sfgRequiredQty - Number(batch.available_qty ?? 0));
                            const isSelected = effectiveSfgBatchNumber === batch.batch_number;
                            return (
                              <tr key={batch.batch_number} className={`border-b border-slate-100 ${isSelected ? "bg-sky-50" : ""}`}>
                                <td className="px-3 py-2">
                                  <input type="radio" name="packing-final-sfg-batch" checked={isSelected} onChange={() => setSfgBatchNumber(batch.batch_number)} />
                                </td>
                                <td className="px-3 py-2">{materialLabelSimple(batch.prodshade) || materialLabelSimple(sfgLine.material)}</td>
                                <td className="px-3 py-2 font-mono">{batch.stroke_number || "--"}</td>
                                <td className="px-3 py-2 font-mono">{batch.batch_number}</td>
                                <td className="px-3 py-2 font-mono">{batch.source_po_number || "--"}</td>
                                <td className="px-3 py-2">{machineLabelSimple(batch.machine) || "--"}</td>
                                <td className="px-3 py-2 text-right font-mono">{qtyFmt(batch.available_qty)}</td>
                                <td className="px-3 py-2 text-right font-mono">{qtyFmt(sfgRequiredQty)}</td>
                                <td className={`px-3 py-2 font-semibold ${rowShort > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                  {rowShort > 0 ? `Short ${qtyFmt(rowShort)}` : "OK"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </ErpSectionCard>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full min-w-[1300px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="border-b px-3 py-2 text-left">Type</th>
                      <th className="border-b px-3 py-2 text-left">Material</th>
                      <th className="border-b px-3 py-2 text-left">Actual Material</th>
                      <th className="border-b px-3 py-2 text-left">Storage Location</th>
                      <th className="border-b px-3 py-2 text-left">Batch</th>
                      <th className="border-b px-3 py-2 text-right">Std Qty</th>
                      <th className="border-b px-3 py-2 text-right">Actual Qty</th>
                      {!hidePmApproval && <th className="border-b px-3 py-2 text-left">Approved</th>}
                      {!hidePmApproval && <th className="border-b px-3 py-2 text-right">AP Appr</th>}
                      <th className="border-b px-3 py-2 text-right">Var</th>
                      {po.status === "FINAL" ? <th className="border-b px-3 py-2 text-right">New Actual Qty (correction)</th> : null}
                      <th className="border-b px-3 py-2 text-left">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(po.lines ?? []).map((line) => {
                      const isPm = line.line_type === "PM";
                      const standardQty = Number(line.total_qty ?? 0);

                      // STANDARD (Final) view — editable Actual Qty/Material/Approved for PM.
                      const actualQtyForFinal = pmActualQty[line.id] !== undefined && pmActualQty[line.id] !== ""
                        ? Number(pmActualQty[line.id]) : standardQty;
                      const finalValues = isPm
                        ? computePmValues(standardQty, actualQtyForFinal, pmApproved[line.id], pmApApproved[line.id])
                        : null;

                      // FINAL (COR6) view — the correction input holds the NEW absolute
                      // actual; approval applies to the delta it implies.
                      const correctionInput = correctionQty[line.id];
                      const hasCorrectionDelta = isPm && correctionInput !== undefined && correctionInput !== "";
                      const correctionDelta = hasCorrectionDelta ? Number(correctionInput) - Number(line.actual_qty ?? line.total_qty ?? 0) : 0;
                      const correctionValues = hasCorrectionDelta
                        ? computePmValues(0, correctionDelta, pmApproved[line.id], pmApApproved[line.id])
                        : null;

                      const altOptions = isPm ? buildPmAlternateOptions(line) : [];
                      const hasAlternates = (line.allowed_alternate_materials ?? []).length > 0;

                      return (
                        <tr key={line.id} className="border-b border-slate-100">
                          <td className="px-3 py-2 font-semibold">{line.line_type}</td>
                          <td className="px-3 py-2">{materialLabelSimple(line.material)}</td>
                          <td className="px-3 py-2 min-w-[200px]">
                            {isPm && hasAlternates ? (
                              <ErpComboboxField
                                value={pmMatOverrides[line.id] ?? line.actual_material_id ?? ""}
                                onChange={(value) => setPmMatOverrides((current) => ({ ...current, [line.id]: value }))}
                                options={altOptions}
                                placeholder="(same as formulation)"
                              />
                            ) : (
                              <span className="text-slate-400">{isPm ? "—" : ""}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">{slocLabelSimple(line.storage_location)}</td>
                          <td className="px-3 py-2 font-mono">{line.batch_number || "--"}</td>
                          <td className="px-3 py-2 text-right font-mono">{qtyFmt(standardQty)}</td>

                          {po.status === "STANDARD" ? (
                            <>
                              <td className="px-3 py-2 text-right">
                                {isPm ? (
                                  <input
                                    type="number" min="0" step="0.001"
                                    className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                    value={pmActualQty[line.id] ?? ""}
                                    placeholder={qtyFmt(standardQty)}
                                    onChange={(event) => setPmActualQty((current) => ({ ...current, [line.id]: event.target.value }))}
                                  />
                                ) : (
                                  <span className="font-mono">{qtyFmt(line.actual_qty ?? line.total_qty)}</span>
                                )}
                              </td>
                              {!hidePmApproval && (
                                <td className="px-3 py-2">
                                  {isPm && !finalValues.autoYes ? (
                                    <ErpComboboxField
                                      value={pmApproved[line.id] || "YES"}
                                      onChange={(value) => setPmApproved((current) => ({ ...current, [line.id]: value }))}
                                      options={APPROVED_OPTIONS}
                                      hideBlank
                                    />
                                  ) : isPm ? (
                                    <span className="inline-flex rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">* YES</span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              )}
                              {!hidePmApproval && (
                                <td className="px-3 py-2 text-right">
                                  {isPm && finalValues.approved === "PARTIAL" && !finalValues.autoYes ? (
                                    <input
                                      type="number" min="0" step="0.001"
                                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                      value={pmApApproved[line.id] ?? ""}
                                      onChange={(event) => setPmApApproved((current) => ({ ...current, [line.id]: event.target.value }))}
                                    />
                                  ) : isPm ? (
                                    <span className="font-mono">{finalValues.apApproved.toFixed(3)}</span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              )}
                              <td className="px-3 py-2 text-right font-mono">{isPm ? finalValues.variance.toFixed(3) : "—"}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-right font-mono">{qtyFmt(line.actual_qty ?? line.total_qty)}</td>
                              {!hidePmApproval && (
                                <td className="px-3 py-2">
                                  {hasCorrectionDelta && !correctionValues.autoYes ? (
                                    <ErpComboboxField
                                      value={pmApproved[line.id] || "YES"}
                                      onChange={(value) => setPmApproved((current) => ({ ...current, [line.id]: value }))}
                                      options={APPROVED_OPTIONS}
                                      hideBlank
                                    />
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              )}
                              {!hidePmApproval && (
                                <td className="px-3 py-2 text-right">
                                  {hasCorrectionDelta && correctionValues.approved === "PARTIAL" ? (
                                    <input
                                      type="number" min="0" step="0.001"
                                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                      value={pmApApproved[line.id] ?? ""}
                                      onChange={(event) => setPmApApproved((current) => ({ ...current, [line.id]: event.target.value }))}
                                    />
                                  ) : hasCorrectionDelta ? (
                                    <span className="font-mono">{correctionValues.apApproved.toFixed(3)}</span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              )}
                              <td className="px-3 py-2 text-right font-mono">{hasCorrectionDelta ? correctionValues.variance.toFixed(3) : "—"}</td>
                            </>
                          )}

                          {po.status === "FINAL" ? (
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                className="w-28 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                value={correctionQty[line.id] ?? ""}
                                placeholder={qtyFmt(line.actual_qty ?? line.total_qty)}
                                onChange={(event) => setCorrectionQty((current) => ({ ...current, [line.id]: event.target.value }))}
                              />
                            </td>
                          ) : null}
                          <td className="px-3 py-2 font-mono">{line.movement_type_code || (line.line_type === "FG" ? "P101" : "P261")}</td>
                        </tr>
                      );
                    })}

                    {po.status === "STANDARD" ? newPmRows.map((row) => (
                      <tr key={row.key} className="border-b border-slate-100 bg-amber-50/40">
                        <td className="px-3 py-2 font-semibold">PM<span className="ml-1 text-xs font-normal text-amber-600">(new)</span></td>
                        <td className="px-3 py-2 min-w-[220px]" colSpan={2}>
                          <ErpComboboxField
                            value={row.material_id}
                            onChange={(value) => updateNewPmRow(row.key, { material_id: value })}
                            options={pmMaterialOptions}
                            placeholder="-- Select PM material --"
                            emptyStateLabel={pmMaterialQ.isLoading ? "Loading PM materials..." : "No PM materials"}
                          />
                        </td>
                        <td className="px-3 py-2 min-w-[200px]">
                          <ErpComboboxField
                            value={row.issue_sloc_id}
                            onChange={(value) => updateNewPmRow(row.key, { issue_sloc_id: value })}
                            options={storageLocationOptions}
                            placeholder="-- Select storage location --"
                            emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono">0.000</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number" min="0" step="0.001"
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                            value={row.actual_qty}
                            onChange={(event) => updateNewPmRow(row.key, { actual_qty: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <ErpComboboxField
                            value={row.approved_status}
                            onChange={(value) => updateNewPmRow(row.key, { approved_status: value })}
                            options={APPROVED_OPTIONS}
                            hideBlank
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.approved_status === "PARTIAL" ? (
                            <input
                              type="number" min="0" step="0.001"
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                              value={row.ap_approved_qty}
                              onChange={(event) => updateNewPmRow(row.key, { ap_approved_qty: event.target.value })}
                            />
                          ) : (
                            <span className="font-mono">{qtyFmt(row.approved_status === "NO" ? 0 : row.actual_qty)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.approved_status === "NO" ? qtyFmt(row.actual_qty) : (row.approved_status === "PARTIAL" ? qtyFmt(Number(row.actual_qty || 0) - Number(row.ap_approved_qty || 0)) : "0.000")}
                        </td>
                        <td className="px-3 py-2">P261</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setNewPmRows((current) => current.filter((entry) => entry.key !== row.key))}
                            className="text-sm font-medium text-rose-600 hover:underline"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )) : null}
                  </tbody>
                </table>
              </div>

              {po.status === "STANDARD" ? (
                <button type="button" onClick={addPmRow} className="self-start text-sm font-medium text-sky-700 hover:underline">
                  + Add PM Row (extra consumable)
                </button>
              ) : null}

              <div className="flex justify-end gap-2">
                {po.status === "STANDARD" ? (
                  <button
                    type="button"
                    onClick={handleFinalize}
                    disabled={isBatchBlind ? saving : (saving || sfgBatchesQ.isFetching || !selectedSfgBatch || sfgShortage > 0)}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {saving ? "Posting..." : "Final & Post Stock"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCorrect}
                    disabled={saving}
                    className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                  >
                    {saving ? "Posting..." : "Post Correction"}
                  </button>
                )}
              </div>
            </div>
          )}
        </ErpSectionCard>
      )}
    </div>
  );
}

function companyLabel(company) {
  return [company.company_code, company.company_name].filter(Boolean).join(" - ");
}

function orderLabel(order) {
  return [order.po_number, order.material?.material_name, order.po_type].filter(Boolean).join(" - ");
}

function materialLabel(material) {
  return [material?.pace_code, material?.material_name].filter(Boolean).join(" - ");
}

function buildActualMaterialOptions(line) {
  const options = [{ value: "", label: "(same)" }];
  const seen = new Set([""]);
  for (const material of line.allowed_alternate_materials ?? []) {
    if (!material?.id || seen.has(material.id)) continue;
    seen.add(material.id);
    options.push({
      value: material.id,
      label: materialLabel(material) || "Registered alternate",
    });
  }
  if (line.registered_alternate_material_id && !seen.has(line.registered_alternate_material_id)) {
    seen.add(line.registered_alternate_material_id);
    options.push({
      value: line.registered_alternate_material_id,
      label: materialLabel(line.registered_alternate_material) || "Registered alternate",
    });
  }
  if (line.actual_material_id && !seen.has(line.actual_material_id)) {
    options.push({
      value: line.actual_material_id,
      label: materialLabel(line.actual_material) || "Selected alternate",
    });
  }
  return options;
}

function storageLocationLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function validateFinalPoStatus(status) {
  return String(status || "").toUpperCase() === "BATCH_STARTED"
    ? ""
    : "This Process PO is not applicable for Final. Only `BATCH_STARTED` is allowed.";
}

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

function makeDraftRow(line) {
  return {
    key: line.id,
    id: line.id,
    material_id: line.material_id,
    material_label: materialLabel(line.material),
    dosage_pct: line.dosage_pct ?? "",
    registered_alternate_material_id: line.registered_alternate_material_id || "",
    registered_alternate_material_label: materialLabel(line.registered_alternate_material),
    allowed_alternate_material_options: buildActualMaterialOptions(line),
    actual_material_id: line.actual_material_id || "",
    issue_sloc_id: line.issue_sloc_id || line.issue_storage_location?.id || "",
    planned_qty: String(line.planned_qty ?? 0),
    actual_qty: String(line.actual_qty ?? line.planned_qty ?? 0),
    approved_status: line.approved_status || "YES",
    ap_approved_qty: String(line.ap_approved_qty ?? line.actual_qty ?? line.planned_qty ?? 0),
    variance_qty: String(line.variance_qty ?? 0),
    is_formulation_line: line.is_formulation_line !== false,
  };
}

function ProcessPoFinalTab() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [activeOrderId, setActiveOrderId] = useState("");
  const [poNumberInput, setPoNumberInput] = useState("");
  const [submittedPoNumber, setSubmittedPoNumber] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [debouncedPreviewRows, setDebouncedPreviewRows] = useState([]);

  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: company.id, label: companyLabel(company) || "Company" })),
    [companies],
  );

  const ordersQ = useQuery({
    queryKey: ["production-final-orders", companyId],
    queryFn: () => listProcessOrders({ company_id: companyId || undefined, status: "BATCH_STARTED", per_page: 100 }),
    enabled: Boolean(companyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: orderLabel(order) || order.po_number || "Process PO" })),
    [ordersQ.data],
  );

  const lookupQ = useQuery({
    queryKey: ["production-final-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const result = await listProcessOrders({ po_number: submittedPoNumber, per_page: 10 });
      const options = Array.isArray(result) ? result : result?.data ?? [];
      const match = options.find((order) => String(order.po_number || "").toUpperCase() === submittedPoNumber.toUpperCase()) ?? null;
      if (!match?.id) return { match: null, blockedMessage: "Process PO not found." };
      const blockedMessage = validateFinalPoStatus(match.status);
      return { match, blockedMessage };
    },
  });

  const detailQ = useQuery({
    queryKey: ["production-final-detail", activeOrderId],
    queryFn: () => getProcessOrder(activeOrderId),
    enabled: Boolean(activeOrderId),
  });
  const materialQ = useMaterialOptionsQuery({ status: "ACTIVE", limit: 500 });
  const materialOptions = useMemo(
    () => (materialQ.materials ?? []).map((material) => ({ value: material.id, label: materialLabel(material) || "Material" })),
    [materialQ.materials],
  );
  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: companyId || undefined },
    { enabled: Boolean(companyId) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: storageLocationLabel(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );

  const po = detailQ.data ?? null;
  // §108.2 item 7 — MTS has no Approved/AP-Approved reco workflow (§108.4); showing
  // these fields would suggest a concept that doesn't apply and is never written
  // (process_order.handlers.ts skips the reco insert entirely for MTS at Verify).
  const hideRmApproval = po?.po_type === "MTS";
  const lookupMessage = useMemo(() => {
    if (lookupQ.error) return lookupQ.error.message || "Process PO lookup failed.";
    if (!submittedPoNumber || lookupQ.isFetching) return "";
    return lookupQ.data?.blockedMessage || "";
  }, [lookupQ.data?.blockedMessage, lookupQ.error, lookupQ.isFetching, submittedPoNumber]);

  useEffect(() => {
    const match = lookupQ.data?.match ?? null;
    if (!match?.id) return;
    setCompanyId(String(match.company_id || ""));
    setSelectedOrderId(lookupQ.data?.blockedMessage ? "" : match.id);
    setActiveOrderId(lookupQ.data?.blockedMessage ? "" : match.id);
  }, [lookupQ.data]);

  useEffect(() => {
    setRows((po?.lines ?? []).map(makeDraftRow));
  }, [po]);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedPreviewRows(rows.map((row) => ({
        line_id: row.id || undefined,
        material_id: row.actual_material_id || row.material_id,
        storage_location_id: row.issue_sloc_id || undefined,
        qty: Number(row.actual_qty || 0),
      })));
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [rows]);

  const availabilityPreviewQ = useQuery({
    queryKey: ["production-final-availability-preview", companyId, activeOrderId, debouncedPreviewRows],
    queryFn: () => availabilityPreviewProcessOrder({
      company_id: companyId,
      process_order_id: activeOrderId,
      overrides: debouncedPreviewRows,
    }),
    enabled: Boolean(companyId && activeOrderId),
  });
  const availabilityByKey = useMemo(
    () => new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [availabilityPreviewQ.data],
  );

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function resetSelection(nextCompanyId = "") {
    setCompanyId(nextCompanyId);
    setSelectedOrderId("");
    setActiveOrderId("");
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setRows([]);
  }

  function handleLookupSubmit(event) {
    event.preventDefault();
    const nextPoNumber = String(poNumberInput || "").trim().toUpperCase();
    setSelectedOrderId("");
    setActiveOrderId("");
    setRows([]);
    if (nextPoNumber && nextPoNumber === submittedPoNumber) {
      lookupQ.refetch();
      return;
    }
    setSubmittedPoNumber(nextPoNumber);
  }

  function handleLoadSelected() {
    if (!selectedOrderId) return;
    setSubmittedPoNumber("");
    setPoNumberInput("");
    setActiveOrderId(selectedOrderId);
  }

  function updateRow(key, patch) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows((current) => [...current, {
      key: `new-${Date.now()}`,
      id: "",
      material_id: "",
      material_label: "",
      dosage_pct: "",
      registered_alternate_material_id: "",
      registered_alternate_material_label: "",
      actual_material_id: "",
      issue_sloc_id: "",
      planned_qty: "0",
      actual_qty: "0",
      approved_status: "YES",
      ap_approved_qty: "0",
      variance_qty: "0",
      is_formulation_line: false,
    }]);
  }

  async function handleSave() {
    if (!po || po.status !== "BATCH_STARTED") return;
    setSaving(true);
    try {
      const inputRows = rows.map((row) => {
        const values = computeRowValues(row);
        return {
          id: row.id || undefined,
          material_id: row.id ? undefined : row.material_id || undefined,
          dosage_pct: row.dosage_pct === "" ? undefined : Number(row.dosage_pct),
          actual_material_id: row.actual_material_id || undefined,
          storage_location_id: row.issue_sloc_id || undefined,
          actual_qty: values.actual,
          approved_status: values.autoYes ? undefined : row.approved_status,
          ap_approved_qty: values.autoYes ? undefined : (row.approved_status === "PARTIAL" ? Number(row.ap_approved_qty || 0) : undefined),
          is_rm: true,
        };
      });
      const outputActualQty = rows.reduce((sum, row) => sum + computeRowValues(row).apApproved, 0);
      await finalizeProcessOrder(po.id, {
        actual_qty: outputActualQty,
        lines: inputRows,
      });
      toast("Process PO saved as FINAL.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-final-detail", po.id] });
    } catch (error) {
      toast(error.message || "Final save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const outputApprovedQty = rows.reduce((sum, row) => sum + computeRowValues(row).apApproved, 0);
  const outputActualQty = rows.reduce((sum, row) => sum + computeRowValues(row).actual, 0);
  const outputVariance = outputActualQty - outputApprovedQty;

  return (
    <div className="flex flex-col gap-4">
      {notice.msg ? (
        <div className={`rounded px-3 py-2 text-sm ${notice.tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {notice.msg}
        </div>
      ) : null}
      <ErpSectionCard title="Select Process PO">
        <div className="flex flex-col gap-4">
          <form onSubmit={handleLookupSubmit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">PO Number</label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={poNumberInput}
                onChange={(event) => setPoNumberInput(event.target.value)}
                placeholder="Paste or enter Process PO number, then press Enter"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="submit"
                disabled={lookupQ.isFetching || !String(poNumberInput || "").trim()}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
              >
                {lookupQ.isFetching ? "Loading..." : "Search"}
              </button>
            </div>
          </form>

          {lookupMessage ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {lookupMessage}
            </div>
          ) : null}

          {detailQ.isFetching && activeOrderId ? (
            <p className="text-sm text-slate-500">Loading Process PO details...</p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Company</label>
              <ErpComboboxField
                value={companyId}
                onChange={(value) => resetSelection(value)}
                options={companyOptions}
                placeholder="-- Select company --"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Process PO</label>
              <ErpComboboxField
                value={selectedOrderId}
                onChange={setSelectedOrderId}
                options={orderOptions}
                placeholder="-- Select process PO --"
                emptyStateLabel={ordersQ.isLoading ? "Loading process orders..." : "No BATCH_STARTED process POs"}
                disabled={!companyId}
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={handleLoadSelected}
                disabled={!selectedOrderId || detailQ.isFetching}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {detailQ.isFetching && activeOrderId === selectedOrderId ? "Loading..." : "Load"}
              </button>
            </div>
          </div>
        </div>
      </ErpSectionCard>

      {po && (
        <ErpSectionCard title="PR11 Final">
          {po.status !== "BATCH_STARTED" ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This Process PO is blocked for Final. Only `BATCH_STARTED` is allowed.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="grid flex-1 gap-3 md:grid-cols-3 text-sm">
                  <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Batch #</span><p className="font-mono">{po.batch_number || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Status</span><p>{po.status || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Machine</span><p>{po.machine?.machine_name || po.machine?.machine_code || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Stroke #</span><p>{po.stroke?.stroke_number || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Prodshade</span><p>{materialLabel(po.material) || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Description</span><p>{po.stroke?.description || po.material?.material_name || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Type</span><p>{po.po_type || "--"}</p></div>
                  <div><span className="block text-xs text-slate-400">Std Size</span><p className="font-mono">{Number(po.planned_qty || 0).toLocaleString()}</p></div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save as Final"}
                </button>
              </div>

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
                        {!hideRmApproval && <th className="border-b px-3 py-2 text-left">Approved</th>}
                        {!hideRmApproval && <th className="border-b px-3 py-2 text-right">AP Appr</th>}
                        <th className="border-b px-3 py-2 text-right">Var</th>
                        <th className="border-b px-3 py-2 text-left">Mvt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const values = computeRowValues(row);
                        const previewMaterialId = row.actual_material_id || row.material_id;
                        const availability = row.issue_sloc_id
                          ? availabilityByKey.get(`${previewMaterialId}::${row.issue_sloc_id}`) ?? null
                          : null;
                        const isShort = Boolean(availability && values.actual > Number(availability.available_qty ?? 0));
                        const actualMaterialOptions = row.allowed_alternate_material_options?.length
                          ? row.allowed_alternate_material_options
                          : [{ value: "", label: "(same)" }];
                        return (
                          <tr key={row.key} className={isShort ? "bg-rose-50" : "border-b border-slate-100"}>
                            <td className="px-3 py-2">
                              {row.id ? (
                                row.material_label || "--"
                              ) : (
                                <ErpComboboxField
                                  value={row.material_id}
                                  onChange={(value) => {
                                    const selected = (materialQ.materials ?? []).find((material) => material.id === value);
                                    updateRow(row.key, {
                                      material_id: value,
                                      material_label: materialLabel(selected),
                                    });
                                  }}
                                  options={materialOptions}
                                  placeholder="-- Select material --"
                                  emptyStateLabel={materialQ.isLoading ? "Loading materials..." : "No materials"}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{row.dosage_pct === "" ? "--" : Number(row.dosage_pct).toFixed(3)}</td>
                            <td className="px-3 py-2">
                              <ErpComboboxField
                                value={row.actual_material_id}
                                onChange={(value) => updateRow(row.key, { actual_material_id: value })}
                                options={actualMaterialOptions}
                                placeholder="(same)"
                                disabled={!row.id || actualMaterialOptions.length <= 1}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <ErpComboboxField
                                value={row.issue_sloc_id}
                                onChange={(value) => updateRow(row.key, { issue_sloc_id: value })}
                                options={storageLocationOptions}
                                placeholder="-- Select storage location --"
                                emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{values.planned.toFixed(3)}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                value={row.actual_qty}
                                onChange={(event) => updateRow(row.key, { actual_qty: event.target.value })}
                              />
                            </td>
                            {!hideRmApproval && (
                              <td className="px-3 py-2">
                                {values.autoYes && row.id ? (
                                  <span className="inline-flex rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">* YES</span>
                                ) : (
                                  <ErpComboboxField
                                    value={row.approved_status}
                                    onChange={(value) => updateRow(row.key, { approved_status: value })}
                                    options={["YES", "NO", "PARTIAL"].map((value) => ({ value, label: value }))}
                                    hideBlank
                                  />
                                )}
                              </td>
                            )}
                            {!hideRmApproval && (
                              <td className="px-3 py-2 text-right">
                                {row.approved_status === "PARTIAL" && !values.autoYes ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                                    value={row.ap_approved_qty}
                                    onChange={(event) => updateRow(row.key, { ap_approved_qty: event.target.value })}
                                  />
                                ) : (
                                  <span className="font-mono">{values.apApproved.toFixed(3)}</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right font-mono">{values.variance.toFixed(3)}</td>
                            <td className="px-3 py-2">P261</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={addRow} className="mt-2 text-sm font-medium text-sky-700 hover:underline">+ Add Row</button>
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
                        {!hideRmApproval && <th className="border-b px-3 py-2 text-right">AP Appr</th>}
                        <th className="border-b px-3 py-2 text-right">Var</th>
                        <th className="border-b px-3 py-2 text-left">Mvt</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border-b border-slate-100 px-3 py-2">{materialLabel(po.material) || "--"}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{Number(po.planned_qty || 0).toFixed(3)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{outputActualQty.toFixed(3)}</td>
                        {!hideRmApproval && <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{outputApprovedQty.toFixed(3)}</td>}
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{outputVariance.toFixed(3)}</td>
                        <td className="border-b border-slate-100 px-3 py-2">P101</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </ErpSectionCard>
      )}
    </div>
  );
}

export default function ProductionPOFinalPage() {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <ErpScreenScaffold
      title="Production PO Final - PR11"
      subtitle="Final data entry before stock posting (Process PO and Packing PO)"
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {FINAL_TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => setActiveTab(index)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        {activeTab === 0 ? <ProcessPoFinalTab /> : <PackingPoFinalTab />}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
