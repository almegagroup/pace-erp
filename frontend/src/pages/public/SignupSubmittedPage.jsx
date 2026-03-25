/*
 * File-ID: UI-5
 * File-Path: frontend/src/pages/public/SignupSubmittedPage.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP signup request submitted confirmation
 * Authority: Frontend
 */

import { useNavigate } from "react-router-dom";
import PublicAuthShell from "./PublicAuthShell.jsx";

export default function SignupSubmittedPage() {
  const navigate = useNavigate();

  return (
    <PublicAuthShell
      cardWidthClass="max-w-[460px]"
      logoWidthClass="w-[380px]"
      title="Signup Request Submitted"
      subtitle="Your ERP account request has been submitted successfully. An administrator will review and approve your account before access is granted."
    >
      <div className="flex justify-center">
        <button
          onClick={() => navigate("/")}
          className="rounded-2xl bg-[#1E3A8A] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(30,58,138,0.22)] transition hover:opacity-90"
        >
          Back to Home
        </button>
      </div>
    </PublicAuthShell>
  );
}
