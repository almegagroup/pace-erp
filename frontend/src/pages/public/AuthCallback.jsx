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
        const flow = url.searchParams.get("flow");

        /* ==============================
        STEP 1 — EXCHANGE SESSION (MANDATORY)
        ============================== */

        if(!code){
          throw new Error("Invalid or expired auth link");
        }

        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);

        if(exchangeError){
          throw exchangeError;
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
        navigate("/email-verified",{ replace:true });

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