/*
 * File-ID: 19.3.5
 * File-Path: frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx
 * Gate: 19.2
 * Domain: PROCUREMENT
 * Purpose: IN06 opening stock approval and correction page.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  approveOpeningStockDocument,
  batchUpdateOpeningStockLines,
  getOpeningStockDocumentByNumber,
  postOpeningStockDocument,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import {
  useMaterialOptionsQuery,
  useStorageLocationsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const PAGE_SIZE = 25;
const CURRENCY_LOCALE_MAP = Object.freeze({
  INR: "en-IN",
  USD: "en-US",
});
const BATCH_NUMBER_HELP_TEXT = "Required for MTO/HPS Prodshades - leave blank if this is an MTS (IWC/Powder) item; MTS batch integration is not yet supported here.";

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

function mapLineForEditing(line) {
  return {
    id: String(line.id),
    line_number: Number(line.line_number ?? 0),
    material_id: String(line.material_id ?? ""),
    storage_location_id: String(line.storage_location_id ?? ""),
    stock_type: String(line.stock_type ?? "UNRESTRICTED"),
    quantity: String(line.quantity ?? ""),
    rate_per_unit: String(line.rate_per_unit ?? "0"),
    is_zero_stock: line.is_zero_stock === true || Number(line.quantity ?? 0) === 0,
    entered_uom_code: String(line.entered_uom_code ?? ""),
    entered_quantity: String(line.entered_quantity ?? line.quantity ?? ""),
    batch_number: String(line.batch_number ?? ""),
  };
}

function serializeEditableLine(line) {
  return JSON.stringify({
    material_id: line.material_id,
    storage_location_id: line.storage_location_id,
    stock_type: line.stock_type,
    quantity: String(line.quantity ?? ""),
    rate_per_unit: String(line.rate_per_unit ?? ""),
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

  useEffect(() => {
    if (!detail) return;
    const nextLines = Array.isArray(detail.lines) ? detail.lines.map(mapLineForEditing) : [];
    setEditableLines(nextLines);
    setSavedSnapshot(new Map(nextLines.map((line) => [line.id, serializeEditableLine(line)])));
    setCurrentPage(0);
  }, [detail]);

  const materialMap = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );
  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        value: material.id,
        label: `${material.material_name ?? "Material"} (${material.pace_code ?? material.material_code ?? material.id})`,
      })),
    [materials],
  );
  const locationOptions = useMemo(
    () =>
      locations.map((location) => ({
        value: location.id,
        label: `${location.location_code ?? location.location_name ?? location.id} (${location.location_type ?? "STORE"})`,
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

  const editedLineIds = useMemo(
    () =>
      editableLines
        .filter((line) => serializeEditableLine(line) !== savedSnapshot.get(line.id))
        .map((line) => line.id),
    [editableLines, savedSnapshot],
  );

  const editedLineSet = useMemo(() => new Set(editedLineIds), [editedLineIds]);
  const totalPages = Math.max(1, Math.ceil(editableLines.length / PAGE_SIZE));
  const pagedLines = useMemo(
    () => editableLines.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [editableLines, currentPage],
  );
  const companyLabel = companyMap.get(companyId) ?? companyId;
  const loading =
    documentQuery.isLoading ||
    materialQuery.isLoading ||
    locationQuery.isLoading ||
    companiesQuery.isLoading;
  const queryError =
    documentQuery.error?.message ||
    materialQuery.error?.message ||
    locationQuery.error?.message ||
    companiesQuery.error?.message ||
    "";
  const canApprove =
    detail?.status === "SUBMITTED" &&
    !saving &&
    !approving &&
    editedLineIds.length === 0 &&
    Boolean(detail?.id);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading || !searchedDocumentNumber,
      perform: () =>
        void Promise.all([
          documentQuery.refetch(),
          materialQuery.refetch(),
          locationQuery.refetch(),
          companiesQuery.refetch(),
        ]),
    },
  });

  function updateLine(lineId, patch) {
    setEditableLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        const nextLine = { ...line, ...patch };
        if (patch.is_zero_stock === true) {
          nextLine.quantity = "0";
          nextLine.entered_quantity = "0";
        }
        if (patch.quantity !== undefined && patch.is_zero_stock !== true) {
          nextLine.entered_quantity = String(patch.quantity);
        }
        const selectedMaterial = materialMap.get(nextLine.material_id);
        nextLine.entered_uom_code = selectedMaterial?.base_uom_code || nextLine.entered_uom_code || "";
        if (selectedMaterial?.material_type !== "SFG" && selectedMaterial?.material_type !== "FG") {
          nextLine.batch_number = "";
        }
        return nextLine;
      }),
    );
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
      const lines = editableLines
        .filter((line) => editedLineSet.has(line.id))
        .map((line) => ({
          id: line.id,
          material_id: line.material_id,
          storage_location_id: line.storage_location_id,
          stock_type: line.stock_type,
          batch_number: line.batch_number || null,
          quantity: line.is_zero_stock ? 0 : Number(line.quantity),
          rate_per_unit: Number(line.rate_per_unit || 0),
          is_zero_stock: Boolean(line.is_zero_stock),
          entered_uom_code: line.entered_uom_code || null,
          entered_quantity: line.is_zero_stock ? 0 : Number(line.entered_quantity || line.quantity || 0),
        }));

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
        ...((error || queryError)
          ? [{ key: "opening-stock-approval-error", tone: "error", message: error || queryError }]
          : []),
        ...(notice ? [{ key: "opening-stock-approval-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: "Back To List",
          tone: "neutral",
          onClick: () => openScreen("PROC_OPENING_STOCK_LIST"),
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () =>
            void Promise.all([
              documentQuery.refetch(),
              materialQuery.refetch(),
              locationQuery.refetch(),
              companiesQuery.refetch(),
            ]),
          disabled: !searchedDocumentNumber,
        },
        {
          key: "save",
          label: saving ? "Saving..." : "Save Corrections",
          tone: "primary",
          onClick: () => void handleSaveCorrections(),
          disabled: !detail?.id || editedLineIds.length === 0 || saving || approving,
        },
        {
          key: "approve",
          label: approving ? "Approving..." : "Approve",
          tone: "primary",
          onClick: () => void handleApprove(),
          disabled: !canApprove,
        },
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Page 1" title="Document Number">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <ErpDenseFormRow label="Document Number" required>
              <input
                value={documentNumberInput}
                onChange={(event) => setDocumentNumberInput(event.target.value.toUpperCase())}
                placeholder="Enter opening stock document number"
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleSearch}
                className="h-8 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950"
              >
                Search
              </button>
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

            <ErpSectionCard
              eyebrow="Page 2"
              title="Correct And Approve Lines"
              aside={(
                <div className="text-sm font-semibold text-slate-600">
                  Edited Rows: {editedLineIds.length} | Page {currentPage + 1} of {totalPages}
                </div>
              )}
            >
              <div className="grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Line #</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Material Type</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Material Name</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Pace Code</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Storage Location</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Status</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Base UOM</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Batch Number</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Counted Stock</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Zero Stock</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Rate</th>
                          <th className="border-b border-slate-200 px-3 py-2 text-left">Total Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedLines.map((line) => {
                          const material = materialMap.get(line.material_id);
                          const dirty = editedLineSet.has(line.id);
                          return (
                            <tr key={line.id} className={`align-top even:bg-slate-50/40 ${dirty ? "bg-amber-50/50" : ""}`}>
                              <td className="border-b border-slate-100 px-3 py-2">{line.line_number}</td>
                              <td className="border-b border-slate-100 px-3 py-2">{material?.material_type ?? "—"}</td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[260px]">
                                <ErpComboboxField
                                  value={line.material_id}
                                  onChange={(value) => updateLine(line.id, { material_id: value })}
                                  options={materialOptions}
                                  blankLabel="Select material"
                                />
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2">{material?.pace_code ?? "—"}</td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[240px]">
                                <select
                                  value={line.storage_location_id}
                                  onChange={(event) => updateLine(line.id, { storage_location_id: event.target.value })}
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
                                  value={line.stock_type}
                                  onChange={(event) => updateLine(line.id, { stock_type: event.target.value })}
                                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                >
                                  {STOCK_TYPES.map((stockType) => (
                                    <option key={stockType} value={stockType}>
                                      {stockType}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2">{material?.base_uom_code ?? line.entered_uom_code ?? "—"}</td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[180px]">
                                {material?.material_type === "SFG" || material?.material_type === "FG" ? (
                                  <input
                                    type="text"
                                    value={line.batch_number}
                                    onChange={(event) => updateLine(line.id, { batch_number: event.target.value.toUpperCase() })}
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
                                  value={line.is_zero_stock ? "0" : line.quantity}
                                  disabled={line.is_zero_stock}
                                  onChange={(event) => updateLine(line.id, { quantity: event.target.value, entered_quantity: event.target.value })}
                                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-500"
                                />
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(line.is_zero_stock)}
                                  onChange={(event) => updateLine(line.id, { is_zero_stock: event.target.checked })}
                                  className="h-4 w-4"
                                />
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 min-w-[130px]">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={line.rate_per_unit}
                                  onChange={(event) => updateLine(line.id, { rate_per_unit: event.target.value })}
                                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                />
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2">
                                {formatCurrency(Number(line.quantity || 0) * Number(line.rate_per_unit || 0), currencyCode)}
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

                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-500">
                    Unsaved edits persist across page changes until Save Corrections.
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
                      disabled={currentPage === 0}
                      className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))}
                      disabled={currentPage >= totalPages - 1}
                      className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 disabled:opacity-40"
                    >
                      Next
                    </button>
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
