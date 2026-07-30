/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DOCreatePage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113 Stage 2 — Delivery Order (DO), shared by SO and STO. Flow:
 *          pick Source Type (SO/STO) → Drawer to pick the specific source
 *          document → table-row grid of lines, each added via a per-line
 *          item picker sourced from that document's own open lines
 *          (§113.10-style ErpDenseGrid, "Add Item" row-based entry) → per
 *          line Storage Location is a dropdown scoped to locations that
 *          actually carry stock for that material (never free text) → live
 *          availability check (Unrestricted − open reservations) before
 *          save. Cost Center is header-level (locked). Saving reserves
 *          stock via erp_production.reservation_document and locks the
 *          source SO/STO line.
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import {
  openScreen,
  openScreenWithContext,
  popScreen,
  getActiveScreenContext,
  updateActiveScreenContext,
} from "../../../../navigation/screenStackEngine.js";
import { isRouteAllowed } from "../../../../router/routeIndex.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { useCostCentersQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import {
  createDeliveryOrder,
  listDOSourceDocuments,
  listDOSourceLines,
  listDOStorageLocationOptions,
  listTransporters,
} from "../procurementApi.js";

function formatFixed(value, digits = 3) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "0";
}

function SourcePickerDrawer({ visible, sourceType, companyId, onClose, onPick }) {
  const query = useQuery({
    queryKey: ["procurement", "do-source-documents", sourceType, companyId],
    queryFn: () => listDOSourceDocuments({ source_type: sourceType, company_id: companyId }),
    enabled: visible,
  });
  const items = Array.isArray(query.data?.items) ? query.data.items : [];

  return (
    <DrawerBase
      visible={visible}
      title={sourceType === "SALES_ORDER" ? "Select Sales Order" : "Select Stock Transfer Order"}
      onEscape={onClose}
      onClose={onClose}
      width="min(560px, calc(100vw - 24px))"
    >
      {query.isLoading ? (
        <div className="px-2 py-6 text-sm text-slate-500">Loading open documents...</div>
      ) : items.length === 0 ? (
        <div className="px-2 py-6 text-sm text-slate-500">No open {sourceType === "SALES_ORDER" ? "sales orders" : "STOs"} with undispatched lines.</div>
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

function ItemPickerDrawer({ visible, sourceType, sourceId, alreadyAddedIds, onClose, onPick }) {
  const query = useQuery({
    queryKey: ["procurement", "do-source-lines", sourceType, sourceId],
    queryFn: () => listDOSourceLines({ source_type: sourceType, source_id: sourceId }),
    enabled: visible && Boolean(sourceId),
  });
  const items = (Array.isArray(query.data?.items) ? query.data.items : []).filter((row) => !alreadyAddedIds.has(row.id));

  return (
    <DrawerBase
      visible={visible}
      title="Add Item"
      onEscape={onClose}
      onClose={onClose}
      width="min(520px, calc(100vw - 24px))"
    >
      {query.isLoading ? (
        <div className="px-2 py-6 text-sm text-slate-500">Loading open lines...</div>
      ) : items.length === 0 ? (
        <div className="px-2 py-6 text-sm text-slate-500">No more open lines on this document.</div>
      ) : (
        <div className="grid gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              className="grid grid-cols-[1fr_130px] items-center gap-3 border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-sky-400 hover:bg-sky-50"
            >
              <span className="truncate text-slate-800">{item.material_display || item.material_id}</span>
              <span className="grid justify-items-end gap-0.5">
                <span className="font-mono text-xs font-semibold text-emerald-700">Bal {formatFixed(item.balance_qty)} {item.uom_code}</span>
                <span className="font-mono text-[10px] text-slate-400">of {formatFixed(item.quantity)} {item.uom_code} ordered</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </DrawerBase>
  );
}

export default function DOCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext, allowedRoutes } = useMenu();
  const companyId = runtimeContext?.selectedCompanyId || "";
  const canManageTransporters = isRouteAllowed(allowedRoutes ?? new Set(), "/dashboard/procurement/masters/transporters");

  // Restored after a round-trip to "Add to Transporter Master" (§113.10 bug #6
  // — Transporter must be a master pick like GRN's Transporter tab, not free
  // text; the create-new detour needs this page's own state back on return).
  const _saved = getActiveScreenContext()?.doFormValues ?? {};

  const [sourceType, setSourceType] = useState(_saved.sourceType ?? "SALES_ORDER");
  const [source, setSource] = useState(_saved.source ?? null);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [costCenterId, setCostCenterId] = useState(_saved.costCenterId ?? "");
  const [lines, setLines] = useState(_saved.lines ?? []);
  const [locationOptionsByLine, setLocationOptionsByLine] = useState(_saved.locationOptionsByLine ?? {});
  const [deliveryFields, setDeliveryFields] = useState(
    _saved.deliveryFields ?? { vehicle_number: "", lr_number: "", driver_name: "", remarks: "" }
  );
  const [transporterId, setTransporterId] = useState(_saved.transporterId ?? "");
  const [transporterName, setTransporterName] = useState(_saved.transporterName ?? "");
  const [transporterSearch, setTransporterSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const debounceRef = useRef(null);
  const [debouncedTransporterSearch, setDebouncedTransporterSearch] = useState("");
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedTransporterSearch(transporterSearch.trim()), 300);
    return () => clearTimeout(debounceRef.current);
  }, [transporterSearch]);

  const transporterQuery = useQuery({
    queryKey: ["procurement", "transporters", "do-search", debouncedTransporterSearch, companyId],
    queryFn: () => listTransporters({ search: debouncedTransporterSearch, company_id: companyId, limit: 20 }),
    enabled: debouncedTransporterSearch.length >= 2,
  });
  const transporterResults = Array.isArray(transporterQuery.data) ? transporterQuery.data : (transporterQuery.data?.data ?? transporterQuery.data?.items ?? []);

  function handleAddTransporterToMaster() {
    updateActiveScreenContext({
      doFormValues: {
        sourceType, source, costCenterId, lines, locationOptionsByLine,
        deliveryFields, transporterId, transporterName,
      },
    });
    openScreen("PROC_TRANSPORTER_MASTER");
  }

  const costCenterQuery = useCostCentersQuery({ company_id: companyId, active: true }, { enabled: Boolean(companyId) });
  const costCenterOptions = useMemo(
    () => (Array.isArray(costCenterQuery.data?.data) ? costCenterQuery.data.data : []).map((entry) => ({
      value: entry.id,
      label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
    })),
    [costCenterQuery.data?.data]
  );

  function resetSource(nextType) {
    setSourceType(nextType);
    setSource(null);
    setLines([]);
    setLocationOptionsByLine({});
  }

  function handleSourcePicked(item) {
    setSource(item);
    setLines([]);
    setLocationOptionsByLine({});
    setShowSourcePicker(false);
  }

  async function handleItemPicked(item) {
    const lineKey = item.id;
    setLines((current) => [...current, {
      source_line_id: item.id,
      material_id: item.material_id,
      material_display: item.material_display,
      uom_code: item.uom_code,
      quantity: String(item.balance_qty ?? ""),
      source_balance_qty: item.balance_qty ?? null,
      storage_location_id: "",
      available_qty: null,
    }]);
    setShowItemPicker(false);

    try {
      const result = await listDOStorageLocationOptions({ company_id: companyId, material_id: item.material_id });
      const options = Array.isArray(result?.items) ? result.items : [];
      setLocationOptionsByLine((current) => ({ ...current, [lineKey]: options }));
    } catch {
      setLocationOptionsByLine((current) => ({ ...current, [lineKey]: [] }));
    }
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index) {
    setLines((current) => current.filter((_line, lineIndex) => lineIndex !== index));
  }

  function handleLocationChange(index, storageLocationId) {
    const line = lines[index];
    const options = locationOptionsByLine[line.source_line_id] || [];
    const picked = options.find((option) => option.storage_location_id === storageLocationId);
    updateLine(index, { storage_location_id: storageLocationId, available_qty: picked ? Number(picked.on_hand_qty) : null });
  }

  async function handleSubmit() {
    if (!source || !costCenterId || lines.length === 0) {
      setError("Source document, cost center, and at least one line are required.");
      return;
    }
    if (lines.some((line) => !line.quantity || !line.storage_location_id)) {
      setError("Each line requires a quantity and a storage location.");
      return;
    }
    if (lines.some((line) => line.source_balance_qty != null && Number(line.quantity || 0) > Number(line.source_balance_qty))) {
      setError("A line's quantity exceeds the source document's remaining balance.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createDeliveryOrder({
        source_type: sourceType,
        source_id: source.id,
        cost_center_id: costCenterId,
        ...deliveryFields,
        transporter_id: transporterId || null,
        transporter_name_freetext: transporterId ? null : (transporterName || null),
        lines: lines.map((line) => ({
          source_line_id: line.source_line_id,
          quantity: Number(line.quantity),
          storage_location_id: line.storage_location_id,
        })),
      });
      setNotice("Delivery order created.");
      openScreenWithContext(OPERATION_SCREENS.PROC_DO_DETAIL.screen_code, { id: created?.id, refreshOnReturn: true });
      navigate(`/dashboard/procurement/delivery-orders/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_DO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const lineColumns = [
    { key: "material_display", label: "Material", render: (_row, index) => lines[index].material_display || lines[index].material_id },
    {
      key: "quantity",
      label: "Qty (full or partial)",
      width: "150px",
      render: (_row, index) => {
        const line = lines[index];
        const overBalance = line.source_balance_qty != null && Number(line.quantity || 0) > Number(line.source_balance_qty);
        return (
          <div className="grid gap-0.5">
            <input
              type="number"
              min="0"
              step="0.0001"
              value={line.quantity}
              onChange={(event) => updateLine(index, { quantity: event.target.value })}
              className={`h-8 w-full border bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500 ${overBalance ? "border-rose-400" : "border-slate-300"}`}
            />
            {line.source_balance_qty != null ? (
              <span className={`font-mono text-[10px] ${overBalance ? "text-rose-600" : "text-slate-400"}`}>
                of {formatFixed(line.source_balance_qty)} {line.uom_code} balance
              </span>
            ) : null}
          </div>
        );
      },
    },
    { key: "uom_code", label: "UOM", width: "70px" },
    {
      key: "storage_location_id",
      label: "Storage Location",
      width: "220px",
      render: (_row, index) => {
        const options = locationOptionsByLine[lines[index].source_line_id] || [];
        if (options.length === 0) {
          return <span className="text-xs text-slate-400">No stock at any location</span>;
        }
        return (
          <select
            value={lines[index].storage_location_id}
            onChange={(event) => handleLocationChange(index, event.target.value)}
            className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
          >
            <option value="">Select location</option>
            {options.map((option) => (
              <option key={option.storage_location_id} value={option.storage_location_id}>
                {option.location_display} ({formatFixed(option.on_hand_qty)})
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "available_qty",
      label: "On Hand",
      width: "100px",
      align: "right",
      render: (_row, index) => (lines[index].available_qty != null ? formatFixed(lines[index].available_qty) : "—"),
    },
    {
      key: "actions",
      label: "",
      width: "80px",
      render: (_row, index) => (
        <button type="button" onClick={() => removeLine(index)} className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">Remove</button>
      ),
    },
  ];

  const alreadyAddedIds = useMemo(() => new Set(lines.map((line) => line.source_line_id)), [lines]);

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Procurement"
        title="Create Delivery Order"
        actions={[
          { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
          { key: "save", label: saving ? "Saving..." : "Create DO", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || !source },
        ]}
        notices={[
          ...(error ? [{ key: "do-create-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "do-create-notice", tone: "success", message: notice }] : []),
        ]}
      >
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Source" title="Choose which order this DO dispatches — one source document per DO (§113.3)">
            <div className="grid gap-3">
              <div className="flex gap-2">
                {[{ value: "SALES_ORDER", label: "Sales Order" }, { value: "STO", label: "Stock Transfer Order" }].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => resetSource(option.value)}
                    className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${sourceType === option.value ? "border border-sky-700 bg-sky-100 text-sky-950" : "border border-slate-300 bg-white text-slate-700"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {source ? (
                <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                  <span><span className="font-mono font-semibold">{source.document_number}</span> — {source.counterparty_display || "—"}</span>
                  <button type="button" onClick={() => setShowSourcePicker(true)} className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Change</button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowSourcePicker(true)} className="w-fit border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900">
                  Select {sourceType === "SALES_ORDER" ? "Sales Order" : "STO"}
                </button>
              )}
            </div>
          </ErpSectionCard>

          {source ? (
            <>
              <ErpSectionCard eyebrow="Header" title="Cost center and delivery basics">
                <div className="grid gap-3 md:grid-cols-3">
                  <ErpDenseFormRow label="Cost Center" required>
                    <select value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                      <option value="">Select cost center</option>
                      {costCenterOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                    </select>
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Vehicle Number">
                    <input value={deliveryFields.vehicle_number} onChange={(event) => setDeliveryFields((current) => ({ ...current, vehicle_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="LR Number">
                    <input value={deliveryFields.lr_number} onChange={(event) => setDeliveryFields((current) => ({ ...current, lr_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Transporter">
                    {transporterId && transporterName ? (
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 flex-1 items-center border border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-900">{transporterName}</span>
                        <button type="button" onClick={() => { setTransporterId(""); setTransporterName(""); setTransporterSearch(""); }} className="h-8 border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600">Clear</button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Type 2+ characters to search transporter master…"
                          value={transporterSearch}
                          onChange={(event) => setTransporterSearch(event.target.value)}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        />
                        {transporterSearch.trim().length >= 2 && (
                          <div className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-52 overflow-y-auto border border-slate-200 bg-white shadow-md">
                            {transporterQuery.isLoading && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
                            {!transporterQuery.isLoading && transporterResults.length === 0 && (
                              <div className="px-3 py-2 text-xs text-slate-500">
                                No match found.
                                {canManageTransporters ? (
                                  <button type="button" onClick={handleAddTransporterToMaster} className="ml-2 text-sky-600 underline">Add to Transporter Master →</button>
                                ) : (
                                  <span className="ml-2 text-slate-400">(Contact manager to add)</span>
                                )}
                              </div>
                            )}
                            {transporterResults.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => { setTransporterId(t.id); setTransporterName(`${t.transporter_code} — ${t.transporter_name}`); setTransporterSearch(""); }}
                                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-sky-50"
                              >
                                <span className="font-mono text-[10px] text-slate-500">{t.transporter_code}</span> {t.transporter_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Driver Name">
                    <input value={deliveryFields.driver_name} onChange={(event) => setDeliveryFields((current) => ({ ...current, driver_name: event.target.value }))} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                </div>
              </ErpSectionCard>

              <ErpSectionCard
                eyebrow="Items"
                title="Full or partial qty per line — availability checked against Unrestricted minus open reservations"
                actions={[{ key: "add-item", label: "+ Add Item", tone: "primary", onClick: () => setShowItemPicker(true) }]}
              >
                <ErpDenseGrid
                  columns={lineColumns}
                  rows={lines.map((line, index) => ({ ...line, __index: index }))}
                  rowKey={(row) => row.__index}
                  emptyMessage="No items yet — click Add Item."
                />
              </ErpSectionCard>
            </>
          ) : null}
        </div>
      </ErpScreenScaffold>

      <SourcePickerDrawer
        visible={showSourcePicker}
        sourceType={sourceType}
        companyId={companyId}
        onClose={() => setShowSourcePicker(false)}
        onPick={handleSourcePicked}
      />
      <ItemPickerDrawer
        visible={showItemPicker}
        sourceType={sourceType}
        sourceId={source?.id}
        alreadyAddedIds={alreadyAddedIds}
        onClose={() => setShowItemPicker(false)}
        onPick={(item) => void handleItemPicked(item)}
      />
    </>
  );
}
