/*
 * File-Path: frontend/src/pages/dashboard/production/MtsPendingVerifyPage.jsx
 * Domain: PRODUCTION
 * Purpose: Read-only MTS Process PO register for documents ready for PR12
 *          Verify. Rows disappear automatically when their Process PO is
 *          verified, because the source query is FINAL-status only.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { listProcessOrders } from "./prodApi.js";

function displayMachine(row) {
  return [row.machine?.machine_code, row.machine?.machine_name].filter(Boolean).join(" - ") || "--";
}

function displayMaterial(row) {
  return [row.material?.pace_code, row.material?.material_name].filter(Boolean).join(" - ") || "--";
}

function displayBatchRange(row) {
  const from = row.batch_number_from || row.batch_number || "";
  const to = row.batch_number_to || "";
  if (from && to && from !== to) return `${from} to ${to}`;
  return from || "--";
}

const COLUMNS = [
  { key: "po_number", label: "Process PO", width: 145 },
  { key: "production_date", label: "Production Date", width: 135, filterType: "date", render: (row) => row.production_date || "--" },
  { key: "shift_name", label: "Shift", width: 130, render: (row) => row.shift_name || "--" },
  { key: "machine", label: "Machine", width: 190, render: displayMachine, copyValue: displayMachine, filterValue: displayMachine },
  { key: "stroke_number", label: "Stroke", width: 110, render: (row) => row.stroke_number || "--" },
  { key: "material", label: "Prodshade / Description", width: 280, render: displayMaterial, copyValue: displayMaterial, filterValue: displayMaterial },
  { key: "batch_range", label: "Batch Range", width: 190, render: displayBatchRange, copyValue: displayBatchRange, filterValue: displayBatchRange },
  { key: "number_of_batches", label: "Batches", align: "right", width: 100, render: (row) => Number(row.number_of_batches || 0) || "--" },
  { key: "planned_qty", label: "Planned Qty (KG)", align: "right", width: 145, render: (row) => Number(row.planned_qty || 0).toLocaleString() },
  { key: "priority", label: "Priority", width: 110, render: (row) => row.priority || "NORMAL" },
  { key: "finalized_at", label: "Ready for Verify", width: 175, render: (row) => row.finalized_at ? new Date(row.finalized_at).toLocaleString() : "--" },
];

export default function MtsPendingVerifyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState(() => searchParams.get("company_id") || "");
  const [search, setSearch] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const pendingQ = useQuery({
    queryKey: ["production-mts-pending-verify", effectiveCompanyId],
    queryFn: () => listProcessOrders({
      company_id: effectiveCompanyId,
      po_type: "MTS",
      status: "FINAL",
      per_page: 100,
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const rows = useMemo(() => pendingQ.data ?? [], [pendingQ.data]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => COLUMNS.some((column) => {
      const value = column.filterValue?.(row) ?? column.copyValue?.(row) ?? row[column.key];
      return String(value ?? "").toLowerCase().includes(query);
    }));
  }, [rows, search]);

  return (
    <ErpScreenScaffold title="MTS Pending Verify List" subtitle="Read-only MTS Process POs ready for PR12 verification">
      <ErpSectionCard title="MTS Process POs awaiting Verify">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-md">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
          </div>
          <button
            type="button"
            onClick={() => navigate("/dashboard/production/po-verify")}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Production PO Verify
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <QuickFilterInput value={search} onChange={setSearch} placeholder="Search any column..." />
          <span className="text-xs text-slate-500">
            {pendingQ.isLoading ? "Loading..." : `${filteredRows.length}${search ? ` of ${rows.length}` : ""} MTS Process PO${filteredRows.length === 1 ? "" : "s"} awaiting Verify`}
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          This is a read-only register. Use the Process PO number to open the correct document in PR12. Rows disappear automatically after Verify. Use column funnels, Excel-style cell navigation, range selection, and Ctrl+C to filter and copy.
        </p>
        <ErpDenseGrid
          columns={COLUMNS}
          rows={filteredRows}
          rowKey={(row) => row.id}
          cellNavigate
          rangeSelect
          columnFilter
          stickyFirstColumn
          fitColumnWidths
          virtualize
          maxHeight="calc(100vh - 330px)"
          emptyMessage={pendingQ.isLoading ? "Loading pending MTS Process POs..." : search ? "No MTS Process PO matches this search." : "No MTS Process PO is pending Verify."}
        />
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
