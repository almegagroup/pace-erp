/*
 * PIDocumentDetailPage — MI02/MI03/MI07 review + oversight (§119.4). MI04 (blind count entry)
 * moved out to its own page, PIDocumentCountEntryPage.jsx, 2026-08-14 — the whole point of a
 * physical count is a blind comparison against the system's book quantity, so the screen where
 * someone types in what they physically found must never show that book quantity. This page is
 * the opposite: it's for reviewing what's already been counted (Book Qty/Difference are exactly
 * what a supervisor/auditor needs here to decide whether to Recount, Submit, Reopen, or Post) —
 * by the time an item has a physical_qty on this page, the blind-entry moment has already
 * happened, so showing the variance here is not a bias risk, it's the actual job of this screen.
 */
import { useMemo, useState } from "react";
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
  requestPIRecount,
  submitPIDForApproval,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useMaterialOptionsQuery,
  useStorageLocationsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const PI_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "COUNTED":
      return "amber";
    case "PENDING_APPROVAL":
      return "violet";
    case "POSTED":
      return "emerald";
    case "CANCELLED":
      return "slate";
    case "OPEN":
    default:
      return "sky";
  }
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

  const items = Array.isArray(detail?.items) ? detail.items : [];
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
  const canEditCounts = ["OPEN", "COUNTED"].includes(status);
  const canAddOrRemoveItems = status === "OPEN";
  const canCancel = status === "OPEN";
  const canSubmit = status === "COUNTED";
  const canReopen = status === "PENDING_APPROVAL";
  const canPost = status === "PENDING_APPROVAL";

  const queryError = detailQuery.error?.message || materialQuery.error?.message || locationQuery.error?.message || "";

  async function handleRecount(itemId) {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    try {
      await requestPIRecount(detail.id, itemId);
      setNotice("Recount requested.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_RECOUNT_FAILED");
    } finally {
      setSaving(false);
    }
  }

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

  async function handleSubmitForApproval() {
    if (!detail?.id) return;
    const confirmed = await openActionConfirm({
      eyebrow: "Physical Inventory",
      title: "Submit for approval?",
      message: "This locks counting — MI04/MI05 will be disabled until Reopened.",
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

  async function handlePostDifferences() {
    if (!detail?.id) return;
    // §119.9 — document-wide atomic: everything posts together or nothing does.
    const confirmed = await openActionConfirm({
      eyebrow: "Physical Inventory",
      title: "Post stock differences?",
      message: "This posts every item's difference to the inventory ledger in one transaction. Cannot be undone.",
      confirmLabel: "Post",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await postPIDifferences(detail.id);
      setNotice("PI differences posted.");
      await detailQuery.refetch();
    } catch (saveError) {
      // §119.5 — authority errors (staff-vs-auditor-vs-director) surface here verbatim.
      setError(saveError instanceof Error ? saveError.message : "PI_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function openPrint() {
    openScreen(OPERATION_SCREENS.PROC_PI_PRINT.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}/print`);
  }

  function openCountEntry() {
    openScreen(OPERATION_SCREENS.PROC_PI_COUNT_ENTRY.screen_code, { context: { id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(id)}/count`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title={detail?.document_number ? `Physical Inventory | ${detail.document_number}` : "Physical Inventory Detail"}
      notices={[
        ...((error || queryError) ? [{ key: "pi-detail-error", tone: "error", message: error || queryError }] : []),
        ...(notice ? [{ key: "pi-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: "Back To List",
          tone: "neutral",
          onClick: () => {
            openScreen(OPERATION_SCREENS.PROC_PI_LIST.screen_code);
            navigate("/dashboard/procurement/physical-inventory");
          },
        },
        { key: "print", label: "Print Count Sheet", tone: "neutral", onClick: openPrint },
        ...(canEditCounts ? [{ key: "count-entry", label: "Enter Counts", tone: "primary", onClick: openCountEntry }] : []),
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void Promise.all([detailQuery.refetch(), materialQuery.refetch(), locationQuery.refetch()]),
        },
        ...(canCancel ? [{ key: "cancel", label: "Cancel Document", tone: "danger", onClick: () => setReasonModal("cancel"), disabled: saving }] : []),
        ...(canSubmit ? [{ key: "submit", label: saving ? "Submitting..." : "Submit for Approval", tone: "primary", onClick: () => void handleSubmitForApproval(), disabled: saving }] : []),
        ...(canReopen ? [{ key: "reopen", label: "Reopen", tone: "neutral", onClick: () => setReasonModal("reopen"), disabled: saving }] : []),
        ...(canPost ? [{ key: "post", label: saving ? "Posting..." : "Post Differences", tone: "primary", onClick: () => void handlePostDifferences(), disabled: saving }] : []),
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
            <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
            <ErpFieldPreview label="Company" value={detail.company_name || detail.company_code || "—"} />
            <ErpFieldPreview
              label="Storage Location"
              value={detail.mode === "LOCATION_WISE" ? (detail.storage_location_name || detail.storage_location_code || "—") : "Multiple (ITEM_WISE)"}
            />
            <ErpFieldPreview label="Progress" value={`Counted ${countedItems}/${items.length}`} caption={`Pending ${pendingItems}`} />
          </div>

          <ErpSectionCard eyebrow="Header" title={detail.document_number || "PI Document"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Mode" value={detail.mode || "—"} />
              <ErpFieldPreview label="Count Date" value={formatDate(detail.count_date)} />
              <ErpFieldPreview label="Posting Date" value={formatDate(detail.posting_date)} />
              <ErpFieldPreview label="Opening Stock Source" value={detail.is_opening_stock_source ? "Yes" : "No"} />
              <ErpFieldPreview label="Submitted At" value={formatDateTime(detail.submitted_at)} />
              <ErpFieldPreview label="Posted At" value={formatDateTime(detail.posted_at)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Count Progress"
            title="Item counts"
            aside={<div className="text-sm font-semibold text-slate-600">Counted {countedItems}/{items.length} | Pending {pendingItems}</div>}
          >
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "60px" },
                {
                  key: "material_id",
                  label: "Material",
                  // §8A fix — "—" on lookup miss, never a raw UUID.
                  render: (row) => (row.material_pace_code || row.material_name ? `${row.material_name ?? "Material"} (${row.material_pace_code ?? "—"})` : "—"),
                },
                { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number ?? "—" },
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
                  // Read-only here on purpose — entry happens only on the blind Count Entry
                  // (MI04) page, never on this review screen (see file header comment).
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
                  width: "160px",
                  render: (row) => {
                    const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;
                    const isPosted = Boolean(row.posted_stock_document_id);
                    return (
                      <div className="flex gap-1">
                        {canEditCounts && !isPosted && hasCount ? (
                          <button type="button" onClick={() => void handleRecount(row.id)} className="border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                            Recount
                          </button>
                        ) : null}
                        {canAddOrRemoveItems && !hasCount ? (
                          <button type="button" onClick={() => void handleRemoveItem(row.id)} className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900">
                            Remove
                          </button>
                        ) : null}
                      </div>
                    );
                  },
                },
              ]}
              rows={items}
              rowKey={(row) => row.id}
              getRowProps={(row) => {
                if (row.physical_qty === null || row.physical_qty === undefined) return {};
                const diff = Number(row.difference_qty ?? 0);
                return { className: diff < 0 ? "bg-rose-50" : diff > 0 ? "bg-emerald-50" : "bg-slate-50" };
              }}
              emptyMessage="No PI items found."
              maxHeight="460px"
            />
          </ErpSectionCard>

          {canAddOrRemoveItems ? (
            <ErpSectionCard eyebrow="Add Item" title="Add item to current PI document (MI02)">
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

          <DocumentFlowSection docType="PID" docId={detail.id} />
        </div>
      )}
    </ErpScreenScaffold>
  );
}

