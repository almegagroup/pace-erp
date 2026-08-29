/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DO01CreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: DO (Delivery Order, TX SO03) §133.12 unified redesign — 3-page
 *          wizard. Page 1: Add SO / Add STO (repeatable — a DO is per
 *          VEHICLE and can carry lines from multiple SO/STO documents,
 *          §133.12). Page 2: consolidated item list — RM/PM/INT lines
 *          sharing a material merge into one row; SFG/FG never merge
 *          (batch/Packing-PO committed). Merged rows can be split across
 *          multiple storage locations; which underlying source feeds which
 *          location is resolved FIFO (business-owner-confirmed rule,
 *          2026-08-28) in buildFinalLines() at submit time — never guessed
 *          per-row in the UI. Page 3: vehicle/transporter header, Save.
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
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreenWithContext, popScreen, openScreen } from "../../../../navigation/screenStackEngine.js";
import { isRouteAllowed } from "../../../../router/routeIndex.js";
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

const MERGEABLE_TYPES = new Set(["RM", "PM", "INT"]);
const QTY_TOL = 0.0001;

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
function SourceDocumentDrawer({ visible, sourceType, companyId, onClose, onPick }) {
  const [search, setSearch] = useState("");
  const [noExactMatch, setNoExactMatch] = useState(false);
  const query = useQuery({
    queryKey: ["procurement", "do01-source-documents", sourceType, companyId],
    queryFn: () => listDOSourceDocuments({ source_type: sourceType, company_id: companyId }),
    enabled: visible,
  });
  const allItems = Array.isArray(query.data?.items) ? query.data.items : [];
  const normalizedSearch = search.trim().toLowerCase();
  const items = normalizedSearch
    ? allItems.filter((item) => String(item.document_number || "").toLowerCase().includes(normalizedSearch))
    : allItems;

  function handleSearchKeyDown(event) {
    if (event.key !== "Enter") return;
    const exact = allItems.find((item) => String(item.document_number || "").toLowerCase() === normalizedSearch);
    if (exact) {
      setNoExactMatch(false);
      onPick(exact);
      setSearch("");
    } else {
      setNoExactMatch(true);
    }
  }

  return (
    <DrawerBase visible={visible} title={sourceType === "SALES_ORDER" ? "Select Sales Order" : "Select STO"} onEscape={onClose} onClose={onClose} width="min(560px, calc(100vw - 24px))">
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
              onClick={() => onPick(item)}
              className="grid grid-cols-[130px_1fr_90px] items-start gap-3 border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-sky-400 hover:bg-sky-50"
            >
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

const DO01_MERGEABLE_TYPES = new Set(["RM", "PM", "INT"]);

// Step 2 — item selection within the chosen SO/STO, grouped by FO/address
// (Dependent* dispatch types) or shown flat (Independent* / STO). Each line
// editable up to its remaining_qty (§133.12 Page 1 point 3). §133.12 point 4
// also requires RM/PM/INT to accept a manual Batch Number/Expiry Date here
// (blank allowed) and FG to let Num Packs drive the qty (still capped at
// remaining_qty) — both were missing in the first pass, fixed here.
// ErpDenseGrid + cellNavigate per §133.16-A's keyboard-first UI standard.
function SourceItemsDrawer({ visible, sourceType, sourceRef, onClose, onAdd }) {
  const isSo = sourceType === "SALES_ORDER";
  const query = useQuery({
    queryKey: ["procurement", "do01-add-options", sourceType, sourceRef?.id],
    queryFn: () => (isSo ? listDoAddSoOptions(sourceRef.id) : listDoAddStoOptions(sourceRef.id)),
    enabled: visible && Boolean(sourceRef?.id),
  });
  const groups = Array.isArray(query.data?.groups) ? query.data.groups : [];
  const [editByLine, setEditByLine] = useState({});

  function editFor(line) {
    const isFgWithPack = line.line_material_type === "FG" && toNumber(line.per_pack_qty) > 0;
    const defaultNumPacks = isFgWithPack ? Math.floor(toNumber(line.remaining_qty) / toNumber(line.per_pack_qty)) : "";
    const packingPoOptions = Array.isArray(line.packing_po_options) ? line.packing_po_options : [];
    return {
      qty: String(line.remaining_qty ?? ""),
      batch_number: line.batch_number ?? "",
      expiry_date: line.expiry_date ?? "",
      num_packs: String(defaultNumPacks || ""),
      // §133.18 — an FO-linked FG/SFG line can have several Packing POs
      // available; business owner locked (2026-08-28): manual pick, not
      // FIFO. Auto-select when there's exactly one option, otherwise leave
      // blank until the user actually picks.
      packing_order_id: packingPoOptions.length === 1 ? packingPoOptions[0].packing_order_id : "",
      ...editByLine[line.id],
    };
  }
  function updateEdit(lineId, patch) {
    setEditByLine((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));
  }

  function handleAdd(group, line) {
    const edit = editFor(line);
    const isFgWithPack = line.line_material_type === "FG" && toNumber(line.per_pack_qty) > 0;
    const packingPoOptions = Array.isArray(line.packing_po_options) ? line.packing_po_options : [];
    let selectedPko = null;
    let qty = isFgWithPack ? Number((toNumber(edit.num_packs) * toNumber(line.per_pack_qty)).toFixed(6)) : toNumber(edit.qty);
    let maxQty = toNumber(line.remaining_qty);
    if (packingPoOptions.length > 0) {
      if (!edit.packing_order_id) return; // must pick a Packing PO before adding
      selectedPko = packingPoOptions.find((option) => option.packing_order_id === edit.packing_order_id);
      if (!selectedPko) return;
      maxQty = Math.min(maxQty, toNumber(selectedPko.remaining_qty));
    }
    if (!qty || qty <= 0 || qty > maxQty + QTY_TOL) return;
    onAdd({
      __key: makeKey(),
      __groupLabel: group.label,
      __billTo: group.bill_to_display,
      __shipTo: group.ship_to_display,
      source_kind: isSo ? (line.source_kind || "SO_LINE_DIRECT") : "STO_LINE_DIRECT",
      so_line_id: isSo ? (line.source_kind === "SO_MAP_ALLOCATION" ? null : line.id) : null,
      so_map_allocation_id: isSo && line.source_kind === "SO_MAP_ALLOCATION" ? line.so_map_allocation_id : null,
      sto_line_id: !isSo ? line.id : null,
      material_id: line.material_id,
      material_display: line.material_display,
      line_material_type: line.line_material_type,
      fg_type: line.fg_type ?? null,
      // FG/SFG batch traceability follows the PO deliberately chosen for
      // this Ship-To line. RM/PM/INT remain manual/blank by design.
      batch_number: selectedPko?.batch_number ?? (DO01_MERGEABLE_TYPES.has(line.line_material_type) ? (edit.batch_number || null) : (line.batch_number ?? null)),
      expiry_date: DO01_MERGEABLE_TYPES.has(line.line_material_type) ? (edit.expiry_date || null) : (line.expiry_date ?? null),
      // §133.18 — manual Packing PO choice when the FO has more than one;
      // falls back to whatever the source line already carried (STO/direct
      // cases never have packing_po_options at all).
      packing_order_id: edit.packing_order_id || line.packing_order_id || null,
      uom_code: line.uom_code,
      maxQty,
      qty,
    });
    setEditByLine((current) => { const next = { ...current }; delete next[line.id]; return next; });
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
                  columns={[
                    { key: "material", label: "Material", render: (line) => line.material_display || line.material_id },
                    {
                      key: "packing_po",
                      label: "Packing PO",
                      width: "170px",
                      render: (line) => {
                        const options = Array.isArray(line.packing_po_options) ? line.packing_po_options : [];
                        if (options.length === 0) return "-";
                        if (options.length === 1) return <span className="font-mono text-xs">{options[0].po_number} ({options[0].batch_number})</span>;
                        const edit = editFor(line);
                        return (
                          <select value={edit.packing_order_id} onChange={(event) => updateEdit(line.id, { packing_order_id: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-1 text-xs text-slate-900 outline-none focus:border-sky-500">
                            <option value="">Select Packing PO</option>
                            {options.map((option) => (
                              <option key={option.packing_order_id} value={option.packing_order_id}>
                                {option.po_number} ({option.batch_number}) — Avail {formatFixed(option.remaining_qty)}
                              </option>
                            ))}
                          </select>
                        );
                      },
                    },
                    {
                      key: "batch",
                      label: "Batch Number",
                      width: "130px",
                      render: (line) => {
                        if (!DO01_MERGEABLE_TYPES.has(line.line_material_type)) {
                          const options = Array.isArray(line.packing_po_options) ? line.packing_po_options : [];
                          const selectedPko = options.find((option) => option.packing_order_id === editFor(line).packing_order_id);
                          return selectedPko?.batch_number || (options.length > 1 ? "Select Packing PO" : line.batch_number || "-");
                        }
                        return (
                          <input value={editFor(line).batch_number} onChange={(event) => updateEdit(line.id, { batch_number: event.target.value })} placeholder="Optional" className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                        );
                      },
                    },
                    {
                      key: "expiry",
                      label: "Expiry Date",
                      width: "140px",
                      render: (line) => {
                        if (!DO01_MERGEABLE_TYPES.has(line.line_material_type)) return "-";
                        return (
                          <input type="date" value={editFor(line).expiry_date} onChange={(event) => updateEdit(line.id, { expiry_date: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                        );
                      },
                    },
                    {
                      key: "qty",
                      label: "Qty / Num Packs",
                      width: "150px",
                      render: (line) => {
                        const isFgWithPack = line.line_material_type === "FG" && toNumber(line.per_pack_qty) > 0;
                        const edit = editFor(line);
                        if (isFgWithPack) {
                          const derivedQty = Number((toNumber(edit.num_packs) * toNumber(line.per_pack_qty)).toFixed(4));
                          return (
                            <div className="grid gap-0.5">
                              <input type="number" min="0" step="1" value={edit.num_packs} onChange={(event) => updateEdit(line.id, { num_packs: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                              <span className="font-mono text-[10px] text-slate-400">{formatFixed(derivedQty)} {line.uom_code} of {formatFixed(line.remaining_qty)}</span>
                            </div>
                          );
                        }
                        return (
                          <input type="number" min="0" max={line.remaining_qty} step="0.0001" value={edit.qty} onChange={(event) => updateEdit(line.id, { qty: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                        );
                      },
                    },
                    { key: "uom", label: "UOM", width: "70px", render: (line) => line.uom_code },
                    {
                      key: "actions",
                      label: "",
                      width: "80px",
                      render: (line) => {
                        const options = Array.isArray(line.packing_po_options) ? line.packing_po_options : [];
                        const needsChoice = options.length > 1 && !editFor(line).packing_order_id;
                        return (
                          <button type="button" disabled={needsChoice} onClick={() => handleAdd(group, line)} className="border border-sky-700 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                            Add
                          </button>
                        );
                      },
                    },
                  ]}
                  rows={group.lines}
                  rowKey={(line) => line.id}
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
// own already-saved lines: each existing line becomes its own "pick"
// (source_kind inferred from which id column is set), which Page 2's own
// grouping (merge RM/PM/INT by material, never merge SFG/FG) then
// re-derives identically to how it looked when first saved — no separate
// reconstruction logic needed. Location splits are rebuilt the same way:
// group existing lines by (group key, storage_location_id) and sum qty,
// which is exactly the inverse of how Save originally flattened them via
// FIFO, since every line still carries its own storage_location_id.
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
  const [showSoDrawer, setShowSoDrawer] = useState(false);
  const [showStoDrawer, setShowStoDrawer] = useState(false);
  const [pickingSourceRef, setPickingSourceRef] = useState(null);
  const [pickingSourceType, setPickingSourceType] = useState(null);
  const [locationSplitsByGroup, setLocationSplitsByGroup] = useState({});
  const [header, setHeader] = useState({ vehicle_number: "", lr_number: "", lr_date: "", gross_weight: "", driver_number: "", driver_contact_number: "", remarks: "" });
  const [transporterId, setTransporterId] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editSeeded, setEditSeeded] = useState(false);

  useEffect(() => {
    if (!isEditMode || editSeeded || !editQuery.data) return;
    const detail = editQuery.data;
    setCompanyId(detail.selling_company_id || "");
    const reconstructedPicks = picksFromExistingDo(detail);
    setPicks(reconstructedPicks);

    const splitsByGroup = {};
    for (const pick of reconstructedPicks) {
      const mergeable = ["RM", "PM", "INT"].includes(pick.line_material_type);
      const groupKey = mergeable ? `material:${pick.material_id}` : `pick:${pick.__key}`;
      if (!splitsByGroup[groupKey]) splitsByGroup[groupKey] = [];
      splitsByGroup[groupKey].push({ __key: makeKey(), storage_location_id: pick.__storageLocationId || "", qty: String(pick.qty) });
    }
    setLocationSplitsByGroup(splitsByGroup);

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

  const groups = useMemo(() => {
    const map = new Map();
    for (const pick of picks) {
      const mergeable = MERGEABLE_TYPES.has(pick.line_material_type);
      const key = mergeable ? `material:${pick.material_id}` : `pick:${pick.__key}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          material_id: pick.material_id,
          material_display: pick.material_display,
          line_material_type: pick.line_material_type,
          uom_code: pick.uom_code,
          mergeable,
          totalQty: 0,
          picks: [],
        });
      }
      const g = map.get(key);
      g.totalQty = Number((g.totalQty + toNumber(pick.qty)).toFixed(6));
      g.picks.push(pick);
    }
    return [...map.values()];
  }, [picks]);

  const netWeight = useMemo(() => Number(picks.reduce((sum, pick) => sum + toNumber(pick.qty), 0).toFixed(4)), [picks]);

  function assignedQtyFor(group) {
    return (locationSplitsByGroup[group.key] ?? []).reduce((sum, split) => sum + toNumber(split.qty), 0);
  }
  function addLocationSplit(group) {
    setLocationSplitsByGroup((current) => ({
      ...current,
      [group.key]: [...(current[group.key] ?? []), { __key: makeKey(), storage_location_id: "", qty: "" }],
    }));
  }
  function updateLocationSplit(groupKey, splitKey, patch) {
    setLocationSplitsByGroup((current) => ({
      ...current,
      [groupKey]: (current[groupKey] ?? []).map((split) => (split.__key === splitKey ? { ...split, ...patch } : split)),
    }));
  }
  function removeLocationSplit(groupKey, splitKey) {
    setLocationSplitsByGroup((current) => ({
      ...current,
      [groupKey]: (current[groupKey] ?? []).filter((split) => split.__key !== splitKey),
    }));
  }

  function goToPage2() {
    if (picks.length === 0) { setError("Add at least one SO/STO item first."); return; }
    setError("");
    setPage(2);
  }

  function goToPage3() {
    for (const group of groups) {
      const assigned = assignedQtyFor(group);
      if (Math.abs(assigned - group.totalQty) > QTY_TOL) {
        setError(`${group.material_display || group.material_id}: assigned ${assigned} of ${group.totalQty} across locations — must match exactly.`);
        return;
      }
      if ((locationSplitsByGroup[group.key] ?? []).some((split) => !split.storage_location_id)) {
        setError(`${group.material_display || group.material_id}: every location row needs a storage location selected.`);
        return;
      }
    }
    setError("");
    setPage(3);
  }

  // §133.12-confirmed FIFO rule (2026-08-28): a merged group's location
  // splits are filled by consuming its underlying source picks IN THE ORDER
  // THEY WERE ADDED, not proportionally or user-chosen per source. Simple,
  // deterministic, and the business owner explicitly picked this over
  // manual per-source/location control.
  function buildFinalLines() {
    const lines = [];
    for (const group of groups) {
      const queue = group.picks.map((pick) => ({ pick, remaining: toNumber(pick.qty) }));
      for (const split of locationSplitsByGroup[group.key] ?? []) {
        let need = toNumber(split.qty);
        while (need > QTY_TOL) {
          const source = queue.find((entry) => entry.remaining > QTY_TOL);
          if (!source) break;
          const take = Number(Math.min(need, source.remaining).toFixed(6));
          lines.push({
            so_line_id: source.pick.so_line_id,
            sto_line_id: source.pick.sto_line_id,
            so_map_allocation_id: source.pick.so_map_allocation_id,
            quantity: take,
            storage_location_id: split.storage_location_id,
            batch_number: source.pick.batch_number,
            expiry_date: source.pick.expiry_date,
            packing_order_id: source.pick.packing_order_id,
          });
          source.remaining = Number((source.remaining - take).toFixed(6));
          need = Number((need - take).toFixed(6));
        }
      }
    }
    return lines;
  }

  async function handleSubmit() {
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
        title={page === 1 ? `${pageLabel} — Page 1: Add SO / Add STO` : page === 2 ? `${pageLabel} — Page 2: Consolidated Items + Storage Location` : `${pageLabel} — Page 3: Vehicle & Transporter`}
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
            <ErpSectionCard eyebrow="Page 1" title="Company + add SO/STO items — one vehicle can carry lines from multiple documents (§133.12)">
              <div className="grid gap-3">
                <div className="max-w-[280px]">
                  <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={(value) => { setCompanyId(value); setPicks([]); }} label="Company" />
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={!companyId} onClick={() => setShowSoDrawer(true)} className="border border-sky-700 bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                    + Add SO
                  </button>
                  <button type="button" disabled={!companyId} onClick={() => setShowStoDrawer(true)} className="border border-sky-700 bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                    + Add STO
                  </button>
                </div>
              </div>
            </ErpSectionCard>

            <ErpSectionCard eyebrow="Picked Items" title={`${picks.length} item${picks.length === 1 ? "" : "s"} added`}>
              <ErpDenseGrid
                columns={[
                  { key: "group", label: "From", render: (row) => row.__groupLabel || "—" },
                  { key: "material_display", label: "Material", render: (row) => row.material_display || row.material_id },
                  { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number || "-" },
                  { key: "qty", label: "Qty", width: "100px", align: "right", render: (row) => `${formatFixed(row.qty)} ${row.uom_code || ""}` },
                  { key: "actions", label: "", width: "80px", render: (row) => (
                    <button type="button" onClick={() => removePick(row.__key)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
                  ) },
                ]}
                rows={picks}
                rowKey={(row) => row.__key}
                emptyMessage="No items yet — click Add SO or Add STO."
              />
            </ErpSectionCard>
          </div>
        ) : null}

        {page === 2 ? (
          <div className="grid gap-4">
            {groups.map((group) => (
              <ErpSectionCard key={group.key} eyebrow={group.mergeable ? "Merged (RM/PM/INT)" : "Not merged (SFG/FG — batch-committed)"} title={`${group.material_display || group.material_id} — ${formatFixed(group.totalQty)} ${group.uom_code}`}>
                <div className="grid gap-2">
                  {(locationSplitsByGroup[group.key] ?? []).map((split) => (
                    <LocationSplitRow key={split.__key} companyId={companyId} materialId={group.material_id} split={split} onChange={(patch) => updateLocationSplit(group.key, split.__key, patch)} onRemove={() => removeLocationSplit(group.key, split.__key)} />
                  ))}
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${Math.abs(assignedQtyFor(group) - group.totalQty) > QTY_TOL ? "text-rose-700" : "text-emerald-700"}`}>
                      Assigned {formatFixed(assignedQtyFor(group))} of {formatFixed(group.totalQty)} {group.uom_code}
                    </span>
                    <button type="button" onClick={() => addLocationSplit(group)} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950">
                      + Add Location
                    </button>
                  </div>
                </div>
              </ErpSectionCard>
            ))}
          </div>
        ) : null}

        {page === 3 ? (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="Page 3" title="Vehicle / Transporter / Weight">
              <div className="grid gap-3 md:grid-cols-3">
                <ErpDenseFormRow label="Vehicle Number">
                  <input value={header.vehicle_number} onChange={(event) => setHeader((current) => ({ ...current, vehicle_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Transporter">
                  <TransporterPicker transporterId={transporterId} transporterName={transporterName} companyId={companyId} canManageTransporters={canManageTransporters} onSelect={(t) => { setTransporterId(t.id); setTransporterName(`${t.transporter_code} — ${t.transporter_name}`); }} onClear={() => { setTransporterId(""); setTransporterName(""); }} onAddNew={handleAddTransporterToMaster} />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LR Number">
                  <input value={header.lr_number} onChange={(event) => setHeader((current) => ({ ...current, lr_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LR Date">
                  <input type="date" value={header.lr_date} onChange={(event) => setHeader((current) => ({ ...current, lr_date: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Gross Weight">
                  <input type="number" step="0.01" value={header.gross_weight} onChange={(event) => setHeader((current) => ({ ...current, gross_weight: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Net Weight (auto)">
                  <input readOnly value={formatFixed(netWeight)} className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-600 outline-none" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Driver Number">
                  <input value={header.driver_number} onChange={(event) => setHeader((current) => ({ ...current, driver_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Driver Contact Number">
                  <input value={header.driver_contact_number} onChange={(event) => setHeader((current) => ({ ...current, driver_contact_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Remarks">
                  <input value={header.remarks} onChange={(event) => setHeader((current) => ({ ...current, remarks: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          </div>
        ) : null}
      </ErpScreenScaffold>

      <SourceDocumentDrawer visible={showSoDrawer} sourceType="SALES_ORDER" companyId={companyId} onClose={() => setShowSoDrawer(false)} onPick={(item) => openSourceItemsFor("SALES_ORDER", item)} />
      <SourceDocumentDrawer visible={showStoDrawer} sourceType="STO" companyId={companyId} onClose={() => setShowStoDrawer(false)} onPick={(item) => openSourceItemsFor("STO", item)} />
      <SourceItemsDrawer
        visible={Boolean(pickingSourceRef)}
        sourceType={pickingSourceType}
        sourceRef={pickingSourceRef}
        onClose={() => setPickingSourceRef(null)}
        onAdd={(pick) => setPicks((current) => [...current, pick])}
      />
    </>
  );
}

// Page 2 — one storage-location row for a (possibly merged) item group.
function LocationSplitRow({ companyId, materialId, split, onChange, onRemove }) {
  const query = useQuery({
    queryKey: ["procurement", "do01-storage-options", companyId, materialId],
    queryFn: () => listDoStorageOptions({ company_id: companyId, material_id: materialId }),
  });
  const options = Array.isArray(query.data?.items) ? query.data.items : [];
  const selected = options.find((option) => option.storage_location_id === split.storage_location_id);

  return (
    <div className="grid grid-cols-[1fr_120px_100px_70px] items-center gap-2 border border-slate-200 bg-white px-2 py-1.5">
      <select value={split.storage_location_id} onChange={(event) => onChange({ storage_location_id: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500">
        <option value="">Select location</option>
        {options.map((option) => (
          <option key={option.storage_location_id} value={option.storage_location_id}>
            {option.location_display}{option.is_default ? " (default)" : ""} — Avail {formatFixed(option.available_qty)}
          </option>
        ))}
      </select>
      <input type="number" min="0" step="0.0001" value={split.qty} onChange={(event) => onChange({ qty: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
      <span className="text-[11px] text-slate-500">{selected ? `Avail ${formatFixed(selected.available_qty)}` : ""}</span>
      <button type="button" onClick={onRemove} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
    </div>
  );
}
