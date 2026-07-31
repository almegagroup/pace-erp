import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
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
  upgradeFgDispatchCustomer,
} from "./omApi.js";

const FO_TYPE_OPTIONS = [
  { value: "", label: "-- Select --" },
  { value: "MTO_HPS", label: "MTO / HPS" },
  { value: "ZTEST", label: "ZTEST" },
  { value: "MTS", label: "MTS" },
];

function noticeFor(error) {
  return error?.message || "";
}

function stateOptions() {
  return INDIAN_STATES.map((entry) => (
    <option key={entry.code} value={entry.name}>
      {entry.name}
    </option>
  ));
}

function SectionTitle({ label, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      {action}
    </div>
  );
}

function ParentCompanyForm({ form, setForm, onLookup, lookingUp, onSave, saving }) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        Parent Company Name
        <input
          value={form.company_name}
          onChange={(event) => setForm((current) => ({ ...current, company_name: event.target.value }))}
          className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        GST Number
        <div className="flex gap-2">
          <input
            value={form.gst_number}
            onChange={(event) => setForm((current) => ({ ...current, gst_number: event.target.value.toUpperCase() }))}
            className="h-9 flex-1 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
          <button type="button" onClick={onLookup} disabled={lookingUp} className="border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
            {lookingUp ? "Checking..." : "Check GST"}
          </button>
        </div>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        State
        <select
          value={form.state}
          onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))}
          className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="">Select state</option>
          {stateOptions()}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        Full Address
        <textarea
          rows={3}
          value={form.full_address}
          onChange={(event) => setForm((current) => ({ ...current, full_address: event.target.value }))}
          className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        PIN Code
        <input
          value={form.pin_code}
          onChange={(event) => setForm((current) => ({ ...current, pin_code: event.target.value }))}
          className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={saving} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
          {saving ? "Saving..." : "Save Parent Company"}
        </button>
      </div>
    </div>
  );
}

export default function FgDispatchCustomerPage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const primaryFocusRef = useRef(null);
  const [dispatchType, setDispatchType] = useState("DIRECT");
  const [companyId, setCompanyId] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedDirectDepotId, setSelectedDirectDepotId] = useState("");
  const [selectedDepotId, setSelectedDepotId] = useState("");
  const [addressParentId, setAddressParentId] = useState("");
  const [upgradeParentId, setUpgradeParentId] = useState("");
  const [loadedAddressId, setLoadedAddressId] = useState("");
  const [currentCustomer, setCurrentCustomer] = useState(null);
  const [notice, setNotice] = useState({ message: "", tone: "neutral" });
  const [savingParent, setSavingParent] = useState(false);
  const [savingDepot, setSavingDepot] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [parentLookupBusy, setParentLookupBusy] = useState(false);
  const [customerLookupBusy, setCustomerLookupBusy] = useState(false);
  const [upgradeLookupBusy, setUpgradeLookupBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const [parentForm, setParentForm] = useState({
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
    name: "",
    registration_type: "UNREGISTERED",
    gst_number: "",
    fo_customer_type: "",
  });
  const [addressForm, setAddressForm] = useState({
    depot_code_id: "",
    address_line: "",
    state: "",
    pin_code: "",
  });
  const [upgradeForm, setUpgradeForm] = useState({
    gst_number: "",
    name: "",
    fo_customer_type: "",
    address_action: "ADD_NEW",
    target_address_id: "",
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
    setAddressParentId("");
    setUpgradeParentId("");
    setLoadedAddressId("");
    setCurrentCustomer(null);
    setAddressForm((current) => ({ ...current, depot_code_id: "" }));
  }, [companyId, dispatchType]);

  useEffect(() => {
    if (dispatchType === "DIRECT") {
      setAddressParentId((current) => current || selectedParentId);
      setUpgradeParentId((current) => current || selectedParentId);
      setAddressForm((current) => ({
        ...current,
        depot_code_id: addressParentId === selectedParentId ? selectedDirectDepotId : current.depot_code_id,
      }));
      setUpgradeForm((current) => ({
        ...current,
        depot_code_id: upgradeParentId === selectedParentId ? selectedDirectDepotId : current.depot_code_id,
      }));
    }
  }, [addressParentId, dispatchType, selectedDirectDepotId, selectedParentId, upgradeParentId]);

  useEffect(() => {
    if (!addressParentId && selectedParentId) {
      setAddressParentId(selectedParentId);
    }
  }, [addressParentId, selectedParentId]);

  useEffect(() => {
    if (!upgradeParentId && selectedParentId) {
      setUpgradeParentId(selectedParentId);
    }
  }, [selectedParentId, upgradeParentId]);

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

  const addressDepotCodesQuery = useQuery({
    queryKey: ["mm05", "depots", addressParentId, "DIRECT"],
    queryFn: () => listFgDepotCodes({ parent_company_id: addressParentId, dispatch_type: "DIRECT" }),
    enabled: Boolean(addressParentId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const upgradeDepotCodesQuery = useQuery({
    queryKey: ["mm05", "depots", upgradeParentId, "DIRECT"],
    queryFn: () => listFgDepotCodes({ parent_company_id: upgradeParentId, dispatch_type: "DIRECT" }),
    enabled: Boolean(upgradeParentId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const addressesQuery = useQuery({
    queryKey: ["mm05", "addresses", currentCustomer?.id],
    queryFn: () => listFgDispatchCustomerAddresses(currentCustomer.id),
    enabled: Boolean(currentCustomer?.id),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const parentOptions = parentCompaniesQuery.data ?? [];
  const activeDepotRows = dispatchType === "DIRECT" ? (directDepotCodesQuery.data ?? []) : (depotCodesQuery.data ?? []);
  const addressRows = addressesQuery.data ?? [];
  const addressDepotOptions = addressDepotCodesQuery.data ?? [];
  const upgradeDepotOptions = upgradeDepotCodesQuery.data ?? [];

  const selectedParent = useMemo(
    () => parentOptions.find((entry) => entry.id === selectedParentId) ?? null,
    [parentOptions, selectedParentId]
  );

  const selectedDepotDisplay = useMemo(() => {
    const targetId = dispatchType === "DIRECT" ? selectedDirectDepotId : selectedDepotId;
    return activeDepotRows.find((entry) => entry.id === targetId) ?? null;
  }, [activeDepotRows, dispatchType, selectedDepotId, selectedDirectDepotId]);

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
      pushNotice("Parent-company GST profile loaded.", "info");
    } catch (error) {
      pushNotice(noticeFor(error) || "GST lookup failed.", "error");
    } finally {
      setParentLookupBusy(false);
    }
  }

  async function handleCustomerLookup(target = "customer") {
    const form = target === "upgrade" ? upgradeForm : customerForm;
    const gst = form.gst_number.trim().toUpperCase();
    if (!gst) return pushNotice("Enter a GST number first.", "error");
    target === "upgrade" ? setUpgradeLookupBusy(true) : setCustomerLookupBusy(true);
    try {
      const profile = await lookupCustomerGstProfile(gst);
      const patch = {
        gst_number: gst,
        name: profile.legal_name || form.name,
        state: profile.state_name ? matchIndianStateName(profile.state_name) : "",
        address_line: profile.full_address || "",
        pin_code: profile.pin_code || "",
      };
      if (target === "upgrade") {
        setUpgradeForm((current) => ({
          ...current,
          gst_number: patch.gst_number,
          name: patch.name,
          state: patch.state || current.state,
          address_line: patch.address_line || current.address_line,
          pin_code: patch.pin_code || current.pin_code,
        }));
      } else {
        setCustomerForm((current) => ({
          ...current,
          gst_number: patch.gst_number,
          name: patch.name,
        }));
        setAddressForm((current) => ({
          ...current,
          state: patch.state || current.state,
          address_line: patch.address_line || current.address_line,
          pin_code: patch.pin_code || current.pin_code,
        }));
      }
      pushNotice("Customer GST profile loaded.", "info");
    } catch (error) {
      pushNotice(noticeFor(error) || "GST lookup failed.", "error");
    } finally {
      target === "upgrade" ? setUpgradeLookupBusy(false) : setCustomerLookupBusy(false);
    }
  }

  async function saveParentCompany() {
    if (!companyId) return pushNotice("Select a company first.", "error");
    setSavingParent(true);
    try {
      const created = await createFgParentCompany({
        company_id: companyId,
        ...parentForm,
      });
      setSelectedParentId(created.id);
      await qc.invalidateQueries({ queryKey: ["mm05", "parents", companyId] });
      pushNotice("Parent company saved.");
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSavingParent(false);
    }
  }

  async function saveDepotCode() {
    if (!selectedParentId) return pushNotice("Select or create a parent company first.", "error");
    setSavingDepot(true);
    try {
      const created = await createOrGetFgDepotCode({
        parent_company_id: selectedParentId,
        dispatch_type: dispatchType,
        ...depotForm,
      });
      if (dispatchType === "DIRECT") setSelectedDirectDepotId(created.id);
      else setSelectedDepotId(created.id);
      await qc.invalidateQueries({ queryKey: ["mm05", "depots", selectedParentId, dispatchType] });
      pushNotice(`${dispatchType === "DIRECT" ? "Direct" : "Depot"} code saved.`);
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSavingDepot(false);
    }
  }

  async function saveCustomerAndAddress() {
    if (!addressForm.depot_code_id) return pushNotice("Select or create a DIRECT depot code first.", "error");
    if (!customerForm.name.trim()) return pushNotice("Customer name is required.", "error");
    if (!customerForm.fo_customer_type) return pushNotice("FO customer type is required.", "error");
    if (customerForm.registration_type === "REGISTERED" && !customerForm.gst_number.trim()) {
      return pushNotice("GST number is required for a registered customer.", "error");
    }
    setSavingCustomer(true);
    setSavingAddress(true);
    try {
      let customer = currentCustomer;
      if (!customer) {
        customer = await createFgDispatchCustomer(customerForm);
        setCurrentCustomer(customer);
      }
      await addFgDispatchCustomerAddress(customer.id, {
        depot_code_id: addressForm.depot_code_id,
        address_line: addressForm.address_line,
        state: addressForm.state,
        pin_code: addressForm.pin_code,
      });
      setLoadedAddressId("");
      await qc.invalidateQueries({ queryKey: ["mm05", "addresses", customer.id] });
      pushNotice(currentCustomer ? "Address added to existing customer." : "Customer and address saved.");
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSavingCustomer(false);
      setSavingAddress(false);
    }
  }

  async function updateAddress(addressId) {
    if (!currentCustomer?.id) return;
    setSavingAddress(true);
    try {
      await updateFgDispatchCustomerAddress(addressId, {
        depot_code_id: addressForm.depot_code_id,
        address_line: addressForm.address_line,
        state: addressForm.state,
        pin_code: addressForm.pin_code,
      });
      setLoadedAddressId(addressId);
      await qc.invalidateQueries({ queryKey: ["mm05", "addresses", currentCustomer.id] });
      pushNotice("Address updated.");
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSavingAddress(false);
    }
  }

  async function submitUpgrade() {
    if (!currentCustomer?.id) return;
    if (!upgradeForm.fo_customer_type) return pushNotice("FO customer type is required.", "error");
    setSavingCustomer(true);
    try {
      const upgraded = await upgradeFgDispatchCustomer(currentCustomer.id, {
        gst_number: upgradeForm.gst_number,
        address_action: upgradeForm.address_action,
        target_address_id: upgradeForm.address_action === "REPLACE" ? upgradeForm.target_address_id : undefined,
        overwrite_fields: {
          name: upgradeForm.name,
          fo_customer_type: upgradeForm.fo_customer_type,
          depot_code_id: upgradeForm.depot_code_id,
          address_line: upgradeForm.address_line,
          state: upgradeForm.state,
          pin_code: upgradeForm.pin_code,
        },
      });
      setCurrentCustomer(upgraded);
      setUpgradeOpen(false);
      await qc.invalidateQueries({ queryKey: ["mm05", "addresses", currentCustomer.id] });
      pushNotice("Customer upgraded to REGISTERED.");
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSavingCustomer(false);
    }
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

  return (
    <ErpScreenScaffold
      title="FG Dispatch Customer Master"
      subtitle="MM05 — Parent Company, DIRECT or DEPOT code, dispatch customer, multi-address flow, and state-consistency guard."
      notice={notice.message ? notice : null}
      actions={[
        {
          label: "Refresh",
          tone: "neutral",
          onClick: () => { void qc.invalidateQueries({ queryKey: ["mm05"] }); },
        },
      ]}
    >
      <ErpSectionCard title="Header">
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_180px]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
            selectRef={primaryFocusRef}
          />
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Type
            <select
              value={dispatchType}
              onChange={(event) => setDispatchType(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="DIRECT">Direct</option>
              <option value="DEPOT">Depot</option>
            </select>
          </label>
        </div>
      </ErpSectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ErpSectionCard title="Parent Company">
          <SectionTitle label="Create Or Select" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Existing Parent Company
              <select
                value={selectedParentId}
                onChange={(event) => setSelectedParentId(event.target.value)}
                className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select parent company</option>
                {parentOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.company_name} | {entry.state}
                  </option>
                ))}
              </select>
            </label>
            <ParentCompanyForm
              form={parentForm}
              setForm={setParentForm}
              onLookup={() => void handleParentLookup()}
              lookingUp={parentLookupBusy}
              onSave={() => void saveParentCompany()}
              saving={savingParent}
            />
          </div>
        </ErpSectionCard>

        <ErpSectionCard title={dispatchType === "DIRECT" ? "DIRECT Depot Code" : "DEPOT Code"}>
          <SectionTitle label="Create Or Select" />
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Existing Depot Code
              <select
                value={dispatchType === "DIRECT" ? selectedDirectDepotId : selectedDepotId}
                onChange={(event) => dispatchType === "DIRECT" ? setSelectedDirectDepotId(event.target.value) : setSelectedDepotId(event.target.value)}
                className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select depot code</option>
                {activeDepotRows.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code}{entry.description ? ` | ${entry.description}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Code
              <input
                value={depotForm.code}
                onChange={(event) => setDepotForm((current) => ({ ...current, code: event.target.value }))}
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
                  Address Line
                  <textarea
                    rows={3}
                    value={depotForm.address_line}
                    onChange={(event) => setDepotForm((current) => ({ ...current, address_line: event.target.value }))}
                    className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  State
                  <select
                    value={depotForm.state}
                    onChange={(event) => setDepotForm((current) => ({ ...current, state: event.target.value }))}
                    className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select state</option>
                    {stateOptions()}
                  </select>
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
            <div className="flex justify-end">
              <button type="button" onClick={() => void saveDepotCode()} disabled={savingDepot} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                {savingDepot ? "Saving..." : "Save Depot Code"}
              </button>
            </div>
          </div>
        </ErpSectionCard>
      </div>

      {dispatchType === "DIRECT" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ErpSectionCard title="Dispatch Customer">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Registration Type
                <select
                  value={customerForm.registration_type}
                  onChange={(event) => setCustomerForm((current) => ({ ...current, registration_type: event.target.value }))}
                  className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="UNREGISTERED">UNREGISTERED</option>
                  <option value="REGISTERED">REGISTERED</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Customer Name
                <input
                  value={customerForm.name}
                  onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))}
                  className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                GST Number
                <div className="flex gap-2">
                  <input
                    value={customerForm.gst_number}
                    onChange={(event) => setCustomerForm((current) => ({ ...current, gst_number: event.target.value.toUpperCase() }))}
                    className="h-9 flex-1 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCustomerLookup("customer")}
                    disabled={customerLookupBusy || customerForm.registration_type !== "REGISTERED"}
                    className="border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {customerLookupBusy ? "Checking..." : "Check GST"}
                  </button>
                </div>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                FO Customer Type
                <select
                  value={customerForm.fo_customer_type}
                  onChange={(event) => setCustomerForm((current) => ({ ...current, fo_customer_type: event.target.value }))}
                  className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {FO_TYPE_OPTIONS.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </label>
              {currentCustomer ? (
                <div className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
                  <ErpFieldPreview label="Current Customer" value={`${currentCustomer.name} | ${currentCustomer.registration_type}`} />
                  {currentCustomer.registration_type === "UNREGISTERED" ? (
                    <button type="button" onClick={() => {
                      setUpgradeForm((current) => ({
                        ...current,
                        name: currentCustomer.name || "",
                        fo_customer_type: currentCustomer.fo_customer_type || "",
                        depot_code_id: selectedDirectDepotId || current.depot_code_id,
                      }));
                      setUpgradeOpen(true);
                    }} className="w-fit border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      Upgrade To REGISTERED
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </ErpSectionCard>

          <ErpSectionCard title="Address">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Parent Company
                <select
                  value={addressParentId}
                  onChange={(event) => {
                    const nextParentId = event.target.value;
                    setAddressParentId(nextParentId);
                    setAddressForm((current) => ({ ...current, depot_code_id: "" }));
                  }}
                  className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select parent company</option>
                  {parentOptions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.company_name} | {entry.state}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                DIRECT Depot Code
                <select
                  value={addressForm.depot_code_id}
                  onChange={(event) => setAddressForm((current) => ({ ...current, depot_code_id: event.target.value }))}
                  className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select depot code</option>
                  {addressDepotOptions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.code}{entry.description ? ` | ${entry.description}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Address Line
                <textarea
                  rows={3}
                  value={addressForm.address_line}
                  onChange={(event) => setAddressForm((current) => ({ ...current, address_line: event.target.value }))}
                  className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                State
                <select
                  value={addressForm.state}
                  onChange={(event) => setAddressForm((current) => ({ ...current, state: event.target.value }))}
                  className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select state</option>
                  {stateOptions()}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                PIN Code
                <input
                  value={addressForm.pin_code}
                  onChange={(event) => setAddressForm((current) => ({ ...current, pin_code: event.target.value }))}
                  className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
              <div className="flex justify-end">
                <button type="button" onClick={() => void saveCustomerAndAddress()} disabled={savingCustomer || savingAddress} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                  {savingCustomer || savingAddress ? "Saving..." : currentCustomer ? "Add Address" : "Save Customer + Address"}
                </button>
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard title={`Addresses${currentCustomer ? ` (${addressRows.length})` : ""}`} className="lg:col-span-2">
            <ErpDenseGrid
              columns={[
                { key: "depot_code", label: "Depot Code", render: (row) => row.depot_code || "-" },
                { key: "parent_company_name", label: "Parent Company", render: (row) => row.parent_company_name ? `${row.parent_company_name} | ${row.parent_company_state}` : "-" },
                { key: "address_line", label: "Address" },
                { key: "state", label: "State" },
                { key: "pin_code", label: "PIN", render: (row) => row.pin_code || "-" },
                {
                  key: "action",
                  label: "Action",
                  render: (row) => (
                    <button
                      type="button"
                      onClick={() => {
                        setAddressParentId(row.parent_company_id || "");
                        setLoadedAddressId(row.id);
                        setAddressForm({
                          depot_code_id: row.depot_code_id,
                          address_line: row.address_line,
                          state: row.state,
                          pin_code: row.pin_code || "",
                        });
                      }}
                      className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                    >
                      Load Into Form
                    </button>
                  ),
                },
              ]}
              rows={addressRows}
              rowKey={(row) => row.id}
              emptyMessage={currentCustomer ? "No address saved yet." : "Create a customer first to manage addresses."}
            />
            {currentCustomer ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!loadedAddressId) {
                      pushNotice("Load an existing row into the form first, then update it.", "error");
                      return;
                    }
                    void updateAddress(loadedAddressId);
                  }}
                  disabled={savingAddress}
                  className="w-fit border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  {savingAddress ? "Updating..." : "Update Loaded Address"}
                </button>
              </div>
            ) : null}
          </ErpSectionCard>
        </div>
      ) : (
        <ErpSectionCard title="DEPOT Summary">
          <div className="grid gap-4 md:grid-cols-2">
            <ErpFieldPreview
              label="Parent Company"
              value={selectedParent ? `${selectedParent.company_name} | ${selectedParent.state}` : "Not selected yet"}
            />
            <ErpFieldPreview
              label="DEPOT Code"
              value={selectedDepotDisplay ? `${selectedDepotDisplay.code}${selectedDepotDisplay.description ? ` | ${selectedDepotDisplay.description}` : ""}` : "Not selected yet"}
              multiline
              caption={selectedDepotDisplay?.address_line ? `${selectedDepotDisplay.address_line}\n${selectedDepotDisplay.state || ""} ${selectedDepotDisplay.pin_code || ""}` : "DEPOT-type address is stored inline on the depot code row."}
            />
          </div>
        </ErpSectionCard>
      )}

      <DrawerBase
        visible={upgradeOpen}
        title="Upgrade To REGISTERED"
        onClose={() => setUpgradeOpen(false)}
        width="min(540px, calc(100vw - 24px))"
        actions={
          <>
            <button type="button" onClick={() => setUpgradeOpen(false)} className="border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => void submitUpgrade()} disabled={savingCustomer} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              {savingCustomer ? "Saving..." : "Upgrade"}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            GST Number
            <div className="flex gap-2">
              <input
                value={upgradeForm.gst_number}
                onChange={(event) => setUpgradeForm((current) => ({ ...current, gst_number: event.target.value.toUpperCase() }))}
                className="h-9 flex-1 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
              <button type="button" onClick={() => void handleCustomerLookup("upgrade")} disabled={upgradeLookupBusy} className="border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
                {upgradeLookupBusy ? "Checking..." : "Check GST"}
              </button>
            </div>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Customer Name
            <input
              value={upgradeForm.name}
              onChange={(event) => setUpgradeForm((current) => ({ ...current, name: event.target.value }))}
              className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            FO Customer Type
            <select
              value={upgradeForm.fo_customer_type}
              onChange={(event) => setUpgradeForm((current) => ({ ...current, fo_customer_type: event.target.value }))}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              {FO_TYPE_OPTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Address Action
            <select
              value={upgradeForm.address_action}
              onChange={(event) => setUpgradeForm((current) => ({ ...current, address_action: event.target.value }))}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="ADD_NEW">Add New</option>
              <option value="REPLACE">Replace Existing</option>
            </select>
          </label>
          {upgradeForm.address_action === "REPLACE" ? (
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Replace Which Address
              <select
                value={upgradeForm.target_address_id}
                onChange={(event) => setUpgradeForm((current) => ({ ...current, target_address_id: event.target.value }))}
                className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select address</option>
                {addressRows.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.depot_code} | {entry.state} | {entry.address_line}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Parent Company
            <select
              value={upgradeParentId}
              onChange={(event) => {
                const nextParentId = event.target.value;
                setUpgradeParentId(nextParentId);
                setUpgradeForm((current) => ({ ...current, depot_code_id: "" }));
              }}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="">Select parent company</option>
              {parentOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.company_name} | {entry.state}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            DIRECT Depot Code
            <select
              value={upgradeForm.depot_code_id}
              onChange={(event) => setUpgradeForm((current) => ({ ...current, depot_code_id: event.target.value }))}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="">Select depot code</option>
              {upgradeDepotOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code}{entry.description ? ` | ${entry.description}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Address Line
            <textarea
              rows={3}
              value={upgradeForm.address_line}
              onChange={(event) => setUpgradeForm((current) => ({ ...current, address_line: event.target.value }))}
              className="border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              State
              <select
                value={upgradeForm.state}
                onChange={(event) => setUpgradeForm((current) => ({ ...current, state: event.target.value }))}
                className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select state</option>
                {stateOptions()}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              PIN Code
              <input
                value={upgradeForm.pin_code}
                onChange={(event) => setUpgradeForm((current) => ({ ...current, pin_code: event.target.value }))}
                className="h-9 border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
