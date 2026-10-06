/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/ReturnableTransferPage.jsx
 * Domain: PROCUREMENT / PO12 Tab 2
 * Purpose: PO12 Tab 2 — Returnable Material Transfer. 3 sub-tabs: Transfer | Receive |
 *          Report. Design: docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) — Tab 1 Design" ->
 *          "Tab 2 ... FINAL DESIGN LOCKED" (2026-10-05).
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { pushToast } from "../../../../store/uiToast.js";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { listMaterials, listStorageLocations } from "../../om/omApi.js";
import {
  createReturnableTransfer,
  getOutstandingReturnableBalance,
  getReturnableTransfer,
  listPendingReturnableTransfers,
  listReturnableTransferLedger,
  listTransferGroupPartners,
  receiveReturnableTransfer,
} from "../procurementApi.js";

const MATERIAL_TYPES = [
  { value: "RM", label: "RM" },
  { value: "PM", label: "PM" },
  { value: "INT", label: "INT" },
  { value: "SFG", label: "SFG" },
  { value: "FG", label: "FG" },
];

const SUB_TABS = [
  { value: "transfer", label: "Transfer" },
  { value: "receive", label: "Receive" },
  { value: "report", label: "Report" },
];

const ERRORS = {
  RETURNABLE_TRANSFER_GROUP_REQUIRED: "These two companies are not in a common active Transfer Group.",
  INSUFFICIENT_STOCK: "Insufficient unrestricted stock on one of the lines.",
  RETURNABLE_TRANSFER_PI_BLOCKED: "A line is under an active Physical Inventory count.",
  RETURNABLE_TRANSFER_NO_LINES: "Add at least one line.",
};

function friendly(code) {
  return ERRORS[code] ?? code ?? "Request failed.";
}

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "0.000";
}

function createEmptyLine() {
  return { material_type: "RM", material_id: "", external_code: "", source_storage_location_id: "", quantity: "", uom_code: "" };
}

function TransferLineRow({ line, companyId, onChange, onRemove }) {
  const materialsQuery = useQuery({
    queryKey: ["rt-materials", companyId, line.material_type],
    queryFn: () => listMaterials({ company_id: companyId, material_type: line.material_type, status: "ACTIVE", limit: 500 }),
    enabled: Boolean(companyId && line.material_type),
    select: (result) => (Array.isArray(result) ? result : result?.data ?? []),
  });
  const slocQuery = useQuery({
    queryKey: ["rt-slocs", companyId],
    queryFn: () => listStorageLocations({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (result) => (Array.isArray(result) ? result : result?.data ?? []),
  });

  const materialOptions = (materialsQuery.data ?? []).map((material) => ({
    value: material.id, label: `${material.pace_code ?? ""} - ${material.material_name ?? ""}`.trim(),
  }));
  const slocOptions = (slocQuery.data ?? []).map((sloc) => ({ value: sloc.id, label: `${sloc.code ?? ""} - ${sloc.name ?? ""}`.trim() }));

  function handleMaterialChange(materialId) {
    const material = (materialsQuery.data ?? []).find((entry) => entry.id === materialId);
    onChange({
      ...line,
      material_id: materialId,
      external_code: material?.external_code ?? "",
      uom_code: material?.base_uom_code ?? line.uom_code,
    });
  }

  return (
    <tr className="border-b border-slate-200">
      <td className="p-1">
        <select
          value={line.material_type}
          onChange={(event) => onChange({ ...line, material_type: event.target.value, material_id: "", external_code: "" })}
          className="h-8 w-full border border-slate-300 bg-white px-1 text-xs"
        >
          {MATERIAL_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
      </td>
      <td className="p-1" style={{ minWidth: "220px" }}>
        <ErpComboboxField value={line.material_id} onChange={handleMaterialChange} options={materialOptions} blankLabel="Select item" />
      </td>
      <td className="p-1 text-xs text-slate-600">{line.external_code || "—"}</td>
      <td className="p-1" style={{ minWidth: "180px" }}>
        <ErpComboboxField
          value={line.source_storage_location_id}
          onChange={(value) => onChange({ ...line, source_storage_location_id: value })}
          options={slocOptions}
          blankLabel="Select location"
        />
      </td>
      <td className="p-1">
        <input
          value={line.quantity}
          onChange={(event) => onChange({ ...line, quantity: event.target.value })}
          className="h-8 w-24 border border-slate-300 bg-white px-2 text-xs text-right"
        />
      </td>
      <td className="p-1 text-xs text-slate-600">{line.uom_code || "—"}</td>
      <td className="p-1">
        <button type="button" onClick={onRemove} className="border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700">
          Remove
        </button>
      </td>
    </tr>
  );
}

function TransferTab({ companyId }) {
  const qc = useQueryClient();
  const [toCompanyId, setToCompanyId] = useState("");
  const [isReturn, setIsReturn] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState([createEmptyLine()]);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);

  const partnersQuery = useQuery({
    queryKey: ["rt-partners", companyId],
    queryFn: () => listTransferGroupPartners(companyId),
    enabled: Boolean(companyId),
  });
  const partnerOptions = Array.isArray(partnersQuery.data) ? partnersQuery.data : [];

  const representativeMaterialId = lines.find((line) => line.material_id)?.material_id ?? "";
  const balanceQuery = useQuery({
    queryKey: ["rt-balance", toCompanyId, companyId, representativeMaterialId, isReturn],
    queryFn: () => getOutstandingReturnableBalance(toCompanyId, companyId, representativeMaterialId),
    enabled: isReturn && Boolean(toCompanyId && companyId && representativeMaterialId),
  });

  function updateLine(index, nextLine) {
    setLines((current) => current.map((line, i) => (i === index ? nextLine : line)));
  }
  function removeLine(index) {
    setLines((current) => current.filter((_, i) => i !== index));
  }
  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  async function handlePost() {
    setError("");
    const payloadLines = lines
      .filter((line) => line.material_id && line.source_storage_location_id && Number(line.quantity) > 0)
      .map((line) => ({
        material_id: line.material_id, material_type: line.material_type,
        source_storage_location_id: line.source_storage_location_id,
        quantity: Number(line.quantity), uom_code: line.uom_code || "KG",
      }));
    if (!toCompanyId || payloadLines.length === 0) {
      setError("Select a To Company and at least one complete line.");
      return;
    }
    setPosting(true);
    try {
      const result = await createReturnableTransfer({
        from_company_id: companyId, to_company_id: toCompanyId, is_return: isReturn, remarks, lines: payloadLines,
      });
      pushToast({ tone: "success", message: `Transfer ${result?.transfer_number ?? ""} posted.` });
      setLines([createEmptyLine()]);
      setRemarks("");
      await qc.invalidateQueries({ queryKey: ["rt-balance"] });
    } catch (postError) {
      setError(friendly(postError?.code ?? postError?.message));
    } finally {
      setPosting(false);
    }
  }

  return (
    <ErpSectionCard eyebrow="Transfer" title="Post a returnable transfer">
      {error ? <div className="mb-3 text-xs font-semibold text-rose-700">{error}</div> : null}
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          To Company <span className="text-rose-500">*</span>
          <ErpComboboxField value={toCompanyId} onChange={setToCompanyId} options={partnerOptions} blankLabel="Select partner company" />
        </label>
        <label className="flex items-center gap-2 pt-5 text-sm text-slate-800">
          <input type="checkbox" checked={isReturn} onChange={(event) => setIsReturn(event.target.checked)} />
          Return (against outstanding balance)
        </label>
        {isReturn && toCompanyId && representativeMaterialId ? (
          <div className="pt-5 text-xs font-semibold text-amber-700">
            Outstanding: {formatNumber(balanceQuery.data?.outstanding_qty)}
          </div>
        ) : null}
      </div>
      {partnerOptions.length === 0 ? (
        <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No Transfer Group partner found for this company — ask SA to add it to a "PTO Company" group first.
        </div>
      ) : null}
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-300 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="p-1">Item Type</th>
            <th className="p-1">Item</th>
            <th className="p-1">External Code</th>
            <th className="p-1">Storage Location</th>
            <th className="p-1">Quantity</th>
            <th className="p-1">UOM</th>
            <th className="p-1"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <TransferLineRow
              key={index}
              line={line}
              companyId={companyId}
              onChange={(next) => updateLine(index, next)}
              onRemove={() => removeLine(index)}
            />
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={addLine} className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
          + Add Row
        </button>
      </div>
      <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-700">
        Remarks
        <input value={remarks} onChange={(event) => setRemarks(event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm" />
      </label>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void handlePost()}
          disabled={posting}
          className="h-9 border border-sky-700 bg-sky-100 px-5 text-xs font-semibold uppercase tracking-[0.12em] text-sky-950 disabled:opacity-50"
        >
          {posting ? "Posting..." : "Post Transfer"}
        </button>
      </div>
    </ErpSectionCard>
  );
}

function ReceiveDetail({ transferId, companyId, onReceived }) {
  const detailQuery = useQuery({ queryKey: ["rt-detail", transferId], queryFn: () => getReturnableTransfer(transferId) });
  const [targetByLine, setTargetByLine] = useState({});
  const [error, setError] = useState("");
  const [receiving, setReceiving] = useState(false);

  const slocQuery = useQuery({
    queryKey: ["rt-slocs", companyId],
    queryFn: () => listStorageLocations({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (result) => (Array.isArray(result) ? result : result?.data ?? []),
  });
  const slocOptions = (slocQuery.data ?? []).map((sloc) => ({ value: sloc.id, label: `${sloc.code ?? ""} - ${sloc.name ?? ""}`.trim() }));

  const lines = detailQuery.data?.lines ?? [];

  async function handleReceive() {
    setError("");
    const payloadLines = lines
      .map((line) => ({ line_id: line.id, target_storage_location_id: targetByLine[line.id] }))
      .filter((line) => line.target_storage_location_id);
    if (payloadLines.length !== lines.length) {
      setError("Pick a storage location for every line.");
      return;
    }
    setReceiving(true);
    try {
      await receiveReturnableTransfer(transferId, { lines: payloadLines });
      pushToast({ tone: "success", message: "Received." });
      await onReceived();
    } catch (receiveError) {
      setError(friendly(receiveError?.code ?? receiveError?.message));
    } finally {
      setReceiving(false);
    }
  }

  return (
    <div className="mt-3 border border-slate-200 p-3">
      {error ? <div className="mb-2 text-xs font-semibold text-rose-700">{error}</div> : null}
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-300 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="p-1">Item</th>
            <th className="p-1">External Code</th>
            <th className="p-1">Quantity</th>
            <th className="p-1">UOM</th>
            <th className="p-1">Your Storage Location</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-slate-200">
              <td className="p-1">{line.material_label}</td>
              <td className="p-1">{line.external_code || "—"}</td>
              <td className="p-1">{formatNumber(line.quantity)}</td>
              <td className="p-1">{line.uom_code}</td>
              <td className="p-1" style={{ minWidth: "200px" }}>
                <ErpComboboxField
                  value={targetByLine[line.id] ?? ""}
                  onChange={(value) => setTargetByLine((current) => ({ ...current, [line.id]: value }))}
                  options={slocOptions}
                  blankLabel="Select location"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void handleReceive()}
          disabled={receiving}
          className="h-9 border border-emerald-700 bg-emerald-100 px-5 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-950 disabled:opacity-50"
        >
          {receiving ? "Receiving..." : "Received"}
        </button>
      </div>
    </div>
  );
}

function ReceiveTab({ companyId }) {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState(null);
  const pendingQuery = useQuery({
    queryKey: ["rt-pending", companyId],
    queryFn: () => listPendingReturnableTransfers(companyId),
    enabled: Boolean(companyId),
    select: (result) => (Array.isArray(result) ? result : result?.data ?? []),
  });
  const rows = pendingQuery.data ?? [];

  async function refresh() {
    setExpandedId(null);
    await qc.invalidateQueries({ queryKey: ["rt-pending", companyId] });
  }

  return (
    <ErpSectionCard eyebrow="Receive" title={`Pending receivables (${rows.length})`}>
      <ErpDenseGrid
        columns={[
          { key: "transfer_number", label: "Transfer #", width: "160px" },
          { key: "transfer_date", label: "Date", width: "110px" },
          { key: "from_company_label", label: "From", width: "220px" },
          { key: "is_return", label: "Return?", width: "80px", render: (row) => (row.is_return ? "Yes" : "No") },
          {
            key: "action", label: "Action", width: "100px",
            render: (row) => (
              <button type="button" onClick={() => setExpandedId((current) => (current === row.id ? null : row.id))} className="border border-sky-300 px-2 py-1 text-[11px] font-semibold text-sky-700">
                {expandedId === row.id ? "Hide" : "Open"}
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage={pendingQuery.isLoading ? "Loading..." : "No pending receivable."}
        maxHeight="min(320px, 40vh)"
      />
      {expandedId ? <ReceiveDetail transferId={expandedId} companyId={companyId} onReceived={refresh} /> : null}
    </ErpSectionCard>
  );
}

function ReportTab({ companyId }) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const ledgerQuery = useQuery({
    queryKey: ["rt-ledger", companyId, search, dateFrom, dateTo],
    queryFn: () => listReturnableTransferLedger({ company_id: companyId, search, date_from: dateFrom, date_to: dateTo }),
    enabled: Boolean(companyId),
    select: (result) => (Array.isArray(result) ? result : result?.data ?? []),
  });
  const rows = ledgerQuery.data ?? [];
  const columns = [
    { key: "transfer_date", label: "Transfer Date", width: "110px" },
    { key: "material_label", label: "Material", width: "220px" },
    { key: "external_code", label: "External Code", width: "120px" },
    { key: "from_company_label", label: "From", width: "180px" },
    { key: "to_company_label", label: "To", width: "180px" },
    { key: "quantity", label: "Qty", width: "100px", render: (row) => formatNumber(row.quantity) },
    { key: "uom_code", label: "UOM", width: "80px" },
    { key: "is_return", label: "Return?", width: "80px", render: (row) => (row.is_return ? "Yes" : "No") },
    { key: "status", label: "Status", width: "100px" },
  ];

  return (
    <ErpSectionCard eyebrow="Report" title="Returnable Transfer Ledger">
      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all columns..." className="h-8 border border-slate-300 bg-white px-2 text-sm md:col-span-2" />
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-sm" />
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-sm" />
      </div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => downloadCsvFile({ fileName: "returnable-transfer-ledger.csv", columns, rows })}
          className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Export Excel
        </button>
      </div>
      <ErpDenseGrid
        columns={columns}
        rows={rows}
        rowKey={(row, index) => `${row.transfer_number}-${index}`}
        emptyMessage={ledgerQuery.isLoading ? "Loading..." : "No transfer history."}
        maxHeight="calc(100vh - 420px)"
      />
    </ErpSectionCard>
  );
}

export default function ReturnableTransferPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext));
  const [subTab, setSubTab] = useState("transfer");

  const sectionsByTab = useMemo(() => ({
    transfer: <TransferTab companyId={companyId} />,
    receive: <ReceiveTab companyId={companyId} />,
    report: <ReportTab companyId={companyId} />,
  }), [companyId]);

  return (
    <ErpScreenScaffold eyebrow="Procurement" title="Returnable Material Transfer">
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
      </div>
      <div className="mb-3 flex gap-1.5">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setSubTab(tab.value)}
            className={`h-8 border px-4 text-xs font-semibold uppercase tracking-[0.1em] ${subTab === tab.value ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {companyId ? sectionsByTab[subTab] : <div className="text-sm text-slate-500">Select a company to begin.</div>}
    </ErpScreenScaffold>
  );
}
