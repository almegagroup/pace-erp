/*
 * File-ID: 27.FE-00
 * File-Path: frontend/src/pages/dashboard/production/PlanFeedPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Plan Feed (FO) management — §83.18-REVISED (LOCKED 2026-07-23).
 *          3 tabs: Create FO | Edit FO (+ Packing PO allocation) | Total Table.
 */

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import {
  listPlanFeed, getPlanFeed, createPlanFeed, updatePlanFeed,
  cancelPlanFeed, getPlanFeedSummary, upsertFoAllocation,
  getUnmappedStock, checkOrderedStroke, listPackingOrders,
} from "./prodApi.js";
import { listMaterials, listCustomers, createCustomer, updateCustomer } from "../om/omApi.js";

const TABS = [
  { key: "create", label: "Create FO" },
  { key: "edit",   label: "Edit FO" },
  { key: "total",  label: "Total Table" },
];

const FO_CUSTOMER_TYPES = [
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "ZTEST", label: "ZTEST" },
  { value: "MTS", label: "MTS" },
];

const ERRORS = {
  PROD_PLAN_FEED_INVALID: "Company, FO number, party, SKU, ordered qty, and order date are required.",
  PROD_PLAN_FEED_FO_EXISTS: "FO number already exists for this company.",
  PROD_PLAN_FEED_SKU_LOCKED: "SKU/Description are locked — Packing PO(s) are already allocated to this FO.",
  PROD_PLAN_FEED_CANCELLED: "Cancelled FO cannot be edited.",
  PROD_PLAN_FEED_ALLOCATION_EXCEEDS_STOCK: "Allocation exceeds this Packing PO's available qty.",
  PROD_PLAN_FEED_MATERIAL_MISMATCH: "Packing PO material differs from this FO's SKU.",
  PROD_PACK_NOT_FOUND: "Packing PO not found.",
  PROD_PACK_REVERSED: "Cannot allocate a reversed/cancelled Packing PO.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendlyErr(code) { return ERRORS[code] ?? code; }

function materialLabel(m) {
  if (!m) return "--";
  return [m.pace_code || m.external_code, m.material_name].filter(Boolean).join(" - ");
}
function customerLabel(c) {
  if (!c) return "--";
  return [c.customer_code, c.customer_name].filter(Boolean).join(" - ");
}
function fmt(n) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "0";
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
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 4000);
  }

  // ── Shared master lookups ─────────────────────────────────────────────────
  const [poTypeFilter, setPoTypeFilter] = useState("");
  const customersQ = useQuery({
    queryKey: ["plan-feed-customers", poTypeFilter],
    queryFn: () => listCustomers({ fo_customer_type: poTypeFilter || undefined, status: "ACTIVE", limit: 200 }),
    select: (d) => d?.data ?? [],
  });
  const materialsQ = useQuery({
    queryKey: ["plan-feed-fg-materials"],
    queryFn: () => listMaterials({ material_type: "FG", status: "ACTIVE", limit: 500 }),
    select: (d) => d?.data ?? [],
  });
  const customerOptions = useMemo(
    () => (customersQ.data ?? []).map((c) => ({ value: c.id, label: customerLabel(c) })),
    [customersQ.data],
  );
  const materialOptions = useMemo(
    () => (materialsQ.data ?? []).map((m) => ({ value: m.id, label: materialLabel(m) })),
    [materialsQ.data],
  );
  const customerMap = useMemo(() => new Map((customersQ.data ?? []).map((c) => [c.id, c])), [customersQ.data]);

  // ── Create tab state ──────────────────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FO });
  const [newPartyOpen, setNewPartyOpen] = useState(false);
  const [newPartyForm, setNewPartyForm] = useState({ customer_name: "", delivery_address: "", fo_customer_type: "" });
  const [newPartySaving, setNewPartySaving] = useState(false);

  const selectedParty = customerMap.get(form.party_id) ?? null;

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

  async function handleCreateNewParty() {
    if (!newPartyForm.customer_name.trim() || !newPartyForm.delivery_address.trim()) return;
    setNewPartySaving(true);
    try {
      const created = await createCustomer({
        customer_name: newPartyForm.customer_name.trim(),
        delivery_address: newPartyForm.delivery_address.trim(),
        customer_type: "DOMESTIC",
        fo_customer_type: newPartyForm.fo_customer_type || poTypeFilter || undefined,
      });
      const newId = created?.data?.id ?? created?.id;
      await qc.invalidateQueries({ queryKey: ["plan-feed-customers"] });
      if (newId) setForm((f) => ({ ...f, party_id: newId, party_name: newPartyForm.customer_name.trim() }));
      setNewPartyOpen(false);
      setNewPartyForm({ customer_name: "", delivery_address: "", fo_customer_type: "" });
      toast("Party created.");
    } catch (err) {
      toast(err.message || "Party create failed.", "error");
    } finally {
      setNewPartySaving(false);
    }
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
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  // ── Edit tab state ────────────────────────────────────────────────────────
  const [editSearch, setEditSearch] = useState("");
  const [editData, setEditData] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editLoading, setEditLoading] = useState(false);
  const [allocPoNumber, setAllocPoNumber] = useState("");
  const [allocCandidate, setAllocCandidate] = useState(null);
  const [allocQty, setAllocQty] = useState("");
  const [allocSearching, setAllocSearching] = useState(false);

  const listQ = useQuery({
    queryKey: ["prod-plan-feed-list", effectiveCompanyId],
    queryFn: () => listPlanFeed({ company_id: effectiveCompanyId || undefined, per_page: 50 }),
    select: (d) => (typeof d === "object" && "data" in d) ? d.data : (Array.isArray(d) ? d : []),
    enabled: tab === "edit",
  });
  const foListFiltered = useMemo(() => {
    const foList = listQ.data ?? [];
    const needle = editSearch.trim().toLowerCase();
    if (!needle) return foList;
    return foList.filter((fo) => [fo.fo_number, fo.party_name].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [listQ.data, editSearch]);

  const skuLockedForEdit = Boolean(editData?.allocations?.length);

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

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editData) return;
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
        payload.description = editDraft.description || null;
      }
      await updatePlanFeed(editData.id, payload);
      toast("FO updated.");
      await loadEditFo(editData.id);
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-list"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleCancel() {
    if (!editData) return;
    const confirmed = await openActionConfirm({
      eyebrow: "Plan Feed",
      title: `Cancel FO ${editData.fo_number}?`,
      message: "All Packing PO allocations against this FO will be removed (the Packing POs themselves are unaffected, just unlinked).",
      confirmLabel: "Cancel FO",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await cancelPlanFeed(editData.id);
      toast("FO cancelled.");
      setEditData(null);
      qc.invalidateQueries({ queryKey: ["prod-plan-feed-list"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleFindAllocationCandidate() {
    if (!editData || !allocPoNumber.trim()) return;
    setAllocSearching(true);
    setAllocCandidate(null);
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

  async function submitAllocation(confirmMismatch) {
    if (!editData || !allocCandidate) return;
    setSaving(true);
    try {
      await upsertFoAllocation(editData.id, {
        packing_order_id: allocCandidate.id,
        allocated_qty_kg: parseFloat(allocQty || "0"),
        confirm_mismatch: confirmMismatch === true,
      });
      toast("Allocation saved.");
      setAllocPoNumber(""); setAllocCandidate(null); setAllocQty("");
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
    if (!editData) return;
    try {
      await upsertFoAllocation(editData.id, {
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
  const summary = summaryQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="Plan Feed"
      subtitle="Firm Order visibility — what customers ordered, and its current production/dispatch state"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
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
                onChange={(v) => setForm(f => ({ ...f, party_id: v }))}
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
                {selectedParty?.delivery_address || "--"}
              </div>
            </div>

            {newPartyOpen && (
              <div className="col-span-2 border border-sky-200 bg-sky-50 rounded p-3 grid grid-cols-2 gap-3">
                <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" placeholder="Party name" value={newPartyForm.customer_name} onChange={e => setNewPartyForm(f => ({ ...f, customer_name: e.target.value }))} />
                <ErpComboboxField
                  value={newPartyForm.fo_customer_type}
                  onChange={(v) => setNewPartyForm(f => ({ ...f, fo_customer_type: v }))}
                  options={FO_CUSTOMER_TYPES}
                  placeholder="PO Type (optional)"
                />
                <input className="col-span-2 border border-slate-300 rounded px-2 py-1.5 text-sm" placeholder="Delivery address" value={newPartyForm.delivery_address} onChange={e => setNewPartyForm(f => ({ ...f, delivery_address: e.target.value }))} />
                <div className="col-span-2 flex gap-2">
                  <button type="button" disabled={newPartySaving} onClick={handleCreateNewParty} className="px-3 py-1.5 bg-sky-600 text-white text-xs rounded hover:bg-sky-700 disabled:opacity-50">Save Party</button>
                  <button type="button" onClick={() => setNewPartyOpen(false)} className="px-3 py-1.5 border border-slate-300 text-xs rounded">Cancel</button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">SKU <span className="text-rose-500">*</span></label>
              <ErpComboboxField
                value={form.material_id}
                onChange={(v) => setForm(f => ({ ...f, material_id: v }))}
                options={materialOptions}
                placeholder="-- Select FG SKU --"
                emptyStateLabel={materialsQ.isLoading ? "Loading..." : "No FG materials found"}
              />
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
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-64" value={form.ordered_stroke_number} onChange={e => setForm(f => ({ ...f, ordered_stroke_number: e.target.value }))} placeholder="Stroke number" />
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
          <ErpSectionCard title="Find FO to Edit">
            <input className="border border-slate-300 rounded px-2 py-1 text-sm w-80" value={editSearch} onChange={e => setEditSearch(e.target.value)} placeholder="Search FO number or party..." />
            <div className="mt-3">
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
          </ErpSectionCard>

          {editLoading && <ErpSectionCard><p className="text-sm text-slate-400 py-4 text-center">Loading FO...</p></ErpSectionCard>}

          {editData && (
            <>
              <ErpSectionCard title={`Editing: ${editData.fo_number}`} tone={editData.status === "CANCELLED" ? "warning" : "default"}>
                {editData.status === "CANCELLED" && (
                  <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                    This FO is cancelled and cannot be edited.
                  </div>
                )}
                <form onSubmit={handleSaveEdit} className="grid grid-cols-2 gap-4 max-w-3xl">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Party</label>
                    <ErpComboboxField
                      value={editDraft.party_id}
                      onChange={(v) => setEditDraft(d => ({ ...d, party_id: v }))}
                      options={customerOptions}
                      placeholder="-- Select party --"
                      disabled={editData.status === "CANCELLED"}
                    />
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
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">
                      SKU {skuLockedForEdit ? <span className="text-amber-600">(locked — allocations exist)</span> : null}
                    </label>
                    <ErpComboboxField
                      value={editDraft.material_id}
                      onChange={(v) => setEditDraft(d => ({ ...d, material_id: v }))}
                      options={materialOptions}
                      placeholder="-- Select FG SKU --"
                      disabled={editData.status === "CANCELLED" || skuLockedForEdit}
                    />
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
                    <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={editDraft.ordered_stroke_number} onChange={e => setEditDraft(d => ({ ...d, ordered_stroke_number: e.target.value }))} disabled={editData.status === "CANCELLED"} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600 font-medium">Actual Stroke(s)</label>
                    <div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-sm text-slate-600 min-h-[34px]">
                      {(editData.actual_stroke_numbers ?? []).length > 0
                        ? editData.actual_stroke_numbers.map((s) => <div key={s}>{s}</div>)
                        : "-- none yet --"}
                    </div>
                  </div>
                  {editData.status !== "CANCELLED" && (
                    <div className="col-span-2 flex gap-3 pt-2">
                      <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-600 text-white text-sm font-medium rounded hover:bg-sky-700 disabled:opacity-50">Save Changes</button>
                      <button type="button" onClick={handleCancel} disabled={saving} className="px-4 py-2 border border-rose-300 text-rose-700 text-sm rounded hover:bg-rose-50 disabled:opacity-50">Cancel FO</button>
                    </div>
                  )}
                </form>
              </ErpSectionCard>

              {editData.status !== "CANCELLED" && (
                <ErpSectionCard title="Packing PO Allocation">
                  <table className="w-full text-sm border-collapse mb-4">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <th className="text-left py-2 px-3 border-b">PO Number</th>
                        <th className="text-left py-2 px-3 border-b">Material</th>
                        <th className="text-left py-2 px-3 border-b">Status</th>
                        <th className="text-right py-2 px-3 border-b">PO Qty</th>
                        <th className="text-right py-2 px-3 border-b">Allocated (KG)</th>
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
                            <td className="py-2 px-3 text-right font-mono">{fmt(po.actual_qty_kg || po.planned_qty_kg)}</td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number" step="0.01" defaultValue={a.allocated_qty_kg}
                                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm font-mono text-right"
                                onBlur={(e) => {
                                  if (Number(e.target.value) !== Number(a.allocated_qty_kg)) {
                                    handleAllocationQtyChange(a, e.target.value);
                                  }
                                }}
                              />
                            </td>
                            <td className="py-2 px-3">
                              <button type="button" onClick={() => handleAllocationQtyChange(a, 0)} className="text-rose-600 text-xs underline">Unmap</button>
                            </td>
                          </tr>
                        );
                      })}
                      {(editData.allocations ?? []).length === 0 && (
                        <tr><td colSpan={6} className="py-4 text-center text-slate-400 text-sm">No Packing PO allocated yet.</td></tr>
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
                    {allocCandidate && (
                      <>
                        <div className="text-sm text-slate-600">
                          Found: <span className="font-mono">{allocCandidate.po_number}</span> ({materialLabel(allocCandidate.material)}, {fmt(allocCandidate.actual_qty_kg || allocCandidate.planned_qty_kg)} KG)
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-600 font-medium">Allocate Qty (KG)</label>
                          <input type="number" step="0.01" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-32" value={allocQty} onChange={e => setAllocQty(e.target.value)} />
                        </div>
                        <button type="button" disabled={saving || !allocQty} onClick={() => submitAllocation(false)} className="px-3 py-1.5 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50">
                          Allocate
                        </button>
                      </>
                    )}
                  </div>
                </ErpSectionCard>
              )}
            </>
          )}
        </>
      )}

      {/* ── Tab: Total Table ── */}
      {tab === "total" && (
        <ErpSectionCard title="Total Table — Order Summary">
          {summaryQ.isLoading ? (
            <p className="text-slate-400 text-sm py-6 text-center">Loading summary...</p>
          ) : summary.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No active FOs found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">FO #</th>
                    <th className="text-left py-2 px-3 border-b">Party</th>
                    <th className="text-left py-2 px-3 border-b">SKU</th>
                    <th className="text-right py-2 px-3 border-b">Ordered KG</th>
                    <th className="text-right py-2 px-3 border-b">Pack Qty</th>
                    <th className="text-right py-2 px-3 border-b">Mapped KG</th>
                    <th className="text-center py-2 px-3 border-b">Production</th>
                    <th className="text-right py-2 px-3 border-b">Dispatched KG</th>
                    <th className="text-center py-2 px-3 border-b">Dispatch</th>
                    <th className="text-right py-2 px-3 border-b">Pending KG</th>
                    <th className="text-left py-2 px-3 border-b">Del Date</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(row => (
                    <tr key={row.id ?? row.fo_number} className="border-b border-slate-100 hover:bg-sky-50">
                      <td className="py-2 px-3 font-mono font-semibold text-sky-700">{row.fo_number}</td>
                      <td className="py-2 px-3">{row.party_name}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{row.sku}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(row.ordered_qty_kg)}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.pack_qty ?? "--"}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(row.allocated_qty_kg)}</td>
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
