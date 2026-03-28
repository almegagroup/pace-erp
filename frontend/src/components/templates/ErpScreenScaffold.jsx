import { Fragment } from "react";

const ACTION_TONE_CLASS = Object.freeze({
  primary:
    "border border-sky-200 bg-sky-50 text-sky-700 shadow-[0_10px_24px_rgba(14,116,144,0.08)]",
  neutral:
    "border border-slate-200 bg-white text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]",
  danger:
    "border border-rose-200 bg-rose-50 text-rose-700 shadow-[0_10px_24px_rgba(190,24,93,0.08)]",
});

const METRIC_TONE_CLASS = Object.freeze({
  sky: "bg-sky-50 text-sky-700",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-700",
});

const NOTICE_TONE_CLASS = Object.freeze({
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_12px_30px_rgba(16,185,129,0.08)]",
  error:
    "border-rose-200 bg-rose-50 text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]",
  info: "border-sky-200 bg-sky-50 text-sky-700 shadow-[0_12px_30px_rgba(14,116,144,0.08)]",
  neutral:
    "border-slate-200 bg-white text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.06)]",
});

export function ErpMetricCard({
  label,
  value,
  caption,
  tone = "sky",
  badge = "Live",
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold text-slate-900">{value}</h3>
        {badge ? (
          <span
            className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              METRIC_TONE_CLASS[tone] ?? METRIC_TONE_CLASS.sky
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      {caption ? (
        <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
      ) : null}
    </article>
  );
}

export function ErpFieldPreview({
  label,
  value,
  caption,
  multiline = false,
  tone = "white",
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : "border-slate-200 bg-white";

  return (
    <article className={`rounded-[28px] border p-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)] ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      {multiline ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-900">
          {value || "Not available yet"}
        </p>
      ) : (
        <p className="mt-3 text-base font-semibold text-slate-900">
          {value || "Not available yet"}
        </p>
      )}
      {caption ? (
        <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
      ) : null}
    </article>
  );
}

export function ErpActionStrip({ actions = [] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {actions.map((action, index) => {
        const toneClass =
          action.disabled
            ? "cursor-not-allowed bg-slate-200 text-slate-500 shadow-none"
            : ACTION_TONE_CLASS[action.tone] ?? ACTION_TONE_CLASS.neutral;

        return (
          <button
            key={action.key ?? `${action.label}-${index}`}
            ref={action.buttonRef}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            onKeyDown={action.onKeyDown}
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ${toneClass}`}
          >
            <span>{action.label}</span>
            {action.hint ? (
              <span className="ml-2 text-[10px] uppercase tracking-[0.16em] opacity-70">
                {action.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default function ErpScreenScaffold({
  eyebrow,
  title,
  description,
  actions = [],
  notices = [],
  metrics = [],
  children,
}) {
  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-4 z-20 rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                {title}
              </h1>
              {description ? (
                <p className="mt-3 text-sm leading-7 text-slate-500">
                  {description}
                </p>
              ) : null}
            </div>

            {actions.length > 0 ? <ErpActionStrip actions={actions} /> : null}
          </div>
        </div>

        {notices.map((notice, index) => {
          if (!notice?.message) {
            return null;
          }

          return (
            <div
              key={notice.key ?? `${notice.tone}-${index}`}
              className={`mt-4 rounded-[28px] border px-5 py-4 text-sm ${
                NOTICE_TONE_CLASS[notice.tone] ?? NOTICE_TONE_CLASS.info
              }`}
            >
              {notice.message}
            </div>
          );
        })}

        {metrics.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric, index) => (
              <ErpMetricCard
                key={metric.key ?? `${metric.label}-${index}`}
                {...metric}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}

export function ErpSectionCard({
  eyebrow,
  title,
  description,
  aside,
  children,
  className = "",
}) {
  return (
    <section
      className={`rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)] ${className}`.trim()}
    >
      {(eyebrow || title || description || aside) ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-4 text-sm leading-7 text-slate-600">
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
