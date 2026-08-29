/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SO01MapPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: SO01 Tab 2 — SO Map. FO-based (Dependent Direct/Depot/No-Inbound)
 *          and manual-Customer-Address-based allocation of SO items.
 *          Feasibility doc §133.9 (2026-08-28). Independent Party SOs never
 *          appear in the pending list (Auto Mapped).
 * Authority: Frontend
 *
 * §8A/bug-pattern-#15 fix (2026-08-28, found during a self-audit after a
 * user challenge): the original version used useEffect+setState (forbidden
 * by CLAUDE.md §8A) AND read `.data` off every API call's result — but
 * listSoForMap/listFoOptionsForSo/listCustomerAddressesForSo all return a
 * bare array via okResponse(array, ...), and getSoMapStatus returns a bare
 * {so, lines, allocations} object — none of them nest under an extra `data`
 * key, so fetchProcurement's shape-dependent unwrap already resolves to the
 * final value. `result?.data`/`statusResult?.data`/etc. were therefore
 * always undefined, and every list on this page silently rendered empty
 * from day one. Rewritten to useQuery, reading the resolved value directly.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import {
  getSoMapStatus,
  listCustomerAddressesForSo,
  listFoOptionsForSo,
  listSoForMap,
  mapSoLineToCustomerAddress,
  mapSoLineToFo,
  unmapSoAllocation,
} from "../procurementApi.js";

function StatusPill({ status }) {
  const tone = status === "FULLY_MAPPED" ? "bg-emerald-100 text-emerald-900 border-emerald-700"
    : status === "PARTIALLY_MAPPED" ? "bg-amber-100 text-amber-900 border-amber-700"
    : "bg-slate-100 text-slate-700 border-slate-400";
  return <span className={`border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{status.replace("_", " ")}</span>;
}

function MapDrawer({ so, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const [selectedLineId, setSelectedLineId] = useState("");
  const [selectedFoId, setSelectedFoId] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [qty, setQty] = useState("");
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const statusQuery = useQuery({
    queryKey: ["procurement", "so-map-status", so.id],
    queryFn: () => getSoMapStatus(so.id),
  });
  const foQuery = useQuery({
    queryKey: ["procurement", "so-map-fo-options", so.id],
    queryFn: () => listFoOptionsForSo(so.id),
  });
  const addressQuery = useQuery({
    queryKey: ["procurement", "so-map-address-options", so.id],
    queryFn: () => listCustomerAddressesForSo(so.id),
    retry: false,
  });

  // Every one of these three resolves to its final value already (bare
  // array or bare object) — fetchProcurement's own unwrap already stripped
  // any `data` nesting, so reading `.data` again here would be the exact
  // §15 bug this rewrite fixes. Read the query result directly.
  const detail = statusQuery.data ?? null;
  const foOptions = Array.isArray(foQuery.data) ? foQuery.data : [];
  const addressOptions = Array.isArray(addressQuery.data) ? addressQuery.data : [];
  const loading = statusQuery.isLoading || foQuery.isLoading;
  const error = actionError
    || (statusQuery.error instanceof Error ? statusQuery.error.message : "")
    || (foQuery.error instanceof Error ? foQuery.error.message : "");

  async function refresh() {
    await Promise.all([statusQuery.refetch(), foQuery.refetch(), addressQuery.refetch()]);
    queryClient.invalidateQueries({ queryKey: ["procurement", "so-map-list"] });
  }

  async function handleMapToFo() {
    if (!selectedLineId || !selectedFoId || !qty) { setActionError("Select a line, an FO, and a quantity."); return; }
    setSaving(true);
    setActionError("");
    try {
      await mapSoLineToFo({
        so_id: so.id,
        so_line_id: selectedLineId,
        fo_id: selectedFoId,
        allocated_qty: Number(qty),
        sku_mismatch_confirmed: confirmMismatch,
      });
      setQty("");
      setConfirmMismatch(false);
      await refresh();
      onChanged();
    } catch (mapError) {
      const code = mapError instanceof Error ? mapError.message : "SO_MAP_FAILED";
      if (code === "SO_MAP_SKU_MISMATCH_CONFIRM_REQUIRED") {
        setActionError("This FO's material differs from the SO line's item. Check 'Confirm mismatch' and try again if this is expected.");
      } else {
        setActionError(code);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleMapToAddress() {
    if (!selectedLineId || !selectedAddressId || !qty) { setActionError("Select a line, a customer address, and a quantity."); return; }
    setSaving(true);
    setActionError("");
    try {
      await mapSoLineToCustomerAddress({
        so_id: so.id,
        so_line_id: selectedLineId,
        customer_address_id: selectedAddressId,
        allocated_qty: Number(qty),
      });
      setQty("");
      await refresh();
      onChanged();
    } catch (mapError) {
      setActionError(mapError instanceof Error ? mapError.message : "SO_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnmap(allocationId) {
    setSaving(true);
    setActionError("");
    try {
      await unmapSoAllocation(allocationId);
      await refresh();
      onChanged();
    } catch (unmapError) {
      setActionError(unmapError instanceof Error ? unmapError.message : "SO_MAP_UNMAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const lines = detail?.lines ?? [];
  const allocations = detail?.allocations ?? [];

  return (
    <DrawerBase
      visible
      title={`SO Map — ${so.so_number}`}
      onEscape={onClose}
      onClose={onClose}
      width="min(920px, calc(100vw - 24px))"
      actions={
        <button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950">
          Done
        </button>
      }
    >
      {loading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div> : null}

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">SO Lines — mapped / remaining</h4>
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "material", label: "Item", width: "160px", render: (line) => line.line_material_type },
                { key: "total", label: "Total Qty", width: "90px", align: "right", render: (line) => Number(line.total_qty ?? 0).toFixed(4) },
                { key: "mapped", label: "Mapped Qty", width: "90px", align: "right", render: (line) => Number(line.mapped_qty ?? 0).toFixed(4) },
                { key: "remaining", label: "Remaining", width: "90px", align: "right", render: (line) => Number(line.remaining_qty ?? 0).toFixed(4) },
              ]}
              rows={lines}
              rowKey={(line) => line.id}
              emptyMessage="No lines."
            />
          </div>

          <ErpSectionCard eyebrow="Map" title="Map an SO Line to an FO">
            <div className="grid gap-2 md:grid-cols-4">
              <select value={selectedLineId} onChange={(event) => setSelectedLineId(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-xs">
                <option value="">Select SO Line</option>
                {lines.map((line) => <option key={line.id} value={line.id}>{line.line_material_type} — remaining {Number(line.remaining_qty ?? 0).toFixed(2)}</option>)}
              </select>
              <select value={selectedFoId} onChange={(event) => setSelectedFoId(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-xs">
                <option value="">Select FO Number</option>
                {foOptions.map((fo) => <option key={fo.id} value={fo.id}>{fo.fo_number} — {fo.party_name} (remaining {Number(fo.remaining_qty ?? 0).toFixed(2)})</option>)}
              </select>
              <input type="number" step="0.0001" value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Qty" className="h-9 border border-slate-300 bg-[#fffef7] px-2 text-xs" />
              <button type="button" disabled={saving} onClick={() => void handleMapToFo()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50">Map to FO</button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-600">
              <input type="checkbox" checked={confirmMismatch} onChange={(event) => setConfirmMismatch(event.target.checked)} />
              Confirm mismatch (FG MTO/HPS/MTEST only — Asian sometimes declares a different SKU than what actually ships)
            </label>
            {/* §133.18 — once an FO is picked, show what it actually has available
                (material/pack/volume, from its own mapped Packing PO(s)) before the
                user commits the map, per the locked flow. */}
            {selectedFoId ? (() => {
              const selectedFo = foOptions.find((fo) => fo.id === selectedFoId);
              const details = Array.isArray(selectedFo?.packing_po_details) ? selectedFo.packing_po_details : [];
              if (details.length === 0) return null;
              return (
                <div className="mt-2 grid gap-1 border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">This FO's Packing PO(s) — material / pack / volume</div>
                  {details.map((d) => (
                    <div key={d.packing_order_id} className="grid grid-cols-[110px_1fr_90px_90px_100px] gap-2 text-[11px] text-slate-700">
                      <span className="font-mono">{d.po_number} ({d.batch_number})</span>
                      <span>{d.material_display || "—"}</span>
                      <span>{d.num_packs ?? "—"} packs</span>
                      <span>{d.fill_qty_per_pack ?? "—"} / pack</span>
                      <span>{Number(d.actual_qty_kg ?? 0).toFixed(2)} KG total</span>
                    </div>
                  ))}
                </div>
              );
            })() : null}
          </ErpSectionCard>

          {addressOptions.length > 0 ? (
            <ErpSectionCard eyebrow="Map" title="Map an SO Line to a Customer Address (no FO)">
              <div className="grid gap-2 md:grid-cols-4">
                <select value={selectedLineId} onChange={(event) => setSelectedLineId(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-xs">
                  <option value="">Select SO Line</option>
                  {lines.map((line) => <option key={line.id} value={line.id}>{line.line_material_type} — remaining {Number(line.remaining_qty ?? 0).toFixed(2)}</option>)}
                </select>
                <select value={selectedAddressId} onChange={(event) => setSelectedAddressId(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-xs">
                  <option value="">Select Customer Address</option>
                  {addressOptions.map((address) => <option key={address.id} value={address.id}>{address.site_name} — {address.town}, {address.state}</option>)}
                </select>
                <input type="number" step="0.0001" value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Qty" className="h-9 border border-slate-300 bg-[#fffef7] px-2 text-xs" />
                <button type="button" disabled={saving} onClick={() => void handleMapToAddress()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50">Map to Address</button>
              </div>
            </ErpSectionCard>
          ) : null}

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Existing Mappings</h4>
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "source", label: "Source", width: "200px", render: (row) => (row.fo_id ? `FO: ${row.fo_id}` : `Address: ${row.customer_address_id}`) },
                { key: "qty", label: "Allocated Qty", width: "100px", align: "right", render: (row) => Number(row.allocated_qty ?? 0).toFixed(4) },
                { key: "actions", label: "", width: "90px", render: (row) => (
                  <button type="button" disabled={saving} onClick={() => void handleUnmap(row.id)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Unmap</button>
                ) },
              ]}
              rows={allocations}
              rowKey={(row) => row.id}
              emptyMessage="No mappings yet."
            />
          </div>
        </div>
      )}
    </DrawerBase>
  );
}

export default function SO01MapPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [activeSo, setActiveSo] = useState(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const listQuery = useQuery({
    queryKey: ["procurement", "so-map-list", effectiveCompanyId],
    queryFn: () => listSoForMap({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
  });
  // listSoForMapHandler returns a bare array via okResponse(array, ...) —
  // fetchProcurement's unwrap already resolves to it directly (see file
  // header note); no `.data` to read off listQuery.data itself.
  const rows = Array.isArray(listQuery.data) ? listQuery.data : [];
  const loading = listQuery.isLoading;
  const error = listQuery.error instanceof Error ? listQuery.error.message : "";

  useErpScreenHotkeys({
    refresh: { disabled: loading, perform: () => void listQuery.refetch() },
  });

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Sales (SO01)"
        title="SO Map"
        notices={error ? [{ key: "so-map-error", tone: "error", message: error }] : []}
      >
        {loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading...</div>
        ) : (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Scope" title="Company">
              <div className="max-w-sm">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={companyId}
                  onChange={(value) => { setCompanyId(value); setActiveSo(null); }}
                  label="Company"
                  hint="Select the company where the dependent SO was created."
                />
              </div>
            </ErpSectionCard>
            <ErpSectionCard eyebrow="Pending" title="SOs needing mapping (Dependent Direct/Depot/No-Inbound)">
              <ErpDenseGrid
                cellNavigate
                columns={[
                  { key: "so_number", label: "SO Number", width: "140px", render: (row) => row.so_number },
                  { key: "so_date", label: "SO Date", width: "100px", render: (row) => row.so_date },
                  { key: "dispatch_type", label: "Dispatch Type", width: "180px", render: (row) => row.dispatch_type },
                  { key: "total", label: "Total Qty", width: "90px", align: "right", render: (row) => Number(row.total_qty ?? 0).toFixed(2) },
                  { key: "mapped", label: "Mapped Qty", width: "90px", align: "right", render: (row) => Number(row.mapped_qty ?? 0).toFixed(2) },
                  { key: "status", label: "Status", width: "120px", render: (row) => <StatusPill status={row.map_status} /> },
                  { key: "actions", label: "", width: "80px", render: (row) => (
                    <button type="button" onClick={() => setActiveSo(row)} className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-950">Map</button>
                  ) },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                emptyMessage="No SOs pending mapping."
              />
            </ErpSectionCard>
          </div>
        )}
      </ErpScreenScaffold>
      {activeSo ? (
        <MapDrawer so={activeSo} onClose={() => setActiveSo(null)} onChanged={() => void listQuery.refetch()} />
      ) : null}
    </>
  );
}
