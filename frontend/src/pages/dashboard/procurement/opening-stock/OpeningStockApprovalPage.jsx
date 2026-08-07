import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  approveOpeningStockDocument,
  batchUpdateOpeningStockLines,
  getOpeningStockDocumentByNumber,
  listMaterialUomConversionsForProcurement,
  postOpeningStockDocument,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import {
  useMaterialOptionsQuery,
  useStorageLocationsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import {
  listOldPackingPoBatches,
  listOldProcessPoBatches,
} from "../../production/prodApi.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const PAGE_SIZE = 25;
const OPENING_GENEALOGY_PO_TYPES = new Set(["MTO", "HPS"]);
const RATE_UOM_PO_TYPES = new Set(["MTS", "MTEST"]);
const CURRENCY_LOCALE_MAP = Object.freeze({ INR: "en-IN", USD: "en-US" });
const BATCH_NUMBER_HELP_TEXT = "MTO/HPS SFG must select a PR22 batch. MTO/HPS FG must select a PR23 packing order; batch is derived automatically. MTS/MTEST can still type batch manually.";

function createNewEditableLine(lineNumber) {
  return {
    row_key: `new-${lineNumber}-${Date.now()}`,
    id: "",
    line_number: Number(lineNumber ?? 0),
    material_id: "",
    storage_location_id: "",
    stock_type: "UNRESTRICTED",
    quantity: "",
    rate_per_unit: "0",
    rate_uom_code: "",
    packing_order_id: "",
    is_zero_stock: false,
    entered_uom_code: "",
    entered_quantity: "",
    batch_number: "",
  };
}

function buildRateUomOptions(material, conversions, includeAlternatesOnly = false) {
  const baseUomCode = material?.base_uom_code || "";
  const options = [];
  if (baseUomCode && !includeAlternatesOnly) options.push({ value: baseUomCode, label: `${baseUomCode} (Base)`, factor: 1 });
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

function displayRateToBase(displayRate, material, conversions, uomCode) {
  const factor = findRateFactor(material, conversions, uomCode || material?.base_uom_code);
  return factor > 0 ? Number(displayRate ?? 0) / factor : Number(displayRate ?? 0);
}

function isFgPackingRateEntry(packingOrder) {
  return Boolean(packingOrder) && String(packingOrder?.pack_code ?? "") !== "000" && Number(packingOrder?.fill_qty_per_pack) > 0;
}

function fgRateEntryLabel(packingOrder) {
  return isFgPackingRateEntry(packingOrder) ? "Rate Per Pack" : "Rate Per KG";
}

function baseRateToOpeningDisplay(baseRate, material, conversions, uomCode, packingOrder = null) {
  const numericBaseRate = Number(baseRate ?? 0);
  if (isFgPackingRateEntry(packingOrder)) {
    return numericBaseRate * Number(packingOrder.fill_qty_per_pack);
  }
  const factor = findRateFactor(material, conversions, uomCode || material?.base_uom_code);
  return numericBaseRate * factor;
}

function resolveOpeningRatePerUnit(displayRate, material, conversions, rateUomCode, packingOrder = null) {
  const numericRate = Number(displayRate ?? 0);
  if (isFgPackingRateEntry(packingOrder)) return numericRate / Number(packingOrder.fill_qty_per_pack);
  return displayRateToBase(numericRate, material, conversions, rateUomCode || material?.base_uom_code);
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

function formatLocationLabel(location) {
  if (!location) return "Unresolved storage location";
  return `${location.code ?? location.location_code ?? location.name ?? location.location_name ?? "Storage Location"} (${location.location_type ?? "STORE"})`;
}

function batchOptionLabel(batch) {
  return `${batch.batch_number} · Stroke ${batch.stroke_number ?? "--"} · ${Number(batch.actual_qty ?? 0).toFixed(3)} KG`;
}

function packingOptionLabel(packingOrder) {
  return `${packingOrder.po_number} · Batch ${packingOrder.batch_number} · ${Number(packingOrder.actual_qty_kg ?? 0).toFixed(3)} KG`;
}

function mapLineForEditing(line) {
  return {
    row_key: String(line.id),
    id: String(line.id),
    line_number: Number(line.line_number ?? 0),
    material_id: String(line.material_id ?? ""),
    storage_location_id: String(line.storage_location_id ?? ""),
    stock_type: String(line.stock_type ?? "UNRESTRICTED"),
    quantity: String(line.quantity ?? ""),
    rate_per_unit: String(line.rate_per_unit ?? "0"),
    stored_base_rate_per_unit: Number(line.rate_per_unit ?? 0),
    rate_uom_code: "",
    packing_order_id: String(line.packing_order_id ?? ""),
    is_zero_stock: line.is_zero_stock === true || Number(line.quantity ?? 0) === 0,
    entered_uom_code: String(line.entered_uom_code ?? ""),
    entered_quantity: String(line.entered_quantity ?? line.quantity ?? ""),
    batch_number: String(line.batch_number ?? ""),
  };
}

function serializeEditableLine(line) {
  return JSON.stringify({
    row_key: line.row_key,
    material_id: line.material_id,
    storage_location_id: line.storage_location_id,
    stock_type: line.stock_type,
    quantity: String(line.quantity ?? ""),
    rate_per_unit: String(line.rate_per_unit ?? ""),
    rate_uom_code: String(line.rate_uom_code ?? ""),
    packing_order_id: String(line.packing_order_id ?? ""),
    is_zero_stock: Boolean(line.is_zero_stock),
    entered_uom_code: line.entered_uom_code || "",
    entered_quantity: String(line.entered_quantity ?? ""),
    batch_number: String(line.batch_number ?? ""),
  });
}

export default function OpeningStockApprovalPage() {
  const [documentNumberInput, setDocumentNumberInput] = useState("");
  const [searchedDocumentNumber, setSearchedDocumentNumber] = useState("");
  const [editableLines, setEditableLines] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState(new Map());
  const [fgRatesHydrated, setFgRatesHydrated] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const documentQuery = useQuery({
    queryKey: ["procurement", "opening-stock-approval", searchedDocumentNumber],
    queryFn: () => getOpeningStockDocumentByNumber(searchedDocumentNumber),
    enabled: Boolean(searchedDocumentNumber),
  });

  const detail = documentQuery.data ?? null;
  const companyId = detail?.company_id || "";
  const currencyCode = detail?.currency_code || "INR";
  const documentMaterialType = String(detail?.material_type || "").toUpperCase();
  const documentPoType = String(detail?.po_type || "").toUpperCase();
  const isOpeningGenealogyDocument = (documentMaterialType === "SFG" || documentMaterialType === "FG") && OPENING_GENEALOGY_PO_TYPES.has(documentPoType);
  const isSfgGenealogy = isOpeningGenealogyDocument && documentMaterialType === "SFG";
  const isFgGenealogy = isOpeningGenealogyDocument && documentMaterialType === "FG";
  const showRateUomSelector = RATE_UOM_PO_TYPES.has(documentPoType);

  const materialQuery = useMaterialOptionsQuery({ limit: 500, status: "ACTIVE" });
  const locationQuery = useStorageLocationsQuery({ company_id: companyId || undefined }, { enabled: Boolean(companyId) });
  const companiesQuery = useCompaniesQuery();

  const materials = useMemo(() => materialQuery.materials.filter((material) => !documentMaterialType || String(material.material_type || "").toUpperCase() === documentMaterialType), [documentMaterialType, materialQuery.materials]);
  const locations = useMemo(() => Array.isArray(locationQuery.data?.data) ? locationQuery.data.data : Array.isArray(locationQuery.data) ? locationQuery.data : [], [locationQuery.data]);
  const companies = useMemo(() => (Array.isArray(companiesQuery.data) ? companiesQuery.data : []), [companiesQuery.data]);

  useEffect(() => {
    if (!detail) return;
    const nextLines = Array.isArray(detail.lines) ? detail.lines.map(mapLineForEditing) : [];
    setEditableLines(nextLines);
    setSavedSnapshot(new Map(nextLines.map((line) => [line.row_key, serializeEditableLine(line)])));
    setFgRatesHydrated(false);
    setCurrentPage(0);
  }, [detail]);

  const materialMap = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const materialOptions = useMemo(() => materials.map((material) => ({ value: material.id, label: `${material.material_name ?? "Material"} (${material.pace_code ?? material.material_code ?? material.id})` })), [materials]);
  const locationOptions = useMemo(() => locations.map((location) => ({ value: location.id, label: formatLocationLabel(location) })), [locations]);
  const companyMap = useMemo(() => new Map(companies.map((company) => [company.id, `${company.company_code ?? "COMP"} | ${company.company_name ?? "Company"}`])), [companies]);

  const conversionQueries = useQueries({
    queries: editableLines.map((line) => ({
      queryKey: ["material-uom-conversions", line.material_id, line.row_key, "approval"],
      queryFn: () => listMaterialUomConversionsForProcurement(line.material_id),
      enabled: Boolean(line.material_id),
      select: (response) => response?.data ?? [],
    })),
  });
  const openingQueries = useQueries({
    queries: editableLines.map((line) => ({
      queryKey: [documentMaterialType === "FG" ? "old-packing-po-batches" : "old-process-po-batches", companyId, line.material_id, line.row_key, "approval"],
      queryFn: () => documentMaterialType === "FG"
        ? listOldPackingPoBatches({ company_id: companyId, material_id: line.material_id })
        : listOldProcessPoBatches({ company_id: companyId, material_id: line.material_id }),
      enabled: Boolean(isOpeningGenealogyDocument && companyId && line.material_id),
      select: (response) => response?.data ?? response ?? [],
    })),
  });

  useEffect(() => {
    if (!isFgGenealogy || fgRatesHydrated || editableLines.length === 0 || openingQueries.length !== editableLines.length) return;
    const hydratedLines = editableLines.map((line, index) => {
      const selectedFgOrder = (openingQueries[index]?.data ?? []).find((entry) => String(entry.id ?? "") === String(line.packing_order_id ?? "")) ?? null;
      if (!selectedFgOrder) return line;
      const material = materialMap.get(line.material_id);
      const conversions = conversionQueries[index]?.data ?? [];
      return {
        ...line,
        rate_per_unit: String(baseRateToOpeningDisplay(
          line.stored_base_rate_per_unit ?? line.rate_per_unit ?? 0,
          material,
          conversions,
          line.rate_uom_code || material?.base_uom_code,
          selectedFgOrder,
        )),
      };
    });
    setEditableLines(hydratedLines);
    setSavedSnapshot(new Map(hydratedLines.map((line) => [line.row_key, serializeEditableLine(line)])));
    setFgRatesHydrated(true);
  }, [
    conversionQueries,
    editableLines,
    fgRatesHydrated,
    isFgGenealogy,
    materialMap,
    openingQueries,
  ]);

  const editedLineIds = useMemo(() => editableLines.filter((line) => serializeEditableLine(line) !== savedSnapshot.get(line.row_key)).map((line) => line.row_key), [editableLines, savedSnapshot]);
  const editedLineSet = useMemo(() => new Set(editedLineIds), [editedLineIds]);
  const totalPages = Math.max(1, Math.ceil(editableLines.length / PAGE_SIZE));
  const pagedLines = useMemo(() => editableLines.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [editableLines, currentPage]);
  const companyLabel = companyMap.get(companyId) ?? companyId;
  const loading = documentQuery.isLoading || materialQuery.isLoading || locationQuery.isLoading || companiesQuery.isLoading;
  const queryError = documentQuery.error?.message || materialQuery.error?.message || locationQuery.error?.message || companiesQuery.error?.message || "";
  const canApprove = detail?.status === "SUBMITTED" && !saving && !approving && editedLineIds.length === 0 && Boolean(detail?.id);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading || !searchedDocumentNumber,
      perform: () => void Promise.all([documentQuery.refetch(), materialQuery.refetch(), locationQuery.refetch(), companiesQuery.refetch()]),
    },
  });

  function updateLine(lineId, patch) {
    setEditableLines((current) => current.map((line) => {
      if (line.row_key !== lineId) return line;
      const nextLine = { ...line, ...patch };
      if (patch.is_zero_stock === true) {
        nextLine.quantity = "0";
        nextLine.entered_quantity = "0";
      }
      if (patch.quantity !== undefined && patch.is_zero_stock !== true) nextLine.entered_quantity = String(patch.quantity);
      const selectedMaterial = materialMap.get(nextLine.material_id);
      nextLine.entered_uom_code = selectedMaterial?.base_uom_code || nextLine.entered_uom_code || "";
      if (selectedMaterial?.material_type !== "SFG" && selectedMaterial?.material_type !== "FG") {
        nextLine.batch_number = "";
        nextLine.packing_order_id = "";
      }
      return nextLine;
    }));
  }

  function handleAddRow() {
    setEditableLines((current) => {
      const next = [...current, createNewEditableLine(current.length + 1)];
      setCurrentPage(Math.floor((next.length - 1) / PAGE_SIZE));
      return next;
    });
    setError("");
    setNotice("");
  }

  function handleSearch() {
    const normalized = documentNumberInput.trim();
    if (!normalized) {
      setError("Document Number is required.");
      return;
    }
    setError("");
    setNotice("");
    setSearchedDocumentNumber(normalized);
  }

  async function handleSaveCorrections() {
    if (!detail?.id) return;
    if (editedLineIds.length === 0) {
      setNotice("No unsaved corrections found.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const lines = editableLines.filter((line) => editedLineSet.has(line.row_key)).map((line) => {
        const globalIndex = editableLines.findIndex((entry) => entry.row_key === line.row_key);
        const material = materialMap.get(line.material_id);
        const conversionRows = conversionQueries[globalIndex]?.data ?? [];
        const openingRows = openingQueries[globalIndex]?.data ?? [];
        const selectedFgOrder = documentMaterialType === "FG"
          ? openingRows.find((entry) => String(entry.id ?? "") === String(line.packing_order_id ?? "")) ?? null
          : null;
        return {
          id: line.id || null,
          material_id: line.material_id,
          storage_location_id: line.storage_location_id,
          stock_type: line.stock_type,
          batch_number: line.batch_number || null,
          packing_order_id: line.packing_order_id || null,
          quantity: line.is_zero_stock ? 0 : Number(line.quantity),
          rate_per_unit: resolveOpeningRatePerUnit(line.rate_per_unit || 0, material, conversionRows, line.rate_uom_code || material?.base_uom_code, selectedFgOrder),
          is_zero_stock: Boolean(line.is_zero_stock),
          entered_uom_code: line.entered_uom_code || null,
          entered_quantity: line.is_zero_stock ? 0 : Number(line.entered_quantity || line.quantity || 0),
        };
      });
      await batchUpdateOpeningStockLines(detail.id, { lines });
      await documentQuery.refetch();
      setNotice("Corrections saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_BATCH_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!detail?.id || !canApprove) return;
    setApproving(true);
    setError("");
    setNotice("");
    try {
      await approveOpeningStockDocument(detail.id);
      await postOpeningStockDocument(detail.id);
      await documentQuery.refetch();
      setNotice("Opening stock document approved and posted.");
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "OPENING_STOCK_DOCUMENT_APPROVE_FAILED");
    } finally {
      setApproving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title="Opening Stock Approval"
      notices={[
        ...((error || queryError) ? [{ key: "opening-stock-approval-error", tone: "error", message: error || queryError }] : []),
        ...(notice ? [{ key: "opening-stock-approval-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back To List", tone: "neutral", onClick: () => openScreen("PROC_OPENING_STOCK_LIST") },
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void Promise.all([documentQuery.refetch(), materialQuery.refetch(), locationQuery.refetch(), companiesQuery.refetch()]), disabled: !searchedDocumentNumber },
        { key: "save", label: saving ? "Saving..." : "Save Corrections", tone: "primary", onClick: () => void handleSaveCorrections(), disabled: !detail?.id || editedLineIds.length === 0 || saving || approving },
        { key: "approve", label: approving ? "Approving..." : "Approve", tone: "primary", onClick: () => void handleApprove(), disabled: !canApprove },
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 1" title="Document Number">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-1">
              <label className="text-xs font-semibold text-slate-700">Document Number</label>
              <input value={documentNumberInput} onChange={(event) => setDocumentNumberInput(event.target.value.toUpperCase())} placeholder="Enter opening stock document number" className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={handleSearch} className="h-8 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950">Search</button>
            </div>
          </div>
        </ErpSectionCard>

        {detail ? (
          <>
            <div className="grid gap-4 xl:grid-cols-4">
              <ErpFieldPreview label="Document #" value={detail.document_number} badge={detail.status} tone={detail.status === "POSTED" ? "emerald" : detail.status === "SUBMITTED" ? "amber" : "sky"} />
              <ErpFieldPreview label="Company" value={companyLabel} />
              <ErpFieldPreview label="Cut-off Date" value={formatDate(detail.cut_off_date)} />
              <ErpFieldPreview label="Currency" value={currencyCode} />
            </div>

            <ErpSectionCard eyebrow="Page 2" title="Correct And Approve Lines" aside={<div className="text-sm font-semibold text-slate-600">Edited Rows: {editedLineIds.length} | Page {currentPage + 1} of {totalPages}</div>}>
              <div className="grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Line #</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Material</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Storage Location</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Stock Type</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Genealogy</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Quantity</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Zero Stock</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Rate</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Total Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedLines.map((line) => {
                          const globalIndex = editableLines.findIndex((entry) => entry.row_key === line.row_key);
                          const material = materialMap.get(line.material_id);
                          const conversions = conversionQueries[globalIndex]?.data ?? [];
                          const openingRows = openingQueries[globalIndex]?.data ?? [];
                          const selectedSfgBatch = isSfgGenealogy ? openingRows.find((entry) => String(entry.batch_number ?? "") === String(line.batch_number ?? "")) ?? null : null;
                          const selectedFgOrder = isFgGenealogy ? openingRows.find((entry) => String(entry.id ?? "") === String(line.packing_order_id ?? "")) ?? null : null;
                          const rateOptions = buildRateUomOptions(material, conversions, showRateUomSelector);
                          const dirty = editedLineSet.has(line.row_key);
                          return (
                            <tr key={line.row_key} className={`align-top even:bg-slate-50/40 ${dirty ? "bg-amber-50/50" : ""}`}>
                              <td className="border-b border-slate-100 px-3 py-2">{line.line_number}</td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[260px]"><ErpComboboxField value={line.material_id} onChange={(value) => updateLine(line.row_key, { material_id: value })} options={materialOptions} blankLabel="Select material" /></td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[220px]"><select value={line.storage_location_id} onChange={(event) => updateLine(line.row_key, { storage_location_id: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"><option value="">Select location</option>{locationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[160px]"><select value={line.stock_type} onChange={(event) => updateLine(line.row_key, { stock_type: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">{STOCK_TYPES.map((stockType) => <option key={stockType} value={stockType}>{stockType}</option>)}</select></td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[260px]">
                                {isSfgGenealogy ? (
                                  <div className="grid gap-1">
                                    <ErpComboboxField value={line.batch_number} onChange={(value) => updateLine(line.row_key, { batch_number: String(value ?? "").toUpperCase() })} options={openingRows.map((entry) => ({ value: entry.batch_number, label: batchOptionLabel(entry) }))} blankLabel="Select PR22 batch" />
                                    <div className="text-[11px] text-slate-500">Stroke {selectedSfgBatch?.stroke_number ?? "--"}</div>
                                  </div>
                                ) : isFgGenealogy ? (
                                  <div className="grid gap-1">
                                    <ErpComboboxField value={line.packing_order_id} onChange={(value) => {
                                      const selectedOrder = openingRows.find((entry) => String(entry.id ?? "") === String(value)) ?? null;
                                      updateLine(line.row_key, {
                                        packing_order_id: String(value ?? ""),
                                        batch_number: selectedOrder?.batch_number ?? "",
                                        rate_per_unit: selectedOrder ? String(Number(selectedOrder.derived_rate_entry_value ?? 0).toFixed(4)) : line.rate_per_unit,
                                      });
                                    }} options={openingRows.map((entry) => ({ value: entry.id, label: packingOptionLabel(entry) }))} blankLabel="Select PR23 packing PO" />
                                    <div className="text-[11px] text-slate-500">Batch {selectedFgOrder?.batch_number ?? "--"} · {selectedFgOrder?.num_packs ?? "--"} packs · {selectedFgOrder?.fill_qty_per_pack ?? "--"} KG/pack</div>
                                    {selectedFgOrder ? <div className="text-[11px] text-sky-700">Derived current {fgRateEntryLabel(selectedFgOrder)}: {Number(selectedFgOrder.derived_rate_entry_value ?? 0).toFixed(4)}{selectedFgOrder.derived_rate_incomplete ? " (incomplete)" : ""}</div> : null}
                                  </div>
                                ) : material?.material_type === "SFG" || material?.material_type === "FG" ? (
                                  <input type="text" value={line.batch_number} onChange={(event) => updateLine(line.row_key, { batch_number: event.target.value.toUpperCase() })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                                ) : <span className="text-slate-400">—</span>}
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[220px]"><UomQuantityInput key={`${line.row_key}-${line.material_id}-${line.batch_number}-${line.packing_order_id}`} baseUomCode={material?.base_uom_code} conversions={conversions} defaultUomCode={line.entered_uom_code || material?.purchase_uom_code} value={line.quantity} disabled={line.is_zero_stock} onChange={(baseQty, meta) => updateLine(line.row_key, { quantity: line.is_zero_stock ? "0" : (baseQty != null ? String(baseQty) : ""), entered_uom_code: meta.enteredUomCode, entered_quantity: Number.isFinite(meta.enteredQty) ? String(meta.enteredQty) : "" })} /></td>
                              <td className="border-b border-slate-100 px-3 py-2"><input type="checkbox" checked={Boolean(line.is_zero_stock)} onChange={(event) => updateLine(line.row_key, { is_zero_stock: event.target.checked })} className="h-4 w-4" /></td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[220px]"><div className="grid gap-1"><input type="number" min="0" step="any" aria-label={isFgGenealogy ? fgRateEntryLabel(selectedFgOrder) : "Rate Per Unit"} value={line.rate_per_unit} onChange={(event) => updateLine(line.row_key, { rate_per_unit: event.target.value })} className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />{showRateUomSelector ? <select value={line.rate_uom_code || material?.base_uom_code || ""} onChange={(event) => updateLine(line.row_key, { rate_uom_code: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">{rateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : null}</div></td>
                              <td className="border-b border-slate-100 px-3 py-2">{formatCurrency(Number(line.quantity || 0) * resolveOpeningRatePerUnit(line.rate_per_unit || 0, material, conversions, line.rate_uom_code || material?.base_uom_code, selectedFgOrder), currencyCode)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{BATCH_NUMBER_HELP_TEXT}</div>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-500">Unsaved edits persist across page changes until Save Corrections.</div>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleAddRow} className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700">Add Row</button>
                    <button type="button" onClick={() => setCurrentPage((page) => Math.max(0, page - 1))} disabled={currentPage === 0} className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 disabled:opacity-40">Prev</button>
                    <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))} disabled={currentPage >= totalPages - 1} className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 disabled:opacity-40">Next</button>
                  </div>
                </div>
              </div>
            </ErpSectionCard>
          </>
        ) : null}
      </div>
    </ErpScreenScaffold>
  );
}

