/*
 * File-ID: UI-4
 * File-Path: frontend/src/pages/public/EmailVerified.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: Handle email verification confirmation
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import PublicAuthShell from "./PublicAuthShell.jsx";

export default function EmailVerified() {
  const navigate = useNavigate();

  const [status, setStatus] = useState("checking");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkVerification() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;

        if (!session) {
          setStatus("not_verified");
          return;
        }

        setStatus("verified");
      } catch (err) {
        setStatus("error");
        setError(err.message);
      }
    }

    checkVerification();
  }, []);

  async function handleContinue() {
    if (loading) return;
    setLoading(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;

      if (!token) {
        setError("Session expired. Please try again.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/signup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Signup API failed");
      }

      navigate("/signup-submitted");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Signup request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[460px]"
      logoWidthClass="w-[380px]"
      title={
        status === "verified"
          ? "Email Verified Successfully"
          : status === "not_verified"
            ? "Email Not Verified"
            : status === "error"
              ? "Verification Error"
              : "Checking verification status"
      }
      subtitle={
        status === "verified"
          ? "Your email has been verified. Continue to submit your ERP signup request."
          : status === "not_verified"
            ? "Please verify your email before continuing."
            : status === "error"
              ? error
              : "Please wait while we validate your verification session."
      }
    >
      <div className="flex justify-center">
        {status === "checking" ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
            Checking verification status...
          </div>
        ) : null}

        {status === "verified" ? (
          <button
            onClick={handleContinue}
            disabled={loading}
            className={primaryButtonClassName}
          >
            {loading ? "Submitting..." : "Continue"}
          </button>
        ) : null}

        {status === "not_verified" ? (
          <button
            onClick={() => navigate("/signup")}
            className={secondaryButtonClassName}
          >
            Back to Signup
          </button>
        ) : null}

        {status === "error" ? (
          <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-center text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </PublicAuthShell>
  );
}

const primaryButtonClassName =
  "rounded-2xl bg-[#1E3A8A] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(30,58,138,0.22)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClassName =
  "rounded-2xl bg-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300";
