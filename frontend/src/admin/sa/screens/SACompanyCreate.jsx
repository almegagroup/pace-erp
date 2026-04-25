/*
 * File-ID: 9.2-FRONT
 * File-Path: frontend/src/admin/sa/screens/SACompanyCreate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin company creation surface with GST-backed autofill and address-only edit mode
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getActiveScreenContext,
  getPreviousScreen,
  openScreen,
  popScreen,
} from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function lookupGstProfile(gstNumber) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/company/gst-profile?gst_number=${encodeURIComponent(gstNumber)}`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.gst_profile) {
    const error = new Error(json?.code ?? "GST_PROFILE_LOOKUP_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.data;
}

async function createCompany(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/company`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.company) {
    const error = new Error(json?.code ?? "COMPANY_CREATE_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.data;
}

async function fetchCompanies() {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/companies`, {
    credentials: "include",
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json?.data?.companies)) {
    const error = new Error(json?.code ?? "COMPANY_LIST_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.data.companies;
}

async function updateCompanyAddress(payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/company/address`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.company) {
    const error = new Error(json?.code ?? "COMPANY_ADDRESS_UPDATE_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.data;
}

function normalizePinInput(value) {
  return String(value ?? "").replace(/[^\d]/g, "").slice(0, 6);
}

export default function SACompanyCreate() {
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const gstInputRef = useRef(null);
  const companyNameInputRef = useRef(null);
  const stateNameInputRef = useRef(null);
  const pinCodeInputRef = useRef(null);
  const fullAddressInputRef = useRef(null);

  const companyIdFromContext = initialContext.companyId ?? "";
  const companyIdFromQuery = searchParams.get("company_id") ?? "";
  const editingCompanyId = companyIdFromQuery || companyIdFromContext;
  const isEditMode = initialContext.mode === "edit" || Boolean(editingCompanyId);
  const isDrillThrough = initialContext.contextKind === "DRILL_THROUGH";

  const [gstNumber, setGstNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [stateName, setStateName] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [fullAddress, setFullAddress] = useState("");
  const [, setGstProfile] = useState(null);
  const [createdCompany, setCreatedCompany] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const normalizedGst = gstNumber.trim().toUpperCase();
  const hasExistingCompany =
    Boolean(createdCompany?.company_code) &&
    (!normalizedGst || createdCompany?.gst_number === normalizedGst);

  useEffect(() => {
    if (!isEditMode || !editingCompanyId) {
      return;
    }

    let alive = true;

    async function loadCompanyForEdit() {
      setLoadingCompany(true);
      setError("");
      setNotice("");

      try {
        const companies = await fetchCompanies();
        const company = companies.find((row) => row.id === editingCompanyId) ?? null;

        if (!alive) {
          return;
        }

        if (!company) {
          setCreatedCompany(null);
          setError("The selected company could not be found.");
          return;
        }

        setCreatedCompany(company);
        setGstNumber(company.gst_number ?? "");
        setCompanyName(company.company_name ?? "");
        setStateName(company.state_name ?? "");
        setPinCode(company.pin_code ?? "");
        setFullAddress(company.full_address ?? "");
      } catch {
        if (!alive) {
          return;
        }

        setError("Company address record could not be loaded right now.");
      } finally {
        if (alive) {
          setLoadingCompany(false);
        }
      }
    }

    void loadCompanyForEdit();

    return () => {
      alive = false;
    };
  }, [editingCompanyId, isEditMode]);

  function handleReturn() {
    const previousScreen = getPreviousScreen();

    if (isDrillThrough && previousScreen?.screen_code === "SA_COMPANY_MANAGE") {
      popScreen();
      return;
    }

    openScreen("SA_COMPANY_MANAGE", { mode: "replace" });
    navigate("/sa/company/manage");
  }

  useErpDenseFormNavigation(formContainerRef, {
    submitOnFinalField: true,
    disabled: creating || lookingUp || loadingCompany,
    onSubmit: () => {
      if (isEditMode) {
        void handleSaveAddress();
        return;
      }

      void handleCreate();
    },
  });

  useErpScreenHotkeys({
    save: {
      disabled:
        creating ||
        lookingUp ||
        loadingCompany ||
        (!isEditMode && hasExistingCompany),
      perform: () => {
        if (isEditMode) {
          void handleSaveAddress();
          return;
        }

        void handleCreate();
      },
    },
    focusSearch: {
      perform: () =>
        isEditMode ? stateNameInputRef.current?.focus() : gstInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () =>
        isEditMode ? stateNameInputRef.current?.focus() : gstInputRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-company-primary-nav",
      group: "Current Screen",
      label: isDrillThrough ? "Back to company register" : "Go to SA control panel",
      keywords: ["control panel", "company register", "sa admin"],
      perform: () => {
        if (isDrillThrough) {
          handleReturn();
          return;
        }

        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      order: 10,
    },
    {
      id: "sa-company-home",
      group: "Current Screen",
      label: isEditMode ? "Go to company register" : "Go to SA home",
      keywords: ["sa home", "dashboard", "company register"],
      perform: () => {
        if (isEditMode) {
          handleReturn();
          return;
        }

        openScreen("SA_HOME", { mode: "reset" });
        navigate("/sa/home");
      },
      order: 20,
    },
    {
      id: "sa-company-focus-primary",
      group: "Current Screen",
      label: isEditMode ? "Focus state name" : "Focus GST number",
      keywords: ["gst", "tax", "state", "address"],
      perform: () =>
        isEditMode ? stateNameInputRef.current?.focus() : gstInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-company-secondary-focus",
      group: "Current Screen",
      label: isEditMode ? "Focus address block" : lookingUp ? "Checking GST profile..." : "Check GST profile",
      hint: "Enter",
      keywords: ["lookup", "gst profile", "address", "applyflow"],
      disabled: isEditMode ? false : lookingUp,
      perform: () => {
        if (isEditMode) {
          fullAddressInputRef.current?.focus();
          return;
        }

        void handleLookup();
      },
      order: 40,
    },
    {
      id: "sa-company-third-focus",
      group: "Current Screen",
      label: isEditMode ? "Focus PIN code" : "Focus company name",
      keywords: ["company name", "pin", "legal name"],
      perform: () =>
        isEditMode ? pinCodeInputRef.current?.focus() : companyNameInputRef.current?.focus(),
      order: 50,
    },
    {
      id: "sa-company-save",
      group: "Current Screen",
      label: isEditMode
        ? creating
          ? "Saving address..."
          : "Save address changes"
        : creating
          ? "Creating company..."
          : hasExistingCompany
            ? "Company already created"
            : "Create company",
      hint: "Ctrl+S",
      keywords: ["create company", "save company", "save address", "master"],
      disabled:
        creating ||
        lookingUp ||
        loadingCompany ||
        (!isEditMode && hasExistingCompany),
      perform: () => {
        if (isEditMode) {
          void handleSaveAddress();
          return;
        }

        void handleCreate();
      },
      order: 60,
    },
  ]);

  async function handleLookup() {
    if (!normalizedGst) {
      setError("Enter a GST number before lookup.");
      return;
    }

    setLookingUp(true);
    setError("");
    setNotice("");

    try {
      const lookup = await lookupGstProfile(normalizedGst);
      const profile = lookup.gst_profile;
      const existingCompany = lookup.existing_company ?? null;

      setGstProfile(profile);
      setCompanyName(profile.legal_name ?? existingCompany?.company_name ?? "");
      setStateName(existingCompany?.state_name ?? "");
      setPinCode(existingCompany?.pin_code ?? "");
      setFullAddress(existingCompany?.full_address ?? "");
      setCreatedCompany(existingCompany);
      setNotice(
        existingCompany
          ? `Company already exists in master as ${existingCompany.company_code}. Review the saved record instead of creating it again.`
          : "GST profile resolved. Review the company identity block and continue with Ctrl+S when ready."
      );
      companyNameInputRef.current?.focus();
    } catch (lookupError) {
      setGstProfile(null);
      setCreatedCompany(null);
      setStateName("");
      setPinCode("");
      setFullAddress("");
      setNotice("");
      setError(
        lookupError?.status >= 500
          ? "GST service is unavailable right now. Check Applyflow/backend configuration."
          : "Unable to resolve GST right now. Check the GST number or backend integration."
      );
    } finally {
      setLookingUp(false);
    }
  }

  async function handleCreate() {
    const trimmedCompanyName = companyName.trim();

    if (!normalizedGst && !trimmedCompanyName) {
      setError("Provide a GST number or a company name before creating the company.");
      return;
    }

    if (hasExistingCompany) {
      setError("");
      setNotice(`Company already exists in master as ${createdCompany.company_code}. No second create is needed.`);
      return;
    }

    setCreating(true);
    setError("");
    setNotice("");

    try {
      const result = await createCompany({
        company_name: trimmedCompanyName || undefined,
        gst_number: normalizedGst || undefined,
      });

      setCreatedCompany(result.company);
      setCompanyName(result.company.company_name ?? trimmedCompanyName);
      setStateName(result.company.state_name ?? "");
      setPinCode(result.company.pin_code ?? "");
      setFullAddress(result.company.full_address ?? "");
      setNotice(
        result.already_exists
          ? `Company already existed as ${result.company.company_code}.`
          : `Company ${result.company.company_code} created successfully.`
      );
    } catch (createError) {
      setError(
        createError?.message === "COMPANY_ALREADY_EXISTS"
          ? "This GST is already present in company master."
          : "Company creation was not finalized by the backend."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveAddress() {
    if (!editingCompanyId) {
      setError("No company is selected for address edit.");
      return;
    }

    setCreating(true);
    setError("");
    setNotice("");

    try {
      const result = await updateCompanyAddress({
        company_id: editingCompanyId,
        state_name: stateName.trim() || null,
        pin_code: pinCode.trim() || null,
        full_address: fullAddress.trim() || null,
      });

      setCreatedCompany(result.company);
      setStateName(result.company.state_name ?? "");
      setPinCode(result.company.pin_code ?? "");
      setFullAddress(result.company.full_address ?? "");
      setNotice(`Address updated for ${result.company.company_code}.`);
    } catch (saveError) {
      setError(
        saveError?.message === "PIN_CODE_INVALID"
          ? "PIN code must contain exactly 6 digits."
          : saveError?.message === "SA_ONLY"
            ? "Only Super Admin can edit company address."
            : "Company address could not be saved right now."
      );
    } finally {
      setCreating(false);
    }
  }

  const topActions = [
    {
      key: "primary-nav",
      label: isDrillThrough ? "Back To Company Register" : "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => {
        if (isDrillThrough) {
          handleReturn();
          return;
        }

        openScreen("SA_CONTROL_PANEL", { mode: "replace" });
        navigate("/sa/control-panel");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "secondary-nav",
      label: isEditMode ? "Company Register" : "SA Home",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => {
        if (isEditMode) {
          handleReturn();
          return;
        }

        openScreen("SA_HOME", { mode: "reset" });
        navigate("/sa/home");
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "save",
      label: isEditMode
        ? creating
          ? "Saving..."
          : "Save Address"
        : creating
          ? "Creating..."
          : hasExistingCompany
            ? "Already Created"
            : "Create Company",
      hint: "Ctrl+S",
      tone: "primary",
      disabled:
        creating ||
        lookingUp ||
        loadingCompany ||
        (!isEditMode && hasExistingCompany),
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => {
        if (isEditMode) {
          void handleSaveAddress();
          return;
        }

        void handleCreate();
      },
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const notices = [
    notice
      ? {
          key: "notice",
          tone: "success",
          message: notice,
        }
      : null,
    error
      ? {
          key: "error",
          tone: "error",
          message: error,
        }
      : null,
  ].filter(Boolean);

  const bottomContent = createdCompany ? (
    <section className="grid gap-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
        {isEditMode ? "Editable Address Record" : hasExistingCompany ? "Existing Company" : "Created"}
      </div>
      <div className="text-sm font-semibold text-slate-900">
        {isEditMode
          ? "Company master identity is locked. Only address fields are editable here."
          : hasExistingCompany
            ? "Company master row already exists for this GST"
            : "Company master row created successfully"}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Company Code", createdCompany.company_code, "Auto-generated canonical company code."],
          ["Company Name", createdCompany.company_name, "Canonical legal company name saved in ERP master."],
          ["State", createdCompany.state_name, "Saved state value on company master."],
          ["PIN Code", createdCompany.pin_code, "Saved as a dedicated postal field."],
        ].map(([label, value, caption]) => (
          <div key={label} className="border border-emerald-300 bg-emerald-50 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">{label}</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{value || "Not captured"}</div>
            <div className="mt-1 text-xs text-slate-600">{caption}</div>
          </div>
        ))}
      </div>
      <div className="border border-emerald-300 bg-emerald-50 px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">Saved Address</div>
        <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-900">
          {createdCompany.full_address || "Address not captured"}
        </div>
        <div className="mt-1 text-xs text-slate-600">The single-field address stored on company master.</div>
      </div>
    </section>
  ) : null;

  return (
    <ErpEntryFormTemplate
      eyebrow={isEditMode ? "SA Company Address Governance" : "SA Company Governance"}
      title={isEditMode ? "Edit Company Address" : "Create Business Company"}
      actions={topActions}
      notices={notices}
      footerHints={[
        "Ctrl+S Save",
        "Esc Back",
        "Ctrl+K Command Bar",
      ]}
      formEyebrow="Entry Form"
      formTitle={isEditMode ? "Address-only company edit" : "GST-driven company setup"}
      formContent={(
        <div ref={formContainerRef} className="grid gap-3">
          {loadingCompany ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Loading company address record...
            </div>
          ) : isEditMode ? (
            <div
              data-erp-form-section="true"
              className="border border-slate-300 bg-white"
            >
              <div className="border-b border-slate-300 bg-[#eef4fb] px-4 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Section 1
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">
                  Locked identity, editable address
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Company code, company name, and GST stay locked. Only address fields can be updated from this SA-only screen.
                </p>
              </div>

              <div className="grid gap-3 bg-white px-4 py-3">
                <ErpDenseFormRow label="Company Code">
                  <input
                    value={createdCompany?.company_code ?? ""}
                    readOnly
                    tabIndex={-1}
                    className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Company Name">
                  <input
                    ref={companyNameInputRef}
                    value={companyName}
                    readOnly
                    tabIndex={-1}
                    className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="GST Number">
                  <input
                    ref={gstInputRef}
                    value={gstNumber}
                    readOnly
                    tabIndex={-1}
                    className="w-full border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="State Name">
                  <input
                    ref={stateNameInputRef}
                    data-workspace-primary-focus="true"
                    data-erp-form-field="true"
                    value={stateName}
                    onChange={(event) => setStateName(event.target.value)}
                    placeholder="State name"
                    className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white"
                  />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="PIN Code">
                  <input
                    ref={pinCodeInputRef}
                    data-erp-form-field="true"
                    value={pinCode}
                    onChange={(event) => setPinCode(normalizePinInput(event.target.value))}
                    placeholder="6 digit PIN"
                    inputMode="numeric"
                    className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white"
                  />
                </ErpDenseFormRow>

                <ErpDenseFormRow label="Full Address">
                  <textarea
                    ref={fullAddressInputRef}
                    data-erp-form-field="true"
                    value={fullAddress}
                    onChange={(event) => setFullAddress(event.target.value)}
                    placeholder="Full company address"
                    rows={4}
                    className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white"
                  />
                </ErpDenseFormRow>
              </div>

              <div className="grid gap-2 border-t border-slate-300 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Address edit rules:
                </p>
                <p>
                  This screen is SA-only. Company identity stays immutable here so address corrections do not change canonical business identity.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div
                data-erp-form-section="true"
                className="border border-slate-300 bg-white"
              >
                <div className="border-b border-slate-300 bg-[#eef4fb] px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                    Section 1
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">
                    Resolve GST identity
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Start with GST. The backend reads cache first, then calls Applyflow only when the cache misses.
                  </p>
                </div>

                <div className="bg-white px-4 py-3">
                  <ErpDenseFormRow label="GST Number" required>
                    <input
                      ref={gstInputRef}
                      data-erp-form-field="true"
                      data-workspace-primary-focus="true"
                      value={gstNumber}
                      onChange={(event) => {
                        setGstNumber(event.target.value.toUpperCase());
                        setGstProfile(null);
                        setError("");
                        setNotice("");
                        setCreatedCompany(null);
                        setStateName("");
                        setPinCode("");
                        setFullAddress("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleLookup();
                        }
                      }}
                      placeholder="29ABCDE1234F1Z5"
                      className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white"
                    />
                  </ErpDenseFormRow>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-slate-300 bg-slate-50 px-4 py-2">
                  <button
                    type="button"
                    disabled={lookingUp}
                    onClick={() => void handleLookup()}
                    className={`border px-2 py-[3px] text-[11px] font-semibold ${
                      lookingUp
                        ? "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400"
                        : "border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100"
                    }`}
                  >
                    {lookingUp ? "Checking GST..." : "Check GST Profile"}
                  </button>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Enter Check GST | Alt+PageDown Next Section
                  </span>
                </div>
              </div>

              <div
                data-erp-form-section="true"
                className="border border-slate-300 bg-white"
              >
                <div className="border-b border-slate-300 bg-[#eef4fb] px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                    Section 2
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">
                    Confirm the ERP company name
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    After GST resolution, adjust the canonical company name if needed and save with Ctrl+S.
                  </p>
                </div>

                <div className="bg-white px-4 py-3">
                  <ErpDenseFormRow label="Company Name" required>
                    <input
                      ref={companyNameInputRef}
                      data-erp-form-field="true"
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      placeholder="Company legal name"
                      className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white"
                    />
                  </ErpDenseFormRow>
                </div>

                <div className="grid gap-2 border-t border-slate-300 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Dense-form rules on this screen:
                  </p>
                  <p>
                    Enter and Shift+Enter move between primary inputs. The last primary field can trigger create confirmation, and Alt+PageDown or Alt+PageUp jumps sections.
                  </p>
                  <p>
                    Created company records store company code, legal name, GST number, state name, full address, PIN code, active status, and business company classification.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      bottomContent={bottomContent}
    />
  );
}
