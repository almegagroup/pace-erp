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
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { pushToast } from "../../../store/uiToast.js";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
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
  listMtestSkus,
} from "./prodApi.js";
import { createCustomerAddress, listMaterials, listCustomers, updateCustomer, listCustomerAddresses } from "../om/omApi.js";
import { getManualDocumentDateBounds, isManualDocumentDateWithinWindow, MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE } from "../../../utils/manualDocumentDateWindow.js";

const EMPTY_ARRAY = [];
const MANUAL_DATE_BOUNDS = getManualDocumentDateBounds();

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
  PROD_PLAN_FEED_ITEM_MATERIAL_MISMATCH: "Packing PO material differs from the selected FO item.",
  PROD_PLAN_FEED_ITEM_ALLOCATION_EXCEEDS_ORDERED: "Allocation exceeds the selected FO item's ordered quantity.",
  PROD_PLAN_FEED_ITEM_REQUIRED: "Select the FO item this Packing PO fulfills.",
  PROD_PLAN_FEED_ITEM_IN_USE: "Release the linked Packing PO and SO Map allocations before deleting this item.",
  PROD_PLAN_FEED_ITEM_LAST_DELETE_BLOCKED: "An FO must retain at least one item line.",
  PROD_PLAN_FEED_ITEM_QTY_BELOW_COMMITTED: "Item quantity cannot be reduced below its committed Packing PO or SO Map quantity.",
  PROD_PLAN_FEED_PACKING_PO_COMPANY_MISMATCH: "Packing PO must belong to the same company as this FO.",
  PROD_PLAN_FEED_PACKING_PO_NOT_FINAL: "Only a FINAL Packing PO can be allocated to an FO.",
  PROD_PLAN_FEED_SHIP_TO_REQUIRED: "Select an active Ship-To address before saving this FO.",
  PROD_PLAN_FEED_CANCEL_BLOCKED_BY_DO: "Cancel the linked Delivery Order first, then cancel this FO.",
  PROD_PLAN_FEED_DATE_OUTSIDE_ALLOWED_WINDOW: "Date must be within three calendar months before or after today.",
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

function localIsoDate() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
function summaryListText(values) {
  return (values ?? []).filter(Boolean).join(" | ");
}
function summaryDateLines(values) {
  return (values ?? []).filter(Boolean).map((value) => <div key={value}>{value}</div>);
}
function gridCellValue(row, column) {
  return String(typeof column.copyValue === "function" ? column.copyValue(row) : row?.[column.key] ?? "");
}

function emptyFo() {
  return {
    fo_number: "", party_id: "", party_name: "", material_id: "", sku: "", description: "",
    ordered_qty_kg: "", pack_qty: "", order_date: localIsoDate(), scheduled_delivery_date: "", ordered_stroke_number: "",
  };
}

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
  const [form, setForm] = useState(emptyFo);
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
    if (!form.fo_number.trim() || !form.party_id || !selectedAddressId || !form.sku.trim() || !form.description.trim()
      || !form.ordered_qty_kg || !form.pack_qty || !form.order_date || !form.scheduled_delivery_date) {
      toast("Complete every FO field except Ordered Stroke before saving.", "error");
      return;
    }
    if (!isManualDocumentDateWithinWindow(form.order_date) || (form.scheduled_delivery_date && !isManualDocumentDateWithinWindow(form.scheduled_delivery_date))) {
      toast(MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE, "error");
      return;
    }
    if (!form.party_id || !selectedAddressId) {
      toast("Select a party and its Ship-To address before creating this FO.", "error");
      return;
    }
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
        pack_qty: parseInt(form.pack_qty, 10),
        order_date: form.order_date,
        scheduled_delivery_date: form.scheduled_delivery_date,
        ordered_stroke_number: form.ordered_stroke_number || undefined,
      });
      toast("FO created successfully.");
      setForm(emptyFo());
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
  const [editData, setEditData] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editLoading, setEditLoading] = useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [allocPoNumber, setAllocPoNumber] = useState("");
  const [allocCandidate, setAllocCandidate] = useState(null);
  const [allocQty, setAllocQty] = useState("");
  const [allocNumPacks, setAllocNumPacks] = useState("");
  const [allocSearching, setAllocSearching] = useState(false);
  const [allocationItemId, setAllocationItemId] = useState("");

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

  const editPartyAddressesQ = useQuery({
    queryKey: ["plan-feed-edit-party-addresses", editDraft.party_id],
    queryFn: () => listCustomerAddresses(editDraft.party_id),
    enabled: Boolean(editDraft.party_id),
    select: (d) => d?.data ?? d ?? [],
  });
  const editPartyAddresses = editPartyAddressesQ.data ?? EMPTY_ARRAY;

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
    setEditDrawerOpen(true);
    setEditData(null);
    try {
      const d = await getPlanFeed(foId);
      const row = d?.data ?? d;
      setEditData(row);
      setAllocationItemId((row.items ?? []).length === 1 ? row.items[0].id : "");
      setEditDraft({
        party_id: row.party_id ?? "",
        customer_address_id: row.customer_address_id ?? "",
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
      setEditDrawerOpen(false);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editData || !canEditSelectedFo) return;
    if (!editDraft.party_id || !editDraft.customer_address_id || !editDraft.sku?.trim() || !editDraft.description?.trim()
      || !editDraft.ordered_qty_kg || !editDraft.pack_qty || !editDraft.order_date || !editDraft.scheduled_delivery_date) {
      toast("Complete every FO field except Ordered Stroke before saving.", "error");
      return;
    }
    if (!isManualDocumentDateWithinWindow(editDraft.order_date) || !isManualDocumentDateWithinWindow(editDraft.scheduled_delivery_date)) {
      toast(MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE, "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        party_id: editDraft.party_id || null,
        customer_address_id: editDraft.customer_address_id || null,
        ordered_qty_kg: parseFloat(editDraft.ordered_qty_kg),
        pack_qty: parseInt(editDraft.pack_qty, 10),
        order_date: editDraft.order_date,
        scheduled_delivery_date: editDraft.scheduled_delivery_date,
        ordered_stroke_number: editDraft.ordered_stroke_number?.trim() || null,
      };
      if (!skuLockedForEdit) {
        Object.assign(payload, {
          material_id: editDraft.material_id || null,
          sku: editDraft.sku,
          description: editDraft.description,
        });
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
        plan_feed_item_id: allocationItemId,
        allocated_qty_kg: parseFloat(allocQty || "0"),
        confirm_mismatch: confirmMismatch === true,
      });
      toast("Allocation saved.");
      setAllocPoNumber(""); setAllocCandidate(null); setAllocQty(""); setAllocNumPacks(""); setAllocationItemId("");
      await loadEditFo(editData.id);
    } catch (err) {
      if (err.code === "PROD_PLAN_FEED_MATERIAL_MISMATCH" || err.code === "PROD_PLAN_FEED_ITEM_MATERIAL_MISMATCH") {
        const confirmed = await openActionConfirm({
          eyebrow: "Plan Feed",
          title: "Material differs from this FO's SKU",
          message: "This Packing PO's material does not match the FO's SKU. Allocate anyway?",
          confirmLabel: "Allocate anyway",
        });
        if (confirmed) await submitAllocation(true);
        return;
      }
      toast(friendlyErr(err.code ?? err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAllocationQtyChange(allocation, newQty, confirmMismatch) {
    if (!editData || !canEditSelectedFo) return;
    try {
      await (isMtestEdit ? upsertMtestFoAllocation : upsertFoAllocation)(editData.id, {
        packing_order_id: allocation.packing_order_id,
        plan_feed_item_id: allocation.plan_feed_item_id,
        allocated_qty_kg: Number(newQty) || 0,
        confirm_mismatch: confirmMismatch === true,
      });
      toast(Number(newQty) > 0 ? "Allocation updated." : "Allocation removed.");
      await loadEditFo(editData.id);
    } catch (err) {
      if (err.code === "PROD_PLAN_FEED_MATERIAL_MISMATCH" || err.code === "PROD_PLAN_FEED_ITEM_MATERIAL_MISMATCH") {
        const confirmed = await openActionConfirm({
          eyebrow: "Plan Feed",
          title: "Material differs from this FO's SKU",
          message: "This Packing PO's material does not match the FO's SKU. Allocate anyway?",
          confirmLabel: "Allocate anyway",
        });
        if (confirmed) await handleAllocationQtyChange(allocation, newQty, true);
        return;
      }
      toast(friendlyErr(err.code ?? err.message), "error");
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
  const [totalColumnFilters, setTotalColumnFilters] = useState({});
  const [totalFiltersOpen, setTotalFiltersOpen] = useState(false);
  const [exportingTotal, setExportingTotal] = useState(false);
  const totalColumns = useMemo(() => [
    { key: "fo_number", label: "FO #", width: "140px", render: (r) => <span className="font-mono font-semibold text-sky-700">{r.fo_number || "--"}</span> },
    { key: "party_name", label: "Party", width: "200px" },
    { key: "party_town", label: "Town", width: "120px" },
    { key: "sku", label: "SKU", width: "135px", render: (r) => <span className="font-mono">{r.sku || "--"}</span> },
    { key: "ordered_stroke_number", label: "Ordered Stroke", width: "135px", render: (r) => <span className="font-mono">{r.ordered_stroke_number || "--"}{r.ordered_stroke_missing ? " (Not in Stroke Master)" : ""}</span> },
    { key: "ordered_qty_kg", label: "Ordered KG", width: "110px", align: "right", copyValue: (r) => fmt(r.ordered_qty_kg), excelValue: (r) => Number(r.ordered_qty_kg ?? 0), numFmt: "#,##0.000", render: (r) => <span className="font-mono">{fmt(r.ordered_qty_kg)}</span> },
    { key: "pack_qty", label: "Pack Qty", width: "90px", align: "right", copyValue: (r) => r.pack_qty ?? "--", excelValue: (r) => (r.pack_qty ?? "" ) === "" ? "" : Number(r.pack_qty), render: (r) => <span className="font-mono">{r.pack_qty ?? "--"}</span> },
    { key: "allocated_qty_kg", label: "Mapped KG", width: "110px", align: "right", copyValue: (r) => fmt(r.allocated_qty_kg), excelValue: (r) => Number(r.allocated_qty_kg ?? 0), numFmt: "#,##0.000", render: (r) => <span className="font-mono">{fmt(r.allocated_qty_kg)}</span> },
    { key: "mapped_batches", label: "Mapped Batch No(s)", width: "220px", copyValue: (r) => summaryListText(r.mapped_batch_numbers), render: (r) => <span className="font-mono">{summaryListText(r.mapped_batch_numbers) || "--"}</span> },
    { key: "production_status", label: "Production", width: "140px", copyValue: (r) => r.production_status?.replaceAll("_", " ") ?? "--", render: (r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${productionStatusTone(r.production_status)}`}>{r.production_status?.replaceAll("_", " ")}</span> },
    { key: "dispatched_qty_kg", label: "Dispatched KG", width: "120px", align: "right", copyValue: (r) => fmt(r.dispatched_qty_kg), excelValue: (r) => Number(r.dispatched_qty_kg ?? 0), numFmt: "#,##0.000", render: (r) => <span className="font-mono text-emerald-700">{fmt(r.dispatched_qty_kg)}</span> },
    { key: "dispatch_status", label: "Dispatch", width: "150px", copyValue: (r) => r.dispatch_status?.replaceAll("_", " ") ?? "--", render: (r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${dispatchStatusTone(r.dispatch_status)}`}>{r.dispatch_status?.replaceAll("_", " ")}</span> },
    { key: "delivery_orders", label: "DO Number", width: "145px", copyValue: (r) => summaryListText((r.delivery_orders ?? []).map((entry) => entry.dc_number)), render: (r) => <span className="font-mono">{summaryListText((r.delivery_orders ?? []).map((entry) => entry.dc_number)) || "--"}</span> },
    { key: "delivery_order_dates", label: "DO Date", width: "115px", copyValue: (r) => summaryListText((r.delivery_orders ?? []).map((entry) => entry.dc_date)), render: (r) => summaryListText((r.delivery_orders ?? []).map((entry) => entry.dc_date)) || "--" },
    { key: "tally_invoice_numbers", label: "Tally Invoice No.", width: "160px", copyValue: (r) => summaryListText(r.tally_invoice_numbers), render: (r) => <span className="font-mono">{summaryListText(r.tally_invoice_numbers) || "--"}</span> },
    { key: "dispatch_dates", label: "Dispatch Date", width: "120px", copyValue: (r) => summaryListText(r.dispatch_dates), render: (r) => r.dispatch_dates?.length ? <span className="font-mono leading-5">{summaryDateLines(r.dispatch_dates)}</span> : "--" },
    { key: "pending_dispatch_kg", label: "Pending KG", width: "110px", align: "right", copyValue: (r) => fmt(r.pending_dispatch_kg), excelValue: (r) => Number(r.pending_dispatch_kg ?? 0), numFmt: "#,##0.000", render: (r) => <span className="font-mono text-amber-700">{fmt(r.pending_dispatch_kg)}</span> },
    { key: "order_date", label: "Order Date", width: "110px" },
    { key: "scheduled_delivery_date", label: "Del. Date", width: "110px" },
  ], []);
  const totalSuggestions = useMemo(() => [...new Set(summary.flatMap((row) => totalColumns.map((column) => gridCellValue(row, column)).filter(Boolean)))].sort((a, b) => a.localeCompare(b)).slice(0, 300), [summary, totalColumns]);
  const totalSuggestionsByColumn = useMemo(() => Object.fromEntries(totalColumns.map((column) => [column.key, [...new Set(summary.map((row) => gridCellValue(row, column)).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 150)])), [summary, totalColumns]);
  const filteredSummary = useMemo(() => {
    const needle = totalSearch.trim().toLowerCase();
    return summary.filter((row) => {
      const globalMatch = !needle || totalColumns.some((column) => gridCellValue(row, column).toLowerCase().includes(needle));
      const columnMatch = Object.entries(totalColumnFilters).every(([key, value]) => {
        if (!value?.trim()) return true;
        const column = totalColumns.find((entry) => entry.key === key);
        return column ? gridCellValue(row, column).toLowerCase().includes(value.trim().toLowerCase()) : true;
      });
      return globalMatch && columnMatch;
    });
  }, [summary, totalSearch, totalColumnFilters, totalColumns]);
  async function handleExportTotalExcel() {
    setExportingTotal(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `plan_feed_total_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: "Plan Feed Total",
        columns: totalColumns,
        rows: filteredSummary,
        // gridCellValue always coerces to a display string (it also drives search/copy, which
        // genuinely need one) -- Excel export must NOT do that for numeric columns, or every
        // cell lands as text and can't be SUM()'d. excelValue (raw number) takes priority when set.
        getCellValue: (row, column) =>
          typeof column.excelValue === "function" ? column.excelValue(row) : gridCellValue(row, column),
      });
    } catch (err) { toast(err instanceof Error ? err.message : "PLAN_FEED_EXPORT_FAILED", "error"); }
    finally { setExportingTotal(false); }
  }

  return (
    <ErpScreenScaffold
      title="Plan Feed"
      subtitle="Firm Order visibility — what customers ordered, and its current production/dispatch state"
      actions={tab === "total" ? [{ key: "plan-feed-total-columns", label: totalFiltersOpen ? "Hide Column Filters" : "Column Filters", onClick: () => setTotalFiltersOpen((open) => !open) }, { key: "plan-feed-total-export", label: exportingTotal ? "Exporting..." : "Export Excel", onClick: () => void handleExportTotalExcel(), disabled: exportingTotal || filteredSummary.length === 0 }] : []}
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
              <label className="text-xs text-slate-600 font-medium">Party Address <span className="text-rose-500">*</span></label>
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
              <label className="text-xs text-slate-600 font-medium">Description <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
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
              <label className="text-xs text-slate-600 font-medium">Pack Qty <span className="text-rose-500">*</span></label>
              <input type="number" step="1" min="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.pack_qty} onChange={e => setForm(f => ({ ...f, pack_qty: e.target.value }))} placeholder="# of packs" required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Order Date <span className="text-rose-500">*</span></label>
              <input type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Scheduled Delivery <span className="text-rose-500">*</span></label>
              <input type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.scheduled_delivery_date} onChange={e => setForm(f => ({ ...f, scheduled_delivery_date: e.target.value }))} required />
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
              <button type="button" onClick={() => setForm(emptyFo())} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50">
                Clear
              </button>
            </div>
          </form>
        </ErpSectionCard>
      )}

      {/* ── Tab: Edit ── */}
      {tab === "edit" && (
        <>
          <ErpSectionCard title="FO Register">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="grid min-w-[320px] flex-1 gap-1 text-xs font-medium text-slate-600">
                Search FO Register
                <input className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" value={editSearch} onChange={(event) => setEditSearch(event.target.value)} placeholder="FO number, party, SKU, status..." />
              </label>
              <span className="inline-flex items-center gap-1.5 pb-1 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
                Ship-To address not set. Press Enter or double-click a row to open its full details.
              </span>
            </div>
            <ErpDenseGrid
              columns={[
                {
                  key: "fo_number",
                  label: "FO #",
                  width: "150px",
                  render: (row) => (
                    <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-sky-700">
                      {row.fo_number}
                      {!row.customer_address_id && (
                        <span
                          className="h-2 w-2 rounded-full bg-rose-500"
                          title="Ship-To address not set"
                          aria-label="Ship-To address not set"
                        />
                      )}
                    </span>
                  ),
                },
                { key: "party_name", label: "Party", width: "230px" },
                { key: "sku", label: "SKU", width: "150px", render: (row) => <span className="font-mono">{row.sku || "--"}</span> },
                { key: "ordered_qty_kg", label: "Ordered KG", width: "115px", align: "right", copyValue: (row) => fmt(row.ordered_qty_kg), render: (row) => <span className="font-mono">{fmt(row.ordered_qty_kg)}</span> },
                { key: "status", label: "Status", width: "110px" },
                { key: "order_date", label: "Order Date", width: "115px" },
                { key: "scheduled_delivery_date", label: "Del. Date", width: "115px" },
              ]}
              rows={foListFiltered}
              rowKey={(row) => row.id}
              onRowActivate={(row) => void loadEditFo(row.id)}
              getRowProps={(row) => ({ onDoubleClick: () => void loadEditFo(row.id) })}
              cellNavigate
              rangeSelect
              virtualize
              stickyFirstColumn
              maxHeight="calc(100vh - 330px)"
              emptyMessage={listQ.isLoading ? "Loading FOs..." : "No FOs matched the current search."}
            />
          </ErpSectionCard>

          {editLoading && <p className="text-sm text-slate-400 py-2 text-center">Loading FO details...</p>}

          {editDrawerOpen && (
            <DrawerBase
              visible={editDrawerOpen}
              title={editData ? `Edit FO — ${editData.fo_number}` : "Loading FO..."}
              side="center"
              width="min(1480px, calc(100vw - 24px))"
              onClose={() => setEditDrawerOpen(false)}
              onEscape={() => setEditDrawerOpen(false)}
              actions={<button type="button" onClick={() => setEditDrawerOpen(false)} className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">Close</button>}
            >
              {editData ? (
              <div className="grid gap-3">
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
                      onChange={(v) => setEditDraft(d => ({ ...d, party_id: v, customer_address_id: "" }))}
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
                    <label className="mt-2 text-xs text-slate-600 font-medium">Ship-To Address <span className="text-rose-500">*</span></label>
                    <select
                      value={editDraft.customer_address_id || ""}
                      onChange={(event) => setEditDraft((d) => ({ ...d, customer_address_id: event.target.value }))}
                      disabled={editData.status === "CANCELLED" || !editDraft.party_id || editPartyAddressesQ.isLoading}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm disabled:opacity-50"
                    >
                      <option value="">-- Select Ship-To address --</option>
                      {editPartyAddresses.map((address) => (
                        <option key={address.id} value={address.id}>
                          {addressLabel(address)}{address.state ? `, ${address.state}` : ""}
                        </option>
                      ))}
                    </select>
                    {!editDraft.customer_address_id && !editPartyAddressesQ.isLoading && (
                      <p className="text-[11px] text-rose-700">A Ship-To address is required before this FO can be saved.</p>
                    )}
                    {editDraft.customer_address_id && (
                      <p className="text-[11px] text-slate-500">
                        {addressFullText(editPartyAddresses.find((address) => address.id === editDraft.customer_address_id))}
                      </p>
                    )}
                    {!editPartyAddressesQ.isLoading && editDraft.party_id && editPartyAddresses.length === 0 && (
                      <p className="text-[11px] text-amber-700">No active address exists for this party. Use Edit Customer to add one.</p>
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
                        disabled={skuLockedForEdit || editData.status === "CANCELLED"}
                      />
                    ) : (
                      <SkuTypeaheadField
                        skuText={editDraft.sku ?? ""}
                        materials={nonMtestMaterials}
                        placeholder="Type SKU — pick a match, or keep typing for a new one"
                        disabled={skuLockedForEdit || editData.status === "CANCELLED"}
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
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.description} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} disabled={skuLockedForEdit || editData.status === "CANCELLED"} required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Ordered Qty (KG)</label>
                    <input type="number" step="0.01" min="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.ordered_qty_kg} onChange={e => setEditDraft(d => ({ ...d, ordered_qty_kg: e.target.value }))} disabled={editData.status === "CANCELLED"} required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Pack Qty</label>
                    <input type="number" step="1" min="1" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.pack_qty} onChange={e => setEditDraft(d => ({ ...d, pack_qty: e.target.value }))} disabled={editData.status === "CANCELLED"} required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">FO Order Date</label>
                    <input key={`${editData.id}-order-date`} type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.order_date} onChange={e => setEditDraft(d => ({ ...d, order_date: e.target.value }))} disabled={editData.status === "CANCELLED"} required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">FO Delivery Date (Proposed Dispatch)</label>
                    <input key={`${editData.id}-delivery-date`} type="date" min={MANUAL_DATE_BOUNDS.min} max={MANUAL_DATE_BOUNDS.max} className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={editDraft.scheduled_delivery_date} onChange={e => setEditDraft(d => ({ ...d, scheduled_delivery_date: e.target.value }))} disabled={editData.status === "CANCELLED"} required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Ordered Stroke</label>
                    <StrokeTypeaheadField
                      strokeText={editDraft.ordered_stroke_number || ""}
                      strokeOptions={editStrokeOptionsQ.data ?? []}
                      placeholder="Type stroke number — pick an existing one, or a new one"
                      disabled={editData.status === "CANCELLED"}
                      onTextChange={(text) => setEditDraft(d => ({ ...d, ordered_stroke_number: text }))}
                      onPickStroke={(stroke) => setEditDraft(d => ({ ...d, ordered_stroke_number: stroke.stroke_number }))}
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

              <ErpSectionCard title="Mapped Packing PO Details">
                <p className="mb-3 text-sm text-slate-600">Read-only production traceability for the Packing POs mapped to this FO.</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1260px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                        <th className="border-b px-3 py-2 text-left">Packing PO</th>
                        <th className="border-b px-3 py-2 text-left">SKU</th>
                        <th className="border-b px-3 py-2 text-left">Document Name</th>
                        <th className="border-b px-3 py-2 text-left">Prodshade</th>
                        <th className="border-b px-3 py-2 text-left">Actual Stroke</th>
                        <th className="border-b px-3 py-2 text-left">Batch No.</th>
                        <th className="border-b px-3 py-2 text-left">Status</th>
                        <th className="border-b px-3 py-2 text-right">Per Pack (KG)</th>
                        <th className="border-b px-3 py-2 text-right">No. of Packs</th>
                        <th className="border-b px-3 py-2 text-right">PO Qty (KG)</th>
                        <th className="border-b px-3 py-2 text-right">Mapped Qty (KG)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(editData.allocations ?? []).map((allocation) => {
                        const po = allocation.packing_order ?? {};
                        const material = po.material ?? {};
                        return <tr key={allocation.id} className="border-b border-slate-100 hover:bg-sky-50">
                          <td className="px-3 py-2 font-mono">{po.po_number || "--"}</td>
                          <td className="px-3 py-2 font-mono">{material.external_code || material.pace_code || allocation.plan_feed_item?.sku || "--"}</td>
                          <td className="px-3 py-2">{material.document_name || material.material_name || "--"}</td>
                          <td className="px-3 py-2">{po.actual_stroke?.prodshade_name || "--"}</td>
                          <td className="px-3 py-2 font-mono">{po.actual_stroke?.stroke_number || "--"}</td>
                          <td className="px-3 py-2 font-mono">{po.batch_number || "--"}</td>
                          <td className="px-3 py-2">{po.status || "--"}</td>
                          <td className="px-3 py-2 text-right font-mono">{po.fill_qty_per_pack != null ? fmt(po.fill_qty_per_pack) : "--"}</td>
                          <td className="px-3 py-2 text-right font-mono">{po.num_packs ?? "--"}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(po.actual_qty_kg || po.planned_qty_kg)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-sky-700">{fmt(allocation.allocated_qty_kg)}</td>
                        </tr>;
                      })}
                      {(editData.allocations ?? []).length === 0 && (
                        <tr><td colSpan={11} className="px-3 py-5 text-center text-sm text-slate-400">No Packing PO is mapped to this FO yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
                        <th className="text-left py-2 px-3 border-b">Batch No.</th>
                        <th className="text-left py-2 px-3 border-b">Actual Stroke</th>
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
                      <td className="py-2 px-3">{a.plan_feed_item?.sku || "Unassigned item"}<div className="text-xs text-slate-500">{materialLabel(po.material)}</div></td>
                            <td className="py-2 px-3">{po.status}</td>
                            <td className="py-2 px-3 font-mono text-xs">{po.batch_number || "--"}</td>
                            <td className="py-2 px-3 text-xs">{po.actual_stroke?.stroke_number || "--"}{po.actual_stroke?.prodshade_name ? <div className="text-slate-500">{po.actual_stroke.prodshade_name}</div> : null}</td>
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
                        <tr><td colSpan={11} className="py-4 text-center text-slate-400 text-sm">No Packing PO allocated yet.</td></tr>
                      )}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap gap-2 items-end border-t border-slate-200 pt-3">
                    {(editData.items ?? []).length > 1 ? (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-600 font-medium">FO Item</label>
                        <select value={allocationItemId} onChange={(e) => setAllocationItemId(e.target.value)} className="min-w-48 rounded border border-slate-300 px-2 py-1.5 text-sm"><option value="">Select FO item</option>{(editData.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.sku || item.description || item.id} ({fmt(item.ordered_qty_kg)} KG)</option>)}</select>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">FO Item</span>
                        <span className="min-w-48 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-mono text-slate-600">{editData.items?.[0]?.sku || "--"}</span>
                      </div>
                    )}
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
                          <button type="button" disabled={saving || !allocQty || !allocationItemId} onClick={() => submitAllocation(false)} className="px-3 py-1.5 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
                            Allocate
                          </button>
                        </>
                      );
                    })()}
                  </div>
                  </fieldset>
                </ErpSectionCard>
              )}
              </div>
              ) : <p className="py-8 text-center text-sm text-slate-500">Loading FO details...</p>}
            </DrawerBase>
          )}
        </>
      )}

      {/* ── Tab: Total Table ── */}
      {tab === "total" && (
        <ErpSectionCard title="Total Table — Order Summary">
          <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-slate-200 pb-3">
            <label className="grid min-w-[300px] flex-1 gap-1 text-xs font-medium text-slate-600">
              Search Any Column
              <input value={totalSearch} onChange={(event) => setTotalSearch(event.target.value)} list="plan-feed-total-search-suggestions" placeholder="FO, party, SKU, batch, status, invoice..." className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <button type="button" onClick={() => { setTotalSearch(""); setTotalColumnFilters({}); }} disabled={!totalSearch && Object.values(totalColumnFilters).every((value) => !value)} className="h-8 border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Clear Filters</button>
            <span className="pb-1 text-xs text-slate-500">{filteredSummary.length.toLocaleString()} of {summary.length.toLocaleString()} FOs</span>
            <datalist id="plan-feed-total-search-suggestions">{totalSuggestions.map((value) => <option key={value} value={value} />)}</datalist>
          </div>
          {totalFiltersOpen ? (
            <div className="mb-3 grid gap-2 border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4">
              {totalColumns.map((column) => {
                const listId = `plan-feed-total-${column.key}-suggestions`;
                return <label key={column.key} className="grid gap-1 text-[11px] font-medium text-slate-600">
                  {column.label}
                  <input value={totalColumnFilters[column.key] ?? ""} onChange={(event) => setTotalColumnFilters((filters) => ({ ...filters, [column.key]: event.target.value }))} list={listId} placeholder={`Filter ${column.label}`} className="h-7 border border-slate-300 bg-white px-2 text-xs outline-none focus:border-sky-500" />
                  <datalist id={listId}>{(totalSuggestionsByColumn[column.key] ?? []).map((value) => <option key={value} value={value} />)}</datalist>
                </label>;
              })}
            </div>
          ) : null}
          {summaryQ.isLoading ? (
            <p className="text-slate-400 text-sm py-6 text-center">Loading summary...</p>
          ) : summary.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No active FOs found.</p>
          ) : filteredSummary.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No rows match this search.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">Arrow keys move cell-to-cell. Shift+Click, click-drag, or Shift+Arrow selects a range; Ctrl+C copies it like Excel.</p>
              <ErpDenseGrid columns={totalColumns} rows={filteredSummary} rowKey={(row) => row.id ?? row.fo_number} virtualize rangeSelect stickyFirstColumn maxHeight="calc(100vh - 290px)" emptyMessage="No FOs matched the selected filters." />
            </>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
