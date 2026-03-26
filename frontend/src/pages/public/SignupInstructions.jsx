import { Link } from "react-router-dom";
import PublicAuthShell from "./PublicAuthShell.jsx";

const INSTRUCTIONS = [
  {
    label: "Full Name",
    detail: "Enter your full name in ALL CAPITAL LETTERS.",
  },
  {
    label: "Parent Company",
    detail: 'Enter the full company name followed by "-" and the location city.',
  },
  {
    label: "Designation",
    detail: "Enter your current designation.",
  },
  {
    label: "Phone Number",
    detail: "Enter only 10 digits. Do not use any country code.",
  },
  {
    label: "Email",
    detail: "Use an email ID you will remember. Password reset will use this same email ID.",
  },
  {
    label: "Password",
    detail: "Minimum 8 characters with 1 capital letter, 1 special character, and 1 numeric digit. This password will also be used for login.",
  },
];

export default function SignupInstructions() {
  return (
    <PublicAuthShell
      cardWidthClass="max-w-[900px]"
      logoWidthClass="w-[380px]"
      title="Please review before Sign Up"
      subtitle="Read these instructions carefully before you continue to the signup form."
      showTagline
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {INSTRUCTIONS.map((item) => (
          <article
            key={item.label}
            className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.06)]"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              {item.label}
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {item.detail}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
        <Link to="/" className="sm:min-w-[180px]">
          <button className={secondaryButtonClassName}>Back</button>
        </Link>

        <Link to="/signup" className="sm:min-w-[220px]">
          <button className={primaryButtonClassName}>OK, Continue</button>
        </Link>
      </div>
    </PublicAuthShell>
  );
}

const primaryButtonClassName =
  "w-full rounded-2xl bg-[#1E3A8A] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(30,58,138,0.22)] transition hover:opacity-90";

const secondaryButtonClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:bg-slate-50";
