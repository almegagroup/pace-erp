/*
 * File-ID: UI-1
 * File-Path: frontend/src/pages/public/LandingPage.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP public landing screen before authentication
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import logo from "../../assets/pace-bgr.png";
import boot from "../../assets/sp.png";

export default function LandingPage() {
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBooting(false);
    }, 1800);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,_#f5f6f8_0%,_#edf2f7_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12%] top-[-10%] h-72 w-72 rounded-full bg-sky-100/80 blur-3xl" />
        <div className="absolute right-[-10%] top-[8%] h-96 w-96 rounded-full bg-blue-100/70 blur-3xl" />
        <div className="absolute bottom-[-16%] left-[18%] h-80 w-80 rounded-full bg-slate-200/60 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.62)_0%,rgba(255,255,255,0)_40%,rgba(255,255,255,0.45)_100%)]" />
      </div>

      {booting ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F5F6F8] px-4">
          <div className="w-full max-w-[600px] mb-8">
            <img
              src={boot}
              alt="PACE ERP Boot"
              className="w-full h-auto"
              loading="eager"
            />
          </div>

          <div className="h-[4px] w-full max-w-[420px] overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-0 animate-loader bg-[#1E3A8A]" />
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-[980px] rounded-[36px] border border-white/70 bg-white/78 px-6 py-10 shadow-[0_30px_100px_rgba(15,23,42,0.10)] backdrop-blur md:px-10 md:py-12">
            <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="text-center lg:text-left">
                <div className="mx-auto w-full max-w-[600px] lg:mx-0">
                  <img
                    src={logo}
                    alt="PACE ERP"
                    className="w-full h-auto"
                    loading="eager"
                  />
                </div>

                <p className="mt-4 text-[20px] tracking-[0.08em] text-slate-600 md:text-[22px]">
                  Process Automation &amp; Control Environment
                </p>

                <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center lg:justify-start">
                  <Link to="/login">
                    <button className={primaryButtonClassName}>Login</button>
                  </Link>

                  <Link to="/signup">
                    <button className={secondaryButtonClassName}>Sign Up</button>
                  </Link>
                </div>
              </div>

              <div className="rounded-[30px] border border-slate-200/80 bg-slate-50/85 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  User Guide
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                  Choose the right entry path before you continue
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Use the action below that matches your current need. This
                  keeps login, onboarding, and password recovery easy to
                  understand before you enter the ERP workspace.
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  <div className={featureCardClassName}>
                    <p className={featureLabelClassName}>Login</p>
                    <p className={featureTextClassName}>
                      Existing approved users should use the Login button to
                      sign in.
                    </p>
                  </div>
                  <div className={featureCardClassName}>
                    <p className={featureLabelClassName}>Sign Up</p>
                    <p className={featureTextClassName}>
                      New users should choose Sign Up to submit an ERP access
                      request.
                    </p>
                  </div>
                  <div className={featureCardClassName}>
                    <p className={featureLabelClassName}>Password Help</p>
                    <p className={featureTextClassName}>
                      If you forgot your password, open Login first and then use
                      Forgot Password.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-sm text-slate-500">
            (c) Almega Group
          </div>
        </div>
      )}
    </div>
  );
}

const primaryButtonClassName =
  "min-w-[160px] rounded-2xl bg-[#1E3A8A] px-8 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(30,58,138,0.22)] transition hover:opacity-90";

const secondaryButtonClassName =
  "min-w-[160px] rounded-2xl border border-slate-200 bg-white px-8 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:bg-slate-50";

const featureCardClassName =
  "rounded-2xl border border-slate-200 bg-white px-4 py-4";

const featureLabelClassName =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500";

const featureTextClassName =
  "mt-2 text-sm leading-6 text-slate-700";
