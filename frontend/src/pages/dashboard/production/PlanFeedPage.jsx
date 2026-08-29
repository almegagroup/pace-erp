/*
 * File-ID: 27.FE-00
 * File-Path: frontend/src/pages/dashboard/production/PlanFeedPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Plan Feed (FO) management — §83.18-REVISED (LOCKED 2026-07-23).
 *          3 tabs: Create FO | Edit FO (+ Packing PO allocation) | Total Table.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import CustomerCreateForm from "../om/customer/CustomerCreateForm.jsx";
import CustomerEditForm from "../om/customer/CustomerEditForm.jsx";
import {
  listPlanFeed, getPlanFeed, createPlanFeed, updatePlanFeed, updateMtestPlanFeed,
  cancelPlanFeed, reactivatePlanFeed, getPlanFeedSummary, upsertFoAllocation,
  upsertMtestFoAllocation, getMtestPlanFeedCapability,
  getUnmappedStock, checkOrderedStroke, listStrokeOptions, listPackingOrders,
  findPlanFeedByNumber, listMtestSkus,
} from "./prodApi.js";
import { createCustomerAddress, listMaterials, listCustomers, updateCustomer, listCustomerAddresses } from "../om/omApi.js";

const EMPTY_ARRAY = [];

const TABS = [
  { key: "create", label: "Create FO" },
  { key: "edit",   label: "Edit FO" },
  { key: "total",  label: "Total Table" },
];

const FO_CUSTOMER_TYPES = [
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "MTEST", label: "MTEST" },
  { value: "MTS", label: "MTS" },
];

function normalizeFoCustomerType(value) {
  return String(value || "").toUpperCase() === "ZTEST" ? "MTEST" : String(value || "");
}

const ERRORS = {
  PROD_PLAN_FEED_INVALID: "Company, FO number, party, SKU, ordered qty, and order date are required.",
  PROD_PLAN_FEED_FO_EXISTS: "FO number already exists for this company.",
  PROD_PLAN_FEED_SKU_LOCKED: "SKU/Description are locked — Packing PO(s) are already allocated to this FO.",
  PROD_PLAN_FEED_CANCELLED: "Cancelled FO cannot be edited.",
  PROD_PLAN_FEED_ALLOCATION_EXCEEDS_STOCK: "Allocation exceeds this Packing PO's available qty.",
  PROD_PLAN_FEED_MATERIAL_MISMATCH: "Packing PO material differs from this FO's SKU.",
  PROD_PLAN_FEED_CANCEL_BLOCKED_BY_DO: "Cancel the linked Delivery Order first, then cancel this FO.",
  PROD_PACK_NOT_FOUND: "Packing PO not found.",
  PROD_PACK_REVERSED: "Cannot allocate a reversed/cancelled Packing PO.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendlyErr(code) { return ERRORS[code] ?? code; }

function materialLabel(m) {
  if (!m) return "--";
  // pace_code is PACE's own internal sequential numbering (FG-00001...) -- meaningless
  // to a business user. The real "SKU" they recognize is external_code (the 11-char
  // code, per §83.18's original "11-char FG SKU code" spec), paired with document_name
  // for the readable description (material_name mirrors external_code for FG, not a
  // real name -- verified live). pace_code never shown here.
  return [m.external_code || m.pace_code, m.document_name || m.material_name].filter(Boolean).join(" - ");
}
function customerLabel(c) {
  if (!c) return "--";
  // §129.4 — display_code already IS "{gst_state_code} - {name}" (computed
  // server-side only, enrichCustomerRows) -- do not re-append customer_name,
  // that would duplicate it. Fall back to the old pairing only when
  // display_code isn't resolved yet (no GST/state on this customer).
  return c.display_code || [c.customer_code, c.customer_name].filter(Boolean).join(" - ");
}
function addressLabel(a) {
  if (!a) return "--";
  return [a.site_name, a.town].filter(Boolean).join(" — ") || a.address_line || "Address";
}
function addressFullText(a) {
  if (!a) return "--";
  return [a.address_line, a.town, a.state].filter(Boolean).join(", ") || "--";
}
function fmt(n) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "0";
}

// SKU field needs to cover both cases: an existing FG material (pick from suggestions,
// description auto-fills) and a brand-new SKU not yet in Material Master (just type it,
// write the description by hand) -- a strict dropdown can only do the first. Typing
// freely always clears any previously-picked material_id (parent's onTextChange);
// clicking a suggestion re-links it.
function SkuTypeaheadField({ skuText, materials, onTextChange, onPickMaterial, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = skuText.trim().toLowerCase();
    if (!needle) return [];
    return materials.filter((m) => materialLabel(m).toLowerCase().includes(needle)).slice(0, 8);
  }, [skuText, materials]);

  return (
    <div className="relative">
      <input
        className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-full disabled:opacity-50"
        value={skuText}
        disabled={disabled}
        onChange={(e) => { onTextChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto border border-slate-300 bg-white shadow-md text-sm">
          {matches.map((m) => (
            <li
              key={m.id}
              className="px-2 py-1 cursor-pointer hover:bg-sky-50"
              onMouseDown={(e) => { e.preventDefault(); onPickMaterial(m); setOpen(false); }}
            >
              {materialLabel(m)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Same hybrid pattern as SkuTypeaheadField: shows existing Stroke numbers for this SKU's
// Prodshade as suggestions, but typing a number that isn't in the list is accepted too
// (Ordered Stroke can be planned ahead of the Stroke actually existing in Stroke Master).
function StrokeTypeaheadField({ strokeText, strokeOptions, onTextChange, onPickStroke, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = strokeText.trim().toLowerCase();
    return strokeOptions.filter((s) => !needle || String(s.stroke_number).toLowerCase().includes(needle)).slice(0, 8);
  }, [strokeText, strokeOptions]);

  return (
    <div className="relative">
      <input
        className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-64 disabled:opacity-50"
        value={strokeText}
        disabled={disabled}
        onChange={(e) => { onTextChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-64 overflow-y-auto border border-slate-300 bg-white shadow-md text-sm">
          {matches.map((s) => (
            <li
              key={s.id}
              className="px-2 py-1 cursor-pointer hover:bg-sky-50 flex justify-between gap-2"
              onMouseDown={(e) => { e.preventDefault(); onPickStroke(s); setOpen(false); }}
            >
              <span className="font-mono">{s.stroke_number}</span>
              <span className="text-[10px] text-slate-400 uppercase">{s.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function productionStatusTone(status) {
  switch (status) {
    case "FULLY_MAPPED": return "bg-emerald-100 text-emerald-800";
    case "PARTIALLY_MAPPED": return "bg-amber-100 text-amber-800";
    default: return "bg-rose-100 text-rose-800";
  }
}
function dispatchStatusTone(status) {
  switch (status) {
    case "FULLY_DISPATCHED": return "bg-emerald-100 text-emerald-800";
    case "PARTIALLY_DISPATCHED": return "bg-amber-100 text-amber-800";
    default: return "bg-slate-100 text-slate-600";
  }
}

const EMPTY_FO = {
  fo_number: "", party_id: "", party_name: "", material_id: "", sku: "", description: "",
  ordered_qty_kg: "", pack_qty: "", order_date: "", scheduled_delivery_date: "", ordered_stroke_number: "",
};

export default function PlanFeedPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [tab, setTab] = useState("create");
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false);

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  // ── Shared master lookups ─────────────────────────────────────────────────
  const [poTypeFilter, setPoTypeFilter] = useState("");
  // MTEST is a sample/test batch, not a distinct customer relationship -- the same
  // real-world customer who normally orders MTO/HPS can just as well receive an
  // MTEST sample, so the Party list is never narrowed to fo_customer_type=MTEST-
  // tagged parties only; it shows every party instead (same as no filter at all).
  const customersQ = useQuery({
    queryKey: ["plan-feed-customers", poTypeFilter],
    queryFn: () => listCustomers({
      fo_customer_type: (poTypeFilter && poTypeFilter !== "MTEST") ? poTypeFilter : undefined,
      status: "ACTIVE",
      limit: 200,
    }),
    select: (d) => d?.data ?? [],
  });
  const materialsQ = useQuery({
    queryKey: ["plan-feed-fg-materials"],
    queryFn: () => listMaterials({ material_type: "FG", status: "ACTIVE", limit: 500 }),
    select: (d) => d?.data ?? [],
  });
  // §131.5 item #1 -- when the FO is MTEST-typed, the SKU field is restricted to ONLY
  // these 5 generic sample SKUs (no ad-hoc/new SKU creation), unlike MTO/HPS/MTS which
  // use materialsQ + the free-text SkuTypeaheadField.
  const mtestSkusQ = useQuery({
    queryKey: ["plan-feed-mtest-skus", effectiveCompanyId],
    queryFn: () => listMtestSkus({ company_id: effectiveCompanyId }),
    enabled: Boolean(effectiveCompanyId),
    // listMtestSkusHandler's okResponse({data: mtestSkus}) has no "pagination"
    // key, so fetchProd's double-unwrap already resolves this down to the bare
    // array -- `d?.data` on an array is always undefined (bug pattern #15,
    // found live 2026-08-27: the 5 MTEST SKUs never showed even though the
    // backend was correctly returning them every time).
    select: (d) => (Array.isArray(d) ? d : (d?.data ?? [])),
  });
  const mtestSkuOptions = useMemo(
    () => (mtestSkusQ.data ?? []).map((m) => ({ value: m.id, label: materialLabel(m) })),
    [mtestSkusQ.data],
  );
  // materialsQ (all ACTIVE FG materials, no pack_type filter) otherwise leaked the 5
  // MTEST sample SKUs into the MTO/HPS/MTS typeahead too -- same root cause as the
  // Packing PO Create SKU-dropdown bug fixed the same day, found via the user's own
  // report that both screens showed this mixing.
  const mtestSkuIdSet = useMemo(
    () => new Set((mtestSkusQ.data ?? []).map((m) => m.id)),
    [mtestSkusQ.data],
  );
  const nonMtestMaterials = useMemo(
    () => (materialsQ.data ?? []).filter((m) => !mtestSkuIdSet.has(m.id)),
    [materialsQ.data, mtestSkuIdSet],
  );
  const normalizedCustomers = useMemo(
    () => (customersQ.data ?? []).map((customer) => ({
      ...customer,
      fo_customer_type: normalizeFoCustomerType(customer.fo_customer_type),
    })),
    [customersQ.data],
  );
  const customerOptions = useMemo(
    () => normalizedCustomers.map((c) => ({ value: c.id, label: customerLabel(c) })),
    [normalizedCustomers],
  );
  const customerMap = useMemo(() => new Map(normalizedCustomers.map((c) => [c.id, c])), [normalizedCustomers]);

  // ── Create tab state ──────────────────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FO });
  const [newPartyOpen, setNewPartyOpen] = useState(false);
  const [editPartyOpen, setEditPartyOpen] = useState(false);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [addressPickerSeenForPartyId, setAddressPickerSeenForPartyId] = useState("");
  const [newAddressOpen, setNewAddressOpen] = useState(false);
  const [newAddress, setNewAddress] = useState({ site_name: "", address_line: "", town: "" });
  const [newAddressSaving, setNewAddressSaving] = useState(false);
  const [newAddressError, setNewAddressError] = useState("");

  const selectedParty = customerMap.get(form.party_id) ?? null;
  const isMtestCreate = poTypeFilter === "MTEST";

  // A party can have multiple addresses/sites. The address is a Ship-To
  // reference for the FO creator and the final Direct-dispatch Ship-To.
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const partyAddressesQ = useQuery({
    queryKey: ["plan-feed-party-addresses", form.party_id],
    queryFn: () => listCustomerAddresses(form.party_id),
    enabled: Boolean(form.party_id),
    select: (d) => d?.data ?? d ?? [],
  });
  const partyAddresses = partyAddressesQ.data ?? EMPTY_ARRAY;
  useEffect(() => {
    if (!form.party_id) {
      setSelectedAddressId("");
      setAddressPickerOpen(false);
      return;
    }
    if (partyAddresses.length === 1) {
      setSelectedAddressId(partyAddresses[0].id);
      return;
    }
    if (partyAddresses.length > 1 && addressPickerSeenForPartyId !== form.party_id) {
      setSelectedAddressId("");
      setAddressPickerOpen(true);
      setAddressPickerSeenForPartyId(form.party_id);
    }
  }, [addressPickerSeenForPartyId, form.party_id, partyAddresses]);
  const selectedAddress = partyAddresses.find((a) => a.id === selectedAddressId) ?? null;

  function choosePartyAddress(addressId) {
    setSelectedAddressId(addressId);
    setAddressPickerOpen(false);
  }

  function openNewAddress() {
    setNewAddress({ site_name: "", address_line: "", town: "" });
    setNewAddressError("");
    setNewAddressOpen(true);
  }

  async function handleCreatePartyAddress() {
    if (!form.party_id || !selectedParty) return;
    if (!newAddress.site_name.trim() || !newAddress.address_line.trim() || !newAddress.town.trim()) {
      setNewAddressError("Site Name, Address, and Town are required.");
      return;
    }
    setNewAddressSaving(true);
    setNewAddressError("");
    try {
      const result = await createCustomerAddress({
        customer_id: form.party_id,
        site_name: newAddress.site_name.trim(),
        address_line: newAddress.address_line.trim(),
        town: newAddress.town.trim(),
        state: selectedParty.billing_state || "",
      });
      const createdAddress = result?.data;
      await qc.invalidateQueries({ queryKey: ["plan-feed-party-addresses", form.party_id] });
      if (createdAddress?.id) setSelectedAddressId(createdAddress.id);
      setNewAddressOpen(false);
      setAddressPickerOpen(false);
      toast("Party address added and selected.");
    } catch (err) {
      setNewAddressError(err instanceof Error ? err.message : "OM_ADDRESS_CREATE_FAILED");
    } finally {
      setNewAddressSaving(false);
    }
  }

  const strokeCheckQ = useQuery({
    queryKey: ["plan-feed-stroke-check", effectiveCompanyId, form.material_id, form.ordered_stroke_number],
    queryFn: () => checkOrderedStroke({
      company_id: effectiveCompanyId, material_id: form.material_id, stroke_number: form.ordered_stroke_number.trim(),
    }),
    enabled: Boolean(effectiveCompanyId && form.material_id && form.ordered_stroke_number.trim()),
    select: (d) => d?.data ?? d,
  });

  const unmappedQ = useQuery({
    queryKey: ["plan-feed-unmapped", effectiveCompanyId, form.material_id],
    queryFn: () => getUnmappedStock({ company_id: effectiveCompanyId, material_id: form.material_id }),
    enabled: Boolean(effectiveCompanyId && form.material_id),
    select: (d) => d?.data ?? d,
  });

  const strokeOptionsQ = useQuery({
    queryKey: ["plan-feed-stroke-options", effectiveCompanyId, form.material_id],
    queryFn: () => listStrokeOptions({ company_id: effectiveCompanyId, material_id: form.material_id }),
    enabled: Boolean(effectiveCompanyId && form.material_id),
    // listStrokeOptionsHandler's okResponse({data: [...]}) has no "pagination"
    // key, so fetchProd already unwraps this to the bare array -- same bug
    // pattern #15 as mtestSkusQ above, found in the same sweep (2026-08-27).
    select: (d) => (Array.isArray(d) ? d : (d?.data ?? [])),
  });

  async function handlePartyCreated(customer) {
    const newId = customer?.id;
    await qc.invalidateQueries({ queryKey: ["plan-feed-customers"] });
    if (newId) setForm((f) => ({ ...f, party_id: newId, party_name: customer.customer_name || "" }));
    setNewPartyOpen(false);
    toast("Party created.");
  }

  // Edited here or from Customer Master (MM04) -- both write the same
  // customer_master row, so either page always reflects the other's changes.
  async function handlePartyUpdated() {
    await qc.invalidateQueries({ queryKey: ["plan-feed-customers"] });
    await qc.invalidateQueries({ queryKey: ["prod-plan-feed-summary"] });
    setEditPartyOpen(false);
    toast("Party updated.");
  }

  const [partyTypeEdit, setPartyTypeEdit] = useState(false);
  const [partyTypeSaving, setPartyTypeSaving] = useState(false);

  async function handleUpdatePartyType(partyId, newType) {
    if (!partyId) return;
    setPartyTypeSaving(true);
    try {
      await updateCustomer({ id: partyId, fo_customer_type: newType || "" });
      await qc.invalidateQueries({ queryKey: ["plan-feed-customers"] });
      setPartyTypeEdit(false);
      toast("Party's FO Type updated.");
    } catch (err) {
      toast(err.message || "Update failed.", "error");
    } finally {
      setPartyTypeSaving(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!effectiveCompanyId) return;
    setSaving(true);
    try {
      await createPlanFeed({
        company_id: effectiveCompanyId,
        fo_number: form.fo_number,
        party_id: form.party_id || undefined,
        customer_address_id: selectedAddressId || undefined,
        party_name: selectedParty?.customer_name || form.party_name,
        material_id: form.material_id || undefined,
        sku: form.sku || undefined,
        description: form.description,
        ordered_qty_kg: parseFloat(form.ordered_qty_kg),
        pack_qty: form.pack_qty ? parseInt(form.pack_qty, 10) : null,
        order_date: form.order_date,
        scheduled_delivery_date: form.scheduled_delivery_date || undefined,
        ordered_stroke_number: form.ordered_stroke_number || undefined,
      });
      toast("FO created successfully.");
      setForm({ ...EMPTY_FO });
      // Every other mutation on this page invalidates these two -- this was
      // the one place that never did, so a freshly created FO stayed invisible
      // on the Edit FO list / Total Table until an unrelated refetch happened
      // to occur (found live 2026-08-27: an MTEST FO created in CMP006 never
      // showed up in either place).
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-list"] });
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-summary"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  // ── Edit tab state ────────────────────────────────────────────────────────
  const [editSearch, setEditSearch] = useState("");
  const [debouncedEditSearch, setDebouncedEditSearch] = useState("");
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedEditSearch(editSearch.trim()), 300);
    return () => window.clearTimeout(timeoutId);
  }, [editSearch]);
  const [foNumberSearch, setFoNumberSearch] = useState("");
  const [foNumberMatches, setFoNumberMatches] = useState(null);
  const [foNumberSearching, setFoNumberSearching] = useState(false);
  const [editData, setEditData] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editLoading, setEditLoading] = useState(false);
  const [allocPoNumber, setAllocPoNumber] = useState("");
  const [allocCandidate, setAllocCandidate] = useState(null);
  const [allocQty, setAllocQty] = useState("");
  const [allocNumPacks, setAllocNumPacks] = useState("");
  const [allocSearching, setAllocSearching] = useState(false);

  // The search box only ever filtered whatever was already fetched (a fixed
  // 50-row page, most-recent-first) -- a real match sitting outside that page
  // silently looked like "not found" (found live 2026-08-27). Now the search
  // term itself is sent to the backend, which filters across the whole
  // company, not just the currently-loaded page.
  const listQ = useQuery({
    queryKey: ["prod-plan-feed-list", effectiveCompanyId, debouncedEditSearch],
    queryFn: () => listPlanFeed({ company_id: effectiveCompanyId || undefined, search: debouncedEditSearch || undefined, per_page: 50 }),
    select: (d) => (typeof d === "object" && "data" in d) ? d.data : (Array.isArray(d) ? d : []),
    enabled: tab === "edit",
  });
  const foListFiltered = listQ.data ?? EMPTY_ARRAY;

  const skuLockedForEdit = Boolean(editData?.allocations?.length);
  // §131.5 -- the FO's type isn't stored on plan_feed itself, it's always derived from
  // its party's own fo_customer_type (embedded server-side in getPlanFeedHandler's
  // `party` object) -- more reliable here than the page-local poTypeFilter/customerMap,
  // which only reflect whichever PO Type the Create tab's filter happens to be set to.
  const isMtestEdit = normalizeFoCustomerType(editData?.party?.fo_customer_type) === "MTEST";
  // Uses runtime ACL decisions, never a department/role-name check. QA has MTEST-only
  // edit permission; Production and ACL-MASTER retain their broader Plan Feed authority.
  const planFeedCapabilityQ = useQuery({
    queryKey: ["plan-feed-mtest-capability", effectiveCompanyId],
    queryFn: () => getMtestPlanFeedCapability(effectiveCompanyId),
    enabled: Boolean(effectiveCompanyId),
    select: (d) => d?.data ?? d ?? {},
  });
  const canEditStandardPlanFeed = planFeedCapabilityQ.data?.standard === true;
  const canEditMtestPlanFeed = planFeedCapabilityQ.data?.mtest === true;
  const canEditSelectedFo = canEditStandardPlanFeed || (isMtestEdit && canEditMtestPlanFeed);

  const editStrokeOptionsQ = useQuery({
    queryKey: ["plan-feed-stroke-options", editData?.company_id, editDraft.material_id],
    queryFn: () => listStrokeOptions({ company_id: editData?.company_id, material_id: editDraft.material_id }),
    enabled: Boolean(editData?.company_id && editDraft.material_id),
    select: (d) => (Array.isArray(d) ? d : (d?.data ?? [])),
  });
  const editStrokeCheckQ = useQuery({
    queryKey: ["plan-feed-stroke-check", editData?.company_id, editDraft.material_id, editDraft.ordered_stroke_number],
    queryFn: () => checkOrderedStroke({
      company_id: editData?.company_id, material_id: editDraft.material_id, stroke_number: (editDraft.ordered_stroke_number || "").trim(),
    }),
    enabled: Boolean(editData?.company_id && editDraft.material_id && (editDraft.ordered_stroke_number || "").trim()),
    select: (d) => d?.data ?? d,
  });

  async function loadEditFo(foId) {
    if (!foId) return;
    setEditLoading(true);
    setEditData(null);
    try {
      const d = await getPlanFeed(foId);
      const row = d?.data ?? d;
      setEditData(row);
      setEditDraft({
        party_id: row.party_id ?? "",
        material_id: row.material_id ?? "",
        sku: row.sku ?? "",
        description: row.description ?? "",
        ordered_qty_kg: row.ordered_qty_kg ?? "",
        pack_qty: row.pack_qty ?? "",
        order_date: row.order_date ?? "",
        scheduled_delivery_date: row.scheduled_delivery_date ?? "",
        ordered_stroke_number: row.ordered_stroke_number ?? "",
      });
    } catch {
      toast("FO not found.", "error");
    } finally {
      setEditLoading(false);
    }
  }

  // Exact FO Number lookup, scoped to every company this user can see (not just the
  // one currently selected) -- auto-resolves the company for multi-company users if
  // the FO turns out to live in a different one of their own companies.
  async function handleFindFoByNumber() {
    const foNumber = foNumberSearch.trim();
    if (!foNumber) return;
    const companyIds = (runtimeContext?.availableCompanies ?? []).map((c) => c.id).filter(Boolean);
    if (companyIds.length === 0) return;
    setFoNumberSearching(true);
    setFoNumberMatches(null);
    try {
      const res = await findPlanFeedByNumber({ fo_number: foNumber, company_ids: companyIds.join(",") });
      // findPlanFeedByNumberHandler's response has no `pagination` key, so
      // fetchProd already unwraps this down to the bare array -- `res.data`
      // was reaching one level too deep (an array has no .data) and always
      // silently produced []. Found live 2026-08-21: real match confirmed via
      // direct API response, but the page still said "not found".
      const matches = Array.isArray(res) ? res : (res?.data ?? []);
      if (matches.length === 0) {
        toast(`FO number "${foNumber}" not found.`, "error");
      } else if (matches.length === 1) {
        await handlePickFoMatch(matches[0]);
      } else {
        setFoNumberMatches(matches);
      }
    } catch (err) {
      toast(err.message || "FO lookup failed.", "error");
    } finally {
      setFoNumberSearching(false);
    }
  }

  async function handlePickFoMatch(match) {
    if (match.company_id && match.company_id !== effectiveCompanyId) {
      setCompanyId(match.company_id);
    }
    setFoNumberMatches(null);
    await loadEditFo(match.id);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editData || !canEditSelectedFo) return;
    setSaving(true);
    try {
      const payload = {
        party_id: editDraft.party_id || null,
        ordered_qty_kg: parseFloat(editDraft.ordered_qty_kg),
        pack_qty: editDraft.pack_qty ? parseInt(editDraft.pack_qty, 10) : null,
        order_date: editDraft.order_date,
        scheduled_delivery_date: editDraft.scheduled_delivery_date || null,
        ordered_stroke_number: editDraft.ordered_stroke_number || null,
      };
      if (!skuLockedForEdit) {
        payload.material_id = editDraft.material_id || null;
        payload.sku = editDraft.sku || null;
        payload.description = editDraft.description || null;
      }
      await (isMtestEdit ? updateMtestPlanFeed : updatePlanFeed)(editData.id, payload);
      toast("FO updated.");
      await loadEditFo(editData.id);
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-list"] });
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-summary"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleCancel() {
    if (!editData) return;
    const confirmed = await openActionConfirm({
      eyebrow: "Plan Feed",
      title: `Cancel FO ${editData.fo_number}?`,
      message: "All mapped Packing PO allocations will be released. If this FO is linked to any active Delivery Order through Sales Order mapping, cancel that Delivery Order first.",
      confirmLabel: "Cancel FO",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await cancelPlanFeed(editData.id);
      toast("FO cancelled.");
      await loadEditFo(editData.id);
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-list"] });
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-summary"] });
    } catch (err) { toast(friendlyErr(err.code ?? err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleReactivate() {
    if (!editData) return;
    const confirmed = await openActionConfirm({
      eyebrow: "Plan Feed",
      title: `Reactivate FO ${editData.fo_number}?`,
      message: "This FO will become serviceable again, but previously released Packing PO or Sales Order mappings will not be restored automatically.",
      confirmLabel: "Reactivate FO",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await reactivatePlanFeed(editData.id);
      toast("FO reactivated.");
      await loadEditFo(editData.id);
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-list"] });
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-summary"] });
    } catch (err) { toast(friendlyErr(err.code ?? err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleFindAllocationCandidate() {
    if (!editData || !canEditSelectedFo || !allocPoNumber.trim()) return;
    setAllocSearching(true);
    setAllocCandidate(null);
    setAllocNumPacks("");
    try {
      const res = await listPackingOrders({ company_id: editData.company_id, po_number: allocPoNumber.trim(), per_page: 5 });
      const rows = res?.data ?? [];
      if (rows.length === 0) {
        toast("No Packing PO found with that number.", "error");
      } else {
        setAllocCandidate(rows[0]);
      }
    } catch (err) {
      toast(err.message || "Packing PO search failed.", "error");
    } finally {
      setAllocSearching(false);
    }
  }

  function handleAllocNumPacksChange(value) {
    setAllocNumPacks(value);
    const packs = Number(value);
    const fillQty = Number(allocCandidate?.fill_qty_per_pack ?? 0);
    if (Number.isFinite(packs) && packs > 0 && fillQty > 0) {
      setAllocQty(String(packs * fillQty));
    }
  }

  async function submitAllocation(confirmMismatch) {
    if (!editData || !canEditSelectedFo || !allocCandidate) return;
    setSaving(true);
    try {
      await (isMtestEdit ? upsertMtestFoAllocation : upsertFoAllocation)(editData.id, {
        packing_order_id: allocCandidate.id,
        allocated_qty_kg: parseFloat(allocQty || "0"),
        confirm_mismatch: confirmMismatch === true,
      });
      toast("Allocation saved.");
      setAllocPoNumber(""); setAllocCandidate(null); setAllocQty(""); setAllocNumPacks("");
      await loadEditFo(editData.id);
    } catch (err) {
      if (err.message === "PROD_PLAN_FEED_MATERIAL_MISMATCH") {
        const confirmed = await openActionConfirm({
          eyebrow: "Plan Feed",
          title: "Material differs from this FO's SKU",
          message: "This Packing PO's material does not match the FO's SKU. Allocate anyway?",
          confirmLabel: "Allocate anyway",
        });
        if (confirmed) await submitAllocation(true);
        return;
      }
      toast(friendlyErr(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAllocationQtyChange(allocation, newQty) {
    if (!editData || !canEditSelectedFo) return;
    try {
      await (isMtestEdit ? upsertMtestFoAllocation : upsertFoAllocation)(editData.id, {
        packing_order_id: allocation.packing_order_id,
        allocated_qty_kg: Number(newQty) || 0,
      });
      toast(Number(newQty) > 0 ? "Allocation updated." : "Allocation removed.");
      await loadEditFo(editData.id);
    } catch (err) {
      toast(friendlyErr(err.message), "error");
    }
  }

  // ── Total Table state ─────────────────────────────────────────────────────
  const summaryQ = useQuery({
    queryKey: ["prod-plan-feed-summary", effectiveCompanyId],
    queryFn: () => getPlanFeedSummary({ company_id: effectiveCompanyId || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: tab === "total",
  });
  const summary = summaryQ.data ?? EMPTY_ARRAY;
  const [totalSearch, setTotalSearch] = useState("");
  const filteredSummary = useMemo(() => {
    const needle = totalSearch.trim().toLowerCase();
    if (!needle) return summary;
    return summary.filter((row) => [
      row.fo_number, row.party_name, row.party_town, row.sku, row.ordered_stroke_number,
      row.ordered_qty_kg, row.pack_qty, row.allocated_qty_kg,
      ...(row.mapped_batch_numbers ?? []),
      row.production_status, row.dispatched_qty_kg, row.dispatch_status,
      row.pending_dispatch_kg, row.scheduled_delivery_date,
    ].filter((v) => v !== null && v !== undefined).join(" ").toLowerCase().includes(needle));
  }, [summary, totalSearch]);

  return (
    <ErpScreenScaffold
      title="Plan Feed"
      subtitle="Firm Order visibility — what customers ordered, and its current production/dispatch state"
    >
      <ErpSectionCard>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="w-64">
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
          </div>
          <div className="flex gap-1 border border-slate-300 rounded overflow-hidden ml-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </ErpSectionCard>

      {/* ── Tab: Create ── */}
      {tab === "create" && (
        <ErpSectionCard title="New Firm Order">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4 max-w-3xl">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">FO Number <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.fo_number} onChange={e => setForm(f => ({ ...f, fo_number: e.target.value }))} required placeholder="e.g. FO-2026-001" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">PO Type (for Party filter)</label>
              <ErpComboboxField
                value={poTypeFilter}
                onChange={setPoTypeFilter}
                options={FO_CUSTOMER_TYPES}
                placeholder="-- All parties --"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Party <span className="text-rose-500">*</span></label>
              <ErpComboboxField
                value={form.party_id}
                onChange={(v) => {
                  setSelectedAddressId("");
                  setAddressPickerSeenForPartyId("");
                  setForm(f => ({ ...f, party_id: v }));
                }}
                options={customerOptions}
                placeholder="-- Select party --"
                emptyStateLabel={customersQ.isLoading ? "Loading..." : "No party matches this PO Type"}
              />
              <button type="button" onClick={() => setNewPartyOpen((v) => !v)} className="text-[11px] text-sky-600 underline self-start">
                + New party
              </button>
              {selectedParty && (
                partyTypeEdit ? (
                  <div className="flex items-center gap-2 mt-1">
                    <ErpComboboxField
                      value={selectedParty.fo_customer_type || ""}
                      onChange={(v) => handleUpdatePartyType(selectedParty.id, v)}
                      options={FO_CUSTOMER_TYPES}
                      placeholder="-- Not an FO party --"
                      disabled={partyTypeSaving}
                    />
                    <button type="button" onClick={() => setPartyTypeEdit(false)} className="text-[11px] text-slate-500 underline">Done</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPartyTypeEdit(true)} className="text-[11px] text-slate-500 underline self-start mt-1">
                    This party's FO Type: <strong>{selectedParty.fo_customer_type || "not set"}</strong> — change here
                  </button>
                )
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Party Address</label>
              <div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-sm text-slate-600 min-h-[34px]">
                {partyAddressesQ.isLoading ? "Loading addresses..." : selectedAddress
                  ? <><span className="font-medium text-slate-800">{addressLabel(selectedAddress)}</span><span className="text-slate-500"> - {addressFullText(selectedAddress)}</span></>
                  : selectedParty ? "No address selected." : "Select a party first."}
              </div>
              {selectedParty ? (
                <div className="flex gap-3 text-[11px]">
                  {partyAddresses.length > 1 ? (
                    <button type="button" onClick={() => setAddressPickerOpen(true)} className="text-sky-600 underline">
                      {selectedAddress ? "Change address" : "Choose address"}
                    </button>
                  ) : null}
                  <button type="button" onClick={openNewAddress} className="text-sky-600 underline">+ Add address</button>
                </div>
              ) : null}
            </div>

            <DrawerBase
              visible={addressPickerOpen}
              title={`Choose address${selectedParty ? ` - ${customerLabel(selectedParty)}` : ""}`}
              side="center"
              width="min(760px, calc(100vw - 24px))"
              onEscape={() => setAddressPickerOpen(false)}
              onClose={() => setAddressPickerOpen(false)}
            >
              <div className="grid gap-2">
                <p className="text-xs text-slate-500">Choose the customer site for this Plan Feed entry.</p>
                {partyAddresses.map((address) => (
                  <button
                    key={address.id}
                    type="button"
                    onClick={() => choosePartyAddress(address.id)}
                    className={`grid gap-1 border px-3 py-2 text-left text-sm ${selectedAddressId === address.id ? "border-sky-600 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <span className="font-semibold text-slate-900">{address.site_name || "Unnamed site"}</span>
                    <span className="text-slate-600">{addressFullText(address)}</span>
                  </button>
                ))}
                <button type="button" onClick={() => { setAddressPickerOpen(false); openNewAddress(); }} className="justify-self-start text-xs text-sky-600 underline">
                  + Add a new address for this customer
                </button>
              </div>
            </DrawerBase>

            <DrawerBase
              visible={newAddressOpen}
              title={`Add address${selectedParty ? ` - ${customerLabel(selectedParty)}` : ""}`}
              side="center"
              width="min(620px, calc(100vw - 24px))"
              onEscape={() => setNewAddressOpen(false)}
              onClose={() => setNewAddressOpen(false)}
              actions={(
                <>
                  <button type="button" onClick={() => setNewAddressOpen(false)} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
                  <button type="button" onClick={() => void handleCreatePartyAddress()} disabled={newAddressSaving} className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50">
                    {newAddressSaving ? "Saving..." : "Add and select"}
                  </button>
                </>
              )}
            >
              <div className="grid gap-3">
                {newAddressError ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{newAddressError}</div> : null}
                <label className="grid gap-1 text-xs font-medium text-slate-600">Site Name<input value={newAddress.site_name} onChange={(event) => setNewAddress((current) => ({ ...current, site_name: event.target.value }))} className="h-9 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></label>
                <label className="grid gap-1 text-xs font-medium text-slate-600">Address<textarea rows={3} value={newAddress.address_line} onChange={(event) => setNewAddress((current) => ({ ...current, address_line: event.target.value }))} className="border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></label>
                <label className="grid gap-1 text-xs font-medium text-slate-600">Town<input value={newAddress.town} onChange={(event) => setNewAddress((current) => ({ ...current, town: event.target.value }))} className="h-9 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500" /></label>
                <div className="text-xs text-slate-500">State: <span className="font-medium text-slate-700">{selectedParty?.billing_state || "Not set on this customer"}</span>. Addresses under one customer must use the same state.</div>
              </div>
            </DrawerBase>

            <DrawerBase
              visible={newPartyOpen}
              title="New FG Sales Customer"
              onEscape={() => setNewPartyOpen(false)}
              onClose={() => setNewPartyOpen(false)}
              width="min(560px, calc(100vw - 24px))"
            >
              {/* Same shared form as MM04/SO01 -- but fieldMode="MINIMAL" (§129.7,
                  Stage 1) shows Production only Customer Name/Address/State/Town/
                  Site Name. GST/Currency/Contact/etc. are Stage 2, added later by
                  anyone with MM04 access via the Customer Detail drawer, not asked
                  here -- Production may not even check GST, nothing should block on
                  that. */}
              <CustomerCreateForm
                companyMode="LOCKED"
                lockedCompanyId={effectiveCompanyId}
                initialFoCustomerType={poTypeFilter}
                fieldMode="MINIMAL"
                onSaved={handlePartyCreated}
                onCancel={() => setNewPartyOpen(false)}
                submitLabel="Create Customer"
              />
            </DrawerBase>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">SKU <span className="text-rose-500">*</span></label>
              {isMtestCreate ? (
                <ErpComboboxField
                  value={form.material_id}
                  onChange={(v) => {
                    const m = (mtestSkusQ.data ?? []).find((row) => row.id === v);
                    setForm(f => ({
                      ...f,
                      material_id: v,
                      sku: m?.external_code || m?.pace_code || "",
                      description: m?.document_name || m?.material_name || f.description,
                    }));
                  }}
                  options={mtestSkuOptions}
                  placeholder="-- Select MTEST sample SKU --"
                  emptyStateLabel={mtestSkusQ.isLoading ? "Loading..." : "No MTEST sample SKUs mapped to this company"}
                />
              ) : (
                <>
                  <SkuTypeaheadField
                    skuText={form.sku}
                    materials={nonMtestMaterials}
                    placeholder="Type SKU — pick a match, or keep typing for a new one"
                    onTextChange={(text) => setForm(f => ({ ...f, sku: text, material_id: "" }))}
                    onPickMaterial={(m) => setForm(f => ({
                      ...f,
                      sku: m.external_code || m.pace_code || f.sku,
                      material_id: m.id,
                      description: m.document_name || m.material_name || f.description,
                    }))}
                  />
                  {form.material_id
                    ? <span className="text-[11px] text-emerald-700">Linked to an existing FG material.</span>
                    : <span className="text-[11px] text-amber-700">No existing material picked — will be saved as a new/free-text SKU.</span>}
                </>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Description</label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {form.material_id && unmappedQ.data?.total_free_qty_kg > 0 && (
              <div className="col-span-2 border border-emerald-200 bg-emerald-50 rounded px-3 py-2 text-xs text-emerald-800">
                <strong>{fmt(unmappedQ.data.total_free_qty_kg)} KG</strong> of this SKU is already produced and unmapped (free) —
                only the remainder needs fresh production.
                <div className="mt-1 text-emerald-700">
                  {unmappedQ.data.lines?.map((l) => (
                    <span key={l.packing_order_id} className="mr-3 inline-block">{l.po_number}: {fmt(l.free_qty_kg)} KG</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Ordered Qty (KG) <span className="text-rose-500">*</span></label>
              <input type="number" step="0.01" min="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.ordered_qty_kg} onChange={e => setForm(f => ({ ...f, ordered_qty_kg: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Pack Qty</label>
              <input type="number" step="1" min="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.pack_qty} onChange={e => setForm(f => ({ ...f, pack_qty: e.target.value }))} placeholder="# of packs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Order Date <span className="text-rose-500">*</span></label>
              <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Scheduled Delivery</label>
              <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.scheduled_delivery_date} onChange={e => setForm(f => ({ ...f, scheduled_delivery_date: e.target.value }))} />
            </div>

            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-xs text-slate-600 font-medium">Ordered Stroke (Production fills in later)</label>
              <StrokeTypeaheadField
                strokeText={form.ordered_stroke_number}
                strokeOptions={strokeOptionsQ.data ?? []}
                placeholder="Type stroke number — pick an existing one, or a new one"
                onTextChange={(text) => setForm(f => ({ ...f, ordered_stroke_number: text }))}
                onPickStroke={(s) => setForm(f => ({ ...f, ordered_stroke_number: s.stroke_number }))}
              />
              {strokeCheckQ.data && (
                strokeCheckQ.data.exists
                  ? <span className="text-[11px] text-emerald-700">Stroke exists (status: {strokeCheckQ.data.status}).</span>
                  : <span className="text-[11px] text-amber-700">Stroke does not exist yet — will need to be created in Stroke Master.</span>
              )}
            </div>

            <div className="col-span-2 flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">
                Save FO
              </button>
              <button type="button" onClick={() => setForm({ ...EMPTY_FO })} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50">
                Clear
              </button>
            </div>
          </form>
        </ErpSectionCard>
      )}

      {/* ── Tab: Edit ── */}
      {tab === "edit" && (
        <>
          <ErpSectionCard title="Find FO by Number">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">FO Number</label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-64"
                  value={foNumberSearch}
                  onChange={(e) => setFoNumberSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleFindFoByNumber(); }}
                  placeholder="Exact FO number"
                />
              </div>
              <button type="button" onClick={handleFindFoByNumber} disabled={foNumberSearching || !foNumberSearch.trim()} className="px-3 py-1.5 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
                {foNumberSearching ? "Searching..." : "Find"}
              </button>
              <span className="text-[11px] text-slate-400">Searches across every company you have access to.</span>
            </div>
            {foNumberMatches && foNumberMatches.length > 1 && (
              <div className="mt-3 border border-amber-200 bg-amber-50 rounded p-2">
                <p className="text-xs text-amber-800 mb-2">This FO number exists in more than one of your companies — pick one:</p>
                <div className="flex flex-col divide-y divide-amber-100">
                  {foNumberMatches.map((m) => {
                    const company = (runtimeContext?.availableCompanies ?? []).find((c) => c.id === m.company_id);
                    return (
                      <button key={m.id} onClick={() => handlePickFoMatch(m)} className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-amber-100 text-left">
                        <span className="text-slate-700">{company?.company_name || company?.company_code || m.company_id}</span>
                        <span className="text-slate-500">{m.party_name}</span>
                        <span className="text-slate-400 text-xs">{m.order_date}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-500 mb-2">Or browse recent FOs in this company:</p>
              <input className="border border-slate-300 rounded px-2 py-1 text-sm w-80" value={editSearch} onChange={e => setEditSearch(e.target.value)} placeholder="Filter by FO number or party..." />
              <div className="mt-2">
                <div className="flex flex-col divide-y divide-slate-100 max-h-56 overflow-y-auto border border-slate-200 rounded">
                  {foListFiltered.map(fo => (
                    <button key={fo.id} onClick={() => loadEditFo(fo.id)}
                      className="flex items-center justify-between px-3 py-2 text-sm hover:bg-sky-50 text-left">
                      <span className="font-mono font-medium text-sky-700">{fo.fo_number}</span>
                      <span className="text-slate-500">{fo.party_name}</span>
                      <span className="text-slate-400 text-xs">{fo.order_date}</span>
                    </button>
                  ))}
                  {foListFiltered.length === 0 && (
                    <p className="px-3 py-4 text-center text-sm text-slate-400">{listQ.isLoading ? "Loading..." : "No FOs matched."}</p>
                  )}
                </div>
              </div>
            </div>
          </ErpSectionCard>

          {editLoading && <ErpSectionCard><p className="text-sm text-slate-400 py-4 text-center">Loading FO...</p></ErpSectionCard>}

          {editData && (
            <>
              <ErpSectionCard title={`Editing: ${editData.fo_number}`} tone={editData.status === "CANCELLED" ? "warning" : "default"}>
                {editData.status === "CANCELLED" && (
                  <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                    This FO is cancelled. You can reactivate it, but Packing PO and Sales Order mappings will need to be rebuilt manually afterwards.
                  </div>
                )}
                {!canEditSelectedFo && !planFeedCapabilityQ.isLoading && (
                  <p className="col-span-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    This is not an MTEST FO. QA can view it, but only Production or ACL-MASTER can edit or map Packing POs.
                  </p>
                )}
                <form onSubmit={handleSaveEdit} className="grid grid-cols-2 gap-4 max-w-3xl">
                  <fieldset disabled={!canEditSelectedFo} className="contents disabled:opacity-55">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Party</label>
                    <ErpComboboxField
                      value={editDraft.party_id}
                      onChange={(v) => setEditDraft(d => ({ ...d, party_id: v }))}
                      options={customerOptions}
                      placeholder="-- Select party --"
                      disabled={editData.status === "CANCELLED"}
                    />
                    {editDraft.party_id && (
                      <button type="button" onClick={() => setEditPartyOpen(true)} className="text-[11px] text-sky-600 underline self-start mt-1">
                        Edit Customer
                      </button>
                    )}
                    {editDraft.party_id && customerMap.get(editDraft.party_id) && (
                      partyTypeEdit ? (
                        <div className="flex items-center gap-2 mt-1">
                          <ErpComboboxField
                            value={customerMap.get(editDraft.party_id)?.fo_customer_type || ""}
                            onChange={(v) => handleUpdatePartyType(editDraft.party_id, v)}
                            options={FO_CUSTOMER_TYPES}
                            placeholder="-- Not an FO party --"
                            disabled={partyTypeSaving}
                          />
                          <button type="button" onClick={() => setPartyTypeEdit(false)} className="text-[11px] text-slate-500 underline">Done</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setPartyTypeEdit(true)} className="text-[11px] text-slate-500 underline self-start mt-1">
                          This party's FO Type: <strong>{customerMap.get(editDraft.party_id)?.fo_customer_type || "not set"}</strong> — change here
                        </button>
                      )
                    )}
                  </div>

                  <DrawerBase
                    visible={editPartyOpen}
                    title="Edit FG Sales Customer"
                    onEscape={() => setEditPartyOpen(false)}
                    onClose={() => setEditPartyOpen(false)}
                    width="min(560px, calc(100vw - 24px))"
                  >
                    <CustomerEditForm
                      customerId={editDraft.party_id}
                      submitLabel="Save"
                      onCancel={() => setEditPartyOpen(false)}
                      onSaved={() => void handlePartyUpdated()}
                    />
                  </DrawerBase>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">
                      SKU {skuLockedForEdit ? <span className="text-amber-600">(locked — allocations exist)</span> : null}
                    </label>
                    {isMtestEdit ? (
                      <ErpComboboxField
                        value={editDraft.material_id}
                        onChange={(v) => {
                          const m = (mtestSkusQ.data ?? []).find((row) => row.id === v);
                          setEditDraft(d => ({
                            ...d,
                            material_id: v,
                            sku: m?.external_code || m?.pace_code || "",
                            description: m?.document_name || m?.material_name || d.description,
                          }));
                        }}
                        options={mtestSkuOptions}
                        placeholder="-- Select MTEST sample SKU --"
                        emptyStateLabel={mtestSkusQ.isLoading ? "Loading..." : "No MTEST sample SKUs mapped to this company"}
                        disabled={editData.status === "CANCELLED" || skuLockedForEdit}
                      />
                    ) : (
                      <SkuTypeaheadField
                        skuText={editDraft.sku ?? ""}
                        materials={nonMtestMaterials}
                        placeholder="Type SKU — pick a match, or keep typing for a new one"
                        disabled={editData.status === "CANCELLED" || skuLockedForEdit}
                        onTextChange={(text) => setEditDraft(d => ({ ...d, sku: text, material_id: "" }))}
                        onPickMaterial={(m) => setEditDraft(d => ({
                          ...d,
                          sku: m.external_code || m.pace_code || d.sku,
                          material_id: m.id,
                          description: m.document_name || m.material_name || d.description,
                        }))}
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-1 col-span-2">
                    <label className="text-xs text-slate-600 font-medium">
                      Description {skuLockedForEdit ? <span className="text-amber-600">(locked)</span> : null}
                    </label>
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.description} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} disabled={editData.status === "CANCELLED" || skuLockedForEdit} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Ordered Qty (KG)</label>
                    <input type="number" step="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.ordered_qty_kg} onChange={e => setEditDraft(d => ({ ...d, ordered_qty_kg: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Pack Qty</label>
                    <input type="number" step="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.pack_qty} onChange={e => setEditDraft(d => ({ ...d, pack_qty: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Order Date</label>
                    <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.order_date} onChange={e => setEditDraft(d => ({ ...d, order_date: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Scheduled Delivery</label>
                    <input type="date" className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.scheduled_delivery_date} onChange={e => setEditDraft(d => ({ ...d, scheduled_delivery_date: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Ordered Stroke</label>
                    <StrokeTypeaheadField
                      strokeText={editDraft.ordered_stroke_number || ""}
                      strokeOptions={editStrokeOptionsQ.data ?? []}
                      placeholder="Type stroke number — pick an existing one, or a new one"
                      disabled={editData.status === "CANCELLED"}
                      onTextChange={(text) => setEditDraft(d => ({ ...d, ordered_stroke_number: text }))}
                      onPickStroke={(s) => setEditDraft(d => ({ ...d, ordered_stroke_number: s.stroke_number }))}
                    />
                    {editStrokeCheckQ.data && (
                      editStrokeCheckQ.data.exists
                        ? <span className="text-[11px] text-emerald-700">Stroke exists (status: {editStrokeCheckQ.data.status}).</span>
                        : <span className="text-[11px] text-amber-700">Stroke does not exist yet — will need to be created in Stroke Master.</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Actual Stroke(s)</label>
                    <div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-sm text-slate-600 min-h-[34px]">
                      {isMtestEdit ? (
                        (editData.actual_stroke_details ?? []).length > 0
                          ? editData.actual_stroke_details.map((s) => (
                            <div key={`${s.prodshade_name ?? ""}|${s.stroke_number}`}>
                              {s.prodshade_name ? `${s.prodshade_name} — ${s.stroke_number}` : s.stroke_number}
                            </div>
                          ))
                          : "-- none yet --"
                      ) : (
                        (editData.actual_stroke_numbers ?? []).length > 0
                          ? editData.actual_stroke_numbers.map((s) => <div key={s}>{s}</div>)
                          : "-- none yet --"
                      )}
                    </div>
                  </div>
                  </fieldset>
                  <div className="col-span-2 flex gap-3 pt-2">
                    {editData.status !== "CANCELLED" ? (
                      <>
                        <button type="submit" disabled={saving || !canEditSelectedFo} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">Save Changes</button>
                        {canEditStandardPlanFeed && <button type="button" onClick={handleCancel} disabled={saving} className="px-4 py-2 border border-rose-300 text-rose-700 text-sm rounded hover:bg-rose-50 disabled:opacity-50">Cancel FO</button>}
                      </>
                    ) : (
                      canEditStandardPlanFeed && <button type="button" onClick={handleReactivate} disabled={saving} className="px-5 py-2 bg-emerald-600 text-white text-sm font-medium rounded hover:bg-emerald-700 disabled:opacity-50">Reactivate FO</button>
                    )}
                  </div>
                </form>
              </ErpSectionCard>

              {editData.status !== "CANCELLED" && (
                <ErpSectionCard title="Packing PO Allocation">
                  <fieldset disabled={!canEditSelectedFo} className="contents disabled:opacity-55">
                  <table className="w-full text-sm border-collapse mb-4">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <th className="text-left py-2 px-3 border-b">PO Number</th>
                        <th className="text-left py-2 px-3 border-b">Material</th>
                        <th className="text-left py-2 px-3 border-b">Status</th>
                        <th className="text-right py-2 px-3 border-b">Fill Qty/Pack</th>
                        <th className="text-right py-2 px-3 border-b">Num Packs</th>
                        <th className="text-right py-2 px-3 border-b">PO Qty</th>
                        <th className="text-right py-2 px-3 border-b">Allocated (KG)</th>
                        <th className="text-right py-2 px-3 border-b">Room to Increase</th>
                        <th className="py-2 px-3 border-b"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(editData.allocations ?? []).map((a) => {
                        const po = a.packing_order ?? {};
                        return (
                          <tr key={a.id} className="border-b border-slate-100">
                            <td className="py-2 px-3 font-mono">{po.po_number}</td>
                            <td className="py-2 px-3">{materialLabel(po.material)}</td>
                            <td className="py-2 px-3">{po.status}</td>
                            <td className="py-2 px-3 text-right font-mono">{po.fill_qty_per_pack != null ? fmt(po.fill_qty_per_pack) : "—"}</td>
                            <td className="py-2 px-3 text-right font-mono">{po.num_packs ?? "—"}</td>
                            <td className="py-2 px-3 text-right font-mono">{fmt(po.actual_qty_kg || po.planned_qty_kg)}</td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number" step="0.01" defaultValue={a.allocated_qty_kg}
                                max={po.available_qty_kg_excl_this_fo}
                                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                                onBlur={(e) => {
                                  if (Number(e.target.value) !== Number(a.allocated_qty_kg)) {
                                    handleAllocationQtyChange(a, e.target.value);
                                  }
                                }}
                              />
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-emerald-700">
                              {fmt(Math.max(0, (po.available_qty_kg_excl_this_fo ?? 0) - Number(a.allocated_qty_kg)))}
                            </td>
                            <td className="py-2 px-3">
                              <button type="button" onClick={() => handleAllocationQtyChange(a, 0)} className="text-rose-600 text-xs underline">Unmap</button>
                            </td>
                          </tr>
                        );
                      })}
                      {(editData.allocations ?? []).length === 0 && (
                        <tr><td colSpan={9} className="py-4 text-center text-slate-400 text-sm">No Packing PO allocated yet.</td></tr>
                      )}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap gap-2 items-end border-t border-slate-200 pt-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-600 font-medium">Packing PO Number</label>
                      <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-48" value={allocPoNumber} onChange={e => setAllocPoNumber(e.target.value)} />
                    </div>
                    <button type="button" onClick={handleFindAllocationCandidate} disabled={allocSearching} className="px-3 py-1.5 border border-slate-300 text-sm rounded hover:bg-slate-50">
                      {allocSearching ? "Searching..." : "Find"}
                    </button>
                    {allocCandidate && (() => {
                      const totalQty = Number(allocCandidate.actual_qty_kg) || Number(allocCandidate.planned_qty_kg) || 0;
                      const ownExisting = (editData.allocations ?? []).find(
                        (a) => a.packing_order_id === allocCandidate.id,
                      )?.allocated_qty_kg ?? 0;
                      const availableForThisFo = (allocCandidate.fo_available_qty_kg ?? totalQty) + Number(ownExisting);
                      return (
                        <>
                          <div className="text-sm text-slate-600">
                            Found: <span className="font-mono">{allocCandidate.po_number}</span> ({materialLabel(allocCandidate.material)})
                            {allocCandidate.fill_qty_per_pack != null && (
                              <span> — {fmt(allocCandidate.fill_qty_per_pack)} KG/pack × {allocCandidate.num_packs ?? "—"} packs</span>
                            )}
                            <br />
                            Total: <strong>{fmt(totalQty)} KG</strong> &nbsp;|&nbsp;
                            Already allocated elsewhere: <strong>{fmt(allocCandidate.fo_allocated_qty_kg ? Number(allocCandidate.fo_allocated_qty_kg) - Number(ownExisting) : 0)} KG</strong> &nbsp;|&nbsp;
                            <span className="text-emerald-700">Available to allocate: <strong>{fmt(availableForThisFo)} KG</strong></span>
                          </div>
                          {allocCandidate.fill_qty_per_pack ? (
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-slate-600 font-medium">Num Packs to Allocate</label>
                              <input type="number" step="1" min="0" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-28" value={allocNumPacks} onChange={e => handleAllocNumPacksChange(e.target.value)} />
                              <span className="text-[11px] text-slate-400">= {fmt(Number(allocNumPacks || 0) * Number(allocCandidate.fill_qty_per_pack))} KG</span>
                            </div>
                          ) : null}
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-600 font-medium">Allocate Qty (KG)</label>
                            <input type="number" step="0.01" max={availableForThisFo} className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-32" value={allocQty} onChange={e => { setAllocQty(e.target.value); setAllocNumPacks(""); }} />
                            {Number(allocQty) > availableForThisFo && (
                              <span className="text-[11px] text-rose-600">Exceeds available quantity.</span>
                            )}
                          </div>
                          <button type="button" disabled={saving || !allocQty} onClick={() => submitAllocation(false)} className="px-3 py-1.5 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
                            Allocate
                          </button>
                        </>
                      );
                    })()}
                  </div>
                  </fieldset>
                </ErpSectionCard>
              )}
            </>
          )}
        </>
      )}

      {/* ── Tab: Total Table ── */}
      {tab === "total" && (
        <ErpSectionCard title="Total Table — Order Summary">
          <div className="mb-3 max-w-md">
            <QuickFilterInput
              label="Quick Search"
              value={totalSearch}
              onChange={setTotalSearch}
              placeholder="Search FO #, party, SKU, stroke, batch, status..."
              hint="Matches any column in this table."
            />
          </div>
          {summaryQ.isLoading ? (
            <p className="text-slate-400 text-sm py-6 text-center">Loading summary...</p>
          ) : summary.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No active FOs found.</p>
          ) : filteredSummary.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No rows match this search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[1240px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">FO #</th>
                    <th className="text-left py-2 px-3 border-b">Party</th>
                    <th className="text-left py-2 px-3 border-b">Town</th>
                    <th className="text-left py-2 px-3 border-b">SKU</th>
                    <th className="text-left py-2 px-3 border-b">Ordered Stroke</th>
                    <th className="text-right py-2 px-3 border-b">Ordered KG</th>
                    <th className="text-right py-2 px-3 border-b">Pack Qty</th>
                    <th className="text-right py-2 px-3 border-b">Mapped KG</th>
                    <th className="text-left py-2 px-3 border-b">Mapped Batch No(s)</th>
                    <th className="text-center py-2 px-3 border-b">Production</th>
                    <th className="text-right py-2 px-3 border-b">Dispatched KG</th>
                    <th className="text-center py-2 px-3 border-b">Dispatch</th>
                    <th className="text-right py-2 px-3 border-b">Pending KG</th>
                    <th className="text-left py-2 px-3 border-b">Del Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummary.map(row => (
                    <tr key={row.id ?? row.fo_number} className="border-b border-slate-100 hover:bg-sky-50">
                      <td className="py-2 px-3 font-mono font-semibold text-sky-700">{row.fo_number}</td>
                      <td className="py-2 px-3">{row.party_name}</td>
                      <td className="py-2 px-3 text-slate-500">{row.party_town || ""}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{row.sku}</td>
                      <td className="py-2 px-3 font-mono">
                        {row.ordered_stroke_number || "--"}
                        {row.ordered_stroke_missing && (
                          <span className="ml-1 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-rose-800" title="Not in Stroke Master yet">
                            Not in Stroke Master
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(row.ordered_qty_kg)}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.pack_qty ?? "--"}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(row.allocated_qty_kg)}</td>
                      <td className="py-2 px-3 font-mono text-xs text-slate-600">
                        {normalizeFoCustomerType(row.fo_customer_type) === "MTEST" ? (
                          (row.mapped_batch_details ?? []).length > 0
                            ? row.mapped_batch_details.map((info) => {
                              const suffix = [info.prodshade_name, info.stroke_number].filter(Boolean).join(" — ");
                              return (
                                <div key={info.batch_number}>
                                  {info.batch_number}
                                  {suffix ? <span className="text-slate-400"> — {suffix}</span> : null}
                                </div>
                              );
                            })
                            : ""
                        ) : (
                          (row.mapped_batch_numbers ?? []).length > 0
                            ? row.mapped_batch_numbers.map((batchNo) => (
                              <div key={batchNo}>{batchNo}</div>
                            ))
                            : ""
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${productionStatusTone(row.production_status)}`}>
                          {row.production_status?.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-700">{fmt(row.dispatched_qty_kg)}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${dispatchStatusTone(row.dispatch_status)}`}>
                          {row.dispatch_status?.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-amber-700">{fmt(row.pending_dispatch_kg)}</td>
                      <td className="py-2 px-3 text-slate-400 text-xs">{row.scheduled_delivery_date ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
