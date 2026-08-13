/*
 * PIDocumentCountEntryPage — MI04, dedicated blind count-entry screen (§119.4, split out
 * 2026-08-14 per business-owner correction: SAP's MI04 never shows the system's book quantity
 * to the person doing the physical count — showing it invites the counter to just copy the
 * expected number instead of actually counting, defeating the whole point of a physical
 * inventory audit. This page intentionally never fetches or renders book_qty/difference_qty
 * anywhere, even though the underlying PID item record carries them (PIDocumentDetailPage.jsx,
 * the review/oversight page, shows those — but only after a count is already locked in, when
 * there's nothing left to bias).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { enterPICount, getPIDocument, listMaterialUomConversionsForProcurement } from "../procurementApi.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

// FG Scenario 2 (variable-fill MTO/HPS/MTEST barrels/IBCs, §UoM-2026-08-14) — no material-level
// fixed conversion exists for these (fill varies Packing PO to Packing PO, §83.14 balance-barrel),
// so the counter enters Num Pack (blind — how many barrels/containers physically found) × a
// Per-Pack Qty defaulted from that specific Packing PO's own recorded fill (that's a package
// label attribute, not a book-stock total, so prefilling it is not the same bias risk as showing
// book_qty — the counter is still blindly counting the actual number of packs).
function PackCountCell({ row, canEdit, active, onActivate, onSave, saving }) {
  const [numPacks, setNumPacks] = useState("");
  const [perPackQty, setPerPackQty] = useState(row.packing_order_fill_qty_per_pack ?? "");
  const [isZero, setIsZero] = useState(row.physical_qty === 0);

  const isPosted = Boolean(row.posted_stock_document_id);
  const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;

  if (!canEdit || isPosted) {
    return <span className="text-sm text-slate-600">{hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"}</span>;
  }

  if (!active && hasCount) {
    return (
      <button type="button" onClick={onActivate} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-900">
        {row.physical_qty} {row.base_uom_code ?? ""} — edit
      </button>
    );
  }

  const derivedQty = Number(numPacks) > 0 && Number(perPackQty) > 0 ? Number(numPacks) * Number(perPackQty) : null;

  function commit() {
    if (derivedQty === null) return;
    onSave(derivedQty, false, { enteredQty: derivedQty, enteredUomCode: row.base_uom_code });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" onFocus={onActivate}>
      <input
        type="number"
        min="0"
        placeholder="Num Pack"
        value={numPacks}
        disabled={isZero || saving}
        onChange={(event) => setNumPacks(event.target.value)}
        onBlur={commit}
        className="h-8 w-24 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
      />
      <span className="text-xs text-slate-500">×</span>
      <input
        type="number"
        min="0"
        step="0.0001"
        placeholder="Per-Pack Qty"
        value={perPackQty}
        disabled={isZero || saving}
        onChange={(event) => setPerPackQty(event.target.value)}
        onBlur={commit}
        className="h-8 w-28 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
      />
      <span className="text-xs text-slate-500">{row.base_uom_code}</span>
      {derivedQty !== null ? <span className="text-xs font-semibold text-slate-700">= {derivedQty} {row.base_uom_code}</span> : null}
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={isZero}
          disabled={saving}
          onChange={(event) => {
            const checked = event.target.checked;
            setIsZero(checked);
            if (checked) onSave(0, true);
          }}
          className="h-3.5 w-3.5"
        />
        Zero Stock
      </label>
    </div>
  );
}

// Same blind-entry cell shape as the old inline one on the Detail page, minus any book-qty
// awareness — this component never receives that field at all, so there is nothing to leak.
function BlindCountCell({ row, canEdit, active, onActivate, onSave, saving }) {
  const [isZero, setIsZero] = useState(row.physical_qty === 0);
  const conversionsQuery = useQuery({
    queryKey: ["procurement", "pi-material-uom-conversions", row.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(row.material_id),
    enabled: canEdit && active,
  });

  const isPosted = Boolean(row.posted_stock_document_id);
  const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;

  if (!canEdit || isPosted) {
    return <span className="text-sm text-slate-600">{hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"}</span>;
  }

  if (!active && hasCount) {
    return (
      <button type="button" onClick={onActivate} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-900">
        {row.physical_qty} {row.base_uom_code ?? ""} — edit
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" onFocus={onActivate}>
      <UomQuantityInput
        key={row.id}
        baseUomCode={row.base_uom_code}
        conversions={Array.isArray(conversionsQuery.data?.data) ? conversionsQuery.data.data : []}
        value={hasCount ? row.physical_qty : undefined}
        disabled={isZero || saving}
        onChange={(baseQty, { enteredQty, enteredUomCode }) => {
          if (baseQty !== null) onSave(baseQty, false, { enteredQty, enteredUomCode });
        }}
      />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={isZero}
          disabled={saving}
          onChange={(event) => {
            const checked = event.target.checked;
            setIsZero(checked);
            if (checked) onSave(0, true);
          }}
          className="h-3.5 w-3.5"
        />
        Zero Stock
      </label>
    </div>
  );
}

export default function PIDocumentCountEntryPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = (() => { try { return getActiveScreenContext() ?? {}; } catch { return {}; } })();
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");

  const [activeItemId, setActiveItemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const detailQuery = useQuery({
    queryKey: ["procurement", "pi-document-detail", id],
    queryFn: () => getPIDocument(id),
    enabled: Boolean(id),
  });
  const detail = detailQuery.data ?? null;
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const status = String(detail?.status || "").toUpperCase();
  const canEditCounts = ["OPEN", "COUNTED"].includes(status);
  const countedItems = items.filter((row) => row.physical_qty !== null && row.physical_qty !== undefined).length;
  const pendingItems = items.length - countedItems;

  async function saveCount(itemId, physicalQty, isZeroStock, enteredMeta) {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = isZeroStock
        ? { is_zero_stock: true }
        : {
            physical_qty: physicalQty,
            ...(enteredMeta?.enteredUomCode ? { entered_uom_code: enteredMeta.enteredUomCode, entered_qty: enteredMeta.enteredQty } : {}),
          };
      await enterPICount(detail.id, itemId, payload);
      setNotice("Count saved.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_COUNT_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function openDetail() {
    openScreen(OPERATION_SCREENS.PROC_PI_DETAIL.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}`);
  }

  const loading = detailQuery.isLoading;

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title={detail?.document_number ? `Count Entry | ${detail.document_number}` : "Count Entry"}
      notices={[
        ...(error ? [{ key: "count-entry-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "count-entry-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "review", label: "Review / Submit", tone: "primary", onClick: openDetail },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void detailQuery.refetch(),
        },
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading PI document..." : "PI document is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            Count what you physically find. The system's book quantity is not shown here on
            purpose — that's the whole point of a physical count.
          </div>

          <div className="grid gap-4 xl:grid-cols-4">
            <ErpFieldPreview label="Company" value={detail.company_name || detail.company_code || "—"} />
            <ErpFieldPreview label="Count Date" value={formatDate(detail.count_date)} />
            <ErpFieldPreview
              label="Storage Location"
              value={detail.mode === "LOCATION_WISE" ? (detail.storage_location_name || detail.storage_location_code || "—") : "Multiple (ITEM_WISE)"}
            />
            <ErpFieldPreview label="Progress" value={`Counted ${countedItems}/${items.length}`} caption={`Pending ${pendingItems}`} />
          </div>

          {!canEditCounts ? (
            <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This document's status is {status} — counts can no longer be entered here.
            </div>
          ) : null}

          <ErpDenseGrid
            columns={[
              { key: "line_number", label: "Line", width: "60px" },
              {
                key: "material_id",
                label: "Material",
                render: (row) => (row.material_pace_code || row.material_name ? `${row.material_name ?? "Material"} (${row.material_pace_code ?? "—"})` : "—"),
              },
              { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number ?? "—" },
              { key: "stock_type", label: "Stock Type", width: "150px" },
              {
                key: "storage_location_id",
                label: "Location",
                width: "150px",
                render: (row) => (row.storage_location_code || row.storage_location_name ? `${row.storage_location_code ?? "—"}` : "—"),
              },
              {
                key: "physical_qty",
                label: "Physical Count",
                width: "300px",
                render: (row) => {
                  const cellProps = {
                    row,
                    canEdit: canEditCounts && !row.posted_stock_document_id,
                    active: activeItemId === row.id,
                    onActivate: () => setActiveItemId(row.id),
                    onSave: (qty, isZero, meta) => void saveCount(row.id, qty, isZero, meta),
                    saving,
                  };
                  // FG Scenario 2 — variable-fill packs (no material-level fixed conversion),
                  // the packing order's own fill_qty_per_pack is the only signal for this.
                  return row.packing_order_fill_qty_per_pack !== null && row.packing_order_fill_qty_per_pack !== undefined
                    ? <PackCountCell {...cellProps} />
                    : <BlindCountCell {...cellProps} />;
                },
              },
            ]}
            rows={items}
            rowKey={(row) => row.id}
            emptyMessage="No items on this PI document."
            maxHeight="520px"
          />
        </div>
      )}
    </ErpScreenScaffold>
  );
}
