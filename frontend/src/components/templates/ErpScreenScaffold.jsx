/*
 * File-ID: 9.10-FRONT
 * File-Path: frontend/src/components/templates/ErpScreenScaffold.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the canonical keyboard-native screen scaffold for dense ERP work surfaces
 * Authority: Frontend
 */

import { Fragment, useEffect, useMemo } from "react";

const ACTION_TONE_CLASS = Object.freeze({
  primary: "border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100",
  neutral: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100",
});

const METRIC_TONE_CLASS = Object.freeze({
  sky: "border-sky-200 bg-sky-50",
  emerald: "border-emerald-200 bg-emerald-50",
  rose: "border-rose-200 bg-rose-50",
  amber: "border-amber-200 bg-amber-50",
  slate: "border-slate-200 bg-slate-50",
});

const NOTICE_TONE_CLASS = Object.freeze({
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  neutral: "border-slate-200 bg-slate-50 text-slate-800",
});

const SECTION_TONE_CLASS = Object.freeze({
  default: "border-slate-200 bg-white",
  accent: "border-sky-200 bg-[#f8fbff]",
  warning: "border-amber-200 bg-[#fffaf2]",
  success: "border-emerald-200 bg-[#f5fffa]",
});

const RESERVED_MNEMONICS = new Set(["A", "C", "H", "K", "L", "M"]);

function extractHintMnemonic(hint) {
  const match = /^Alt\+([A-Z])$/i.exec(hint ?? "");
  return match ? match[1].toUpperCase() : null;
}

function findMnemonic(label, used) {
  const candidates = Array.from((label ?? "").toUpperCase()).filter((char) =>
    /[A-Z]/.test(char)
  );

  for (const char of candidates) {
    if (!used.has(char) && !RESERVED_MNEMONICS.has(char)) {
      used.add(char);
      return char;
    }
  }

  for (const char of candidates) {
    if (!used.has(char)) {
      used.add(char);
      return char;
    }
  }

  return null;
}

function withActionMnemonics(actions) {
  const used = new Set();

  return actions.map((action) => {
    const hintedMnemonic = extractHintMnemonic(action.hint);
    const mnemonic =
      action.mnemonic?.toUpperCase() ??
      (hintedMnemonic && !used.has(hintedMnemonic)
        ? hintedMnemonic
        : findMnemonic(action.label, used));

    if (hintedMnemonic) {
      used.add(hintedMnemonic);
    } else if (mnemonic) {
      used.add(mnemonic);
    }

    return {
      ...action,
      mnemonic,
      mnemonicHint: mnemonic ? `Alt+${mnemonic}` : null,
    };
  });
}

function renderMnemonicLabel(label, mnemonic) {
  if (!label || !mnemonic) {
    return label;
  }

  const index = label.toUpperCase().indexOf(mnemonic);

  if (index < 0) {
    return label;
  }

  return (
    <>
      {label.slice(0, index)}
      <span className="underline decoration-[1.5px] underline-offset-[3px]">
        {label[index]}
      </span>
      {label.slice(index + 1)}
    </>
  );
}

export function ErpMetricCard({
  label,
  value,
  caption,
  tone = "sky",
  badge = "",
}) {
  return (
    <article
      className={`border px-3 py-2 ${METRIC_TONE_CLASS[tone] ?? METRIC_TONE_CLASS.sky}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
        {badge ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-tight text-slate-900">
          {value}
        </h3>
        {caption ? (
          <p className="max-w-[16rem] text-right text-xs leading-5 text-slate-500">
            {caption}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function ErpFieldPreview({
  label,
  value,
  caption,
  multiline = false,
  tone = "default",
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-[#f5fffa]"
      : "border-slate-200 bg-white";

  return (
    <article className={`border px-3 py-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      {multiline ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
          {value || "Not available yet"}
        </p>
      ) : (
        <p className="mt-2 text-sm font-semibold text-slate-900">
          {value || "Not available yet"}
        </p>
      )}
      {caption ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">{caption}</p>
      ) : null}
    </article>
  );
}

export function ErpActionStrip({ actions = [] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action, index) => {
        const toneClass =
          action.disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            : ACTION_TONE_CLASS[action.tone] ?? ACTION_TONE_CLASS.neutral;

        return (
          <button
            key={action.key ?? `${action.label}-${index}`}
            ref={action.buttonRef}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            onKeyDown={action.onKeyDown}
            className={`border px-3 py-2 text-left transition ${toneClass}`}
          >
            <span className="block text-sm font-semibold">
              {renderMnemonicLabel(action.label, action.mnemonic)}
            </span>
            {[action.hint, action.mnemonicHint]
              .filter(Boolean)
              .filter((value, index, values) => values.indexOf(value) === index)
              .length > 0 ? (
              <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {[action.hint, action.mnemonicHint]
                  .filter(Boolean)
                  .filter((value, index, values) => values.indexOf(value) === index)
                  .join(" | ")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ErpSectionCard({
  eyebrow,
  title,
  description,
  aside,
  children,
  className = "",
  tone = "default",
}) {
  return (
    <section
      className={`border px-4 py-4 ${SECTION_TONE_CLASS[tone] ?? SECTION_TONE_CLASS.default} ${className}`.trim()}
    >
      {(eyebrow || title || description || aside) ? (
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-3">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-2 text-base font-semibold tracking-tight text-slate-900">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                {description}
              </p>
            ) : null}
          </div>
          {aside ? <Fragment>{aside}</Fragment> : null}
        </div>
      ) : null}
      <div className={eyebrow || title || description || aside ? "pt-4" : ""}>
        {children}
      </div>
    </section>
  );
}

export default function ErpScreenScaffold({
  eyebrow,
  title,
  description,
  actions = [],
  notices = [],
  metrics = [],
  footerHints = [],
  children,
}) {
  const resolvedActions = useMemo(() => withActionMnemonics(actions), [actions]);

  useEffect(() => {
    function handleMnemonic(event) {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        typeof event.key !== "string"
      ) {
        return;
      }

      const key = event.key.toUpperCase();
      const action = resolvedActions.find(
        (item) => !item.disabled && item.mnemonic === key
      );

      if (!action) {
        return;
      }

      event.preventDefault();
      action.onClick?.(event);
    }

    window.addEventListener("keydown", handleMnemonic, true);
    return () => window.removeEventListener("keydown", handleMnemonic, true);
  }, [resolvedActions]);

  return (
    <section className="min-h-full text-slate-900">
      <div className="mx-auto flex max-w-none flex-col gap-3">
        <div className="border border-slate-300 bg-white">
          <div className="border-b border-slate-300 bg-[#eef4fb] px-4 py-2">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-700">
                  {eyebrow}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {title}
                </h1>
                {description ? (
                  <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
                    {description}
                  </p>
                ) : null}
              </div>

              {actions.length > 0 ? (
                <div className="xl:justify-self-end">
                  <ErpActionStrip actions={resolvedActions} />
                </div>
              ) : null}
            </div>
          </div>

          {metrics.length > 0 ? (
            <div className="grid gap-2 border-b border-slate-300 bg-[#f8fbfd] px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric, index) => (
                <ErpMetricCard
                  key={metric.key ?? `${metric.label}-${index}`}
                  {...metric}
                />
              ))}
            </div>
          ) : null}

          {notices.length > 0 ? (
            <div className="grid gap-2 border-b border-slate-300 bg-white px-4 py-3">
              {notices.map((notice, index) => {
                if (!notice?.message) {
                  return null;
                }

                return (
                  <div
                    key={notice.key ?? `${notice.tone}-${index}`}
                    className={`border px-3 py-2 text-sm ${NOTICE_TONE_CLASS[notice.tone] ?? NOTICE_TONE_CLASS.info}`}
                  >
                    {notice.message}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">{children}</div>

        {footerHints.length > 0 ? (
          <div className="border border-slate-300 bg-[#f7f9fc] px-4 py-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {footerHints.map((hint) => (
                <span key={hint}>{hint}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
