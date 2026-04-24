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

export default function SACompanyCreate() {
  const navigate = useNavigate();
  const actionBarRefs = useRef([]);
  const formContainerRef = useRef(null);
  const gstInputRef = useRef(null);
  const companyNameInputRef = useRef(null);
  const [gstNumber, setGstNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [, setGstProfile] = useState(null);
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
        {hasExistingCompany ? "Existing Company" : "Created"}
      </div>
      <div className="text-sm font-semibold text-slate-900">
        {hasExistingCompany
          ? "Company master row already exists for this GST"
          : "Company master row created successfully"}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Company Code", createdCompany.company_code, "Auto-generated canonical company code."],
          ["Company Name", createdCompany.company_name, "Canonical legal company name saved in ERP master."],
          ["State", createdCompany.state_name, "Saved from GST-derived company state."],
          ["PIN Code", createdCompany.pin_code, "Saved as a dedicated postal field."],
        ].map(([label, value, caption]) => (
          <div key={label} className="border border-emerald-300 bg-emerald-50 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">{label}</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
            <div className="mt-1 text-xs text-slate-600">{caption}</div>
          </div>
        ))}
      </div>
      <div className="border border-emerald-300 bg-emerald-50 px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">Saved Address</div>
        <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-900">{createdCompany.full_address}</div>
        <div className="mt-1 text-xs text-slate-600">The single-field address stored on company master.</div>
      </div>
    </section>
  ) : null;

  return (
    <ErpEntryFormTemplate
      eyebrow="SA Company Governance"
      title="Create Business Company"
      actions={topActions}
      notices={notices}
      footerHints={["Tab Next Field", "Ctrl+S Save", "Enter Check GST", "Esc Cancel", "Ctrl+K Command Bar"]}
      formEyebrow="Entry Form"
      formTitle="GST-driven company setup"
      formContent={(
        <div ref={formContainerRef} className="grid gap-3">
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
                className={`border px-3 py-2 text-sm font-semibold ${
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
        </div>
      )}
      bottomContent={bottomContent}
    />
  );
}
