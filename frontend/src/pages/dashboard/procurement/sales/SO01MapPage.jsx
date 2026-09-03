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

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
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
  saveSoMapGroup,
  releaseSoMapGroup,
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
  const [selectedFoId, setSelectedFoId] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [draftQtyByLine, setDraftQtyByLine] = useState({});
  const [foItemIdByLine, setFoItemIdByLine] = useState({});
  const [excludedLineIds, setExcludedLineIds] = useState([]);
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

  async function handleSaveDestination() {
    const source = selectedFoId ? "fo" : selectedAddressId ? "address" : destinationMode === "DEPOT" ? "depot" : null;
    if (!source) { setActionError("Select an FO or customer address first."); return; }
    const selectedRows = lines.filter((line) => !excludedLineIds.includes(line.id));
    if (selectedRows.length === 0) { setActionError("Select at least one SO item to map."); return; }
    const allocations = selectedRows.map((line) => {
      const enteredQty = Number(draftQtyByLine[line.id] ?? getDisplayQty(line));
      return { line, baseQty: toBaseQty(line, enteredQty) };
    });
    if (allocations.some(({ line, baseQty }) => !Number.isFinite(baseQty) || baseQty <= 0 || (line.map_quantity_mode === "PACK_QTY" && !Number(line.map_per_pack_qty)))) {
      setActionError("Every selected item needs a valid quantity and pack conversion."); return;
    }
    if (allocations.some(({ line, baseQty }) => baseQty > Number(line.remaining_qty ?? 0) + 0.0001)) {
      setActionError("A mapped item quantity cannot exceed its remaining SO quantity."); return;
    }
    if (source === "fo") {
      const selectedFo = foOptions.find((fo) => fo.id === selectedFoId);
      const selectedItems = selectedFo?.items ?? [];
      const itemForLine = (line) => selectedItems.find((item) => item.id === foItemIdByLine[line.id])
        ?? selectedItems.find((item) => item.material_id === line.material_id)
        ?? selectedItems[0];
      if (allocations.some(({ line }) => !itemForLine(line))) { setActionError("Select an FO item for every SO line."); return; }
      const qtyByItem = allocations.reduce((totals, entry) => {
        const item = itemForLine(entry.line);
        totals[item.id] = (totals[item.id] ?? 0) + entry.baseQty;
        return totals;
      }, {});
      if (Object.entries(qtyByItem).some(([itemId, qty]) => qty > Number(selectedItems.find((item) => item.id === itemId)?.available_qty ?? 0) + 0.0001)) {
        setActionError("The selected item quantities exceed an FO item's remaining balance."); return;
      }
      const strictMismatch = allocations.some(({ line }) => {
        const item = itemForLine(line);
        return line.material_id !== item.material_id && !(line.line_material_type === "FG" && ["MTO", "HPS", "MTEST"].includes(line.fg_type));
      });
      if (strictMismatch) { setActionError("This FO material does not match one or more selected SO items."); return; }
      const softMismatch = allocations.some(({ line }) => line.material_id !== itemForLine(line).material_id);
      if (softMismatch && !confirmMismatch) { setActionError("Confirm the permitted FG MTO/HPS/MTEST SKU mismatch before saving."); return; }
    }
    setSaving(true);
    setActionError("");
    try {
      const selectedItems = selectedFo?.items ?? [];
      const itemForLine = (line) => selectedItems.find((item) => item.id === foItemIdByLine[line.id])
        ?? selectedItems.find((item) => item.material_id === line.material_id)
        ?? selectedItems[0];
      await saveSoMapGroup({ so_id: so.id, source, fo_id: selectedFoId || undefined, customer_address_id: selectedAddressId || undefined, sku_mismatch_confirmed: confirmMismatch, items: allocations.map(({ line, baseQty }) => ({ so_line_id: line.id, allocated_qty: baseQty, plan_feed_item_id: source === "fo" ? itemForLine(line)?.id : undefined })) });
      setDraftQtyByLine({});
      setExcludedLineIds([]);
      setConfirmMismatch(false);
      await refresh();
      onChanged();
    } catch (mapError) {
      const code = mapError instanceof Error ? mapError.message : "SO_MAP_FAILED";
      setActionError(code === "SO_MAP_SKU_MISMATCH_CONFIRM_REQUIRED"
        ? "This FO's material differs from an SO item. Confirm the permitted FG mismatch and save again."
        : code);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditGroup(group) {
    setSaving(true); setActionError("");
    try {
      await releaseExistingMapping(group);
      if (group.fo_id) chooseFo(group.fo_id);
      else if (group.customer_address_id) chooseAddress(group.customer_address_id);
      setDraftQtyByLine(Object.fromEntries(group.rows.map((row) => [row.so_line_id, getDisplayQty({ ...lines.find((line) => line.id === row.so_line_id), remaining_qty: row.allocated_qty })])));
      setExcludedLineIds(lines.filter((line) => !group.rows.some((row) => row.so_line_id === line.id)).map((line) => line.id));
      await refresh(); onChanged();
    } catch (editError) { setActionError(editError instanceof Error ? editError.message : "SO_MAP_GROUP_EDIT_FAILED"); }
    finally { setSaving(false); }
  }

  async function releaseExistingMapping(group) {
    if (group.map_group_id) {
      await releaseSoMapGroup(group.map_group_id);
      return;
    }
    const allocationId = group.rows?.[0]?.id;
    if (!allocationId) throw new Error("SO_MAP_ALLOCATION_NOT_FOUND");
    await unmapSoAllocation(allocationId);
  }

  async function handleUnmapGroup(group) {
    const itemCount = group.rows?.length ?? 0;
    if (!window.confirm(`Unmap ${itemCount} item${itemCount === 1 ? "" : "s"} from ${group.source_display || "this destination"}? This is blocked if a Delivery Order already uses the mapping.`)) return;
    setSaving(true); setActionError("");
    try {
      await releaseExistingMapping(group);
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
  const destinationMode = detail?.destination_mode ?? "DIRECT";
  function getDisplayQty(line) {
    return line.map_quantity_mode === "PACK_QTY"
      ? Number(line.remaining_qty ?? 0) / Number(line.map_per_pack_qty || 1)
      : Number(line.remaining_qty ?? 0);
  }
  function toBaseQty(line, enteredQty) {
    return line.map_quantity_mode === "PACK_QTY" ? enteredQty * Number(line.map_per_pack_qty || 0) : enteredQty;
  }
  function chooseFo(value) {
    setSelectedFoId(value); setSelectedAddressId(""); setDraftQtyByLine({}); setFoItemIdByLine({}); setExcludedLineIds([]);
  }
  function chooseAddress(value) {
    setSelectedAddressId(value); setSelectedFoId(""); setDraftQtyByLine({}); setFoItemIdByLine({}); setExcludedLineIds([]);
  }
  function toggleLine(lineId) {
    setExcludedLineIds((current) => current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]);
  }
  const activeDestinationLabel = selectedFoId
    ? `FO ${foOptions.find((fo) => fo.id === selectedFoId)?.fo_number || ""}`
    : selectedAddressId
      ? (addressOptions.find((address) => address.id === selectedAddressId)?.site_name || "Customer Address")
      : destinationMode === "DEPOT" ? "Fixed Depot" : "";
  const selectedFo = foOptions.find((fo) => fo.id === selectedFoId);
  const selectedFoAddress = selectedFo?.customer_address_id
    ? (selectedFo.customer_address ?? null)
    : null;
  const mappingGroups = Object.values(allocations.reduce((groups, row) => {
    const key = row.map_group_id || `legacy:${row.id}`;
    if (!groups[key]) groups[key] = { ...row, rows: [] };
    groups[key].rows.push(row);
    return groups;
  }, {}));

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
              maxHeight="none"
              columns={[
                { key: "material", label: "Item", width: "300px", render: (line) => `${line.line_material_type}${line.fg_type ? ` / ${line.fg_type}` : ""} — ${line.material_display || "—"}` },
                { key: "total", label: "Total Qty", width: "90px", align: "right", render: (line) => Number(line.total_qty ?? 0).toFixed(4) },
                { key: "mapped", label: "Mapped Qty", width: "90px", align: "right", render: (line) => Number(line.mapped_qty ?? 0).toFixed(4) },
                { key: "remaining", label: "Remaining", width: "90px", align: "right", render: (line) => Number(line.remaining_qty ?? 0).toFixed(4) },
              ]}
              rows={lines}
              rowKey={(line) => line.id}
              emptyMessage="No lines."
            />
          </div>

          <ErpSectionCard eyebrow="Step 1" title={destinationMode === "DEPOT" ? "Choose an Optional FO, or map directly to the Fixed Depot" : "Choose the FO or Customer Address (Ship-To) first"}>
            <div className="grid gap-2 md:grid-cols-2">
              <ErpComboboxField
                value={selectedFoId}
                onChange={(value) => chooseFo(value)}
                options={foOptions.map((fo) => ({
                  value: fo.id,
                  label: `${fo.fo_number} — ${fo.party_name} (remaining ${Number(fo.remaining_qty ?? 0).toFixed(2)} KG)`,
                }))}
                placeholder="Select FO Number"
              />
              {destinationMode === "DIRECT" ? <select value={selectedAddressId} onChange={(event) => chooseAddress(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-xs"><option value="">No FO: select Customer Address</option>{addressOptions.map((address) => <option key={address.id} value={address.id}>{address.site_name} — {address.town}, {address.state}</option>)}</select> : <p className="self-center text-xs text-slate-600">No FO required: the Page 2 Depot is the fixed Ship-To.</p>}
            </div>
            {selectedFo ? <p className="mt-3 text-xs text-slate-600">FO Ship-To: {selectedFoAddress ? [selectedFoAddress.site_name, selectedFoAddress.address_line, selectedFoAddress.town, selectedFoAddress.state].filter(Boolean).join(", ") : "Address will resolve from this FO."}</p> : null}
            {selectedFo ? <div className="mt-3 overflow-x-auto border border-slate-300"><table className="w-full text-xs"><thead className="bg-slate-800 text-white"><tr><th className="p-2 text-left">Packing PO</th><th className="p-2 text-left">Batch</th><th className="p-2 text-left">Material</th><th className="p-2 text-right">Packs</th><th className="p-2 text-right">Qty / Pack</th><th className="p-2 text-right">FO-linked Volume</th><th className="p-2 text-right">Base Volume</th></tr></thead><tbody>{(selectedFo.packing_po_details ?? []).map((packingPo) => <tr key={packingPo.packing_order_id} className="border-t border-slate-200"><td className="p-2 font-mono">{packingPo.po_number || "-"}</td><td className="p-2 font-mono">{packingPo.batch_number || "-"}</td><td className="p-2">{packingPo.material_display || "-"}</td><td className="p-2 text-right">{Number(packingPo.num_packs ?? 0).toFixed(0)}</td><td className="p-2 text-right">{Number(packingPo.fill_qty_per_pack ?? 0).toFixed(4)}</td><td className="p-2 text-right">{Number(packingPo.allocated_qty_kg ?? 0).toFixed(4)} KG</td><td className="p-2 text-right">{Number(packingPo.actual_qty_kg ?? 0).toFixed(4)} KG</td></tr>)}</tbody></table>{(selectedFo.packing_po_details ?? []).length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">No FINAL Packing PO is linked to this FO yet.</p> : null}</div> : null}
          </ErpSectionCard>

          {(selectedFoId || selectedAddressId || destinationMode === "DEPOT") ? <ErpSectionCard eyebrow="Step 2" title={`Items for ${activeDestinationLabel}`}>
            <p className="mb-3 text-xs text-slate-600">All remaining SO items are shown. Untick an item if it will not go to this Ship-To, or change its quantity before saving.</p>
            <div className="overflow-x-auto border border-slate-300"><table className="w-full text-xs"><thead className="bg-slate-800 text-white"><tr><th className="p-2 text-left">Map</th><th className="p-2 text-left">SO Item</th>{selectedFoId ? <th className="p-2 text-left">FO Item / Available</th> : null}<th className="p-2 text-right">Remaining KG</th><th className="p-2 text-left">Quantity for this Ship-To</th></tr></thead><tbody>{lines.map((line) => {
              const excluded = excludedLineIds.includes(line.id);
              const displayQty = draftQtyByLine[line.id] ?? getDisplayQty(line);
              const matchedFoItem = selectedFo?.items?.find((item) => item.id === foItemIdByLine[line.id]) ?? selectedFo?.items?.find((item) => item.material_id === line.material_id) ?? selectedFo?.items?.[0];
              return <tr key={line.id} className="border-t border-slate-200"><td className="p-2"><input type="checkbox" checked={!excluded} onChange={() => toggleLine(line.id)} /></td><td className="p-2">{line.material_display || line.line_material_type}<div className="text-[10px] text-slate-500">{line.map_quantity_mode === "PACK_QTY" ? `${line.map_uom}; ${Number(line.map_per_pack_qty || 0).toFixed(4)} KG per pack` : line.map_uom}</div></td>{selectedFoId ? <td className="p-2"><select disabled={excluded} value={foItemIdByLine[line.id] ?? matchedFoItem?.id ?? ""} onChange={(event) => setFoItemIdByLine((current) => ({ ...current, [line.id]: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-1"><option value="">Select FO item</option>{(selectedFo?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.sku || item.description || "Item"} ({Number(item.available_qty ?? 0).toFixed(4)} KG)</option>)}</select></td> : null}<td className="p-2 text-right">{Number(line.remaining_qty ?? 0).toFixed(4)}</td><td className="p-2"><input disabled={excluded} type="number" min="0" step="0.0001" value={displayQty} onChange={(event) => setDraftQtyByLine((current) => ({ ...current, [line.id]: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 disabled:bg-slate-100" /></td></tr>;
            })}</tbody></table></div>
            {selectedFoId ? <label className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-600"><input type="checkbox" checked={confirmMismatch} onChange={(event) => setConfirmMismatch(event.target.checked)} />Confirm SKU mismatch only for FG MTO/HPS/MTEST.</label> : null}
            <button type="button" disabled={saving} onClick={() => void handleSaveDestination()} className="mt-3 border border-sky-700 bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50">Save {activeDestinationLabel} Mapping</button>
          </ErpSectionCard> : null}

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Existing Mappings</h4>
            <ErpDenseGrid
              cellNavigate
              maxHeight="none"
              columns={[
                { key: "source", label: "Destination", width: "280px", render: (group) => group.source_display || "Mapping destination" },
                { key: "qty", label: "Items / Qty", width: "140px", align: "right", render: (group) => `${group.rows.length} / ${group.rows.reduce((sum, row) => sum + Number(row.allocated_qty ?? 0), 0).toFixed(4)}` },
                { key: "actions", label: "", width: "150px", render: (row) => (
                  <div className="flex justify-end gap-1">
                    <button type="button" disabled={saving} onClick={() => void handleEditGroup(row)} className="border border-sky-300 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 disabled:opacity-50">Edit</button>
                    <button type="button" disabled={saving} onClick={() => void handleUnmapGroup(row)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Unmap</button>
                  </div>
                ) },
              ]}
              rows={mappingGroups}
              rowKey={(row) => row.map_group_id || row.id}
              emptyMessage="No mappings yet."
            />
          </div>
        </div>
      )}
    </DrawerBase>
  );
}

const SO_MAP_COLUMNS = [
  { key: "so_number", label: "SO Number", width: "140px", render: (row) => row.so_number },
  { key: "customer_po_number", label: "External SO Number", width: "150px", render: (row) => row.customer_po_number || "—" },
  { key: "so_date", label: "SO Date", width: "100px", render: (row) => row.so_date },
  { key: "dispatch_type", label: "Dispatch Type", width: "180px", render: (row) => row.dispatch_type },
  { key: "total", label: "Total Qty", width: "90px", align: "right", render: (row) => Number(row.total_qty ?? 0).toFixed(2) },
  { key: "mapped", label: "Mapped Qty", width: "90px", align: "right", render: (row) => Number(row.mapped_qty ?? 0).toFixed(2) },
  { key: "status", label: "Status", width: "120px", render: (row) => <StatusPill status={row.map_status} />, copyValue: (row) => row.map_status },
];

// Business owner ask (2026-09-03), same pattern as every other report this
// session — reuses copyValue when present so a JSX-rendered cell (Status)
// still filters against plain text.
function getColumnFilterText(column, row) {
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
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
  const rows = useMemo(() => (Array.isArray(listQuery.data) ? listQuery.data : []), [listQuery.data]);
  const loading = listQuery.isLoading;
  const error = listQuery.error instanceof Error ? listQuery.error.message : "";

  const [globalSearch, setGlobalSearch] = useState("");
  const globalSearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of rows) {
      for (const column of SO_MAP_COLUMNS) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
  }, [rows]);
  const hasActiveSearch = globalSearch.trim().length > 0;
  const filteredRows = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => SO_MAP_COLUMNS.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
  }, [rows, globalSearch]);

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
              <div className="mb-2 flex items-center gap-2">
                <input
                  list="so-map-search-options"
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Search across every column..."
                  className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
                />
                <datalist id="so-map-search-options">
                  {globalSearchOptions.map((option) => <option key={option} value={option} />)}
                </datalist>
                {hasActiveSearch ? (
                  <button type="button" onClick={() => setGlobalSearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                    Clear
                  </button>
                ) : null}
                {hasActiveSearch ? (
                  <span className="text-xs text-slate-500">{filteredRows.length} of {rows.length} SOs</span>
                ) : null}
              </div>
              <ErpDenseGrid
                cellNavigate
                columns={[
                  ...SO_MAP_COLUMNS,
                  { key: "actions", label: "", width: "80px", render: (row) => (
                    <button type="button" onClick={() => setActiveSo(row)} className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-950">Map</button>
                  ) },
                ]}
                rows={filteredRows}
                rowKey={(row) => row.id}
                emptyMessage={hasActiveSearch ? "No rows match this search." : "No SOs pending mapping."}
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
