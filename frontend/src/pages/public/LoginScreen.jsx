/*
* File-ID: UI-2
* File-Path: frontend/src/pages/public/LoginScreen.jsx
* Gate: UI
* Phase: Public
* Domain: FRONT
* Purpose: ERP authentication screen
* Authority: Frontend
*
* NOTE:
* Login API wired
* Session verification via /api/me
* Universe resolution via /api/me/menu
* Redirect SSOT compliant
*/

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import PublicAuthShell from "./PublicAuthShell.jsx";

export default function LoginScreen() {
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(e) {
    if (e) e.preventDefault();
    if (loading) return;

    if (!identifier || !password) {
      setError("Please enter identifier and password");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
        }),
      });

      const loginData = await res.json();

      if (!res.ok || !loginData?.ok) {
        throw new Error("INVALID_LOGIN");
      }

      navigate("/app");
    } catch (err) {
      let message = "Login failed";
      const code = err?.message || "UNKNOWN";

      if (code === "INVALID_LOGIN") {
        message = "Invalid UserID or password";
      }

      setError(`${message} (${code})`);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      handleLogin();
    }
  }

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[980px]"
      logoWidthClass="w-[380px]"
      showTagline
      subtitle="Sign in to continue into your ERP workspace."
      align="left"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[28px] border border-slate-200 bg-white/80 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Email or User ID
              </label>
              <input
                type="text"
                placeholder="erp@company.com / P000X"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                className={inputClassName}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
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
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className={primaryButtonClassName}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Logging in...
                </span>
              ) : (
                "Login"
              )}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-4 text-sm text-slate-600">
            <Link to="/forgot-password" className={linkClassName}>
              Forgot Password?
            </Link>
            <Link to="/signup" className={linkClassName}>
              Create Account
            </Link>
          </div>
        </div>

        <aside className="rounded-[28px] border border-slate-200 bg-slate-50/85 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
            User Guide
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            Choose the action that matches your need
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Use Login if your account is already approved. Use Forgot Password if
            you cannot access your current password. Use Create Account if you
            are a new user and need ERP access.
          </p>

          <div className="mt-8 space-y-3">
            <div className={instructionCardClassName}>
              <p className={instructionLabelClassName}>Login</p>
              <p className={instructionTextClassName}>
                Signs in existing approved ERP users with their User ID or email
                and password.
              </p>
            </div>

            <div className={instructionCardClassName}>
              <p className={instructionLabelClassName}>Forgot Password</p>
              <p className={instructionTextClassName}>
                Sends a recovery link to your email so you can reset your
                password safely.
              </p>
            </div>

            <div className={instructionCardClassName}>
              <p className={instructionLabelClassName}>Create Account</p>
              <p className={instructionTextClassName}>
                Starts the signup flow for new users who need to submit an ERP
                access request.
              </p>
            </div>
          </div>
        </aside>
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

const instructionCardClassName =
  "rounded-2xl border border-slate-200 bg-white px-4 py-4";

const instructionLabelClassName =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500";

const instructionTextClassName =
  "mt-2 text-sm leading-6 text-slate-700";
