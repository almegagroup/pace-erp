/*
 * File-ID: UI-AUTH-CALLBACK
 * File-Path: frontend/src/pages/public/AuthCallback.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: Unified public auth callback gateway
 * Authority: Frontend
 *
 * RULE:
 * All external auth-originated links MUST land here first.
 * This page restores Supabase session, resolves auth flow,
 * then redirects to the correct internal public page.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import PublicAuthShell from "./PublicAuthShell.jsx";

export default function AuthCallback() {
  const navigate = useNavigate();

  const [status, setStatus] = useState("processing");
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const url = new URL(globalThis.location.href);
        const code = url.searchParams.get("code");
        const hash = globalThis.location.hash;

        let flow = url.searchParams.get("type");

        if (!flow && hash) {
          const params = new URLSearchParams(hash.substring(1));
          flow = params.get("type") || null;
        }

        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(window.location.href);

          if (exchangeError) throw exchangeError;
        } else if (hash) {
          const params = new URLSearchParams(hash.substring(1));

          if (params.get("error")) {
            const errMsg = params.get("error_description") || "Auth error";
            throw new Error(errMsg);
          }

          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");

          if (access_token && refresh_token) {
            const { data, error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });

            if (error) throw error;

            if (!data?.session) {
              throw new Error("Session not established from tokens");
            }
          }
        }

        if (cancelled) return;

        const { data } = await supabase.auth.getSession();
        const session = data?.session;

        if (!session) {
          throw new Error("Session establishment failed");
        }

        if (cancelled) return;

        const urlStr = globalThis.location.href;

        if (flow === "signup") {
          navigate("/email-verified", { replace: true });
          return;
        }

        if (flow === "recovery" || urlStr.includes("recovery")) {
          navigate("/reset-password", { replace: true });
          return;
        }

        navigate("/login", { replace: true });
      } catch (err) {
        if (cancelled) return;

        setStatus("error");
        setError(err?.message || "Authentication failed");
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[460px]"
      logoWidthClass="w-[380px]"
      title={status === "error" ? "Authentication Failed" : "Securing your session"}
      subtitle={
        status === "error"
          ? error
          : "Please wait while we restore your verification or recovery session."
      }
    >
      {status !== "error" ? (
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
            <span className="h-4 w-4 rounded-full border-2 border-[#1E3A8A] border-t-transparent animate-spin" />
            Please wait...
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-center text-sm text-rose-700 break-words">
          {error}
        </div>
      )}
    </PublicAuthShell>
  );
}
