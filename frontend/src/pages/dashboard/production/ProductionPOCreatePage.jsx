/*
 * File-ID: 27.FE-PR09
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: FRONT
 * Purpose: Create new Process PO or Packing PO (Standard Create - both PO types).
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  availabilityPreviewPackingOrder,
  availabilityPreviewProcessOrder,
  createPackingOrder,
  createProcessOrder,
  getPackBom,
  getStrokeMaster,
  listPackBoms,
  listPackCodes,
  listSegmentLocations,
  listStrokeMasters,
} from "./prodApi.js";
import {
  addMaterialCategoryMember,
  createMaterialCategoryGroup,
  listMachines,
  listMaterialCategoryGroups,
  listMaterials,
  listStorageLocations,
} from "../om/omApi.js";
import { packingPoTypeForProcessType } from "./productionTypeLabels.js";
import { GroupCreateModal, MemberAddModal } from "./strokeShared.jsx";

const PROCESS_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const MTS_SEGMENTS = ["IWC", "POWDER"];
const PACKING_SOURCE_TYPES = ["MTO", "HPS", "MTS", "ZTEST"];
const TABS = ["Process PO", "Packing PO"];

const EMPTY_PROCESS = {
  company_id: "",
  po_type: "MTO",
  prodshade_material_id: "",
  stroke_master_id: "",
  machine_id: "",
  planned_qty_kg: "",
  planned_start_date: "",
  mts_segment_code: "",
};

const EMPTY_PACKING = {
  company_id: "",
  source_po_type: "MTO",
  material_id: "",
  num_packs: "",
  fill_qty_per_pack: "",
  pm_lines: [],
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
  return [prodCode, shadeCode, materialName]
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
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "-";
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

function deriveSegmentCode(poType, mtsSegmentCode) {
  if (poType === "MTO") return "ADMIX";
  if (poType === "HPS") return "HPS";
  if (poType === "INT") return "INT";
  if (poType === "MTS") return mtsSegmentCode || "";
  return "";
}

function buildOutputReferenceValue(value) {
  return value || "--";
}

export default function ProductionPOCreatePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [processStep, setProcessStep] = useState(1);
  const [processForm, setProcessForm] = useState({ ...EMPTY_PROCESS });
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

  const materialsQ = useMaterialOptionsQuery({ status: "ACTIVE", limit: 500 });
  const materialRows = materialsQ.materials ?? [];
  const materialById = useMemo(
    () => new Map(materialRows.map((material) => [material.id, material])),
    [materialRows],
  );

  const approvedStrokesQ = useQuery({
    queryKey: ["production-create-approved-strokes", effectiveCompanyId],
    queryFn: () => listStrokeMasters({
      company_id: effectiveCompanyId || undefined,
      status: "APPROVED",
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

  const fgMaterialOptions = useMemo(
    () => materialRows
      .filter((material) => String(material.material_type || "").toUpperCase() === "FG")
      .map((material) => ({
        value: material.id,
        label: materialLabel(material) || "SKU",
      })),
    [materialRows],
  );

  const prodshadeOptions = useMemo(() => {
    const approvedRows = approvedStrokes.filter((stroke) => {
      const strokePoType = String(stroke.po_type || "").toUpperCase();
      const materialType = String(stroke.material?.material_type || "").toUpperCase();

      if (processForm.po_type === "MTEST") {
        return materialType === "SFG" || strokePoType === "INT";
      }

      return strokePoType === String(processForm.po_type || "").toUpperCase();
    });

    const seenApproved = new Set();
    const approvedOptions = [];
    approvedRows.forEach((item) => {
      const materialId = String(item.material_id || "");
      if (!materialId || seenApproved.has(materialId)) return;
      seenApproved.add(materialId);
      approvedOptions.push({ value: materialId, label: prodshadeLabel(item) || "Material" });
    });

    if (processForm.po_type !== "MTEST") return approvedOptions;

    const seen = new Set(approvedOptions.map((option) => option.value));
    const merged = [...approvedOptions];
    for (const option of fgMaterialOptions) {
      if (!seen.has(option.value)) merged.push(option);
    }
    return merged;
  }, [approvedStrokes, fgMaterialOptions, processForm.po_type]);

  const selectedMaterial = materialById.get(processForm.prodshade_material_id) ?? null;
  const selectedMaterialType = String(selectedMaterial?.material_type || "").toUpperCase();
  const derivedSegmentCode = deriveSegmentCode(processForm.po_type, processForm.mts_segment_code);
  const machineRequired = ["MTO", "HPS", "MTS", "INT"].includes(processForm.po_type);
  const mtestSkuPath = processForm.po_type === "MTEST" && selectedMaterialType === "FG";

  const strokesQ = useQuery({
    queryKey: ["production-create-strokes", effectiveCompanyId, processForm.prodshade_material_id],
    queryFn: () => listStrokeMasters({
      company_id: effectiveCompanyId || undefined,
      material_id: processForm.prodshade_material_id || undefined,
      status: "APPROVED",
    }),
    enabled: Boolean(effectiveCompanyId && processForm.prodshade_material_id && !mtestSkuPath),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const strokeOptions = useMemo(
    () => (strokesQ.data ?? [])
      .filter((stroke) => {
        if (processForm.po_type === "MTEST") {
          const strokePoType = String(stroke.po_type || "").toUpperCase();
          return strokePoType === "MTEST" || strokePoType === "INT";
        }
        return String(stroke.po_type || "").toUpperCase() === String(processForm.po_type || "").toUpperCase();
      })
      .map((stroke) => ({ value: stroke.id, label: strokeLabel(stroke) })),
    [processForm.po_type, strokesQ.data],
  );

  const strokeDetailQ = useQuery({
    queryKey: ["production-create-stroke-detail", processForm.stroke_master_id],
    queryFn: () => getStrokeMaster(processForm.stroke_master_id),
    enabled: Boolean(processForm.stroke_master_id),
  });

  const machinesQ = useQuery({
    queryKey: ["production-create-machines", effectiveCompanyId],
    queryFn: () => listMachines({ company_id: effectiveCompanyId, active: true }),
    enabled: Boolean(effectiveCompanyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });

  // §108.2 item 3 — MTS/IWC Batch Qty is entered in Liter, RM calc needs KG.
  // Source of truth: the selected Stroke's own conversion_uom_code/conversion_factor
  // (§83.3 — "Conversion Factor = KG per Litre (density-based)", captured at Stroke
  // Master create/approve, StrokeMasterPage.jsx). By processStep 3 the Stroke (step 2)
  // is already selected, so strokeDetailQ is already loaded — no separate lookup needed.
  const strokeConversionFactor = Number(strokeDetailQ.data?.conversion_factor);
  const literToKgFactor = processForm.po_type === "MTS"
    && strokeDetailQ.data?.conversion_uom_code
    && Number.isFinite(strokeConversionFactor)
    && strokeConversionFactor > 0
    ? strokeConversionFactor
    : null;
  const literConversionMissing = processForm.po_type === "MTS"
    && Boolean(processForm.stroke_master_id)
    && !strokeDetailQ.isLoading
    && literToKgFactor === null;
  const machineOptions = useMemo(
    () => (machinesQ.data ?? []).map((machine) => ({ value: machine.id, label: machineLabel(machine) || "Machine" })),
    [machinesQ.data],
  );

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
  const packingSkuOptions = useMemo(
    () => (packingActiveBomsQ.data ?? []).map((bom) => ({ value: bom.sku_material_id, label: materialLabel(bom.sku) || "SKU" })),
    [packingActiveBomsQ.data],
  );
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
  const packingPmBomLines = packingBomLines.filter((line) => line.line_type === "INPUT");

  const packCodesQ = useQuery({
    queryKey: ["packing-create-pack-codes"],
    queryFn: () => listPackCodes(),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const packingBomRequired = useMemo(() => {
    const packCode = (packCodesQ.data ?? []).find((pc) => pc.pack_code === packingSku?.pack_code);
    return packCode ? packCode.bom_required !== false : true;
  }, [packCodesQ.data, packingSku?.pack_code]);

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
  const packingSfgQtyPerPack = packingBomRequired ? Number(packingSfgLine?.qty || 0) : packingFillQtyPerPack;
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

  // 599/000/001 (bomRequired=false): Pack BOM carries no PM lines at all for
  // these pack codes (§83.15 "PM optional/zero") — the user adds fresh lines
  // here, exactly like Process PO's own manual RM/PM entry pattern.
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
    () => strokeLines.map((line) => {
      const selectedStorageLocationId = lineLocationOverrides[line.material_id] || line.default_storage_location_id || "";
      const plannedQty = (Number(line.dosage_pct ?? 0) / 100) * Number(processForm.planned_qty_kg || 0);
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
    }),
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
    enabled: Boolean(
      effectiveCompanyId
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
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function resetProcess(next = {}) {
    setProcessForm({ ...EMPTY_PROCESS, ...next });
    setProcessStep(1);
    setLineActualMaterialOverrides({});
    setLineLocationOverrides({});
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
      }
      if (field === "po_type") {
        next.prodshade_material_id = "";
        next.stroke_master_id = "";
        next.machine_id = "";
        next.mts_segment_code = "";
        next.planned_qty_kg = "";
      }
      if (field === "prodshade_material_id") {
        next.stroke_master_id = "";
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
    if (mtestSkuPath) {
      setProcessStep(3);
      return;
    }
    setProcessStep(2);
  }

  function handleStepTwoNext() {
    if (processForm.po_type !== "MTEST" && !processForm.stroke_master_id) {
      toast("Stroke is required for this Process PO type.", "error");
      return;
    }
    setProcessStep(3);
  }

  async function handleCreateProcess(event) {
    event.preventDefault();

    if (processForm.po_type === "MTEST") {
      toast("MTEST create remains blocked here because the locked brief/frontend contract does not define the full create payload for this repo.", "error");
      return;
    }
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
    if (shortLineNumbers.length > 0) {
      toast(`Create is blocked. Short stock on line(s): ${shortLineNumbers.join(", ")}.`, "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        company_id: effectiveCompanyId,
        po_type: processForm.po_type,
        segment_code: derivedSegmentCode,
        prodshade_material_id: processForm.prodshade_material_id,
        machine_id: processForm.machine_id || undefined,
        stroke_master_id: processForm.stroke_master_id,
        planned_qty_kg: Number(processForm.planned_qty_kg),
        planned_start_date: processForm.planned_start_date || undefined,
        line_location_overrides: previewRowsWithAvailability
          .filter((row) => (row.storage_location_id && row.storage_location_id !== row.default_storage_location_id) || row.actual_material_id)
          .map((row) => ({
            material_id: row.material_id,
            actual_material_id: row.actual_material_id || undefined,
            storage_location_id: row.storage_location_id,
          })),
      };
      const result = await createProcessOrder(payload);
      toast(`Process PO created${result?.po_number ? `: ${result.po_number}` : "."}`);
      resetProcess({ company_id: defaultCompanyId || "" });
      qc.invalidateQueries({ queryKey: ["process-orders"] });
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
    if (!packingBomRequired && !packingFillQtyPerPack) {
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
        fill_qty_per_pack: packingBomRequired ? undefined : packingFillQtyPerPack,
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
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
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

        {activeTab === 0 && (
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
                      options={PROCESS_TYPES.map((type) => ({ value: type, label: type }))}
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
                      Stroke
                      {processForm.po_type === "MTEST" ? <span className="text-slate-400"> (optional)</span> : <span className="text-rose-500"> *</span>}
                    </label>
                    <ErpComboboxField
                      value={processForm.stroke_master_id}
                      onChange={(value) => updateProcess("stroke_master_id", value)}
                      options={strokeOptions}
                      placeholder={processForm.po_type === "MTEST" ? "-- Optional stroke --" : "-- Select stroke --"}
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
                    <h3 className="text-lg font-semibold text-slate-900">Header + Material Table</h3>
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
                    <div className="text-xs font-medium text-slate-500">Batch Number</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">--</div>
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
                      <label className="text-xs font-medium text-slate-600">Segment <span className="text-rose-500">*</span></label>
                      <ErpComboboxField
                        value={processForm.mts_segment_code}
                        onChange={(value) => updateProcess("mts_segment_code", value)}
                        options={MTS_SEGMENTS.map((segment) => ({ value: segment, label: segment }))}
                        placeholder="-- Select segment --"
                      />
                    </div>
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
                    </div>
                  )}

                  {processForm.po_type === "MTS" ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">Batch Size (Liter) <span className="text-rose-500">*</span></label>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                          value={batchQtyLiter}
                          disabled={!processForm.stroke_master_id || literConversionMissing || strokeDetailQ.isLoading}
                          onChange={(event) => {
                            const literValue = event.target.value;
                            setBatchQtyLiter(literValue);
                            const liters = Number(literValue);
                            if (literToKgFactor && Number.isFinite(liters) && liters > 0) {
                              updateProcess("planned_qty_kg", (liters * literToKgFactor).toFixed(4));
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
                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900">
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
                        step="0.01"
                        className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                        value={processForm.planned_qty_kg}
                        onChange={(event) => updateProcess("planned_qty_kg", event.target.value)}
                        required
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Planned Start Date</label>
                    <input
                      type="date"
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={processForm.planned_start_date}
                      onChange={(event) => updateProcess("planned_start_date", event.target.value)}
                    />
                  </div>
                </div>

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
                              <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.dosage_pct.toFixed(3)}</td>
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
                              <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">{row.standard_qty.toFixed(3)}</td>
                              <td className="border-b border-slate-100 px-3 py-2">P261</td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right font-mono">
                                {row.available_qty == null ? "--" : row.available_qty.toFixed(3)}
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

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setProcessStep(processForm.po_type === "MTEST" && mtestSkuPath ? 1 : 2)}
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
                      disabled={saving || shortLineNumbers.length > 0}
                      className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                    >
                      {saving ? "Creating..." : "Create Process PO"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
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
                  {!packingBomRequired && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Fill Qty Per Pack (KG) <span className="text-rose-500">*</span></label>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                        value={packingForm.fill_qty_per_pack}
                        onChange={(event) => setPackingForm((current) => ({ ...current, fill_qty_per_pack: event.target.value }))}
                        required
                      />
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-400">Planned SFG Qty</p>
                    <p className="font-mono font-semibold">{qtyFmt(packingPlannedQtyKg)} KG</p>
                  </div>
                </div>

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
                        <td className="px-3 py-2">{materialLabel(packingSfgLine?.material) || "--"}</td>
                        <td className="px-3 py-2">{slocLabel(packingSfgLine?.storage_location) || "--"}</td>
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
                                <td className="px-3 py-2 text-right font-mono">{line.available_qty == null ? "--" : qtyFmt(line.available_qty)}</td>
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
                                    step="0.001"
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
                                <td className="px-3 py-2 text-right font-mono">{line.available_qty == null ? "--" : qtyFmt(line.available_qty)}</td>
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
    </ErpScreenScaffold>
  );
}
