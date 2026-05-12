import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listMaterials, listStorageLocations } from "../../om/omApi.js";
import {
  addPIItem,
  enterPICount,
  getPIDocument,
  postPIDifferences,
  requestPIRecount,
} from "../procurementApi.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];
const PI_MATERIAL_TYPES = new Set(["RM", "PM", "INT"]);

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "COUNTED":
      return "amber";
    case "POSTED":
      return "emerald";
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

function normalizeMaterialRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

function normalizeLocationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

function toneForDifference(value) {
  if (value < 0) return "text-rose-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-600";
}

export default function PIDocumentDetailPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { runtimeContext } = useMenu();
  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";
  const [detail, setDetail] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [storageLocations, setStorageLocations] = useState([]);
  const [countDrafts, setCountDrafts] = useState({});
  const [activeCountItemId, setActiveCountItemId] = useState("");
  const [itemForm, setItemForm] = useState({
    material_id: "",
    stock_type: "UNRESTRICTED",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const items = Array.isArray(detail?.items) ? detail.items : [];
  const materialOptions = useMemo(
    () =>
      materials
        .filter((row) => PI_MATERIAL_TYPES.has(String(row.material_type || "").toUpperCase()))
        .map((row) => ({
          value: row.id,
          label: `${row.material_name ?? "Material"} (${row.pace_code ?? row.material_code ?? row.id})`,
        })),
    [materials],
  );
  const materialMap = useMemo(
    () => new Map(materials.map((row) => [row.id, row])),
    [materials],
  );
  const locationMap = useMemo(
    () => new Map(storageLocations.map((row) => [row.id, row])),
    [storageLocations],
  );

  const countedItems = items.filter((row) => row.physical_qty !== null && row.physical_qty !== undefined).length;
  const pendingItems = items.length - countedItems;
  const canEditCounts = ["OPEN", "COUNTED"].includes(String(detail?.status || "").toUpperCase());
  const canAddItems = String(detail?.status || "").toUpperCase() === "OPEN";

  async function loadDetail() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const document = await getPIDocument(id);
      const [materialRows, locationRows] = await Promise.all([
        listMaterials({ limit: 500, offset: 0, status: "ACTIVE" }),
        listStorageLocations({
          company_id: selectedCompanyId || undefined,
          plant_id: document.plant_id,
          is_active: true,
        }).catch(() => []),
      ]);

      setDetail(document);
      setMaterials(normalizeMaterialRows(materialRows));
      setStorageLocations(normalizeLocationRows(locationRows));
      setCountDrafts({});
      setActiveCountItemId("");
    } catch (loadError) {
      setDetail(null);
      setMaterials([]);
      setStorageLocations([]);
      setError(loadError instanceof Error ? loadError.message : "PI_DOCUMENT_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, selectedCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  function getDraftValue(item) {
    const draft = countDrafts[item.id];
    if (draft !== undefined) return draft;
    if (item.physical_qty !== null && item.physical_qty !== undefined) {
      return String(item.physical_qty);
    }
    return "";
  }

  function getLiveDifference(item) {
    const draftValue = getDraftValue(item);
    if (draftValue === "") {
      return item.physical_qty === null || item.physical_qty === undefined
        ? null
        : Number(item.physical_qty) - Number(item.book_qty ?? 0);
    }
    const numericValue = Number(draftValue);
    if (!Number.isFinite(numericValue)) return null;
    return numericValue - Number(item.book_qty ?? 0);
  }

  async function saveCount(itemId, value) {
    if (!detail?.id) return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      setError("Physical quantity must be 0 or greater.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await enterPICount(detail.id, itemId, { physical_qty: numericValue });
      setNotice("Physical count saved.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_COUNT_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleRecount(itemId) {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await requestPIRecount(detail.id, itemId);
      setNotice("Recount requested.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_RECOUNT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddItem() {
    if (!detail?.id || !itemForm.material_id || !itemForm.stock_type) {
      setError("Material and stock type are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await addPIItem(detail.id, itemForm);
      setNotice("PI item added.");
      setItemForm({ material_id: "", stock_type: "UNRESTRICTED" });
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_ITEM_ADD_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePostDifferences() {
    if (!detail?.id) return;
    const confirmed = window.confirm("This will post stock differences to the inventory ledger. Cannot be undone.");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await postPIDifferences(detail.id);
      setNotice("PI differences posted.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title={detail?.document_number ? `Physical Inventory | ${detail.document_number}` : "Physical Inventory Detail"}
      notices={[
        ...(error ? [{ key: "pi-detail-error", tone: "error", message: error }] : []),
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
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadDetail(),
        },
        ...(["OPEN", "COUNTED"].includes(String(detail?.status || "").toUpperCase())
          ? [{
              key: "post",
              label: saving ? "Posting..." : "Post Differences",
              tone: "primary",
              onClick: () => void handlePostDifferences(),
              disabled: saving,
            }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading PI document..." : "PI document is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
            <ErpFieldPreview label="Plant" value={detail.plant_id || "—"} caption={`Storage: ${locationMap.get(detail.storage_location_id)?.code ?? detail.storage_location_id ?? "—"}`} />
            <ErpFieldPreview label="Progress" value={`Counted ${countedItems}/${items.length}`} caption={`Pending ${pendingItems}`} />
          </div>

          <ErpSectionCard eyebrow="Header" title={detail.document_number || "PI Document"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Mode" value={detail.mode || "—"} />
              <ErpFieldPreview label="Count Date" value={formatDate(detail.count_date)} />
              <ErpFieldPreview label="Posting Date" value={formatDate(detail.posting_date)} />
              <ErpFieldPreview label="Created By" value={detail.created_by || "—"} />
              <ErpFieldPreview label="Posted By" value={detail.posted_by || "—"} />
              <ErpFieldPreview label="Posted At" value={formatDateTime(detail.posted_at)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Count Progress"
            title="Item counts"
            aside={(
              <div className="text-sm font-semibold text-slate-600">
                Total Items | Counted {countedItems}/{items.length} | Pending {pendingItems}
              </div>
            )}
          >
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
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
                { key: "stock_type", label: "Stock Type", width: "160px" },
                { key: "book_qty", label: "Book Qty", width: "110px" },
                {
                  key: "physical_qty",
                  label: "Physical Qty",
                  width: "160px",
                  render: (row) => {
                    const isPosted = Boolean(row.posted_stock_document_id);
                    const isEditing = activeCountItemId === row.id || row.physical_qty === null || row.physical_qty === undefined;
                    if (!canEditCounts || isPosted) {
                      return row.physical_qty ?? "—";
                    }
                    if (isEditing) {
                      return (
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={getDraftValue(row)}
                          onChange={(event) =>
                            setCountDrafts((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          onFocus={() => setActiveCountItemId(row.id)}
                          onBlur={() => void saveCount(row.id, getDraftValue(row))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      );
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCountItemId(row.id);
                          setCountDrafts((current) => ({
                            ...current,
                            [row.id]: String(row.physical_qty ?? ""),
                          }));
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-900"
                      >
                        {row.physical_qty}
                      </button>
                    );
                  },
                },
                {
                  key: "difference",
                  label: "Difference",
                  width: "120px",
                  render: (row) => {
                    const difference = getLiveDifference(row);
                    if (difference === null) {
                      return <span className="text-slate-400">—</span>;
                    }
                    return <span className={`font-semibold ${toneForDifference(difference)}`}>{difference.toFixed(4)}</span>;
                  },
                },
                {
                  key: "counted_by",
                  label: "Counted By",
                  width: "140px",
                  render: (row) => row.counted_by || "—",
                },
                {
                  key: "actions",
                  label: "Actions",
                  width: "130px",
                  render: (row) => {
                    const isPosted = Boolean(row.posted_stock_document_id);
                    const hasCount = row.physical_qty !== null && row.physical_qty !== undefined;
                    if (!canEditCounts || isPosted || !hasCount) {
                      return "—";
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => void handleRecount(row.id)}
                        className="border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900"
                      >
                        Recount
                      </button>
                    );
                  },
                },
              ]}
              rows={items}
              rowKey={(row) => row.id}
              getRowProps={(row) => {
                const difference = getLiveDifference(row);
                if (difference === null) return {};
                return {
                  className:
                    difference < 0
                      ? "bg-rose-50"
                      : difference > 0
                      ? "bg-emerald-50"
                      : "bg-slate-50",
                };
              }}
              emptyMessage="No PI items found."
              maxHeight="460px"
            />
          </ErpSectionCard>

          {canAddItems ? (
            <ErpSectionCard eyebrow="Add Item" title="Add item to current PI document">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
                <ErpDenseFormRow label="Material" required>
                  <ErpComboboxField
                    value={itemForm.material_id}
                    onChange={(value) => setItemForm((current) => ({ ...current, material_id: value }))}
                    options={materialOptions}
                    blankLabel="Select material"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Stock Type" required>
                  <select
                    value={itemForm.stock_type}
                    onChange={(event) => setItemForm((current) => ({ ...current, stock_type: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {STOCK_TYPES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleAddItem()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
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
