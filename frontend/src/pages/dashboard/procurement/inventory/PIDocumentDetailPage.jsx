/*
 * PIDocumentDetailPage — MI02/MI03/MI07 review + oversight (§119.4). MI04 (blind count entry)
 * and MI05 (Change Count) live on their own pages, PIDocumentCountEntryPage.jsx and
 * PIDocumentRecountPage.jsx — the whole point of a physical count is a blind comparison against
 * the system's book quantity, so the screen where someone types in what they physically found
 * must never show that book quantity, and correcting an already-made decision is a distinct step
 * from making it. This page is pure review: Book Qty/Difference are exactly what a
 * supervisor/auditor needs here to decide whether to Cancel, Reopen, or Post — by the time an
 * item has a physical_qty on this page, the blind-entry moment has already happened, so showing
 * the variance here is not a bias risk, it's the actual job of this screen.
 *
 * MI07 Post is batch-selective (§MI07-batch-2026-08-14, business-owner directive): the item grid
 * becomes selectable once status is PENDING_APPROVAL — select any subset (or all) and Post; that
 * selection posts atomically together, and the document can go through more than one Post action
 * until every non-zero-difference item is posted.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  addPIItem,
  cancelPIDocument,
  getPIDocument,
  postPIDifferences,
  removePIItem,
  reopenPIDocument,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useMaterialOptionsQuery,
  useStorageLocationsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { getPIStatusMeta } from "./piStatusPresentation.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const PI_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

function toneForDifference(value) {
  if (value < 0) return "text-rose-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-600";
}

function buildStageMessage(status, counts) {
  switch (status) {
    case "OPEN":
      return {
        tone: "info",
        message: `MI02 change mode is active. Scope can still be adjusted, and MI04 count entry remains open. Counted ${counts.counted}/${counts.total}; pending ${counts.pending}.`,
      };
    case "COUNTED":
      return {
        tone: "info",
        message: "MI04 is complete. Use MI05 to review and change counts before submitting for approval.",
      };
    case "PENDING_APPROVAL":
      return {
        tone: "info",
        message: "MI05 is locked. Review the variances below, select the lines you want to post, then complete MI07-style posting.",
      };
    case "POSTED":
      return {
        tone: "success",
        message: "This PID is fully posted. The review screen is now display-only.",
      };
    case "CANCELLED":
      return {
        tone: "warning",
        message: "This PID has been cancelled. It remains visible for review, but no further processing is allowed.",
      };
    default:
      return null;
  }
}

// §8A — Reason modal for Reopen/Cancel (mandatory reason, small inline modal — the shared
// actionConfirm store is boolean-only, this codebase's established pattern for Recalculate/
// COR6-style corrections is a small dedicated reason prompt, not a new shared component).
function ReasonModal({ title, onConfirm, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded border border-slate-300 bg-white p-4 shadow-lg">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <textarea
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (required)"
          className="mt-3 min-h-[80px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
            Cancel
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-900 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PIDocumentDetailPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id =
    routeId && routeId !== ":id" && routeId !== "id"
      ? routeId
      : (screenContext.id || "");
  const { runtimeContext } = useMenu();
  const selectedCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [itemForm, setItemForm] = useState({ material_id: "", stock_type: "UNRESTRICTED", storage_location_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reasonModal, setReasonModal] = useState(null); // "reopen" | "cancel" | null
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  // §119.14.1 — per-row opt-in for batch-tracked SFG/FG reco cascade, default unchecked.
  const [recoItemIds, setRecoItemIds] = useState(() => new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [page, setPage] = useState(1);

  const detailQuery = useQuery({
    queryKey: ["procurement", "pi-document-detail", id],
    queryFn: () => getPIDocument(id),
    enabled: Boolean(id),
  });
  const detail = detailQuery.data ?? null;
  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0, status: "ACTIVE" });
  const locationQuery = useStorageLocationsQuery(
    { company_id: detail?.company_id || selectedCompanyId || undefined, is_active: true },
    { enabled: Boolean(detail?.company_id || selectedCompanyId) },
  );
  const materials = materialQuery.materials;
  const storageLocations = useMemo(
    () => (Array.isArray(locationQuery.data?.data) ? locationQuery.data.data : (Array.isArray(locationQuery.data) ? locationQuery.data : [])),
    [locationQuery.data],
  );
  const loading = detailQuery.isLoading || materialQuery.isLoading || locationQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([detailQuery.refetch(), materialQuery.refetch(), locationQuery.refetch()]),
    },
  });

  const items = useMemo(() => (Array.isArray(detail?.items) ? detail.items : []), [detail]);
  const statusMeta = useMemo(() => getPIStatusMeta(detail?.status), [detail?.status]);
  const materialOptions = useMemo(
    () =>
      materials
        .filter((row) => PI_MATERIAL_TYPES.has(String(row.material_type || "").toUpperCase()))
        .map((row) => ({ value: row.id, label: `${row.material_name ?? "Material"} (${row.pace_code ?? row.material_code ?? row.id})` })),
    [materials],
  );
  const locationOptions = useMemo(
    () => storageLocations.map((row) => ({ value: row.id, label: `${row.code ?? row.storage_location_code ?? row.id} — ${row.name ?? row.storage_location_name ?? ""}`.trim() })),
    [storageLocations],
  );

  const status = String(detail?.status || "").toUpperCase();
  const countedItems = items.filter((row) => row.physical_qty !== null && row.physical_qty !== undefined).length;
  const pendingItems = items.length - countedItems;
  // MI04 (Count Entry) only stays open while OPEN; MI05 (Change Count) only opens once COUNTED.
  const canEnterCounts = status === "OPEN";
  const canChangeCounts = status === "COUNTED";
  const canAddOrRemoveItems = status === "OPEN";
  const canCancel = status === "OPEN";
  const canReopen = status === "PENDING_APPROVAL";
  // §MI07-batch — every counted, unposted line is selectable. Zero-variance lines have no
  // ledger movement, but selecting them lets MI07 release their block and complete an
  // otherwise zero-variance document.
  const postableItems = useMemo(
    () => (status === "PENDING_APPROVAL" ? items.filter((row) => row.physical_qty !== null && row.physical_qty !== undefined && !row.posted_stock_document_id) : []),
    [items, status],
  );
  const canPost = status === "PENDING_APPROVAL" && postableItems.length > 0;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(() => items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [items, currentPage]);
  const stageNotice = buildStageMessage(status, { counted: countedItems, total: items.length, pending: pendingItems });

  useEffect(() => {
    setError("");
    setNotice("");
    setSelectedItemIds(new Set());
    setRecoItemIds(new Set());
    setCurrentPage(0);
    setItemForm({ material_id: "", stock_type: "UNRESTRICTED", storage_location_id: "" });
    setPage(1);
  }, [id]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(totalPages - 1, 0)));
  }, [totalPages]);

  useEffect(() => {
    setSelectedItemIds((current) => {
      if (current.size === 0) return current;
      const valid = new Set(postableItems.map((row) => row.id));
      const next = new Set([...current].filter((itemId) => valid.has(itemId)));
      return next.size === current.size ? current : next;
    });
    setRecoItemIds((current) => {
      if (current.size === 0) return current;
      const valid = new Set(postableItems.map((row) => row.id));
      const next = new Set([...current].filter((itemId) => valid.has(itemId)));
      return next.size === current.size ? current : next;
    });
  }, [postableItems]);

  useScreenBackInterceptor(() => {
    if (page <= 1) return false;
    setPage((current) => Math.max(1, current - 1));
    return true;
  });

  const queryError = detailQuery.error?.message || materialQuery.error?.message || locationQuery.error?.message || "";

  async function handleRemoveItem(itemId) {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    try {
      await removePIItem(detail.id, itemId);
      setNotice("Item removed.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_ITEM_REMOVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddItem() {
    if (!detail?.id || !itemForm.material_id || !itemForm.stock_type || !itemForm.storage_location_id) {
      setError("Material, stock type, and storage location are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addPIItem(detail.id, itemForm);
      setNotice("PI item added.");
      setItemForm({ material_id: "", stock_type: "UNRESTRICTED", storage_location_id: "" });
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_ITEM_ADD_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen(reason) {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    try {
      await reopenPIDocument(detail.id, reason);
      setNotice("Reopened — counting is editable again.");
      setReasonModal(null);
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_REOPEN_FAILED");
      setReasonModal(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(reason) {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    try {
      await cancelPIDocument(detail.id, reason);
      setNotice("Document cancelled.");
      setReasonModal(null);
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_CANCEL_FAILED");
      setReasonModal(null);
    } finally {
      setSaving(false);
    }
  }

  async function handlePostSelected() {
    if (!detail?.id || selectedItemIds.size === 0) return;
    const idsToPost = [...selectedItemIds];
    const confirmed = await openActionConfirm({
      eyebrow: "Physical Inventory",
      title: `Post ${idsToPost.length} selected item${idsToPost.length === 1 ? "" : "s"}?`,
      message: "This posts the selected items' differences to the inventory ledger in one atomic transaction. Cannot be undone. Any items you don't select can be posted later in a separate batch.",
      confirmLabel: "Post",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      const recoIdsToPost = idsToPost.filter((itemId) => recoItemIds.has(itemId));
      await postPIDifferences(detail.id, idsToPost, recoIdsToPost);
      setNotice(`${idsToPost.length} item(s) posted.`);
      setSelectedItemIds(new Set());
      setRecoItemIds(new Set());
      await detailQuery.refetch();
    } catch (saveError) {
      // §119.5 — authority errors (staff-vs-auditor-vs-director) surface here verbatim.
      setError(saveError instanceof Error ? saveError.message : "PI_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelectAll() {
    setSelectedItemIds((current) =>
      current.size === postableItems.length ? new Set() : new Set(postableItems.map((row) => row.id)),
    );
  }

  function toggleSelectItem(itemId) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleRecoItem(itemId) {
    setRecoItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function openPrint() {
    openScreen(OPERATION_SCREENS.PROC_PI_PRINT.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}/print`);
  }

  function openCountEntry() {
    openScreen(OPERATION_SCREENS.PROC_PI_COUNT_ENTRY.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}/count`);
  }

  function openRecount() {
    openScreen(OPERATION_SCREENS.PROC_PI_RECOUNT.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}/recount`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title={detail?.document_number ? `Physical Inventory | ${detail.document_number}` : "Physical Inventory Detail"}
      notices={[
        ...((error || queryError) ? [{ key: "pi-detail-error", tone: "error", message: error || queryError }] : []),
        ...(notice ? [{ key: "pi-detail-notice", tone: "success", message: notice }] : []),
        ...(stageNotice ? [{ key: "pi-detail-stage", tone: stageNotice.tone, message: stageNotice.message }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: page === 1 ? "Back To List" : "Back",
          tone: "neutral",
          onClick: () => {
            if (page > 1) {
              setPage((current) => Math.max(1, current - 1));
              return;
            }
            openScreen(OPERATION_SCREENS.PROC_PI_LIST.screen_code);
            navigate("/dashboard/procurement/physical-inventory");
          },
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void Promise.all([detailQuery.refetch(), materialQuery.refetch(), locationQuery.refetch()]),
        },
        {
          key: "overview",
          label: "Overview",
          tone: page === 1 ? "primary" : "neutral",
          onClick: () => setPage(1),
        },
        {
          key: "items",
          label: status === "PENDING_APPROVAL" ? "Review / Post" : "Item Grid",
          tone: page === 2 ? "primary" : "neutral",
          onClick: () => setPage(2),
        },
        ...(canAddOrRemoveItems ? [{
          key: "scope",
          label: "Adjust Scope",
          tone: page === 3 ? "primary" : "neutral",
          onClick: () => setPage(3),
        }] : []),
        { key: "print", label: "Print Count Sheet", tone: "neutral", onClick: openPrint },
        ...(canEnterCounts ? [{ key: "count-entry", label: "Enter Counts (MI04)", tone: "primary", onClick: openCountEntry }] : []),
        ...(canChangeCounts ? [{ key: "recount", label: "Change Counts (MI05)", tone: "primary", onClick: openRecount }] : []),
        ...(canCancel ? [{ key: "cancel", label: "Cancel Document", tone: "danger", onClick: () => setReasonModal("cancel"), disabled: saving }] : []),
        ...(canReopen ? [{ key: "reopen", label: "Reopen", tone: "neutral", onClick: () => setReasonModal("reopen"), disabled: saving }] : []),
        ...(canPost ? [{
          key: "post",
          label: saving ? "Posting..." : `Post Selected (${selectedItemIds.size})`,
          tone: "primary",
          onClick: () => void handlePostSelected(),
          disabled: saving || selectedItemIds.size === 0,
        }] : []),
      ]}
    >
      {reasonModal === "reopen" ? (
        <ReasonModal title="Reopen — reason required" onConfirm={handleReopen} onCancel={() => setReasonModal(null)} />
      ) : null}
      {reasonModal === "cancel" ? (
        <ReasonModal title="Cancel document — reason required" onConfirm={handleCancel} onCancel={() => setReasonModal(null)} />
      ) : null}

      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading PI document..." : "PI document is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-4">
            <ErpFieldPreview label="Step" value={status === "OPEN" ? "MI02 / MI03" : status === "COUNTED" ? "MI03 -> MI05" : status === "PENDING_APPROVAL" ? "MI03 / MI07" : "MI03 Display"} />
            <ErpFieldPreview label="Page" value={page === 1 ? "Overview" : page === 2 ? (status === "PENDING_APPROVAL" ? "Review / Post" : "Item Grid") : "Adjust Scope"} />
          <ErpFieldPreview label="Status" value={statusMeta.label} tone={statusMeta.previewTone} />
          <ErpFieldPreview label="Company" value={detail.company_name || detail.company_code || "—"} />
          <ErpFieldPreview
            label="Storage Location"
            value={getStorageScopeLabel(detail)}
          />
            <ErpFieldPreview label="Progress" value={`Counted ${countedItems}/${items.length}`} caption={`Pending ${pendingItems}`} />
          </div>

          <ErpSectionCard eyebrow="Header" title={detail.document_number || "PI Document"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Mode" value={getModeLabel(detail.mode)} />
              <ErpFieldPreview label="Count Date" value={formatDate(detail.count_date)} />
              <ErpFieldPreview label="Posting Date" value={formatDate(detail.posting_date)} />
              <ErpFieldPreview label="Opening Stock Source" value={detail.is_opening_stock_source ? "Yes" : "No"} />
              <ErpFieldPreview label="Submitted At" value={formatDateTime(detail.submitted_at)} />
              <ErpFieldPreview label="Posted At" value={formatDateTime(detail.posted_at)} />
            </div>
          </ErpSectionCard>

          {page === 1 ? (
            <>
              <ErpSectionCard eyebrow="Page 1" title="Stage Overview">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <ErpFieldPreview label="Mode" value={detail.mode || "—"} />
                  <ErpFieldPreview label="Count Date" value={formatDate(detail.count_date)} />
                  <ErpFieldPreview label="Posting Date" value={formatDate(detail.posting_date)} />
                  <ErpFieldPreview label="Progress" value={`Counted ${countedItems}/${items.length}`} caption={`Pending ${pendingItems}`} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <ErpFieldPreview label="Opening Stock Source" value={detail.is_opening_stock_source ? "Yes" : "No"} />
                  <ErpFieldPreview label="Submitted At" value={formatDateTime(detail.submitted_at)} />
                  <ErpFieldPreview label="Posted At" value={formatDateTime(detail.posted_at)} />
                  <ErpFieldPreview label="Variance Rows" value={`${items.filter((row) => Number(row.difference_qty ?? 0) !== 0).length}`} caption="Non-zero difference lines" />
                </div>
              </ErpSectionCard>
              <DocumentFlowSection docType="PID" docId={detail.id} />
            </>
          ) : null}

          {page === 2 && status === "PENDING_APPROVAL" ? (
            <div className="border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Select which items to post below (or Select All) — the selected batch posts atomically
              together. You can post in more than one batch; the document is fully POSTED once every
              non-zero-difference item has been posted. For batch-tracked SFG/FG rows, tick "Reco?" only
              if this difference should also proportionally adjust that batch's RM/PM/INT reco — leave it
              unchecked for routine small leftovers (only the SFG/FG stock itself will move).
            </div>
          ) : null}

          {page === 2 ? (
          <ErpSectionCard
            eyebrow="Page 2"
            title={status === "PENDING_APPROVAL" ? "Review And Post" : "Item Grid"}
            aside={<div className="text-sm font-semibold text-slate-600">Counted {countedItems}/{items.length} | Pending {pendingItems}</div>}
          >
            <ErpDenseGrid
              columns={[
                ...(status === "PENDING_APPROVAL" ? [{
                  key: "select",
                  label: <input type="checkbox" checked={postableItems.length > 0 && selectedItemIds.size === postableItems.length} onChange={toggleSelectAll} className="h-4 w-4" />,
                  width: "40px",
                  render: (row) => {
                    const isPostable = row.physical_qty !== null && row.physical_qty !== undefined && !row.posted_stock_document_id;
                    if (!isPostable) return row.posted_stock_document_id ? <span className="text-[10px] text-emerald-700">Posted</span> : null;
                    return (
                      <input
                        type="checkbox"
                        checked={selectedItemIds.has(row.id)}
                        onChange={() => toggleSelectItem(row.id)}
                        className="h-4 w-4"
                      />
                    );
                  },
                }] : []),
                { key: "line_number", label: "Line", width: "60px" },
                {
                  key: "material_id",
                  label: "Material",
                  // §8A fix — "—" on lookup miss, never a raw UUID.
                  render: (row) => (row.material_pace_code || row.material_name ? `${row.material_name ?? "Material"} (${row.material_pace_code ?? "—"})` : "—"),
                },
                { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number ?? "—" },
                ...(status === "PENDING_APPROVAL" ? [{
                  key: "apply_reco_adjustment",
                  label: "Reco?",
                  width: "70px",
                  // §119.14.1 — only batch-tracked SFG/FG rows can cascade to RM/PM/INT reco;
                  // everything else (RM/PM/INT, MTS-typed, non-batch) never shows this control.
                  render: (row) => {
                    const isBatchTrackedSfgFg = Boolean(row.batch_number) && ["SFG", "FG"].includes(String(row.material_type || "").toUpperCase());
                    const isPostable = Number(row.difference_qty ?? 0) !== 0 && !row.posted_stock_document_id;
                    if (!isBatchTrackedSfgFg || !isPostable) return <span className="text-slate-300">—</span>;
                    return (
                      <input
                        type="checkbox"
                        checked={recoItemIds.has(row.id)}
                        onChange={() => toggleRecoItem(row.id)}
                        title="Also proportionally adjust RM/PM/INT reco for this batch"
                        className="h-4 w-4"
                      />
                    );
                  },
                }] : []),
                { key: "stock_type", label: "Stock Type", width: "150px" },
                {
                  key: "storage_location_id",
                  label: "Location",
                  width: "150px",
                  // §8A fix — "—" on lookup miss, never a raw UUID.
                  render: (row) => row.storage_location_code || row.storage_location_name ? `${row.storage_location_code ?? "—"}` : "—",
                },
                { key: "book_qty", label: "Book Qty", width: "100px" },
                {
                  key: "physical_qty",
                  label: "Physical Qty",
                  width: "140px",
                  // Read-only here on purpose — entry happens only on MI04/MI05, never on this
                  // review screen (see file header comment).
                  render: (row) => (row.physical_qty === null || row.physical_qty === undefined ? <span className="text-slate-400">Not counted</span> : <span>{row.physical_qty}</span>),
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
                { key: "counted_by", label: "Counted By", width: "120px", render: (row) => (row.counted_by ? "Counted" : "—") },
                {
                  key: "actions",
                  label: "Actions",
                  width: "100px",
                  render: (row) => {
                    const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;
                    return canAddOrRemoveItems && !hasCount ? (
                      <button type="button" onClick={() => void handleRemoveItem(row.id)} className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900">
                        Remove
                      </button>
                    ) : null;
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
              emptyMessage="No PI items found."
              maxHeight="460px"
            />
            <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
              <span>Page {currentPage + 1} of {totalPages} ({items.length} items)</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setCurrentPage((page) => Math.max(0, page - 1))} disabled={currentPage === 0} className="border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 disabled:opacity-40">Prev</button>
                <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))} disabled={currentPage >= totalPages - 1} className="border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 disabled:opacity-40">Next</button>
              </div>
            </div>
          </ErpSectionCard>
          ) : null}

          {page === 3 && canAddOrRemoveItems ? (
            <ErpSectionCard eyebrow="Page 3" title="Adjust Scope (MI02)">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_200px_auto]">
                <ErpDenseFormRow label="Material" required>
                  <ErpComboboxField value={itemForm.material_id} onChange={(value) => setItemForm((current) => ({ ...current, material_id: value }))} options={materialOptions} blankLabel="Select material" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Stock Type" required>
                  <select value={itemForm.stock_type} onChange={(event) => setItemForm((current) => ({ ...current, stock_type: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    {STOCK_TYPES.map((entry) => (<option key={entry} value={entry}>{entry}</option>))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Storage Location" required>
                  <select value={itemForm.storage_location_id} onChange={(event) => setItemForm((current) => ({ ...current, storage_location_id: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                    <option value="">Select location</option>
                    {locationOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
                  </select>
                </ErpDenseFormRow>
                <div className="flex items-end">
                  <button type="button" disabled={saving} onClick={() => void handleAddItem()} className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50">
                    Add Item
                  </button>
                </div>
              </div>
            </ErpSectionCard>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
