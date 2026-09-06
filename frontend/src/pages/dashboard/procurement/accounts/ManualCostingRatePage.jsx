/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/ManualCostingRatePage.jsx
 * Purpose: AC08 Manual Costing Rate Entry (Accounts). Lists dispatched MTO/HPS
 *          SO lines whose Costing Rate Month is "MANUAL" -- no AC06 month rate
 *          exists for these, so Accounts hand-enters a rate per material here.
 *          Row click/Enter opens an AC01-style center drawer: RM/INT lines
 *          (SO Stroke dosage% + Actual/Production Stroke dosage% side by
 *          side, unioned like AC07), PM lines too when the SKU's pack code is
 *          599/Barrel, each with a blank manual Rate field. Save writes to
 *          erp_procurement.manual_costing_rate_entry, case-by-case per SO
 *          line -- never a shared company+material rate (business owner,
 *          explicit, 2026-09-07).
 * Authority: Frontend
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { pushToast } from "../../../../store/uiToast.js";
import { getManualCostingRow, listManualCostingRows, saveManualCostingRates } from "../procurementApi.js";

function toast(message, tone = "success") {
  pushToast({ message, tone });
}

const LIST_COLUMNS = [
  { key: "so_number", label: "SO Number", width: "120px" },
  { key: "item", label: "Item", width: "260px" },
  { key: "document_name", label: "Document Name", width: "200px", render: (r) => r.document_name || "—" },
  { key: "batch_number", label: "Batch #", width: "110px", render: (r) => r.batch_number || "—" },
  { key: "packing_po_number", label: "Packing PO #", width: "120px", render: (r) => r.packing_po_number || "—" },
  { key: "so_stroke", label: "SO Stroke", width: "90px", render: (r) => r.so_stroke || "—" },
  { key: "actual_stroke", label: "Production Stroke", width: "120px", render: (r) => r.actual_stroke || "—" },
  {
    key: "rate_status", label: "Status", width: "100px",
    render: (r) => (
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.rate_status === "STARTED" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
        {r.rate_status === "STARTED" ? "In Progress" : "Pending"}
      </span>
    ),
  },
];

export default function ManualCostingRatePage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const listQ = useQuery({
    queryKey: ["manual-costing-rows", effectiveCompanyId],
    queryFn: () => listManualCostingRows({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const rows = listQ.data ?? [];

  const [drawerSoLineId, setDrawerSoLineId] = useState("");
  const drawerOpen = Boolean(drawerSoLineId);
  const detailQ = useQuery({
    queryKey: ["manual-costing-row-detail", drawerSoLineId, effectiveCompanyId],
    queryFn: () => getManualCostingRow(drawerSoLineId, { company_id: effectiveCompanyId }),
    enabled: drawerOpen,
    // §8A checklist pattern #15 (API-client double-unwrap) -- getManualCostingRowHandler
    // returns okResponse({ data: {...} }), and fetchProcurement's own shape-dependent
    // unwrap already resolves that down to the bare detail object (no "total" key, so
    // it takes the payload.data branch) -- selecting `.data` again here always yielded
    // undefined, so `detail` stayed null forever and the drawer never left "Loading...".
    select: (data) => data ?? null,
  });
  const detail = detailQ.data ?? null;

  // material_id -> string draft value. Reseeded from the loaded detail's own
  // existing rate (if any) each time the drawer opens on a new row.
  const [draftRates, setDraftRates] = useState({});
  const [seededSoLineId, setSeededSoLineId] = useState("");
  if (detail && seededSoLineId !== drawerSoLineId) {
    const seeded = {};
    for (const row of [...detail.rm_int_rows, ...detail.pm_rows]) {
      seeded[row.material_id] = row.rate != null ? String(row.rate) : "";
    }
    setDraftRates(seeded);
    setSeededSoLineId(drawerSoLineId);
  }

  function openDrawer(row) {
    setDrawerSoLineId(row.so_line_id);
  }
  function closeDrawer() {
    setDrawerSoLineId("");
    setSeededSoLineId("");
    setDraftRates({});
  }

  const [saving, setSaving] = useState(false);
  async function handleSave() {
    if (!detail) return;
    const entries = [...detail.rm_int_rows, ...detail.pm_rows]
      .map((row) => ({ material_id: row.material_id, rate: draftRates[row.material_id] }))
      .filter((entry) => entry.rate !== "" && entry.rate != null)
      .map((entry) => ({ material_id: entry.material_id, rate: Number(entry.rate) }));
    const invalid = entries.some((entry) => !Number.isFinite(entry.rate) || entry.rate < 0);
    if (invalid) {
      toast("Every entered rate must be a valid, non-negative number.", "error");
      return;
    }
    if (entries.length === 0) {
      toast("Enter at least one rate before saving.", "error");
      return;
    }
    setSaving(true);
    try {
      await saveManualCostingRates(drawerSoLineId, { company_id: effectiveCompanyId, entries });
      toast("Rates saved.");
      await qc.invalidateQueries({ queryKey: ["manual-costing-rows", effectiveCompanyId] });
      await qc.invalidateQueries({ queryKey: ["manual-costing-row-detail", drawerSoLineId, effectiveCompanyId] });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  function fmtDosage(value) {
    return value == null ? <span className="text-slate-300">—</span> : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
  }
  function rateInput(row) {
    return (
      <input
        type="number" step="any" min="0"
        className="h-7 w-24 border border-sky-400 bg-sky-50 px-1.5 text-right font-mono text-xs font-semibold text-sky-800 outline-none"
        placeholder="0.00"
        value={draftRates[row.material_id] ?? ""}
        onChange={(e) => setDraftRates((current) => ({ ...current, [row.material_id]: e.target.value }))}
      />
    );
  }

  return (
    <ErpScreenScaffold
      eyebrow="Accounts"
      title="Manual Costing Rate Entry"
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="AC08" title="SO lines with Costing Rate Month = Manual">
          <div className="mb-3 max-w-xs">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Only dispatched MTO/HPS lines are listed — a Production Stroke has to exist to compare against. Click or press Enter on a row to open the rate-entry drawer.
          </p>
          <ErpDenseGrid
            columns={LIST_COLUMNS}
            rows={rows}
            rowKey={(row) => row.so_line_id}
            onRowActivate={openDrawer}
            emptyMessage={listQ.isLoading ? "Loading..." : "No Manual-costing rows for this company."}
          />
        </ErpSectionCard>
      </div>

      <DrawerBase
        visible={drawerOpen}
        title={detail ? `${detail.so_number} — ${detail.item}` : "Loading..."}
        onClose={closeDrawer}
        side="center"
        width="min(1100px, calc(100vw - 24px))"
        actions={
          <>
            <button type="button" onClick={() => void handleSave()} disabled={saving || !detail}
              className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={closeDrawer} className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">
              Close
            </button>
          </>
        }
      >
        {!detail || detailQ.isLoading ? (
          <p className="p-6 text-center text-sm text-slate-400">Loading...</p>
        ) : (
          <div className="grid gap-4 p-1">
            <div className="flex flex-wrap items-center gap-4 border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>Batch: <b>{detail.batch_number || "—"}</b></span>
              <span>Packing PO: <b>{detail.packing_po_number || "—"}</b></span>
              <span>SO Stroke: <b>{detail.so_stroke_number || "—"}</b>{detail.so_stroke_number && !detail.so_stroke_found ? <span className="ml-1 text-rose-600">(not in Stroke Master — dosage blank until it's added)</span> : null}</span>
              <span>Production Stroke: <b>{detail.actual_stroke_number || "—"}</b></span>
            </div>

            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">RM / INT — formulation-wise</h3>
              <ErpDenseGrid
                rowKey={(row) => row.material_id}
                rows={detail.rm_int_rows}
                maxHeight="320px"
                columns={[
                  { key: "material_type", label: "Type", width: "60px" },
                  { key: "material_name", label: "Item", width: "220px" },
                  { key: "external_code", label: "Ext. Code", width: "100px", render: (row) => row.external_code || "—" },
                  { key: "so_dosage_pct", label: "SO Stroke Dosage%", width: "130px", align: "right", render: (row) => fmtDosage(row.so_dosage_pct) },
                  { key: "actual_dosage_pct", label: "Production Stroke Dosage%", width: "150px", align: "right", render: (row) => fmtDosage(row.actual_dosage_pct) },
                  { key: "rate", label: "Rate", width: "110px", align: "right", render: rateInput },
                ]}
                emptyMessage="No RM/INT lines for either stroke."
              />
            </div>

            {detail.include_pm ? (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">PM — Pack Code 599 (Barrel)</h3>
                <ErpDenseGrid
                  rowKey={(row) => row.material_id}
                  rows={detail.pm_rows}
                  maxHeight="none"
                  columns={[
                    { key: "material_name", label: "Item", width: "220px" },
                    { key: "external_code", label: "Ext. Code", width: "100px", render: (row) => row.external_code || "—" },
                    { key: "qty_per_pack", label: "Qty / Pack", width: "100px", align: "right", render: (row) => Number(row.qty_per_pack ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 }) },
                    { key: "rate", label: "Rate", width: "110px", align: "right", render: rateInput },
                  ]}
                  emptyMessage="No PM composition available for this pack code."
                />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Pack code is {detail.pack_code || "—"} (not 599) — PM lines are not part of this entry.</p>
            )}
          </div>
        )}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
