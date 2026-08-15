/*
 * PIDocumentCountEntryPage — MI04, dedicated blind count-entry screen (§119.4, split out
 * 2026-08-14 per business-owner correction: SAP's MI04 never shows the system's book quantity
 * to the person doing the physical count — showing it invites the counter to just copy the
 * expected number instead of actually counting, defeating the whole point of a physical
 * inventory audit. This page intentionally never fetches or renders book_qty/difference_qty
 * anywhere, even though the underlying PID item record carries them (PIDocumentDetailPage.jsx,
 * the review/oversight page, shows those — but only after a count is already locked in, when
 * there's nothing left to bias).
 *
 * §MI04-batch-save-2026-08-15 — every row is edited locally (edits keyed by item id, kept
 * across pagination) and nothing hits the API until "Save" is clicked. The earlier design saved
 * on every keystroke/checkbox toggle (UomQuantityInput's onChange fired an immediate PUT per
 * digit typed) — business owner correctly called this out as wrong: a counter should be able to
 * fill in the whole sheet, then commit it all at once, same as every other bulk-entry page in
 * this app (Opening Stock's UomQuantityInput usage already works this way).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { enterPICount, getPIDocument, listMaterialUomConversionsForProcurement } from "../procurementApi.js";
import PIDNumberEntryStep from "./PIDNumberEntryStep.jsx";

const PAGE_SIZE = 25;

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function hasPendingValue(edit) {
  return Boolean(edit) && (edit.isZeroStock || (edit.physicalQty !== null && edit.physicalQty !== undefined));
}

// FG Scenario 2 (variable-fill MTO/HPS/MTEST barrels/IBCs, §UoM-2026-08-14) — no material-level
// fixed conversion exists for these (fill varies Packing PO to Packing PO, §83.14 balance-barrel),
// so the counter enters Num Pack (blind — how many barrels/containers physically found) × a
// Per-Pack Qty defaulted from that specific Packing PO's own recorded fill (that's a package
// label attribute, not a book-stock total, so prefilling it is not the same bias risk as showing
// book_qty — the counter is still blindly counting the actual number of packs).
function PackCountCell({ row, canEdit, edit, onEditChange, disabled }) {
  const isPosted = Boolean(row.posted_stock_document_id);
  const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;

  if (!canEdit || isPosted) {
    return <span className="text-sm text-slate-600">{hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"}</span>;
  }

  const isZero = edit?.isZeroStock ?? false;
  const numPacks = edit?.numPacks ?? "";
  const perPackQty = edit?.perPackQty ?? (row.packing_order_fill_qty_per_pack ?? "");
  const derivedQty = Number(numPacks) > 0 && Number(perPackQty) > 0 ? Number(numPacks) * Number(perPackQty) : null;

  function updateQty(nextNumPacks, nextPerPackQty) {
    const qty = Number(nextNumPacks) > 0 && Number(nextPerPackQty) > 0 ? Number(nextNumPacks) * Number(nextPerPackQty) : null;
    onEditChange({
      numPacks: nextNumPacks,
      perPackQty: nextPerPackQty,
      isZeroStock: false,
      physicalQty: qty,
      enteredQty: qty,
      enteredUomCode: row.base_uom_code,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min="0"
        placeholder="Num Pack"
        value={numPacks}
        disabled={isZero || disabled}
        onChange={(event) => updateQty(event.target.value, perPackQty)}
        className="h-8 w-24 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
      />
      <span className="text-xs text-slate-500">×</span>
      <input
        type="number"
        min="0"
        step="0.0001"
        placeholder="Per-Pack Qty"
        value={perPackQty}
        disabled={isZero || disabled}
        onChange={(event) => updateQty(numPacks, event.target.value)}
        className="h-8 w-28 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
      />
      <span className="text-xs text-slate-500">{row.base_uom_code}</span>
      {derivedQty !== null ? <span className="text-xs font-semibold text-slate-700">= {derivedQty} {row.base_uom_code}</span> : null}
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={isZero}
          disabled={disabled}
          onChange={(event) => {
            const checked = event.target.checked;
            onEditChange({ isZeroStock: checked, physicalQty: checked ? 0 : null, numPacks, perPackQty });
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
function BlindCountCell({ row, canEdit, edit, onEditChange, disabled }) {
  const conversionsQuery = useQuery({
    queryKey: ["procurement", "pi-material-uom-conversions", row.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(row.material_id),
    enabled: canEdit,
  });

  const isPosted = Boolean(row.posted_stock_document_id);
  const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;

  if (!canEdit || isPosted) {
    return <span className="text-sm text-slate-600">{hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"}</span>;
  }

  const isZero = edit?.isZeroStock ?? false;
  const seedValue = edit && !edit.isZeroStock && edit.physicalQty != null ? edit.physicalQty : (hasCount ? row.physical_qty : undefined);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <UomQuantityInput
        key={row.id}
        baseUomCode={row.base_uom_code}
        conversions={Array.isArray(conversionsQuery.data?.data) ? conversionsQuery.data.data : []}
        value={seedValue}
        disabled={isZero || disabled}
        onChange={(baseQty, { enteredQty, enteredUomCode }) => {
          onEditChange({ physicalQty: baseQty, isZeroStock: false, enteredQty, enteredUomCode });
        }}
      />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={isZero}
          disabled={disabled}
          onChange={(event) => {
            const checked = event.target.checked;
            onEditChange({ isZeroStock: checked, physicalQty: checked ? 0 : null });
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
  const linkedId = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");

  // §MI04-MI05-sidebar-restore — standalone entry: no linked id means Page 1 (type the PID
  // number) runs first; a linked id (companion button from PID Detail / MI05's "Go to MI04")
  // skips straight to Page 2, same as before.
  const [resolvedId, setResolvedId] = useState(linkedId);
  const id = resolvedId;

  const [edits, setEdits] = useState({}); // { [itemId]: { physicalQty, isZeroStock, enteredQty, enteredUomCode, numPacks, perPackQty } }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  const detailQuery = useQuery({
    queryKey: ["procurement", "pi-document-detail", id],
    queryFn: () => getPIDocument(id),
    enabled: Boolean(id),
  });
  const detail = detailQuery.data ?? null;
  const items = useMemo(() => (Array.isArray(detail?.items) ? detail.items : []), [detail]);
  const status = String(detail?.status || "").toUpperCase();
  // MI04 only stays open while the document is OPEN (i.e. at least one item still undecided).
  // The instant every item has a Count or Zero Check, status flips to COUNTED and this page
  // locks — further changes go through MI05 (Change Count), not back through here.
  const canEditCounts = status === "OPEN";
  const isFullyLocked = status !== "OPEN";
  const countedItems = items.filter((row) => row.physical_qty !== null && row.physical_qty !== undefined).length;
  const pendingItems = items.length - countedItems;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(() => items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [items, currentPage]);

  const pendingEntries = useMemo(
    () => Object.entries(edits).filter(([, edit]) => hasPendingValue(edit)),
    [edits],
  );

  function updateEdit(itemId, patch) {
    setEdits((current) => ({ ...current, [itemId]: { ...current[itemId], ...patch } }));
  }

  async function handleSaveAll() {
    if (!detail?.id || pendingEntries.length === 0) {
      setNotice("Nothing to save.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // INDEPENDENT (§8B) — each entry is a separate PID item row, no shared state or ordering
      // dependency between them, safe to fire in parallel.
      await Promise.all(pendingEntries.map(([itemId, edit]) => {
        const payload = edit.isZeroStock
          ? { is_zero_stock: true }
          : {
              physical_qty: edit.physicalQty,
              ...(edit.enteredUomCode ? { entered_uom_code: edit.enteredUomCode, entered_qty: edit.enteredQty } : {}),
            };
        return enterPICount(detail.id, itemId, payload);
      }));
      setEdits({});
      setNotice(`Saved ${pendingEntries.length} item${pendingEntries.length === 1 ? "" : "s"}.`);
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

  function openRecount() {
    openScreen(OPERATION_SCREENS.PROC_PI_RECOUNT.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}/recount`);
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
      actions={id ? [
        {
          key: "save",
          label: saving ? "Saving..." : `Save${pendingEntries.length ? ` (${pendingEntries.length})` : ""}`,
          tone: "primary",
          onClick: () => void handleSaveAll(),
          disabled: saving || pendingEntries.length === 0 || isFullyLocked,
        },
        { key: "review", label: "Review / Submit", tone: "neutral", onClick: openDetail },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void detailQuery.refetch(),
        },
      ] : []}
    >
      {!id ? (
        <PIDNumberEntryStep
          heading="Enter PID number"
          helperText="Type the PID you want to count. This is global across companies — if it belongs to a different company, you'll be told so."
          onResolved={(doc) => setResolvedId(doc.id)}
        />
      ) : loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading PI document..." : "PI document is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-4">
            <ErpFieldPreview label="Company" value={detail.company_name || detail.company_code || "—"} />
            <ErpFieldPreview label="Count Date" value={formatDate(detail.count_date)} />
            <ErpFieldPreview
              label="Storage Location"
              value={detail.mode === "LOCATION_WISE" ? (detail.storage_location_name || detail.storage_location_code || "—") : "Multiple (ITEM_WISE)"}
            />
            <ErpFieldPreview label="Progress" value={`Counted ${countedItems}/${items.length}`} caption={`Pending ${pendingItems} · Unsaved ${pendingEntries.length}`} />
          </div>

          {isFullyLocked ? (
            <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Every item already has a Count or Zero Check — MI04 is locked and permanently closed
              for this document. {status === "COUNTED" ? (
                <button type="button" onClick={openRecount} className="ml-1 font-semibold underline">
                  Go to MI05 (Change Count) to make further changes.
                </button>
              ) : (
                <>Status is {status}.</>
              )}
            </div>
          ) : (
            <div className="border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Count what you physically find. The system's book quantity is not shown here on
              purpose — that's the whole point of a physical count. Fill in as many rows as you
              like across pages, then click Save to commit them all at once. This page stays open
              until every item has a Count or Zero Check, then locks permanently.
            </div>
          )}

          {!isFullyLocked ? (
            <>
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
                        edit: edits[row.id],
                        onEditChange: (patch) => updateEdit(row.id, patch),
                        disabled: saving,
                      };
                      // FG Scenario 2 — variable-fill packs (no material-level fixed conversion),
                      // the packing order's own fill_qty_per_pack is the only signal for this.
                      return row.packing_order_fill_qty_per_pack !== null && row.packing_order_fill_qty_per_pack !== undefined
                        ? <PackCountCell {...cellProps} />
                        : <BlindCountCell {...cellProps} />;
                    },
                  },
                ]}
                rows={pagedItems}
                rowKey={(row) => row.id}
                emptyMessage="No items on this PI document."
                maxHeight="520px"
              />
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Page {currentPage + 1} of {totalPages} ({items.length} items)</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCurrentPage((page) => Math.max(0, page - 1))} disabled={currentPage === 0} className="border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 disabled:opacity-40">Prev</button>
                  <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))} disabled={currentPage >= totalPages - 1} className="border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 disabled:opacity-40">Next</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
