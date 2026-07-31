/*
 * File-ID: 19.3.4
 * File-Path: frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx
 * Gate: 19 (ACL migration)
 * Domain: PROCUREMENT
 * Purpose: Opening stock document detail with locked IN05 single/bulk entry flow.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  addOpeningStockLine,
  getOpeningStockDocument,
  listMaterialUomConversionsForProcurement,
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
import {
  getDerivedOpeningRate,
  listOldPackingPoBatches,
  listOldProcessPoBatches,
} from "../../production/prodApi.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const ENTRY_MODES = Object.freeze({ SINGLE: "SINGLE", BULK: "BULK" });
const OPENING_GENEALOGY_PO_TYPES = new Set(["MTO", "HPS"]);
const RATE_UOM_PO_TYPES = new Set(["MTS", "MTEST"]);
const CURRENCY_LOCALE_MAP = Object.freeze({
  INR: "en-IN",
  USD: "en-US",
});
const BATCH_NUMBER_HELP_TEXT = "MTO/HPS SFG must select a PR22 batch. MTO/HPS FG must select a PR23 packing order; batch is derived automatically. MTS/MTEST can still type batch manually.";

function createEmptySingleForm() {
  return {
    material_id: "",
    storage_location_id: "",
    stock_type: "UNRESTRICTED",
    batch_number: "",
    packing_order_id: "",
    quantity: "",
    entered_uom_code: "",
    entered_quantity: "",
    rate_per_unit: "",
    rate_uom_code: "",
  };
}

function createBulkRow(index) {
  return {
    key: `bulk-${index}-${Date.now()}`,
    material_id: "",
    storage_location_id: "",
    stock_type: "UNRESTRICTED",
    batch_number: "",
    packing_order_id: "",
    quantity: "",
    entered_uom_code: "",
    entered_quantity: "",
    rate_per_unit: "",
    rate_uom_code: "",
    is_zero_stock: false,
  };
}

function buildRateUomOptions(material, conversions, includeAlternatesOnly = false) {
  const baseUomCode = material?.base_uom_code || "";
  const options = [];
  if (baseUomCode && !includeAlternatesOnly) {
    options.push({ value: baseUomCode, label: `${baseUomCode} (Base)`, factor: 1 });
  }
  for (const row of conversions ?? []) {
    if (row.variable_conversion || row.to_uom_code !== baseUomCode || row.from_uom_code === baseUomCode) continue;
    const factor = Number(row.conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    options.push({ value: row.from_uom_code, label: row.from_uom_code, factor });
  }
  return options;
}

function findRateFactor(material, conversions, uomCode) {
  const options = buildRateUomOptions(material, conversions, false);
  return options.find((option) => option.value === uomCode)?.factor ?? 1;
}

function baseRateToDisplay(baseRate, material, conversions, uomCode) {
  const factor = findRateFactor(material, conversions, uomCode || material?.base_uom_code);
  return Number(baseRate ?? 0) * factor;
}

function displayRateToBase(displayRate, material, conversions, uomCode) {
  const factor = findRateFactor(material, conversions, uomCode || material?.base_uom_code);
  return factor > 0 ? Number(displayRate ?? 0) / factor : Number(displayRate ?? 0);
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

function isSfgGenealogyDocument(isOpeningGenealogyDocument, documentMaterialType) {
  return isOpeningGenealogyDocument && documentMaterialType === "SFG";
}

function isFgGenealogyDocument(isOpeningGenealogyDocument, documentMaterialType) {
  return isOpeningGenealogyDocument && documentMaterialType === "FG";
}

function normalizeNumeric(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumOtherLineQuantities(lines, matcher, excludeLineId = "") {
  return (lines ?? []).reduce((sum, line) => {
    if (excludeLineId && String(line.id ?? "") === String(excludeLineId)) return sum;
    return matcher(line) ? sum + normalizeNumeric(line.quantity) : sum;
  }, 0);
}

function sumOtherDraftQuantities(rows, matcher, excludeRowKey = "") {
  return (rows ?? []).reduce((sum, row) => {
    if (excludeRowKey && row.key === excludeRowKey) return sum;
    return matcher(row) ? sum + normalizeNumeric(row.quantity) : sum;
  }, 0);
}

function batchOptionLabel(batch) {
  return `${batch.batch_number} · Stroke ${batch.stroke_number ?? "--"} · ${normalizeNumeric(batch.actual_qty).toFixed(3)} KG`;
}

function packingOptionLabel(packingOrder) {
  return `${packingOrder.po_number} · Batch ${packingOrder.batch_number} · ${normalizeNumeric(packingOrder.actual_qty_kg).toFixed(3)} KG`;
}

function resolveSfgRemaining(batch, lines, excludeLineId = "") {
  const usedQty = sumOtherLineQuantities(lines, (line) => String(line.batch_number ?? "") === String(batch.batch_number ?? ""), excludeLineId);
  return Math.max(normalizeNumeric(batch.actual_qty) - usedQty, 0);
}

function resolveFgRemaining(packingOrder, lines, excludeLineId = "") {
  const usedQty = sumOtherLineQuantities(lines, (line) => String(line.packing_order_id ?? "") === String(packingOrder.id ?? ""), excludeLineId);
  return Math.max(normalizeNumeric(packingOrder.actual_qty_kg) - usedQty, 0);
}

function resolveBulkSfgRemaining(batch, lines, bulkRows, rowKey) {
  const postedQty = sumOtherLineQuantities(lines, (line) => String(line.batch_number ?? "") === String(batch.batch_number ?? ""));
  const draftQty = sumOtherDraftQuantities(bulkRows, (row) => String(row.batch_number ?? "") === String(batch.batch_number ?? ""), rowKey);
  return Math.max(normalizeNumeric(batch.actual_qty) - postedQty - draftQty, 0);
}

function resolveBulkFgRemaining(packingOrder, lines, bulkRows, rowKey) {
  const postedQty = sumOtherLineQuantities(lines, (line) => String(line.packing_order_id ?? "") === String(packingOrder.id ?? ""));
  const draftQty = sumOtherDraftQuantities(bulkRows, (row) => String(row.packing_order_id ?? "") === String(packingOrder.id ?? ""), rowKey);
  return Math.max(normalizeNumeric(packingOrder.actual_qty_kg) - postedQty - draftQty, 0);
}

function resolveOpeningRatePerUnit(displayRate, material, conversions, rateUomCode, fillQtyPerPack) {
  const numericRate = normalizeNumeric(displayRate);
  if (Number(fillQtyPerPack) > 0) {
    return numericRate / Number(fillQtyPerPack);
  }
  return displayRateToBase(numericRate, material, conversions, rateUomCode || material?.base_uom_code);
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
  // Â§109 â€” Opening Rate "Recalculate" (Phase 1, single material, no cascade yet).
  // Bulk-table UX per business owner feedback (2026-07-24): every un-recalculated
  // POSTED line gets an inline Corrected Rate input; ONE shared Reason + ONE
  // "Recalculate All" button submits every filled-in line in one action. Each
  // line is one-time-use (enforced server-side, VALUATION_RECALC_ALREADY_DONE) â€”
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
  const isOpeningGenealogyDocument =
    (documentMaterialType === "SFG" || documentMaterialType === "FG") &&
    OPENING_GENEALOGY_PO_TYPES.has(documentPoType);
  const showRateUomSelector = RATE_UOM_PO_TYPES.has(documentPoType);
  const isSfgGenealogy = isSfgGenealogyDocument(isOpeningGenealogyDocument, documentMaterialType);
  const isFgGenealogy = isFgGenealogyDocument(isOpeningGenealogyDocument, documentMaterialType);

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
    () => Number(singleForm.quantity || 0) * resolveOpeningRatePerUnit(
      singleForm.rate_per_unit || 0,
      selectedSingleMaterial,
      singleConversionsQuery.data,
      singleForm.rate_uom_code || selectedSingleMaterial?.base_uom_code,
      selectedSingleFgOrder?.fill_qty_per_pack,
    ),
    [singleForm, selectedSingleFgOrder?.fill_qty_per_pack, selectedSingleMaterial, singleConversionsQuery.data],
  );

  // Â§104.8 (LOCKED 2026-07-18): for a produced material (INT today, SFG later) the opening rate can
  // be derived from its own Stroke â€” Î£(dosage% Ã— that RM's current rate) â€” because opening stock is
  // loaded bottom-up (RM/PM â†’ INT â†’ SFG â†’ FG), so the inputs are already valued by the time we get
  // here. It is only a SUGGESTION: a *purchased* opening INT must keep its purchase price, and
  // suggesting (not forcing) stops a hand-typed rate from diverging from the formula in-house
  // production will use â€” which would make the weighted average jump on the first PO after go-live.
  const derivedRateQuery = useQuery({
    queryKey: ["derived-opening-rate", companyId, singleForm.material_id],
    queryFn: () => getDerivedOpeningRate({ company_id: companyId, material_id: singleForm.material_id }),
    enabled: Boolean(companyId && singleForm.material_id),
    select: (response) => response?.data ?? response ?? null,
  });
  const derivedRate = derivedRateQuery.data?.derivable ? derivedRateQuery.data : null;

  // Â§110 Phase B â€” the material's own alternate UoMs (e.g. a purchased-in-bags
  // RM, or an FG SKU's own outer pack unit), so the user can type "23 bags"
  // instead of hand-computing KG. Falls back to base-UoM-only display when a
  // material has no material_uom_conversion rows (Â§110.4, deliberate â€” no
  // bulk data-entry forced on materials that don't need it).
  const singleConversionsQuery = useQuery({
    queryKey: ["material-uom-conversions", singleForm.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(singleForm.material_id),
    enabled: Boolean(singleForm.material_id),
    select: (response) => response?.data ?? [],
  });
  const editConversionsQuery = useQuery({
    queryKey: ["material-uom-conversions", editForm.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(editForm.material_id),
    enabled: Boolean(editForm.material_id),
    select: (response) => response?.data ?? [],
  });
  const bulkConversionQueries = useQueries({
    queries: bulkRows.map((row) => ({
      queryKey: ["material-uom-conversions", row.material_id],
      queryFn: () => listMaterialUomConversionsForProcurement(row.material_id),
      enabled: Boolean(row.material_id),
      select: (response) => response?.data ?? [],
    })),
  });
  const singleOpeningSfgQuery = useQuery({
    queryKey: ["old-process-po-batches", companyId, singleForm.material_id],
    queryFn: () => listOldProcessPoBatches({ company_id: companyId, material_id: singleForm.material_id }),
    enabled: Boolean(isOpeningGenealogyDocument && documentMaterialType === "SFG" && companyId && singleForm.material_id),
    select: (response) => response?.data ?? response ?? [],
  });
  const singleOpeningFgQuery = useQuery({
    queryKey: ["old-packing-po-batches", companyId, singleForm.material_id],
    queryFn: () => listOldPackingPoBatches({ company_id: companyId, material_id: singleForm.material_id }),
    enabled: Boolean(isOpeningGenealogyDocument && documentMaterialType === "FG" && companyId && singleForm.material_id),
    select: (response) => response?.data ?? response ?? [],
  });
  const editOpeningSfgQuery = useQuery({
    queryKey: ["old-process-po-batches", companyId, editForm.material_id, "edit"],
    queryFn: () => listOldProcessPoBatches({ company_id: companyId, material_id: editForm.material_id }),
    enabled: Boolean(isOpeningGenealogyDocument && documentMaterialType === "SFG" && companyId && editForm.material_id),
    select: (response) => response?.data ?? response ?? [],
  });
  const editOpeningFgQuery = useQuery({
    queryKey: ["old-packing-po-batches", companyId, editForm.material_id, "edit"],
    queryFn: () => listOldPackingPoBatches({ company_id: companyId, material_id: editForm.material_id }),
    enabled: Boolean(isOpeningGenealogyDocument && documentMaterialType === "FG" && companyId && editForm.material_id),
    select: (response) => response?.data ?? response ?? [],
  });
  const bulkOpeningQueries = useQueries({
    queries: bulkRows.map((row) => ({
      queryKey: [
        documentMaterialType === "FG" ? "old-packing-po-batches" : "old-process-po-batches",
        companyId,
        row.material_id,
        row.key,
      ],
      queryFn: () => (
        documentMaterialType === "FG"
          ? listOldPackingPoBatches({ company_id: companyId, material_id: row.material_id })
          : listOldProcessPoBatches({ company_id: companyId, material_id: row.material_id })
      ),
      enabled: Boolean(isOpeningGenealogyDocument && companyId && row.material_id),
      select: (response) => response?.data ?? response ?? [],
    })),
  });
  const singleRateUomOptions = useMemo(
    () => buildRateUomOptions(selectedSingleMaterial, singleConversionsQuery.data, showRateUomSelector),
    [selectedSingleMaterial, singleConversionsQuery.data, showRateUomSelector],
  );
  const editRateUomOptions = useMemo(
    () => buildRateUomOptions(selectedEditMaterial, editConversionsQuery.data, showRateUomSelector),
    [selectedEditMaterial, editConversionsQuery.data, showRateUomSelector],
  );

  const lines = Array.isArray(detail?.lines) ? detail.lines : [];
  const selectedSingleSfgBatch = useMemo(
    () => (singleOpeningSfgQuery.data ?? []).find((row) => String(row.batch_number ?? "") === String(singleForm.batch_number ?? "")) ?? null,
    [singleForm.batch_number, singleOpeningSfgQuery.data],
  );
  const selectedSingleFgOrder = useMemo(
    () => (singleOpeningFgQuery.data ?? []).find((row) => String(row.id ?? "") === String(singleForm.packing_order_id ?? "")) ?? null,
    [singleForm.packing_order_id, singleOpeningFgQuery.data],
  );
  const selectedEditSfgBatch = useMemo(
    () => (editOpeningSfgQuery.data ?? []).find((row) => String(row.batch_number ?? "") === String(editForm.batch_number ?? "")) ?? null,
    [editForm.batch_number, editOpeningSfgQuery.data],
  );
  const selectedEditFgOrder = useMemo(
    () => (editOpeningFgQuery.data ?? []).find((row) => String(row.id ?? "") === String(editForm.packing_order_id ?? "")) ?? null,
    [editForm.packing_order_id, editOpeningFgQuery.data],
  );
  const computedTotalValue = lines.reduce((sum, line) => sum + Number(line.total_value ?? 0), 0);

  // Â§104-7/Â§109 â€” SFG and INT get the same dosage-derived rate suggestion at
  // Recalculate time as they do at original Opening entry (Stroke dosage% x
  // that RM's CURRENT rate) â€” useful here because the RM side may have just
  // been corrected in an earlier step of the same sweep. Still only a
  // suggestion: a purchased INT/SFG batch keeps its own real rate.
  const recalcSuggestLines = lines.filter((line) => {
    if (line.already_recalculated) return false;
    const materialType = materialMap.get(line.material_id)?.material_type;
    return materialType === "SFG" || materialType === "INT";
  });
  const recalcDerivedRateQueries = useQueries({
    queries: recalcSuggestLines.map((line) => ({
      queryKey: ["derived-opening-rate-recalc", detail?.company_id, line.material_id],
      queryFn: () => getDerivedOpeningRate({ company_id: detail?.company_id, material_id: line.material_id }),
      enabled: Boolean(detail?.status === "POSTED" && detail?.company_id && line.material_id),
      select: (response) => response?.data ?? response ?? null,
    })),
  });
  const recalcDerivedRateByLineId = new Map(
    recalcSuggestLines.map((line, index) => [line.id, recalcDerivedRateQueries[index]?.data ?? null]),
  );
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
        packing_order_id: singleForm.packing_order_id || null,
        batch_number:
          selectedSingleMaterial?.material_type === "SFG" || selectedSingleMaterial?.material_type === "FG"
            ? singleForm.batch_number.trim().toUpperCase() || null
            : null,
        quantity: Number(singleForm.quantity),
        entered_uom_code: singleForm.entered_uom_code || null,
        entered_quantity: singleForm.entered_quantity === "" ? null : Number(singleForm.entered_quantity),
        rate_per_unit: resolveOpeningRatePerUnit(
          singleForm.rate_per_unit || 0,
          selectedSingleMaterial,
          singleConversionsQuery.data,
          singleForm.rate_uom_code || selectedSingleMaterial?.base_uom_code,
          selectedSingleFgOrder?.fill_qty_per_pack,
        ),
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
          const rowIndex = bulkRows.indexOf(row);
          const material = materialMap.get(row.material_id);
          const baseUom = material?.base_uom_code || null;
          const quantity = row.is_zero_stock ? 0 : Number(row.quantity);
          const openingRows = bulkOpeningQueries[rowIndex]?.data ?? [];
          const selectedFgOrder = documentMaterialType === "FG"
            ? openingRows.find((entry) => String(entry.id ?? "") === String(row.packing_order_id ?? "")) ?? null
            : null;
          return addOpeningStockLine(detail.id, {
            material_id: row.material_id,
            storage_location_id: row.storage_location_id,
            stock_type: row.stock_type,
            quantity,
            rate_per_unit: row.rate_per_unit === ""
              ? 0
              : resolveOpeningRatePerUnit(
                row.rate_per_unit,
                material,
                bulkConversionQueries[rowIndex]?.data,
                row.rate_uom_code || material?.base_uom_code,
                selectedFgOrder?.fill_qty_per_pack,
              ),
            is_zero_stock: Boolean(row.is_zero_stock),
            entered_uom_code: row.is_zero_stock ? baseUom : (row.entered_uom_code || baseUom),
            entered_quantity: row.is_zero_stock ? 0 : (row.entered_quantity === "" ? quantity : Number(row.entered_quantity)),
            packing_order_id: row.packing_order_id || null,
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
    const material = materialMap.get(line.material_id);
    setEditingLineId(line.id);
    setEditForm({
      material_id: line.material_id,
      storage_location_id: line.storage_location_id,
      stock_type: line.stock_type,
      quantity: String(line.quantity ?? ""),
      entered_uom_code: line.entered_uom_code ?? "",
      entered_quantity: line.entered_quantity != null ? String(line.entered_quantity) : "",
      rate_uom_code: material?.base_uom_code || "",
      rate_per_unit: String(baseRateToDisplay(
        line.rate_per_unit ?? "",
        material,
        editConversionsQuery.data,
        material?.base_uom_code,
      )),
      packing_order_id: String(line.packing_order_id ?? ""),
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
        packing_order_id: editForm.packing_order_id || null,
        batch_number:
          selectedEditMaterial?.material_type === "SFG" || selectedEditMaterial?.material_type === "FG"
            ? editForm.batch_number.trim().toUpperCase() || null
            : null,
        quantity: Number(editForm.quantity),
        entered_uom_code: editForm.entered_uom_code || null,
        entered_quantity: editForm.entered_quantity === "" ? null : Number(editForm.entered_quantity),
        rate_per_unit: resolveOpeningRatePerUnit(
          editForm.rate_per_unit || 0,
          selectedEditMaterial,
          editConversionsQuery.data,
          editForm.rate_uom_code || selectedEditMaterial?.base_uom_code,
          selectedEditFgOrder?.fill_qty_per_pack,
        ),
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

  // Â§8B: each line's correction touches a different (material, location, stock_type)
  // snapshot row â€” independent of every other line â€” so this batch runs in parallel,
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
    try {
      // Single batch call â€” the backend cascades RM/PM -> SFG -> FG in one
      // action (Â§109). Sending each line separately would let two lines that
      // feed the same downstream batch race and silently overwrite each
      // other's correction, so this is never split into per-line calls.
      const { results } = await recalculateValuation({
        reason: recalcReason.trim(),
        lines: targets.map((line) => ({
          line_id: line.id,
          new_rate: Number(recalcRates[line.id]),
          posted_stock_document_id: line.posted_stock_document_id,
        })),
      });
      setRecalcResults(results);
      setRecalcRates({});
      const succeeded = results.filter((r) => r.ok).length;
      setNotice(`Recalculated ${succeeded} of ${results.length} step(s) across the RM/PM -> SFG -> FG chain. See results below for details.`);
      await detailQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "VALUATION_RECALC_FAILED");
    } finally {
      setSaving(false);
    }
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
                    {
                      key: "quantity",
                      label: "Qty (Base UOM)",
                      width: "120px",
                      render: (row) => `${row.quantity} ${materialMap.get(row.material_id)?.base_uom_code ?? ""}`,
                    },
                    {
                      key: "entered_uom_code",
                      label: "Entered As",
                      width: "130px",
                      render: (row) =>
                        row.entered_uom_code && row.entered_uom_code !== materialMap.get(row.material_id)?.base_uom_code
                          ? `${row.entered_quantity} ${row.entered_uom_code}`
                          : "â€”",
                    },
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
                          label: "Corrected Rate (Â§109)",
                          width: "160px",
                          render: (row) => {
                            if (row.already_recalculated) {
                              return (
                                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                  Recalculated
                                </span>
                              );
                            }
                            const suggested = recalcDerivedRateByLineId.get(row.id);
                            const derivable = suggested?.derivable ? suggested : null;
                            return (
                              <div className="flex flex-col gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder="New rate"
                                  value={recalcRates[row.id] ?? ""}
                                  onChange={(event) => updateRecalcRate(row.id, event.target.value)}
                                  className="h-8 w-full border border-amber-300 bg-amber-50 px-2 text-sm text-amber-950 outline-none focus:border-amber-500"
                                />
                                {derivable && (
                                  <button
                                    type="button"
                                    onClick={() => updateRecalcRate(row.id, String(Number(derivable.rate).toFixed(4)))}
                                    title={`From Stroke ${derivable.stroke_number ?? "--"} dosage: ${Number(derivable.rate).toFixed(4)}/unit. Only a suggestion â€” purchased SFG/INT keeps its own purchase rate.`}
                                    className="truncate text-left text-xs text-sky-700 underline decoration-dotted hover:text-sky-900"
                                  >
                                    Suggest {Number(derivable.rate).toFixed(4)} (from dosage)
                                  </button>
                                )}
                              </div>
                            );
                          },
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
                          "â€”"
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
                      Recalculate Valuation (Â§109 â€” one click, fully automatic, one-time-use per line)
                    </div>
                    <div className="text-xs text-amber-800">
                      Fill in "Corrected Rate" on whichever lines above need it, give one shared reason, then Recalculate All.
                      The system corrects these materials and then <strong>automatically cascades</strong> into every SFG batch
                      and FG batch that consumed them â€” no separate manual step. The results below list every step the
                      cascade actually touched. Already-recalculated lines are locked â€” no "reopen" action exists yet.
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
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                          Every step the cascade actually touched (RM/PM you entered, then any SFG/FG it flowed into):
                        </div>
                        {recalcResults.map((result) => {
                          const material = materialMap.get(result.materialId);
                          const materialLabel = material ? (material.material_name ?? result.materialId) : (result.materialId || result.ledgerId);
                          return (
                            <div key={result.ledgerId}>
                              {result.ok ? (
                                <>
                                  <strong>{materialLabel}</strong>: {result.oldRate} {"->"} {result.newRate}
                                </>
                              ) : (
                                <span className="text-rose-700">
                                  <strong>{materialLabel}</strong>: failed â€” {result.error}
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
                      {isSfgGenealogy ? (
                        <ErpDenseFormRow label="Batch Number">
                          <div className="grid gap-1">
                            <ErpComboboxField
                              value={editForm.batch_number}
                              onChange={(value) => {
                                const selectedBatch = (editOpeningSfgQuery.data ?? []).find((row) => String(row.batch_number ?? "") === String(value)) ?? null;
                                const remaining = selectedBatch ? resolveSfgRemaining(selectedBatch, lines, editingLineId) : 0;
                                setEditForm((current) => ({
                                  ...current,
                                  batch_number: String(value ?? "").toUpperCase(),
                                  quantity: selectedBatch ? String(remaining) : current.quantity,
                                  entered_uom_code: selectedEditMaterial?.base_uom_code || current.entered_uom_code,
                                  entered_quantity: selectedBatch ? String(remaining) : current.entered_quantity,
                                }));
                              }}
                              options={(editOpeningSfgQuery.data ?? []).map((row) => ({ value: row.batch_number, label: batchOptionLabel(row) }))}
                              blankLabel="Select PR22 batch"
                            />
                            <div className="text-xs text-slate-500">
                              Stroke {selectedEditSfgBatch?.stroke_number ?? "--"} · Remaining {resolveSfgRemaining(selectedEditSfgBatch ?? {}, lines, editingLineId).toFixed(3)} KG
                            </div>
                          </div>
                        </ErpDenseFormRow>
                      ) : isFgGenealogy ? (
                        <ErpDenseFormRow label="Packing PO (PR23)">
                          <div className="grid gap-1">
                            <ErpComboboxField
                              value={editForm.packing_order_id}
                              onChange={(value) => {
                                const selectedOrder = (editOpeningFgQuery.data ?? []).find((row) => String(row.id ?? "") === String(value)) ?? null;
                                const remaining = selectedOrder ? resolveFgRemaining(selectedOrder, lines, editingLineId) : 0;
                                setEditForm((current) => ({
                                  ...current,
                                  packing_order_id: String(value ?? ""),
                                  batch_number: selectedOrder?.batch_number ?? "",
                                  quantity: selectedOrder ? String(remaining) : current.quantity,
                                  entered_uom_code: selectedEditMaterial?.base_uom_code || current.entered_uom_code,
                                  entered_quantity: selectedOrder ? String(remaining) : current.entered_quantity,
                                }));
                              }}
                              options={(editOpeningFgQuery.data ?? []).map((row) => ({ value: row.id, label: packingOptionLabel(row) }))}
                              blankLabel="Select PR23 packing PO"
                            />
                            <div className="text-xs text-slate-500">
                              Batch {selectedEditFgOrder?.batch_number ?? "--"} · {selectedEditFgOrder?.num_packs ?? "--"} packs · {selectedEditFgOrder?.fill_qty_per_pack ?? "--"} KG/pack · Remaining {resolveFgRemaining(selectedEditFgOrder ?? {}, lines, editingLineId).toFixed(3)} KG
                            </div>
                          </div>
                        </ErpDenseFormRow>
                      ) : null}
                      <ErpDenseFormRow label="Quantity">
                        <UomQuantityInput
                          key={`${editForm.material_id}-${editForm.batch_number}-${editForm.packing_order_id}-${editingLineId}`}
                          baseUomCode={selectedEditMaterial?.base_uom_code}
                          conversions={editConversionsQuery.data}
                          defaultUomCode={editForm.entered_uom_code || selectedEditMaterial?.purchase_uom_code}
                          value={editForm.quantity}
                          onChange={(baseQty, meta) => setEditForm((current) => ({
                            ...current,
                            quantity: baseQty != null ? String(baseQty) : "",
                            entered_uom_code: meta.enteredUomCode,
                            entered_quantity: Number.isFinite(meta.enteredQty) ? String(meta.enteredQty) : "",
                          }))}
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label={isFgGenealogy && Number(selectedEditFgOrder?.fill_qty_per_pack) > 0 ? "Rate Per Pack" : "Rate Per Unit"}>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editForm.rate_per_unit}
                            onChange={(event) => setEditForm((current) => ({ ...current, rate_per_unit: event.target.value }))}
                            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                          {showRateUomSelector ? (
                            <select
                              value={editForm.rate_uom_code || selectedEditMaterial?.base_uom_code || ""}
                              onChange={(event) => setEditForm((current) => ({ ...current, rate_uom_code: event.target.value }))}
                              className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                            >
                              {editRateUomOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </ErpDenseFormRow>
                      {!isSfgGenealogy && !isFgGenealogy && (selectedEditMaterial?.material_type === "SFG" || selectedEditMaterial?.material_type === "FG") ? (
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
                          {isSfgGenealogy ? (
                            <ErpDenseFormRow label="Batch Number">
                              <div className="grid gap-1">
                                <ErpComboboxField
                                  value={singleForm.batch_number}
                                  onChange={(value) => {
                                    const selectedBatch = (singleOpeningSfgQuery.data ?? []).find((row) => String(row.batch_number ?? "") === String(value)) ?? null;
                                    const remaining = selectedBatch ? resolveSfgRemaining(selectedBatch, lines) : 0;
                                    setSingleForm((current) => ({
                                      ...current,
                                      batch_number: String(value ?? "").toUpperCase(),
                                      quantity: selectedBatch ? String(remaining) : current.quantity,
                                      entered_uom_code: selectedSingleMaterial?.base_uom_code || current.entered_uom_code,
                                      entered_quantity: selectedBatch ? String(remaining) : current.entered_quantity,
                                    }));
                                  }}
                                  options={(singleOpeningSfgQuery.data ?? []).map((row) => ({ value: row.batch_number, label: batchOptionLabel(row) }))}
                                  blankLabel="Select PR22 batch"
                                />
                                <div className="text-xs text-slate-500">
                                  Stroke {selectedSingleSfgBatch?.stroke_number ?? "--"} · Remaining {resolveSfgRemaining(selectedSingleSfgBatch ?? {}, lines).toFixed(3)} KG
                                </div>
                              </div>
                            </ErpDenseFormRow>
                          ) : isFgGenealogy ? (
                            <ErpDenseFormRow label="Packing PO (PR23)">
                              <div className="grid gap-1">
                                <ErpComboboxField
                                  value={singleForm.packing_order_id}
                                  onChange={(value) => {
                                    const selectedOrder = (singleOpeningFgQuery.data ?? []).find((row) => String(row.id ?? "") === String(value)) ?? null;
                                    const remaining = selectedOrder ? resolveFgRemaining(selectedOrder, lines) : 0;
                                    setSingleForm((current) => ({
                                      ...current,
                                      packing_order_id: String(value ?? ""),
                                      batch_number: selectedOrder?.batch_number ?? "",
                                      quantity: selectedOrder ? String(remaining) : current.quantity,
                                      entered_uom_code: selectedSingleMaterial?.base_uom_code || current.entered_uom_code,
                                      entered_quantity: selectedOrder ? String(remaining) : current.entered_quantity,
                                    }));
                                  }}
                                  options={(singleOpeningFgQuery.data ?? []).map((row) => ({ value: row.id, label: packingOptionLabel(row) }))}
                                  blankLabel="Select PR23 packing PO"
                                />
                                <div className="text-xs text-slate-500">
                                  Batch {selectedSingleFgOrder?.batch_number ?? "--"} · {selectedSingleFgOrder?.num_packs ?? "--"} packs · {selectedSingleFgOrder?.fill_qty_per_pack ?? "--"} KG/pack · Remaining {resolveFgRemaining(selectedSingleFgOrder ?? {}, lines).toFixed(3)} KG
                                </div>
                              </div>
                            </ErpDenseFormRow>
                          ) : (selectedSingleMaterial?.material_type === "SFG" || selectedSingleMaterial?.material_type === "FG") ? (
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
                              <UomQuantityInput
                                key={`${singleForm.material_id}-${singleForm.batch_number}-${singleForm.packing_order_id}`}
                                baseUomCode={selectedSingleMaterial?.base_uom_code}
                                conversions={singleConversionsQuery.data}
                                defaultUomCode={selectedSingleMaterial?.purchase_uom_code}
                                value={singleForm.quantity}
                                onChange={(baseQty, meta) => setSingleForm((current) => ({
                                  ...current,
                                  quantity: baseQty != null ? String(baseQty) : "",
                                  entered_uom_code: meta.enteredUomCode,
                                  entered_quantity: Number.isFinite(meta.enteredQty) ? String(meta.enteredQty) : "",
                                }))}
                              />
                            </ErpDenseFormRow>
                            <ErpDenseFormRow label={isFgGenealogy && Number(selectedSingleFgOrder?.fill_qty_per_pack) > 0 ? "Rate Per Pack" : "Rate Per Unit"} required>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={singleForm.rate_per_unit}
                                  onChange={(event) => setSingleForm((current) => ({ ...current, rate_per_unit: event.target.value }))}
                                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                />
                                {showRateUomSelector ? (
                                  <select
                                    value={singleForm.rate_uom_code || selectedSingleMaterial?.base_uom_code || ""}
                                    onChange={(event) => setSingleForm((current) => ({ ...current, rate_uom_code: event.target.value }))}
                                    className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                  >
                                    {singleRateUomOptions.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                ) : null}
                              </div>
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
                                    One or more inputs have no valued stock yet â€” load their opening stock first,
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
                                    const openingRows = bulkOpeningQueries[index]?.data ?? [];
                                    const selectedSfgBatch = isSfgGenealogy
                                      ? openingRows.find((entry) => String(entry.batch_number ?? "") === String(row.batch_number ?? "")) ?? null
                                      : null;
                                    const selectedFgOrder = isFgGenealogy
                                      ? openingRows.find((entry) => String(entry.id ?? "") === String(row.packing_order_id ?? "")) ?? null
                                      : null;
                                    const bulkRateUomOptions = buildRateUomOptions(material, bulkConversionQueries[index]?.data, showRateUomSelector);
                                    return (
                                      <tr key={row.key} className="align-top even:bg-slate-50/40">
                                        <td className="border-b border-slate-100 px-3 py-2">{index + 1}</td>
                                        <td className="border-b border-slate-100 px-3 py-2">{material?.material_type ?? "â€”"}</td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[260px]">
                                          <ErpComboboxField
                                            value={row.material_id}
                                            onChange={(value) => updateBulkRow(row.key, { material_id: value })}
                                            options={materialOptions}
                                            blankLabel="Select material"
                                          />
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">{material?.pace_code ?? "â€”"}</td>
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
                                        <td className="border-b border-slate-100 px-3 py-2">{material?.base_uom_code ?? "â€”"}</td>
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[240px]">
                                          {isSfgGenealogy ? (
                                            <div className="grid gap-1">
                                              <ErpComboboxField
                                                value={row.batch_number}
                                                onChange={(value) => {
                                                  const selectedBatch = openingRows.find((entry) => String(entry.batch_number ?? "") === String(value)) ?? null;
                                                  const remaining = selectedBatch ? resolveBulkSfgRemaining(selectedBatch, lines, bulkRows, row.key) : 0;
                                                  updateBulkRow(row.key, {
                                                    batch_number: String(value ?? "").toUpperCase(),
                                                    quantity: selectedBatch ? String(remaining) : row.quantity,
                                                    entered_uom_code: material?.base_uom_code || row.entered_uom_code,
                                                    entered_quantity: selectedBatch ? String(remaining) : row.entered_quantity,
                                                  });
                                                }}
                                                options={openingRows.map((entry) => ({ value: entry.batch_number, label: batchOptionLabel(entry) }))}
                                                blankLabel="Select PR22 batch"
                                              />
                                              <div className="text-[11px] text-slate-500">
                                                Stroke {selectedSfgBatch?.stroke_number ?? "--"} · Remaining {resolveBulkSfgRemaining(selectedSfgBatch ?? {}, lines, bulkRows, row.key).toFixed(3)} KG
                                              </div>
                                            </div>
                                          ) : isFgGenealogy ? (
                                            <div className="grid gap-1">
                                              <ErpComboboxField
                                                value={row.packing_order_id}
                                                onChange={(value) => {
                                                  const selectedOrder = openingRows.find((entry) => String(entry.id ?? "") === String(value)) ?? null;
                                                  const remaining = selectedOrder ? resolveBulkFgRemaining(selectedOrder, lines, bulkRows, row.key) : 0;
                                                  updateBulkRow(row.key, {
                                                    packing_order_id: String(value ?? ""),
                                                    batch_number: selectedOrder?.batch_number ?? "",
                                                    quantity: selectedOrder ? String(remaining) : row.quantity,
                                                    entered_uom_code: material?.base_uom_code || row.entered_uom_code,
                                                    entered_quantity: selectedOrder ? String(remaining) : row.entered_quantity,
                                                  });
                                                }}
                                                options={openingRows.map((entry) => ({ value: entry.id, label: packingOptionLabel(entry) }))}
                                                blankLabel="Select PR23 packing PO"
                                              />
                                              <div className="text-[11px] text-slate-500">
                                                Batch {selectedFgOrder?.batch_number ?? "--"} · {selectedFgOrder?.num_packs ?? "--"} packs · {selectedFgOrder?.fill_qty_per_pack ?? "--"} KG/pack · Remaining {resolveBulkFgRemaining(selectedFgOrder ?? {}, lines, bulkRows, row.key).toFixed(3)} KG
                                              </div>
                                            </div>
                                          ) : material?.material_type === "SFG" || material?.material_type === "FG" ? (
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
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[220px]">
                                          <UomQuantityInput
                                            key={`${row.key}-${row.material_id}-${row.batch_number}-${row.packing_order_id}`}
                                            baseUomCode={material?.base_uom_code}
                                            conversions={bulkConversionQueries[index]?.data}
                                            defaultUomCode={material?.purchase_uom_code}
                                            value={row.quantity}
                                            disabled={row.is_zero_stock}
                                            onChange={(baseQty, meta) => updateBulkRow(row.key, {
                                              quantity: row.is_zero_stock ? "0" : (baseQty != null ? String(baseQty) : ""),
                                              entered_uom_code: meta.enteredUomCode,
                                              entered_quantity: Number.isFinite(meta.enteredQty) ? String(meta.enteredQty) : "",
                                            })}
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
                                        <td className="border-b border-slate-100 px-3 py-2 min-w-[220px]">
                                          <div className="grid gap-1">
                                            <input
                                              type="number"
                                              min="0"
                                              step="any"
                                              placeholder="Optional"
                                              value={row.rate_per_unit}
                                              onChange={(event) => updateBulkRow(row.key, { rate_per_unit: event.target.value })}
                                              aria-label={isFgGenealogy && Number(selectedFgOrder?.fill_qty_per_pack) > 0 ? "Rate Per Pack" : "Rate Per Unit"}
                                              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                            />
                                            {showRateUomSelector ? (
                                              <select
                                                value={row.rate_uom_code || material?.base_uom_code || ""}
                                                onChange={(event) => updateBulkRow(row.key, { rate_uom_code: event.target.value })}
                                                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                              >
                                                {bulkRateUomOptions.map((option) => (
                                                  <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                              </select>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td className="border-b border-slate-100 px-3 py-2">
                                          {formatCurrency(
                                            Number(row.quantity || 0) * resolveOpeningRatePerUnit(
                                              row.rate_per_unit || 0,
                                              material,
                                              bulkConversionQueries[index]?.data,
                                              row.rate_uom_code || material?.base_uom_code,
                                              selectedFgOrder?.fill_qty_per_pack,
                                            ),
                                            currencyCode,
                                          )}
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
        </div>
      )}
    </ErpScreenScaffold>
  );
}



