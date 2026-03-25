/*
 * File-ID: UI-3
 * File-Path: frontend/src/pages/public/SignupScreen.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP signup screen (Supabase identity creation)
 * Authority: Frontend
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import PublicAuthShell from "./PublicAuthShell.jsx";

export default function SignupScreen() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [designation, setDesignation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordStrength = getPasswordStrength(password);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);

  const widgetIdRef = useRef(null);

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function isValidPhone(value) {
    return /^[0-9]{10}$/.test(value);
  }

  function getPasswordStrength(value) {
    let score = 0;

    if (value.length >= 8) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;

    return score;
  }

  function isValidPassword(value) {
    return (
      value.length >= 8 &&
      /[A-Z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^A-Za-z0-9]/.test(value)
    );
  }

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;

    function renderCaptcha() {
      if (cancelled) return;

      if (!globalThis.turnstile) {
        if (retryCount < 10) {
          retryCount++;
          setTimeout(renderCaptcha, 500);
        }
        return;
      }

      const container = document.getElementById("signup-turnstile");
      if (!container) return;

      if (!container.hasChildNodes()) {
        widgetIdRef.current = globalThis.turnstile.render(container, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
          callback: (token) => {
            setCaptchaToken(token);
          },
          "expired-callback": () => {
            setCaptchaToken(null);
          },
        });
      }
    }

    renderCaptcha();

    return () => {
      cancelled = true;

      if (widgetIdRef.current && globalThis.turnstile) {
        globalThis.turnstile.remove(widgetIdRef.current);
      }
    };
  }, []);

  function validateFields() {
    const errors = {};

    if (!name) errors.name = "Name is required";
    if (!company) errors.company = "Company is required";

    if (!email) {
      errors.email = "Email is required";
    } else if (!isValidEmail(email)) {
      errors.email = "Invalid email format";
    }

    if (!phone) {
      errors.phone = "Phone is required";
    } else if (!isValidPhone(phone)) {
      errors.phone = "Phone must be 10 digits";
    }

    if (!password) {
      errors.password = "Password is required";
    } else if (!isValidPassword(password)) {
      errors.password = "8+ chars, 1 Capital, 1 Number, 1 Special required";
    }

    return errors;
  }

  async function handleSignup(e) {
    if (e) e.preventDefault();
    if (loading) return;

    const lastSignup = localStorage.getItem("signup_attempt");

    if (lastSignup) {
      const diff = Date.now() - Number(lastSignup);

      if (diff < 10000) {
        setError("Please wait before trying again");
        return;
      }
    }

    localStorage.setItem("signup_attempt", Date.now());
    setError(null);

    const errors = validateFields();
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    if (!name || !company) {
      setError("Name and Company are required");
      return;
    }

    if (!email || !password || !phone) {
      setError("Email, Phone and Password are required");
      return;
    }

    if (!isValidEmail(email)) {
      setError("Invalid email format");
      return;
    }

    if (!isValidPhone(phone)) {
      setError("Phone must be 10 digits");
      return;
    }

    if (!isValidPassword(password)) {
      setError(
        "Password must be 8+ chars with 1 Capital, 1 Number, 1 Special Character"
      );
      return;
    }

    if (!captchaToken) {
      setError("Please complete captcha");
      return;
    }

    if (captchaToken.length < 10) {
      setError("Invalid captcha");
      return;
    }

    setLoading(true);

    try {
      const redirectUrl = import.meta.env.VITE_APP_URL;

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            parent_company: company,
            designation_hint: designation,
            phone,
          },
          emailRedirectTo: `${redirectUrl}/auth/callback`,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      setSuccess(true);
      setCaptchaToken(null);

      if (globalThis.turnstile && widgetIdRef.current) {
        try {
          globalThis.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        } catch (e) {
          console.error(e);
        }
      }
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[520px]"
      logoWidthClass="w-[380px]"
      title={success ? "Verification Email Sent" : "Create your ERP account"}
      subtitle={
        success
          ? "Please check your email and click the verification link to continue your ERP signup."
          : "Create your ERP account with the details below. All onboarding logic remains unchanged."
      }
    >
      {success ? (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
            Verification Email Sent
          </div>

          <div className="flex flex-col items-center gap-3 text-sm">
            <Link to="/login" className={linkClassName}>
              Already verified? Go to Login
            </Link>

            <button
              onClick={() => navigate("/")}
              className="font-medium text-slate-600 transition hover:text-blue-700 hover:underline"
            >
              Back to Landing Page
            </button>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Full Name"
                value={name}
                onChange={setName}
                placeholder="Full Name"
                error={fieldErrors.name}
              />
              <Field
                label="Parent Company"
                value={company}
                onChange={setCompany}
                placeholder="Parent Company"
                error={fieldErrors.company}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Designation"
                value={designation}
                onChange={setDesignation}
                placeholder="Designation (optional)"
              />
              <Field
                label="Phone Number"
                value={phone}
                onChange={setPhone}
                placeholder="Phone Number"
                error={fieldErrors.phone}
              />
            </div>

            <Field
              label="Email"
              value={email}
              onChange={setEmail}
              placeholder="Email"
              type="email"
              error={fieldErrors.email}
            />

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

              {fieldErrors.password ? (
                <p className="text-xs text-rose-600">{fieldErrors.password}</p>
              ) : null}

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

            <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4">
              <div className="flex justify-center">
                <div id="signup-turnstile" />
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
                  Creating account...
                </span>
              ) : (
                "Create Account"
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Cancel
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className={linkClassName}>
              Login
            </Link>
          </div>
        </>
      )}
    </PublicAuthShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  type = "text",
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClassName} ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100" : ""}`}
      />
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100";

const primaryButtonClassName =
  "w-full rounded-2xl bg-[#1E3A8A] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(30,58,138,0.22)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

const linkClassName =
  "font-medium text-blue-700 transition hover:text-blue-800 hover:underline";
