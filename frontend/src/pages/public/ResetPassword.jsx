/*
 * File-ID: UI-7
 * File-Path: frontend/src/pages/public/ResetPassword.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP reset password screen
 * Authority: Frontend
 *
 * NOTE:
 * * Triggered from Supabase email recovery link
 * * Uses Supabase Auth updateUser
 * * No ERP backend/API required
 */

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import PublicAuthShell from "./PublicAuthShell.jsx";

function getPasswordStrength(password) {
  let score = 0;

  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return score;
}

function isValidPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const passwordStrength = getPasswordStrength(password);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;

      if (!session) {
        setTimeout(async () => {
          const { data } = await supabase.auth.getSession();
          if (!data?.session) {
            setError("Invalid or expired reset link");
          }
        }, 500);
      }
    }

    checkSession();
  }, []);

  async function handleReset(e) {
    if (e) e.preventDefault();
    if (loading) return;

    const { data } = await supabase.auth.getSession();
    const session = data?.session;

    if (!session) {
      setError("Session expired. Please request a new reset link.");
      return;
    }

    if (!password || !confirm) {
      setError("Please enter password");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (!isValidPassword(password)) {
      setError("8+ chars, 1 Capital, 1 Number, 1 Special required");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      setSuccess(true);

      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      setError(err?.message || "Unable to reset password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[460px]"
      logoWidthClass="w-[380px]"
      title="Reset your password"
      subtitle="Choose a strong password for your ERP account and confirm it once."
    >
      <form onSubmit={handleReset} className="space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="New password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className={`${inputClassName} pr-20`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500 transition hover:text-slate-700"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <div className="h-2 w-full rounded-full bg-slate-200">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  passwordStrength <= 1
                    ? "bg-red-500 w-1/4"
                    : passwordStrength === 2
                      ? "bg-yellow-500 w-2/4"
                      : passwordStrength === 3
                        ? "bg-blue-500 w-3/4"
                        : "bg-green-500 w-full"
                }`}
              />
            </div>

            <p className="mt-2 text-xs text-slate-600">
              {passwordStrength <= 1
                ? "Weak password"
                : passwordStrength === 2
                  ? "Medium strength"
                  : passwordStrength === 3
                    ? "Good password"
                    : "Strong password"}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className={`${inputClassName} pr-20`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500 transition hover:text-slate-700"
            >
              {showConfirm ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-700">
            Password reset successful. Redirecting to login...
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || success}
          className={primaryButtonClassName}
        >
          {loading ? "Resetting..." : "Reset Password"}
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
