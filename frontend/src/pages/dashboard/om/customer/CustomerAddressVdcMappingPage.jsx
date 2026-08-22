/*
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerAddressVdcMappingPage.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Dedicated bulk Address<->VDC/DC mapping workspace (feasibility doc
 *          Section 129, business owner's explicit ask 2026-08-22 -- reviewed
 *          all of MM04 and found no standalone UI for this at all, only the
 *          buried per-address picker inside CustomerEditForm.jsx, which also
 *          has no multi-select). Flow: pick a Customer -> see all its
 *          Addresses (State + the Customer's own GST shown per row) ->
 *          multi-select any number -> pick one VDC/DC (shows its resolved
 *          Parent Company + GST) -> Save maps every selected address to that
 *          one VDC/DC in a single batch action. Complements, does not
 *          replace, the existing per-address picker.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  bulkMapCustomerAddresses,
  listCustomerAddresses,
  listCustomers,
  listFgDepotCodes,
  listFgParentCompanies,
} from "../omApi.js";

// §129.6 — Direct dispatch = VDC, Depot dispatch = DC. Same helper as
// CustomerEditForm.jsx / VdcParentCompanyMasterPage.jsx (duplicated
// deliberately, no shared util file exists for this yet).
function depotLabel(dispatchType) {
  return dispatchType === "DEPOT" ? "DC" : "VDC";
}

export default function CustomerAddressVdcMappingPage() {
  const queryClient = useQueryClient();

  // ---------- Step 1: Customer picker ----------
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch.trim()), 300);
    return () => window.clearTimeout(timeoutId);
  }, [customerSearch]);

  const customerQuery = useQuery({
    queryKey: ["om", "customer-list", "vdc-mapping-picker", debouncedCustomerSearch],
    queryFn: () => listCustomers({ search: debouncedCustomerSearch || undefined, limit: 20 }),
    enabled: !selectedCustomer,
    select: (data) => data?.data ?? [],
  });
  const customerRows = customerQuery.data ?? [];

  // ---------- Step 2: this customer's addresses ----------
  const addressesQuery = useQuery({
    queryKey: ["om", "customer-addresses", selectedCustomer?.id],
    queryFn: () => listCustomerAddresses(selectedCustomer.id),
    enabled: Boolean(selectedCustomer?.id),
    select: (data) => data?.data ?? [],
  });
  const addresses = addressesQuery.data ?? [];
  const [selectedAddressIds, setSelectedAddressIds] = useState(() => new Set());

  function toggleAddress(id) {
    setSelectedAddressIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedAddressIds((current) =>
      (current.size === addresses.length ? new Set() : new Set(addresses.map((a) => a.id)))
    );
  }

  // ---------- Step 3: VDC/DC picker ----------
  const [vdcSearch, setVdcSearch] = useState("");
  const [selectedVdcId, setSelectedVdcId] = useState("");
  const vdcQuery = useQuery({
    queryKey: ["om", "fg-depot-codes", "all"],
    queryFn: () => listFgDepotCodes(),
    select: (data) => data?.data ?? [],
  });
  const parentQuery = useQuery({
    queryKey: ["om", "fg-parent-companies", "mapping-picker"],
    queryFn: () => listFgParentCompanies(),
    select: (data) => data?.data ?? [],
  });
  const parentById = useMemo(() => {
    const map = new Map();
    for (const p of parentQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [parentQuery.data]);
  const filteredVdcs = useMemo(() => {
    const term = vdcSearch.trim().toLowerCase();
    const rows = vdcQuery.data ?? [];
    if (!term) return rows;
    return rows.filter((v) => (v.code || "").toLowerCase().includes(term));
  }, [vdcQuery.data, vdcSearch]);
  const selectedVdc = useMemo(
    () => (vdcQuery.data ?? []).find((v) => v.id === selectedVdcId) || null,
    [vdcQuery.data, selectedVdcId]
  );
  const selectedVdcParent = selectedVdc ? parentById.get(selectedVdc.parent_company_id) : null;

  // ---------- Save ----------
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSaveMapping() {
    if (selectedAddressIds.size === 0) {
      setError("Select at least one address.");
      return;
    }
    if (!selectedVdcId) {
      setError("Pick a VDC/DC to map to.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await bulkMapCustomerAddresses({ address_ids: [...selectedAddressIds], depot_code_id: selectedVdcId });
      await queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", selectedCustomer.id] });
      setNotice(`Mapped ${selectedAddressIds.size} address(es) to ${depotLabel(selectedVdc?.dispatch_type)}: ${selectedVdc?.code}.`);
      setSelectedAddressIds(new Set());
      setSelectedVdcId("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_ADDRESS_BULK_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnmapSelected() {
    if (selectedAddressIds.size === 0) {
      setError("Select at least one address.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await bulkMapCustomerAddresses({ address_ids: [...selectedAddressIds], depot_code_id: null });
      await queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses", selectedCustomer.id] });
      setNotice(`Unmapped ${selectedAddressIds.size} address(es).`);
      setSelectedAddressIds(new Set());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_ADDRESS_BULK_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function changeCustomer() {
    setSelectedCustomer(null);
    setSelectedAddressIds(new Set());
    setSelectedVdcId("");
    setNotice("");
    setError("");
  }

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Address to VDC / DC Mapping"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        {
          key: "vdc-master",
          label: "Parent Company / VDC Master",
          tone: "neutral",
          onClick: () => openScreen(OPERATION_SCREENS.OM_VDC_PARENT_COMPANY_MASTER.screen_code),
        },
      ]}
    >
      <div className="grid gap-4">
        {!selectedCustomer ? (
          <ErpSectionCard eyebrow="Step 1" title="Pick a Customer">
            <div className="grid gap-2">
              <input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Search customer code or name..."
                autoFocus
                className="h-9 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
              <ErpDenseGrid
                columns={[
                  { key: "display_code", label: "Customer", render: (row) => row.display_code || row.customer_name || "-" },
                  { key: "gst_number", label: "GST", render: (row) => row.gst_number || "-" },
                  { key: "billing_state", label: "State", render: (row) => row.billing_state || "-" },
                ]}
                rows={customerRows}
                rowKey={(row) => row.id}
                onRowActivate={(row) => setSelectedCustomer(row)}
                cellNavigate
                getRowProps={(row) => ({ onDoubleClick: () => setSelectedCustomer(row), className: "cursor-pointer hover:bg-sky-50" })}
                emptyMessage={customerQuery.isLoading ? "Loading..." : "No customer found."}
              />
            </div>
          </ErpSectionCard>
        ) : (
          <>
            <ErpSectionCard eyebrow="Step 1" title="Customer">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-semibold text-slate-900">{selectedCustomer.display_code || selectedCustomer.customer_name}</span>
                  <span className="ml-3 text-slate-600">GST: {selectedCustomer.gst_number || "—"}</span>
                </div>
                <button type="button" onClick={changeCustomer} className="h-8 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
                  Change Customer
                </button>
              </div>
            </ErpSectionCard>

            {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}
            {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <ErpSectionCard eyebrow="Step 2" title="Select Addresses (multi-select)">
                <div className="grid gap-2">
                  {addresses.length > 0 ? (
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <input type="checkbox" checked={selectedAddressIds.size === addresses.length} onChange={toggleAll} />
                      Select all ({addresses.length})
                    </label>
                  ) : null}
                  <ul className="grid max-h-[420px] gap-1 overflow-y-auto">
                    {addressesQuery.isLoading ? (
                      <li className="text-xs text-slate-500">Loading addresses...</li>
                    ) : addresses.length === 0 ? (
                      <li className="text-xs text-slate-500">This customer has no addresses yet.</li>
                    ) : (
                      addresses.map((address) => (
                        <li key={address.id} className="flex items-start gap-2 border border-slate-200 bg-white px-2 py-1.5 text-xs">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={selectedAddressIds.has(address.id)}
                            onChange={() => toggleAddress(address.id)}
                          />
                          <div className="flex-1">
                            <div>
                              <span className="font-semibold text-slate-900">{address.site_name || "Untitled site"}</span>
                              {" — "}{address.address_line}, {address.town}
                              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {address.state}
                              </span>
                            </div>
                            <div className="mt-0.5 text-slate-500">
                              {address.depot_code ? (
                                <>
                                  Currently mapped:{" "}
                                  <span className="font-semibold text-emerald-700">
                                    {depotLabel(address.depot_dispatch_type)}: {address.depot_code}
                                  </span>
                                  {address.parent_company_name ? ` — ${address.parent_company_name}` : ""}
                                </>
                              ) : (
                                <span className="text-amber-700">Not mapped</span>
                              )}
                            </div>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </ErpSectionCard>

              <ErpSectionCard eyebrow="Step 3" title="Pick VDC / DC">
                <div className="grid gap-2">
                  <input
                    value={vdcSearch}
                    onChange={(event) => setVdcSearch(event.target.value)}
                    placeholder="Search VDC/DC code..."
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                  <ul className="grid max-h-56 gap-1 overflow-y-auto">
                    {vdcQuery.isLoading ? (
                      <li className="text-xs text-slate-500">Loading...</li>
                    ) : filteredVdcs.length === 0 ? (
                      <li className="text-xs text-slate-500">
                        No VDC/DC found.{" "}
                        <button
                          type="button"
                          onClick={() => openScreen(OPERATION_SCREENS.OM_VDC_PARENT_COMPANY_MASTER.screen_code)}
                          className="text-sky-700 underline"
                        >
                          Create one →
                        </button>
                      </li>
                    ) : (
                      filteredVdcs.map((v) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedVdcId(v.id)}
                            className={`flex w-full items-center justify-between border px-2 py-1 text-left text-xs ${
                              selectedVdcId === v.id ? "border-sky-600 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          >
                            <span>
                              <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600">
                                {depotLabel(v.dispatch_type)}
                              </span>
                              <span className="font-semibold text-slate-900">{v.code}</span>
                              {" — "}
                              <span className="text-slate-500">{parentById.get(v.parent_company_id)?.company_name || "—"}</span>
                            </span>
                            {selectedVdcId === v.id ? <span className="text-sky-700">✓</span> : null}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>

                  {selectedVdc ? (
                    <div className="border border-sky-200 bg-sky-50/60 p-2 text-xs">
                      <div className="font-semibold text-slate-900">
                        {depotLabel(selectedVdc.dispatch_type)}: {selectedVdc.code}
                      </div>
                      <div className="mt-1 text-slate-700">
                        Parent Company: <span className="font-semibold">{selectedVdcParent?.company_name || "—"}</span>
                      </div>
                      <div className="text-slate-700">
                        Parent GST: <span className="font-semibold">{selectedVdcParent?.gst_number || "—"}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 border-t border-slate-200 pt-2">
                    <button
                      type="button"
                      onClick={() => void handleUnmapSelected()}
                      disabled={saving || selectedAddressIds.size === 0}
                      className="h-8 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    >
                      Unmap Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveMapping()}
                      disabled={saving || selectedAddressIds.size === 0 || !selectedVdcId}
                      className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : `Map ${selectedAddressIds.size || ""} Selected`}
                    </button>
                  </div>
                </div>
              </ErpSectionCard>
            </div>
          </>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
