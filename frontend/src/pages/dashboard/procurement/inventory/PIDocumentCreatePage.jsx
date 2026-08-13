/*
 * PIDocumentCreatePage — MI01, §119.4/§119.7/§119.12/§119.13.
 * Dedicated Create page (not a List-page side panel — FG/SFG batch/PO + multi-location
 * selection is too complex for that). LOCATION_WISE sweeps one location; ITEM_WISE lets the
 * Auditor search a material, see its stock across EVERY location (§119.12 correction — one PID
 * can now span multiple locations), and stage rows before actually creating the document.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
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

  useMemo(() => {
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
          ? { storage_location_id: storageLocationId }
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
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title="New Physical Inventory Document"
      notices={error ? [{ key: "pi-create-error", tone: "error", message: error }] : []}
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
        <ErpSectionCard eyebrow="Header" title="Document header">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="md:col-span-1 xl:col-span-2">
              <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
            </div>
            <ErpDenseFormRow label="Mode" required>
              <select
                value={mode}
                onChange={(event) => { setMode(event.target.value); setStagedItems([]); setBreakdown(null); }}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="LOCATION_WISE">LOCATION_WISE (sweep one location)</option>
                <option value="ITEM_WISE">ITEM_WISE (pick materials, any location)</option>
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Count Date" required>
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
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Posting Date" required>
              <input
                type="date"
                value={postingDate}
                onChange={(event) => setPostingDate(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            {mode === "LOCATION_WISE" ? (
              <ErpDenseFormRow label="Storage Location" required>
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
              </ErpDenseFormRow>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ErpDenseFormRow label="Notes">
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-[60px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isOpeningStockSource}
                  onChange={(event) => setIsOpeningStockSource(event.target.checked)}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-semibold">Opening Stock Source</span> — §119.13: Posting Date+1 becomes
                  the next period&apos;s official Opening Stock reference for every item here, once Posted.
                </span>
              </label>
            </div>
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
                      { key: "storage_location_name", label: "Location", width: "220px", render: (row) => `${row.storage_location_code ?? row.storage_location_id} — ${row.storage_location_name ?? ""}` },
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
                { key: "material", label: "Material", render: (row) => `${row.material?.material_name ?? "Material"} (${row.material?.pace_code ?? row.material_id})` },
                { key: "storage_location_name", label: "Location", width: "200px", render: (row) => `${row.storage_location_code ?? row.storage_location_id} — ${row.storage_location_name ?? ""}` },
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
