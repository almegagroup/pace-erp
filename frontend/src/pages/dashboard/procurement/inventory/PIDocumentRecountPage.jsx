/*
 * PIDocumentRecountPage — MI05, dedicated Change Count screen (§119.4/MI04-MI05 split,
 * 2026-08-14). Only reachable once MI04 has locked (every item already has a Count or Zero
 * Check, document status = COUNTED) — this is the review-and-correct step: unlike MI04, Book Qty
 * is shown here on purpose (the blind-entry moment already happened, so there's nothing left to
 * bias), and any item can be changed either direction — Count -> new Count, Count -> Zero Check,
 * Zero Check -> Count. Submit for Approval lives on this page, not the Detail/review page.
 *
 * §MI04-batch-save-2026-08-15 — same local-edit-then-Save pattern as MI04 (see that file's header
 * for the full "why": saving on every keystroke was a real bug, not intended behavior). Submit for
 * Approval refuses to run while unsaved edits are pending, rather than silently discarding them.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpScreenScaffold from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  changePICount,
  getPIRecountWorkspace,
  listMaterialUomConversionsForProcurement,
  resolvePIDByNumberForRecount,
  submitPIDForApproval,
} from "../procurementApi.js";
import PIDNumberEntryStep from "./PIDNumberEntryStep.jsx";
import { getPIStatusMeta } from "./piStatusPresentation.js";

const PAGE_SIZE = 25;

function getModeLabel(mode) {
  if (mode === "LOCATION_WISE") return "Location-wise";
  if (mode === "ITEM_WISE") return "Item-wise";
  if (mode === "MANUAL_WISE") return "Manual item-wise";
  return String(mode || "—");
}

function getStorageScopeLabel(detail) {
  return detail?.mode === "LOCATION_WISE"
    ? (detail.storage_location_name || detail.storage_location_code || "—")
    : `Multiple (${getModeLabel(detail?.mode)})`;
}

function toneForDifference(value) {
  if (value < 0) return "text-rose-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-600";
}

function hasPendingValue(edit) {
  return Boolean(edit) && (edit.isZeroStock || (edit.physicalQty !== null && edit.physicalQty !== undefined));
}

function CompactMetaCell({ label, value, caption = "" }) {
  return (
    <div className="border border-slate-300 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value || "—"}</div>
      {caption ? <div className="mt-1 text-[11px] text-slate-500">{caption}</div> : null}
    </div>
  );
}

// Same three entry shapes as MI04 (blind UomQuantityInput / pack-count), but Book Qty is visible
// alongside — the counter/supervisor here is correcting an already-made decision, not making a
// blind first pass.
function RecountCell({ row, canEdit, edit, onEditChange, disabled }) {
  const isPackMode = row.packing_order_fill_qty_per_pack !== null && row.packing_order_fill_qty_per_pack !== undefined;
  const conversionsQuery = useQuery({
    queryKey: ["procurement", "pi-material-uom-conversions", row.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(row.material_id),
    enabled: canEdit && !isPackMode,
  });

  const isPosted = Boolean(row.posted_stock_document_id);
  const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;

  if (!canEdit || isPosted) {
    return <span className="text-sm text-slate-600">{hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"}</span>;
  }

  const isZero = edit?.isZeroStock ?? false;
  const numPacks = edit?.numPacks ?? "";
  const perPackQty = edit?.perPackQty ?? (row.packing_order_fill_qty_per_pack ?? "");
  const derivedPackQty = Number(numPacks) > 0 && Number(perPackQty) > 0 ? Number(numPacks) * Number(perPackQty) : null;
  const seedValue = edit && !edit.isZeroStock && edit.physicalQty != null ? edit.physicalQty : (hasCount ? row.physical_qty : undefined);

  function updatePackQty(nextNumPacks, nextPerPackQty) {
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
      {isPackMode ? (
        <>
          <input type="number" min="0" placeholder="Num Pack" value={numPacks} disabled={isZero || disabled}
            onChange={(event) => updatePackQty(event.target.value, perPackQty)}
            className="h-8 w-20 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
          <span className="text-xs text-slate-500">×</span>
          <input type="number" min="0" step="0.0001" placeholder="Per-Pack Qty" value={perPackQty} disabled={isZero || disabled}
            onChange={(event) => updatePackQty(numPacks, event.target.value)}
            className="h-8 w-24 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
          {derivedPackQty !== null ? <span className="text-xs font-semibold text-slate-700">= {derivedPackQty}</span> : null}
        </>
      ) : (
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
      )}
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

export default function PIDocumentRecountPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = (() => { try { return getActiveScreenContext() ?? {}; } catch { return {}; } })();
  const linkedId = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");

  // §MI04-MI05-sidebar-restore — same Page 1 pattern as MI04, plus an extra gate: MI05 only
  // makes sense once MI04 has locked (status COUNTED) — reject the resolve here with a clear
  // message rather than silently landing on a page with nothing editable.
  const [resolvedId, setResolvedId] = useState(linkedId);
  const id = resolvedId;

  const [edits, setEdits] = useState({}); // { [itemId]: { physicalQty, isZeroStock, enteredQty, enteredUomCode, numPacks, perPackQty } }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  const detailQuery = useQuery({
    queryKey: ["procurement", "pi-recount-workspace", id],
    queryFn: () => getPIRecountWorkspace(id),
    enabled: Boolean(id),
  });
  const detail = detailQuery.data ?? null;
  const items = useMemo(() => (Array.isArray(detail?.items) ? detail.items : []), [detail]);
  const status = String(detail?.status || "").toUpperCase();
  const statusMeta = useMemo(() => getPIStatusMeta(detail?.status), [detail?.status]);
  // MI05 only makes sense once MI04 has locked (status COUNTED) — before that, changes belong
  // on MI04; after Submit (PENDING_APPROVAL+) counting is frozen entirely.
  const canEdit = status === "COUNTED";
  const canSubmit = status === "COUNTED";
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(() => items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [items, currentPage]);
  const paginationPage = currentPage + 1;
  const startIndex = items.length === 0 ? 0 : currentPage * PAGE_SIZE + 1;
  const endIndex = items.length === 0 ? 0 : Math.min(items.length, currentPage * PAGE_SIZE + pagedItems.length);

  const pendingEntries = useMemo(
    () => Object.entries(edits).filter(([, edit]) => hasPendingValue(edit)),
    [edits],
  );
  const stageMessage = canEdit
    ? "MI05 change-count mode is active. Review the book quantity and differences, save any corrections, then submit the PID for approval."
    : `MI05 is closed because this PID is currently ${status}.`;

  useEffect(() => {
    setEdits({});
    setError("");
    setNotice("");
    setCurrentPage(0);
  }, [id]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(totalPages - 1, 0)));
  }, [totalPages]);

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
        return changePICount(detail.id, itemId, payload);
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

  async function handleSubmitForApproval() {
    if (!detail?.id) return;
    if (pendingEntries.length > 0) {
      setError("You have unsaved changes — click Save before submitting for approval.");
      return;
    }
    const confirmed = await openActionConfirm({
      eyebrow: "Physical Inventory",
      title: "Submit for approval?",
      message: "This locks counting entirely — MI04/MI05 will be disabled until Reopened.",
      confirmLabel: "Submit",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await submitPIDForApproval(detail.id);
      setNotice("Submitted for approval.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_SUBMIT_FAILED");
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
      title={detail?.document_number ? `Change Count | ${detail.document_number}` : "Change Count"}
      notices={[
        ...(error ? [{ key: "recount-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "recount-notice", tone: "success", message: notice }] : []),
        ...(id ? [{ key: "recount-stage", tone: canEdit ? "info" : "warning", message: stageMessage }] : []),
      ]}
      actions={id ? [
        { key: "back", label: "Back To Detail", tone: "neutral", onClick: openDetail },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void detailQuery.refetch(),
        },
        {
          key: "save",
          label: saving ? "Saving..." : `Save${pendingEntries.length ? ` (${pendingEntries.length})` : ""}`,
          tone: "primary",
          onClick: () => void handleSaveAll(),
          disabled: saving || pendingEntries.length === 0 || !canEdit,
        },
        ...(canSubmit ? [{ key: "submit", label: saving ? "Submitting..." : "Submit for Approval", tone: "neutral", onClick: () => void handleSubmitForApproval(), disabled: saving }] : []),
      ] : []}
    >
      {!id ? (
        <PIDNumberEntryStep
          heading="Enter PID number"
          helperText="Type the PID you want to change counts on. MI04 must already be fully counted (status COUNTED) before MI05 will accept it."
          onResolved={(doc) => setResolvedId(doc.id)}
          resolveFn={resolvePIDByNumberForRecount}
          extraValidate={(doc) => {
            if (String(doc.status || "").toUpperCase() === "OPEN") {
              return "This PID still has pending items in MI04. Complete MI04 first.";
            }
            return null;
          }}
        />
      ) : loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading PI document..." : "PI document is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            <CompactMetaCell label="Step" value="MI05 Change Count" />
            <CompactMetaCell label="Status" value={statusMeta.label} />
            <CompactMetaCell label="Mode" value={getModeLabel(detail.mode)} />
            <CompactMetaCell label="Location" value={getStorageScopeLabel(detail)} />
            <CompactMetaCell label="Rows" value={`${items.length}`} caption={`Page ${paginationPage}/${totalPages}`} />
            <CompactMetaCell label="Pending Save" value={`${pendingEntries.length}`} />
          </div>

          <div className="grid gap-4">
            <div className={`border px-3 py-2 text-sm ${canEdit ? "border-sky-200 bg-sky-50 text-sky-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
              {canEdit
                ? `Review corrected counts, save in batch, then Submit for Approval. Unsaved: ${pendingEntries.length}.`
                : `This PID is currently ${statusMeta.label}. MI05 is closed, so count changes can no longer be made here.`}
            </div>

            <div className="grid gap-3">
              <ErpPaginationStrip
                page={paginationPage}
                setPage={(next) => setCurrentPage(Math.max(0, Number(next) - 1))}
                totalPages={totalPages}
                startIndex={startIndex}
                endIndex={endIndex}
                totalItems={items.length}
              />
              <ErpDenseGrid
                columns={[
                  { key: "line_number", label: "Line", width: "60px" },
                  {
                    key: "material_id",
                    label: "Material",
                    render: (row) => (row.material_pace_code || row.material_name ? `${row.material_name ?? "Material"} (${row.material_pace_code ?? "—"})` : "—"),
                  },
                  { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number ?? "—" },
                  { key: "stock_type", label: "Stock Type", width: "140px" },
                  {
                    key: "storage_location_id",
                    label: "Location",
                    width: "140px",
                    render: (row) => (row.storage_location_code || row.storage_location_name ? `${row.storage_location_code ?? "—"}` : "—"),
                  },
                  { key: "book_qty", label: "Book Qty", width: "100px" },
                  {
                    key: "physical_qty",
                    label: "Physical Count",
                    width: "260px",
                    render: (row) => (
                      <RecountCell
                        row={row}
                        canEdit={canEdit && !row.posted_stock_document_id}
                        edit={edits[row.id]}
                        onEditChange={(patch) => updateEdit(row.id, patch)}
                        disabled={saving}
                      />
                    ),
                  },
                  {
                    key: "difference_qty",
                    label: "Difference",
                    width: "110px",
                    render: (row) => {
                      const edit = edits[row.id];
                      const pending = hasPendingValue(edit);
                      const effectiveQty = pending ? edit.physicalQty : row.physical_qty;
                      if (effectiveQty === null || effectiveQty === undefined) return <span className="text-slate-400">—</span>;
                      const diff = Number(effectiveQty) - Number(row.book_qty ?? 0);
                      return (
                        <span className={`font-semibold ${toneForDifference(diff)}`}>
                          {diff.toFixed(4)}{pending ? <span className="ml-1 text-xs font-normal text-amber-600">(unsaved)</span> : null}
                        </span>
                      );
                    },
                  },
                ]}
                rows={pagedItems}
                rowKey={(row) => row.id}
                rowTabIndex={-1}
                maxHeight="calc(100vh - 340px)"
                getRowProps={(row) => {
                  const edit = edits[row.id];
                  const pending = hasPendingValue(edit);
                  const effectiveQty = pending ? edit.physicalQty : row.physical_qty;
                  if (effectiveQty === null || effectiveQty === undefined) return {};
                  const diff = Number(effectiveQty) - Number(row.book_qty ?? 0);
                  return { className: diff < 0 ? "bg-rose-50" : diff > 0 ? "bg-emerald-50" : "bg-slate-50" };
                }}
                emptyMessage="No items on this PI document."
              />
            </div>
          </div>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
