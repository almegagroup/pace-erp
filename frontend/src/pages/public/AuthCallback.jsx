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
import logo from "../../assets/pace-bgr.png";

export default function AuthCallback() {

  const navigate = useNavigate();

  const [status,setStatus] = useState("processing");
  const [error,setError] = useState(null);

  useEffect(()=>{

    let cancelled = false;

    async function run(){

      try{

        const url = new URL(globalThis.location.href);

const code = url.searchParams.get("code");
const flow = url.searchParams.get("flow"); // ✅ ADD THIS
const hash = globalThis.location.hash;

/* ==============================
STEP 1 — EXCHANGE / RESTORE SESSION
============================== */

// 🔴 CASE 1: PKCE flow (?code=...)
if(code){
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(window.location.href);

  if(exchangeError){
    throw exchangeError;
  }
}

// 🔴 CASE 2: HASH FLOW (#access_token...)
else if(hash && hash.includes("access_token")){

  const params = new URLSearchParams(hash.substring(1));

  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if(!access_token || !refresh_token){
    throw new Error("Invalid auth tokens in URL");
  }

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token
  });

  if(error){
    throw error;
  }

  if(!data?.session){
    throw new Error("Session not established from tokens");
  }
}

// 🔴 CASE 3: ERROR FROM SUPABASE
else if(hash && hash.includes("error")){
  const params = new URLSearchParams(hash.substring(1));
  const errMsg = params.get("error_description") || "Auth error";

  throw new Error(errMsg);
}

if(cancelled) return;

        /* ==============================
        STEP 2 — VALIDATE SESSION (STRICT)
        ============================== */

        const { data } = await supabase.auth.getSession();

        const session = data?.session;

        if(!session){
          throw new Error("Session establishment failed");
        }

        if(cancelled) return;

        /* ==============================
        STEP 3 — FLOW ROUTING
        ============================== */

        if(flow === "recovery"){
          navigate("/reset-password",{ replace:true });
          return;
        }

        // default → email verify
        setTimeout(() => {
        navigate("/email-verified",{ replace:true });
        }, 200);

      }catch(err){

        if(cancelled) return;

        setStatus("error");
        setError(err?.message || "Authentication failed");

      }

    }

    run();

    return ()=>{ cancelled = true };

  },[navigate]);

  return(

    <div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">

      <div className="w-[420px] bg-white rounded-xl shadow-md p-8 text-center">

        <div className="flex flex-col items-center">
          <div className="w-[360px] mb-4">
            <img src={logo} className="w-full h-auto" />
          </div>
        </div>

        {status === "processing" && (
          <>
            <h2 className="text-[#1E3A8A] text-xl font-semibold mb-4">
              Securing your session
            </h2>
            <p className="text-gray-600">
              Please wait...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h2 className="text-red-600 text-xl font-semibold mb-4">
              Authentication Failed
            </h2>
            <p className="text-gray-600 break-words">
              {error}
            </p>
          </>
        )}

      </div>

    </div>

  );

}