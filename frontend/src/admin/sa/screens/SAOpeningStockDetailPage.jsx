/*
 * File-ID: 19.3.2
 * File-Path: frontend/src/admin/sa/screens/SAOpeningStockDetailPage.jsx
 * Gate: 19
 * Phase: 19
 * Domain: PROCUREMENT
 * Purpose: SA detail screen for opening stock document lines and posting workflow.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  approveOpeningStockDocument,
  addOpeningStockLine,
  getOpeningStockDocument,
  postOpeningStockDocument,
  removeOpeningStockLine,
  submitOpeningStockDocument,
  updateOpeningStockLine,
} from "../../../pages/dashboard/procurement/procurementApi.js";
import { listMaterials, listStorageLocations } from "../../../pages/dashboard/om/omApi.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const ENTRY_MODES = Object.freeze({
  SINGLE: "SINGLE",
  BULK: "BULK",
});

function createEmptySingleForm() {
  return {
    material_id: "",
    storage_location_id: "",
    stock_type: "UNRESTRICTED",
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
    quantity: "",
    rate_per_unit: "",
  };
}

function formatCurrency(value) {
  const numericValue = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
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

function isLocationMappedToPlant(location, plantId) {
  const normalizedPlantId = String(plantId ?? "").trim();
  if (!normalizedPlantId) return true;
  const directPlantId = String(location.plant_id ?? "").trim();
  if (directPlantId && directPlantId === normalizedPlantId) return true;
  const companyFieldPlantId = String(location.company_id ?? "").trim();
  if (companyFieldPlantId && companyFieldPlantId === normalizedPlantId) return true;
  if (Array.isArray(location.plant_ids)) {
    return location.plant_ids.map((entry) => String(entry)).includes(normalizedPlantId);
  }
  return !directPlantId && !companyFieldPlantId;
}

export default function SAOpeningStockDetailPage({ documentId: documentIdProp = "" }) {
  const navigate = useNavigate();
  const params = useParams();
  const documentId = documentIdProp || params.id || "";
  const [detail, setDetail] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [locations, setLocations] = useState([]);
  const [entryMode, setEntryMode] = useState(ENTRY_MODES.SINGLE);
  const [singleForm, setSingleForm] = useState(createEmptySingleForm());
  const [bulkRows, setBulkRows] = useState([createBulkRow(1), createBulkRow(2), createBulkRow(3)]);
  const [editingLineId, setEditingLineId] = useState("");
  const [editForm, setEditForm] = useState(createEmptySingleForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        value: material.id,
        label: `${material.material_name ?? "Material"} (${material.pace_code ?? material.material_code ?? material.id})`,
      })),
    [materials],
  );

  const materialMap = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );

  const filteredLocations = useMemo(
    () => locations.filter((location) => isLocationMappedToPlant(location, detail?.plant_id)),
    [detail?.plant_id, locations],
  );

  const locationOptions = useMemo(
    () =>
      filteredLocations.map((location) => ({
        value: location.id,
        label: `${location.location_code ?? location.location_name ?? location.id} (${location.location_type ?? "STORE"})`,
      })),
    [filteredLocations],
  );

  const locationMap = useMemo(
    () => new Map(filteredLocations.map((location) => [location.id, location])),
    [filteredLocations],
  );

  const totalValue = useMemo(() => Number(singleForm.quantity || 0) * Number(singleForm.rate_per_unit || 0), [singleForm]);

  async function loadDetail() {
    if (!documentId) {
      setLoading(false);
      setError("Opening stock document id is required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const document = await getOpeningStockDocument(documentId);
      setDetail(document);
      const [materialRows, locationRows] = await Promise.all([
        listMaterials({ limit: 500, status: "ACTIVE" }),
        listStorageLocations({ plant_id: document.plant_id }),
      ]);
      setMaterials(Array.isArray(materialRows?.data) ? materialRows.data : Array.isArray(materialRows) ? materialRows : []);
      setLocations(Array.isArray(locationRows?.data) ? locationRows.data : Array.isArray(locationRows) ? locationRows : []);
    } catch (loadError) {
      setDetail(null);
      setError(loadError instanceof Error ? loadError.message : "OPENING_STOCK_DOCUMENT_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [documentId]);

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
        quantity: Number(singleForm.quantity),
        rate_per_unit: Number(singleForm.rate_per_unit),
      });
      setNotice("Opening stock line added.");
      resetSingleForm();
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBulkLines() {
    if (!detail || detail.status !== "DRAFT") return;
    const validRows = bulkRows.filter(
      (row) => row.material_id && row.storage_location_id && row.quantity && row.rate_per_unit !== "",
    );

    if (validRows.length === 0) {
      setError("Fill at least one complete bulk row before adding.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      for (const row of validRows) {
        await addOpeningStockLine(detail.id, {
          material_id: row.material_id,
          storage_location_id: row.storage_location_id,
          stock_type: row.stock_type,
          quantity: Number(row.quantity),
          rate_per_unit: Number(row.rate_per_unit),
        });
      }
      setNotice(`${validRows.length} opening stock lines added.`);
      setBulkRows([createBulkRow(1), createBulkRow(2), createBulkRow(3)]);
      await loadDetail();
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
        quantity: Number(editForm.quantity),
        rate_per_unit: Number(editForm.rate_per_unit),
      });
      setEditingLineId("");
      setNotice("Opening stock line updated.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_LINE_UPDATE_FAILED");
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
      await loadDetail();
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
      setNotice("Opening stock document submitted.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_DOCUMENT_SUBMIT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!detail) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await approveOpeningStockDocument(detail.id);
      setNotice("Opening stock document approved.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_DOCUMENT_APPROVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    if (!detail) return;
    const confirmed = window.confirm("This will post stock movements to the ledger. Cannot be undone.");
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await postOpeningStockDocument(detail.id);
      setNotice("Opening stock document posted to inventory ledger.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OPENING_STOCK_DOCUMENT_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const lines = Array.isArray(detail?.lines) ? detail.lines : [];
  const computedTotalValue = lines.reduce((sum, line) => sum + Number(line.total_value ?? 0), 0);

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin"
      title={detail?.document_number ? `Opening Stock | ${detail.document_number}` : "Opening Stock Detail"}
      notices={[
        ...(error ? [{ key: "opening-stock-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "opening-stock-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: "Back To List",
          tone: "neutral",
          onClick: () => { openScreen("SA_OPENING_STOCK_LIST"); navigate("/sa/opening-stock"); },
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadDetail(),
        },
        ...(detail?.status === "DRAFT"
          ? [{ key: "submit", label: saving ? "Submitting..." : "Submit For Approval", tone: "primary", onClick: () => void handleSubmit(), disabled: saving }]
          : []),
        ...(detail?.status === "SUBMITTED"
          ? [{ key: "approve", label: saving ? "Approving..." : "Approve", tone: "primary", onClick: () => void handleApprove(), disabled: saving }]
          : []),
        ...(detail?.status === "APPROVED"
          ? [{ key: "post", label: saving ? "Posting..." : "Post Stock", tone: "primary", onClick: () => void handlePost(), disabled: saving }]
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
          <div className="grid gap-4 xl:grid-cols-3">
            <ErpFieldPreview label="Document #" value={detail.document_number} tone={getStatusTone(detail.status)} badge={detail.status} />
            <ErpFieldPreview label="Company" value={detail.company_id} caption={`Plant: ${detail.plant_id || "-"}`} />
            <ErpFieldPreview label="Cut-off Date" value={formatDate(detail.cut_off_date)} caption={`Created: ${formatDateTime(detail.created_at)}`} />
          </div>

          <ErpSectionCard eyebrow="Header" title="Document Header">
            <div className="grid gap-3 xl:grid-cols-2">
              <ErpFieldPreview label="Status" value={detail.status} tone={getStatusTone(detail.status)} />
              <ErpFieldPreview label="Notes" value={detail.notes || "No notes"} multiline />
              <ErpFieldPreview label="Submitted At" value={formatDateTime(detail.submitted_at)} />
              <ErpFieldPreview label="Approved At" value={formatDateTime(detail.approved_at)} />
              <ErpFieldPreview label="Posted At" value={formatDateTime(detail.posted_at)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Lines"
            title="Opening stock lines"
            aside={(
              <div className="text-sm font-semibold text-slate-600">
                Total Lines: {lines.length} | Total Value: {formatCurrency(computedTotalValue)}
              </div>
            )}
          >
            <div className="grid gap-3">
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
                      return location
                        ? `${location.location_code ?? location.location_name ?? location.id}`
                        : row.storage_location_id;
                    },
                  },
                  { key: "stock_type", label: "Stock Type", width: "170px" },
                  { key: "quantity", label: "Qty", width: "100px" },
                  { key: "rate_per_unit", label: "Rate", width: "100px" },
                  {
                    key: "total_value",
                    label: "Total Value",
                    width: "140px",
                    render: (row) => formatCurrency(row.total_value),
                  },
                  { key: "movement_type_code", label: "Movement", width: "100px" },
                  {
                    key: "action",
                    label: "Action",
                    width: "180px",
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
                maxHeight="360px"
              />

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
            </div>
          </ErpSectionCard>

          {detail.status === "DRAFT" ? (
            <ErpSectionCard eyebrow="Add Line" title="Single entry or bulk entry">
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
                      <ErpDenseFormRow label="Total Value">
                        <input
                          value={formatCurrency(totalValue)}
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
                    <ErpDenseGrid
                      columns={[
                        {
                          key: "material_id",
                          label: "Material",
                          render: (row) => (
                            <ErpComboboxField
                              value={row.material_id}
                              onChange={(value) => updateBulkRow(row.key, { material_id: value })}
                              options={materialOptions}
                              blankLabel="Select material"
                            />
                          ),
                        },
                        {
                          key: "storage_location_id",
                          label: "Storage Location",
                          render: (row) => (
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
                          ),
                        },
                        {
                          key: "stock_type",
                          label: "Stock Type",
                          render: (row) => (
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
                          ),
                        },
                        {
                          key: "quantity",
                          label: "Qty",
                          render: (row) => (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.quantity}
                              onChange={(event) => updateBulkRow(row.key, { quantity: event.target.value })}
                              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                            />
                          ),
                        },
                        {
                          key: "rate_per_unit",
                          label: "Rate",
                          render: (row) => (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.rate_per_unit}
                              onChange={(event) => updateBulkRow(row.key, { rate_per_unit: event.target.value })}
                              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                            />
                          ),
                        },
                        {
                          key: "total",
                          label: "Total Value",
                          render: (row) => formatCurrency(Number(row.quantity || 0) * Number(row.rate_per_unit || 0)),
                        },
                        {
                          key: "remove",
                          label: "Action",
                          render: (row) => (
                            <button
                              type="button"
                              onClick={() => removeBulkRow(row.key)}
                              className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                            >
                              Remove
                            </button>
                          ),
                        },
                      ]}
                      rows={bulkRows}
                      rowKey={(row) => row.key}
                      maxHeight="320px"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={appendBulkRow}
                        className="border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
                      >
                        Add Grid Row
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
            </ErpSectionCard>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
