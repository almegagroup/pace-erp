/*
 * File-ID: 9.2-FRONT
 * File-Path: frontend/src/admin/sa/screens/SACompanyCreate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin company creation surface with GST-backed autofill
 * Authority: Frontend
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";

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
    },
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !json?.data?.gst_profile) {
    const error = new Error("GST_PROFILE_LOOKUP_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.data.gst_profile;
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
    const error = new Error("COMPANY_CREATE_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.data.company;
}

function SummaryCard({ label, value, caption }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <h3 className="mt-3 text-2xl font-semibold text-slate-900">{value}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
    </article>
  );
}

function FieldCard({ label, value, caption, multiline = false }) {
  const content = value || "Not available yet";

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      {multiline ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-900">{content}</p>
      ) : (
        <p className="mt-3 text-base font-semibold text-slate-900">{content}</p>
      )}
      <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
    </article>
  );
}

export default function SACompanyCreate() {
  const navigate = useNavigate();
  const [gstNumber, setGstNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [gstProfile, setGstProfile] = useState(null);
  const [createdCompany, setCreatedCompany] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const normalizedGst = gstNumber.trim().toUpperCase();

  async function handleLookup() {
    if (!normalizedGst) {
      setError("Enter a GST number before lookup.");
      return;
    }

    setLookingUp(true);
    setError("");
    setCreatedCompany(null);

    try {
      const profile = await lookupGstProfile(normalizedGst);
      setGstProfile(profile);
      setCompanyName(profile.legal_name ?? "");
    } catch (error) {
      setGstProfile(null);
      setError(
        error?.status >= 500
          ? "GST service is unavailable right now. Check Applyflow/backend configuration."
          : "Unable to resolve GST right now. Check the GST number or backend integration.",
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

    try {
      const company = await createCompany({
        company_name: trimmedCompanyName || undefined,
        gst_number: normalizedGst || undefined,
      });

      setCreatedCompany(company);
      setCompanyName(company.company_name ?? trimmedCompanyName);
    } catch {
      setError("Company creation was not finalized by the backend.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Company Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Create Business Company
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Enter a GST number, resolve the GST profile from cache or Applyflow,
                and review the legal name, state, address, and PIN code before
                creating the business company master record.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  openScreen("SA_CONTROL_PANEL", { mode: "replace" });
                  navigate("/sa/control-panel");
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Control Panel
              </button>
              <button
                type="button"
                onClick={() => {
                  openScreen("SA_HOME", { mode: "reset" });
                  navigate("/sa/home");
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                SA Home
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold shadow-[0_10px_24px_rgba(14,116,144,0.08)] ${
                  creating
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "border border-sky-200 bg-sky-50 text-sky-700"
                }`}
              >
                {creating ? "Creating..." : "Create Company"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="GST Source"
            value={gstProfile?.source ?? "Pending"}
            caption="GST lookup checks cache first. A miss falls through to Applyflow."
          />
          <SummaryCard
            label="Resolved State"
            value={gstProfile?.state_name ?? "Pending"}
            caption="Geographic company state derived from the GST profile."
          />
          <SummaryCard
            label="PIN Code"
            value={gstProfile?.pin_code ?? "Pending"}
            caption="Postal code captured separately for the company master."
          />
          <SummaryCard
            label="Created Company"
            value={createdCompany?.company_code ?? "Not Created"}
            caption={createdCompany?.company_name ?? "The company code appears here after a successful create."}
          />
        </div>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
          <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Input
            </p>
            <h2 className="mt-3 text-xl font-semibold text-slate-900">
              GST-driven company setup
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Provide GST first. The backend will read cache, call Applyflow only
              when the cache misses, and fill the company profile preview.
            </p>

            <label className="mt-5 block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                GST Number
              </span>
              <input
                value={gstNumber}
                onChange={(event) => {
                  setGstNumber(event.target.value.toUpperCase());
                  setGstProfile(null);
                  setError("");
                  setCreatedCompany(null);
                }}
                placeholder="29ABCDE1234F1Z5"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-sky-300 focus:bg-white"
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
            </div>

            <label className="mt-5 block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Company Name
              </span>
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Company legal name"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-sky-300 focus:bg-white"
              />
            </label>

            <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-5 text-sm leading-7 text-slate-600">
              Created company records will now store:
              company code, legal name, GST number, state name, full address,
              pin code, active status, and business company classification.
            </div>
          </article>

          <div className="grid gap-6">
            <FieldCard
              label="Legal Name"
              value={gstProfile?.legal_name ?? companyName}
              caption="GST legal name is preferred and also becomes the default company name."
            />
            <FieldCard
              label="Trade Name"
              value={gstProfile?.trade_name}
              caption="Visible for review, but company master still uses the legal name as the canonical title."
            />
            <FieldCard
              label="Company State"
              value={gstProfile?.state_name}
              caption="Derived from the GST address payload and stored as a dedicated company field."
            />
            <FieldCard
              label="PIN Code"
              value={gstProfile?.pin_code}
              caption="Captured separately so postal filters and reporting can use a clean field."
            />
            <FieldCard
              label="Full Address"
              value={gstProfile?.full_address}
              caption="Stored as a single human-readable address field on company master."
              multiline
            />
          </div>
        </section>

        {createdCompany ? (
          <section className="mt-6 rounded-[30px] border border-emerald-200 bg-emerald-50 p-6 shadow-[0_14px_40px_rgba(16,185,129,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
              Created
            </p>
            <h2 className="mt-3 text-xl font-semibold text-slate-900">
              Company master row created successfully
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FieldCard
                label="Company Code"
                value={createdCompany.company_code}
                caption="Auto-generated canonical company code."
              />
              <FieldCard
                label="Company Name"
                value={createdCompany.company_name}
                caption="Canonical legal company name saved in ERP master."
              />
              <FieldCard
                label="State"
                value={createdCompany.state_name}
                caption="Saved from GST-derived company state."
              />
              <FieldCard
                label="PIN Code"
                value={createdCompany.pin_code}
                caption="Saved as a dedicated postal field."
              />
            </div>
            <div className="mt-4">
              <FieldCard
                label="Saved Address"
                value={createdCompany.full_address}
                caption="The single-field address stored on company master."
                multiline
              />
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
