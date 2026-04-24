/*
 * File-ID: FW-P1-1.4
 * File-Path: frontend/src/components/forms/ErpSelectionSection.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Plain divider label for ERP selection screen sections
 * Authority: Frontend
 */

export default function ErpSelectionSection({ label }) {
  return (
    <div className="mb-2 mt-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">
        {label}
      </span>
      <div className="mt-1 border-b border-slate-300" />
    </div>
  );
}
