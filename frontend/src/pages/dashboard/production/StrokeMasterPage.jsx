/*
 * File-ID: 27.FE-01
 * File-Path: frontend/src/pages/dashboard/production/StrokeMasterPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Stroke Master list + create/edit/approve in right drawer.
 *          DRAFT = QA edits, APPROVED = Manager saves (= ACTIVE). Manager can
 *          Deactivate an APPROVED stroke (terminal) or Revert to DRAFT.
 *          See feasibility doc Section 83.3 (revised 2026-06-30).
 *
 * Prodshade can be an existing SFG/INT material or a brand-new Prod+Shade
 * (Material Master is created on Approve, not on Save Draft — 83.3 rule).
 *
 * Known deviation from the 83.3 lock (deferred, not built in this pass):
 *  - OUTPUT line is shown as a computed header summary, not a literal
 *    stroke_line row.
 */

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import {
  listStrokeMasters, getStrokeMaster, createStrokeMaster,
  updateStrokeMaster, approveStrokeMaster, revertStrokeMaster,
  rejectStrokeMaster, deactivateStrokeMaster, reactivateStrokeMaster,
  shareStrokeMaster, listMtsCurrentStroke, setMtsCurrentStroke,
} from "./prodApi.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { listMaterials, listUoms, listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember, listStorageLocations } from "../om/omApi.js";
import { useMenu } from "../../../context/useMenu.js";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpCompanySelector from "../../../components/inputs/ErpCompanySelector.jsx";
import {
  MATERIAL_TYPE_OPTIONS, PO_TYPE_OPTIONS_BY_MATERIAL_TYPE, EMPTY_LINE,
  friendlyStrokeErr, dosageSumOf, renderDrawerActions, Field,
  StrokeLinesTable, GroupCreateModal, MemberAddModal,
} from "./strokeShared.jsx";
import { formatPreciseNumber, formatSum } from "./productionPrecision.js";
import { getManualDocumentDateBounds, isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../../utils/manualDocumentDateWindow.js";
import SalesReturnPendingButton from "./SalesReturnPendingButton.jsx";

const EMPTY_ARRAY = [];
const COMMUNICATION_TYPE_OPTIONS = [
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "VERBAL_COMMUNICATION", label: "Verbal Communication" },
];
const COMMUNICATION_DATE_BOUNDS = getManualDocumentDateBounds();
const SHAREABLE_PO_TYPE_OPTIONS = [
  { value: "MTO", label: "MTO" },
  { value: "HPS", label: "HPS" },
  { value: "MTS", label: "MTS" },
  { value: "MTEST", label: "MTEST" },
];

const STATUS_BADGE = {
  DRAFT:       "bg-amber-100 text-amber-800",
  APPROVED:    "bg-emerald-100 text-emerald-800",
  DEACTIVATED: "bg-slate-200 text-slate-500",
};

const friendlyErr = friendlyStrokeErr;

export default function StrokeMasterPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create"); // create | detail
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEditLines, setDetailEditLines] = useState(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareForm, setShareForm] = useState({
    company_id: "", from_po_type: "", to_po_type: "", prodshade_material_id: "", stroke_master_id: "", consider_formulation_changes: false,
  });

  // MTS "Current Stroke" drawer — separate from Stroke Share, MTS-only.
  const [currentStrokeOpen, setCurrentStrokeOpen] = useState(false);
  const [currentStrokeCompanyId, setCurrentStrokeCompanyId] = useState("");
  const [currentStrokeSearch, setCurrentStrokeSearch] = useState("");
  // Staged (unsaved) picks: { [prodshade_material_id]: newStrokeNumber }. Kept
  // independent of the filtered/visible row list on purpose -- changing the
  // search box must never drop an edit made while a different filter was
  // active. Cleared on open and on Company switch (a different company's
  // rows have nothing to do with a pending edit made against another one).
  const [currentStrokePending, setCurrentStrokePending] = useState({});
  const [currentStrokeSaving, setCurrentStrokeSaving] = useState(false);

  const [form, setForm] = useState({
    company_id: "", material_type: "SFG", po_type: "", prodshade_mode: "existing",
    prodshade_material_id: "", prod_code: "", shade_code: "",
    stroke_number: "", description: "", base_uom_code: "", conversion_uom_code: "", conversion_factor: "",
    default_storage_location_id: "",
    communication_date: "", communication_type: "", communicator_name: "", communication_reference: "",
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  // Inline "create group" mini-form state
  const [groupModal, setGroupModal] = useState(null); // { onCreated } | null
  const [groupForm, setGroupForm] = useState({ group_name: "", description: "" });
  const [memberModal, setMemberModal] = useState(null); // groupId | null
  const [memberMaterialId, setMemberMaterialId] = useState("");

  const firstInputRef = useRef(null);

  // business owner, 2026-09-26: found live -- this was declared much lower
  // in the file (right before companyOptions) but strokesQ below reads it
  // immediately, so every render threw "Cannot access 'effectiveCompanyFilter'
  // before initialization" (a const's temporal dead zone) and blanked the
  // whole page. Moved above every hook that reads it.
  const effectiveCompanyFilter = companyFilter || resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => {
    if (!companyFilter && effectiveCompanyFilter) setCompanyFilter(effectiveCompanyFilter);
  }, [companyFilter, effectiveCompanyFilter]);

  const strokesQ = useQuery({
    queryKey: ["prod-stroke-masters", effectiveCompanyFilter, statusFilter],
    queryFn: () => listStrokeMasters({ company_id: effectiveCompanyFilter || undefined, status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });
  const createCompanyStrokesQ = useQuery({
    queryKey: ["prod-stroke-masters-create-check", form.company_id],
    queryFn: () => listStrokeMasters({ company_id: form.company_id || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: Boolean(form.company_id),
  });
  const shareSourceStrokesQ = useQuery({
    queryKey: ["prod-stroke-share-sources", shareForm.company_id, shareForm.from_po_type],
    queryFn: () => listStrokeMasters({ company_id: shareForm.company_id, status: "APPROVED" }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: Boolean(shareOpen && shareForm.company_id && shareForm.from_po_type),
  });
  const mtsCurrentStrokeQ = useQuery({
    queryKey: ["prod-mts-current-stroke", currentStrokeCompanyId],
    queryFn: () => listMtsCurrentStroke(currentStrokeCompanyId),
    // fetchProd already unwraps to { stroke_numbers, rows } directly (no
    // `pagination` key on this response) -- do NOT read `.data` again here,
    // that's the exact double-unwrap bug class (11-bug #15): it would leave
    // this query permanently resolving to the empty fallback.
    select: (d) => d ?? { stroke_numbers: [], rows: [] },
    enabled: Boolean(currentStrokeOpen && currentStrokeCompanyId),
    // The global queryClient default staleTime (60s) is wrong for this
    // drawer specifically -- it's a live multi-user edit surface (another
    // QA user, or an approve/deactivate/revert elsewhere, can change the
    // Current Stroke between visits), so every open must hit the server,
    // never serve a same-session cached copy.
    staleTime: 0,
  });

  const companies = buildTransactionCompanyList(runtimeContext);
  const uomsQ = useQuery({ queryKey: ["om-uoms"], queryFn: () => listUoms({ is_active: true, limit: 500 }), select: (d) => d?.data ?? [] });
  // Storage locations and Material Groups are both scoped to whichever
  // company is in play: the create form's company while creating, or the
  // stroke's own (immutable) company while viewing/editing an existing DRAFT.
  const activeCompanyId = drawerMode === "create" ? form.company_id : (detail?.company_id ?? "");
  const groupsQ = useQuery({
    queryKey: ["om-material-groups", activeCompanyId],
    queryFn: () => listMaterialCategoryGroups(activeCompanyId),
    select: (d) => d?.data ?? [],
    enabled: Boolean(activeCompanyId),
  });
  // Company-scoped (via material_company_ext, same as every other picker in
  // this app) -- previously these three passed no company_id at all, so the
  // Prodshade/RM/INT pickers dumped every company's materials into one list
  // (191+ SFG rows company-wide in Prod). Falls back to the unscoped global
  // list only before a company is actually chosen (activeCompanyId empty).
  const sfgMaterialsQ = useQuery({
    queryKey: ["om-materials", "SFG", activeCompanyId],
    queryFn: () => listMaterials({ material_type: "SFG", limit: 500, company_id: activeCompanyId || undefined }),
    select: (d) => d?.data ?? [],
  });
  const intMaterialsQ = useQuery({
    queryKey: ["om-materials", "INT", activeCompanyId],
    queryFn: () => listMaterials({ material_type: "INT", limit: 500, company_id: activeCompanyId || undefined }),
    select: (d) => d?.data ?? [],
  });
  const rmMaterialsQ = useQuery({
    queryKey: ["om-materials", "RM", activeCompanyId],
    queryFn: () => listMaterials({ material_type: "RM", limit: 500, company_id: activeCompanyId || undefined }),
    select: (d) => d?.data ?? [],
  });

  const storageLocationsQ = useQuery({
    queryKey: ["om-storage-locations", activeCompanyId],
    queryFn: () => listStorageLocations({ company_id: activeCompanyId, is_active: true }),
    select: (d) => d?.data ?? [],
    enabled: Boolean(activeCompanyId),
  });

  const uoms = uomsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const storageLocations = storageLocationsQ.data ?? [];
  const prodshadeMaterialsByType = { SFG: sfgMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };
  const lineMaterialsByType = { RM: rmMaterialsQ.data ?? [], INT: intMaterialsQ.data ?? [] };

  const companyOptions = companies.map((c) => ({ value: c.id, label: `${c.company_code} — ${c.company_name}` }));
  const uomOptions = uoms.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }));
  const storageLocationOptions = storageLocations.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
  // §131.3 (2026-08-26): MTEST strokes' SFG output location is always L003 (ADMIX
  // LAB), backend-enforced (createStrokeMasterHandler/updateStrokeMasterHandler both
  // hard-block anything else) — narrow the picker to just that option so a QA user
  // can't accidentally pick something the backend will reject anyway.
  const l003Location = storageLocations.find((s) => String(s.code ?? "").toUpperCase() === "L003") ?? null;
  const isMtestStroke = form.po_type === "MTEST";
  const strokeStorageLocationOptions = isMtestStroke && l003Location
    ? [{ value: l003Location.id, label: `${l003Location.code} — ${l003Location.name}` }]
    : storageLocationOptions;
  // Label includes document_name (the human-recognizable product description,
  // e.g. "TRUCARE WALL PUTTY WHITE") alongside pace_code/material_name -- the
  // combobox's own search only matches against the label text, and
  // material_name alone is often just an internal numeric code, not
  // something a user would actually type to find a material.
  const prodshadeOptions = (prodshadeMaterialsByType[form.material_type] ?? []).map((m) => ({
    value: m.id,
    label: [m.pace_code ?? "—", m.material_name, m.document_name].filter(Boolean).join(" — "),
  }));
  // Existing Prodshade's Description is its own Material Master document_name --
  // pulled from the list, never re-typed, so a user picking an existing SFG/INT
  // can't accidentally save a different description than what Master already has.
  const prodshadeDocumentNameById = new Map(
    (prodshadeMaterialsByType[form.material_type] ?? []).map((m) => [String(m.id), m.document_name || ""]),
  );

  const createCheckStrokes = createCompanyStrokesQ.data ?? [];
  // Uppercased so MTS's alphanumeric codes (DOE1, DOE2...) dedupe the same way
  // regardless of case, matching the backend's own uppercase-normalize on save.
  const normalizedStrokeNumber = String(form.stroke_number ?? "").trim().toUpperCase();
  const normalizedProdCode = String(form.prod_code ?? "").trim().toUpperCase();
  const normalizedShadeCode = String(form.shade_code ?? "").trim().toUpperCase();
  const duplicateStroke = !form.company_id || !normalizedStrokeNumber
    ? null
    : createCheckStrokes.find((stroke) => {
        if (String(stroke.stroke_number ?? "").trim().toUpperCase() !== normalizedStrokeNumber) return false;
        if (form.prodshade_mode === "existing") {
          return String(stroke.prodshade_material_id ?? "") === String(form.prodshade_material_id ?? "");
        }
        return String(stroke.prod_code ?? "").trim().toUpperCase() === normalizedProdCode
          && String(stroke.shade_code ?? "").trim().toUpperCase() === normalizedShadeCode;
      }) ?? null;
  const isDuplicateBlocked = Boolean(duplicateStroke);
  const hasCommunicationDetails = (data) => Boolean(
    data?.communication_date
    && data?.communication_type
    && String(data?.communicator_name || "").trim()
    && String(data?.communication_reference || "").trim(),
  );
  const shareSourceStrokes = (shareSourceStrokesQ.data ?? []).filter((stroke) => (
    stroke.material_type === "SFG" && String(stroke.po_type ?? "").toUpperCase() === shareForm.from_po_type
  ));
  const shareProdshadeOptions = useMemo(() => {
    const seen = new Set();
    return shareSourceStrokes.flatMap((stroke) => {
      const id = String(stroke.prodshade_material_id ?? "");
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const material = stroke.material ?? {};
      return [{ value: id, label: `${material.pace_code ?? ""} — ${material.material_name ?? `${stroke.prod_code ?? ""}${stroke.shade_code ?? ""}`}`.replace(/^\s*—\s*/, "") }];
    });
  }, [shareSourceStrokes]);
  const shareStrokeOptions = useMemo(() => shareSourceStrokes
    .filter((stroke) => String(stroke.prodshade_material_id ?? "") === shareForm.prodshade_material_id)
    .map((stroke) => ({ value: stroke.id, label: `Stroke ${stroke.stroke_number}${Number(stroke.revision_no ?? 1) > 1 ? ` (Rev ${stroke.revision_no})` : ""}${stroke.description ? ` — ${stroke.description}` : ""}` })),
  [shareForm.prodshade_material_id, shareSourceStrokes]);

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  function openCreate() {
    setDrawerMode("create");
    setAttemptedSave(false);
    setForm({
      company_id: effectiveCompanyFilter || "", material_type: "SFG", po_type: "", prodshade_mode: "existing",
      prodshade_material_id: "", prod_code: "", shade_code: "",
      stroke_number: "", description: "", base_uom_code: "", conversion_uom_code: "", conversion_factor: "",
      default_storage_location_id: "",
      communication_date: "", communication_type: "", communicator_name: "", communication_reference: "",
    });
    setLines([{ ...EMPTY_LINE }]);
    setDrawerOpen(true);
  }

  function openShare() {
    setShareForm({
      company_id: effectiveCompanyFilter || "", from_po_type: "", to_po_type: "", prodshade_material_id: "", stroke_master_id: "", consider_formulation_changes: false,
    });
    setShareOpen(true);
  }

  function updateShare(field, value) {
    setShareForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "company_id" || field === "from_po_type") {
        next.prodshade_material_id = "";
        next.stroke_master_id = "";
      }
      if (field === "prodshade_material_id") next.stroke_master_id = "";
      if (field === "from_po_type" && value === next.to_po_type) next.to_po_type = "";
      return next;
    });
  }

  async function handleShare() {
    if (!shareForm.company_id || !shareForm.from_po_type || !shareForm.to_po_type || !shareForm.stroke_master_id) {
      toast("Company, From PO Type, To PO Type, Prodshade, and Stroke are required.", "error");
      return;
    }
    setShareSaving(true);
    try {
      const { stroke_master_id, ...shareRequest } = shareForm;
      const result = await shareStrokeMaster({
        ...shareRequest,
        source_stroke_master_id: stroke_master_id,
      });
      const data = result?.data ?? result;
      await qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
      await qc.invalidateQueries({ queryKey: ["so05-pending-production", "STROKE"] });
      setShareOpen(false);
      if (data.created_draft) {
        toast("Target draft revision created. Update formulation, then save and approve it.");
        await openDetail(data.target_stroke_master_id);
      } else {
        toast("Stroke shared and active for the target PO Type.");
      }
    } catch (err) {
      toast(friendlyErr(err.code) || err.message, "error");
    } finally {
      setShareSaving(false);
    }
  }

  // Existing Prodshade already used in another Stroke for this company? Prefill
  // Default Storage Location from that prior entry — user can still override.
  function handleProdshadeSelect(materialId) {
    setForm((f) => {
      const prior = createCheckStrokes.find((s) => String(s.prodshade_material_id ?? "") === String(materialId));
      const documentName = prodshadeDocumentNameById.get(String(materialId)) ?? "";
      return {
        ...f,
        prodshade_material_id: materialId,
        default_storage_location_id: f.default_storage_location_id
          ? f.default_storage_location_id
          : (prior?.default_storage_location_id ? String(prior.default_storage_location_id) : f.default_storage_location_id),
        description: documentName,
      };
    });
  }

  async function openDetail(id) {
    setDrawerMode("detail");
    setAttemptedSave(false);
    setDetail(null);
    setDetailEditLines(null);
    setDetailLoading(true);
    setDrawerOpen(true);
    try {
      const d = await getStrokeMaster(id);
      setDetail(d);
      if (d.status === "DRAFT") {
        setDetailEditLines((d.lines ?? []).map((l) => ({
          line_material_type: l.line_material_type ?? "RM",
          material_id: l.material_id,
          dosage_pct: String(l.dosage_pct),
          has_alternate: Boolean(l.material_group_id),
          material_group_id: l.material_group_id ?? "",
          default_storage_location_id: l.default_storage_location_id ?? "",
        })));
      }
    } catch { toast("Failed to load stroke detail.", "error"); setDrawerOpen(false); }
    finally { setDetailLoading(false); }
  }

  function openCreateGroupModal(onCreated) {
    setGroupForm({ group_name: "", description: "" });
    setGroupModal({ onCreated });
  }

  async function handleCreateGroup() {
    if (!groupForm.group_name.trim()) { toast("Group name required.", "error"); return; }
    if (!activeCompanyId) { toast("Select a company first.", "error"); return; }
    try {
      const res = await createMaterialCategoryGroup({ ...groupForm, company_id: activeCompanyId });
      const newGroup = res?.data ?? res;
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      toast("Material group created.");
      groupModal?.onCreated?.(newGroup.id);
      setGroupModal(null);
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
  }

  async function handleAddMember() {
    if (!memberMaterialId) { toast("Select a material first.", "error"); return; }
    try {
      await addMaterialCategoryMember({ group_id: memberModal, material_id: memberMaterialId });
      await qc.invalidateQueries({ queryKey: ["om-material-groups"] });
      toast("Member added.");
      setMemberModal(null);
      setMemberMaterialId("");
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
  }

  function validateHeader(f) {
    if (!f.company_id || !f.stroke_number || !f.po_type || !f.base_uom_code) {
      toast("Company, Material Type, PO Type, Stroke number, and Base UOM are required.", "error");
      return false;
    }
    if (f.prodshade_mode === "existing" && !f.prodshade_material_id) {
      toast("Select an existing Prodshade, or switch to \"Create new Prodshade\".", "error");
      return false;
    }
    if (f.prodshade_mode === "new" && (!f.prod_code.trim() || !f.shade_code.trim())) {
      toast("Prod Code and Shade Code are required for a new Prodshade.", "error");
      return false;
    }
    if (!f.default_storage_location_id) {
      toast("Default Storage Location is required.", "error");
      return false;
    }
    if (!hasCommunicationDetails(f)) {
      toast("Communication Date, Type, Communicator Name, and Communication Reference are required.", "error");
      return false;
    }
    if (!isManualDocumentDateWithinWindow(f.communication_date)) {
      toast(MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE, "error");
      return false;
    }
    return true;
  }

  async function handleCreate(e) {
    e.preventDefault();
    setAttemptedSave(true);
    if (isDuplicateBlocked) {
      toast("Duplicate blocked: this Prodshade + Stroke Number combination already exists.", "error");
      return;
    }
    if (!validateHeader(form)) return;
    const sum = dosageSumOf(lines);
    if (lines.some((l) => l.material_id) && Math.abs(sum - 100) > 0.01) {
      toast(`Dosage must sum to 100. Current: ${formatSum(sum, "0")}%`, "error"); return;
    }
    setSaving(true);
    try {
      const isNewProdshade = form.prodshade_mode === "new";
      await createStrokeMaster({
        ...form,
        // Uppercased so MTS's alphanumeric codes (DOE1, DOE2...) are stored
        // consistently — matches the backend's own uppercase-normalize.
        stroke_number: form.stroke_number.trim().toUpperCase(),
        prodshade_material_id: isNewProdshade ? "" : form.prodshade_material_id,
        prod_code: isNewProdshade ? form.prod_code.trim().toUpperCase() : "",
        shade_code: isNewProdshade ? form.shade_code.trim().toUpperCase() : "",
        communication_date: form.communication_date,
        communication_type: form.communication_type,
        communicator_name: form.communicator_name.trim(),
        communication_reference: form.communication_reference.trim(),
        lines: lines.filter((l) => l.material_id).map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: parseFloat(l.dosage_pct),
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
          default_storage_location_id: l.default_storage_location_id || null,
        })),
      });
      toast("Stroke master created (DRAFT).");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
      qc.invalidateQueries({ queryKey: ["so05-pending-production", "STROKE"] });
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleSaveDraft() {
    setAttemptedSave(true);
    if (!hasCommunicationDetails(detail) || !isManualDocumentDateWithinWindow(detail.communication_date)) {
      toast(!hasCommunicationDetails(detail) ? "Communication Date, Type, Communicator Name, and Communication Reference are required." : MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE, "error");
      return;
    }
    if (!detail.default_storage_location_id) {
      toast("Default Storage Location is required.", "error");
      return;
    }
    const sum = dosageSumOf(detailEditLines);
    if (Math.abs(sum - 100) > 0.01) { toast(`Dosage must sum to 100. Current: ${formatSum(sum, "0")}%`, "error"); return; }
    setSaving(true);
    try {
      await updateStrokeMaster(detail.id, {
        description: detail.description,
        base_uom_code: detail.base_uom_code,
        conversion_uom_code: detail.conversion_uom_code,
        conversion_factor: detail.conversion_factor,
        default_storage_location_id: detail.default_storage_location_id,
        communication_date: detail.communication_date,
        communication_type: detail.communication_type,
        communicator_name: detail.communicator_name,
        communication_reference: detail.communication_reference,
        lines: detailEditLines.map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: parseFloat(l.dosage_pct),
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
          default_storage_location_id: l.default_storage_location_id || null,
        })),
      });
      toast("Draft saved.");
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
      qc.invalidateQueries({ queryKey: ["so05-pending-production", "STROKE"] });
      openDetail(detail.id);
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleSaveApproveDraft() {
    setAttemptedSave(true);
    if (!hasCommunicationDetails(detail) || !isManualDocumentDateWithinWindow(detail.communication_date)) {
      toast(!hasCommunicationDetails(detail) ? "Communication Date, Type, Communicator Name, and Communication Reference are required." : MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE, "error");
      return;
    }
    if (!detail.default_storage_location_id) {
      toast("Default Storage Location is required.", "error");
      return;
    }
    const sum = dosageSumOf(detailEditLines);
    if (Math.abs(sum - 100) > 0.01) {
      toast(`Dosage must sum to 100. Current: ${formatSum(sum, "0")}%`, "error");
      return;
    }
    setSaving(true);
    try {
      await updateStrokeMaster(detail.id, {
        description: detail.description,
        base_uom_code: detail.base_uom_code,
        conversion_uom_code: detail.conversion_uom_code,
        conversion_factor: detail.conversion_factor,
        default_storage_location_id: detail.default_storage_location_id,
        communication_date: detail.communication_date,
        communication_type: detail.communication_type,
        communicator_name: detail.communicator_name,
        communication_reference: detail.communication_reference,
        lines: detailEditLines.map((l) => ({
          material_id: l.material_id,
          line_material_type: l.line_material_type,
          dosage_pct: parseFloat(l.dosage_pct),
          material_group_id: l.has_alternate ? (l.material_group_id || null) : null,
          default_storage_location_id: l.default_storage_location_id || null,
        })),
      });
      await approveStrokeMaster(detail.id);
      toast("Stroke approved (ACTIVE).");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
      qc.invalidateQueries({ queryKey: ["so05-pending-production", "STROKE"] });
    } catch (err) {
      toast(friendlyErr(err.code) || err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(fn, id, successMsg) {
    setSaving(true);
    try {
      await fn(id);
      toast(successMsg);
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
      qc.invalidateQueries({ queryKey: ["so05-pending-production", "STROKE"] });
    } catch (err) { toast(friendlyErr(err.code) || err.message, "error"); }
    finally { setSaving(false); }
  }

  const strokes = strokesQ.data ?? EMPTY_ARRAY;
  // Current Stroke is MTS-only — the button (and drawer's own company
  // choices) only exist for companies that actually have an MTS stroke at
  // all, derived from the page's own already-loaded list (no extra query).
  const mtsCompanyIds = useMemo(
    () => [...new Set(strokes.filter((s) => s.po_type === "MTS").map((s) => String(s.company_id ?? "")))].filter(Boolean),
    [strokes],
  );
  const hasMtsProdshade = mtsCompanyIds.length > 0;
  const currentStrokeCompanyOptions = companyOptions.filter((c) => mtsCompanyIds.includes(c.value));

  function openCurrentStroke() {
    const defaultCompanyId = mtsCompanyIds.includes(companyFilter) ? companyFilter : (mtsCompanyIds[0] ?? "");
    setCurrentStrokeCompanyId(defaultCompanyId);
    setCurrentStrokeSearch("");
    setCurrentStrokePending({});
    setCurrentStrokeOpen(true);
  }

  function changeCurrentStrokeCompany(nextCompanyId) {
    setCurrentStrokeCompanyId(nextCompanyId);
    setCurrentStrokePending({});
  }

  // Stage a row's picked stroke number -- no network call here. Nothing
  // persists until Save Changes is clicked, so a user can edit many rows
  // (across any number of searches) and commit them all in one action.
  function stageCurrentStrokePick(prodshadeMaterialId, strokeNumber) {
    setCurrentStrokePending((prev) => ({ ...prev, [prodshadeMaterialId]: strokeNumber }));
  }

  const currentStrokePendingCount = Object.keys(currentStrokePending).length;

  async function handleSaveCurrentStrokes() {
    const entries = Object.entries(currentStrokePending);
    if (entries.length === 0) return;
    setCurrentStrokeSaving(true);
    // INDEPENDENT: each entry is a different Prodshade's own pick, unrelated
    // to any other row -- batch in parallel rather than one at a time.
    const results = await Promise.allSettled(
      entries.map(([prodshadeMaterialId, strokeNumber]) =>
        setMtsCurrentStroke({ company_id: currentStrokeCompanyId, prodshade_material_id: prodshadeMaterialId, stroke_number: strokeNumber })
          .then(() => ({ prodshadeMaterialId, strokeNumber })),
      ),
    );
    const succeeded = [];
    const failed = [];
    results.forEach((result, idx) => {
      if (result.status === "fulfilled") succeeded.push(result.value);
      else failed.push(entries[idx][0]);
    });

    if (succeeded.length > 0) {
      const succeededMap = new Map(succeeded.map((s) => [s.prodshadeMaterialId, s.strokeNumber]));
      // Patch the cache immediately with the known-correct new state -- the
      // grid must reflect it right away, not wait on a refetch race. This is
      // the exact query this drawer reads (same key/shape queryFn resolves
      // to, pre-`select`): { stroke_numbers, rows }.
      qc.setQueryData(["prod-mts-current-stroke", currentStrokeCompanyId], (old) => {
        if (!old?.rows) return old;
        return {
          ...old,
          rows: old.rows.map((row) => {
            const newNumber = succeededMap.get(row.prodshade_material_id);
            if (newNumber === undefined) return row;
            return {
              ...row,
              strokes: Object.fromEntries(
                Object.entries(row.strokes ?? {}).map(([number, cell]) => [number, { ...cell, current: number === newNumber }]),
              ),
            };
          }),
        };
      });
      // Backstop: also invalidate, so a stale/never-fetched cache entry (or
      // any drift from another user's concurrent change) still self-heals.
      await qc.invalidateQueries({ queryKey: ["prod-mts-current-stroke"] });
    }

    setCurrentStrokePending((prev) => {
      const next = { ...prev };
      for (const s of succeeded) delete next[s.prodshadeMaterialId];
      return next;
    });
    setCurrentStrokeSaving(false);

    if (failed.length === 0) toast(`Current Stroke updated for ${succeeded.length} Prodshade${succeeded.length === 1 ? "" : "s"}.`);
    else if (succeeded.length === 0) toast("Save failed for all changed rows.", "error");
    else toast(`${succeeded.length} saved, ${failed.length} failed -- retry the remaining row(s).`, "error");
  }

  const mtsCurrentStrokeData = mtsCurrentStrokeQ.data ?? { stroke_numbers: [], rows: [] };
  const filteredMtsCurrentStrokeRows = useMemo(() => {
    const needle = currentStrokeSearch.trim().toLowerCase();
    if (!needle) return mtsCurrentStrokeData.rows;
    return mtsCurrentStrokeData.rows.filter((row) => [
      row.pace_code, row.material_name, row.document_name, ...Object.keys(row.strokes ?? {}),
    ].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [mtsCurrentStrokeData.rows, currentStrokeSearch]);
  const mtsCurrentStrokeSearchOptions = useMemo(() => {
    const values = new Set();
    for (const row of mtsCurrentStrokeData.rows) {
      if (row.pace_code) values.add(row.pace_code);
      if (row.material_name) values.add(row.material_name);
      if (row.document_name) values.add(row.document_name);
      for (const number of Object.keys(row.strokes ?? {})) values.add(number);
    }
    return [...values];
  }, [mtsCurrentStrokeData.rows]);
  function currentStrokeNumberOf(row) {
    for (const [number, cell] of Object.entries(row.strokes ?? {})) if (cell?.current) return number;
    return null;
  }

  const mtsCurrentStrokeColumns = useMemo(() => [
    { key: "pace_code", label: "Prodshade", width: "150px", render: (row) => row.pace_code ?? "—" },
    { key: "material_name", label: "Name", width: "160px", render: (row) => row.material_name ?? "—" },
    { key: "document_name", label: "Description", width: "220px", render: (row) => row.document_name ?? "—" },
    {
      key: "current_stroke",
      label: "Current Stroke",
      width: "130px",
      render: (row) => currentStrokeNumberOf(row) ?? "—",
    },
    {
      key: "available_strokes",
      label: "Available Strokes",
      width: "220px",
      render: (row) => {
        const currentNumber = currentStrokeNumberOf(row);
        const availableNumbers = Object.keys(row.strokes ?? {});
        const options = availableNumbers.map((number) => ({
          value: number,
          label: number,
          disabled: number === currentNumber,
        }));
        const value = currentStrokePending[row.prodshade_material_id] ?? currentNumber ?? "";
        return (
          <ErpComboboxField
            value={value}
            onChange={(nextNumber) => stageCurrentStrokePick(row.prodshade_material_id, nextNumber)}
            options={options}
            hideBlank
            placeholder="-- Select --"
          />
        );
      },
    },
  ], [currentStrokePending]);

  const filteredStrokes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return strokes;
    return strokes.filter((s) => [
      s.stroke_number,
      s.material ? `${s.material.pace_code ?? ""} ${s.material.material_name ?? ""}` : `${s.prod_code ?? ""}${s.shade_code ?? ""}`,
      s.material_type, s.po_type, s.description, s.status, s.created_at?.slice(0, 10),
    ].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [strokes, search]);
  const actions = [
    ...(hasMtsProdshade ? [{ label: "Current Stroke", tone: "neutral", mnemonic: "U", onClick: openCurrentStroke }] : []),
    { label: "Stroke Share", tone: "neutral", mnemonic: "H", onClick: openShare },
    { label: "New Stroke", tone: "primary", mnemonic: "N", onClick: openCreate },
  ];

  return (
    <ErpScreenScaffold
      title="Stroke Master"
      subtitle="Define RM/INT dosage formulas per Prodshade (SFG/INT, PO Type-scoped)"
      actions={actions}
    >
      <div className="flex justify-end"><SalesReturnPendingButton companyId={effectiveCompanyFilter || companies[0]?.id || ""} kind="STROKE" /></div>
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap">
          <div className="w-64">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={effectiveCompanyFilter} onChange={setCompanyFilter} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Status</label>
            <select className="border border-slate-300 rounded px-2 py-1 text-sm h-7" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved (Active)</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </div>
          <div className="min-w-[280px] flex-1">
            <QuickFilterInput
              label="Quick Search"
              value={search}
              onChange={setSearch}
              placeholder="Search stroke #, prodshade, type, description, status..."
              hint="Matches any column below."
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title={`Strokes (${filteredStrokes.length}${filteredStrokes.length !== strokes.length ? ` of ${strokes.length}` : ""})`}>
        {strokesQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : strokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No strokes found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : filteredStrokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No rows match this search.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-left py-2 px-3 border-b">Prodshade</th>
                <th className="text-left py-2 px-3 border-b">Material Type</th>
                <th className="text-left py-2 px-3 border-b">PO Type</th>
                <th className="text-left py-2 px-3 border-b">Description</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
                <th className="text-left py-2 px-3 border-b">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredStrokes.map((s) => (
                <tr key={s.id} className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors" onClick={() => openDetail(s.id)}>
                  <td className="py-2 px-3 font-mono font-semibold">{s.stroke_number}</td>
                  <td className="py-2 px-3 text-slate-600">
                    {s.material ? `${s.material.pace_code ?? "—"} — ${s.material.material_name ?? "—"}` : `${s.prod_code ?? "—"}${s.shade_code ?? ""} (new, pending Approve)`}
                  </td>
                  <td className="py-2 px-3 text-slate-500">{s.material_type}</td>
                  <td className="py-2 px-3 text-slate-500">{s.po_type}</td>
                  <td className="py-2 px-3 text-slate-500">{s.description ?? "—"}</td>
                  <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[s.status] ?? ""}`}>{s.status}</span></td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{s.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      {/* Create Drawer */}
      <DrawerBase
        visible={drawerOpen && drawerMode === "create"}
        title="New Stroke Master"
        onClose={() => setDrawerOpen(false)}
        initialFocusRef={firstInputRef}
        side="center"
        width="min(1480px, calc(100vw - 24px))"
        actions={renderDrawerActions([
          { label: "Save Draft", tone: "primary", onClick: handleCreate, disabled: saving || isDuplicateBlocked || !hasCommunicationDetails(form) },
          { label: "Cancel", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ])}
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={form.company_id} onChange={(v) => setForm((f) => ({ ...f, company_id: v }))} label="Company" hint="" />
            <Field label="Material Type" required hint={MATERIAL_TYPE_OPTIONS.find((o) => o.value === form.material_type)?.desc}>
              <ErpComboboxField
                value={form.material_type}
                onChange={(v) => setForm((f) => ({ ...f, material_type: v, po_type: "", prodshade_material_id: "" }))}
                options={MATERIAL_TYPE_OPTIONS}
                hideBlank
              />
            </Field>
            <Field label="PO Type" required hint={PO_TYPE_OPTIONS_BY_MATERIAL_TYPE[form.material_type]?.find((o) => o.value === form.po_type)?.desc}>
              <ErpComboboxField
                value={form.po_type}
                onChange={(v) => setForm((f) => ({
                  ...f,
                  po_type: v,
                  // §131.3: switching to/from MTEST re-derives the storage location —
                  // into L003 automatically, or clears a stale L003 pick when switching
                  // away (that value would no longer even appear in the now-unfiltered list).
                  default_storage_location_id: v === "MTEST"
                    ? (l003Location?.id ?? "")
                    : (f.po_type === "MTEST" ? "" : f.default_storage_location_id),
                }))}
                options={PO_TYPE_OPTIONS_BY_MATERIAL_TYPE[form.material_type] ?? []}
              />
            </Field>
            <Field label="Prodshade" required>
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-3 text-xs text-slate-600">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="prodshade_mode" checked={form.prodshade_mode === "existing"} onChange={() => setForm((f) => ({ ...f, prodshade_mode: "existing", prod_code: "", shade_code: "", description: "" }))} />
                    Existing
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="prodshade_mode" checked={form.prodshade_mode === "new"} onChange={() => setForm((f) => ({ ...f, prodshade_mode: "new", prodshade_material_id: "", description: "" }))} />
                    Create new
                  </label>
                </div>
                {form.prodshade_mode === "existing" ? (
                  <ErpComboboxField value={form.prodshade_material_id} onChange={handleProdshadeSelect} options={prodshadeOptions} emptyStateLabel="No materials of this type yet" />
                ) : (
                  <div className="flex gap-2">
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-1/2 font-mono uppercase" value={form.prod_code} onChange={(e) => setForm((f) => ({ ...f, prod_code: e.target.value }))} placeholder="Prod code" />
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-1/2 font-mono uppercase" value={form.shade_code} onChange={(e) => setForm((f) => ({ ...f, shade_code: e.target.value }))} placeholder="Shade code" />
                  </div>
                )}
                {form.prodshade_mode === "new" && (
                  <p className="text-[11px] text-slate-400">Material Master ({form.material_type}) will be created automatically when this stroke is Approved — not on Save Draft.</p>
                )}
                {isDuplicateBlocked && (
                  <p className="text-[11px] font-medium text-rose-600">
                    Duplicate blocked: this Prodshade + Stroke Number combination already exists.
                  </p>
                )}
              </div>
            </Field>
            <Field label="Stroke Number" required>
              <input
                ref={firstInputRef}
                className={`border rounded px-2 py-1.5 text-sm font-mono h-7 w-full ${
                  isDuplicateBlocked ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-300"
                }`}
                value={form.stroke_number}
                onChange={(e) => setForm((f) => ({ ...f, stroke_number: e.target.value }))}
                placeholder={form.po_type === "MTS" ? "e.g. DOE1, or 1, 2, 3..." : "Numeric only"}
                required
              />
            </Field>
            <Field label="Description">
              <input
                className={`border rounded px-2 py-1.5 text-sm h-7 w-full ${
                  form.prodshade_mode === "existing" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-300"
                }`}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional"
                readOnly={form.prodshade_mode === "existing"}
                title={form.prodshade_mode === "existing" ? "Pulled from the selected Prodshade's own Material Master document name" : undefined}
              />
            </Field>
            <Field label="Communication Date" required>
              <input type="date" min={COMMUNICATION_DATE_BOUNDS.min} max={COMMUNICATION_DATE_BOUNDS.max} className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={form.communication_date} onChange={(e) => setForm((f) => ({ ...f, communication_date: e.target.value }))} />
            </Field>
            <Field label="Communication Type" required>
              <ErpComboboxField value={form.communication_type} onChange={(v) => setForm((f) => ({ ...f, communication_type: v }))} options={COMMUNICATION_TYPE_OPTIONS} placeholder="-- Select --" />
            </Field>
            <Field label="Communicator Name" required>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={form.communicator_name} onChange={(e) => setForm((f) => ({ ...f, communicator_name: e.target.value }))} placeholder="Name of the communicator" />
            </Field>
            <Field label="Communication Reference (Email Subject)" required hint="For email, enter the email subject.">
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={form.communication_reference} onChange={(e) => setForm((f) => ({ ...f, communication_reference: e.target.value }))} placeholder="Email subject or communication reference" />
            </Field>
            <Field label="Base UOM" required>
              <ErpComboboxField value={form.base_uom_code} onChange={(v) => setForm((f) => ({ ...f, base_uom_code: v }))} options={uomOptions} />
            </Field>
            <Field label="Conversion UOM" hint="Only needed if formulation input UOM differs from output UOM (e.g. KG in, LTR out).">
              <ErpComboboxField value={form.conversion_uom_code} onChange={(v) => setForm((f) => ({ ...f, conversion_uom_code: v }))} options={uomOptions} />
            </Field>
            <Field label="Conversion Factor" hint="e.g. KG per Litre (density-based).">
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" type="number" step="0.0001" min="0" value={form.conversion_factor} onChange={(e) => setForm((f) => ({ ...f, conversion_factor: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field
              label="Default Storage Location (Output)"
              required
              hint={isMtestStroke
                ? "MTEST always uses L003 (ADMIX LAB) — locked, not a per-stroke choice."
                : "Company-mapped locations only. Process PO Verify posts SFG/INT output here."}
            >
              <ErpComboboxField
                value={form.default_storage_location_id}
                onChange={(v) => setForm((f) => ({ ...f, default_storage_location_id: v }))}
                options={strokeStorageLocationOptions}
                placeholder={form.company_id ? "-- Select --" : "-- Select Company first --"}
                emptyStateLabel={isMtestStroke ? "L003 is not mapped to this company yet" : "No storage locations mapped to this company"}
                disabled={!form.company_id || isMtestStroke}
                className={attemptedSave && !form.default_storage_location_id ? "ring-2 ring-rose-400 rounded" : ""}
              />
              {attemptedSave && !form.default_storage_location_id && (
                <p className="text-[11px] font-medium text-rose-600 mt-1">Required.</p>
              )}
            </Field>
          </div>

          <StrokeLinesTable
            lines={lines}
            setLines={setLines}
            materialsByType={lineMaterialsByType}
            groups={groups}
            storageLocationOptions={storageLocationOptions}
            onCreateGroup={openCreateGroupModal}
            onAddMember={(groupId) => setMemberModal(groupId)}
          />
        </form>
      </DrawerBase>

      {/* Detail Drawer */}
      <DrawerBase
        visible={drawerOpen && drawerMode === "detail"}
        title={detail ? `Stroke #${detail.stroke_number}` : "Loading…"}
        onClose={() => setDrawerOpen(false)}
        side="center"
        width="min(1480px, calc(100vw - 24px))"
        actions={renderDrawerActions(detail ? [
          ...(detail.status === "DRAFT" ? [
            { label: "Save", tone: "neutral", onClick: handleSaveDraft, disabled: saving || !hasCommunicationDetails(detail) },
            { label: "Approve", tone: "primary", onClick: handleSaveApproveDraft, disabled: saving || !hasCommunicationDetails(detail) },
            { label: "Reject", tone: "danger", onClick: () => runAction(rejectStrokeMaster, detail.id, "Stroke rejected and deleted."), disabled: saving },
          ] : []),
          ...(detail.status === "APPROVED" ? [
            { label: "Deactivate", tone: "danger", onClick: () => runAction(deactivateStrokeMaster, detail.id, "Stroke deactivated."), disabled: saving },
            { label: "Revert to Draft", tone: "neutral", onClick: () => runAction(revertStrokeMaster, detail.id, "Reverted to DRAFT."), disabled: saving },
          ] : []),
          ...(detail.status === "DEACTIVATED" ? [
            { label: "Reactivate to Draft", tone: "primary", onClick: () => runAction(reactivateStrokeMaster, detail.id, "Stroke moved back to DRAFT."), disabled: saving },
          ] : []),
          { label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ] : [{ label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) }])}
      >
        {detailLoading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading…</p>
        ) : detail ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs">Prodshade</span>
                <p className="font-medium">
                  {detail.material
                    ? `${detail.material.pace_code ?? "—"} — ${detail.material.material_name ?? "—"}`
                    : `${detail.prod_code ?? "—"}${detail.shade_code ?? ""} (new — created on Approve)`}
                </p>
              </div>
              <div><span className="text-slate-400 text-xs">Status</span><p><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[detail.status]}`}>{detail.status}</span></p></div>
              <div><span className="text-slate-400 text-xs">Material Type</span><p>{detail.material_type}</p></div>
              <div><span className="text-slate-400 text-xs">PO Type</span><p>{detail.po_type}</p></div>
              <div><span className="text-slate-400 text-xs">Revision</span><p>{detail.revision_no ?? 1}</p></div>
              <div><span className="text-slate-400 text-xs">Active For PO Type</span><p>{(detail.applicable_po_types ?? []).join(", ") || "—"}</p></div>
              <div><span className="text-slate-400 text-xs">Base UOM / Conversion</span><p>{detail.base_uom_code ?? "—"}{detail.conversion_uom_code ? ` → ${detail.conversion_uom_code} (× ${detail.conversion_factor})` : ""}</p></div>
              {detail.status === "DRAFT" ? (
                <div>
                  <span className="text-slate-400 text-xs">Default Storage Location (Output) <span className="text-rose-500">*</span></span>
                  <ErpComboboxField
                    value={detail.default_storage_location_id ?? ""}
                    onChange={(v) => setDetail((d) => ({ ...d, default_storage_location_id: v }))}
                    options={detail.po_type === "MTEST" ? strokeStorageLocationOptions : storageLocationOptions}
                    placeholder="-- Select --"
                    emptyStateLabel="No storage locations mapped to this company"
                    disabled={detail.po_type === "MTEST"}
                    className={attemptedSave && !detail.default_storage_location_id ? "ring-2 ring-rose-400 rounded" : ""}
                  />
                  {detail.po_type === "MTEST" && (
                    <p className="text-[11px] text-slate-400 mt-1">MTEST always uses L003 (ADMIX LAB) — locked.</p>
                  )}
                  {attemptedSave && !detail.default_storage_location_id && (
                    <p className="text-[11px] font-medium text-rose-600 mt-1">Required.</p>
                  )}
                </div>
              ) : (
                <div><span className="text-slate-400 text-xs">Default Storage Location (Output)</span><p>{detail.default_storage_location ? `${detail.default_storage_location.code} — ${detail.default_storage_location.name}` : "—"}</p></div>
              )}
              {detail.status === "DRAFT" ? (
                <div>
                  <span className="text-slate-400 text-xs">Description</span>
                  <input
                    className="mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full"
                    value={detail.description ?? ""}
                    onChange={(e) => setDetail((d) => ({ ...d, description: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              ) : (
                <div><span className="text-slate-400 text-xs">Description</span><p>{detail.description ?? "—"}</p></div>
              )}
              {detail.status === "DRAFT" ? (
                <>
                  <div>
                    <span className="text-slate-400 text-xs">Communication Date <span className="text-rose-500">*</span></span>
                    <input type="date" min={COMMUNICATION_DATE_BOUNDS.min} max={COMMUNICATION_DATE_BOUNDS.max} className="mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={detail.communication_date ?? ""} onChange={(e) => setDetail((d) => ({ ...d, communication_date: e.target.value }))} />
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">Communication Type <span className="text-rose-500">*</span></span>
                    <ErpComboboxField value={detail.communication_type ?? ""} onChange={(v) => setDetail((d) => ({ ...d, communication_type: v }))} options={COMMUNICATION_TYPE_OPTIONS} placeholder="-- Select --" />
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">Communicator Name <span className="text-rose-500">*</span></span>
                    <input className="mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={detail.communicator_name ?? ""} onChange={(e) => setDetail((d) => ({ ...d, communicator_name: e.target.value }))} placeholder="Name of the communicator" />
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">Communication Reference (Email Subject) <span className="text-rose-500">*</span></span>
                    <input className="mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm h-7 w-full" value={detail.communication_reference ?? ""} onChange={(e) => setDetail((d) => ({ ...d, communication_reference: e.target.value }))} placeholder="Email subject or communication reference" />
                  </div>
                </>
              ) : (
                <>
                  <div><span className="text-slate-400 text-xs">Communication Date</span><p>{detail.communication_date ?? "—"}</p></div>
                  <div><span className="text-slate-400 text-xs">Communication Type</span><p>{COMMUNICATION_TYPE_OPTIONS.find((option) => option.value === detail.communication_type)?.label ?? "—"}</p></div>
                  <div><span className="text-slate-400 text-xs">Communicator Name</span><p>{detail.communicator_name ?? "—"}</p></div>
                  <div><span className="text-slate-400 text-xs">Communication Reference (Email Subject)</span><p>{detail.communication_reference ?? "—"}</p></div>
                </>
              )}
              {detail.approved_by && <div><span className="text-slate-400 text-xs">Approved</span><p>{detail.approved_at?.slice(0, 10)}</p></div>}
              {detail.deactivated_by && <div><span className="text-slate-400 text-xs">Deactivated</span><p>{detail.deactivated_at?.slice(0, 10)}</p></div>}
            </div>

            {detail.status === "DRAFT" && detailEditLines ? (
              <StrokeLinesTable
                lines={detailEditLines}
                setLines={setDetailEditLines}
                materialsByType={lineMaterialsByType}
                groups={groups}
                storageLocationOptions={storageLocationOptions}
                onCreateGroup={openCreateGroupModal}
                onAddMember={(groupId) => setMemberModal(groupId)}
              />
            ) : (
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">RM / INT Lines</p>
                {(detail.lines ?? []).length === 0 ? (
                  <p className="text-slate-400 text-sm">No lines.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs">
                        <th className="text-left py-1.5 px-2 border-b">#</th>
                        <th className="text-left py-1.5 px-2 border-b">Type</th>
                        <th className="text-left py-1.5 px-2 border-b">Material</th>
                        <th className="text-left py-1.5 px-2 border-b">Group</th>
                        <th className="text-left py-1.5 px-2 border-b">Storage Loc.</th>
                        <th className="text-right py-1.5 px-2 border-b">Dosage %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l, i) => (
                        <tr key={l.id} className="border-b border-slate-100">
                          <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                          <td className="py-1.5 px-2 text-slate-500">{l.line_material_type}</td>
                          <td className="py-1.5 px-2">{l.material?.pace_code ?? "—"} — {l.material?.material_name ?? ""}</td>
                          <td className="py-1.5 px-2 text-slate-500">{l.material_group?.group_name ?? "—"}</td>
                          <td className="py-1.5 px-2 text-slate-500">{l.default_storage_location ? l.default_storage_location.code : "—"}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{formatPreciseNumber(l.dosage_pct, "0")}%</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td colSpan={5} className="py-1.5 px-2 text-right text-slate-500 text-xs">Total</td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          {formatSum(detail.lines.reduce((s, l) => s + Number(l.dosage_pct), 0), "0")}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DrawerBase>

      <DrawerBase
        visible={shareOpen}
        title="Stroke Share"
        side="center"
        width="min(680px, calc(100vw - 24px))"
        onClose={() => !shareSaving && setShareOpen(false)}
        actions={(
          <div className="flex w-full justify-end gap-2">
            <button type="button" className="border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setShareOpen(false)} disabled={shareSaving}>Cancel</button>
            <button type="button" className="bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" onClick={handleShare} disabled={shareSaving || !shareForm.company_id || !shareForm.from_po_type || !shareForm.to_po_type || !shareForm.stroke_master_id}>
              {shareSaving ? "Sharing..." : shareForm.consider_formulation_changes ? "Create Draft Revision" : "Share & Activate"}
            </button>
          </div>
        )}
      >
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">Share an approved SFG stroke from one PO type to another. INT is intentionally excluded.</p>
          <div className="grid grid-cols-2 gap-4">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={shareForm.company_id} onChange={(value) => updateShare("company_id", value)} label="Company" hint="" />
            <Field label="From PO Type" required>
              <ErpComboboxField value={shareForm.from_po_type} onChange={(value) => updateShare("from_po_type", value)} options={SHAREABLE_PO_TYPE_OPTIONS} placeholder="-- Select source type --" />
            </Field>
            <Field label="Prodshade" required>
              <ErpComboboxField value={shareForm.prodshade_material_id} onChange={(value) => updateShare("prodshade_material_id", value)} options={shareProdshadeOptions} placeholder="-- Select Prodshade --" emptyStateLabel={shareSourceStrokesQ.isLoading ? "Loading approved strokes..." : "No approved Prodshade for this type"} disabled={!shareForm.from_po_type} />
            </Field>
            <Field label="Stroke" required>
              <ErpComboboxField value={shareForm.stroke_master_id} onChange={(value) => updateShare("stroke_master_id", value)} options={shareStrokeOptions} placeholder="-- Select stroke --" emptyStateLabel="Select a Prodshade first" disabled={!shareForm.prodshade_material_id} />
            </Field>
            <Field label="To PO Type" required>
              <ErpComboboxField value={shareForm.to_po_type} onChange={(value) => updateShare("to_po_type", value)} options={SHAREABLE_PO_TYPE_OPTIONS.filter((option) => option.value !== shareForm.from_po_type)} placeholder="-- Select target type --" disabled={!shareForm.from_po_type} />
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={shareForm.consider_formulation_changes} onChange={(event) => updateShare("consider_formulation_changes", event.target.checked)} />
            <span><strong>Consider formulation changes</strong><br /><span className="text-xs text-slate-500">Unchecked: the same approved formulation becomes active in the target type. Checked: a target-type DRAFT revision is created for changes and must be approved before use.</span></span>
          </label>
        </div>
      </DrawerBase>

      {/* MTS Current Stroke Drawer */}
      <DrawerBase
        visible={currentStrokeOpen}
        title="Current Stroke — MTS"
        side="center"
        width="min(1200px, calc(100vw - 24px))"
        onClose={() => setCurrentStrokeOpen(false)}
        actions={(
          <div className="flex w-full justify-between items-center">
            <span className="text-xs text-slate-500">
              {currentStrokePendingCount > 0 ? `${currentStrokePendingCount} unsaved change${currentStrokePendingCount === 1 ? "" : "s"}` : ""}
            </span>
            <div className="flex gap-2">
              <button type="button" className="border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setCurrentStrokeOpen(false)}>Close</button>
              <button
                type="button"
                className="bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                onClick={handleSaveCurrentStrokes}
                disabled={currentStrokeSaving || currentStrokePendingCount === 0}
              >
                {currentStrokeSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      >
        <div className="p-4 flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            Per Prodshade, pick a Stroke Number from Available Strokes to switch the production default — the current one stays disabled in that dropdown.
            Changes are staged here; nothing is saved until you click Save Changes, so you can edit several rows (across any search) and commit them together.
          </p>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="w-64">
              {/* business owner, 2026-09-26: this is a company subset (only
                  companies with an MTS Prodshade), not the user's full
                  runtime company list, so TransactionCompanySelector itself
                  doesn't fit -- ErpCompanySelector directly with the same
                  "lock when there's only one real choice" rule instead. */}
              <ErpCompanySelector
                companies={currentStrokeCompanyOptions.map((option) => {
                  const [company_code, company_name] = option.label.split(" — ");
                  return { id: option.value, company_code, company_name };
                })}
                value={currentStrokeCompanyId}
                onChange={changeCurrentStrokeCompany}
                readOnly={currentStrokeCompanyOptions.length <= 1}
              />
            </div>
            <div className="min-w-[280px] flex-1">
              <label className="text-xs text-slate-500 block mb-1">Search (all columns)</label>
              <input
                list="mts-current-stroke-search-options"
                value={currentStrokeSearch}
                onChange={(e) => setCurrentStrokeSearch(e.target.value)}
                placeholder="Search Prodshade, description, stroke number..."
                className="h-8 w-full border border-slate-300 rounded px-2 text-sm outline-none focus:border-sky-500"
              />
              <datalist id="mts-current-stroke-search-options">
                {mtsCurrentStrokeSearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </div>
          </div>
          <ErpDenseGrid
            columns={mtsCurrentStrokeColumns}
            rows={filteredMtsCurrentStrokeRows}
            rowKey={(row) => row.prodshade_material_id}
            maxHeight="520px"
            emptyMessage={mtsCurrentStrokeQ.isLoading ? "Loading..." : "No MTS Prodshade with an approved Stroke for this company."}
          />
        </div>
      </DrawerBase>

      <GroupCreateModal
        open={Boolean(groupModal)}
        groupForm={groupForm}
        setGroupForm={setGroupForm}
        onCancel={() => setGroupModal(null)}
        onCreate={handleCreateGroup}
      />

      <MemberAddModal
        open={Boolean(memberModal)}
        memberMaterialId={memberMaterialId}
        setMemberMaterialId={setMemberMaterialId}
        materialOptions={[...(lineMaterialsByType.RM ?? []), ...(lineMaterialsByType.INT ?? [])].map((m) => ({ value: m.id, label: [m.pace_code ?? "—", m.material_name, m.document_name].filter(Boolean).join(" — ") }))}
        onCancel={() => setMemberModal(null)}
        onAdd={handleAddMember}
      />

    </ErpScreenScaffold>
  );
}
