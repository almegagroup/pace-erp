/*
 * File-ID: 9.2-FRONT
 * File-Path: frontend/src/admin/sa/screens/SACompanyCreate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin company creation surface with GST-backed autofill
 * Authority: Frontend
 */

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpDenseFormNavigation } from "../../../hooks/useErpDenseFormNavigation.js";
import ErpEntryFormTemplate from "../../../components/templates/ErpEntryFormTemplate.jsx";
import {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";

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

export default function SACompanyCreate() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const gstInputRef = useRef(null);
  const companyNameInputRef = useRef(null);
  const [gstNumber, setGstNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [gstProfile, setGstProfile] = useState(null);
  const [createdCompany, setCreatedCompany] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const normalizedGst = gstNumber.trim().toUpperCase();
  const hasExistingCompany =
    Boolean(createdCompany?.company_code) &&
    (!normalizedGst || createdCompany?.gst_number === normalizedGst);

  useErpDenseFormNavigation(formContainerRef, {
    submitOnFinalField: true,
    onSubmit: () => handleCreate(),
  });

  useErpScreenHotkeys({
    save: {
      disabled: creating || hasExistingCompany,
      perform: () => void handleCreate(),
    },
    focusSearch: {
      perform: () => gstInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => gstInputRef.current?.focus(),
    },
  });

  useErpScreenCommands([
    {
      id: "sa-company-control-panel",
      group: "Current Screen",
      label: "Go to SA control panel",
      keywords: ["control panel", "sa admin"],
      perform: handleOpenControlPanel,
      order: 10,
    },
    {
      id: "sa-company-home",
      group: "Current Screen",
      label: "Go to SA home",
      keywords: ["sa home", "dashboard"],
      perform: handleOpenHome,
      order: 20,
    },
    {
      id: "sa-company-focus-gst",
      group: "Current Screen",
      label: "Focus GST number",
      keywords: ["gst", "tax", "input"],
      perform: () => gstInputRef.current?.focus(),
      order: 30,
    },
    {
      id: "sa-company-lookup-gst",
      group: "Current Screen",
      label: lookingUp ? "Checking GST profile..." : "Check GST profile",
      hint: "Enter",
      keywords: ["lookup", "gst profile", "applyflow"],
      disabled: lookingUp,
      perform: () => void handleLookup(),
      order: 40,
    },
    {
      id: "sa-company-focus-name",
      group: "Current Screen",
      label: "Focus company name",
      keywords: ["company name", "legal name"],
      perform: () => companyNameInputRef.current?.focus(),
      order: 50,
    },
    {
      id: "sa-company-create",
      group: "Current Screen",
      label: creating
        ? "Creating company..."
        : hasExistingCompany
          ? "Company already created"
          : "Create company",
      hint: "Ctrl+S",
      keywords: ["create company", "save company", "master"],
      disabled: creating || hasExistingCompany,
      perform: () => void handleCreate(),
      order: 60,
    },
  ]);

  function handleOpenControlPanel() {
    openScreen("SA_CONTROL_PANEL", { mode: "replace" });
    navigate("/sa/control-panel");
  }

  function handleOpenHome() {
    openScreen("SA_HOME", { mode: "reset" });
    navigate("/sa/home");
  }

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

    const approved = await openActionConfirm({
      eyebrow: "SA Company Governance",
      title: "Create ERP Company",
      message: `Create company ${trimmedCompanyName || gstProfile?.legal_name || normalizedGst} now?`,
      confirmLabel: "Create Company",
      cancelLabel: "Cancel",
    });

    if (!approved) {
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

  const topActions = [
    {
      key: "control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: handleOpenControlPanel,
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "sa-home",
      label: "SA Home",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: handleOpenHome,
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "create-company",
      label: creating
        ? "Creating..."
        : hasExistingCompany
          ? "Already Created"
          : "Create Company",
      hint: "Ctrl+S",
      tone: "primary",
      disabled: creating || hasExistingCompany,
      buttonRef: (element) => {
        actionBarRefs.current[2] = element;
      },
      onClick: () => void handleCreate(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 2,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const metrics = [
    {
      key: "gst-source",
      label: "GST Source",
      value: gstProfile?.source ?? "Pending",
      caption: "GST lookup checks cache first. A miss falls through to Applyflow.",
      tone: "sky",
    },
    {
      key: "resolved-state",
      label: "Resolved State",
      value: gstProfile?.state_name ?? "Pending",
      caption: "Geographic company state derived from the GST profile.",
      tone: "amber",
    },
    {
      key: "pin-code",
      label: "PIN Code",
      value: gstProfile?.pin_code ?? "Pending",
      caption: "Postal code captured separately for the company master.",
      tone: "slate",
    },
    {
      key: "created-company",
      label: "Created Company",
      value: createdCompany?.company_code ?? "Not Created",
      caption: createdCompany
        ? `${createdCompany.company_name}${createdCompany.state_name ? ` | ${createdCompany.state_name}` : ""}`
        : "The company code appears here after a successful create.",
      tone: createdCompany ? "emerald" : "sky",
      badge: createdCompany ? "Ready" : "Pending",
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

  const sideContent = (
    <>
      <ErpFieldPreview
        label="Legal Name"
        value={gstProfile?.legal_name ?? companyName}
        caption="GST legal name is preferred and also becomes the default company name."
      />
      <ErpFieldPreview
        label="Trade Name"
        value={gstProfile?.trade_name}
        caption="Visible for review, but company master still uses the legal name as the canonical title."
      />
      <ErpFieldPreview
        label="Company State"
        value={gstProfile?.state_name}
        caption="Derived from the GST address payload and stored as a dedicated company field."
      />
      <ErpFieldPreview
        label="PIN Code"
        value={gstProfile?.pin_code}
        caption="Captured separately so postal filters and reporting can use a clean field."
      />
      <ErpFieldPreview
        label="Full Address"
        value={gstProfile?.full_address}
        caption="Stored as a single human-readable address field on company master."
        multiline
      />
    </>
  );

  const bottomContent = createdCompany ? (
    <ErpSectionCard
      eyebrow={hasExistingCompany ? "Existing Company" : "Created"}
      title={
        hasExistingCompany
          ? "Company master row already exists for this GST"
          : "Company master row created successfully"
      }
      className="border-emerald-200 bg-emerald-50 shadow-[0_14px_40px_rgba(16,185,129,0.08)]"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ErpFieldPreview
          label="Company Code"
          value={createdCompany.company_code}
          caption="Auto-generated canonical company code."
          tone="success"
        />
        <ErpFieldPreview
          label="Company Name"
          value={createdCompany.company_name}
          caption="Canonical legal company name saved in ERP master."
          tone="success"
        />
        <ErpFieldPreview
          label="State"
          value={createdCompany.state_name}
          caption="Saved from GST-derived company state."
          tone="success"
        />
        <ErpFieldPreview
          label="PIN Code"
          value={createdCompany.pin_code}
          caption="Saved as a dedicated postal field."
          tone="success"
        />
      </div>
      <div className="mt-4">
        <ErpFieldPreview
          label="Saved Address"
          value={createdCompany.full_address}
          caption="The single-field address stored on company master."
          multiline
          tone="success"
        />
      </div>
    </ErpSectionCard>
  ) : null;

  return (
    <ErpEntryFormTemplate
      eyebrow="SA Company Governance"
      title="Create Business Company"
      description="This keyboard-native entry form keeps GST lookup, company identity review, and final create action in one deterministic flow."
      actions={topActions}
      notices={notices}
      metrics={metrics}
      formEyebrow="Entry Form"
      formTitle="GST-driven company setup"
      formDescription="Enter moves between primary fields, the final field can trigger the create confirmation, Shift+Enter moves back, and Alt+PageDown or Alt+PageUp jumps across sections without needing the mouse."
      formContent={(
        <div ref={formContainerRef} className="grid gap-5">
          <div
            data-erp-form-section="true"
            className="rounded-[26px] border border-slate-200 bg-slate-50/80 px-5 py-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Section 1
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              Resolve GST identity
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Start with GST. The backend reads cache first, calls Applyflow only
              when the cache misses, and hydrates the right-hand review rail.
            </p>

            <label className="mt-5 block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                GST Number
              </span>
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
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleLookup();
                  }
                }}
                placeholder="29ABCDE1234F1Z5"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={lookingUp}
                onClick={() => void handleLookup()}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                  lookingUp
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {lookingUp ? "Checking GST..." : "Check GST Profile"}
              </button>
              <span className="self-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Enter = Check GST | Alt+PageDown = Next Section
              </span>
            </div>
          </div>

          <div
            data-erp-form-section="true"
            className="rounded-[26px] border border-slate-200 bg-slate-50/80 px-5 py-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Section 2
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              Confirm the ERP company name
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              After GST resolution, adjust the canonical company name if needed.
              Use Ctrl+S to create once the review rail looks correct.
            </p>

            <label className="mt-5 block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Company Name
              </span>
              <input
                ref={companyNameInputRef}
                data-erp-form-field="true"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Company legal name"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
              />
            </label>

            <div className="mt-5 grid gap-3 rounded-3xl border border-dashed border-slate-200 bg-white px-5 py-5 text-sm leading-7 text-slate-600">
              <p>
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
        </div>
      )}
      sideContent={sideContent}
      bottomContent={bottomContent}
    />
  );
}
