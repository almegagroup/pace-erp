export default function QuickFilterInput({
  label = "Quick Filter",
  value,
  onChange,
  placeholder,
  hint,
  inputRef,
  primaryFocus = false,
  className = "",
  inputProps = {},
}) {
  return (
    <label className={`block ${className}`.trim()}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <input
        ref={inputRef}
        data-workspace-primary-focus={primaryFocus ? "true" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
        {...inputProps}
      />
      {hint ? (
        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
          {hint}
        </p>
      ) : null}
    </label>
  );
}
