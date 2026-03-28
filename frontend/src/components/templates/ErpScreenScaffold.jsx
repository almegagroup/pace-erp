/*
 * File-ID: 9.10-FRONT
 * File-Path: frontend/src/components/templates/ErpScreenScaffold.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the canonical keyboard-native screen scaffold for dense ERP work surfaces
 * Authority: Frontend
 */

import { Fragment } from "react";

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
            <span className="block text-sm font-semibold">{action.label}</span>
            {action.hint ? (
              <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {action.hint}
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
  return (
    <section className="min-h-full text-slate-900">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-3">
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
                  <ErpActionStrip actions={actions} />
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
