/*
 * PIDocumentCreatePage — MI01, §119.4/§119.7/§119.12/§119.13.
 * Dedicated Create page (not a List-page side panel — FG/SFG batch/PO + multi-location
 * selection is too complex for that). LOCATION_WISE sweeps one location; ITEM_WISE lets the
 * Auditor search a material, see its stock across EVERY location (§119.12 correction — one PID
 * can now span multiple locations), and stage rows before actually creating the document.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listStorageLocations } from "../../om/omApi.js";
import { createPIDocument, getPIMaterialLocationBreakdown } from "../procurementApi.js";
import {
  MASTER_PICKER_FETCH_LIMIT,
  useMaterialOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

const PI_MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);
const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];

function normalizeLocationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

function stagedKey(row) {
  return [row.material_id, row.stock_type, row.storage_location_id, row.batch_number ?? "", row.packing_order_id ?? ""].join("::");
}

function normalizeCreateErrorMessage(message, mode) {
  const text = String(message || "").trim();
  if (!text) return "PID create failed.";
  if (text.includes("storage_location_id does not belong to company_id")) {
    return "The selected storage location no longer matches the current company. Re-select the location and try again.";
  }
  if (text.includes("company_id, count_date, posting_date, and valid mode are required")) {
    return "Company, mode, count date, and posting date are required.";
  }
  if (text.includes("storage_location_id is required for LOCATION_WISE mode")) {
    return "Choose a storage location before creating a location-wise PID.";
  }
  if (text === "PI_CREATE_FAILED") {
    return mode === "LOCATION_WISE" ? "Could not create the location-wise PID." : "Could not create the item-wise PID.";
  }
  return text;
}

export default function PIDocumentCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext));
  const [mode, setMode] = useState("LOCATION_WISE");
  const [storageLocationId, setStorageLocationId] = useState("");
  const [countDate, setCountDate] = useState(new Date().toISOString().slice(0, 10));
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [isOpeningStockSource, setIsOpeningStockSource] = useState(false);
  // §MI01-ignore-zero-2026-08-14 — unchecked by default: a full physical sweep should include
  // every material that ever moved through this location, even ones currently at zero book
  // stock (that's exactly the case a physical count is meant to catch — phantom stock the
  // system doesn't know about). Checking this trades completeness for a faster, leaner sweep.
  const [ignoreZeroStock, setIgnoreZeroStock] = useState(false);

  // ITEM_WISE staging
  const [searchMaterialId, setSearchMaterialId] = useState("");
  const [breakdown, setBreakdown] = useState(null); // { material, items }
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [checkedKeys, setCheckedKeys] = useState({});
  const [stagedItems, setStagedItems] = useState([]); // [{material_id, stock_type, storage_location_id, batch_number, packing_order_id, book_qty, ...display}]

  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0, status: "ACTIVE" });
  const materialOptions = useMemo(
    () =>
      materialQuery.materials
        .filter((row) => PI_MATERIAL_TYPES.has(String(row.material_type || "").toUpperCase()))
        .map((row) => ({ value: row.id, label: `${row.material_name ?? "Material"} (${row.pace_code ?? row.material_code ?? row.id})` })),
    [materialQuery.materials],
  );

  useEffect(() => {
    let active = true;
    if (!companyId) {
      setLocations([]);
      return undefined;
    }
    listStorageLocations({ company_id: companyId, is_active: true })
      .then((result) => { if (active) setLocations(normalizeLocationRows(result)); })
      .catch(() => { if (active) setLocations([]); });
    return () => { active = false; };
  }, [companyId]);

  useEffect(() => {
    setStorageLocationId("");
    setSearchMaterialId("");
    setBreakdown(null);
    setCheckedKeys({});
    setStagedItems([]);
    setError("");
  }, [companyId]);

  useEffect(() => {
    setError("");
    setSearchMaterialId("");
    setBreakdown(null);
    setCheckedKeys({});
    if (mode === "LOCATION_WISE") {
      setStagedItems([]);
      return;
    }
    setStorageLocationId("");
  }, [mode]);

  useEffect(() => {
    if (!storageLocationId) return;
    const stillExists = locations.some((row) => String(row.id || "") === String(storageLocationId));
    if (!stillExists) {
      setStorageLocationId("");
    }
  }, [locations, storageLocationId]);

  const locationOptions = useMemo(
    () => locations.map((row) => ({ value: row.id, label: `${row.code ?? row.storage_location_code ?? row.id} — ${row.name ?? row.storage_location_name ?? ""}`.trim() })),
    [locations],
  );

  async function handleSearchMaterial(materialId) {
    setSearchMaterialId(materialId);
    setBreakdown(null);
    setCheckedKeys({});
    if (!materialId || !companyId) return;
    setBreakdownLoading(true);
    setError("");
    try {
      const result = await getPIMaterialLocationBreakdown({ company_id: companyId, material_id: materialId });
      setBreakdown(result);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "PI_MATERIAL_LOCATIONS_FAILED");
    } finally {
      setBreakdownLoading(false);
    }
  }

  function addCheckedToStaged() {
    const rows = Array.isArray(breakdown?.items) ? breakdown.items : [];
    const toAdd = rows.filter((row) => checkedKeys[stagedKey(row)]);
    if (toAdd.length === 0) return;
    setStagedItems((current) => {
      const existingKeys = new Set(current.map(stagedKey));
      const fresh = toAdd
        .filter((row) => !existingKeys.has(stagedKey(row)))
        .map((row) => ({ ...row, material: breakdown.material }));
      return [...current, ...fresh];
    });
    setCheckedKeys({});
    setSearchMaterialId("");
    setBreakdown(null);
  }

  function removeStaged(row) {
    setStagedItems((current) => current.filter((entry) => stagedKey(entry) !== stagedKey(row)));
  }

  const canCreate = companyId && countDate && postingDate
    && (mode === "LOCATION_WISE" ? Boolean(storageLocationId) : stagedItems.length > 0);

  async function handleCreate() {
    setError("");
    if (!canCreate) {
      setError(mode === "LOCATION_WISE" ? "Company, storage location, count date, and posting date are required." : "Company, count date, posting date, and at least one staged item are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: companyId,
        mode,
        count_date: countDate,
        posting_date: postingDate,
        notes: notes.trim() || null,
        is_opening_stock_source: isOpeningStockSource,
        ...(mode === "LOCATION_WISE"
          ? { storage_location_id: storageLocationId, ignore_zero_stock: ignoreZeroStock }
          : { items: stagedItems.map((row) => ({ material_id: row.material_id, stock_type: row.stock_type, storage_location_id: row.storage_location_id })) }),
      };
      const created = await createPIDocument(payload);
      if (created?.id) {
        openScreen(OPERATION_SCREENS.PROC_PI_DETAIL.screen_code, { context: { id: created.id } });
        navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(created.id)}`);
      }
    } catch (saveError) {
      // §119.9 — a blocked material surfaces which PID document owns the block.
      const message = saveError instanceof Error ? saveError.message : "PI_CREATE_FAILED";
      setError(normalizeCreateErrorMessage(message, mode));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title="New Physical Inventory Document"
      notices={[
        ...(error ? [{ key: "pi-create-error", tone: "error", message: error }] : []),
        {
          key: "pi-create-stage",
          tone: "info",
          message: mode === "LOCATION_WISE"
            ? "MI01 Location-wise: choose the company and one storage location, then create the PID scope in one step."
            : "MI01 Item-wise: search a material, pick the exact location rows you want, stage them, then create the PID.",
        },
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
          key: "create",
          label: saving ? "Creating..." : "Create PID",
          tone: "primary",
          onClick: () => void handleCreate(),
          disabled: saving || !canCreate,
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Step" value="MI01 Create" tone="sky" />
          <ErpFieldPreview label="Mode" value={mode === "LOCATION_WISE" ? "Location-wise" : "Item-wise"} />
          <ErpFieldPreview label="Company Scope" value={companyId ? "Selected" : "Required"} />
          <ErpFieldPreview
            label="Ready To Create"
            value={canCreate ? "Yes" : "No"}
            caption={mode === "LOCATION_WISE" ? "Need company + location + dates" : `Staged ${stagedItems.length}`}
          />
        </div>

        <ErpSectionCard eyebrow="Header" title="Document header">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="md:col-span-1 xl:col-span-2">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
            </div>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Mode <span className="text-rose-500">*</span>
              <select
                value={mode}
                onChange={(event) => { setMode(event.target.value); setStagedItems([]); setBreakdown(null); }}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="LOCATION_WISE">Location-wise</option>
                <option value="ITEM_WISE">Item-wise</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Count Date <span className="text-rose-500">*</span>
              <input
                type="date"
                value={countDate}
                onChange={(event) => {
                  const next = event.target.value;
                  setCountDate(next);
                  setPostingDate((current) => (current === countDate ? next : current));
                }}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Posting Date <span className="text-rose-500">*</span>
              <input
                type="date"
                value={postingDate}
                onChange={(event) => setPostingDate(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            {mode === "LOCATION_WISE" ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-700 xl:col-span-2">
                Storage Location <span className="text-rose-500">*</span>
                <select
                  value={storageLocationId}
                  onChange={(event) => setStorageLocationId(event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select storage location</option>
                  {locationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {companyId && locationOptions.length === 0 ? (
                  <span className="text-[11px] font-normal text-amber-700">
                    No active storage location is currently available for the selected company.
                  </span>
                ) : null}
              </label>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Notes
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-[60px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm font-normal text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <div className="flex items-end">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isOpeningStockSource}
                  onChange={(event) => setIsOpeningStockSource(event.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="font-semibold">Opening Stock Source</span> — once posted, this document's
                  count becomes the official Opening Stock reference for the next period.
                </span>
              </label>
            </div>
            {mode === "LOCATION_WISE" ? (
              <div className="flex items-end md:col-span-2">
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={ignoreZeroStock}
                    onChange={(event) => setIgnoreZeroStock(event.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="font-semibold">Ignore Zero Stock</span> — skip materials with zero book
                    quantity at this location. Unchecked (default) includes them too, so the count can catch
                    stock the system doesn't know about, not just confirm what it already expects. A material
                    can appear as multiple rows here — one per stock type (Unrestricted/QI/Blocked) currently
                    or previously present at this location.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </ErpSectionCard>

        {mode === "ITEM_WISE" ? (
          <ErpSectionCard eyebrow="Item Selection" title="Search material, pick locations">
            <div className="grid gap-3">
              <ErpDenseFormRow label="Material">
                <ErpComboboxField
                  value={searchMaterialId}
                  onChange={(value) => void handleSearchMaterial(value)}
                  options={materialOptions}
                  blankLabel="Search material"
                />
              </ErpDenseFormRow>

              {breakdownLoading ? (
                <div className="text-sm text-slate-500">Loading stock breakdown...</div>
              ) : breakdown ? (
                <>
                  <ErpDenseGrid
                    columns={[
                      {
                        key: "check",
                        label: "",
                        width: "40px",
                        render: (row) => (
                          <input
                            type="checkbox"
                            checked={Boolean(checkedKeys[stagedKey(row)])}
                            onChange={(event) => setCheckedKeys((current) => ({ ...current, [stagedKey(row)]: event.target.checked }))}
                            className="h-4 w-4"
                          />
                        ),
                      },
                      { key: "storage_location_name", label: "Location", width: "220px", render: (row) => (row.storage_location_code || row.storage_location_name ? `${row.storage_location_code ?? "—"} — ${row.storage_location_name ?? "—"}` : "—") },
                      { key: "stock_type", label: "Stock Type", width: "140px" },
                      { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number ?? "—" },
                      { key: "packing_order_id", label: "Packing PO", width: "110px", render: (row) => (row.packing_order_id ? "Linked" : "—") },
                      { key: "book_qty", label: "Book Qty", width: "110px" },
                      { key: "base_uom_code", label: "UoM", width: "70px" },
                    ]}
                    rows={breakdown.items}
                    rowKey={stagedKey}
                    emptyMessage="No stock found for this material in this company (a zero-qty row won't appear here — use the material search again to add a not-yet-in-system item)."
                    maxHeight="260px"
                  />
                  <div>
                    <button
                      type="button"
                      onClick={addCheckedToStaged}
                      className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                    >
                      Add checked to PID
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </ErpSectionCard>
        ) : null}

        {mode === "ITEM_WISE" ? (
          <ErpSectionCard eyebrow="Staged" title={`${stagedItems.length} item${stagedItems.length === 1 ? "" : "s"} staged`}>
            <ErpDenseGrid
              columns={[
                { key: "material", label: "Material", render: (row) => `${row.material?.material_name ?? "Material"} (${row.material?.pace_code ?? "—"})` },
                { key: "storage_location_name", label: "Location", width: "200px", render: (row) => (row.storage_location_code || row.storage_location_name ? `${row.storage_location_code ?? "—"} — ${row.storage_location_name ?? "—"}` : "—") },
                { key: "stock_type", label: "Stock Type", width: "140px" },
                { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number ?? "—" },
                { key: "book_qty", label: "Book Qty", width: "100px" },
                {
                  key: "actions",
                  label: "",
                  width: "80px",
                  render: (row) => (
                    <button type="button" onClick={() => removeStaged(row)} className="text-xs font-semibold text-rose-700">
                      Remove
                    </button>
                  ),
                },
              ]}
              rows={stagedItems}
              rowKey={stagedKey}
              emptyMessage="No items staged yet — search a material above."
              maxHeight="300px"
            />
          </ErpSectionCard>
        ) : null}
      </div>
    </ErpScreenScaffold>
  );
}
