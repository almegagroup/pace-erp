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

useEffect(()=>{

  const timer = setTimeout(()=>{
    setBooting(false);
  },1800);

  return ()=>clearTimeout(timer);

},[]);

  return (

    <div className="min-h-screen bg-[#F5F6F8] relative">

      {/* ============================= */}
      {/* BOOT LOADER (FULL SCREEN) */}
      {/* ============================= */}

     {booting && (

<div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F5F6F8] z-50">

<div className="w-[600px] mb-8">
<img
src={boot}
alt="PACE ERP Boot"
className="w-full h-auto"
loading="eager"
/>
</div>

<div className="w-[420px] h-[4px] bg-gray-200 rounded overflow-hidden">

<div className="h-full bg-[#1E3A8A] w-0 animate-loader"/>

</div>

</div>

)}

      {/* ============================= */}
      {/* LANDING CONTENT */}
      {/* ============================= */}

      {!booting && (

        <div className="min-h-screen flex flex-col items-center pt-2">

          <div className="w-[600px] mb-3">
<img
src={logo}
alt="PACE ERP"
className="w-full h-auto"
loading="eager"
/>
</div>

          <p className="text-[22px] text-gray-700 tracking-wide mb-6 text-center">
            Process Automation & Control Environment
          </p>

          <div className="flex gap-5">

            <Link to="/login">

              <button className="px-8 py-3 bg-[#1E3A8A] text-white rounded-lg shadow hover:opacity-90 transition">
                Login
              </button>

            </Link>

            <Link to="/signup">

              <button className="px-8 py-3 border border-[#E5E7EB] bg-white rounded-lg shadow hover:bg-gray-50 transition">
                Sign Up
              </button>

            </Link>

          </div>

        </div>

      )}

      {/* ============================= */}
      {/* FOOTER */}
      {/* ============================= */}

      <div className="absolute bottom-6 w-full text-center text-gray-500 text-sm">
        © Almega Group
      </div>

    </div>

  );

}