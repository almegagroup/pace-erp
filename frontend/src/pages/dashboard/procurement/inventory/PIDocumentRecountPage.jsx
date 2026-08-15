/*
 * PIDocumentRecountPage — MI05, dedicated Change Count screen (§119.4/MI04-MI05 split,
 * 2026-08-14). Only reachable once MI04 has locked (every item already has a Count or Zero
 * Check, document status = COUNTED) — this is the review-and-correct step: unlike MI04, Book Qty
 * is shown here on purpose (the blind-entry moment already happened, so there's nothing left to
 * bias), and any item can be changed either direction — Count -> new Count, Count -> Zero Check,
 * Zero Check -> Count. Submit for Approval lives on this page, not the Detail/review page.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  changePICount,
  getPIDocument,
  listMaterialUomConversionsForProcurement,
  submitPIDForApproval,
} from "../procurementApi.js";
import PIDNumberEntryStep from "./PIDNumberEntryStep.jsx";

const PAGE_SIZE = 25;

function toneForDifference(value) {
  if (value < 0) return "text-rose-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-600";
}

// Same three entry shapes as MI04 (blind UomQuantityInput / pack-count), but Book Qty is visible
// alongside — the counter/supervisor here is correcting an already-made decision, not making a
// blind first pass.
function RecountCell({ row, canEdit, active, onActivate, onSave, saving }) {
  const [isZero, setIsZero] = useState(row.physical_qty === 0);
  const [numPacks, setNumPacks] = useState("");
  const [perPackQty, setPerPackQty] = useState(row.packing_order_fill_qty_per_pack ?? "");
  const isPackMode = row.packing_order_fill_qty_per_pack !== null && row.packing_order_fill_qty_per_pack !== undefined;
  const conversionsQuery = useQuery({
    queryKey: ["procurement", "pi-material-uom-conversions", row.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(row.material_id),
    enabled: canEdit && active && !isPackMode,
  });

  const isPosted = Boolean(row.posted_stock_document_id);
  const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;

  if (!canEdit || isPosted) {
    return <span className="text-sm text-slate-600">{hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"}</span>;
  }

  if (!active) {
    return (
      <button type="button" onClick={onActivate} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-900">
        {hasCount ? `${row.physical_qty} ${row.base_uom_code ?? ""}` : "Not counted"} — change
      </button>
    );
  }

  const derivedPackQty = Number(numPacks) > 0 && Number(perPackQty) > 0 ? Number(numPacks) * Number(perPackQty) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isPackMode ? (
        <>
          <input type="number" min="0" placeholder="Num Pack" value={numPacks} disabled={isZero || saving}
            onChange={(event) => setNumPacks(event.target.value)}
            onBlur={() => derivedPackQty !== null && onSave(derivedPackQty, false, { enteredQty: derivedPackQty, enteredUomCode: row.base_uom_code })}
            className="h-8 w-20 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
          <span className="text-xs text-slate-500">×</span>
          <input type="number" min="0" step="0.0001" placeholder="Per-Pack Qty" value={perPackQty} disabled={isZero || saving}
            onChange={(event) => setPerPackQty(event.target.value)}
            onBlur={() => derivedPackQty !== null && onSave(derivedPackQty, false, { enteredQty: derivedPackQty, enteredUomCode: row.base_uom_code })}
            className="h-8 w-24 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
          {derivedPackQty !== null ? <span className="text-xs font-semibold text-slate-700">= {derivedPackQty}</span> : null}
        </>
      ) : (
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
      )}
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

  const [activeItemId, setActiveItemId] = useState("");
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
  // MI05 only makes sense once MI04 has locked (status COUNTED) — before that, changes belong
  // on MI04; after Submit (PENDING_APPROVAL+) counting is frozen entirely.
  const canEdit = status === "COUNTED";
  const canSubmit = status === "COUNTED";
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(() => items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [items, currentPage]);

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
      await changePICount(detail.id, itemId, payload);
      setNotice("Count updated.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_COUNT_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForApproval() {
    if (!detail?.id) return;
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
      ]}
      actions={id ? [
        { key: "back", label: "Back To Detail", tone: "neutral", onClick: openDetail },
        ...(canSubmit ? [{ key: "submit", label: saving ? "Submitting..." : "Submit for Approval", tone: "primary", onClick: () => void handleSubmitForApproval(), disabled: saving }] : []),
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
          helperText="Type the PID you want to change counts on. MI04 must already be fully counted (status COUNTED) before MI05 will accept it."
          onResolved={(doc) => setResolvedId(doc.id)}
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
          <div className="grid gap-4 xl:grid-cols-3">
            <ErpFieldPreview label="Status" value={detail.status || "—"} />
            <ErpFieldPreview label="Company" value={detail.company_name || detail.company_code || "—"} />
            <ErpFieldPreview
              label="Storage Location"
              value={detail.mode === "LOCATION_WISE" ? (detail.storage_location_name || detail.storage_location_code || "—") : "Multiple (ITEM_WISE)"}
            />
          </div>

          {!canEdit ? (
            <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This document's status is {status} — changes can no longer be made here.
            </div>
          ) : (
            <div className="border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Every item already has a Count or Zero Check. Change any of them below, then Submit
              for Approval when satisfied.
            </div>
          )}

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
                    active={activeItemId === row.id}
                    onActivate={() => setActiveItemId(row.id)}
                    onSave={(qty, isZero, meta) => void saveCount(row.id, qty, isZero, meta)}
                    saving={saving}
                  />
                ),
              },
              {
                key: "difference_qty",
                label: "Difference",
                width: "110px",
                render: (row) => {
                  if (row.physical_qty === null || row.physical_qty === undefined) return <span className="text-slate-400">—</span>;
                  const diff = Number(row.difference_qty ?? 0);
                  return <span className={`font-semibold ${toneForDifference(diff)}`}>{diff.toFixed(4)}</span>;
                },
              },
            ]}
            rows={pagedItems}
            rowKey={(row) => row.id}
            getRowProps={(row) => {
              if (row.physical_qty === null || row.physical_qty === undefined) return {};
              const diff = Number(row.difference_qty ?? 0);
              return { className: diff < 0 ? "bg-rose-50" : diff > 0 ? "bg-emerald-50" : "bg-slate-50" };
            }}
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
        </div>
      )}
    </ErpScreenScaffold>
  );
}
