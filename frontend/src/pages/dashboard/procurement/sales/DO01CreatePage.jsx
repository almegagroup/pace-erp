/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DO01CreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: DO (Delivery Order, TX SO03) §133.12 unified redesign — 3-page
 *          wizard. Page 1: Add SO / Add STO (repeatable — a DO is per
 *          VEHICLE and can carry lines from multiple SO/STO documents,
 *          §133.12). Page 2: choose source documents. Page 3: choose only
 *          SO Map-refined lines, then adjust every selected source line's
 *          truck quantity and storage location directly in the dense grid.
 *          The pre-redesign DOCreatePage.jsx (single source per DO) is left
 *          on disk untouched, same additive pattern as SO01.
 * Authority: Frontend
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreenWithContext, popScreen, openScreen } from "../../../../navigation/screenStackEngine.js";
import { isRouteAllowed } from "../../../../router/routeIndex.js";
import { getManualDocumentDateBounds, isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../../../utils/manualDocumentDateWindow.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createDeliveryOrderUnified,
  getDeliveryOrderUnified,
  listDOSourceDocuments,
  listDoAddSoOptions,
  listDoAddStoOptions,
  listDoStorageOptions,
  listTransporters,
  updateDeliveryOrderUnified,
} from "../procurementApi.js";

const QTY_TOL = 0.0001;
const MANUAL_DATE_BOUNDS = getManualDocumentDateBounds();
const TRUCK_EXPORT_COLUMNS = [
  { key: "__groupLabel", label: "FO / Customer Address" },
  { key: "__billTo", label: "Bill-To" },
  { key: "__shipTo", label: "Ship-To" },
  { key: "material_display", label: "Material" },
  { key: "packing_order_number", label: "Packing PO" },
  { key: "document_name", label: "Document Name" },
  { key: "prodshade_display", label: "Prod Shade" },
  { key: "actual_stroke", label: "Actual Stroke" },
  { key: "packing_code", label: "Pack Code" },
  { key: "batch_number", label: "Batch" },
  { key: "expiry_date", label: "Expiry" },
  { key: "pack_uom_code", label: "Pack UOM" },
  { key: "pack_qty", label: "Pack Qty" },
  { key: "per_pack_qty", label: "Per Pack" },
  { key: "uom_code", label: "Base UOM" },
  { key: "base_qty", label: "Base Volume" },
  { key: "qty", label: "Truck Base Qty" },
];

function formatFixed(value, digits = 3) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "0";
}
function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
function makeKey() {
  return Math.random().toString(36).slice(2);
}

function AddressCell({ value }) {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return "—";
  return <span className="block whitespace-normal leading-4">{parts.map((part, index) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 ? <br /> : null}</span>)}</span>;
}

// Transporter search + "Add to Transporter Master" — copied from
// DOCreatePage.jsx (§113), unchanged. Kept local rather than shared since
// it's tightly coupled to this page's own state shape (transporterId/Name).
function TransporterPicker({ transporterId, transporterName, onSelect, onClear, companyId, canManageTransporters, onAddNew }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [panelRect, setPanelRect] = useState(null);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const open = debouncedSearch.length >= 2;
  const transporterQuery = useQuery({
    queryKey: ["procurement", "transporters", "do01-search", debouncedSearch, companyId],
    queryFn: () => listTransporters({ search: debouncedSearch, company_id: companyId, limit: 20 }),
    enabled: open,
  });
  const results = Array.isArray(transporterQuery.data) ? transporterQuery.data : (transporterQuery.data?.data ?? transporterQuery.data?.items ?? []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function updateRect() {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPanelRect({ top: rect.bottom, left: rect.left, width: rect.width });
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  if (transporterId && transporterName) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-8 flex-1 items-center border border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-900">{transporterName}</span>
        <button type="button" onClick={onClear} className="h-8 border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600">Clear</button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        placeholder="Type 2+ characters to search transporter master…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
      />
      {open && panelRect &&
        createPortal(
          <div
            style={{ position: "fixed", top: panelRect.top, left: panelRect.left, width: panelRect.width, zIndex: 1000200 }}
            className="max-h-52 overflow-y-auto border border-slate-400 bg-white shadow-md"
          >
            {transporterQuery.isLoading && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
            {!transporterQuery.isLoading && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">
                No match found.
                {canManageTransporters ? (
                  <button type="button" onClick={onAddNew} className="ml-2 text-sky-600 underline">Add to Transporter Master →</button>
                ) : (
                  <span className="ml-2 text-slate-400">(Contact manager to add)</span>
                )}
              </div>
            )}
            {results.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onSelect(t); setSearch(""); }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-sky-50"
              >
                <span className="font-mono text-[10px] text-slate-500">{t.transporter_code}</span> {t.transporter_name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// Step 1 of "Add SO"/"Add STO" — browse open documents (§113's existing
// SourcePickerDrawer discovery mechanism, reused as-is — a browsable list
// satisfies the same workflow as "type the SO number").
// §133.12 Page 1 point 1 ("SO Number দিলে") — type the exact number + Enter
// jumps straight to that document (calls onPick immediately, no extra click
// through the list); typing a partial number just filters the list as
// before. Both paths read the same already-fetched open-document list —
// exact-match resolution is a pure client-side lookup, no extra round trip.
function SourceDocumentDrawer({ visible, sourceType, companyId, selectedIds, onToggle, onConfirm, onClose }) {
  const [search, setSearch] = useState("");
  const [noExactMatch, setNoExactMatch] = useState(false);
  const query = useQuery({
    queryKey: ["procurement", "do01-source-documents", sourceType, companyId],
    queryFn: () => listDOSourceDocuments({ source_type: sourceType, company_id: companyId }),
    enabled: visible,
  });
  const allItems = Array.isArray(query.data?.items) ? query.data.items : [];
  const normalizedSearch = search.trim().toLowerCase();
  // Customer PO Number is often what the dispatcher actually has in hand
  // (not PACE's own SO number) -- reference_display already reads
  // "Customer PO <number>", so a plain substring match against it covers
  // both a bare number and the full label.
  const items = normalizedSearch
    ? allItems.filter((item) => String(item.document_number || "").toLowerCase().includes(normalizedSearch)
        || String(item.reference_display || "").toLowerCase().includes(normalizedSearch))
    : allItems;

  function handleSearchKeyDown(event) {
    if (event.key !== "Enter") return;
    const exact = allItems.find((item) => String(item.document_number || "").toLowerCase() === normalizedSearch
      || String(item.reference_display || "").toLowerCase().replace(/^customer po\s*/, "").trim() === normalizedSearch);
    if (exact) {
      setNoExactMatch(false);
      onToggle(exact);
      setSearch("");
    } else {
      setNoExactMatch(true);
    }
  }

  return (
    <DrawerBase visible={visible} title={sourceType === "SALES_ORDER" ? "Select Sales Orders" : "Select STOs"} onEscape={onClose} onClose={onClose} width="min(620px, calc(100vw - 24px))"
      actions={<button type="button" onClick={onConfirm} className="border border-sky-700 bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white">Use selected</button>}>
      <input
        type="text"
        value={search}
        onChange={(event) => { setSearch(event.target.value); setNoExactMatch(false); }}
        onKeyDown={handleSearchKeyDown}
        placeholder={sourceType === "SALES_ORDER" ? "Type SO Number + Enter to jump directly, or partial text to filter…" : "Type STO Number + Enter to jump directly, or partial text to filter…"}
        className="mb-1 h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
        autoFocus
      />
      {noExactMatch ? (
        <div className="mb-2 text-xs text-rose-700">No open document matches that exact number — pick from the filtered list below, or check the number.</div>
      ) : (
        <div className="mb-3" />
      )}
      {query.isLoading ? (
        <div className="px-2 py-6 text-sm text-slate-500">Loading open documents...</div>
      ) : items.length === 0 ? (
        <div className="px-2 py-6 text-sm text-slate-500">
          {normalizedSearch ? "No document matches that number." : `No open ${sourceType === "SALES_ORDER" ? "sales orders" : "STOs"} with undispatched lines.`}
        </div>
      ) : (
        <div className="grid gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item)}
              className={`grid grid-cols-[24px_130px_1fr_90px] items-start gap-3 border px-3 py-2 text-left text-sm ${selectedIds.has(item.id) ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:border-sky-400 hover:bg-sky-50"}`}
            >
              <span className="mt-0.5 flex h-4 w-4 items-center justify-center border border-slate-400 text-[10px] text-sky-800">{selectedIds.has(item.id) ? "✓" : ""}</span>
              <span className="grid gap-0.5">
                <span className="font-mono font-semibold text-slate-800">{item.document_number}</span>
                <span className="text-xs text-slate-500">{item.document_date}</span>
              </span>
              <span className="grid gap-0.5">
                <span className="truncate text-slate-700">{item.counterparty_display || "—"}</span>
                {item.reference_display ? <span className="truncate text-xs text-slate-500">{item.reference_display}</span> : null}
              </span>
              <span className="justify-self-end rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600">{item.status}</span>
            </button>
          ))}
        </div>
      )}
    </DrawerBase>
  );
}

// Item selection only chooses an SO Map/STO source for the truck. Quantity,
// storage, and optional manual batch details are intentionally decided in the
// picked-items grid so the picker never changes the SO Map allocation.
//
// §133.18 "balance barrel" -- one FO/material line can legitimately draw from
// MORE THAN ONE Packing PO batch (e.g. 2 barrels off PO-A + rest off PO-B).
// A line with >1 linked Packing PO used to render as ONE row with a nested
// dropdown -- pick one PO, Add, and the whole line was marked "Added",
// permanently hiding the other PO's own balance even though it was still
// legitimately available. Found live 2026-09-02 (business owner, FO
// 5157405986 split across two Packing POs whose Avail figures summed
// exactly to the line's own Mapped Qty). Fixed: each linked Packing PO now
// becomes its OWN addable row, sharing the line's Mapped Qty as one combined
// budget across siblings (picking from one leaves correspondingly less on
// the others) -- never more than that line's own Mapped Qty in total.
function SourceItemsDrawer({ visible, sourceType, sourceRef, picks, onClose, onAdd }) {
  const isSo = sourceType === "SALES_ORDER";
  const query = useQuery({
    queryKey: ["procurement", "do01-add-options", sourceType, sourceRef?.id],
    queryFn: () => (isSo ? listDoAddSoOptions(sourceRef.id) : listDoAddStoOptions(sourceRef.id)),
    enabled: visible && Boolean(sourceRef?.id),
  });
  const groups = Array.isArray(query.data?.groups) ? query.data.groups : [];

  function lineSourceKey(line) {
    return line.source_kind === "SO_MAP_ALLOCATION"
      ? `allocation:${line.so_map_allocation_id}`
      : `${sourceType}:${line.id}`;
  }

  // Already-picked quantity and row identity, both keyed off the underlying
  // FO/material line (not the specific Packing PO) so the shared budget
  // above accounts for everything already added from ANY sibling PO row.
  const pickedQtyByLineKey = new Map();
  const pickedRowKeys = new Set();
  for (const pick of picks) {
    const lineKey = pick.so_map_allocation_id ? `allocation:${pick.so_map_allocation_id}` : `${pick.__sourceType}:${pick.so_line_id || pick.sto_line_id}`;
    pickedQtyByLineKey.set(lineKey, (pickedQtyByLineKey.get(lineKey) ?? 0) + toNumber(pick.qty));
    pickedRowKeys.add(`${lineKey}::${pick.packing_order_id || "none"}`);
  }

  function expandLine(line) {
    const options = Array.isArray(line.packing_po_options) ? line.packing_po_options : [];
    const lineKey = lineSourceKey(line);
    const lineBudget = Math.max(0, toNumber(line.remaining_qty) - (pickedQtyByLineKey.get(lineKey) ?? 0));
    if (options.length <= 1) {
      const option = options[0] ?? null;
      return [{
        ...line,
        __rowKey: `${lineKey}::${option?.packing_order_id || "none"}`,
        __option: option,
        __maxQty: option ? Math.min(lineBudget, toNumber(option.remaining_qty)) : lineBudget,
      }];
    }
    // Found live 2026-09-02, same session as the split-into-rows fix above:
    // Pack Qty/Base Qty here used to stay the LINE's own total (e.g. 87
    // barrels for the whole 20010 KG FO need) on every sibling row, even
    // though each row now represents ONE specific Packing PO whose own
    // available pack count differs (44 vs 43) -- misleadingly showing the
    // same "87" next to two different "Packing PO Avail" figures. Each
    // row's Pack Qty/Base Qty now matches its OWN Packing PO's balance.
    const perPackQty = toNumber(line.per_pack_qty);
    return options.map((option) => ({
      ...line,
      __rowKey: `${lineKey}::${option.packing_order_id}`,
      __option: option,
      __maxQty: Math.min(lineBudget, toNumber(option.remaining_qty)),
      pack_qty: perPackQty > 0 ? Number((toNumber(option.remaining_qty) / perPackQty).toFixed(6)) : line.pack_qty,
      base_qty: toNumber(option.remaining_qty),
    }));
  }

  function handleAdd(group, row) {
    const option = row.__option;
    const maxQty = row.__maxQty;
    if (maxQty <= QTY_TOL) return;
    onAdd({
      __key: makeKey(),
      __groupLabel: group.label,
      __billTo: group.bill_to_display,
      __shipTo: group.ship_to_display,
      __sourceId: sourceRef.id,
      __sourceType: sourceType,
      source_kind: isSo ? (row.source_kind || "SO_LINE_DIRECT") : "STO_LINE_DIRECT",
      so_line_id: isSo ? (row.source_kind === "SO_MAP_ALLOCATION" ? null : row.id) : null,
      so_map_allocation_id: isSo && row.source_kind === "SO_MAP_ALLOCATION" ? row.so_map_allocation_id : null,
      sto_line_id: !isSo ? row.id : null,
      material_id: row.material_id,
      material_display: row.material_display,
      line_material_type: row.line_material_type,
      fg_type: row.fg_type ?? null,
      batch_number: option?.batch_number || row.batch_number || null,
      expiry_date: null,
      packing_order_id: option?.packing_order_id || row.packing_order_id || null,
      packing_order_number: option?.po_number || null,
      document_name: option?.document_name || null,
      prodshade_display: option?.prodshade_display || null,
      actual_stroke: option?.actual_stroke || null,
      process_order_number: option?.process_order_number || null,
      packing_code: option?.packing_code || null,
      uom_code: row.uom_code,
      pack_uom_code: row.pack_uom_code || null,
      pack_qty: row.pack_qty ?? null,
      per_pack_qty: row.per_pack_qty ?? null,
      base_qty: row.base_qty ?? row.remaining_qty,
      maxQty,
      qty: maxQty,
    });
  }

  return (
    <DrawerBase visible={visible} title={sourceRef ? `${sourceRef.document_number} — pick items` : "Pick items"} onEscape={onClose} onClose={onClose} width="min(900px, calc(100vw - 24px))">
      {query.isLoading ? (
        <div className="px-2 py-6 text-sm text-slate-500">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="px-2 py-6 text-sm text-slate-500">No open lines with remaining balance.</div>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group.key} className="grid gap-2 border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{group.label}</div>
              {(group.bill_to_display || group.ship_to_display) && (
                <div className="text-xs text-slate-600">
                  {group.bill_to_display ? <span>Bill-To: {group.bill_to_display}</span> : null}
                  {group.ship_to_display && group.ship_to_display !== group.bill_to_display ? <span className="ml-3">Ship-To: {group.ship_to_display}</span> : null}
                </div>
              )}
              {(group.lines ?? []).length === 0 ? (
                <div className="text-xs text-slate-400">Nothing left to add from this group.</div>
              ) : (
                <ErpDenseGrid
                  cellNavigate
                  fitColumnWidths
                  columns={[
                    { key: "material", label: "Material", width: "180px", render: (row) => row.material_display || row.material_id },
                    { key: "packing_po", label: "Packing PO", width: "140px", render: (row) => row.__option ? <span className="font-mono text-xs">{row.__option.po_number}</span> : "-" },
                    { key: "batch", label: "Batch Number", width: "120px", render: (row) => row.__option?.batch_number || row.batch_number || "-" },
                    { key: "po_avail", label: "Packing PO Avail", width: "120px", render: (row) => row.__option ? `${formatFixed(row.__option.remaining_qty)} ${row.uom_code}` : "-" },
                    { key: "mapped_qty", label: "Mapped Qty", width: "110px", render: (row) => `${formatFixed(row.remaining_qty)} ${row.uom_code}` },
                    { key: "pack_uom", label: "Pack UOM", width: "85px", render: (row) => row.pack_uom_code || "-" },
                    { key: "pack_qty", label: "Pack Qty", width: "90px", render: (row) => formatFixed(row.pack_qty) },
                    { key: "per_pack", label: "Per Pack", width: "90px", render: (row) => formatFixed(row.per_pack_qty) },
                    { key: "base_qty", label: "Base Qty", width: "100px", render: (row) => `${formatFixed(row.base_qty ?? row.remaining_qty)} ${row.uom_code}` },
                    { key: "prodshade", label: "Prod Shade", width: "130px", render: (row) => row.__option?.prodshade_display || "-" },
                    { key: "stroke", label: "Stroke", width: "80px", render: (row) => row.__option?.actual_stroke || "-" },
                    {
                      key: "actions",
                      label: "",
                      width: "80px",
                      render: (row) => {
                        const alreadyPicked = pickedRowKeys.has(row.__rowKey);
                        const disabled = alreadyPicked || row.__maxQty <= QTY_TOL;
                        return (
                          <button type="button" disabled={disabled} onClick={() => handleAdd(group, row)} className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                            {alreadyPicked ? "Added" : "Add"}
                          </button>
                        );
                      },
                    },
                  ]}
                  rows={(group.lines ?? []).flatMap(expandLine)}
                  rowKey={(row) => row.__rowKey}
                  emptyMessage="Nothing left to add from this group."
                />
              )}
            </div>
          ))}
        </div>
      )}
    </DrawerBase>
  );
}

// §133.12 Edit — a DO can be edited freely pre-PGI. Rather than a separate
// UI, this reopens the exact same 3-page wizard pre-seeded from the DO's
// own already-saved lines: each existing line becomes its own picked row,
// preserving its source, batch, Packing PO, quantity and storage location.
function picksFromExistingDo(detail) {
  return (detail.lines ?? []).map((line) => ({
    __key: `existing-${line.id}`,
    __groupLabel: line.material_display || line.material_id,
    __billTo: null,
    __shipTo: null,
    so_line_id: line.so_line_id ?? null,
    so_map_allocation_id: line.so_map_allocation_id ?? null,
    sto_line_id: line.sto_line_id ?? null,
    material_id: line.material_id,
    material_display: line.material_display,
    line_material_type: line.line_material_type,
    fg_type: null,
    batch_number: line.batch_number ?? null,
    expiry_date: line.expiry_date ?? null,
    packing_order_id: line.packing_order_id ?? null,
    uom_code: line.uom_code,
    maxQty: Number(line.quantity ?? 0),
    qty: Number(line.quantity ?? 0),
    __storageLocationId: line.storage_location_id ?? null,
  }));
}

export default function DO01CreatePage() {
  const navigate = useNavigate();
  const { id: editDcId } = useParams();
  const { runtimeContext, allowedRoutes } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const canManageTransporters = isRouteAllowed(allowedRoutes ?? new Set(), "/dashboard/procurement/masters/transporters");
  const isEditMode = Boolean(editDcId);

  const editQuery = useQuery({
    queryKey: ["procurement", "do01-edit-source", editDcId],
    queryFn: () => getDeliveryOrderUnified(editDcId),
    enabled: isEditMode,
  });

  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [picks, setPicks] = useState([]);
  const [selectedSources, setSelectedSources] = useState([]);
  const [showSoDrawer, setShowSoDrawer] = useState(false);
  const [showStoDrawer, setShowStoDrawer] = useState(false);
  const [pickingSourceRef, setPickingSourceRef] = useState(null);
  const [pickingSourceType, setPickingSourceType] = useState(null);
  const [header, setHeader] = useState({ vehicle_number: "", lr_number: "", lr_date: "", gross_weight: "", driver_number: "", driver_contact_number: "", remarks: "" });
  const [transporterId, setTransporterId] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [saving, setSaving] = useState(false);
  const [truckSearch, setTruckSearch] = useState("");
  const [exportingTruckRows, setExportingTruckRows] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editSeeded, setEditSeeded] = useState(false);

  useEffect(() => {
    if (!isEditMode || editSeeded || !editQuery.data) return;
    const detail = editQuery.data;
    setCompanyId(detail.selling_company_id || "");
    const reconstructedPicks = picksFromExistingDo(detail);
    setPicks(reconstructedPicks);
    setSelectedSources((detail.sources ?? []).map((source) => ({
      id: source.source_id,
      document_number: source.document_number,
      document_date: source.document_date,
      counterparty_display: source.party_display,
      status: "SELECTED",
      source_type: source.source_type,
    })));


    setHeader({
      vehicle_number: detail.vehicle_number || "",
      lr_number: detail.lr_number || "",
      lr_date: detail.lr_date || "",
      gross_weight: detail.gross_weight ?? "",
      driver_number: detail.driver_number || "",
      driver_contact_number: detail.driver_contact_number || "",
      remarks: detail.remarks || "",
    });
    setTransporterId(detail.transporter_id || "");
    setTransporterName(detail.transporter_display || "");
    setEditSeeded(true);
  }, [isEditMode, editSeeded, editQuery.data]);

  function handleAddTransporterToMaster() {
    openScreen("PROC_TRANSPORTER_MASTER");
  }

  function removePick(key) {
    setPicks((current) => current.filter((pick) => pick.__key !== key));
  }

  const netWeight = useMemo(() => Number(picks.reduce((sum, pick) => sum + toNumber(pick.qty), 0).toFixed(4)), [picks]);
  // Found live 2026-09-02 (business owner) -- a truck with multiple lines
  // (e.g. two Packing POs off the same FO) had no running total of how many
  // packs/how much base qty had been set across the whole truck, only a
  // per-line qty. totalPacks sums every pack-driven line's live Truck
  // Packs count (qty ÷ its own per_pack_qty) -- deliberately a plain count
  // across materials, since the truck-loading question is "how many
  // barrels/packs total," not per-material.
  const totalPacks = useMemo(() => Number(picks.reduce((sum, pick) => (
    isPackDrivenFg(pick) && toNumber(pick.per_pack_qty) > 0 ? sum + toNumber(pick.qty) / toNumber(pick.per_pack_qty) : sum
  ), 0).toFixed(3)), [picks]);
  const visiblePicks = useMemo(() => {
    const query = truckSearch.trim().toLowerCase();
    if (!query) return picks;
    return picks.filter((pick) => Object.values(pick).some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [picks, truckSearch]);

  function updatePick(key, patch) {
    setPicks((current) => current.map((pick) => (pick.__key === key ? { ...pick, ...patch } : pick)));
  }

  function goToPage2() {
    if (!companyId) { setError("Select a company first."); return; }
    setError("");
    setPage(2);
  }

  function goToPage3() {
    if (selectedSources.length === 0) { setError("Select at least one SO or STO for this truck."); return; }
    setError("");
    setPage(3);
  }

  function toggleSource(sourceType, source) {
    const exists = selectedSources.some((item) => item.source_type === sourceType && item.id === source.id);
    if (exists) {
      removeSource(sourceType, source.id);
      return;
    }
    setSelectedSources((current) => [...current, { ...source, source_type: sourceType }]);
  }

  function removeSource(sourceType, sourceId) {
    setSelectedSources((current) => current.filter((source) => !(source.source_type === sourceType && source.id === sourceId)));
    setPicks((current) => current.filter((pick) => !(pick.__sourceType === sourceType && pick.__sourceId === sourceId)));
  }

  function selectedIdsFor(sourceType) {
    return new Set(selectedSources.filter((source) => source.source_type === sourceType).map((source) => source.id));
  }

  function validateFinalSelection() {
    if (picks.length === 0) { setError("Choose at least one mapped SO/STO item for this truck."); return false; }
    for (const pick of picks) {
      const qty = toNumber(pick.qty);
      if (qty <= QTY_TOL || qty > toNumber(pick.maxQty) + QTY_TOL) {
        setError(`${pick.material_display || pick.material_id}: truck quantity must be greater than zero and cannot exceed ${formatFixed(pick.maxQty)} ${pick.uom_code}.`);
        return false;
      }
      if (!pick.storage_location_id && !pick.__storageLocationId) {
        setError(`${pick.material_display || pick.material_id}: select a storage location for every picked row.`);
        return false;
      }
    }
    return true;
  }

  function buildFinalLines() {
    return picks.map((pick) => ({
      so_line_id: pick.so_line_id,
      sto_line_id: pick.sto_line_id,
      so_map_allocation_id: pick.so_map_allocation_id,
      quantity: toNumber(pick.qty),
      storage_location_id: pick.storage_location_id || pick.__storageLocationId,
      batch_number: pick.batch_number || null,
      expiry_date: pick.expiry_date || null,
      packing_order_id: pick.packing_order_id || null,
    }));
  }

  async function exportTruckRows() {
    setExportingTruckRows(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `do_truck_items_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: "DO Truck Items",
        columns: TRUCK_EXPORT_COLUMNS,
        rows: visiblePicks,
        getCellValue: (row, column) => row?.[column.key] ?? "",
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "DO_TRUCK_ITEMS_EXPORT_FAILED");
    } finally {
      setExportingTruckRows(false);
    }
  }

  async function handleSubmit() {
    if (!validateFinalSelection()) return;
    if (header.lr_date && !isManualDocumentDateWithinWindow(header.lr_date)) {
      setError(MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        company_id: companyId,
        lines: buildFinalLines(),
        vehicle_number: header.vehicle_number || null,
        transporter_id: transporterId || null,
        transporter_name_freetext: transporterId ? null : (transporterName || null),
        lr_number: header.lr_number || null,
        lr_date: header.lr_date || null,
        gross_weight: header.gross_weight === "" ? null : Number(header.gross_weight),
        driver_number: header.driver_number || null,
        driver_contact_number: header.driver_contact_number || null,
        remarks: header.remarks || null,
      };
      const saved = isEditMode
        ? await updateDeliveryOrderUnified(editDcId, payload)
        : await createDeliveryOrderUnified(payload);
      setNotice(isEditMode ? "Delivery order updated." : "Delivery order created.");
      const savedId = isEditMode ? editDcId : saved?.id;
      openScreenWithContext(OPERATION_SCREENS.PROC_DO_DETAIL.screen_code, { id: savedId, refreshOnReturn: true });
      navigate(`/dashboard/procurement/delivery-orders/${encodeURIComponent(savedId)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : (isEditMode ? "DO_EDIT_FAILED" : "DO_CREATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  function openSourceItemsFor(sourceType, sourceRef) {
    setPickingSourceType(sourceType);
    setPickingSourceRef(sourceRef);
    setShowSoDrawer(false);
    setShowStoDrawer(false);
  }

  const pageLabel = isEditMode ? "Edit DO" : "Create DO";
  if (isEditMode && !editSeeded) {
    return (
      <ErpScreenScaffold eyebrow="Sales (SO03)" title="Edit DO" actions={[{ key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() }]} notices={editQuery.error ? [{ key: "do01-edit-error", tone: "error", message: editQuery.error instanceof Error ? editQuery.error.message : "DO_EDIT_LOAD_FAILED" }] : []}>
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading delivery order...</div>
      </ErpScreenScaffold>
    );
  }

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Sales (SO03)"
        title={page === 1 ? `${pageLabel} — Page 1: Delivery Details` : page === 2 ? `${pageLabel} — Page 2: Select SO / STO` : `${pageLabel} — Page 3: Truck Items`}
        actions={[
          { key: "back", label: page === 1 ? "Back" : "Previous", tone: "neutral", onClick: () => (page === 1 ? popScreen() : setPage(page - 1)) },
          page === 3
            ? { key: "save", label: saving ? "Saving..." : pageLabel, tone: "primary", onClick: () => void handleSubmit(), disabled: saving }
            : { key: "next", label: "Next", tone: "primary", onClick: page === 1 ? goToPage2 : goToPage3 },
        ]}
        notices={[
          ...(error ? [{ key: "do01-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "do01-notice", tone: "success", message: notice }] : []),
        ]}
      >
        {page === 1 ? (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Page 1" title="Delivery Details — vehicle, transporter and weight">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="max-w-[280px]"><TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={(value) => { setCompanyId(value); setPicks([]); setSelectedSources([]); }} label="Company" /></div>
                <ErpDenseFormRow label="Vehicle Number"><input value={header.vehicle_number} onChange={(event) => setHeader((current) => ({ ...current, vehicle_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
                <ErpDenseFormRow label="Transporter"><TransporterPicker transporterId={transporterId} transporterName={transporterName} companyId={companyId} canManageTransporters={canManageTransporters} onSelect={(t) => { setTransporterId(t.id); setTransporterName(`${t.transporter_code} — ${t.transporter_name}`); }} onClear={() => { setTransporterId(""); setTransporterName(""); }} onAddNew={handleAddTransporterToMaster} /></ErpDenseFormRow>
                <ErpDenseFormRow label="LR Number"><input value={header.lr_number} onChange={(event) => setHeader((current) => ({ ...current, lr_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
                <ErpDenseFormRow label="LR Date"><input type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} value={header.lr_date} onChange={(event) => setHeader((current) => ({ ...current, lr_date: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
                <ErpDenseFormRow label="Gross Weight"><input type="number" step="0.01" value={header.gross_weight} onChange={(event) => setHeader((current) => ({ ...current, gross_weight: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
                <ErpDenseFormRow label="Driver Name"><input value={header.driver_number} onChange={(event) => setHeader((current) => ({ ...current, driver_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
                <ErpDenseFormRow label="Driver Contact Number"><input value={header.driver_contact_number} onChange={(event) => setHeader((current) => ({ ...current, driver_contact_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
                <ErpDenseFormRow label="Remarks"><input value={header.remarks} onChange={(event) => setHeader((current) => ({ ...current, remarks: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          </div>
        ) : null}

        {page === 2 ? (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Page 2" title="Select SO / STO for this truck">
              <p className="mb-3 text-sm text-slate-600">Choose one or more open or partially dispatched documents. Item quantities are selected only on the next page.</p>
              <div className="flex gap-2">
                <button type="button" disabled={!companyId} onClick={() => setShowSoDrawer(true)} className="border border-sky-700 bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">+ Select SO</button>
                <button type="button" disabled={!companyId} onClick={() => setShowStoDrawer(true)} className="border border-sky-700 bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">+ Select STO</button>
              </div>
            </ErpSectionCard>
            <ErpSectionCard eyebrow="Selected Documents" title={`${selectedSources.length} document${selectedSources.length === 1 ? "" : "s"} selected`}>
              <ErpDenseGrid cellNavigate fitColumnWidths columns={[
                { key: "document_number", label: "Document", width: "140px" },
                { key: "source_type", label: "Type", width: "100px", render: (row) => row.source_type === "SALES_ORDER" ? "SO" : "STO" },
                { key: "counterparty_display", label: "Customer / Receiving Company", width: "280px" },
                { key: "status", label: "Status", width: "110px" },
                { key: "remove", label: "", width: "90px", render: (row) => <button type="button" onClick={() => removeSource(row.source_type, row.id)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button> },
              ]} rows={selectedSources} rowKey={(row) => `${row.source_type}:${row.id}`} emptyMessage="Select one or more SO/STO above." />
            </ErpSectionCard>
          </div>
        ) : null}

        {page === 3 ? (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Page 3" title="Select mapped items for this truck">
              <p className="mb-3 text-sm text-slate-600">Only SO Map-refined destination lines appear. Add a mapped line here; its truck quantity and storage location are decided in the picked-items grid below.</p>
              <div className="flex flex-wrap gap-2">
                {selectedSources.map((source) => <button key={`${source.source_type}:${source.id}`} type="button" onClick={() => openSourceItemsFor(source.source_type, source)} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950">Choose items: {source.document_number}</button>)}
              </div>
            </ErpSectionCard>
            <ErpSectionCard eyebrow="Truck Items" title={`${picks.length} item${picks.length === 1 ? "" : "s"} selected`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <QuickFilterInput label="Search picked items" value={truckSearch} onChange={setTruckSearch} placeholder="FO, address, material, Packing PO, batch, shade or stroke" className="min-w-[280px] flex-1" />
                <button type="button" onClick={() => void exportTruckRows()} disabled={exportingTruckRows || visiblePicks.length === 0} className="border border-emerald-700 bg-emerald-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-emerald-950 disabled:cursor-not-allowed disabled:opacity-50">{exportingTruckRows ? "Exporting..." : "Excel Download"}</button>
              </div>
              <ErpDenseGrid cellNavigate rangeSelect stickyFirstColumn fitColumnWidths columns={[
                { key: "group", label: "FO / Customer Address", width: "145px", wrap: true, className: "whitespace-normal leading-4", render: (row) => row.__groupLabel || "—" },
                { key: "bill_to", label: "Bill-To", width: "260px", wrap: true, className: "whitespace-normal leading-4", render: (row) => <AddressCell value={row.__billTo} /> },
                { key: "ship_to", label: "Ship-To", width: "280px", wrap: true, className: "whitespace-normal leading-4", render: (row) => <AddressCell value={row.__shipTo} /> },
                { key: "material_display", label: "Material", width: "155px", wrap: true, className: "whitespace-normal leading-4", render: (row) => row.material_display || "—" },
                { key: "packing_order", label: "Packing PO", width: "125px", render: (row) => row.packing_order_number || row.packing_order_id || "-" },
                { key: "document_name", label: "Document Name", width: "155px", render: (row) => row.document_name || "-" },
                { key: "prodshade", label: "Prod Shade", width: "135px", render: (row) => row.prodshade_display || "-" },
                { key: "stroke", label: "Actual Stroke", width: "95px", render: (row) => row.actual_stroke || "-" },
                { key: "batch_number", label: "Batch", width: "120px", render: (row) => <input value={row.batch_number || ""} placeholder="Optional" onChange={(event) => updatePick(row.__key, { batch_number: event.target.value })} className="h-7 w-full border border-slate-300 bg-[#fffef7] px-1 text-xs" /> },
                { key: "expiry_date", label: "Expiry", width: "125px", render: (row) => <input type="date" value={row.expiry_date || ""} onChange={(event) => updatePick(row.__key, { expiry_date: event.target.value })} className="h-7 w-full border border-slate-300 bg-[#fffef7] px-1 text-xs" /> },
                { key: "packing_code", label: "Pack Code", width: "85px", render: (row) => row.packing_code || "-" },
                { key: "pack_uom", label: "Pack UOM", width: "80px", render: (row) => row.pack_uom_code || "-" },
                { key: "pack_qty", label: "Pack Qty", width: "80px", align: "right", render: (row) => formatFixed(row.pack_qty) },
                { key: "per_pack", label: "Per Pack", width: "85px", align: "right", render: (row) => formatFixed(row.per_pack_qty) },
                { key: "base_uom", label: "Base UOM", width: "80px", render: (row) => row.uom_code || "-" },
                { key: "base_volume", label: "Base Volume", width: "100px", align: "right", render: (row) => formatFixed(row.base_qty) },
                { key: "truck_packs", label: "Truck Packs", width: "105px", render: (row) => <TruckPacksInput row={row} onChange={(qty) => updatePick(row.__key, { qty })} /> },
                { key: "qty", label: "Truck Base Qty", width: "125px", render: (row) => <TruckBaseQtyInput row={row} onChange={(qty) => updatePick(row.__key, { qty })} /> },
                { key: "sloc", label: "Storage Location", width: "210px", render: (row) => <TruckItemLocation companyId={companyId} materialId={row.material_id} value={row.storage_location_id || row.__storageLocationId || ""} onChange={(storageLocationId) => updatePick(row.__key, { storage_location_id: storageLocationId })} /> },
                { key: "remove", label: "", width: "80px", render: (row) => <button type="button" onClick={() => removePick(row.__key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button> },
              ]} rows={visiblePicks} rowKey={(row) => row.__key} emptyMessage="Choose items from a selected SO or STO." />
            </ErpSectionCard>
            <div className="flex justify-end gap-6 text-sm text-slate-600">
              <span>Total Packs (auto): <span className="font-mono font-semibold">{formatFixed(totalPacks, 3)}</span></span>
              <span>Truck Net Weight (auto): <span className="font-mono font-semibold">{formatFixed(netWeight)}</span></span>
            </div>
          </div>
        ) : null}
      </ErpScreenScaffold>

      <SourceDocumentDrawer visible={showSoDrawer} sourceType="SALES_ORDER" companyId={companyId} selectedIds={selectedIdsFor("SALES_ORDER")} onClose={() => setShowSoDrawer(false)} onToggle={(item) => toggleSource("SALES_ORDER", item)} onConfirm={() => setShowSoDrawer(false)} />
      <SourceDocumentDrawer visible={showStoDrawer} sourceType="STO" companyId={companyId} selectedIds={selectedIdsFor("STO")} onClose={() => setShowStoDrawer(false)} onToggle={(item) => toggleSource("STO", item)} onConfirm={() => setShowStoDrawer(false)} />
      <SourceItemsDrawer
        visible={Boolean(pickingSourceRef)}
        sourceType={pickingSourceType}
        sourceRef={pickingSourceRef}
        picks={picks}
        onClose={() => setPickingSourceRef(null)}
        onAdd={(pick) => {
          setPicks((current) => [...current, pick]);
        }}
      />
    </>
  );
}

function TruckItemLocation({ companyId, materialId, value, onChange }) {
  const query = useQuery({
    queryKey: ["procurement", "do01-storage-options", companyId, materialId],
    queryFn: () => listDoStorageOptions({ company_id: companyId, material_id: materialId }),
    enabled: Boolean(companyId && materialId),
  });
  const options = Array.isArray(query.data?.items) ? query.data.items : [];

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-full border border-slate-300 bg-white px-1 text-xs text-slate-900 outline-none focus:border-sky-500">
      <option value="">Select location</option>
      {options.map((option) => (
        <option key={option.storage_location_id} value={option.storage_location_id}>
          {option.location_display}{option.is_default ? " (default)" : ""} — Avail {formatFixed(option.available_qty)}
        </option>
      ))}
    </select>
  );
}

function isPackDrivenFg(row) {
  return row.line_material_type === "FG" && ["MTO", "HPS"].includes(String(row.fg_type || "").toUpperCase()) && String(row.packing_code || "").trim() !== "000" && toNumber(row.per_pack_qty) > 0;
}

function TruckPacksInput({ row, onChange }) {
  if (!isPackDrivenFg(row)) return "-";
  const perPack = toNumber(row.per_pack_qty);
  const maxPacks = Math.floor(toNumber(row.maxQty) / perPack);
  const packs = toNumber(row.qty) / perPack;
  return (
    <input type="number" min="0" max={maxPacks} step="1" value={Number.isInteger(packs) ? packs : ""} onChange={(event) => onChange(Number((toNumber(event.target.value) * perPack).toFixed(6)))} className="h-7 w-full border border-slate-300 bg-[#fffef7] px-1 text-xs" />
  );
}

function TruckBaseQtyInput({ row, onChange }) {
  if (isPackDrivenFg(row)) return <span className="font-mono text-xs">{formatFixed(row.qty)}</span>;
  return <input type="number" min="0" max={row.maxQty} step="0.0001" value={row.qty} onChange={(event) => onChange(event.target.value)} className="h-7 w-full border border-slate-300 bg-[#fffef7] px-1 text-xs" />;
}
