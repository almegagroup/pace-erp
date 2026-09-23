/*
 * File-ID: 27.FE-PR09
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: FRONT
 * Purpose: Create new Process PO or Packing PO (Standard Create - both PO types).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  availabilityPreviewPackingOrder,
  availabilityPreviewProcessOrder,
  checkMtsBatchRange,
  createPackingOrder,
  createProcessOrder,
  createShift,
  getProcessOrderCreateCapability,
  previewMtsCreationMaterialPlan,
  previewMtsCreationPackingPlan,
  previewMtsCreationPackingCombine,
  commitMtsCreation,
  getPackBom,
  getStrokeMaster,
  listPackBoms,
  listPackCodes,
  listMtestSfgProdshadeOptions,
  listMtestSkusForPacking,
  listMtsCurrentStroke,
  listSegmentLocations,
  listShifts,
  listStrokeMasters,
} from "./prodApi.js";
import {
  addMaterialCategoryMember,
  createMaterialCategoryGroup,
  listMachines,
  listMaterialCategoryGroups,
  listMaterials,
  listMaterialUomConversions,
  listStorageLocations,
} from "../om/omApi.js";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";
import { GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";
import BlockingLayer from "../../../components/layer/BlockingLayer.jsx";
import { formatPreciseNumber, formatStockQty, multiplyPreciseValues, PRODUCTION_DECIMAL_STEP } from "./productionPrecision.js";
import { getManualPastDateBounds, isManualDocumentDateWithinPastWindow, MANUAL_PAST_DATE_WINDOW_MESSAGE } from "../../../utils/manualDocumentDateWindow.js";

const PROCESS_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const EPSILON_FRONTEND = 0.0001;
const MTEST_SEGMENTS = ["ADMIX", "HPS", "IWC", "POWDER"];
const PACKING_SOURCE_TYPES = ["MTO", "HPS", "MTS", "MTEST"];
const TABS = ["Process PO", "Packing PO"];
const PROCESS_PO_DATE_BOUNDS = getManualPastDateBounds();
// MTS Page 3 "Date" field (2026-09-17 lock) — current-3-days..current only,
// never future. Deliberately narrower than PROCESS_PO_DATE_BOUNDS' 3-CALENDAR-
// MONTH window above (that one is for backdated Planned Start Date generally;
// this is "which of the last few days did this actually run"). Mirrors the
// backend's own isProductionDateWithinWindow() in process_order.handlers.ts.
function toLocalIsoDateForBounds(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function getProductionDateBounds(today = new Date()) {
  const lower = new Date(today);
  lower.setDate(lower.getDate() - 3);
  return { min: toLocalIsoDateForBounds(lower), max: toLocalIsoDateForBounds(today) };
}
const PRODUCTION_DATE_BOUNDS = getProductionDateBounds();
const PRODUCTION_DATE_WINDOW_MESSAGE = "Date must be within the previous 3 days and cannot be in the future.";
function isProductionDateWithinWindow(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  return value >= PRODUCTION_DATE_BOUNDS.min && value <= PRODUCTION_DATE_BOUNDS.max;
}
const KG_UOM_CODES = new Set(["KG", "KGS", "KILOGRAM", "KILOGRAMS"]);
const LITRE_UOM_CODES = new Set(["L", "LT", "LTR", "LITRE", "LITRES"]);
const MACHINE_CAPACITY_TOLERANCE = 1.1;

const EMPTY_PROCESS = {
  company_id: "",
  po_type: "MTO",
  prodshade_material_id: "",
  stroke_master_id: "",
  machine_id: "",
  // §138.2 — MTS-only: bypass the Stroke's default-location machine filter
  // and show every MTS machine in the company (exception-case override).
  select_all_mts_machines: false,
  planned_qty_kg: "",
  planned_start_date: "",
  mts_segment_code: "",
  mtest_segment_code: "",
  // MTS Page 3 — captured for the Page 1–6 browser session, not at a later
  // Start Batch click.  Page 6 validates it again during atomic creation.
  production_date: "",
  shift_id: "",
  batch_start_serial: "",
  number_of_batches: "",
  // §136 follow-up (2026-09-08): MTEST has no separate QA_APPROVED step to pick
  // Priority at (QA is the only actor, this Standard-creation IS the approval) —
  // so for MTEST only, Priority is captured right here. Ignored server-side for
  // every other po_type, which still sets Priority later at QA Approve (PR16).
  priority: "NORMAL",
};

const EMPTY_PACKING = {
  company_id: "",
  source_po_type: "MTO",
  material_id: "",
  num_packs: "",
  fill_qty_per_pack: "",
  pm_lines: [],
  // §131.4 item #11 (2026-08-26): PTEST-only — chosen Prodshade+Stroke, since these SKUs'
  // Pack BOM has no SFG row to derive it from (item #10).
  sfg_material_id: "",
  sfg_stroke_master_id: "",
};

const PACKING_ERRORS = {
  PROD_PACK_INVALID: "Company, PO Type and FG SKU are required.",
  PROD_PACK_SKU_INVALID: "Selected material must be an FG SKU.",
  PROD_PACK_CODE_NOT_FOUND: "FG SKU pack code is not configured.",
  PROD_PACK_NO_ACTIVE_BOM: "Active Pack BOM is required before creating a Packing PO.",
  PROD_PACK_BOM_INCOMPLETE: "Pack BOM must have OUTPUT and SFG lines.",
  PROD_PACK_BOM_SLOC_MISSING: "Pack BOM OUTPUT/SFG storage locations are not set.",
  PROD_PACK_FILL_QTY_REQUIRED: "Fill Qty Per Pack is required for this pack code.",
  PROD_PACK_QTY_INVALID: "Could not derive a valid planned quantity from the Pack BOM.",
  PROD_PACK_PM_SLOC_REQUIRED: "Select an issue storage location for every PM line.",
  PROD_PACK_PM_SLOC_INVALID: "PM storage location must be active and mapped to the selected company.",
  PROD_PACK_SUBSTITUTE_NOT_REGISTERED: "Actual material must match a registered Pack BOM alternate group member.",
  PROD_PACK_PM_ONLY: "Only PM materials are allowed in PM lines.",
  PROD_PACK_PM_SHORTAGE: "Stock is short for one or more PM lines.",
  PROD_PACK_SCOPE_VIOLATION: "You do not have access to this company.",
};

function packingFriendly(error) {
  const code = error?.code || error?.message || "";
  return PACKING_ERRORS[code] ?? error?.message ?? "Packing PO create failed.";
}

function companyLabel(company) {
  return [company.company_code, company.company_name].filter(Boolean).join(" - ");
}

function prodshadeLabel(item) {
  const prodCode = item.material?.pace_code || item.pace_code || null;
  const shadeCode = item.material?.external_code || item.external_code || item.material?.shade_code || item.shade_code || null;
  const materialName = item.material?.material_name || item.material_name || null;
  const documentName = item.material?.document_name || item.document_name || null;
  return [prodCode, shadeCode, materialName, documentName]
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
    .join(" - ");
}

function materialLabel(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}

function slocLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

function qtyFmt(value) {
  return formatPreciseNumber(value, "-");
}

function strokeLabel(stroke) {
  const prodshade = stroke.material?.external_code || stroke.material?.shade_code || "Prodshade";
  return `${prodshade} - stroke #${stroke.stroke_number}${stroke.description ? ` - ${stroke.description}` : ""}`;
}

function machineLabel(machine) {
  return [machine.machine_code, machine.machine_name].filter(Boolean).join(" - ");
}

function storageLocationLabel(location) {
  return [location?.code || location?.location_code, location?.name || location?.location_name].filter(Boolean).join(" - ");
}

// MTS spans two segments (IWC=liquid, POWDER=dry) that share one po_type --
// live prod data confirmed (2026-09-18) the Stroke's own base_uom_code is
// the real signal, no manual picker needed: 7 of 8 real MTS strokes are
// base_uom_code='KG' (POWDER, no Liter concept at all), exactly 1 is
// base_uom_code='L' with a real conversion_factor (IWC). Previously this was
// a manual dropdown that (a) required a needless extra click and (b) forced
// EVERY MTS stroke through the Liter-entry+conversion-factor-required path
// regardless of segment, so a genuine POWDER (KG-native) stroke always hit a
// "missing conversion factor" error it should never have needed to clear.
function deriveSegmentCode(poType, mtsStrokeBaseUomCode, mtestSegmentCode) {
  if (poType === "MTO") return "ADMIX";
  if (poType === "HPS") return "HPS";
  if (poType === "INT") return "INT";
  if (poType === "MTS") {
    if (!mtsStrokeBaseUomCode) return "";
    return LITRE_UOM_CODES.has(String(mtsStrokeBaseUomCode).trim().toUpperCase()) ? "IWC" : "POWDER";
  }
  if (poType === "MTEST") return mtestSegmentCode || "";
  return "";
}

function buildOutputReferenceValue(value) {
  return value || "--";
}

export default function ProductionPOCreatePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [processStep, setProcessStep] = useState(1);
  const [processForm, setProcessForm] = useState({ ...EMPTY_PROCESS });
  // Pages 1-6 are one temporary MTS creation session.  It intentionally has
  // no server-side draft/PO id; Page 6 owns the only durable write.
  const [mtsCreationSession, setMtsCreationSession] = useState(null);
  const [mtsPlanOverrides, setMtsPlanOverrides] = useState({}); // { [formulationMaterialId]: rows[] | { actual_material_id } }
  const [packingStep, setPackingStep] = useState(1);
  const [packingForm, setPackingForm] = useState({ ...EMPTY_PACKING });
  // Only used for bomRequired=false (599/000/001) — these pack codes carry no
  // PM lines on the Pack BOM at all, so the user adds them fresh here.
  const [packingManualPmLines, setPackingManualPmLines] = useState([]);
  const [packingGroupModal, setPackingGroupModal] = useState(null);
  const [packingGroupForm, setPackingGroupForm] = useState({ group_name: "", description: "" });
  const [packingMemberModal, setPackingMemberModal] = useState(null);
  const [packingMemberMaterialId, setPackingMemberMaterialId] = useState("");
  const [lineActualMaterialOverrides, setLineActualMaterialOverrides] = useState({});
  const [lineLocationOverrides, setLineLocationOverrides] = useState({});
  const [debouncedCreatePreview, setDebouncedCreatePreview] = useState([]);
  const [batchQtyLiter, setBatchQtyLiter] = useState("");
  // MTS-only Stroke Gate design (2026-09-17 session) — holds the stroke the
  // user just picked from the dropdown when it is NOT the Current Stroke, so
  // the confirm modal can apply it on Confirm or drop it on Cancel without
  // ever touching processForm.stroke_master_id in between.
  const [pendingNonCurrentStroke, setPendingNonCurrentStroke] = useState(null);
  const packingManualTemplateKeyRef = useRef("");

  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const effectiveCompanyId = processForm.company_id || defaultCompanyId;
  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: company.id, label: companyLabel(company) || "Unnamed company" })),
    [companies],
  );

  useEffect(() => {
    if (defaultCompanyId && !processForm.company_id) {
      setProcessForm((current) => ({ ...current, company_id: defaultCompanyId }));
    }
  }, [defaultCompanyId, processForm.company_id]);

  const materialsQ = useMaterialOptionsQuery({ status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT });
  const materialRows = materialsQ.materials ?? [];
  const materialById = useMemo(
    () => new Map(materialRows.map((material) => [material.id, material])),
    [materialRows],
  );
  // §131.2 (2026-08-26): which po_type family this user can actually create here —
  // drives disabling (not removing) PO Type options below, ACL-driven rather than a
  // hardcoded role check (see the backend handler's own comment for why).
  const createCapabilityQ = useQuery({
    queryKey: ["production-create-capability", effectiveCompanyId],
    queryFn: () => getProcessOrderCreateCapability(effectiveCompanyId),
    enabled: Boolean(effectiveCompanyId),
  });
  const canCreateStandardType = createCapabilityQ.data?.standard !== false;
  const canCreateMtest = createCapabilityQ.data?.mtest !== false;
  const processTypeOptions = useMemo(
    () => PROCESS_TYPES.map((type) => ({
      value: type,
      label: type,
      disabled: type === "MTEST" ? !canCreateMtest : !canCreateStandardType,
    })),
    [canCreateMtest, canCreateStandardType],
  );
  const approvedStrokesQ = useQuery({
    queryKey: ["production-create-approved-strokes", effectiveCompanyId, processForm.po_type],
    queryFn: () => listStrokeMasters({
      company_id: effectiveCompanyId || undefined,
      status: "APPROVED",
      usable_for_po_type: processForm.po_type || undefined,
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  const approvedStrokes = useMemo(
    () => (approvedStrokesQ.data ?? []).map((stroke) => ({
      ...stroke,
      material_id: stroke.prodshade_material_id,
      material: materialById.get(stroke.prodshade_material_id) ?? stroke.material ?? null,
    })),
    [approvedStrokesQ.data, materialById],
  );

  const prodshadeOptions = useMemo(() => {
    const seenApproved = new Set();
    const approvedOptions = [];
    approvedStrokes.forEach((item) => {
      const materialId = String(item.material_id || "");
      if (!materialId || seenApproved.has(materialId)) return;
      seenApproved.add(materialId);
      approvedOptions.push({ value: materialId, label: prodshadeLabel(item) || "Material" });
    });

    return approvedOptions;
  }, [approvedStrokes]);

  const selectedMaterial = materialById.get(processForm.prodshade_material_id) ?? null;
  const machineRequired = ["MTO", "HPS", "MTS", "INT"].includes(processForm.po_type);

  const strokesQ = useQuery({
    queryKey: ["production-create-strokes", effectiveCompanyId, processForm.po_type, processForm.prodshade_material_id],
    queryFn: () => listStrokeMasters({
      company_id: effectiveCompanyId || undefined,
      material_id: processForm.prodshade_material_id || undefined,
      status: "APPROVED",
      usable_for_po_type: processForm.po_type || undefined,
    }),
    enabled: Boolean(effectiveCompanyId && processForm.prodshade_material_id),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  // MTS-only (design session 2026-09-17) — Stroke Gate defaults to this
  // (company, Prodshade)'s Current Stroke (erp_production.mts_current_stroke,
  // auto-set when exactly one APPROVED stroke exists for the Prodshade) and
  // flags it in the dropdown; picking any other stroke needs an explicit
  // confirm below. MTO/HPS/MTEST are completely untouched by this block.
  const isMts = processForm.po_type === "MTS";
  const mtsCurrentStrokeQ = useQuery({
    queryKey: ["production-create-mts-current-stroke", effectiveCompanyId],
    queryFn: () => listMtsCurrentStroke(effectiveCompanyId),
    // fetchProd already unwraps to { stroke_numbers, rows } directly (no
    // `pagination` key on this response) — do NOT read `.data` again here
    // (11-bug #15's double-unwrap class), same as StrokeMasterPage.jsx's own
    // mtsCurrentStrokeQ.
    select: (d) => d ?? { stroke_numbers: [], rows: [] },
    enabled: Boolean(effectiveCompanyId && isMts),
  });
  const mtsCurrentStrokeNumber = useMemo(() => {
    if (!isMts || !processForm.prodshade_material_id) return null;
    const row = (mtsCurrentStrokeQ.data?.rows ?? [])
      .find((r) => String(r.prodshade_material_id) === String(processForm.prodshade_material_id));
    if (!row) return null;
    const currentEntry = Object.entries(row.strokes ?? {}).find(([, info]) => info?.current);
    return currentEntry ? currentEntry[0] : null;
  }, [mtsCurrentStrokeQ.data, isMts, processForm.prodshade_material_id]);

  const strokeOptions = useMemo(
    () => (strokesQ.data ?? [])
      .map((stroke) => {
        const isCurrent = isMts
          && mtsCurrentStrokeNumber !== null
          && String(stroke.stroke_number) === String(mtsCurrentStrokeNumber);
        return { value: stroke.id, label: isCurrent ? `${strokeLabel(stroke)} — Current` : strokeLabel(stroke) };
      }),
    [strokesQ.data, isMts, mtsCurrentStrokeNumber],
  );

  // Auto-default to the Current Stroke once both queries have landed —
  // stroke_master_id resets to "" whenever prodshade_material_id changes
  // (updateProcess below), so this only ever fires once per fresh Prodshade
  // pick, never overriding a choice the user already made.
  useEffect(() => {
    if (!isMts || processForm.stroke_master_id || !mtsCurrentStrokeNumber) return;
    const match = (strokesQ.data ?? []).find((stroke) => String(stroke.stroke_number) === String(mtsCurrentStrokeNumber));
    if (match) updateProcess("stroke_master_id", match.id);
  }, [isMts, processForm.stroke_master_id, mtsCurrentStrokeNumber, strokesQ.data]);

  const strokeDetailQ = useQuery({
    queryKey: ["production-create-stroke-detail", processForm.stroke_master_id],
    queryFn: () => getStrokeMaster(processForm.stroke_master_id),
    enabled: Boolean(processForm.stroke_master_id),
  });
  const derivedSegmentCode = deriveSegmentCode(
    processForm.po_type,
    strokeDetailQ.data?.base_uom_code,
    processForm.mtest_segment_code,
  );

  // §138.2 — normal case: for MTS only, filter the Machine dropdown down to
  // the Stroke's own declared default SFG location (§138.1 mapping). The
  // "Select all MTS machines" checkbox bypasses this (§138.4 exception case)
  // and shows every MTS machine in the company regardless of location.
  const strokeDefaultLocationId = strokeDetailQ.data?.default_storage_location_id || null;
  const machineLocationFilterId = isMts && !processForm.select_all_mts_machines
    ? strokeDefaultLocationId
    : null;
  const machinesQ = useQuery({
    queryKey: ["production-create-machines", effectiveCompanyId, processForm.po_type, machineLocationFilterId],
    queryFn: () => listMachines({
      company_id: effectiveCompanyId,
      active: true,
      po_type: processForm.po_type || undefined,
      storage_location_id: machineLocationFilterId || undefined,
    }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  // §108.2 item 3 — only the IWC segment of MTS (base_uom_code=Litre) enters
  // Batch Qty in Liter, RM calc needs KG. POWDER-segment MTS (base_uom_code=KG,
  // 7 of 8 real MTS strokes) is KG-native and never needs this at all -- gating
  // on po_type==="MTS" alone (fixed 2026-09-18) wrongly forced every POWDER
  // stroke through this Liter-entry path and a "conversion factor missing"
  // error it could never legitimately clear.
  // Source of truth: the selected Stroke's own conversion_uom_code/conversion_factor
  // (§83.3 — "Conversion Factor = KG per Litre (density-based)", captured at Stroke
  // Master create/approve, StrokeMasterPage.jsx). By processStep 3 the Stroke (step 2)
  // is already selected, so strokeDetailQ is already loaded — no separate lookup needed.
  const isMtsIwc = processForm.po_type === "MTS" && derivedSegmentCode === "IWC";
  const strokeConversionFactor = Number(strokeDetailQ.data?.conversion_factor);
  const literToKgFactor = isMtsIwc
    && strokeDetailQ.data?.conversion_uom_code
    && Number.isFinite(strokeConversionFactor)
    && strokeConversionFactor > 0
    ? strokeConversionFactor
    : null;
  const literConversionMissing = isMtsIwc
    && Boolean(processForm.stroke_master_id)
    && !strokeDetailQ.isLoading
    && literToKgFactor === null;
  const machineOptions = useMemo(
    () => (machinesQ.data ?? []).map((machine) => ({ value: machine.id, label: machineLabel(machine) || "Machine" })),
    [machinesQ.data],
  );
  const selectedMachine = useMemo(
    () => (machinesQ.data ?? []).find((machine) => machine.id === processForm.machine_id) ?? null,
    [machinesQ.data, processForm.machine_id],
  );
  const machineCapacityCheck = useMemo(() => {
    if (!machineRequired || !processForm.machine_id) return { blocked: false, message: "" };
    const capacity = Number(selectedMachine?.capacity_per_batch ?? 0);
    const uom = String(selectedMachine?.capacity_uom_code ?? "").trim().toUpperCase();
    if (!Number.isFinite(capacity) || capacity <= 0 || !uom) {
      return { blocked: true, message: "Selected machine has no valid batch capacity. Configure Capacity and UOM in Machine Master." };
    }
    let capacityKg = null;
    if (KG_UOM_CODES.has(uom)) capacityKg = capacity;
    if (LITRE_UOM_CODES.has(uom) && literToKgFactor) capacityKg = capacity * literToKgFactor;
    if (!capacityKg) {
      return { blocked: true, message: "Machine capacity UOM must be KG, or Litre with a valid Stroke conversion factor." };
    }
    const maximumKg = capacityKg * MACHINE_CAPACITY_TOLERANCE;
    const plannedKg = Number(processForm.planned_qty_kg || 0);
    if (plannedKg > maximumKg + 0.000001) {
      return { blocked: true, message: `Batch Size ${formatPreciseNumber(plannedKg, "0.###")} KG exceeds the allowed maximum ${formatPreciseNumber(maximumKg, "0.###")} KG (Machine Capacity ${capacity} ${uom} + 10%).` };
    }
    return { blocked: false, message: `Maximum allowed: ${formatPreciseNumber(maximumKg, "0.###")} KG (Machine Capacity ${capacity} ${uom} + 10%).` };
  }, [literToKgFactor, machineRequired, processForm.machine_id, processForm.planned_qty_kg, selectedMachine]);

  // MTS Page 3 "Shift" — company-wise, inline-create-as-you-go (2026-09-17 lock).
  const [shiftCreateName, setShiftCreateName] = useState("");
  const [shiftCreating, setShiftCreating] = useState(false);
  const shiftsQ = useQuery({
    queryKey: ["production-create-shifts", effectiveCompanyId],
    queryFn: () => listShifts({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId && isMts),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const shiftOptions = useMemo(
    () => (shiftsQ.data ?? []).map((shift) => ({ value: shift.id, label: shift.shift_name })),
    [shiftsQ.data],
  );

  async function handleCreateShiftInline() {
    const shiftName = shiftCreateName.trim();
    if (!shiftName || !effectiveCompanyId) return;
    setShiftCreating(true);
    try {
      const created = await createShift({ company_id: effectiveCompanyId, shift_name: shiftName });
      await qc.invalidateQueries({ queryKey: ["production-create-shifts", effectiveCompanyId] });
      updateProcess("shift_id", created?.id ?? created?.data?.id ?? "");
      setShiftCreateName("");
      toast("Shift added.");
    } catch (error) {
      toast(error.message || "Shift create failed.", "error");
    } finally {
      setShiftCreating(false);
    }
  }

  // MTS Page 3 "Batch Range" — live duplicate-check, debounced as the user
  // types Start Batch Number / Number of Batches. Advisory only — the Page-6
  // atomic create re-checks server-side before it claims the range.
  const [debouncedBatchRange, setDebouncedBatchRange] = useState({ start: "", count: "" });
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedBatchRange({
        start: processForm.batch_start_serial,
        count: processForm.number_of_batches,
      });
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [processForm.batch_start_serial, processForm.number_of_batches]);

  const mtsBatchRangeQ = useQuery({
    queryKey: [
      "production-create-mts-batch-range-check",
      effectiveCompanyId,
      processForm.prodshade_material_id,
      debouncedBatchRange.start,
      debouncedBatchRange.count,
    ],
    queryFn: () => checkMtsBatchRange({
      company_id: effectiveCompanyId,
      prodshade_material_id: processForm.prodshade_material_id,
      start_serial: debouncedBatchRange.start,
      count: debouncedBatchRange.count,
    }),
    enabled: Boolean(
      isMts
      && effectiveCompanyId
      && processForm.prodshade_material_id
      && Number(debouncedBatchRange.start) > 0
      && Number(debouncedBatchRange.count) > 0,
    ),
  });
  const mtsBatchRangeHasDuplicate = mtsBatchRangeQ.data?.has_duplicate === true;

  const storageLocationQ = useStorageLocationOptionsQuery(
    { company_id: effectiveCompanyId || undefined },
    { enabled: Boolean(effectiveCompanyId) },
  );
  const storageLocationOptions = useMemo(
    () => (storageLocationQ.storageLocations ?? []).map((location) => ({
      value: location.id,
      label: storageLocationLabel(location) || "Storage Location",
    })),
    [storageLocationQ.storageLocations],
  );
  const segmentLocationsQ = useQuery({
    queryKey: ["production-create-segment-locations", effectiveCompanyId],
    queryFn: () => listSegmentLocations({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  const activeSegmentLocation = useMemo(
    () => (segmentLocationsQ.data ?? []).find((row) => row.segment_code === derivedSegmentCode && row.active !== false) ?? null,
    [derivedSegmentCode, segmentLocationsQ.data],
  );

  // ── Packing PO tab ──────────────────────────────────────────────────────
  const effectivePackingCompanyId = packingForm.company_id || defaultCompanyId;
  const packingPoType = packingPoTypeForProcessType(packingForm.source_po_type);

  useEffect(() => {
    if (defaultCompanyId && !packingForm.company_id) {
      setPackingForm((current) => ({ ...current, company_id: defaultCompanyId }));
    }
  }, [defaultCompanyId, packingForm.company_id]);

  const packingActiveBomsQ = useQuery({
    queryKey: ["packing-create-active-boms", effectivePackingCompanyId],
    queryFn: () => listPackBoms({ company_id: effectivePackingCompanyId, status: "ACTIVE" }),
    enabled: Boolean(effectivePackingCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  // §131.4 follow-up (2026-08-27): listPackBoms above has no po_type/pack_type filter at
  // all, so it always returned EVERY ACTIVE Pack BOM SKU regardless of source_po_type --
  // the 5 MTEST sample SKUs leaked into the MTO/HPS/MTS dropdown and vice versa. Fetch the
  // MTEST set separately (same handler Plan Feed uses, reached via a PROD_PO_CREATE-gated
  // route since Packing PO Create doesn't require Plan Feed access) and split on it.
  const mtestSkusForPackingQ = useQuery({
    queryKey: ["packing-create-mtest-skus", effectivePackingCompanyId],
    queryFn: () => listMtestSkusForPacking({ company_id: effectivePackingCompanyId }),
    enabled: Boolean(effectivePackingCompanyId),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const mtestSkuIdSet = useMemo(
    () => new Set((mtestSkusForPackingQ.data ?? []).map((s) => s.id)),
    [mtestSkusForPackingQ.data],
  );
  const isPackingMtestSource = packingForm.source_po_type === "MTEST";
  const packingSkuOptions = useMemo(() => {
    if (isPackingMtestSource) {
      return (mtestSkusForPackingQ.data ?? []).map((sku) => ({ value: sku.id, label: materialLabel(sku) || "SKU" }));
    }
    return (packingActiveBomsQ.data ?? [])
      .filter((bom) => !mtestSkuIdSet.has(bom.sku_material_id))
      .map((bom) => ({ value: bom.sku_material_id, label: materialLabel(bom.sku) || "SKU" }));
  }, [isPackingMtestSource, mtestSkusForPackingQ.data, packingActiveBomsQ.data, mtestSkuIdSet]);
  const selectedPackingBomRow = useMemo(
    () => (packingActiveBomsQ.data ?? []).find((bom) => bom.sku_material_id === packingForm.material_id) ?? null,
    [packingActiveBomsQ.data, packingForm.material_id],
  );
  const packingBomDetailQ = useQuery({
    queryKey: ["packing-create-bom-detail", selectedPackingBomRow?.id],
    queryFn: () => getPackBom(selectedPackingBomRow.id),
    enabled: Boolean(selectedPackingBomRow?.id),
  });
  const packingBom = packingBomDetailQ.data ?? null;
  const packingSku = packingBom?.sku ?? selectedPackingBomRow?.sku ?? null;
  const packingBomLines = packingBom?.lines ?? [];
  const packingOutputLine = packingBomLines.find((line) => line.line_type === "OUTPUT") ?? null;
  const packingSfgLine = packingBomLines.find((line) => line.line_type === "SFG") ?? null;
  const packingPmBomLines = useMemo(
    () => packingBomLines.filter((line) => line.line_type === "INPUT"),
    [packingBomLines],
  );

  const packCodesQ = useQuery({
    queryKey: ["packing-create-pack-codes"],
    queryFn: () => listPackCodes(),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const packingBomRequired = useMemo(() => {
    const packCode = (packCodesQ.data ?? []).find((pc) => pc.pack_code === packingSku?.pack_code);
    return packCode ? packCode.bom_required !== false : true;
  }, [packCodesQ.data, packingSku?.pack_code]);
  // §131.4 item #11: the 5 MTEST sample SKUs have no SFG row on their Pack BOM at all
  // (item #10) — this SKU family is identified by pack_type, not just bom_required
  // (599/000 are also bom_required=false but DO have a real fixed Prodshade/SFG line).
  const isMtestPackingSku = useMemo(() => {
    const packCode = (packCodesQ.data ?? []).find((pc) => pc.pack_code === packingSku?.pack_code);
    return String(packCode?.pack_type || "").toUpperCase() === "MTEST";
  }, [packCodesQ.data, packingSku?.pack_code]);
  const mtestSfgOptionsQ = useQuery({
    queryKey: ["packing-create-mtest-sfg-options", effectivePackingCompanyId],
    queryFn: () => listMtestSfgProdshadeOptions(effectivePackingCompanyId),
    enabled: Boolean(effectivePackingCompanyId && isMtestPackingSku),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const mtestSfgOptions = useMemo(
    () => (mtestSfgOptionsQ.data ?? []).map((row) => ({
      value: `${row.prodshade_material_id}|${row.stroke_master_id}`,
      label: `${materialLabel(row.prodshade) || "Prodshade"} — Stroke ${row.stroke_number || "--"} (${formatStockQty(row.available_qty)} KG available)`,
    })),
    [mtestSfgOptionsQ.data],
  );
  // §131.4 item #11: fixed PKT->KG factor already set on the SKU at creation time
  // (item #1) — used here only to preview "Planned SFG Qty" on this page; the actual
  // fill qty is re-derived authoritatively server-side at submit (never trusted from
  // the client).
  const mtestPackingConversionQ = useQuery({
    queryKey: ["packing-create-mtest-conversion", packingForm.material_id],
    queryFn: () => listMaterialUomConversions(packingForm.material_id),
    enabled: Boolean(packingForm.material_id && isMtestPackingSku),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const mtestFixedFillQtyPerPack = useMemo(() => {
    const row = (mtestPackingConversionQ.data ?? []).find(
      (r) => r.from_uom_code === "PKT" && r.to_uom_code === "KG" && r.variable_conversion === false,
    );
    return row ? Number(row.conversion_factor || 0) : 0;
  }, [mtestPackingConversionQ.data]);

  const packingStorageQ = useQuery({
    queryKey: ["packing-create-storage-locations", effectivePackingCompanyId],
    queryFn: () => listStorageLocations({ company_id: effectivePackingCompanyId, is_active: true }),
    enabled: Boolean(effectivePackingCompanyId),
    select: (data) => data?.data ?? data ?? [],
  });
  const packingStorageOptions = useMemo(
    () => (packingStorageQ.data ?? []).map((location) => ({ value: location.id, label: slocLabel(location) || "Storage Location" })),
    [packingStorageQ.data],
  );

  // Pack BOM's own material_group embed has no members list (pack_bom.handlers.ts's
  // getGroupMapByIds only returns id/group_code/group_name) — fetch the full
  // group+members list separately, same source the old alternate-group UI used.
  const packingGroupsQ = useQuery({
    queryKey: ["packing-create-material-groups", effectivePackingCompanyId],
    queryFn: () => listMaterialCategoryGroups(effectivePackingCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    enabled: Boolean(effectivePackingCompanyId),
  });
  const packingGroupById = useMemo(
    () => new Map((packingGroupsQ.data ?? []).map((group) => [group.id, group])),
    [packingGroupsQ.data],
  );

  const packingNumPacks = Number(packingForm.num_packs || 0);
  const packingFillQtyPerPack = Number(packingForm.fill_qty_per_pack || 0);
  const packingSfgQtyPerPack = isMtestPackingSku
    ? mtestFixedFillQtyPerPack
    : (packingBomRequired ? Number(packingSfgLine?.qty || 0) : packingFillQtyPerPack);
  const packingPlannedQtyKg = packingSfgQtyPerPack * packingNumPacks;

  // Fixed Pack BOM types (bomRequired=true): PM material/dosage/alternate/group
  // come from the Pack BOM, only storage location (and an optional validated
  // substitute) is user-picked per line.
  const packingBomPmPreviewLines = useMemo(
    () => packingPmBomLines.map((line) => {
      const override = packingForm.pm_lines.find((pm) => pm.material_id === line.material_id);
      const group = packingGroupById.get(line.material_group_id) ?? null;
      const alternateOptions = (group?.members ?? [])
        .filter((member) => String(member.material_id) !== String(line.material_id))
        .map((member) => ({ value: member.material_id, label: materialLabel(member.material) || "Registered alternate" }));
      return {
        key: line.material_id,
        material_id: line.material_id,
        material_label: materialLabel(line.material) || "--",
        dosage_per_pack: Number(line.qty ?? 0),
        standard_qty: Number(line.qty ?? 0) * packingNumPacks,
        storage_location_id: override?.storage_location_id || "",
        actual_material_id: override?.actual_material_id || "",
        effective_material_id: override?.actual_material_id || line.material_id,
        has_alternate: Boolean(line.has_alternate),
        alternate_options: alternateOptions,
        group_label: group?.group_name || "",
      };
    }),
    [packingForm.pm_lines, packingGroupById, packingNumPacks, packingPmBomLines],
  );

  const packingBomPmTemplateLines = useMemo(
    () => packingPmBomLines.map((line) => ({
      material_id: line.material_id || "",
      dosage_per_pack: line.qty == null ? "" : String(line.qty),
      storage_location_id: "",
      has_alternate: Boolean(line.has_alternate),
      material_group_id: line.material_group_id || "",
    })),
    [packingPmBomLines],
  );
  const packingManualTemplateKey = useMemo(
    () => `${selectedPackingBomRow?.id || ""}::${packingBomPmTemplateLines.map((line) => [
      line.material_id || "",
      line.dosage_per_pack || "",
      line.material_group_id || "",
      line.has_alternate ? "1" : "0",
    ].join("|")).join("~")}`,
    [packingBomPmTemplateLines, selectedPackingBomRow?.id],
  );

  // Non-fixed pack codes still support ad-hoc PM lines, but they now start
  // from the saved Pack BOM material template instead of an empty list.
  const packingPmMaterialsQ = useQuery({
    queryKey: ["packing-create-pm-materials"],
    queryFn: () => listMaterials({ material_type: "PM", limit: 500 }),
    select: (data) => data?.data ?? [],
  });
  const packingPmMaterialOptions = useMemo(
    () => (packingPmMaterialsQ.data ?? []).map((material) => ({ value: material.id, label: materialLabel(material) || "PM Material" })),
    [packingPmMaterialsQ.data],
  );
  const packingManualPmPreviewLines = useMemo(
    () => packingManualPmLines.map((line, index) => {
      const group = packingGroupById.get(line.material_group_id) ?? null;
      const material = (packingPmMaterialsQ.data ?? []).find((m) => m.id === line.material_id) ?? null;
      const dosagePerPack = Number(line.dosage_per_pack || 0);
      return {
        key: index,
        index,
        material_id: line.material_id,
        material_label: materialLabel(material) || "",
        dosage_per_pack: dosagePerPack,
        standard_qty: dosagePerPack * packingNumPacks,
        storage_location_id: line.storage_location_id || "",
        actual_material_id: "",
        effective_material_id: line.material_id,
        has_alternate: Boolean(line.has_alternate),
        material_group_id: line.material_group_id || "",
        group_label: group?.group_name || "",
      };
    }),
    [packingGroupById, packingManualPmLines, packingNumPacks, packingPmMaterialsQ.data],
  );

  useEffect(() => {
    if (!selectedPackingBomRow?.id) {
      packingManualTemplateKeyRef.current = "";
      setPackingManualPmLines([]);
      return;
    }
    if (packingBomRequired) {
      packingManualTemplateKeyRef.current = `FIXED::${selectedPackingBomRow.id}`;
      return;
    }
    if (packingManualTemplateKeyRef.current !== packingManualTemplateKey) {
      packingManualTemplateKeyRef.current = packingManualTemplateKey;
      setPackingManualPmLines(packingBomPmTemplateLines);
    }
  }, [packingBomPmTemplateLines, packingBomRequired, packingManualTemplateKey, selectedPackingBomRow?.id]);

  const packingEffectivePmLines = packingBomRequired ? packingBomPmPreviewLines : packingManualPmPreviewLines;

  const packingAvailabilityNeeds = useMemo(
    () => packingEffectivePmLines
      .filter((line) => line.effective_material_id && line.storage_location_id && line.standard_qty > 0)
      .map((line) => ({ material_id: line.effective_material_id, storage_location_id: line.storage_location_id, qty: line.standard_qty })),
    [packingEffectivePmLines],
  );
  const packingAvailabilityPreviewQ = useQuery({
    queryKey: ["packing-create-availability-preview", effectivePackingCompanyId, packingAvailabilityNeeds],
    queryFn: () => availabilityPreviewPackingOrder({
      company_id: effectivePackingCompanyId,
      needs: JSON.stringify(packingAvailabilityNeeds),
    }),
    enabled: packingStep === 2 && Boolean(effectivePackingCompanyId) && packingAvailabilityNeeds.length > 0,
    select: (data) => data?.data ?? data ?? [],
  });
  const packingAvailabilityByKey = useMemo(
    () => new Map((packingAvailabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [packingAvailabilityPreviewQ.data],
  );
  const packingPmRowsWithAvailability = useMemo(
    () => packingEffectivePmLines.map((line) => {
      const row = line.effective_material_id && line.storage_location_id
        ? packingAvailabilityByKey.get(`${line.effective_material_id}::${line.storage_location_id}`) ?? null
        : null;
      return { ...line, available_qty: row ? Number(row.available_qty ?? 0) : null, short: row ? Number(row.short ?? 0) : 0 };
    }),
    [packingAvailabilityByKey, packingEffectivePmLines],
  );
  const packingHasShortage = packingPmRowsWithAvailability.some((line) => line.short > 0);
  const packingMissingPmSloc = packingEffectivePmLines.some((line) => !line.storage_location_id);
  const packingMissingManualMaterial = !packingBomRequired && packingManualPmLines.some((line) => !line.material_id);

  const strokeLines = Array.isArray(strokeDetailQ.data?.lines) ? strokeDetailQ.data.lines : [];
  const strokePreviewRows = useMemo(
    () => {
      // §131.1 (2026-08-26): MTEST's Process PO lifecycle now matches MTO/HPS/MTS
      // exactly, including real RM/INT lines derived from the Stroke's own dosage
      // recipe (createProcessOrderHandler already derives these generically,
      // no po_type branch) -- this used to `return []` for MTEST under the old
      // pre-redesign assumption ("no stroke/BOM"), which only hid the preview/
      // availability-check table, it never affected what actually got created.
      return strokeLines.map((line) => {
      const selectedStorageLocationId = lineLocationOverrides[line.material_id] || line.default_storage_location_id || "";
      // dosage_pct/batch qty are never round binary fractions (e.g. 60.079), so the raw
      // product carries IEEE-754 residue (6007.900000000001). Round to 6dp -- the same
      // precision ceiling PRODUCTION_DECIMAL_STEP already uses for entered values -- since
      // this is a computed quantity, not something the user typed (see formatSum's note).
      const rawPlannedQty = (Number(line.dosage_pct ?? 0) / 100) * Number(processForm.planned_qty_kg || 0);
      const plannedQty = Number(rawPlannedQty.toFixed(6));
      const alternateOptions = [];
      const seenAlternateIds = new Set();

      if (line.alternate_material_id) {
        const alternateId = String(line.alternate_material_id);
        seenAlternateIds.add(alternateId);
        alternateOptions.push({
          value: alternateId,
          label: materialLabel(line.alternate_material) || "Registered alternate",
        });
      }

      for (const member of line.material_group?.members ?? []) {
        const memberId = String(member.material_id ?? "");
        if (!memberId || memberId === String(line.material_id) || seenAlternateIds.has(memberId)) continue;
        seenAlternateIds.add(memberId);
        alternateOptions.push({
          value: memberId,
          label: materialLabel(member.material) || memberId,
        });
      }

      return {
        key: line.id || line.material_id,
        material_id: line.material_id,
        material_type: String(line.line_material_type || line.material?.material_type || "RM").toUpperCase() === "INT" ? "INT" : "RM",
        material_label: materialLabel(line.material) || "--",
        dosage_pct: Number(line.dosage_pct ?? 0),
        actual_material_id: lineActualMaterialOverrides[line.material_id] || "",
        registered_alternate_material_options: alternateOptions,
        material_group_label: line.material_group?.group_name || "",
        default_storage_location_id: line.default_storage_location_id || "",
        storage_location_id: selectedStorageLocationId,
        standard_qty: plannedQty,
      };
      });
    },
    [lineActualMaterialOverrides, lineLocationOverrides, processForm.planned_qty_kg, strokeLines],
  );

  useEffect(() => {
    setLineActualMaterialOverrides({});
    setLineLocationOverrides({});
  }, [processForm.company_id, processForm.po_type, processForm.prodshade_material_id, processForm.stroke_master_id]);

  useEffect(() => {
    setBatchQtyLiter("");
  }, [processForm.po_type, processForm.prodshade_material_id, processForm.stroke_master_id]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedCreatePreview(
        strokePreviewRows
          .filter((row) => row.storage_location_id || row.actual_material_id)
          .map((row) => ({
            material_id: row.material_id,
            actual_material_id: row.actual_material_id || undefined,
            storage_location_id: row.storage_location_id,
          })),
      );
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [strokePreviewRows]);

  const availabilityPreviewQ = useQuery({
    queryKey: [
      "production-create-availability-preview",
      effectiveCompanyId,
      processForm.stroke_master_id,
      processForm.planned_qty_kg,
      debouncedCreatePreview,
    ],
    queryFn: () => availabilityPreviewProcessOrder({
      company_id: effectiveCompanyId,
      stroke_master_id: processForm.stroke_master_id,
      planned_qty: processForm.planned_qty_kg,
      overrides: debouncedCreatePreview,
    }),
    // MTS has no Material Table / short-stock-block on this page at all
    // (moves to Page 4's machine-bucket-aware check instead) -- this preview
    // is MTO/HPS/INT/MTEST-only, same as the up-front create-time check it
    // mirrors (fixed 2026-09-18 to also skip MTS).
    enabled: Boolean(
      !isMts
      && effectiveCompanyId
      && processForm.stroke_master_id
      && Number(processForm.planned_qty_kg || 0) > 0,
    ),
  });

  const availabilityByKey = useMemo(
    () => new Map((availabilityPreviewQ.data ?? []).map((row) => [`${row.material_id}::${row.storage_location_id}`, row])),
    [availabilityPreviewQ.data],
  );

  const previewRowsWithAvailability = useMemo(
    () => strokePreviewRows.map((row, index) => {
      const previewMaterialId = row.actual_material_id || row.material_id;
      const availability = row.storage_location_id
        ? availabilityByKey.get(`${previewMaterialId}::${row.storage_location_id}`) ?? null
        : null;
      const availableQty = availability ? Number(availability.available_qty ?? 0) : null;
      const isShort = availability ? availableQty < row.standard_qty : false;
      return {
        ...row,
        line_no: index + 1,
        available_qty: availableQty,
        is_short: isShort,
      };
    }),
    [availabilityByKey, strokePreviewRows],
  );

  const shortLineNumbers = useMemo(
    () => previewRowsWithAvailability.filter((row) => row.is_short).map((row) => row.line_no),
    [previewRowsWithAvailability],
  );

  const outputStorageLocation = strokeDetailQ.data?.default_storage_location
    || activeSegmentLocation?.shopfloor_sloc
    || null;

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  function resetProcess(next = {}) {
    setProcessForm({ ...EMPTY_PROCESS, ...next });
    setProcessStep(1);
    setLineActualMaterialOverrides({});
    setLineLocationOverrides({});
    setShiftCreateName("");
  }

  function updateProcess(field, value) {
    setProcessForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "company_id") {
        next.prodshade_material_id = "";
        next.stroke_master_id = "";
        next.machine_id = "";
        next.planned_qty_kg = "";
        next.planned_start_date = "";
        next.mts_segment_code = "";
        next.mtest_segment_code = "";
        next.production_date = "";
        next.shift_id = "";
        next.batch_start_serial = "";
        next.number_of_batches = "";
      }
      if (field === "po_type") {
        next.prodshade_material_id = "";
        next.stroke_master_id = "";
        next.machine_id = "";
        next.mts_segment_code = "";
        next.mtest_segment_code = "";
        next.planned_qty_kg = "";
        next.production_date = "";
        next.shift_id = "";
        next.batch_start_serial = "";
        next.number_of_batches = "";
      }
      if (field === "prodshade_material_id") {
        next.stroke_master_id = "";
        next.batch_start_serial = "";
        next.number_of_batches = "";
      }
      return next;
    });
    if (field === "company_id" || field === "po_type" || field === "prodshade_material_id") {
      setProcessStep(1);
    }
  }

  function updatePacking(field, value) {
    setPackingForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "company_id" || field === "source_po_type") {
        next.material_id = "";
        next.num_packs = "";
        next.fill_qty_per_pack = "";
        next.pm_lines = [];
        setPackingStep(1);
        setPackingManualPmLines([]);
      }
      if (field === "material_id") {
        next.num_packs = "";
        next.fill_qty_per_pack = "";
        next.pm_lines = [];
        next.sfg_material_id = "";
        next.sfg_stroke_master_id = "";
        setPackingManualPmLines([]);
      }
      return next;
    });
  }

  function addPackingManualPmLine() {
    setPackingManualPmLines((current) => [
      ...current,
      { material_id: "", dosage_per_pack: "", storage_location_id: "", has_alternate: false, material_group_id: "" },
    ]);
  }

  function updatePackingManualPmLine(index, patch) {
    setPackingManualPmLines((current) => current.map((line, idx) => (idx === index ? { ...line, ...patch } : line)));
  }

  function removePackingManualPmLine(index) {
    setPackingManualPmLines((current) => current.filter((_, idx) => idx !== index));
  }

  function openPackingCreateGroupModal(onCreated) {
    setPackingGroupForm({ group_name: "", description: "" });
    setPackingGroupModal({ onCreated });
  }

  async function handlePackingCreateGroup() {
    if (!packingGroupForm.group_name.trim()) {
      toast("Group name required.", "error");
      return;
    }
    if (!effectivePackingCompanyId) {
      toast("Select a company first.", "error");
      return;
    }
    try {
      const res = await createMaterialCategoryGroup({ ...packingGroupForm, company_id: effectivePackingCompanyId });
      const newGroup = res?.data ?? res;
      await qc.invalidateQueries({ queryKey: ["packing-create-material-groups"] });
      packingGroupModal?.onCreated?.(newGroup.id);
      setPackingGroupModal(null);
      toast("Material group created.");
    } catch (error) {
      toast(packingFriendly(error), "error");
    }
  }

  async function handlePackingAddMember() {
    if (!packingMemberMaterialId) {
      toast("Select a material first.", "error");
      return;
    }
    try {
      await addMaterialCategoryMember({ group_id: packingMemberModal, material_id: packingMemberMaterialId });
      await qc.invalidateQueries({ queryKey: ["packing-create-material-groups"] });
      setPackingMemberModal(null);
      setPackingMemberMaterialId("");
      toast("Member added.");
    } catch (error) {
      toast(packingFriendly(error), "error");
    }
  }

  function updatePackingPmLine(materialId, patch) {
    setPackingForm((current) => {
      const existing = current.pm_lines.find((line) => line.material_id === materialId) ?? { material_id: materialId };
      const rest = current.pm_lines.filter((line) => line.material_id !== materialId);
      return { ...current, pm_lines: [...rest, { ...existing, ...patch, material_id: materialId }] };
    });
  }

  function resetPacking() {
    setPackingForm({ ...EMPTY_PACKING, company_id: defaultCompanyId || "" });
    setPackingStep(1);
    setPackingManualPmLines([]);
  }

  function handlePackingStepOneNext() {
    if (!effectivePackingCompanyId || !packingForm.source_po_type || !packingForm.material_id) {
      toast("Company, PO Type and FG SKU are required.", "error");
      return;
    }
    if (!packingBom) {
      toast("Active Pack BOM not loaded for this SKU.", "error");
      return;
    }
    setPackingStep(2);
  }

  function handleStepOneNext() {
    if (!effectiveCompanyId || !processForm.po_type || !processForm.prodshade_material_id) {
      toast("Company, PO Type, and Material are required.", "error");
      return;
    }
    setProcessStep(2);
  }

  function handleStepTwoNext() {
    if (!processForm.stroke_master_id) {
      toast("Stroke is required for this Process PO type.", "error");
      return;
    }
    if (machineCapacityCheck.blocked) {
      toast(machineCapacityCheck.message, "error");
      return;
    }
    if (!isMts && processForm.planned_start_date && !isManualDocumentDateWithinPastWindow(processForm.planned_start_date)) {
      toast(MANUAL_PAST_DATE_WINDOW_MESSAGE, "error");
      return;
    }
    setProcessStep(3);
  }

  async function handleCreateProcess(event) {
    event.preventDefault();

    if (!effectiveCompanyId || !processForm.prodshade_material_id || !processForm.planned_qty_kg || !derivedSegmentCode) {
      toast("Company, Material, Segment, and Batch Size are required.", "error");
      return;
    }
    if (machineRequired && !processForm.machine_id) {
      toast("Machine is required for this Process PO type.", "error");
      return;
    }
    if (!processForm.stroke_master_id) {
      toast("Stroke is required for this Process PO type.", "error");
      return;
    }
    if (!isMts && shortLineNumbers.length > 0) {
      toast(`Create is blocked. Short stock on line(s): ${shortLineNumbers.join(", ")}.`, "error");
      return;
    }
    if (isMts) {
      if (!processForm.production_date || !isProductionDateWithinWindow(processForm.production_date)) {
        toast(PRODUCTION_DATE_WINDOW_MESSAGE, "error");
        return;
      }
      if (!processForm.shift_id) {
        toast("Shift is required.", "error");
        return;
      }
      if (!(Number(processForm.batch_start_serial) > 0) || !(Number(processForm.number_of_batches) > 0)) {
        toast("Start Batch Number and Number of Batches are required.", "error");
        return;
      }
      if (mtsBatchRangeHasDuplicate) {
        toast("One or more batch numbers in this range already exist. Change Start Batch Number or Number of Batches.", "error");
        return;
      }
    }

    const payload = {
        company_id: effectiveCompanyId,
        po_type: processForm.po_type,
        segment_code: derivedSegmentCode,
        prodshade_material_id: processForm.prodshade_material_id,
        machine_id: processForm.machine_id || undefined,
        stroke_master_id: processForm.stroke_master_id,
        planned_start_date: isMts ? undefined : (processForm.planned_start_date || undefined),
        priority: processForm.po_type === "MTEST" ? processForm.priority : undefined,
        // MTS: batch_size is the per-batch KG already derived above
        // (Liter→KG conversion where applicable); Page 6 derives total planned
        // quantity from batch_size × number_of_batches on the server.
        ...(isMts ? {
          batch_size: Number(processForm.planned_qty_kg),
          number_of_batches: Number(processForm.number_of_batches),
          production_date: processForm.production_date,
          shift_id: processForm.shift_id,
          batch_start_serial: Number(processForm.batch_start_serial),
        } : {
          planned_qty_kg: Number(processForm.planned_qty_kg),
        }),
        line_location_overrides: previewRowsWithAvailability
          .filter((row) => (row.storage_location_id && row.storage_location_id !== row.default_storage_location_id) || row.actual_material_id)
          .map((row) => ({
            material_id: row.material_id,
            actual_material_id: row.actual_material_id || undefined,
            storage_location_id: row.storage_location_id,
          })),
      };
    if (isMts) {
      // Do not call createProcessOrder here.  Page 3 is only a batch-range
      // preview; Page 4/5/6 stay in browser state and Page 6 commits all
      // document/reservation writes in one transaction.
      setMtsCreationSession({ header: payload, materialGroups: [], packingRows: [] });
      setMtsPlanOverrides({});
      setProcessStep(4);
      toast("MTS creation session started. No Process PO or batch claim exists yet.");
      return;
    }

    setSaving(true);
    try {
      const result = await createProcessOrder(payload);
      toast(`Process PO created${result?.po_number ? `: ${result.po_number}` : "."}`);
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      resetProcess({ company_id: defaultCompanyId || "" });
    } catch (error) {
      toast(error.message || "Process PO create failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePacking(event) {
    event.preventDefault();
    if (!packingNumPacks) {
      toast("Num Packs is required.", "error");
      return;
    }
    if (isMtestPackingSku && !packingForm.sfg_material_id) {
      toast("Select a Prodshade + Stroke for the SFG source.", "error");
      return;
    }
    if (!isMtestPackingSku && !packingBomRequired && !packingFillQtyPerPack) {
      toast("Fill Qty Per Pack is required for this pack code.", "error");
      return;
    }
    if (packingMissingManualMaterial) {
      toast("Select a material for every PM line.", "error");
      return;
    }
    if (packingMissingPmSloc) {
      toast("Select a storage location for every PM line.", "error");
      return;
    }
    if (packingAvailabilityPreviewQ.isFetching) {
      toast("Stock check is still loading. Try again in a moment.", "error");
      return;
    }
    if (packingHasShortage) {
      toast("PM stock shortage exists. Change storage location or receive stock before create.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: effectivePackingCompanyId,
        source_po_type: packingForm.source_po_type,
        po_type: packingPoType,
        material_id: packingForm.material_id,
        num_packs: packingNumPacks,
        // §131.4 item #11: MTEST samples never send fill_qty_per_pack — the server
        // derives it from the SKU's own fixed conversion factor (item #1), ignoring
        // whatever the client might send, so there's nothing useful to send here.
        fill_qty_per_pack: (packingBomRequired || isMtestPackingSku) ? undefined : packingFillQtyPerPack,
        sfg_material_id: isMtestPackingSku ? packingForm.sfg_material_id : undefined,
        pm_lines: packingBomRequired
          ? packingBomPmPreviewLines
              .filter((line) => line.material_id && line.storage_location_id)
              .map((line) => ({
                material_id: line.material_id,
                actual_material_id: line.actual_material_id || undefined,
                storage_location_id: line.storage_location_id,
              }))
          : packingManualPmPreviewLines
              .filter((line) => line.material_id && line.storage_location_id)
              .map((line) => ({
                material_id: line.material_id,
                dosage_per_pack: line.dosage_per_pack,
                storage_location_id: line.storage_location_id,
                has_alternate: line.has_alternate,
                material_group_id: line.has_alternate ? (line.material_group_id || undefined) : undefined,
              })),
      };
      const result = await createPackingOrder(payload);
      toast(`Packing PO created${result?.po_number ? `: ${result.po_number}` : "."}`);
      resetPacking();
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
    } catch (error) {
      toast(packingFriendly(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Production PO Create - PR09"
      subtitle="Create Process or Packing production orders"
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => setActiveTab(index)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && processStep <= 3 && (
          <form onSubmit={handleCreateProcess} className="flex max-w-6xl flex-col gap-4">
            {processStep === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 1</p>
                  <h3 className="text-lg font-semibold text-slate-900">Company / PO Type / Material</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <TransactionCompanySelector
                      runtimeContext={runtimeContext}
                      value={effectiveCompanyId}
                      onChange={(value) => updateProcess("company_id", value)}
                      label="Company"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">PO Type <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={processForm.po_type}
                      onChange={(value) => updateProcess("po_type", value)}
                      options={processTypeOptions}
                      hideBlank
                    />
                  </div>

                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-600">Material <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={processForm.prodshade_material_id}
                      onChange={(value) => updateProcess("prodshade_material_id", value)}
                      options={prodshadeOptions}
                      placeholder="-- Select material --"
                      emptyStateLabel={approvedStrokesQ.isLoading || materialsQ.isLoading ? "Loading materials..." : "No eligible materials"}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleStepOneNext}
                    className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {processStep === 2 && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 2</p>
                  <h3 className="text-lg font-semibold text-slate-900">Stroke Gate</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-600">
                      Stroke <span className="text-rose-500"> *</span>
                    </label>
                    <ErpComboboxField
                      value={processForm.stroke_master_id}
                      onChange={(value) => {
                        if (isMts && mtsCurrentStrokeNumber !== null) {
                          const picked = (strokesQ.data ?? []).find((stroke) => String(stroke.id) === String(value));
                          if (picked && String(picked.stroke_number) !== String(mtsCurrentStrokeNumber)) {
                            setPendingNonCurrentStroke({ id: value, label: strokeLabel(picked) });
                            return;
                          }
                        }
                        updateProcess("stroke_master_id", value);
                      }}
                      options={strokeOptions}
                      placeholder="-- Select stroke --"
                      emptyStateLabel={strokesQ.isLoading ? "Loading strokes..." : "No approved strokes for this company + material"}
                    />
                  </div>
                </div>

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setProcessStep(1)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleStepTwoNext}
                    className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {processStep === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 3</p>
                    <h3 className="text-lg font-semibold text-slate-900">{isMts ? "Header + Batch Range" : "Header + Material Table"}</h3>
                  </div>
                  <span className="inline-flex rounded bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">STANDARD</span>
                </div>

                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">PO Number</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">-- (generated on save)</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Company</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{companyOptions.find((option) => option.value === effectiveCompanyId)?.label || "--"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">PO Type</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{processForm.po_type || "--"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Batch Number{isMts ? " Range" : ""}</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {isMts
                        ? (mtsBatchRangeQ.data?.from_batch_number
                          ? `${mtsBatchRangeQ.data.from_batch_number} — ${mtsBatchRangeQ.data.to_batch_number}`
                          : "--")
                        : "--"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Stroke</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{strokeOptions.find((option) => option.value === processForm.stroke_master_id)?.label || "--"}</div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Prodshade</label>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      {buildOutputReferenceValue(selectedMaterial?.material_name)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Description</label>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      {buildOutputReferenceValue(selectedMaterial?.document_name)}
                    </div>
                  </div>

                  {processForm.po_type === "MTS" ? (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Segment</label>
                      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                        {strokeDetailQ.isLoading ? "Loading..." : (derivedSegmentCode || "--")}
                      </div>
                      {!strokeDetailQ.isLoading && processForm.stroke_master_id && (
                        <p className="text-xs text-slate-500">
                          Auto-derived from this Stroke's own base UOM (Litre = IWC, KG = POWDER) -- not a manual choice.
                        </p>
                      )}
                    </div>
                  ) : processForm.po_type === "MTEST" ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Family Segment <span className="text-rose-500">*</span></label>
                        <ErpComboboxField
                          value={processForm.mtest_segment_code}
                          onChange={(value) => updateProcess("mtest_segment_code", value)}
                          options={MTEST_SEGMENTS.map((segment) => ({ value: segment, label: segment }))}
                          placeholder="-- Select family segment --"
                        />
                      </div>
                      {/* §136 follow-up (2026-09-08): MTEST has no separate QA_APPROVED
                          step, so Priority is picked here at Standard creation instead —
                          Urgent still routes through Manager Approval before Start Batch. */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Priority</label>
                        <select
                          value={processForm.priority}
                          onChange={(event) => updateProcess("priority", event.target.value)}
                          className="h-9 rounded border border-slate-300 px-2 text-sm"
                        >
                          <option value="NORMAL">Normal</option>
                          <option value="URGENT">Urgent</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Segment</label>
                      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                        {derivedSegmentCode || "--"}
                      </div>
                    </div>
                  )}

                  {machineRequired && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Machine <span className="text-rose-500">*</span></label>
                      <ErpComboboxField
                        value={processForm.machine_id}
                        onChange={(value) => updateProcess("machine_id", value)}
                        options={machineOptions}
                        placeholder="-- Select machine --"
                        emptyStateLabel={machinesQ.isLoading ? "Loading machines..." : "No active machines for this company"}
                        disabled={!effectiveCompanyId}
                      />
                      {isMts && (
                        <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={processForm.select_all_mts_machines}
                            onChange={(event) => {
                              updateProcess("select_all_mts_machines", event.target.checked);
                              updateProcess("machine_id", "");
                            }}
                          />
                          Select all MTS machines (bypass this Stroke's default location filter — §138.4 exception case)
                        </label>
                      )}
                      {isMts && !processForm.select_all_mts_machines && !strokeDefaultLocationId && processForm.stroke_master_id && (
                        <p className="text-xs text-amber-600">
                          This Stroke has no default storage location -- machine list can't be filtered, showing every active MTS machine.
                        </p>
                      )}
                    </div>
                  )}

                  {isMtsIwc ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Batch Size (Liter) <span className="text-rose-500">*</span></label>
                        <input
                          type="number"
                          min="0.01"
                          step={PRODUCTION_DECIMAL_STEP}
                          className={`rounded border px-2 py-1.5 text-sm font-mono ${machineCapacityCheck.blocked ? "border-rose-500 bg-rose-50 text-rose-900" : "border-slate-300"}`}
                          value={batchQtyLiter}
                          disabled={!processForm.stroke_master_id || literConversionMissing || strokeDetailQ.isLoading}
                          onChange={(event) => {
                            const literValue = event.target.value;
                            setBatchQtyLiter(literValue);
                            const liters = Number(literValue);
                            if (literToKgFactor && Number.isFinite(liters) && liters > 0) {
                              updateProcess("planned_qty_kg", multiplyPreciseValues(liters, literToKgFactor));
                            } else {
                              updateProcess("planned_qty_kg", "");
                            }
                          }}
                          required
                        />
                        {literConversionMissing && (
                          <span className="text-xs text-rose-600">
                            এই Stroke-এ Conversion UOM/Factor সেট করা নেই — Stroke Master-এ গিয়ে KG→Liter conversion factor যোগ করুন।
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">= Batch Size (KG, derived)</label>
                        <div className={`rounded border px-3 py-2 text-sm font-mono ${machineCapacityCheck.blocked ? "border-rose-500 bg-rose-50 text-rose-900" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                          {processForm.planned_qty_kg || "--"}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Batch Size (Planned Qty KG) <span className="text-rose-500">*</span></label>
                      <input
                        type="number"
                        min="0.01"
                        step={PRODUCTION_DECIMAL_STEP}
                        className={`rounded border px-2 py-1.5 text-sm font-mono ${machineCapacityCheck.blocked ? "border-rose-500 bg-rose-50 text-rose-900" : "border-slate-300"}`}
                        value={processForm.planned_qty_kg}
                        onChange={(event) => updateProcess("planned_qty_kg", event.target.value)}
                        required
                      />
                    </div>
                  )}

                  {machineRequired && processForm.machine_id && machineCapacityCheck.message && (
                    <div className={`-mt-2 text-xs ${machineCapacityCheck.blocked ? "font-medium text-rose-600" : "text-slate-500"}`}>
                      {machineCapacityCheck.message}
                    </div>
                  )}

                  {isMts ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Date <span className="text-rose-500">*</span></label>
                        <input
                          type="date"
                          min={PRODUCTION_DATE_BOUNDS.min}
                          max={PRODUCTION_DATE_BOUNDS.max}
                          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                          value={processForm.production_date}
                          onChange={(event) => updateProcess("production_date", event.target.value)}
                          required
                        />
                        <span className="text-xs text-slate-400">Declared physical production date — previous 3 days only, never future.</span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Shift <span className="text-rose-500">*</span></label>
                        <ErpComboboxField
                          value={processForm.shift_id}
                          onChange={(value) => updateProcess("shift_id", value)}
                          options={shiftOptions}
                          placeholder="-- Select shift --"
                          emptyStateLabel={shiftsQ.isLoading ? "Loading shifts..." : "No shifts yet — add one below"}
                          disabled={!effectiveCompanyId}
                        />
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            placeholder="+ New shift name"
                            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                            value={shiftCreateName}
                            onChange={(event) => setShiftCreateName(event.target.value)}
                            disabled={!effectiveCompanyId}
                          />
                          <button
                            type="button"
                            onClick={handleCreateShiftInline}
                            disabled={!shiftCreateName.trim() || shiftCreating}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {shiftCreating ? "Adding..." : "Add"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Planned Start Date</label>
                      <input
                        type="date"
                        min={PROCESS_PO_DATE_BOUNDS.min}
                        max={PROCESS_PO_DATE_BOUNDS.max}
                        className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={processForm.planned_start_date}
                        onChange={(event) => updateProcess("planned_start_date", event.target.value)}
                      />
                    </div>
                  )}
                </div>

                {isMts && (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-800">Batch Range</h4>
                    </div>
                    <div className="grid gap-4 px-4 py-4 md:grid-cols-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Start Batch Number <span className="text-rose-500">*</span></label>
                        <div className="flex items-center gap-2">
                          {mtsBatchRangeQ.data?.prefix && (
                            <span className="rounded bg-slate-100 px-2 py-1.5 text-xs font-mono text-slate-500">{mtsBatchRangeQ.data.prefix}</span>
                          )}
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className={`w-full rounded border px-2 py-1.5 text-sm font-mono ${mtsBatchRangeHasDuplicate ? "border-rose-500 bg-rose-50 text-rose-900" : "border-slate-300"}`}
                            value={processForm.batch_start_serial}
                            onChange={(event) => updateProcess("batch_start_serial", event.target.value)}
                            disabled={!processForm.prodshade_material_id}
                            required
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Number of Batches <span className="text-rose-500">*</span></label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className={`rounded border px-2 py-1.5 text-sm font-mono ${mtsBatchRangeHasDuplicate ? "border-rose-500 bg-rose-50 text-rose-900" : "border-slate-300"}`}
                          value={processForm.number_of_batches}
                          onChange={(event) => updateProcess("number_of_batches", event.target.value)}
                          disabled={!processForm.prodshade_material_id}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">To Batch</label>
                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900">
                          {mtsBatchRangeQ.data?.to_batch_number || "--"}
                        </div>
                      </div>
                    </div>
                    {mtsBatchRangeQ.error && (
                      <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                        {mtsBatchRangeQ.error.message || "Could not resolve batch range for this Prodshade."}
                      </div>
                    )}
                    {mtsBatchRangeHasDuplicate && (
                      <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">
                        Already active: {mtsBatchRangeQ.data.duplicates.join(", ")} — change Start Batch Number or Number of Batches.
                      </div>
                    )}
                    {isMts && Number(processForm.number_of_batches) > 0 && Number(processForm.planned_qty_kg) > 0 && (
                      <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                        SFG Output Qty (total): {formatStockQty(Number(processForm.planned_qty_kg) * Number(processForm.number_of_batches))} KG
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <h4 className="text-sm font-semibold text-slate-800">Output Reference</h4>
                  </div>
                  <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Material Code</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.pace_code)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Name</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.material_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Description</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.document_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">External Code</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(selectedMaterial?.external_code)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Storage Location</div>
                      <div className="mt-1 text-sm text-slate-900">{buildOutputReferenceValue(storageLocationLabel(outputStorageLocation))}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Movement Type</div>
                      <div className="mt-1 text-sm text-slate-900">P101</div>
                    </div>
                  </div>
                </div>

                {isMts ? (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                    RM Line entry (machine-bucket auto-derive, AP-Approved) is not part of this step —
                    saving here creates the Process PO header only. The RM Material Table opens next
                    (Page 4), where lines get computed and saved against this Batch Range's total quantity.
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3">
                        <h4 className="text-sm font-semibold text-slate-800">Material Table</h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1180px] border-collapse text-sm">
                          <thead>
                            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                              <th className="border-b px-3 py-2 text-left">#</th>
                              <th className="border-b px-3 py-2 text-left">Material Type</th>
                              <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                              <th className="border-b px-3 py-2 text-right">Dosage %</th>
                              <th className="border-b px-3 py-2 text-left">Actual Material</th>
                              <th className="border-b px-3 py-2 text-left">Storage Location</th>
                              <th className="border-b px-3 py-2 text-right">Standard Qty</th>
                              <th className="border-b px-3 py-2 text-left">Movement Type</th>
                              <th className="border-b px-3 py-2 text-right">Available</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewRowsWithAvailability.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">
                                  No stroke-derived material lines.
                                </td>
                              </tr>
                            ) : previewRowsWithAvailability.map((row) => {
                              const actualMaterialOptions = [
                                { value: "", label: "(same)" },
                                ...row.registered_alternate_material_options,
                              ];
                              return (
                                <tr key={row.key} className={row.is_short ? "bg-rose-50" : "border-b border-slate-100"}>
                                  <td className="border-b border-slate-100 px-3 py-2">{row.line_no}</td>
                                  <td className="border-b border-slate-100 px-3 py-2">{row.material_type}</td>
                                  <td className="border-b border-slate-100 px-3 py-2">{row.material_label || "--"}</td>
                                  <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(row.dosage_pct, "0")}</td>
                                  <td className="border-b border-slate-100 px-3 py-2">
                                    <ErpComboboxField
                                      value={row.actual_material_id}
                                      onChange={(value) => {
                                        setLineActualMaterialOverrides((current) => ({ ...current, [row.material_id]: value }));
                                      }}
                                      options={actualMaterialOptions}
                                      placeholder="(same)"
                                      disabled={row.registered_alternate_material_options.length === 0}
                                    />
                                  </td>
                                  <td className="border-b border-slate-100 px-3 py-2">
                                    <ErpComboboxField
                                      value={row.storage_location_id}
                                      onChange={(value) => {
                                        setLineLocationOverrides((current) => ({ ...current, [row.material_id]: value }));
                                      }}
                                      options={storageLocationOptions}
                                      placeholder="-- Select storage location --"
                                      emptyStateLabel={storageLocationQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                                    />
                                  </td>
                                  <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(row.standard_qty, "0")}</td>
                                  <td className="border-b border-slate-100 px-3 py-2">P261</td>
                                  <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                                    {formatStockQty(row.available_qty)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {shortLineNumbers.length > 0 && (
                      <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        Create is blocked because Available is below Standard Qty on line(s): {shortLineNumbers.join(", ")}.
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setProcessStep(2)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => resetProcess({ company_id: defaultCompanyId || "" })}
                      className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Clear
                    </button>
                    <button
                      type="submit"
                      disabled={saving || (!isMts && shortLineNumbers.length > 0) || machineCapacityCheck.blocked || (isMts && mtsBatchRangeHasDuplicate)}
                      className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : (isMts ? "Continue to Page 4" : "Create Process PO")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        )}

        {activeTab === 0 && processStep === 4 && mtsCreationSession && (
          <MtsMaterialPlanStep
            session={mtsCreationSession}
            overrides={mtsPlanOverrides}
            setOverrides={setMtsPlanOverrides}
            onCancel={() => {
              setMtsCreationSession(null);
              setMtsPlanOverrides({});
              resetProcess({ company_id: defaultCompanyId || "" });
            }}
            onContinue={(materialGroups) => {
              setMtsCreationSession((current) => ({ ...current, materialGroups }));
              setProcessStep(5);
            }}
          />
        )}

        {activeTab === 0 && processStep === 5 && mtsCreationSession && (
          <MtsPackingPlanStep
            session={mtsCreationSession}
            onBack={() => setProcessStep(4)}
            onContinue={(packingRows) => {
              setMtsCreationSession((current) => ({ ...current, packingRows }));
              setProcessStep(6);
            }}
          />
        )}

        {activeTab === 0 && processStep === 6 && mtsCreationSession && (
          <MtsPackingCombineStep
            session={mtsCreationSession}
            onBack={() => setProcessStep(5)}
            onDone={() => {
              setMtsCreationSession(null);
              setMtsPlanOverrides({});
              resetProcess({ company_id: defaultCompanyId || "" });
            }}
          />
        )}

        {activeTab === 1 && (
          <form onSubmit={handleCreatePacking} className="flex max-w-6xl flex-col gap-4">
            {packingStep === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 1</p>
                  <h3 className="text-lg font-semibold text-slate-900">Company / PO Type / FG SKU</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <TransactionCompanySelector
                      runtimeContext={runtimeContext}
                      value={effectivePackingCompanyId}
                      onChange={(value) => updatePacking("company_id", value)}
                      label="Company"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">PO Type <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={packingForm.source_po_type}
                      onChange={(value) => updatePacking("source_po_type", value)}
                      options={PACKING_SOURCE_TYPES.map((type) => ({ value: type, label: type }))}
                      hideBlank
                    />
                  </div>

                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-600">FG SKU <span className="text-rose-500">*</span></label>
                    <ErpComboboxField
                      value={packingForm.material_id}
                      onChange={(value) => updatePacking("material_id", value)}
                      options={packingSkuOptions}
                      placeholder={packingActiveBomsQ.isFetching ? "Loading ACTIVE Pack BOM SKUs..." : "-- Select FG SKU --"}
                      emptyStateLabel="No ACTIVE Pack BOM SKU found for this company"
                    />
                  </div>

                  <div className="text-sm">
                    <p className="text-xs text-slate-400">Packing PO Type</p>
                    <p className="font-semibold">{packingPoType || "--"}</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handlePackingStepOneNext}
                    className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {packingStep === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 2</p>
                    <h3 className="text-lg font-semibold text-slate-900">Header + Lines (from Pack BOM)</h3>
                  </div>
                  <span className="inline-flex rounded bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">STANDARD</span>
                </div>

                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5 text-sm">
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Company</div>
                    <div className="mt-1 font-medium text-slate-900">{companyOptions.find((option) => option.value === effectivePackingCompanyId)?.label || "--"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">SKU</div>
                    <div className="mt-1 font-medium text-slate-900">{materialLabel(packingSku) || "--"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Type</div>
                    <div className="mt-1 font-medium text-slate-900">{packingForm.source_po_type} / {packingPoType}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">PO Number</div>
                    <div className="mt-1 font-medium text-slate-900">-- (generated on save)</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">SFG Batch</div>
                    <div className="mt-1 font-medium text-slate-900">Chosen at Final</div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Num Packs <span className="text-rose-500">*</span></label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                      value={packingForm.num_packs}
                      onChange={(event) => setPackingForm((current) => ({ ...current, num_packs: event.target.value }))}
                      required
                    />
                  </div>
                  {!packingBomRequired && !isMtestPackingSku && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Fill Qty Per Pack (KG) <span className="text-rose-500">*</span></label>
                      <input
                        type="number"
                        min="0.001"
                        step={PRODUCTION_DECIMAL_STEP}
                        className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                        value={packingForm.fill_qty_per_pack}
                        onChange={(event) => setPackingForm((current) => ({ ...current, fill_qty_per_pack: event.target.value }))}
                        required
                      />
                    </div>
                  )}
                  {isMtestPackingSku && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Fill Qty Per Pack (KG)</label>
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-mono text-slate-600">
                        {mtestFixedFillQtyPerPack ? `${qtyFmt(mtestFixedFillQtyPerPack)} (fixed by SKU)` : "--"}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-400">Planned SFG Qty</p>
                    <p className="font-mono font-semibold">{qtyFmt(packingPlannedQtyKg)} KG</p>
                  </div>
                </div>

                {isMtestPackingSku && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">
                      SFG Source — Prodshade + Stroke <span className="text-rose-500">*</span>
                    </label>
                    <ErpComboboxField
                      value={packingForm.sfg_material_id && packingForm.sfg_stroke_master_id
                        ? `${packingForm.sfg_material_id}|${packingForm.sfg_stroke_master_id}`
                        : ""}
                      onChange={(value) => {
                        const [prodshadeMaterialId, strokeMasterId] = String(value || "").split("|");
                        setPackingForm((current) => ({
                          ...current,
                          sfg_material_id: prodshadeMaterialId || "",
                          sfg_stroke_master_id: strokeMasterId || "",
                        }));
                      }}
                      options={mtestSfgOptions}
                      placeholder={mtestSfgOptionsQ.isFetching ? "Loading L003 stock..." : "-- Select Prodshade + Stroke --"}
                      emptyStateLabel="No SFG stock available at L003 for this company"
                    />
                    <p className="text-xs text-slate-400">
                      Only combos with SFG stock currently sitting in L003 are shown. The exact batch is chosen at Final.
                    </p>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="border-b px-3 py-2 text-left">Line</th>
                        <th className="border-b px-3 py-2 text-left">Material</th>
                        <th className="border-b px-3 py-2 text-left">Storage Location</th>
                        <th className="border-b px-3 py-2 text-right">Qty</th>
                        <th className="border-b px-3 py-2 text-left">Movement</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-2 font-semibold">FG</td>
                        <td className="px-3 py-2">{materialLabel(packingSku) || "--"}</td>
                        <td className="px-3 py-2">{slocLabel(packingOutputLine?.storage_location) || "--"}</td>
                        <td className="px-3 py-2 text-right font-mono">{qtyFmt(packingNumPacks)}</td>
                        <td className="px-3 py-2 font-mono">P101</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-2 font-semibold">SFG</td>
                        <td className="px-3 py-2">
                          {isMtestPackingSku
                            ? (materialLabel((mtestSfgOptionsQ.data ?? []).find((row) => row.prodshade_material_id === packingForm.sfg_material_id)?.prodshade) || "-- select above --")
                            : (materialLabel(packingSfgLine?.material) || "--")}
                        </td>
                        <td className="px-3 py-2">{isMtestPackingSku ? "L003 (ADMIX LAB)" : (slocLabel(packingSfgLine?.storage_location) || "--")}</td>
                        <td className="px-3 py-2 text-right font-mono">{qtyFmt(packingPlannedQtyKg)} KG</td>
                        <td className="px-3 py-2 font-mono">P261</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {packingBomRequired ? (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-800">PM Lines (from Pack BOM)</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1050px] border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                            <th className="border-b px-3 py-2 text-right">Dosage / Pack</th>
                            <th className="border-b px-3 py-2 text-right">Standard Qty</th>
                            <th className="border-b px-3 py-2 text-left">Actual Material</th>
                            <th className="border-b px-3 py-2 text-left">Storage Location <span className="text-rose-500">*</span></th>
                            <th className="border-b px-3 py-2 text-right">Available</th>
                            <th className="border-b px-3 py-2 text-right">Shortage</th>
                            <th className="border-b px-3 py-2 text-left">Group</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packingPmRowsWithAvailability.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">
                                No PM lines on this Pack BOM.
                              </td>
                            </tr>
                          ) : packingPmRowsWithAvailability.map((line) => {
                            const actualMaterialOptions = [{ value: "", label: "(same)" }, ...line.alternate_options];
                            return (
                              <tr key={line.material_id} className={line.short > 0 ? "bg-rose-50" : "border-b border-slate-100"}>
                                <td className="px-3 py-2">{line.material_label}</td>
                                <td className="px-3 py-2 text-right font-mono">{qtyFmt(line.dosage_per_pack)}</td>
                                <td className="px-3 py-2 text-right font-mono">{qtyFmt(line.standard_qty)}</td>
                                <td className="px-3 py-2 min-w-[200px]">
                                  <ErpComboboxField
                                    value={line.actual_material_id}
                                    onChange={(value) => updatePackingPmLine(line.material_id, { actual_material_id: value })}
                                    options={actualMaterialOptions}
                                    placeholder="(same)"
                                    disabled={!line.has_alternate || line.alternate_options.length === 0}
                                  />
                                </td>
                                <td className="px-3 py-2 min-w-[220px]">
                                  <ErpComboboxField
                                    value={line.storage_location_id}
                                    onChange={(value) => updatePackingPmLine(line.material_id, { storage_location_id: value })}
                                    options={packingStorageOptions}
                                    placeholder="-- Select --"
                                    emptyStateLabel={packingStorageQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{formatStockQty(line.available_qty)}</td>
                                <td className={`px-3 py-2 text-right font-mono ${line.short > 0 ? "text-rose-600 font-semibold" : ""}`}>{line.short > 0 ? qtyFmt(line.short) : "--"}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{line.group_label || "--"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-800">PM Lines (add manually — no Fixed Pack BOM for this pack code)</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1150px] border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <th className="border-b px-3 py-2 text-left">Material <span className="text-rose-500">*</span></th>
                            <th className="border-b px-3 py-2 text-right">Dosage / Pack</th>
                            <th className="border-b px-3 py-2 text-right">Standard Qty</th>
                            <th className="border-b px-3 py-2 text-left">Storage Location <span className="text-rose-500">*</span></th>
                            <th className="border-b px-3 py-2 text-right">Available</th>
                            <th className="border-b px-3 py-2 text-right">Shortage</th>
                            <th className="border-b px-3 py-2 text-left">Alternate?</th>
                            <th className="border-b px-3 py-2 text-left">Group</th>
                            <th className="border-b px-3 py-2 text-left"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {packingPmRowsWithAvailability.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">
                                No PM lines added yet.
                              </td>
                            </tr>
                          ) : packingPmRowsWithAvailability.map((line) => {
                            const selectedGroup = packingGroupById.get(line.material_group_id) ?? null;
                            return (
                              <tr key={line.index} className={line.short > 0 ? "bg-rose-50" : "border-b border-slate-100"}>
                                <td className="px-3 py-2 min-w-[200px]">
                                  <ErpComboboxField
                                    value={line.material_id}
                                    onChange={(value) => updatePackingManualPmLine(line.index, { material_id: value })}
                                    options={packingPmMaterialOptions}
                                    placeholder="-- Select PM --"
                                    emptyStateLabel={packingPmMaterialsQ.isLoading ? "Loading PM materials..." : "No PM materials"}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    className="h-8 w-24 rounded border border-slate-300 px-2 text-right font-mono text-sm"
                                    type="number"
                                    min="0.001"
                                    step={PRODUCTION_DECIMAL_STEP}
                                    value={packingManualPmLines[line.index]?.dosage_per_pack ?? ""}
                                    onChange={(event) => updatePackingManualPmLine(line.index, { dosage_per_pack: event.target.value })}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{qtyFmt(line.standard_qty)}</td>
                                <td className="px-3 py-2 min-w-[220px]">
                                  <ErpComboboxField
                                    value={line.storage_location_id}
                                    onChange={(value) => updatePackingManualPmLine(line.index, { storage_location_id: value })}
                                    options={packingStorageOptions}
                                    placeholder="-- Select --"
                                    emptyStateLabel={packingStorageQ.isLoading ? "Loading storage locations..." : "No storage locations"}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{formatStockQty(line.available_qty)}</td>
                                <td className={`px-3 py-2 text-right font-mono ${line.short > 0 ? "text-rose-600 font-semibold" : ""}`}>{line.short > 0 ? qtyFmt(line.short) : "--"}</td>
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={line.has_alternate}
                                    onChange={(event) => updatePackingManualPmLine(line.index, { has_alternate: event.target.checked, material_group_id: event.target.checked ? line.material_group_id : "" })}
                                  />
                                </td>
                                <td className="px-3 py-2 min-w-[180px]">
                                  {line.has_alternate ? (
                                    <div className="flex gap-1">
                                      <ErpComboboxField
                                        value={line.material_group_id}
                                        onChange={(value) => updatePackingManualPmLine(line.index, { material_group_id: value })}
                                        options={(packingGroupsQ.data ?? []).map((group) => ({ value: group.id, label: `${group.group_code} - ${group.group_name}` }))}
                                        placeholder="-- Group --"
                                      />
                                      <button type="button" className="text-sky-600 text-xs underline" onClick={() => openPackingCreateGroupModal((id) => updatePackingManualPmLine(line.index, { material_group_id: id }))}>+ New</button>
                                    </div>
                                  ) : <span className="text-slate-400">--</span>}
                                  {line.has_alternate && selectedGroup ? (
                                    <div className="mt-1 text-xs text-slate-500">
                                      {(selectedGroup.members ?? []).length ? `${selectedGroup.members.length} members` : "none"}
                                      <button type="button" className="ml-1 text-sky-600 underline" onClick={() => setPackingMemberModal(selectedGroup.id)}>+ Add</button>
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2">
                                  <button type="button" className="text-rose-500 text-xs underline" onClick={() => removePackingManualPmLine(line.index)}>Remove</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-3">
                      <button type="button" className="text-sky-600 text-xs underline" onClick={addPackingManualPmLine}>+ Add PM line</button>
                    </div>
                  </div>
                )}

                {packingHasShortage ? (
                  <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    PM stock shortage exists. Change storage location or receive stock before creating this Packing PO.
                  </div>
                ) : null}

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setPackingStep(1)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetPacking}
                      className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Clear
                    </button>
                    <button
                      type="submit"
                      disabled={saving || packingAvailabilityPreviewQ.isFetching || packingHasShortage}
                      className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                    >
                      {saving ? "Creating..." : packingAvailabilityPreviewQ.isFetching ? "Checking Stock..." : "Create Packing PO"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        )}
      </ErpSectionCard>

      <GroupCreateModal open={Boolean(packingGroupModal)} groupForm={packingGroupForm} setGroupForm={setPackingGroupForm} onCancel={() => setPackingGroupModal(null)} onCreate={handlePackingCreateGroup} />
      <MemberAddModal
        open={Boolean(packingMemberModal)}
        memberMaterialId={packingMemberMaterialId}
        setMemberMaterialId={setPackingMemberMaterialId}
        materialOptions={packingPmMaterialOptions}
        onCancel={() => setPackingMemberModal(null)}
        onAdd={handlePackingAddMember}
      />
      <BlockingLayer
        visible={Boolean(pendingNonCurrentStroke)}
        onEscape={() => setPendingNonCurrentStroke(null)}
        overlayStyle={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 1000100, display: "flex", alignItems: "center", justifyContent: "center" }}
        dialogStyle={{ background: "white", borderRadius: 4, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 16, width: 380, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <p className="text-sm font-semibold text-slate-800">Non-Current Stroke Selected</p>
        <p className="text-sm text-slate-600">
          You have selected a non-current stroke ({pendingNonCurrentStroke?.label}). Are you sure you want to continue with this stroke?
        </p>
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            onClick={() => setPendingNonCurrentStroke(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
            onClick={() => {
              updateProcess("stroke_master_id", pendingNonCurrentStroke.id);
              setPendingNonCurrentStroke(null);
            }}
          >
            Confirm
          </button>
        </div>
      </BlockingLayer>
    </ErpScreenScaffold>
  );
}

// Page 4 is a stateless server preview over browser session data.  It never
// owns a Process PO or a reservation; Page 6 is the first durable write.
function MtsMaterialPlanStep({ session, overrides, setOverrides, onCancel, onContinue }) {
  const [manualPicks, setManualPicks] = useState({});
  const [saving, setSaving] = useState(false);
  const planQ = useQuery({
    queryKey: ["mts-creation-material-plan", session.header],
    queryFn: () => previewMtsCreationMaterialPlan({ header: session.header }),
  });

  const header = planQ.data?.header ?? null;
  const groups = useMemo(() => planQ.data?.groups ?? [], [planQ.data]);
  const materials = planQ.data?.materials ?? {};
  const storageLocations = planQ.data?.storage_locations ?? {};
  // Both current and non-current MTS strokes are editable throughout the
  // browser-only creation session.  The non-current distinction is a QA
  // sign-off after Page 6, not a restriction on making the plan that QA
  // reviews.  Nothing is durable until the Page-6 atomic commit.
  const isEditable = true;

  function materialLabel(id) {
    const m = materials[id];
    if (!m) return "--";
    return [m.pace_code, m.material_name].filter(Boolean).join(" - ") || "--";
  }
  function slocLabel(id) {
    const s = storageLocations[id];
    if (!s) return "--";
    return [s.code, s.name].filter(Boolean).join(" - ") || "--";
  }

  function rowsForGroup(group) {
    const override = overrides[group.stroke_line_id];
    if (isEditable && override) return override;
    return group.rows;
  }

  function handleSwapMaterial(group, rowIndex, newMaterialId) {
    const rows = rowsForGroup(group).map((r) => ({ ...r }));
    if (rows.some((r, i) => i !== rowIndex && r.actual_material_id === newMaterialId)) {
      pushToast("This material is already used in another row for this line.", "error");
      return;
    }
    rows[rowIndex] = { ...rows[rowIndex], actual_material_id: newMaterialId };
    setOverrides((current) => ({ ...current, [group.stroke_line_id]: rows }));
  }

  function handleQtyChange(group, rowIndex, qtyStr) {
    let rows = rowsForGroup(group).map((r) => ({ ...r }));
    const qty = Number(qtyStr) || 0;
    rows[rowIndex] = { ...rows[rowIndex], actual_qty: qty };
    // §138.12 refinement: raising one row's Actual Qty to meet/exceed the
    // group's own Standard Qty means every sibling row's contribution is no
    // longer needed -- they vanish rather than sitting at qty 0. No attempt
    // is made to redistribute a *reduction* across remaining siblings (no
    // unambiguous "fair split"); that case is handled by the under-qty
    // confirm-on-Save flow instead.
    if (qty >= group.standard_qty - EPSILON_FRONTEND) {
      rows = [rows[rowIndex]];
    }
    setOverrides((current) => ({ ...current, [group.stroke_line_id]: rows }));
  }

  function handleRemoveRow(group, rowIndex) {
    const rows = rowsForGroup(group).filter((_, i) => i !== rowIndex);
    setOverrides((current) => ({ ...current, [group.stroke_line_id]: rows }));
  }

  function handleAddRow(group) {
    const rows = rowsForGroup(group).map((r) => ({ ...r }));
    const nextMaterialId = group.group_member_ids.find((id) => !rows.some((r) => r.actual_material_id === id));
    if (!nextMaterialId) {
      pushToast("Every material in this alternate group is already present.", "error");
      return;
    }
    rows.push({
      stroke_line_id: group.stroke_line_id,
      stroke_line_material_id: group.stroke_line_material_id,
      actual_material_id: nextMaterialId,
      is_formulation_line: false,
      dosage_pct: null,
      planned_qty: 0,
      actual_qty: 0,
      available_qty: 0,
    });
    setOverrides((current) => ({ ...current, [group.stroke_line_id]: rows }));
  }

  const shortGroups = groups.filter((g) => g.short);
  const manualPickMissing = groups.some((g) => !g.auto_derive_applicable
    && !manualPicks[g.stroke_line_id]
    && !g.rows.some((r) => r.is_formulation_line && r.actual_qty > 0));
  const [deviationModal, setDeviationModal] = useState(null);

  function buildSaveBody(confirmDeviation) {
    return {
      groups: groups.map((group) => {
        if (group.auto_derive_applicable) {
          // Preserve the derived rows as part of the browser-only session even
          // when the operator has not edited them.  Page 6 re-derives from
          // current stock, but the persisted snapshot must still show what the
          // operator saw and accepted on Page 4.
          const override = overrides[group.stroke_line_id] ?? group.rows;
          return {
            stroke_line_id: group.stroke_line_id,
            rows: override.map((r) => ({ actual_material_id: r.actual_material_id, actual_qty: r.actual_qty })),
            confirmed_deviation: confirmDeviation === true,
          };
        }
        const chosen = manualPicks[group.stroke_line_id];
        return chosen ? { stroke_line_id: group.stroke_line_id, actual_material_id: chosen } : null;
      }).filter(Boolean),
    };
  }

  // §138 deviation-confirm (2026-09-21): a Page-4 group's total departing from
  // the formula's own Standard Qty -- over OR under -- is a real production
  // event (alternates substitute at a different ratio, mixing loses/gains
  // material), not an error. It is never silently accepted: the operator
  // must explicitly confirm it here before Page 5, mirroring the same gate
  // enforced server-side in prepareRmLines().
  function findDeviationGroups() {
    const found = [];
    for (const group of groups) {
      if (!group.auto_derive_applicable || !isEditable) continue;
      const override = overrides[group.stroke_line_id];
      if (!override) continue;
      const total = override.reduce((sum, r) => sum + (Number(r.actual_qty) || 0), 0);
      const deviation = Number((total - group.standard_qty).toFixed(6));
      if (Math.abs(deviation) > EPSILON_FRONTEND) {
        found.push({
          strokeLineId: group.stroke_line_id,
          label: materialLabel(group.stroke_line_material_id),
          standardQty: group.standard_qty,
          actualQty: total,
          deviation,
        });
      }
    }
    return found;
  }

  async function doSave(confirmDeviation) {
    setSaving(true);
    try {
      const body = buildSaveBody(confirmDeviation);
      onContinue(body.groups);
    } catch (error) {
      pushToast(error.message || "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const deviations = findDeviationGroups();
    if (deviations.length > 0) {
      setDeviationModal({ deviations });
      return;
    }
    await doSave(false);
  }

  if (planQ.isLoading) {
    return <div className="max-w-6xl px-1 py-6 text-sm text-slate-500">Loading material plan...</div>;
  }
  if (planQ.isError) {
    return <div className="max-w-6xl px-1 py-6 text-sm text-rose-600">{planQ.error?.message || "Failed to load material plan."}</div>;
  }

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 4</p>
          <h3 className="text-lg font-semibold text-slate-900">RM Auto-Derive Material Table</h3>
        </div>
        <span className="inline-flex rounded bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">CREATION SESSION</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">PO Number</div>
          <div className="mt-1 text-sm font-medium text-slate-900">Created only after Page 6</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Prodshade</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{[header?.prodshade_pace_code, header?.prodshade_material_name].filter(Boolean).join(" - ") || "--"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Description</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{header?.prodshade_description || "--"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Stroke Number</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{header?.stroke_number || "--"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Machine</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{header?.machine_label || "--"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Batch Range</div>
          <div className="mt-1 text-sm font-medium text-slate-900">
            {header?.batch_number_from ? `${header.batch_number_from} - ${header.batch_number_to}` : "--"}
            {header?.number_of_batches ? ` (${header.number_of_batches})` : ""}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Batch Size (per batch)</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{formatPreciseNumber(header?.batch_size, "0.###")} KG</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Total Qty</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{formatPreciseNumber(header?.total_qty, "0.###")} KG</div>
        </div>
      </div>

      {shortGroups.length > 0 && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Insufficient stock (formulation + alternates combined) for: {shortGroups.map((g) => materialLabel(g.stroke_line_material_id)).join(", ")}.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-800">Material Table</h4>
          <p className="mt-1 text-xs text-slate-500">Formulation Material, Dosage and Standard Qty describe the recipe requirement. Actual Material shows what will be issued; replacing it does not change the recipe.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b px-3 py-2 text-left">#</th>
                <th className="border-b px-3 py-2 text-left">Material Type</th>
                <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                <th className="border-b px-3 py-2 text-right">Dosage %</th>
                <th className="border-b px-3 py-2 text-left">Actual Material</th>
                <th className="border-b px-3 py-2 text-left">Storage Location</th>
                <th className="border-b px-3 py-2 text-right">Standard Qty</th>
                <th className="border-b px-3 py-2 text-right">Actual Qty</th>
                <th className="border-b px-3 py-2 text-right">Available</th>
                <th className="border-b px-3 py-2 text-left">Movement Type</th>
                <th className="border-b px-3 py-2 text-left">AP-Approved</th>
                <th className="border-b px-3 py-2 text-right">AP Qty</th>
                <th className="border-b px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-sm text-slate-400">No stroke-derived material lines.</td>
                </tr>
              ) : groups.flatMap((group, groupIndex) => {
                const rows = rowsForGroup(group);
                const usedIds = new Set(rows.map((r) => r.actual_material_id));
                return rows.map((row, rowIndex) => {
                  const rowKey = `${group.stroke_line_id}-${rowIndex}`;
                  const materialOptions = group.group_member_ids.map((id) => ({
                    value: id,
                    label: materialLabel(id),
                    disabled: usedIds.has(id) && id !== row.actual_material_id,
                  }));
                  const isFirstRow = rowIndex === 0;
                  return (
                    <tr key={rowKey} className={group.short ? "bg-rose-50" : "border-b border-slate-100"}>
                      <td className="border-b border-slate-100 px-3 py-2">{isFirstRow ? groupIndex + 1 : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2">RM</td>
                      <td className="border-b border-slate-100 px-3 py-2">{isFirstRow ? materialLabel(group.stroke_line_material_id) : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{isFirstRow ? formatPreciseNumber(group.dosage_pct, "0") : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {group.auto_derive_applicable && isEditable ? (
                          <ErpComboboxField
                            value={row.actual_material_id}
                            onChange={(value) => handleSwapMaterial(group, rowIndex, value)}
                            options={materialOptions}
                          />
                        ) : !group.auto_derive_applicable ? (
                          <ErpComboboxField
                            value={manualPicks[group.stroke_line_id] || ""}
                            onChange={(value) => setManualPicks((current) => ({ ...current, [group.stroke_line_id]: value }))}
                            options={group.group_member_ids.map((id) => ({ value: id, label: materialLabel(id) }))}
                            placeholder="-- Select Actual Material --"
                          />
                        ) : (
                          materialLabel(row.actual_material_id)
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">{slocLabel(group.storage_location_id)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{isFirstRow ? formatPreciseNumber(group.standard_qty, "0.###") : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                        {group.auto_derive_applicable && isEditable ? (
                          <input
                            type="number"
                            step="0.001"
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                            value={row.actual_qty}
                            onChange={(event) => handleQtyChange(group, rowIndex, event.target.value)}
                          />
                        ) : (
                          formatPreciseNumber(row.actual_qty, "0.###")
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(row.available_qty, "0.###")}</td>
                      <td className="border-b border-slate-100 px-3 py-2">P261</td>
                      <td className="border-b border-slate-100 px-3 py-2">Yes</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(row.actual_qty, "0.###")}</td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {group.short ? <span className="text-rose-600">Short</span> : ""}
                        {group.auto_derive_applicable && isEditable && rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(group, rowIndex)}
                            className="ml-2 text-xs text-slate-400 underline hover:text-rose-600"
                            title="Remove this row"
                          >
                            Remove
                          </button>
                        )}
                        {group.auto_derive_applicable && isEditable && rowIndex === rows.length - 1 && rows.length < group.group_member_ids.length && (
                          <button
                            type="button"
                            onClick={() => handleAddRow(group)}
                            className="ml-2 text-xs text-sky-600 underline hover:text-sky-800"
                            title="Add an alternate-material row"
                          >
                            Add row
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50">
          Cancel / Back to list
        </button>
        <button
          type="button"
          disabled={saving || shortGroups.length > 0 || manualPickMissing}
          onClick={handleSave}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Checking..." : "Next: Page 5"}
        </button>
      </div>

      <BlockingLayer
        visible={!!deviationModal}
        onEscape={() => setDeviationModal(null)}
        overlayStyle={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 1000100, display: "flex", alignItems: "center", justifyContent: "center" }}
        dialogStyle={{ background: "white", borderRadius: 4, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 16, width: 480, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <p className="text-sm font-semibold text-slate-700">RM quantity differs from Standard Qty</p>
        <p className="text-xs text-slate-500">
          One or more groups below do not exactly match the formula's Standard Qty. This can be a
          deliberate alternate-material substitution or a real over/under issue -- confirm to proceed
          to Page 5, or Cancel to adjust the rows first.
        </p>
        <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left">Material</th>
                <th className="px-2 py-1 text-right">Standard</th>
                <th className="px-2 py-1 text-right">Actual</th>
                <th className="px-2 py-1 text-right">Deviation</th>
              </tr>
            </thead>
            <tbody>
              {(deviationModal?.deviations ?? []).map((d) => (
                <tr key={d.strokeLineId} className="border-t border-slate-100">
                  <td className="px-2 py-1">{d.label}</td>
                  <td className="px-2 py-1 text-right">{formatStockQty(d.standardQty)}</td>
                  <td className="px-2 py-1 text-right">{formatStockQty(d.actualQty)}</td>
                  <td className={`px-2 py-1 text-right font-medium ${d.deviation > 0 ? "text-amber-600" : "text-rose-600"}`}>
                    {d.deviation > 0 ? "+" : ""}{formatStockQty(d.deviation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button type="button" className="text-xs text-slate-500 px-3 py-1" onClick={() => setDeviationModal(null)}>Cancel</button>
          <button
            type="button"
            className="text-xs bg-sky-600 text-white rounded px-3 py-1"
            onClick={() => { setDeviationModal(null); doSave(true); }}
          >
            Confirm & Continue
          </button>
        </div>
      </BlockingLayer>
    </div>
  );
}

// Page 5 remains inside the browser-only MTS creation session.  Its rows are
// validated again at Page 6 before the atomic document-create call.
function MtsPackingPlanStep({ session, onBack, onContinue }) {
  const [rows, setRows] = useState(null); // lazily initialized from session data
  const [saving, setSaving] = useState(false);

  const planQ = useQuery({
    queryKey: ["mts-creation-packing-plan", session.header],
    queryFn: () => previewMtsCreationPackingPlan({ header: session.header }),
  });

  const header = planQ.data?.header ?? null;
  const packSizeOptions = planQ.data?.pack_size_options ?? [];
  const storageLocationOptions = planQ.data?.storage_location_options ?? [];
  const batchNumbers = useMemo(() => planQ.data?.batch_numbers ?? [], [planQ.data]);

  useEffect(() => {
    if (rows === null && planQ.data) {
      const existing = (session.packingRows ?? []).map((r) => ({
        batch_number_from: r.batch_number_from,
        batch_number_to: r.batch_number_to,
        up_to_last_batch: batchNumbers.length > 0 && r.batch_number_to === batchNumbers[batchNumbers.length - 1],
        pack_code_id: r.pack_code_id,
        outer_unit_per_batch: r.outer_unit_per_batch,
        storage_location_id: r.storage_location_id,
      }));
      setRows(existing.length > 0 ? existing : [{ batch_number_from: "", batch_number_to: "", up_to_last_batch: false, pack_code_id: "", outer_unit_per_batch: "", storage_location_id: "" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planQ.data]);

  const effectiveRows = useMemo(() => rows ?? [], [rows]);

  function batchIndexOf(bn) {
    return batchNumbers.indexOf(bn);
  }

  // Batches claimed by every OTHER row -- used both to disable/reorder the
  // dropdown options for a given row and to compute each row's own live
  // Number of Batches/Volume without double-claiming.
  function claimedIndicesExcluding(rowIndex) {
    const claimed = new Set();
    effectiveRows.forEach((r, i) => {
      if (i === rowIndex) return;
      const fromIdx = batchIndexOf(r.batch_number_from);
      const toIdx = r.up_to_last_batch ? batchNumbers.length - 1 : batchIndexOf(r.batch_number_to);
      if (fromIdx < 0 || toIdx < fromIdx) return;
      for (let k = fromIdx; k <= toIdx; k++) claimed.add(k);
    });
    return claimed;
  }

  // §138.16 "availability-first, taken-after" sort: unclaimed batch numbers
  // list first (in their natural order), claimed ones after, disabled.
  function batchOptionsFor(rowIndex) {
    const claimed = claimedIndicesExcluding(rowIndex);
    const available = [];
    const taken = [];
    batchNumbers.forEach((bn, idx) => {
      (claimed.has(idx) ? taken : available).push({ value: bn, label: bn, disabled: claimed.has(idx) });
    });
    return [...available, ...taken];
  }

  function updateRow(index, patch) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function computeRowMetrics(row) {
    const fromIdx = batchIndexOf(row.batch_number_from);
    const toIdx = row.up_to_last_batch ? batchNumbers.length - 1 : batchIndexOf(row.batch_number_to);
    const numberOfBatches = fromIdx >= 0 && toIdx >= fromIdx ? toIdx - fromIdx + 1 : 0;
    const pack = packSizeOptions.find((p) => p.pack_code_id === row.pack_code_id) ?? null;
    const outerUnitPerBatch = Number(row.outer_unit_per_batch) || 0;
    const totalOuterUnit = numberOfBatches * outerUnitPerBatch;
    const hasInner = Boolean(pack?.inner_uom_code);
    // §138.16 (2026-09-22): the SKU's own Pack BOM is_primary_container PM line qty IS the
    // "inner units per 1 outer unit" ratio (e.g. 10 BTL per 1 CTN) -- backend resolves and
    // attaches it per pack option as inner_units_per_outer_unit. No BOM/no primary-container
    // line (or an inner_uom_code-less pack) leaves it null, shown as N/A below.
    const innerUnitsPerOuterUnit = pack?.inner_units_per_outer_unit != null ? Number(pack.inner_units_per_outer_unit) : null;
    const totalInnerUnit = hasInner && innerUnitsPerOuterUnit != null ? totalOuterUnit * innerUnitsPerOuterUnit : null;
    const volume = pack ? totalOuterUnit * Number(pack.fill_qty || 0) : 0;
    return { numberOfBatches, pack, totalOuterUnit, hasInner, innerUnitsPerOuterUnit, totalInnerUnit, volume };
  }

  const rowMetrics = effectiveRows.map((r) => computeRowMetrics(r));
  const runningVolume = rowMetrics.reduce((sum, m) => sum + m.volume, 0);
  const totalQty = Number(header?.total_qty ?? 0);
  const shortfall = Math.max(0, Number((totalQty - runningVolume).toFixed(6)));
  // Yield may vary, but every physical batch must still appear exactly once.
  // Keep this guard on Page 5 and in Page 6 so an overlap/gap never looks
  // like a valid plan.
  const batchCoverage = useMemo(() => {
    const claimed = new Array(batchNumbers.length).fill(false);
    let invalid = effectiveRows.length === 0;
    for (const row of effectiveRows) {
      const fromIdx = batchNumbers.indexOf(row.batch_number_from);
      const toIdx = row.up_to_last_batch ? batchNumbers.length - 1 : batchNumbers.indexOf(row.batch_number_to);
      if (fromIdx < 0 || toIdx < fromIdx) {
        invalid = true;
        continue;
      }
      for (let index = fromIdx; index <= toIdx; index += 1) {
        if (claimed[index]) invalid = true;
        claimed[index] = true;
      }
    }
    return { complete: !invalid && claimed.length > 0 && claimed.every(Boolean), invalid };
  }, [batchNumbers, effectiveRows]);

  function addRow() {
    setRows((current) => [...current, { batch_number_from: "", batch_number_to: "", up_to_last_batch: false, pack_code_id: "", outer_unit_per_batch: "", storage_location_id: "" }]);
  }
  function removeRow(index) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function doSave() {
    setSaving(true);
    try {
      const body = {
        rows: effectiveRows
          .filter((r) => r.batch_number_from && (r.up_to_last_batch || r.batch_number_to) && r.pack_code_id && r.outer_unit_per_batch && r.storage_location_id)
          .map((r) => ({
            batch_number_from: r.batch_number_from,
            batch_number_to: r.up_to_last_batch ? batchNumbers[batchNumbers.length - 1] : r.batch_number_to,
            pack_code_id: r.pack_code_id,
            outer_unit_per_batch: Number(r.outer_unit_per_batch),
            storage_location_id: r.storage_location_id,
          })),
      };
      if (body.rows.length !== effectiveRows.length || !batchCoverage.complete) {
        pushToast("Every batch must be assigned exactly once before you continue.", "error");
        return;
      }
      onContinue(body.rows);
    } catch (error) {
      pushToast(error.message || "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() { if (batchCoverage.complete) doSave(); }

  if (planQ.isLoading) {
    return <div className="max-w-6xl px-1 py-6 text-sm text-slate-500">Loading packing plan...</div>;
  }
  if (planQ.isError) {
    return <div className="max-w-6xl px-1 py-6 text-sm text-rose-600">{planQ.error?.message || "Failed to load packing plan."}</div>;
  }

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 5</p>
          <h3 className="text-lg font-semibold text-slate-900">Batch to Pack-Size Planning</h3>
        </div>
        <span className="inline-flex rounded bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">CREATION SESSION</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">PO Number</div>
          <div className="mt-1 text-sm font-medium text-slate-900">Created only after Page 6</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Batch Range</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{header?.batch_number_from} - {header?.batch_number_to} ({header?.number_of_batches})</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Total Qty</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{formatPreciseNumber(totalQty, "0.###")} KG</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Planned So Far</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{formatPreciseNumber(runningVolume, "0.###")} KG</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">Remaining</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{formatPreciseNumber(shortfall, "0.###")} KG</div>
        </div>
      </div>

      {!batchCoverage.complete && effectiveRows.length > 0 && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Each batch in the selected range must be covered exactly once. Remove any overlap and fill every gap before continuing.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-800">Packing Rows</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b px-3 py-2 text-left">#</th>
                <th className="border-b px-3 py-2 text-left">From Batch</th>
                <th className="border-b px-3 py-2 text-left">To Batch</th>
                <th className="border-b px-3 py-2 text-left">Up to Last Batch</th>
                <th className="border-b px-3 py-2 text-right">Number of Batches</th>
                <th className="border-b px-3 py-2 text-left">Pack Size</th>
                <th className="border-b px-3 py-2 text-right">Outer Unit / Batch</th>
                <th className="border-b px-3 py-2 text-right">Total Outer Unit</th>
                <th className="border-b px-3 py-2 text-right">Total Inner Unit</th>
                <th className="border-b px-3 py-2 text-right">Volume (KG)</th>
                <th className="border-b px-3 py-2 text-left">Storage Location</th>
                <th className="border-b px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {effectiveRows.map((row, index) => {
                const metrics = rowMetrics[index];
                const batchOptions = batchOptionsFor(index);
                return (
                  <tr key={index} className="border-b border-slate-100">
                    <td className="border-b border-slate-100 px-3 py-2">{index + 1}</td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <ErpComboboxField
                        value={row.batch_number_from}
                        onChange={(value) => updateRow(index, { batch_number_from: value })}
                        options={batchOptions}
                        placeholder="-- From --"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <ErpComboboxField
                        value={row.up_to_last_batch ? (batchNumbers[batchNumbers.length - 1] || "") : row.batch_number_to}
                        onChange={(value) => updateRow(index, { batch_number_to: value })}
                        options={batchOptions}
                        placeholder="-- To --"
                        disabled={row.up_to_last_batch}
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={row.up_to_last_batch}
                        onChange={(event) => updateRow(index, { up_to_last_batch: event.target.checked })}
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{metrics.numberOfBatches || "--"}</td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <ErpComboboxField
                        value={row.pack_code_id}
                        onChange={(value) => updateRow(index, { pack_code_id: value })}
                        options={packSizeOptions.map((p) => ({ value: p.pack_code_id, label: p.description }))}
                        placeholder="-- Pack Size --"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right">
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                        value={row.outer_unit_per_batch}
                        onChange={(event) => updateRow(index, { outer_unit_per_batch: event.target.value })}
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(metrics.totalOuterUnit, "0.###")}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                      {!metrics.hasInner ? (
                        <span className="text-slate-400">N/A</span>
                      ) : metrics.totalInnerUnit != null ? (
                        <>
                          {formatPreciseNumber(metrics.totalInnerUnit, "0.###")} {metrics.pack.inner_uom_code}
                        </>
                      ) : (
                        <span className="text-amber-600" title="No is_primary_container PM line found on this SKU's Pack BOM">--</span>
                      )}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(metrics.volume, "0.###")}</td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <ErpComboboxField
                        value={row.storage_location_id}
                        onChange={(value) => updateRow(index, { storage_location_id: value })}
                        options={storageLocationOptions.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` }))}
                        placeholder="-- Storage Location --"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      {effectiveRows.length > 1 && (
                        <button type="button" onClick={() => removeRow(index)} className="text-xs text-slate-400 underline hover:text-rose-600">Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={addRow} className="text-sm text-sky-600 hover:text-sky-700">+ Add Row</button>
        </div>
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50">Back</button>
        <button
          type="button"
          disabled={saving || !batchCoverage.complete}
          onClick={handleSaveClick}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Checking..." : "Next: Page 6"}
        </button>
      </div>

    </div>
  );
}

// Page 6: combined PM auto-derive across every Page-5 row, then one atomic
// commit creates the parent MTS Process PO and every linked PMTS Packing PO.
// Groups are keyed by PM formulation material -- a PM item shared
// across pack sizes (Thread, Cable Tie...) shows ONCE with a combined
// Standard Qty; a pack-specific item (the outer bag) never merges since its
// own material_id differs per pack size. Same auto_derive_applicable
// row/override shape as Page 4's MtsMaterialPlanStep, but at PM-storage-
// location level (no machine bucket) and with Storage Location itself also
// editable per group (Page 4 only let Actual Material move within a group).
function MtsPackingCombineStep({ session, onBack, onDone }) {
  const qc = useQueryClient();
  const [overrides, setOverrides] = useState({}); // material_id -> { rows: [...], storage_location_id }
  const [saving, setSaving] = useState(false);
  const [deviationModal, setDeviationModal] = useState(null);

  const storageOverrides = useMemo(
    () => Object.fromEntries(Object.entries(overrides)
      .map(([materialId, override]) => [materialId, override?.storage_location_id])
      .filter(([, storageLocationId]) => Boolean(storageLocationId))),
    [overrides],
  );
  const combineQ = useQuery({
    queryKey: ["mts-creation-packing-combine", session.header, session.packingRows, storageOverrides],
    queryFn: () => previewMtsCreationPackingCombine({
      header: session.header,
      packing_rows: session.packingRows,
      storage_overrides: storageOverrides,
    }),
  });

  const rowsSummary = combineQ.data?.rows_summary ?? [];
  const groups = useMemo(() => combineQ.data?.groups ?? [], [combineQ.data]);
  const materials = combineQ.data?.materials ?? {};
  const storageLocations = combineQ.data?.storage_locations ?? {};
  const pmStorageLocationOptions = combineQ.data?.pm_storage_location_options ?? [];

  function materialLabel(id) {
    const m = materials[id];
    if (!m) return "--";
    return [m.pace_code, m.material_name].filter(Boolean).join(" - ") || "--";
  }
  function slocLabel(id) {
    const s = storageLocations[id];
    if (s) return [s.code, s.name].filter(Boolean).join(" - ") || "--";
    const opt = pmStorageLocationOptions.find((o) => o.id === id);
    return opt ? [opt.code, opt.name].filter(Boolean).join(" - ") : "--";
  }

  function overrideFor(group) {
    const override = overrides[group.material_id] ?? {};
    return {
      rows: Array.isArray(override.rows) ? override.rows : group.rows,
      storage_location_id: override.storage_location_id ?? group.storage_location_id,
    };
  }
  function rowsForGroup(group) {
    return overrideFor(group).rows;
  }
  function storageLocationForGroup(group) {
    return overrideFor(group).storage_location_id;
  }

  function setGroupOverride(group, patch) {
    setOverrides((current) => ({
      ...current,
      [group.material_id]: { ...(current[group.material_id] ?? {}), ...patch },
    }));
  }

  function handleSwapMaterial(group, rowIndex, newMaterialId) {
    const rows = rowsForGroup(group).map((r) => ({ ...r }));
    if (rows.some((r, i) => i !== rowIndex && r.actual_material_id === newMaterialId)) {
      pushToast("This material is already used in another row for this PM group.", "error");
      return;
    }
    rows[rowIndex] = { ...rows[rowIndex], actual_material_id: newMaterialId };
    setGroupOverride(group, { rows });
  }

  function handleQtyChange(group, rowIndex, qtyStr) {
    let rows = rowsForGroup(group).map((r) => ({ ...r }));
    const qty = Number(qtyStr) || 0;
    rows[rowIndex] = { ...rows[rowIndex], actual_qty: qty };
    // Same auto-vanish rule as Page 4 (§138.12 refinement): raising one row to
    // meet/exceed the group's own combined Standard Qty removes every sibling.
    if (qty >= group.standard_qty - EPSILON_FRONTEND) {
      rows = [rows[rowIndex]];
    }
    setGroupOverride(group, { rows });
  }

  function handleRemoveRow(group, rowIndex) {
    const rows = rowsForGroup(group).filter((_, i) => i !== rowIndex);
    setGroupOverride(group, { rows });
  }

  function handleStorageLocationChange(group, storageLocationId) {
    // Reset rows to the server-derived result for the newly selected location.
    // The query key above fetches it immediately, so Available/Short never
    // continue to show the previous location's numbers.
    setGroupOverride(group, { storage_location_id: storageLocationId, rows: null });
  }

  // `short` is calculated for the initial Pack-BOM location. Once the user
  // chooses a different location, the old result must not block Save; the
  // backend re-checks the selected location using fresh balances.
  const shortGroups = groups.filter((g) => g.short && storageLocationForGroup(g) === g.storage_location_id);

  // §138 deviation-confirm (2026-09-21): same symmetric over/under rule as
  // Page 4 -- a PM group's total departing from the combined Standard Qty is
  // a real production event, gated on explicit operator confirmation, never
  // silently blocked or silently accepted. Mirrors preparePmSelections()'s
  // server-side gate.
  function findDeviationGroups() {
    const found = [];
    for (const group of groups) {
      const rows = rowsForGroup(group);
      const total = rows.reduce((sum, r) => sum + (Number(r.actual_qty) || 0), 0);
      const deviation = Number((total - group.standard_qty).toFixed(6));
      if (Math.abs(deviation) > EPSILON_FRONTEND) {
        found.push({
          materialId: group.material_id,
          label: materialLabel(group.material_id),
          standardQty: group.standard_qty,
          actualQty: total,
          deviation,
        });
      }
    }
    return found;
  }

  function buildSaveBody(confirmDeviation) {
    return {
      groups: groups.map((group) => ({
        material_id: group.material_id,
        storage_location_id: storageLocationForGroup(group),
        rows: rowsForGroup(group).map((r) => ({ actual_material_id: r.actual_material_id, actual_qty: r.actual_qty })),
        confirmed_deviation: confirmDeviation === true,
      })),
    };
  }

  async function doSave(confirmDeviation) {
    setSaving(true);
    try {
      const body = buildSaveBody(confirmDeviation);
      const result = await commitMtsCreation({
        header: session.header,
        material_groups: session.materialGroups,
        packing_rows: session.packingRows,
        pm_groups: body.groups,
      });
      const packingCount = result?.packing_orders?.length ?? 0;
      pushToast(`MTS Process PO ${result?.po_number || ""} and ${packingCount} linked Packing PO(s) created atomically.`);
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["packing-orders"] });
      onDone();
    } catch (error) {
      const mustRestart = new Set([
        "PROD_MTS_INSUFFICIENT_STOCK",
        "PROD_MTS_MACHINE_BUCKET_SHORT",
        "PROD_BATCH_RANGE_DUPLICATE",
      ]).has(error?.code);
      pushToast(
        mustRestart
          ? "Stock or batch availability changed. Nothing was created; start a new MTS entry after arranging stock."
          : (error.message || "Save failed."),
        "error",
      );
      // The database transaction rolled back. Discard the browser-only session
      // too, so a shortage/range collision cannot turn into an implicit draft.
      if (mustRestart) onDone();
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (groups.some((g) => !storageLocationForGroup(g))) {
      pushToast("Select a Storage Location for every PM group before saving.", "error");
      return;
    }
    const deviations = findDeviationGroups();
    if (deviations.length > 0) {
      setDeviationModal({ deviations });
      return;
    }
    await doSave(false);
  }

  if (combineQ.isLoading) {
    return <div className="max-w-6xl px-1 py-6 text-sm text-slate-500">Loading combined PM plan...</div>;
  }
  if (combineQ.isError) {
    return <div className="max-w-6xl px-1 py-6 text-sm text-rose-600">{combineQ.error?.message || "Failed to load combined PM plan."}</div>;
  }

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 6</p>
          <h3 className="text-lg font-semibold text-slate-900">Combined PM Auto-Derive &amp; Atomic Document Create</h3>
        </div>
        <span className="inline-flex rounded bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">CREATION SESSION</span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-800">Page 5 Summary -- one Packing PO per row on atomic create</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b px-3 py-2 text-left">Pack Size</th>
                <th className="border-b px-3 py-2 text-left">Batch Sub-Range</th>
                <th className="border-b px-3 py-2 text-right">Total Outer Unit</th>
                <th className="border-b px-3 py-2 text-right">Volume (KG)</th>
              </tr>
            </thead>
            <tbody>
              {rowsSummary.map((r) => (
                <tr key={r.row_id} className="border-b border-slate-100">
                  <td className="border-b border-slate-100 px-3 py-2">{r.pack_size_label}</td>
                  <td className="border-b border-slate-100 px-3 py-2">{r.batch_number_from} - {r.batch_number_to} ({r.number_of_batches})</td>
                  <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(r.total_outer_unit, "0.###")}</td>
                  <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(r.volume, "0.###")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {shortGroups.length > 0 && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Insufficient PM stock (formulation + alternates combined) for: {shortGroups.map((g) => materialLabel(g.material_id)).join(", ")}.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-800">Combined PM Table</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b px-3 py-2 text-left">#</th>
                <th className="border-b px-3 py-2 text-left">Formulation Material</th>
                <th className="border-b px-3 py-2 text-left">Actual Material</th>
                <th className="border-b px-3 py-2 text-left">Storage Location</th>
                <th className="border-b px-3 py-2 text-right">Standard Qty</th>
                <th className="border-b px-3 py-2 text-right">Actual Qty</th>
                <th className="border-b px-3 py-2 text-right">Available</th>
                <th className="border-b px-3 py-2 text-left">Contributing Pack Sizes</th>
                <th className="border-b px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">No PM lines found across the planned pack sizes.</td>
                </tr>
              ) : groups.flatMap((group, groupIndex) => {
                const rows = rowsForGroup(group);
                const usedIds = new Set(rows.map((r) => r.actual_material_id));
                const groupStorageLocationId = storageLocationForGroup(group);
                return rows.map((row, rowIndex) => {
                  const rowKey = `${group.material_id}-${rowIndex}`;
                  const materialOptions = group.group_member_ids.map((id) => ({
                    value: id,
                    label: materialLabel(id),
                    disabled: usedIds.has(id) && id !== row.actual_material_id,
                  }));
                  const isFirstRow = rowIndex === 0;
                  return (
                    <tr key={rowKey} className={group.short && groupStorageLocationId === group.storage_location_id ? "bg-rose-50" : "border-b border-slate-100"}>
                      <td className="border-b border-slate-100 px-3 py-2">{isFirstRow ? groupIndex + 1 : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{isFirstRow ? materialLabel(group.material_id) : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        <ErpComboboxField
                          value={row.actual_material_id}
                          onChange={(value) => handleSwapMaterial(group, rowIndex, value)}
                          options={materialOptions}
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {isFirstRow ? (
                          <ErpComboboxField
                            value={groupStorageLocationId || ""}
                            onChange={(value) => handleStorageLocationChange(group, value)}
                            options={pmStorageLocationOptions.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` }))}
                            placeholder="-- Storage Location --"
                          />
                        ) : slocLabel(groupStorageLocationId)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{isFirstRow ? formatPreciseNumber(group.standard_qty, "0.###") : ""}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                        <input
                          type="number"
                          step="0.001"
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                          value={row.actual_qty}
                          onChange={(event) => handleQtyChange(group, rowIndex, event.target.value)}
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{formatPreciseNumber(row.available_qty, "0.###")}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                        {isFirstRow ? group.contributing.map((c) => c.pack_size_label).join(", ") : ""}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {group.short ? <span className="text-rose-600">Short</span> : ""}
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(group, rowIndex)}
                            className="ml-2 text-xs text-slate-400 underline hover:text-rose-600"
                            title="Remove this row"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50">Back</button>
        <button
          type="button"
          disabled={saving || shortGroups.length > 0}
          onClick={handleSave}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Creating..." : `Create Process PO + ${rowsSummary.length || ""} Packing PO(s)`}
        </button>
      </div>

      <BlockingLayer
        visible={!!deviationModal}
        onEscape={() => setDeviationModal(null)}
        overlayStyle={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 1000100, display: "flex", alignItems: "center", justifyContent: "center" }}
        dialogStyle={{ background: "white", borderRadius: 4, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 16, width: 480, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <p className="text-sm font-semibold text-slate-700">PM quantity differs from Standard Qty</p>
        <p className="text-xs text-slate-500">
          One or more PM groups below do not exactly match the combined Standard Qty. This can be a
          deliberate alternate-material substitution or a real over/under issue -- confirm to create
          the documents, or Cancel to adjust the rows first.
        </p>
        <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left">Material</th>
                <th className="px-2 py-1 text-right">Standard</th>
                <th className="px-2 py-1 text-right">Actual</th>
                <th className="px-2 py-1 text-right">Deviation</th>
              </tr>
            </thead>
            <tbody>
              {(deviationModal?.deviations ?? []).map((d) => (
                <tr key={d.materialId} className="border-t border-slate-100">
                  <td className="px-2 py-1">{d.label}</td>
                  <td className="px-2 py-1 text-right">{formatStockQty(d.standardQty)}</td>
                  <td className="px-2 py-1 text-right">{formatStockQty(d.actualQty)}</td>
                  <td className={`px-2 py-1 text-right font-medium ${d.deviation > 0 ? "text-amber-600" : "text-rose-600"}`}>
                    {d.deviation > 0 ? "+" : ""}{formatStockQty(d.deviation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button type="button" className="text-xs text-slate-500 px-3 py-1" onClick={() => setDeviationModal(null)}>Cancel</button>
          <button
            type="button"
            className="text-xs bg-sky-600 text-white rounded px-3 py-1"
            onClick={() => { setDeviationModal(null); doSave(true); }}
          >
            Confirm & Create
          </button>
        </div>
      </BlockingLayer>
    </div>
  );
}
