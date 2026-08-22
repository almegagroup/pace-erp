/*
 * File-Path: frontend/src/pages/dashboard/om/customer/VdcParentCompanyMasterPage.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Standalone master for Parent Company (Bill-To) and Virtual Depot
 *          Code (VDC) -- feasibility doc Section 129.6/129.8. A customer's
 *          Address maps directly to a VDC (picked here); the VDC's own
 *          Parent Company is what resolves as Bill-To, never re-picked at
 *          address-mapping time. Mirrors Company Master's own list+create+
 *          edit+Check-GST pattern (business owner's explicit reference,
 *          2026-08-22) -- this was previously missing entirely, VDC/Parent
 *          Company creation was buried inline inside address mapping with
 *          no list, no edit, no GST check. Reuses MM04's existing
 *          OM_CUSTOMER_LIST/OM_CUSTOMER_CREATE ACL resource codes -- no new
 *          tx_code/menu row, reached via a link from CustomerListPage/
 *          CustomerEditForm, not the sidebar directly.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { INDIAN_STATES } from "../../../../data/indianStates.js";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  createFgParentCompany,
  createOrGetFgDepotCode,
  listFgDepotCodes,
  listFgParentCompanies,
  lookupCustomerGstProfile,
  updateFgDepotCode,
  updateFgParentCompany,
} from "../omApi.js";

const EMPTY_PARENT_FORM = { company_name: "", state: "", gst_number: "", full_address: "", pin_code: "" };
const EMPTY_VDC_FORM = { code: "", dispatch_type: "DIRECT", state: "", address_line: "", pin_code: "", gst_number: "" };

// §129.6 correction (2026-08-22) — VDC (Direct) and DC (Depot) are two
// different things, not one "VDC" bucket with a type flag.
function depotLabel(dispatchType) {
  return dispatchType === "DEPOT" ? "DC" : "VDC";
}

function GstCheckRow({ value, onChange, onResolved, disabled }) {
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");

  async function handleCheck() {
    const gst = (value || "").trim().toUpperCase();
    if (!gst) return;
    setChecking(true);
    setNotice("");
    try {
      const result = await lookupCustomerGstProfile(gst);
      const profile = result?.data;
      if (!profile) throw new Error("GST lookup failed");
      // §129.5 — auto-overwrite directly, no Keep/Overwrite dialog; fields
      // stay editable afterward.
      onResolved(profile);
      setNotice(`GST found: ${profile.legal_name ?? "—"}`);
    } catch {
      setNotice("GST lookup failed. Check the GST number.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <ErpDenseFormRow label="GST Number (optional)">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => { onChange(event.target.value.toUpperCase()); setNotice(""); }}
          disabled={disabled}
          className="h-8 flex-1 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
          placeholder="e.g. 27AAAAA0000A1Z5"
        />
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={disabled || checking}
          className="h-8 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50 whitespace-nowrap"
        >
          {checking ? "Checking..." : "Check GST"}
        </button>
      </div>
      {notice ? <p className="mt-1 text-xs text-emerald-600">{notice}</p> : null}
    </ErpDenseFormRow>
  );
}

export default function VdcParentCompanyMasterPage() {
  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("PARENT");

  // ---------- Parent Company tab ----------
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const parentQuery = useQuery({
    queryKey: ["om", "fg-parent-companies", companyId],
    queryFn: () => listFgParentCompanies({ company_id: companyId || undefined }),
    select: (data) => data?.data ?? [],
  });
  const parentCompanies = useMemo(() => parentQuery.data ?? [], [parentQuery.data]);

  const [selectedParentId, setSelectedParentId] = useState("");
  const [parentForm, setParentForm] = useState(EMPTY_PARENT_FORM);
  const [creatingParentNew, setCreatingParentNew] = useState(false);
  const [savingParent, setSavingParent] = useState(false);
  const [parentError, setParentError] = useState("");

  function openParentRow(row) {
    setSelectedParentId(row.id);
    setCreatingParentNew(false);
    setParentForm({
      company_name: row.company_name ?? "",
      state: row.state ?? "",
      gst_number: row.gst_number ?? "",
      full_address: row.full_address ?? "",
      pin_code: row.pin_code ?? "",
    });
  }

  function openParentCreate() {
    setSelectedParentId("");
    setCreatingParentNew(true);
    setParentForm({ ...EMPTY_PARENT_FORM, company_name: "" });
  }

  async function handleSaveParent() {
    if (!parentForm.company_name.trim() || !parentForm.state) {
      setParentError("Company Name and State are required.");
      return;
    }
    if (creatingParentNew && !companyId) {
      setParentError("Select a company first.");
      return;
    }
    setSavingParent(true);
    setParentError("");
    try {
      if (creatingParentNew) {
        await createFgParentCompany({
          company_id: companyId,
          company_name: parentForm.company_name.trim(),
          state: parentForm.state,
          gst_number: parentForm.gst_number.trim() || undefined,
          full_address: parentForm.full_address.trim() || undefined,
          pin_code: parentForm.pin_code.trim() || undefined,
        });
      } else {
        await updateFgParentCompany({
          id: selectedParentId,
          company_name: parentForm.company_name.trim(),
          state: parentForm.state,
          gst_number: parentForm.gst_number.trim() || null,
          full_address: parentForm.full_address.trim() || null,
          pin_code: parentForm.pin_code.trim() || null,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["om", "fg-parent-companies"] });
      setSelectedParentId("");
      setCreatingParentNew(false);
      setParentForm(EMPTY_PARENT_FORM);
    } catch (saveError) {
      setParentError(saveError instanceof Error ? saveError.message : "MM05_PARENT_COMPANY_SAVE_FAILED");
    } finally {
      setSavingParent(false);
    }
  }

  // ---------- VDC tab ----------
  const vdcQuery = useQuery({
    queryKey: ["om", "fg-depot-codes", "all"],
    queryFn: () => listFgDepotCodes(),
    select: (data) => data?.data ?? [],
  });
  const parentNameById = useMemo(() => {
    const map = new Map();
    for (const p of parentCompanies) map.set(p.id, p.company_name);
    return map;
  }, [parentCompanies]);
  const vdcs = vdcQuery.data ?? [];

  const [selectedVdcId, setSelectedVdcId] = useState("");
  const [vdcForm, setVdcForm] = useState(EMPTY_VDC_FORM);
  const [vdcParentId, setVdcParentId] = useState("");
  const [creatingVdcNew, setCreatingVdcNew] = useState(false);
  const [changingVdcParent, setChangingVdcParent] = useState(false);
  const [newVdcParentId, setNewVdcParentId] = useState("");
  const [savingVdc, setSavingVdc] = useState(false);
  const [vdcError, setVdcError] = useState("");

  function openVdcRow(row) {
    setSelectedVdcId(row.id);
    setCreatingVdcNew(false);
    setChangingVdcParent(false);
    setNewVdcParentId("");
    setVdcParentId(row.parent_company_id ?? "");
    setVdcForm({
      code: row.code ?? "",
      dispatch_type: row.dispatch_type ?? "DIRECT",
      state: row.state ?? "",
      address_line: row.address_line ?? "",
      pin_code: row.pin_code ?? "",
      gst_number: row.gst_number ?? "",
    });
  }

  function openVdcCreate() {
    setSelectedVdcId("");
    setCreatingVdcNew(true);
    setChangingVdcParent(false);
    setVdcParentId("");
    setVdcForm(EMPTY_VDC_FORM);
  }

  async function handleSaveVdc() {
    if (!vdcForm.code.trim()) {
      setVdcError(`External ${depotLabel(vdcForm.dispatch_type)} Code is required.`);
      return;
    }
    if (creatingVdcNew && !vdcParentId) {
      setVdcError("Pick a Parent Company first (create one on the Parent Company tab if none exists yet).");
      return;
    }
    setSavingVdc(true);
    setVdcError("");
    try {
      if (creatingVdcNew) {
        await createOrGetFgDepotCode({
          parent_company_id: vdcParentId,
          dispatch_type: vdcForm.dispatch_type,
          code: vdcForm.code.trim(),
          address_line: vdcForm.address_line.trim() || undefined,
          state: vdcForm.state || undefined,
          pin_code: vdcForm.pin_code.trim() || undefined,
          gst_number: vdcForm.gst_number.trim() || undefined,
        });
      } else {
        await updateFgDepotCode({
          id: selectedVdcId,
          code: vdcForm.code.trim(),
          dispatch_type: vdcForm.dispatch_type,
          address_line: vdcForm.address_line.trim() || null,
          state: vdcForm.state || null,
          pin_code: vdcForm.pin_code.trim() || null,
          gst_number: vdcForm.gst_number.trim() || null,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["om", "fg-depot-codes"] });
      setSelectedVdcId("");
      setCreatingVdcNew(false);
      setVdcForm(EMPTY_VDC_FORM);
    } catch (saveError) {
      setVdcError(saveError instanceof Error ? saveError.message : "MM05_DEPOT_CODE_SAVE_FAILED");
    } finally {
      setSavingVdc(false);
    }
  }

  // §129 correction (2026-08-22): a VDC's Parent Company is never a one-click
  // "Change" dropdown -- Unmap first (reveals a fresh picker, nothing saved
  // yet), then Map to the new Parent Company (the only step that actually
  // commits, via the same updateFgDepotCode PATCH).
  async function handleMapVdcParent() {
    if (!newVdcParentId) {
      setVdcError("Pick a Parent Company to map to.");
      return;
    }
    setSavingVdc(true);
    setVdcError("");
    try {
      await updateFgDepotCode({ id: selectedVdcId, parent_company_id: newVdcParentId });
      await queryClient.invalidateQueries({ queryKey: ["om", "fg-depot-codes"] });
      setVdcParentId(newVdcParentId);
      setChangingVdcParent(false);
      setNewVdcParentId("");
    } catch (saveError) {
      setVdcError(saveError instanceof Error ? saveError.message : "MM05_DEPOT_CODE_REMAP_FAILED");
    } finally {
      setSavingVdc(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Parent Company / VDC Master"
      actions={[{ key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() }]}
    >
      <div className="grid gap-4">
        <div className="flex gap-2 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab("PARENT")}
            className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${tab === "PARENT" ? "border-b-2 border-sky-600 text-sky-900" : "text-slate-500"}`}
          >
            Parent Company
          </button>
          <button
            type="button"
            onClick={() => setTab("VDC")}
            className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${tab === "VDC" ? "border-b-2 border-sky-600 text-sky-900" : "text-slate-500"}`}
          >
            VDC / DC (Depot Code)
          </button>
        </div>

        {tab === "PARENT" ? (
          <ErpSectionCard eyebrow="Parent Company" title="Bill-To entities">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    Company
                    <select
                      value={companyId}
                      onChange={(event) => setCompanyId(event.target.value)}
                      className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      {companies.map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.company_code}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={openParentCreate}
                    className="h-8 border border-sky-300 bg-sky-50 px-3 text-xs font-semibold text-sky-900"
                  >
                    + New Parent Company
                  </button>
                </div>
                <ErpDenseGrid
                  columns={[
                    { key: "company_name", label: "Name", render: (row) => row.company_name || "-" },
                    { key: "state", label: "State", render: (row) => row.state || "-" },
                    { key: "gst_number", label: "GST", render: (row) => row.gst_number || "-" },
                  ]}
                  rows={parentCompanies}
                  rowKey={(row) => row.id}
                  onRowActivate={openParentRow}
                  cellNavigate
                  getRowProps={(row) => ({ onDoubleClick: () => openParentRow(row), className: "cursor-pointer hover:bg-sky-50" })}
                  emptyMessage={parentQuery.isLoading ? "Loading..." : "No Parent Company yet for this company."}
                />
              </div>

              {selectedParentId || creatingParentNew ? (
                <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
                  {parentError ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{parentError}</div> : null}
                  <ErpDenseFormRow label="Company Name" required>
                    <input
                      value={parentForm.company_name}
                      onChange={(event) => setParentForm((c) => ({ ...c, company_name: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="State" required>
                    <select
                      value={parentForm.state}
                      onChange={(event) => setParentForm((c) => ({ ...c, state: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state.code} value={state.name}>{state.name}</option>
                      ))}
                    </select>
                  </ErpDenseFormRow>
                  <GstCheckRow
                    value={parentForm.gst_number}
                    onChange={(value) => setParentForm((c) => ({ ...c, gst_number: value }))}
                    onResolved={(profile) => setParentForm((c) => ({
                      ...c,
                      company_name: profile.legal_name || c.company_name,
                      state: profile.state_name || c.state,
                      full_address: profile.full_address || c.full_address,
                    }))}
                  />
                  <ErpDenseFormRow label="Address">
                    <textarea
                      rows={2}
                      value={parentForm.full_address}
                      onChange={(event) => setParentForm((c) => ({ ...c, full_address: event.target.value }))}
                      className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Pin Code">
                    <input
                      value={parentForm.pin_code}
                      onChange={(event) => setParentForm((c) => ({ ...c, pin_code: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setSelectedParentId(""); setCreatingParentNew(false); }} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
                    <button type="button" onClick={() => void handleSaveParent()} disabled={savingParent} className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50">
                      {savingParent ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
                  Select a row to edit, or "+ New Parent Company" to create one.
                </div>
              )}
            </div>
          </ErpSectionCard>
        ) : (
          <ErpSectionCard eyebrow="VDC / DC" title="VDC (Direct) or DC (Depot) — what a Customer Address maps to">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="grid gap-2">
                <p className="text-xs text-slate-500">
                  Direct dispatch = <b>VDC</b> (Virtual Depot Code). Depot dispatch = <b>DC</b> (Depot Code).
                  Both live under a Parent Company; one Parent Company can have both VDCs and DCs at once.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={openVdcCreate}
                    className="h-8 border border-sky-300 bg-sky-50 px-3 text-xs font-semibold text-sky-900"
                  >
                    + New VDC / DC
                  </button>
                </div>
                <ErpDenseGrid
                  columns={[
                    { key: "type", label: "VDC / DC", render: (row) => (row.dispatch_type === "DEPOT" ? "DC" : "VDC") },
                    { key: "code", label: "External Code", render: (row) => row.code || "-" },
                    { key: "state", label: "State", render: (row) => row.state || "-" },
                    { key: "gst_number", label: "GST", render: (row) => row.gst_number || "-" },
                    { key: "parent", label: "Parent Company", render: (row) => parentNameById.get(row.parent_company_id) || "-" },
                  ]}
                  rows={vdcs}
                  rowKey={(row) => row.id}
                  onRowActivate={openVdcRow}
                  cellNavigate
                  virtualize
                  getRowProps={(row) => ({ onDoubleClick: () => openVdcRow(row), className: "cursor-pointer hover:bg-sky-50" })}
                  emptyMessage={vdcQuery.isLoading ? "Loading..." : "No VDC/DC created yet."}
                />
              </div>

              {selectedVdcId || creatingVdcNew ? (
                <div className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
                  {vdcError ? <div className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">{vdcError}</div> : null}

                  {creatingVdcNew ? (
                    <ErpDenseFormRow label="Parent Company" required>
                      <select
                        value={vdcParentId}
                        onChange={(event) => setVdcParentId(event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      >
                        <option value="">Select Parent Company</option>
                        {parentCompanies.map((p) => (
                          <option key={p.id} value={p.id}>{p.company_name} ({p.state})</option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">No Parent Company here? Create it on the "Parent Company" tab first.</p>
                    </ErpDenseFormRow>
                  ) : (
                    <div className="grid gap-1 border border-slate-200 bg-white p-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Parent Company</div>
                      {!changingVdcParent ? (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-900">{parentNameById.get(vdcParentId) || "—"}</span>
                          <button type="button" onClick={() => setChangingVdcParent(true)} className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                            Unmap →
                          </button>
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          <p className="text-xs text-amber-700">Unmapped from {parentNameById.get(vdcParentId) || "current parent"}. Pick a new Parent Company and click Map to commit.</p>
                          <select
                            value={newVdcParentId}
                            onChange={(event) => setNewVdcParentId(event.target.value)}
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          >
                            <option value="">Select new Parent Company</option>
                            {parentCompanies.filter((p) => p.id !== vdcParentId).map((p) => (
                              <option key={p.id} value={p.id}>{p.company_name} ({p.state})</option>
                            ))}
                          </select>
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => { setChangingVdcParent(false); setNewVdcParentId(""); }} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
                            <button type="button" onClick={() => void handleMapVdcParent()} disabled={savingVdc} className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50">
                              {savingVdc ? "Mapping..." : "Map"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <ErpDenseFormRow label={`External ${depotLabel(vdcForm.dispatch_type)} Code`} required>
                    <input
                      value={vdcForm.code}
                      onChange={(event) => setVdcForm((c) => ({ ...c, code: event.target.value }))}
                      placeholder={vdcForm.dispatch_type === "DEPOT" ? "e.g. DC-KOLH-002" : "e.g. VDC-KOLH-002"}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Dispatch Type">
                    <select
                      value={vdcForm.dispatch_type}
                      onChange={(event) => setVdcForm((c) => ({ ...c, dispatch_type: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="DIRECT">Direct</option>
                      <option value="DEPOT">Depot</option>
                    </select>
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="State">
                    <select
                      value={vdcForm.state}
                      onChange={(event) => setVdcForm((c) => ({ ...c, state: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state.code} value={state.name}>{state.name}</option>
                      ))}
                    </select>
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Address">
                    <textarea
                      rows={2}
                      value={vdcForm.address_line}
                      onChange={(event) => setVdcForm((c) => ({ ...c, address_line: event.target.value }))}
                      className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Pin Code">
                    <input
                      value={vdcForm.pin_code}
                      onChange={(event) => setVdcForm((c) => ({ ...c, pin_code: event.target.value }))}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <GstCheckRow
                    value={vdcForm.gst_number}
                    onChange={(value) => setVdcForm((c) => ({ ...c, gst_number: value }))}
                    onResolved={(profile) => setVdcForm((c) => ({
                      ...c,
                      state: profile.state_name || c.state,
                      address_line: profile.full_address || c.address_line,
                    }))}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setSelectedVdcId(""); setCreatingVdcNew(false); }} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700">Cancel</button>
                    <button type="button" onClick={() => void handleSaveVdc()} disabled={savingVdc} className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50">
                      {savingVdc ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
                  Select a row to edit, or "+ New VDC / DC" to create one.
                </div>
              )}
            </div>
          </ErpSectionCard>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
