import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { INDIAN_STATES, matchIndianStateName } from "../../../data/indianStates.js";
import {
  addFgDispatchCustomerAddress,
  createFgDispatchCustomer,
  createFgParentCompany,
  createOrGetFgDepotCode,
  listFgDepotCodes,
  listFgDispatchCustomerAddresses,
  listFgParentCompanies,
  lookupCustomerGstProfile,
  updateFgDispatchCustomerAddress,
} from "./omApi.js";

const FO_TYPE_OPTIONS = [
  { value: "", label: "-- Select --" },
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "ZTEST", label: "ZTEST" },
  { value: "MTS", label: "MTS" },
];

const DISPATCH_TYPES = [
  { value: "DIRECT", label: "Direct / Virtual Depot", helper: "Virtual Depot codes are used for direct-to-customer dispatch." },
  { value: "DEPOT", label: "Depot", helper: "Depot codes are used for depot dispatch." },
];

function stateOptions() {
  return INDIAN_STATES.map((entry) => (
    <option key={entry.code} value={entry.name}>
      {entry.name}
    </option>
  ));
}

function SectionTitle({ label, helper }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      {helper ? <div className="mt-1 text-xs text-slate-500">{helper}</div> : null}
    </div>
  );
}

function renderStateSelect(value, onChange) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
    >
      <option value="">Select state</option>
      {stateOptions()}
    </select>
  );
}

function compactCardClass() {
  return "rounded border border-slate-200 bg-white p-4 shadow-sm";
}

export default function FgDispatchCustomerPage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const primaryFocusRef = useRef(null);
  const [dispatchType, setDispatchType] = useState("DIRECT");
  const [companyId, setCompanyId] = useState("");
  const [foCustomerType, setFoCustomerType] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedDirectDepotId, setSelectedDirectDepotId] = useState("");
  const [selectedDepotId, setSelectedDepotId] = useState("");
  const [currentCustomer, setCurrentCustomer] = useState(null);
  const [loadedAddressId, setLoadedAddressId] = useState("");
  const [notice, setNotice] = useState({ message: "", tone: "neutral" });
  const [savingParent, setSavingParent] = useState(false);
  const [savingDepot, setSavingDepot] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [parentLookupBusy, setParentLookupBusy] = useState(false);
  const [customerLookupBusy, setCustomerLookupBusy] = useState(false);

  const [parentForm, setParentForm] = useState({
    registration_type: "REGISTERED",
    company_name: "",
    gst_number: "",
    state: "",
    full_address: "",
    pin_code: "",
  });
  const [depotForm, setDepotForm] = useState({
    code: "",
    description: "",
    address_line: "",
    state: "",
    pin_code: "",
  });
  const [customerForm, setCustomerForm] = useState({
    registration_type: "UNREGISTERED",
    gst_number: "",
    name: "",
    state: "",
    full_address: "",
    pin_code: "",
  });
  const [addressForm, setAddressForm] = useState({
    depot_code_id: "",
    address_line: "",
    state: "",
    pin_code: "",
  });

  useEffect(() => {
    if (!companyId) {
      const defaultCompany = String(runtimeContext?.selectedCompanyId ?? "").trim();
      if (defaultCompany) setCompanyId(defaultCompany);
    }
  }, [companyId, runtimeContext]);

  useEffect(() => {
    setSelectedParentId("");
    setSelectedDirectDepotId("");
    setSelectedDepotId("");
    setCurrentCustomer(null);
    setLoadedAddressId("");
    setAddressForm({ depot_code_id: "", address_line: "", state: "", pin_code: "" });
  }, [companyId, dispatchType]);

  useEffect(() => {
    if (dispatchType === "DIRECT" && selectedDirectDepotId) {
      setAddressForm((current) => ({ ...current, depot_code_id: current.depot_code_id || selectedDirectDepotId }));
    }
  }, [dispatchType, selectedDirectDepotId]);

  function pushNotice(message, tone = "success") {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice({ message: "", tone: "neutral" }), 4500);
  }

  const parentCompaniesQuery = useQuery({
    queryKey: ["mm05", "parents", companyId],
    queryFn: () => listFgParentCompanies({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const directDepotCodesQuery = useQuery({
    queryKey: ["mm05", "depots", selectedParentId, "DIRECT"],
    queryFn: () => listFgDepotCodes({ parent_company_id: selectedParentId, dispatch_type: "DIRECT" }),
    enabled: Boolean(selectedParentId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const depotCodesQuery = useQuery({
    queryKey: ["mm05", "depots", selectedParentId, "DEPOT"],
    queryFn: () => listFgDepotCodes({ parent_company_id: selectedParentId, dispatch_type: "DEPOT" }),
    enabled: Boolean(selectedParentId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const addressesQuery = useQuery({
    queryKey: ["mm05", "addresses", currentCustomer?.id],
    queryFn: () => listFgDispatchCustomerAddresses(currentCustomer.id),
    enabled: Boolean(currentCustomer?.id),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const parentOptions = useMemo(() => parentCompaniesQuery.data ?? [], [parentCompaniesQuery.data]);
  const directDepotOptions = directDepotCodesQuery.data ?? [];
  const depotOptions = depotCodesQuery.data ?? [];
  const addressRows = addressesQuery.data ?? [];
  const selectedParent = useMemo(
    () => parentOptions.find((entry) => entry.id === selectedParentId) ?? null,
    [parentOptions, selectedParentId],
  );
  const activeDispatchType = DISPATCH_TYPES.find((entry) => entry.value === dispatchType);

  async function handleParentLookup() {
    const gst = parentForm.gst_number.trim().toUpperCase();
    if (!gst) return pushNotice("Enter a GST number first.", "error");
    setParentLookupBusy(true);
    try {
      const profile = await lookupCustomerGstProfile(gst);
      setParentForm((current) => ({
        ...current,
        gst_number: gst,
        company_name: profile.legal_name || current.company_name,
        state: profile.state_name ? matchIndianStateName(profile.state_name) : current.state,
        full_address: profile.full_address || current.full_address,
        pin_code: profile.pin_code || current.pin_code,
      }));
      pushNotice("Parent company GST profile loaded.", "info");
    } catch (error) {
      pushNotice(error?.message || "GST lookup failed.", "error");
    } finally {
      setParentLookupBusy(false);
    }
  }

  async function handleCustomerLookup() {
    const gst = customerForm.gst_number.trim().toUpperCase();
    if (!gst) return pushNotice("Enter a GST number first.", "error");
    setCustomerLookupBusy(true);
    try {
      const profile = await lookupCustomerGstProfile(gst);
      const nextState = profile.state_name ? matchIndianStateName(profile.state_name) : customerForm.state;
      const nextAddress = profile.full_address || customerForm.full_address;
      const nextPin = profile.pin_code || customerForm.pin_code;
      setCustomerForm((current) => ({
        ...current,
        gst_number: gst,
        name: profile.legal_name || current.name,
        state: nextState,
        full_address: nextAddress,
        pin_code: nextPin,
      }));
      setAddressForm((current) => ({
        ...current,
        state: nextState || current.state,
        address_line: nextAddress || current.address_line,
        pin_code: nextPin || current.pin_code,
      }));
      pushNotice("Customer GST profile loaded.", "info");
    } catch (error) {
      pushNotice(error?.message || "GST lookup failed.", "error");
    } finally {
      setCustomerLookupBusy(false);
    }
  }

  async function handleSaveParent() {
    if (!companyId) return pushNotice("Select company first.", "error");
    if (!parentForm.company_name.trim() || !parentForm.state) {
      return pushNotice("Parent company name and state are required.", "error");
    }
    if (parentForm.registration_type === "REGISTERED" && !parentForm.gst_number.trim()) {
      return pushNotice("Registered parent company requires GST number.", "error");
    }
    setSavingParent(true);
    try {
      const result = await createFgParentCompany({
        company_id: companyId,
        company_name: parentForm.company_name.trim(),
        gst_number: parentForm.registration_type === "REGISTERED" ? parentForm.gst_number.trim().toUpperCase() : "",
        state: parentForm.state,
        full_address: parentForm.full_address.trim(),
        pin_code: parentForm.pin_code.trim(),
      });
      await qc.invalidateQueries({ queryKey: ["mm05", "parents"] });
      setSelectedParentId(result?.data?.id ?? result?.id ?? "");
      pushNotice("Parent company saved.");
    } catch (error) {
      pushNotice(error?.message || "Parent company save failed.", "error");
    } finally {
      setSavingParent(false);
    }
  }

  async function handleSaveDepot() {
    if (!selectedParentId) return pushNotice("Select parent company first.", "error");
    if (!depotForm.code.trim()) return pushNotice("Code is required.", "error");
    if (dispatchType === "DEPOT" && (!depotForm.address_line.trim() || !depotForm.state)) {
      return pushNotice("Depot dispatch requires address and state.", "error");
    }
    setSavingDepot(true);
    try {
      const result = await createOrGetFgDepotCode({
        parent_company_id: selectedParentId,
        dispatch_type: dispatchType,
        code: depotForm.code.trim().toUpperCase(),
        description: depotForm.description.trim(),
        address_line: dispatchType === "DEPOT" ? depotForm.address_line.trim() : "",
        state: dispatchType === "DEPOT" ? depotForm.state : "",
        pin_code: dispatchType === "DEPOT" ? depotForm.pin_code.trim() : "",
      });
      await qc.invalidateQueries({ queryKey: ["mm05", "depots"] });
      const depotId = result?.data?.id ?? result?.id ?? "";
      if (dispatchType === "DIRECT") setSelectedDirectDepotId(depotId);
      else setSelectedDepotId(depotId);
      pushNotice(dispatchType === "DIRECT" ? "Virtual depot code saved." : "Depot code saved.");
    } catch (error) {
      pushNotice(error?.message || "Depot code save failed.", "error");
    } finally {
      setSavingDepot(false);
    }
  }

  async function handleSaveCustomer() {
    if (!customerForm.name.trim() || !customerForm.state || !customerForm.full_address.trim()) {
      return pushNotice("Customer name, state, and address are required.", "error");
    }
    if (customerForm.registration_type === "REGISTERED" && !customerForm.gst_number.trim()) {
      return pushNotice("Registered customer requires GST number.", "error");
    }
    if (dispatchType === "DIRECT" && !selectedDirectDepotId) {
      return pushNotice("Select virtual depot code first.", "error");
    }
    if (dispatchType === "DEPOT" && !selectedDepotId) {
      return pushNotice("Select depot code first.", "error");
    }
    setSavingCustomer(true);
    try {
      const created = await createFgDispatchCustomer({
        name: customerForm.name.trim(),
        registration_type: customerForm.registration_type,
        gst_number: customerForm.registration_type === "REGISTERED" ? customerForm.gst_number.trim().toUpperCase() : "",
        fo_customer_type: foCustomerType,
        state: customerForm.state,
        full_address: customerForm.full_address.trim(),
        pin_code: customerForm.pin_code.trim(),
      });
      const createdCustomer = created?.data ?? created;
      if (dispatchType === "DIRECT") {
        await addFgDispatchCustomerAddress(createdCustomer.id, {
          depot_code_id: selectedDirectDepotId,
          address_line: customerForm.full_address.trim(),
          state: customerForm.state,
          pin_code: customerForm.pin_code.trim(),
        });
        setAddressForm({
          depot_code_id: selectedDirectDepotId,
          address_line: customerForm.full_address.trim(),
          state: customerForm.state,
          pin_code: customerForm.pin_code.trim(),
        });
      }
      setCurrentCustomer(createdCustomer);
      setLoadedAddressId("");
      await qc.invalidateQueries({ queryKey: ["mm05", "addresses"] });
      pushNotice("Dispatch customer saved.");
    } catch (error) {
      pushNotice(error?.message || "Customer save failed.", "error");
    } finally {
      setSavingCustomer(false);
    }
  }

  async function handleSaveAddress() {
    if (!currentCustomer?.id) return pushNotice("Save customer first.", "error");
    if (!addressForm.depot_code_id || !addressForm.address_line.trim() || !addressForm.state) {
      return pushNotice("Virtual depot, address, and state are required.", "error");
    }
    setSavingAddress(true);
    try {
      if (loadedAddressId) {
        await updateFgDispatchCustomerAddress(loadedAddressId, {
          depot_code_id: addressForm.depot_code_id,
          address_line: addressForm.address_line.trim(),
          state: addressForm.state,
          pin_code: addressForm.pin_code.trim(),
        });
        pushNotice("Customer address updated.");
      } else {
        await addFgDispatchCustomerAddress(currentCustomer.id, {
          depot_code_id: addressForm.depot_code_id,
          address_line: addressForm.address_line.trim(),
          state: addressForm.state,
          pin_code: addressForm.pin_code.trim(),
        });
        pushNotice("Customer address added.");
      }
      await qc.invalidateQueries({ queryKey: ["mm05", "addresses", currentCustomer.id] });
      setLoadedAddressId("");
    } catch (error) {
      pushNotice(error?.message || "Address save failed.", "error");
    } finally {
      setSavingAddress(false);
    }
  }

  function loadAddressRow(row) {
    setLoadedAddressId(row.id);
    setAddressForm({
      depot_code_id: row.depot_code_id ?? "",
      address_line: row.address_line ?? "",
      state: row.state ?? "",
      pin_code: row.pin_code ?? "",
    });
  }

  function prepareAnotherAddress() {
    setLoadedAddressId("");
    setAddressForm((current) => ({
      ...current,
      depot_code_id: current.depot_code_id || selectedDirectDepotId,
    }));
  }

  useErpScreenHotkeys({
    refresh: {
      disabled: !companyId,
      perform: () => {
        void qc.invalidateQueries({ queryKey: ["mm05"] });
      },
    },
    focusPrimary: {
      disabled: false,
      perform: () => primaryFocusRef.current?.focus?.(),
    },
  });

  const addressColumns = [
    { key: "depot_code", label: "Virtual Depot", width: "120px" },
    { key: "address_line", label: "Address", width: "260px" },
    { key: "state", label: "State", width: "140px" },
    { key: "pin_code", label: "PIN", width: "90px" },
    {
      key: "edit",
      label: "Edit",
      width: "90px",
      render: (row) => (
        <button
          type="button"
          onClick={() => loadAddressRow(row)}
          className="border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-900"
        >
          Load
        </button>
      ),
    },
  ];

  return (
    <ErpScreenScaffold
      title="FG Dispatch Customer Master"
      subtitle="MM05 - Parent company, depot or virtual depot, then customer with GST/unregistered address flow."
      notice={notice.message ? { message: notice.message, tone: notice.tone } : null}
    >
      <ErpSectionCard>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,320px)_220px_220px]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
          />
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Type
            <select
              ref={primaryFocusRef}
              value={dispatchType}
              onChange={(event) => setDispatchType(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              {DISPATCH_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            FO Customer Type
            <select
              value={foCustomerType}
              onChange={(event) => setFoCustomerType(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              {FO_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-4 rounded border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <span className="font-semibold">{activeDispatchType?.label}:</span> {activeDispatchType?.helper}
        </div>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid gap-5">
            <div className={compactCardClass()}>
              <SectionTitle label="Parent Company" helper="State is mandatory for both registered and unregistered parent companies." />
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Registration Type
                  <select
                    value={parentForm.registration_type}
                    onChange={(event) => setParentForm((current) => ({ ...current, registration_type: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="REGISTERED">Registered</option>
                    <option value="UNREGISTERED">Unregistered</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Parent Company Name
                  <input
                    value={parentForm.company_name}
                    onChange={(event) => setParentForm((current) => ({ ...current, company_name: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  GST Number
                  <div className="flex gap-2">
                    <input
                      value={parentForm.gst_number}
                      disabled={parentForm.registration_type !== "REGISTERED"}
                      onChange={(event) => setParentForm((current) => ({ ...current, gst_number: event.target.value.toUpperCase() }))}
                      className="h-9 flex-1 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
                    />
                    <button
                      type="button"
                      disabled={parentLookupBusy || parentForm.registration_type !== "REGISTERED"}
                      onClick={handleParentLookup}
                      className="border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:bg-slate-100"
                    >
                      {parentLookupBusy ? "Checking..." : "Check GST"}
                    </button>
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  State
                  {renderStateSelect(parentForm.state, (event) => setParentForm((current) => ({ ...current, state: event.target.value })))}
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Full Address
                  <textarea
                    rows={3}
                    value={parentForm.full_address}
                    onChange={(event) => setParentForm((current) => ({ ...current, full_address: event.target.value }))}
                    className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  PIN Code
                  <input
                    value={parentForm.pin_code}
                    onChange={(event) => setParentForm((current) => ({ ...current, pin_code: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <button type="button" onClick={handleSaveParent} disabled={savingParent} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                  {savingParent ? "Saving..." : "Save Parent Company"}
                </button>
              </div>
            </div>

            <div className={compactCardClass()}>
              <SectionTitle
                label={dispatchType === "DIRECT" ? "Virtual Depot" : "Depot"}
                helper={dispatchType === "DIRECT"
                  ? "Virtual depot code is short; customer address stays in the customer section."
                  : "Depot code can carry its own depot address."}
              />
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Select Parent Company
                  <select
                    value={selectedParentId}
                    onChange={(event) => setSelectedParentId(event.target.value)}
                    className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select parent company</option>
                    {parentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.company_name} - {option.state}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Code
                  <input
                    value={depotForm.code}
                    onChange={(event) => setDepotForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Description
                  <input
                    value={depotForm.description}
                    onChange={(event) => setDepotForm((current) => ({ ...current, description: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                {dispatchType === "DEPOT" ? (
                  <>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Depot Address
                      <textarea
                        rows={2}
                        value={depotForm.address_line}
                        onChange={(event) => setDepotForm((current) => ({ ...current, address_line: event.target.value }))}
                        className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      State
                      {renderStateSelect(depotForm.state, (event) => setDepotForm((current) => ({ ...current, state: event.target.value })))}
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      PIN Code
                      <input
                        value={depotForm.pin_code}
                        onChange={(event) => setDepotForm((current) => ({ ...current, pin_code: event.target.value }))}
                        className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </label>
                  </>
                ) : null}
                <button type="button" onClick={handleSaveDepot} disabled={savingDepot} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                  {savingDepot ? "Saving..." : dispatchType === "DIRECT" ? "Save Virtual Depot" : "Save Depot"}
                </button>

                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {selectedParent ? (
                    <>
                      <div className="font-semibold">{selectedParent.company_name}</div>
                      <div>{selectedParent.state}</div>
                      <div>{selectedParent.full_address || "No address yet"}</div>
                    </>
                  ) : "Pick a parent company to continue."}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
              <SectionTitle
                label="Customer"
                helper={dispatchType === "DIRECT"
                  ? "Customer section is larger because GST fetch, unregistered entry, and direct-delivery address all happen here."
                  : "For depot dispatch, depot remains compact and customer carries its own state and address."}
              />
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Registration Type
                  <select
                    value={customerForm.registration_type}
                    onChange={(event) => setCustomerForm((current) => ({ ...current, registration_type: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="REGISTERED">Registered</option>
                    <option value="UNREGISTERED">Unregistered</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  {dispatchType === "DIRECT" ? "Virtual Depot Code" : "Depot Code"}
                  <select
                    value={dispatchType === "DIRECT" ? selectedDirectDepotId : selectedDepotId}
                    onChange={(event) => dispatchType === "DIRECT" ? setSelectedDirectDepotId(event.target.value) : setSelectedDepotId(event.target.value)}
                    className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select code</option>
                    {(dispatchType === "DIRECT" ? directDepotOptions : depotOptions).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.code} {option.description ? `- ${option.description}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 lg:col-span-2">
                  GST Number
                  <div className="flex gap-2">
                    <input
                      value={customerForm.gst_number}
                      disabled={customerForm.registration_type !== "REGISTERED"}
                      onChange={(event) => setCustomerForm((current) => ({ ...current, gst_number: event.target.value.toUpperCase() }))}
                      className="h-9 flex-1 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
                    />
                    <button
                      type="button"
                      disabled={customerLookupBusy || customerForm.registration_type !== "REGISTERED"}
                      onClick={handleCustomerLookup}
                      className="border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:bg-slate-100"
                    >
                      {customerLookupBusy ? "Checking..." : "Fetch GST"}
                    </button>
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 lg:col-span-2">
                  Customer Name
                  <input
                    value={customerForm.name}
                    onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  State
                  {renderStateSelect(customerForm.state, (event) => {
                    const nextState = event.target.value;
                    setCustomerForm((current) => ({ ...current, state: nextState }));
                    setAddressForm((current) => ({ ...current, state: nextState || current.state }));
                  })}
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  PIN Code
                  <input
                    value={customerForm.pin_code}
                    onChange={(event) => {
                      const nextPin = event.target.value;
                      setCustomerForm((current) => ({ ...current, pin_code: nextPin }));
                      setAddressForm((current) => ({ ...current, pin_code: nextPin || current.pin_code }));
                    }}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700 lg:col-span-2">
                  Customer Address
                  <textarea
                    rows={4}
                    value={customerForm.full_address}
                    onChange={(event) => {
                      const nextAddress = event.target.value;
                      setCustomerForm((current) => ({ ...current, full_address: nextAddress }));
                      setAddressForm((current) => ({ ...current, address_line: nextAddress || current.address_line }));
                    }}
                    className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={handleSaveCustomer} disabled={savingCustomer} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                  {savingCustomer ? "Saving..." : "Save Customer"}
                </button>
                {currentCustomer ? (
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    Active customer: <span className="font-semibold">{currentCustomer.name}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {dispatchType === "DIRECT" ? (
              <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
                <SectionTitle label="Customer Additional Address" helper="This uses the exact same address fields as the customer area above." />
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Virtual Depot Code
                    <select
                      value={addressForm.depot_code_id}
                      onChange={(event) => setAddressForm((current) => ({ ...current, depot_code_id: event.target.value }))}
                      className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select virtual depot</option>
                      {directDepotOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.code} {option.description ? `- ${option.description}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    State
                    {renderStateSelect(addressForm.state, (event) => setAddressForm((current) => ({ ...current, state: event.target.value })))}
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    PIN Code
                    <input
                      value={addressForm.pin_code}
                      onChange={(event) => setAddressForm((current) => ({ ...current, pin_code: event.target.value }))}
                      className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700 lg:col-span-2">
                    Address
                    <textarea
                      rows={3}
                      value={addressForm.address_line}
                      onChange={(event) => setAddressForm((current) => ({ ...current, address_line: event.target.value }))}
                      className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={handleSaveAddress} disabled={savingAddress || !currentCustomer} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                    {savingAddress ? "Saving..." : loadedAddressId ? "Update Address" : "Add Address"}
                  </button>
                  <button type="button" onClick={prepareAnotherAddress} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                    Add Another Address
                  </button>
                </div>

                <div className="mt-4">
                  <ErpDenseGrid
                    columns={addressColumns}
                    rows={addressRows}
                    rowKey={(row) => row.id}
                    maxHeight="280px"
                    emptyMessage={currentCustomer ? "No additional address yet." : "Save a direct customer first to manage addresses."}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
