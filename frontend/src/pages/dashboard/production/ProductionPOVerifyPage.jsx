/*
 * File-ID: 27.FE-PR12
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Process PO verify screen for PR12.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useCompaniesForOmQuery, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import { availabilityPreviewProcessOrder, getProcessOrder, listProcessOrders, verifyProcessOrder } from "./prodApi.js";

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

function validateVerifyPoStatus(status) {
  return String(status || "").toUpperCase() === "FINAL"
    ? ""
    : "This Process PO is not applicable for Verify. Only `FINAL` is allowed.";
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

export default function ProductionPOVerifyPage() {
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

  const companiesQ = useCompaniesForOmQuery();
  const companyOptions = useMemo(
    () => (companiesQ.data ?? []).map((company) => ({ value: company.id, label: companyLabel(company) || "Company" })),
    [companiesQ.data],
  );

  const ordersQ = useQuery({
    queryKey: ["production-verify-orders", companyId],
    queryFn: () => listProcessOrders({ company_id: companyId || undefined, status: "FINAL", per_page: 100 }),
    enabled: Boolean(companyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: orderLabel(order) || order.po_number || "Process PO" })),
    [ordersQ.data],
  );

  const lookupQ = useQuery({
    queryKey: ["production-verify-lookup", submittedPoNumber],
    enabled: Boolean(submittedPoNumber),
    queryFn: async () => {
      const result = await listProcessOrders({ po_number: submittedPoNumber, per_page: 10 });
      const options = Array.isArray(result) ? result : result?.data ?? [];
      const match = options.find((order) => String(order.po_number || "").toUpperCase() === submittedPoNumber.toUpperCase()) ?? null;
      if (!match?.id) return { match: null, blockedMessage: "Process PO not found." };
      const blockedMessage = validateVerifyPoStatus(match.status);
      return { match, blockedMessage };
    },
  });

  const detailQ = useQuery({
    queryKey: ["production-verify-detail", activeOrderId],
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
    queryKey: ["production-verify-availability-preview", companyId, activeOrderId, debouncedPreviewRows],
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
    if (!po || po.status !== "FINAL") return;
    setSaving(true);
    try {
      const payloadLines = rows.map((row) => {
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
      const verifiedQty = rows.reduce((sum, row) => sum + computeRowValues(row).actual, 0);
      await verifyProcessOrder(po.id, {
        verified_qty: verifiedQty,
        lines: payloadLines,
      });
      toast("Process PO verified and stock posted.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-verify-detail", po.id] });
    } catch (error) {
      toast(error.message || "Verify failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const outputApprovedQty = rows.reduce((sum, row) => sum + computeRowValues(row).apApproved, 0);
  const outputActualQty = rows.reduce((sum, row) => sum + computeRowValues(row).actual, 0);
  const outputVariance = outputActualQty - outputApprovedQty;

  return (
    <ErpScreenScaffold
      title="Production PO Verify - PR12"
      subtitle="QA verification and stock posting"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
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
                emptyStateLabel={ordersQ.isLoading ? "Loading process orders..." : "No FINAL process POs"}
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
        <ErpSectionCard title="PR12 Verify">
          {po.status !== "FINAL" ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This Process PO is blocked for Verify. Only `FINAL` is allowed.
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
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? "Posting..." : "Save & Post Stock"}
                </button>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Input</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] border-collapse text-sm">
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
                        <th className="border-b px-3 py-2 text-center">Delete</th>
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
                                disabled={actualMaterialOptions.length <= 1}
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
                            <td className="px-3 py-2">
                              {values.autoYes && row.id && row.is_formulation_line ? (
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
                            <td className="px-3 py-2 text-right font-mono">{values.variance.toFixed(3)}</td>
                            <td className="px-3 py-2">P261</td>
                            <td className="px-3 py-2 text-center">
                              {!row.is_formulation_line && (
                                <button
                                  onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
                                  className="text-sm font-medium text-rose-600 hover:underline"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
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
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
