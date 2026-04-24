/*
 * File-ID: FW-P1-1.6
 * File-Path: frontend/src/components/layout/ErpCommandStrip.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Sticky ERP command vocabulary strip for keyboard hints
 * Authority: Frontend
 */

export default function ErpCommandStrip({ hints = [] }) {
  const normalizedHints = (hints ?? []).filter(Boolean);

  if (normalizedHints.length === 0) {
    return null;
  }

  return (
    <div className="sticky bottom-0 z-20 flex h-7 items-center gap-0 overflow-x-auto bg-slate-900 px-4">
      {normalizedHints.map((hint, index) => (
        <div key={`${hint}-${index}`} className="flex items-center">
          <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] whitespace-nowrap text-slate-300">
            {hint}
          </span>
          {index < normalizedHints.length - 1 ? (
            <span className="text-slate-600">|</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
