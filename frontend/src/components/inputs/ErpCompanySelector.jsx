/*
 * File-ID: PHASE3D-ERP-COMPANY-SELECTOR
 * File-Path: frontend/src/components/inputs/ErpCompanySelector.jsx
 * Phase: 3
 * Domain: FRONT
 * Purpose: Keyboard-first company selector for in-page company selection.
 *
 * Rules:
 *   - mode="required"  → blank placeholder shown, empty string value = no selection (caller must block action)
 *   - mode="all"       → first option is "* All Companies" (value = "*"); used for inbox / report filters
 *   - Keyboard-first: standard <select> with full browser keyboard support
 *   - Type 1 users: pre-filled + read-only (pass readOnly prop)
 *   - Type 2 users: selectable dropdown
 *   - Never used for ACL decisions — display and UX only
 */

/**
 * @param {object} props
 * @param {Array<{id: string, company_code: string, company_name: string}>} props.companies
 * @param {string} props.value — selected company ID, or "" for blank, or "*" for All (mode="all")
 * @param {function} props.onChange — called with new value string
 * @param {"required"|"all"} [props.mode="required"] — "required" = blank placeholder; "all" = * All Companies option
 * @param {string} [props.label="Company"]
 * @param {boolean} [props.disabled=false]
 * @param {boolean} [props.readOnly=false] — renders as read-only display, not a select
 * @param {React.Ref} [props.selectRef]
 * @param {string} [props.hint] — optional keyboard hint label, e.g. "Alt+Y"
 */
export default function ErpCompanySelector({
  companies,
  value,
  onChange,
  mode = "required",
  label = "Company",
  disabled = false,
  readOnly = false,
  selectRef,
  hint,
}) {
  const safeCompanies = Array.isArray(companies) ? companies : [];

  const selectedCompany =
    value && value !== "*"
      ? safeCompanies.find((c) => c.id === value) ?? null
      : null;

  const displayLabel = selectedCompany
    ? `${selectedCompany.company_code} | ${selectedCompany.company_name}`
    : mode === "all" && value === "*"
      ? "* All Companies"
      : "—";

  if (readOnly) {
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </span>
          {hint ? (
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {hint}
            </span>
          ) : null}
        </div>
        <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {displayLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </span>
        {hint ? (
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {hint}
          </span>
        ) : null}
      </div>
      <select
        ref={selectRef}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      >
        {mode === "required" ? (
          <option value="">— Select company —</option>
        ) : (
          <option value="*">* All Companies</option>
        )}
        {safeCompanies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.company_code} | {company.company_name}
          </option>
        ))}
      </select>
    </div>
  );
}
