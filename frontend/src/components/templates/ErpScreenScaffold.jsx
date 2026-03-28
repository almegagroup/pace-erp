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
  primary:
    "border-emerald-400/30 bg-emerald-400/12 text-emerald-50 hover:bg-emerald-400/18",
  neutral:
    "border-white/8 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]",
  danger:
    "border-rose-400/30 bg-rose-400/12 text-rose-50 hover:bg-rose-400/18",
});

const METRIC_TONE_CLASS = Object.freeze({
  sky: "border-cyan-400/25 bg-cyan-400/10 text-cyan-50",
  emerald: "border-emerald-400/25 bg-emerald-400/10 text-emerald-50",
  rose: "border-rose-400/25 bg-rose-400/10 text-rose-50",
  amber: "border-amber-400/25 bg-amber-400/10 text-amber-50",
  slate: "border-white/8 bg-white/[0.04] text-slate-50",
});

const NOTICE_TONE_CLASS = Object.freeze({
  success: "border-emerald-400/30 bg-emerald-400/12 text-emerald-50",
  error: "border-rose-400/30 bg-rose-400/12 text-rose-50",
  info: "border-cyan-400/25 bg-cyan-400/10 text-cyan-50",
  neutral: "border-white/8 bg-white/[0.04] text-slate-100",
});

const SECTION_TONE_CLASS = Object.freeze({
  default: "border-white/8 bg-[#0d1a21]",
  accent: "border-emerald-400/20 bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(10,23,29,0.92))]",
  warning: "border-amber-400/20 bg-[linear-gradient(180deg,rgba(245,158,11,0.08),rgba(10,23,29,0.92))]",
  success: "border-emerald-400/20 bg-[linear-gradient(180deg,rgba(52,211,153,0.08),rgba(10,23,29,0.92))]",
});

export function ErpMetricCard({
  label,
  value,
  caption,
  tone = "sky",
  badge = "Live",
}) {
  return (
    <article
      className={`rounded-[24px] border px-4 py-4 ${METRIC_TONE_CLASS[tone] ?? METRIC_TONE_CLASS.sky}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300">
          {label}
        </p>
        {badge ? (
          <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-200">
            {badge}
          </span>
        ) : null}
      </div>
      <h3 className="mt-4 text-2xl font-semibold tracking-tight text-white">
        {value}
      </h3>
      {caption ? (
        <p className="mt-3 text-sm leading-6 text-slate-300">{caption}</p>
      ) : null}
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
      ? "border-emerald-400/20 bg-emerald-400/10"
      : "border-white/8 bg-black/10";

  return (
    <article className={`rounded-[22px] border px-4 py-4 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </p>
      {multiline ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">
          {value || "Not available yet"}
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-white">
          {value || "Not available yet"}
        </p>
      )}
      {caption ? (
        <p className="mt-3 text-xs leading-5 text-slate-400">{caption}</p>
      ) : null}
    </article>
  );
}

export function ErpActionStrip({ actions = [] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action, index) => {
        const toneClass =
          action.disabled
            ? "cursor-not-allowed border-white/6 bg-white/[0.03] text-slate-500"
            : ACTION_TONE_CLASS[action.tone] ?? ACTION_TONE_CLASS.neutral;

        return (
          <button
            key={action.key ?? `${action.label}-${index}`}
            ref={action.buttonRef}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            onKeyDown={action.onKeyDown}
            className={`rounded-2xl border px-4 py-3 text-left transition ${toneClass}`}
          >
            <span className="block text-sm font-semibold">{action.label}</span>
            {action.hint ? (
              <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-slate-400">
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
      className={`rounded-[28px] border px-5 py-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)] ${SECTION_TONE_CLASS[tone] ?? SECTION_TONE_CLASS.default} ${className}`.trim()}
    >
      {(eyebrow || title || description || aside) ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-3 text-lg font-semibold tracking-tight text-white">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
                {description}
              </p>
            ) : null}
          </div>
          {aside ? <Fragment>{aside}</Fragment> : null}
        </div>
      ) : null}
      <div className={eyebrow || title || description || aside ? "mt-5" : ""}>
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
    <section className="min-h-full text-slate-100">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <div className="rounded-[30px] border border-white/8 bg-[#0b161c] px-5 py-5 shadow-[0_20px_56px_rgba(0,0,0,0.28)]">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-300">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {title}
              </h1>
              {description ? (
                <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
                  {description}
                </p>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Screen Actions
              </p>
              <div className="mt-3">
                {actions.length > 0 ? (
                  <ErpActionStrip actions={actions} />
                ) : (
                  <p className="text-sm text-slate-400">
                    No direct actions registered on this surface yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          {metrics.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric, index) => (
                <ErpMetricCard
                  key={metric.key ?? `${metric.label}-${index}`}
                  {...metric}
                />
              ))}
            </div>
          ) : null}

          {notices.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {notices.map((notice, index) => {
                if (!notice?.message) {
                  return null;
                }

                return (
                  <div
                    key={notice.key ?? `${notice.tone}-${index}`}
                    className={`rounded-[22px] border px-4 py-3 text-sm ${NOTICE_TONE_CLASS[notice.tone] ?? NOTICE_TONE_CLASS.info}`}
                  >
                    {notice.message}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4">{children}</div>

        {footerHints.length > 0 ? (
          <div className="rounded-[24px] border border-white/8 bg-[#091319] px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Operating Flow
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {footerHints.map((hint) => (
                <span
                  key={hint}
                  className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300"
                >
                  {hint}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
