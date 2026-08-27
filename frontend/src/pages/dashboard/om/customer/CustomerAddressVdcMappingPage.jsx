/*
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerAddressVdcMappingPage.jsx
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Bulk Address<->VDC/DC mapping workspace (feasibility doc Section
 *          129, business owner's explicit ask 2026-08-22, extended
 *          2026-08-27 to cross-customer batches). A VDC often needs
 *          addresses from SEVERAL customers mapped to it at once, and one
 *          customer can have many addresses -- so this is a 2-step wizard:
 *          Step 1 lets the user browse any number of customers, pick some/
 *          all of each one's addresses (building up one running selection
 *          across every customer visited, not just the last one), then
 *          Step 2 picks a single VDC/DC and maps every selected address to
 *          it in one Save. Complements, does not replace, the existing
 *          per-address picker inside CustomerEditForm.jsx.
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
  const [step, setStep] = useState("SELECT"); // SELECT -> VDC

  // ---------- Step 1a: customer browser (left panel) ----------
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  const [viewedCustomer, setViewedCustomer] = useState(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch.trim()), 300);
    return () => window.clearTimeout(timeoutId);
  }, [customerSearch]);

  const customerQuery = useQuery({
    queryKey: ["om", "customer-list", "vdc-mapping-picker", debouncedCustomerSearch],
    queryFn: () => listCustomers({ search: debouncedCustomerSearch || undefined, limit: 20 }),
    select: (data) => data?.data ?? [],
  });
  const customerRows = customerQuery.data ?? [];

  // ---------- Step 1b: viewed customer's addresses (right panel) ----------
  const addressesQuery = useQuery({
    queryKey: ["om", "customer-addresses", viewedCustomer?.id],
    queryFn: () => listCustomerAddresses(viewedCustomer.id),
    enabled: Boolean(viewedCustomer?.id),
    select: (data) => data?.data ?? [],
  });
  const addresses = addressesQuery.data ?? [];

  // ---------- Cross-customer selection basket ----------
  // Keyed by address id so it's trivial to know "is this row checked" no
  // matter which customer is currently being viewed; each entry also carries
  // enough of its own customer's/site's display info to render the basket
  // summary without re-fetching every customer visited.
  const [basket, setBasket] = useState(() => new Map());

  function toggleAddress(address) {
    setBasket((current) => {
      const next = new Map(current);
      if (next.has(address.id)) {
        next.delete(address.id);
      } else {
        next.set(address.id, {
          customerId: viewedCustomer.id,
          customerLabel: viewedCustomer.display_code || viewedCustomer.customer_name,
          siteName: address.site_name || "Untitled site",
          addressLine: address.address_line,
          town: address.town,
          state: address.state,
        });
      }
      return next;
    });
  }
  function toggleAllForViewedCustomer() {
    const viewedIds = addresses.map((a) => a.id);
    const allSelected = viewedIds.length > 0 && viewedIds.every((id) => basket.has(id));
    setBasket((current) => {
      const next = new Map(current);
      if (allSelected) {
        for (const id of viewedIds) next.delete(id);
      } else {
        for (const address of addresses) {
          next.set(address.id, {
            customerId: viewedCustomer.id,
            customerLabel: viewedCustomer.display_code || viewedCustomer.customer_name,
            siteName: address.site_name || "Untitled site",
            addressLine: address.address_line,
            town: address.town,
            state: address.state,
          });
        }
      }
      return next;
    });
  }
  function removeFromBasket(addressId) {
    setBasket((current) => {
      const next = new Map(current);
      next.delete(addressId);
      return next;
    });
  }

  // Basket entries grouped by customer, for the running summary list.
  const basketByCustomer = useMemo(() => {
    const groups = new Map();
    for (const [addressId, entry] of basket) {
      const group = groups.get(entry.customerId) ?? { customerLabel: entry.customerLabel, addresses: [] };
      group.addresses.push({ id: addressId, ...entry });
      groups.set(entry.customerId, group);
    }
    return [...groups.values()];
  }, [basket]);

  // ---------- Step 2: VDC/DC picker ----------
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
    if (basket.size === 0) {
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
      const addressIds = [...basket.keys()];
      await bulkMapCustomerAddresses({ address_ids: addressIds, depot_code_id: selectedVdcId });
      await queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses"] });
      setNotice(
        `Mapped ${addressIds.length} address(es) across ${basketByCustomer.length} customer(s) to ${depotLabel(selectedVdc?.dispatch_type)}: ${selectedVdc?.code}.`
      );
      setBasket(new Map());
      setSelectedVdcId("");
      setStep("SELECT");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_ADDRESS_BULK_MAP_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnmapBasket() {
    if (basket.size === 0) {
      setError("Select at least one address.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const addressIds = [...basket.keys()];
      await bulkMapCustomerAddresses({ address_ids: addressIds, depot_code_id: null });
      await queryClient.invalidateQueries({ queryKey: ["om", "customer-addresses"] });
      setNotice(`Unmapped ${addressIds.length} address(es).`);
      setBasket(new Map());
      setStep("SELECT");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_ADDRESS_BULK_MAP_FAILED");
    } finally {
      setSaving(false);
    }
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
        <ErpSectionCard>
          <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <span className={step === "SELECT" ? "text-sky-700" : ""}>Step 1 — Pick Customers &amp; Addresses</span>
            <span>→</span>
            <span className={step === "VDC" ? "text-sky-700" : ""}>Step 2 — Pick VDC/DC &amp; Save</span>
          </div>
        </ErpSectionCard>

        {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}
        {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}

        {step === "SELECT" ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <ErpSectionCard eyebrow="Customers" title="Click a customer to see its addresses">
                <div className="grid gap-2">
                  <input
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Search customer code or name..."
                    className="h-9 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                  <ErpDenseGrid
                    columns={[
                      { key: "display_code", label: "Customer", render: (row) => row.display_code || row.customer_name || "-" },
                      { key: "billing_state", label: "State", render: (row) => row.billing_state || "-" },
                      {
                        key: "picked",
                        label: "Picked",
                        render: (row) => {
                          const count = basketByCustomer.find((g) => g.addresses[0]?.customerId === row.id)?.addresses.length;
                          return count ? <span className="font-semibold text-sky-700">{count}</span> : "-";
                        },
                      },
                    ]}
                    rows={customerRows}
                    rowKey={(row) => row.id}
                    onRowActivate={(row) => setViewedCustomer(row)}
                    cellNavigate
                    getRowProps={(row) => ({
                      onDoubleClick: () => setViewedCustomer(row),
                      className: `cursor-pointer hover:bg-sky-50 ${viewedCustomer?.id === row.id ? "bg-sky-50" : ""}`,
                    })}
                    emptyMessage={customerQuery.isLoading ? "Loading..." : "No customer found."}
                  />
                </div>
              </ErpSectionCard>

              <ErpSectionCard
                eyebrow="Addresses"
                title={viewedCustomer ? `${viewedCustomer.display_code || viewedCustomer.customer_name}'s addresses` : "Pick a customer on the left"}
              >
                {!viewedCustomer ? (
                  <p className="text-xs text-slate-500">Click a customer from the list to see its addresses here.</p>
                ) : (
                  <div className="grid gap-2">
                    {addresses.length > 0 ? (
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={addresses.length > 0 && addresses.every((a) => basket.has(a.id))}
                          onChange={toggleAllForViewedCustomer}
                        />
                        Select all ({addresses.length})
                      </label>
                    ) : null}
                    <ul className="grid max-h-[360px] gap-1 overflow-y-auto">
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
                              checked={basket.has(address.id)}
                              onChange={() => toggleAddress(address)}
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
                )}
              </ErpSectionCard>
            </div>

            <ErpSectionCard eyebrow={`${basket.size} address(es) selected across ${basketByCustomer.length} customer(s)`} title="Selection basket">
              {basketByCustomer.length === 0 ? (
                <p className="text-xs text-slate-500">Nothing picked yet — click a customer above, then check some of its addresses.</p>
              ) : (
                <div className="grid gap-2">
                  {basketByCustomer.map((group) => (
                    <div key={group.addresses[0].customerId} className="border border-slate-200 bg-white p-2 text-xs">
                      <div className="mb-1 font-semibold text-slate-900">{group.customerLabel}</div>
                      <ul className="grid gap-1">
                        {group.addresses.map((address) => (
                          <li key={address.id} className="flex items-center justify-between">
                            <span>{address.siteName} — {address.addressLine}, {address.town} ({address.state})</span>
                            <button type="button" onClick={() => removeFromBasket(address.id)} className="text-rose-600 underline">
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep("VDC")}
                  disabled={basket.size === 0}
                  className="h-9 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950 disabled:opacity-50"
                >
                  Next: Pick VDC/DC →
                </button>
              </div>
            </ErpSectionCard>
          </>
        ) : (
          <>
            <ErpSectionCard eyebrow="Mapping" title={`${basket.size} address(es) across ${basketByCustomer.length} customer(s)`}>
              <div className="grid gap-1 text-xs text-slate-600">
                {basketByCustomer.map((group) => (
                  <div key={group.addresses[0].customerId}>
                    <span className="font-semibold text-slate-900">{group.customerLabel}</span>: {group.addresses.length} address(es)
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep("SELECT")}
                className="mt-3 h-8 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700"
              >
                ← Back to selection
              </button>
            </ErpSectionCard>

            <ErpSectionCard eyebrow="Step 2" title="Pick VDC / DC">
              <div className="grid gap-2">
                <input
                  value={vdcSearch}
                  onChange={(event) => setVdcSearch(event.target.value)}
                  placeholder="Search VDC/DC code..."
                  className="h-8 w-full max-w-sm border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
                <ul className="grid max-h-72 max-w-sm gap-1 overflow-y-auto">
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
                  <div className="max-w-sm border border-sky-200 bg-sky-50/60 p-2 text-xs">
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
                    onClick={() => void handleUnmapBasket()}
                    disabled={saving || basket.size === 0}
                    className="h-8 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Unmap Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveMapping()}
                    disabled={saving || basket.size === 0 || !selectedVdcId}
                    className="h-8 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold text-sky-950 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : `Map ${basket.size} Selected`}
                  </button>
                </div>
              </div>
            </ErpSectionCard>
          </>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
