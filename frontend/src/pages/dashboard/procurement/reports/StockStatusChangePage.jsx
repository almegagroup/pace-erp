/*
 * File-Path: frontend/src/pages/dashboard/procurement/reports/StockStatusChangePage.jsx
 * Domain: PROCUREMENT / INVENTORY (Quality Assurance ACL group)
 * Purpose: IN13 Stock Status Change — SAP MB1B-equivalent single-page workbench.
 *          See feasibility doc Section 126.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useMenu } from "../../../../context/useMenu.js";
import {
  approveStockStatusChangePosting,
  getStockStatusChangeBalance,
  listStockStatusChangePostings,
  postStockStatusChange,
  reverseStockStatusChangePosting,
} from "../procurementApi.js";

const STOCK_TYPE_LABELS = {
  UNRESTRICTED: "Unrestricted",
  QUALITY_INSPECTION: "Quality inspection",
  BLOCKED: "Blocked",
};

// §126.3 — the only 6 valid transitions; Blocked -> Unrestricted needs approval.
const VALID_TRANSITIONS = {
  UNRESTRICTED: ["QUALITY_INSPECTION", "BLOCKED"],
  QUALITY_INSPECTION: ["BLOCKED", "UNRESTRICTED"],
  BLOCKED: ["QUALITY_INSPECTION", "UNRESTRICTED"],
};

function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function formatQuantity(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(3) : "—";
}

function emptyLine() {
  return {
    key: crypto.randomUUID(),
    materialId: "",
    materialLabel: "",
    storageLocationId: "",
    storageLocationLabel: "",
    batchNumber: "",
    packingPoNumber: "",
    isFg: false,
    fromStockType: "",
    toStockType: "",
    quantity: "",
    reason: "",
  };
}

export default function StockStatusChangePage() {
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext) || "");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  // Locate stock — quick lookup
  const [lookupMaterialId, setLookupMaterialId] = useState("");
  const [lookupSlocId, setLookupSlocId] = useState("");
  const [lookupBatch, setLookupBatch] = useState("");
  const [balanceQuery, setBalanceQuery] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const materialsQuery = useMaterialOptionsQuery(
    { status: "ACTIVE", company_id: effectiveCompanyId },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const slocQuery = useStorageLocationOptionsQuery({ is_active: true, limit: 1000 });

  const materialOptions = useMemo(
    () => (materialsQuery.materials ?? []).map((material) => ({
      value: material.id,
      label: `${material.pace_code ?? "—"} — ${material.material_name || material.document_name || "Material"}`,
      isFg: toTrimmedString(material.material_type).toUpperCase() === "FG",
    })),
    [materialsQuery.materials],
  );
  const slocOptions = useMemo(
    () => (slocQuery.storageLocations ?? []).map((sloc) => ({
      value: sloc.id,
      label: sloc.code ? `${sloc.code}${sloc.name ? ` — ${sloc.name}` : ""}` : (sloc.name || sloc.id),
    })),
    [slocQuery.storageLocations],
  );

  const balanceResultQuery = useQuery({
    queryKey: ["ssc-balance", balanceQuery],
    enabled: Boolean(balanceQuery),
    queryFn: () => getStockStatusChangeBalance(balanceQuery),
    select: (result) => result?.data ?? null,
  });

  function handleCheckBalance() {
    setError("");
    if (!effectiveCompanyId || !lookupMaterialId || !lookupSlocId) {
      setError("Select company, material and storage location first.");
      return;
    }
    setBalanceQuery({
      company_id: effectiveCompanyId,
      material_id: lookupMaterialId,
      storage_location_id: lookupSlocId,
      batch_number: lookupBatch || undefined,
    });
  }

  // Change status — multi-line
  const [lines, setLines] = useState([emptyLine()]);

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }
  function removeLine(key) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
  }
  function updateLine(key, patch) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  const postingsQuery = useQuery({
    queryKey: ["ssc-postings", effectiveCompanyId],
    enabled: Boolean(effectiveCompanyId),
    queryFn: () => listStockStatusChangePostings({ company_id: effectiveCompanyId }),
    select: (result) => result?.data ?? [],
  });
  const postings = Array.isArray(postingsQuery.data) ? postingsQuery.data : [];

  async function handlePostLines() {
    setError("");
    setNotice("");
    if (!effectiveCompanyId) {
      setError("Select a company first.");
      return;
    }
    for (const [index, line] of lines.entries()) {
      if (!line.materialId || !line.storageLocationId) {
        setError(`Line ${index + 1}: material and storage location are required.`);
        return;
      }
      if (line.isFg && !line.packingPoNumber) {
        setError(`Line ${index + 1}: Packing PO is required for FG.`);
        return;
      }
      if (!line.fromStockType || !line.toStockType) {
        setError(`Line ${index + 1}: pick From and To.`);
        return;
      }
      if (!Number(line.quantity) || Number(line.quantity) <= 0) {
        setError(`Line ${index + 1}: quantity must be greater than zero.`);
        return;
      }
      if (!toTrimmedString(line.reason)) {
        setError(`Line ${index + 1}: reason is required.`);
        return;
      }
    }
    try {
      await postStockStatusChange({
        company_id: effectiveCompanyId,
        lines: lines.map((line) => ({
          material_id: line.materialId,
          storage_location_id: line.storageLocationId,
          batch_number: line.batchNumber || undefined,
          packing_po_number: line.packingPoNumber || undefined,
          from_stock_type: line.fromStockType,
          to_stock_type: line.toStockType,
          quantity: Number(line.quantity),
          reason: line.reason,
        })),
      });
      setNotice(`Posted ${lines.length} line${lines.length === 1 ? "" : "s"}.`);
      setLines([emptyLine()]);
      await queryClient.invalidateQueries({ queryKey: ["ssc-postings", effectiveCompanyId] });
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "SSC_POST_FAILED");
    }
  }

  async function handleApprove(postingId) {
    setError("");
    setNotice("");
    try {
      await approveStockStatusChangePosting(postingId);
      setNotice("Approved and posted.");
      await queryClient.invalidateQueries({ queryKey: ["ssc-postings", effectiveCompanyId] });
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "SSC_APPROVE_FAILED");
    }
  }

  async function handleReverse(postingId) {
    setError("");
    setNotice("");
    const reason = window.prompt("Reason for reversing this posting?");
    if (!reason || !reason.trim()) return;
    try {
      await reverseStockStatusChangePosting(postingId, reason.trim());
      setNotice("Reversed.");
      await queryClient.invalidateQueries({ queryKey: ["ssc-postings", effectiveCompanyId] });
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "SSC_REVERSE_FAILED");
    }
  }

  const balances = balanceResultQuery.data;

  return (
    <ErpScreenScaffold
      eyebrow="Quality Assurance"
      title="Stock Status Change"
      notices={[
        ...(error ? [{ key: "ssc-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ssc-notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Locate stock" title="Quick lookup">
          <div className="grid gap-3 md:grid-cols-4">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Material</span>
              <ErpComboboxField
                value={lookupMaterialId}
                onChange={setLookupMaterialId}
                options={materialOptions}
                placeholder="Select material"
                blankLabel="Select material"
                inputClassName="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Storage Location</span>
              <ErpComboboxField
                value={lookupSlocId}
                onChange={setLookupSlocId}
                options={slocOptions}
                placeholder="Select location"
                blankLabel="Select location"
                inputClassName="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Batch</span>
              <input
                className="min-h-9 border border-slate-300 bg-white px-3 py-2 text-sm"
                value={lookupBatch}
                onChange={(event) => setLookupBatch(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleCheckBalance}
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Check balance
            </button>
          </div>
          {balances ? (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {Object.entries(STOCK_TYPE_LABELS).map(([key, label]) => (
                <div key={key} className="rounded bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">{label}</div>
                  <div className="text-base tabular-nums text-slate-900">{formatQuantity(balances[key]?.quantity)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Change status" title="Multi-line">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-left text-slate-200">
                  <th className="px-2 py-2 font-normal">Material</th>
                  <th className="px-2 py-2 font-normal">SLoc</th>
                  <th className="px-2 py-2 font-normal">Batch / PPO</th>
                  <th className="px-2 py-2 font-normal">From</th>
                  <th className="px-2 py-2 font-normal">To</th>
                  <th className="px-2 py-2 text-right font-normal">Qty</th>
                  <th className="px-2 py-2 font-normal">Reason</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const selectedMaterial = materialOptions.find((option) => option.value === line.materialId);
                  const isFg = Boolean(selectedMaterial?.isFg);
                  const toOptions = line.fromStockType ? VALID_TRANSITIONS[line.fromStockType] ?? [] : [];
                  return (
                    <tr key={line.key} className="border-t border-slate-200 odd:bg-slate-50">
                      <td className="px-2 py-1">
                        <ErpComboboxField
                          value={line.materialId}
                          onChange={(value) => {
                            const material = materialOptions.find((option) => option.value === value);
                            updateLine(line.key, {
                              materialId: value,
                              materialLabel: material?.label ?? "",
                              isFg: Boolean(material?.isFg),
                            });
                          }}
                          options={materialOptions}
                          placeholder="Select material"
                          blankLabel="Select material"
                          inputClassName="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <ErpComboboxField
                          value={line.storageLocationId}
                          onChange={(value) => updateLine(line.key, { storageLocationId: value })}
                          options={slocOptions}
                          placeholder="Select location"
                          blankLabel="Select location"
                          inputClassName="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex flex-col gap-1">
                          <input
                            className="min-h-8 w-full border border-slate-300 px-2 py-1 text-xs"
                            placeholder="Batch"
                            value={line.batchNumber}
                            onChange={(event) => updateLine(line.key, { batchNumber: event.target.value })}
                          />
                          {isFg ? (
                            <input
                              className="min-h-8 w-full border border-slate-300 px-2 py-1 text-xs"
                              placeholder="Packing PO"
                              value={line.packingPoNumber}
                              onChange={(event) => updateLine(line.key, { packingPoNumber: event.target.value })}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <ErpComboboxField
                          value={line.fromStockType}
                          onChange={(value) => updateLine(line.key, { fromStockType: value, toStockType: "" })}
                          options={Object.entries(STOCK_TYPE_LABELS).map(([key, label]) => ({ value: key, label }))}
                          placeholder="Select"
                          blankLabel="Select"
                          inputClassName="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <ErpComboboxField
                          value={line.toStockType}
                          onChange={(value) => updateLine(line.key, { toStockType: value })}
                          options={toOptions.map((key) => ({ value: key, label: STOCK_TYPE_LABELS[key] }))}
                          placeholder="Select"
                          blankLabel="Select"
                          disabled={!line.fromStockType}
                          inputClassName="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        />
                        {line.fromStockType === "BLOCKED" && line.toStockType === "UNRESTRICTED" ? (
                          <div className="mt-1 text-[10px] text-amber-700">Needs Manager approval</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          className="min-h-8 w-24 border border-slate-300 px-2 py-1 text-right text-xs"
                          placeholder={isFg ? "Packs" : "Qty"}
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          className="min-h-8 w-full border border-slate-300 px-2 py-1 text-xs"
                          value={line.reason}
                          onChange={(event) => updateLine(line.key, { reason: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          className="text-xs text-rose-700 hover:underline"
                          disabled={lines.length === 1}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={addLine}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              + Add row
            </button>
            <button
              type="button"
              onClick={() => void handlePostLines()}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              Post {lines.length} line{lines.length === 1 ? "" : "s"}
            </button>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Recent postings" title="History">
          <ErpDenseGrid
            columns={[
              { key: "movement_type_code", label: "MvT", width: "80px" },
              { key: "quantity", label: "Qty", width: "110px", align: "right", render: (row) => formatQuantity(row.quantity) },
              { key: "material", label: "Material", width: "220px" },
              { key: "batch_number", label: "Batch", width: "120px" },
              { key: "reason", label: "Reason", width: "220px" },
              { key: "created_by", label: "Posted By", width: "200px" },
              { key: "created_at", label: "Posted At", width: "170px" },
              { key: "status", label: "Status", width: "130px" },
              {
                key: "actions",
                label: "",
                width: "120px",
                render: (row) => {
                  if (row.status === "PENDING_APPROVAL") {
                    return (
                      <button
                        type="button"
                        onClick={() => void handleApprove(row.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Approve
                      </button>
                    );
                  }
                  if (row.status === "POSTED") {
                    return (
                      <button
                        type="button"
                        onClick={() => void handleReverse(row.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Reverse
                      </button>
                    );
                  }
                  return null;
                },
              },
            ]}
            rows={postings}
            rowKey={(row) => row.id}
            emptyMessage="No recent postings."
          />
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
