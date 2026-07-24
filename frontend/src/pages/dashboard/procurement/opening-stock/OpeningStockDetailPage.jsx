/*
 * File-ID: 19.3.4
 * File-Path: frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx
 * Gate: 19 (ACL migration)
 * Domain: PROCUREMENT
 * Purpose: Opening stock document detail with locked IN05 single/bulk entry flow.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  addOpeningStockLine,
  getOpeningStockDocument,
  recalculateValuation,
  removeOpeningStockLine,
  submitOpeningStockDocument,
  updateOpeningStockLine,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import {
  useMaterialOptionsQuery,
  useStorageLocationsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { getDerivedOpeningRate } from "../../production/prodApi.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const ENTRY_MODES = Object.freeze({ SINGLE: "SINGLE", BULK: "BULK" });
const CURRENCY_LOCALE_MAP = Object.freeze({
  INR: "en-IN",
  USD: "en-US",
});
const BATCH_NUMBER_HELP_TEXT = "Required for MTO/HPS Prodshades - leave blank if this is an MTS (IWC/Powder) item; MTS batch integration is not yet supported here.";

function createEmptySingleForm() {
  return {
    material_id: "",
    storage_location_id: "",
    stock_type: "UNRESTRICTED",
    batch_number: "",
    quantity: "",
    rate_per_unit: "",
  };
}

function createBulkRow(index) {
  return {
    key: `bulk-${index}-${Date.now()}`,
    material_id: "",
    storage_location_id: "",
    stock_type: "UNRESTRICTED",
    batch_number: "",
    quantity: "",
    rate_per_unit: "",
    is_zero_stock: false,
  };
}

function formatCurrency(value, currencyCode = "INR") {
  const numericValue = Number(value ?? 0);
  const normalizedCurrency = String(currencyCode || "INR").toUpperCase();
  return new Intl.NumberFormat(CURRENCY_LOCALE_MAP[normalizedCurrency] ?? "en-IN", {
    style: "currency",
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

function getStatusTone(status) {
  switch (status) {
    case "SUBMITTED":
      return "amber";
    case "APPROVED":
      return "sky";
    case "POSTED":
      return "emerald";
    default:
      return "slate";
  }
}

function formatLocationLabel(location) {
  if (!location) return "--";
  return `${location.code ?? location.location_code ?? location.name ?? location.location_name ?? "Storage Location"} (${location.location_type ?? "STORE"})`;
}

export default function OpeningStockDetailPage({ documentId: documentIdProp = "" }) {
  const params = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const routeId = params.id && params.id !== ":id" ? params.id : "";
  const documentId = documentIdProp || routeId || screenContext.id || "";

  const [entryMode, setEntryMode] = useState(ENTRY_MODES.SINGLE);
  const [singleForm, setSingleForm] = useState(createEmptySingleForm());
  const [bulkRows, setBulkRows] = useState([createBulkRow(1), createBulkRow(2), createBulkRow(3)]);
  const [entryDrawerOpen, setEntryDrawerOpen] = useState(false);
  const [editingLineId, setEditingLineId] = useState("");
  const [editForm, setEditForm] = useState(createEmptySingleForm());
  // §109 — Opening Rate "Recalculate" (Phase 1, single material, no cascade yet).
  // Bulk-table UX per business owner feedback (2026-07-24): every un-recalculated
  // POSTED line gets an inline Corrected Rate input; ONE shared Reason + ONE
  // "Recalculate All" button submits every filled-in line in one action. Each
  // line is one-time-use (enforced server-side, VALUATION_RECALC_ALREADY_DONE) —
  // once done it shows as locked, no "reopen" mechanism exists yet.
  const [recalcRates, setRecalcRates] = useState({});
  const [recalcReason, setRecalcReason] = useState("");
  const [recalcResults, setRecalcResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const detailQuery = useQuery({
    queryKey: ["procurement", "opening-stock-detail", documentId],
    queryFn: () => getOpeningStockDocument(documentId),
    enabled: Boolean(documentId),
  });

  const detail = detailQuery.data ?? null;
  const companyId = detail?.company_id || "";
  const currencyCode = detail?.currency_code || "INR";
  const documentMaterialType = String(detail?.material_type || "").toUpperCase();
  const documentPoType = String(detail?.po_type || "").toUpperCase();
  const isBlockedPlaceholder =
    (documentMaterialType === "SFG" || documentMaterialType === "FG") &&
    (documentPoType === "MTO" || documentPoType === "HPS");

  const materialQuery = useMaterialOptionsQuery({ limit: 500, status: "ACTIVE" });
  const locationQuery = useStorageLocationsQuery(
    { company_id: companyId || undefined },
    { enabled: Boolean(companyId) },
  );
  const companiesQuery = useCompaniesQuery();

  const materials = useMemo(
    () =>
      materialQuery.materials.filter((material) => (
        !documentMaterialType || String(material.material_type || "").toUpperCase() === documentMaterialType
      )),
    [documentMaterialType, materialQuery.materials],
  );
  const locations = useMemo(
    () => (
      Array.isArray(locationQuery.data?.data)
        ? locationQuery.data.data
        : Array.isArray(locationQuery.data)
        ? locationQuery.data
        : []
    ),
    [locationQuery.data],
  );
  const companies = useMemo(
    () => (Array.isArray(companiesQuery.data) ? companiesQuery.data : []),
    [companiesQuery.data],
  );
  const loading =
    detailQuery.isLoading ||
    materialQuery.isLoading ||
    locationQuery.isLoading ||
    companiesQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () =>
        void Promise.all([
          detailQuery.refetch(),
          materialQuery.refetch(),
          locationQuery.refetch(),
          companiesQuery.refetch(),
        ]),
    },
  });

  const materialMap = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );
  const selectedSingleMaterial = materialMap.get(singleForm.material_id);
  const selectedEditMaterial = materialMap.get(editForm.material_id);
  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        value: material.id,
        label: `${material.material_name ?? "Material"} (${material.pace_code ?? material.material_code ?? material.id})`,
      })),
    [materials],
  );
  const locationMap = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const locationOptions = useMemo(
    () =>
      locations.map((location) => ({
        value: location.id,
        label: formatLocationLabel(location),
      })),
    [locations],
  );
  const companyMap = useMemo(
    () =>
      new Map(
        companies.map((company) => [
          company.id,
          `${company.company_code ?? "COMP"} | ${company.company_name ?? "Company"}`,
        ]),
      ),
    [companies],
  );
  const companyLabel = companyMap.get(companyId) ?? companyId;

  const totalValue = useMemo(
    () => Number(singleForm.quantity || 0) * Number(singleForm.rate_per_unit || 0),
    [singleForm],
  );

  // §104.8 (LOCKED 2026-07-18): for a produced material (INT today, SFG later) the opening rate can
  // be derived from its own Stroke — Σ(dosage% × that RM's current rate) — because opening stock is
  // loaded bottom-up (RM/PM → INT → SFG → FG), so the inputs are already valued by the time we get
  // here. It is only a SUGGESTION: a *purchased* opening INT must keep its purchase price, and
  // suggesting (not forcing) stops a hand-typed rate from diverging from the formula in-house
  // production will use — which would make the weighted average jump on the first PO after go-live.
  const derivedRateQuery = useQuery({
    queryKey: ["derived-opening-rate", companyId, singleForm.material_id],
    queryFn: () => getDerivedOpeningRate({ company_id: companyId, material_id: singleForm.material_id }),
    enabled: Boolean(companyId && singleForm.material_id),
    select: (response) => response?.data ?? response ?? null,
  });
  const derivedRate = derivedRateQuery.data?.derivable ? derivedRateQuery.data : null;

  const lines = Array.isArray(detail?.lines) ? detail.lines : [];
  const computedTotalValue = lines.reduce((sum, line) => sum + Number(line.total_value ?? 0), 0);
  const queryError =
    (!documentId ? "Opening stock document id is required." : "") ||
    detailQuery.error?.message ||
    materialQuery.error?.message ||
    locationQuery.error?.message ||
    companiesQuery.error?.message ||
    "";

  function resetSingleForm() {
    setSingleForm(createEmptySingleForm());
  }

  function appendBulkRow() {
    setBulkRows((current) => [...current, createBulkRow(current.length + 1)]);
  }

  function updateBulkRow(key, patch) {
    setBulkRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeBulkRow(key) {
    setBulkRows((current) => (current.length === 1 ? current : current.filter((row) => row.key !== key)));
  }

  function closeEntryDrawer() {
    setEntryDrawerOpen(false);
  }

  async function handleAddSingleLine() {
    if (!detail || detail.status !== "DRAFT") return;
    if (!singleForm.material_id || !singleForm.storage_location_id || !singleForm.quantity || singleForm.rate_per_unit === "") {
      setError("Material, storage location, quantity, and rate are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await addOpeningStockLine(detail.id, {
        material_id: singleForm.material_id,
        storage_location_id: singleForm.storage_location_id,
        stock_type: singleForm.stock_type,
        batch_number:
          selectedSingleMaterial?.material_type === "SFG" || selectedSingleMaterial?.material_type === "FG"
            ? singleForm.batch_number.trim().toUpperCase() || null
            : null,
        quantity: Number(singleForm.quantity),
        rate_per_unit: Number(singleForm.rate_per_unit),
      });
      setNotice("Opening stock line added.");
      resetSingleForm();
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBulkLines() {
    if (!detail || detail.status !== "DRAFT") return;
    const validRows = bulkRows.filter(
      (row) => row.material_id && row.storage_location_id && (row.is_zero_stock || Number(row.quantity) > 0),
    );
    if (validRows.length === 0) {
      setError("Fill at least one complete bulk row (or tick Zero Stock) before adding.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await Promise.all(
        validRows.map((row) => {
          const material = materialMap.get(row.material_id);
          const baseUom = material?.base_uom_code || null;
          const quantity = row.is_zero_stock ? 0 : Number(row.quantity);
          return addOpeningStockLine(detail.id, {
            material_id: row.material_id,
            storage_location_id: row.storage_location_id,
            stock_type: row.stock_type,
            quantity,
            rate_per_unit: row.rate_per_unit === "" ? 0 : Number(row.rate_per_unit),
            is_zero_stock: Boolean(row.is_zero_stock),
            entered_uom_code: baseUom,
            entered_quantity: quantity,
            batch_number:
              material?.material_type === "SFG" || material?.material_type === "FG"
                ? row.batch_number.trim().toUpperCase() || null
                : null,
          });
        }),
      );
      setNotice(`${validRows.length} opening stock lines added.`);
      setBulkRows([createBulkRow(1), createBulkRow(2), createBulkRow(3)]);
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function startEditLine(line) {
    setEditingLineId(line.id);
    setEditForm({
      material_id: line.material_id,
      storage_location_id: line.storage_location_id,
      stock_type: line.stock_type,
      quantity: String(line.quantity ?? ""),
      rate_per_unit: String(line.rate_per_unit ?? ""),
      batch_number: String(line.batch_number ?? ""),
    });
  }

  async function handleSaveEdit() {
    if (!detail || !editingLineId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateOpeningStockLine(detail.id, editingLineId, {
        storage_location_id: editForm.storage_location_id,
        stock_type: editForm.stock_type,
        batch_number:
          selectedEditMaterial?.material_type === "SFG" || selectedEditMaterial?.material_type === "FG"
            ? editForm.batch_number.trim().toUpperCase() || null
            : null,
        quantity: Number(editForm.quantity),
        rate_per_unit: Number(editForm.rate_per_unit),
      });
      setEditingLineId("");
      setNotice("Opening stock line updated.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function updateRecalcRate(lineId, value) {
    setRecalcRates((current) => ({ ...current, [lineId]: value }));
  }

  // §8B: each line's correction touches a different (material, location, stock_type)
  // snapshot row — independent of every other line — so this batch runs in parallel,
  // not a sequential for-loop.
  async function handleRecalculateAll() {
    if (!detail) return;
    const targets = lines.filter((line) => !line.already_recalculated && recalcRates[line.id]?.trim());
    if (targets.length === 0) {
      setError("Enter a Corrected Rate on at least one line first.");
      return;
    }
    if (!recalcReason.trim()) {
      setError("A reason is required before recalculating.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const results = await Promise.all(
      targets.map(async (line) => {
        try {
          const result = await recalculateValuation({
            line_id: line.id,
            company_id: detail.company_id,
            material_id: line.material_id,
            storage_location_id: line.storage_location_id,
            stock_type_code: line.stock_type,
            new_rate: Number(recalcRates[line.id]),
            reason: recalcReason.trim(),
          });
          return { lineId: line.id, materialId: line.material_id, ok: true, ...result };
        } catch (saveError) {
          return {
            lineId: line.id,
            materialId: line.material_id,
            ok: false,
            error: saveError instanceof Error ? saveError.message : "VALUATION_RECALC_FAILED",
          };
        }
      }),
    );
    setRecalcResults(results);
    setRecalcRates({});
    const succeeded = results.filter((r) => r.ok).length;
    setNotice(`Recalculated ${succeeded} of ${results.length} line(s). See results below for details.`);
    setSaving(false);
    await detailQuery.refetch();
  }

  async function handleRemoveLine(lineId) {
    if (!detail) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await removeOpeningStockLine(detail.id, lineId);
      setNotice("Opening stock line removed.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_DELETE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!detail) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await submitOpeningStockDocument(detail.id);
      setNotice("Opening stock document submitted for approval.");
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_DOCUMENT_SUBMIT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!entryDrawerOpen) return undefined;

    function handleDrawerEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      closeEntryDrawer();
    }

    window.addEventListener("keydown", handleDrawerEscape, true);
    return () => window.removeEventListener("keydown", handleDrawerEscape, true);
  }, [entryDrawerOpen]);

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title={detail?.document_number ? `Opening Stock | ${detail.document_number}` : "Opening Stock Detail"}
      notices={[
        ...((error || queryError)
          ? [{ key: "opening-stock-detail-error", tone: "error", message: error || queryError }]
          : []),
        ...(notice ? [{ key: "opening-stock-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: "Back To List",
          tone: "neutral",
          onClick: () => {
            openScreen("PROC_OPENING_STOCK_LIST");
          },
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () =>
            void Promise.all([
              detailQuery.refetch(),
              materialQuery.refetch(),
              locationQuery.refetch(),
              companiesQuery.refetch(),
            ]),
        },
        ...(detail?.status === "DRAFT"
          ? [{
              key: "submit",
              label: saving ? "Submitting..." : "Submit For Approval",
              tone: "primary",
              onClick: () => void handleSubmit(),
              disabled: saving,
            }]
          : []),
      ]}
    >
      {!detail ? (
        <ErpSectionCard eyebrow="Opening Stock" title="Document">
          <div className="text-sm text-slate-500">
            {loading ? "Loading opening stock document..." : "Opening stock document not found."}
          </div>
        </ErpSectionCard>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ErpFieldPreview label="Document #" value={detail.document_number} tone={getStatusTone(detail.status)} badge={detail.status} />
            <ErpFieldPreview label="Company" value={companyLabel || detail.company_id} />
            <ErpFieldPreview label="Cut-off Date" value={formatDate(detail.cut_off_date)} caption={`Created: ${formatDateTime(detail.created_at)}`} />
            <ErpFieldPreview label="Currency" value={currencyCode} />
            <ErpFieldPreview label="Notes" value={detail.notes || "No notes"} />
            <ErpFieldPreview label="Submitted At" value={formatDateTime(detail.submitted_at)} />
            <ErpFieldPreview label="Approved At" value={formatDateTime(detail.approved_at)} />
            <ErpFieldPreview label="Posted At" value={formatDateTime(detail.posted_at)} />
          </div>

          {!isBlockedPlaceholder ? (
            <ErpSectionCard
              eyebrow="Lines"
              title="Opening stock lines"
              aside={(
                <div className="text-sm font-semibold text-slate-600">
                  Total Lines: {lines.length} | Total Value: {formatCurrency(computedTotalValue, currencyCode)}
                </div>
              )}
            >
              <div className="grid gap-4">
                <ErpDenseGrid
                  columns={[
                    { key: "line_number", label: "Line #", width: "70px" },
                    {
                      key: "material_id",
                      label: "Material",
                      render: (row) => {
                        const material = materialMap.get(row.material_id);
                        return material
                          ? `${material.material_name ?? "Material"} (${material.pace_code ?? material.material_code ?? material.id})`
                          : row.material_id;
                      },
                    },
                    {
                      key: "storage_location_id",
                      label: "Storage Location",
                    render: (row) => {
                      const location = locationMap.get(row.storage_location_id);
                      return location ? formatLocationLabel(location) : "--";
                    },
                  },
                    { key: "stock_type", label: "Stock Type", width: "170px" },
                    { key: "quantity", label: "Qty", width: "100px" },
                    { key: "rate_per_unit", label: "Rate", width: "100px" },
                    {
                      key: "total_value",
                      label: "Total Value",
                      width: "140px",
                      render: (row) => formatCurrency(row.total_value, currencyCode),
                    },
                    { key: "movement_type_code", label: "Movement", width: "100px" },
                    ...(detail.status === "POSTED"
                      ? [{
                          key: "corrected_rate",
                          label: "Corrected Rate (§109)",
                          width: "160px",
                          render: (row) =>
                            row.already_recalculated ? (
                              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                Recalculated
                              </span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="New rate"
                                value={recalcRates[row.id] ?? ""}
                                onChange={(event) => updateRecalcRate(row.id, event.target.value)}
                                className="h-8 w-full border border-amber-300 bg-amber-50 px-2 text-sm text-amber-950 outline-none focus:border-amber-500"
                              />
                            ),
                        }]
                      : []),
                    {
                      key: "action",
                      label: "Action",
                      width: "140px",
                      render: (row) =>
                        detail.status === "DRAFT" ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEditLine(row)}
                              className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemoveLine(row.id)}
                              className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          "—"
                        ),
                    },
                  ]}
                  rows={lines}
                  rowKey={(row) => row.id}
                  emptyMessage={loading ? "Loading opening stock lines..." : "No lines added yet."}
                />

                {detail.status === "POSTED" ? (
                  <div className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-semibold text-amber-900">
                      Recalculate Valuation (§109 Phase 1 — one click for every filled-in line above, one-time-use per line)
                    </div>
                    <div className="text-xs text-amber-800">
                      Fill in "Corrected Rate" on whichever lines above need it, give one shared reason, then Recalculate All.
                      Downstream SFG/FG batches that consumed these materials are <strong>not</strong> auto-corrected yet —
                      check each result below for impacted postings that still need manual review. Already-recalculated lines
                      are locked — no "reopen" action exists yet.
                    </div>
                    <ErpDenseFormRow label="Reason (required, applies to all lines recalculated in this action)">
                      <input
                        type="text"
                        value={recalcReason}
                        onChange={(event) => setRecalcReason(event.target.value)}
                        placeholder="e.g. 31 July closing WAR received from Commercial"
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-amber-500"
                      />
                    </ErpDenseFormRow>
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() => void handleRecalculateAll()}
                        disabled={saving}
                        className="border border-amber-700 bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950 disabled:opacity-50"
                      >
                        {saving ? "Recalculating..." : "Recalculate All"}
                      </button>
                    </div>
                    {recalcResults.length > 0 ? (
                      <div className="grid gap-1 border-t border-amber-200 pt-3 text-sm text-amber-900">
                        {recalcResults.map((result) => {
                          const material = materialMap.get(result.materialId);
                          const materialLabel = material ? (material.material_name ?? result.materialId) : result.materialId;
                          return (
                            <div key={result.lineId}>
                              {result.ok ? (
                                <>
                                  <strong>{materialLabel}</strong>: {result.old_rate} {"->"} {result.new_rate} —{" "}
                                  {result.impacted_rows.length} downstream posting(s) not yet corrected
                                </>
                              ) : (
                                <span className="text-rose-700">
                                  <strong>{materialLabel}</strong>: failed — {result.error}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {detail.status === "DRAFT" && editingLineId ? (
                  <div className="grid gap-3 rounded border border-sky-200 bg-sky-50 p-4">
                    <div className="text-sm font-semibold text-sky-900">Edit Line</div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      <ErpDenseFormRow label="Storage Location">
                        <select
                          value={editForm.storage_location_id}
                          onChange={(event) => setEditForm((current) => ({ ...current, storage_location_id: event.target.value }))}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        >
                          <option value="">Select storage location</option>
                          {locationOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Stock Type">
                        <select
                          value={editForm.stock_type}
                          onChange={(event) => setEditForm((current) => ({ ...current, stock_type: event.target.value }))}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        >
                          {STOCK_TYPES.map((stockType) => (
                            <option key={stockType} value={stockType}>
                              {stockType}
                            </option>
                          ))}
                        </select>
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Quantity">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editForm.quantity}
                          onChange={(event) => setEditForm((current) => ({ ...current, quantity: event.target.value }))}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Rate Per Unit">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editForm.rate_per_unit}
                          onChange={(event) => setEditForm((current) => ({ ...current, rate_per_unit: event.target.value }))}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      {selectedEditMaterial?.material_type === "SFG" || selectedEditMaterial?.material_type === "FG" ? (
                        <ErpDenseFormRow label="Batch Number">
                          <input
                            type="text"
                            value={editForm.batch_number}
                            onChange={(event) => setEditForm((current) => ({ ...current, batch_number: event.target.value.toUpperCase() }))}
                            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveEdit()}
                        className="border border-sky-700 bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-950"
                      >
                        Save Line
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingLineId("")}
                        className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {detail.status === "DRAFT" ? (
                  <div className="border-t border-slate-200 pt-4">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                      Add Line
                    </div>
                    <div className="mb-4 text-lg font-semibold text-slate-900">
                      Single entry or bulk entry
                    </div>
                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={() => setEntryDrawerOpen(true)}
                        className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950"
                      >
                        Open Entry Drawer
                      </button>
                    </div>
                    <DrawerBase
                      visible={entryDrawerOpen}
                      title="Opening Stock Entry"
                      onEscape={closeEntryDrawer}
                      onClose={closeEntryDrawer}
                      width="min(1120px, calc(100vw - 24px))"
                      actions={(
                        <button
                          type="button"
                          onClick={closeEntryDrawer}
                          className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                        >
                          Close
                        </button>
                      )}
                    >
                    <div className="grid gap-4">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEntryMode(ENTRY_MODES.SINGLE)}
                          className={`border px-3 py-1 text-sm font-semibold ${
                            entryMode === ENTRY_MODES.SINGLE
                              ? "border-sky-700 bg-sky-100 text-sky-950"
                              : "border-slate-300 bg-white text-slate-700"
                          }`}
                        >
                          Single Entry
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryMode(ENTRY_MODES.BULK)}
                          className={`border px-3 py-1 text-sm font-semibold ${
                            entryMode === ENTRY_MODES.BULK
                              ? "border-sky-700 bg-sky-100 text-sky-950"
                              : "border-slate-300 bg-white text-slate-700"
                          }`}
                        >
                          Bulk Entry
                        </button>
                      </div>

                      {entryMode === ENTRY_MODES.SINGLE ? (
                        <div className="grid gap-3">
                          <ErpDenseFormRow label="Material" required>
                            <ErpComboboxField
                              value={singleForm.material_id}
                              onChange={(value) => setSingleForm((current) => ({ ...current, material_id: value }))}
                              options={materialOptions}
                              blankLabel="Select material"
                            />
                          </ErpDenseFormRow>
                          <ErpDenseFormRow label="Storage Location" required>
                            <select
                              value={singleForm.storage_location_id}
                              onChange={(event) => setSingleForm((current) => ({ ...current, storage_location_id: event.target.value }))}
                              className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                            >
                              <option value="">Select storage location</option>
                              {locationOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </ErpDenseFormRow>
                          <ErpDenseFormRow label="Stock Type" required>
                            <select
                              value={singleForm.stock_type}
                              onChange={(event) => setSingleForm((current) => ({ ...current, stock_type: event.target.value }))}
                              className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                            >
                              {STOCK_TYPES.map((stockType) => (
                                <option key={stockType} value={stockType}>
                                  {stockType}
                                </option>
                              ))}
                            </select>
                          </ErpDenseFormRow>
                          {selectedSingleMaterial?.material_type === "SFG" || selectedSingleMaterial?.material_type === "FG" ? (
                            <ErpDenseFormRow label="Batch Number">
                              <input
                                type="text"
                                value={singleForm.batch_number}
                                onChange={(event) => setSingleForm((current) => ({ ...current, batch_number: event.target.value.toUpperCase() }))}
                                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                              />
                            </ErpDenseFormRow>
                          ) : null}
                          <div className="grid gap-3 xl:grid-cols-3">
                            <ErpDenseFormRow label="Quantity" required>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={singleForm.quantity}
                                onChange={(event) => setSingleForm((current) => ({ ...current, quantity: event.target.value }))}
                                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                              />
                            </ErpDenseFormRow>
                            <ErpDenseFormRow label="Rate Per Unit" required>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={singleForm.rate_per_unit}
                                onChange={(event) => setSingleForm((current) => ({ ...current, rate_per_unit: event.target.value }))}
                                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                              />
                            </ErpDenseFormRow>
                            {derivedRate && (
                              <div className="col-span-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-slate-700">
                                <div className="flex items-center justify-between gap-3">
                                  <span>
                                    Suggested rate from Stroke {derivedRate.stroke_number ?? "--"}:{" "}
                                    <strong className="font-mono">{Number(derivedRate.rate).toFixed(4)}</strong>
                                    <span className="text-slate-500"> / unit</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setSingleForm((current) => ({
                                      ...current,
                                      rate_per_unit: String(Number(derivedRate.rate).toFixed(4)),
                                    }))}
                                    className="border border-sky-500 bg-white px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-100"
                                  >
                                    Use this
                                  </button>
                                </div>
                                <div className="mt-1 text-slate-500">
                                  {derivedRate.lines.map((l) => (
                                    <span key={l.material_id} className="mr-3 inline-block">
                                      {(l.pace_code || "--")} {Number(l.dosage_pct).toFixed(2)}% x{" "}
                                      {Number(l.rm_rate).toFixed(4)} = {Number(l.contribution).toFixed(4)}
                                    </span>
                                  ))}
                                </div>
                                {derivedRate.incomplete && (
                                  <div className="mt-1 text-amber-700">
                                    One or more inputs have no valued stock yet — load their opening stock first,
                                    or this suggestion is understated.
                                  </div>
                                )}
                                <div className="mt-1 text-slate-400">
                                  Use only if this stock was produced in-house. If it was purchased, enter the
                                  purchase rate instead.
                                </div>
                              </div>
                            )}
                            <ErpDenseFormRow label="Total Value">
                              <input
                                value={formatCurrency(totalValue, currencyCode)}
                                readOnly
                                className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-900 outline-none"
                              />
                            </ErpDenseFormRow>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => void handleAddSingleLine()}
                              disabled={saving}
                              className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {saving ? "Adding..." : "Add Line"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          <div className="rounded-lg border border-slate-200 bg-white">
                            <div className="overflow-x-auto">
                              <table className="min-w-full border-collapse text-sm">
                                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                                  <tr>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Sl No</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Material Type</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Material Name</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Pace Code (auto)</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Storage Location</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Status</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Base UOM</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Batch Number</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Counted Stock</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Zero Stock</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Rate</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Total Value</th>
                                    <th className="border-b border-slate-200 px-3 py-2 text-left">Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bulkRows.map((row, index) => {
                                    const material = materialMap.get(row.material_id);
                                    return (
                                      <tr key={row.key} className="align-top even:bg-slate-50/40">
                                        <td className="border-b border-slate-100 px-3 py-2">{index + 1}</td>
                                        <td className="border-b border-slate-100 px-3 py-2">{material?.material_type ?? "—"}</td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[260px]">
                                          <ErpComboboxField
                                            value={row.material_id}
                                            onChange={(value) => updateBulkRow(row.key, { material_id: value })}
                                            options={materialOptions}
                                            blankLabel="Select material"
                                          />
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">{material?.pace_code ?? "—"}</td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[240px]">
                                          <select
                                            value={row.storage_location_id}
                                            onChange={(event) => updateBulkRow(row.key, { storage_location_id: event.target.value })}
                                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                          >
                                            <option value="">Select location</option>
                                            {locationOptions.map((option) => (
                                              <option key={option.value} value={option.value}>
                                                {option.label}
                                              </option>
                                            ))}
                                          </select>
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[170px]">
                                          <select
                                            value={row.stock_type}
                                            onChange={(event) => updateBulkRow(row.key, { stock_type: event.target.value })}
                                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                          >
                                            {STOCK_TYPES.map((stockType) => (
                                              <option key={stockType} value={stockType}>
                                                {stockType}
                                              </option>
                                            ))}
                                          </select>
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">{material?.base_uom_code ?? "—"}</td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[180px]">
                                          {material?.material_type === "SFG" || material?.material_type === "FG" ? (
                                            <input
                                              type="text"
                                              value={row.batch_number}
                                              onChange={(event) => updateBulkRow(row.key, { batch_number: event.target.value.toUpperCase() })}
                                              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                            />
                                          ) : (
                                            <span className="text-slate-400">—</span>
                                          )}
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[130px]">
                                          <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={row.is_zero_stock ? "0" : row.quantity}
                                            disabled={row.is_zero_stock}
                                            onChange={(event) => updateBulkRow(row.key, { quantity: event.target.value })}
                                            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-500"
                                          />
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(row.is_zero_stock)}
                                            onChange={(event) => updateBulkRow(row.key, {
                                              is_zero_stock: event.target.checked,
                                              quantity: event.target.checked ? "0" : row.quantity,
                                            })}
                                            className="h-4 w-4"
                                          />
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[130px]">
                                          <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            placeholder="Optional"
                                            value={row.rate_per_unit}
                                            onChange={(event) => updateBulkRow(row.key, { rate_per_unit: event.target.value })}
                                            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                          />
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">
                                          {formatCurrency(Number(row.quantity || 0) * Number(row.rate_per_unit || 0), currencyCode)}
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">
                                          <button
                                            type="button"
                                            onClick={() => removeBulkRow(row.key)}
                                            className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                                          >
                                            Remove
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            {BATCH_NUMBER_HELP_TEXT}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={appendBulkRow}
                              className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
                            >
                              Add Row
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAddBulkLines()}
                              disabled={saving}
                              className="border border-sky-700 bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {saving ? "Adding..." : "Add All Lines"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    </DrawerBase>
                  </div>
                ) : null}
              </div>
            </ErpSectionCard>
          ) : null}

          {detail && isBlockedPlaceholder ? (
            <ErpSectionCard eyebrow="Entry" title="Opening Stock Entry">
              <div className="text-sm text-slate-700">Will open after implementation</div>
            </ErpSectionCard>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
