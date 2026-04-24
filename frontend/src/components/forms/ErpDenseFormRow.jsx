/*
 * File-ID: FW-P1-1.2
 * File-Path: frontend/src/components/forms/ErpDenseFormRow.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Dense ERP form row primitive with fixed label width
 * Authority: Frontend
 */

export default function ErpDenseFormRow({
  label,
  required = false,
  error = "",
  children,
}) {
  return (
    <div className="grid gap-y-[var(--erp-form-gap)]">
      <div className="grid grid-cols-[160px_1fr] items-start gap-x-3">
        <label className="pt-[7px] text-[11px] font-medium text-slate-600">
          {label}
          {required ? (
            <span className="ml-1 text-rose-600" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        <div>{children}</div>
      </div>
      {error ? (
        <div className="col-start-2 ml-[172px] mt-0.5 text-[11px] text-rose-600">
          {error}
        </div>
      ) : null}
    </div>
  );
}
