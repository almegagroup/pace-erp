/*
 * File-ID: UI-6
 * File-Path: frontend/src/pages/public/ForgotPassword.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP forgot password screen
 * Authority: Frontend
 *
 * NOTE:
 * * Uses Supabase Auth password reset flow
 * * No ERP backend/API required
 * * No ERP DB interaction required
 * * Prevents email enumeration
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import PublicAuthShell from "./PublicAuthShell.jsx";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (loading) return;

    if (!email) {
      setError("Please enter your email address");
      return;
    }

    if (!isValidEmail(email)) {
      setError("Invalid email format");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const redirectUrl = import.meta.env.VITE_APP_URL;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${redirectUrl}/auth/callback`,
      });

      if (error) throw error;

      setSuccess(true);
    } catch {
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[440px]"
      logoWidthClass="w-[380px]"
      title="Forgot your password?"
      subtitle="Enter your email address and we will send you a recovery link."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className={inputClassName}
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-700">
            If an account exists for this email, a reset link has been sent.
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className={primaryButtonClassName}
        >
          {loading ? "Sending..." : "Send Reset Link"}
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between gap-4 text-sm text-slate-600">
        <Link to="/login" className={linkClassName}>
          Back to Login
        </Link>
        <Link to="/signup-instructions" className={linkClassName}>
          Create Account
        </Link>
      </div>
    </PublicAuthShell>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60";

const primaryButtonClassName =
  "w-full rounded-2xl bg-[#1E3A8A] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(30,58,138,0.22)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

const linkClassName =
  "font-medium text-slate-600 transition hover:text-blue-700 hover:underline";
